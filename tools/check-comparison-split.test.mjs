// All future-looking records and log hashes below are synthetic test data.
// They do not represent a deployment, response, browser run or measurement.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,cpSync,copyFileSync,symlinkSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync,inflateSync} from 'node:zlib';
import {checkComparison,renderSplitPage,renderMeasuredHistory,renderSplitCandidate} from './check-comparison.mjs';
import {actualAdjacentBinding} from './check-adjacent-streams.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(readFileSync(p));
const hash=x=>createHash('sha256').update(x).digest('hex');
const scratch=resolve(repo,'optimization');mkdirSync(scratch,{recursive:true});
const temp=mkdtempSync(join(scratch,'split-synthetic-'));
after(()=>rmSync(temp,{recursive:true,force:true}));
const gitRoot=join(temp,'git'),empty=join(temp,'empty');mkdirSync(gitRoot);mkdirSync(empty);
// Prevent injected object stores, replacement objects and user git hooks.
for(const key of Object.keys(process.env))if(key.startsWith('GIT_'))delete process.env[key];
Object.assign(process.env,{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'});
const env={...process.env,GIT_AUTHOR_NAME:'Synthetic test',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_AUTHOR_DATE:'2026-11-01T00:00:00Z',
 GIT_COMMITTER_NAME:'Synthetic test',GIT_COMMITTER_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_DATE:'2026-11-01T00:00:00Z'};
const git=(cwd,args,options={})=>execFileSync('git',args,{cwd,env,maxBuffer:64*1024*1024,...options});
git(gitRoot,['init','--quiet','--object-format=sha1',`--template=${empty}`]);
const historic=read(join(repo,'measurements/deployment-20261025-adjacent.json')).pageCommit;
const pack=git(repo,['pack-objects','--stdout','--revs'],{input:`${historic}\n${actualAdjacentBinding.normalizer.sourceCommit}\n2fa4e3fe7e2b6863f6a62ab46fd7dbdafb459e0a\n`});
git(gitRoot,['index-pack','--stdin'],{input:pack});
// The synthetic page commit only contains test inputs and reviewed validators.
for(const file of ['index.html','tools/verify-page.mjs','server/site.js','server/deploy.sh','build.mjs','server/verify.mjs','server/verify-alias.mjs','server/verify-response.mjs']) {
 mkdirSync(dirname(join(gitRoot,file)),{recursive:true});copyFileSync(join(repo,file==='index.html'?'tools/fixtures/comparison-split/index.html':file),join(gitRoot,file));
}
mkdirSync(join(gitRoot,'compression'));
copyFileSync(join(repo,'tools/fixtures/comparison-split/index.html.gz'),join(gitRoot,'compression/index.html.gz'));
git(gitRoot,['add','index.html','compression/index.html.gz','tools/verify-page.mjs','server/site.js','server/deploy.sh','build.mjs','server/verify.mjs','server/verify-alias.mjs','server/verify-response.mjs']);
git(gitRoot,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','--no-verify','-m','Synthetic page fixture']);
const commit=git(gitRoot,['rev-parse','HEAD']).toString().trim();
const treeId=git(gitRoot,['rev-parse',commit+'^{tree}']).toString().trim();
// Each additional commit has the same HTML and reviewed tools but different
// compressed inputs, so an identity-only provenance check cannot distinguish it.
const source=readFileSync(join(gitRoot,'index.html'));
let stockGzip;
for(let level=1;level<=9;level++)for(let strategy=0;strategy<=4;strategy++) {
 const candidate=gzipSync(source,{level,strategy});
 if(!stockGzip||candidate.length<stockGzip.length)stockGzip=candidate;
}
function gzipCommit(label,bytes) {
 const path='compression/index.html.gz';
 if(bytes===null)git(gitRoot,['rm','--quiet','--',path]);
 else {mkdirSync(dirname(join(gitRoot,path)),{recursive:true});writeFileSync(join(gitRoot,path),bytes);git(gitRoot,['add','--',path]);}
 git(gitRoot,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','--no-verify','-m',label]);
 return git(gitRoot,['rev-parse','HEAD']).toString().trim();
}
const noSavedCommit=gzipCommit('Synthetic stock gzip',null);
mkdirSync(join(gitRoot,'compression'),{recursive:true});
writeFileSync(join(gitRoot,'compression/other.bin'),'other compressed input');
git(gitRoot,['add','--','compression/other.bin']);
git(gitRoot,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','--no-verify','-m','Synthetic stock gzip with directory']);
const noSavedWithDirectoryCommit=git(gitRoot,['rev-parse','HEAD']).toString().trim();
const differentGzipCommit=gzipCommit('Synthetic different gzip',gzipSync(source,{level:9}));
const oversizedGzip=gzipSync(source,{level:1,strategy:2});
assert.ok(oversizedGzip.length>stockGzip.length&&oversizedGzip.length<1024);
const oversizedGzipCommit=gzipCommit('Synthetic oversized gzip',oversizedGzip);
const tiedGzip=Buffer.from(stockGzip);tiedGzip[4]=1;
const tiedGzipCommit=gzipCommit('Synthetic tied gzip',tiedGzip);
const staleGzipCommit=gzipCommit('Synthetic stale gzip',gzipSync(Buffer.from('A different source')));
const overDecodeLimitCommit=gzipCommit('Synthetic large unrelated source',gzipSync(Buffer.alloc((1<<20)+1,65)));
const malformedGzipCommit=gzipCommit('Synthetic malformed gzip',Buffer.from('not a gzip member'));
const savedFixture=readFileSync(join(repo,'tools/fixtures/comparison-split/index.html.gz'));
const trailingGzip=Buffer.concat([savedFixture,Buffer.from([0])]);
const trailingGzipCommit=gzipCommit('Synthetic trailing gzip',trailingGzip);
const concatenatedGzip=Buffer.concat([savedFixture,savedFixture]);
const concatenatedGzipCommit=gzipCommit('Synthetic concatenated gzip',concatenatedGzip);
const optionalGzip=Buffer.concat([savedFixture.subarray(0,10),Buffer.from([120,0]),savedFixture.subarray(10)]);
optionalGzip[3]=8;
assert.deepEqual(gunzipSync(optionalGzip),source);
const optionalGzipCommit=gzipCommit('Synthetic optional gzip field',optionalGzip);
git(gitRoot,['rm','--quiet','-r','--','compression']);
symlinkSync('elsewhere',join(gitRoot,'compression'));
git(gitRoot,['add','--','compression']);
git(gitRoot,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','--no-verify','-m','Synthetic symlink parent']);
const symlinkGzipParentCommit=git(gitRoot,['rev-parse','HEAD']).toString().trim();
const cases=join(gitRoot,'cases');mkdirSync(cases);
const fileNames={html:'index.html',brotli:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'};
const map={identity:'html',br:'brotli',gzip:'gzip',deflate:'deflate'};
// Synthetic cases branch from the last maintenance deployment. Keep all older
// evidence, but remove newer own-page deployments from each disposable copy.
// Malformed or misplaced records remain for the validator to reject.
function timestampParts(value) {
 const match=typeof value==='string'&&/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(?:Z|\+00:00)$/.exec(value);
 if(!match)return null;
 const second=Date.parse(match[1]+'Z');
 return Number.isFinite(second)&&new Date(second).toISOString().slice(0,19)===match[1]?[second,match[2]??'']:null;
}
function laterThan(a,b) {
 if(a[0]!==b[0])return a[0]>b[0];
 const width=Math.max(a[1].length,b[1].length);
 return a[1].padEnd(width,'0')>b[1].padEnd(width,'0');
}
function isolateDeployments(root,cutoff) {
 const measurements=join(root,'measurements'),baseline=timestampParts(cutoff);
 assert.ok(baseline);
 for(const name of readdirSync(measurements)) {
  if(!/^(?:deployment|maintenance)-[A-Za-z0-9._-]+\.json$/.test(name))continue;
  const path=join(measurements,name);let record,url;
  if(lstatSync(path).isSymbolicLink())continue;
  try {record=read(path);} catch {continue;}
  if(typeof record?.url!=='string'||record.url.trim()!==record.url||!record.url)continue;
  try {url=new URL(record.url);} catch {continue;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port
    ||!['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'].includes(url.hostname)||!['/','/index.html'].includes(url.pathname))continue;
  const pageDeployment=['content-update-deployment','page-only-deployment'].includes(record.kind);
  if((!pageDeployment&&!name.startsWith('deployment-'))||(record.kind==='page-only-deployment'&&!name.startsWith('deployment-')))continue;
  const values=pageDeployment?['verifiedAt','verifiedThrough'].filter(key=>Object.hasOwn(record,key)).map(key=>record[key]):[record.verifiedThrough??record.verifiedAt];
  const times=values.map(timestampParts);
  if(times.length&&times.every(Boolean)&&times.some(time=>laterThan(time,baseline)))rmSync(path);
 }
}
function fixture(t,seed=()=>{}) {
 const root=mkdtempSync(join(cases,'case-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 cpSync(join(repo,'measurements'),join(root,'measurements'),{recursive:true});
 seed(root);
 isolateDeployments(root,read(join(root,'measurements/maintenance-20261025-intune-name.json')).verifiedAt);
 mkdirSync(join(root,'public'));
 for(const file of Object.values(fileNames))copyFileSync(join(repo,'tools/fixtures/comparison-split',file),join(root,'public',file));
 copyFileSync(join(repo,'tools/fixtures/comparison-split/index.html'),join(root,'index.html'));
 const build=Object.fromEntries(Object.entries(fileNames).map(([key,file])=>[key,readFileSync(join(root,'public',file)).length]));
 writeFileSync(join(root,'build-report.json'),JSON.stringify(build));
 const config=read(join(root,'measurements/comparison-current.json')),old=structuredClone(config.schemaVersion===2?config.measured:config.current);
 config.schemaVersion=2;config.measured=old;config.current={};delete config.candidate;
 const historical={page:read(join(root,old.page.path)),deployment:read(join(root,old.deployment.path)),overhead:read(join(root,old.overhead.path)),refs:old};
 for(const [name,key] of [['quic','quicTransportParameters'],['statusEncoding','statusEncoding'],['peerComparison','peerComparison'],['streamOffsets','quicStreamOffsets'],['finCoalescing','quicFinCoalescing'],['streamLengths','quicStreamLengthEncoding'],['adjacentStreams','quicAdjacentStreams']])historical[name]=historical.deployment[key]?read(join(root,historical.deployment[key].path)):null;
 const page=read(join(root,'measurements/page-20261027-brotli-first-local.json'));
 const rows=()=>Object.entries(map).map(([encoding,key])=>({encoding,bytes:page[key],sha256:page[key+'Sha256'],contentEncoding:encoding==='identity'?null:encoding}));
 const toolSha256=Object.fromEntries(['server/deploy.sh','build.mjs','server/verify.mjs','server/verify-alias.mjs','server/verify-response.mjs'].map(path=>[path,hash(readFileSync(join(repo,path)))]));
 const release='releases/synthetic-test-only',image='sha256:'+'3'.repeat(64);
 const deployment={schemaVersion:2,kind:'page-only-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-11-01T12:00:30Z',
  pageCommit:commit,pageRelease:release,runtime:{imageId:image,running:true},representations:rows(),
  aliases:['www.tomkimberlin.com','tom.kimberlin.net'].map(host=>({host,location:'https://tomkimberlin.com/'})),
  verification:{window:{startedAt:'2026-11-01T12:00:00Z',completedAt:'2026-11-01T12:00:10Z'},
   originReleaseMarkerVerified:true,originRepresentationsVerified:true,publicRepresentationsVerified:true,aliasesVerified:true,normalCertificateValidation:true,
   publicVerificationEnvironment:Object.fromEntries(['ONEKB_TEST_IP','ONEKB_TEST_HTTP_PORT','ONEKB_TEST_HTTPS_PORT','ONEKB_ALIAS_IP','CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','DYLD_INSERT_LIBRARIES','LD_PRELOAD'].map(k=>[k,null])),
   publicEnvironmentRecordedAt:'2026-11-01T12:00:06Z',
   privateLogHashes:{deploy:'a'.repeat(64),build:'b'.repeat(64),live:'c'.repeat(64),alias:'d'.repeat(64),publicEnvironment:'e'.repeat(64),readback:'f'.repeat(64)},
   fileReadbacks:Object.fromEntries([['preflight','2026-11-01T11:59:59Z','1'],['postBuild','2026-11-01T12:00:05Z','2'],['release','2026-11-01T12:00:30Z','f']].map(([kind,observedAt,seed])=>[kind,{observedAt,passed:true,privateReadbackSha256:seed.repeat(64),...(kind==='release'?{pageRelease:release}:{}),files:Object.entries(map).map(([encoding,key])=>({encoding,file:{identity:'index.html',br:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'}[encoding],bytes:page[key],sha256:page[key+'Sha256']}))}])),
   readback:{verifiedAt:'2026-11-01T12:00:30Z',pageRelease:release,imageId:image,running:true,normalCertificateValidation:true},toolSha256}};
 const paths={deployment:'measurements/deployment-synthetic-split.json',page:'measurements/page-20261027-brotli-first-local.json'};
 const put=(path,value)=>writeFileSync(join(root,path),JSON.stringify(value,null,2)+'\n');
 const data={deployment,page};
 function save(key){if(key==='deployment')put(paths[key],data[key]);config.current[key]={path:paths[key],sha256:hash(readFileSync(join(root,paths[key])))};}
 save('page');save('deployment');
 function document() {
  const nowPage=read(join(root,config.current.page.path)),nowDeployment=read(join(root,config.current.deployment.path));
  const candidate=config.candidate?renderSplitCandidate(read(join(root,config.candidate.page.path)),config.candidate.page)+'\n\n':'';
  const gallery=read(join(root,config.historicalGallery.path));
  const n=x=>x.toLocaleString('en-US'),sum=historical.overhead.summary.estimatedTcpPlusDnsMinusBody;
  writeFileSync(join(root,'README.md'),`**Latest measured transport result: ${n(sum.median)} B estimated overhead, October 25, 2026.** (${n(sum.minimum)}–${n(sum.maximum)} B). [Evidence](${old.overhead.path}).\n`);
  const rows=gallery.summary.map(r=>`| [Site](${r.url}) | ${n(r.tls_median)} | ${n(r.total_median)} |`).join('\n');
  writeFileSync(join(root,'COMPARISON.md'),renderSplitPage({page:nowPage,deployment:nowDeployment,refs:config.current})+'\n\n'+renderMeasuredHistory(historical)+'\n\n'+candidate+
   '<!-- comparison:gallery:start -->\n## September 22, 2026\n\n| Website | TLS | Packet + DNS |\n| --- | ---: | ---: |\n'+rows+'\n\n[Historical evidence]('+config.historicalGallery.path+')\n<!-- comparison:gallery:end -->\n');
 }
 function flush({doc=true}={}){put('measurements/comparison-current.json',config);if(doc)document();}
 function useMaintenance() {
  rmSync(join(root,paths.deployment));
  config.current={deployment:{path:'measurements/maintenance-20261025-intune-name.json',sha256:hash(readFileSync(join(root,'measurements/maintenance-20261025-intune-name.json')))},
   page:{path:'measurements/page-20261025-intune-name-local.json',sha256:hash(readFileSync(join(root,'measurements/page-20261025-intune-name-local.json')))}};
  config.candidate={page:{path:paths.page,sha256:hash(readFileSync(join(root,paths.page)))} };flush();
 }
 flush();return {root,config,data,old,historical,paths,put,save,flush,useMaintenance,check:()=>checkComparison({root})};
}

test('synthetic newer page remains independent from actual measured transport and components',t=>{const f=fixture(t),result=f.check();assert.equal(result.liveDate,'2026-11-01');assert.equal(result.measuredDate,'2026-10-25');assert.equal(result.localCandidate,false);});
test('the retained maintenance record can be the latest page before a candidate is deployed',t=>{const f=fixture(t);f.useMaintenance();const result=f.check();assert.equal(result.liveDate,'2026-10-25');assert.equal(result.localCandidate,true);});
test('fixture isolates later copied deployments while retaining older, equal and unrelated records',t=>{
 const records={
  'deployment-later-page.json':{kind:'page-only-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-10-25T17:20:17.879109+00:00',verifiedThrough:'2026-10-25T17:20:17.879107Z'},
  'maintenance-later-content.json':{kind:'content-update-deployment',url:'http://tom.kimberlin.net/index.html?release=1#top',verifiedAt:'2026-11-02T00:00:00Z'},
  'deployment-later-legacy.json':{url:'https://www.tomkimberlin.com/',verifiedAt:'invalid',verifiedThrough:'2026-11-02T00:00:00Z'},
  'deployment-later-legacy-at.json':{url:'https://tomkimberlin.com/',verifiedAt:'2026-11-02T00:00:00Z'},
  'deployment-legacy-uses-through.json':{url:'https://tomkimberlin.com/',verifiedAt:'2026-11-02T00:00:00Z',verifiedThrough:'2026-10-25T17:20:17.879107Z'},
  'deployment-earlier.json':{url:'https://tomkimberlin.com/',verifiedAt:'2026-10-25T17:20:17.879107Z'},
  'deployment-equal.json':{url:'https://tomkimberlin.com/',verifiedAt:'2026-10-25T17:20:17.8791080Z'},
  'deployment-unrelated.json':{url:'https://example.com/',verifiedAt:'2026-11-02T00:00:00Z'}
 };
 const f=fixture(t,root=>{for(const [name,value] of Object.entries(records))writeFileSync(join(root,'measurements',name),JSON.stringify(value));});
 for(const name of ['deployment-later-page.json','maintenance-later-content.json','deployment-later-legacy.json','deployment-later-legacy-at.json'])assert.equal(existsSync(join(f.root,'measurements',name)),false);
 for(const name of ['deployment-earlier.json','deployment-equal.json','deployment-unrelated.json','deployment-legacy-uses-through.json'])assert.deepEqual(read(join(f.root,'measurements',name)),records[name]);
 f.useMaintenance();assert.doesNotThrow(f.check);
});
test('fixture isolation retains malformed copied deployment evidence for validation',t=>{
 const name='measurements/deployment-malformed-fixture.json';
 const f=fixture(t,root=>writeFileSync(join(root,name),JSON.stringify({kind:'page-only-deployment',url:'https://tomkimberlin.com/',verifiedAt:'invalid',verifiedThrough:'2026-11-02T00:00:00Z'})));
 assert.ok(existsSync(join(f.root,name)));f.useMaintenance();assert.throws(f.check,/timestamp/i);
});
test('fixture isolation leaves copied symlinks for the confinement check',t=>{
 const name='measurements/deployment-escape-fixture.json';
 const f=fixture(t,root=>{const outside=join(root,'outside-fixture.json');writeFileSync(outside,JSON.stringify({url:'https://tomkimberlin.com/',verifiedAt:'2026-11-02T00:00:00Z'}));symlinkSync(outside,join(root,name));});
 assert.ok(lstatSync(join(f.root,name)).isSymbolicLink());f.useMaintenance();assert.throws(f.check,/escapes measurements/i);
});
test('real current deployment still validates and invalidates the historical fixture when added',t=>{
 const ref=read(join(repo,'measurements/comparison-current.json')).current.deployment;
 const actual=readFileSync(join(repo,ref.path)),record=JSON.parse(actual),f=fixture(t);
 f.useMaintenance();assert.doesNotThrow(f.check);
 assert.ok(laterThan(timestampParts(record.verifiedAt),timestampParts(read(join(repo,'measurements/maintenance-20261025-intune-name.json')).verifiedAt)));
 copyFileSync(join(repo,ref.path),join(f.root,ref.path));assert.throws(f.check,/newer verified deployment/i);
 assert.deepEqual(readFileSync(join(repo,ref.path)),actual);
 assert.equal(checkComparison({root:repo}).liveDate,record.verifiedAt.slice(0,10));
});
test('downgrading to the actual v1 measured pointer cannot hide the later retained maintenance deployment',t=>{
 const f=fixture(t);f.useMaintenance();f.config.schemaVersion=1;f.config.current=f.config.measured;delete f.config.measured;f.flush({doc:false});
 assert.throws(f.check,/newer verified deployment/i);
});
test('split state rejects malformed recognized maintenance evidence',t=>{
 const f=fixture(t);f.useMaintenance();f.put('measurements/maintenance-malformed.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/'});
 assert.throws(f.check,/timestamp/i);
});
test('split state rejects a newer maintenance verification within the same millisecond',t=>{
 const f=fixture(t);f.useMaintenance();f.put('measurements/maintenance-microseconds.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-10-25T17:20:17.879109Z'});
 assert.throws(f.check,/newer verified deployment/i);
});
test('split state recognizes same-page URL variations in later page-only deployments',t=>{
 const f=fixture(t);f.useMaintenance();f.put('measurements/deployment-page-variant.json',{kind:'page-only-deployment',url:'https://TOMKIMBERLIN.COM:443/?v=release#section',verifiedAt:'2026-12-01T00:00:00Z'});
 assert.throws(f.check,/newer verified deployment/i);
});
test('split state recognizes same-page URL variations in later legacy deployments',t=>{
 const f=fixture(t);f.useMaintenance();f.put('measurements/deployment-legacy-variant.json',{url:'https://TOMKIMBERLIN.COM:443/?v=release#section',verifiedAt:'2026-12-01T00:00:00Z'});
 assert.throws(f.check,/newer verified deployment/i);
});
test('split state recognizes a later verified deployment through a known redirect',t=>{
 const f=fixture(t);f.useMaintenance();f.put('measurements/maintenance-redirect.json',{kind:'content-update-deployment',url:'http://tom.kimberlin.net/index.html?v=1',verifiedAt:'2026-12-01T00:00:00Z'});
 assert.throws(f.check,/newer verified deployment/i);
});
test('split state confines scanned references to measurements',t=>{
 const f=fixture(t),outside=join(f.root,'synthetic-outside.json');writeFileSync(outside,'SYNTHETIC_PRIVATE_SENTINEL');
 symlinkSync(outside,join(f.root,'measurements/maintenance-escape.json'));
 assert.throws(f.check,error=>/escapes measurements/i.test(error.message)&&!error.message.includes('SYNTHETIC_PRIVATE_SENTINEL'));
});
test('synthetic fixture has no dependency on the old candidate commit',t=>{const r=spawnSync('git',['cat-file','-e','41d09e8eb85faeecd39dea397169a5f3a49d83b2^{commit}'],{cwd:gitRoot,env,stdio:'ignore'});assert.notEqual(r.status,0);assert.notEqual(commit,'41d09e8eb85faeecd39dea397169a5f3a49d83b2');fixture(t).check();});
test('latest page record must match pointer hash',t=>{const f=fixture(t);f.data.deployment.runtime.running=false;f.put(f.paths.deployment,f.data.deployment);assert.throws(f.check,/hash/i);});
test('historical page cannot be replaced even when its pointer is rehashed',t=>{const f=fixture(t);f.config.measured.page=f.config.current.page;f.flush();assert.throws(f.check,/historical.*anchor/i);});
test('historical overhead cannot be silently modified and rehashed',t=>{const f=fixture(t);const path=f.old.overhead.path,p=read(join(f.root,path));p.runs[0].tlsThroughBodyComplete.received++;f.put(path,p);f.config.measured.overhead.sha256=hash(readFileSync(join(f.root,path)));f.flush();assert.throws(f.check,/historical.*anchor/i);});
test('historical component evidence cannot be modified',t=>{const f=fixture(t),ref=f.historical.deployment.statusEncoding,path=join(f.root,ref.path),value=read(path);value.after.rows.h2.main.bodyBytes++;writeFileSync(path,JSON.stringify(value));assert.throws(f.check,/hash/i);});
test('historical transport must subtract the entire old body',t=>{const f=fixture(t);const path=join(f.root,f.old.overhead.path),value=read(path);value.runs[0].tlsThroughBodyCompleteMinusBody++;writeFileSync(path,JSON.stringify(value));assert.throws(f.check,/hash/i);});
for(const [label,change] of [
 ['different immutable page commit',d=>d.pageCommit='0'.repeat(40)],
 ['bad release',d=>d.pageRelease='current'],['different release in readback',d=>d.verification.readback.pageRelease='releases/other'],
 ['bad runtime image',d=>d.runtime.imageId='sha256:'+'0'.repeat(64)],['stopped runtime',d=>d.runtime.running=false],
 ['bad tool source hash',d=>d.verification.toolSha256['server/verify.mjs']='0'.repeat(64)],
 ['missing deploy log',d=>delete d.verification.privateLogHashes.deploy],['missing build log',d=>delete d.verification.privateLogHashes.build],
 ['missing live log',d=>delete d.verification.privateLogHashes.live],['missing alias log',d=>delete d.verification.privateLogHashes.alias],['missing public environment log',d=>delete d.verification.privateLogHashes.publicEnvironment],['missing final readback log',d=>delete d.verification.privateLogHashes.readback],
 ['reused final readback log',d=>d.verification.privateLogHashes.readback=d.verification.privateLogHashes.deploy],
 ['origin release marker fails',d=>d.verification.originReleaseMarkerVerified=false],
 ['origin aggregate verification fails',d=>d.verification.originRepresentationsVerified=false],
 ['public aggregate verification fails',d=>d.verification.publicRepresentationsVerified=false],
 ['aggregate alias verification fails',d=>d.verification.aliasesVerified=false],
 ['normal trust fails',d=>d.verification.normalCertificateValidation=false],['readback trust fails',d=>d.verification.readback.normalCertificateValidation=false],
 ['page verification before local page measurement',d=>d.verification.window.startedAt='2026-10-20T00:00:00Z'],
 ['readback before verification ends',d=>d.verification.readback.verifiedAt='2026-11-01T12:00:05Z'],
 ['readback after deployment verification',d=>d.verification.readback.verifiedAt='2026-11-01T12:00:31Z'],
 ['latest page before prior verified maintenance',d=>{d.verifiedAt='2026-10-25T12:00:00Z';d.verification.window.startedAt='2026-10-25T11:00:00Z';d.verification.window.completedAt='2026-10-25T11:00:10Z';d.verification.readback.verifiedAt='2026-10-25T11:00:20Z';}],
])test('rejects '+label,t=>{const f=fixture(t);change(f.data.deployment);f.save('deployment');f.flush();assert.throws(f.check);});
for(const [label,change] of [
 ['missing encoding',rows=>rows.pop()],['duplicate encoding',rows=>rows[1].encoding=rows[0].encoding],['wrong bytes',rows=>rows[0].bytes++],
 ['wrong hash',rows=>rows[1].sha256='0'.repeat(64)],['wrong content encoding',rows=>rows[1].contentEncoding='gzip'],
 ['identity content encoding',rows=>rows[0].contentEncoding='identity']
])test(`rejects expected representation ${label}`,t=>{const f=fixture(t);change(f.data.deployment.representations);f.save('deployment');f.flush();assert.throws(f.check,/representation/i);});
for(const [label,change] of [
 ['missing',a=>a.pop()],['duplicate',a=>a[1].host=a[0].host],['wrong destination',a=>a[0].location='https://example.com/']
])test('rejects expected alias '+label,t=>{const f=fixture(t);change(f.data.deployment.aliases);f.save('deployment');f.flush();assert.throws(f.check,/alias/i);});
test('browser report hash stays bound to the latest page',t=>{const f=fixture(t);const ref=f.data.page.browserEvidence,path=join(f.root,ref.path),v=read(path);v.cases[0].identicalPixels=false;writeFileSync(path,JSON.stringify(v));assert.throws(f.check,/hash/i);});
test('stale current page section cannot claim historic sizes',t=>{const f=fixture(t),path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace('1,040 B HTML','1,021 B HTML'));assert.throws(f.check,/current page.*stale/i);});
test('measured section cannot attribute old totals to latest page',t=>{const f=fixture(t),path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace('1,021 B HTML','1,040 B HTML'));assert.throws(f.check,/historical measured.*stale/i);});
test('README must identify the old value as measured transport',t=>{const f=fixture(t),path=join(f.root,'README.md');writeFileSync(path,readFileSync(path,'utf8').replace('Latest measured transport result','Latest verified result'));assert.throws(f.check,/README/i);});
test('later verified deployment invalidates the latest page pointer',t=>{const f=fixture(t);f.put('measurements/deployment-newer.json',{url:'https://tomkimberlin.com/',verifiedAt:'2026-12-01T00:00:00Z'});assert.throws(f.check,/newer verified deployment/i);});
test('later measured transport invalidates the dated measured pointer',t=>{const f=fixture(t);const p=structuredClone(f.historical.overhead);for(const r of p.runs)r.measuredAt='2026-12-01T00:00:00Z';f.put('measurements/overhead-newer.json',p);assert.throws(f.check,/newer own-site/i);});
test('source commit must contain the verified page even if it names another real commit',t=>{const f=fixture(t);f.data.deployment.pageCommit='2fa4e3fe7e2b6863f6a62ab46fd7dbdafb459e0a';f.save('deployment');f.flush();assert.throws(f.check,/immutable commit|verifier/i);});
test('a tree object containing identical files cannot be used as a page commit',t=>{
 const f=fixture(t);f.data.deployment.pageCommit=treeId;f.save('deployment');f.flush();
 assert.throws(f.check,/source reference must be a Git commit/i);
});
test('same HTML and verifier cannot hide a different committed gzip member',t=>{
 const f=fixture(t);f.data.deployment.pageCommit=differentGzipCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/gzip.*immutable commit/i);
});
function installFallbackEvidence(f,gzip) {
 let a=1,b=0;for(const byte of source){a=(a+byte)%65521;b=(b+a)%65521;}
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE((b*65536+a)>>>0);
 const deflate=Buffer.concat([Buffer.from([120,218]),gzip.subarray(10,-8),checksum]);
 for(const [key,bytes,file] of [['gzip',gzip,'index.html.gz'],['deflate',deflate,'index.html.deflate']]) {
  f.data.page[key]=bytes.length;f.data.page[key+'Sha256']=hash(bytes);
  writeFileSync(join(f.root,'public',file),bytes);
  const row=f.data.deployment.representations.find(row=>row.encoding===key);row.bytes=bytes.length;row.sha256=hash(bytes);
  for(const readback of Object.values(f.data.deployment.verification.fileReadbacks)) {
   const entry=readback.files.find(row=>row.encoding===key);entry.bytes=bytes.length;entry.sha256=hash(bytes);
  }
 }
 // The frozen native-encoding report measured the old member, not this
 // synthetic member; normal/font reports still match the same HTML.
 delete f.data.page.nativeEncodingEvidence;
 const build=read(join(f.root,'build-report.json'));build.gzip=gzip.length;build.deflate=deflate.length;
 writeFileSync(join(f.root,'build-report.json'),JSON.stringify(build));
 f.put(f.paths.page,f.data.page);f.save('page');
}
const installStockEvidence=f=>installFallbackEvidence(f,stockGzip);
for(const [label,target] of [['no saved candidate',noSavedCommit],['directory without saved candidate',noSavedWithDirectoryCommit],['valid unrelated candidate',staleGzipCommit]])test('stock gzip can be reproduced with '+label,t=>{
 const f=fixture(t);installStockEvidence(f);f.data.deployment.pageCommit=target;f.save('deployment');f.flush();
 assert.doesNotThrow(f.check);
});
test('a saved candidate wins a stock tie, so the stock member cannot be claimed',t=>{
 const f=fixture(t);installStockEvidence(f);f.data.deployment.pageCommit=tiedGzipCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/gzip.*immutable commit/i);
});
test('matching saved-member evidence cannot claim a gzip larger than the stock winner',t=>{
 const f=fixture(t);installFallbackEvidence(f,oversizedGzip);f.data.deployment.pageCommit=oversizedGzipCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/gzip.*immutable commit/i);
});
test('a malformed committed gzip cannot be ignored as a stock build',t=>{
 const f=fixture(t);installStockEvidence(f);f.data.deployment.pageCommit=malformedGzipCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/invalid committed gzip candidate/i);
});
test('an unrelated saved gzip exceeding the decode bound fails closed',t=>{
 const f=fixture(t);installStockEvidence(f);f.data.deployment.pageCommit=overDecodeLimitCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/invalid committed gzip candidate/i);
});
for(const [label,target,gzip] of [
 ['trailing bytes',trailingGzipCommit,trailingGzip],
 ['concatenated member',concatenatedGzipCommit,concatenatedGzip],
 ['optional field',optionalGzipCommit,optionalGzip]
])test('rejects matching committed gzip evidence with '+label,t=>{
 const f=fixture(t);installFallbackEvidence(f,gzip);f.data.deployment.pageCommit=target;f.save('deployment');f.flush();
 assert.throws(f.check,/invalid committed gzip candidate/i);
});
test('a committed symlink parent is not treated as an absent gzip candidate',t=>{
 const f=fixture(t);installStockEvidence(f);f.data.deployment.pageCommit=symlinkGzipParentCommit;f.save('deployment');f.flush();
 assert.throws(f.check,/invalid immutable optional file parent/i);
});
test('deflate must derive from the exact committed gzip stream',t=>{
 const f=fixture(t),key='deflate';
 let a=1,b=0;for(const byte of source){a=(a+byte)%65521;b=(b+a)%65521;}
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE((b*65536+a)>>>0);
 // This complete alternate stream decodes to the same HTML but comes from a
 // different valid gzip member, so independently matching hashes are not enough.
 const alternative=Buffer.concat([Buffer.from([120,218]),stockGzip.subarray(10,-8),checksum]);
 assert.deepEqual(inflateSync(alternative),source);
 assert.notEqual(hash(alternative),f.data.page.deflateSha256);
 f.data.page.deflate=alternative.length;f.data.page.deflateSha256=hash(alternative);
 const representation=f.data.deployment.representations.find(r=>r.encoding===key);
 representation.bytes=alternative.length;representation.sha256=hash(alternative);
 for(const readback of Object.values(f.data.deployment.verification.fileReadbacks)) {
  const entry=readback.files.find(r=>r.encoding===key);entry.bytes=alternative.length;entry.sha256=hash(alternative);
 }
 writeFileSync(join(f.root,'public/index.html.deflate'),alternative);
 const build=read(join(f.root,'build-report.json'));build.deflate=alternative.length;
 writeFileSync(join(f.root,'build-report.json'),JSON.stringify(build));
 f.put(f.paths.page,f.data.page);f.save('page');f.save('deployment');f.flush();
 assert.throws(f.check,/deflate.*committed gzip/i);
});
test('pinned maintenance evidence cannot be replaced and rehashed',t=>{const f=fixture(t);f.useMaintenance();const path=f.config.current.deployment.path,p=read(join(f.root,path));p.pageRelease='releases/other';f.put(path,p);f.config.current.deployment.sha256=hash(readFileSync(join(f.root,path)));f.flush();assert.throws(f.check,/hash|deployment identity/i);});
test('a rehashed page record cannot make a failing browser case pass',t=>{const f=fixture(t);f.data.page.verification.browserComparisons[0].identicalPixels=false;f.put(f.paths.page,f.data.page);f.save('page');f.flush();assert.throws(f.check,/browser/i);});
test('a rehashed page cannot replace the immutable browser verifier',t=>{const f=fixture(t);f.data.page.verification.browserVerifierSha256='0'.repeat(64);f.put(f.paths.page,f.data.page);f.save('page');f.flush();assert.throws(f.check,/browser verifier/i);});
test('a rehashed font report cannot change its source derivative',t=>{const f=fixture(t),ref=f.data.page.fontOverrideEvidence.root,path=join(f.root,ref.path),r=read(path);r.candidate.htmlSha256='0'.repeat(64);writeFileSync(path,JSON.stringify(r));ref.sha256=hash(readFileSync(path));f.put(f.paths.page,f.data.page);f.save('page');f.flush();assert.throws(f.check,/font override/i);});
test('a verification window before prior maintenance is rejected even if readback is later',t=>{const f=fixture(t);f.data.page.measuredAt='2026-10-25T10:00:00Z';f.put(f.paths.page,f.data.page);f.save('page');f.data.deployment.verification.window.startedAt='2026-10-25T12:00:00Z';f.data.deployment.verification.window.completedAt='2026-10-25T12:00:10Z';f.save('deployment');f.flush();assert.throws(f.check,/timestamps/i);});
test('aggregate representation outcomes do not claim per-request observations',t=>{const f=fixture(t);assert.equal(f.data.deployment.verification.originRepresentationsVerified,true);assert.equal(f.data.deployment.verification.publicRepresentationsVerified,true);assert.doesNotThrow(f.check);});
for(const key of ['ONEKB_TEST_IP','ONEKB_TEST_HTTP_PORT','ONEKB_TEST_HTTPS_PORT','ONEKB_ALIAS_IP','CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','DYLD_INSERT_LIBRARIES','LD_PRELOAD'])test('rejects public verification with '+key+' set',t=>{const f=fixture(t);f.data.deployment.verification.publicVerificationEnvironment[key]='set';f.save('deployment');f.flush();assert.throws(f.check,/environment/i);});
test('rejects incomplete public environment profile',t=>{const f=fixture(t);delete f.data.deployment.verification.publicVerificationEnvironment.SSL_CERT_DIR;f.save('deployment');f.flush();assert.throws(f.check,/environment/i);});
test('rejects unknown public environment profile fields',t=>{const f=fixture(t);f.data.deployment.verification.publicVerificationEnvironment.OTHER_SETTING=null;f.save('deployment');f.flush();assert.throws(f.check,/environment/i);});
test('future browser baseline cannot name the candidate itself',t=>{const f=fixture(t);f.data.page.publishedMeasurement=f.paths.page;f.put(f.paths.page,f.data.page);f.save('page');f.flush();assert.throws(f.check,/baseline/i);});
test('future browser baseline cannot name unrelated evidence',t=>{const f=fixture(t);f.data.page.publishedMeasurement='measurements/page-20261025-font-validation-local.json';f.put(f.paths.page,f.data.page);f.save('page');f.flush();assert.throws(f.check,/baseline/i);});
test('packaging time cannot hide an intervening later deployment',t=>{const f=fixture(t);f.data.deployment.verification.readback.verifiedAt='2026-11-01T12:00:20Z';f.save('deployment');f.flush();f.put('measurements/deployment-intervening.json',{url:'https://tomkimberlin.com/',verifiedAt:'2026-11-01T12:00:25Z'});assert.throws(f.check,/timestamps/i);});
test('a replacement ref cannot disguise a different immutable page',t=>{const f=fixture(t),prior='2fa4e3fe7e2b6863f6a62ab46fd7dbdafb459e0a';git(gitRoot,['replace','-f',prior,commit]);t.after(()=>git(gitRoot,['replace','-d',prior]));const unsafeEnv={...env};delete unsafeEnv.GIT_NO_REPLACE_OBJECTS;const replaced=execFileSync('git',['show',prior+':index.html'],{cwd:gitRoot,env:unsafeEnv});assert.equal(hash(replaced),f.data.page.htmlSha256);f.data.deployment.pageCommit=prior;f.save('deployment');f.flush();assert.throws(f.check,/immutable commit|verifier/i);});
test('a replacement ref cannot make an authentic immutable page appear different',t=>{const f=fixture(t);git(gitRoot,['replace','-f',commit,'2fa4e3fe7e2b6863f6a62ab46fd7dbdafb459e0a']);t.after(()=>git(gitRoot,['replace','-d',commit]));assert.doesNotThrow(f.check);});
test('inherited Git directory, object and config routing variables do not change provenance reads',t=>{const f=fixture(t);const values={GIT_DIR:'/nonexistent/attacker-git',GIT_WORK_TREE:'/nonexistent/attacker-tree',GIT_COMMON_DIR:'/nonexistent/attacker-common',GIT_OBJECT_DIRECTORY:'/nonexistent/attacker-objects',GIT_ALTERNATE_OBJECT_DIRECTORIES:'/nonexistent/attacker-alternates',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.worktree',GIT_CONFIG_VALUE_0:'/nonexistent/attacker-tree'};const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);t.after(()=>{for(const [k,v] of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});assert.doesNotThrow(f.check);});
for(const phase of ['preflight','postBuild','release'])for(const [label,change] of [
 ['missing file',x=>x.files.pop()],['wrong filename',x=>x.files[0].file='wrong.html'],['wrong file length',x=>x.files[1].bytes++],
 ['wrong file digest',x=>x.files[2].sha256='0'.repeat(64)],['failed readback',x=>x.passed=false],['missing readback hash',x=>delete x.privateReadbackSha256]
])test(`rejects ${phase} ${label}`,t=>{const f=fixture(t);change(f.data.deployment.verification.fileReadbacks[phase]);f.save('deployment');f.flush();assert.throws(f.check,/readback/i);});
test('release-file readback must name the active release',t=>{const f=fixture(t);f.data.deployment.verification.fileReadbacks.release.pageRelease='releases/wrong';f.save('deployment');f.flush();assert.throws(f.check,/readback/i);});
test('release-file and runtime readback must use the same retained log',t=>{const f=fixture(t);f.data.deployment.verification.fileReadbacks.release.privateReadbackSha256='3'.repeat(64);f.save('deployment');f.flush();assert.throws(f.check,/readback/i);});
test('file readbacks cannot reuse the same private record',t=>{const f=fixture(t);f.data.deployment.verification.fileReadbacks.preflight.privateReadbackSha256=f.data.deployment.verification.fileReadbacks.postBuild.privateReadbackSha256;f.save('deployment');f.flush();assert.throws(f.check,/readback/i);});
test('post-build files must be read before the public environment check',t=>{const f=fixture(t);f.data.deployment.verification.fileReadbacks.postBuild.observedAt='2026-11-01T12:00:07Z';f.save('deployment');f.flush();assert.throws(f.check,/readback/i);});
for(const name of ['arbitrary.json','maintenance-misplaced.json'])test('misplaced page-only deployment is rejected: '+name,t=>{const f=fixture(t);f.put('measurements/'+name,{kind:'page-only-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-12-01T00:00:00Z'});assert.throws(f.check,/misplaced/i);});
test('the current page-only deployment must use a deployment filename',t=>{const f=fixture(t);f.put('measurements/page-only-current.json',f.data.deployment);f.config.current.deployment={path:'measurements/page-only-current.json',sha256:hash(readFileSync(join(f.root,'measurements/page-only-current.json')))};f.flush();assert.throws(f.check,/deployment identity/i);});
