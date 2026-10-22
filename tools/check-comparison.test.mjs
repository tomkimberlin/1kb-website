// Real saved evidence is copied into disposable ignored fixtures. No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync,gzipSync,deflateRawSync} from 'node:zlib';
import {checkComparison,renderCurrent,renderCandidate} from './check-comparison.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const integrated=existsSync(resolve(here,'../package.json'));
const repo=resolve(here,integrated?'..':'../../../..');
const scratch=integrated?resolve(repo,'optimization/comparison-test-fixtures'):resolve(here,'../test-fixtures');
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p));
const files={html:'index.html',brotli:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'};
const actualOverhead='measurements/overhead-20261022-openssl359.json';
const actualDeployment='measurements/deployment-20261022-openssl359.json';

function fixture(t) {
  mkdirSync(scratch,{recursive:true});
  const root=mkdtempSync(join(scratch,'fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'measurements'));mkdirSync(join(root,'public'));
  const names={overhead:'measurements/overhead-current.json',deployment:'measurements/deployment-current.json',page:'measurements/page-current.json',gallery:'measurements/gallery-20260922.json'};
  const data={overhead:json(resolve(repo,actualOverhead)),deployment:json(resolve(repo,actualDeployment)),page:json(resolve(repo,'measurements/page-20261022-accessibility-local.json')),gallery:json(resolve(repo,'measurements/gallery-20260922.json'))};
  const config={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',current:{},historicalGallery:null};
  const put=(name,value)=>writeFileSync(resolve(root,name),JSON.stringify(value,null,2)+'\n');
  function save(kind) {
    put(names[kind],data[kind]);const ref={path:names[kind],sha256:hash(readFileSync(resolve(root,names[kind])))};
    if(kind==='gallery')config.historicalGallery=ref;else config.current[kind]=ref;
  }
  for(const k of Object.keys(data))save(k);
  for(const file of Object.values(files))copyFileSync(resolve(repo,'public',file),resolve(root,'public',file));
  copyFileSync(resolve(repo,'index.html'),resolve(root,'index.html'));copyFileSync(resolve(repo,'build-report.json'),resolve(root,'build-report.json'));
  writeFileSync(resolve(root,'README.md'),readFileSync(resolve(repo,'README.md'),'utf8').replaceAll(actualOverhead,names.overhead));
  function document() {
    const old=data.gallery.summary.map(r=>`| [Site](${r.url}) | ${r.tls_median.toLocaleString('en-US')} | ${r.total_median.toLocaleString('en-US')} |`).join('\n');
    const candidate=config.candidate?renderCandidate(json(resolve(root,config.candidate.page.path)),config.candidate.page)+'\n\n':'';
    writeFileSync(resolve(root,'COMPARISON.md'),renderCurrent({...data,refs:config.current})+'\n\n'+candidate+'<!-- comparison:gallery:start -->\n## September 22, 2026 gallery\n\n| Website | TLS | Packet + DNS |\n| --- | ---: | ---: |\n'+old+'\n\n[Historical evidence]('+config.historicalGallery.path+')\n<!-- comparison:gallery:end -->\n');
  }
  function flush({doc=true}={}) {put('measurements/comparison-current.json',config);if(doc)document();}
  function candidate() {
    const source=Buffer.concat([readFileSync(resolve(root,'index.html')),Buffer.from('\n')]);
    const representations={html:source,brotli:brotliCompressSync(source),gzip:gzipSync(source),deflate:deflateRawSync(source)};
    const page={scope:'local build'},build={};
    for(const [key,bytes] of Object.entries(representations)) {writeFileSync(resolve(root,'public',files[key]),bytes);page[key]=build[key]=bytes.length;page[key+'Sha256']=hash(bytes);}
    writeFileSync(resolve(root,'index.html'),source);put('build-report.json',build);put('measurements/page-candidate.json',page);
    config.candidate={page:{path:'measurements/page-candidate.json',sha256:hash(readFileSync(resolve(root,'measurements/page-candidate.json')))}};flush();return page;
  }
  flush();
  return {root,data,config,save,put,flush,document,candidate,check:()=>checkComparison({root})};
}

test('current real evidence, complete totals and all live hashes pass',t=>{const f=fixture(t);assert.deepEqual(f.check(),{liveDate:'2026-10-22',localCandidate:false});});
test('pending local body change passes only with separately labeled exact candidate evidence',t=>{const f=fixture(t);f.candidate();assert.equal(f.check().localCandidate,true);});
test('body-only encoded representation change also requires a candidate',t=>{const f=fixture(t);const body=brotliCompressSync(readFileSync(join(f.root,'index.html')));writeFileSync(join(f.root,'public/index.html.br'),body);const build=json(join(f.root,'build-report.json'));build.brotli=body.length;f.put('build-report.json',build);assert.throws(f.check,/local candidate/);});
test('changed body without candidate cannot keep stale live claims',t=>{const f=fixture(t);f.candidate();delete f.config.candidate;f.flush();assert.throws(f.check,/local candidate/);});
test('candidate body hash must match the working artifact',t=>{const f=fixture(t);f.candidate();const p=json(join(f.root,'measurements/page-candidate.json'));p.brotliSha256='0'.repeat(64);f.put('measurements/page-candidate.json',p);f.config.candidate.page.sha256=hash(readFileSync(join(f.root,'measurements/page-candidate.json')));f.flush();assert.throws(f.check,/candidate evidence/);});
test('candidate requires a local evidence scope',t=>{const f=fixture(t);f.candidate();const p=json(join(f.root,'measurements/page-candidate.json'));delete p.scope;f.put('measurements/page-candidate.json',p);f.config.candidate.page.sha256=hash(readFileSync(join(f.root,'measurements/page-candidate.json')));f.flush();assert.throws(f.check,/explicitly local/);});
test('candidate section cannot be omitted',t=>{const f=fixture(t);f.candidate();const p=join(f.root,'COMPARISON.md');writeFileSync(p,readFileSync(p,'utf8').replace(/<!-- comparison:candidate:start -->[\s\S]*?<!-- comparison:candidate:end -->/,''));assert.throws(f.check,/candidate block/);});
test('remove candidate state once working equals published live',t=>{const f=fixture(t);f.config.candidate={page:f.config.current.page};f.flush();assert.throws(f.check,/Remove the local candidate/);});
test('unreferenced later live overhead invalidates old pointers even if body is unchanged',t=>{const f=fixture(t);const later=structuredClone(f.data.overhead);for(const r of later.runs)r.measuredAt='2026-10-22T18:59:20Z';f.put('measurements/overhead-newer.json',later);assert.throws(f.check,/newer own-site/);});
test('newer verified deployment invalidates old pointer with unchanged bytes',t=>{const f=fixture(t);f.put('measurements/deployment-newer.json',{...f.data.deployment,verifiedThrough:'2026-10-22T20:00:00Z'});assert.throws(f.check,/newer verified deployment/);});
test('malformed new deployment timestamp cannot fall back to an older valid timestamp',t=>{const f=fixture(t);f.data.deployment.verifiedThrough='not a timestamp';f.data.deployment.verifiedAt='2026-10-22T17:00:00Z';f.save('deployment');f.flush();assert.throws(f.check,/Invalid evidence timestamp/);});
test('later baseline-only preview does not pretend to be a live measurement',t=>{const f=fixture(t);f.put('measurements/overhead-baseline.json',{...f.data.overhead,phase:'baseline',runs:f.data.overhead.runs.map(r=>({...r,measuredAt:'2026-10-22T20:00:00Z'}))});assert.doesNotThrow(f.check);});
test('unrelated target deployment does not advance this site',t=>{const f=fixture(t);f.put('measurements/deployment-other.json',{url:'https://example.invalid/',verifiedAt:'2026-10-22T20:00:00Z'});assert.doesNotThrow(f.check);});
test('pointer cannot silently bless changed record bytes',t=>{const f=fixture(t);f.data.overhead.bodyBytes--;f.put(f.config.current.overhead.path,f.data.overhead);assert.throws(f.check,/hash is stale/);});
test('whole encoded body is subtracted, not an allowance or substring',t=>{const f=fixture(t);f.data.overhead.runs[0].tlsThroughBodyCompleteMinusBody++;f.save('overhead');f.flush();assert.throws(f.check,/whole encoded body/);});
test('median or range drift fails even when pointers are rehashed',t=>{const f=fixture(t);f.data.overhead.summary.estimatedTcpPlusDnsMinusBody.maximum++;f.save('overhead');f.flush();assert.throws(f.check,/summary is stale/);});
test('packet plus DNS arithmetic is verified',t=>{const f=fixture(t);f.data.overhead.runs[0].dnsIpv4UdpBytes++;f.save('overhead');f.flush();assert.throws(f.check,/packet\/DNS sum/);});
test('every sample binds the exact source/body',t=>{const f=fixture(t);f.data.overhead.runs[1].bodySha256='0'.repeat(64);f.save('overhead');f.flush();assert.throws(f.check,/sample body\/source/);});
test('duplicate raw hashes cannot count as three samples',t=>{const f=fixture(t);f.data.overhead.runs[1].privateRawSnapshotSha256=f.data.overhead.runs[0].privateRawSnapshotSha256;f.save('overhead');f.flush();assert.throws(f.check,/Duplicate samples/);});
test('sample time ordering is checked',t=>{const f=fixture(t);f.data.overhead.runs[0].measuredAt='2026-10-22T22:00:00Z';f.save('overhead');f.flush();assert.throws(f.check,/unordered timestamps/);});
test('current data must be live rather than a baseline preview',t=>{const f=fixture(t);f.data.overhead.phase='baseline';f.save('overhead');f.flush();assert.throws(f.check,/live samples/);});
test('server image binding cannot be replaced by client library metadata',t=>{const f=fixture(t);f.data.overhead.serverRuntime.imageId='sha256:'+'0'.repeat(64);f.save('overhead');f.flush();assert.throws(f.check,/runtime image/);});
test('actual deployment release must match measured runtime readback',t=>{const f=fixture(t);f.data.deployment.pageRelease+='-wrong';f.save('deployment');f.flush();assert.throws(f.check,/page release/);});
test('actual deployed source commit is checked',t=>{const f=fixture(t);f.data.deployment.pageCommit=f.data.overhead.pageCommit='f7a51b1'.padEnd(40,'0');f.save('deployment');f.save('overhead');f.flush();assert.throws(f.check);});
test('all four deployed representations must be verified and unique',t=>{const f=fixture(t);f.data.deployment.pageRepresentations[3]=f.data.deployment.pageRepresentations[0];f.save('deployment');f.flush();assert.throws(f.check,/representation/);});
test('fallback body changes cannot retain stale deployment evidence',t=>{const f=fixture(t);f.data.page.gzip--;f.save('page');f.flush();assert.throws(f.check,/representations differ/);});
test('stale displayed totals fail even if live pointers are valid',t=>{const f=fixture(t);const p=join(f.root,'COMPARISON.md');writeFileSync(p,readFileSync(p,'utf8').replace('5,642 B','5,641 B'));assert.throws(f.check,/section is stale/);});
test('historical gallery stays scoped and unchanged',t=>{const f=fixture(t);const p=join(f.root,'COMPARISON.md');writeFileSync(p,readFileSync(p,'utf8').replace('| 5,251 | 6,995 |','| 5,252 | 6,995 |'));assert.throws(f.check,/Historical gallery values/);});
test('historical duplicate site rows fail',t=>{const f=fixture(t);const p=join(f.root,'COMPARISON.md'),s=readFileSync(p,'utf8'),row=s.split('\n').find(l=>l.includes('](https://tomkimberlin.com/)'));writeFileSync(p,s.replace(row,row+'\n'+row));assert.throws(f.check,/missing or duplicated/);});
test('duplicate current section cannot conceal stale content',t=>{const f=fixture(t);const p=join(f.root,'COMPARISON.md');writeFileSync(p,readFileSync(p,'utf8')+'<!-- comparison:current:start -->');assert.throws(f.check,/duplicate comparison current/);});
test('relative paths cannot escape the public evidence directory',t=>{const f=fixture(t);f.config.current.overhead.path='../private.json';f.flush();assert.throws(f.check,/Invalid comparison evidence reference/);});
test('object key ordering is not a measurement change',t=>{const f=fixture(t);const s=f.data.overhead.summary.tlsThroughBodyCompleteMinusBody;f.data.overhead.summary.tlsThroughBodyCompleteMinusBody={maximum:s.maximum,minimum:s.minimum,median:s.median};f.save('overhead');f.flush();assert.doesNotThrow(f.check);});
test('README latest evidence link must advance with the pointer',t=>{const f=fixture(t);const p=join(f.root,'README.md');writeFileSync(p,readFileSync(p,'utf8').replace('](measurements/overhead-current.json)','](measurements/overhead-20261005.json)'));assert.throws(f.check,/Stale README latest/);});
test('README latest median cannot drift',t=>{const f=fixture(t);const p=join(f.root,'README.md');writeFileSync(p,readFileSync(p,'utf8').replace('Latest verified result: 6,945 B','Latest verified result: 6,944 B'));assert.throws(f.check,/Stale README latest/);});
test('README latest range cannot drift',t=>{const f=fixture(t);const p=join(f.root,'README.md');writeFileSync(p,readFileSync(p,'utf8').replace('(6,894–6,996 B)','(6,895–6,996 B)'));assert.throws(f.check,/Stale README latest/);});
