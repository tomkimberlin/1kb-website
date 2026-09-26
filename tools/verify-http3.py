"""Verify the site's HTTP/3 representations, QPACK headers and stream reuse.

Requires aioquic from tools/requirements.txt. Use --ca for a local certificate
and --public-dir for the four exact representations served by the test server.
Certificate and hostname verification remain enabled.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path

from aioquic.asyncio.client import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3Connection, H3_ALPN
from aioquic.h3.events import HeadersReceived, DataReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ProtocolNegotiated, ConnectionTerminated, StreamReset
from probe_response import report_headers

if not __debug__:
    raise RuntimeError('Transport verification requires Python assertions; remove -O or PYTHONOPTIMIZE')

REPO = Path(__file__).resolve().parents[1]


class Client(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.http = None
        self.responses = {}
        self.waiters = {}

    def quic_event_received(self, event):
        if isinstance(event, ProtocolNegotiated):
            self.http = H3Connection(self._quic)
        if isinstance(event, ConnectionTerminated):
            for waiter in self.waiters.values():
                if not waiter.done():
                    waiter.set_exception(RuntimeError(str(event)))
        if isinstance(event, StreamReset):
            waiter = self.waiters.get(event.stream_id)
            if waiter is not None and not waiter.done():
                waiter.set_exception(RuntimeError(str(event)))
        if self.http is not None:
            for item in self.http.handle_event(event):
                if not isinstance(item, (HeadersReceived, DataReceived)):
                    continue
                if item.stream_id not in self.responses:
                    continue
                response = self.responses[item.stream_id]
                waiter = self.waiters[item.stream_id]
                if waiter.done():
                    continue
                if isinstance(item, HeadersReceived):
                    statuses = [value for key, value in item.headers if key == b':status']
                    if len(statuses) == 1 and statuses[0].startswith(b'1'):
                        if item.stream_ended:
                            waiter.set_exception(ValueError('HTTP/3 stream ended before its final response'))
                        continue
                    if statuses:
                        if response['headers']:
                            waiter.set_exception(ValueError('HTTP/3 stream sent multiple final responses'))
                            continue
                        response['headers'] = item.headers
                    else:
                        response['trailers'].extend(item.headers)
                else:
                    if len(response['body']) + len(item.data) > response['bodyLimit']:
                        waiter.set_exception(ValueError('HTTP/3 body exceeds the expected representation size'))
                        continue
                    response['body'].extend(item.data)
                if item.stream_ended:
                    waiter.set_result(response)

    async def request(self, host, path='/', accepted='br', method='GET', body_limit=0):
        stream = self._quic.get_next_available_stream_id()
        self.responses[stream] = {'body': bytearray(), 'headers': [], 'trailers': [], 'bodyLimit': body_limit}
        self.waiters[stream] = asyncio.get_running_loop().create_future()
        headers = [(':method', method), (':scheme', 'https'), (':authority', host),
                   (':path', path), ('accept-encoding', accepted)]
        self.http.send_headers(stream, [(key.encode(), value.encode()) for key, value in headers],
                               end_stream=True)
        self.transmit()
        response = await asyncio.wait_for(self.waiters[stream], 15)
        fields = report_headers([(key.decode(), value.decode()) for key, value in response['headers']])
        headers = dict(fields)
        assert len(headers) == len(fields), ('Unexpected duplicate response header', fields)
        forbidden = ('content-length', 'server', 'alt-svc', 'etag', 'last-modified', 'accept-ranges')
        assert not any(key in headers for key in forbidden), headers
        return {'request': {'path': path, 'accepted': accepted, 'method': method, 'host': host},
                'stream': stream, 'headers': headers, 'body': bytes(response['body']),
                'trailers': report_headers([(key.decode(), value.decode()) for key, value in response['trailers']])}


async def verify(args, bodies):
    config = QuicConfiguration(is_client=True, alpn_protocols=H3_ALPN, server_name=args.host)
    if args.ca:
        config.load_verify_locations(cafile=str(args.ca))
    results = []
    async with connect(args.ip or args.host, args.port, configuration=config, create_protocol=Client) as client:
        async def encoding_case(accepted, encoding, method='GET'):
            expected = bodies[encoding] if encoding and method == 'GET' else b''
            response = await client.request(args.host, accepted=accepted, method=method, body_limit=len(expected))
            headers = response['headers']
            assert headers[':status'] == ('200' if encoding else '406'), response
            assert headers['vary'] == 'accept-encoding', response
            encoded = encoding if encoding and encoding != 'identity' else None
            assert headers.get('content-encoding') == encoded, response
            assert headers.get('content-type') == ('text/html; charset=utf-8' if encoding else None), response
            assert headers.get('cache-control') == ('max-age=86400' if encoding else None), response
            assert response['body'] == expected, response
            results.append(response)

        # These values exercise both static QPACK entries and literal values
        # using a static name, decoded by aioquic's independent QPACK decoder.
        for encoding in bodies:
            for method in ('GET', 'HEAD'):
                await encoding_case(encoding, encoding, method)
        whitespace = [('br ; q=1', 'br'), ('gzip\t; q=1, br ;q=0', 'gzip'),
                      ('br ;q=0, * ;q=1', 'deflate'), ('identity ;q=1,br;q=0.5', 'identity'),
                      ('* ;q=0', None), ('identity ;q=0, * ;q=0', None)]
        for accepted, encoding in whitespace:
            await encoding_case(accepted, encoding)
        routes = [('/b', '301', 'https://github.com/tomkimberlin', 'GET', args.host),
                  ('/index.html?a=1', '301', '/?a=1', 'GET', args.host),
                  ('/missing', '404', None, 'GET', args.host),
                  ('/', '405', None, 'POST', args.host),
                  ('/?a=1', '301', 'https://tomkimberlin.com/?a=1', 'GET', 'www.tomkimberlin.com'),
                  ('/?a=1', '301', 'https://tomkimberlin.com/?a=1', 'GET', 'tom.kimberlin.net')]
        for path, status, location, method, host in routes:
            response = await client.request(host, path=path, method=method)
            headers = response['headers']
            assert headers[':status'] == status and headers.get('location') == location, response
            assert not response['body'] and 'content-type' not in headers and 'content-encoding' not in headers, response
            if status == '405':
                assert headers.get('allow') == 'GET, HEAD', response
            results.append(response)
        await asyncio.gather(*(encoding_case(encoding, encoding)
                               for encoding in ('br', 'gzip', 'deflate', 'identity') * 4))
    for result in results:
        result['bodyBytes'] = len(result['body'])
        result['bodySha256'] = hashlib.sha256(result.pop('body')).hexdigest()
    return {'passed': True, 'checks': len(results), 'protocol': 'h3',
            'scope': 'Verified QUIC/TLS and QPACK responses; sequential and concurrent requests on one connection.',
            'responses': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='tomkimberlin.com')
    parser.add_argument('--ip')
    parser.add_argument('--port', type=int, default=443)
    parser.add_argument('--ca', type=Path)
    parser.add_argument('--public-dir', type=Path, default=REPO / 'public')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    paths = {encoding: args.public_dir / ('index.html' + suffix) for encoding, suffix in
             [('br', '.br'), ('gzip', '.gz'), ('deflate', '.deflate'), ('identity', '')]}
    if args.out:
        inputs = [Path(__file__), Path(__file__).with_name('probe_response.py'),
                  *paths.values(), *([args.ca] if args.ca else [])]
        output = args.out.resolve()
        for path in inputs:
            if output == path.resolve() or (output.exists() and output.samefile(path)):
                parser.error('--out aliases an input file: ' + str(path))
    bodies = {encoding: path.read_bytes() for encoding, path in paths.items()}
    report = asyncio.run(verify(args, bodies))
    encoded = json.dumps(report, indent=2) + '\n'
    if args.out:
        args.out.write_text(encoded)
    print(encoded, end='')


if __name__ == '__main__':
    main()
