"""HTTP/3 measurement failure paths, exercised without sockets or certificates."""
import asyncio
from contextlib import asynccontextmanager, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    from aioquic.h3.events import HeadersReceived, DataReceived
    from aioquic.quic.events import ConnectionTerminated, StreamReset
except ImportError as error:
    raise unittest.SkipTest('aioquic is required for HTTP/3 measurement fixtures') from error


class HTTP3MeasurementTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary.cleanup)
        root = Path(temporary.name)
        body = root / 'expected.br'
        body.write_bytes(b'abc')
        script = Path(__file__).with_name('measure-http3.py')
        spec = importlib.util.spec_from_file_location('http3_measurement', script)
        cls.probe = importlib.util.module_from_spec(spec)
        # Load the real Client without starting the CLI's network coroutine.
        with patch.object(sys, 'argv', [str(script), '--ip', '127.0.0.1',
                                        '--expected-body', str(body), '--out', str(root / 'report.json')]), \
             patch('asyncio.run', side_effect=lambda coroutine: coroutine.close()):
            spec.loader.exec_module(cls.probe)

    def client(self, events=()):
        client = object.__new__(self.probe.Client)
        client.http = type('HTTP', (), {'handle_event': lambda self, event: events})()
        client.responses = {0: {'body': b'', 'headers': []}}
        client.waiters = {0: asyncio.get_running_loop().create_future()}
        return client

    async def test_informational_and_trailing_headers_preserve_the_final_response(self):
        final = [(b':status', b'200'), (b'content-encoding', b'br')]
        client = self.client([HeadersReceived([(b':status', b'103')], 0, False),
                              HeadersReceived(final, 0, False), DataReceived(b'abc', 0, False),
                              HeadersReceived([(b'set-cookie', b'trailer-cookie')], 0, True)])
        client.quic_event_received(object())
        response = await client.waiters[0]
        self.assertEqual(response['headers'], [(':status', '200'), ('content-encoding', 'br')])
        self.assertEqual(response['body'], b'abc')
        self.assertEqual(response['trailers'], [('set-cookie', 'trailer-cookie')])

    async def test_malformed_sequences_fail_the_waiter_without_replacing_final_headers(self):
        final = [(b':status', b'200'), (b'content-encoding', b'br')]
        for events in [
            [HeadersReceived(final, 0, False), HeadersReceived(final, 0, True)],
            [HeadersReceived(final, 0, False), HeadersReceived([(b':status', b'103')], 0, True)],
            [HeadersReceived([(b':status', b'103')], 0, True)],
            [HeadersReceived([(b'x-trailer', b'early')], 0, True)],
            [HeadersReceived([(b':status', b'200'), (b':status', b'200')], 0, True)],
            [DataReceived(b'abc', 0, True)],
        ]:
            with self.subTest(events=events):
                client = self.client(events)
                client.quic_event_received(object())
                self.assertTrue(client.waiters[0].done())
                with self.assertRaises(ValueError):
                    await client.waiters[0]
                if len(events) > 1:
                    self.assertEqual(client.responses[0]['headers'],
                                     [(':status', '200'), ('content-encoding', 'br')])

    async def test_reset_fails_only_the_affected_pending_stream(self):
        client = self.client()
        other = asyncio.get_running_loop().create_future()
        client.waiters[4] = other
        client.quic_event_received(StreamReset(error_code=8, stream_id=0))
        self.assertTrue(client.waiters[0].done())
        with self.assertRaisesRegex(RuntimeError, 'before a complete response'):
            await client.waiters[0]
        self.assertFalse(other.done())
        other.cancel()

    async def test_connection_end_fails_all_pending_streams_without_changing_completed_ones(self):
        client = self.client()
        other = asyncio.get_running_loop().create_future()
        complete = asyncio.get_running_loop().create_future()
        complete.set_result('already complete')
        client.waiters.update({4: other, 8: complete})
        client.quic_event_received(ConnectionTerminated(error_code=0, frame_type=None, reason_phrase='private peer detail'))
        for waiter in (client.waiters[0], other):
            self.assertTrue(waiter.done())
            with self.assertRaisesRegex(RuntimeError, 'before a complete response') as error:
                await waiter
            self.assertNotIn('private peer detail', str(error.exception))
        self.assertEqual(complete.result(), 'already complete')

    async def test_body_limit_still_fails_before_completion(self):
        client = self.client([HeadersReceived([(b':status', b'200')], 0, False),
                              DataReceived(b'too large', 0, False), DataReceived(b'ignored', 0, True)])
        client.quic_event_received(object())
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            await client.waiters[0]
        self.assertEqual(client.responses[0]['body'], b'')

    async def run_cli(self, failure=None):
        requests, clients = [], []

        @asynccontextmanager
        async def connect(*args, **kwargs):
            client = self.client()
            client.responses, client.waiters = {}, {}
            client.wire = {'sent': 0, 'received': 0}
            client.packets = {'sent': 0, 'received': 0}
            client.datagrams, client.snapshots = [], []
            client.reused = bool(clients)
            clients.append(client)
            streams = iter((0, 4))
            client._quic = type('QUIC', (), {'get_next_available_stream_id': lambda self: next(streams)})()

            def send_headers(stream, headers, end_stream):
                requests.append((stream, headers, end_stream))

            def transmit():
                stream = requests[-1][0]
                client.record('sent', 100)
                client.record('received', 150)
                if failure is not None:
                    client.quic_event_received(failure)
                    return
                events = [HeadersReceived([(b':status', b'200'), (b'content-encoding', b'br')], stream, False),
                          DataReceived(b'abc', stream, True)]
                client.http.handle_event = lambda event: events
                client.quic_event_received(object())

            client.http.send_headers, client.transmit = send_headers, transmit
            client.snap('handshake_complete')
            yield client

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'report.json'
            with patch.object(self.probe, 'connect', connect), patch.object(self.probe.a, 'out', str(output)), \
                 redirect_stdout(io.StringIO()):
                if failure is not None:
                    with self.assertRaisesRegex(RuntimeError, 'before a complete response'):
                        await self.probe.main()
                    self.assertFalse(output.exists(), 'A failed exchange must not publish measurements')
                    return
                await self.probe.main()
                report = json.loads(output.read_text())
        self.assertEqual(len(requests), 4)
        self.assertTrue(all(end and dict(headers)[b':method'] == b'GET'
                            and dict(headers)[b'accept-encoding'] == b'br'
                            for _, headers, end in requests))
        self.assertEqual(report['expected_body_bytes'], 3)
        self.assertEqual([row['session_reused'] for row in report['measurements']], [False, True])
        for row in report['measurements']:
            self.assertEqual([response['body_bytes'] for response in row['responses']], [3, 3])
            for snapshot in row['snapshots']:
                for direction in ('sent', 'received'):
                    self.assertEqual(snapshot['ipv4_udp_total'][direction],
                                     snapshot['udp_payload'][direction] + 28 * snapshot['datagrams'][direction])

    async def test_valid_cli_keeps_four_responses_and_complete_body_accounting(self):
        await self.run_cli()

    async def test_failed_cli_never_publishes_a_measurement(self):
        for event in [StreamReset(error_code=8, stream_id=0),
                      ConnectionTerminated(error_code=0, frame_type=None, reason_phrase='private peer detail')]:
            with self.subTest(event=event):
                await self.run_cli(event)


if __name__ == '__main__':
    unittest.main()
