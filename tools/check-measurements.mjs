// Run after deploying and refreshing the browser and gallery measurements.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [browserPath,galleryPath]=process.argv.slice(2);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const browser=read(browserPath),gallery=read(galleryPath),build=read('build-report.json');
for(const measurement of [browser,gallery]) {
  assert.equal(measurement.htmlSha256,hash('index.html'),'Stale HTML measurement');
  assert.equal(measurement.brotliSha256,hash('public/index.html.br'),'Stale Brotli measurement');
}
for(const key of ['html','brotli','gzip','deflate'])assert.equal(browser[key],build[key],key);
assert.ok(readFileSync('README.md','utf8').includes(`](${browserPath})`));
assert.ok(readFileSync('COMPARISON.md','utf8').includes(`](${galleryPath})`));
assert.equal(gallery.runs.length,3);
for(const run of gallery.runs) {
  const own=run.results.find(result=>result.url===browser.url);
  assert.equal(own.body_sha256,browser.brotliSha256);
  assert.equal(own.body_bytes,build.brotli);
}
console.log('Browser and gallery measurements match the current build.');
