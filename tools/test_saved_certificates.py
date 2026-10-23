"""Validate the saved public Certificate encodings with an independent decoder."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

import brotli

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'compression/certificates'
SAVED = {
    '06775c21de30195f66bf5f991e73fe3b5ab59c3195b46f620ee5b1119701e0d7':
        ('ffe8ca224aa655579e8fc472bfa3b818dfdb0d441f5637eb192a83cc523ec0fe',
         '3f1093a5a46aaeee1412726722b74b4865dd80885af7144941879d0917aa7ebc'),
    '10d003a9fcefe2199c69d4a16f8916b3343947c88c83f254afbd558f5810b91f':
        ('90f2fbfce98994ffeba62aacf34c679c33302332ce1ee1ae89826928bde6f4c9',
         'e8006a8face2291325914cdb63461e389e7aba77032398460882ef84c25d5a89'),
}
spec = importlib.util.spec_from_file_location('certificate_optimizer', ROOT / 'tools/optimize-certificates.py')
optimizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(optimizer)


def decode_complete(encoded, expected_length):
    decoder = brotli.Decompressor()
    decoded = bytearray()
    for byte in encoded:
        if decoder.is_finished():
            raise ValueError('Trailing Brotli input')
        decoded.extend(decoder.process(bytes([byte])))
        if len(decoded) > expected_length:
            raise ValueError('Decoded Certificate exceeds its recorded size')
    if not decoder.is_finished() or len(decoded) != expected_length:
        raise ValueError('Incomplete Certificate encoding')
    return bytes(decoded)


class SavedCertificateTests(unittest.TestCase):
    def test_exact_saved_streams_and_provenance(self):
        self.assertEqual({p.stem for p in CACHE.glob('*.br')}, set(SAVED))
        self.assertEqual({p.stem for p in CACHE.glob('*.json')}, set(SAVED))
        for identity, (encoded_hash, metadata_hash) in SAVED.items():
            with self.subTest(input=identity):
                encoded = (CACHE / (identity + '.br')).read_bytes()
                metadata_bytes = (CACHE / (identity + '.json')).read_bytes()
                metadata = json.loads(metadata_bytes)
                self.assertEqual(hashlib.sha256(encoded).hexdigest(), encoded_hash)
                self.assertEqual(hashlib.sha256(metadata_bytes).hexdigest(), metadata_hash)
                self.assertEqual(metadata['brotliSha256'], encoded_hash)
                self.assertEqual(metadata['brotliBytes'], len(encoded))
                decoded = decode_complete(encoded, metadata['inputBytes'])
                self.assertEqual(hashlib.sha256(decoded).hexdigest(), identity)
                self.assertEqual(metadata['inputSha256'], identity)
                self.assertEqual(metadata['inputFormat'], 'TLS 1.3 Certificate body')
                self.assertEqual(optimizer.validate_body(decoded), metadata['certificates'])

    def test_truncated_or_trailing_saved_streams_are_rejected(self):
        for identity in SAVED:
            encoded = (CACHE / (identity + '.br')).read_bytes()
            metadata = json.loads((CACHE / (identity + '.json')).read_text())
            for invalid in (encoded[:-1], encoded + b'\0'):
                with self.subTest(input=identity, bytes=len(invalid)):
                    with self.assertRaises((ValueError, brotli.error)):
                        decode_complete(invalid, metadata['inputBytes'])


if __name__ == '__main__':
    unittest.main()
