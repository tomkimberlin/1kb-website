"""Certificate optimizer publication and provenance checks without native compilation."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('certificate_optimizer', ROOT / 'tools/optimize-certificates.py')
optimizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(optimizer)


class CertificateOptimizerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.library = self.root / 'encoder.so'
        self.library.write_bytes(b'fixture library')
        self.source = optimizer.pem_body(ROOT / 'tools/fixtures/certificate-cache.pem')
        self.identity = hashlib.sha256(self.source).hexdigest()
        self.output = self.root / (self.identity + '.br')
        self.metadata = {'inputFormat': 'TLS 1.3 Certificate body', 'inputSha256': self.identity,
                         'inputBytes': len(self.source), 'certificates': optimizer.validate_body(self.source),
                         **optimizer.encoder_provenance(self.library)}
        self.small, self.large = b'valid-small', b'valid-larger-encoding'

    def decode(self, data, source, library):
        # Publication tests isolate filesystem/provenance decisions. Real
        # native decode round trips are exercised by the optional encoder.
        self.assertEqual(source, self.source)
        if data not in (self.small, self.large):
            raise RuntimeError('invalid, stale or trailing encoded bytes')

    def publish(self, candidate=None):
        with patch.object(optimizer, 'decode_exact', side_effect=self.decode):
            return optimizer.publish_encoded(self.source, candidate or self.large,
                                             self.output, self.metadata, object())

    def manifest(self):
        return self.output.with_suffix('.json')

    def complete_metadata(self, encoded, **changes):
        return {**self.metadata, 'brotliSha256': hashlib.sha256(encoded).hexdigest(),
                'brotliBytes': len(encoded), **changes}

    def test_public_pem_and_raw_body_validation(self):
        self.assertEqual(optimizer.validate_body(self.source), 3)
        self.assertEqual(self.source[0], 0)
        for body in (b'', b'\0\0', self.source[:-1], self.source + b'\0'):
            with self.subTest(body=body[:4]), self.assertRaises(ValueError):
                optimizer.validate_body(body)
        private = self.root / 'private.pem'
        private.write_text((ROOT / 'tools/fixtures/certificate-cache.pem').read_text() +
                           '\n-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n')
        with self.assertRaisesRegex(ValueError, 'Private-key PEM'):
            optimizer.pem_body(private)

    def first_der(self):
        length = int.from_bytes(self.source[4:7], 'big')
        return self.source[7:7+length]

    def test_der_requires_exact_outer_sequence_boundaries(self):
        der = self.first_der()
        optimizer.validate_der(der)
        for invalid in (b'', b'\x30', b'\x30\x82\x01', b'\x31' + der[1:],
                        der[:-1], der + b'\0', der + b'public trailing marker'):
            with self.subTest(input_bytes=len(invalid)), self.assertRaisesRegex(ValueError, 'complete DER SEQUENCE'):
                optimizer.validate_der(invalid)

    def test_der_rejects_indefinite_and_nonminimal_outer_lengths(self):
        der = self.first_der()
        count = der[1] & 0x7f
        self.assertTrue(der[1] & 0x80)
        content = der[2+count:]
        for invalid in (b'\x30\x80' + content + b'\0\0',
                        bytes([0x30, 0x80 + count + 1, 0]) + der[2:],
                        b'\x30\x81\x03\x02\x01\x01'):
            with self.subTest(prefix=invalid[:5]), self.assertRaisesRegex(ValueError, 'minimal definite length'):
                optimizer.validate_der(invalid)

    def test_pem_and_raw_entries_reject_bytes_after_the_der_certificate(self):
        der = self.first_der() + b'public trailing marker'
        pem = self.root / 'trailing.pem'
        pem.write_text(ssl.DER_cert_to_PEM_cert(der))
        with self.assertRaisesRegex(ValueError, 'complete DER SEQUENCE'):
            optimizer.pem_body(pem)
        entry = len(der).to_bytes(3, 'big') + der + b'\0\0'
        body = b'\0' + len(entry).to_bytes(3, 'big') + entry
        with self.assertRaisesRegex(ValueError, 'complete DER SEQUENCE'):
            optimizer.validate_body(body)

    def test_smaller_exact_encoding_and_its_metadata_are_not_rewritten(self):
        self.output.write_bytes(self.small)
        previous = self.complete_metadata(self.small, encoderSha256='earlier-encoder', model={'earlier': True})
        self.manifest().write_text(json.dumps(previous))
        before = [path.stat().st_mtime_ns for path in (self.output, self.manifest())]
        selected, metadata, retained = self.publish()
        self.assertEqual(selected, self.small)
        self.assertTrue(retained)
        self.assertEqual(metadata, previous)
        self.assertEqual([path.stat().st_mtime_ns for path in (self.output, self.manifest())], before)

    def test_retained_candidate_without_matching_metadata_does_not_get_current_recipe(self):
        for content in (None, 'not json', json.dumps(self.complete_metadata(self.large))):
            with self.subTest(content=content):
                self.output.write_bytes(self.small)
                self.manifest().unlink(missing_ok=True)
                if content is not None:
                    self.manifest().write_text(content)
                _, metadata, retained = self.publish()
                self.assertTrue(retained)
                self.assertNotIn('model', metadata)
                self.assertNotIn('encoderSha256', metadata)
                self.assertIn('Unknown', metadata['encoderProvenance'])
                self.assertEqual(metadata['brotliSha256'], hashlib.sha256(self.small).hexdigest())

    def test_identical_reproduced_candidate_can_record_current_provenance(self):
        self.output.write_bytes(self.large)
        before = self.output.stat().st_mtime_ns
        _, metadata, retained = self.publish()
        self.assertTrue(retained)
        self.assertEqual(self.output.stat().st_mtime_ns, before)
        self.assertEqual(metadata['model'], optimizer.MODEL)

    def test_larger_invalid_stale_and_trailing_existing_candidates_are_replaced(self):
        for existing in (self.large, b'bad', b'stale', self.small + b'\0'):
            with self.subTest(existing=existing):
                self.output.write_bytes(existing)
                selected, metadata, retained = self.publish(self.small)
                self.assertFalse(retained)
                self.assertEqual(selected, self.small)
                self.assertEqual(self.output.read_bytes(), self.small)
                self.assertEqual(metadata, json.loads(self.manifest().read_text()))

    def test_invalid_new_candidate_never_changes_saved_output_or_metadata(self):
        self.output.write_bytes(self.small)
        self.manifest().write_text('existing metadata')
        with self.assertRaises(RuntimeError):
            self.publish(b'invalid')
        self.assertEqual(self.output.read_bytes(), self.small)
        self.assertEqual(self.manifest().read_text(), 'existing metadata')

    def test_failed_atomic_write_preserves_destination_and_cleans_temporary_file(self):
        self.output.write_bytes(self.small)
        before = set(self.root.iterdir())
        with patch.object(optimizer.os, 'replace', side_effect=OSError('simulated failure')):
            with self.assertRaises(OSError):
                optimizer.atomic_write(self.output, self.large)
        self.assertEqual(self.output.read_bytes(), self.small)
        self.assertEqual(set(self.root.iterdir()), before)

    def test_encoder_requires_matching_library_and_recipe_manifest(self):
        manifest = Path(str(self.library) + '.json')
        with self.assertRaisesRegex(ValueError, 'Missing or invalid encoder manifest'):
            optimizer.load_encoder_provenance(self.library)
        good = optimizer.encoder_provenance(self.library)
        manifest.write_text(json.dumps(good))
        self.assertEqual(optimizer.load_encoder_provenance(self.library), good)
        for bad in ({**good, 'encoderSha256': 'wrong'}, {**good, 'model': {}}, [], {'params': good['params']}):
            with self.subTest(bad=bad):
                manifest.write_text(json.dumps(bad))
                with self.assertRaisesRegex(ValueError, 'checksum or pinned recipe'):
                    optimizer.load_encoder_provenance(self.library)
        manifest.write_text(json.dumps(good))
        self.library.write_bytes(b'a different encoder')
        with self.assertRaisesRegex(ValueError, 'checksum or pinned recipe'):
            optimizer.load_encoder_provenance(self.library)

    def test_output_guards_cover_direct_symbolic_hardlink_and_output_collisions(self):
        symbolic, hard = self.root / 'symbolic', self.root / 'hard'
        symbolic.symlink_to(self.library)
        os.link(self.library, hard)
        for path in (self.library, symbolic, hard):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'aliases an input'):
                optimizer.require_distinct_outputs([path], [self.library])
        with self.assertRaisesRegex(ValueError, 'another output'):
            optimizer.require_distinct_outputs([self.output, self.output], [])

    def test_cli_rejects_build_library_and_sidecar_aliases_before_compilation(self):
        source = self.root / 'body'
        source.write_bytes(self.source)
        archive = self.root / 'archive.tar.gz'
        archive.write_bytes(b'archive fixture')
        cases = [([str(source), '--build-encoder', str(source)], source),
                 (['--archive', str(archive), '--build-encoder', str(archive)], archive),
                 ([str(source), '--build-encoder', str(self.output), '--output', str(self.root)], self.output),
                 ([str(source), '--build-encoder', str(self.root / self.identity), '--output', str(self.root)], self.manifest())]
        for arguments, output in cases:
            with self.subTest(arguments=arguments), patch.object(sys, 'argv', ['optimizer', *arguments]), \
                 patch.object(optimizer, 'build_encoder') as build:
                before = source.read_bytes(), archive.read_bytes()
                with self.assertRaisesRegex(ValueError, 'aliases an input or another output'):
                    optimizer.main()
                build.assert_not_called()
                self.assertEqual((source.read_bytes(), archive.read_bytes()), before)

    def test_cli_rejects_hash_named_input_and_encoder_as_output(self):
        for name in (self.identity + '.br', self.identity + '.json'):
            source = self.root / name
            source.write_bytes(self.source)
            with self.subTest(name=name), patch.object(sys, 'argv', ['optimizer', str(source), '--output', str(self.root)]), \
                 patch.object(optimizer, 'build_encoder') as build:
                with self.assertRaisesRegex(ValueError, 'aliases an input'):
                    optimizer.main()
                build.assert_not_called()
                self.assertEqual(source.read_bytes(), self.source)
            source.unlink()
        source = self.root / 'body'
        source.write_bytes(self.source)
        self.output.write_bytes(b'library fixture')
        with patch.object(sys, 'argv', ['optimizer', str(source), '--encoder', str(self.output), '--output', str(self.root)]):
            with self.assertRaisesRegex(ValueError, 'aliases an input'):
                optimizer.main()
        self.assertEqual(self.output.read_bytes(), b'library fixture')

    def test_prebuilt_cli_does_not_compile_or_download(self):
        source = self.root / 'body'
        source.write_bytes(self.source)
        Path(str(self.library) + '.json').write_text(json.dumps(optimizer.encoder_provenance(self.library)))
        captured = io.StringIO()
        with patch.object(sys, 'argv', ['optimizer', str(source), '--encoder', str(self.library), '--output', str(self.root)]), \
             patch.object(optimizer, 'build_encoder') as build, \
             patch.object(optimizer.urllib.request, 'urlopen') as download, \
             patch.object(optimizer, 'encode', return_value=self.small), \
             patch.object(optimizer, 'decode_exact', side_effect=self.decode), \
             patch.object(optimizer.c, 'CDLL', return_value=object()), redirect_stdout(captured):
            optimizer.main()
        build.assert_not_called()
        download.assert_not_called()
        self.assertEqual(self.output.read_bytes(), self.small)
        self.assertFalse(json.loads(captured.getvalue())['retainedExisting'])


if __name__ == '__main__':
    unittest.main()
