"""Small DNS queries used by the two byte-counting probes, without EDNS."""
import socket
import struct

RESOLVER = ('1.1.1.1', 53)


def question_name(host):
    labels = host.encode('idna').removesuffix(b'.').split(b'.')
    if any(not label or len(label) > 63 or any(byte <= 32 or byte == 127 for byte in label)
           for label in labels):
        raise ValueError('Invalid DNS hostname')
    encoded = b''.join(bytes([len(label)]) + label for label in labels) + b'\0'
    if len(encoded) > 255:
        raise ValueError('DNS hostname exceeds 255 wire bytes')
    return encoded


def read_name(packet, offset):
    labels, visited = [], set()
    end, length = None, 1
    while True:
        if offset in visited or offset >= len(packet):
            raise ValueError('Incomplete or cyclic DNS name')
        visited.add(offset)
        count = packet[offset]
        offset += 1
        if count & 0xc0 == 0xc0:
            if offset >= len(packet):
                raise ValueError('Incomplete DNS compression pointer')
            if end is None: end = offset + 1
            offset = ((count & 0x3f) << 8) | packet[offset]
            continue
        if count & 0xc0 or offset + count > len(packet):
            raise ValueError('Invalid DNS label')
        if not count:
            return tuple(labels), end if end is not None else offset
        length += count + 1
        if length > 255:
            raise ValueError('DNS response name exceeds 255 wire bytes')
        labels.append(packet[offset:offset + count].lower())
        offset += count


def measure_query(host, qtype, identifier):
    name = question_name(host)
    query = struct.pack('!6H', identifier, 0x0100, 1, 0, 0, 0) + name + struct.pack('!HH', qtype, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(10)
        sock.sendto(query, RESOLVER)
        # Receive a complete IPv4 UDP payload. A smaller buffer can silently
        # discard trailing bytes before the exact-record-length check below.
        response, peer = sock.recvfrom(65535)
    if peer != RESOLVER or len(response) < 12:
        raise ValueError('Unexpected DNS peer or incomplete response')
    received_id, flags, questions, answers, authorities, additional = struct.unpack('!6H', response[:12])
    if received_id != identifier or not flags & 0x8000 or flags & 0x7a00 or questions != 1:
        raise ValueError('Mismatched, truncated or non-query DNS response')
    received_name, offset = read_name(response, 12)
    if (received_name != read_name(query, 12)[0] or len(response) < offset + 4
            or response[offset:offset + 4] != struct.pack('!HH', qtype, 1)):
        raise ValueError('DNS response question does not match the query')
    offset += 4
    # Check the shape of every declared record without interpreting its RDATA.
    for _ in range(answers + authorities + additional):
        _, offset = read_name(response, offset)
        if offset + 10 > len(response):
            raise ValueError('Incomplete DNS resource record header')
        data_length = int.from_bytes(response[offset + 8:offset + 10], 'big')
        offset += 10 + data_length
        if offset > len(response):
            raise ValueError('Incomplete DNS resource record data')
    if offset != len(response):
        raise ValueError('Trailing bytes after DNS resource records')
    return {'query_bytes': len(query), 'response_bytes': len(response),
            'ipv4_udp_bytes': len(query) + len(response) + 56,
            'answer_count': answers, 'flags': f'{flags:04x}'}
