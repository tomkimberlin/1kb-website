// Measurements follow the build; the gallery remains a dated snapshot.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const args=process.argv.slice(2);
const buildOnly=args[0]==='--build-only';
if(buildOnly)args.shift();
assert.equal(args.length,2,'Usage: check-measurements.mjs [--build-only] PAGE GALLERY');
const [browserPath,galleryPath]=args;
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const browser=read(browserPath),gallery=read(galleryPath),build=read('build-report.json');
const files={html:'index.html',brotli:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'};
for(const [key,file] of Object.entries(files)) {
  const path='public/'+file;
  assert.equal(browser[key],build[key],key);
  assert.equal(readFileSync(path).length,build[key],'Stale built '+key);
  assert.match(browser[key+'Sha256']??'',/^[0-9a-f]{64}$/,'Missing or invalid '+key+' measurement hash');
  assert.equal(browser[key+'Sha256'],hash(path),'Stale '+key+' measurement');
}
assert.equal(hash('public/index.html'),hash('index.html'),'Stale built HTML');
// nginx serves this preloaded map, so checking only the body files is not enough.
const preloaded=read('public/representations.json');
assert.ok(preloaded&&typeof preloaded==='object'&&!Array.isArray(preloaded),'Malformed preload map');
const encodings={br:'index.html.br',deflate:'index.html.deflate',gzip:'index.html.gz',identity:'index.html'};
assert.deepEqual(Object.keys(preloaded).sort(),Object.keys(encodings).sort(),'Preload map must contain exactly four representations');
for(const [encoding,file] of Object.entries(encodings))
  assert.equal(preloaded[encoding],readFileSync('public/'+file).toString('base64'),'Stale or malformed preloaded '+encoding);
if(buildOnly) {
  assert.equal(browser.scope,'local build','Build-only evidence must explicitly use local build scope');
  assert.ok(!Object.hasOwn(browser,'verification'),'Build-only evidence must not carry browser equivalence verification');
} else {
  // Browser evidence belongs to these exact source bytes and verifier/handler
  // versions. Updating only the build hashes must not refresh older browser claims.
  const verification=browser.verification;
  assert.ok(verification,'Missing browser verification');
  assert.equal(verification.browserVerifierSha256,hash('tools/verify-page.mjs'),'Stale browser verifier');
  assert.equal(verification.handlerSha256,hash('server/site.js'),'Stale browser handler');
  assert.equal(verification.browserCandidateSha256,browser.htmlSha256,'Browser candidate hash does not match the measured build');
  assert.match(verification.browserBaselineSha256??'',/^[0-9a-f]{64}$/,'Browser baseline hash is missing or invalid');
  assert.equal(verification.browserBaselineSha256,read(browser.publishedMeasurement).htmlSha256,'Browser baseline hash does not match the dated page snapshot');
  const matrix=['chromium','webkit'].flatMap(engine=>[320,402,768,1440].flatMap(width=>['light','dark'].map(theme=>`${engine}-${width}-${theme}`)));
  const comparisons=verification.browserComparisons;
  assert.ok(Array.isArray(comparisons),'Browser matrix is missing');
  assert.deepEqual(comparisons.map(({engine,width,theme})=>`${engine}-${width}-${theme}`).sort(),matrix.sort(),'Browser matrix must contain all 16 unique cases');
  for(const entry of comparisons) {
    const name=`${entry.engine}-${entry.width}-${entry.theme}`;
    const expected={mobile:entry.width<=402,identicalPixels:true,identicalContentAndGeometry:true,
      keyboardLinks:9,identicalFocusedPixels:9,keyboardEnterDestinations:9,pageLoadRequests:1,
      keyboardProbeRequests:9,unexpectedRequests:0,externalRequestsBlocked:true};
    for(const [key,value] of Object.entries(expected))assert.equal(entry[key],value,'Browser case '+name+': '+key);
    assert.ok(typeof entry.browserVersion==='string'&&entry.browserVersion.trim(),'Browser case '+name+': missing browser version');
    assert.ok(['Tab','Alt+Tab'].includes(entry.focusKey),'Browser case '+name+': unsupported keyboard probe');
  }
}

const readme=readFileSync('README.md','utf8'),comparison=readFileSync('COMPARISON.md','utf8');
assert.ok(readme.includes(`](${browserPath})`));
assert.ok(comparison.includes(`](${galleryPath})`));
const cells=line=>line.split('|').slice(1,-1).map(cell=>cell.trim());
const bytes=cell=>Number(cell.replace(/[*, B]/g,''));
for(const [key,label] of Object.entries({html:'Raw HTML',brotli:'Brotli response body',gzip:'Gzip response body',deflate:'Deflate response body'})) {
  const row=readme.split('\n').find(line=>line.startsWith('| '+label+' |'));
  assert.ok(row,'Missing README measurement: '+label);
  assert.equal(bytes(cells(row).at(-1)),build[key],'Stale README size: '+key);
}
assert.equal(gallery.runs.length,3);
const summaryUrls=gallery.summary.map(row=>row.url);
assert.ok(summaryUrls.length>0,'Gallery summary must contain measured sites');
assert.equal(new Set(summaryUrls).size,summaryUrls.length,'Duplicate site in gallery summary');
for(const run of gallery.runs) {
  const urls=run.results.map(row=>row.url);
  assert.equal(new Set(urls).size,urls.length,'Duplicate site in gallery run');
  assert.deepEqual([...urls].sort(),[...summaryUrls].sort(),'Gallery summary must cover every site in each run');
  const own=run.results.find(result=>result.url===browser.url);
  assert.equal(own.body_sha256,gallery.brotliSha256,'Inconsistent gallery snapshot');
}
const median=values=>[...values].sort((a,b)=>a-b)[1];
const range=values=>[Math.min(...values),Math.max(...values)];
for(const summary of gallery.summary) {
  const rows=gallery.runs.map(run=>{
    const matches=run.results.filter(row=>row.url===summary.url);
    assert.equal(matches.length,1,'Expected one gallery result per site and run');
    return matches[0];
  });
  for(const row of rows) {
    assert.equal(row.observed_ipv4_tcp_bytes,row.packets.reduce((n,p)=>n+p.ip_bytes,0),'Packet byte total');
    assert.equal(row.estimated_ipv4_tcp_bytes_1500_mtu,row.packets.reduce((n,p)=>n+p.ip_bytes_at_1500_mtu,0),'MTU-adjusted packet total');
    assert.equal(row.dns_ipv4_udp_bytes,row.dns_queries.reduce((n,q)=>n+q.ipv4_udp_bytes,0),'DNS byte total');
    assert.equal(row.estimated_tcp_plus_dns_bytes,row.estimated_ipv4_tcp_bytes_1500_mtu+row.dns_ipv4_udp_bytes,'TCP plus DNS total');
  }
  const tls=rows.map(row=>row.tls_through_body_complete.sent+row.tls_through_body_complete.received-row.body_bytes);
  const total=rows.map(row=>row.estimated_tcp_plus_dns_bytes-row.body_bytes);
  assert.equal(summary.tls_median,median(tls),'Gallery TLS median: '+summary.url);
  assert.deepEqual(summary.tls_range,range(tls),'Gallery TLS range: '+summary.url);
  assert.equal(summary.total_median,median(total),'Gallery total median: '+summary.url);
  assert.deepEqual(summary.total_range,range(total),'Gallery total range: '+summary.url);
  const row=comparison.split('\n').find(line=>line.startsWith('| ')&&line.includes(`](${summary.url})`));
  assert.ok(row,'Missing comparison table row: '+summary.url);
  assert.equal(bytes(cells(row)[1]),summary.tls_median,'Stale comparison TLS median: '+summary.url);
  assert.equal(bytes(cells(row)[2]),summary.total_median,'Stale comparison total median: '+summary.url);
}
console.log(buildOnly
  ? 'Local build measurements, README and dated gallery hashes, totals, medians, ranges and table are consistent; browser equivalence is not claimed.'
  : 'Page measurements, browser provenance and all 16 comparisons match the build; README and dated gallery hashes, totals, medians, ranges and table are consistent.');
