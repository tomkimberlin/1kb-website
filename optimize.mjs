// Search equivalent serializations; candidates stay separate from the page source.
import {readFileSync, writeFileSync, mkdirSync, existsSync, statSync, lstatSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliCompressSync, brotliDecompressSync, gzipSync, constants as c} from 'node:zlib';

const options = {attempts:16000, seed:129811, input:'index.html', output:'optimization'};
const numeric = new Set(['attempts', 'seed', 'gzip-limit']);
// WHATWG HTML syntax: these characters require quoted attribute values.
const unquotedForbidden=/[\t\n\f\r "'`=<>]/;
for(let i=2; i<process.argv.length; i++) {
 const name = process.argv[i].replace(/^--/, '');
 if(process.argv[i] === '--help') {
  console.log('node optimize.mjs [--attempts N] [--seed N] [--input FILE] [--output DIR] [--gzip-limit BYTES]');
  console.log('The gzip limit defaults to the source size with Node gzip. Output never replaces the input.');
  process.exit(0);
 }
 if(!process.argv[i].startsWith('--') || ![...Object.keys(options),'gzip-limit'].includes(name) || process.argv[i+1] === undefined)
  throw Error('Unknown or incomplete option: '+process.argv[i]);
 const value = process.argv[++i];
 if(numeric.has(name) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))))
  throw Error('Expected a nonnegative integer for --'+name);
 options[name] = numeric.has(name) ? Number(value) : value;
}
if(options.seed > 0xffffffff) throw Error('--seed must fit in an unsigned 32-bit integer');
const sourceBytes=readFileSync(options.input);
try {new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);}
catch(error) {throw Error('Source must be valid UTF-8',{cause:error});}
// Keep compact HTTP/1–2 headers safe and JS whitespace identical to HTML whitespace.
if(sourceBytes.some(byte=>byte>0x7f))
 throw Error('HTML source must be ASCII; use character references for Unicode text');
if(sourceBytes.some(byte=>byte===0x7f || byte<0x20 && ![9,10,12,13].includes(byte)))
 throw Error('HTML source must not contain non-HTML control characters');
const source=sourceBytes.toString('utf8');
const doctype=source.match(/<!doctype html>/i);
if(!doctype) throw Error('Expected an HTML5 doctype to preserve standards mode');
const protectedPaths=[options.input,fileURLToPath(import.meta.url),
 'server/site.js','build-report.json','compression/index.html.br'];
for(const name of ['candidate.html','search.json','shortlist.json']) {
 const path=resolve(options.output,name);
 let output;
 try {output=lstatSync(path);} catch(error) {if(error.code!=='ENOENT')throw error;}
 if(output?.isSymbolicLink())throw Error('Output must not overwrite the input or another file through a symbolic link: '+path);
 if(output && !output.isFile())throw Error('Output must be a regular file: '+path);
 for(const input of protectedPaths) {
  const prior=existsSync(input) ? statSync(input) : null;
  if(resolve(input)===path || output && prior && output.dev===prior.dev && output.ino===prior.ino)
   throw Error('Output must not overwrite the input, a serializer dependency or another output: '+path);
 }
 protectedPaths.push(path);
}

// This optimizer targets the site's existing five declarations and inline heading.
// Fail clearly when the page changes instead of silently discarding new content.
const css = source.match(/<html style=(?:"([^"]*)"|'([^']*)')>/)?.slice(1).find(Boolean);
const heading = source.match(/<h1 style=(?:"font-size:([^"]+)"|'font-size:([^']+)'|font-size:([^ >]+))>([\s\S]*?)<\/h1>/);
if(!css || !heading) throw Error('Expected the page root style and inline h1 font size');
if(heading[4].includes('<')) throw Error('Unsupported markup inside the heading');
const headingSizes=['1.5em','150%','27px','1.5rem'];
if(!headingSizes.includes(heading.slice(1,4).find(Boolean)))
 throw Error('The heading font size changed; review the equivalent sizes before searching');
const cssOptions = [
 ['padding:18px','padding:1em','padding:1rem'],
 ['font:18px/1.5 sans-serif','font:18px/1.50 sans-serif'],
 ['max-width:540px','max-width:30em','max-width:30rem'],
 ['margin:auto','margin:0 auto'],
 ['color-scheme:light dark']
];
const declarations = css.split(';').filter(Boolean);
if(declarations.length !== cssOptions.length || cssOptions.some(values=>!declarations.some(value=>values.includes(value))))
 throw Error('The root CSS changed; review the equivalent declaration choices before searching');
const head = source.slice(0, heading.index);
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0];
const comments = head.match(/<!--[\s\S]*?-->/g) || [];
const metas = head.match(/<meta[^>]*>/g) || [];
const icons = head.match(/<link[^>]*>/g) || [];
function attributes(tag) {
 const pattern=/\s+([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
 const pairs=[...tag.matchAll(pattern)];
 if(pairs.some(([,key,a,b,d])=>d !== undefined && unquotedForbidden.test(d)))
  throw Error('Invalid unquoted metadata attribute');
 const values=Object.fromEntries(pairs.map(([,key,a,b,d])=>[key,a??b??d]));
 if(tag.replace(/^<\w+/,'').replace(/>$/,'').replace(pattern,'').trim() || Object.keys(values).length !== pairs.length)
  throw Error('Unrecognized or repeated metadata attributes');
 return values;
}
const meta=metas.length === 1 ? attributes(metas[0]) : {};
const icon=icons.length === 1 ? attributes(icons[0]) : {};
if(!title || comments.length !== 1 || metas.length !== 1 || icons.length !== 1 ||
 Object.keys(meta).length !== 2 || meta.content !== 'width=device-width' || meta.name !== 'viewport' ||
 Object.keys(icon).length !== 2 || icon.rel !== 'icon' || icon.href !== 'data:,')
 throw Error('The page metadata changed; review the serializer before searching');
const remainingHead=head.replace(/<!doctype html>/i,'').replace(/<html style=(?:"[^"]*"|'[^']*')>/,'')
 .replace(title,'').replace(metas[0],'').replace(icons[0],'').replace(comments[0],'')
 .replace(/<\/?head>|<body>/g,'').trim();
if(remainingHead) throw Error('Unrecognized head content; update the serializer before searching');
const tail = source.slice(heading.index+heading[0].length);
const paragraphMatches=[...tail.matchAll(/<p>[\s\S]*?(?=\s*<p>|$)/g)];
const paragraphs = paragraphMatches.map(match=>match[0].trimEnd().replace(/<\/p>$/, ''));
if(!paragraphs || paragraphs.length !== 5 || tail.includes('<!--') || tail.replace(/<p>[\s\S]*/, '').trim())
 throw Error('Expected the five existing paragraphs after the heading');
const normalized = paragraphs.map(p=>p.replace(/<a href=(?:"([a-z])"|'([a-z])'|([a-z]))>/g, (_,a,b,d)=>'<a href='+(a||b||d)+'>'));
if(normalized.join('').match(/<a href=[a-z]>/g)?.length !== 9)
 throw Error('Expected nine one-character links');
for(const paragraph of normalized) {
 let open=false;
 const text=paragraph.slice(3).replace(/<a href=[a-z]>|<\/a>/g,tag=>{
  const starts=tag !== '</a>';
  if(starts === open) throw Error('Unsupported or unbalanced anchor markup');
  open=starts;
  return '';
 });
 if(open || text.includes('<')) throw Error('Unsupported or unbalanced paragraph markup');
}

let rng = options.seed;
const random = ()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
const pick = values=>values[Math.floor(random()*values.length)];
function shuffle(values) {
 const copy=[...values];
 for(let i=copy.length-1;i;i--) {const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
 return copy;
}
const whitespace = ['', ' ', '\n'];
const quotes = ['', "'", '"'];
const attributeQuotes=tag=>[...tag.matchAll(/\s+([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
 .map(([,name,a,b])=>({name,quote:a !== undefined ? '"' : b !== undefined ? "'" : ''}));
const metaAttributes=attributeQuotes(metas[0]), iconAttributes=attributeQuotes(icons[0]);
const rootTag=source.match(/<html style=(?:"[^"]*"|'[^']*')>/);
const headParts=[title,metas[0],icons[0],comments[0]];
const headOrder=[0,1,2,3].sort((a,b)=>head.indexOf(headParts[a])-head.indexOf(headParts[b]));
const headWs=headOrder.map((part,i)=>head.slice(i ? head.indexOf(headParts[headOrder[i-1]])+headParts[headOrder[i-1]].length : rootTag.index+rootTag[0].length,head.indexOf(headParts[part])).replace('<head>',''));
const lastHeadPart=headParts[headOrder.at(-1)];
const headStructure=headParts.reduce((markup,part)=>markup.replace(part,''),head);
const anchorAttributes=[...paragraphs.join('').matchAll(/<a href=(?:"([a-z])"|'([a-z])'|([a-z]))>/g)];
const boundaryWs=paragraphMatches.map((match,i)=>tail.slice(i ? paragraphMatches[i-1].index+paragraphMatches[i-1][0].length : 0,match.index));
boundaryWs.push(paragraphMatches.at(-1)[0].match(/\s*$/)[0]);
const base = {
 css:cssOptions.map(values=>declarations.find(value=>values.includes(value))),
 order:declarations.map(value=>cssOptions.findIndex(values=>values.includes(value))),
 semicolon:css.endsWith(';'), heading:heading.slice(1,4).find(Boolean),
 rootQuote:rootTag[0].includes('style="') ? '"' : "'",
 headingQuote:heading[1] !== undefined ? '"' : heading[2] !== undefined ? "'" : '',
 headOrder,headWs,doctype:doctype[0],
 doctypeWs:source.slice(doctype.index+doctype[0].length,rootTag.index),
 metaOrder:metaAttributes.map(({name})=>['content','name'].indexOf(name)),
 metaQuotes:['content','name'].map(name=>metaAttributes.find(attribute=>attribute.name===name).quote),
 iconOrder:iconAttributes.map(({name})=>['rel','href'].indexOf(name)),
 iconQuotes:['rel','href'].map(name=>iconAttributes.find(attribute=>attribute.name===name).quote),
 pClose:paragraphMatches.map(match=>match[0].trimEnd().endsWith('</p>')),
 boundaryWs,hrefQuotes:anchorAttributes.map(([,a,b])=>a !== undefined ? '"' : b !== undefined ? "'" : ''),
 entity:tail.match(/&#8217;|&#x2019;|&rsquo;|&CloseCurlyQuote;/)?.[0] || '&#8217;',
 aliases:[['w','e'],['b','g'],['a','s'],['k','o']].map(group=>anchorAttributes.map(([,a,b,d])=>a||b||d).find(href=>group.includes(href)) || group[0]),
 bodyTag:headStructure.includes('<body>'),headTag:headStructure.includes('<head>'),
 beforeHeading:head.slice(head.indexOf(lastHeadPart)+lastHeadPart.length).replace('</head>','').replace('<body>','')
};
// Only substitute a short path when the current server maps both aliases equally.
const redirects=existsSync('server/site.js') ? Object.fromEntries(
 [...readFileSync('server/site.js','utf8').matchAll(/'\/([a-z])':'([^']*)'/g)].map(([,path,destination])=>[path,destination])) : {};
const aliasGroups=[['w','e'],['b','g'],['a','s'],['k','o']];
const aliasChoices=aliasGroups.map(group=>redirects[group[0]] && redirects[group[0]] === redirects[group[1]] ? group : null);
const aliases=Object.fromEntries(aliasChoices.flatMap((group,i)=>group ? group.map(path=>[path,i]) : []));
const quoted = (value,quote)=>{
 if(!quote && (!value || unquotedForbidden.test(value))) quote='"';
 return quote+value+quote;
};
const tag = (name,attrs,order,quote)=>'<'+name+' '+order.map(i=>attrs[i][0]+'='+quoted(attrs[i][1],quote[i])).join(' ')+'>';
function render(state) {
 const style=state.order.map(i=>state.css[i]).join(';')+(state.semicolon?';':'');
 const parts=[title,
  tag('meta',[['content','width=device-width'],['name','viewport']],state.metaOrder,state.metaQuotes),
  tag('link',[['rel','icon'],['href','data:,']],state.iconOrder,state.iconQuotes),comments[0]];
 let html=state.doctype+state.doctypeWs+'<html style='+quoted(style,state.rootQuote)+'>';
 if(state.headTag) html+='<head>';
 html+=state.headOrder.map((value,i)=>state.headWs[i]+parts[value]).join('');
 if(state.headTag) html+='</head>';
 if(state.bodyTag) html+='<body>';
 html+=state.beforeHeading+'<h1 style='+quoted('font-size:'+state.heading,state.headingQuote)+'>'+heading[4]+'</h1>';
 let anchor=0;
 html+=normalized.map((p,i)=>{
  // Keep entities ASCII: HTTP/1 and HTTP/2 omit a charset declaration. Restrict
  // these substitutions to paragraphs, preserving title and comment literally.
  p=p.replace(/&#8217;|&#x2019;|&rsquo;|&CloseCurlyQuote;/,state.entity);
  p=p.replace(/<a href=([a-z])>/g,(_,href)=>'<a href='+quoted(aliases[href] === undefined ? href : state.aliases[aliases[href]],state.hrefQuotes[anchor++])+'>');
  return state.boundaryWs[i]+p+(state.pClose[i]?'</p>':'');
 }).join('')+state.boundaryWs[5];
 return html;
}
function mutate(input,count) {
 const state=structuredClone(input);
 for(let i=0;i<count;i++) switch(Math.floor(random()*18)) {
 case 0: {const k=Math.floor(random()*5);state.css[k]=pick(cssOptions[k]);break;}
 case 1: state.order=shuffle(state.order);break;
 case 2: state.semicolon=!state.semicolon;break;
 case 3: state.heading=pick(headingSizes);break;
 case 4: state.rootQuote=pick(['"',"'"]);state.headingQuote=pick(quotes);break;
 case 5: state.headOrder=shuffle(state.headOrder);break;
 case 6: state.headWs[Math.floor(random()*4)]=pick(whitespace);break;
 case 7: state.doctype=pick(['<!DOCTYPE html>','<!doctype html>','<!DOCTYPE HTML>']);state.doctypeWs=pick(whitespace);break;
 case 8: state.metaOrder=shuffle(state.metaOrder);state.metaQuotes=[pick(quotes),pick(quotes)];break;
 case 9: state.iconOrder=shuffle(state.iconOrder);state.iconQuotes=[pick(quotes),pick(quotes)];break;
 case 10: {const k=Math.floor(random()*5);state.pClose[k]=!state.pClose[k];break;}
 case 11: state.boundaryWs[Math.floor(random()*6)]=pick(whitespace);break;
 case 12: state.hrefQuotes[Math.floor(random()*9)]=pick(quotes);break;
 case 13: state.entity=pick(['&#8217;','&#x2019;','&rsquo;','&CloseCurlyQuote;']);break;
 case 14: {const k=Math.floor(random()*4);if(aliasChoices[k]) state.aliases[k]=pick(aliasChoices[k]);break;}
 case 15: state.bodyTag=!state.bodyTag;break;
 case 16: state.headTag=!state.headTag;break;
 case 17: state.hrefQuotes.fill(pick(quotes));break;
 }
 return state;
}

const defaults=[0,1].flatMap(mode=>[
 {[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:16},
 {[c.BROTLI_PARAM_QUALITY]:11,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:16,[c.BROTLI_PARAM_NPOSTFIX]:3,[c.BROTLI_PARAM_NDIRECT]:8}
]);
const previous=existsSync('build-report.json') ? JSON.parse(readFileSync('build-report.json','utf8')).brotliParams : null;
// A saved candidate has no stock encoder settings; score explicit settings only.
const paramsList=previous && typeof previous === 'object' ? [previous,...defaults] : defaults;
function score(html) {
 const data=Buffer.from(html);
 let brotli=Infinity, params;
 for(const candidate of paramsList) {
  const bytes=brotliCompressSync(data,{params:candidate}).length;
  if(bytes<brotli) {brotli=bytes;params=candidate;}
 }
 return {html:html,brotli,params,raw:data.length,gzip:gzipSync(data,{level:9}).length};
}
const baseline=score(source);
const gzipLimit=options['gzip-limit'] ?? baseline.gzip;
const saved='compression/index.html.br';
let installedBrotli=null;
if(existsSync(saved)) {
 const data=readFileSync(saved);
 try {
  const decoded=brotliDecompressSync(data,{info:true});
  if(decoded.engine.bytesWritten === data.length && decoded.buffer.equals(sourceBytes)) installedBrotli=data.length;
 } catch {}
}
const compare=(a,b)=>a.brotli-b.brotli || a.gzip-b.gzip || a.raw-b.raw;
let best=baseline.gzip <= gzipLimit ? {...baseline} : null;
let population=[{...score(render(base)),state:base}];
const seen=new Set([source]);
let measured=0, rejectedGzip=0;
for(let i=0;i<options.attempts;i++) {
 const parent=i<1000 ? base : pick(population).state;
 const state=mutate(parent,i<1000 ? 8 : pick([1,1,1,2,2,3,5,8]));
 const html=render(state);
 if(seen.has(html)) continue;
 seen.add(html);
 const candidate={...score(html),state};
 measured++;
 if(candidate.gzip>gzipLimit) {rejectedGzip++;continue;}
 if(!best || compare(candidate,best)<0) best=candidate;
 if(population.length<64 || compare(candidate,population.at(-1))<0) {
  population.push(candidate);population.sort(compare);population=population.slice(0,64);
 }
}
// A known exact precompression can beat the stock search on another serialization.
if(installedBrotli !== null && baseline.gzip <= gzipLimit && (!best || installedBrotli < best.brotli))
 best={...baseline,brotli:installedBrotli,params:null};
if(!best) throw Error('No candidate meets the requested gzip limit of '+gzipLimit+' bytes');
const report={seed:options.seed,attempts:options.attempts,measured,rejectedGzip,gzipLimit,
 source:options.input,sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),
 optimizerSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
 runtime:{node:process.versions.node,brotli:process.versions.brotli,zlib:process.versions.zlib},sourceSeeded:render(base)===source,
 baseline:{html:baseline.raw,brotli:baseline.brotli,installedBrotli,gzip:baseline.gzip},
 best:{html:best.raw,brotli:best.brotli,gzip:best.gzip,brotliParams:best.params,brotliSource:best.params ? 'node:zlib' : saved},
 note:'Brotli uses the listed stock settings or exact saved candidate; gzip uses Node level 9. Check custom Brotli/gzip and browser equivalence before adoption.'};
mkdirSync(options.output,{recursive:true});
writeFileSync(join(options.output,'candidate.html'),best.html);
writeFileSync(join(options.output,'search.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(options.output,'shortlist.json'),JSON.stringify(population.map(({state,...candidate})=>candidate),null,2)+'\n');
console.log(report);
