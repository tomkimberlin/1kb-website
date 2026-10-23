"""Replay the October 23 exact-source gzip header improvement; no encoding search."""
import argparse
import hashlib
from pathlib import Path
import struct
import zlib

from optimizer_output import exact_gzip, publish_candidate, require_distinct_paths

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / 'tools/fixtures/gzip-rle-20261023.raw'
SOURCE_SHA256 = 'aa9d6af64c9dbc06da71361f34da43c1d9ea40e725de70daa8ffcd9c165069d9'
SEED_SHA256 = '0cce05aebaefb47e721568c8de2fb1914284a78d397026502ce502cfd8517c39'
RAW_SHA256 = '7673976d0c1f226820f1cdb91570b482fbb38b083edcdfe9bcad1604eccda968'
GZIP_SHA256 = '8128dce71c9c9f4a16ff3920fff528891f83cad0aaa09b53bc2f7ef2218070a0'
# 262 bits, least-significant bit first, followed by two zero padding bits.
# The frozen seed's code-length alphabet stays unchanged. This replaces only
# its 266-bit run-length description, preserving the prefix and payload.
RLE = bytes.fromhex('f77d8a5a3d0db0238a64ddddcf01aa490d11bea4687bfa055a560f736829fbed0b')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def exact(data, source, wbits):
    decoder = zlib.decompressobj(wbits)
    decoded = decoder.decompress(data, len(source) + 1)
    if decoded != source or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('Replayed stream did not completely decode to the exact source')


def replay(source, seed):
    if len(source) != 1021 or sha(source) != SOURCE_SHA256:
        raise ValueError('This replay requires the exact October 23 HTML source')
    if len(seed) != 518 or sha(seed) != SEED_SHA256:
        raise ValueError('Frozen Zopfli seed checksum mismatch')
    exact(seed, source, -15)
    bits = lambda data: [(byte >> i) & 1 for byte in data for i in range(8)]
    original = bits(seed)
    rewritten = original[:141] + bits(RLE)[:262] + original[407:4140]
    raw = bytes(sum(rewritten[start + i] << i for i in range(8))
                for start in range(0, len(rewritten), 8))
    if len(raw) != 517 or sha(raw) != RAW_SHA256:
        raise ValueError('Replayed DEFLATE checksum mismatch')
    exact(raw, source, -15)
    gzip = (bytes.fromhex('1f8b0800000000000203') + raw
            + struct.pack('<II', zlib.crc32(source) & 0xffffffff, len(source)))
    if len(gzip) != 535 or sha(gzip) != GZIP_SHA256 or not exact_gzip(gzip, source):
        raise ValueError('Replayed gzip checksum or complete decoding mismatch')
    # Match the normal build's HTTP deflate wrapper as a separate check.
    exact(b'\x78\xda' + raw + zlib.adler32(source).to_bytes(4, 'big'), source, 15)
    return gzip


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('index.html'))
    parser.add_argument('--output', type=Path, default=Path('compression/index.html.gz'),
                        help='Keep any smaller valid encoding of this exact input.')
    args = parser.parse_args(argv)
    try:
        for protected in (args.input, SEED, Path(__file__), ROOT / 'tools/optimizer_output.py'):
            require_distinct_paths(protected, args.output)
        source = args.input.read_bytes()
        candidate = replay(source, SEED.read_bytes())
        result = publish_candidate(source, candidate, args.output, exact_gzip)
    except (OSError, ValueError, zlib.error) as error:
        parser.error(str(error))
    print(f'{len(source)} bytes HTML -> {len(result)} bytes gzip')


if __name__ == '__main__':
    main()
