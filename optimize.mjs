// Search equivalent serializations of this page; never overwrite index.html.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const source=readFileSync('index.html','utf8');
const css=source.match(/<html style="([^"]*)">/)[1];
const heading=source.match(/<h1 style=font-size:([^ >]+)>/)[1];
const body=source.slice(source.indexOf('<h1'));
const head=source.slice(0,source.indexOf('<h1'));
const comments=head.match(/<!--[\s\S]*?-->/g)||[];
const title=head.match(/<title>.*?<\/title>/s)[0];
const meta=head.match(/<meta[^>]+>/)[0];
const icon=head.match(/<link[^>]+>/)[0];
const currentParams=JSON.parse(readFileSync('build-report.json','utf8')).brotliParams;
const score=html=>Math.min(...[currentParams,...[0,1,2].map(mode=>({[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:16}))].map(params=>brotliCompressSync(Buffer.from(html),{params}).length));
let rng=129811;
const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
function shuffle(values){
 const a=[...values];
 for(let i=a.length-1;i;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
 return a;
}
let best=source,bytes=score(source);
const attempts=16000;
for(let i=0;i<attempts;i++){
 let style=css;
 for(const [a,b] of [['padding:1em','padding:18px'],['margin:auto','margin:0 auto'],['max-width:30em','max-width:540px']])if(random()<.5)style=style.includes(a)?style.replaceAll(a,b):style.replaceAll(b,a);
 style=shuffle(style.split(';').filter(Boolean)).join(';')+(random()<.5?';':'');
 const size=['1.5em','150%','27px'][Math.floor(random()*3)];
 const tail=body.replace('font-size:'+heading,'font-size:'+size);
 let html=(random()<.5?'<!doctype html>':'<!DOCTYPE html>')+'<html style="'+style+'">'+shuffle([meta,icon,title,...comments]).join('')+tail;
 if(random()<.5)html=html.replace(/(href|name|content|rel)="([^"\s]+)"/g,'$1=$2');
 const n=score(html);
 if(n<bytes||n===bytes&&html.length<best.length){best=html;bytes=n;}
}
mkdirSync('optimization',{recursive:true});
const report={attempts,baseline:{html:Buffer.byteLength(source),brotli:score(source)},best:{html:Buffer.byteLength(best),brotli:bytes}};
writeFileSync('optimization/candidate.html',best);
writeFileSync('optimization/search.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
