import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

const page='measurements/page-20260926-local.json',gallery='measurements/gallery-20260922.json';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'onekb-measurements-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const file of ['tools/check-measurements.mjs','tools/verify-page.mjs','server/site.js','measurements/page-20260922.json','README.md','COMPARISON.md','index.html','build-report.json',page,gallery,
    'public/index.html','public/index.html.br','public/index.html.gz','public/index.html.deflate','public/representations.json']) {
    const target=join(directory,file);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(new URL('../'+file,import.meta.url),target);
  }
  // Synthetic validator fixture: rebind the recorded matrix to these test bytes.
  // This exercises provenance checks; it does not create new browser evidence.
  const hash=file=>createHash('sha256').update(readFileSync(join(directory,file))).digest('hex');
  changeJson(directory,page,data=>{
    for(const [key,file] of Object.entries({html:'index.html',brotli:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'})) {
      data[key]=readFileSync(join(directory,'public',file)).length;
      data[key+'Sha256']=hash('public/'+file);
    }
    data.verification.browserCandidateSha256=data.htmlSha256;
    data.verification.browserVerifierSha256=hash('tools/verify-page.mjs');
    data.verification.handlerSha256=hash('server/site.js');
    const native=[...readFileSync(join(directory,'index.html'),'utf8').matchAll(/<a\s+href=(?:"mailto:[^"]*"|'mailto:[^']*'|mailto:[^\s>]+)/gi)].length;
    for(const entry of data.verification.browserComparisons) {
      entry.nativeProtocolActivations=native;entry.keyboardProbeRequests=9-native;
    }
  });
  const readme=join(directory,'README.md');
  writeFileSync(readme,readFileSync(readme,'utf8')+'\n[Test browser fixture]('+page+')\n');
  return directory;
}
function check(directory,buildOnly=false) {
  return spawnSync(process.execPath,['tools/check-measurements.mjs',...(buildOnly?['--build-only']:[]),page,gallery],{cwd:directory,encoding:'utf8'});
}
function changeJson(directory,file,mutate) {
  const path=join(directory,file),data=JSON.parse(readFileSync(path));
  mutate(data);
  writeFileSync(path,JSON.stringify(data));
}
const debugbear='measurements/debugbear-20261005.json';
function debugbearFixture(t) {
  const directory=fixture(t);
  copyFileSync(new URL('../'+debugbear,import.meta.url),join(directory,debugbear));
  const measured=JSON.parse(readFileSync(join(directory,page)));
  // Synthetic opt-in fixture: bind the normalized scan to these test bytes.
  // This exercises the validator without claiming a newly performed scan.
  changeJson(directory,debugbear,data=>{
    data.targetUrl=data.finalUrl=measured.url;
    data.sourceSha256=data.sourceMatchesApprovedSha256=measured.htmlSha256;
    data.metrics.decodedBodyBytes=measured.html;
    data.metrics.compressedBodyBytes=measured.brotli;
    data.metrics.networkBytesTotal=measured.brotli+data.metrics.networkCounterMinusCompressedBodyBytes;
    data.metrics.requestNetworkBytesTotal=data.metrics.lighthouseTotalByteWeight=data.metrics.lighthouseRequestTransferSize=data.metrics.networkBytesTotal;
  });
  changeJson(directory,page,data=>data.debugbearEvidence=debugbear);
  const scan=JSON.parse(readFileSync(join(directory,debugbear)));
  const path=join(directory,'README.md');
  const source=readFileSync(path,'utf8');
  const row=/^(\| DebugBear page weight \|[^\n]*\|)[^|]*\|$/m;
  // A local-build README may have no current scanner row; supply this fixture's own.
  const text=row.test(source)
    ? source.replace(row,(_,prefix)=>prefix+' **'+scan.metrics.networkBytesTotal+' B** |')
    : source+'\n| DebugBear page weight | Synthetic scan | **'+scan.metrics.networkBytesTotal+' B** |\n';
  writeFileSync(path,text+'\n[Test scan report]('+scan.reportUrl+') [Test normalized evidence]('+debugbear+')\n');
  return directory;
}
test('valid browser evidence fixture and dated gallery agree with their Markdown tables',t=>{
  const result=check(fixture(t));
  assert.equal(result.status,0,result.stderr);
});
test('same-length corruption of a compressed representation fails its measured hash',t=>{
  const directory=fixture(t),path=join(directory,'public/index.html.gz');
  const data=readFileSync(path);data[data.length-1]^=1;writeFileSync(path,data);
  const result=check(directory);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Stale gzip measurement/);
});
test('stale or malformed preloaded data cannot pass with four correct response files',t=>{
  for(const [name,mutate,error] of [
    ['stale body',data=>data.br=Buffer.from('stale body').toString('base64'),/Stale or malformed preloaded br/],
    ['noncanonical base64',data=>data.gzip+='\n',/Stale or malformed preloaded gzip/],
    ['wrong type',data=>data.identity=[],/Stale or malformed preloaded identity/],
    ['missing encoding',data=>delete data.deflate,/exactly four representations/],
    ['extra encoding',data=>data.zstd='',/exactly four representations/],
  ]) {
    const directory=fixture(t);changeJson(directory,'public/representations.json',mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
  for(const data of ['null','[]','{']) {
    const directory=fixture(t);writeFileSync(join(directory,'public/representations.json'),data);
    const result=check(directory);
    assert.notEqual(result.status,0,data);
    assert.match(result.stderr,/Malformed preload map|SyntaxError/);
  }
});
test('gallery summaries must be derived from recorded exchanges',t=>{
  for(const [name,mutate,error] of [
    ['median',data=>data.summary[0].tls_median++,/Gallery TLS median/],
    ['packet',data=>data.runs[0].results[0].packets[0].ip_bytes++,/Packet byte total/],
    ['range',data=>data.summary[0].total_range[1]++,/Gallery total range/]
  ]) {
    const directory=fixture(t);changeJson(directory,gallery,mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});
test('missing or duplicate gallery sites cannot bypass exchange validation',t=>{
  for(const [name,mutate,error] of [
    ['empty summary',data=>{
      data.summary=[];
      data.runs[0].results[0].packets[0].ip_bytes++;
    },/Gallery summary must contain measured sites/],
    ['incomplete summary',data=>data.summary.pop(),/Gallery summary must cover every site/],
    ['incomplete run',data=>data.runs[1].results.pop(),/Gallery summary must cover every site/],
    ['duplicate summary',data=>data.summary.push(data.summary[0]),/Duplicate site in gallery summary/],
    ['duplicate run',data=>data.runs[1].results.push(data.runs[1].results[0]),/Duplicate site in gallery run/]
  ]) {
    const directory=fixture(t);changeJson(directory,gallery,mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});
test('Markdown byte counts cannot drift from the underlying measurements',t=>{
  for(const [file,edit,error] of [
    ['README.md',text=>text.replace(/(\| Brotli response body \|[^\n]*\| )\*?\*?\d+ B\*?\*?( \|)/,'$1999 B$2'),/Stale README size/],
    ['COMPARISON.md',text=>text.replace('**5,251**','**5,250**'),/Stale comparison TLS median/]
  ]) {
    const directory=fixture(t),path=join(directory,file),before=readFileSync(path,'utf8');
    const after=edit(before);assert.notEqual(after,before);
    writeFileSync(path,after);
    const result=check(directory);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,error);
  }
});


test('changed browser verifier or handler cannot retain earlier browser provenance',t=>{
  for(const [file,error] of [
    ['tools/verify-page.mjs',/Stale browser verifier/],
    ['server/site.js',/Stale browser handler/]
  ]) {
    const directory=fixture(t),path=join(directory,file);
    writeFileSync(path,readFileSync(path,'utf8')+'\n// changed after measurement\n');
    const result=check(directory);
    assert.notEqual(result.status,0,file);
    assert.match(result.stderr,error);
  }
});

test('missing compressed hashes cannot turn same-length corruption into valid evidence',t=>{
  for(const [key,file] of [['gzip','index.html.gz'],['deflate','index.html.deflate']]) {
    const directory=fixture(t),path=join(directory,'public',file);
    changeJson(directory,page,data=>delete data[key+'Sha256']);
    const bytes=readFileSync(path);bytes[bytes.length-1]^=1;writeFileSync(path,bytes);
    const result=check(directory);
    assert.notEqual(result.status,0,key);
    assert.match(result.stderr,new RegExp('Missing or invalid '+key+' measurement hash'));
  }
});

test('browser evidence is bound to its candidate and dated baseline',t=>{
  for(const [field,error] of [
    ['browserCandidateSha256',/Browser candidate hash/],
    ['browserBaselineSha256',/Browser baseline hash/],
    ['browserVerifierSha256',/Stale browser verifier/],
    ['handlerSha256',/Stale browser handler/]
  ]) for(const value of [undefined,'0'.repeat(64)]) {
    const directory=fixture(t);
    changeJson(directory,page,data=>data.verification[field]=value);
    const result=check(directory);
    assert.notEqual(result.status,0,field);
    assert.match(result.stderr,error);
  }
});

test('browser claims require the complete unique successful matrix',t=>{
  for(const [name,change] of [
    ['empty',data=>data.verification.browserComparisons=[]],
    ['missing',data=>data.verification.browserComparisons.pop()],
    ['duplicate',data=>data.verification.browserComparisons[1]=data.verification.browserComparisons[0]],
    ['pixels failed',data=>data.verification.browserComparisons[0].identicalPixels=false],
    ['focus missing',data=>delete data.verification.browserComparisons[0].identicalFocusedPixels],
    ['activation missing',data=>data.verification.browserComparisons[0].keyboardEnterDestinations=8],
    ['HTTP probe count wrong',data=>data.verification.browserComparisons[0].keyboardProbeRequests=99],
    ['native protocol count wrong',data=>data.verification.browserComparisons[0].nativeProtocolActivations=99],
    ['request leaked',data=>data.verification.browserComparisons[0].unexpectedRequests=1],
    ['wrong viewport mode',data=>data.verification.browserComparisons[0].mobile=false],
    ['missing version',data=>delete data.verification.browserComparisons[0].browserVersion]
  ]) {
    const directory=fixture(t);changeJson(directory,page,change);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,/Browser matrix|Browser case/);
  }
});


test('build-only mode requires honest scope, rejects browser claims and still checks body hashes',t=>{
  const directory=fixture(t);
  changeJson(directory,page,data=>{data.scope='local build';delete data.verification;});
  const valid=check(directory,true);
  assert.equal(valid.status,0,valid.stderr);
  assert.match(valid.stdout,/browser equivalence is not claimed/);
  const strict=check(directory);
  assert.notEqual(strict.status,0);
  assert.match(strict.stderr,/Missing browser verification/);
  changeJson(directory,page,data=>{data.scope='browser equivalence';});
  const scope=check(directory,true);
  assert.notEqual(scope.status,0);
  assert.match(scope.stderr,/explicitly use local build scope/);
  changeJson(directory,page,data=>{data.scope='local build';data.verification={};});
  const claims=check(directory,true);
  assert.notEqual(claims.status,0);
  assert.match(claims.stderr,/must not carry browser equivalence/);
  changeJson(directory,page,data=>{delete data.verification;data.gzipSha256='0'.repeat(64);});
  const stale=check(directory,true);
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/Stale gzip measurement/);
});


test('completed normalized DebugBear scan agrees with source, exact counters and README',t=>{
  const directory=debugbearFixture(t);
  const result=check(directory);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Completed normalized DebugBear evidence matches/);
  changeJson(directory,page,data=>{data.scope='local build';delete data.verification;});
  const buildOnly=check(directory,true);
  assert.equal(buildOnly.status,0,buildOnly.stderr);
  assert.match(buildOnly.stdout,/Completed normalized DebugBear evidence matches/);
});

test('DebugBear URL, source and completed result provenance cannot drift',t=>{
  for(const [name,mutate,error] of [
    ['schema',data=>data.schemaVersion=2,/Unsupported DebugBear evidence schema/],
    ['unfinished',data=>data.status='running',/scan is not completed/],
    ['target',data=>data.targetUrl='https://example.invalid/',/DebugBear target URL/],
    ['final URL',data=>data.finalUrl='https://example.invalid/',/DebugBear final URL/],
    ['source',data=>data.sourceSha256='0'.repeat(64),/Stale DebugBear source hash/],
    ['approved source',data=>data.sourceMatchesApprovedSha256='0'.repeat(64),/DebugBear approved source hash/],
    ['result hash',data=>delete data.publicResultSha256,/invalid DebugBear public result hash/],
    ['report host',data=>data.reportUrl='https://example.invalid/test/website-speed/run/overview',/Invalid DebugBear report URL/],
    ['result ID',data=>data.publicResultUrl='https://www.debugbear.com/api/oneOffTest/other',/report and public result IDs differ/]
  ]) {
    const directory=debugbearFixture(t);changeJson(directory,debugbear,mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});

test('DebugBear evidence requires exact uncached single-document body measurements',t=>{
  for(const [name,mutate,error] of [
    ['decoded body',data=>data.metrics.decodedBodyBytes++,/Stale DebugBear decoded body size/],
    ['compressed body',data=>data.metrics.compressedBodyBytes++,/Stale DebugBear compressed body size/],
    ['request count',data=>data.metrics.networkRequestCount=2,/DebugBear document: networkRequestCount/],
    ['encoding',data=>data.metrics.contentEncoding='gzip',/DebugBear document: contentEncoding/],
    ['protocol',data=>data.metrics.protocol='http/1.1',/DebugBear document: protocol/],
    ['status',data=>data.metrics.statusCode=301,/DebugBear document: statusCode/],
    ['disk cache',data=>data.metrics.fromDiskCache=true,/DebugBear document: fromDiskCache/],
    ['service worker',data=>data.metrics.fromServiceWorker=true,/DebugBear document: fromServiceWorker/],
    ['Lighthouse cache',data=>data.metrics.lighthouseCache='disk',/DebugBear document: lighthouseCache/]
  ]) {
    const directory=debugbearFixture(t);changeJson(directory,debugbear,mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});

test('DebugBear and Lighthouse counters require exact numeric agreement and explicit provenance',t=>{
  for(const [name,mutate,error] of [
    ['network total',data=>data.metrics.networkBytesTotal++,/DebugBear\/Lighthouse counter mismatch/],
    ['request network total',data=>data.metrics.requestNetworkBytesTotal++,/DebugBear\/Lighthouse counter mismatch/],
    ['Lighthouse total',data=>data.metrics.lighthouseTotalByteWeight++,/DebugBear\/Lighthouse counter mismatch/],
    ['Lighthouse request',data=>data.metrics.lighthouseRequestTransferSize++,/DebugBear\/Lighthouse counter mismatch/],
    ['string counter',data=>data.metrics.networkBytesTotal=String(data.metrics.networkBytesTotal),/Invalid DebugBear byte counter/],
    ['noninteger',data=>data.metrics.lighthouseRequestTransferSize+=0.5,/Invalid DebugBear byte counter/],
    ['counter difference',data=>data.metrics.networkCounterMinusCompressedBodyBytes++,/counter-minus-body difference mismatch/],
    ['negative difference',data=>data.metrics.networkCounterMinusCompressedBodyBytes=-1,/Invalid DebugBear counter-minus-body difference/],
    ['body provenance',data=>delete data.metrics.compressedBodyField,/DebugBear counter provenance/],
    ['decoded provenance',data=>delete data.metrics.decodedBodyField,/DebugBear counter provenance/],
    ['request provenance',data=>delete data.metrics.requestNetworkBytesField,/DebugBear counter provenance/],
    ['normalization failed',data=>data.validation.scannerAndLighthouseTransferCountersAgree=false,/DebugBear normalization validation/]
  ]) {
    const directory=debugbearFixture(t);changeJson(directory,debugbear,mutate);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});

test('README must publish the latest DebugBear count and link its exact report and evidence',t=>{
  for(const [name,edit,error] of [
    ['stale row',text=>text.replace(/^(\| DebugBear page weight \|[^\n]*\|)[^|]*\|$/m,(_,prefix)=>prefix+' 1 B |'),/Stale README DebugBear size/],
    ['report link',(text,scan)=>text.replaceAll(']('+scan.reportUrl+')','](https://www.debugbear.com/test/website-speed/other/overview)'),/Missing README DebugBear report link/],
    ['evidence link',text=>text.replaceAll(']('+debugbear+')','](measurements/other-scan.json)'),/Missing README DebugBear evidence link/]
  ]) {
    const directory=debugbearFixture(t),path=join(directory,'README.md');
    const before=readFileSync(path,'utf8'),after=edit(before,JSON.parse(readFileSync(join(directory,debugbear))));
    assert.notEqual(after,before,'fixture must change '+name);
    writeFileSync(path,after);
    const result=check(directory);
    assert.notEqual(result.status,0,name);
    assert.match(result.stderr,error);
  }
});

test('recovered September scan cannot replace current DebugBear evidence',t=>{
  const directory=debugbearFixture(t);
  copyFileSync(new URL('../measurements/debugbear-20260922-recovered.json',import.meta.url),join(directory,debugbear));
  const result=check(directory);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Stale DebugBear source hash/);
});
