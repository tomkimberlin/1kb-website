"""Exact-source replay guards and complete decoding, without a compiler or downloads."""
import gzip
import hashlib
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parent.parent
MODULE = runpy.run_path(str(ROOT / 'tools/replay-gzip-rle.py'))


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / 'tools/fixtures').mkdir(parents=True)
        for name in ('replay-gzip-rle.py', 'optimizer_output.py', 'fixtures/gzip-rle-20261023.raw'):
            shutil.copyfile(ROOT / 'tools' / name, self.root / 'tools' / name)
        self.seed = self.root / 'tools/fixtures/gzip-rle-20261023.raw'
        # The frozen seed makes these regressions independent of future copy edits.
        self.source = zlib.decompress(self.seed.read_bytes(), -15)
        self.input = self.root / 'index.html'
        self.input.write_bytes(self.source)
        self.output = self.root / 'candidate.gz'
        self.output.write_bytes(gzip.compress(self.source, mtime=0))

    def tearDown(self):
        self.directory.cleanup()

    def cli(self, output=None, optimized=False):
        return subprocess.run([sys.executable, *(['-O'] if optimized else []),
            str(self.root / 'tools/replay-gzip-rle.py'), '--input', str(self.input),
            '--output', str(output or self.output)], capture_output=True, text=True)

    def test_replay_is_deterministic_and_completely_decodes_both_wrappers(self):
        candidate = MODULE['replay'](self.source, self.seed.read_bytes())
        self.assertEqual(len(candidate), 535)
        self.assertEqual(hashlib.sha256(candidate).hexdigest(), MODULE['GZIP_SHA256'])
        self.assertEqual(candidate, MODULE['replay'](self.source, self.seed.read_bytes()))
        deflate = b'\x78\xda' + candidate[10:-8] + zlib.adler32(self.source).to_bytes(4, 'big')
        self.assertEqual(len(deflate), 523)
        for body, wbits in ((candidate, 31), (candidate[10:-8], -15), (deflate, 15)):
            MODULE['exact'](body, self.source, wbits)
            for malformed in (body[:-1], body + b'!', bytes([body[0] ^ 1]) + body[1:]):
                with self.assertRaises((ValueError, zlib.error)):
                    MODULE['exact'](malformed, self.source, wbits)

    def test_cli_replays_under_optimized_python_and_preserves_existing_exact_output(self):
        result = self.cli(optimized=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.output.stat()
        self.assertEqual(hashlib.sha256(self.output.read_bytes()).hexdigest(), MODULE['GZIP_SHA256'])
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        after = self.output.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))

    def test_wrong_source_and_seed_fail_without_replacing_output_even_under_optimization(self):
        for wrong in ('source', 'seed'):
            for optimized in (False, True):
                path = self.input if wrong == 'source' else self.seed
                original = path.read_bytes()
                before = self.output.read_bytes()
                path.write_bytes(original + b'!')
                try:
                    result = self.cli(optimized=optimized)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn('exact October 23 HTML' if wrong == 'source' else 'seed checksum', result.stderr)
                    self.assertEqual(self.output.read_bytes(), before)
                finally:
                    path.write_bytes(original)

    def test_output_cannot_alias_source_seed_script_or_helper(self):
        for original in (self.input, self.seed, self.root / 'tools/replay-gzip-rle.py',
                         self.root / 'tools/optimizer_output.py'):
            before = original.read_bytes()
            for kind in ('direct', 'symbolic', 'hard'):
                output = original if kind == 'direct' else self.root / ('alias-' + kind)
                if kind == 'symbolic':
                    output.symlink_to(original)
                elif kind == 'hard':
                    os.link(original, output)
                try:
                    result = self.cli(output=output)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn('must refer to different files', result.stderr)
                    self.assertEqual(original.read_bytes(), before)
                finally:
                    if kind != 'direct':
                        output.unlink()


if __name__ == '__main__':
    unittest.main()
