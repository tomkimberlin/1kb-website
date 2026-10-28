import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

const page='measurements/page-20260926-local.json',gallery='measurements/gallery-20260922.json';
const project=new URL(existsSync(new URL('../package.json',import.meta.url))?'../':'../../../../',import.meta.url);
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'onekb-measurements-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const file of ['tools/check-measurements.mjs','tools/verify-page.mjs','server/site.js','measurements/page-20260922.json','README.md','COMPARISON.md','index.html','build-report.json',page,gallery,
    'public/index.html','public/index.html.br','public/index.html.gz','public/index.html.deflate','public/representations.json']) {
    const target=join(directory,file);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(file==='tools/check-measurements.mjs'?new URL('./check-measurements.mjs',import.meta.url):new URL(file,project),target);
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
      entry.identicalAccessibilityAttributes=true;
    }
  });
  const readme=join(directory,'README.md');
  writeFileSync(readme,readFileSync(readme,'utf8')+'\n[Test browser fixture]('+page+')\n');
  return directory;
}
function check(directory,buildOnly=false,pagePath=page) {
  return spawnSync(process.execPath,['tools/check-measurements.mjs',...(buildOnly?['--build-only']:[]),pagePath,gallery],{cwd:directory,encoding:'utf8'});
}
function changeJson(directory,file,mutate) {
  const path=join(directory,file),data=JSON.parse(readFileSync(path));
  mutate(data);
  writeFileSync(path,JSON.stringify(data));
}
const fontReports=Object.fromEntries(['root','body'].map(name=>[name,`measurements/browser-20261022-accessibility-${name}-font-local.json`]));
function fontFixture(t) {
  const directory=fixture(t);
  for(const file of Object.values(fontReports))copyFileSync(new URL(file,project),join(directory,file));
  const current=JSON.parse(readFileSync(new URL('measurements/page-20261025-font-validation-local.json',project)));
  changeJson(directory,page,data=>data.fontOverrideEvidence=current.fontOverrideEvidence);
  // Rebind these copied, synthetic fixtures just like the main matrix above.
  // Historical browser records on disk remain unchanged and are not rerun.
  const html=readFileSync(join(directory,'index.html'),'utf8');
  const comment=html.indexOf('<!--');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [name,selector] of [['root','html'],['body','body']]) {
    const file=fontReports[name];
    const derivative=Buffer.from(html.slice(0,comment)+`<style>${selector}{font-size:24px!important}</style>`+html.slice(comment));
    changeJson(directory,file,data=>{
      data.verifierSha256=hash(readFileSync(join(directory,'tools/verify-page.mjs')));
      data.handlerSha256=hash(readFileSync(join(directory,'server/site.js')));
      data.candidate={htmlBytes:derivative.length,htmlSha256:hash(derivative)};
    });
    refreshFontReference(directory,file);
  }
  return directory;
}
function refreshFontReference(directory,file) {
  const sha256=createHash('sha256').update(readFileSync(join(directory,file))).digest('hex');
  changeJson(directory,page,data=>{
    const ref=Object.values(data.fontOverrideEvidence).find(ref=>ref.path===file);
    ref.sha256=sha256;
  });
}
test('enlarged-font evidence binds both complete matrices to exact current-source derivatives',t=>{
  const result=check(fontFixture(t));
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/all 32 browser comparisons pass/);
});
test('enlarged-font references cannot omit a setting or point outside measurement records',t=>{
  for(const [mutate,error] of [
    [data=>data.fontOverrideEvidence=null,/Missing enlarged-font references/],
    [data=>delete data.fontOverrideEvidence.body,/must cover root and body/],
    [data=>data.fontOverrideEvidence.extra={},/must cover root and body/],
    [data=>data.fontOverrideEvidence.root.path='../outside.json',/invalid evidence path/],
    [data=>data.fontOverrideEvidence.root.path='measurements/missing-font.json',/ENOENT/],
    [data=>delete data.fontOverrideEvidence.root.sha256,/invalid evidence hash/],
    [data=>data.fontOverrideEvidence.body.sha256='0'.repeat(64),/stale evidence hash/],
    [data=>data.fontOverrideEvidence.body.comparisons=0,/expected 16 comparisons/]
  ]) {
    const directory=fontFixture(t);changeJson(directory,page,mutate);
    const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,error);
  }
});
test('enlarged-font report hash binds the dated historical baseline and complete record',t=>{
  const directory=fontFixture(t);
  changeJson(directory,fontReports.root,data=>data.baseline.htmlSha256='0'.repeat(64));
  const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,/stale evidence hash/);
});
test('enlarged-font evidence rejects failed, incomplete and stale reports for either setting',t=>{
  for(const file of Object.values(fontReports))for(const [mutate,error] of [
    [data=>data.cases=[],/matrix must contain all 16/],
    [data=>data.cases.pop(),/matrix must contain all 16/],
    [data=>data.cases[1]=data.cases[0],/matrix must contain all 16/],
    [data=>data.cases[0].width='320',/width must be numeric/],
    [data=>data.cases[0].identicalPixels=false,/identicalPixels/],
    [data=>data.cases[0].identicalContentAndGeometry=false,/identicalContentAndGeometry/],
    [data=>data.cases[0].identicalAccessibilityAttributes=false,/identicalAccessibilityAttributes/],
    [data=>data.cases[0].identicalFocusedPixels=8,/identicalFocusedPixels/],
    [data=>data.cases[0].keyboardEnterDestinations=8,/keyboardEnterDestinations/],
    [data=>data.cases[0].unexpectedRequests=1,/unexpectedRequests/],
    [data=>delete data.cases[0].browserVersion,/missing browser version/],
    [data=>data.verifierSha256='0'.repeat(64),/stale verifier/],
    [data=>data.handlerSha256='0'.repeat(64),/stale handler/],
    [data=>data.candidate.htmlBytes++,/stale candidate size/],
    [data=>data.candidate.htmlSha256='0'.repeat(64),/stale candidate source/],
    [data=>data.baseline.htmlBytes=0,/invalid historical baseline size/],
    [data=>delete data.baseline.htmlSha256,/invalid historical baseline hash/]
  ]) {
    const directory=fontFixture(t);changeJson(directory,file,mutate);refreshFontReference(directory,file);
    const result=check(directory);assert.notEqual(result.status,0,file);assert.match(result.stderr,error);
  }
  const directory=fontFixture(t);
  copyFileSync(join(directory,fontReports.root),join(directory,fontReports.body));
  refreshFontReference(directory,fontReports.body);
  const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,/stale candidate source/);
});
const nativeEncoding='measurements/browser-20261023-fallback-encoding-local.json';
function nativeEncodingFixture(t) {
  const directory=fixture(t);
  copyFileSync(new URL(nativeEncoding,project),join(directory,nativeEncoding));
  const measured=JSON.parse(readFileSync(join(directory,page)));
  // Synthetic validator fixture; these edits do not claim a new browser run.
  changeJson(directory,nativeEncoding,data=>{
    for(const row of data.rows) {
      const key={identity:'html',br:'brotli',gzip:'gzip',deflate:'deflate'}[row.encoding];
      row.encodedBytes=measured[key];row.encodedSha256=measured[key+'Sha256'];
      row.htmlBytes=measured.html;row.htmlSha256=measured.htmlSha256;
    }
  });
  refreshNativeReference(directory);
  return directory;
}
function refreshNativeReference(directory) {
  const sha256=createHash('sha256').update(readFileSync(join(directory,nativeEncoding))).digest('hex');
  changeJson(directory,page,data=>data.nativeEncodingEvidence={path:nativeEncoding,sha256});
}
test('native encoding evidence binds both browsers to all four exact representations',t=>{
  const result=check(nativeEncodingFixture(t));
  assert.equal(result.status,0,result.stderr);
});
test('native encoding evidence rejects stale hashes and incomplete or changed cases',t=>{
  const directory=nativeEncodingFixture(t);
  changeJson(directory,nativeEncoding,data=>data.rows[0].encodedBytes++);
  let result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,/Stale native encoding evidence hash/);
  for(const [mutate,error] of [
    [data=>data.rows[0].encodedBytes++,/Stale native encoding byte count/],
    [data=>data.rows[0].encodedSha256='0'.repeat(64),/Stale native encoding body hash/],
    [data=>data.rows[0].htmlSha256='0'.repeat(64),/Stale native decoded source hash/],
    [data=>data.rows.pop(),/Native encoding cases must cover/],
    [data=>data.rows[0]=data.rows[1],/Native encoding cases must cover/],
    [data=>data.rows[0].exactDecodedSource=false,/exactDecodedSource/],
    [data=>data.rows[0].unexpectedPageRequests=1,/unexpectedPageRequests/],
    [data=>data.requestInterception=true,/Native encoding evidence: requestInterception/],
  ]) {
    const root=nativeEncodingFixture(t);
    changeJson(root,nativeEncoding,mutate);refreshNativeReference(root);
    result=check(root);assert.notEqual(result.status,0);assert.match(result.stderr,error);
  }
});
const researchFile='measurements/compression-synthetic-brotli.json';
const bitFile='measurements/synthetic-brotli-bit-audit.json';
const bitScript='measurements/synthetic-brotli-bit-audit.py';
const recipe='tools/synthetic-brotli-recipe.py',harness='tools/synthetic-brotli-harness.c';
const digestFile=(directory,path)=>createHash('sha256').update(readFileSync(join(directory,path))).digest('hex');
function refreshResearchReference(directory) {
  changeJson(directory,page,data=>data.brotliResearchEvidence={path:researchFile,sha256:digestFile(directory,researchFile)});
}
function researchFixture(t) {
  const directory=fixture(t),measured=JSON.parse(readFileSync(join(directory,page)));
  mkdirSync(join(directory,'compression'));
  copyFileSync(join(directory,'public/index.html.br'),join(directory,'compression/index.html.br'));
  for(const path of [recipe,harness,bitScript])writeFileSync(join(directory,path),`synthetic ${path}\n`);
  const control={bytes:392,sha256:'a'.repeat(64)},candidate={path:'compression/index.html.br',bytes:measured.brotli,sha256:measured.brotliSha256};
  const audit={scriptSha256:digestFile(directory,bitScript),sourceSha256:measured.htmlSha256,streams:{
    control:{...control,preamble:{distancePostfix:0,distanceDirect:1}},
    candidate:{bytes:candidate.bytes,sha256:candidate.sha256,preamble:{distancePostfix:0,distanceDirect:1}}}};
  writeFileSync(join(directory,bitFile),JSON.stringify(audit));
  const bitHash=digestFile(directory,bitFile),study={
    source:{path:'index.html',bytes:measured.html,sha256:measured.htmlSha256},control,candidate,
    reproduction:{recipe,recipeSha256:digestFile(directory,recipe),harness,harnessSha256:digestFile(directory,harness)},
    independentAudit:{bitEvidence:bitFile,sha256:bitHash,script:bitScript,scriptSha256:digestFile(directory,bitScript)},
    encoder:{emittedDistanceHeader:{postfix:0,direct:1,evidence:bitFile,evidenceSha256:bitHash}}};
  writeFileSync(join(directory,researchFile),JSON.stringify(study));refreshResearchReference(directory);
  return directory;
}
test('optional Brotli research binds the page, tools and independent bit report',t=>{
  const result=check(researchFixture(t));assert.equal(result.status,0,result.stderr);
});
test('Brotli research rejects stale or inconsistent linked records and tools',t=>{
  for(const [mutate,error] of [
    [root=>writeFileSync(join(root,researchFile),'{}'),/Stale Brotli research evidence hash/],
    [root=>{changeJson(root,researchFile,v=>v.source.sha256='0'.repeat(64));refreshResearchReference(root);},/Brotli research source hash differs/],
    [root=>{changeJson(root,researchFile,v=>v.candidate.sha256='0'.repeat(64));refreshResearchReference(root);},/Brotli research candidate hash differs/],
    [root=>writeFileSync(join(root,'compression/index.html.br'),'stale'),/Stale Brotli research candidate file/],
    [root=>writeFileSync(join(root,recipe),'stale'),/Stale Brotli research recipe hash/],
    [root=>writeFileSync(join(root,harness),'stale'),/Stale Brotli research harness hash/],
    [root=>writeFileSync(join(root,bitFile),'{}'),/Stale Brotli bit-audit hash/],
    [root=>writeFileSync(join(root,bitScript),'stale'),/Stale Brotli bit-audit script hash/],
    [root=>{changeJson(root,researchFile,v=>v.independentAudit.script='../outside.py');refreshResearchReference(root);},/Invalid Brotli bit-audit script reference/],
    [root=>{changeJson(root,researchFile,v=>v.encoder.emittedDistanceHeader.direct=2);refreshResearchReference(root);},/Brotli bit-audit direct count differs/],
    [root=>{changeJson(root,researchFile,v=>delete v.independentAudit);refreshResearchReference(root);},/Invalid Brotli bit-audit reference/]
  ]) {
    const directory=researchFixture(t);mutate(directory);
    const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,error);
  }
});
const debugbear='measurements/debugbear-20261005.json';
function debugbearFixture(t) {
  const directory=fixture(t);
  copyFileSync(new URL(debugbear,project),join(directory,debugbear));
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

test('referenced browser evidence binds the report bytes, provenance and cases',t=>{
  const report='measurements/browser-reference.json';
  function createReport(directory) {
    const data=JSON.parse(readFileSync(join(directory,page)));
    const v=data.verification;
    const value={verifierSha256:v.browserVerifierSha256,handlerSha256:v.handlerSha256,
      baseline:{htmlSha256:v.browserBaselineSha256,htmlBytes:JSON.parse(readFileSync(join(directory,data.publishedMeasurement))).html},candidate:{htmlSha256:v.browserCandidateSha256,htmlBytes:data.html},cases:v.browserComparisons};
    writeFileSync(join(directory,report),JSON.stringify(value));
    const sha256=createHash('sha256').update(readFileSync(join(directory,report))).digest('hex');
    changeJson(directory,page,data=>data.browserEvidence={path:report,sha256});
  }
  const valid=fixture(t);createReport(valid);
  assert.equal(check(valid).status,0);
  const missing=fixture(t),newPage='measurements/page-new.json';
  copyFileSync(join(missing,page),join(missing,newPage));
  writeFileSync(join(missing,'README.md'),readFileSync(join(missing,'README.md'),'utf8')+'\n[New fixture]('+newPage+')\n');
  assert.match(check(missing,false,newPage).stderr,/Missing browser evidence reference/);
  const downgrade=fixture(t);changeJson(downgrade,page,data=>data.browserEvidence='measurements/legacy-report.json');
  assert.match(check(downgrade).stderr,/Unsupported legacy browser evidence reference/);
  const legacy=fixture(t),legacyPage='measurements/page-20261005-approved-copy.json';
  copyFileSync(join(legacy,page),join(legacy,legacyPage));
  changeJson(legacy,legacyPage,data=>data.browserEvidence='measurements/browser-20261005-approved-copy.json');
  writeFileSync(join(legacy,'README.md'),readFileSync(join(legacy,'README.md'),'utf8')+'\n[Legacy fixture]('+legacyPage+')\n');
  assert.equal(check(legacy,false,legacyPage).status,0);
  const stale=fixture(t);createReport(stale);
  changeJson(stale,report,data=>data.cases[0].identicalPixels=false);
  assert.match(check(stale).stderr,/Stale browser evidence hash/);
  for(const [change,error] of [
    [data=>data.verifierSha256='0'.repeat(64),/Browser report verifier mismatch/],
    [data=>data.handlerSha256='0'.repeat(64),/Browser report handler mismatch/],
    [data=>data.baseline.htmlBytes++,/Browser report baseline size mismatch/],
    [data=>data.candidate.htmlSha256='0'.repeat(64),/Browser report candidate mismatch/],
    [data=>data.baseline.htmlSha256='0'.repeat(64),/Browser report baseline mismatch/],
    [data=>data.candidate.htmlBytes++,/Browser report candidate size mismatch/],
    [data=>data.cases[0].identicalPixels=false,/Browser report cases mismatch/]
  ]) {
    const directory=fixture(t);createReport(directory);changeJson(directory,report,change);
    const sha256=createHash('sha256').update(readFileSync(join(directory,report))).digest('hex');
    changeJson(directory,page,data=>data.browserEvidence.sha256=sha256);
    const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,error);
  }
  const outside=fixture(t);createReport(outside);
  changeJson(outside,page,data=>data.browserEvidence.path='../outside.json');
  assert.match(check(outside).stderr,/Invalid browser evidence path/);
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
  copyFileSync(new URL('measurements/debugbear-20260922-recovered.json',project),join(directory,debugbear));
  const result=check(directory);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Stale DebugBear source hash/);
});

test('browser evidence must include the actual accessibility-attribute comparison',t=>{
  for(const value of [undefined,false]) {
    const directory=fixture(t);
    changeJson(directory,page,data=>{
      const entry=data.verification.browserComparisons[0];
      if(value===undefined)delete entry.identicalAccessibilityAttributes;
      else entry.identicalAccessibilityAttributes=value;
    });
    const result=check(directory);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/identicalAccessibilityAttributes/);
  }
});

test('fresh peer table rows cannot replace September gallery values',t=>{
  const directory=fixture(t),path=join(directory,'COMPARISON.md');
  const source=readFileSync(path,'utf8');
  const fresh='## Six-site sample — October 23, 2026\n\n| Website | TLS | Packet + DNS |\n| --- | ---: | ---: |\n| [Current sample](https://tomkimberlin.com/) | 1 (1–2) | 2 (2–3) |\n\n';
  writeFileSync(path,fresh+source);
  const result=check(directory);assert.equal(result.status,0,result.stderr);
});
test('a correct fresh row cannot conceal a stale historical row',t=>{
  const directory=fixture(t),path=join(directory,'COMPARISON.md');
  const source=readFileSync(path,'utf8');
  const own=source.split('\n').find(line=>line.startsWith('| ')&&line.includes('](https://tomkimberlin.com/)'));
  writeFileSync(path,own+'\n'+source.replace('**5,251**','**5,250**'));
  const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,/Stale comparison TLS median/);
});
test('historical gallery markers and URL rows must be unique',t=>{
  for(const mutate of [text=>text.replace('<!-- comparison:gallery:start -->',''),
    text=>text+'\n<!-- comparison:gallery:end -->',
    text=>{
      const start=text.indexOf('<!-- comparison:gallery:start -->'),end=text.indexOf('<!-- comparison:gallery:end -->');
      const historical=text.slice(start,end),row=historical.split('\n').find(line=>line.startsWith('| ')&&line.includes('](https://tomkimberlin.com/)'));
      assert.ok(row,'Historical fixture row is required');
      return text.slice(0,start)+historical.replace(row,row+'\n'+row)+text.slice(end);
    }]) {
    const directory=fixture(t),path=join(directory,'COMPARISON.md');writeFileSync(path,mutate(readFileSync(path,'utf8')));
    const result=check(directory);assert.notEqual(result.status,0);assert.match(result.stderr,/historical (gallery|comparison)/i);
  }
});
