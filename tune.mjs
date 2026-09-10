// Re-rank shortlisted source variants across the full Brotli parameter grid.
import fs from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const sources=[...new Set([
 fs.readFileSync('index.html','utf8'),
 ...JSON.parse(fs.readFileSync('optimization/search.json')).top.map(x=>x.html),
 ...JSON.parse(fs.readFileSync('optimization/refined.json')).top,
])];
let attempts=0;
const results=sources.map(html=>{
 const bytes=Buffer.from(html);let best=Infinity;
 for(let q=0;q<=11;q++)for(let mode=0;mode<=2;mode++)for(let window=10;window<=24;window++)for(const hint of [0,bytes.length]){
  const br=brotliCompressSync(bytes,{params:{[c.BROTLI_PARAM_QUALITY]:q,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:window,[c.BROTLI_PARAM_SIZE_HINT]:hint}});
  attempts++;best=Math.min(best,br.length);
 }
 return {html,bytes:bytes.length,brotli:best};
}).sort((a,b)=>a.brotli-b.brotli||a.bytes-b.bytes);
fs.writeFileSync('optimization/tuned.json',JSON.stringify({sources:sources.length,attempts,results},null,2)+'\n');
fs.writeFileSync('optimization/candidate.html',results[0].html);
console.log({sources:sources.length,attempts,best:results[0]});
