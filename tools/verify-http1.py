"""Check HTTP/1 connection reuse, framing and upgrade responses."""
import argparse
import json
import socket
import ssl
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--host', default='tomkimberlin.com')
p.add_argument('--ip')
p.add_argument('--port', type=int, default=443)
p.add_argument('--expected-body', type=Path, required=True)
p.add_argument('--mode', choices=['baseline', 'patched'], required=True)
p.add_argument('--upgrade-fixture', help='Optional staging-only path returning 101')
p.add_argument('--length-fixture', help='Optional staging-only path returning the byte x')
a = p.parse_args()
expected = a.expected_body.read_bytes()
ctx = ssl.create_default_context()
ctx.set_alpn_protocols(['http/1.1'])
report = []

def connect():
    return ctx.wrap_socket(socket.create_connection((a.ip or a.host, a.port), timeout=5), server_hostname=a.host)

def request(s, method='GET', version='1.1', connection=None, path='/', expect=200, body=expected):
    req = f'{method} {path} HTTP/{version}\r\nHost: {a.host}\r\nAccept-Encoding: br\r\n'
    if connection:
        req += f'Connection: {connection}\r\n'
    if connection == 'upgrade':
        req += 'Upgrade: tiny-test\r\n'
    s.sendall((req + '\r\n').encode())
    wire = bytearray()
    while b'\r\n\r\n' not in wire:
        data = s.recv(8192)
        assert data, 'EOF before headers'
        wire.extend(data)
    head, received = bytes(wire).split(b'\r\n\r\n', 1)
    lines = head.decode('ascii').split('\r\n')
    status = int(lines[0].split(' ')[1])
    headers = dict((k.lower(), v.strip()) for k, v in (line.split(':', 1) for line in lines[1:]))
    assert status == expect, (status, expect)
    closed = headers.get('connection') == 'close'
    if method == 'HEAD' or status in [101, 204, 304]:
        assert received == b'', 'Unexpected body for bodyless response'
        expected_length = 0
    elif 'content-length' in headers:
        expected_length = int(headers['content-length'])
        while len(received) < expected_length:
            data = s.recv(8192)
            assert data, 'EOF before declared Content-Length'
            received += data
        assert len(received) == expected_length
        assert received == body
    else:
        assert closed, f'Cannot delimit response: {headers}'
        while True:
            data = s.recv(8192)
            if not data:
                break
            received += data
        expected_length = len(received)
        assert received == body
    if closed:
        assert s.recv(1) == b'', 'Connection: close response remained open'
    if version == '1.1' and not closed and status != 101:
        assert headers.get('connection') == ('keep-alive' if a.mode == 'baseline' else None), headers
    if version == '1.0' and not closed:
        assert headers.get('connection') == 'keep-alive', headers
    report.append({'request': f'{method} {path} HTTP/{version}', 'request_connection': connection, 'response_connection': headers.get('connection'), 'status': status, 'header_bytes': len(head) + 4, 'body_bytes': expected_length, 'closed': closed})
    return headers

# Successful second responses on the same TLS socket verify actual persistence.
with connect() as s:
    request(s)
    request(s)
    request(s, method='HEAD')
    request(s, connection='keep-alive')
    request(s, path='/b', expect=301, body=b'')
    request(s, connection='close')
for version, connection in [('1.0', None), ('1.0', 'keep-alive')]:
    with connect() as s:
        h = request(s, version=version, connection=connection)
        assert h.get('connection') == 'close' and 'content-length' not in h
# HEAD is self-delimited even though the site's H1.0 filter omits Content-Length.
with connect() as s:
    h = request(s, method='HEAD', version='1.0', connection='keep-alive')
    assert h.get('connection') == 'keep-alive'
    request(s, method='HEAD', version='1.0', connection='keep-alive')
    request(s, method='HEAD', version='1.0', connection='close')
if a.length_fixture:
    with connect() as s:
        h = request(s, version='1.0', connection='keep-alive', path=a.length_fixture, body=b'x')
        assert h.get('content-length') == '1' and h.get('connection') == 'keep-alive'
        request(s, version='1.0', connection='close', path=a.length_fixture, body=b'x')
if a.upgrade_fixture:
    with connect() as s:
        h = request(s, connection='upgrade', path=a.upgrade_fixture, expect=101, body=b'')
        assert h.get('connection') == 'upgrade' and h.get('upgrade') == 'tiny-test'
print(json.dumps({'mode': a.mode, 'passed': True, 'checks': len(report), 'responses': report}, indent=2))
