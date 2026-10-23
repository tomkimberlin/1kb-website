// Current live evidence and a pending local build are separate comparison states.
import {readFileSync, readdirSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const target='https://tomkimberlin.com/';
const hash=data=>createHash('sha256').update(data).digest('hex');
const need=(condition,message)=>{if(!condition)throw Error(message);};
const equal=isDeepStrictEqual;
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),[...expected].sort());
const stats=values=>({median:[...values].sort((a,b)=>a-b)[1],minimum:Math.min(...values),maximum:Math.max(...values)});
const stamp=value=>{need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19),'Invalid evidence timestamp');return Date.parse(value);};
const representations={identity:['html','index.html'],br:['brotli','index.html.br'],gzip:['gzip','index.html.gz'],deflate:['deflate','index.html.deflate']};
const metrics=['tlsThroughBodyCompleteMinusBody','estimatedTcpPlusDnsMinusBody','responseHttpPlainMinusBody'];
const componentHosts=['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'];
const markers=kind=>[`<!-- comparison:${kind}:start -->`,`<!-- comparison:${kind}:end -->`];
const bytes=n=>n.toLocaleString('en-US')+' B';
const interval=s=>`${s.minimum.toLocaleString('en-US')}–${s.maximum.toLocaleString('en-US')} B`;

function block(markdown,kind,required=true) {
  const [start,end]=markers(kind),a=markdown.split(start),b=markdown.split(end);
  if(!required&&a.length===1&&b.length===1)return null;
  need(a.length===2&&b.length===2&&markdown.indexOf(start)<markdown.indexOf(end),'Missing or duplicate comparison '+kind+' block');
  return markdown.slice(markdown.indexOf(start),markdown.indexOf(end)+end.length).trim();
}

export function renderCurrent({overhead,deployment,page,refs,quic,statusEncoding}) {
  const rows=[['Complete TLS through first document',stats(overhead.runs.map(r=>r.tlsThroughBodyComplete.sent+r.tlsThroughBodyComplete.received))],
    ['TLS minus complete body',overhead.summary[metrics[0]]],
    ['Estimated TCP/IP + DNS through close',stats(overhead.runs.map(r=>r.estimatedTcpPlusDnsBytes))],
    ['TCP/IP + DNS minus complete body',overhead.summary[metrics[1]]],
    ['HTTP/2 plaintext minus complete body',overhead.summary[metrics[2]]]];
  const day=overhead.runs.at(-1).measuredAt.slice(0,10);
  const parameters=quic?`\n\nHTTP/3 transport-parameter component: **${bytes(quic.before.parameters.encoded_transport_parameters_bytes)} → ${bytes(quic.after.parameters.encoded_transport_parameters_bytes)} (${bytes(quic.before.parameters.encoded_transport_parameters_bytes-quic.after.parameters.encoded_transport_parameters_bytes)} less)** with unchanged effective ${quic.before.parameters.limit_fields?'parameters':'ACK parameters'} ([verified component evidence](${deployment.quicTransportParameters.path})); this does not establish a fixed complete-exchange or HTTP/2 saving.`:'';
  const status=statusEncoding?`\n\nStatus-field components: **301: HTTP/2 5 → 4 B; HTTP/3 6 → 5 B. HTTP/3 404: 6 → 1 B; main 200 unchanged.** [Verified component evidence](${deployment.statusEncoding.path}); no fixed whole-exchange saving is established.`:'';
  return `${markers('current')[0]}
## Latest verified own-site result

Measured ${day}: **${bytes(page.html)} HTML; ${bytes(page.brotli)} Brotli; ${bytes(page.gzip)} gzip; ${bytes(page.deflate)} deflate.** Three cold first-document exchanges count both directions. Delivery overhead subtracts the entire encoded body from each exchange.

Verified certificate components: **${componentHosts.map(host=>`${host} ${bytes(deployment.certificateCache.trustedLiveCompleteCompressedCertificateBytes.find(row=>row.hostname===host).compressedCertificateMessageBytes[0])}`).join('; ')}** (complete compressed Certificate handshake messages). These are component bytes; aliases have no complete-exchange measurement here.

| Measurement | Median | Range |
| --- | ---: | ---: |
${rows.map(([label,s])=>`| ${label} | ${bytes(s.median)} | ${interval(s)} |`).join('\n')}${parameters}${status}

[Overhead evidence](${refs.overhead.path}), [verified deployment](${refs.deployment.path}) and [page measurements](${refs.page.path}). Only this website was remeasured; this creates no new peer ranking. TLS and packet totals stop at different points, so their difference does not isolate TCP overhead. Three samples do not establish a timing or universal saving.

Refresh this section after every verified body or transport byte reduction. Complete totals show body savings even when body-subtracted overhead stays unchanged.
${markers('current')[1]}`;
}

export function renderCandidate(page,ref) {
  return `${markers('candidate')[0]}
## Local candidate — not deployed

The working build is **${bytes(page.html)} HTML; ${bytes(page.brotli)} Brotli; ${bytes(page.gzip)} gzip; ${bytes(page.deflate)} deflate.** [Local build evidence](${ref.path}) binds these exact representations. No live transfer, overhead or peer-ranking result is claimed for this candidate. After publication and measurement, advance the verified-live pointers and remove this section.
${markers('candidate')[1]}`;
}

export function checkComparison({root=process.cwd(),pointer='measurements/comparison-current.json'}={}) {
  root=resolve(root);
  const read=name=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
  const doc=readFileSync(resolve(root,'COMPARISON.md'),'utf8');
  const config=read(pointer);
  need(keys(config,['schemaVersion','targetUrl','current','historicalGallery',...(Object.hasOwn(config,'candidate')?['candidate']:[])])&&config.schemaVersion===1&&config.targetUrl===target,'Invalid comparison pointer schema');
  need(keys(config.current,['overhead','deployment','page']),'Invalid current comparison pointers');
  function record(ref) {
    need(keys(ref,['path','sha256'])&&/^measurements\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(ref.path)&&digest(ref.sha256),'Invalid comparison evidence reference');
    const path=realpathSync(resolve(root,ref.path));
    need(path.startsWith(realpathSync(resolve(root,'measurements'))+sep),'Evidence reference escapes measurements');
    const contents=readFileSync(path);need(hash(contents)===ref.sha256,'Comparison evidence hash is stale');
    return JSON.parse(contents);
  }
  const overhead=record(config.current.overhead),deployment=record(config.current.deployment),page=record(config.current.page),gallery=record(config.historicalGallery);
  const statusEncoding=deployment.statusEncoding===undefined?null:record(deployment.statusEncoding);
  need(!Object.hasOwn(deployment.server?.sourceFileHashes??{},'server/status-encoding.patch')||deployment.statusEncoding!==undefined,'Current status-encoding runtime requires component evidence');
  if(deployment.statusEncoding!==undefined) {
    const s=statusEncoding,source=s?.source,hashes=deployment.server?.sourceFileHashes;
    need(s?.schemaVersion===1&&s.targetUrl===target,'Invalid status component evidence');
    need(/^sha256:[0-9a-f]{64}$/.test(s.before?.runtimeImageId??'')&&s.after?.runtimeImageId===deployment.server?.imageId,'Status component runtime image differs from current deployment');
    need(/^[0-9a-f]{40}$/.test(deployment.runtimeSourceCommit??'')&&source?.runtimeSourceCommit===deployment.runtimeSourceCommit
      &&s.after.runtimeSourceCommit===deployment.runtimeSourceCommit,'Status component runtime source commit differs');
    for(const [path,key] of [['server/status-encoding.patch','statusEncodingPatchSha256'],['server/Dockerfile','dockerfileSha256']]) {
      need(digest(source[key])&&source[key]===hashes?.[path],'Status component source hash differs from deployment');
      const committed=execFileSync('git',['show',deployment.runtimeSourceCommit+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});
      need(hash(committed)===source[key],'Status component source differs from immutable runtime commit');
    }
    const cases={main:{hostname:'tomkimberlin.com',method:'GET',path:'/',statusCode:200},
      missing:{hostname:'tomkimberlin.com',method:'GET',path:'/missing',statusCode:404},
      method:{hostname:'tomkimberlin.com',method:'BREW',path:'/',statusCode:405},
      wwwAlias:{hostname:'www.tomkimberlin.com',method:'GET',path:'/legacy?onekb=status',statusCode:301},
      alternateAlias:{hostname:'tom.kimberlin.net',method:'GET',path:'/legacy?onekb=status',statusCode:301}};
    need(equal(s.requestCases,cases),'Status component request cases differ');
    const names=Object.keys(cases),protocols=['h2','h3'];
    const sizes={before:{h2:[1,1,5,5,5],h3:[1,6,6,6,6]},after:{h2:[1,1,5,4,4],h3:[1,1,6,5,5]}};
    const rowKeys=['statusCode','statusFieldBytes','blockBytes','nonFieldPrefixBytes','statusRepresentation','bodyBytes','bodySha256',
      'normalCertificateValidation','exactStatus','exactBody','destinationVerified','allowVerified'];
    const clientKeys=['h2','hpack','pylsqpack','aioquic'],reusedKeys=['tools/verify-http3.py','tools/probe_response.py'];
    const verified=stamp(s.verifiedThrough);
    for(const phase of ['before','after']) {
      const side=s[phase];
      need(side.passed===true&&side.normalCertificateValidation===true&&side.trust==='Default CA and owned hostname verification'
        &&side.fixtureCAUsed===false&&side.freshConnections===10,'Status component requires trusted fresh connections');
      need(digest(side.sourceSha256)&&keys(side.clientVersions,clientKeys)&&clientKeys.every(k=>typeof side.clientVersions[k]==='string'&&side.clientVersions[k].length>0)
        &&keys(side.reusedSources,reusedKeys)&&reusedKeys.every(k=>digest(side.reusedSources[k])),'Invalid status component client identity');
      need(/^[0-9a-f]{40}$/.test(side.runtimeSourceCommit??'')&&/^[0-9a-f]{40}$/.test(side.pageCommitAtReadback??'')
        &&typeof side.pageReleaseAtReadback==='string'&&side.pageReleaseAtReadback.startsWith('releases/')
        &&side.perRequestGenerationVerified===false&&typeof side.deploymentOverlap==='boolean'
        &&!Object.hasOwn(side,'pageCommit')&&!Object.hasOwn(side,'pageRelease'),'Invalid status component readback scope');
      need(stamp(side.startedAt)<=stamp(side.completedAt)&&stamp(side.completedAt)<=stamp(side.runtimeReadbackAt)
        &&stamp(side.runtimeReadbackAt)<=verified,'Status component timestamps are unordered');
      need(keys(side.rows,protocols),'Missing status component protocol rows');
      for(const protocol of protocols) {
        need(keys(side.rows[protocol],names),'Missing or extra status component case');
        for(const [index,name] of names.entries()) {
          const row=side.rows[protocol][name],prefix=protocol==='h2'?1:2;
          const indexed=name==='main'||(name==='missing'&&(protocol==='h2'||phase==='after'));
          const representation=indexed?'indexed-static':phase==='after'&&name.endsWith('Alias')?'literal-name-huffman':'literal-name-raw';
          need(keys(row,rowKeys)&&row.statusCode===cases[name].statusCode&&row.statusFieldBytes===sizes[phase][protocol][index]
            &&row.statusRepresentation===representation&&row.nonFieldPrefixBytes===prefix,'Status component field encoding differs');
          need(integer(row.blockBytes)&&row.blockBytes>=prefix+row.statusFieldBytes&&row.blockBytes<=16384,'Status component block bounds differ');
          need(row.normalCertificateValidation===true&&row.exactStatus===true&&row.exactBody===true
            &&row.destinationVerified===true&&row.allowVerified===true,'Status component response verification failed');
          need(integer(row.bodyBytes)&&digest(row.bodySha256)&&(name==='main'?row.bodyBytes>0:row.bodyBytes===0&&row.bodySha256===hash(Buffer.alloc(0))),'Status component body verification differs');
        }
      }
      need(side.rows.h2.main.bodyBytes===side.rows.h3.main.bodyBytes&&side.rows.h2.main.bodySha256===side.rows.h3.main.bodySha256,'Status component protocol bodies differ');
    }
    need(stamp(s.before.runtimeReadbackAt)<=stamp(s.after.startedAt)&&s.before.sourceSha256===s.after.sourceSha256
      &&equal(s.before.clientVersions,s.after.clientVersions)&&equal(s.before.reusedSources,s.after.reusedSources),'Status component client changed or phases overlap');
    const main=s.after.rows.h2.main;
    need(main.bodyBytes===page.brotli&&main.bodySha256===page.brotliSha256,'Status component after body differs from current page');
    need(keys(s.deltas,protocols),'Invalid status component deltas');
    for(const protocol of protocols) {
      need(keys(s.deltas[protocol],names),'Missing status component delta case');
      for(const name of names) {
        const a=s.before.rows[protocol][name],b=s.after.rows[protocol][name],d=s.deltas[protocol][name];
        need(keys(d,['statusFieldBytesSaved','blockBytesSaved','bodyBytesSaved'])&&['statusField','block','body'].every(k=>Number.isSafeInteger(d[k+'BytesSaved'])
          &&d[k+'BytesSaved']===a[k+'Bytes']-b[k+'Bytes']),'Status component delta arithmetic differs');
      }
    }
  }
  const quic=deployment.quicTransportParameters===undefined?null:record(deployment.quicTransportParameters);
  if(deployment.quicTransportParameters!==undefined) {
    need(quic&&quic.schemaVersion===1&&quic.targetUrl===target,'Invalid QUIC component evidence');
    need(digest(quic.before?.runtimeImageId?.replace(/^sha256:/,''))&&quic.after?.runtimeImageId===deployment.server?.imageId,'QUIC component runtime image differs from current deployment');
    const limits=quic.before?.parameters?.limit_fields!==undefined||quic.after?.parameters?.limit_fields!==undefined;
    const contextKeys=['max_idle_timeout_ms','max_udp_payload_size','initial_max_data','initial_max_stream_data_bidi_local','initial_max_stream_data_bidi_remote','initial_max_stream_data_uni','initial_max_streams_bidi','initial_max_streams_uni','active_connection_id_limit','disable_active_migration'];
    const parameterKeys=['schema','host','protocol','certificate_verification','trust_store','fresh_handshake_completed','session_resumed','aioquic_version','probe_source_sha256','scope','encoded_transport_parameters_bytes','ack_fields','saved_context_relevant_effective_values',...(limits?['limit_fields']:[])];
    for(const [name,side] of [['before',quic.before],['after',quic.after]]) {
      const p=side.parameters,c=p?.saved_context_relevant_effective_values;
      need(keys(p,parameterKeys)&&p.schema===1&&p.host==='tomkimberlin.com'&&p.protocol==='h3'
        &&p.certificate_verification===true&&p.trust_store==='default'&&p.fresh_handshake_completed===true&&p.session_resumed===false
        &&typeof p.aioquic_version==='string'&&p.aioquic_version.length>0&&digest(p.probe_source_sha256)&&typeof p.scope==='string'
        &&integer(p.encoded_transport_parameters_bytes)&&p.encoded_transport_parameters_bytes>0,'Invalid trusted QUIC parameter readback');
      need(keys(c,contextKeys)&&contextKeys.slice(0,-1).every(key=>integer(c[key]))&&typeof c.disable_active_migration==='boolean','Invalid QUIC parameter context values');
      need(keys(p.ack_fields,['ack_delay_exponent','max_ack_delay_ms']),'Invalid QUIC ACK fields');
      for(const [key,value] of [['ack_delay_exponent',3],['max_ack_delay_ms',25]]) {
        const ack=p.ack_fields[key];
        need(keys(ack,['present','effective_value'])&&ack.present===(!limits&&name==='before')&&ack.effective_value===value,'QUIC ACK defaults or omission changed');
      }
      if(limits) {
        need(keys(p.limit_fields,['max_udp_payload_size','active_connection_id_limit']),'Invalid QUIC limit fields');
        for(const [key,value] of [['max_udp_payload_size',65527],['active_connection_id_limit',2]]) {
          const limit=p.limit_fields[key];
          need(keys(limit,['present','effective_value'])&&limit.present===(name==='before')&&limit.effective_value===value
            &&c[key]===value,'QUIC limit defaults or omission changed');
        }
      }
    }
    const before=quic.before.parameters,after=quic.after.parameters;
    // ACK fields cost 3+3 B; the two optional limits cost 6+3 B.
    need(before.encoded_transport_parameters_bytes-after.encoded_transport_parameters_bytes===(limits?9:6),'QUIC omitted-default component byte difference differs');
    need(equal(before.saved_context_relevant_effective_values,after.saved_context_relevant_effective_values)
      &&before.aioquic_version===after.aioquic_version&&before.probe_source_sha256===after.probe_source_sha256,'QUIC context or measurement client changed');
  }
  need(overhead.targetUrl===target&&deployment.url===target&&page.url===target,'Comparison evidence targets differ');
  need(overhead.phase==='live'&&overhead.runs?.length===3,'Current overhead must contain three live samples');
  need(overhead.pageCommit===deployment.pageCommit&&/^[0-9a-f]{40}$/.test(deployment.pageCommit),'Current page commits differ');
  need(overhead.serverRuntime?.imageId===deployment.server?.imageId&&digest(deployment.server.imageId?.replace(/^sha256:/,'')),'Current runtime image binding differs');
  need(overhead.serverRuntime.pageRelease===deployment.pageRelease,'Current deployed page release differs');
  need(deployment.server.running===true,'Current deployment did not verify a running server');
  need(Array.isArray(deployment.pageRepresentations)&&deployment.pageRepresentations.length===4,'Deployment must verify exactly four representations');
  const live={};
  for(const [encoding,[key]] of Object.entries(representations)) {
    const matches=deployment.pageRepresentations.filter(r=>r.encoding===encoding);
    need(matches.length===1,'Duplicate or missing deployed representation');
    const row=matches[0];
    need(integer(page[key])&&page[key]>0&&digest(page[key+'Sha256'])&&row.bytes===page[key]&&row.sha256===page[key+'Sha256']&&row.exactLocalOriginAndPublicResponse===true,'Page and verified deployment representations differ');
    live[key]={bytes:page[key],sha256:page[key+'Sha256']};
  }
  const committed=execFileSync('git',['show',deployment.pageCommit+':index.html'],{cwd:root,stdio:['ignore','pipe','pipe']});
  need(committed.length===page.html&&hash(committed)===page.htmlSha256,'Verified deployment source differs from its immutable commit');
  need(overhead.bodyBytes===page.brotli&&overhead.bodySha256===page.brotliSha256&&overhead.decodedBodyBytes===page.html&&overhead.sourceSha256===page.htmlSha256,'Overhead body/source differs from the verified page');
  const rawHashes=new Set(),times=[];
  const certificates=deployment.certificateCache?.trustedLiveCompleteCompressedCertificateBytes;
  need(Array.isArray(certificates)&&certificates.length===3
    &&equal(certificates.map(row=>row.hostname).sort(),[...componentHosts].sort()),'Missing or duplicate verified certificate component hosts');
  for(const row of certificates) {
    need(row.verified===true&&row.protocol==='TLSv1.3'&&row.alpn==='h2'&&row.cipher==='TLS_AES_128_GCM_SHA256'
      &&row.compressedCertificateMessageCount===1&&row.compressedCertificateMessageBytes?.length===1
      &&integer(row.compressedCertificateMessageBytes[0])&&row.compressedCertificateMessageBytes[0]>=12,'Invalid verified certificate component');
    const caches=deployment.certificateCache.actualOwnedCacheFiles;
    if(caches!==undefined) {
      const sidecar=Array.isArray(caches)?caches.filter(cache=>cache.hostname===row.hostname):[];
      need(sidecar.length===1&&integer(sidecar[0].brotliBytes)&&sidecar[0].brotliBytes>0
        &&sidecar[0].brotliBytes+12===row.compressedCertificateMessageBytes[0],'Verified certificate component and sidecar payload sizes differ');
    }
  }
  const certificateBytes=certificates.find(row=>row.hostname==='tomkimberlin.com').compressedCertificateMessageBytes[0];
  for(const [i,row] of overhead.runs.entries()) {
    need(row.run===i+1&&row.statusCode===200&&row.certificateVerified===true&&row.httpProtocol==='h2'&&row.tlsProtocol==='TLSv1.3','Invalid current overhead sample');
    need(row.bodyBytes===page.brotli&&row.bodySha256===page.brotliSha256&&row.decodedBodyBytes===page.html&&row.sourceSha256===page.htmlSha256,'Stale overhead sample body/source');
    need(digest(row.privateRawSnapshotSha256),'Missing raw snapshot hash');rawHashes.add(row.privateRawSnapshotSha256);times.push(stamp(row.measuredAt));
    const sent=row.tlsThroughBodyComplete?.sent,received=row.tlsThroughBodyComplete?.received;
    need([sent,received,row.estimatedIpv4TcpBytesAt1500Mtu,row.dnsIpv4UdpBytes,row.estimatedTcpPlusDnsBytes,row.responseHttpPlainBytes,...metrics.map(k=>row[k])].every(integer),'Invalid sample byte count');
    need(row.estimatedTcpPlusDnsBytes===row.estimatedIpv4TcpBytesAt1500Mtu+row.dnsIpv4UdpBytes,'Current packet/DNS sum differs');
    need(row[metrics[0]]===sent+received-row.bodyBytes&&row[metrics[1]]===row.estimatedTcpPlusDnsBytes-row.bodyBytes&&row[metrics[2]]===row.responseHttpPlainBytes-row.bodyBytes,'Current overhead does not subtract the whole encoded body');
    const component=row.tlsComponents?.compressedCertificate?.read;
    need(component?.count===1&&component.bytes===certificateBytes&&equal(component.messageBytes,[certificateBytes]),'Current measured certificate component differs from the verified deployment');
  }
  if(overhead.certificateComponents) {
    const hosts=overhead.certificateComponents.hosts;
    need(Array.isArray(hosts)&&hosts.length===3&&new Set(hosts.map(row=>row.hostname)).size===3,'Invalid normalized certificate component hosts');
    for(const host of hosts) {
      const matches=certificates.filter(row=>row.hostname===host.hostname);
      need(matches.length===1&&matches[0].verified===true&&matches[0].compressedCertificateMessageCount===1
        &&equal(matches[0].compressedCertificateMessageBytes,[host.compressedCertificateMessageBytes])
        &&host.encodedCertificatePayloadBytes===host.compressedCertificateMessageBytes-12&&host.certificateVerified===true,'Normalized alias certificate component differs from the verified deployment');
    }
  }
  need(rawHashes.size===3&&equal(times,[...times].sort((a,b)=>a-b)),'Duplicate samples or unordered timestamps');
  for(const key of metrics)need(equal(overhead.summary?.[key],stats(overhead.runs.map(r=>r[key]))),'Current overhead summary is stale');
  // New published verification must advance the pointer even when bytes match.
  const deploymentTime=stamp(deployment.verifiedThrough??deployment.verifiedAt),overheadTime=Math.max(...times);
  for(const name of readdirSync(resolve(root,'measurements'))) {
    if(!/^(?:deployment|overhead)-[A-Za-z0-9._-]+\.json$/.test(name))continue;
    const other=read('measurements/'+name);
    if(name.startsWith('deployment-')&&other.url===target)need(stamp(other.verifiedThrough??other.verifiedAt)<=deploymentTime,'A newer verified deployment is missing from the comparison');
    if(name.startsWith('overhead-')&&other.targetUrl===target&&other.phase!=='baseline') {
      need(Array.isArray(other.runs)&&other.runs.length===3,'Malformed published overhead record');
      need(Math.max(...other.runs.map(r=>stamp(r.measuredAt)))<=overheadTime,'A newer own-site overhead result is missing from the comparison');
    }
  }
  need(block(doc,'current')===renderCurrent({overhead,deployment,page,refs:config.current,quic,statusEncoding}),'Current comparison section is stale');
  const latest=readFileSync(resolve(root,'README.md'),'utf8').split('\n').filter(line=>line.startsWith('**Latest verified result: '));
  const current=overhead.summary.estimatedTcpPlusDnsMinusBody;
  const date=new Date(overhead.runs.at(-1).measuredAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
  need(latest.length===1&&latest[0].includes(`**Latest verified result: ${bytes(current.median)} estimated overhead, ${date}.**`)
    &&latest[0].includes(`(${interval(current)})`)&&latest[0].includes(`](${config.current.overhead.path})`),'Stale README latest result, range or evidence link');
  const historical=block(doc,'gallery');
  need(historical.includes('September 22, 2026')&&historical.includes(`](${config.historicalGallery.path})`),'Historical gallery date/evidence link is missing');
  need(Array.isArray(gallery.summary)&&gallery.summary.length===6,'Historical gallery must retain six sites');
  for(const row of gallery.summary) {
    const lines=historical.split('\n').filter(line=>line.startsWith('| ')&&line.includes(`](${row.url})`));
    need(lines.length===1,'Historical comparison row is missing or duplicated');
    const cells=lines[0].split('|').slice(1,-1).map(c=>c.trim());
    const number=cell=>Number(cell.replace(/[*, B]/g,''));
    need(number(cells[1])===row.tls_median&&number(cells[2])===row.total_median,'Historical gallery values changed');
  }
  const build=read('build-report.json'),working={};
  for(const [,[key,file]] of Object.entries(representations)) {
    const contents=readFileSync(resolve(root,'public',file));
    need(contents.length===build[key],'Working build byte count is stale');
    working[key]={bytes:contents.length,sha256:hash(contents)};
  }
  need(hash(readFileSync(resolve(root,'index.html')))===working.html.sha256,'Working source and build differ');
  const changed=Object.keys(live).some(k=>!equal(working[k],live[k]));
  if(changed) {
    need(keys(config.candidate,['page']),'A changed working build needs an explicit local candidate');
    const candidate=record(config.candidate.page);
    need(candidate.scope==='local build'||candidate.verification?.browserCandidateSha256===candidate.htmlSha256,'Candidate must carry explicitly local build or browser evidence');
    for(const key of Object.keys(working))need(candidate[key]===working[key].bytes&&candidate[key+'Sha256']===working[key].sha256,'Local candidate evidence is stale');
    need(block(doc,'candidate')===renderCandidate(candidate,config.candidate.page),'Local candidate comparison section is stale');
  } else need(!Object.hasOwn(config,'candidate')&&block(doc,'candidate',false)===null,'Remove the local candidate after live publication');
  return {liveDate:overhead.runs.at(-1).measuredAt.slice(0,10),localCandidate:changed};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length<=3,'Usage: check-comparison.mjs [POINTER]');
    const result=checkComparison({pointer:process.argv[2]});
    console.log(`Verified-live comparison is current (${result.liveDate}); ${result.localCandidate?'local candidate is separately labeled':'working build matches live evidence'}. Historical gallery remains dated.`);
  } catch(error) {console.error('Comparison check failed: '+error.message);process.exitCode=1;}
}
