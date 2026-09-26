"""Probe validation fixtures; HTTP/2 integration uses optional tools/requirements.txt."""
import argparse
import asyncio
from contextlib import redirect_stderr, redirect_stdout
import io
import importlib.util
import json
import os
from pathlib import Path
import runpy
import ssl
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from probe_response import ipv4_address, validate_brotli_response, report_headers, receive_headers, report_qlog, require_distinct_report

try:
    import h2.config
    import h2.connection
    import h2.events
    HAVE_H2 = True
except ImportError:
    HAVE_H2 = False

ROOT = Path(__file__).resolve().parent


class ResponseTests(unittest.TestCase):
    @unittest.skipUnless(HAVE_H2, 'Install tools/requirements.txt for HTTP/2 measurement')
    def test_measurement_rejects_disabled_framing_assertions_before_running(self):
        for flags, extra_env in [(['-O'], {}), ([], {'PYTHONOPTIMIZE': '1'})]:
            with self.subTest(flags=flags, env=extra_env):
                result = subprocess.run([sys.executable, *flags, str(ROOT / 'measure-transport.py'), '--help'],
                                        env={**os.environ, **extra_env}, capture_output=True, text=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('requires Python assertions', result.stderr)

    def test_report_cannot_overwrite_input_through_direct_symbolic_or_hard_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.write_bytes(b'input')
            symbolic = root / 'symbolic'
            symbolic.symlink_to(source)
            hard = root / 'hard'
            hard.hardlink_to(source)
            for output in (source, symbolic, hard):
                with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'aliases an input'):
                    require_distinct_report(output, [source])
            require_distinct_report(root / 'new-report', [source])
            self.assertEqual(source.read_bytes(), b'input')

    def test_cli_rejects_output_alias_before_contacting_server(self):
        for script, dependency in [('measure-transport.py', 'h2'), ('measure-http3.py', 'aioquic')]:
            if importlib.util.find_spec(dependency) is None:
                continue
            with self.subTest(script=script), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / 'expected.br'
                source.write_bytes(b'preserve input')
                for flag in ('--expected-body', '--ca'):
                    result = subprocess.run([sys.executable, str(ROOT / script), '--ip', '127.0.0.1',
                                             '--port', '1', flag, str(source), '--out', str(source)],
                                            capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn('aliases an input file', result.stderr)
                    self.assertEqual(source.read_bytes(), b'preserve input')

    def test_status_encoding_and_exact_body_are_all_required(self):
        headers = [(':status', '200'), ('content-encoding', 'br')]
        validate_brotli_response(headers, b'encoded page', b'encoded page', 'stream 1')
        for changed, body in [([(':status', '404'), ('content-encoding', 'br')], b'encoded page'),
                              ([(':status', '200')], b'encoded page'),
                              ([(':status', '200'), ('content-encoding', 'gzip')], b'encoded page'),
                              (headers + [(':status', '200')], b'encoded page'),
                              (headers + [('content-encoding', 'br')], b'encoded page'),
                              (headers, b'wrong page')]:
            with self.subTest(headers=changed, body=body), self.assertRaises(ValueError):
                validate_brotli_response(changed, body, b'encoded page', 'stream 3')

    def test_cookie_redaction_preserves_other_headers_and_input(self):
        headers = [(':status', '200'), ('Set-Cookie', 'secret1'), ('cookie', 'secret2'),
                   ('set-cookie2', 'secret3'), ('content-encoding', 'br')]
        public = report_headers(headers)
        self.assertEqual(public, [(':status', '200'), ('Set-Cookie', '<redacted>'),
                                 ('cookie', '<redacted>'), ('set-cookie2', '<redacted>'),
                                 ('content-encoding', 'br')])
        self.assertEqual(headers[1][1], 'secret1')

    def test_nested_qlog_cookies_are_redacted_without_changing_lengths(self):
        events = [{'name': 'http:frame_parsed', 'data': {'length': 63, 'stream_id': 0,
                   'frame': {'frame_type': 'headers', 'headers': [
                       {'name': ':status', 'value': '200'},
                       {'name': 'set-cookie', 'value': 'session=secret'}]}}}]
        public = report_qlog(events)
        self.assertNotIn('session=secret', json.dumps(public))
        self.assertIn('session=secret', json.dumps(events))
        self.assertEqual(public[0]['data']['length'], 63)
        self.assertEqual(public[0]['data']['frame']['headers'][0]['value'], '200')

    def test_http3_trailers_do_not_replace_status_or_encoding(self):
        response = {'headers': []}
        receive_headers(response, [(':status', '103'), ('link', '</style>;rel=preload')])
        receive_headers(response, [(':status', '200'), ('content-encoding', 'br')])
        receive_headers(response, [('set-cookie', 'trailer-secret')])
        validate_brotli_response(response['headers'], b'page', b'page', 'stream 0')
        self.assertEqual(report_headers(response['trailers']), [('set-cookie', '<redacted>')])

    def test_only_literal_ipv4_can_use_ipv4_framing_accounting(self):
        self.assertEqual(ipv4_address('127.0.0.1'), '127.0.0.1')
        for value in ('::1', '::ffff:127.0.0.1', 'localhost', '999.1.1.1', '127.00.0.1'):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                ipv4_address(value)


@unittest.skipUnless(HAVE_H2, 'Install tools/requirements.txt for in-memory HTTP/2 integration')
class Http2ProbeTests(unittest.TestCase):
    def run_probe(self, response=None, close_early=False, heartbeat=False, slow_handshake=False):
        """Run the real CLI and hyper-h2 exchange with an in-memory TLS socket."""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        expected = b'exact Brotli fixture bytes'
        (root / 'expected.br').write_bytes(expected)
        sockets, contexts, clock = [], [], [0]

        class Socket:
            def __init__(self):
                self.closed = False
                sockets.append(self)
            def __enter__(self): return self
            def __exit__(self, *args): self.closed = True
            def settimeout(self, value): pass
            def connect(self, address): pass
            def bind(self, address): pass
            def sendall(self, data): pass
            def recv(self, capacity): return b'TLS handshake fragment'
            def getsockname(self): return ('127.0.0.1', 12345)

        class TLS:
            def __init__(self, outgoing, session):
                self.outgoing = outgoing
                self.index = len(contexts)
                contexts.append(self)
                self.session_reused = session is not None
                self.session = object()
                self.server = h2.connection.H2Connection(config=h2.config.H2Configuration(
                    client_side=False, header_encoding='utf-8'))
                self.server.initiate_connection()
            def do_handshake(self):
                if slow_handshake:
                    clock[0] += 6
                    raise ssl.SSLWantReadError()
            def selected_alpn_protocol(self): return 'h2'
            def version(self): return 'TLSv1.3'
            def cipher(self): return ('TLS_AES_128_GCM_SHA256', 'TLSv1.3', 128)
            def getpeercert(self, binary_form=False): return b'certificate fixture'
            def unwrap(self): pass
            def write(self, data):
                self.outgoing.write(b'\x17\x03\x03' + len(data).to_bytes(2, 'big') + data)
                for event in self.server.receive_data(data):
                    if isinstance(event, h2.events.RequestReceived):
                        headers = [(':status', '200'), ('content-encoding', 'br'),
                                   ('set-cookie', 'private-cookie-must-not-be-published')]
                        body, reset = expected, False
                        if response:
                            headers, body, reset = response(self.index, event.stream_id, headers, body)
                        if reset:
                            self.server.reset_stream(event.stream_id, error_code=8)
                        else:
                            ended = not (close_early or heartbeat)
                            self.server.send_headers(event.stream_id, headers, end_stream=ended and not body)
                            if body: self.server.send_data(event.stream_id, body, end_stream=ended)
                return len(data)
            def read(self, capacity):
                if heartbeat:
                    clock[0] += 6
                    self.server.ping(b'12345678')
                data = self.server.data_to_send()
                if close_early and not data: return b''
                if not data: raise AssertionError('Probe waited instead of rejecting the response')
                return data

        class Context:
            def set_alpn_protocols(self, protocols): pass
            def wrap_bio(self, incoming, outgoing, server_side, server_hostname, session=None):
                return TLS(outgoing, session)

        error = None
        with patch('socket.socket', Socket), patch('ssl.create_default_context', return_value=Context()), \
             patch('time.monotonic', side_effect=lambda: clock[0]), \
             patch('select.select', return_value=([], [], [])), \
             patch.object(sys, 'argv', ['measure-transport.py', '--ip', '127.0.0.1', '--minimal',
                                       '--expected-body', str(root / 'expected.br'), '--out', str(root / 'report.json')]), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            try:
                runpy.run_path(str(ROOT / 'measure-transport.py'), run_name='__main__')
            except (ValueError, RuntimeError, EOFError, TimeoutError) as exception:
                error = exception
        self.assertTrue(sockets)
        self.assertTrue(all(sock.closed for sock in sockets), 'Every owned socket closes on failure')
        report = json.loads((root / 'report.json').read_text()) if (root / 'report.json').exists() else None
        return report, error

    def test_all_four_responses_are_validated_and_cookie_values_are_not_published(self):
        report, error = self.run_probe()
        self.assertIsNone(error)
        self.assertEqual(sum(len(item['requests']) for item in report['measurements']), 4)
        self.assertEqual(report['measurements'][1]['connection'], 'resumption_attempt')
        self.assertTrue(report['measurements'][1]['session_reused'])
        self.assertNotIn('private-cookie-must-not-be-published', json.dumps(report))
        self.assertIn('<redacted>', json.dumps(report))

    def test_bad_reused_responses_fail_without_publishing_a_measurement(self):
        for target in ((0, 3), (1, 1), (1, 3)):
            with self.subTest(connection=target[0], stream=target[1]):
                def response(connection, stream, headers, body):
                    return headers, b'wrong body' if (connection, stream) == target else body, False
                report, error = self.run_probe(response)
                self.assertIsNone(report)
                self.assertIsInstance(error, ValueError)
                self.assertIn('response body differs', str(error))

    def test_wrong_metadata_fails_even_when_compressed_bytes_match(self):
        for headers in ([(':status', '404'), ('content-encoding', 'br')],
                        [(':status', '200'), ('content-encoding', 'gzip')]):
            with self.subTest(headers=headers):
                report, error = self.run_probe(lambda connection, stream, previous, body: (headers, body, False))
                self.assertIsNone(report)
                self.assertIsInstance(error, ValueError)

    def test_reset_stream_fails_immediately_and_closes_socket(self):
        report, error = self.run_probe(lambda connection, stream, headers, body: (headers, body, True))
        self.assertIsNone(report)
        self.assertIsInstance(error, RuntimeError)
        self.assertIn('before a complete response', str(error))

    def test_clean_tls_close_before_end_stream_fails_promptly(self):
        report, error = self.run_probe(close_early=True)
        self.assertIsNone(report)
        self.assertIsInstance(error, EOFError)
        self.assertIn('before a complete HTTP/2 response', str(error))

    def test_oversized_body_fails_before_waiting_for_end_stream(self):
        report, error = self.run_probe(lambda connection, stream, headers, body: (headers, body + b'x', False), close_early=True)
        self.assertIsNone(report)
        self.assertIsInstance(error, ValueError)
        self.assertIn('exceeds the local Brotli representation', str(error))

    def test_continuous_ping_frames_cannot_extend_response_deadline(self):
        report, error = self.run_probe(heartbeat=True)
        self.assertIsNone(report)
        self.assertIsInstance(error, TimeoutError)
        self.assertIn('response on stream 1 exceeded', str(error))

    def test_slow_handshake_fragments_cannot_extend_handshake_deadline(self):
        report, error = self.run_probe(slow_handshake=True)
        self.assertIsNone(report)
        self.assertIsInstance(error, TimeoutError)
        self.assertIn('handshake exceeded', str(error))


@unittest.skipUnless(importlib.util.find_spec('aioquic'), 'Install tools/requirements.txt for HTTP/3 events')
class Http3ProbeTests(unittest.TestCase):
    def test_oversized_body_rejects_waiter_before_end_stream(self):
        from aioquic.h3.events import DataReceived
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'expected.br'
            source.write_bytes(b'page')
            # Load the real protocol class without opening its CLI connection.
            with patch.object(sys, 'argv', ['measure-http3.py', '--ip', '127.0.0.1',
                                           '--expected-body', str(source), '--out', str(root / 'report.json')]), \
                 patch('asyncio.run', side_effect=lambda coroutine: coroutine.close()):
                module = runpy.run_path(str(ROOT / 'measure-http3.py'), run_name='probe_fixture')
            async def exercise():
                client = module['Client'].__new__(module['Client'])
                events = [DataReceived(data=b'page', stream_id=0, stream_ended=False),
                          DataReceived(data=b'excess', stream_id=0, stream_ended=False)]
                client.http = SimpleNamespace(handle_event=lambda event: events)
                client.responses = {0: {'body': b'', 'headers': []}}
                client.waiters = {0: asyncio.get_running_loop().create_future()}
                client.quic_event_received(object())
                with self.assertRaisesRegex(ValueError, 'exceeds the local Brotli representation'):
                    await client.waiters[0]
                self.assertEqual(client.responses[0]['body'], b'page')
            asyncio.run(exercise())


if __name__ == '__main__':
    unittest.main()
