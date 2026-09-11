// Refine the best initial candidates for compressed size, not just source length.
import fs from 'node:fs';
import zlib from 'node:zlib';
const {constants:c}=zlib;
const compress=s=>zlib.brotliCompressSync(Buffer.from(s),{params:{[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_LGWIN]:10}}).length;
let seeds=JSON.parse(fs.readFileSync('optimization/search.json')).top.map(x=>x.html),tested=0;
const mutations=[
 s=>s.replace('rel=icon href=data:,','href=data:, rel=icon'),
 s=>s.replace('name=viewport content=width=device-width','content=width=device-width name=viewport'),
 s=>s.replace('name=viewport','name="viewport"'),
 s=>s.replace('href=g','href="g"'),
 s=>s.replace('color-scheme:dark','color-scheme:dark;'),
 s=>s.replace('html{','HTML{')
];
const seen=new Set(seeds);
for(let round=0;round<5;round++){
 const next=[];
 for(const seed of seeds) for(const mutate of mutations){
  const s=mutate(seed);
  if(!seen.has(s)){seen.add(s);next.push(s);tested++;}
 }
 seeds=[...seeds,...next].sort((a,b)=>compress(a)-compress(b)||a.length-b.length).slice(0,40);
}
const best=seeds[0],report={tested,html:Buffer.byteLength(best),brotli:compress(best),best,top:seeds};
fs.writeFileSync('optimization/refined.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('optimization/candidate.html',best);
console.log({tested,html:report.html,brotli:report.brotli,best});
