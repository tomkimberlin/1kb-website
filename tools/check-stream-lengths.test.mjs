// Portable synthetic metadata controls. No network, Git, files or actual after claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture as offsetFixture} from './fin-fixture.mjs';
import {checkCurrentLen,requireCurrentLen,checkLenAdoption,finAnchor,actualLenBinding,actualBuildProof,lenNormalizerSourcePin,selectedRoleWidths,renderLen} from './check-stream-lengths.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture() {
  const f=offsetFixture(),before=structuredClone(f.record.before),after=structuredClone(f.record.after);
  const sources={'server/quic-packet-end-len.patch':Buffer.from('synthetic LEN patch'),'tools/synthetic-len.c':Buffer.from('synthetic gate'),'tools/synthetic-len.mk':Buffer.from('synthetic makefile'),
    'server/Dockerfile':Buffer.from('COPY server/quic-packet-end-len.patch /build/\nRUN patch --fuzz=0 -p1 < /build/quic-packet-end-len.patch\n')};
  const binding={imageId:f.deployment.server.imageId,runtimeSourceCommit:f.deployment.runtimeSourceCommit,
    patch:{path:'server/quic-packet-end-len.patch',sha256:hash(sources['server/quic-packet-end-len.patch'])},
    gateSources:['tools/synthetic-len.c','tools/synthetic-len.mk'].map(path=>({path,sha256:hash(sources[path])}))};
  Object.assign(before,{runtimeImageId:finAnchor.imageId,runtimeSourceCommit:finAnchor.runtimeSourceCommit});
  for(const [side,explicit] of [[before,true],[after,false]]) {
    for(const frame of side.acceptedRelevantFrames) {
      Object.assign(frame,{offPresent:false,semanticOffset:0,offsetFieldBytes:0,frameType:10});
      if(frame.streamId===0)Object.assign(frame,{frameType:explicit?11:9,fin:true,lengthPresent:explicit,lengthFieldBytes:explicit?2:0});
    }
    side.firstAcceptedFrames=Object.fromEntries(Object.entries({control:3,qpackDecoder:7,response:0}).map(([r,id])=>[r,structuredClone(side.acceptedRelevantFrames.find(x=>x.streamId===id))]));
  }
  const deployment=structuredClone(f.deployment);deployment.pageCommit=after.pageCommitAtReadback;deployment.pageRelease=after.pageReleaseAtReadback;
  deployment.verifiedThrough='2026-10-23T12:00:00Z';deployment.server.sourceFileHashes=Object.fromEntries(Object.entries(sources).map(([p,b])=>[p,hash(b)]));
  const inheritedFin={deployment:{verifiedThrough:'2026-10-23T10:00:00Z',server:{imageId:finAnchor.imageId},pageCommit:before.pageCommitAtReadback,pageRelease:before.pageReleaseAtReadback},component:{after:{privateRawSnapshotSha256:'6'.repeat(64)}}};
  const record={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',protocol:'h3',source:{runtimeSourceCommit:binding.runtimeSourceCommit,patch:binding.patch,gateSources:binding.gateSources,dockerfileSha256:hash(sources['server/Dockerfile'])},
    before,after,framing:{before:{responseDataBytes:437,responseFrameHeaderBytes:4,lengthFieldBytes:2,frameTypeBytesDerivedFromSource:1},after:{responseDataBytes:437,responseFrameHeaderBytes:2,lengthFieldBytes:0,frameTypeBytesDerivedFromSource:1}},
    deltas:{lengthFieldBytesSaved:2,responseFrameHeaderBytesSaved:2},selectedRoleLengthMetadata:{before:selectedRoleWidths(before),after:selectedRoleWidths(after)},normalizationSourceSha256:lenNormalizerSourcePin,limitations:['Synthetic unit fixture only.']};
  const context={deployment,page:f.page,binding,inheritedFin,streamOffsets:{after:structuredClone(after)},readCommitted:(c,p)=>sources[p]};
  return {record,context,check:()=>checkCurrentLen(record,context)};
}
test('separate response4-to2 shape passes synthetic contract without recomputing FIN9-to4',()=>{
  const f=fixture();assert.doesNotThrow(f.check);assert.match(renderLen(f.record,{path:'measurements/synthetic.json'}),/4 → 2 B/);assert.match(renderLen(f.record,{path:'measurements/synthetic.json'}),/earlier FIN 9 → 4 B/);
});
test('actual per-phase stream data may vary while the encoded body stays389',()=>{
  const f=fixture();f.record.after.acceptedRelevantFrames.find(r=>r.streamId===0).dataBytes=438;f.record.after.firstAcceptedFrames.response.dataBytes=438;
  f.record.framing.after.responseDataBytes=438;f.record.selectedRoleLengthMetadata.after=selectedRoleWidths(f.record.after);f.context.streamOffsets.after=structuredClone(f.record.after);assert.doesNotThrow(f.check);
});
for(const [name,mutate] of [
 ['missing after',f=>delete f.record.after],['stale before page',f=>f.record.before.pageCommitAtReadback='0'.repeat(40)],
 ['stale before release',f=>f.record.before.pageReleaseAtReadback='releases/stale'],['historical raw reused',f=>f.record.before.privateRawSnapshotSha256='6'.repeat(64)],
 ['wrong complete body',f=>f.record.after.bodyBytes=390],['stale refreshed offset after',f=>f.context.streamOffsets.after.privateRawSnapshotSha256='9'.repeat(64)],
 ['post-readback after verification',f=>f.record.after.runtimeReadbacks.after.completedAt='2099-01-01T00:00:00Z'],
 ['invented combined7B FIN delta',f=>f.record.deltas.responseFrameHeaderBytesSaved=7],
 ['wrong header arithmetic',f=>f.record.framing.after.responseFrameHeaderBytes=1],
 ['missing normalization identity',f=>delete f.record.normalizationSourceSha256],['wrong normalization source',f=>f.record.normalizationSourceSha256='7'.repeat(64)],['missing scope',f=>delete f.record.limitations],
 ['invented selected response width',f=>f.record.selectedRoleLengthMetadata.after.response.lengthFieldBytes=2],
 ['invented selected control width',f=>f.record.selectedRoleLengthMetadata.before.control.lengthFieldBytes=0],
 ['missing selected role',f=>delete f.record.selectedRoleLengthMetadata.after.qpackDecoder],
 ['unknown raw frame property',f=>f.record.after.acceptedRelevantFrames[0].payload='private'],
 ['missing gate source',f=>f.record.source.gateSources=[]],['wrong immutable patch',f=>f.record.source.patch={...f.record.source.patch,sha256:'0'.repeat(64)}],
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(f.check);});
test('known actual image cannot omit LEN with an old valid commit',()=>assert.throws(()=>checkLenAdoption(null,{deployment:{server:{imageId:actualLenBinding.imageId},runtimeSourceCommit:finAnchor.runtimeSourceCommit},readCommitted:()=>Buffer.from('FROM historical FIN')})));
test('immutable Dockerfile independently requires evidence for an explicitly bound image',()=>{
  const f=fixture();assert.throws(()=>requireCurrentLen(f.context.deployment,null,f.context.binding,f.context.readCommitted));
});
test('historical non-LEN schema remains optional',()=>assert.equal(checkLenAdoption(null,{deployment:{server:{imageId:finAnchor.imageId},runtimeSourceCommit:finAnchor.runtimeSourceCommit},readCommitted:()=>Buffer.from('COPY server/quic-fin.patch /build/')}),null));

test('public inherited component reference cannot disagree with the loaded historical FIN chain',()=>{
  const d={server:{imageId:actualLenBinding.imageId},runtimeSourceCommit:actualLenBinding.runtimeSourceCommit,quicFinCoalescing:finAnchor.component};
  assert.throws(()=>checkLenAdoption({actualBuildProof,inheritedFin:{deployment:finAnchor.deployment,component:{...finAnchor.component,sha256:'0'.repeat(64)}}},
    {deployment:d,readCommitted:()=>Buffer.from('FROM synthetic'),readRecord:()=>{throw Error('Should reject before loading history');}}),/Historical FIN anchor changed/);
});
