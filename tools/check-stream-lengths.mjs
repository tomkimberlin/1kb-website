// Ignored actual-build adoption proposal. No collector, writes or CLI.
// Constants bind reviewed configured Linux artifacts; they do not attest live eligibility.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {checkFinCoalescing} from './check-fin-coalescing.mjs';
import {checkStreamPhase} from './check-stream-offsets.mjs';
const need=(ok,msg)=>{if(!ok)throw Error(msg);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const commit=v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v);
const image=v=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
const stamp=v=>{need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19),'Invalid LEN timestamp');return Date.parse(v);};
export const lenNormalizerSourcePin='cdf6418baa2a3426d4ce0c777a40923e8bd471d3a9a4deccd83f870c0bdfe3b7';
export const actualLenBinding={"imageId":"sha256:fdc327367ceab6f28e8fd88c3903c256900c7b23f86855eaae20d2f4c28bd27f","runtimeSourceCommit":"efe18b575e09ff8e7bd9c733ac568b37572fe541","patch":{"path":"server/quic-packet-end-len.patch","sha256":"6de823ad6a7138fdc34f1579666b54ff18217617e7a20f53a76b6d3b9d228945"},"gateSources":[{"path":"tools/verify-quic-packet-end-len.c","sha256":"7aa1dbef1db91c4db7388dc48b33b7e542b0085aa4899ad2fd3b8c0319589ab6"},{"path":"tools/quic-packet-end-len-test.mk","sha256":"4e6f61497981534a46c7bc49c4498c565df1f26091512ac01ef2e5640a51a81e"},{"path":"tools/extract-quic-packet-end-len.sh","sha256":"d27ab4d960fbe2d3130ad98d4ed6c907b07f5b22ae5f9be94b816ac901197c4c"}]};
export const actualBuildProof={"buildResultSha256":"78f1afcaf6dbb6832cd6824e01d6a722e584ef6354e6dfb7579b146f05c108b3","finIncludeSha256":"31f0f06fa8003c3473d0a1a089b6e30df2093f07043f2476cb199db8d7427250","finResultSha256":"fc0c9a16b79d8d2a5cc60a841ba82435b08fe35bce284cb7d2ec8e65407131f4","lenResultSha256":"8048a2fd92d0c66c798c02e1cb186216bbd271b808ca70c6d1562d9272659b07","independentDecoderSha256":"e10a0d6f842f7571c88d3d25d4bf8836b9376cba8a49afd8bceb906eb8e12600","contextTarSha256":"bc002b55065e3489177b4b55a0bcfce7c2c571839d063885cb03044e2de3f494","contextManifestSha256":"d0b90893bd7c8c3516198d407c33306e61b4f603a59ebf8a4c2d42562c388740","bindingSha256":"e5bcb390cab2e9c0185f562ce55fead6c663f3b01013478badd41ec9a5350ad5"};
export const finAnchor={
  deployment:{path:'measurements/deployment-20261023-fin.json',sha256:'645e06897de8e8556e3225f380a72c2206fd9c29659b850a143f3270e16c5809'},
  component:{path:'measurements/quic-fin-20261023-live.json',sha256:'50d137402c99d99064cb4b8679465ce78f0d42808571a9d79dd4e15087704404'},
  imageId:'sha256:60fe60ddb91f09f99e39360ad871782f3a36d47fe8bcadaca1159fd80fae7240',
  runtimeSourceCommit:'9e0dbfd76ada9740bf4f2698b584d78f833a41ef',
};
export const unchangedFinSources={
  'server/quic-fin.patch':'quicFinPatchSha256',
  'tools/verify-quic-fin.c':'verifyQuicFinSha256',
  'tools/quic-fin-test.mk':'quicFinTestMakefileSha256',
  'tools/extract-quic-fin-fixtures.sh':'quicFinExtractorSha256',
  'server/quic-stream-offset.patch':'streamOffsetPatchSha256',
};
export const reviewedFinExtractorUpdate={
  candidatePinsSha256:'fb95e2831ff43424dea228ca9169e638762135b2d213edc55693901fb2805031',
  extractorPatchSha256:'6f1b284508cf95c0fd85b8c05731dba67ac10a394ed6dbc6d7c41436a697293c',
  oldExtractorSha256:'0a315d8e72b60500232038835896a79da97c802049250a1187df54c76fa80cde',
  newExtractorSha256:'91067c03fa47a408c2e26747edb2427f4dad2deb6f7b18aedcfdb32a2476c43c',
  oldOutputSha256:'fff23e8f68bc2a49fe33a7446f64b82d88ece92d990c765f11ddf22df6f6fe22',
  newOutputSha256:'95ba0fc8c9f6825a95707cf3624624903ec5d46e721b11ba79121a191fc402b4',
  functionIncludeSha256:'31f0f06fa8003c3473d0a1a089b6e30df2093f07043f2476cb199db8d7427250',
};
function checkReviewedExtractorUpdate(oldSource,currentSource,recordedHash,proof) {
  const p=reviewedFinExtractorUpdate;
  const publicBound=equal(proof,{reviewedActualBuild:actualBuildProof});
  if(publicBound) {
    need(hash(oldSource)===p.oldExtractorSha256&&hash(currentSource)===p.newExtractorSha256&&recordedHash===p.newExtractorSha256,'Unreviewed FIN extractor change');
    const text=oldSource.toString();
    need(text.split(p.oldOutputSha256).length===2&&currentSource.equals(Buffer.from(text.replace(p.oldOutputSha256,p.newOutputSha256))),'FIN extractor change is not the exact one-line output pin');
    return;
  }
  need(proof&&['candidatePins','extractorPatch','referenceInclude','currentInclude'].every(k=>Buffer.isBuffer(proof[k])),'Reviewed extractor/include proof required');
  need(hash(proof.candidatePins)===p.candidatePinsSha256&&hash(proof.extractorPatch)===p.extractorPatchSha256,'Extractor review proof changed');
  const pins=JSON.parse(proof.candidatePins);
  need(pins.candidateFiles?.['tools/extract-quic-fin-fixtures.sh']===p.newExtractorSha256
    &&pins.baseFiles?.['tools/extract-quic-fin-fixtures.sh']===p.oldExtractorSha256
    &&pins.finFunctionIncludeSha256===p.functionIncludeSha256,'Extractor reviewed candidate pins differ');
  need(hash(oldSource)===p.oldExtractorSha256&&hash(currentSource)===p.newExtractorSha256&&recordedHash===p.newExtractorSha256,'Unreviewed FIN extractor change');
  const oldText=oldSource.toString();
  need(oldText.split(p.oldOutputSha256).length===2
    &&currentSource.equals(Buffer.from(oldText.replace(p.oldOutputSha256,p.newOutputSha256))),'FIN extractor change is not the exact one-line output pin');
  need(hash(proof.referenceInclude)===p.functionIncludeSha256&&hash(proof.currentInclude)===p.functionIncludeSha256
    &&proof.referenceInclude.equals(proof.currentInclude),'Extracted FIN functions changed');
}
function record(ref,readRecord) {
  need(ref&&/^measurements\/[A-Za-z0-9._-]+\.json$/.test(ref.path)&&digest(ref.sha256),'Invalid LEN chain reference');
  const bytes=readRecord(ref.path);need(hash(bytes)===ref.sha256,'Stale LEN chain reference');return JSON.parse(bytes);
}
export function checkInheritedFin({currentDeployment,currentPage,inheritance,readRecord,readCommitted,finExtractorUpdateProof}) {
  need(equal(inheritance?.deployment,finAnchor.deployment)&&equal(inheritance?.component,finAnchor.component)&&equal(currentDeployment.quicFinCoalescing,finAnchor.component),'Historical FIN anchor changed');
  const old=record(inheritance.deployment,readRecord),fin=record(old.quicFinCoalescing,readRecord);
  need(equal(old.quicFinCoalescing,finAnchor.component)&&old.server.imageId===finAnchor.imageId&&old.runtimeSourceCommit===finAnchor.runtimeSourceCommit,'Historical FIN deployment differs');
  const page=record(old.verification.localSemanticBrowserEvidence,readRecord);
  const stream=record(old.quicStreamOffsets,readRecord),baseline=record(fin.baselineDeployment,readRecord);
  checkFinCoalescing(fin,{deployment:old,page,streamOffsets:stream,baselineDeployment:baseline,readCommitted});
  need(currentPage.brotli===page.brotli&&currentPage.brotliSha256===page.brotliSha256,'Inherited FIN body differs');
  need(commit(currentDeployment.runtimeSourceCommit),'Current runtime source missing');
  for(const [path,key] of Object.entries(unchangedFinSources)) {
    const currentSource=readCommitted(currentDeployment.runtimeSourceCommit,path),recordedHash=currentDeployment.server.sourceFileHashes?.[path];
    need(digest(fin.source[key]),'Historical FIN source hash missing');
    if(path==='tools/extract-quic-fin-fixtures.sh'&&hash(currentSource)!==fin.source[key]) {
      if(finExtractorUpdateProof?.reviewedActualBuild)need(currentDeployment.server.imageId===actualLenBinding.imageId&&currentDeployment.runtimeSourceCommit===actualLenBinding.runtimeSourceCommit,'Reviewed Linux include belongs to another runtime');
      checkReviewedExtractorUpdate(readCommitted(finAnchor.runtimeSourceCommit,path),currentSource,recordedHash,finExtractorUpdateProof);
    } else need(recordedHash===fin.source[key]&&hash(currentSource)===fin.source[key],'FIN source/gate changed; inheritance is ineligible');
  }
  return {deployment:old,component:fin};
}
// Root supplies this identity only after independently verified actual build
// and gate evidence. This check is not an attestation that those gates ran.
export function requireCurrentLen(deployment,evidence,binding,readCommitted) {
  need(binding&&image(binding.imageId)&&binding.imageId!==finAnchor.imageId&&commit(binding.runtimeSourceCommit)
    &&binding.patch&&/^server\/[A-Za-z0-9._-]+\.patch$/.test(binding.patch.path)&&digest(binding.patch.sha256),'Actual root LEN binding required');
  const known=deployment.server?.imageId===binding.imageId;
  const text=commit(deployment.runtimeSourceCommit)?readCommitted(deployment.runtimeSourceCommit,'server/Dockerfile').toString():'';
  const adopted=text.includes('COPY '+binding.patch.path+' ')&&text.includes('< /build/'+binding.patch.path.split('/').at(-1));
  need(!(known||adopted)||evidence!==null&&evidence!==undefined,'Current LEN runtime requires fresh LEN evidence');
}
function framing(side,explicit) {
  const rows=side.acceptedRelevantFrames.filter(f=>f.streamId===0);need(rows.length===1,'LEN comparison needs one accepted response frame');
  const f=rows[0];need(f.fin===true&&f.semanticOffset===0&&f.offPresent===false&&f.offsetFieldBytes===0
    &&f.streamIdFieldBytes===1&&f.lengthPresent===explicit&&f.lengthFieldBytes===(explicit?2:0)
    &&Number.isSafeInteger(f.dataBytes)&&f.dataBytes>=389&&f.dataBytes<16384,'Invalid response LEN framing');
  return {responseDataBytes:f.dataBytes,responseFrameHeaderBytes:1+f.streamIdFieldBytes+f.offsetFieldBytes+f.lengthFieldBytes,
    lengthFieldBytes:f.lengthFieldBytes,frameTypeBytesDerivedFromSource:1};
}
const publicPhaseKeys=['runtimeImageId','runtimeSourceCommit','pageCommitAtReadback','pageReleaseAtReadback','perRequestGenerationVerified','privateRawSnapshotSha256','runtimeReadbacks','observer','passed','startedAt','observationStoppedAt','completedAt','normalCertificateValidation','freshConnection','handshake','statusCode','exactBrotliBody','bodyBytes','bodySha256','streamRolesVerified','firstAcceptedFrames','acceptedRelevantFrames','allAcceptedStreamFrameCount'];
const exactKeys=(value,want)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),[...want].sort());
export function checkPublicPhase(side) {
  need(exactKeys(side,publicPhaseKeys)&&exactKeys(side.observer,['sourceSha256','versions','aioquicSourceSha256','reusedSourceSha256'])
    &&exactKeys(side.runtimeReadbacks,['precisionSeconds','before','after']),'Unallowlisted public STREAM phase metadata');
  checkStreamPhase(side);
}
export function checkBeforeLen(before,{page,inheritedFin}) {
  checkPublicPhase(before);
  need(before.runtimeImageId===finAnchor.imageId&&before.runtimeSourceCommit===finAnchor.runtimeSourceCommit
    &&before.pageCommitAtReadback===inheritedFin.deployment.pageCommit&&before.pageReleaseAtReadback===inheritedFin.deployment.pageRelease,'LEN before runtime/page differs');
  need(before.privateRawSnapshotSha256!==inheritedFin.component.after.privateRawSnapshotSha256
    &&stamp(inheritedFin.deployment.verifiedThrough)<stamp(before.startedAt),'LEN before is not fresh');
  need(before.bodyBytes===page.brotli&&before.bodySha256===page.brotliSha256&&page.brotli===389
    &&page.brotliSha256==='ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e','LEN before complete body differs');
  const result=framing(before,true);need(result.responseDataBytes===437,'LEN before response is not the qualifying 437 B sample');return result;
}
export function selectedRoleWidths(phase) {
  return Object.fromEntries(['control','qpackDecoder','response'].map(role=>{
    const f=phase.firstAcceptedFrames[role];
    return [role,{streamId:f.streamId,frameType:f.frameType,semanticOffset:f.semanticOffset,dataBytes:f.dataBytes,
      lengthPresent:f.lengthPresent,lengthFieldBytes:f.lengthFieldBytes,offPresent:f.offPresent,offsetFieldBytes:f.offsetFieldBytes,fin:f.fin}];
  }));
}
export function checkSelectedRoleMetadata(s) {
  need(equal(s.selectedRoleLengthMetadata,{before:selectedRoleWidths(s.before),after:selectedRoleWidths(s.after)}),'Selected role LEN metadata differs from accepted phase rows');
}
export function checkCurrentLen(s,{deployment,page,streamOffsets,binding,readCommitted,inheritedFin}) {
  requireCurrentLen(deployment,s,binding,readCommitted);
  checkBeforeLen(s?.before,{page,inheritedFin});
  need(s?.schemaVersion===1&&s.targetUrl==='https://tomkimberlin.com/'&&s.protocol==='h3','Invalid current LEN evidence');
  need(deployment.server?.imageId===binding.imageId&&deployment.runtimeSourceCommit===binding.runtimeSourceCommit
    &&s.source?.runtimeSourceCommit===binding.runtimeSourceCommit&&s.after?.runtimeImageId===binding.imageId
    &&s.after.runtimeSourceCommit===binding.runtimeSourceCommit,'LEN runtime/source binding differs');
  need(equal(s.source.patch,binding.patch)&&hash(readCommitted(binding.runtimeSourceCommit,binding.patch.path))===binding.patch.sha256
    &&deployment.server.sourceFileHashes?.[binding.patch.path]===binding.patch.sha256,'LEN patch binding differs');
  need(Array.isArray(binding.gateSources)&&binding.gateSources.length>=2&&binding.gateSources.length<=4
    &&new Set(binding.gateSources.map(v=>v.path)).size===binding.gateSources.length&&equal(s.source.gateSources,binding.gateSources),'LEN gate sources missing');
  for(const g of binding.gateSources)need(/^tools\/[A-Za-z0-9._-]+\.(?:c|mk|sh)$/.test(g.path)&&digest(g.sha256)
    &&hash(readCommitted(binding.runtimeSourceCommit,g.path))===g.sha256&&deployment.server.sourceFileHashes?.[g.path]===g.sha256,'LEN gate source binding differs');
  need(digest(s.source.dockerfileSha256)&&hash(readCommitted(binding.runtimeSourceCommit,'server/Dockerfile'))===s.source.dockerfileSha256
    &&deployment.server.sourceFileHashes?.['server/Dockerfile']===s.source.dockerfileSha256,'LEN Dockerfile binding differs');
  const docker=readCommitted(binding.runtimeSourceCommit,'server/Dockerfile').toString();
  need(docker.includes('COPY '+binding.patch.path+' ')&&docker.includes('< /build/'+binding.patch.path.split('/').at(-1)),'LEN patch not adopted by immutable Dockerfile');
  need(s.before?.runtimeImageId===finAnchor.imageId&&s.before.runtimeSourceCommit===finAnchor.runtimeSourceCommit
    &&s.before.privateRawSnapshotSha256!==s.after.privateRawSnapshotSha256,'LEN fresh before/runtime differs');
  need(inheritedFin?.deployment?.server?.imageId===finAnchor.imageId
    &&s.before.privateRawSnapshotSha256!==inheritedFin.component.after.privateRawSnapshotSha256
    &&stamp(inheritedFin.deployment.verifiedThrough)<stamp(s.before.startedAt),'LEN before is not a fresh post-FIN observation');
  need(s.before.pageCommitAtReadback===inheritedFin.deployment.pageCommit&&s.before.pageReleaseAtReadback===inheritedFin.deployment.pageRelease,'LEN before page differs from historical FIN deployment');
  for(const side of [s.before,s.after]) {
    checkPublicPhase(side);
    need(side.bodyBytes===page.brotli&&side.bodySha256===page.brotliSha256&&page.brotli===389
      &&page.brotliSha256==='ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e','LEN complete body differs');
    need(stamp(side.runtimeReadbacks.after.completedAt)<=stamp(deployment.verifiedThrough??deployment.verifiedAt)&&stamp(side.completedAt)<=stamp(deployment.verifiedThrough??deployment.verifiedAt),'LEN post-readback exceeds verification');
  }
  need(equal(s.after,streamOffsets.after)&&s.after.pageCommitAtReadback===deployment.pageCommit&&s.after.pageReleaseAtReadback===deployment.pageRelease
    &&equal(s.before.observer,s.after.observer)&&stamp(s.before.runtimeReadbacks.after.completedAt)<=stamp(s.after.startedAt)
    &&stamp(s.before.completedAt)<stamp(s.after.startedAt),'LEN phases/current after differ');
  need(s.normalizationSourceSha256===lenNormalizerSourcePin&&Array.isArray(s.limitations)&&s.limitations.length>0,'LEN normalization identity/scope missing');
  checkSelectedRoleMetadata(s);
  const before=framing(s.before,true),after=framing(s.after,false);
  need(equal(s.framing,{before,after})&&equal(s.deltas,{lengthFieldBytesSaved:2,responseFrameHeaderBytesSaved:2}),'LEN component arithmetic differs; no combined FIN delta');
}
export function checkLenChain(s,context) {
  const inheritedFin=checkInheritedFin({...context,currentDeployment:context.deployment,currentPage:context.page});
  checkCurrentLen(s,{...context,inheritedFin});
  return {inheritedFin,currentLen:s};
}

// Public comparison entry point. Historical deployments continue through the existing FIN guard.
// The exact successful build is bound here; future images require a new reviewed binding.
export function checkLenAdoption(s,context) {
  requireCurrentLen(context.deployment,s,actualLenBinding,context.readCommitted);
  if(s===null||s===undefined)return null;
  need(equal(s.actualBuildProof,actualBuildProof),'LEN actual build proof differs');
  return checkLenChain(s,{...context,binding:actualLenBinding,inheritance:s.inheritedFin,
    finExtractorUpdateProof:{reviewedActualBuild:actualBuildProof}});
}
export function renderLen(s,ref) {
  return `\n\nHTTP/3 response STREAM headers: **${s.framing.before.responseFrameHeaderBytes} → ${s.framing.after.responseFrameHeaderBytes} B (${s.deltas.responseFrameHeaderBytesSaved} B less)** in the one accepted FIN response frame; its two-byte LEN field is omitted ([component evidence](${ref.path})). The earlier FIN 9 → 4 B result remains dated evidence; this is a separate response-only field observation, not a fixed packet or complete-exchange saving.`;
}
