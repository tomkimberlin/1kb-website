"""Exercise DNS maintenance lock failures without credentials or network access."""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
BASH = shutil.which('bash')


class DnsLockTests(unittest.TestCase):
    def run_script(self, lock_status, credential=True):
        with tempfile.TemporaryDirectory(prefix='onekb-dns-lock-') as temporary:
            root = Path(temporary)
            (root / 'state').mkdir()
            (root / 'bin').mkdir()
            marker = root / 'unexpected-access'
            if credential:
                (root / 'secrets').mkdir()
                (root / 'secrets/cloudflare-dns-token').write_text('fixture-only')
            for name in ['stat', 'cat', 'curl']:
                command = root / 'bin' / name
                command.write_text('#!/bin/sh\nprintf accessed > ' + shlex.quote(str(marker)) + '\nexit 99\n')
                command.chmod(0o755)
            if lock_status is not None:
                command = root / 'bin/flock'
                command.write_text('#!/bin/sh\nexit ' + str(lock_status) + '\n')
                command.chmod(0o755)
            source = (REPO / 'server/update-dns.sh').read_text()
            binding = 'base=/mnt/user/appdata/onekb-website'
            self.assertEqual(source.count(binding), 1)
            script = root / 'update-dns.sh'
            script.write_text(source.replace(binding, 'base=' + shlex.quote(str(root))))
            environment = os.environ.copy()
            environment['PATH'] = str(root / 'bin')
            result = subprocess.run([BASH, str(script)], env=environment,
                                    capture_output=True, text=True, timeout=5)
            self.assertFalse(marker.exists(), 'Lock handling must precede token or network access')
            self.assertEqual(result.stdout, '')
            return result

    def test_contention_is_a_quiet_success(self):
        result = self.run_script(1)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, '')

    def test_operational_lock_errors_are_reported_and_preserved(self):
        for status in [64, 73]:
            with self.subTest(status=status):
                result = self.run_script(status)
                self.assertEqual(result.returncode, status)
                self.assertIn('DNS update lock failed (exit ' + str(status) + ').', result.stderr)

    def test_missing_flock_is_an_error(self):
        result = self.run_script(None)
        self.assertEqual(result.returncode, 127)
        self.assertIn('DNS update lock failed (exit 127).', result.stderr)

    def test_acquired_lock_continues_to_credential_validation(self):
        result = self.run_script(0, credential=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn('DNS token is unavailable.', result.stderr)
        self.assertNotIn('lock failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
