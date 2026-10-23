// Component metadata only. No network or whole-exchange inference.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {checkStreamPhase} from './check-stream-offsets.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const stamp=value=>{need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19),'Invalid FIN timestamp');return Date.parse(value);};
export const finSourceFields={
  'server/Dockerfile':'dockerfileSha256',
  'server/quic-fin.patch':'quicFinPatchSha256',
  'server/quic-stream-offset.patch':'streamOffsetPatchSha256',
  'tools/verify-quic-fin.c':'verifyQuicFinSha256',
  'tools/quic-fin-test.mk':'quicFinTestMakefileSha256',
  'tools/extract-quic-fin-fixtures.sh':'quicFinExtractorSha256',
};
export const finDefinitions={
  observed:'Accepted STREAM metadata through the first exact document response completion, including FIN; first accepted is not first sent.',
  frameTypeBytes:'One byte derived from the pinned nginx minimal serializer for STREAM types 8–15; the frozen observer does not measure the type-varint width.',
  otherWidths:'Stream ID, OFF and LEN widths are observed before the original aioquic handler accepts each frame.',
  headerBytes:'Source-derived frame-type byte plus observed stream-ID, OFF and LEN widths. Payload, encryption, padding, packets and complete exchanges are excluded.',
};
// Read the actual immutable Dockerfile: omitting a metadata source key cannot
// turn off a mandatory current-runtime evidence requirement.
export function runtimeRequiresFin(deployment,readCommitted) {
  if(deployment.server?.imageId==='sha256:60fe60ddb91f09f99e39360ad871782f3a36d47fe8bcadaca1159fd80fae7240')return true;
  // Older saved records predate explicit runtime commits. Preserve that
  // historical schema, but never let this known FIN image omit the field.
  if(!/^[0-9a-f]{40}$/.test(deployment.runtimeSourceCommit??''))return false;
  const text=readCommitted(deployment.runtimeSourceCommit,'server/Dockerfile').toString();
  return /^COPY server\/quic-fin\.patch\s/m.test(text)||/patch[^\n]*< \/build\/quic-fin\.patch/.test(text);
}
export function requireFinEvidence(deployment,evidence,readCommitted) {
  need(!runtimeRequiresFin(deployment,readCommitted)||evidence!==null&&evidence!==undefined,'Current FIN runtime requires component evidence');
}
export function responseFraming(side,phase) {
  const rows=side.acceptedRelevantFrames.filter(frame=>frame.streamId===0);
  need(rows.length===(phase==='before'?2:1),'FIN response frame count differs');
  const first=rows[0];
  need(first.semanticOffset===0&&first.offPresent===false&&first.offsetFieldBytes===0
    &&first.streamIdFieldBytes===1&&first.lengthPresent===true&&first.lengthFieldBytes===2
    &&integer(first.dataBytes)&&first.dataBytes>=389&&first.dataBytes<16384,'FIN response data/header shape differs');
  if(phase==='before') {
    const final=rows[1];
    need(first.fin===false&&final.fin===true&&final.dataBytes===0&&final.semanticOffset===first.dataBytes
      &&final.offPresent===true&&final.offsetFieldBytes===2&&final.streamIdFieldBytes===1
      &&final.lengthPresent===true&&final.lengthFieldBytes===1,'FIN baseline does not end in a separate empty frame');
  } else need(first.fin===true,'FIN candidate data frame has no final marker');
  const responseFrameHeaderBytes=rows.map(f=>1+f.streamIdFieldBytes+f.offsetFieldBytes+f.lengthFieldBytes);
  return {responseStreamFrames:rows.length,responseDataBytes:rows.reduce((n,f)=>n+f.dataBytes,0),
    responseFrameHeaderBytes,totalResponseFrameHeaderBytes:responseFrameHeaderBytes.reduce((a,b)=>a+b,0),
    responseFinFrames:rows.filter(f=>f.fin).length,frameTypeBytesDerivedFromSource:1};
}
export function checkFinCoalescing(s,{deployment,page,streamOffsets,baselineDeployment,readCommitted}) {
  need(s?.schemaVersion===1&&s.targetUrl==='https://tomkimberlin.com/'&&s.protocol==='h3'
    &&equal(s.definitions,finDefinitions),'Invalid FIN component evidence');
  need(runtimeRequiresFin(deployment,readCommitted),'FIN evidence is not bound to an active patch');
  need(s.source?.runtimeSourceCommit===deployment.runtimeSourceCommit&&s.after?.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&s.after.runtimeImageId===deployment.server?.imageId,'FIN current-runtime binding differs');
  for(const [path,key] of Object.entries(finSourceFields))need(digest(s.source[key])
    &&s.source[key]===deployment.server?.sourceFileHashes?.[path]
    &&hash(readCommitted(deployment.runtimeSourceCommit,path))===s.source[key],'FIN immutable source/gate binding differs');
  need(s.before?.runtimeImageId===baselineDeployment?.server?.imageId&&s.before?.runtimeSourceCommit===baselineDeployment?.runtimeSourceCommit
    &&s.before.runtimeImageId==='sha256:8358bfe170c58e7ae35523ef7d74fff5136347838d0006252d50c6a4091084ce'
    &&s.before.runtimeSourceCommit==='17af6caedafe1cc40c311d02691a5ccaebfa2554'
    &&s.before.pageCommitAtReadback===baselineDeployment.pageCommit
    &&s.before.pageReleaseAtReadback===baselineDeployment.pageRelease,'FIN baseline runtime/page differs');
  for(const side of [s.before,s.after]) {
    checkStreamPhase(side);
    need(side.bodyBytes===page.brotli&&side.bodySha256===page.brotliSha256&&page.brotli===389
      &&page.brotliSha256==='ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e','FIN complete body differs');
    need(stamp(side.runtimeReadbacks.after.completedAt)<=stamp(deployment.verifiedThrough??deployment.verifiedAt),'FIN post-readback exceeds deployment verification');
  }
  need(s.after.pageCommitAtReadback===deployment.pageCommit&&s.after.pageReleaseAtReadback===deployment.pageRelease
    &&equal(s.after,streamOffsets?.after),'FIN current page or refreshed STREAM after differs');
  need(s.before.runtimeImageId!==s.after.runtimeImageId&&s.before.privateRawSnapshotSha256!==s.after.privateRawSnapshotSha256
    &&equal(s.before.observer,s.after.observer)&&stamp(s.before.completedAt)<stamp(s.after.startedAt)
    &&stamp(s.before.runtimeReadbacks.after.completedAt)<=stamp(s.after.startedAt)
    &&stamp(s.after.completedAt)<=stamp(deployment.verifiedThrough??deployment.verifiedAt),'FIN phases/client/verification interval differ');
  const before=responseFraming(s.before,'before'),after=responseFraming(s.after,'after');
  need(equal(s.framing,{before,after}),'FIN framing arithmetic differs');
  need(equal(s.deltas,{responseStreamFrameHeaderBytesSaved:before.totalResponseFrameHeaderBytes-after.totalResponseFrameHeaderBytes,
    emptyResponseFinFramesRemoved:1})&&s.deltas.responseStreamFrameHeaderBytesSaved===5,'FIN header-component difference differs');
  need(digest(s.normalizationSourceSha256)&&Array.isArray(s.limitations)&&s.limitations.length>0,'Missing FIN normalization/scope');
}
export function renderFinCoalescing(s,ref) {
  return `\n\nHTTP/3 response STREAM framing: **${s.framing.before.totalResponseFrameHeaderBytes} → ${s.framing.after.totalResponseFrameHeaderBytes} B (${s.deltas.responseStreamFrameHeaderBytesSaved} B less)** across the accepted response frames; the final marker is attached to the data frame ([component evidence](${ref.path})). Type-byte size is source-derived; other widths are observed. This does not establish a fixed complete-exchange saving.`;
}
