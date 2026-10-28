// These are offline unit/input checks only. They never start a server or browser
// and are not evidence of native browser decoding.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {CODINGS, EXPECTED, MANIFEST_SHA256, exactDecoded, loadFixtures, sha256, validateBodies} from './fixture.mjs';
import {makeHandler} from './handler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(process.env.NATIVE_BROWSER_FIXTURES ?? join(here, '../build-check/public'));
const {bodies} = loadFixtures(fixtures);

function invokeHandler(handler, {url, method = 'GET', acceptEncoding}) {
  const result = {};
  handler({url, method, headers: acceptEncoding === undefined ? {} : {'accept-encoding': acceptEncoding}}, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body; },
  });
  return result;
}

test('pinned build bodies and manifest match and decode completely', () => {
  assert.equal(sha256(readFileSync(join(fixtures, 'representations.json'))), MANIFEST_SHA256);
  assert.doesNotThrow(() => validateBodies(bodies));
  for (const coding of CODINGS) {
    assert.equal(bodies[coding].length, EXPECTED[coding].bytes);
    assert.equal(sha256(bodies[coding]), EXPECTED[coding].sha256);
    assert.ok(exactDecoded(coding, bodies[coding], bodies.identity));
  }
});

test('changed or missing bodies and incomplete or trailing compressed streams are rejected', () => {
  const changed = Buffer.from(bodies.gzip);
  changed[20] ^= 1;
  assert.throws(() => validateBodies({...bodies, gzip: changed}), /E_FIXTURE_HASH:gzip/);
  const {gzip: ignored, ...missing} = bodies;
  assert.throws(() => validateBodies(missing), /E_FIXTURE_CODINGS/);
  for (const coding of ['br', 'gzip', 'deflate']) {
    assert.equal(exactDecoded(coding, bodies[coding].subarray(0, -1), bodies.identity), false, `${coding} truncated`);
    assert.equal(exactDecoded(coding, Buffer.concat([bodies[coding], Buffer.from([0xff])]), bodies.identity), false, `${coding} trailing`);
  }
  assert.equal(exactDecoded('unknown', bodies.identity, bodies.identity), false);
});

test('a changed build manifest is rejected before any browser run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-browser-test-'));
  try {
    for (const coding of CODINGS) copyFileSync(join(fixtures, EXPECTED[coding].file), join(dir, EXPECTED[coding].file));
    writeFileSync(join(dir, 'representations.json'), '{}\n');
    assert.throws(() => loadFixtures(dir), /E_FIXTURE_MANIFEST_HASH/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('request handler sends each selected pinned body with exact HTTP encoding', () => {
  const routes = new Map(CODINGS.map(coding => [`/test/${coding}`, coding]));
  const serverRequests = [];
  const handler = makeHandler({bodies, routes, serverRequests});
  for (const coding of CODINGS) {
    const response = invokeHandler(handler, {url: `/test/${coding}`, acceptEncoding: coding});
    assert.equal(response.status, 200);
    assert.strictEqual(response.body, bodies[coding]);
    assert.equal(response.headers['content-length'], EXPECTED[coding].bytes);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(response.headers['content-encoding'], coding === 'identity' ? undefined : coding);
    assert.deepEqual(serverRequests.at(-1), {
      path: `/test/${coding}`, method: 'GET', coding, acceptEncoding: coding, expected: true,
      encodedBytes: EXPECTED[coding].bytes, encodedSha256: EXPECTED[coding].sha256,
    });
  }
  assert.equal(serverRequests.length, 4);
});

test('request handler rejects unknown paths, wrong methods and wrong encodings', () => {
  const serverRequests = [];
  const handler = makeHandler({bodies, routes: new Map([['/test/gzip', 'gzip']]), serverRequests});
  for (const request of [
    {url: '/other', acceptEncoding: 'gzip'},
    {url: '/test/gzip', method: 'POST', acceptEncoding: 'gzip'},
    {url: '/test/gzip', acceptEncoding: 'br'},
    {url: '/test/gzip'},
    {url: '/test/gzip', acceptEncoding: 'gzip, br'},
  ]) {
    const response = invokeHandler(handler, request);
    assert.equal(response.status, 400);
    assert.equal(response.body, undefined);
    assert.equal(serverRequests.at(-1).expected, false);
  }
  assert.equal(serverRequests.length, 5);
});

test('check-inputs mode identifies itself as non-browser validation', () => {
  const result = spawnSync(process.execPath, [join(here, 'runner.mjs'), '--check-inputs', '--fixtures', fixtures], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputValidationPassed, true);
  assert.equal(report.nativeBrowserVerified, false);
  assert.equal(report.bodies.gzip.sha256, EXPECTED.gzip.sha256);
  assert.equal(report.bodies.deflate.sha256, EXPECTED.deflate.sha256);
});
