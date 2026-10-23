import {createHash} from 'node:crypto';
import {checkStreamOffsets} from './check-stream-offsets.mjs';
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

export {fixture};
