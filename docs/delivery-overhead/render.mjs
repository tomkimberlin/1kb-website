import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE || 'sharp');
const dir=resolve(process.argv[2]||fileURLToPath(new URL('.',import.meta.url)));
const data=JSON.parse(readFileSync(resolve(dir,'history-data.json'),'utf8'));
const reference=JSON.parse(readFileSync(resolve(dir,'default-reference-20261026.json'),'utf8'));
const values=[data.points[0].extra_bytes,reference.arms['stock-identity'].median,reference.arms.optimized.median];
if(values.join(',')!=='6203,5421,4432')throw new Error('Unexpected chart values');
const out=['<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="880" viewBox="0 0 1080 880" role="img" aria-labelledby="title description"><title id="title">Cold-connection TLS overhead</title><desc id="description">Archived Cloudflare test: 6,203 bytes. Matched nginx tests using the same certificate chain: stock 5,421 bytes and optimized 4,432 bytes. TLS bytes through the first complete HTTP/2 page response minus the entire encoded body; excludes TCP/IP, DNS and connection close. Cloudflare is a separate, unmatched historical control.</desc><style>text{font-family:Arial,Helvetica,sans-serif;fill:#6c787e}rect{fill:#34817d}#gh-light-mode-only:target~text{fill:#172b40}#gh-dark-mode-only:target~text{fill:#e6edf3}#gh-dark-mode-only:target~rect{fill:#5bada7}</style><g id="gh-light-mode-only"/><g id="gh-dark-mode-only"/>'];
const baseline=690,scale=550/6500;
const bars=[
 {x:137,value:values[0],label:'Cloudflare'},
 {x:439,value:values[1],label:'Stock nginx'},
 {x:741,value:values[2],label:'Optimized nginx'},
];
for(const b of bars){
 const h=b.value*scale,top=baseline-h,cx=b.x+100;
 out.push(`<text x="${cx}" y="${(top-32).toFixed(3)}" text-anchor="middle" font-size="48" font-weight="700">${b.value.toLocaleString('en-US')} B</text>`);
 out.push(`<rect data-value="${b.value}" data-baseline="0" x="${b.x}" y="${top.toFixed(3)}" width="200" height="${h.toFixed(3)}"/>`);
 out.push(`<text x="${cx}" y="765" text-anchor="middle" font-size="36" font-weight="600">${b.label}</text>`);
}
out.push('</svg>');
const source=out.join('\n');
writeFileSync(resolve(dir,'delivery-overhead.svg'),source);
await sharp(Buffer.from(source)).png().toFile(resolve(dir,'delivery-overhead.png'));
console.log(JSON.stringify({values,width:1080,height:880,scale:'550/6500'}));
