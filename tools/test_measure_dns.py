"""DNS measurement regressions using local datagram fixtures."""
import io
import json
from pathlib import Path
import runpy
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch
from dns_measurement import read_name, question_name

PROBE = Path(__file__).with_name('measure-dns.py')


class Datagram:
    def __init__(self, reply=None, peer=('1.1.1.1', 53), error=None):
        self.reply, self.peer, self.error = reply, peer, error
        self.sent = None
        self.closed = False

    def settimeout(self, value): pass
    def sendto(self, data, address): self.sent = data
    def recvfrom(self, size):
        if self.error: raise self.error
        data = self.sent[:2] + b'\x81\x80' + self.sent[4:]
        response = self.reply(data) if self.reply else data
        return response[:size], self.peer
    def close(self): self.closed = True
    def __enter__(self): return self
    def __exit__(self, *args): self.close()


class DnsTests(unittest.TestCase):
    def probe(self, host, **socket_options):
        self.sockets = [Datagram(**socket_options) for _ in range(3)]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'dns.json'
            with patch('socket.socket', side_effect=self.sockets), \
                 patch('sys.argv', [str(PROBE), host, str(output)]), \
                 patch('sys.stdout', new_callable=io.StringIO):
                runpy.run_path(str(PROBE), run_name='__main__')
            return json.loads(output.read_text())

    def test_absolute_and_unicode_names_have_correct_wire_labels(self):
        for name, encoded in [('example.com', 'example.com'), ('example.com.', 'example.com'),
                              ('bücher.example', 'xn--bcher-kva.example')]:
            with self.subTest(name=name):
                report = self.probe(name)
                wire_name = b''.join(bytes([len(label)]) + label.encode() for label in encoded.split('.')) + b'\0'
                for sock, qtype, result in zip(self.sockets, (1, 28, 65), report['queries']):
                    self.assertEqual(sock.sent[12:], wire_name + struct.pack('!HH', qtype, 1))
                    self.assertEqual(result['ipv4_udp_bytes'], result['query_bytes'] + result['response_bytes'] + 56)
                    self.assertTrue(sock.closed)

    def test_mismatched_or_incomplete_responses_cannot_be_reported(self):
        cases = [
            {'peer': ('192.0.2.1', 53)},
            {'reply': lambda data: data[:3]},
            {'reply': lambda data: data[:2] + b'\x01\x80' + data[4:]},
            {'reply': lambda data: data[:2] + b'\x83\x80' + data[4:]},
            {'reply': lambda data: data[:-4] + b'\0\x1c\0\x01'},
            {'reply': lambda data: data[:13] + b'X' + data[14:]},
            {'reply': lambda data: data[:6] + b'\0\x01' + data[8:]},
            {'reply': lambda data: data + b'\0'},
        ]
        for options in cases:
            with self.subTest(options=options):
                with self.assertRaises((ValueError, AssertionError)):
                    self.probe('example.com', **options)
                self.assertTrue(self.sockets[0].closed)

    def test_compressed_resource_record_names_are_counted(self):
        def response(data):
            # One A record whose owner name points to the echoed question.
            record = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + b'\xc0\0\x02\x01'
            return data[:6] + b'\0\x01' + data[8:] + record
        report = self.probe('example.com', reply=response)
        for result in report['queries']:
            self.assertEqual(result['answer_count'], 1)
            self.assertEqual(result['response_bytes'], result['query_bytes'] + 16)

    def test_truncated_resource_record_headers_and_data_are_rejected(self):
        record = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + b'\xc0\0\x02\x01'
        for length in range(len(record)):
            def response(data):
                return data[:6] + b'\0\x01' + data[8:] + record[:length]
            with self.subTest(length=length), self.assertRaises(ValueError):
                self.probe('example.com', reply=response)

    def test_large_datagram_cannot_hide_trailing_bytes_past_receive_buffer(self):
        def response(data):
            size = 4096 - len(data) - 12
            record = b'\xc0\x0c' + struct.pack('!HHIH', 65001, 1, 0, size) + b'X' * size
            # A valid 4096-byte prefix followed by an invalid extra datagram byte.
            return data[:10] + b'\0\x01' + data[12:] + record + b'!'
        with self.assertRaisesRegex(ValueError, 'Trailing bytes'):
            self.probe('example.com', reply=response)

    def test_timeout_closes_socket(self):
        with self.assertRaises(TimeoutError):
            self.probe('example.com', error=TimeoutError('fixture timeout'))
        self.assertTrue(self.sockets[0].closed)

    def test_compressed_name_resolution_and_cycles(self):
        suffix = b'\x07example\x03com\0'
        packet = suffix + b'\x03WWW\xc0\x00'
        self.assertEqual(read_name(packet, len(suffix)),
                         ((b'www', b'example', b'com'), len(packet)))
        for packet in (b'\xc0\x00', b'\xc0', b'\xc0\xff', b'\x08short', b'\x40invalid'):
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                read_name(packet, 0)

    def test_empty_labels_and_oversized_names_fail_before_querying(self):
        for name in ('', '.', 'example..com', 'example.com..', 'x' * 64 + '.com',
                     '.'.join(['x' * 63] * 4), 'example.\x00com'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                question_name(name)


if __name__ == '__main__':
    unittest.main()
