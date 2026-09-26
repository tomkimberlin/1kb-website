"""Exercise HTTP/3 verifier error paths without opening a socket."""
import asyncio
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

try:
    from aioquic.h3.events import HeadersReceived, DataReceived
except ImportError as error:
    raise unittest.SkipTest('aioquic is required for HTTP/3 verifier fixtures') from error

spec = importlib.util.spec_from_file_location('http3_verifier', Path(__file__).with_name('verify-http3.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class HTTP3VerifierTests(unittest.IsolatedAsyncioTestCase):
    def client(self, events, limit=3):
        client = object.__new__(probe.Client)
        client.http = type('HTTP', (), {'handle_event': lambda self, event: events})()
        client.responses = {0: {'body': bytearray(), 'headers': [], 'trailers': [], 'bodyLimit': limit}}
        client.waiters = {0: asyncio.get_running_loop().create_future()}
        return client

    async def test_oversized_body_fails_before_stream_ends(self):
        client = self.client([HeadersReceived([(b':status', b'200')], 0, False),
                              DataReceived(b'too long', 0, False),
                              DataReceived(b'ignored after failure', 0, True)])
        client.quic_event_received(object())
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            await client.waiters[0]
        self.assertEqual(client.responses[0]['body'], b'')

    async def test_informational_and_trailing_headers_do_not_replace_final_headers(self):
        final = [(b':status', b'200'), (b'content-encoding', b'br')]
        trailers = [(b'x-fixture', b'completed')]
        client = self.client([HeadersReceived([(b':status', b'103'), (b'link', b'</hint>')], 0, False),
                              HeadersReceived(final, 0, False), DataReceived(b'abc', 0, False),
                              HeadersReceived(trailers, 0, True)])
        client.quic_event_received(object())
        response = await client.waiters[0]
        self.assertEqual(response['headers'], final)
        self.assertEqual(response['trailers'], trailers)
        self.assertEqual(response['body'], b'abc')

    async def test_informational_end_is_not_a_successful_response(self):
        client = self.client([HeadersReceived([(b':status', b'103')], 0, True)])
        client.quic_event_received(object())
        with self.assertRaisesRegex(ValueError, 'before its final'):
            await client.waiters[0]

    async def test_multiple_final_responses_are_rejected(self):
        client = self.client([HeadersReceived([(b':status', b'200')], 0, False),
                              HeadersReceived([(b':status', b'404')], 0, True)])
        client.quic_event_received(object())
        with self.assertRaisesRegex(ValueError, 'multiple final'):
            await client.waiters[0]

    async def test_duplicate_header_diagnostics_redact_cookies(self):
        events = [HeadersReceived([(b':status', b'200'), (b'set-cookie', b'private-one'),
                                   (b'set-cookie', b'private-two')], 0, True)]
        client = self.client(events)
        client._quic = type('QUIC', (), {'get_next_available_stream_id': lambda self: 0})()
        client.http.send_headers = lambda *args, **kwargs: None
        client.transmit = lambda: client.quic_event_received(object())
        with self.assertRaises(AssertionError) as result:
            await client.request('fixture.test')
        self.assertNotIn('private-one', str(result.exception))
        self.assertNotIn('private-two', str(result.exception))
        self.assertIn('<redacted>', str(result.exception))

    async def test_output_cannot_overwrite_its_imported_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            for suffix in ('', '.br', '.gz', '.deflate'):
                (Path(directory) / ('index.html' + suffix)).write_bytes(b'')
            helper = Path(__file__).with_name('probe_response.py')
            original = helper.read_bytes()
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('verify-http3.py')),
                                     '--public-dir', directory, '--out', str(helper)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2)
            self.assertIn('aliases an input file', result.stderr)
            self.assertEqual(helper.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
