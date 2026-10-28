// Split page/transport state: checks assertions and retained provenance, not
// authenticity of the private logs or proof of a public worker generation.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {gzipSync,gunzipSync,inflateRawSync,inflateSync} from 'node:zlib';

const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const eq=isDeepStrictEqual;
const digest=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>0;
const keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&eq(Object.keys(x).sort(),[...k].sort());
const stamp=x=>{need(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19),'Invalid page evidence timestamp');return Date.parse(x);};
const target='https://tomkimberlin.com/';
const mapping={identity:'html',br:'brotli',gzip:'gzip',deflate:'deflate'};
const release=x=>typeof x==='string'&&/^releases\/[A-Za-z0-9._-]{1,200}$/.test(x);
const image=x=>typeof x==='string'&&/^sha256:[0-9a-f]{64}$/.test(x);
const commit=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const legacyDeployment={path:'measurements/maintenance-20261025-intune-name.json',sha256:'7ce8a78a736e87e8c0dfcb7a58f6e11ca0f825ab266f5be6a04805bade2bcb0d'};
const legacyPage={path:'measurements/page-20261025-intune-name-local.json',sha256:'1d02f588491896b4edfc116519889adb96b1da237fb9ba05e26d4cb83525d135'};
const reviewedTools={
 'server/deploy.sh':'5b5260ff6904c73d19f5d498dd2b944a419c8c19d2266034fa9f66d38e20747c',
 'build.mjs':'d893c2873ee422fc86ed4a6a4f31d335a587df1dfea6e64bd8ed0abbe94beb99',
 'server/verify.mjs':'3dbe7bd6ae56a10634e6d130d3f0c54fef143968862d229a40beaf5e80f5b6f3',
 'server/verify-alias.mjs':'3da19f8a883eeff511374263dba231cc4e9d45476a4c116dce29d02b25edbc79',
 'server/verify-response.mjs':'3e57f69039e0cf0adfd358888bb17b32eb2c8d034ce4c71be240a28b22e05d06'
};

function browserMatrix(rows,source,label) {
 const matrix=['chromium','webkit'].flatMap(engine=>[320,402,768,1440].flatMap(width=>['light','dark'].map(theme=>`${engine}-${width}-${theme}`)));
 need(Array.isArray(rows)&&eq(rows.map(r=>`${r.engine}-${r.width}-${r.theme}`).sort(),matrix.sort()),label+' browser matrix differs');
 const native=[...source.toString('utf8').matchAll(/<a\s+href=(?:"mailto:[^"]*"|'mailto:[^']*'|mailto:[^\s>]+)/gi)].length;
 for(const r of rows) {
  const expected={mobile:r.width<=402,identicalPixels:true,identicalContentAndGeometry:true,identicalAccessibilityAttributes:true,keyboardLinks:9,
   identicalFocusedPixels:9,keyboardEnterDestinations:9,pageLoadRequests:1,keyboardProbeRequests:9-native,nativeProtocolActivations:native,unexpectedRequests:0,externalRequestsBlocked:true};
  need(Object.entries(expected).every(([k,v])=>r[k]===v)&&typeof r.browserVersion==='string'&&r.browserVersion.trim().length>0&&['Tab','Alt+Tab'].includes(r.focusKey),label+' browser case failed');
 }
}

// Bind the two fallback bodies to the build inputs in the immutable page
// commit. Reproduce the reviewed build's stock grid and saved-member selection
// on this runtime. A different zlib implementation may change the stock bytes
// or selection. A mismatch fails; a match establishes selection only on this
// runtime, not on the historical deployment runtime. The retained readbacks
// describe their observations separately.
function validateCommittedFallback(page,{source,sourceCommit,immutableSource}) {
 const saved=immutableSource(sourceCommit,'compression/index.html.gz',{optional:true});
 let savedSource;
 if(saved!==null) {
  try {
   // Conservative bound: unlike build.mjs, this can reject an unrelated saved
   // candidate that expands beyond the bound instead of ignoring it.
   const gzip=gunzipSync(saved,{info:true,maxOutputLength:Math.max(source.length+1,1<<20)});
   need(saved[3]===0&&gzip.engine.bytesWritten===saved.length,'Invalid committed gzip member');
   const raw=inflateRawSync(saved.subarray(10,-8),{info:true,maxOutputLength:Math.max(source.length+1,1<<20)});
   need(raw.engine.bytesWritten===saved.length-18&&raw.buffer.equals(gzip.buffer),'Invalid committed DEFLATE stream');
   savedSource=gzip.buffer;
  } catch(error) {throw new Error('Invalid committed gzip candidate',{cause:error});}
 }
 // Match build.mjs's order, strict-shorter stock selection, and saved-member
 // preference on ties. A larger or unrelated saved member is not selected.
 let gzip;
 for(let level=1;level<=9;level++)for(let strategy=0;strategy<=4;strategy++) {
  const candidate=gzipSync(source,{level,strategy});
  if(!gzip||candidate.length<gzip.length)gzip=candidate;
 }
 if(saved!==null&&savedSource.equals(source)&&saved.length<=gzip.length)gzip=saved;
 need(gzip.length===page.gzip&&hash(gzip)===page.gzipSha256,
  'Gzip differs from the immutable commit or cannot be reproduced with this runtime');
 need(gzip[3]===0,'Unexpected gzip optional fields');
 let a=1,b=0;
 for(const byte of source){a=(a+byte)%65521;b=(b+a)%65521;}
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE((b*65536+a)>>>0);
 const deflate=Buffer.concat([Buffer.from([120,218]),gzip.subarray(10,-8),checksum]);
 const decoded=inflateSync(deflate,{info:true,maxOutputLength:Math.max(source.length+1,1<<20)});
 need(decoded.engine.bytesWritten===deflate.length&&decoded.buffer.equals(source),'Committed deflate does not decode completely to the source');
 need(deflate.length===page.deflate&&hash(deflate)===page.deflateSha256,'Deflate differs from the committed gzip stream');
}

function validateBrowser(page,{root,record,immutableSource,source,sourceCommit,legacy,latestPageRef}) {
 const v=page.verification;
 need(v&&digest(v.browserVerifierSha256)&&digest(v.handlerSha256)&&v.browserCandidateSha256===page.htmlSha256&&digest(v.browserBaselineSha256),'Page browser provenance is missing');
 need(hash(immutableSource(sourceCommit,'tools/verify-page.mjs'))===v.browserVerifierSha256&&hash(immutableSource(sourceCommit,'server/site.js'))===v.handlerSha256,'Page browser verifier or handler differs from immutable commit');
 need(typeof page.publishedMeasurement==='string'&&/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(page.publishedMeasurement),'Invalid page browser baseline path');
 const baselinePath=realpathSync(resolve(root,page.publishedMeasurement));
 need(baselinePath.startsWith(realpathSync(resolve(root,'measurements'))+sep),'Page browser baseline escapes measurements');
 const baseline=JSON.parse(readFileSync(baselinePath,'utf8')),prior=record(legacyPage);
 need(baseline.htmlSha256===v.browserBaselineSha256&&baseline.htmlSha256===prior.htmlSha256&&baseline.html===prior.html
  &&(legacy||page.publishedMeasurement===legacyPage.path&&page.publishedMeasurement!==latestPageRef.path),'Page browser baseline is not the prior verified page');
 browserMatrix(v.browserComparisons,source,'Page');
 const report=record(page.browserEvidence);
 need(report.verifierSha256===v.browserVerifierSha256&&report.handlerSha256===v.handlerSha256
  &&report.baseline?.htmlSha256===v.browserBaselineSha256&&report.baseline?.htmlBytes===baseline.html
  &&report.candidate?.htmlSha256===page.htmlSha256&&report.candidate?.htmlBytes===page.html
  &&eq(report.cases,v.browserComparisons),'Page browser report differs');
 if(Object.hasOwn(page,'fontOverrideEvidence')) {
  need(keys(page.fontOverrideEvidence,['root','body']),'Missing font override evidence');
  const html=source.toString('utf8'),comment=html.indexOf('<!--');need(comment>=0,'Font override insertion point missing');
  for(const [name,selector] of [['root','html'],['body','body']]) {
   const ref=page.fontOverrideEvidence[name];need(ref?.comparisons===16,'Font override comparison count differs');
   const report=record({path:ref.path,sha256:ref.sha256});
   const derivative=Buffer.from(html.slice(0,comment)+`<style>${selector}{font-size:24px!important}</style>`+html.slice(comment));
   need(report.verifierSha256===v.browserVerifierSha256&&report.handlerSha256===v.handlerSha256
    &&report.candidate?.htmlBytes===derivative.length&&report.candidate?.htmlSha256===hash(derivative)
    &&integer(report.baseline?.htmlBytes)&&digest(report.baseline?.htmlSha256),'Font override evidence differs');
   browserMatrix(report.cases,source,'Font override');
  }
 }
 if(Object.hasOwn(page,'nativeEncodingEvidence')) {
  const report=record(page.nativeEncodingEvidence);
  need(report.schemaVersion===1&&report.passed===true&&report.cleanupComplete===true&&report.loopbackOnly===true&&report.requestInterception===false
   &&report.javaScriptEnabled===false&&report.serviceWorkers==='block'&&digest(report.fixtureSourceSha256),'Native encoding evidence failed');
  const matrix=['chromium','webkit'].flatMap(e=>Object.keys(mapping).map(k=>`${e}-${k}`));
  need(Array.isArray(report.rows)&&eq(report.rows.map(r=>`${r.engine}-${r.encoding}`).sort(),matrix.sort()),'Native encoding matrix differs');
  for(const r of report.rows) {
   const key=mapping[r.encoding];
   need(r.encodedBytes===page[key]&&r.encodedSha256===page[key+'Sha256']&&r.htmlBytes===page.html&&r.htmlSha256===page.htmlSha256
    &&r.exactDecodedSource===true&&r.contentMatchesIdentityControl===true&&r.explicitAcceptEncoding===r.encoding&&r.requestedEncodingAdvertised===true
    &&r.pageDocumentRequests===1&&r.unexpectedPageRequests===0&&typeof r.browserVersion==='string'&&r.browserVersion.trim(),'Native encoding evidence differs');
  }
 }
}

// The maintenance evidence is a specifically pinned legacy exception, not a
// template for accepting other old records with fewer provenance fields.
export function checkPageState({root,page,deployment,refs,record,immutableSource,earliest}) {
 const legacy=eq(refs.deployment,legacyDeployment)&&eq(refs.page,legacyPage);
 let sourceCommit,at;
 if(legacy) {
  const v=deployment.verification,r=v?.readback;
  need(deployment.schemaVersion===1&&deployment.kind==='content-update-deployment'&&deployment.url===target
   &&commit(deployment.sourceCommit)&&release(deployment.pageRelease)&&image(deployment.runtime?.imageId)&&deployment.runtime.running===true
   &&v.originReleaseMarkerAndAllBodiesPassed===true&&v.liveHttp11AndHttp2ChecksPassed===120&&v.aliasChecksPassed===12
   &&v.browserCases===16&&r?.pageRelease===deployment.pageRelease&&r.runtimeImageId===deployment.runtime.imageId
   &&r.running===true&&r.normalCertificateValidation===true&&r.exactPublicSource===true&&r.htmlSha256===page.htmlSha256
   &&['deploy.log','post-deploy-build.log','live.log','alias.log','live-readback.json'].every(k=>digest(v.privateLogHashes?.[k])),
   'Pinned maintenance page verification differs');
  for(const [encoding,key] of Object.entries(mapping))need(deployment.representations?.[key]?.bytes===page[key]
   &&deployment.representations?.[key]?.sha256===page[key+'Sha256'],'Pinned maintenance representation differs');
  sourceCommit=deployment.sourceCommit;at=stamp(deployment.verifiedAt);
  need(stamp(r.verifiedAt)===at&&stamp(page.measuredAt)<=at,'Pinned maintenance verification dates differ');
 } else {
  const d=deployment,v=d?.verification,r=v?.readback;
  need(/^measurements\/deployment-[A-Za-z0-9._-]+\.json$/.test(refs.deployment.path)
   &&keys(d,['schemaVersion','kind','url','verifiedAt','pageCommit','pageRelease','runtime','representations','aliases','verification'])&&d.schemaVersion===2&&d.kind==='page-only-deployment'&&d.url===target&&commit(d.pageCommit)&&release(d.pageRelease)
   &&keys(d.runtime,['imageId','running'])&&image(d.runtime.imageId)&&d.runtime.running===true,'Invalid latest page deployment identity');
  need(keys(v,['window','originReleaseMarkerVerified','originRepresentationsVerified','publicRepresentationsVerified','aliasesVerified','normalCertificateValidation','publicVerificationEnvironment','publicEnvironmentRecordedAt','privateLogHashes','fileReadbacks','readback','toolSha256'])
   &&v.originReleaseMarkerVerified===true&&v.originRepresentationsVerified===true&&v.publicRepresentationsVerified===true
   &&v.aliasesVerified===true&&v.normalCertificateValidation===true,'Latest page verification missing');
  need(keys(v.window,['startedAt','completedAt'])&&stamp(page.measuredAt)<=stamp(v.window.startedAt)
   &&earliest<=stamp(v.window.startedAt)&&stamp(v.window.startedAt)<=stamp(v.window.completedAt)&&stamp(v.window.completedAt)<=stamp(r?.verifiedAt)
   &&stamp(r.verifiedAt)===stamp(d.verifiedAt),'Page verification timestamps are unordered');
  need(keys(r,['verifiedAt','pageRelease','imageId','running','normalCertificateValidation'])&&r.pageRelease===d.pageRelease
   &&r.imageId===d.runtime.imageId&&r.running===true&&r.normalCertificateValidation===true,'Page release or runtime readback differs');
  const cleanEnvironment=['ONEKB_TEST_IP','ONEKB_TEST_HTTP_PORT','ONEKB_TEST_HTTPS_PORT','ONEKB_ALIAS_IP','CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','DYLD_INSERT_LIBRARIES','LD_PRELOAD'];
  need(keys(v.publicVerificationEnvironment,cleanEnvironment)&&Object.values(v.publicVerificationEnvironment).every(value=>value===null),'Public verification environment is tainted or unknown');
  need(keys(v.privateLogHashes,['deploy','build','live','alias','publicEnvironment','readback'])&&Object.values(v.privateLogHashes).every(digest)
   &&['deploy','build','live','alias','publicEnvironment'].every(k=>v.privateLogHashes[k]!==v.privateLogHashes.readback),'Page verification log hashes missing or reused');
  need(eq(v.toolSha256,reviewedTools),'Page verification tool identities are not reviewed');
  for(const [path,sha256] of Object.entries(reviewedTools))need(hash(immutableSource(d.pageCommit,path))===sha256,'Page verifier differs from immutable commit');
  // Expected build identities are distinct from aggregate command outcomes.
  // They are not reconstructed per-request observations.
  need(Array.isArray(d.representations)&&d.representations.length===4,'Expected page representations missing');
  for(const [encoding,key] of Object.entries(mapping)) {
   const matches=d.representations.filter(x=>x.encoding===encoding),row=matches[0];
   need(matches.length===1&&keys(row,['encoding','bytes','sha256','contentEncoding'])&&row.bytes===page[key]
    &&row.sha256===page[key+'Sha256']&&row.contentEncoding===(encoding==='identity'?null:encoding),'Expected page representation differs');
  }
  // These are separately retained file readbacks, not HTTP observations.
  need(keys(v.fileReadbacks,['preflight','postBuild','release']),'Page file readbacks missing');
  const files={identity:'index.html',br:'index.html.br',gzip:'index.html.gz',deflate:'index.html.deflate'},readbackHashes=[];
  for(const [name,readback] of Object.entries(v.fileReadbacks)) {
   need(keys(readback,['observedAt','passed','privateReadbackSha256','files',...(name==='release'?['pageRelease']:[])])
    &&readback.passed===true&&digest(readback.privateReadbackSha256)&&Array.isArray(readback.files)&&readback.files.length===4,'Page file readback missing');
   readbackHashes.push(readback.privateReadbackSha256);
   for(const [encoding,key] of Object.entries(mapping)) {
    const matches=readback.files.filter(x=>x.encoding===encoding),row=matches[0];
    need(matches.length===1&&keys(row,['encoding','file','bytes','sha256'])&&row.file===files[encoding]
     &&row.bytes===page[key]&&row.sha256===page[key+'Sha256'],'Page file readback representation differs');
   }
  }
  const a=v.fileReadbacks.preflight,b=v.fileReadbacks.postBuild,c=v.fileReadbacks.release;
  need(new Set(readbackHashes).size===3&&c.privateReadbackSha256===v.privateLogHashes.readback&&c.pageRelease===d.pageRelease
   &&stamp(page.measuredAt)<=stamp(a.observedAt)&&earliest<=stamp(a.observedAt)&&stamp(a.observedAt)<=stamp(v.window.startedAt)
   &&stamp(v.window.startedAt)<=stamp(b.observedAt)&&stamp(b.observedAt)<=stamp(v.publicEnvironmentRecordedAt)
   &&stamp(v.publicEnvironmentRecordedAt)<=stamp(v.window.completedAt)&&stamp(c.observedAt)===stamp(r.verifiedAt),
   'Page file readback identity or timestamps differ');
  need(Array.isArray(d.aliases)&&d.aliases.length===2,'Expected aliases missing');
  for(const host of ['www.tomkimberlin.com','tom.kimberlin.net']) {
   const matches=d.aliases.filter(x=>x.host===host),row=matches[0];
   need(matches.length===1&&keys(row,['host','location'])&&row.location===target,'Expected page alias differs');
  }
  sourceCommit=d.pageCommit;at=stamp(d.verifiedAt);
 }
 need(at>=earliest,'Latest page verification predates historical evidence');
 need(page.url===target&&Object.values(mapping).every(k=>integer(page[k])&&digest(page[k+'Sha256'])),'Invalid latest page measurements');
 const source=immutableSource(sourceCommit,'index.html');
 need(source.length===page.html&&hash(source)===page.htmlSha256,'Latest page differs from immutable commit');
 if(!legacy)validateCommittedFallback(page,{source,sourceCommit,immutableSource});
 validateBrowser(page,{root,record,immutableSource,source,sourceCommit,legacy,latestPageRef:refs.page});
 return {at,sourceCommit,pageRelease:deployment.pageRelease,live:Object.fromEntries(Object.values(mapping).map(k=>[k,{bytes:page[k],sha256:page[k+'Sha256']}]))};
}
