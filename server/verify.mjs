import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {curlResponse} from './verify-response.mjs';

const representations = Object.fromEntries(Object.entries({identity:'',br:'.br',gzip:'.gz',deflate:'.deflate'}).map(([k,s])=>[k,readFileSync(new URL('../public/index.html'+s,import.meta.url))]));
const ip=process.env.ONEKB_TEST_IP;
const connect=[];
if(ip&&process.env.ONEKB_TEST_HTTPS_PORT) for(const host of ['tomkimberlin.com','www.tomkimberlin.com']) connect.push('--connect-to',`${host}:443:${ip}:${process.env.ONEKB_TEST_HTTPS_PORT}`);
if(ip&&process.env.ONEKB_TEST_HTTP_PORT) connect.push('--connect-to',`tomkimberlin.com:80:${ip}:${process.env.ONEKB_TEST_HTTP_PORT}`);
const resolve=ip?['--resolve',`tomkimberlin.com:443:${ip}`,'--resolve',`www.tomkimberlin.com:443:${ip}`,'--resolve',`tomkimberlin.com:80:${ip}`]:[];
function request(protocol, path='/', encoding='br', method='GET', origin='https://tomkimberlin.com') {
  const response=curlResponse([protocol,...resolve,...connect,...(method==='HEAD'?['-I']:['-X',method]),'-H',`Accept-Encoding: ${encoding}`,origin+path]);
  const {statusLine,status,headers,body}=response;
  if(protocol==='--http2'&&origin.startsWith('https:'))assert(statusLine.startsWith('HTTP/2 '),statusLine);
  assert.equal(headers['content-type'],status===200?'text/html':undefined,`${origin}${path} ${method} ${protocol}`);
  const names=Object.keys(headers);
  assert(!names.some(name=>/^(server|alt-svc|etag|last-modified|accept-ranges|cf-.*|nel|report-to|server-timing)$/.test(name)),`Unexpected response headers: ${names.join(', ')}`);
  if(protocol==='--http2'&&origin.startsWith('https:'))assert.equal(headers['content-length'],undefined);
  else if(method!=='HEAD')assert.equal(headers['content-length'],String(body.length));
  return response;
}
const cases=[['br','br'],['deflate','deflate'],['gzip,deflate','deflate'],['deflate;q=0.5,gzip','gzip'],['deflate;q=0,gzip','gzip'],['gzip','gzip'],['identity','identity'],['','identity'],['br;q=0,gzip;q=0','identity'],['gzip, deflate, br, zstd','br'],['br;q=0,gzip;q=1','gzip'],['gzip;q=0.5,br;q=1','br'],['gzip;q=1,br;q=0.2','gzip'],['identity;q=1,br;q=0.5','identity'],['*;q=0',null],['*','br'],['br;q=0,*;q=1','deflate'],['br;q=0,gzip;q=0,*;q=0',null],['identity;q=0',null],['identity;q=0,br','br'],['BR;q=0.500,GZIP;q=0.250','br'],['br;q=banana,gzip','gzip'],['br;q=1.1','identity'],['br;q=0,br;q=1','br'],['gzip,identity','gzip'],['br;q=0.001,identity;q=0','br'],['br ; q=1','br'],['gzip\t; q=1, br ;q=0','gzip'],['br ;q=0, * ;q=1','deflate'],['identity ;q=1,br;q=0.5','identity'],['* ;q=0',null],['identity ;q=0, * ;q=0',null]];
let checks=0;
for(const protocol of ['--http1.1','--http2']) {
 for(const [accepted,encoding] of cases) {
  const r=request(protocol,'/',accepted);
  assert.equal(r.status,encoding?200:406,accepted);
  assert.equal(r.headers['content-encoding'],encoding&&encoding!=='identity'?encoding:undefined,accepted);
  assert.deepEqual(r.body,encoding?representations[encoding]:Buffer.alloc(0),accepted);
  assert.equal(r.headers.vary,'accept-encoding');
  if(encoding)assert.equal(r.headers['cache-control'],'max-age=86400');
  else assert.equal(r.headers['cache-control'],undefined);
  checks++;
 }
 for(const encoding of ['br','gzip','deflate','identity']) {
  const r=request(protocol,'/',encoding,'HEAD');assert.equal(r.status,200);assert.equal(r.body.length,0);assert.equal(r.headers['content-length'],protocol==='--http1.1'?String(representations[encoding].length):undefined);assert.equal(r.headers['content-encoding'],encoding==='identity'?undefined:encoding);assert.equal(r.headers.vary,'accept-encoding');assert.equal(r.headers['cache-control'],'max-age=86400');checks++;
 }
 for(const [path,status,location,method,origin] of [
  ['/b',301,'https://github.com/tomkimberlin'],['/a',301,'https://github.com/tomkimberlin/1kb-website'],['/o',301,'https://1kb.club/'],['/c',301,'mailto:tomkimberlin@gmail.com'],['/m',301,'https://github.com/tomkimberlin/m365-workbench'],['/i',301,'https://github.com/tomkimberlin/Save-Image-As'],['/w',301,'https://euthenics.com/'],['/e',301,'https://euthenics.com/'],['/g',301,'https://github.com/tomkimberlin'],['/p',301,'https://paste.kimberlin.net/'],['/k',301,'https://1kb.club/'],['/t',404],['/x',301,'https://xmr.surf/'],['/s',301,'https://github.com/tomkimberlin/1kb-website'],['/index.html',301,'/'],['/index.html?a=1',301,'/?a=1'],['/missing',404],['/index.html.br',404],['/Caddyfile',404],['/.well-known/onekb-connectivity',404],['/',405,undefined,'POST'],['/?a=1',301,'https://tomkimberlin.com/?a=1','GET','http://tomkimberlin.com'],['/?a=1',301,'https://tomkimberlin.com/?a=1','GET','https://www.tomkimberlin.com']]) {
  const r=request(protocol,path,'br',method,origin);assert.equal(r.status,status,path);assert.equal(r.body.length,0,path);assert.equal(r.headers.location,location,path);if(status===405)assert.equal(r.headers.allow,'GET, HEAD');checks++;
 }
}
console.log(`${checks} live HTTP/1.1 and HTTP/2 checks passed.`);
