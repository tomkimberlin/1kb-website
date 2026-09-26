"""Report destination preflights; no network traffic or writes to source files."""
import importlib.util
import io
import os
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from unittest.mock import patch
from probe_response import require_report_outputs

TOOLS = Path(__file__).resolve().parent


class OutputTests(unittest.TestCase):
    def test_multiple_reports_reject_aliases_links_and_nonfiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'input'; source.write_bytes(b'keep input')
            first = root / 'first'; first.write_bytes(b'keep report')
            hard = root / 'hard'; os.link(first, hard)
            link = root / 'link'; link.symlink_to(root / 'missing')
            folder = root / 'directory'; folder.mkdir()
            cases = [([source], [source]), ([first, hard], []), ([first, first], []),
                     ([link], []), ([folder], [])]
            for outputs, inputs in cases:
                with self.subTest(outputs=outputs), self.assertRaises(ValueError):
                    require_report_outputs(outputs, inputs)
            self.assertEqual(source.read_bytes(), b'keep input')
            self.assertEqual(first.read_bytes(), b'keep report')
            require_report_outputs([root / 'new.json', root / 'new.html'], [source])

    def check_cli(self, script, protected, arguments):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ('direct', 'symbolic', 'hard'):
                output = protected if kind == 'direct' else root / kind
                if kind == 'symbolic': output.symlink_to(protected)
                if kind == 'hard': os.link(protected, output)
                before = protected.read_bytes()
                argv = [str(script), *arguments, *([str(output)] if script.name == 'measure-dns.py' else ['--out', str(output)])]
                with self.subTest(script=script.name, protected=protected.name, alias=kind), \
                     patch('sys.argv', argv), patch('sys.stderr', new_callable=io.StringIO), \
                     patch('socket.socket') as network, patch('ssl.create_default_context') as tls:
                    with self.assertRaises(SystemExit) as failure:
                        runpy.run_path(str(script), run_name='__main__')
                    self.assertEqual(failure.exception.code, 2)
                    network.assert_not_called(); tls.assert_not_called()
                self.assertEqual(protected.read_bytes(), before)

    def test_dns_guards_script_and_both_helpers_before_requests(self):
        for name in ['measure-dns.py', 'dns_measurement.py', 'probe_response.py']:
            self.check_cli(TOOLS / 'measure-dns.py', TOOLS / name, ['example.com'])

    @unittest.skipUnless(importlib.util.find_spec('h2'), 'Install tools/requirements.txt')
    def test_buffering_guards_compare_ca_script_helper_and_fixtures_before_tls(self):
        for name in ['verify-response-buffering.py', 'probe_response.py',
                     'fixtures/response-buffering.js', 'fixtures/response-buffering.conf']:
            self.check_cli(TOOLS / 'verify-response-buffering.py', TOOLS / name, [])
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input'; source.write_bytes(b'preserve input')
            for flag in ['--compare', '--ca']:
                self.check_cli(TOOLS / 'verify-response-buffering.py', source, [flag, str(source)])


if __name__ == '__main__':
    unittest.main()
