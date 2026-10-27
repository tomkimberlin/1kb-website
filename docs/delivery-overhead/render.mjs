import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE || 'sharp');
const dir=resolve(process.argv[2]||fileURLToPath(new URL('.',import.meta.url)));
const data=JSON.parse(readFileSync(resolve(dir,'history-data.json'),'utf8'));
const reference=JSON.parse(readFileSync(resolve(dir,'default-reference-20261026.json'),'utf8'));
const live=JSON.parse(readFileSync(resolve(dir,'fresh-measurement.json'),'utf8'));
const values=[reference.arms['stock-identity'].median,reference.arms.optimized.median,data.points[0].extra_bytes];
if(values.join(',')!=='5421,4432,6203')throw new Error('Unexpected chart values');
const liveMedian=live.runs.map(run=>run.tls_minus_body).sort((a,b)=>a-b)[1];
if(live.status!=='passed'||live.runs.length!==3||liveMedian!==5252||!live.started_at_utc.startsWith('2026-10-26'))throw new Error('Unexpected live measurement');
const x=310, scale=620/6500;
const format=value=>value.toLocaleString('en-US');
const bar=(value,y,color)=>`<rect data-value="${value}" data-baseline="0" x="${x}" y="${y}" width="${(value*scale).toFixed(3)}" height="40" rx="8" fill="${color}"/><text x="${(x+value*scale+15).toFixed(3)}" y="${y+29}" class="number">${format(value)} B</text>`;
const source=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="650" viewBox="0 0 1080 650" role="img" aria-labelledby="title description">
<title id="title">Cold connection delivery overhead</title>
<desc id="description">Matched nginx test setups: stock 5,421 bytes and optimized 4,432 bytes, a difference of 989 bytes. A separate archived Cloudflare control measured 6,203 bytes. An October 26 live median of three measured 5,252 bytes with a different certificate. TLS bytes through the first complete HTTP/2 page response, less the entire encoded body; excludes TCP/IP, DNS and connection close.</desc>
<style>text{font-family:Arial,Helvetica,sans-serif}.title{font-size:32px;font-weight:700;fill:#142b3f}.subtitle{font-size:19px;fill:#465a68}.section{font-size:18px;font-weight:700;fill:#465a68;letter-spacing:.04em}.label{font-size:22px;font-weight:700;fill:#142b3f}.detail{font-size:17px;fill:#526773}.number{font-size:22px;font-weight:700;fill:#142b3f}</style>
<rect width="1080" height="650" rx="20" fill="#f7faf9"/>
<text x="48" y="56" class="title">Cold connection delivery overhead</text>
<text x="48" y="86" class="subtitle">TLS bytes through first complete HTTP/2 response, minus the encoded page body</text>
<text x="48" y="144" class="section">MATCHED NGINX TEST SETUPS</text>
<text x="48" y="174" class="detail">Same test certificate chain · median of 3</text>
<text x="48" y="234" class="label">Stock nginx</text>
${bar(values[0],205,'#5bada7')}
<text x="48" y="302" class="label">Optimized nginx</text>
${bar(values[1],273,'#087f7d')}
<rect x="310" y="332" width="530" height="32" rx="16" fill="#e3f1ef"/>
<text x="326" y="354" class="detail">${format(values[0]-values[1])} B fewer in this fixture; results vary by setup</text>
<path d="M48 391H1032" stroke="#d3dfdc"/>
<text x="48" y="428" class="section">SEPARATE ARCHIVED CONTROL</text>
<text x="48" y="461" class="label">Cloudflare</text>
<text x="48" y="484" class="detail">Temporary route · 2026</text>
${bar(values[2],434,'#8396a2')}
<text x="48" y="543" class="subtitle">October 26 live median of 3: ${format(liveMedian)} B, measured with a different certificate.</text>
<text x="48" y="573" class="detail">The archived control and live result are not matched with the nginx test setups.</text>
<text x="48" y="607" class="detail">Excludes TCP/IP, DNS and connection-close traffic.</text>
</svg>`;
writeFileSync(resolve(dir,'delivery-overhead.svg'),source);
await sharp(Buffer.from(source)).png().toFile(resolve(dir,'delivery-overhead.png'));
console.log(JSON.stringify({values,width:1080,height:650,scale:'620/6500',matchedFixtureDifference:values[0]-values[1]}));
