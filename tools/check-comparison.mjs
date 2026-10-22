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
const markers=kind=>[`<!-- comparison:${kind}:start -->`,`<!-- comparison:${kind}:end -->`];
const bytes=n=>n.toLocaleString('en-US')+' B';
const interval=s=>`${s.minimum.toLocaleString('en-US')}–${s.maximum.toLocaleString('en-US')} B`;

function block(markdown,kind,required=true) {
  const [start,end]=markers(kind),a=markdown.split(start),b=markdown.split(end);
  if(!required&&a.length===1&&b.length===1)return null;
  need(a.length===2&&b.length===2&&markdown.indexOf(start)<markdown.indexOf(end),'Missing or duplicate comparison '+kind+' block');
  return markdown.slice(markdown.indexOf(start),markdown.indexOf(end)+end.length).trim();
}

export function renderCurrent({overhead,deployment,page,refs}) {
  const rows=[['Complete TLS through first document',stats(overhead.runs.map(r=>r.tlsThroughBodyComplete.sent+r.tlsThroughBodyComplete.received))],
    ['TLS minus complete body',overhead.summary[metrics[0]]],
    ['Estimated TCP/IP + DNS through close',stats(overhead.runs.map(r=>r.estimatedTcpPlusDnsBytes))],
    ['TCP/IP + DNS minus complete body',overhead.summary[metrics[1]]],
    ['HTTP/2 plaintext minus complete body',overhead.summary[metrics[2]]]];
  const day=overhead.runs.at(-1).measuredAt.slice(0,10);
  return `${markers('current')[0]}
## Latest verified own-site result

Measured ${day}: **${bytes(page.html)} HTML; ${bytes(page.brotli)} Brotli; ${bytes(page.gzip)} gzip; ${bytes(page.deflate)} deflate.** Three cold first-document exchanges count both directions. Delivery overhead subtracts the entire encoded body from each exchange.

| Measurement | Median | Range |
| --- | ---: | ---: |
${rows.map(([label,s])=>`| ${label} | ${bytes(s.median)} | ${interval(s)} |`).join('\n')}

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
  for(const [i,row] of overhead.runs.entries()) {
    need(row.run===i+1&&row.statusCode===200&&row.certificateVerified===true&&row.httpProtocol==='h2'&&row.tlsProtocol==='TLSv1.3','Invalid current overhead sample');
    need(row.bodyBytes===page.brotli&&row.bodySha256===page.brotliSha256&&row.decodedBodyBytes===page.html&&row.sourceSha256===page.htmlSha256,'Stale overhead sample body/source');
    need(digest(row.privateRawSnapshotSha256),'Missing raw snapshot hash');rawHashes.add(row.privateRawSnapshotSha256);times.push(stamp(row.measuredAt));
    const sent=row.tlsThroughBodyComplete?.sent,received=row.tlsThroughBodyComplete?.received;
    need([sent,received,row.estimatedIpv4TcpBytesAt1500Mtu,row.dnsIpv4UdpBytes,row.estimatedTcpPlusDnsBytes,row.responseHttpPlainBytes,...metrics.map(k=>row[k])].every(integer),'Invalid sample byte count');
    need(row.estimatedTcpPlusDnsBytes===row.estimatedIpv4TcpBytesAt1500Mtu+row.dnsIpv4UdpBytes,'Current packet/DNS sum differs');
    need(row[metrics[0]]===sent+received-row.bodyBytes&&row[metrics[1]]===row.estimatedTcpPlusDnsBytes-row.bodyBytes&&row[metrics[2]]===row.responseHttpPlainBytes-row.bodyBytes,'Current overhead does not subtract the whole encoded body');
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
  need(block(doc,'current')===renderCurrent({overhead,deployment,page,refs:config.current}),'Current comparison section is stale');
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
