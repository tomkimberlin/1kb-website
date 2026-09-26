"""Run transport regressions against an isolated, already-built nginx.

Requires the repository's patched nginx with njs and headers-more, Node.js,
curl with HTTP/2, and Python dependencies from tools/requirements.txt. This
runner does not download dependencies, build nginx, or change system trust.
All listeners bind to loopback; the owned nginx master and workers are stopped.
"""
import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

if not __debug__:
    raise RuntimeError('Transport verification requires Python assertions; remove -O or PYTHONOPTIMIZE')

REPO = Path(__file__).resolve().parents[1]
REPRESENTATIONS = ('index.html', 'index.html.br', 'index.html.gz', 'index.html.deflate')
HOST = 'tomkimberlin.com'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def nginx_path(path):
    value = str(path)
    if any(ord(char) < 32 for char in value):
        raise ValueError('Configuration paths cannot contain control characters')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def baseline_source(args):
    if args.baseline_handler:
        path = args.baseline_handler.resolve(strict=True)
        return path.read_text(), {'path': str(path)}
    revision = subprocess.check_output(
        ['git', 'rev-parse', '--verify', '--end-of-options', args.baseline_ref + '^{commit}'],
        cwd=REPO, text=True).strip()
    source = subprocess.check_output(
        ['git', 'show', revision + ':server/site.js'], cwd=REPO, text=True)
    return source, {'commit': revision}


def validate_output(path, inputs):
    output = path.resolve()
    if output.exists() and not output.is_file():
        raise ValueError('The output must be a regular file')
    for source in inputs:
        source = Path(source).resolve(strict=True)
        if output == source or (output.exists() and output.samefile(source)):
            raise ValueError('Output aliases a test input: ' + str(source))
    return output


def free_ports(count):
    sockets = []
    try:
        for _ in range(count):
            sock = socket.socket()
            sockets.append(sock)
            sock.bind(('127.0.0.1', 0))
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def configuration(root, ports, cert, key, baseline_preloaded=False):
    before, after, plain = ports
    fixture = (REPO / 'tools/fixtures/response-buffering.conf').read_text().split('# TLS server{}:', 1)[1]
    common = f'''
http2 on;
server_name {HOST} www.tomkimberlin.com tom.kimberlin.net;
ssl_certificate {nginx_path(cert)};
ssl_certificate_key {nginx_path(key)};
ssl_certificate_compression on;
'''
    preload = 'js_preload_object onekbRepresentations from public/representations.json;'
    return f'''
daemon off;
master_process on;
worker_processes 1;
error_log {nginx_path(root / 'error.log')} info;
pid {nginx_path(root / 'nginx.pid')};
events {{ worker_connections 256; }}
http {{
http2_body_preread_size 65535;
access_log off;
types {{ }}
default_type "";
server_tokens off;
absolute_redirect off;
more_clear_headers Server;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_session_cache shared:ssl:1m;
ssl_session_tickets off;
ssl_conf_command NumTickets 1;
server {{ listen 127.0.0.1:{before} ssl; {common}
js_import before from before.js;
{preload if baseline_preloaded else ''}
location / {{ js_content before.serve; js_header_filter before.headers; }}
}}
server {{ listen 127.0.0.1:{after} ssl; {common}
js_import after from after.js;
js_import coalescing from coalescing.js;
{preload}
location / {{ js_content after.serve; js_header_filter after.headers; }}
{fixture}
}}
server {{ listen 127.0.0.1:{plain}; server_name {HOST} www.tomkimberlin.com tom.kimberlin.net;
js_import after from after.js;
{preload}
location / {{ js_content after.serve; js_header_filter after.headers; }}
}}
}}
'''


def wait_ready(process, port):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Isolated nginx exited before accepting connections')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError('Isolated nginx did not start within ten seconds')


def whitespace_cases(ports, ca, bodies):
    context = ssl.create_default_context(cafile=str(ca))
    context.set_alpn_protocols(['http/1.1'])
    cases = [('br ; q=1', 'br'), ('gzip\t; q=1, br ;q=0', 'gzip'),
             ('br ;q=0, * ;q=1', 'deflate'), ('identity ;q=1,br;q=0.5', 'identity'),
             ('* ;q=0', None), ('identity ;q=0, * ;q=0', None)]
    files = {'br': 'index.html.br', 'gzip': 'index.html.gz',
             'deflate': 'index.html.deflate', 'identity': 'index.html'}
    results = {}
    for name, port in zip(('before', 'after'), ports):
        results[name] = []
        for accepted, encoding in cases:
            with socket.create_connection(('127.0.0.1', port), timeout=5) as raw:
                with context.wrap_socket(raw, server_hostname=HOST) as tls:
                    tls.sendall(('GET / HTTP/1.1\r\nHost: ' + HOST
                                 + '\r\nAccept-Encoding: ' + accepted
                                 + '\r\nConnection: close\r\n\r\n').encode())
                    response = http.client.HTTPResponse(tls)
                    response.begin()
                    body = response.read()
                    encoded = response.getheader('Content-Encoding')
                    if name == 'after':
                        assert response.status == (200 if encoding else 406), accepted
                        assert encoded == (encoding if encoding != 'identity' else None), accepted
                        assert body == (bodies[files[encoding]] if encoding else b''), accepted
                    results[name].append({'acceptEncoding': accepted, 'status': response.status,
                                          'encoding': encoded, 'bodyBytes': len(body),
                                          'bodySha256': digest(body)})
    return results


def snapshot_cases(process, root, port, ca, bodies, node):
    """Check actual njs generation retention and successful/failed reloads."""
    files = {'br': 'index.html.br', 'gzip': 'index.html.gz',
             'deflate': 'index.html.deflate', 'identity': 'index.html'}
    original = {encoding: bodies[file] for encoding, file in files.items()}
    snapshot = root / 'public/representations.json'
    original_json = snapshot.read_bytes()
    second_json = subprocess.check_output([node, '--input-type=module', '-e', '''
import {brotliCompressSync,gzipSync,deflateSync} from 'node:zlib';
const identity=Buffer.from('<!doctype html><title>Reload fixture</title>');
console.log(JSON.stringify(Object.fromEntries(Object.entries({identity,
br:brotliCompressSync(identity),gzip:gzipSync(identity),deflate:deflateSync(identity)})
.map(([key,value])=>[key,value.toString('base64')]))));
'''], timeout=10)
    second = {key: base64.b64decode(value, validate=True)
              for key, value in json.loads(second_json).items()}
    context = ssl.create_default_context(cafile=str(ca))
    context.set_alpn_protocols(['http/1.1'])
    results = []

    def request(encoding, path='/'):
        assert process.poll() is None, 'Owned nginx exited during reload'
        with socket.create_connection(('127.0.0.1', port), timeout=3) as raw:
            with context.wrap_socket(raw, server_hostname=HOST) as tls:
                tls.sendall(('GET '+path+' HTTP/1.1\r\nHost: '+HOST+
                             '\r\nAccept-Encoding: '+encoding+
                             '\r\nConnection: close\r\n\r\n').encode())
                response = http.client.HTTPResponse(tls)
                response.begin()
                body = response.read()
                return response.status, response.getheader('Content-Encoding'), body

    def check(label, expected):
        for encoding, data in expected.items():
            status, coding, body = request(encoding)
            assert status == 200 and coding == (None if encoding == 'identity' else encoding)
            assert body == data, (label, encoding, len(body), len(data))
            results.append({'stage': label, 'encoding': encoding, 'bytes': len(body),
                            'sha256': digest(body), 'passed': True})

    def reload_and_wait(expected, invalid=False):
        log = root / 'error.log'
        offset = log.stat().st_size
        process.send_signal(signal.SIGHUP)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            assert process.poll() is None, 'Owned nginx exited during reload'
            messages = log.read_bytes()[offset:].decode(errors='replace')
            if 'reconfiguring' in messages and (not invalid or '[emerg]' in messages):
                try:
                    if request('identity')[2] == expected['identity']:
                        return
                except (OSError, http.client.HTTPException):
                    pass
            time.sleep(0.05)
        raise RuntimeError('Owned nginx did not complete the expected reload')

    try:
        # Baseline imports are isolated in their own server context; otherwise
        # their eager file reads would incorrectly contaminate the candidate.
        for name in REPRESENTATIONS:
            (root / 'public' / name).unlink()
        snapshot.write_bytes(second_json)
        check('disk-files-removed-before-reload', original)
        status, _, body = request('br', '/g')
        assert status == 301 and body == b''
        results.append({'stage': 'redirect-without-body-files', 'passed': True})
        reload_and_wait(second)
        check('valid-reload-new-snapshot', second)
        snapshot.write_text('{invalid-json')
        reload_and_wait(second, invalid=True)
        check('invalid-reload-preserves-snapshot', second)
    finally:
        snapshot.write_bytes(original_json)
        for name, data in bodies.items():
            (root / 'public' / name).write_bytes(data)
    reload_and_wait(original)
    check('restored-snapshot', original)
    return {'passed': True, 'checks': len(results), 'results': results,
            'scope': 'Owned loopback nginx PID, real SIGHUP reloads, explicit CA verification; no production state.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nginx', type=Path, required=True)
    parser.add_argument('--ca', type=Path, required=True)
    parser.add_argument('--cert', type=Path, help='Server certificate chain; defaults to --ca for a self-signed fixture')
    parser.add_argument('--key', type=Path, required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--public-dir', type=Path, default=REPO / 'public')
    parser.add_argument('--out', type=Path, required=True)
    baseline = parser.add_mutually_exclusive_group(required=True)
    baseline.add_argument('--baseline-handler', type=Path)
    baseline.add_argument('--baseline-ref', help='Explicit Git commit/ref containing the historical server/site.js')
    parser.add_argument('--baseline-legacy-http10', action='store_true',
                        help='Expect the historical baseline to omit HTTP/1.0 Content-Length')
    args = parser.parse_args()
    if not args.node:
        parser.error('Node.js is required; provide --node if it is not on PATH')
    args.nginx = args.nginx.resolve(strict=True)
    args.ca = args.ca.resolve(strict=True)
    args.key = args.key.resolve(strict=True)
    cert = (args.cert or args.ca).resolve(strict=True)
    node = shutil.which(args.node)
    if not node:
        parser.error('The --node executable was not found')
    node_version = subprocess.run([node, '--version'], capture_output=True, text=True, timeout=10)
    match = re.fullmatch(r'v(\d+)\.\d+\.\d+(?:[-+][\w.-]+)?\s*', node_version.stdout)
    if node_version.returncode or not match or int(match[1]) < 22:
        parser.error('--node must identify a Node.js 22+ executable')
    args.node = str(Path(node).resolve())
    inputs = [args.nginx, args.ca, cert, args.key, args.node, Path(__file__),
              REPO / 'server/site.js', REPO / 'server/verify.mjs',
              REPO / 'server/verify-response.mjs',
              REPO / 'tools/probe_response.py',
              REPO / 'tools/verify-http1.py', REPO / 'tools/verify-http2.py',
              REPO / 'tools/verify-response-buffering.py',
              REPO / 'tools/fixtures/response-buffering.js', REPO / 'tools/fixtures/response-buffering.conf']
    inputs += [args.public_dir / name for name in REPRESENTATIONS]
    inputs.append(args.public_dir / 'representations.json')
    if args.baseline_handler:
        inputs.append(args.baseline_handler)
    try:
        args.out = validate_output(args.out, inputs)
    except ValueError as error:
        parser.error(str(error))
    before, baseline_info = baseline_source(args)
    after = (REPO / 'server/site.js').read_text()
    bodies = {name: (args.public_dir / name).read_bytes() for name in REPRESENTATIONS}
    snapshot = (args.public_dir / 'representations.json').read_bytes()
    encoded = json.loads(snapshot)
    expected = {'br': 'index.html.br', 'gzip': 'index.html.gz',
                'deflate': 'index.html.deflate', 'identity': 'index.html'}
    if set(encoded) != set(expected) or any(base64.b64decode(encoded[key], validate=True) != bodies[file]
                                          for key, file in expected.items()):
        parser.error('representations.json must contain the exact four built body files')
    version = subprocess.run([str(args.nginx), '-V'], capture_output=True, text=True, check=True)
    report = {'measuredAt': datetime.now(timezone.utc).isoformat(), 'passed': False,
              'scope': 'Isolated loopback test, with explicit certificate verification; no production traffic.',
              'nginxBuild': version.stdout + version.stderr, 'nodeVersion': node_version.stdout.strip(), 'baseline': baseline_info,
              'handlerSha256': {'before': digest(before.encode()), 'after': digest(after.encode())},
              'representations': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in bodies.items()},
              'preloadSnapshotSha256': digest(snapshot),
              'checks': {}}
    status = 1
    # Node's ESM loader rejects a backslash in a POSIX module pathname. Keep
    # staging usable when such a pathname appears in a custom TMPDIR.
    temp_parent = Path(tempfile.gettempdir())
    if os.name == 'posix' and '\\' in str(temp_parent):
        temp_parent = Path('/tmp')
        report['temporaryDirectoryFallback'] = '/tmp (Node ESM pathname restriction)'
    with tempfile.TemporaryDirectory(prefix='onekb-transport-', dir=temp_parent) as directory:
        root = Path(directory)
        (root / 'logs').mkdir()
        (root / 'public').mkdir()
        (root / 'server').mkdir()
        for name, data in bodies.items():
            (root / 'public' / name).write_bytes(data)
        (root / 'public/representations.json').write_bytes(snapshot)
        for name, source in [('before', before), ('after', after)]:
            if '/srv/current/' not in source and 'onekbRepresentations' not in source:
                raise ValueError('Handler must use the expected representation directory or preload global')
            # Escape the fragment for either quote style in the original JS.
            prefix = json.dumps(str(root / 'public') + '/')[1:-1].replace("'", '\\u0027')
            (root / (name + '.js')).write_text(source.replace('/srv/current/', prefix))
        shutil.copyfile(REPO / 'server/verify.mjs', root / 'server/verify.mjs')
        shutil.copyfile(REPO / 'server/verify-response.mjs', root / 'server/verify-response.mjs')
        shutil.copyfile(REPO / 'tools/fixtures/response-buffering.js', root / 'coalescing.js')
        ports = free_ports(3)
        config = configuration(root, ports, cert, args.key, 'onekbRepresentations' in before)
        (root / 'nginx.conf').write_text(config)
        report['configuration'] = config.replace(str(root), '<staging>')
        launch = [str(args.nginx), '-p', str(root), '-c', str(root / 'nginx.conf')]
        process = None
        try:
            preflight = subprocess.run(launch + ['-t'], capture_output=True, text=True, timeout=30)
            if preflight.returncode:
                raise RuntimeError('Isolated nginx configuration failed: ' + preflight.stderr[-10000:])
            with (root / 'process.log').open('w') as log:
                process = subprocess.Popen(launch, stdout=log, stderr=subprocess.STDOUT,
                                           start_new_session=True)
                wait_ready(process, ports[1])

                def check(name, command, env=None, expected_output=None):
                    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=120)
                    passed = result.returncode == 0 and (expected_output is None or re.fullmatch(expected_output, result.stdout))
                    report['checks'][name] = {'passed': bool(passed)}
                    if not passed:
                        report['checks'][name]['stderr'] = result.stderr[-10000:]
                        report['checks'][name]['stdout'] = result.stdout[-10000:]
                        raise RuntimeError(name + ' failed')
                    try:
                        report['checks'][name]['result'] = json.loads(result.stdout)
                    except ValueError:
                        report['checks'][name]['result'] = result.stdout.strip()

                shared = ['--ip', '127.0.0.1', '--ca', str(args.ca)]
                body = ['--expected-body', str(root / 'public/index.html.br')]
                for name, port in zip(('before', 'after'), ports):
                    legacy = ['--legacy-http10-framing'] if name == 'before' and args.baseline_legacy_http10 else []
                    check('http1-' + name, [sys.executable, str(REPO / 'tools/verify-http1.py'),
                          *shared, '--port', str(port), *body, '--mode', 'patched', '--compact-headers', *legacy])
                check('http2', [sys.executable, str(REPO / 'tools/verify-http2.py'),
                      *shared, '--port', str(ports[1]), *body])
                check('buffering', [sys.executable, str(REPO / 'tools/verify-response-buffering.py'),
                      *shared, '--port', str(ports[1]), '--expect-coalesced-records'])
                env = dict(os.environ, ONEKB_TEST_IP='127.0.0.1', ONEKB_TEST_HTTPS_PORT=str(ports[1]),
                           ONEKB_TEST_HTTP_PORT=str(ports[2]), CURL_CA_BUNDLE=str(args.ca), NO_PROXY='*', no_proxy='*')
                check('handler', [args.node, str(root / 'server/verify.mjs')], env,
                      r'[1-9]\d* live HTTP/1\.1 and HTTP/2 checks passed\.\s*')
                report['acceptEncodingWhitespace'] = whitespace_cases(ports, args.ca, bodies)
                report['preloadSnapshots'] = snapshot_cases(process, root, ports[1], args.ca, bodies, args.node)
                report['passed'] = True
                status = 0
        except (AssertionError, OSError, RuntimeError, subprocess.SubprocessError) as error:
            report['error'] = str(error)
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                report['ownedProcessStopped'] = process.poll() is not None
                deadline = time.monotonic() + 2
                report['ownedProcessGroupStopped'] = False
                while time.monotonic() < deadline:
                    try:
                        os.killpg(process.pid, 0)
                    except ProcessLookupError:
                        report['ownedProcessGroupStopped'] = True
                        break
                    time.sleep(0.02)
                if not report['ownedProcessGroupStopped']:
                    report['passed'] = False
                    report['error'] = 'Owned nginx process group did not stop'
                    status = 1
            if status and (root / 'error.log').exists():
                report['nginxErrors'] = (root / 'error.log').read_text()[-10000:]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(('Passed' if report['passed'] else 'Failed') + ': ' + str(args.out))
    return status


if __name__ == '__main__':
    sys.exit(main())
