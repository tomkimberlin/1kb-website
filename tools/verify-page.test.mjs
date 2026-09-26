// Optional browser regressions: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// node --test tools/verify-page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,linkSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const module=process.env.PLAYWRIGHT_MODULE || 'playwright';
let available=true;
try {await import(module);} catch(error) {
 if(process.env.PLAYWRIGHT_MODULE) throw error;
 available=false;
}
const optional={skip:available ? false : 'Install Playwright or set PLAYWRIGHT_MODULE to run browser regressions'};
const verifier=fileURLToPath(new URL('./verify-page.mjs',import.meta.url));
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const root=fileURLToPath(new URL('../',import.meta.url));
async function compare(t,candidate=page,prepare) {
 const directory=mkdtempSync(join(tmpdir(),'onekb-browser-test-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'baseline.html'),page);
 writeFileSync(join(directory,'candidate.html'),candidate);
 const options=prepare?.(directory)||{};
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[options.verifier||verifier,'--baseline',join(directory,'baseline.html'),'--candidate',join(directory,'candidate.html'),
   '--out',join(directory,'report'),'--case','chromium-1440-light','--playwright-module',options.module||module],{cwd:root});
  let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);
  child.stderr.on('data',data=>stderr+=data);
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Browser regression timed out'));},45000);
  child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr,directory});});
 });
 return result;
}

test('equivalent aliases preserve focused pixels and all nine native Enter destinations',optional,async t=>{
 const candidate=page.replace(/<a href=(?:e|w)>/,'<a href=w>');
 const result=await compare(t,candidate);
 assert.equal(result.code,0,result.stderr);
 const report=JSON.parse(readFileSync(join(result.directory,'report/report.json')));
 assert.equal(report.cases.length,1);
 assert.equal(report.cases[0].identicalFocusedPixels,9);
 assert.equal(report.cases[0].keyboardEnterDestinations,9);
 assert.equal(report.cases[0].pageLoadRequests,1);
 assert.equal(report.cases[0].keyboardProbeRequests,9);
 assert.equal(report.cases[0].unexpectedRequests,0);
});

test('a hidden cross-origin image is rejected without sending its request',optional,async t=>{
 let hits=0;
 const external=createServer((request,response)=>{hits++;response.writeHead(204).end();});
 await new Promise(resolve=>external.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>external.close(resolve)));
 const url=`http://127.0.0.1:${external.address().port}/hidden.gif`;
 const result=await compare(t,page+`<img hidden src="${url}">`);
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/unexpected requests \(blocked before sending\)/);
 assert.equal(hits,0,'An unexpected origin must never be contacted');
});

test('removing keyboard outlines fails even while :focus-visible remains true',optional,async t=>{
 const candidate=page.replace('<h1','<style>a:focus-visible{outline:none}</style><h1');
 const result=await compare(t,candidate);
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/focused appearance changed|focused pixels changed/);
});

test('an inline click blocker cannot pass as a script-free page',optional,async t=>{
 const candidate=page.replace(/<a href=([a-z])>/,'<a href=$1 onclick="return false">');
 const result=await compare(t,candidate);
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/unexpected inline event handlers/);
});

test('nonbreaking spaces remain distinct from serialization whitespace',optional,async t=>{
 const result=await compare(t,page.replace('IT Manager','IT&nbsp;Manager'));
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/content or layout changed/);
});

test('changing a link target is rejected before opening a new tab',optional,async t=>{
 const result=await compare(t,page.replace(/<a href=([a-z])>/,'<a href=$1 target=_blank>'));
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/content or layout changed/);
});


test('focused pixel checks catch changes outside the focused anchor styles',optional,async t=>{
 const candidate=page.replace('<h1','<style>body:has(a:focus-visible){opacity:0}</style><h1');
 const result=await compare(t,candidate);
 assert.notEqual(result.code,0);
 assert.match(result.stderr,/focused pixels changed/);
});

test('reports and focused screenshots cannot overwrite either input through aliases',async t=>{
 for(const [name,input,link] of [
  ['report.json','baseline.html',symlinkSync],
  ['chromium-1440-light-baseline.png','candidate.html',linkSync],
  ['chromium-1440-light-candidate-focus-9.png','baseline.html',linkSync],
 ]) {
  const result=await compare(t,page,directory=>{
   mkdirSync(join(directory,'report'));
   link(join(directory,input),join(directory,'report',name));
  });
  assert.notEqual(result.code,0);
  assert.match(result.stderr,/Browser output must not (overwrite an input|be a symbolic link)/);
  assert.equal(readFileSync(join(result.directory,'baseline.html'),'utf8'),page);
  assert.equal(readFileSync(join(result.directory,'candidate.html'),'utf8'),page);
 }
});

test('reports cannot overwrite the verifier or redirect handler through hard links',async t=>{
 for(const input of ['tools/verify-page.mjs','server/site.js']) {
  const result=await compare(t,page,directory=>{
   for(const folder of ['tools','server','report'])mkdirSync(join(directory,folder));
   for(const file of ['tools/verify-page.mjs','server/site.js'])copyFileSync(join(root,file),join(directory,file));
   linkSync(join(directory,input),join(directory,'report/report.json'));
   return {verifier:join(directory,'tools/verify-page.mjs'),module:'missing-browser-module'};
  });
  assert.notEqual(result.code,0);
  assert.match(result.stderr,/Browser output must not overwrite an input or source/);
  assert.deepEqual(readFileSync(join(result.directory,input)),readFileSync(join(root,input)));
  assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND/,'Output checks must run before loading browser tools');
 }
});

test('output symlinks, nonfiles, and collisions fail before writing any browser artifact',async t=>{
 for(const kind of ['dangling symlink','regular symlink','directory','hardlink collision']) {
  const result=await compare(t,page,directory=>{
   const output=join(directory,'report');mkdirSync(output);
   const first=join(output,'report.json'),last=join(output,'chromium-1440-light-candidate-focus-9.png');
   if(kind==='dangling symlink')symlinkSync(join(directory,'missing'),last);
   if(kind==='regular symlink') {writeFileSync(join(directory,'sentinel'),'untouched');symlinkSync(join(directory,'sentinel'),last);}
   if(kind==='directory')mkdirSync(last);
   if(kind==='hardlink collision') {writeFileSync(first,'untouched');linkSync(first,last);}
   return {module:'missing-browser-module'};
  });
  assert.notEqual(result.code,0,kind);
  assert.match(result.stderr,/Browser output(?:s)? (?:must not be a symbolic link|must be a regular file|must not alias each other)/);
  assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND/);
  assert(!existsSync(join(result.directory,'report/chromium-1440-light-baseline.png')));
  if(kind==='hardlink collision')assert.equal(readFileSync(join(result.directory,'report/report.json'),'utf8'),'untouched');
  if(kind==='regular symlink')assert.equal(readFileSync(join(result.directory,'sentinel'),'utf8'),'untouched');
  if(kind==='dangling symlink')assert(!existsSync(join(result.directory,'missing')));
 }
});
