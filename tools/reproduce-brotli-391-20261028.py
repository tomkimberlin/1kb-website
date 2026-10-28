"""Reproduce two exact fixed-source Brotli streams from a pinned archive.

Requires Python 3.12+, a C compiler and the unmodified Brotli 1.2.1 archive.
This is an encoder research recipe, not a general-purpose compressor.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile

REV = 'db24a98aed38a16de78cc05ca15cdd8dc2a0d92d'
SOURCE = '86b1f6f2777fbfe9e98fcbe43456e85c87829ed03c10d8bd911271fd463a277c'
ARCHIVE = '113b9685dfc14dd2f3360d077283266eec2fbdfb0fe3e5600f11be151da0d68e'
EXPECTED = {
    'control': (392, 'a5302e0d6b9199bf0a9fe7d81916315e6be47772b97b7d12491ce9eaf1fa1bd5'),
    'candidate': (391, 'fa488bbf1bc3bd9d07be9d1030d06eb7632c3523396b4ef09780594edb704786'),
}
HOOK = '  BrotliCreateHuffmanTree(histogram, histogram_length, 15, tree, depth);\n'
sha = lambda value: hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--cc', default='cc', help='C compiler executable (default: cc)')
    args = parser.parse_args()
    source, archive = args.input.read_bytes(), args.archive.read_bytes()
    if len(source) != 1040 or sha(source) != SOURCE: raise ValueError('input differs from pinned source')
    if sha(archive) != ARCHIVE: raise ValueError('archive differs from pinned Brotli 1.2.1 source')
    harness = Path(__file__).with_suffix('.c')
    with tempfile.TemporaryDirectory(prefix='brotli-391-') as tmp:
        root = Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar: tar.extractall(root, filter='data')
        input_file = root / 'input.html'
        input_file.write_bytes(source)
        tree = root / ('brotli-' + REV)
        source_file = tree / 'c/enc/brotli_bit_stream.c'
        text = source_file.read_text()
        if text.count(HOOK) != 1: raise ValueError('unexpected encoder source')
        text = '#include <stddef.h>\n#include <stdint.h>\nextern void one_swap_depths(uint8_t*, size_t);\n' + text.replace(HOOK, HOOK + '  one_swap_depths(depth, histogram_length);\n')
        source_file.write_text(text)
        sources = [path for part in ('common', 'enc', 'dec') for path in sorted((tree / 'c' / part).glob('*.c'))]
        executable = root / 'reproduce'
        subprocess.run([args.cc, '-O2', '-I' + str(tree / 'c/include'), '-I' + str(tree / 'c'),
                        *map(str, sources), str(harness), '-lm', '-o', str(executable)], check=True)
        streams = {}
        for name, (size, digest) in EXPECTED.items():
            result = subprocess.run([str(executable), str(input_file), name], check=True, capture_output=True).stdout
            if len(result) != size or sha(result) != digest: raise ValueError(name + ' stream differs from pinned result')
            streams[name] = result
        # Refuse to overwrite existing files or directories, including symlinks.
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for name, data in streams.items():
            with (args.output_dir / (name + '.br')).open('xb') as output: output.write(data)
        compiler = subprocess.run([args.cc, '--version'], check=True, capture_output=True, text=True).stdout.splitlines()[0]
        print(json.dumps({'python': platform.python_version(), 'compiler': compiler, 'sourceSha256': SOURCE,
                          'archiveSha256': ARCHIVE, 'streams': {name: {'bytes': len(data), 'sha256': sha(data)}
                          for name, data in streams.items()}}, indent=2))


if __name__ == '__main__': main()
