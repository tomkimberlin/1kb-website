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
const out=['<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="880" viewBox="0 0 1080 880" role="img" aria-labelledby="title description"><title id="title">Cold-connection TLS overhead</title><desc id="description">Archived Cloudflare test: 6,203 bytes. Matched nginx tests using the same certificate chain: stock 5,421 bytes and optimized 4,432 bytes. TLS bytes through the first complete HTTP/2 page response minus the entire encoded body; excludes TCP/IP, DNS and connection close. Cloudflare is a separate, unmatched historical control.</desc><style>text{font-family:Arial,Helvetica,sans-serif}</style><rect width="1080" height="880" fill="white"/>'];
const baseline=690,scale=550/6500;
const bars=[
 {x:137,value:values[0],label:['Cloudflare','archived test'],color:'#6c7f90'},
 {x:439,value:values[1],label:['Stock nginx','matched test'],color:'#34817d'},
 {x:741,value:values[2],label:['Optimized nginx','matched test'],color:'#086b69'},
];
for(const b of bars){
 const h=b.value*scale,top=baseline-h,cx=b.x+100;
 out.push(`<text x="${cx}" y="${(top-32).toFixed(3)}" text-anchor="middle" font-size="48" font-weight="700" fill="#172b40">${b.value.toLocaleString('en-US')} B</text>`);
 out.push(`<rect data-value="${b.value}" data-baseline="0" x="${b.x}" y="${top.toFixed(3)}" width="200" height="${h.toFixed(3)}" fill="${b.color}"/>`);
 b.label.forEach((line,i)=>out.push(`<text x="${cx}" y="${765+i*44}" text-anchor="middle" font-size="36" font-weight="${i?400:600}" fill="#172b40">${line}</text>`));
}
out.push('</svg>');
const source=out.join('\n');
writeFileSync(resolve(dir,'delivery-overhead.svg'),source);
await sharp(Buffer.from(source)).png().toFile(resolve(dir,'delivery-overhead.png'));
console.log(JSON.stringify({values,width:1080,height:880,scale:'550/6500'}));
