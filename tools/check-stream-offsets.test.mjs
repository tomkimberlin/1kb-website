// Synthetic guard fixtures only; no public result, network, Git or ignored inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkStreamOffsets,renderStreamOffsets,checkFreshQuicAfter} from './check-stream-offsets.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

function fixture() {
  const sources={'server/quic-stream-offset.patch':Buffer.from('synthetic fixture patch'),'server/Dockerfile':Buffer.from('synthetic fixture Dockerfile')};
  const deployment={runtimeSourceCommit:'a'.repeat(40),server:{imageId:'sha256:'+'b'.repeat(64),sourceFileHashes:Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,hash(value)]))}};
  const page={brotli:389,brotliSha256:'ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e'};
  const observer={sourceSha256:'297e152798685065bb02b0b3d55685e8fa8840dff39e5ad8a3c0e18e1be489c0',
    versions:{python:'3.13.16',aioquic:'1.3.0',pylsqpack:'0.3.24',cryptography:'50.0.2',certifi:'2026.10.19'},
    aioquicSourceSha256:{'aioquic.quic.connection':'f6d0bd15ea563a3bd68518e3d4a6b918f4c9341048f850b27aa582f3a63fab65','aioquic.asyncio.client':'5159d2e28bd33da386c59dbac99dbb35ee47ecf4b480596367299c5ec03dd1c9','aioquic.h3.connection':'696e9c3735de11c314b8cd1e7e1265761a9373d1bbd2dbdf66570961dac839cd'},
    reusedSourceSha256:{'tools/verify-http3.py':'07c4f5f1d1fe1ce3768c1b3599182b2ad2b24f5b61ba5a8235fcd3fd74ce03e9','tools/probe_response.py':'e16a4fba43ee63f94cedcdb16b8e76bba53544109b55e275872883e31ab07eaa'}};
  const record={schemaVersion:1,targetUrl:'https://tomkimberlin.com/',protocol:'h3',source:{runtimeSourceCommit:deployment.runtimeSourceCommit,
    streamOffsetPatchSha256:hash(sources['server/quic-stream-offset.patch']),dockerfileSha256:hash(sources['server/Dockerfile'])},limitations:['Synthetic component fixture only.'],deltas:{}};
  for(const [phase,hour] of [['before','10'],['after','11']]) {
    const frames=Object.entries({control:3,qpackDecoder:7,response:0}).map(([role,streamId])=>({streamId,frameType:phase==='before'?14:10,
      offPresent:phase==='before',semanticOffset:0,offsetFieldBytes:phase==='before'?1:0,streamIdFieldBytes:1,lengthPresent:true,lengthFieldBytes:role==='response'?2:1,dataBytes:role==='response'?437:1,fin:false}));
    const time=`2026-10-23T${hour}:56:14`;
    record[phase]={runtimeImageId:phase==='after'?deployment.server.imageId:'sha256:'+'f'.repeat(64),runtimeSourceCommit:deployment.runtimeSourceCommit,
      pageCommitAtReadback:'1'.repeat(40),pageReleaseAtReadback:'releases/synthetic-fixture',perRequestGenerationVerified:false,privateRawSnapshotSha256:(phase==='before'?'2':'3').repeat(64),
      passed:true,normalCertificateValidation:true,freshConnection:true,streamRolesVerified:true,handshake:{alpn:'h3',sessionResumed:false,earlyDataAccepted:false},
      statusCode:200,exactBrotliBody:true,bodyBytes:389,bodySha256:page.brotliSha256,observer:structuredClone(observer),
      startedAt:time+'.556Z',observationStoppedAt:time+'.580Z',completedAt:time+'.669Z',
      runtimeReadbacks:{precisionSeconds:1,before:{startedAt:time+'Z',completedAt:time+'Z',sha256:'4'.repeat(64)},after:{startedAt:time+'Z',completedAt:time+'Z',sha256:'5'.repeat(64)}},
      firstAcceptedFrames:Object.fromEntries(Object.keys({control:3,qpackDecoder:7,response:0}).map((k,i)=>[k,structuredClone(frames[i])])),acceptedRelevantFrames:frames,allAcceptedStreamFrameCount:3};
  }
  for(const role of ['control','qpackDecoder','response'])record.deltas[role]={offsetFieldBytesSaved:1};
  return {record,deployment,page,check:()=>checkStreamOffsets(record,{deployment,page,readCommitted:(commit,path)=>sources[path]})};
}

const first=(side,role,values)=>{Object.assign(side.firstAcceptedFrames[role],values);Object.assign(side.acceptedRelevantFrames.find(f=>f.streamId===side.firstAcceptedFrames[role].streamId),values);};
const append=(side,values)=>{side.acceptedRelevantFrames.push({...side.acceptedRelevantFrames[0],...values});side.allAcceptedStreamFrameCount++;};

test('valid nonminimal QUIC widths remain accepted',()=>{const f=fixture();for(const side of [f.record.before,f.record.after]){first(side,'control',{streamIdFieldBytes:8,lengthFieldBytes:2});append(side,{frameType:14,offPresent:true,semanticOffset:64,offsetFieldBytes:4,lengthFieldBytes:8});}assert.doesNotThrow(f.check);});

test('matched component fixture and coarse same-second readbacks pass',()=>{const f=fixture();assert.doesNotThrow(f.check);assert.match(renderStreamOffsets(f.record,{path:'measurements/stream-fixture.json'}),/1 B less in each of 3 first-accepted zero-offset frames/);});
for(const [name,change] of [
  ['current image',f=>f.record.after.runtimeImageId='sha256:'+'0'.repeat(64)],
  ['reused image',f=>f.record.before.runtimeImageId=f.record.after.runtimeImageId],
  ['reused raw snapshot',f=>f.record.after.privateRawSnapshotSha256=f.record.before.privateRawSnapshotSha256],
  ['immutable patch',f=>f.record.source.streamOffsetPatchSha256='0'.repeat(64)],
  ['runtime source commit',f=>f.record.source.runtimeSourceCommit='0'.repeat(40)],
  ['observer identity',f=>f.record.after.observer.sourceSha256='0'.repeat(64)],
  ['client versions',f=>f.record.after.observer.versions.python='different'],
  ['normal trust',f=>f.record.after.normalCertificateValidation=false],
  ['before body',f=>f.record.before.bodySha256='0'.repeat(64)],
  ['substituted module pins in both phases',f=>{for(const side of [f.record.before,f.record.after])for(const key of Object.keys(side.observer.aioquicSourceSha256))side.observer.aioquicSourceSha256[key]='0'.repeat(64);}],
  ['substituted reused pins in both phases',f=>{for(const side of [f.record.before,f.record.after])for(const key of Object.keys(side.observer.reusedSourceSha256))side.observer.reusedSourceSha256[key]='0'.repeat(64);}],
  ['impossible one-byte LEN value',f=>first(f.record.after,'control',{dataBytes:64,lengthFieldBytes:1})],
  ['impossible one-byte OFF value',f=>append(f.record.after,{frameType:14,offPresent:true,semanticOffset:64,offsetFieldBytes:1})],
  ['fractional readback precision',f=>f.record.after.runtimeReadbacks.before.completedAt='2026-10-23T11:56:14.100Z'],
  ['before readback ending after observation and after readback',f=>f.record.after.runtimeReadbacks.before.completedAt='2026-10-23T11:56:16Z'],
  ['after readback starting too early but ending later',f=>f.record.after.runtimeReadbacks.after.startedAt='2026-10-23T11:56:13Z'],
  ['unordered readback phases',f=>{f.record.after.runtimeReadbacks.before.completedAt='2026-10-23T11:56:14Z';f.record.after.runtimeReadbacks.after.startedAt='2026-10-23T11:56:13Z';}],
  ['current body',f=>f.record.after.bodySha256='0'.repeat(64)],
  ['OFF bit consistency',f=>f.record.after.acceptedRelevantFrames[0].offPresent=true],
  ['zero offset semantics',f=>f.record.after.acceptedRelevantFrames[0].semanticOffset=1],
  ['first observation',f=>f.record.after.firstAcceptedFrames.response.dataBytes++],
  ['offset-field delta',f=>f.record.deltas.control.offsetFieldBytesSaved=3],
  ['raw payload field',f=>f.record.after.acceptedRelevantFrames[0].payload='private'],
  ['malformed timestamp',f=>f.record.after.runtimeReadbacks.after.completedAt='2026-02-31T11:56:14Z'],
  ['readback envelope',f=>f.record.after.runtimeReadbacks.after.completedAt='2026-10-23T11:55:14Z'],
  ['generation claim',f=>f.record.after.perRequestGenerationVerified=true],
])test('rejects stale/invalid '+name,()=>{const f=fixture();change(f);assert.throws(f.check);});

function quicFixture() {
  const stream=fixture(),{record:streamOffsets,deployment}=stream;
  const sources={'server/Dockerfile':Buffer.from('fresh fixture Dockerfile'),'server/quic-defaults.patch':Buffer.from('fresh ACK fixture'),'server/quic-backend-defaults.patch':Buffer.from('fresh limits fixture')};
  deployment.verifiedThrough='2026-10-23T11:59:00Z';
  deployment.server.sourceFileHashes=Object.fromEntries(Object.entries(sources).map(([path,value])=>[path,hash(value)]));
  const quic={source:{runtimeSourceCommit:deployment.runtimeSourceCommit,dockerfileSha256:hash(sources['server/Dockerfile']),quicDefaultsPatchSha256:hash(sources['server/quic-defaults.patch']),quicBackendDefaultsPatchSha256:hash(sources['server/quic-backend-defaults.patch'])},
    after:{runtimeImageId:deployment.server.imageId,runtimeSourceCommit:deployment.runtimeSourceCommit,runtimeReadbackAt:'2026-10-23T11:58:00Z',privateRuntimeReadbackSha256:'6'.repeat(64)},
    parameterObservation:{afterSnapshotSha256:'7'.repeat(64),afterArtifactModifiedAt:'2026-10-23T11:57:00Z'}};
  return {quic,deployment,check:()=>checkFreshQuicAfter(quic,{deployment,streamOffsets,readCommitted:(commit,path)=>sources[path]})};
}

test('fresh current-runtime QUIC after provenance passes with retained dated before',()=>assert.doesNotThrow(quicFixture().check));
for(const [name,change] of [
  ['missing source',f=>delete f.quic.source],
  ['old runtime source',f=>f.quic.after.runtimeSourceCommit='0'.repeat(40)],
  ['old runtime image',f=>f.quic.after.runtimeImageId='sha256:'+'0'.repeat(64)],
  ['immutable Dockerfile',f=>f.quic.source.dockerfileSha256='0'.repeat(64)],
  ['immutable QUIC patch',f=>f.quic.source.quicBackendDefaultsPatchSha256='0'.repeat(64)],
  ['missing raw identity',f=>delete f.quic.parameterObservation.afterSnapshotSha256],
  ['missing readback identity',f=>delete f.quic.after.privateRuntimeReadbackSha256],
  ['malformed timestamp',f=>f.quic.parameterObservation.afterArtifactModifiedAt='2026-02-31T11:57:00Z'],
  ['old after observation',f=>f.quic.parameterObservation.afterArtifactModifiedAt='2026-10-23T10:55:00Z'],
  ['readback before observation',f=>f.quic.after.runtimeReadbackAt='2026-10-23T11:56:00Z'],
  ['readback after deployment verification',f=>f.quic.after.runtimeReadbackAt='2026-10-23T12:00:00Z'],
])test('rejects unrefreshed QUIC '+name,()=>{const f=quicFixture();change(f);assert.throws(f.check);});
