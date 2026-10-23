// Real saved evidence is copied into disposable ignored fixtures. No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,deflateSync,inflateSync} from 'node:zlib';
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

function fixture(t,project=repo) {
  mkdirSync(scratch,{recursive:true});
  const root=mkdtempSync(join(scratch,'fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'measurements'));mkdirSync(join(root,'public'));
  const names={overhead:'measurements/overhead-current.json',deployment:'measurements/deployment-current.json',page:'measurements/page-current.json',gallery:'measurements/gallery-20260922.json'};
  const data={overhead:json(resolve(project,actualOverhead)),deployment:json(resolve(project,actualDeployment)),page:json(resolve(project,'measurements/page-20261022-accessibility-local.json')),gallery:json(resolve(project,'measurements/gallery-20260922.json'))};
  const config={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',current:{},historicalGallery:null};
  const put=(name,value)=>writeFileSync(resolve(root,name),JSON.stringify(value,null,2)+'\n');
  function save(kind) {
    put(names[kind],data[kind]);const ref={path:names[kind],sha256:hash(readFileSync(resolve(root,names[kind])))};
    if(kind==='gallery')config.historicalGallery=ref;else config.current[kind]=ref;
  }
  for(const k of Object.keys(data))save(k);
  // Freeze bytes to this dated deployed commit, not a future working candidate.
  const committed=name=>execFileSync('git',['show',data.deployment.pageCommit+':'+name],{cwd:project});
  const source=committed('index.html'),br=committed('compression/index.html.br'),gzip=committed('compression/index.html.gz');
  let a=1,b=0;for(const byte of source){a=(a+byte)%65521;b=(b+a)%65521;}
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE(((b<<16)|a)>>>0);
  const frozen={html:source,brotli:br,gzip,deflate:Buffer.concat([Buffer.from([120,218]),gzip.subarray(10,-8),checksum])};
  assert.deepEqual(brotliDecompressSync(br),source);assert.deepEqual(gunzipSync(gzip),source);assert.deepEqual(inflateSync(frozen.deflate),source);
  const build={};
  for(const [key,bytes] of Object.entries(frozen)){writeFileSync(resolve(root,'public',files[key]),bytes);build[key]=bytes.length;assert.equal(hash(bytes),data.page[key+'Sha256']);}
  writeFileSync(resolve(root,'index.html'),source);put('build-report.json',build);
  const s=data.overhead.summary.estimatedTcpPlusDnsMinusBody,n=value=>value.toLocaleString('en-US');
  writeFileSync(resolve(root,'README.md'),`**Latest verified result: ${n(s.median)} B estimated overhead, October 22, 2026.** Median (${n(s.minimum)}–${n(s.maximum)} B). [Evidence](${names.overhead}).\n`);
  function document() {
    const old=data.gallery.summary.map(r=>`| [Site](${r.url}) | ${r.tls_median.toLocaleString('en-US')} | ${r.total_median.toLocaleString('en-US')} |`).join('\n');
    const candidate=config.candidate?renderCandidate(json(resolve(root,config.candidate.page.path)),config.candidate.page)+'\n\n':'';
    writeFileSync(resolve(root,'COMPARISON.md'),renderCurrent({...data,refs:config.current})+'\n\n'+candidate+'<!-- comparison:gallery:start -->\n## September 22, 2026 gallery\n\n| Website | TLS | Packet + DNS |\n| --- | ---: | ---: |\n'+old+'\n\n[Historical evidence]('+config.historicalGallery.path+')\n<!-- comparison:gallery:end -->\n');
  }
  function flush({doc=true}={}) {put('measurements/comparison-current.json',config);if(doc)document();}
  function candidate() {
    const source=Buffer.concat([readFileSync(resolve(root,'index.html')),Buffer.from('\n')]);
    const representations={html:source,brotli:brotliCompressSync(source),gzip:gzipSync(source),deflate:deflateSync(source)};
    const page={scope:'local build'},build={};
    for(const [key,bytes] of Object.entries(representations)) {writeFileSync(resolve(root,'public',files[key]),bytes);page[key]=build[key]=bytes.length;page[key+'Sha256']=hash(bytes);}
    writeFileSync(resolve(root,'index.html'),source);put('build-report.json',build);put('measurements/page-candidate.json',page);
    config.candidate={page:{path:'measurements/page-candidate.json',sha256:hash(readFileSync(resolve(root,'measurements/page-candidate.json')))}};flush();return page;
  }
  function quic() {
    // Synthetic readbacks exercise the optional path without live or ignored inputs.
    const parameters={schema:1,host:'tomkimberlin.com',protocol:'h3',certificate_verification:true,trust_store:'default',fresh_handshake_completed:true,session_resumed:false,aioquic_version:'1.3.0',probe_source_sha256:'a'.repeat(64),scope:'Synthetic trusted parameter fixture; no network measurement.',encoded_transport_parameters_bytes:102,ack_fields:{ack_delay_exponent:{present:true,effective_value:3},max_ack_delay_ms:{present:true,effective_value:25}},saved_context_relevant_effective_values:{max_idle_timeout_ms:75000,max_udp_payload_size:65527,initial_max_data:8585216,initial_max_stream_data_bidi_local:65536,initial_max_stream_data_bidi_remote:65536,initial_max_stream_data_uni:65536,initial_max_streams_bidi:128,initial_max_streams_uni:3,active_connection_id_limit:2,disable_active_migration:false}};
    data.quic={schemaVersion:1,targetUrl:config.targetUrl,before:{runtimeImageId:'sha256:'+'b'.repeat(64),parameters},after:{runtimeImageId:data.deployment.server.imageId,parameters:structuredClone(parameters)}};
    data.quic.after.parameters.encoded_transport_parameters_bytes=96;
    for(const ack of Object.values(data.quic.after.parameters.ack_fields))ack.present=false;
    const update=()=>{const path='measurements/quic-current.json';put(path,data.quic);data.deployment.quicTransportParameters={path,sha256:hash(readFileSync(resolve(root,path)))};save('deployment');flush();};
    update();return update;
  }
  flush();
  return {root,data,config,save,put,flush,document,candidate,quic,check:()=>checkComparison({root})};
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
test('dated fixtures stay valid when the project working bodies and README change',t=>{
  const project=fixture(t);project.candidate();
  writeFileSync(join(project.root,'README.md'),'Different pending working-copy documentation.\n');
  for(const path of [actualOverhead,actualDeployment,'measurements/page-20261022-accessibility-local.json','measurements/gallery-20260922.json'])
    writeFileSync(resolve(project.root,path),readFileSync(resolve(repo,path)));
  const frozen=fixture(t,project.root);
  assert.deepEqual(frozen.check(),{liveDate:'2026-10-22',localCandidate:false});
  assert.notEqual(hash(readFileSync(join(project.root,'index.html'))),hash(readFileSync(join(frozen.root,'index.html'))));
});

// A certificate cache can change without a new page release or runtime image.
test('verified cache-only component reduction cannot reuse older measured overhead',t=>{
  const f=fixture(t);
  const row=f.data.deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.find(r=>r.hostname==='tomkimberlin.com');
  row.compressedCertificateMessageBytes=[row.compressedCertificateMessageBytes[0]-2];
  const cache=f.data.deployment.certificateCache.actualOwnedCacheFiles.find(r=>r.hostname==='tomkimberlin.com');
  cache.brotliBytes-=2;cache.brotliSha256='0'.repeat(64);
  f.save('deployment');f.flush();
  assert.throws(f.check,/certificate component/);
});
test('matching component-only aliases bind without claiming full alias exchanges',t=>{
  const f=fixture(t);
  f.data.overhead.certificateComponents={hosts:f.data.deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.map(row=>({hostname:row.hostname,compressedCertificateMessageBytes:row.compressedCertificateMessageBytes[0],encodedCertificatePayloadBytes:row.compressedCertificateMessageBytes[0]-12,certificateVerified:true}))};
  f.save('overhead');f.flush();assert.doesNotThrow(f.check);
});
test('a verified alias reduction invalidates stale normalized alias components',t=>{
  const f=fixture(t);
  f.data.overhead.certificateComponents={hosts:f.data.deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.map(row=>({hostname:row.hostname,compressedCertificateMessageBytes:row.compressedCertificateMessageBytes[0],encodedCertificatePayloadBytes:row.compressedCertificateMessageBytes[0]-12,certificateVerified:true}))};
  f.data.deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.find(row=>row.hostname==='www.tomkimberlin.com').compressedCertificateMessageBytes[0]-=2;
  f.data.deployment.certificateCache.actualOwnedCacheFiles.find(row=>row.hostname==='www.tomkimberlin.com').brotliBytes-=2;
  f.save('overhead');f.save('deployment');f.flush();assert.throws(f.check,/alias certificate component/);
});
test('sidecar payload size and full certificate framing must agree',t=>{
  const f=fixture(t);f.data.deployment.certificateCache.actualOwnedCacheFiles[0].brotliBytes-=1;
  f.save('deployment');f.flush();assert.throws(f.check,/sidecar payload/);
});
test('a www-only reduction cannot leave the canonical component line stale',t=>{
  const f=fixture(t);
  f.data.deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.find(row=>row.hostname==='www.tomkimberlin.com').compressedCertificateMessageBytes[0]-=2;
  f.data.deployment.certificateCache.actualOwnedCacheFiles.find(row=>row.hostname==='www.tomkimberlin.com').brotliBytes-=2;
  f.save('deployment');f.flush({doc:false});assert.throws(f.check,/section is stale/);
});


// The optional HTTP/3 component remains separate from the HTTP/2 exchange table.
test('trusted optional QUIC component binds current image and renders outside the table',t=>{
  const f=fixture(t);f.quic();assert.doesNotThrow(f.check);
  const doc=readFileSync(join(f.root,'COMPARISON.md'),'utf8');
  assert.match(doc,/102 B → 96 B \(6 B less\)/);assert.match(doc,/component.*HTTP\/2 saving/);
  assert.ok(doc.indexOf('HTTP/3 transport-parameter component:')>doc.indexOf('| HTTP/2 plaintext minus complete body |'));
});
test('QUIC evidence hash cannot silently change',t=>{const f=fixture(t);f.quic();f.data.quic.after.parameters.encoded_transport_parameters_bytes--;f.put('measurements/quic-current.json',f.data.quic);assert.throws(f.check,/hash is stale/);});
test('QUIC after image must be the currently verified runtime',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.runtimeImageId='sha256:'+'0'.repeat(64);save();assert.throws(f.check,/QUIC component runtime image/);});
test('QUIC byte accounting must remove exactly the two default fields',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.encoded_transport_parameters_bytes--;save();assert.throws(f.check,/byte difference/);});
test('QUIC readbacks require normal certificate trust',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.trust_store='test-only';save();assert.throws(f.check,/trusted QUIC/);});
test('QUIC readbacks require completed fresh handshakes',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.session_resumed=true;save();assert.throws(f.check,/trusted QUIC/);});
test('QUIC ACK fields must actually be omitted after activation',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.ack_fields.max_ack_delay_ms.present=true;save();assert.throws(f.check,/ACK defaults/);});
test('QUIC effective ACK values must stay at the protocol defaults',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.ack_fields.ack_delay_exponent.effective_value=4;save();assert.throws(f.check,/ACK defaults/);});
test('QUIC context numeric values cannot change',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.saved_context_relevant_effective_values.initial_max_data++;save();assert.throws(f.check,/context or measurement client/);});
test('QUIC context values must be numeric even if equally malformed',t=>{const f=fixture(t),save=f.quic();for(const side of ['before','after'])f.data.quic[side].parameters.saved_context_relevant_effective_values.max_idle_timeout_ms='75000';save();assert.throws(f.check,/context values/);});
test('QUIC readbacks cannot carry unallowlisted raw network fields',t=>{const f=fixture(t),save=f.quic();f.data.quic.after.parameters.ip='192.0.2.1';save();assert.throws(f.check,/trusted QUIC/);});
test('stale rendered QUIC bytes are rejected',t=>{const f=fixture(t);f.quic();const path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace('102 B → 96 B','102 B → 97 B'));assert.throws(f.check,/section is stale/);});
test('stale rendered QUIC evidence link is rejected',t=>{const f=fixture(t);f.quic();const path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace('](measurements/quic-current.json)','](measurements/quic-old.json)'));assert.throws(f.check,/section is stale/);});
test('QUIC component display derives other validated lengths rather than hardcoding the first result',t=>{const f=fixture(t),save=f.quic();f.data.quic.before.parameters.encoded_transport_parameters_bytes=103;f.data.quic.after.parameters.encoded_transport_parameters_bytes=97;save();assert.doesNotThrow(f.check);assert.match(readFileSync(join(f.root,'COMPARISON.md'),'utf8'),/103 B → 97 B \(6 B less\)/);});

test('hashed null QUIC evidence cannot disable the optional validation',t=>{const f=fixture(t),save=f.quic();f.data.quic=null;save();assert.throws(f.check,/Invalid QUIC component evidence/);});
