"""Generate an optional Brotli candidate. Requires Python 3.12+, Node and a C compiler."""
import argparse
import ctypes as c
import hashlib
import io
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REVISION = '028fb5a23661f123017c060daa546b55cf4bde29'  # Brotli 1.2.0
ARCHIVE_SHA256 = '0afe09a53c8bad9861c8dd1fc1284308d54f19d2979ba3541cfdcc9b05fe360f'
URL = f'https://codeload.github.com/google/brotli/tar.gz/{REVISION}'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, help='Use an already downloaded source archive.')
args = parser.parse_args()
source = Path('index.html').read_bytes()
archive = args.archive.read_bytes() if args.archive else urllib.request.urlopen(URL, timeout=60).read()
if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
    raise SystemExit('Brotli source archive checksum mismatch')

with tempfile.TemporaryDirectory(prefix='onekb-brotli-') as directory:
    root = Path(directory)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(root, filter='data')
    tree = root / f'brotli-{REVISION}'

    # Change match-selection estimates, not the Brotli format or dictionary.
    # A shorter local histogram and a slightly higher estimated literal cost
    # find a smaller encoding of this page than the stock quality-11 search.
    path = tree / 'c/enc/literal_cost.c'
    text = path.read_text()
    old = 'size_t window_half = 495;'
    assert text.count(old) == 1
    path.write_text(text.replace(old, 'size_t window_half = 32;'))
    path = tree / 'c/enc/backward_references_hq.c'
    text = path.read_text()
    old = '    *num_commands = orig_num_commands;'
    assert text.count(old) == 1
    text = text.replace(old, '''    {
      size_t j;
      for (j = 0; j <= num_bytes; ++j)
        model->literal_costs_[j] *= 1.23f;
    }
''' + old)
    path.write_text(text)

    # Preserve shorter zero runs and adjust histogram smoothing so the
    # resulting Huffman code trees take fewer bits to describe.
    path = tree / 'c/enc/entropy_encode.c'
    text = path.read_text()
    for old, new in (
        ('symbol == 0 && step >= 5', 'symbol == 0 && step >= 3'),
        ('limit += 120;', 'limit += 512;'),
    ):
        assert text.count(old) == 1
        text = text.replace(old, new)
    path.write_text(text)

    library = root / 'encoder.so'
    compiler = shlex.split(os.environ.get('CC', 'cc'))
    sources = sorted((tree / 'c/common').glob('*.c')) + sorted((tree / 'c/enc').glob('*.c'))
    subprocess.run([*compiler, '-O2', '-fPIC',
                    '-dynamiclib' if sys.platform == 'darwin' else '-shared',
                    '-I' + str(tree / 'c/include'), *map(str, sources), '-lm',
                    '-o', str(library)], check=True)
    lib = c.CDLL(str(library))
    byte = c.c_ubyte
    pointer = c.POINTER(byte)
    size = c.c_size_t
    lib.BrotliEncoderCreateInstance.argtypes = [c.c_void_p] * 3
    lib.BrotliEncoderCreateInstance.restype = c.c_void_p
    lib.BrotliEncoderDestroyInstance.argtypes = [c.c_void_p]
    lib.BrotliEncoderSetParameter.argtypes = [c.c_void_p, c.c_int, c.c_uint]
    lib.BrotliEncoderSetParameter.restype = c.c_int
    lib.BrotliEncoderCompressStream.argtypes = [c.c_void_p, c.c_int, c.POINTER(size),
                                               c.POINTER(pointer), c.POINTER(size),
                                               c.POINTER(pointer), c.POINTER(size)]
    lib.BrotliEncoderCompressStream.restype = c.c_int
    lib.BrotliEncoderIsFinished.argtypes = [c.c_void_p]
    lib.BrotliEncoderIsFinished.restype = c.c_int
    state = lib.BrotliEncoderCreateInstance(None, None, None)
    if not state:
        raise MemoryError('Cannot create Brotli encoder')
    try:
        # Generic mode, quality 11, 64 KiB window, literal contexts enabled,
        # three distance postfix bits and eight direct distance codes.
        for key, value in {0: 0, 1: 11, 2: 16, 4: 0, 7: 3, 8: 8}.items():
            if not lib.BrotliEncoderSetParameter(state, key, value):
                raise RuntimeError(f'Brotli rejected parameter {key}')
        raw = (byte * len(source)).from_buffer_copy(source)
        input_pointer = c.cast(raw, pointer)
        available = size(len(source))
        output = (byte * max(4096, len(source) * 2))()
        output_pointer = c.cast(output, pointer)
        room = size(len(output))
        total = size()
        result = lib.BrotliEncoderCompressStream(state, 2, c.byref(available),
                    c.byref(input_pointer), c.byref(room), c.byref(output_pointer), c.byref(total))
        if not result or available.value or not lib.BrotliEncoderIsFinished(state):
            raise RuntimeError('Brotli did not finish encoding')
        candidate = root / 'candidate.br'
        candidate.write_bytes(bytes(output[:len(output) - room.value]))
    finally:
        lib.BrotliEncoderDestroyInstance(state)

    # Validate with Node's unmodified decoder before writing the build input.
    subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
if (!brotliDecompressSync(readFileSync(process.argv[1])).equals(readFileSync('index.html')))
  throw Error('Brotli round trip failed');
''', str(candidate)], check=True)
    Path('compression').mkdir(exist_ok=True)
    Path('compression/index.html.br').write_bytes(candidate.read_bytes())
    print(f'{len(source)} bytes HTML -> {candidate.stat().st_size} bytes Brotli')
