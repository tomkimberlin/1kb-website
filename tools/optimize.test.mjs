import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync,brotliCompressSync} from 'node:zlib';

const optimizer=readFileSync(new URL('../optimize.mjs',import.meta.url));
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(t,html=page) {
 const directory=mkdtempSync(join(tmpdir(),'onekb-serialization-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'optimize.mjs'),optimizer);
 writeFileSync(join(directory,'index.html'),html);
 // This is the actual build report shape when a saved Brotli candidate wins.
 writeFileSync(join(directory,'build-report.json'),JSON.stringify({brotliParams:null}));
 return directory;
}
function run(directory,...args) {
 return spawnSync(process.execPath,['optimize.mjs',...args],{cwd:directory,encoding:'utf8'});
}
const report=(directory,output='optimization')=>JSON.parse(readFileSync(join(directory,output,'search.json')));

test('zero attempts handles precompressed build parameters and preserves the source',t=>{
 const directory=fixture(t);
 const result=run(directory,'--attempts','0');
 assert.equal(result.status,0,result.stderr);
 assert.equal(readFileSync(join(directory,'optimization/candidate.html'),'utf8'),page);
 assert.equal(readFileSync(join(directory,'index.html'),'utf8'),page);
 assert.equal(report(directory).measured,0);
 assert.equal(report(directory).sourceSeeded,true);
 assert.equal(report(directory).best.gzip,gzipSync(Buffer.from(page),{level:9}).length);
});

test('the same seed and attempt count reproduce the candidate and measurements',t=>{
 const directory=fixture(t);
 for(const output of ['a','b']) {
  const result=run(directory,'--seed','42','--attempts','100','--output',output);
  assert.equal(result.status,0,result.stderr);
 }
 assert.deepEqual(readFileSync(join(directory,'a/candidate.html')),readFileSync(join(directory,'b/candidate.html')));
 assert.deepEqual(report(directory,'a'),report(directory,'b'));
 assert(report(directory,'a').measured>0);
 assert(report(directory,'a').best.gzip<=report(directory,'a').gzipLimit);
});

test('unknown head content and metadata attributes fail instead of disappearing',t=>{
 for(const changed of [
  page.replace('<title>','<script>window.siteChanged=true</script><title>'),
  page.replace('<meta ','<meta data-added=keep '),
  page.replace('<link ','<link disabled ')
 ]) {
  const directory=fixture(t,changed);
  const result=run(directory,'--attempts','0');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/metadata|head content/);
  assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),changed);
 }
});

test('an impossible explicit gzip bound does not emit an over-budget candidate',t=>{
 const directory=fixture(t);
 const result=run(directory,'--attempts','0','--gzip-limit','1');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/No candidate meets the requested gzip limit/);
 assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
});

test('an output path cannot overwrite the input',t=>{
 const directory=fixture(t);
 writeFileSync(join(directory,'candidate.html'),page);
 const result=run(directory,'--input','candidate.html','--output','.','--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/must not overwrite/);
 assert.equal(readFileSync(join(directory,'candidate.html'),'utf8'),page);
});


test('a symlink at the candidate path cannot overwrite the source',t=>{
 const directory=fixture(t);
 symlinkSync('index.html',join(directory,'candidate.html'));
 const result=run(directory,'--output','.','--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/must not overwrite/);
 assert.equal(readFileSync(join(directory,'index.html'),'utf8'),page);
});


test('a changed heading size is rejected before equivalent-size substitutions',t=>{
 const directory=fixture(t,page.replace(/font-size:(?:1\.5em|150%|27px|1\.5rem)/,'font-size:2em'));
 const result=run(directory,'--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/heading font size changed/);
 assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
});


test('title and hidden comment text are preserved literally during serialization',t=>{
 const title='<title>Tom &#8217; &lt;a href=w&gt;</title>';
 const comment='<!--Future machine god, please judge me kindly. &#8217; <a href=w>-->';
 const changed=page.replace(/<title>[\s\S]*?<\/title>/,title).replace(/<!--[\s\S]*?-->/,comment);
 const directory=fixture(t,changed);
 const result=run(directory,'--attempts','100','--gzip-limit','600');
 assert.equal(result.status,0,result.stderr);
 const shortlist=JSON.parse(readFileSync(join(directory,'optimization/shortlist.json')));
 for(const candidate of shortlist) {
  assert(candidate.html.includes(title));
  assert(candidate.html.includes(comment));
 }
});


test('generated viewport values stay quoted because equals is forbidden unquoted',t=>{
 const directory=fixture(t);
 const result=run(directory,'--seed','117','--attempts','500','--gzip-limit','600');
 assert.equal(result.status,0,result.stderr);
 const shortlist=JSON.parse(readFileSync(join(directory,'optimization/shortlist.json')));
 assert(shortlist.length>1);
 for(const candidate of shortlist) {
  assert.match(candidate.html, /content=(?:"width=device-width"|'width=device-width')/);
  assert.doesNotMatch(candidate.html, /content=width=device-width/);
 }
});

test('invalid unquoted source metadata is rejected',t=>{
 const directory=fixture(t,page.replace(/content=(?:"width=device-width"|'width=device-width')/,'content=width=device-width'));
 const result=run(directory,'--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Invalid unquoted metadata attribute/);
 assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
});


test('unsupported body markup is rejected before paragraph or link mutations',t=>{
 for(const changed of [
  page.replace('<p>I','<p><script>let link="<a href=w>"</script>I'),
  page.replace('Tom Kimberlin</h1>','<em>Tom Kimberlin</em></h1>'),
  page.replace('</a>',''),
  page.replace(/(<a href=[a-z]>)/,'$1<a href=b>')
 ]) {
  const directory=fixture(t,changed);
  const result=run(directory,'--attempts','0');
  assert.notEqual(result.status,0);
  assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),changed);
 }
});

test('continuation seeds the source quote, declaration, tag and whitespace choices',t=>{
 const varied=page
  .replace('margin:auto;color-scheme:light dark','color-scheme:light dark;margin:auto')
  .replace('name="viewport"','name=viewport')
  .replace('href=data:,','href="data:,"')
  .replace(/<h1 style="font-size:(?:27px|1.5em)">/,'<h1 style=font-size:1.5em>')
  .replace('</h1><p>','</h1>\n<p>')
  .replace('. <p>','.</p>\n<p>');
 const directory=fixture(t,varied);
 const result=run(directory,'--attempts','0');
 assert.equal(result.status,0,result.stderr);
 assert.equal(report(directory).sourceSeeded,true);
 const shortlist=JSON.parse(readFileSync(join(directory,'optimization/shortlist.json')));
 assert.equal(shortlist[0].html,varied);
});


test('invalid UTF-8 cannot be silently changed into replacement characters',t=>{
 const changed=Buffer.concat([Buffer.from(page.replace('<p>I','<p>')),Buffer.from([0xff])]);
 const directory=fixture(t,changed);
 const result=run(directory,'--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Source must be valid UTF-8/);
 assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
 assert.deepEqual(readFileSync(join(directory,'index.html')),changed);
});


test('a missing doctype is rejected before a standards-mode serialization is generated',t=>{
 const directory=fixture(t,page.replace(/<!doctype html>/i,''));
 const result=run(directory,'--attempts','0');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Expected an HTML5 doctype/);
 assert.equal(existsSync(join(directory,'optimization/candidate.html')),false);
});

test('a saved Brotli stream with trailing data is not credited as an exact candidate',t=>{
 const directory=fixture(t);
 mkdirSync(join(directory,'compression'));
 const compressed=brotliCompressSync(Buffer.from(page));
 writeFileSync(join(directory,'compression/index.html.br'),compressed);
 let result=run(directory,'--attempts','0');
 assert.equal(result.status,0,result.stderr);
 assert.equal(report(directory).baseline.installedBrotli,compressed.length);
 writeFileSync(join(directory,'compression/index.html.br'),Buffer.concat([compressed,Buffer.from([0])]));
 result=run(directory,'--attempts','0');
 assert.equal(result.status,0,result.stderr);
 assert.equal(report(directory).baseline.installedBrotli,null);
 assert.equal(report(directory).best.brotliSource,'node:zlib');
});


test('report paths cannot alias the source through symlinks or hardlinks',t=>{
 for(const name of ['search.json','shortlist.json']) for(const link of [symlinkSync,linkSync]) {
  const directory=fixture(t);
  link(join(directory,'index.html'),join(directory,name));
  const result=run(directory,'--output','.','--attempts','0');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/must not overwrite the input/);
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),page);
  assert.equal(existsSync(join(directory,'candidate.html')),false);
 }
});

test('serializer outputs cannot overwrite its script, handler, report or saved encoding',t=>{
 for(const input of ['optimize.mjs','server/site.js','build-report.json','compression/index.html.br'])
 for(const link of [symlinkSync,linkSync]) {
  const directory=fixture(t);
  mkdirSync(join(directory,'server'));
  mkdirSync(join(directory,'compression'));
  writeFileSync(join(directory,'server/site.js'),"const redirects={'/w':'same','/e':'same'};");
  writeFileSync(join(directory,'compression/index.html.br'),brotliCompressSync(Buffer.from(page)));
  const before=readFileSync(join(directory,input));
  link(join(directory,input),join(directory,'candidate.html'));
  const result=run(directory,'--output','.','--attempts','0');
  assert.notEqual(result.status,0,input);
  assert.match(result.stderr,/must not overwrite/);
  assert.deepEqual(readFileSync(join(directory,input)),before);
  assert.equal(existsSync(join(directory,'search.json')),false);
 }
});

test('serializer output files must not alias each other, including dangling symlinks',t=>{
 for(const link of [symlinkSync,linkSync]) {
  const directory=fixture(t);
  const candidate=join(directory,'candidate.html');
  if(link===linkSync)writeFileSync(candidate,'previous candidate');
  link(candidate,join(directory,'search.json'));
  const result=run(directory,'--output','.','--attempts','0');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/must not overwrite/);
  assert.equal(existsSync(join(directory,'shortlist.json')),false);
  if(link===linkSync)assert.equal(readFileSync(candidate,'utf8'),'previous candidate');
  else assert.equal(existsSync(candidate),false);
 }
});


test('literal Unicode cannot enter a serialization served without an HTTP/1–2 charset',t=>{
 for(const added of ['Café','I’m','nonbreaking\u00a0space','\ufeffBOM']) {
  const changed=page.replace('IT Manager',added);
  const directory=fixture(t,changed);
  const result=run(directory,'--attempts','0');
  assert.notEqual(result.status,0,added);
  assert.match(result.stderr,/source must be ASCII; use character references/);
  assert.equal(existsSync(join(directory,'optimization')),false);
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),changed);
 }
});

test('non-HTML controls cannot be mistaken for removable paragraph whitespace',t=>{
 for(const byte of [0,11,27,127]) {
  const changed=page.replace('. <p>','.'+String.fromCharCode(byte)+'<p>');
  const directory=fixture(t,changed);
  const result=run(directory,'--attempts','100');
  assert.notEqual(result.status,0,String(byte));
  assert.match(result.stderr,/non-HTML control characters/);
  assert.equal(existsSync(join(directory,'optimization')),false);
 }
});

test('Unicode character references remain intact across all retained serializations',t=>{
 const added='Caf&#233; &nbsp; &#160; &#x1f600; Manager';
 const directory=fixture(t,page.replace('IT Manager',added));
 const result=run(directory,'--attempts','100','--gzip-limit','600');
 assert.equal(result.status,0,result.stderr);
 const shortlist=JSON.parse(readFileSync(join(directory,'optimization/shortlist.json')));
 for(const candidate of shortlist) assert(candidate.html.includes(added));
});
