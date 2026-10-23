// Validate hashed STREAM component observations without network access.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
// QUIC varints may use a nonminimal legal width, but the value must fit it.
const fits=(value,width)=>integer(value)&&[1,2,4,8].includes(width)&&value<2**(width*8-2);
const bodySha256='ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e';
const versions={python:'3.13.16',aioquic:'1.3.0',pylsqpack:'0.3.24',cryptography:'50.0.2',certifi:'2026.10.19'};
const modulePins={'aioquic.quic.connection':'f6d0bd15ea563a3bd68518e3d4a6b918f4c9341048f850b27aa582f3a63fab65','aioquic.asyncio.client':'5159d2e28bd33da386c59dbac99dbb35ee47ecf4b480596367299c5ec03dd1c9','aioquic.h3.connection':'696e9c3735de11c314b8cd1e7e1265761a9373d1bbd2dbdf66570961dac839cd'};
const reusedPins={'tools/verify-http3.py':'07c4f5f1d1fe1ce3768c1b3599182b2ad2b24f5b61ba5a8235fcd3fd74ce03e9','tools/probe_response.py':'e16a4fba43ee63f94cedcdb16b8e76bba53544109b55e275872883e31ab07eaa'};
const keys=(value,want)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),[...want].sort());
const roles={control:3,qpackDecoder:7,response:0};
const rowKeys=['streamId','frameType','offPresent','semanticOffset','offsetFieldBytes','streamIdFieldBytes','lengthPresent','lengthFieldBytes','dataBytes','fin'];
const stamp=value=>{need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19),'Invalid STREAM timestamp');return Date.parse(value);};

export function checkStreamOffsets(s,{deployment,page,readCommitted}) {
  need(s?.schemaVersion===1&&s.targetUrl==='https://tomkimberlin.com/'&&s.protocol==='h3','Invalid STREAM evidence');
  need(/^[0-9a-f]{40}$/.test(deployment.runtimeSourceCommit??'')&&s.after?.runtimeImageId===deployment.server?.imageId&&s.source?.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&s.after.runtimeSourceCommit===deployment.runtimeSourceCommit,'STREAM runtime binding differs');
  for(const [path,key] of [['server/quic-stream-offset.patch','streamOffsetPatchSha256'],['server/Dockerfile','dockerfileSha256']]) {
    need(digest(s.source[key])&&s.source[key]===deployment.server?.sourceFileHashes?.[path]
      &&hash(readCommitted(deployment.runtimeSourceCommit,path))===s.source[key],'STREAM source binding differs');
  }
  for(const side of [s.before,s.after]) {
    need(/^sha256:[0-9a-f]{64}$/.test(side?.runtimeImageId??'')&&/^[0-9a-f]{40}$/.test(side.runtimeSourceCommit??'')
      &&/^[0-9a-f]{40}$/.test(side.pageCommitAtReadback??'')&&/^releases\/[A-Za-z0-9._-]+$/.test(side.pageReleaseAtReadback??'')
      &&side.perRequestGenerationVerified===false&&digest(side.privateRawSnapshotSha256),'Invalid STREAM provenance');
    need(side.passed===true&&side.normalCertificateValidation===true&&side.freshConnection===true&&side.streamRolesVerified===true
      &&equal(side.handshake,{alpn:'h3',sessionResumed:false,earlyDataAccepted:false})
      &&side.statusCode===200&&side.exactBrotliBody===true&&integer(side.bodyBytes)&&side.bodyBytes>0&&digest(side.bodySha256),'Invalid trusted STREAM response');
    need(digest(side.observer?.sourceSha256)&&side.observer.sourceSha256==='297e152798685065bb02b0b3d55685e8fa8840dff39e5ad8a3c0e18e1be489c0'
      &&equal(side.observer.versions,versions)&&equal(side.observer.aioquicSourceSha256,modulePins)
      &&equal(side.observer.reusedSourceSha256,reusedPins),'Invalid STREAM observer identity');
    const a=stamp(side.startedAt),b=stamp(side.observationStoppedAt),c=stamp(side.completedAt),r=side.runtimeReadbacks;
    need(a<=b&&b<=c&&r?.precisionSeconds===1,'Invalid STREAM observation interval');
    for(const phase of ['before','after'])need(keys(r[phase],['startedAt','completedAt','sha256'])&&digest(r[phase].sha256)
      &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r[phase].startedAt)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r[phase].completedAt)
      &&stamp(r[phase].startedAt)<=stamp(r[phase].completedAt),'Invalid STREAM runtime readback');
    // A whole-second host timestamp denotes [t,t+1s); command order is not a per-request attestation.
    need(stamp(r.before.completedAt)<=a&&stamp(r.before.completedAt)<=stamp(r.after.startedAt)
      &&c<stamp(r.after.startedAt)+1000,'STREAM readback envelope differs');
    need(keys(side.firstAcceptedFrames,Object.keys(roles))&&Array.isArray(side.acceptedRelevantFrames)
      &&side.acceptedRelevantFrames.length>=3&&side.acceptedRelevantFrames.length<=256
      &&integer(side.allAcceptedStreamFrameCount)&&side.allAcceptedStreamFrameCount>=side.acceptedRelevantFrames.length
      &&side.allAcceptedStreamFrameCount<=256,'Invalid STREAM frame counts');
    for(const frame of side.acceptedRelevantFrames)need(keys(frame,rowKeys)&&Object.values(roles).includes(frame.streamId)
      &&integer(frame.frameType)&&frame.frameType>=8&&frame.frameType<=15
      &&frame.offPresent===Boolean(frame.frameType&4)&&frame.lengthPresent===Boolean(frame.frameType&2)&&frame.fin===Boolean(frame.frameType&1)
      &&integer(frame.semanticOffset)&&frame.semanticOffset<=0x7fffffff&&integer(frame.dataBytes)&&frame.dataBytes<=1<<20
      &&fits(frame.streamId,frame.streamIdFieldBytes)
      &&(frame.lengthPresent?fits(frame.dataBytes,frame.lengthFieldBytes):frame.lengthFieldBytes===0)
      &&(frame.offPresent?fits(frame.semanticOffset,frame.offsetFieldBytes):frame.offsetFieldBytes===0&&frame.semanticOffset===0),'Invalid STREAM frame metadata');
    for(const [role,id] of Object.entries(roles))need(side.firstAcceptedFrames[role]&&equal(side.firstAcceptedFrames[role],side.acceptedRelevantFrames.find(f=>f.streamId===id))
      &&side.firstAcceptedFrames[role].semanticOffset===0,'STREAM first accepted role differs');
  }
  need(s.before.runtimeImageId!==s.after.runtimeImageId&&s.before.privateRawSnapshotSha256!==s.after.privateRawSnapshotSha256
    &&stamp(s.before.completedAt)<stamp(s.after.startedAt)&&equal(s.before.observer,s.after.observer),'STREAM phases/client differ');
  need(page.brotli===389&&page.brotliSha256===bodySha256&&[s.before,s.after].every(side=>side.bodyBytes===page.brotli&&side.bodySha256===page.brotliSha256),'STREAM body differs from frozen current page');
  need(keys(s.deltas,Object.keys(roles)),'Invalid STREAM deltas');
  for(const role of Object.keys(roles)) {
    const a=s.before.firstAcceptedFrames[role],b=s.after.firstAcceptedFrames[role],delta=s.deltas[role];
    need(a.offPresent===true&&a.offsetFieldBytes===1&&b.offPresent===false&&b.offsetFieldBytes===0
      &&keys(delta,['offsetFieldBytesSaved'])&&delta.offsetFieldBytesSaved===a.offsetFieldBytes-b.offsetFieldBytes,'STREAM offset-field saving differs');
  }
  need(Array.isArray(s.limitations)&&s.limitations.length>0,'Missing STREAM limitations');
}

// Only the STREAM-enabled path requires this new provenance; old parameter records remain dated.
export function checkFreshQuicAfter(quic,{deployment,streamOffsets,readCommitted}) {
  need(quic?.after?.runtimeImageId===deployment.server?.imageId&&quic.source?.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&quic.after.runtimeSourceCommit===deployment.runtimeSourceCommit,'Fresh QUIC runtime binding differs');
  for(const [path,key] of [['server/Dockerfile','dockerfileSha256'],['server/quic-defaults.patch','quicDefaultsPatchSha256'],['server/quic-backend-defaults.patch','quicBackendDefaultsPatchSha256']]) {
    need(digest(quic.source[key])&&quic.source[key]===deployment.server?.sourceFileHashes?.[path]
      &&hash(readCommitted(deployment.runtimeSourceCommit,path))===quic.source[key],'Fresh QUIC source binding differs');
  }
  const observation=quic.parameterObservation,after=quic.after;
  need(digest(observation?.afterSnapshotSha256)&&digest(after.privateRuntimeReadbackSha256),'Missing fresh QUIC snapshot/readback identity');
  // This observer has no embedded clock; retain the explicitly labeled artifact-mtime provenance.
  need(stamp(streamOffsets.before.completedAt)<stamp(observation.afterArtifactModifiedAt)
    &&stamp(observation.afterArtifactModifiedAt)<=stamp(after.runtimeReadbackAt)
    &&stamp(after.runtimeReadbackAt)<=stamp(deployment.verifiedThrough??deployment.verifiedAt),'Fresh QUIC after observation is outside the current verification window');
}

export function renderStreamOffsets(s,ref) {
  const values=Object.values(s.deltas).map(v=>v.offsetFieldBytesSaved);
  return `\n\nHTTP/3 STREAM components: **${values[0]} B less in each of ${values.length} first-accepted zero-offset frames** ([component evidence](${ref.path})); no fixed whole-exchange saving is established.`;
}
