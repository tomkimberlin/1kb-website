"""Candidate publication regressions; no compiler, downloads or Zopfli needed."""
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from optimizer_output import exact_brotli, exact_gzip, publish_candidate, require_distinct_paths

ROOT = Path(__file__).resolve().parent.parent


class CandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = b'<!DOCTYPE html><title>Example</title><p>Small and readable. ' * 20
        cls.formats = [('gzip', exact_gzip,
                        gzip.compress(cls.source, compresslevel=9, mtime=0),
                        gzip.compress(cls.source, compresslevel=0, mtime=0),
                        gzip.compress(b'stale', mtime=0))]
        if shutil.which('node'):
            encoded = subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const source=readFileSync(0);
const encode=(data,quality)=>brotliCompressSync(data,{params:{[c.BROTLI_PARAM_QUALITY]:quality}}).toString('base64');
console.log(JSON.stringify([encode(source,11),encode(source,0),encode(Buffer.from('stale'),11)]));
'''], input=cls.source, check=True, stdout=subprocess.PIPE)
            cls.formats.append(('brotli', exact_brotli, *map(base64.b64decode, json.loads(encoded.stdout))))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.output = self.root / 'candidate'

    def tearDown(self):
        self.directory.cleanup()

    def test_keeps_smaller_exact_candidate_without_rewriting(self):
        for name, exact, small, large, _ in self.formats:
            with self.subTest(format=name):
                self.assertLess(len(small), len(large))
                self.output.write_bytes(small)
                before = self.output.stat()
                self.assertEqual(publish_candidate(self.source, large, self.output, exact), small)
                after = self.output.stat()
                self.assertEqual((after.st_ino, after.st_mtime_ns), (before.st_ino, before.st_mtime_ns))

    def test_replaces_larger_candidate(self):
        for name, exact, small, large, _ in self.formats:
            with self.subTest(format=name):
                self.output.write_bytes(large)
                self.assertEqual(publish_candidate(self.source, small, self.output, exact), small)
                self.assertEqual(self.output.read_bytes(), small)

    def test_replaces_stale_malformed_truncated_and_trailing_candidates(self):
        for name, exact, small, large, stale in self.formats:
            for kind, existing in [('stale', stale), ('malformed', b'\xff'),
                                   ('truncated', small[:-1]), ('trailing', small + b'\0')]:
                with self.subTest(format=name, kind=kind):
                    self.assertLess(len(existing), len(large))
                    self.output.write_bytes(existing)
                    publish_candidate(self.source, large, self.output, exact)
                    self.assertEqual(self.output.read_bytes(), large)

    def test_rejects_invalid_new_candidates_without_touching_output(self):
        for name, exact, small, _, stale in self.formats:
            for candidate in (b'\xff', stale, small[:-1], small + b'\0'):
                with self.subTest(format=name, candidate=candidate[:8]):
                    self.output.write_bytes(small)
                    with self.assertRaises(ValueError):
                        publish_candidate(self.source, candidate, self.output, exact)
                    self.assertEqual(self.output.read_bytes(), small)

    def test_failed_atomic_replace_preserves_output_and_removes_temporary_file(self):
        name, exact, small, large, _ = self.formats[0]
        self.output.write_bytes(large)
        with patch('optimizer_output.os.replace', side_effect=OSError('simulated publish failure')):
            with self.assertRaises(OSError):
                publish_candidate(self.source, small, self.output, exact)
        self.assertEqual(self.output.read_bytes(), large)
        self.assertEqual(list(self.root.iterdir()), [self.output])

    def test_gzip_rejects_extra_members_and_optional_headers(self):
        encoded = gzip.compress(self.source, mtime=0)
        self.assertFalse(exact_gzip(encoded + gzip.compress(b'', mtime=0), self.source))
        optional = encoded[:3] + b'\x08' + encoded[4:10] + b'name\0' + encoded[10:]
        self.assertEqual(gzip.decompress(optional), self.source)
        self.assertFalse(exact_gzip(optional, self.source))

    def test_distinct_paths_reject_aliases_to_source(self):
        source = self.root / 'source.html'
        source.write_bytes(self.source)
        symbolic = self.root / 'symbolic'
        symbolic.symlink_to(source)
        hard = self.root / 'hard'
        os.link(source, hard)
        for output in (source, self.root / '.' / source.name, symbolic, hard):
            with self.subTest(output=output):
                with self.assertRaises(ValueError):
                    require_distinct_paths(source, output)
        require_distinct_paths(source, self.output)

    def test_cli_rejects_same_file_before_encoding(self):
        source = self.root / 'source.html'
        source.write_bytes(self.source)
        symbolic = self.root / 'symbolic'
        symbolic.symlink_to(source)
        hard = self.root / 'hard'
        os.link(source, hard)
        for command in (['optimize-brotli.py'], ['optimize-gzip.py'], ['optimize-gzip.py', '--tuned']):
            for output in (source, symbolic, hard):
                with self.subTest(command=command, output=output):
                    result = subprocess.run([sys.executable, str(ROOT / command[0]), *command[1:], '--input', str(source),
                                             '--output', str(output)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn('must refer to different files', result.stderr)
                    self.assertEqual(source.read_bytes(), self.source)

    def test_tuned_gzip_rejects_unpinned_archive_without_touching_output(self):
        source = self.root / 'source.html'
        source.write_bytes(self.source)
        archive = self.root / 'unexpected.tar.gz'
        archive.write_bytes(b'not the pinned source archive')
        existing = gzip.compress(self.source, mtime=0)
        self.output.write_bytes(existing)
        result = subprocess.run([sys.executable, str(ROOT / 'optimize-gzip.py'), '--tuned',
                                 '--archive', str(archive), '--input', str(source),
                                 '--output', str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('source archive checksum mismatch', result.stderr)
        self.assertEqual(self.output.read_bytes(), existing)
        self.assertEqual(source.read_bytes(), self.source)

    def test_cli_rejects_archive_script_and_helper_aliases_before_encoding(self):
        tools = self.root / 'tools'
        tools.mkdir()
        helper = tools / 'optimizer_output.py'
        shutil.copyfile(ROOT / 'tools/optimizer_output.py', helper)
        source = self.root / 'source.html'
        source.write_bytes(self.source)
        archive = self.root / 'archive.tar.gz'
        archive.write_bytes(b'guard must run before checking this archive or compiling')
        for command in (['optimize-brotli.py'], ['optimize-gzip.py'], ['optimize-gzip.py', '--tuned']):
            script = self.root / command[0]
            shutil.copyfile(ROOT / command[0], script)
            protected = [script, helper]
            if command[0] == 'optimize-brotli.py' or '--tuned' in command:
                protected.append(archive)
            for original in protected:
                before = original.read_bytes()
                for kind in ('direct', 'symbolic', 'hard'):
                    output = original if kind == 'direct' else self.root / ('output-' + kind)
                    if kind == 'symbolic':
                        output.symlink_to(original)
                    elif kind == 'hard':
                        os.link(original, output)
                    try:
                        with self.subTest(command=command, protected=original.name, alias=kind):
                            arguments = ['--archive', str(archive)] if original == archive else []
                            result = subprocess.run([sys.executable, str(script), *command[1:],
                                '--input', str(source), '--output', str(output), *arguments],
                                capture_output=True, text=True)
                            self.assertEqual(result.returncode, 2)
                            self.assertIn('must refer to different files', result.stderr)
                            self.assertEqual(original.read_bytes(), before)
                    finally:
                        if kind != 'direct':
                            output.unlink(missing_ok=True)

    @unittest.skipUnless(hasattr(tarfile, 'data_filter'), 'Brotli patch fixtures require tarfile extraction filters (Python 3.12+)')
    def test_brotli_patch_checks_survive_optimized_python(self):
        # A tiny archive and locally adjusted checksum isolate patch matching;
        # the actual CLI retains the pinned upstream checksum unchanged.
        tools = self.root / 'tools'
        tools.mkdir()
        shutil.copyfile(ROOT / 'tools/optimizer_output.py', tools / 'optimizer_output.py')
        source = self.root / 'source.html'
        source.write_bytes(self.source)
        script = self.root / 'optimize-brotli.py'
        original = (ROOT / script.name).read_text()
        revision = '028fb5a23661f123017c060daa546b55cf4bde29'
        pinned_sha = '0afe09a53c8bad9861c8dd1fc1284308d54f19d2979ba3541cfdcc9b05fe360f'
        seed = 'FastLog2(20 + (uint32_t)i)'
        cost = '    *num_commands = orig_num_commands;'
        histogram = 'symbol == 0 && step >= 5'
        for missing in (seed, cost, histogram):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
                for name, text in (('backward_references_hq.c', seed + '\n' + cost),
                                   ('entropy_encode.c', histogram + '\n/ 3 + 420;\n/ 3 + 420;')):
                    data = text.replace(missing, 'unmatched fixture').encode()
                    info = tarfile.TarInfo(f'brotli-{revision}/c/enc/{name}')
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
            archive = self.root / 'fixture.tar.gz'
            archive.write_bytes(buffer.getvalue())
            script.write_text(original.replace(pinned_sha, hashlib.sha256(buffer.getvalue()).hexdigest()))
            for mode in ([], ['-O']):
                with self.subTest(missing=missing, mode=mode):
                    result = subprocess.run([sys.executable, *mode, str(script), '--input', str(source),
                        '--archive', str(archive), '--output', str(self.output)],
                        env={**os.environ, 'CC': 'compiler-must-not-run'}, capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Pinned Brotli source does not match', result.stderr)
                    self.assertNotIn('compiler-must-not-run', result.stderr)
                    self.assertFalse(self.output.exists())

    def test_gzip_cli_rejects_unused_archive_and_unrepresentable_iterations(self):
        for arguments, message in ((['--archive', 'unused.tar.gz'], '--archive requires --tuned'),
                                   (['--iterations', '0'], '--iterations must be between'),
                                   (['--tuned', '--iterations', '4294967297'], '--iterations must be between')):
            with self.subTest(arguments=arguments):
                result = subprocess.run([sys.executable, str(ROOT / 'optimize-gzip.py'), *arguments],
                                         capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)


if __name__ == '__main__':
    unittest.main()
