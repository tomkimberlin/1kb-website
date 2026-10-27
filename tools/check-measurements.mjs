// Measurements follow the build; the gallery remains a dated snapshot.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative,resolve} from 'node:path';
import assert from 'node:assert/strict';

const args=process.argv.slice(2);
const buildOnly=args[0]==='--build-only';
if(buildOnly)args.shift();
assert.equal(args.length,2,'Usage: check-measurements.mjs [--build-only] PAGE GALLERY');
const [browserPath,galleryPath]=args;
const normalizedBrowserPath=relative(process.cwd(),resolve(browserPath));
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
const html=readFileSync('index.html','utf8');
const nativeProtocolActivations=[...html.matchAll(/<a\s+href=(?:"mailto:[^"]*"|'mailto:[^']*'|mailto:[^\s>]+)/gi)].length;
function checkBrowserMatrix(comparisons,label) {
  const matrix=['chromium','webkit'].flatMap(engine=>[320,402,768,1440].flatMap(width=>['light','dark'].map(theme=>`${engine}-${width}-${theme}`)));
  assert.ok(Array.isArray(comparisons),label+' matrix is missing');
  assert.deepEqual(comparisons.map(({engine,width,theme})=>`${engine}-${width}-${theme}`).sort(),matrix.sort(),label+' matrix must contain all 16 unique cases');
  for(const entry of comparisons) {
    const name=`${entry.engine}-${entry.width}-${entry.theme}`;
    assert.ok(Number.isInteger(entry.width),label+' case '+name+': width must be numeric');
    const expected={mobile:entry.width<=402,identicalPixels:true,identicalContentAndGeometry:true,identicalAccessibilityAttributes:true,
      keyboardLinks:9,identicalFocusedPixels:9,keyboardEnterDestinations:9,pageLoadRequests:1,
      keyboardProbeRequests:9-nativeProtocolActivations,unexpectedRequests:0,externalRequestsBlocked:true};
    assert.equal(entry.nativeProtocolActivations??0,nativeProtocolActivations,label+' case '+name+': nativeProtocolActivations');
    for(const [key,value] of Object.entries(expected))assert.equal(entry[key],value,label+' case '+name+': '+key);
    assert.ok(typeof entry.browserVersion==='string'&&entry.browserVersion.trim(),label+' case '+name+': missing browser version');
    assert.ok(['Tab','Alt+Tab'].includes(entry.focusKey),label+' case '+name+': unsupported keyboard probe');
  }
}
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
  checkBrowserMatrix(verification.browserComparisons,'Browser');
  const legacyWithoutReport=new Set([
    'measurements/page-20260922.json','measurements/page-20260926-local.json',
    'measurements/page-20261005-local.json','measurements/page-20261022-accessibility-local.json',
    'measurements/page-20261022-local.json','measurements/page-20261023-rle-local.json',
    'measurements/page-20261025-font-validation-local.json'
  ]);
  if(!Object.hasOwn(browser,'browserEvidence'))
    assert.ok(legacyWithoutReport.has(normalizedBrowserPath),'Missing browser evidence reference');
  if(typeof browser.browserEvidence==='string') {
    // These older page records predate hashed report references. Do not allow
    // a new record to downgrade an object reference to an unchecked string.
    const legacy={
      'measurements/page-20261005-approved-copy.json':'measurements/browser-20261005-approved-copy.json',
      'measurements/page-20261005-opening-copy.json':'measurements/browser-20261005-opening-copy.json',
      'measurements/page-20261005-club-link.json':'measurements/browser-20261005-club-link.json',
      'measurements/page-20261005-direct-links-local.json':'measurements/browser-20261005-direct-links-local.json'
    };
    assert.equal(browser.browserEvidence,legacy[normalizedBrowserPath],'Unsupported legacy browser evidence reference');
  } else if(Object.hasOwn(browser,'browserEvidence')) {
    const ref=browser.browserEvidence;
    assert.match(ref?.path??'',/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/,'Invalid browser evidence path');
    assert.match(ref.sha256??'',/^[0-9a-f]{64}$/,'Invalid browser evidence hash');
    assert.equal(hash(ref.path),ref.sha256,'Stale browser evidence hash');
    const report=read(ref.path);
    assert.equal(report.verifierSha256,verification.browserVerifierSha256,'Browser report verifier mismatch');
    assert.equal(report.handlerSha256,verification.handlerSha256,'Browser report handler mismatch');
    assert.equal(report.baseline?.htmlSha256,verification.browserBaselineSha256,'Browser report baseline mismatch');
    assert.equal(report.baseline?.htmlBytes,read(browser.publishedMeasurement).html,'Browser report baseline size mismatch');
    assert.equal(report.candidate?.htmlSha256,verification.browserCandidateSha256,'Browser report candidate mismatch');
    assert.equal(report.candidate?.htmlBytes,browser.html,'Browser report candidate size mismatch');
    assert.deepEqual(report.cases,verification.browserComparisons,'Browser report cases mismatch');
  }
}
if(Object.hasOwn(browser,'fontOverrideEvidence')) {
  const references=browser.fontOverrideEvidence;
  assert.ok(references&&typeof references==='object'&&!Array.isArray(references),'Missing enlarged-font references');
  assert.deepEqual(Object.keys(references).sort(),['body','root'],'Enlarged-font references must cover root and body');
  const comment=html.indexOf('<!--');
  assert.ok(comment>=0,'Enlarged-font fixture requires the source comment insertion point');
  for(const [name,selector] of [['root','html'],['body','body']]) {
    const ref=references[name],label='Enlarged-font '+name;
    assert.match(ref?.path??'',/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/,label+': invalid evidence path');
    assert.match(ref.sha256??'',/^[0-9a-f]{64}$/,label+': invalid evidence hash');
    assert.equal(hash(ref.path),ref.sha256,label+': stale evidence hash');
    assert.equal(ref.comparisons,16,label+': expected 16 comparisons');
    const report=read(ref.path);
    assert.equal(report.verifierSha256,hash('tools/verify-page.mjs'),label+': stale verifier');
    assert.equal(report.handlerSha256,hash('server/site.js'),label+': stale handler');
    // These are test-only derivatives of the current decoded HTML. The dated
    // report's original baseline is historical, not the current normal baseline.
    const derivative=Buffer.from(html.slice(0,comment)+`<style>${selector}{font-size:24px!important}</style>`+html.slice(comment));
    assert.equal(report.candidate?.htmlBytes,derivative.length,label+': stale candidate size');
    assert.equal(report.candidate?.htmlSha256,createHash('sha256').update(derivative).digest('hex'),label+': stale candidate source');
    assert.ok(Number.isSafeInteger(report.baseline?.htmlBytes)&&report.baseline.htmlBytes>0,label+': invalid historical baseline size');
    assert.match(report.baseline?.htmlSha256??'',/^[0-9a-f]{64}$/,label+': invalid historical baseline hash');
    checkBrowserMatrix(report.cases,label);
  }
  console.log('Both enlarged-font derivatives match the current source, verifier and handler; all 32 browser comparisons pass.');
}

if(Object.hasOwn(browser,'nativeEncodingEvidence')) {
  const ref=browser.nativeEncodingEvidence;
  assert.match(ref?.path??'',/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/,'Invalid native encoding evidence path');
  assert.match(ref.sha256??'',/^[0-9a-f]{64}$/,'Invalid native encoding evidence hash');
  assert.equal(hash(ref.path),ref.sha256,'Stale native encoding evidence hash');
  const native=read(ref.path);
  for(const [key,value] of Object.entries({schemaVersion:1,passed:true,cleanupComplete:true,loopbackOnly:true,
    requestInterception:false,javaScriptEnabled:false,serviceWorkers:'block'}))
    assert.equal(native[key],value,'Native encoding evidence: '+key);
  assert.match(native.fixtureSourceSha256??'',/^[0-9a-f]{64}$/,'Missing native encoding verifier hash');
  assert.ok(Array.isArray(native.rows),'Missing native encoding cases');
  const matrix=['chromium','webkit'].flatMap(engine=>Object.keys(encodings).map(encoding=>`${engine}-${encoding}`));
  assert.deepEqual(native.rows.map(({engine,encoding})=>`${engine}-${encoding}`).sort(),matrix.sort(),'Native encoding cases must cover both browsers and all four representations');
  for(const row of native.rows) {
    const key={identity:'html',br:'brotli',gzip:'gzip',deflate:'deflate'}[row.encoding];
    assert.equal(row.encodedBytes,browser[key],'Stale native encoding byte count');
    assert.equal(row.encodedSha256,browser[key+'Sha256'],'Stale native encoding body hash');
    assert.equal(row.htmlBytes,browser.html,'Stale native decoded source size');
    assert.equal(row.htmlSha256,browser.htmlSha256,'Stale native decoded source hash');
    for(const [field,value] of Object.entries({exactDecodedSource:true,contentMatchesIdentityControl:true,
      explicitAcceptEncoding:row.encoding,requestedEncodingAdvertised:true,pageDocumentRequests:1,unexpectedPageRequests:0}))
      assert.equal(row[field],value,'Native encoding case: '+field);
    assert.ok(typeof row.browserVersion==='string'&&row.browserVersion.trim(),'Missing native encoding browser version');
  }
}

const readme=readFileSync('README.md','utf8'),comparison=readFileSync('COMPARISON.md','utf8');
const galleryStart='<!-- comparison:gallery:start -->',galleryEnd='<!-- comparison:gallery:end -->';
assert.equal(comparison.split(galleryStart).length,2,'Missing or duplicate historical gallery start');
assert.equal(comparison.split(galleryEnd).length,2,'Missing or duplicate historical gallery end');
assert.ok(comparison.indexOf(galleryStart)<comparison.indexOf(galleryEnd),'Historical gallery markers are reversed');
const historicalComparison=comparison.slice(comparison.indexOf(galleryStart),comparison.indexOf(galleryEnd));
assert.ok(readme.includes(`](${browserPath})`));
assert.ok(historicalComparison.includes(`](${galleryPath})`));
const cells=line=>line.split('|').slice(1,-1).map(cell=>cell.trim());
const bytes=cell=>Number(cell.replace(/[*, B]/g,''));
for(const [key,label] of Object.entries({html:'Raw HTML',brotli:'Brotli response body',gzip:'Gzip response body',deflate:'Deflate response body'})) {
  const row=readme.split('\n').find(line=>line.startsWith('| '+label+' |'));
  assert.ok(row,'Missing README measurement: '+label);
  assert.equal(bytes(cells(row).at(-1)),build[key],'Stale README size: '+key);
}
if(Object.hasOwn(browser,'debugbearEvidence')) {
  assert.ok(typeof browser.debugbearEvidence==='string'&&browser.debugbearEvidence.trim(),'Missing DebugBear evidence path');
  const scan=read(browser.debugbearEvidence);
  assert.equal(scan.schemaVersion,1,'Unsupported DebugBear evidence schema');
  assert.equal(scan.status,'completed','DebugBear scan is not completed');
  assert.equal(scan.targetUrl,browser.url,'DebugBear target URL does not match the page');
  assert.equal(scan.finalUrl,browser.url,'DebugBear final URL does not match the page');
  assert.equal(scan.sourceSha256,browser.htmlSha256,'Stale DebugBear source hash');
  assert.equal(scan.sourceMatchesApprovedSha256,browser.htmlSha256,'DebugBear approved source hash does not match the page');
  assert.match(scan.publicResultSha256??'',/^[0-9a-f]{64}$/,'Missing or invalid DebugBear public result hash');
  const report=scan.reportUrl?.match(/^https:\/\/www\.debugbear\.com\/test\/website-speed\/([A-Za-z0-9_-]+)\/overview$/);
  assert.ok(report,'Invalid DebugBear report URL');
  assert.equal(scan.publicResultUrl,'https://www.debugbear.com/api/oneOffTest/'+report[1],'DebugBear report and public result IDs differ');
  const metrics=scan.metrics;
  assert.ok(metrics&&typeof metrics==='object'&&!Array.isArray(metrics),'Missing DebugBear metrics');
  for(const field of ['networkBytesTotal','requestNetworkBytesTotal','compressedBodyBytes','decodedBodyBytes','lighthouseTotalByteWeight','lighthouseRequestTransferSize'])
    assert.ok(Number.isSafeInteger(metrics[field])&&metrics[field]>0,'Invalid DebugBear byte counter: '+field);
  assert.equal(metrics.decodedBodyBytes,browser.html,'Stale DebugBear decoded body size');
  assert.equal(metrics.compressedBodyBytes,browser.brotli,'Stale DebugBear compressed body size');
  for(const [field,value] of Object.entries({networkRequestCount:1,contentEncoding:'br',protocol:'h2',statusCode:200,
    fromDiskCache:false,fromServiceWorker:false,lighthouseCache:'none'}))
    assert.equal(metrics[field],value,'DebugBear document: '+field);
  for(const field of ['requestNetworkBytesTotal','lighthouseTotalByteWeight','lighthouseRequestTransferSize'])
    assert.equal(metrics[field],metrics.networkBytesTotal,'DebugBear/Lighthouse counter mismatch: '+field);
  assert.ok(Number.isSafeInteger(metrics.networkCounterMinusCompressedBodyBytes)&&metrics.networkCounterMinusCompressedBodyBytes>=0,'Invalid DebugBear counter-minus-body difference');
  assert.equal(metrics.networkCounterMinusCompressedBodyBytes,metrics.networkBytesTotal-metrics.compressedBodyBytes,'DebugBear counter-minus-body difference mismatch');
  for(const [field,value] of Object.entries({
    compressedBodyField:'result.result.resultJson.requestList[0].netlogData.encodedSize',
    decodedBodyField:'result.result.resultJson.requestList[0].netlogData.decodedSize',
    networkBytesField:'result.result.resultJson.lhData.totalEncodedBodyLength',
    requestNetworkBytesField:'result.result.resultJson.requestList[0].encodedDataLength'
  })) assert.equal(metrics[field],value,'DebugBear counter provenance: '+field);
  for(const field of ['assertionsPassed','singleFinishedUncachedHttp2Document','explicitNetlogBodyCounts',
    'sourceHashMatchesApproved','scannerAndLighthouseTransferCountersAgree','allResourceTypesSumToDocumentTotals'])
    assert.equal(scan.validation?.[field],true,'DebugBear normalization validation: '+field);
  const row=readme.split('\n').find(line=>line.startsWith('| DebugBear page weight |'));
  assert.ok(row,'Missing README DebugBear measurement');
  assert.equal(bytes(cells(row).at(-1)),metrics.networkBytesTotal,'Stale README DebugBear size');
  assert.ok(readme.includes(`](${scan.reportUrl})`),'Missing README DebugBear report link');
  assert.ok(readme.includes(`](${browser.debugbearEvidence})`),'Missing README DebugBear evidence link');
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
  const tableRows=historicalComparison.split('\n').filter(line=>line.startsWith('| ')&&line.includes(`](${summary.url})`));
  assert.equal(tableRows.length,1,'Missing or duplicate historical comparison row: '+summary.url);
  const row=tableRows[0];
  assert.ok(row,'Missing comparison table row: '+summary.url);
  assert.equal(bytes(cells(row)[1]),summary.tls_median,'Stale comparison TLS median: '+summary.url);
  assert.equal(bytes(cells(row)[2]),summary.total_median,'Stale comparison total median: '+summary.url);
}
if(Object.hasOwn(browser,'debugbearEvidence')) console.log('Completed normalized DebugBear evidence matches the source, body sizes, uncached HTTP/2 document, exact transfer counters and README.');
console.log(buildOnly
  ? 'Local build measurements, README and dated gallery hashes, totals, medians, ranges and table are consistent; browser equivalence is not claimed.'
  : 'Page measurements, browser provenance and all 16 comparisons match the build; README and dated gallery hashes, totals, medians, ranges and table are consistent.');
