// Current adjacent-STREAM evidence validation alongside immutable historical records.
// A binding is an independently reviewed build identity, never evidence-derived.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {checkLenAdoption,checkPublicPhase,actualLenBinding,finAnchor} from './check-stream-lengths.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const commit=v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v);
const image=v=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const keys=(v,want)=>v&&typeof v==='object'&&!Array.isArray(v)&&equal(Object.keys(v).sort(),[...want].sort());
const stamp=v=>{need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19),'Invalid adjacent timestamp');return Date.parse(v);};
const target='https://tomkimberlin.com/',patchPath='server/quic-adjacent-stream.patch';
const bodySha256='ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e';
const scope='accepted-control-stream-header-component';
const proofKeys=['buildResultSha256','nginxSha256','moduleSha256','imageConfigSha256','finIncludeSha256','lenIncludeSha256','adjacentGateResultSha256'];
const requiredSources=['server/Dockerfile',patchPath,'server/quic-fin.patch','server/quic-packet-end-len.patch','server/quic-stream-offset.patch',
  'tools/extract-quic-fin-fixtures.sh','tools/extract-quic-packet-end-len.sh','tools/verify-quic-fin.c','tools/quic-fin-test.mk',
  'tools/verify-quic-packet-end-len.c','tools/quic-packet-end-len-test.mk',
  'tools/verify-quic-adjacent.c','tools/quic-adjacent-test.mk','tools/extract-quic-adjacent-fixtures.sh'];
export const lenAnchor=Object.freeze({
  deployment:Object.freeze({path:'measurements/deployment-20261023-len.json',sha256:'d28e797abc404e2b07d836926f3ae2f081975117e20ddd893b863c49328a5fd4'}),
  component:Object.freeze({path:'measurements/quic-stream-length-20261023-live.json',sha256:'711fdbbd9e97be067edf77f1e9677df22f2e17a1f0ab7f4e812e07e2553e284f'}),
});
// Independently reviewed actual build and committed normalizer identities.
// Never derive these pins from the deployment or component being checked.
export const actualAdjacentBinding={"imageId":"sha256:bd2a90f1661d741e5a2788ac19b6054116b5bca44103a8b6a8af6ab09ec127e3","runtimeSourceCommit":"79fd19662243a6968bbf4e00ddfff1b336000d77","sourceFileHashes":{"server/Dockerfile":"8d28d28115fa78a85a7534f9fa8437868cfa8d34e210c3824bb040b987e48d7a","server/quic-adjacent-stream.patch":"fa835efb819a60a9fb27fc3d923ec171a02c31e0979b136ba7837ca771a5bbf2","server/quic-fin.patch":"861eaaed3734a3c071d3636e40f3c4cdab6e409b9698cd50175f3388f603b6cf","server/quic-packet-end-len.patch":"6de823ad6a7138fdc34f1579666b54ff18217617e7a20f53a76b6d3b9d228945","server/quic-stream-offset.patch":"c54501a08170325c70504592186d44b1fa6572fcb8dc4d23968ee7a585ca5f5a","tools/extract-quic-fin-fixtures.sh":"4349db218ffb58f90e9dcf3ba76eff222a7c2a520adf4ef146c543ff8eae7ef3","tools/extract-quic-packet-end-len.sh":"d638b8dc53d645664de00ee9909131a176643b353ae97c8a6fe1e287ea12f54d","tools/verify-quic-fin.c":"3140387c934bf6dc1042a348014615c7a23b18f49e6c8fa544bd74ec5c47b86d","tools/quic-fin-test.mk":"40d51666fad9423059fd39ece38555e8018b67d59aaa16350e6e361abeb1ef44","tools/verify-quic-packet-end-len.c":"7aa1dbef1db91c4db7388dc48b33b7e542b0085aa4899ad2fd3b8c0319589ab6","tools/quic-packet-end-len-test.mk":"4e6f61497981534a46c7bc49c4498c565df1f26091512ac01ef2e5640a51a81e","tools/verify-quic-adjacent.c":"2e4d4411c6d6f0c48fefb9ec7633a6c2f8b0eafcab0ed593ff4c91af521a959f","tools/quic-adjacent-test.mk":"c8581d384bebba082b3473136f079fbb36f7421a0bf61317dbec3a4d70c7db8b","tools/extract-quic-adjacent-fixtures.sh":"29bec4f576b2a330f3621456819869fe12dc33203aca22ddc29a9578529b1ba7"},"baseline":{"imageId":"sha256:fdc327367ceab6f28e8fd88c3903c256900c7b23f86855eaae20d2f4c28bd27f","runtimeSourceCommit":"efe18b575e09ff8e7bd9c733ac568b37572fe541","pageCommit":"a299a5eea8b3f79f01cfb91371895a8fd0c446ca","pageRelease":"releases/20261025T042442Z-aa9d6af64c9d-onekb-deploy.QIXVXB","source":{"bytes":1021,"sha256":"aa9d6af64c9dbc06da71361f34da43c1d9ea40e725de70daa8ffcd9c165069d9"},"body":{"bytes":389,"sha256":"ecdaa2f1bc1b86240ec863f8be8ed1cf4f1fc4012e437c7b35c5fa17c21ca36e"},"verifiedThrough":"2026-10-25T04:38:29Z"},"normalizer":{"sourceCommit":"a0687df702ca95ee0f983415cae21217519630db","path":"tools/normalize-stream-phase.py","sha256":"e9e459491927d22c7e2862a2606e9b604ebe7317ead760c64cf3b10f2f6c218e"},"actualBuildProof":{"buildResultSha256":"834cc0f68384772f3156e01eb067a4e57b7eea4dfcb14e6c96dec4dd31088066","nginxSha256":"39084155b377b2444b3b8ce511c7c7f81271438f69253ec577b05001d8bc231a","moduleSha256":"1a5469f5b1c022e9bc22f736fc89420c0b877b411d625bb8ef5b1247d559a6c6","imageConfigSha256":"8de35f10c3049bbc58a21e8456efcdccc6c0b88f2688cb727a0b9526c3689dcf","finIncludeSha256":"bac84edd85593a1a8045fa3e526828d52f253f5a2a12daa12e919fcd21843eed","lenIncludeSha256":"2e66d450a997218c2b2fd49e6e223b91abf53ae4d09642be39858eb22d0967f3","adjacentGateResultSha256":"d9747fae400430d4015f4200250719d03010a23c0522611c53db896ec307ed39"}};

function read(ref,readRecord) {
  need(keys(ref,['path','sha256'])&&/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(ref.path)&&digest(ref.sha256),'Invalid adjacent evidence reference');
  const bytes=readRecord(ref.path);need(hash(bytes)===ref.sha256,'Stale adjacent evidence hash');return JSON.parse(bytes);
}
export function checkHistoricalLen(inheritance,{readRecord,readCommitted}) {
  need(equal(inheritance,lenAnchor),'Historical LEN anchor changed');
  const deployment=read(inheritance.deployment,readRecord),component=read(inheritance.component,readRecord);
  need(equal(deployment.quicStreamLengthEncoding,lenAnchor.component)&&equal(deployment.quicFinCoalescing,finAnchor.component)
    &&deployment.server?.imageId===actualLenBinding.imageId&&deployment.runtimeSourceCommit===actualLenBinding.runtimeSourceCommit,'Historical LEN deployment differs');
  const page=read(deployment.verification.localSemanticBrowserEvidence,readRecord),streamOffsets=read(deployment.quicStreamOffsets,readRecord);
  // This unchanged entry point recursively validates the immutable FIN chain.
  const chain=checkLenAdoption(component,{deployment,page,streamOffsets,readRecord,readCommitted});
  need(chain!==null,'Historical LEN chain missing');return {deployment,component,page};
}
function adopted(deployment,readCommitted) {
  if(!commit(deployment.runtimeSourceCommit))return false;
  const docker=readCommitted(deployment.runtimeSourceCommit,'server/Dockerfile').toString();
  return docker.includes('COPY '+patchPath+' ')&&docker.includes('< /build/quic-adjacent-stream.patch');
}
export function requireAdjacentEvidence(deployment,evidence,readCommitted,binding=actualAdjacentBinding) {
  const requires=(binding!==null&&binding!==undefined&&deployment.server?.imageId===binding.imageId)||adopted(deployment,readCommitted);
  need(!requires||evidence!==null&&evidence!==undefined,'Adjacent runtime requires fresh component evidence');
  if(evidence!==null&&evidence!==undefined)need(binding!==null&&binding!==undefined,'Reviewed actual adjacent binding unavailable');
}
function checkBinding(binding) {
  need(keys(binding,['imageId','runtimeSourceCommit','sourceFileHashes','baseline','normalizer','actualBuildProof'])&&image(binding.imageId)&&commit(binding.runtimeSourceCommit)
    &&binding.imageId!==actualLenBinding.imageId,'Reviewed actual adjacent binding invalid');
  const sources=binding.sourceFileHashes;
  need(sources&&typeof sources==='object'&&!Array.isArray(sources)&&Object.keys(sources).length<=32
    &&requiredSources.every(p=>digest(sources[p]))&&Object.entries(sources).every(([p,h])=>(p==='server/Dockerfile'||/^(?:server|tools)\/[A-Za-z0-9._-]+\.(?:patch|c|mk|sh|mjs|py)$/.test(p))&&digest(h)),'Adjacent source/gate binding invalid');
  checkBaselineIdentity(binding.baseline);
  need(keys(binding.normalizer,['sourceCommit','path','sha256'])&&commit(binding.normalizer.sourceCommit)&&/^tools\/[A-Za-z0-9._-]+\.(?:mjs|py)$/.test(binding.normalizer.path)&&digest(binding.normalizer.sha256),'Adjacent normalizer binding invalid');
  need(keys(binding.actualBuildProof,proofKeys)&&Object.values(binding.actualBuildProof).every(digest),'Adjacent actual build proof invalid');
}
function checkBaselineIdentity(baseline) {
  need(keys(baseline,['imageId','runtimeSourceCommit','pageCommit','pageRelease','source','body','verifiedThrough'])
    &&baseline.imageId===actualLenBinding.imageId&&baseline.runtimeSourceCommit===actualLenBinding.runtimeSourceCommit
    &&commit(baseline.pageCommit)&&typeof baseline.pageRelease==='string'&&/^releases\/[A-Za-z0-9._-]+$/.test(baseline.pageRelease)
    &&keys(baseline.source,['bytes','sha256'])&&integer(baseline.source.bytes)&&baseline.source.bytes>0&&digest(baseline.source.sha256)
    &&equal(baseline.body,{bytes:389,sha256:bodySha256}),'Adjacent fresh baseline binding invalid');
  stamp(baseline.verifiedThrough);
}
// Runtime source, page source and tool source have independent immutable commits.
export function checkBaselinePage(baseline,{page,readCommitted}) {
  checkBaselineIdentity(baseline);
  need(page.html===baseline.source.bytes&&page.htmlSha256===baseline.source.sha256
    &&page.brotli===baseline.body.bytes&&page.brotliSha256===baseline.body.sha256,'Adjacent baseline/page evidence differs');
  for(const [path,expected] of [['index.html',baseline.source],['compression/index.html.br',baseline.body]]) {
    const bytes=readCommitted(baseline.pageCommit,path);
    need(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'Adjacent baseline committed body/source differs');
  }
}
function phaseIdentity(side,expected) {
  need(side.runtimeImageId===expected.imageId&&side.runtimeSourceCommit===expected.runtimeSourceCommit
    &&side.pageCommitAtReadback===expected.pageCommit&&side.pageReleaseAtReadback===expected.pageRelease,'Adjacent phase runtime/page binding differs');
}
function control(side) {
  const rows=side.acceptedRelevantFrames.filter(f=>f.streamId===3).slice().sort((a,b)=>a.semanticOffset-b.semanticOffset);
  let end=0,headerBytes=0;
  for(const frame of rows) {
    need(frame.dataBytes>0&&!frame.fin&&frame.semanticOffset===end,'Adjacent control sequence gap, overlap or FIN');
    end+=frame.dataBytes;headerBytes+=1+frame.streamIdFieldBytes+frame.offsetFieldBytes+frame.lengthFieldBytes;
  }
  need(rows.length>0&&end===9,'Adjacent complete control sequence must cover nine setup bytes');
  return {dataBytes:end,frameCount:rows.length,headerBytes};
}
function response(side) {
  const rows=side.acceptedRelevantFrames.filter(f=>f.streamId===0);
  need(rows.length===1,'Adjacent response must retain one accepted frame');
  const f=rows[0];need(f.fin&&f.semanticOffset===0&&!f.offPresent&&f.offsetFieldBytes===0&&!f.lengthPresent&&f.lengthFieldBytes===0
    &&f.streamIdFieldBytes===1&&f.dataBytes>=side.bodyBytes,'Adjacent response FIN/LEN framing differs');
  return {dataBytes:f.dataBytes,headerBytes:2};
}
// Pure metadata/component checks. Passing these alone is not adoption approval.
export function checkAdjacentComponent(s,{page,beforeRuntime,afterRuntime,baselineVerifiedThrough,normalizerSha256}) {
  need(keys(s,['schemaVersion','targetUrl','protocol','scope','source','actualBuildProof','inheritedLen','before','after','activation','framing','deltas','normalizationSourceSha256','verifiedThrough','limitations'])
    &&s.schemaVersion===1&&s.targetUrl===target&&s.protocol==='h3'&&s.scope===scope,'Invalid adjacent component schema/scope');
  need(keys(s.source,['runtimeSourceCommit','sourceFileHashes'])&&s.source.runtimeSourceCommit===afterRuntime.runtimeSourceCommit
    &&s.source.sourceFileHashes&&typeof s.source.sourceFileHashes==='object'&&!Array.isArray(s.source.sourceFileHashes)
    &&Object.entries(s.source.sourceFileHashes).every(([p,h])=>(p==='server/Dockerfile'||/^(?:server|tools)\/[A-Za-z0-9._-]+\.(?:patch|c|mk|sh|mjs|py)$/.test(p))&&digest(h)),'Invalid adjacent source schema');
  need(keys(s.actualBuildProof,proofKeys)&&Object.values(s.actualBuildProof).every(digest)&&equal(s.inheritedLen,lenAnchor),'Invalid adjacent build/history schema');
  need(keys(s.activation,['startedAt','completedAt']),'Invalid adjacent activation schema');
  const start=stamp(s.activation.startedAt),end=stamp(s.activation.completedAt),verified=stamp(s.verifiedThrough);
  need(start<=end&&end<=verified&&stamp(baselineVerifiedThrough)<stamp(s.before?.startedAt),'Adjacent baseline/activation dates differ');
  need(page.brotli===389&&page.brotliSha256===bodySha256,'Adjacent page differs from frozen complete body');
  for(const [side,expected] of [[s.before,beforeRuntime],[s.after,afterRuntime]]) {
    checkPublicPhase(side);phaseIdentity(side,expected);
    need(side.bodyBytes===page.brotli&&side.bodySha256===page.brotliSha256,'Adjacent complete body differs');
    need(stamp(side.completedAt)<=verified&&stamp(side.runtimeReadbacks.after.completedAt)<=verified,'Adjacent readback exceeds verification');
  }
  need(s.before.runtimeImageId!==s.after.runtimeImageId&&s.before.privateRawSnapshotSha256!==s.after.privateRawSnapshotSha256
    &&equal(s.before.observer,s.after.observer),'Adjacent phases/client differ');
  need(stamp(s.before.completedAt)<=start&&stamp(s.before.runtimeReadbacks.after.completedAt)<=start
    &&end<=stamp(s.after.runtimeReadbacks.before.startedAt),'Adjacent phases do not bracket activation');
  need(digest(normalizerSha256)&&s.normalizationSourceSha256===normalizerSha256,'Adjacent normalizer differs');
  need(Array.isArray(s.limitations)&&s.limitations.length>0&&s.limitations.every(v=>typeof v==='string'&&v.length>0&&v.length<=2000),'Adjacent limitations missing');
  const framing={before:{control:control(s.before),response:response(s.before)},after:{control:control(s.after),response:response(s.after)}};
  const delta=framing.before.control.headerBytes-framing.after.control.headerBytes;
  need(delta>0&&equal(s.framing,framing)&&equal(s.deltas,{controlHeaderBytesSaved:delta}),'Adjacent header arithmetic differs or no reduction');
  return framing;
}
// Additional current-window checks. Existing comparison validation remains required.
export function checkAdjacentCurrentEvidence(s,{deployment,overhead,statusEncoding,quic}) {
  need(equal(deployment.runtimeActivation,s.activation)&&stamp(s.verifiedThrough)<=stamp(deployment.verifiedThrough),'Adjacent deployment window differs');
  const first=stamp(s.activation.completedAt),last=stamp(deployment.verifiedThrough),w=overhead.captureWindow;
  need(keys(w,['startedAt','completedAt','before','after']),'Adjacent overhead capture window missing');
  const a=stamp(w.startedAt),b=stamp(w.completedAt);need(first<=a&&a<=b&&b<=last,'Adjacent overhead capture outside activation window');
  for(const r of [w.before,w.after])need(keys(r,['at','sha256','imageId','runtimeSourceCommit','pageRelease'])&&digest(r.sha256)
    &&r.imageId===deployment.server.imageId&&r.runtimeSourceCommit===deployment.runtimeSourceCommit&&r.pageRelease===deployment.pageRelease,'Adjacent capture runtime readback differs');
  need(first<=stamp(w.before.at)&&stamp(w.before.at)<=a&&b<=stamp(w.after.at)&&stamp(w.after.at)<=last,'Adjacent capture readbacks do not bracket capture');
  need(overhead.serverRuntime?.imageId===deployment.server.imageId&&overhead.serverRuntime.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&overhead.serverRuntime.pageRelease===deployment.pageRelease&&overhead.bodyBytes===389&&overhead.bodySha256===bodySha256,'Adjacent overhead identity differs');
  need(Array.isArray(overhead.runs)&&overhead.runs.length===3,'Adjacent overhead requires three runs');
  const raws=new Set();
  for(const row of overhead.runs) {
    need(a<=stamp(row.measuredAt)&&stamp(row.measuredAt)<=b&&row.bodyBytes===389&&row.bodySha256===bodySha256&&digest(row.privateRawSnapshotSha256),'Adjacent overhead row is stale');
    raws.add(row.privateRawSnapshotSha256);
    const sent=row.tlsThroughBodyComplete?.sent,received=row.tlsThroughBodyComplete?.received;
    need([sent,received,row.responseHttpPlainBytes,row.estimatedIpv4TcpBytesAt1500Mtu,row.dnsIpv4UdpBytes,row.estimatedTcpPlusDnsBytes,
      row.tlsThroughBodyCompleteMinusBody,row.estimatedTcpPlusDnsMinusBody,row.responseHttpPlainMinusBody].every(integer)
      &&row.estimatedTcpPlusDnsBytes===row.estimatedIpv4TcpBytesAt1500Mtu+row.dnsIpv4UdpBytes
      &&row.tlsThroughBodyCompleteMinusBody===sent+received-row.bodyBytes
      &&row.estimatedTcpPlusDnsMinusBody===row.estimatedTcpPlusDnsBytes-row.bodyBytes
      &&row.responseHttpPlainMinusBody===row.responseHttpPlainBytes-row.bodyBytes,'Adjacent overhead must subtract the whole body');
  }
  need(raws.size===3,'Adjacent overhead snapshots repeat');
  const status=statusEncoding?.after,params=quic?.after;
  need(status?.runtimeImageId===deployment.server.imageId&&status.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&first<=stamp(status.startedAt)&&stamp(status.startedAt)<=stamp(status.runtimeReadbackAt)&&stamp(status.runtimeReadbackAt)<=last,'Adjacent current status is stale');
  need(params?.runtimeImageId===deployment.server.imageId&&params.runtimeSourceCommit===deployment.runtimeSourceCommit
    &&first<=stamp(quic.parameterObservation?.afterArtifactModifiedAt)&&stamp(quic.parameterObservation.afterArtifactModifiedAt)<=stamp(params.runtimeReadbackAt)
    &&stamp(params.runtimeReadbackAt)<=last,'Adjacent current QUIC is stale');
}
export function checkAdjacentAdoption(s,context) {
  const {deployment,page,streamOffsets,readCommitted,readRecord,binding=actualAdjacentBinding}=context;
  requireAdjacentEvidence(deployment,s,readCommitted,binding);if(s===null||s===undefined)return null;
  checkBinding(binding);
  need(deployment.server?.imageId===binding.imageId&&deployment.runtimeSourceCommit===binding.runtimeSourceCommit
    &&adopted(deployment,readCommitted),'Adjacent current runtime is not the reviewed build');
  need(equal(s.source,{runtimeSourceCommit:binding.runtimeSourceCommit,sourceFileHashes:binding.sourceFileHashes})
    &&equal(s.actualBuildProof,binding.actualBuildProof),'Adjacent source/build proof differs');
  for(const [path,sha] of Object.entries(binding.sourceFileHashes))need(deployment.server.sourceFileHashes?.[path]===sha
    &&hash(readCommitted(binding.runtimeSourceCommit,path))===sha,'Adjacent immutable source/gate differs');
  need(hash(readCommitted(binding.normalizer.sourceCommit,binding.normalizer.path))===binding.normalizer.sha256,'Adjacent immutable normalizer differs');
  checkBaselinePage(binding.baseline,{page,readCommitted});
  const history=checkHistoricalLen(s.inheritedLen,{readRecord,readCommitted});
  need(stamp(binding.baseline.verifiedThrough)>=stamp(history.deployment.verifiedThrough),'Adjacent fresh baseline predates historical LEN');
  need(equal(deployment.quicFinCoalescing,finAnchor.component)&&equal(deployment.quicStreamLengthEncoding,lenAnchor.component),'Adjacent deployment changed historical references');
  checkAdjacentComponent(s,{page,beforeRuntime:binding.baseline,
    afterRuntime:{imageId:binding.imageId,runtimeSourceCommit:binding.runtimeSourceCommit,pageCommit:deployment.pageCommit,pageRelease:deployment.pageRelease},
    baselineVerifiedThrough:binding.baseline.verifiedThrough,normalizerSha256:binding.normalizer.sha256});
  need(equal(s.after,streamOffsets?.after)&&s.before.privateRawSnapshotSha256!==history.component.after.privateRawSnapshotSha256,'Adjacent current/historical snapshots differ');
  checkAdjacentCurrentEvidence(s,context);return {history,current:s};
}
export function renderAdjacent(s,ref) {
  return `\n\nHTTP/3 accepted control STREAM headers: **${s.framing.before.control.headerBytes} → ${s.framing.after.control.headerBytes} B (${s.deltas.controlHeaderBytesSaved} B less)** across the complete nine-byte setup sequence through the first exact document response ([component evidence](${ref.path})); type-byte width is source-derived. No fixed packet, complete-exchange, HTTP/2 or latency saving is established.`;
}
