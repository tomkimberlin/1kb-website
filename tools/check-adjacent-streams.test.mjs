// Synthetic contracts only; the after identities below are not build attestations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repoRoot=process.env.ADJACENT_TEST_REPO??fileURLToPath(new URL('../',import.meta.url));
import {createHash} from 'node:crypto';
import {fixture as originalFixture} from './fin-fixture.mjs';
import {actualLenBinding} from './check-stream-lengths.mjs';
import {lenAnchor,actualAdjacentBinding,checkAdjacentComponent,checkAdjacentCurrentEvidence,checkAdjacentAdoption,checkHistoricalLen,checkBaselinePage,requireAdjacentEvidence,renderAdjacent} from './check-adjacent-streams.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const proofKeys=['buildResultSha256','nginxSha256','moduleSha256','imageConfigSha256','finIncludeSha256','lenIncludeSha256','adjacentGateResultSha256'];
function fixture() {
  const old=originalFixture(),before=JSON.parse(JSON.stringify(old.record.before).replaceAll('2026-10-23','2026-10-25')),after=JSON.parse(JSON.stringify(old.record.after).replaceAll('2026-10-23','2026-10-25'));
  const baselinePageCommit='c'.repeat(40),normalizerCommit='d'.repeat(40);
  before.pageCommitAtReadback=baselinePageCommit;before.pageReleaseAtReadback='releases/20261025T042442Z-synthetic-baseline';
  const baselineSource=readFileSync(join(repoRoot,'index.html'));
  const baselineBody=readFileSync(join(repoRoot,'compression/index.html.br'));
  const page={...old.page,html:baselineSource.length,htmlSha256:hash(baselineSource)};
  const normalizerBytes=Buffer.from('synthetic independently committed normalizer');
  const beforeRuntime={imageId:actualLenBinding.imageId,runtimeSourceCommit:actualLenBinding.runtimeSourceCommit,pageCommit:before.pageCommitAtReadback,pageRelease:before.pageReleaseAtReadback};
  const afterRuntime={imageId:old.deployment.server.imageId,runtimeSourceCommit:old.deployment.runtimeSourceCommit,pageCommit:after.pageCommitAtReadback,pageRelease:after.pageReleaseAtReadback};
  const frame=(streamId,semanticOffset,dataBytes,flags={})=>({streamId,frameType:flags.fin?9:semanticOffset?14:10,
    offPresent:semanticOffset>0,semanticOffset,offsetFieldBytes:semanticOffset?1:0,streamIdFieldBytes:1,
    lengthPresent:!flags.fin,lengthFieldBytes:flags.fin?0:1,dataBytes,fin:Boolean(flags.fin)});
  for(const [side,runtime] of [[before,beforeRuntime],[after,afterRuntime]]) {
    Object.assign(side,{runtimeImageId:runtime.imageId,runtimeSourceCommit:runtime.runtimeSourceCommit});
    side.acceptedRelevantFrames=[...(side===before?[frame(3,0,1),frame(3,1,8)]:[frame(3,0,9)]),frame(7,0,1),frame(0,0,437,{fin:true})];
    side.firstAcceptedFrames=Object.fromEntries(Object.entries({control:3,qpackDecoder:7,response:0}).map(([role,id])=>[role,structuredClone(side.acceptedRelevantFrames.find(f=>f.streamId===id))]));
    side.allAcceptedStreamFrameCount=side.acceptedRelevantFrames.length;
  }
  const sources={'server/Dockerfile':Buffer.from('COPY server/quic-adjacent-stream.patch /build/\nRUN patch --fuzz=0 -p1 < /build/quic-adjacent-stream.patch\n'),
    'server/quic-adjacent-stream.patch':Buffer.from('synthetic patch'),
    'tools/verify-quic-adjacent.c':Buffer.from('synthetic gate'),'tools/quic-adjacent-test.mk':Buffer.from('synthetic makefile'),
    'tools/extract-quic-adjacent-fixtures.sh':Buffer.from('synthetic extractor')};
  for(const p of ['server/quic-fin.patch','server/quic-packet-end-len.patch','server/quic-stream-offset.patch',
    'tools/extract-quic-fin-fixtures.sh','tools/extract-quic-packet-end-len.sh','tools/verify-quic-fin.c','tools/quic-fin-test.mk',
    'tools/verify-quic-packet-end-len.c','tools/quic-packet-end-len-test.mk'])sources[p]=Buffer.from('synthetic source '+p);
  const sourceFileHashes=Object.fromEntries(Object.entries(sources).map(([p,b])=>[p,hash(b)]));
  const actualBuildProof=Object.fromEntries(proofKeys.map((k,i)=>[k,String(i+1).repeat(64)]));
  const record={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',protocol:'h3',scope:'accepted-control-stream-header-component',
    source:{runtimeSourceCommit:afterRuntime.runtimeSourceCommit,sourceFileHashes},actualBuildProof,inheritedLen:structuredClone(lenAnchor),before,after,
    activation:{startedAt:'2026-10-25T11:00:00Z',completedAt:'2026-10-25T11:10:00Z'},
    framing:{before:{control:{dataBytes:9,frameCount:2,headerBytes:7},response:{dataBytes:437,headerBytes:2}},after:{control:{dataBytes:9,frameCount:1,headerBytes:3},response:{dataBytes:437,headerBytes:2}}},
    deltas:{controlHeaderBytesSaved:4},normalizationSourceSha256:hash(normalizerBytes),verifiedThrough:'2026-10-25T12:00:00Z',limitations:['Synthetic component fixture; no build or live claim.']};
  const context={page,beforeRuntime,afterRuntime,baselineVerifiedThrough:'2026-10-25T09:00:00Z',normalizerSha256:hash(normalizerBytes)};
  const deployment={runtimeSourceCommit:afterRuntime.runtimeSourceCommit,pageCommit:afterRuntime.pageCommit,pageRelease:afterRuntime.pageRelease,
    server:{imageId:afterRuntime.imageId,sourceFileHashes},runtimeActivation:structuredClone(record.activation),verifiedThrough:record.verifiedThrough};
  const readback=at=>({at,sha256:'6'.repeat(64),imageId:deployment.server.imageId,runtimeSourceCommit:deployment.runtimeSourceCommit,pageRelease:deployment.pageRelease});
  const overhead={serverRuntime:{imageId:deployment.server.imageId,runtimeSourceCommit:deployment.runtimeSourceCommit,pageRelease:deployment.pageRelease},
    bodyBytes:389,bodySha256:old.page.brotliSha256,captureWindow:{startedAt:'2026-10-25T11:30:00Z',completedAt:'2026-10-25T11:40:00Z',before:readback('2026-10-25T11:29:00Z'),after:readback('2026-10-25T11:41:00Z')},
    runs:[1,2,3].map(i=>({measuredAt:`2026-10-25T11:3${i}:00Z`,bodyBytes:389,bodySha256:old.page.brotliSha256,privateRawSnapshotSha256:String(i).repeat(64),
      tlsThroughBodyComplete:{sent:1000,received:2000},tlsThroughBodyCompleteMinusBody:2611,
      estimatedIpv4TcpBytesAt1500Mtu:3300,dnsIpv4UdpBytes:400,estimatedTcpPlusDnsBytes:3700,estimatedTcpPlusDnsMinusBody:3311,
      responseHttpPlainBytes:450,responseHttpPlainMinusBody:61}))};
  const runtime={runtimeImageId:deployment.server.imageId,runtimeSourceCommit:deployment.runtimeSourceCommit,runtimeReadbackAt:'2026-10-25T11:45:00Z'};
  const current={deployment,overhead,statusEncoding:{after:{...runtime,startedAt:'2026-10-25T11:44:00Z'}},
    quic:{after:{...runtime},parameterObservation:{afterArtifactModifiedAt:'2026-10-25T11:44:00Z'}}};
  const binding={imageId:afterRuntime.imageId,runtimeSourceCommit:afterRuntime.runtimeSourceCommit,sourceFileHashes,
    baseline:{...beforeRuntime,source:{bytes:baselineSource.length,sha256:hash(baselineSource)},body:{bytes:baselineBody.length,sha256:hash(baselineBody)},verifiedThrough:'2026-10-25T09:00:00Z'},
    normalizer:{sourceCommit:normalizerCommit,path:'tools/synthetic-normalizer.mjs',sha256:hash(normalizerBytes)},actualBuildProof:structuredClone(actualBuildProof)};
  const calls=[];
  const readNewCommitted=(c,p)=>{
    calls.push([c,p]);
    if(c===normalizerCommit&&p==='tools/synthetic-normalizer.mjs')return normalizerBytes;
    if(c===baselinePageCommit&&p==='index.html')return baselineSource;
    if(c===baselinePageCommit&&p==='compression/index.html.br')return baselineBody;
    if(c===afterRuntime.runtimeSourceCommit)return sources[p];
    throw Error('HISTORICAL_IMMUTABLE_SOURCE_REQUIRED');
  };
  return {record,context,current,sources,binding,readNewCommitted,calls,baselineSource,baselineBody,check:()=>checkAdjacentComponent(record,context),checkCurrent:()=>checkAdjacentCurrentEvidence(record,current)};
}
function syncRoles(side) {
  for(const [role,id] of Object.entries({control:3,qpackDecoder:7,response:0}))side.firstAcceptedFrames[role]=structuredClone(side.acceptedRelevantFrames.find(f=>f.streamId===id));
  side.allAcceptedStreamFrameCount=side.acceptedRelevantFrames.length;
}
test('full synthetic component has four header bytes less without a whole-exchange claim',()=>{
  const f=fixture();assert.doesNotThrow(f.check);assert.doesNotThrow(f.checkCurrent);
  const text=renderAdjacent(f.record,{path:'measurements/synthetic-adjacent.json'});
  assert.match(text,/7 → 3 B \(4 B less\)/);assert.match(text,/No fixed packet, complete-exchange, HTTP\/2 or latency saving/);
});
test('fresh baseline page, runtime source and later normalizer commit stay distinct',()=>{
  const f=fixture(),b=f.binding;
  assert.equal(new Set([b.runtimeSourceCommit,b.baseline.runtimeSourceCommit,b.baseline.pageCommit,b.normalizer.sourceCommit]).size,4);
  assert.notEqual(b.baseline.pageCommit,actualLenBinding.runtimeSourceCommit);
  assert.doesNotThrow(()=>checkBaselinePage(b.baseline,{page:f.context.page,readCommitted:f.readNewCommitted}));
  assert.doesNotThrow(f.check);
  assert.deepEqual(f.calls,[[b.baseline.pageCommit,'index.html'],[b.baseline.pageCommit,'compression/index.html.br']]);
});
test('historical page commit cannot substitute for independently pinned fresh baseline',()=>{
  const f=fixture();f.record.before.pageCommitAtReadback=actualLenBinding.runtimeSourceCommit;
  assert.throws(f.check,/phase runtime\/page/);
});
test('historical release cannot substitute for independently pinned fresh baseline',()=>{
  const f=fixture();f.record.before.pageReleaseAtReadback='releases/historical-oct23';
  assert.throws(f.check,/phase runtime\/page/);
});
for(const [name,mutate] of [
  ['wrong baseline image',f=>f.binding.baseline.imageId='sha256:'+'f'.repeat(64)],
  ['wrong baseline runtime source',f=>f.binding.baseline.runtimeSourceCommit='f'.repeat(40)],
  ['wrong complete baseline body hash',f=>f.binding.baseline.body.sha256='0'.repeat(64)],
  ['wrong complete baseline body length',f=>f.binding.baseline.body.bytes=390],
  ['unknown baseline field',f=>f.binding.baseline.privateIp='private'],
  ['wrong baseline source hash',f=>f.binding.baseline.source.sha256='0'.repeat(64)],
])test('baseline binding rejects '+name,()=>{
  const f=fixture();mutate(f);assert.throws(()=>checkBaselinePage(f.binding.baseline,{page:f.context.page,readCommitted:f.readNewCommitted}));
});
test('committed baseline Brotli bytes must match their pinned hash',()=>{
  const f=fixture();assert.throws(()=>checkBaselinePage(f.binding.baseline,{page:f.context.page,
    readCommitted:(c,p)=>p==='compression/index.html.br'?Buffer.alloc(389):f.readNewCommitted(c,p)}),/committed body\/source/);
});
test('committed baseline HTML must match its pinned hash',()=>{
  const f=fixture();assert.throws(()=>checkBaselinePage(f.binding.baseline,{page:f.context.page,
    readCommitted:(c,p)=>p==='index.html'?Buffer.alloc(f.baselineSource.length):f.readNewCommitted(c,p)}),/committed body\/source/);
});
test('source-derived type byte remains present in both totals',()=>{
  const f=fixture();f.record.framing.before.control.headerBytes-=2;f.record.framing.after.control.headerBytes--;
  assert.throws(f.check,/header arithmetic/);
});
test('equal-size control sequence cannot claim a reduction',()=>{
  const f=fixture();f.record.before.acceptedRelevantFrames=structuredClone(f.record.after.acceptedRelevantFrames);syncRoles(f.record.before);
  f.record.framing.before=structuredClone(f.record.framing.after);f.record.deltas.controlHeaderBytesSaved=0;
  assert.throws(f.check,/no reduction/);
});
test('different response-stream framing payload may retain the same complete body',()=>{
  const f=fixture();f.record.after.acceptedRelevantFrames.at(-1).dataBytes=438;syncRoles(f.record.after);f.record.framing.after.response.dataBytes=438;
  assert.doesNotThrow(f.check);
});
test('component counts a complete sequence even when accepted frames are reordered',()=>{
  const f=fixture();f.record.before.acceptedRelevantFrames.reverse();
  // firstAcceptedFrames deliberately stays the first accepted zero-offset row;
  // swapping only the two control rows would violate that observer contract.
  f.record.before.acceptedRelevantFrames=[f.record.before.acceptedRelevantFrames[0],f.record.before.acceptedRelevantFrames[1],f.record.before.acceptedRelevantFrames[3],f.record.before.acceptedRelevantFrames[2]];
  syncRoles(f.record.before);assert.doesNotThrow(f.check);
});
for(const [name,mutate] of [
  ['unknown top-level raw payload',f=>f.record.payload='secret'],
  ['unknown phase endpoint',f=>f.record.after.remoteAddress='private'],
  ['unknown activation field',f=>f.record.activation.privatePath='/private'],
  ['unknown raw frame',f=>f.record.after.acceptedRelevantFrames[0].data='private'],
  ['unsafe source path',f=>f.record.source.sourceFileHashes['../private']='1'.repeat(64)],
  ['malformed source hash',f=>f.record.source.sourceFileHashes['server/Dockerfile']='wrong'],
  ['unknown build proof',f=>f.record.actualBuildProof.privatePath='/private'],
  ['wrong schema scope',f=>f.record.scope='whole-exchange'],
  ['crossed runtime source',f=>f.record.after.runtimeSourceCommit='7'.repeat(40)],
  ['crossed runtime image',f=>f.record.after.runtimeImageId='sha256:'+'7'.repeat(64)],
  ['source metadata differs from after',f=>f.record.source.runtimeSourceCommit='7'.repeat(40)],
  ['old page release',f=>f.record.after.pageReleaseAtReadback='releases/old'],
  ['stale body length',f=>f.record.after.bodyBytes=388],
  ['stale body hash',f=>f.record.before.bodySha256='0'.repeat(64)],
  ['changed page record',f=>f.context.page.brotliSha256='0'.repeat(64)],
  ['wrong normalizer hash',f=>f.record.normalizationSourceSha256='0'.repeat(64)],
  ['unverified fixture CA',f=>f.record.after.normalCertificateValidation=false],
  ['fixture observer version',f=>f.record.after.observer.versions.pylsqpack='0.3.23'],
  ['false per-request attestation',f=>f.record.after.perRequestGenerationVerified=true],
  ['reused raw snapshot',f=>f.record.after.privateRawSnapshotSha256=f.record.before.privateRawSnapshotSha256],
  ['baseline observation not fresh',f=>f.context.baselineVerifiedThrough='2026-10-26T00:00:00Z'],
  ['activation precedes before',f=>f.record.activation.startedAt='2026-10-25T10:00:00Z'],
  ['after precedes activation',f=>f.record.activation.completedAt='2026-10-25T12:00:00Z'],
  ['final verification precedes after',f=>f.record.verifiedThrough='2026-10-25T11:50:00Z'],
  ['invalid calendar date',f=>f.record.activation.startedAt='2026-02-30T11:00:00Z'],
  ['missing later control frame',f=>{f.record.before.acceptedRelevantFrames.splice(1,1);syncRoles(f.record.before);}],
  ['duplicate accepted control frame',f=>{f.record.before.acceptedRelevantFrames.splice(1,0,structuredClone(f.record.before.acceptedRelevantFrames[0]));syncRoles(f.record.before);}],
  ['control gap',f=>{f.record.before.acceptedRelevantFrames[1].semanticOffset=2;syncRoles(f.record.before);}],
  ['control overlap',f=>{f.record.before.acceptedRelevantFrames[1].semanticOffset=0;f.record.before.acceptedRelevantFrames[1].offPresent=false;f.record.before.acceptedRelevantFrames[1].offsetFieldBytes=0;f.record.before.acceptedRelevantFrames[1].frameType=10;syncRoles(f.record.before);}],
  ['crossed control role',f=>{f.record.before.acceptedRelevantFrames[1].streamId=7;syncRoles(f.record.before);}],
  ['wrong first-role summary',f=>f.record.after.firstAcceptedFrames.control.streamId=7],
  ['illegal control length width',f=>{f.record.after.acceptedRelevantFrames[0].lengthFieldBytes=3;syncRoles(f.record.after);}],
  ['control FIN',f=>{f.record.after.acceptedRelevantFrames[0].fin=true;f.record.after.acceptedRelevantFrames[0].frameType|=1;syncRoles(f.record.after);}],
  ['response FIN removed',f=>{f.record.after.acceptedRelevantFrames.at(-1).fin=false;f.record.after.acceptedRelevantFrames.at(-1).frameType=8;syncRoles(f.record.after);}],
  ['response payload confused with body',f=>{f.record.after.acceptedRelevantFrames.at(-1).dataBytes=388;syncRoles(f.record.after);}],
  ['combined FIN/LEN saving',f=>f.record.deltas.controlHeaderBytesSaved=11],
  ['first-frame-only arithmetic',f=>{f.record.framing.before.control={dataBytes:1,frameCount:1,headerBytes:3};f.record.deltas.controlHeaderBytesSaved=0;}],
  ['unaccounted later after frame',f=>{f.record.after.acceptedRelevantFrames.splice(1,0,structuredClone(f.record.after.acceptedRelevantFrames[0]));syncRoles(f.record.after);}],
  ['mutated historical reference',f=>f.record.inheritedLen.component.sha256='0'.repeat(64)],
])test('component rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(f.check);});
for(const [name,mutate] of [
  ['stale activation',f=>f.current.deployment.runtimeActivation.completedAt='2026-10-25T11:11:00Z'],
  ['capture before activation',f=>f.current.overhead.captureWindow.startedAt='2026-10-25T11:00:00Z'],
  ['missing capture window',f=>delete f.current.overhead.captureWindow],
  ['unknown capture window field',f=>f.current.overhead.captureWindow.endpoint='private'],
  ['unknown capture readback field',f=>f.current.overhead.captureWindow.after.raw='private'],
  ['crossed readback image',f=>f.current.overhead.captureWindow.after.imageId='sha256:'+'0'.repeat(64)],
  ['crossed readback source',f=>f.current.overhead.captureWindow.before.runtimeSourceCommit='0'.repeat(40)],
  ['crossed readback release',f=>f.current.overhead.captureWindow.after.pageRelease='releases/old'],
  ['readback before capture complete',f=>f.current.overhead.captureWindow.after.at='2026-10-25T11:39:00Z'],
  ['readback after verification',f=>f.current.overhead.captureWindow.after.at='2026-10-25T12:01:00Z'],
  ['capture row outside window',f=>f.current.overhead.runs[0].measuredAt='2026-10-25T11:29:00Z'],
  ['old overhead source',f=>f.current.overhead.serverRuntime.runtimeSourceCommit='0'.repeat(40)],
  ['body-subtraction allowance',f=>f.current.overhead.runs[0].tlsThroughBodyCompleteMinusBody++],
  ['packet sum drift',f=>f.current.overhead.runs[0].estimatedTcpPlusDnsBytes++],
  ['plaintext subtraction drift',f=>f.current.overhead.runs[0].responseHttpPlainMinusBody++],
  ['stale overhead body',f=>f.current.overhead.runs[1].bodyBytes=390],
  ['duplicate capture raw',f=>f.current.overhead.runs[1].privateRawSnapshotSha256=f.current.overhead.runs[0].privateRawSnapshotSha256],
  ['stale status',f=>f.current.statusEncoding.after.startedAt='2026-10-25T11:00:00Z'],
  ['status readback precedes probe',f=>f.current.statusEncoding.after.runtimeReadbackAt='2026-10-25T11:43:00Z'],
  ['old QUIC image',f=>f.current.quic.after.runtimeImageId='sha256:'+'0'.repeat(64)],
  ['stale QUIC observation',f=>f.current.quic.parameterObservation.afterArtifactModifiedAt='2026-10-25T11:00:00Z'],
  ['QUIC readback precedes observation',f=>f.current.quic.after.runtimeReadbackAt='2026-10-25T11:43:00Z'],
])test('current-window rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(f.checkCurrent);});
test('no production binding is fabricated and observed adoption cannot bypass it',()=>{
  const f=fixture();assert.equal(actualAdjacentBinding,null);
  const readCommitted=(c,p)=>f.sources[p];
  assert.throws(()=>requireAdjacentEvidence(f.current.deployment,null,readCommitted),/requires fresh/);
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,page:f.context.page,readCommitted}),/binding unavailable/);
});
test('known image cannot omit evidence using an older Dockerfile',()=>{
  const f=fixture();assert.throws(()=>requireAdjacentEvidence(f.current.deployment,null,()=>Buffer.from('FROM old'),f.binding),/requires fresh/);
});
test('an unrelated historical runtime remains on the existing path',()=>{
  assert.doesNotThrow(()=>requireAdjacentEvidence({runtimeSourceCommit:'1'.repeat(40),server:{imageId:actualLenBinding.imageId}},null,()=>Buffer.from('FROM old')));
});
test('legacy metadata without an image does not equal the absent new binding',()=>{
  assert.doesNotThrow(()=>requireAdjacentEvidence({},null,()=>{throw Error('no source requested');}));
});
test('binding cannot come from component evidence and crossed build proof fails before history',()=>{
  const f=fixture();f.record.actualBuildProof.imageConfigSha256='0'.repeat(64);
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,page:f.context.page,binding:f.binding,readCommitted:(c,p)=>f.sources[p],readRecord:()=>{throw Error('history reached');}}),/source\/build proof/);
});
test('an unsafe binding source is rejected',()=>{
  const f=fixture();f.binding.sourceFileHashes['../private']='1'.repeat(64);
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:(c,p)=>f.sources[p]}),/source\/gate binding/);
});
test('changed committed patch bytes cannot be blessed by matching JSON identities',()=>{
  const f=fixture();
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:(c,p)=>p.endsWith('.patch')?Buffer.from('changed bytes'):f.sources[p]}),/immutable source\/gate/);
});
test('omitted native gate hashes cannot serve as a reviewed build binding',()=>{
  const f=fixture();delete f.binding.sourceFileHashes['tools/verify-quic-adjacent.c'];
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:(c,p)=>f.sources[p]}),/source\/gate binding/);
});
test('changed FIN extractor cannot be omitted from a new source binding',()=>{
  const f=fixture();delete f.binding.sourceFileHashes['tools/extract-quic-fin-fixtures.sh'];
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:(c,p)=>f.sources[p]}),/source\/gate binding/);
});
test('valid synthetic new-source guards still require immutable historical sources',()=>{
  const f=fixture(),root=repoRoot;
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,page:f.context.page,binding:f.binding,
    readRecord:p=>readFileSync(join(root,p)),readCommitted:f.readNewCommitted}),/HISTORICAL_IMMUTABLE_SOURCE_REQUIRED/);
});
test('normalizer is read from its separate reviewed tool commit before immutable history',()=>{
  const f=fixture(),root=repoRoot;
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,page:f.context.page,binding:f.binding,
    readRecord:p=>readFileSync(join(root,p)),readCommitted:f.readNewCommitted}),/HISTORICAL_IMMUTABLE_SOURCE_REQUIRED/);
  assert.ok(f.calls.some(([c,p])=>c===f.binding.normalizer.sourceCommit&&p===f.binding.normalizer.path));
  assert.ok(!f.calls.some(([c,p])=>c===f.binding.runtimeSourceCommit&&p===f.binding.normalizer.path));
});
test('normalizer without an independent commit is invalid',()=>{
  const f=fixture();delete f.binding.normalizer.sourceCommit;
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:f.readNewCommitted}),/normalizer binding/);
});
test('substituting runtime commit for the tool commit fails the immutable normalizer hash',()=>{
  const f=fixture();f.binding.normalizer.sourceCommit=f.binding.runtimeSourceCommit;
  assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,
    readCommitted:(c,p)=>p===f.binding.normalizer.path?Buffer.from('wrong runtime source'):f.readNewCommitted(c,p)}),/immutable normalizer/);
});
for(const path of ['tools/verify-quic-adjacent.c','tools/quic-adjacent-test.mk','tools/extract-quic-adjacent-fixtures.sh'])
  test('exact adjacent gate cannot be replaced: '+path,()=>{
    const f=fixture();delete f.binding.sourceFileHashes[path];
    for(const p of ['tools/arbitrary.c','tools/arbitrary.mk','tools/arbitrary.sh'])f.binding.sourceFileHashes[p]='8'.repeat(64);
    assert.throws(()=>checkAdjacentAdoption(f.record,{...f.current,binding:f.binding,readCommitted:f.readNewCommitted}),/source\/gate binding/);
  });
test('real historical bytes retain the pinned SHA-256 references',()=>{
  const root=repoRoot;assert.ok(root,'Runner must supply repository for read-only historical data');
  for(const ref of Object.values(lenAnchor))assert.equal(hash(readFileSync(join(root,ref.path))),ref.sha256);
});
test('a rehashed replacement of the historical reference is rejected before reading',()=>{
  const changed=structuredClone(lenAnchor);changed.component.sha256='0'.repeat(64);
  assert.throws(()=>checkHistoricalLen(changed,{readRecord:()=>{throw Error('should not read');}}),/anchor changed/);
});
test('historical bytes cannot be replaced while keeping the exact anchor',()=>{
  assert.throws(()=>checkHistoricalLen(lenAnchor,{readRecord:()=>Buffer.from('{}')}),/evidence hash/);
});
test('valid historical references reach the unchanged historical validator, with no bypass callback',()=>{
  const root=repoRoot;
  assert.throws(()=>checkHistoricalLen(lenAnchor,{readRecord:p=>readFileSync(join(root,p)),readCommitted:()=>{throw Error('IMMUTABLE_SOURCE_REQUIRED');}}),/IMMUTABLE_SOURCE_REQUIRED/);
});
