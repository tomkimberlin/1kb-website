"""Finite offline tests; synthetic raw metadata is not a live attestation."""
import copy
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stream_normalizer", HERE / "normalize-stream-phase.py")
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
REPO = HERE.parent if HERE.name == "tools" else HERE.parents[4]


def frame(stream, offset, size, kind):
    return {"streamId": stream, "frameType": kind, "offPresent": bool(kind & 4), "semanticOffset": offset,
            "offsetFieldBytes": 1 if kind & 4 else 0, "streamIdFieldBytes": 1,
            "lengthPresent": bool(kind & 2), "lengthFieldBytes": 1 if kind & 2 else 0,
            "dataBytes": size, "fin": bool(kind & 1)}


class NormalizerTests(unittest.TestCase):
    def setUp(self):
        self.image = "sha256:" + "b" * 64
        self.runtime_commit = "a" * 40
        self.page_commit = "c" * 40
        self.release = "releases/synthetic-page"
        self.now = datetime(2026, 10, 26, tzinfo=timezone.utc)
        frames = [frame(3, 0, 1, 10), frame(3, 1, 8, 14), frame(7, 0, 1, 8), frame(0, 0, 437, 9)]
        self.raw = {"schemaVersion": 1, "targetUrl": "https://tomkimberlin.com/", "protocol": "h3", "passed": True,
                    "startedAt": "2026-10-25T04:38:29.707038Z", "completedAt": "2026-10-25T04:38:29.849164Z",
                    "observationStoppedAt": "2026-10-25T04:38:29.761075Z", "normalCertificateValidation": True,
                    "freshConnection": True, "sourceSha256": n.FROZEN_OBSERVER,
                    "pythonVersion": n.VERSIONS["python"], "aioquicVersion": n.VERSIONS["aioquic"],
                    "pylsqpackVersion": n.VERSIONS["pylsqpack"], "cryptographyVersion": n.VERSIONS["cryptography"],
                    "certifiVersion": n.VERSIONS["certifi"], "aioquicSourceSha256": dict(n.MODULE_PINS),
                    "reusedSourceSha256": dict(n.REUSED_PINS), "firstAcceptedFrames": {role: copy.deepcopy(next(f for f in frames if f["streamId"] == stream)) for role, stream in n.ROLES.items()},
                    "acceptedRelevantFrames": frames, "allAcceptedStreamFrameCount": 4, "streamRolesVerified": True,
                    "handshake": {"alpn": "h3", "sessionResumed": False, "earlyDataAccepted": False},
                    "bodyBytes": 389, "bodySha256": n.BODY_SHA256, "statusCode": 200, "exactBrotliBody": True, "scope": n.SCOPE}
        self.before = self.make_readback()
        self.after = self.make_readback()
        # This normalizer deliberately validates the dated 389-byte snapshot.
        # Later copy edits must not replace its synthetic fixture's input page.
        fixture_commit = "56810bdae15d91b08fd0e37d2ddf707a6cb9cdfb"
        self.html = subprocess.check_output(["git", "show", fixture_commit + ":index.html"], cwd=REPO)
        self.body = subprocess.check_output(["git", "show", fixture_commit + ":compression/index.html.br"], cwd=REPO)
        self.reads = []

    def make_readback(self):
        return ("2026-10-25T04:38:29Z\nruntime " + self.image + " true\n" + n.OPENSSL + "\n" + self.release
                + "\nreleases/synthetic-tls\n2026-10-25T04:38:29Z\n").encode()

    def read_committed(self, commit, path):
        self.reads.append((commit, path))
        self.assertEqual(commit, self.page_commit)
        return {"index.html": self.html, "compression/index.html.br": self.body}[path]

    def run_normalize(self, raw_bytes=None, **overrides):
        args = dict(image=self.image, runtime_commit=self.runtime_commit, page_commit=self.page_commit,
                    page_release=self.release, read_committed=self.read_committed, now=self.now)
        args.update(overrides)
        return n.normalize(json.dumps(self.raw).encode() if raw_bytes is None else raw_bytes,
                           self.before, self.after, **args)

    def test_valid_phase_keeps_every_frame_and_only_public_keys(self):
        result = self.run_normalize()
        self.assertEqual(set(result), {"runtimeImageId", "runtimeSourceCommit", "pageCommitAtReadback", "pageReleaseAtReadback",
                                      "perRequestGenerationVerified", "privateRawSnapshotSha256", "runtimeReadbacks", "observer"} | set(n.PUBLIC_KEYS))
        self.assertEqual(result["acceptedRelevantFrames"], self.raw["acceptedRelevantFrames"])
        self.assertEqual(result["bodyBytes"], 389)
        self.assertEqual(result["acceptedRelevantFrames"][-1]["dataBytes"], 437)
        self.assertFalse(result["perRequestGenerationVerified"])
        self.assertEqual(result["runtimeReadbacks"]["precisionSeconds"], 1)
        self.assertEqual(self.reads, [(self.page_commit, "index.html"), (self.page_commit, "compression/index.html.br")])
        self.assertNotIn("scope", result)
        self.assertNotIn("deltas", result)

    def test_same_source_bytes_make_reproducible_output(self):
        self.assertEqual(json.dumps(self.run_normalize()), json.dumps(self.run_normalize()))

    def test_same_second_after_readback_is_a_coarse_valid_envelope(self):
        self.assertLess(n.instant(self.after.decode().splitlines()[0]), n.instant(self.raw["completedAt"]))
        self.run_normalize()

    def test_raw_mutations_fail(self):
        changes = {
            "unknown raw field": lambda r: r.update(remoteAddress="private"),
            "wrong observer": lambda r: r.update(sourceSha256="0" * 64),
            "wrong library": lambda r: r.update(pylsqpackVersion="0.3.23"),
            "wrong Python": lambda r: r.update(pythonVersion="3.14.8"),
            "wrong module hash": lambda r: r["aioquicSourceSha256"].update({"aioquic.quic.connection": "0" * 64}),
            "extra module": lambda r: r["aioquicSourceSha256"].update(private="0" * 64),
            "wrong reused helper": lambda r: r["reusedSourceSha256"].update({"tools/verify-http3.py": "0" * 64}),
            "fixture CA": lambda r: r.update(normalCertificateValidation=False),
            "resumed": lambda r: r["handshake"].update(sessionResumed=True),
            "early data": lambda r: r["handshake"].update(earlyDataAccepted=True),
            "handshake extra": lambda r: r["handshake"].update(secret="private"),
            "numeric false": lambda r: r["handshake"].update(sessionResumed=0),
            "wrong body size": lambda r: r.update(bodyBytes=388),
            "wrong body hash": lambda r: r.update(bodySha256="0" * 64),
            "future observation": lambda r: r.update(completedAt="2099-01-01T00:00:00Z"),
            "backward observation": lambda r: r.update(observationStoppedAt="2026-10-25T04:38:29.001Z"),
            "invalid day": lambda r: r.update(startedAt="2026-02-30T04:38:29Z"),
            "wrong zone": lambda r: r.update(startedAt="2026-10-25T04:38:29+00:00"),
            "private scope": lambda r: r.update(scope="private path /Users/example"),
            "bool schema": lambda r: r.update(schemaVersion=True),
            "bool count": lambda r: r.update(allAcceptedStreamFrameCount=True),
            "understated count": lambda r: r.update(allAcceptedStreamFrameCount=3),
            "oversized count": lambda r: r.update(allAcceptedStreamFrameCount=257),
            "private frame": lambda r: r["acceptedRelevantFrames"][0].update(payload="private"),
            "wrong role": lambda r: r["acceptedRelevantFrames"][0].update(streamId=4),
            "bool stream": lambda r: r["acceptedRelevantFrames"][0].update(streamId=True),
            "wrong OFF flag": lambda r: r["acceptedRelevantFrames"][0].update(offPresent=True),
            "bad width": lambda r: r["acceptedRelevantFrames"][0].update(lengthFieldBytes=3),
            "width too short": lambda r: r["acceptedRelevantFrames"][0].update(dataBytes=64),
            "nonzero implicit offset": lambda r: r["acceptedRelevantFrames"][0].update(semanticOffset=1),
            "missing role": lambda r: r["firstAcceptedFrames"].pop("response"),
            "crossed first role": lambda r: r["firstAcceptedFrames"]["response"].update(streamId=7),
        }
        for name, change in changes.items():
            with self.subTest(name=name):
                original = copy.deepcopy(self.raw)
                change(self.raw)
                with self.assertRaises((n.InvalidEvidence, ValueError, TypeError)):
                    self.run_normalize()
                self.raw = original

    def test_duplicate_keys_and_nan_fail(self):
        for data in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}', b'[]'):
            with self.subTest(data=data), self.assertRaises(n.InvalidEvidence):
                self.run_normalize(raw_bytes=data)

    def test_readback_mutations_fail(self):
        cases = [
            self.after.replace(b" true", b" false"),
            self.after.replace(self.image.encode(), ("sha256:" + "f" * 64).encode()),
            self.after.replace(self.release.encode(), b"releases/stale"),
            self.after.replace(b"OpenSSL 3.5.9", b"OpenSSL 3.5.8"),
            self.after.replace(b"releases/synthetic-tls", b"releases/changed-tls"),
            self.after.replace(b"releases/synthetic-tls", b"/private/tls"),
            self.after.replace(b"04:38:29Z", b"04:38:28Z"),
            self.after.replace(b"04:38:29Z", b"04:38:29.000Z"),
            self.after + b"unexpected\n",
        ]
        old = self.after
        for data in cases:
            with self.subTest(data=data):
                self.after = data
                with self.assertRaises(n.InvalidEvidence):
                    self.run_normalize()
        self.after = old

    def test_exact_next_second_is_outside_coarse_envelope(self):
        self.raw["completedAt"] = "2026-10-25T04:38:30Z"
        with self.assertRaises(n.InvalidEvidence):
            self.run_normalize()

    def test_committed_body_and_source_must_both_match(self):
        for path in ("index.html", "compression/index.html.br"):
            with self.subTest(path=path), self.assertRaises(n.InvalidEvidence):
                self.run_normalize(read_committed=lambda commit, requested: b"wrong" if requested == path else self.read_committed(commit, requested))

    def test_expected_identity_syntax_is_strict(self):
        for changed in ({"image": "latest"}, {"runtime_commit": "main"}, {"page_commit": "HEAD"}, {"page_release": "/private/release"}):
            with self.subTest(changed=changed), self.assertRaises(n.InvalidEvidence):
                self.run_normalize(**changed)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="onekb-normalizer-")
        self.root = Path(self.temp.name).resolve()
        self.out = self.root / "phase.json"

    def tearDown(self):
        self.temp.cleanup()

    def assert_no_temporary_files(self):
        self.assertEqual(list(self.root.glob(".stream-phase-*.tmp")), [])

    def test_complete_new_file_is_private(self):
        n.publish(self.out, b'{"complete":true}\n')
        self.assertEqual(self.out.read_bytes(), b'{"complete":true}\n')
        self.assertEqual(stat.S_IMODE(self.out.stat().st_mode), 0o600)
        self.assert_no_temporary_files()

    def test_existing_output_is_never_replaced(self):
        self.out.write_bytes(b"original")
        with self.assertRaises(FileExistsError):
            n.publish(self.out, b"new")
        self.assertEqual(self.out.read_bytes(), b"original")
        self.assert_no_temporary_files()

    def test_existing_hardlink_alias_is_never_modified(self):
        source = self.root / "raw.json"
        source.write_bytes(b"raw")
        os.link(source, self.out)
        with self.assertRaises(FileExistsError):
            n.publish(self.out, b"new")
        self.assertEqual(source.read_bytes(), b"raw")

    def test_dangling_symlink_output_is_refused(self):
        self.out.symlink_to(self.root / "absent")
        with self.assertRaises(FileExistsError):
            n.publish(self.out, b"new")
        self.assertTrue(self.out.is_symlink())
        self.assertFalse((self.root / "absent").exists())
        self.assert_no_temporary_files()

    def test_symlink_parent_is_refused(self):
        target = self.root / "real"
        target.mkdir()
        link = self.root / "link"
        link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(OSError):
            n.publish(link / "phase.json", b"new")
        self.assertFalse((target / "phase.json").exists())

    def test_parent_traversal_cannot_erase_a_symlink_component(self):
        target = self.root / "real"
        target.mkdir()
        link = self.root / "link"
        link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(n.InvalidEvidence):
            n.publish(link / ".." / "phase.json", b"new")
        self.assertFalse(self.out.exists())

    def test_fsync_failure_leaves_no_output_or_partial_file(self):
        with patch.object(n.os, "fsync", side_effect=OSError("injected failure")):
            with self.assertRaises(OSError):
                n.publish(self.out, b"new")
        self.assertFalse(self.out.exists())
        self.assert_no_temporary_files()

    def test_target_creation_race_cannot_overwrite(self):
        real_link = os.link
        def raced_link(*args, **kwargs):
            self.out.write_bytes(b"racer")
            return real_link(*args, **kwargs)
        with patch.object(n.os, "link", side_effect=raced_link):
            with self.assertRaises(FileExistsError):
                n.publish(self.out, b"new")
        self.assertEqual(self.out.read_bytes(), b"racer")
        self.assert_no_temporary_files()

    def test_regular_input_has_a_finite_size(self):
        self.out.write_bytes(b"12345")
        self.assertEqual(n.read_regular(self.out, 5), b"12345")
        with self.assertRaises(n.InvalidEvidence):
            n.read_regular(self.out, 4)

    def test_direct_input_reuse_is_rejected(self):
        source = self.root / "readback.txt"
        source.write_bytes(b"same")
        with self.assertRaises(n.InvalidEvidence):
            n.read_inputs([(source, 10), (source, 10)])

    def test_hardlink_input_reuse_is_rejected(self):
        source, alias = self.root / "readback.txt", self.root / "alias.txt"
        source.write_bytes(b"same")
        os.link(source, alias)
        with self.assertRaises(n.InvalidEvidence):
            n.read_inputs([(source, 10), (alias, 10)])

    def test_input_identity_uses_open_descriptors_and_holds_them_all(self):
        paths = [self.root / str(i) for i in range(3)]
        for path in paths:
            path.write_bytes(b"same")
        descriptors, real_fstat = [], os.fstat
        def checked_fstat(fd):
            for earlier in descriptors:
                real_fstat(earlier)  # Earlier inputs must still be open.
            descriptors.append(fd)
            return real_fstat(fd)
        with patch.object(n.os, "fstat", side_effect=checked_fstat), patch.object(Path, "stat", side_effect=AssertionError("Path.stat is not an identity check")):
            self.assertEqual(n.read_inputs([(path, 10) for path in paths]), [b"same"] * 3)
        for fd in descriptors:
            with self.assertRaises(OSError):
                real_fstat(fd)

    def cli_fixture(self):
        f = NormalizerTests()
        f.setUp()
        raw, before, after = self.root / "raw.json", self.root / "before.txt", self.root / "after.txt"
        raw.write_text(json.dumps(f.raw))
        before.write_bytes(f.before)
        after.write_bytes(f.after)
        return f, raw, before, after

    def run_cli(self, fixture, raw, before, after):
        args = ["normalize-stream-phase.py", "--repo", str(REPO), "--raw", str(raw),
                "--runtime-before", str(before), "--runtime-after", str(after),
                "--expected-image", fixture.image, "--runtime-commit", fixture.runtime_commit,
                "--page-commit", fixture.page_commit, "--page-release", fixture.release, "--out", str(self.out)]
        real_normalize = n.normalize
        with patch("sys.argv", args), patch("sys.stdout", io.StringIO()), patch.object(n, "git_reader", return_value=fixture.read_committed), \
                patch.object(n, "normalize", side_effect=lambda *a, **k: real_normalize(*a, **k, now=fixture.now)):
            n.main()

    def test_cli_rejects_same_readback_argument_without_output(self):
        f, raw, before, after = self.cli_fixture()
        with self.assertRaises(n.InvalidEvidence):
            self.run_cli(f, raw, before, before)
        self.assertFalse(self.out.exists())

    def test_cli_rejects_hardlinked_readbacks_without_output(self):
        f, raw, before, after = self.cli_fixture()
        after.unlink()
        os.link(before, after)
        with self.assertRaises(n.InvalidEvidence):
            self.run_cli(f, raw, before, after)
        self.assertFalse(self.out.exists())

    def test_cli_allows_independent_identical_readbacks(self):
        f, raw, before, after = self.cli_fixture()
        self.assertEqual(before.read_bytes(), after.read_bytes())
        self.run_cli(f, raw, before, after)
        result = json.loads(self.out.read_bytes())
        self.assertEqual(result["runtimeReadbacks"]["before"]["sha256"], result["runtimeReadbacks"]["after"]["sha256"])
        self.assertFalse(result["perRequestGenerationVerified"])

    def test_symlink_input_is_refused(self):
        source = self.root / "raw.json"
        source.write_bytes(b"raw")
        self.out.symlink_to(source)
        with self.assertRaises(OSError):
            n.read_regular(self.out, 10)

    def test_cli_validation_failure_creates_no_artifact(self):
        raw = self.root / "raw.json"
        before = self.root / "before.txt"
        after = self.root / "after.txt"
        raw.write_bytes(b"{}")
        before.write_bytes(b"not a readback")
        after.write_bytes(b"not a readback")
        args = ["normalize-stream-phase.py", "--repo", str(REPO), "--raw", str(raw),
                "--runtime-before", str(before), "--runtime-after", str(after),
                "--expected-image", "sha256:" + "b" * 64, "--runtime-commit", "a" * 40,
                "--page-commit", "c" * 40, "--page-release", "releases/synthetic", "--out", str(self.out)]
        with patch("sys.argv", args), patch.object(n, "git_reader", return_value=lambda c, p: b"unused"):
            with self.assertRaises(n.InvalidEvidence):
                n.main()
        self.assertFalse(self.out.exists())
        self.assert_no_temporary_files()


if __name__ == "__main__":
    unittest.main(verbosity=2)
