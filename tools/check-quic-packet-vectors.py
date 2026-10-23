"""Independent QUIC header removal, AES-GCM open and RFC 9000 frame decode.
No nginx wire/parser helper is used here. All keys are synthetic fixture keys.
"""
from pathlib import Path
import argparse, hashlib, json
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
sha = lambda b: hashlib.sha256(b).hexdigest()
KEY = b'"' * 16
HP = b'3' * 16
IV = b'D' * 12

def varint(data, pos):
    if pos >= len(data):
        raise ValueError('Missing varint')
    width = 1 << (data[pos] >> 6)
    if pos + width > len(data):
        raise ValueError('Truncated varint')
    return (int.from_bytes(data[pos:pos + width], 'big') & (1 << 8 * width - 2) - 1, pos + width)

def decode_frames(data):
    pos = 0
    result = []
    while pos < len(data):
        typ, pos = varint(data, pos)
        if typ == 0:
            continue
        if typ == 1:
            result.append({'type': 'ping'})
            continue
        if typ == 2:
            largest, pos = varint(data, pos)
            delay, pos = varint(data, pos)
            count, pos = varint(data, pos)
            first, pos = varint(data, pos)
            if count:
                raise ValueError('Fixture expects zero additional ACK ranges')
            result.append({'type': 'ack', 'largest': largest, 'delay': delay, 'first': first})
            continue
        if typ == 6:
            offset, pos = varint(data, pos)
            length, pos = varint(data, pos)
            if length > len(data) - pos:
                raise ValueError('Truncated CRYPTO')
            result.append({'type': 'crypto', 'offset': offset, 'length': length, 'data': data[pos:pos + length].hex()})
            pos += length
            continue
        if not 8 <= typ <= 15:
            raise ValueError('Unexpected fixture frame')
        stream, pos = varint(data, pos)
        offset, pos = varint(data, pos) if typ & 4 else (0, pos)
        length, pos = varint(data, pos) if typ & 2 else (len(data) - pos, pos)
        if length > len(data) - pos or offset + length > (1 << 62) - 1:
            raise ValueError('Truncated/invalid STREAM')
        result.append({'type': 'stream', 'id': stream, 'offset': offset, 'length': length, 'fin': bool(typ & 1), 'explicitLength': bool(typ & 2), 'data': data[pos:pos + length].hex()})
        pos += length
    return result

def open_packet(row):
    data = bytes.fromhex(row['ciphertext'])
    plain = bytes.fromhex(row['plaintext'])
    pos = 1
    long = bool(data[0] & 128)
    if long:
        if int.from_bytes(data[1:5], 'big') != 1:
            raise ValueError('Wrong version')
        pos = 5
        dcid = data[pos]
        pos += 1 + dcid
        scid = data[pos]
        pos += 1 + scid
        if data[0] & 48 == 0:
            token, pos = varint(data, pos)
            pos += token
        remaining, pos = varint(data, pos)
        if remaining != len(data) - pos:
            raise ValueError('Long header remainder mismatch')
    else:
        pos += 8
    sample = data[pos + 4:pos + 20]
    if len(sample) != 16:
        raise ValueError('Missing header protection sample')
    encryptor = Cipher(algorithms.AES(HP), modes.ECB()).encryptor()
    mask = encryptor.update(sample) + encryptor.finalize()
    first = data[0] ^ mask[0] & (15 if long else 31)
    pnlen = (first & 3) + 1
    if pnlen != row['pnLength']:
        raise ValueError('Packet number width changed')
    aad = bytearray(data[:pos + pnlen])
    aad[0] = first
    for i in range(pnlen):
        aad[pos + i] ^= mask[i + 1]
    number = int.from_bytes(aad[pos:], 'big')
    if number != row['number'] & (1 << pnlen * 8) - 1:
        raise ValueError('Packet number changed')
    nonce = (int.from_bytes(IV, 'big') ^ row['number']).to_bytes(12, 'big')
    opened = AESGCM(KEY).decrypt(nonce, data[pos + pnlen:], bytes(aad))
    if opened != plain or pos + pnlen != row['headerLength']:
        raise ValueError('Independent open differs')
    return decode_frames(opened)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', required=True, type=Path)
parser.add_argument('--candidate', required=True, type=Path)
parser.add_argument('--baseline-sanitized', type=Path)
parser.add_argument('--candidate-sanitized', type=Path)
parser.add_argument('--report', type=Path, help='Optional new report; never overwrite')
args = parser.parse_args()
raws = {}
malformed = 0
decoded = 0
changed = 0
removed = 0
errors = []
for variant in ['baseline', 'candidate']:
    path = getattr(args, variant)
    sanitized = getattr(args, variant + '_sanitized')
    if sanitized is not None and path.read_bytes() != sanitized.read_bytes():
        raise ValueError('Sanitized vectors differ')
    rows = json.loads(path.read_bytes())
    parsed = []
    for row in rows:
        parsed.append(open_packet(row))
        decoded += 1
        data = bytes.fromhex(row['ciphertext'])
        for bad in [data[:-1], data + b'\x00', bytes([data[0] ^ 1]) + data[1:]]:
            try:
                open_packet({**row, 'ciphertext': bad.hex()})
            except (ValueError, InvalidTag):
                malformed += 1
            else:
                raise ValueError('Malformed protected packet accepted')
    raws[variant] = (rows, parsed)
a, b = (raws['baseline'], raws['candidate'])
if len(a[0]) != len(b[0]):
    raise ValueError('Packet matrix differs')
for old, new, oa, na in zip(a[0], b[0], a[1], b[1]):
    semantics = lambda rows: [{k: v for k, v in r.items() if k != 'explicitLength'} for r in rows]
    if semantics(oa) != semantics(na):
        raise ValueError('Frame content/semantic mismatch')
    if {k: v for k, v in old.items() if k not in ['plaintext', 'ciphertext']} != {k: v for k, v in new.items() if k not in ['plaintext', 'ciphertext']}:
        raise ValueError('Packet metadata changed')
    for i, (x, y) in enumerate(zip(oa, na)):
        if x.get('explicitLength') != y.get('explicitLength'):
            if i != len(na) - 1 or y['explicitLength'] or new['level'] != 3:
                raise ValueError('Omitted nonfinal/nonapplication STREAM length')
            changed += 1
    delta = len(bytes.fromhex(old['ciphertext'])) - len(bytes.fromhex(new['ciphertext']))
    if delta < 0:
        raise ValueError('Candidate packet grew')
    removed += delta
try:
    decode_frames(bytes.fromhex('0a00c000000040000000'))
except ValueError:
    malformed += 1
else:
    raise ValueError('Truncated 8-byte length accepted')
result = {'independentOpenedPackets': decoded, 'independentSemanticComparisons': len(a[0]), 'changedFinalStreamLengthFields': changed, 'syntheticEncryptedBytesRemoved': removed, 'malformedRejected': malformed, 'decoder': 'Independent Python cryptography AES-ECB header unmask/AESGCM open and RFC 9000 frame reader; synthetic fixture keys only', 'vectors': {v: {'sha256': sha(getattr(args, v).read_bytes())} for v in raws}}
if args.report is not None:
    with args.report.open('x') as output:
        output.write(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
