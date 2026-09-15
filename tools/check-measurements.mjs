// Browser measurements follow the build; the gallery remains a dated snapshot.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [browserPath,galleryPath]=process.argv.slice(2);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const browser=read(browserPath),gallery=read(galleryPath),build=read('build-report.json');
assert.equal(browser.htmlSha256,hash('index.html'),'Stale HTML measurement');
assert.equal(browser.brotliSha256,hash('public/index.html.br'),'Stale Brotli measurement');
for(const key of ['html','brotli','gzip','deflate'])assert.equal(browser[key],build[key],key);
assert.ok(readFileSync('README.md','utf8').includes(`](${browserPath})`));
assert.ok(readFileSync('COMPARISON.md','utf8').includes(`](${galleryPath})`));
assert.equal(gallery.runs.length,3);
for(const run of gallery.runs) {
  const own=run.results.find(result=>result.url===browser.url);
  assert.equal(own.body_sha256,gallery.brotliSha256,'Inconsistent gallery snapshot');
}
console.log('Browser measurements match the build; gallery snapshot hashes are consistent.');
