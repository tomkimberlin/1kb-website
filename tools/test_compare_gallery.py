"""Gallery decoding, HTTP/2, capture bounds and cleanup regressions without live traffic."""
import gzip
import os
import importlib.util
from pathlib import Path
import tempfile
import struct
import threading
import unittest
from unittest.mock import patch
import zlib

import brotli
import zstandard
import h2.config
import h2.connection
import h2.events
from hyperframe.frame import PingFrame

spec = importlib.util.spec_from_file_location('gallery', Path(__file__).with_name('compare-gallery.py'))
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)


def packet_frame(payload=0, peer='192.0.2.1', port=46240):
    ip = bytearray(20)
    ip[0] = 0x45
    ip[2:4] = struct.pack('!H', 40 + payload)
    ip[9] = 6
    ip[12:16] = gallery.socket.inet_aton(peer)
    ip[16:20] = gallery.socket.inet_aton('192.0.2.2')
    tcp = bytearray(20)
    tcp[:4] = struct.pack('!HH', 443, port)
    tcp[4:8] = (120).to_bytes(4, 'big')
    tcp[12:14] = b'\x50\x18'
    return b'\0' * 12 + b'\x08\x00' + ip + tcp + b'x' * payload


class FakeSocket:
    def __init__(self):
        self.closed = False

    def settimeout(self, value): pass
    def bind(self, address): pass
    def connect(self, address): pass
    def getsockname(self): return ('192.0.2.2', 46240)
    def sendall(self, data): pass
    def close(self): self.closed = True


class FakeThread:
    def __init__(self, **kwargs):
        self.started = False
        self.joined = False
        self.args = kwargs.get('args', ())
        self.action = kwargs.get('action', lambda args: args[2].append(gallery.tcp_packet(packet_frame(), '192.0.2.1', 46240, args[6])))

    def start(self): self.started = True; self.action(self.args)
    def join(self): self.joined = True


class FakeTLS:
    def __init__(self, body, encoding):
        self.request = b''
        self.response = (b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(len(body)).encode()
                         + b'\r\nContent-Encoding: ' + encoding.encode() + b'\r\n\r\n' + body)

    def do_handshake(self): pass
    def selected_alpn_protocol(self): return 'http/1.1'
    def version(self): return 'TLSv1.3'
    def cipher(self): return ('fixture',)
    def getpeercert(self, binary_form=False): return b'fixture certificate'
    def write(self, data): self.request += data; return len(data)
    def read(self, size):
        response, self.response = self.response, b''
        return response
    def unwrap(self): pass


class H2TLS(FakeTLS):
    def __init__(self, action, repeat=None):
        self.request = b''
        self.response = b''
        self.repeat = repeat
        self.server = h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=False))
        self.server.initiate_connection()
        self.response += self.server.data_to_send()
        self.action = action

    def selected_alpn_protocol(self): return 'h2'

    def write(self, data):
        self.request += data
        for event in self.server.receive_data(data):
            if isinstance(event, h2.events.RequestReceived):
                self.action(self.server)
        self.response += self.server.data_to_send()
        return len(data)

    def read(self, size):
        if self.response:
            return super().read(size)
        return self.repeat() if self.repeat else b''


class FakeContext:
    def __init__(self, tls): self.tls = tls
    def set_alpn_protocols(self, protocols): pass
    def set_ecdh_curve(self, curve): raise ValueError('unsupported fixture curve')
    def wrap_bio(self, incoming, outgoing, server_hostname): return self.tls


class GalleryTests(unittest.TestCase):
    source = b'<!DOCTYPE html><title>Small</title><p>Correct decoded bytes.'

    def test_output_preflight_rejects_input_and_cross_output_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            report = output / 'results.json'; html = output / 'example.com.html'
            inputs = [Path(gallery.__file__), Path(gallery.__file__).with_name('dns_measurement.py'),
                      Path(gallery.__file__).with_name('probe_response.py')]
            for target in inputs:
                before = target.read_bytes()
                for destination in [report, html]:
                    for kind in ['symbolic', 'hard']:
                        if kind == 'symbolic': destination.symlink_to(target)
                        else: os.link(target, destination)
                        try:
                            with self.subTest(target=target, destination=destination, kind=kind), \
                                 patch.object(gallery.socket, 'gethostbyname') as network:
                                with self.assertRaises(ValueError): gallery.run('https://example.com/', 46240, output)
                                network.assert_not_called()
                        finally: destination.unlink()
                        self.assertEqual(target.read_bytes(), before)
            report.write_text('previous report'); os.link(report, html)
            with self.assertRaisesRegex(ValueError, 'distinct files'):
                gallery.validate_outputs(['https://example.com/'], output)
            self.assertEqual(report.read_text(), 'previous report')
            html.unlink(); report.unlink(); html.mkdir()
            with self.assertRaisesRegex(ValueError, 'regular file'):
                gallery.validate_outputs(['https://example.com/'], output)

    def run_probe(self, body=None, encoding='identity', url='https://example.com/', curve=None,
                  context_error=None, tls=None, thread_action=None):
        self.raw, self.tcp = FakeSocket(), FakeSocket()
        self.thread = FakeThread()
        self.tls = tls or FakeTLS(self.source if body is None else body, encoding)
        def make_thread(**kwargs):
            if thread_action is not None: kwargs['action'] = thread_action
            self.thread = FakeThread(**kwargs)
            return self.thread
        context = FakeContext(self.tls)
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(gallery.socket, 'AF_PACKET', 17, create=True), \
             patch.object(gallery.socket, 'gethostbyname', return_value='192.0.2.1'), \
             patch.object(gallery.socket, 'socket', side_effect=[self.raw, self.tcp]), \
             patch.object(gallery, 'dns', return_value=[]), \
             patch.object(gallery.threading, 'Thread', side_effect=make_thread), \
             patch.object(gallery.ssl, 'create_default_context', return_value=context, side_effect=context_error), \
             patch.object(gallery.select, 'select', return_value=([], [], [])), \
             patch.object(gallery.time, 'sleep'):
            result = gallery.run(url, 46240, Path(directory), curve)
            self.decoded = (Path(directory) / 'example.com.html').read_bytes()
            return result

    def test_query_is_sent_and_fragment_is_not(self):
        self.run_probe(url='https://example.com/search?q=one%20byte&x=2#ignored')
        self.assertTrue(self.tls.request.startswith(b'GET /search?q=one%20byte&x=2 HTTP/1.1\r\n'))

    def test_every_advertised_encoding_decodes_to_exact_source(self):
        for encoding, body in [('identity', self.source), ('br', brotli.compress(self.source)),
                               ('gzip', gzip.compress(self.source)), ('deflate', zlib.compress(self.source)),
                               ('zstd', zstandard.ZstdCompressor().compress(self.source))]:
            with self.subTest(encoding=encoding):
                result = self.run_probe(body, encoding)
                self.assertEqual(result['body_bytes'], len(body))
                self.assertEqual(result['decoded_body_bytes'], len(self.source))
                self.assertEqual(self.decoded, self.source)

    def test_unknown_encoding_is_not_reported_as_decoded_html(self):
        with self.assertRaisesRegex(ValueError, 'encoding'):
            self.run_probe(b'not decoded', 'unknown')

    def test_non200_documents_fail_before_decoding_or_publication(self):
        for status in (301, 404, 500):
            for protocol in ('h1', 'h2'):
                if protocol == 'h1':
                    tls = FakeTLS(self.source, 'identity')
                    tls.response = tls.response.replace(b'200 OK', str(status).encode() + b' Fixture')
                else:
                    def response(server):
                        server.send_headers(1, [(':status', str(status))])
                        server.send_data(1, self.source, end_stream=True)
                    tls = H2TLS(response)
                with self.subTest(status=status, protocol=protocol), \
                     patch.object(gallery, 'decode_body') as decode:
                    with self.assertRaisesRegex(ValueError, 'requires HTTP 200'):
                        self.run_probe(tls=tls)
                    decode.assert_not_called()
                    self.assertTrue(self.raw.closed)
                    self.assertTrue(self.tcp.closed)
                    self.assertTrue(self.thread.joined)

    def test_encoding_stack_is_decoded_in_reverse_order(self):
        encoded = brotli.compress(gzip.compress(self.source))
        self.run_probe(encoded, 'gzip, BR')
        self.assertEqual(self.decoded, self.source)

    def test_concatenated_zstd_frames_are_fully_decoded(self):
        encoder = zstandard.ZstdCompressor()
        encoded = encoder.compress(self.source[:20]) + encoder.compress(self.source[20:])
        self.run_probe(encoded, 'zstd')
        self.assertEqual(self.decoded, self.source)

    def test_invalid_compression_cannot_produce_a_successful_measurement(self):
        for encoding, encoded in [('br', brotli.compress(self.source)),
                                  ('gzip', gzip.compress(self.source)),
                                  ('deflate', zlib.compress(self.source)),
                                  ('zstd', zstandard.ZstdCompressor().compress(self.source))]:
            for malformed in (encoded[:-1], encoded + b'junk'):
                with self.subTest(encoding=encoding, malformed=malformed[-8:]):
                    with self.assertRaises(Exception):
                        self.run_probe(malformed, encoding)
                    self.assertTrue(self.raw.closed)
                    self.assertTrue(self.tcp.closed)
                    self.assertTrue(self.thread.joined)

    def test_url_scope_rejects_silently_mismeasured_protocols_and_ports(self):
        for url in ('http://example.com/', 'https://example.com:8443/',
                    'https://name:password@example.com/', 'https:///missing'):
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, 'HTTPS on port 443'):
                    self.run_probe(url=url)
                self.assertFalse(self.thread.started)

    def test_curve_and_context_failures_release_capture_resources(self):
        for options in ({'curve': 'invalid'}, {'context_error': ValueError('context failed')}):
            with self.subTest(options=options):
                with self.assertRaises(ValueError):
                    self.run_probe(**options)
                if self.thread.started:
                    self.assertTrue(self.thread.joined, 'capture thread leaked')
                    self.assertTrue(self.raw.closed, 'raw capture socket leaked')

    def test_success_releases_both_sockets_and_capture_thread(self):
        self.run_probe()
        self.assertTrue(self.raw.closed)
        self.assertTrue(self.tcp.closed)
        self.assertTrue(self.thread.joined)

    def test_decoding_caps_every_supported_coding(self):
        source = b'x' * 8192
        for coding, encoded in [('identity', source), ('br', brotli.compress(source)),
                                ('gzip', gzip.compress(source)), ('deflate', zlib.compress(source)),
                                ('zstd', zstandard.ZstdCompressor().compress(source))]:
            with self.subTest(coding=coding):
                with self.assertRaisesRegex(ValueError, 'limit'):
                    gallery.decode_body(encoded, coding, limit=4096)

    def test_all_truncated_single_frames_fail_even_if_partial_output_exists(self):
        source = bytes(range(256))
        for coding, encoded in [('br', brotli.compress(source)), ('gzip', gzip.compress(source)),
                                ('deflate', zlib.compress(source)),
                                ('zstd', zstandard.ZstdCompressor().compress(source))]:
            for cut in range(len(encoded)):
                with self.subTest(coding=coding, cut=cut):
                    with self.assertRaises(Exception):
                        gallery.decode_body(encoded[:cut], coding)

    def test_zstd_window_limit_uses_actual_bytes_in_pinned_binding(self):
        def compressed(source, window_log):
            parameters = zstandard.ZstdCompressionParameters.from_level(
                1, window_log=window_log, write_content_size=0)
            encoder = zstandard.ZstdCompressor(compression_params=parameters).compressobj()
            return encoder.compress(source) + encoder.flush()
        source = b'x' * (1 << 20)
        encoded = compressed(source, 20)
        self.assertEqual(zstandard.get_frame_parameters(encoded).window_size, 1 << 20)
        self.assertEqual(gallery.decode_body(encoded, 'zstd'), source)
        encoded = compressed(b'tiny document', 23)
        self.assertEqual(zstandard.get_frame_parameters(encoded).window_size, 8 << 20)
        with self.assertRaisesRegex(zstandard.ZstdError, 'memory'):
            gallery.decode_body(encoded, 'zstd')

    def test_old_brotli_binding_fails_before_capture_starts(self):
        class UnboundedDecoder:
            def process(self, data): return b''
        with patch.object(gallery.brotli, 'Decompressor', UnboundedDecoder):
            with self.assertRaisesRegex(RuntimeError, 'brotli >= 1.2.0'):
                self.run_probe()
        self.assertFalse(self.thread.started)

    def test_intermediate_encoding_is_bounded_even_when_final_body_is_small(self):
        inner = gzip.compress(self.source)
        # Valid gzip with a long optional filename; the final document is tiny.
        padded = inner[:3] + b'\x08' + inner[4:10] + b'n' * 8192 + b'\0' + inner[10:]
        self.assertEqual(gzip.decompress(padded), self.source)
        with self.assertRaisesRegex(ValueError, 'limit'):
            gallery.decode_body(gzip.compress(padded), 'gzip,gzip', limit=4096)

    def test_concatenated_gzip_members_share_the_same_output_limit(self):
        encoded = gzip.compress(b'x' * 3000) + gzip.compress(b'x' * 3000)
        with self.assertRaisesRegex(ValueError, 'limit'):
            gallery.decode_body(encoded, 'gzip', limit=4096)
        self.assertEqual(gallery.decode_body(encoded, 'gzip'), b'x' * 6000)

    def test_capture_failure_and_empty_capture_cannot_be_successful_results(self):
        def failed(args): args[3].append(OSError('capture device failed'))
        for action, message in [(failed, 'Packet capture failed'), (lambda args: None, 'No packets captured')]:
            with self.subTest(message=message):
                with self.assertRaisesRegex(RuntimeError, message):
                    self.run_probe(thread_action=action)
                self.assertTrue(self.raw.closed)
                if self.thread.started: self.assertTrue(self.thread.joined)

    def test_owned_h2_response_completes_and_early_eof_reset_or_goaway_fail(self):
        def complete(server):
            server.send_headers(1, [(':status', '200')])
            server.send_data(1, self.source, end_stream=True)
        self.assertEqual(self.run_probe(tls=H2TLS(complete))['decoded_body_bytes'], len(self.source))
        def headers(server): server.send_headers(1, [(':status', '200')])
        def reset(server): headers(server); server.reset_stream(1)
        def goaway(server): headers(server); server.close_connection(last_stream_id=1)
        for action in (headers, reset, goaway):
            with self.subTest(action=action.__name__):
                with self.assertRaises(EOFError): self.run_probe(tls=H2TLS(action))
                self.assertTrue(self.raw.closed)
                self.assertTrue(self.tcp.closed)

    def test_connection_window_updates_and_partial_post_body_frames_are_valid(self):
        def complete(server):
            server.increment_flow_control_window(1024)
            server.send_headers(1, [(':status', '200')])
            server.send_data(1, self.source, end_stream=True)
        tls = H2TLS(complete)
        read = tls.read
        tls.read = lambda size: read(size) + b'\0\0'
        result = self.run_probe(tls=tls)
        self.assertEqual(self.decoded, self.source)
        self.assertEqual(result['response_http2_trailing_partial_bytes'], 2)
        self.assertEqual(sum(frame['payload_bytes'] + 9 for frame in result['response_http2_frames']) + 2,
                         result['response_http_plain_bytes'])

    def test_h2_push_cannot_replace_the_requested_document(self):
        def pushed(server):
            server.push_stream(1, 2, [(':method', 'GET'), (':scheme', 'https'),
                                      (':authority', 'example.com'), (':path', '/pushed')])
            server.send_headers(2, [(':status', '200')])
            server.send_data(2, b'wrong pushed document', end_stream=True)
        with self.assertRaisesRegex(ValueError, 'pushed stream'):
            self.run_probe(tls=H2TLS(pushed))

    def test_control_frames_count_toward_plaintext_and_deadline_limits(self):
        def headers(server): server.send_headers(1, [(':status', '200')])
        ping = PingFrame(0); ping.opaque_data = b'12345678'
        with patch.object(gallery, 'MAX_HTTP_PLAIN_BYTES', 150):
            with self.assertRaisesRegex(ValueError, 'plaintext byte limit'):
                self.run_probe(tls=H2TLS(headers, repeat=lambda: ping.serialize()))
        with patch.object(gallery.time, 'monotonic', return_value=0) as clock, \
             patch.object(gallery, 'EXCHANGE_SECONDS', 3):
            def drip():
                clock.return_value += 1
                return ping.serialize()
            with self.assertRaisesRegex(TimeoutError, 'deadline'):
                self.run_probe(tls=H2TLS(headers, repeat=drip))

    def test_tls_byte_limit_covers_handshake_or_non_document_traffic(self):
        tls = FakeTLS(self.source, 'identity')
        tls.read = lambda size: (_ for _ in ()).throw(gallery.ssl.SSLWantReadError())
        with patch.object(FakeSocket, 'recv', return_value=b'x' * 17, create=True), \
             patch.object(gallery, 'MAX_TLS_BYTES', 16):
            with self.assertRaisesRegex(ValueError, 'TLS byte limit'):
                self.run_probe(tls=tls)


class PacketTests(unittest.TestCase):
    def test_packet_metadata_and_gro_estimate(self):
        result = gallery.tcp_packet(packet_frame(3000), '192.0.2.1', 46240, '192.0.2.2')
        self.assertEqual(result['direction'], 'received')
        self.assertEqual(result['ip_bytes'], 3040)
        self.assertEqual(result['tcp_payload_bytes'], 3000)
        self.assertEqual(result['estimated_segments_at_1500_mtu'], 3)
        self.assertEqual(result['ip_bytes_at_1500_mtu'], 3120)
        self.assertNotIn('payload', result)

    def test_unrelated_short_non_ipv4_and_impossible_headers_are_ignored(self):
        frame = packet_frame()
        wrong_version = bytearray(frame); wrong_version[14] = 0x65
        wrong_ihl = bytearray(frame); wrong_ihl[14] = 0x4f
        short_ihl = bytearray(frame); short_ihl[14] = 0x41
        non_tcp = bytearray(frame); non_tcp[23] = 17
        for bad in (b'', frame[:18], wrong_version, wrong_ihl, short_ihl, non_tcp,
                    packet_frame(peer='192.0.2.99'), packet_frame(port=1)):
            with self.subTest(frame=bad[:20]):
                self.assertIsNone(gallery.tcp_packet(bad, '192.0.2.1', 46240, '192.0.2.2'))

    def test_same_peer_and_port_on_a_different_local_address_is_unrelated(self):
        frame = bytearray(packet_frame())
        frame[30:34] = gallery.socket.inet_aton('198.51.100.99')
        self.assertIsNone(gallery.tcp_packet(frame, '192.0.2.1', 46240, '192.0.2.2'))
        # Reverse the same flow to cover sent-direction ownership too.
        frame[26:30], frame[30:34] = frame[30:34], frame[26:30]
        frame[34:36], frame[36:38] = frame[36:38], frame[34:36]
        self.assertIsNone(gallery.tcp_packet(frame, '192.0.2.1', 46240, '192.0.2.2'))

    def test_malformed_owned_flow_fails_instead_of_undercounting(self):
        frame = packet_frame()
        bad_length = bytearray(frame); bad_length[16:18] = (19).to_bytes(2, 'big')
        bad_tcp_length = bytearray(frame); bad_tcp_length[46] = 0xf0
        short_tcp_length = bytearray(frame); short_tcp_length[46] = 0x10
        fragment = bytearray(frame); fragment[20:22] = b'\x20\0'
        for bad in (frame[:-1], bad_length, bad_tcp_length, short_tcp_length, fragment):
            with self.subTest(frame=bad):
                with self.assertRaises(ValueError): gallery.tcp_packet(bad, '192.0.2.1', 46240, '192.0.2.2')

    def test_capture_loop_collects_errors_and_stops(self):
        class BrokenSocket:
            def recv(self, size): raise OSError('capture failed')
        stop = threading.Event(); packets = []; errors = []
        gallery.capture_packets(BrokenSocket(), stop, packets, errors, '192.0.2.1', 46240, '192.0.2.2')
        self.assertTrue(stop.is_set())
        self.assertEqual(packets, [])
        self.assertIsInstance(errors[0], OSError)

    def test_capture_continues_after_unrelated_malformed_packet(self):
        stop = threading.Event(); packets = []; errors = []
        class Frames:
            frames = [b'bad', packet_frame()]
            def recv(self, size):
                if self.frames: return self.frames.pop(0)
                stop.set(); raise TimeoutError()
        gallery.capture_packets(Frames(), stop, packets, errors, '192.0.2.1', 46240, '192.0.2.2')
        self.assertEqual(len(packets), 1)
        self.assertEqual(errors, [])


if __name__ == '__main__':
    unittest.main()
