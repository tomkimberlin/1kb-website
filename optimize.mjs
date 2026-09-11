// Measure equivalent serializations of the current page. Never overwrite it.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {brotliCompressSync,constants as c} from 'node:zlib';
const source=readFileSync('index.html','utf8');
const perm=a=>a.length?a.flatMap((x,i)=>perm(a.filter((_,j)=>i!==j)).map(p=>[x,...p])):[[]];
const title=source.match(/<title>.*?<\/title>/s)[0];
const style=source.match(/<style>(.*?)<\/style>/s)[1];
const linkRule=style.match(/a\{[^}]*(?:}|$)/)?.[0];
const declarations=style.match(/html\{([^}]+)/)[1].split(';').filter(Boolean);
const body=source.replace(/^\ufeff/,'').replace(/<!doctype\s*html>/i,'').replace(/<style>.*?<\/style>|<title>.*?<\/title>|<link[^>]*>|<meta[^>]*>/gs,'');
const encodings=/[^\x00-\x7f]/.test(body+title+style)?['\ufeff','<meta charset=utf-8>']:['','\ufeff','<meta charset=utf-8>'];
const score=html=>brotliCompressSync(Buffer.from(html),{params:{[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_LGWIN]:16}}).length;
const top=[];let count=0;
function consider(html) {
 const candidate={html,bytes:Buffer.byteLength(html),br:score(html)};count++;
 top.push(candidate);top.sort((a,b)=>a.br-b.br||a.bytes-b.bytes);if(top.length>40)top.length=40;
}
consider(source);
for(const ds of perm(declarations))for(const reverse of [false,true])for(const brace of [true,false])for(const quote of ['', '"'])for(const doctype of ['<!doctype html>','<!DOCTYPE html>']) {
 const rules=[`html{${ds.join(';')}}`];if(linkRule)rules.push(linkRule.endsWith('}')?linkRule:linkRule+'}');if(reverse)rules.reverse();if(!brace)rules[rules.length-1]=rules.at(-1).slice(0,-1);
 const heads=[title,'<link rel=icon href=data:,>',`<meta name=viewport content=${quote}width=device-width${quote}>`,`<style>${rules.join('')}</style>`];
 for(const order of perm(heads))for(const encoding of encodings)consider((encoding==='\ufeff'?encoding:'')+doctype+(encoding==='\ufeff'?'':encoding)+order.join('')+body);
}
// Starting with the best serializations, compare redirect and direct link targets.
const heads=[...top];
const destinations={g:'https://github.com/tomkimberlin',p:'https://paste.kimberlin.net/',k:'https://1kb.club/',x:'https://xmr.surf/'};
for(const seed of heads) {
 let variants=[seed.html];
 for(const [path,url] of Object.entries(destinations)) {
  const attribute=new RegExp(`href=(?:${path}(?=[ >])|"${path}")`);
  if(attribute.test(seed.html))variants=variants.flatMap(html=>[path,url,url.slice(6)].map(target=>html.replace(attribute,'href='+target)));
 }
 for(const html of variants)for(const close of ['', '</a>'])consider(html.replace(/<\/a>$/,'')+close);
}
mkdirSync('optimization',{recursive:true});
const report={count,baseline:{bytes:Buffer.byteLength(source),brotli:score(source)},best:top[0],top};
writeFileSync('optimization/search.json',JSON.stringify(report,null,2)+'\n');writeFileSync('optimization/candidate.html',top[0].html);
console.log(JSON.stringify({count,baseline:report.baseline,best:report.best},null,2));
