import test from 'node:test';
import assert from 'node:assert/strict';
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
  return directory;
}
function check(directory) {
  return spawnSync(process.execPath,['tools/check-measurements.mjs',page,gallery],{cwd:directory,encoding:'utf8'});
}
function changeJson(directory,file,mutate) {
  const path=join(directory,file),data=JSON.parse(readFileSync(path));
  mutate(data);
  writeFileSync(path,JSON.stringify(data));
}
test('current local build and dated gallery evidence agree with their Markdown tables',t=>{
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
