"""Checks for the fixed-source Brotli recipe; full replay needs the pinned archive."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/reproduce-brotli-391-20261028.py'
SOURCE = ROOT / 'tools/fixtures/comparison-split/index.html'
FIXTURE = ROOT / 'tools/fixtures/brotli-391/candidate.br'
ARCHIVE = os.environ.get('BROTLI_SOURCE_ARCHIVE')
EXPECTED = {
    'control': 'a5302e0d6b9199bf0a9fe7d81916315e6be47772b97b7d12491ce9eaf1fa1bd5',
    'candidate': 'fa488bbf1bc3bd9d07be9d1030d06eb7632c3523396b4ef09780594edb704786',
}


class BrotliRecipeTest(unittest.TestCase):
    def call(self, source, archive, output):
        return subprocess.run([sys.executable, str(SCRIPT), '--input', str(source), '--archive', str(archive),
                               '--output-dir', str(output)], capture_output=True, text=True)

    def test_rejects_other_source_or_archive_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bad_source, bad_archive, output = root / 'source', root / 'archive', root / 'output'
            data = bytearray(SOURCE.read_bytes()); data[0] ^= 1
            bad_source.write_bytes(data); bad_archive.write_bytes(b'invalid archive')
            self.assertNotEqual(self.call(bad_source, bad_archive, output).returncode, 0)
            self.assertFalse(output.exists())
            self.assertNotEqual(self.call(SOURCE, bad_archive, output).returncode, 0)
            self.assertFalse(output.exists())

    @unittest.skipUnless(ARCHIVE, 'set BROTLI_SOURCE_ARCHIVE to run the pinned-source recipe')
    def test_fresh_compiles_reproduce_frozen_candidate_and_refuse_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / 'first', Path(directory) / 'second'
            for output in (first, second):
                result = self.call(SOURCE, ARCHIVE, output)
                self.assertEqual(result.returncode, 0, result.stderr)
                for name, digest in EXPECTED.items():
                    data = (output / (name + '.br')).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
                self.assertEqual((output / 'candidate.br').read_bytes(), FIXTURE.read_bytes())
            self.assertEqual((first / 'candidate.br').read_bytes(), (second / 'candidate.br').read_bytes())
            self.assertNotEqual(self.call(SOURCE, ARCHIVE, first).returncode, 0)


if __name__ == '__main__': unittest.main()
