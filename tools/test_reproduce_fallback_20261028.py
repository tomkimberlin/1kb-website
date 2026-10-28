"""Regression checks for the fixed-source fallback reproduction recipe."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/reproduce-fallback-20261028.py'
SOURCE = ROOT / 'tools/fixtures/comparison-split/index.html'
EXPECTED = {
    'raw': '2798bd32bd28c5cf57e002e95e799c4bdeb8237d3a89ee3c950e49141858db55',
    'gz': 'c3d75eb558ff097e54ec7e0f180e37869c9b4bfbec301045410413f0ff974fef',
    'deflate': '055a322af0c96ace5f049886e0ac4675b4dc0728cbcef72c48b2667af7235d01',
}


class FallbackRecipeTest(unittest.TestCase):
    def call(self, source, output):
        return subprocess.run([sys.executable, str(SCRIPT), '--input', str(source),
                               '--output-dir', str(output)], capture_output=True, text=True)

    def test_reproduces_recorded_streams_and_refuses_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'new'
            result = self.call(SOURCE, output)
            self.assertEqual(result.returncode, 0, result.stderr)
            for ext, expected in EXPECTED.items():
                self.assertEqual(hashlib.sha256((output / ('reproduced.' + ext)).read_bytes()).hexdigest(), expected)
            self.assertNotEqual(self.call(SOURCE, output).returncode, 0)

    def test_rejects_other_source_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source', Path(directory) / 'new'
            data = bytearray(SOURCE.read_bytes()); data[0] ^= 1
            source.write_bytes(data)
            self.assertNotEqual(self.call(source, output).returncode, 0)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
