// Synthetic metadata fixtures; no network, Git, public measurement or file writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture as offsetFixture} from './fin-fixture.mjs';
import {checkFinCoalescing,requireFinEvidence,runtimeRequiresFin,renderFinCoalescing,finDefinitions,finSourceFields,responseFraming} from './check-fin-coalescing.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture() {
  const f=offsetFixture(),s=f.record;
  f.sources=Object.fromEntries(Object.keys(finSourceFields).map(p=>[p,Buffer.from(p==='server/Dockerfile'?'COPY server/quic-fin.patch /build/\nRUN patch --fuzz=0 -p1 < /build/quic-fin.patch\n':'synthetic '+p)]));
  const readCommitted=(c,p)=>f.sources[p];
  f.deployment.server.sourceFileHashes=Object.fromEntries(Object.entries(f.sources).map(([p,b])=>[p,hash(b)]));
  f.deployment.pageCommit=s.after.pageCommitAtReadback;f.deployment.pageRelease=s.after.pageReleaseAtReadback;
  f.deployment.verifiedThrough='2026-10-23T12:00:00Z';
  const before=structuredClone(s.before),after=structuredClone(s.after);
  before.runtimeImageId='sha256:8358bfe170c58e7ae35523ef7d74fff5136347838d0006252d50c6a4091084ce';
  before.runtimeSourceCommit='17af6caedafe1cc40c311d02691a5ccaebfa2554';
  for(const frame of before.acceptedRelevantFrames)Object.assign(frame,{frameType:10,offPresent:false,offsetFieldBytes:0});
  const empty={streamId:0,frameType:15,offPresent:true,semanticOffset:437,offsetFieldBytes:2,streamIdFieldBytes:1,lengthPresent:true,lengthFieldBytes:1,dataBytes:0,fin:true};
  before.acceptedRelevantFrames.push(empty);before.allAcceptedStreamFrameCount++;
  for(const side of [before,after])side.firstAcceptedFrames=Object.fromEntries(Object.entries({control:3,qpackDecoder:7,response:0}).map(([r,id])=>[r,structuredClone(side.acceptedRelevantFrames.find(f=>f.streamId===id))]));
  Object.assign(after.acceptedRelevantFrames.find(f=>f.streamId===0),{fin:true,frameType:11});
  Object.assign(after.firstAcceptedFrames.response,{fin:true,frameType:11});
  f.streamOffsets={after:structuredClone(after)};
  f.baselineDeployment={runtimeSourceCommit:before.runtimeSourceCommit,server:{imageId:before.runtimeImageId},pageCommit:before.pageCommitAtReadback,pageRelease:before.pageReleaseAtReadback};
  f.record={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',protocol:'h3',definitions:structuredClone(finDefinitions),
    source:{runtimeSourceCommit:f.deployment.runtimeSourceCommit,...Object.fromEntries(Object.entries(finSourceFields).map(([p,k])=>[k,hash(f.sources[p])]))},
    before,after,framing:{before:responseFraming(before,'before'),after:responseFraming(after,'after')},
    deltas:{responseStreamFrameHeaderBytesSaved:5,emptyResponseFinFramesRemoved:1},normalizationSourceSha256:'6'.repeat(64),limitations:['Synthetic offline fixture only.']};
  f.readCommitted=readCommitted;
  f.check=()=>checkFinCoalescing(f.record,f);
  return f;
}
test('matched accepted FIN frames and source-derived type width pass',()=>{
  const f=fixture();assert.doesNotThrow(f.check);
  assert.match(renderFinCoalescing(f.record,{path:'measurements/synthetic-fin.json'}),/9 → 4 B \(5 B less\)/);
  assert.match(renderFinCoalescing(f.record,{path:'measurements/synthetic-fin.json'}),/source-derived/);
});
test('actual per-phase H3 payload sizes can vary while the complete body stays exact',()=>{
  const f=fixture();for(const frame of [f.record.after.firstAcceptedFrames.response,f.record.after.acceptedRelevantFrames.find(x=>x.streamId===0)])frame.dataBytes=438;
  f.record.framing.after=responseFraming(f.record.after,'after');f.streamOffsets.after=structuredClone(f.record.after);assert.doesNotThrow(f.check);
});
test('missing FIN reference is mandatory from actual Dockerfile even if metadata key is omitted',()=>{
  const f=fixture();delete f.deployment.server.sourceFileHashes['server/quic-fin.patch'];
  assert.equal(runtimeRequiresFin(f.deployment,f.readCommitted),true);
  assert.throws(()=>requireFinEvidence(f.deployment,null,f.readCommitted));
  assert.throws(f.check);
});
test('legacy runtime schema stays optional while the exact known FIN image cannot omit source',()=>{
  const fail=()=>{throw Error('Legacy fixture must not read a guessed commit');};
  assert.doesNotThrow(()=>requireFinEvidence({server:{imageId:'sha256:'+'a'.repeat(64)}},null,fail));
  assert.throws(()=>requireFinEvidence({server:{imageId:'sha256:60fe60ddb91f09f99e39360ad871782f3a36d47fe8bcadaca1159fd80fae7240'}},null,fail));
});
test('known FIN image cannot claim a valid older source commit to omit evidence',()=>{
  const d={runtimeSourceCommit:'17af6caedafe1cc40c311d02691a5ccaebfa2554',server:{imageId:'sha256:60fe60ddb91f09f99e39360ad871782f3a36d47fe8bcadaca1159fd80fae7240'}};
  assert.throws(()=>requireFinEvidence(d,null,()=>Buffer.from('FROM historical non-FIN runtime\n')));
});
for(const [name,change] of [
 ['current image',f=>f.record.after.runtimeImageId='sha256:'+'0'.repeat(64)],
 ['source commit',f=>f.record.source.runtimeSourceCommit='0'.repeat(40)],
 ['baseline runtime',f=>f.record.before.runtimeImageId=f.record.after.runtimeImageId],
 ['baseline page commit',f=>f.record.before.pageCommitAtReadback='0'.repeat(40)],
 ['baseline page release',f=>f.record.before.pageReleaseAtReadback='releases/other'],
 ['gate source hash',f=>f.record.source.verifyQuicFinSha256='0'.repeat(64)],
 ['missing extractor binding',f=>delete f.deployment.server.sourceFileHashes['tools/extract-quic-fin-fixtures.sh']],
 ['wrong page release',f=>f.deployment.pageRelease='releases/other'],
 ['stale zero-offset after',f=>f.streamOffsets.after.privateRawSnapshotSha256='0'.repeat(64)],
 ['untrusted response',f=>f.record.after.normalCertificateValidation=false],
 ['body mismatch',f=>f.record.after.bodyBytes=390],
 ['generation attestation',f=>f.record.after.perRequestGenerationVerified=true],
 ['substituted observer',f=>f.record.after.observer.sourceSha256='0'.repeat(64)],
 ['phase overlap',f=>f.record.after.startedAt=f.record.before.startedAt],
 ['missing separate baseline FIN',f=>f.record.before.acceptedRelevantFrames.pop()],
 ['baseline FIN with data',f=>f.record.before.acceptedRelevantFrames.at(-1).dataBytes=1],
 ['baseline FIN gap',f=>f.record.before.acceptedRelevantFrames.at(-1).semanticOffset++],
 ['duplicate accepted response',f=>{f.record.after.acceptedRelevantFrames.push(structuredClone(f.record.after.acceptedRelevantFrames.at(-1)));f.record.after.allAcceptedStreamFrameCount++;}],
 ['missing attached FIN',f=>{f.record.after.acceptedRelevantFrames.at(-1).fin=false;f.record.after.acceptedRelevantFrames.at(-1).frameType=10;f.record.after.firstAcceptedFrames.response=structuredClone(f.record.after.acceptedRelevantFrames.at(-1));}],
 ['implicit LEN unrelated change',f=>{f.record.after.acceptedRelevantFrames.at(-1).lengthPresent=false;f.record.after.acceptedRelevantFrames.at(-1).lengthFieldBytes=0;f.record.after.acceptedRelevantFrames.at(-1).frameType=9;}],
 ['framing count',f=>f.record.framing.before.totalResponseFrameHeaderBytes++],
 ['invented component delta',f=>f.record.deltas.responseStreamFrameHeaderBytesSaved=6],
 ['type width described as observed',f=>f.record.definitions.frameTypeBytes='Observed one-byte type'],
 ['raw payload leak',f=>f.record.after.acceptedRelevantFrames[0].payload='private'],
 ['verification too early',f=>f.deployment.verifiedThrough='2026-10-23T11:00:00Z'],
 ['post-readback beyond verification',f=>{f.record.after.runtimeReadbacks.after.startedAt='2026-10-23T13:00:00Z';f.record.after.runtimeReadbacks.after.completedAt='2026-10-23T13:00:00Z';f.streamOffsets.after=structuredClone(f.record.after);}],
 ['baseline post-readback overlaps after',f=>{f.record.before.runtimeReadbacks.after.startedAt='2026-10-23T11:57:00Z';f.record.before.runtimeReadbacks.after.completedAt='2026-10-23T11:57:00Z';}],
])test('rejects '+name,()=>{const f=fixture();change(f);assert.throws(f.check);});
