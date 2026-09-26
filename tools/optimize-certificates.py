"""Optimize public TLS 1.3 certificate bytes with a pinned Brotli recipe. Python 3.12+."""
import argparse
import base64
import ctypes as c
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REVISION = '028fb5a23661f123017c060daa546b55cf4bde29'  # Brotli 1.2.0
ARCHIVE_SHA256 = '0afe09a53c8bad9861c8dd1fc1284308d54f19d2979ba3541cfdcc9b05fe360f'
URL = f'https://codeload.github.com/google/brotli/tar.gz/{REVISION}'
PARAMS = {0: 0, 1: 11, 2: 16, 4: 0, 7: 1, 8: 18}
MODEL = {'distanceSeed': 1, 'literalScale': 0.9, 'commandScale': 1.02, 'distanceScale': 1.1,
         'histogramStreakLimit': 1536, 'histogramBias': 128,
         'zeroRunThreshold': 7, 'nonzeroEntryThreshold': 16}


def validate_der(der):
    # OpenSSL permits trailing data and some BER length forms. Certificate
    # entries must contain exactly one DER SEQUENCE before semantic parsing.
    invalid = 'Certificate must be one complete DER SEQUENCE with a minimal definite length'
    if len(der) < 2 or der[0] != 0x30:
        raise ValueError(invalid)
    length, offset = der[1], 2
    if length & 0x80:
        count = length & 0x7f
        if not count or offset + count > len(der) or der[offset] == 0:
            raise ValueError(invalid)
        length = int.from_bytes(der[offset:offset+count], 'big')
        offset += count
        if length < 128:
            raise ValueError(invalid)
    if offset + length != len(der):
        raise ValueError(invalid)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(der))


def pem_body(path):
    pem = path.read_text(encoding='ascii')
    if re.search(r'-----BEGIN [^-]*PRIVATE KEY-----', pem):
        raise ValueError('Private-key PEM labels are not accepted; provide only a public fullchain')
    pattern = re.compile(r'-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----')
    entries = []
    for match in pattern.finditer(pem):
        der = base64.b64decode(re.sub(r'\s+', '', match.group(1)), validate=True)
        validate_der(der)
        entries.append(len(der).to_bytes(3, 'big') + der + b'\0\0')
    if not entries or pattern.sub('', pem).strip():
        raise ValueError('Expected only public CERTIFICATE PEM blocks')
    chain = b''.join(entries)
    return b'\0' + len(chain).to_bytes(3, 'big') + chain


def validate_body(data):
    if not data:
        raise ValueError('Empty Certificate body')
    pos = 1 + data[0]
    if pos + 3 > len(data):
        raise ValueError('Missing certificate list')
    length = int.from_bytes(data[pos:pos+3], 'big')
    pos += 3
    if not length or pos + length != len(data):
        raise ValueError('Certificate list length mismatch')
    count = 0
    while pos < len(data):
        if pos + 3 > len(data):
            raise ValueError('Truncated certificate length')
        length = int.from_bytes(data[pos:pos+3], 'big')
        pos += 3
        if not length or pos + length + 2 > len(data):
            raise ValueError('Certificate entry length mismatch')
        validate_der(data[pos:pos+length])
        pos += length
        extensions = int.from_bytes(data[pos:pos+2], 'big')
        pos += 2 + extensions
        if pos > len(data):
            raise ValueError('Certificate extension length mismatch')
        count += 1
    return count


def build_encoder(root, library, archive_path):
    archive = archive_path.read_bytes() if archive_path else urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Brotli source archive checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(root, filter='data')
    tree = root / f'brotli-{REVISION}'
    def replace(text, old, new, count=1):
        if text.count(old) != count:
            raise RuntimeError('Pinned Brotli source does not match patch: ' + old)
        return text.replace(old, new)

    path = tree / 'c/enc/backward_references_hq.c'
    text = path.read_text()
    text = replace(text, 'FastLog2(20 + (uint32_t)i)', 'FastLog2(1 + (uint32_t)i)')
    old = '    *num_commands = orig_num_commands;'
    text = replace(text, old, '''    {
      size_t j;
      for (j = 0; j <= num_bytes; ++j)
        model->literal_costs_[j] *= 0.9f;
      for (j = 0; j < BROTLI_NUM_COMMAND_SYMBOLS; ++j)
        model->cost_cmd_[j] *= 1.02f;
      model->min_cost_cmd_ *= 1.02f;
      for (j = 0; j < params->dist.alphabet_size_limit; ++j)
        model->cost_dist_[j] *= 1.1f;
    }
''' + old)
    path.write_text(text)
    path = tree / 'c/enc/entropy_encode.c'
    text = path.read_text()
    for old, new, count in (
        ('const size_t streak_limit = 1240;', 'const size_t streak_limit = 1536;', 1),
        ('/ 3 + 420;', '/ 3 + 128;', 2),
        ('symbol == 0 && step >= 5', 'symbol == 0 && step >= 7', 1),
        ('if (nonzeros < 28)', 'if (nonzeros < 16)', 1),
    ):
        text = replace(text, old, new, count)
    path.write_text(text)

    compiler = shlex.split(os.environ.get('CC', 'cc'))
    sources = sorted((tree / 'c/common').glob('*.c')) + sorted((tree / 'c/enc').glob('*.c')) + sorted((tree / 'c/dec').glob('*.c'))
    subprocess.run([*compiler, '-O2', '-fPIC',
                    '-dynamiclib' if sys.platform == 'darwin' else '-shared',
                    '-I' + str(tree / 'c/include'), *map(str, sources), '-lm',
                    '-o', str(library)], check=True)


def encode(source, library):
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
        for key, value in PARAMS.items():
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
        encoded = bytes(output[:len(output) - room.value])
    finally:
        lib.BrotliEncoderDestroyInstance(state)
    decode_exact(encoded, source, lib)
    return encoded


def decode_exact(encoded, source, lib):
    # Streaming decode proves both exact output and complete input consumption.
    byte, size = c.c_ubyte, c.c_size_t
    pointer = c.POINTER(byte)
    lib.BrotliDecoderCreateInstance.argtypes = [c.c_void_p] * 3
    lib.BrotliDecoderCreateInstance.restype = c.c_void_p
    lib.BrotliDecoderDestroyInstance.argtypes = [c.c_void_p]
    lib.BrotliDecoderDecompressStream.argtypes = [c.c_void_p, c.POINTER(size),
        c.POINTER(pointer), c.POINTER(size), c.POINTER(pointer), c.POINTER(size)]
    lib.BrotliDecoderDecompressStream.restype = c.c_int
    compressed = (byte * len(encoded)).from_buffer_copy(encoded)
    decoded = (byte * len(source))()
    input_pointer, output_pointer = c.cast(compressed, pointer), c.cast(decoded, pointer)
    available, room, total = size(len(encoded)), size(len(source)), size()
    state = lib.BrotliDecoderCreateInstance(None, None, None)
    if not state:
        raise MemoryError('Cannot create Brotli decoder')
    try:
        result = lib.BrotliDecoderDecompressStream(state, c.byref(available),
            c.byref(input_pointer), c.byref(room), c.byref(output_pointer), c.byref(total))
        if result != 1 or available.value or room.value or bytes(decoded) != source:
            raise RuntimeError('Certificate Brotli round trip failed or has trailing bytes')
    finally:
        lib.BrotliDecoderDestroyInstance(state)


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.'+path.name+'.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def require_distinct_outputs(outputs, inputs):
    protected = list(inputs)
    for output in outputs:
        for source in protected:
            if output.resolve() == source.resolve() or (output.exists() and source.exists() and output.samefile(source)):
                raise ValueError(f'Output {output} aliases an input or another output: {source}')
        protected.append(output)


def encoder_provenance(library):
    return {'brotliRevision': REVISION, 'archiveSha256': ARCHIVE_SHA256,
            'params': {str(key): value for key, value in PARAMS.items()}, 'model': MODEL,
            'encoderSha256': hashlib.sha256(library.read_bytes()).hexdigest(),
            'decoder': 'unmodified Brotli 1.2.0 decoder'}


def load_encoder_provenance(library):
    manifest = Path(str(library) + '.json')
    try:
        recorded = json.loads(manifest.read_text())
    except (OSError, ValueError) as error:
        raise ValueError('Missing or invalid encoder manifest; use --build-encoder to produce the library and its .json file') from error
    expected = encoder_provenance(library)
    if not isinstance(recorded, dict) or any(recorded.get(key) != value for key, value in expected.items()):
        raise ValueError('Encoder manifest does not match the library checksum or pinned recipe; rebuild with --build-encoder')
    return recorded


def publish_encoded(source, encoded, output, metadata, lib):
    decode_exact(encoded, source, lib)
    retained, reproduced = False, True
    if output.exists():
        existing = output.read_bytes()
        if len(existing) <= len(encoded):
            try:
                decode_exact(existing, source, lib)
            except RuntimeError:
                pass
            else:
                reproduced = existing == encoded
                encoded, retained = existing, True
    facts = {key: metadata[key] for key in ('inputFormat', 'inputSha256', 'inputBytes', 'certificates')}
    facts.update(brotliSha256=hashlib.sha256(encoded).hexdigest(), brotliBytes=len(encoded))
    manifest = output.with_suffix('.json')
    if retained:
        try:
            previous = json.loads(manifest.read_text())
        except (OSError, ValueError):
            previous = None
        if isinstance(previous, dict) and all(previous.get(key) == value for key, value in facts.items()):
            return encoded, previous, retained
        # A different encoder may have found the retained bytes. Do not assign
        # this run's model to them when matching provenance is unavailable.
        if not reproduced:
            metadata = {**facts, 'encoderProvenance': 'Unknown; retained an existing exact candidate',
                        'validatedWithEncoderSha256': metadata['encoderSha256']}
    metadata = {**metadata, **facts}
    if not retained:
        atomic_write(output, encoded)
    atomic_write(manifest, (json.dumps(metadata, indent=2) + '\n').encode())
    return encoded, metadata, retained


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', nargs='?', type=Path, help='Public Certificate body without its four-byte handshake header.')
    parser.add_argument('--pem', type=Path, help='Public fullchain PEM; constructs a Certificate body with empty context and entry extensions.')
    parser.add_argument('--archive', type=Path, help='Already downloaded pinned Brotli source archive.')
    parser.add_argument('--build-encoder', type=Path, help='Compile the encoder/standard-decoder library once to this path; a C compiler is required.')
    parser.add_argument('--encoder', type=Path, help='Load a library and its checksum-bound .json manifest previously produced by --build-encoder, without compiling or downloading.')
    parser.add_argument('--output', '--output-dir', dest='output_dir', type=Path, default=Path(__file__).resolve().parent / 'output', help='Write INPUT_SHA256.br and INPUT_SHA256.json here.')
    args = parser.parse_args()
    if args.input and args.pem:
        parser.error('Choose a raw Certificate body or --pem, not both')
    if args.encoder and args.build_encoder:
        parser.error('Choose --encoder or --build-encoder, not both')
    if args.encoder and args.archive:
        parser.error('--archive is only used when compiling an encoder')
    if not args.input and not args.pem and not args.build_encoder:
        parser.error('Provide public input or use --build-encoder')
    source = pem_body(args.pem) if args.pem else args.input.read_bytes() if args.input else None
    certificate_count = validate_body(source) if source is not None else None
    input_sha = hashlib.sha256(source).hexdigest() if source is not None else None
    output = args.output_dir / (input_sha + '.br') if source is not None else None
    inputs = [path for path in (args.input, args.pem, args.archive, args.encoder, Path(__file__)) if path is not None]
    if args.encoder:
        inputs.append(Path(str(args.encoder.resolve()) + '.json'))
    outputs = [output, output.with_suffix('.json')] if output is not None else []
    if args.build_encoder:
        outputs += [args.build_encoder, Path(str(args.build_encoder.resolve()) + '.json')]
    require_distinct_outputs(outputs, inputs)
    with tempfile.TemporaryDirectory(prefix='certificate-brotli-') as directory:
        root = Path(directory)
        library = (args.encoder or args.build_encoder or (root / 'encoder.so')).resolve()
        if not args.encoder:
            # Build in the temporary directory, then publish only the complete library.
            temporary_library = root / 'built-encoder.so'
            build_encoder(root, temporary_library, args.archive)
            atomic_write(library, temporary_library.read_bytes())
        provenance = load_encoder_provenance(library) if args.encoder else encoder_provenance(library)
        if args.build_encoder:
            atomic_write(Path(str(library) + '.json'), (json.dumps(provenance, indent=2) + '\n').encode())
        if source is None:
            print(json.dumps({'encoder': str(library), **provenance}))
            return
        encoded = encode(source, library)
        metadata = {'inputFormat': 'TLS 1.3 Certificate body', 'inputSha256': input_sha,
                    'inputBytes': len(source), 'certificates': certificate_count,
                    **provenance}
        encoded, metadata, retained = publish_encoded(source, encoded, output, metadata, c.CDLL(str(library)))
        print(json.dumps({'output': str(output), 'inputBytes': len(source),
                         'brotliBytes': len(encoded), 'brotliSha256': metadata['brotliSha256'],
                         'retainedExisting': retained}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        raise SystemExit(str(error)) from error
