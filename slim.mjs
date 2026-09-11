// Compare equivalent character references and safe removal of encoding markers.
// Candidates are measured only; this script never replaces index.html.
import fs from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const input=JSON.parse(fs.readFileSync('optimization/tuned.json'));
const seeds=[fs.readFileSync('index.html','utf8'),...input.results.map(x=>x.html)];
const candidates=new Set();
for(const seed of seeds)for(const dot of ['·','&middot;','&middot','&#183;','&#183','&#xb7;','&#xb7'])for(const less of ['<1','&lt;1','&lt1','&#60;1']){
 const normalized=seed.replace(/&#183;?(?=\s|<|$)|&middot;?(?=\s|<|$)|&#x[bB]7;?(?=\s|<|$)/g,'·').replace(/&lt;?1|&#60;1/g,'<1');
 const text=normalized.replace(/·/g,dot).replace(/<1/g,less);
 if(/^[\x00-\x7f]*$/.test(text)||text.startsWith('\ufeff')||text.includes('<meta charset=utf-8>'))candidates.add(text);
 else candidates.add('\ufeff'+text);
 const bare=text.replace(/^\ufeff/,'').replace(/<meta charset=utf-8>/,'');
 if(/^[\x00-\x7f]*$/.test(bare))candidates.add(bare);
}
function size(html,full=false){
 const bytes=Buffer.from(html);let best=Infinity;
 for(const quality of (full?[9,10,11]:[11]))for(let mode=0;mode<=2;mode++)for(const window of (full?[10,12,16,20,24]:[16]))for(const hint of (full?[0,bytes.length]:[0])){
  const params={[c.BROTLI_PARAM_QUALITY]:quality,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:window,[c.BROTLI_PARAM_SIZE_HINT]:hint};
  best=Math.min(best,brotliCompressSync(bytes,{params}).length);
 }
 return best;
}
const ranked=[...candidates].map(html=>({html,bytes:Buffer.byteLength(html),brotli:size(html)})).sort((a,b)=>a.brotli-b.brotli||a.bytes-b.bytes);
const finalists=ranked.slice(0,40).map(x=>({...x,brotli:size(x.html,true)})).sort((a,b)=>a.brotli-b.brotli||a.bytes-b.bytes);
const report={candidates:candidates.size,finalists:finalists.length,best:finalists[0],results:finalists};
fs.writeFileSync('optimization/slim.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('optimization/candidate.html',report.best.html);
console.log({candidates:report.candidates,finalists:report.finalists,best:report.best});
