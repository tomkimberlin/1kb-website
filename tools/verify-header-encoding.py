"""Verify static and fallback HPACK/QPACK fields on an isolated fixture server.

Load tools/fixtures/header-encoding.conf alongside the real site handler.
Requires tools/requirements.txt. HEAD fixtures cover coding-header values
without claiming a compressed body; certificate verification stays enabled.
"""
from pathlib import Path
import argparse
import asyncio
import importlib.util
import json
import socket
import ssl
import h2.config, h2.connection, h2.events, h2.settings
from aioquic.asyncio.client import connect
from aioquic.h3.connection import H3Connection, Setting
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ProtocolNegotiated
import pylsqpack
repo = Path(__file__).resolve().parents[1]
if not __debug__:
    raise RuntimeError('Transport verification requires Python assertions; remove -O or PYTHONOPTIMIZE')
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--host', default='tomkimberlin.com')
p.add_argument('--ip')
p.add_argument('--port', type=int, default=443)
p.add_argument('--ca', type=Path)
p.add_argument('--protocol', choices=['h2', 'h3', 'both'], default='both')
p.add_argument('--out', type=Path)
args = p.parse_args()
if args.out:
    output = args.out.resolve()
    inputs = [Path(__file__), repo / 'tools/verify-http3.py', repo / 'tools/probe_response.py',
              repo / 'tools/fixtures/header-encoding.js',
              repo / 'tools/fixtures/header-encoding.conf', *([args.ca] if args.ca else [])]
    for item in inputs:
        if output == item.resolve() or (output.exists() and output.samefile(item)):
            p.error('--out aliases an input file: ' + str(item))
spec = importlib.util.spec_from_file_location('probe', repo / 'tools/verify-http3.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
cases = {
    'static': {'CaChE-CoNtRoL': 'max-age=86400', 'CONTENT-ENCODING': 'br',
               'VaRy': 'accept-encoding', 'Content-Type': 'text/html; charset=utf-8'},
    'gzip': {'Cache-Control': 'no-cache', 'Content-Encoding': 'gzip',
             'Vary': 'accept-encoding', 'Content-Type': 'text/html; charset=utf-8'},
    'literal-values': {'Cache-Control': 'private, max-age=17', 'Content-Encoding': 'Br',
                       'Vary': 'Accept-Encoding, X-Custom', 'Content-Type': 'Text/HTML; Charset=UTF-8'},
    'other-coding': {'Cache-Control': 'max-age=604800', 'Content-Encoding': 'zstd',
                     'Vary': '*', 'Content-Type': 'application/octet-stream'},
    'similar-names': {'cache-control-x': 'a', 'content-encoding-x': 'b', 'vary-x': 'c',
                      'X-MiXeD-CaSe': 'Some Mixed VALUE', 'Content-Type': 'text/plain'},
    'duplicate-values': {'Cache-Control': ['max-age=10', 'public'],
                         'Vary': ['accept-encoding', 'x-test'], 'X-Multi': ['first', 'second'],
                         'Content-Type': 'text/plain'},
    'large-literal': {'X-Long-Literal': 'Z' * 26000, 'Content-Type': 'text/plain'},
    'empty-values': {'Cache-Control': '', 'Content-Encoding': '', 'Vary': '',
                     'X-Empty': '', 'Content-Type': 'text/plain'},
}
HOST = args.host
results = {'h2': [], 'h3ZeroTable': []}

def verify(case, headers, body, method='HEAD', status='200'):
    fields = {}
    for (key, value) in headers:
        fields.setdefault(key, []).append(value)
    assert fields[':status'] == [status] and (not body), (case, status, fields.get(':status'), len(body))
    expected = {k.lower(): v if isinstance(v, list) else [v] for (k, v) in cases[case].items() if v != ''} if case in cases else {'allow': ['GET, HEAD']}
    actual = {k: v for (k, v) in fields.items() if k not in [':status', 'date']}
    assert actual == expected, (case, {k: [len(x) for x in v] for (k, v) in actual.items()}, {k: [len(x) for x in v] for (k, v) in expected.items()})
    return {'case': case, 'method': method, 'status': status, 'headerFields': len(headers), 'headerValueBytes': sum((len(v.encode()) for (_, v) in headers)), 'passed': True}
ctx = ssl.create_default_context(cafile=str(args.ca) if args.ca else None)
ctx.set_alpn_protocols(['h2'])
if args.protocol in ('h2', 'both'):
    with socket.create_connection((args.ip or HOST, args.port), timeout=5) as raw, ctx.wrap_socket(raw, server_hostname=HOST) as tls:
        assert tls.selected_alpn_protocol() == 'h2'
        h = h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True, header_encoding='utf-8'))
        h.initiate_connection()
        wire = bytearray()
        frames = []

        def request(case, path, method, status='200', settings=()):
            for size in settings:
                h.update_settings({h2.settings.SettingCodes.HEADER_TABLE_SIZE: size})
            sid = h.get_next_available_stream_id()
            h.send_headers(sid, [(':method', method), (':scheme', 'https'), (':authority', HOST), (':path', path)], end_stream=True)
            tls.sendall(h.data_to_send())
            body = bytearray()
            headers = None
            ended = False
            while not ended:
                data = tls.recv(65536)
                assert data
                wire.extend(data)
                while len(wire) >= 9:
                    length = int.from_bytes(wire[:3], 'big')
                    if len(wire) < 9 + length:
                        break
                    frames.append({'length': length, 'type': wire[3], 'flags': wire[4], 'stream': int.from_bytes(wire[5:9], 'big') & 2147483647})
                    del wire[:9 + length]
                for event in h.receive_data(data):
                    if isinstance(event, h2.events.ResponseReceived):
                        headers = event.headers
                    elif isinstance(event, h2.events.DataReceived):
                        assert not event.data, 'Empty-body fixture returned DATA'
                        body.extend(event.data)
                        h.acknowledge_received_data(event.flow_controlled_length, event.stream_id)
                    elif isinstance(event, h2.events.StreamEnded):
                        assert event.stream_id == sid
                        ended = True
                    elif isinstance(event, (h2.events.StreamReset, h2.events.ConnectionTerminated)):
                        raise RuntimeError(str(event))
                pending = h.data_to_send()
                if pending:
                    tls.sendall(pending)
            result = verify(case, headers, body, method, status)
            result['settingsBeforeRequest'] = list(settings)
            result['responseFrames'] = [f for f in frames if f['stream'] == sid]
            if case == 'large-literal':
                assert [f['type'] for f in result['responseFrames']] == [1, 9], result
            results['h2'].append(result)
        # Batch multiple valid settings before HEADERS to exercise minimum/final
        # table-size transitions, including zero followed by a larger limit.
        batches = [[4096, 0, 4096], [32, 65536, 1], [65536, 0, 65536], [1, 0, 4096]]
        for (index, name) in enumerate(cases):
            request(name, '/_encoding/' + name, 'HEAD', settings=batches[index % len(batches)])
        request('similar-names', '/_encoding/similar-names', 'GET')
        for method in ['BREW', 'CUSTOM_METHOD', 'OPTIONS']:
            request(method, '/', method, '405')

class ZeroTableH3(H3Connection):

    def _get_local_settings(self):
        settings = super()._get_local_settings()
        settings[Setting.QPACK_MAX_TABLE_CAPACITY] = 0
        settings[Setting.QPACK_BLOCKED_STREAMS] = 0
        return settings

class Client(probe.Client):

    def quic_event_received(self, event):
        if isinstance(event, ProtocolNegotiated):
            self.http = ZeroTableH3(self._quic)
            # Keep the decoder's actual limits consistent with advertised settings.
            self.http._decoder = pylsqpack.Decoder(0, 0)
            return
        super().quic_event_received(event)

    async def raw_request(self, path, method):
        sid = self._quic.get_next_available_stream_id()
        self.responses[sid] = {'body': bytearray(), 'bodyLimit': 0, 'headers': [], 'trailers': []}
        self.waiters[sid] = asyncio.get_running_loop().create_future()
        self.http.send_headers(sid, [(b':method', method.encode()), (b':scheme', b'https'), (b':authority', HOST.encode()), (b':path', path.encode())], end_stream=True)
        self.transmit()
        r = await asyncio.wait_for(self.waiters[sid], 10)
        return ([(k.decode(), v.decode()) for (k, v) in r['headers']], bytes(r['body']))

async def h3():
    config = QuicConfiguration(is_client=True, alpn_protocols=['h3'], server_name=HOST)
    if args.ca:
        config.load_verify_locations(cafile=str(args.ca))
    async with connect(args.ip or HOST, args.port, configuration=config, create_protocol=Client) as client:
        for name in cases:
            (headers, body) = await client.raw_request('/_encoding/' + name, 'HEAD')
            results['h3ZeroTable'].append(verify(name, headers, body))
        (headers, body) = await client.raw_request('/_encoding/similar-names', 'GET')
        results['h3ZeroTable'].append(verify('similar-names', headers, body, 'GET'))
        for method in ['BREW', 'CUSTOM_METHOD', 'OPTIONS']:
            (headers, body) = await client.raw_request('/', method)
            results['h3ZeroTable'].append(verify(method, headers, body, method, '405'))
if args.protocol in ('h3', 'both'):
    asyncio.run(h3())
report = {'passed': True, 'checks': sum(map(len, results.values())), 'scope': 'Isolated fixture H2/H3 with certificate verification. QPACK advertises zero dynamic table capacity and zero blocked streams. Fixture HEAD requests test encoder fields without claiming compressed body validity.', 'results': results}
encoded = json.dumps(report, indent=2) + '\n'
if args.out:
    args.out.write_text(encoded)
print(encoded, end='')
