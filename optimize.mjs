import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliCompressSync,gzipSync,constants as c} from 'node:zlib';
const original=execFileSync('git',['show','715f2de:index.html'],{encoding:'utf8'});
const perm=a=>a.length?a.flatMap((x,i)=>perm(a.filter((_,j)=>i!==j)).map(p=>[x,...p])):[[]];
let best, count=0;
const candidates=[];
for(const close of ['', '</a>']) for(const href of ['https://github.com/tomkimberlin', '//github.com/tomkimberlin', 'g']) for(const doctype of ['<!doctype html>','<!DOCTYPE html>','<!doctypehtml>']) for(const brace of [true,false]) for(const quotes of [true,false]) {
 const css=['color-scheme:dark','font:5vmin monospace','padding:1em'];
 for(const declarations of perm(css)) for(const order of [0,1]) for(const initial of ['',',initial-scale=1']) {
  const body=`Hi, I'm Tom! <a href=${href}>GitHub${close}`;
  const rules=[`html{${declarations.join(';')}}`,'a{color:#fff}'];
  if(order) rules.reverse();
  if(!brace)rules[rules.length-1]=rules.at(-1).slice(0,-1);
  const heads=['<title>Tom Kimberlin</title>','<link rel=icon href=data:,>',`<meta name=viewport content=${quotes?'"':''}width=device-width${initial}${quotes?'"':''}>`,`<style>${rules.join('')}</style>`];
  for(const head of perm(heads)) {
   const html=doctype+head.join('')+body;
   const data=Buffer.from(html);
   const br=brotliCompressSync(data,{params:{[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_MODE]:c.BROTLI_MODE_TEXT,[c.BROTLI_PARAM_SIZE_HINT]:data.length}});
   const candidate={html,bytes:data.length,br:br.length,initial,close,href,doctype,brace,quotes};
   candidates.push(candidate); count++;
   if(!best||candidate.br<best.br||candidate.br===best.br&&candidate.bytes<best.bytes)best=candidate;
  }
 }
}
candidates.sort((a,b)=>a.br-b.br||a.bytes-b.bytes);
const baseline=Buffer.from(original);
const report={count,baseline:{bytes:baseline.length,brotli:brotliCompressSync(baseline,{params:{[c.BROTLI_PARAM_QUALITY]:11}}).length,gzip:gzipSync(baseline,{level:9}).length},best,top:candidates.slice(0,20)};
mkdirSync('optimization',{recursive:true});
writeFileSync('optimization/search.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('optimization/candidate.html',best.html);
console.log(JSON.stringify({count,baseline:report.baseline,best},null,2));
