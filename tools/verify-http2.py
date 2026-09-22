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

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='tomkimberlin.com')
parser.add_argument('--ip')
parser.add_argument('--port', type=int, default=443)
args = parser.parse_args()
expected = (Path(__file__).resolve().parents[1] / 'public/index.html.br').read_bytes()
context = ssl.create_default_context()
context.set_alpn_protocols(['h2'])
connection = h2.connection.H2Connection(config=h2.config.H2Configuration(
    client_side=True, header_encoding='utf-8'))
cases = [(size, 'GET', '/', 200) for size in
         [4096, 65536, 4095, 65536, 0, 4096, 0, 65536, 1, 4096]]
cases += [(0, 'HEAD', '/', 200), (4096, 'GET', '/missing', 404)]

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
            connection.send_headers(stream_id, [
                (':method', method), (':scheme', 'https'),
                (':authority', args.host), (':path', path), ('accept-encoding', 'br')
            ], end_stream=True)
            stream.sendall(connection.data_to_send())
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
print(json.dumps({'checks': len(cases) + 3, 'passed': True}))
