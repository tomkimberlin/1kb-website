import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {parseResponseHeaders} from '../server/verify-response.mjs';
import {inspect} from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const preload=fileURLToPath(new URL('./fixtures/verify-curl.mjs',import.meta.url));
function verify(t,name,scenario='ordinary') {
 const directory=mkdtempSync(join(tmpdir(),'onekb-live-check-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const subdir of ['server','public']) mkdirSync(join(directory,subdir));
 for(const file of ['server/site.js','server/verify.mjs','server/verify-alias.mjs','server/verify-response.mjs',
  'public/index.html','public/index.html.br','public/index.html.gz','public/index.html.deflate','public/representations.json']) {
  if(existsSync(join(root,file))) copyFileSync(join(root,file),join(directory,file));
 }
 const result=spawnSync(process.execPath,['--import',preload,join(directory,'server',name)],{encoding:'utf8',timeout:10000,
  env:{...process.env,ONEKB_VERIFY_FIXTURE:directory,ONEKB_VERIFY_SCENARIO:scenario,
   ONEKB_TEST_IP:'127.0.0.1',ONEKB_TEST_HTTPS_PORT:'18443',ONEKB_TEST_HTTP_PORT:'18080',ONEKB_ALIAS_IP:'127.0.0.1',
   HTTPS_PROXY:'http://unused.invalid:8080',HTTP_PROXY:'http://unused.invalid:8080',ALL_PROXY:'http://unused.invalid:8080'}});
 return {...result,calls:readFileSync(join(directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
}
test('both live verifiers retain their successful checks and local port mappings',t=>{
 const main=verify(t,'verify.mjs');
 assert.equal(main.status,0,main.stderr);
 assert.match(main.stdout,/118 live HTTP\/1.1 and HTTP\/2 checks passed/);
 assert.equal(main.calls.length,118);
 assert(main.calls.every(args=>args.includes('tomkimberlin.com:443:127.0.0.1:18443')&&args.includes('tomkimberlin.com:80:127.0.0.1:18080')));
 const alias=verify(t,'verify-alias.mjs');
 assert.equal(alias.status,0,alias.stderr);
 assert.match(alias.stdout,/12 alias redirect checks passed/);
 assert(alias.calls.every(args=>args.includes('tom.kimberlin.net:443:127.0.0.1')));
});
test('conflicting duplicate Content-Encoding and Location fields cannot pass',t=>{
 for(const [name,scenario] of [['verify.mjs','duplicate-encoding'],['verify.mjs','duplicate-location'],['verify-alias.mjs','duplicate-location']]) {
  const result=verify(t,name,scenario);
  assert.notEqual(result.status,0,`${name} accepted ${scenario}`);
  assert.match(result.stderr,/duplicate response header/i);
  assert.doesNotMatch(result.stderr,/unexpected\.invalid/,'Diagnostics should identify field names without printing values');
 }
});
test('valid informational responses do not replace the final response',t=>{
 for(const name of ['verify.mjs','verify-alias.mjs']) {
  const result=verify(t,name,'informational');
  assert.equal(result.status,0,result.stderr);
 }
});
test('test-IP verification cannot be routed through a proxy or curlrc',t=>{
 for(const name of ['verify.mjs','verify-alias.mjs']) {
  const result=verify(t,name,'direct-request');
  assert.equal(result.status,0,result.stderr);
 }
});
test('page responses require the compact HTML content type',t=>{
 const result=verify(t,'verify.mjs','missing-content-type');
 assert.notEqual(result.status,0,'A page without Content-Type must fail');
});
test('documented Date headers are present and valid without testing clock freshness',t=>{
 for(const name of ['verify.mjs','verify-alias.mjs']) for(const scenario of ['missing-date','invalid-date']) {
  const result=verify(t,name,scenario);
  assert.notEqual(result.status,0,`${name} accepted ${scenario}`);
  assert.match(result.stderr,/Date header/);
 }
});
test('following the alias requires status 200 and Brotli encoding as well as exact bytes',t=>{
 for(const scenario of ['follow-wrong-status','follow-wrong-encoding']) {
  const result=verify(t,'verify-alias.mjs',scenario);
  assert.notEqual(result.status,0,`Alias follow accepted ${scenario}`);
 }
});

test('header parsing retains response boundaries and rejects ambiguous fields without values',()=>{
 const parsed=parseResponseHeaders(Buffer.from('HTTP/1.1 103 Early Hints\r\nLink: </ignored>\r\n\r\nHTTP/2 301\r\nLocation: https://example.invalid/\r\n\r\nHTTP/2 200\r\nContent-Encoding:\tbr \t\r\n\r\n'));
 assert.deepEqual(parsed.map(response=>response.status),[301,200]);
 assert.equal(parsed[1].headers['content-encoding'],'br');
 for(const value of ['', 'HTTP/2 200\r\n', 'HTTP/2 103\r\n\r\n', 'HTTP/2 101\r\n\r\n',
  'HTTP/2 200\r\n Content-Type: text/html\r\n\r\n', 'HTTP/2 200\r\nContent-Type : text/html\r\n\r\n',
  'HTTP/2 200\r\nContent-Type: text/html\x00\r\n\r\n', 'HTTP/2 200\r\n\r\ntrailing']) {
  assert.throws(()=>parseResponseHeaders(Buffer.from(value)));
 }
 assert.throws(()=>parseResponseHeaders(Buffer.from('HTTP/2 200\r\nSet-Cookie: private=secret-one\r\nsEt-CoOkIe: private=secret-two\r\n\r\n')),error=>{
  assert.match(error.message,/Duplicate response header: set-cookie/);
  assert.doesNotMatch(error.message,/private|secret/);
  return true;
 });
 assert.throws(()=>parseResponseHeaders(Buffer.from('HTTP/2 200\r\nSet-Cookie: private=secret\r\n')),error=>{
  assert.doesNotMatch(inspect(error),/private|secret/);
  return true;
 });
});

test('real loopback curl keeps informational headers, HEAD output, and binary bodies separate',async t=>{
 const body=Buffer.from('HTTP/1.1 418 Body bytes\r\n\r\n\x00\xff','latin1');
 const requests=[];
 const server=createServer((request,response)=>{
  requests.push(request.method);
  response.writeEarlyHints({link:'</ignored>; rel=preload'});
  response.writeHead(200,{'Content-Type':'text/html','Content-Length':String(body.length)});
  response.end(request.method==='HEAD'?undefined:body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const script=`import {curlResponse} from ${JSON.stringify(new URL('../server/verify-response.mjs',import.meta.url).href)};
 const url=process.argv[1];
 console.log(JSON.stringify([curlResponse([url]),curlResponse(['-I',url])].map(({status,body,responses})=>({status,body:body.toString('hex'),responses:responses.length}))));`;
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script,`http://127.0.0.1:${server.address().port}/`],{
   env:{...process.env,HTTP_PROXY:'http://unused.invalid:8080',http_proxy:'http://unused.invalid:8080',NO_PROXY:'',no_proxy:''}});
  let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
 });
 assert.equal(result.code,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),[{status:200,body:body.toString('hex'),responses:1},{status:200,body:'',responses:1}]);
 assert.deepEqual(requests,['GET','HEAD']);
});
