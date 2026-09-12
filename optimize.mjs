// Search equivalent serializations of this page; never overwrite index.html.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const source=readFileSync('index.html','utf8');
let css=source.match(/<style>(.*?)<\/style>/s)[1];
// CSS closes outstanding blocks at EOF. Restore them before shuffling leaves.
while((css.match(/\{/g)||[]).length>(css.match(/\}/g)||[]).length)css+='}';
const body=source.slice(source.indexOf('<h1'));
const title=source.match(/<title>.*?<\/title>/s)[0];
const meta=source.match(/<meta[^>]+>/)[0];
const icon=source.match(/<link[^>]+>/)[0];
const currentParams=JSON.parse(readFileSync('build-report.json','utf8')).brotliParams;
const score=html=>Math.min(...[currentParams,...[0,1,2].map(mode=>({[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:16}))].map(params=>brotliCompressSync(Buffer.from(html),{params}).length));
let rng=129811;
const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
function shuffle(values){
 const a=[...values];
 for(let i=a.length-1;i;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
 return a;
}
function rules(text){
 const result=[];let depth=0,start=0;
 for(let i=0;i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&!--depth){result.push(text.slice(start,i+1));start=i+1;}
 }
 return result;
}
let best=source,bytes=score(source);
const attempts=16000;
for(let i=0;i<attempts;i++){
 let style=css;
 // These alternatives preserve this page's values and selectors.
 for(const [a,b] of [["content:''",'content:""'],['#fff','white'],['font-size:2em','font-size:200%'],['1turn','360deg']])if(random()<.5)style=style.replaceAll(a,b);
 style=style.replace(/\{([^{}]+)\}/g,(_,declarations)=>'{'+shuffle(declarations.split(';').filter(Boolean)).join(';')+'}');
 // Current rules have no order-dependent declarations of equal specificity.
 style=shuffle(rules(style)).join('');
 if(random()<.5)style=style.replace(/}+$/,'');
 const html=(random()<.5?'<!doctype html>':'<!DOCTYPE html>')+shuffle([meta,icon,title,'<style>'+style+'</style>']).join('')+body;
 const n=score(html);
 if(n<bytes||n===bytes&&html.length<best.length){best=html;bytes=n;}
}
mkdirSync('optimization',{recursive:true});
const report={attempts,baseline:{html:Buffer.byteLength(source),brotli:score(source)},best:{html:Buffer.byteLength(best),brotli:bytes}};
writeFileSync('optimization/candidate.html',best);
writeFileSync('optimization/search.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
