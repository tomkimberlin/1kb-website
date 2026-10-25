"""Normalize one saved, normally trusted STREAM observation; never run a probe."""
import argparse
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess

FROZEN_OBSERVER = "297e152798685065bb02b0b3d55685e8fa8840dff39e5ad8a3c0e18e1be489c0"
BODY_SHA256 = "ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e"
HTML_SHA256 = "aa9d6af64c9dbc06da71361f34da43c1d9ea40e725de70daa8ffcd9c165069d9"
VERSIONS = {"python": "3.13.16", "aioquic": "1.3.0", "pylsqpack": "0.3.24", "cryptography": "50.0.2", "certifi": "2026.10.19"}
MODULE_PINS = {
    "aioquic.quic.connection": "f6d0bd15ea563a3bd68518e3d4a6b918f4c9341048f850b27aa582f3a63fab65",
    "aioquic.asyncio.client": "5159d2e28bd33da386c59dbac99dbb35ee47ecf4b480596367299c5ec03dd1c9",
    "aioquic.h3.connection": "696e9c3735de11c314b8cd1e7e1265761a9373d1bbd2dbdf66570961dac839cd",
}
REUSED_PINS = {
    "tools/verify-http3.py": "07c4f5f1d1fe1ce3768c1b3599182b2ad2b24f5b61ba5a8235fcd3fd74ce03e9",
    "tools/probe_response.py": "e16a4fba43ee63f94cedcdb16b8e76bba53544109b55e275872883e31ab07eaa",
}
ROLES = {"control": 3, "qpackDecoder": 7, "response": 0}
ROW_KEYS = {"streamId", "frameType", "offPresent", "semanticOffset", "offsetFieldBytes", "streamIdFieldBytes", "lengthPresent", "lengthFieldBytes", "dataBytes", "fin"}
PUBLIC_KEYS = ("passed", "startedAt", "observationStoppedAt", "completedAt", "normalCertificateValidation", "freshConnection", "handshake", "statusCode", "exactBrotliBody", "bodyBytes", "bodySha256", "streamRolesVerified", "firstAcceptedFrames", "acceptedRelevantFrames", "allAcceptedStreamFrameCount")
RAW_KEYS = set(PUBLIC_KEYS) | {"schemaVersion", "targetUrl", "protocol", "sourceSha256", "aioquicVersion", "pylsqpackVersion", "pythonVersion", "cryptographyVersion", "certifiVersion", "aioquicSourceSha256", "reusedSourceSha256", "scope"}
SCOPE = "Received STREAM header components through the first exact document response, before connection close. First accepted observation per stream, not first-sent ordering; retransmission, loss and reordering can affect observation order. OFF is decoded from the actual dispatched frame type, with its offset-field width measured before the original handler accepts the frame. No datagram totals, raw payload, endpoints, TLS secrets, settings changes, transfer-saving or latency claims."
OPENSSL = "OpenSSL 3.5.9 29 Sep 2026 (Library: OpenSSL 3.5.9 29 Sep 2026)"


class InvalidEvidence(ValueError):
    pass


def need(condition):
    if not condition:
        raise InvalidEvidence("E_STREAM_PHASE")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def instant(value, seconds=False):
    pattern = r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ" if seconds else r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z"
    need(isinstance(value, str) and re.fullmatch(pattern, value) is not None)
    result = datetime.fromisoformat(value[:-1] + "+00:00")
    need(result.isoformat(timespec="seconds")[:19] == value[:19])
    return result


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result)
        result[key] = value
    return result


def parse_raw(data):
    need(len(data) <= 262144)
    return json.loads(data.decode("utf-8"), object_pairs_hook=no_duplicate_keys,
                      parse_constant=lambda _: (_ for _ in ()).throw(InvalidEvidence("E_STREAM_PHASE")))


def fits(value, width):
    return integer(value) and type(width) is int and width in (1, 2, 4, 8) and value < 1 << (width * 8 - 2)


def validate_raw(raw, now):
    need(type(raw) is dict and set(raw) == RAW_KEYS)
    need(type(raw["schemaVersion"]) is int and raw["schemaVersion"] == 1
         and raw["targetUrl"] == "https://tomkimberlin.com/" and raw["protocol"] == "h3"
         and raw["scope"] == SCOPE and raw["sourceSha256"] == FROZEN_OBSERVER)
    for key in ("passed", "normalCertificateValidation", "freshConnection", "streamRolesVerified", "exactBrotliBody"):
        need(raw[key] is True)
    handshake = raw["handshake"]
    need(type(handshake) is dict and set(handshake) == {"alpn", "sessionResumed", "earlyDataAccepted"}
         and handshake["alpn"] == "h3" and handshake["sessionResumed"] is False and handshake["earlyDataAccepted"] is False)
    need(type(raw["statusCode"]) is int and raw["statusCode"] == 200
         and type(raw["bodyBytes"]) is int and raw["bodyBytes"] == 389 and raw["bodySha256"] == BODY_SHA256)
    versions = {key: raw[field] for key, field in (("python", "pythonVersion"), ("aioquic", "aioquicVersion"),
                ("pylsqpack", "pylsqpackVersion"), ("cryptography", "cryptographyVersion"), ("certifi", "certifiVersion"))}
    need(versions == VERSIONS and raw["aioquicSourceSha256"] == MODULE_PINS and raw["reusedSourceSha256"] == REUSED_PINS)
    need(instant(raw["startedAt"]) <= instant(raw["observationStoppedAt"]) <= instant(raw["completedAt"]) <= now)
    frames = raw["acceptedRelevantFrames"]
    need(type(frames) is list and 3 <= len(frames) <= 256)
    for frame in frames:
        need(type(frame) is dict and set(frame) == ROW_KEYS and integer(frame["streamId"]) and frame["streamId"] in ROLES.values()
             and type(frame["frameType"]) is int and 8 <= frame["frameType"] <= 15)
        for key, mask in (("offPresent", 4), ("lengthPresent", 2), ("fin", 1)):
            need(type(frame[key]) is bool and frame[key] == bool(frame["frameType"] & mask))
        need(integer(frame["semanticOffset"]) and frame["semanticOffset"] <= 0x7fffffff
             and integer(frame["dataBytes"]) and frame["dataBytes"] <= 1 << 20
             and fits(frame["streamId"], frame["streamIdFieldBytes"]))
        need(fits(frame["dataBytes"], frame["lengthFieldBytes"]) if frame["lengthPresent"]
             else type(frame["lengthFieldBytes"]) is int and frame["lengthFieldBytes"] == 0)
        need(fits(frame["semanticOffset"], frame["offsetFieldBytes"]) if frame["offPresent"]
             else type(frame["offsetFieldBytes"]) is int and frame["offsetFieldBytes"] == 0 and frame["semanticOffset"] == 0)
    need(type(raw["firstAcceptedFrames"]) is dict and set(raw["firstAcceptedFrames"]) == set(ROLES)
         and type(raw["allAcceptedStreamFrameCount"]) is int and len(frames) <= raw["allAcceptedStreamFrameCount"] <= 256)
    for role, stream in ROLES.items():
        first = next((f for f in frames if f["streamId"] == stream), None)
        need(first is not None and raw["firstAcceptedFrames"][role] == first and first["semanticOffset"] == 0)
    return {"sourceSha256": FROZEN_OBSERVER, "versions": versions,
            "aioquicSourceSha256": dict(MODULE_PINS), "reusedSourceSha256": dict(REUSED_PINS)}


def readback(data, image, release, now):
    need(len(data) <= 16384)
    rows = data.decode("utf-8").splitlines()
    need(len(rows) == 6 and rows[1] == "runtime " + image + " true" and rows[2] == OPENSSL
         and rows[3] == release and re.fullmatch(r"releases/[A-Za-z0-9._-]+", rows[4]) is not None)
    need(instant(rows[0], seconds=True) <= instant(rows[5], seconds=True) <= now)
    return {"startedAt": rows[0], "completedAt": rows[5], "sha256": sha(data)}, rows[4]


def normalize(raw_bytes, before_bytes, after_bytes, *, image, runtime_commit, page_commit, page_release, read_committed, now=None):
    need(re.fullmatch(r"sha256:[0-9a-f]{64}", image) is not None
         and re.fullmatch(r"[0-9a-f]{40}", runtime_commit) is not None and re.fullmatch(r"[0-9a-f]{40}", page_commit) is not None
         and re.fullmatch(r"releases/[A-Za-z0-9._-]+", page_release) is not None)
    now = now or datetime.now(timezone.utc)
    raw = parse_raw(raw_bytes)
    identity = validate_raw(raw, now)
    before, before_tls = readback(before_bytes, image, page_release, now)
    after, after_tls = readback(after_bytes, image, page_release, now)
    # A whole-second host timestamp denotes [t,t+1s), not a fractional attestation.
    need(before_tls == after_tls and instant(before["completedAt"]) <= instant(raw["startedAt"])
         and instant(before["completedAt"]) <= instant(after["startedAt"])
         and instant(raw["completedAt"]) < instant(after["startedAt"]) + timedelta(seconds=1))
    html = read_committed(page_commit, "index.html")
    body = read_committed(page_commit, "compression/index.html.br")
    need(len(html) == 1021 and sha(html) == HTML_SHA256 and len(body) == 389 and sha(body) == BODY_SHA256)
    return {"runtimeImageId": image, "runtimeSourceCommit": runtime_commit,
            "pageCommitAtReadback": page_commit, "pageReleaseAtReadback": page_release,
            "perRequestGenerationVerified": False, "privateRawSnapshotSha256": sha(raw_bytes),
            "runtimeReadbacks": {"precisionSeconds": 1, "before": before, "after": after}, "observer": identity,
            **{key: raw[key] for key in PUBLIC_KEYS}}


def absolute_path(path):
    # Reject parent traversal before abspath could erase a symlink/.. component.
    need(".." not in Path(path).parts)
    return Path(os.path.abspath(path))


def directory_fd(path):
    """Open a real directory component by component, refusing symlink ancestors."""
    absolute = absolute_path(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(absolute.anchor, flags)
    try:
        for part in absolute.parts[1:]:
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_inputs(specifications):
    """Hold all input files open while rejecting repeated descriptor identities."""
    result, identities = [], set()
    with ExitStack() as opened:
        for path, limit in specifications:
            path = absolute_path(path)
            parent = directory_fd(path.parent)
            try:
                fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            finally:
                os.close(parent)
            source = opened.enter_context(os.fdopen(fd, "rb"))
            info = os.fstat(source.fileno())
            need(stat.S_ISREG(info.st_mode) and info.st_size <= limit)
            identity = (info.st_dev, info.st_ino)
            need(identity not in identities)
            identities.add(identity)
            data = source.read(limit + 1)
            need(len(data) <= limit)
            result.append(data)
    return result


def read_regular(path, limit):
    return read_inputs([(path, limit)])[0]


def publish(path, data):
    """Create a complete 0600 output atomically, refusing every existing target."""
    path = absolute_path(path)
    parent = directory_fd(path.parent)
    temporary = ".stream-phase-" + secrets.token_hex(16) + ".tmp"
    created = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        created = True
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        # Unlike replace/rename, linking never overwrites a file, alias or symlink.
        os.link(temporary, path.name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
    finally:
        if created:
            try:
                os.unlink(temporary, dir_fd=parent)
            except FileNotFoundError:
                pass
        os.close(parent)


def git_reader(repo, commits):
    for commit in set(commits):
        subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"], cwd=repo, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    def read(commit, path):
        need(commit in commits and path in ("index.html", "compression/index.html.br"))
        return subprocess.check_output(["git", "cat-file", "blob", commit + ":" + path], cwd=repo, stderr=subprocess.DEVNULL, timeout=15)
    return read


def main():
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise InvalidEvidence("E_ARGUMENTS")
    parser = Parser(description=__doc__)
    for flag in ("repo", "raw", "runtime-before", "runtime-after", "expected-image", "runtime-commit", "page-commit", "page-release", "out"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args()
    need(re.fullmatch(r"[0-9a-f]{40}", args.runtime_commit) is not None and re.fullmatch(r"[0-9a-f]{40}", args.page_commit) is not None)
    raw, before, after = read_inputs([(args.raw, 262144), (args.runtime_before, 16384), (args.runtime_after, 16384)])
    result = normalize(raw, before, after,
                       image=args.expected_image, runtime_commit=args.runtime_commit, page_commit=args.page_commit,
                       page_release=args.page_release, read_committed=git_reader(args.repo, {args.runtime_commit, args.page_commit}))
    data = (json.dumps(result, indent=2, allow_nan=False) + "\n").encode("utf-8")
    publish(args.out, data)
    print(json.dumps({"passed": True, "phaseSha256": sha(data), "bodyBytes": result["bodyBytes"],
                      "acceptedRelevantFrames": len(result["acceptedRelevantFrames"]), "perRequestGenerationVerified": False}))


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt):
        raise SystemExit("Normalization failed: E_STREAM_PHASE") from None
