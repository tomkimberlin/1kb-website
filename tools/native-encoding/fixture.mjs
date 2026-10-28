import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {brotliDecompressSync, gunzipSync, inflateSync} from 'node:zlib';

// Pinned to the 391-byte local build and its manifest.
export const EXPECTED = Object.freeze({
  identity: {file: 'index.html', bytes: 1040, sha256: '86b1f6f2777fbfe9e98fcbe43456e85c87829ed03c10d8bd911271fd463a277c'},
  br: {file: 'index.html.br', bytes: 391, sha256: 'fa488bbf1bc3bd9d07be9d1030d06eb7632c3523396b4ef09780594edb704786'},
  gzip: {file: 'index.html.gz', bytes: 541, sha256: 'c3d75eb558ff097e54ec7e0f180e37869c9b4bfbec301045410413f0ff974fef'},
  deflate: {file: 'index.html.deflate', bytes: 529, sha256: '055a322af0c96ace5f049886e0ac4675b4dc0728cbcef72c48b2667af7235d01'},
});
export const MANIFEST_SHA256 = '441caa39500be4b9c410de43a407eb5e782f4d3b18530e858180da4bdd892d0f';
export const CODINGS = Object.freeze(Object.keys(EXPECTED));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function need(condition, message) {
  if (!condition) throw new Error(message);
}

// info.bytesWritten catches compressed data following the end of a stream.
export function exactDecoded(coding, body, source) {
  try {
    if (coding === 'identity') return body.equals(source);
    const decode = {br: brotliDecompressSync, gzip: gunzipSync, deflate: inflateSync}[coding];
    if (!decode) return false;
    const result = decode(body, {info: true, maxOutputLength: source.length + 1});
    return result.engine.bytesWritten === body.length && result.buffer.equals(source);
  } catch {
    return false;
  }
}

export function validateBodies(bodies) {
  need(Object.keys(bodies).sort().join(',') === [...CODINGS].sort().join(','), 'E_FIXTURE_CODINGS');
  for (const coding of CODINGS) {
    const body = bodies[coding];
    need(Buffer.isBuffer(body) && body.length === EXPECTED[coding].bytes && sha256(body) === EXPECTED[coding].sha256,
      `E_FIXTURE_HASH:${coding}`);
    need(exactDecoded(coding, body, bodies.identity), `E_FIXTURE_DECODE:${coding}`);
  }
}

export function loadFixtures(directory) {
  const bodies = Object.fromEntries(CODINGS.map(coding => [coding, readFileSync(join(directory, EXPECTED[coding].file))]));
  validateBodies(bodies);
  const manifestBytes = readFileSync(join(directory, 'representations.json'));
  need(sha256(manifestBytes) === MANIFEST_SHA256, 'E_FIXTURE_MANIFEST_HASH');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw new Error('E_FIXTURE_MANIFEST_JSON'); }
  need(manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    && Object.keys(manifest).sort().join(',') === [...CODINGS].sort().join(','), 'E_FIXTURE_MANIFEST_CODINGS');
  for (const coding of CODINGS) {
    need(manifest[coding] === bodies[coding].toString('base64'), `E_FIXTURE_MANIFEST_BODY:${coding}`);
  }
  return {bodies, manifestSha256: sha256(manifestBytes)};
}
