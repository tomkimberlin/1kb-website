"""Optional gzip optimizer: pip install zopfli==0.4.3, or --tuned with Python 3.12+ and a C compiler."""
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
import zlib
from tools.optimizer_output import exact_gzip, publish_candidate, require_distinct_paths

ARCHIVE_SHA256 = 'd3a50f91a13cea9bafe025de8fd87a005eb26de02a4f0c193127ddbf23ac8ebe'
URL = 'https://files.pythonhosted.org/packages/source/z/zopfli/zopfli-0.4.3.tar.gz'


def tuned_candidates(source, iterations, archive_path):
    archive = archive_path.read_bytes() if archive_path else urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Zopfli source archive checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='onekb-zopfli-') as directory:
        root = Path(directory)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(root, filter='data')
        tree = root / 'zopfli-0.4.3/zopfli/src/zopfli'
        path = tree / 'deflate.c'
        text = path.read_text()
        old = 'symbol == 0 && stride >= 5'
        if text.count(old) != 1:
            raise RuntimeError('Pinned Zopfli source does not match histogram patch')
        # Preserve shorter zero runs when smoothing Huffman histograms. This
        # changes the encoding search, not DEFLATE or its standard wrappers.
        path.write_text(text.replace(old, 'symbol == 0 && stride >= 4'))
        library = root / 'encoder.so'
        compiler = shlex.split(os.environ.get('CC', 'cc'))
        subprocess.run([*compiler, '-O2', '-fPIC',
                        '-dynamiclib' if sys.platform == 'darwin' else '-shared',
                        *map(str, sorted(tree.glob('*.c'))), '-lm', '-o', str(library)], check=True)
        lib = c.CDLL(str(library))
        class Options(c.Structure):
            _fields_ = [(key, c.c_int) for key in ('verbose', 'verbose_more', 'numiterations',
                        'blocksplitting', 'blocksplittinglast', 'blocksplittingmax')]
        byte, size = c.c_ubyte, c.c_size_t
        pointer = c.POINTER(byte)
        lib.ZopfliInitOptions.argtypes = [c.POINTER(Options)]
        lib.ZopfliInitOptions.restype = None
        lib.ZopfliCompress.argtypes = [c.POINTER(Options), c.c_int, pointer, size,
                                      c.POINTER(pointer), c.POINTER(size)]
        lib.ZopfliCompress.restype = None
        free = c.CDLL(None).free
        free.argtypes = [c.c_void_p]
        free.restype = None
        raw = (byte * len(source)).from_buffer_copy(source)
        for count in iterations:
            for splitting in (0, 1):
                options = Options()
                lib.ZopfliInitOptions(c.byref(options))
                options.numiterations = count
                options.blocksplitting = splitting
                output, length = pointer(), size()
                lib.ZopfliCompress(c.byref(options), 0, raw, len(source), c.byref(output), c.byref(length))
                try:
                    yield bytes(output[:length.value])
                finally:
                    free(output)


def ordinary_candidates(source, iterations):
    import zopfli.gzip
    for count in iterations:
        for splitting in (0, 1):
            yield zopfli.gzip.compress(source, numiterations=count, blocksplitting=splitting)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, default=Path('index.html'), help='HTML source to encode.')
parser.add_argument('--output', type=Path, default=Path('compression/index.html.gz'), help='Candidate path; keeps any smaller valid encoding of the same input.')
parser.add_argument('--iterations', type=int, nargs='+', default=[15, 100, 1000, 10000], help='Positive Zopfli iteration counts to compare.')
parser.add_argument('--tuned', action='store_true', help='Build the pinned encoder with tuned Huffman histogram smoothing; does not need the Python Zopfli package.')
parser.add_argument('--archive', type=Path, help='Already downloaded pinned source archive for --tuned.')
args = parser.parse_args()
maximum_iterations = (1 << (c.sizeof(c.c_int) * 8 - 1)) - 1
if any(value < 1 or value > maximum_iterations for value in args.iterations):
    parser.error(f'--iterations must be between 1 and {maximum_iterations}')
if args.archive and not args.tuned:
    parser.error('--archive requires --tuned')
try:
    for protected in (args.input, args.archive, Path(__file__),
                      Path(__file__).resolve().parent / 'tools/optimizer_output.py'):
        if protected is not None:
            require_distinct_paths(protected, args.output)
except ValueError as error:
    parser.error(str(error))
source = args.input.read_bytes()
best = None
candidates = (tuned_candidates(source, args.iterations, args.archive) if args.tuned
              else ordinary_candidates(source, args.iterations))
for data in candidates:
    if not exact_gzip(data, source):
        raise RuntimeError('Gzip round trip failed or has trailing bytes')
    # Validate the wrapper conversion used by the build as well as gzip itself.
    deflate = b'\x78\xda' + data[10:-8] + zlib.adler32(source).to_bytes(4, 'big')
    decoder = zlib.decompressobj()
    if decoder.decompress(deflate) != source or not decoder.eof or decoder.unused_data:
        raise RuntimeError('Deflate round trip failed or has trailing bytes')
    if best is None or len(data) < len(best):
        best = data
best = publish_candidate(source, best, args.output, exact_gzip)
print(f'{len(source)} bytes HTML -> {len(best)} bytes gzip')
