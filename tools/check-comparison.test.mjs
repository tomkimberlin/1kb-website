// Real saved evidence is copied into disposable ignored fixtures. No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
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
  function statusEncoding() {
    // Synthetic component rows use only immutable source hashes and dated page
    // evidence. They never read a live probe, ignored draft or working source.
    const runtime='2055306d4f632e5dd2eedd9793e17ace77b3c3bd';
    const committed=name=>execFileSync('git',['show',runtime+':'+name],{cwd:project});
    const patch=hash(committed('server/status-encoding.patch')),dockerfile=hash(committed('server/Dockerfile'));
    data.deployment.runtimeSourceCommit=runtime;
    data.deployment.server.sourceFileHashes??={};
    Object.assign(data.deployment.server.sourceFileHashes,{'server/status-encoding.patch':patch,'server/Dockerfile':dockerfile});
    const requestCases={main:{hostname:'tomkimberlin.com',method:'GET',path:'/',statusCode:200},
      missing:{hostname:'tomkimberlin.com',method:'GET',path:'/missing',statusCode:404},
      method:{hostname:'tomkimberlin.com',method:'BREW',path:'/',statusCode:405},
      wwwAlias:{hostname:'www.tomkimberlin.com',method:'GET',path:'/legacy?onekb=status',statusCode:301},
      alternateAlias:{hostname:'tom.kimberlin.net',method:'GET',path:'/legacy?onekb=status',statusCode:301}};
    const sizes={before:{h2:[1,1,5,5,5],h3:[1,6,6,6,6]},after:{h2:[1,1,5,4,4],h3:[1,1,6,5,5]}};
    const phases={};
    for(const [phase,hour] of [['before','15'],['after','16']]) {
      const rows={};
      for(const protocol of ['h2','h3']) {
        rows[protocol]={};
        for(const [i,[name,request]] of Object.entries(requestCases).entries()) {
          const indexed=name==='main'||(name==='missing'&&(protocol==='h2'||phase==='after'));
          rows[protocol][name]={statusCode:request.statusCode,statusFieldBytes:sizes[phase][protocol][i],
            blockBytes:50+sizes[phase][protocol][i],nonFieldPrefixBytes:protocol==='h2'?1:2,
            statusRepresentation:indexed?'indexed-static':phase==='after'&&name.endsWith('Alias')?'literal-name-huffman':'literal-name-raw',
            bodyBytes:name==='main'?data.page.brotli:0,bodySha256:name==='main'?data.page.brotliSha256:hash(Buffer.alloc(0)),
            normalCertificateValidation:true,exactStatus:true,exactBody:true,destinationVerified:true,allowVerified:true};
        }
      }
      phases[phase]={runtimeImageId:phase==='after'?data.deployment.server.imageId:'sha256:'+'b'.repeat(64),
        runtimeSourceCommit:runtime,pageCommitAtReadback:data.deployment.pageCommit,pageReleaseAtReadback:data.deployment.pageRelease,
        perRequestGenerationVerified:false,deploymentOverlap:phase==='after',
        passed:true,normalCertificateValidation:true,trust:'Default CA and owned hostname verification',fixtureCAUsed:false,freshConnections:10,
        startedAt:`2026-10-22T${hour}:00:00Z`,completedAt:`2026-10-22T${hour}:00:01Z`,runtimeReadbackAt:`2026-10-22T${hour}:01:00Z`,
        sourceSha256:'a'.repeat(64),clientVersions:{h2:'4.4.1',hpack:'4.2.0',pylsqpack:'0.3.24',aioquic:'1.3.0'},
        reusedSources:{'tools/verify-http3.py':'c'.repeat(64),'tools/probe_response.py':'d'.repeat(64)},rows};
    }
    data.statusEncoding={schemaVersion:1,targetUrl:config.targetUrl,verifiedThrough:'2026-10-22T17:00:00Z',
      requestCases,...phases,source:{runtimeSourceCommit:runtime,statusEncodingPatchSha256:patch,dockerfileSha256:dockerfile},deltas:{h2:{},h3:{}}};
    for(const protocol of ['h2','h3']) for(const name of Object.keys(requestCases)) {
      const a=phases.before.rows[protocol][name],b=phases.after.rows[protocol][name];
      data.statusEncoding.deltas[protocol][name]={statusFieldBytesSaved:a.statusFieldBytes-b.statusFieldBytes,blockBytesSaved:a.blockBytes-b.blockBytes,bodyBytesSaved:a.bodyBytes-b.bodyBytes};
    }
    const update=()=>{const path='measurements/status-current.json';put(path,data.statusEncoding);
      data.deployment.statusEncoding={path,sha256:hash(readFileSync(resolve(root,path)))};save('deployment');flush();};
    update();return update;
  }
  function peerComparison() {
    // The same relative path resolves to committed public evidence after integration.
    // This frozen dated record never reads a live request or the current working body.
    data.peerComparison=json(new URL('../measurements/gallery-20261023-integrated.json',import.meta.url));
    const update=()=>{const path='measurements/gallery-20261023-integrated.json';put(path,data.peerComparison);
      data.deployment.peerComparison={path,sha256:hash(readFileSync(resolve(root,path)))};save('deployment');flush();};
    update();return update;
  }
  flush();
  return {root,data,config,save,put,flush,document,candidate,quic,statusEncoding,peerComparison,check:()=>checkComparison({root})};
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
test('v1 rejects a newer verified maintenance content deployment',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-20261025-intune-name.json',json(resolve(repo,'measurements/maintenance-20261025-intune-name.json')));
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 recognizes a normalized equivalent of the target URL',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-canonical.json',{kind:'content-update-deployment',url:'https://TOMKIMBERLIN.COM',verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 recognizes the target URL even when it contains a fragment',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-fragment.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/#section',verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
for(const prefix of ['maintenance','deployment'])test('v1 recognizes same-page URL variations in '+prefix+' records',t=>{
  const f=fixture(t);
  f.put(`measurements/${prefix}-variant.json`,{kind:'content-update-deployment',url:'https://TOMKIMBERLIN.COM:443/?v=release#section',verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 recognizes same-page URL variations in page-only deployment records',t=>{
  const f=fixture(t);
  f.put('measurements/deployment-page-variant.json',{kind:'page-only-deployment',url:'https://TOMKIMBERLIN.COM:443/?v=release#section',verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 recognizes same-page URL variations in legacy deployment records',t=>{
  const f=fixture(t);
  f.put('measurements/deployment-legacy-variant.json',{url:'https://TOMKIMBERLIN.COM:443/?v=release#section',verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
for(const [label,kind,url] of [
  ['http canonical','content-update-deployment','http://tomkimberlin.com/?v=1'],
  ['https www alias','content-update-deployment','https://www.tomkimberlin.com/#fragment'],
  ['http alternate alias','content-update-deployment','http://tom.kimberlin.net/'],
  ['https alternate alias','page-only-deployment','https://tom.kimberlin.net/'],
  ['canonical index redirect','page-only-deployment','https://tomkimberlin.com/index.html?v=1'],
  ['alias index redirect',undefined,'https://www.tomkimberlin.com/index.html#section']
])test('v1 recognizes a known redirect to the page: '+label,t=>{
  const f=fixture(t);
  f.put('measurements/deployment-known-redirect.json',{...(kind?{kind}:{}),url,verifiedAt:'2026-12-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 detects a later maintenance verification within the same millisecond',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-microseconds.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-10-22T17:04:17.857001Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 accepts the same instant with extra fractional zeroes',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-equal-time.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-10-22T17:04:17.857000Z'});
  assert.doesNotThrow(f.check);
});
test('v1 detects a later overhead sample within the same millisecond',t=>{
  const f=fixture(t),later=structuredClone(f.data.overhead);later.runs[2].measuredAt='2026-10-22T16:59:20.000001Z';
  f.put('measurements/overhead-microseconds.json',later);assert.throws(f.check,/newer own-site/i);
});
test('v1 detects a later peer comparison within the same millisecond',t=>{
  const f=fixture(t);f.peerComparison();f.put('measurements/gallery-microseconds.json',{schemaVersion:1,completedAt:'2026-10-23T09:25:23.000001Z'});
  assert.throws(f.check,/newer peer comparison/i);
});
test('v1 cannot hide a later verification behind an earlier verifiedThrough',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-two-dates.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-12-01T00:00:00Z',verifiedThrough:'2026-10-01T00:00:00Z'});
  assert.throws(f.check,/newer verified deployment/i);
});
test('v1 accepts an older verified maintenance content deployment',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-old.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'2026-10-01T00:00:00Z'});
  assert.doesNotThrow(f.check);
});
test('v1 ignores unrelated maintenance verification and content deployments for other sites',t=>{
  const f=fixture(t);
  f.put('measurements/maintenance-other-kind.json',{kind:'maintenance-verification',verifiedAt:'2026-12-01T00:00:00Z'});
  f.put('measurements/maintenance-unrelated-kind.json',{kind:'network-verification'});
  f.put('measurements/maintenance-other-no-kind.json',{url:'https://example.invalid/',verifiedAt:'not a timestamp'});
  f.put('measurements/maintenance-other-bad-kind.json',{kind:7,url:'https://example.invalid/'});
  f.put('measurements/maintenance-other-port-no-kind.json',{url:'https://tomkimberlin.com:8443/'});
  f.put('measurements/maintenance-other-site.json',{kind:'content-update-deployment',url:'https://example.invalid/',verifiedAt:'2026-12-01T00:00:00Z'});
  f.put('measurements/maintenance-other-site-no-date.json',{kind:'content-update-deployment',url:'https://example.invalid/'});
  f.put('measurements/maintenance-other-site-invalid-date.json',{kind:'content-update-deployment',url:'https://example.invalid/',verifiedAt:'not a timestamp'});
  f.put('measurements/deployment-other-path.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com/another-page',verifiedAt:'not a timestamp'});
  f.put('measurements/deployment-other-port.json',{kind:'content-update-deployment',url:'https://tomkimberlin.com:8443/',verifiedAt:'not a timestamp'});
  f.put('measurements/deployment-other-page-only.json',{kind:'page-only-deployment',url:'https://example.invalid/',verifiedAt:'not a timestamp'});
  f.put('measurements/deployment-legacy-no-url.json',{verifiedAt:'not a timestamp'});
  f.put('measurements/deployment-legacy-bad-url.json',{url:'not a URL',verifiedAt:'not a timestamp'});
  assert.doesNotThrow(f.check);
});
for(const [label,value] of [
  ['missing timestamp',{kind:'content-update-deployment',url:'https://tomkimberlin.com/'}],
  ['invalid timestamp',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'not a timestamp'}],
  ['invalid secondary timestamp',{kind:'content-update-deployment',url:'https://tomkimberlin.com/',verifiedAt:'not a timestamp',verifiedThrough:'2026-10-01T00:00:00Z'}],
  ['missing target',{kind:'content-update-deployment',verifiedAt:'2026-10-01T00:00:00Z'}],
  ['invalid target',{kind:'content-update-deployment',url:7,verifiedAt:'2026-10-01T00:00:00Z'}],
  ['malformed URL',{kind:'content-update-deployment',url:'not a URL',verifiedAt:'2026-10-01T00:00:00Z'}],
  ['missing kind',{url:'https://tomkimberlin.com/',verifiedAt:'2026-10-01T00:00:00Z'}],
  ['missing kind and target',{verifiedAt:'2026-10-01T00:00:00Z'}],
  ['invalid kind and same-site target',{kind:7,url:'https://www.tomkimberlin.com/',verifiedAt:'2026-10-01T00:00:00Z'}],
  ['missing kind and index redirect',{url:'https://tomkimberlin.com/index.html',verifiedAt:'2026-10-01T00:00:00Z'}]
])test('v1 rejects maintenance content deployment with '+label,t=>{
  const f=fixture(t);f.put('measurements/maintenance-malformed.json',value);assert.throws(f.check);
});
test('v1 rejects malformed maintenance JSON',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'measurements/maintenance-malformed.json'),'{');assert.throws(f.check,/JSON/i);
});
for(const prefix of ['maintenance','deployment','overhead','gallery'])test('v1 confines scanned '+prefix+' references to measurements',t=>{
  const f=fixture(t),outside=join(f.root,'synthetic-outside.json');writeFileSync(outside,'SYNTHETIC_PRIVATE_SENTINEL');
  symlinkSync(outside,join(f.root,`measurements/${prefix}-escape.json`));
  assert.throws(f.check,error=>/escapes measurements/i.test(error.message)&&!error.message.includes('SYNTHETIC_PRIVATE_SENTINEL'));
});
test('v1 malformed scanned JSON errors do not expose content',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'measurements/maintenance-malformed.json'),'{"sentinel":"SYNTHETIC_PRIVATE_SENTINEL", invalid}');
  assert.throws(f.check,error=>/JSON/i.test(error.message)&&!error.message.includes('SYNTHETIC_PRIVATE_SENTINEL'));
});
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


function limitReduction(f) {
  const update=f.quic();
  f.data.quic.before.parameters.encoded_transport_parameters_bytes=96;
  f.data.quic.after.parameters.encoded_transport_parameters_bytes=87;
  for(const [name,side] of Object.entries({before:f.data.quic.before,after:f.data.quic.after})) {
    for(const field of Object.values(side.parameters.ack_fields))field.present=false;
    side.parameters.limit_fields={max_udp_payload_size:{present:name==='before',effective_value:65527},active_connection_id_limit:{present:name==='before',effective_value:2}};
  }
  update();return update;
}
test('additional limit omission is a separate 96 to 87 B comparison',t=>{const f=fixture(t);limitReduction(f);assert.doesNotThrow(f.check);const doc=readFileSync(join(f.root,'COMPARISON.md'),'utf8');assert.match(doc,/96 B → 87 B \(9 B less\)/);assert.match(doc,/unchanged effective parameters/);assert.doesNotMatch(doc,/102 B → 87 B/);});
test('new limit evidence cannot substitute an ACK-only six-byte delta',t=>{const f=fixture(t),save=limitReduction(f);f.data.quic.after.parameters.encoded_transport_parameters_bytes=90;save();assert.throws(f.check,/component byte difference/);});
test('new limit evidence requires actual before-wire presence',t=>{const f=fixture(t),save=limitReduction(f);f.data.quic.before.parameters.limit_fields.max_udp_payload_size.present=false;save();assert.throws(f.check,/limit defaults/);});
test('new limit evidence requires both fields omitted after activation',t=>{const f=fixture(t),save=limitReduction(f);f.data.quic.after.parameters.limit_fields.active_connection_id_limit.present=true;save();assert.throws(f.check,/limit defaults/);});
test('new limit evidence must retain the exact effective defaults',t=>{const f=fixture(t),save=limitReduction(f);f.data.quic.after.parameters.limit_fields.max_udp_payload_size.effective_value=65526;save();assert.throws(f.check,/limit defaults/);});
test('new limit evidence must agree with saved context values',t=>{const f=fixture(t),save=limitReduction(f);for(const name of ['before','after'])f.data.quic[name].parameters.saved_context_relevant_effective_values.active_connection_id_limit=3;save();assert.throws(f.check,/limit defaults/);});
test('new limit evidence requires ACK fields already omitted on both sides',t=>{const f=fixture(t),save=limitReduction(f);f.data.quic.before.parameters.ack_fields.ack_delay_exponent.present=true;save();assert.throws(f.check,/ACK defaults/);});
test('missing one phase limit observation cannot be inferred from context',t=>{const f=fixture(t),save=limitReduction(f);delete f.data.quic.before.parameters.limit_fields;save();assert.throws(f.check,/trusted QUIC/);});

test('status component binds immutable runtime source and renders component-only bytes',t=>{
  const f=fixture(t);f.statusEncoding();assert.doesNotThrow(f.check);
  const doc=readFileSync(join(f.root,'COMPARISON.md'),'utf8');
  assert.match(doc,/301: HTTP\/2 5 → 4 B; HTTP\/3 6 → 5 B/);
  assert.match(doc,/HTTP\/3 404: 6 → 1 B; main 200 unchanged/);
  assert.match(doc,/no fixed whole-exchange saving is established/);
  assert.ok(doc.indexOf('Status-field components:')>doc.indexOf('| HTTP/2 plaintext minus complete body |'));
});
test('status and QUIC components coexist without changing the whole-body table',t=>{
  const f=fixture(t);f.quic();f.statusEncoding();assert.doesNotThrow(f.check);
  const doc=readFileSync(join(f.root,'COMPARISON.md'),'utf8');assert.match(doc,/HTTP\/3 transport-parameter component/);assert.match(doc,/Status-field components/);
});
test('runtime status patch requires a status component reference',t=>{
  const f=fixture(t);f.statusEncoding();delete f.data.deployment.statusEncoding;f.save('deployment');f.flush({doc:false});
  assert.throws(f.check,/requires component evidence/);
});
test('status reference hashes and nonnull schema are enforced',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h3.main.blockBytes++;f.put('measurements/status-current.json',f.data.statusEncoding);
  assert.throws(f.check,/hash is stale/);f.data.statusEncoding=null;save();assert.throws(f.check,/Invalid status component evidence/);
});
test('status schema and exact target cannot be substituted',t=>{
  for(const change of [{schemaVersion:2},{targetUrl:'https://example.invalid/'}]) {
    const f=fixture(t),save=f.statusEncoding();Object.assign(f.data.statusEncoding,change);save();assert.throws(f.check,/Invalid status component evidence/);
  }
});
test('status current image and runtime source commit must match deployment',t=>{
  for(const [path,value] of [['runtimeImageId','sha256:'+'0'.repeat(64)],['runtimeSourceCommit','0'.repeat(40)]]) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after[path]=value;save();assert.throws(f.check,/runtime (image|source commit)/);
  }
});
test('status source patch and Dockerfile hashes bind both deployment and immutable commit',t=>{
  for(const [key,path] of [['statusEncodingPatchSha256','server/status-encoding.patch'],['dockerfileSha256','server/Dockerfile']]) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.source[key]='0'.repeat(64);save();assert.throws(f.check,/source hash differs/);
    f.data.deployment.server.sourceFileHashes[path]='0'.repeat(64);save();assert.throws(f.check,/immutable runtime commit/);
  }
});
test('status source metadata cannot select a different runtime commit',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.source.runtimeSourceCommit='f'.repeat(40);save();assert.throws(f.check,/source commit differs/);
});
test('status readback requires normal CA and ten fresh successful connections in both phases',t=>{
  for(const phase of ['before','after']) for(const [key,value] of [['passed',false],['normalCertificateValidation',false],['trust','fixture CA'],['fixtureCAUsed',true],['freshConnections',9]]) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding[phase][key]=value;save();assert.throws(f.check,/trusted fresh connections/);
  }
});
test('status measurement client identities cannot change or be malformed',t=>{
  for(const change of [s=>{s.after.sourceSha256='b'.repeat(64);},s=>{s.after.clientVersions.hpack='new';},s=>{s.after.reusedSources['tools/verify-http3.py']='e'.repeat(64);},s=>{s.after.sourceSha256='bad';}]) {
    const f=fixture(t),save=f.statusEncoding();change(f.data.statusEncoding);save();assert.throws(f.check,/client (changed|identity)/);
  }
});
test('status readback never claims a per-request page generation',t=>{
  for(const phase of ['before','after']) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding[phase].perRequestGenerationVerified=true;save();assert.throws(f.check,/readback scope/);
  }
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.pageCommit=f.data.deployment.pageCommit;save();assert.throws(f.check,/readback scope/);
});
test('status deployment overlap must be an explicit boolean observation',t=>{
  for(const phase of ['before','after']) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding[phase].deploymentOverlap='false';save();assert.throws(f.check,/readback scope/);
  }
});
test('future status refresh can honestly report no overlapping page deployment',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.deploymentOverlap=false;save();assert.doesNotThrow(f.check);
});
test('readback page fields are metadata rather than a per-request current-page claim',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.pageCommitAtReadback='e'.repeat(40);f.data.statusEncoding.after.pageReleaseAtReadback='releases/another-byte-identical-snapshot';save();assert.doesNotThrow(f.check);
});
test('status timestamps require ordered probes and subsequent readbacks',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.completedAt='2026-10-22T18:00:00Z';save();assert.throws(f.check,/timestamps are unordered/);
});
test('status baseline runtime readback precedes the after probe',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.before.runtimeReadbackAt='2026-10-22T16:00:00.500Z';save();assert.throws(f.check,/phases overlap/);
});
test('status request cases and all ten protocol rows are required without extras',t=>{
  for(const change of [s=>{s.requestCases.wwwAlias.hostname='tomkimberlin.com';},s=>{delete s.after.rows.h3.missing;},s=>{s.after.rows.h2.extra=s.after.rows.h2.main;},s=>{delete s.before.rows.h2;}]) {
    const f=fixture(t),save=f.statusEncoding();change(f.data.statusEncoding);save();assert.throws(f.check,/request cases|component (case|protocol)/);
  }
});
test('every status field byte count is checked independently of reported deltas',t=>{
  for(const phase of ['before','after']) for(const protocol of ['h2','h3']) for(const name of ['main','missing','method','wwwAlias','alternateAlias']) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding[phase].rows[protocol][name].statusFieldBytes++;save();assert.throws(f.check,/field encoding differs/);
  }
});
test('status representation and encoded prefix cannot be relabeled',t=>{
  for(const change of [s=>{s.after.rows.h2.wwwAlias.statusRepresentation='literal-name-raw';},s=>{s.before.rows.h3.missing.statusRepresentation='indexed-static';},s=>{s.after.rows.h2.main.nonFieldPrefixBytes=0;},s=>{s.after.rows.h3.main.nonFieldPrefixBytes=1;},s=>{s.after.rows.h3.main.statusCode=404;}]) {
    const f=fixture(t),save=f.statusEncoding();change(f.data.statusEncoding);save();assert.throws(f.check,/field encoding differs/);
  }
});
test('status complete block bounds include both prefix and field and cap accepted size',t=>{
  for(const value of [2,16385,-1,3.5]) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h3.main.blockBytes=value;save();assert.throws(f.check,/block bounds differ/);
  }
});
test('status rows require exact status/body/destination/Allow and normal validation',t=>{
  for(const key of ['exactStatus','exactBody','destinationVerified','allowVerified','normalCertificateValidation']) {
    const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h2.wwwAlias[key]=false;save();assert.throws(f.check,/response verification failed/);
  }
});
test('status rows reject unallowlisted raw header or packet fields',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h3.main.rawHeaderBlock='PRIVATE_SENTINEL';save();assert.throws(f.check,/field encoding differs/);
});
test('status errors and aliases have exact empty-body hashes',t=>{
  for(const change of [s=>{s.after.rows.h3.missing.bodyBytes=1;},s=>{s.after.rows.h2.wwwAlias.bodySha256='a'.repeat(64);}]) {
    const f=fixture(t),save=f.statusEncoding();change(f.data.statusEncoding);save();assert.throws(f.check,/body verification differs/);
  }
});
test('status after main body must match the current page across both protocols',t=>{
  const f=fixture(t),save=f.statusEncoding();for(const protocol of ['h2','h3'])f.data.statusEncoding.after.rows[protocol].main.bodySha256='b'.repeat(64);save();assert.throws(f.check,/after body differs/);
});
test('status protocol bodies cannot disagree even if one matches current page',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h3.main.bodyBytes++;save();assert.throws(f.check,/protocol bodies differ/);
});
test('a future body change can preserve independent historical before-body evidence',t=>{
  for(const delta of [-10,10]) {
    const f=fixture(t),save=f.statusEncoding();for(const protocol of ['h2','h3']) {
      f.data.statusEncoding.before.rows[protocol].main.bodyBytes+=delta;
      f.data.statusEncoding.before.rows[protocol].main.bodySha256='b'.repeat(64);
      f.data.statusEncoding.deltas[protocol].main.bodyBytesSaved=delta;
    }
    save();assert.doesNotThrow(f.check);
  }
});
test('status component deltas derive from actual field/block/body counts including Date variation',t=>{
  const f=fixture(t),save=f.statusEncoding();f.data.statusEncoding.after.rows.h3.missing.blockBytes++;f.data.statusEncoding.deltas.h3.missing.blockBytesSaved--;save();assert.doesNotThrow(f.check);
  f.data.statusEncoding.deltas.h3.missing.statusFieldBytesSaved--;save();assert.throws(f.check,/delta arithmetic differs/);
});
test('stale rendered status component values and evidence links are rejected',t=>{
  for(const [before,after] of [['HTTP/2 5 → 4 B','HTTP/2 5 → 3 B'],['](measurements/status-current.json)','](measurements/status-old.json)']]) {
    const f=fixture(t);f.statusEncoding();const path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace(before,after));assert.throws(f.check,/section is stale/);
  }
});

// Dated peer comparisons are independent of the current own-site measurement.
test('normalized peer evidence validates all 18 rows and renders a dated table sorted by TLS median',t=>{
  const f=fixture(t),before=readFileSync(join(f.root,'COMPARISON.md'),'utf8').split('<!-- comparison:gallery:start -->')[1];f.peerComparison();
  assert.doesNotThrow(f.check);
  const doc=readFileSync(join(f.root,'COMPARISON.md'),'utf8');
  assert.equal(doc.split('<!-- comparison:gallery:start -->')[1],before);
  assert.match(doc,/Six-site sample — October 23, 2026/);assert.match(doc,/5,253 \(5,252–5,253\)/);
  const urls=doc.split('<!-- comparison:fresh-gallery:start -->')[1].split('<!-- comparison:fresh-gallery:end -->')[0].split('\n').filter(l=>l.startsWith('| [')).map(l=>l.match(/\]\(([^)]+)\)/)[1]);
  assert.deepEqual(urls,['https://tomkimberlin.com/','https://cv.btxx.org/','https://hi.mrkrk.me/','https://5.vg/','https://pba.im/200B','https://1k.lom.me/']);
  assert.doesNotMatch(doc,/Only this website was remeasured|creates no new peer ranking/);
  assert.notEqual(f.data.peerComparison.ownSite.pageCommit,f.data.deployment.pageCommit);
  assert.notEqual(f.data.peerComparison.serverRuntime.imageId,f.data.deployment.server.imageId);
});
test('a different working candidate can retain independently dated peer evidence',t=>{
  const f=fixture(t);f.peerComparison();const peer=structuredClone(f.data.peerComparison);f.candidate();
  assert.doesNotThrow(f.check);assert.deepEqual(f.data.peerComparison,peer);
  assert.notEqual(hash(readFileSync(join(f.root,'index.html'))),peer.ownSite.sourceSha256);
});
test('a later own-only measurement can retain the earlier peer sample unchanged',t=>{
  const f=fixture(t);f.peerComparison();const peer=structuredClone(f.data.peerComparison);
  for(const row of f.data.overhead.runs)row.measuredAt=row.measuredAt.replace('2026-10-22','2026-10-24');
  f.data.deployment.verifiedThrough='2026-10-24T18:00:00Z';f.save('overhead');f.save('deployment');f.flush();
  const p=join(f.root,'README.md');writeFileSync(p,readFileSync(p,'utf8').replace('October 22, 2026','October 24, 2026'));
  assert.doesNotThrow(f.check);assert.deepEqual(f.data.peerComparison,peer);
});
test('a published normalized gallery cannot silently lose its deployment reference',t=>{
  const f=fixture(t);f.peerComparison();delete f.data.deployment.peerComparison;delete f.data.peerComparison;f.save('deployment');f.flush();
  assert.throws(f.check,/Published normalized peer comparison requires a current reference/);
});
test('a newer normalized gallery invalidates a stale reference and can then become current',t=>{
  const f=fixture(t);f.peerComparison();const later=structuredClone(f.data.peerComparison);
  for(const key of ['startedAt','completedAt','normalizedAt'])later[key]=later[key].replace('2026-10-23','2026-10-24');later.date='2026-10-24';
  for(const run of later.runs)for(const key of ['startedAt','completedAt','rawReportCompletedAt'])run[key]=run[key].replace('2026-10-23','2026-10-24');
  const path='measurements/gallery-20261024-integrated.json';f.put(path,later);assert.throws(f.check,/newer peer comparison/);
  f.data.peerComparison=later;f.data.deployment.peerComparison={path,sha256:hash(readFileSync(join(f.root,path)))};f.save('deployment');f.flush();assert.doesNotThrow(f.check);
});
test('legacy raw gallery and older normalized galleries do not force new peer measurements',t=>{
  const f=fixture(t);f.peerComparison();f.put('measurements/gallery-20261022-older.json',{schemaVersion:1,completedAt:'2026-10-22T00:00:00Z'});assert.doesNotThrow(f.check);
});
test('peer reference remains hash bound and rejects explicit null',t=>{
  const f=fixture(t);f.peerComparison();const path=join(f.root,f.data.deployment.peerComparison.path);writeFileSync(path,readFileSync(path,'utf8')+'\n');assert.throws(f.check,/hash is stale/);
  f.put(f.data.deployment.peerComparison.path,null);f.data.deployment.peerComparison.sha256=hash(readFileSync(path));f.save('deployment');f.flush({doc:false});assert.throws(f.check,/peer comparison schema/);
});
const peerRejected=[
  ['three complete rounds',p=>p.runs.pop(),/three rounds/],
  ['six unique URLs per round',p=>{p.runs[0].results[1]=structuredClone(p.runs[0].results[0]);},/six URLs/],
  ['normal certificate validation',p=>{p.runs[0].results[1].certificateVerified=false;},/normal-trust/],
  ['HTTP 200',p=>{p.runs[0].results[1].statusCode=301;},/normal-trust/],
  ['normalizer date and terminal time',p=>{p.normalizedAt='2026-10-23T09:00:00Z';},/peer comparison dates/],
  ['ordered round intervals',p=>{p.runs[1].startedAt=p.runs[0].startedAt;},/timestamps are unordered/],
  ['raw completion bounded by its round',p=>{p.runs[0].rawReportCompletedAt='2026-10-23T10:00:00Z';},/timestamps are unordered/],
  ['exact total interval',p=>{p.startedAt='2026-10-23T09:25:04Z';},/total interval/],
  ['successful command completion',p=>{p.runs[1].commandExitCode=1;},/round\/provenance/],
  ['distinct raw snapshot hashes',p=>{p.runs[1].privateRawSnapshotSha256=p.runs[0].privateRawSnapshotSha256;},/Duplicate peer raw/],
  ['committed probe digest',p=>{p.probe.mountedProbeSha256='0'.repeat(64);},/immutable source/],
  ['immutable measurement image',p=>{p.client.imageId='sha256:'+'a'.repeat(64);},/client\/profile/],
  ['exact client packages',p=>{p.client.packages.h2='4.4.1';},/client\/profile/],
  ['exact request profile',p=>{p.client.requestHeaders[0][1]='br';},/client\/profile/],
  ['frozen helper identity',p=>{p.probe.frozenImageHelperSha256.dnsHelperSha256='0'.repeat(64);},/helper identities/],
  ['private input provenance digests',p=>{p.privateInputSha256.runScript='bad';},/provenance hashes/],
  ['historical gallery binding',p=>{p.historicalGallery.sha256='0'.repeat(64);},/historical evidence/],
  ['dated own source hash',p=>{p.ownSite.sourceSha256='0'.repeat(64);},/immutable commit/],
  ['dated own committed body hash',p=>{p.ownSite.bodySha256='0'.repeat(64);},/body differs from immutable commit/],
  ['dated own body hash',p=>{p.runs[0].results[0].bodySha256='a'.repeat(64);},/dated identity/],
  ['positive encoded body',p=>{p.runs[0].results[1].bodyBytes=0;},/body\/plaintext/],
  ['body digest syntax',p=>{p.runs[0].results[1].bodySha256='bad';},/body\/plaintext/],
  ['complete encoded-body subtraction',p=>{p.runs[0].results[1].tlsThroughBodyCompleteMinusBody++;},/complete body/],
  ['TLS stopping points',p=>{p.runs[0].results[0].tlsBeforeClientClose.received=0;},/stopping points/],
  ['capture SYN visibility',p=>{p.runs[0].results[1].captureIntegrity.completeSynObserved=false;},/Incomplete peer capture/],
  ['positive SYN count',p=>{p.runs[0].results[1].captureIntegrity.sentSynPackets=0;},/SYN\/owned/],
  ['zero kernel drops',p=>{p.runs[0].results[1].captureIntegrity.kernelDrops=1;},/kernel drops/],
  ['kernel counter bounds',p=>{p.runs[0].results[1].captureIntegrity.kernelPackets=0;},/kernel drops/],
  ['packet direction sums',p=>{p.runs[0].results[1].packetDirections.sent.observedIpv4TcpBytes--;},/packet sums/],
  ['DNS sums',p=>{p.runs[0].results[1].dnsIpv4UdpBytes++;},/packet\/DNS/],
  ['DNS query arithmetic',p=>{p.runs[0].results[1].dnsQueries[0].query_bytes++;},/DNS byte arithmetic/],
  ['DNS flag representation',p=>{p.runs[0].results[1].dnsQueries[0].flags=8180;},/DNS byte arithmetic/],
  ['packet plus DNS sums',p=>{p.runs[0].results[1].estimatedTcpPlusDnsBytes++;},/packet\/DNS/],
  ['full-body packet subtraction',p=>{p.runs[0].results[1].estimatedTcpPlusDnsMinusBody++;},/packet\/DNS/],
  ['HTTP/2 plaintext sums',p=>{p.runs[0].results[0].responseHttp2TrailingPartialBytes++;},/HTTP\/2 plaintext/],
  ['HTTP/2 DATA lower bound',p=>{const r=p.runs[0].results[0];r.responseHttp2Frames.find(f=>f.type===0).payload_bytes=0;r.responseHttp2Frames.find(f=>f.type===1).payload_bytes+=r.bodyBytes;},/HTTP\/2 plaintext/],
  ['median and min/max recomputation',p=>{p.summary[0].tlsThroughBodyCompleteMinusBody.maximum++;},/summary is stale/],
  ['all summary URLs once',p=>{p.summary[1]=structuredClone(p.summary[0]);},/summary URLs/],
  ['all body-size summaries',p=>{p.summary[1].bodyBytes.median++;},/summary is stale/],
  ['explicit successful validation',p=>{p.validation.allCertificateVerified=false;},/validation did not pass/],
  ['no raw row metadata',p=>{p.runs[0].results[0].rawPacket='PRIVATE_SENTINEL';},/normal-trust/],
  ['no raw TLS metadata',p=>{p.runs[0].results[0].tlsHandshakeMessages[0].raw='PRIVATE_SENTINEL';},/TLS message metadata/],
  ['no raw DNS metadata',p=>{p.runs[0].results[0].dnsQueries[0].address='PRIVATE_SENTINEL';},/DNS byte arithmetic/],
  ['no unallowlisted top-level capture',p=>{p.rawPacket='PRIVATE_SENTINEL';},/peer comparison schema/]
];
for(const [name,change,pattern] of peerRejected)test('peer evidence rejects '+name,t=>{
  const f=fixture(t),save=f.peerComparison();change(f.data.peerComparison);save();assert.throws(f.check,pattern);
});
test('stale rendered peer date, range and link cannot be blessed by valid data',t=>{
  for(const [before,after] of [['Six-site sample — October 23, 2026','Six-site sample — October 22, 2026'],['5,253 (5,252–5,253)','5,253 (5,253–5,253)'],['](measurements/gallery-20261023-integrated.json)','](measurements/gallery-old.json)']]) {
    const f=fixture(t);f.peerComparison();const path=join(f.root,'COMPARISON.md');writeFileSync(path,readFileSync(path,'utf8').replace(before,after));assert.throws(f.check,/section is stale/);
  }
});
test('duplicate fresh peer markers outside the current section are rejected',t=>{
  const f=fixture(t);f.peerComparison();const path=join(f.root,'COMPARISON.md');
  writeFileSync(path,readFileSync(path,'utf8')+'\n<!-- comparison:fresh-gallery:start -->\n');
  assert.throws(f.check,/duplicate comparison fresh-gallery/);
});
test('a fresh peer section requires referenced peer evidence',t=>{
  const f=fixture(t),path=join(f.root,'COMPARISON.md');
  writeFileSync(path,readFileSync(path,'utf8')+'\n<!-- comparison:fresh-gallery:start -->\nStale table\n<!-- comparison:fresh-gallery:end -->\n');
  assert.throws(f.check,/Fresh peer section is stale/);
});

test('STREAM-offset runtime cannot omit its component evidence',t=>{const f=fixture(t);f.data.deployment.server.sourceFileHashes??={};f.data.deployment.server.sourceFileHashes['server/quic-stream-offset.patch']='a'.repeat(64);f.save('deployment');f.flush();assert.throws(f.check,/STREAM-offset runtime requires component evidence/);});
