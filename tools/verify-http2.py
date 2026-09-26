"""Check HTTP/2 header-table resizing, response framing and receive limits."""
import argparse
import json
import socket
import ssl
from pathlib import Path

import h2.config
import h2.connection
import h2.events
import h2.settings

if not __debug__:
    raise RuntimeError('Transport verification requires Python assertions; remove -O or PYTHONOPTIMIZE')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='tomkimberlin.com')
parser.add_argument('--ip')
parser.add_argument('--port', type=int, default=443)
parser.add_argument('--ca', help='CA PEM for an isolated trusted test server')
parser.add_argument('--expected-body', type=Path, default=Path(__file__).resolve().parents[1] / 'public/index.html.br')
args = parser.parse_args()
expected = args.expected_body.read_bytes()
context = ssl.create_default_context(cafile=args.ca)
context.set_alpn_protocols(['h2'])
connection = h2.connection.H2Connection(config=h2.config.H2Configuration(
    client_side=True, header_encoding='utf-8'))
cases = [(size, 'GET', '/', 200) for size in
         [4096, 65536, 4095, 65536, 0, 4096, 0, 65536, 1, 4096]]
cases += [(0, 'HEAD', '/', 200), (4096, 'GET', '/missing', 404)]
split_headers_index = len(cases)
cases += [(4096, 'GET', '/', 200)]

with socket.create_connection((args.ip or args.host, args.port), timeout=15) as tcp:
    with context.wrap_socket(tcp, server_hostname=args.host) as stream:
        assert stream.selected_alpn_protocol() == 'h2'
        connection.initiate_connection()
        stream.sendall(connection.data_to_send())
        # A maximum-size unknown extension frame must be ignored.
        stream.sendall((16384).to_bytes(3, 'big') + bytes([0xef, 0])
                       + bytes(4) + bytes(16384))
        for index, (size, method, path, expected_status) in enumerate(cases):
            connection.update_settings({h2.settings.SettingCodes.HEADER_TABLE_SIZE: size})
            stream_id = index * 2 + 1
            headers = [
                (':method', method), (':scheme', 'https'),
                (':authority', args.host), (':path', path), ('accept-encoding', 'br')
            ]
            if index == split_headers_index:
                # The block exceeds one frame while each field and the whole
                # decoded list fit nginx's normal request-header limits.
                headers += [(f'x-padding-{i}', 'Z' * 1024) for i in range(20)]
            connection.send_headers(stream_id, headers, end_stream=True)
            outgoing = connection.data_to_send()
            if index == split_headers_index:
                frames, offset = [], 0
                while offset < len(outgoing):
                    length = int.from_bytes(outgoing[offset:offset + 3], 'big')
                    frames.append((outgoing[offset + 3], length))
                    offset += 9 + length
                assert any(kind == 9 for kind, _ in frames), 'Missing CONTINUATION fixture frame'
                assert max(length for _, length in frames) <= 16384
                split_header_bytes = sum(length for kind, length in frames if kind in (1, 9))
            stream.sendall(outgoing)
            body, status, ended = bytearray(), None, False
            while not ended:
                data = stream.recv(65536)
                assert data, 'Connection closed before the response ended'
                for event in connection.receive_data(data):
                    assert not isinstance(event, (h2.events.ConnectionTerminated,
                                                  h2.events.StreamReset)), event
                    if isinstance(event, h2.events.ResponseReceived):
                        status = int(dict(event.headers)[':status'])
                    if isinstance(event, h2.events.DataReceived):
                        body.extend(event.data)
                        connection.acknowledge_received_data(
                            event.flow_controlled_length, event.stream_id)
                    if isinstance(event, h2.events.StreamEnded):
                        assert event.stream_id == stream_id
                        ended = True
                pending = connection.data_to_send()
                if pending:
                    stream.sendall(pending)
            assert status == expected_status, (stream_id, status)
            assert body == (expected if method == 'GET' and path == '/' else b'')
        # A request larger than the initial 65,535-byte connection window must
        # advance through WINDOW_UPDATE and legal DATA frames, then reach the
        # normal method handler. This probes receive credit after omitting the
        # old initial connection-window increase from the server preface.
        stream_id = len(cases) * 2 + 1
        upload = b'u' * 81920
        connection.send_headers(stream_id, [
            (':method', 'POST'), (':scheme', 'https'),
            (':authority', args.host), (':path', '/'),
            ('content-length', str(len(upload)))
        ])
        sent, upload_frames, status, ended = 0, [], None, False
        upload_response, window_updates = bytearray(), set()
        while not ended:
            while sent < len(upload) and connection.local_flow_control_window(stream_id) > 0:
                length = min(16384, connection.local_flow_control_window(stream_id), len(upload) - sent)
                connection.send_data(stream_id, upload[sent:sent + length], end_stream=sent + length == len(upload))
                sent += length
                upload_frames.append(length)
            pending = connection.data_to_send()
            if pending:
                stream.sendall(pending)
            data = stream.recv(65536)
            assert data, 'Connection closed during a valid multi-frame upload'
            for event in connection.receive_data(data):
                assert not isinstance(event, (h2.events.ConnectionTerminated, h2.events.StreamReset)), event
                if isinstance(event, h2.events.WindowUpdated):
                    window_updates.add(event.stream_id)
                elif isinstance(event, h2.events.ResponseReceived):
                    assert event.stream_id == stream_id
                    status = int(dict(event.headers)[':status'])
                elif isinstance(event, h2.events.DataReceived):
                    assert event.stream_id == stream_id
                    upload_response.extend(event.data)
                    connection.acknowledge_received_data(event.flow_controlled_length, event.stream_id)
                elif isinstance(event, h2.events.StreamEnded):
                    assert event.stream_id == stream_id
                    ended = True
        assert sent == len(upload) and status == 405 and upload_response == b''
        assert 0 in window_updates, 'Missing connection receive-window growth'
        assert max(upload_frames) == 16384
        assert connection.max_outbound_frame_size == 16384
        # Exceeding the default receive limit must produce FRAME_SIZE_ERROR.
        stream.sendall((16385).to_bytes(3, 'big') + bytes([0xef, 0])
                       + bytes(4) + bytes(16385))
        terminated = False
        while not terminated:
            data = stream.recv(65536)
            assert data, 'Missing GOAWAY for an oversized frame'
            for event in connection.receive_data(data):
                if isinstance(event, h2.events.ConnectionTerminated):
                    assert event.error_code == 6, event
                    terminated = True
print(json.dumps({'checks': len(cases) + 4, 'passed': True,
                  'splitHeaderBlockBytes': split_header_bytes,
                  'uploadBytes': len(upload), 'uploadFrameBytes': upload_frames}))
