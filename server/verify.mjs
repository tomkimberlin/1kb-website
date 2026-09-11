import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const representations = Object.fromEntries(Object.entries({identity:'',br:'.br',gzip:'.gz'}).map(([k,s])=>[k,readFileSync(new URL('../public/index.html'+s,import.meta.url))]));
const ip=process.env.ONEKB_TEST_IP;
const connect=[];
if(ip&&process.env.ONEKB_TEST_HTTPS_PORT) for(const host of ['tomkimberlin.com','www.tomkimberlin.com']) connect.push('--connect-to',`${host}:443:${ip}:${process.env.ONEKB_TEST_HTTPS_PORT}`);
if(ip&&process.env.ONEKB_TEST_HTTP_PORT) connect.push('--connect-to',`tomkimberlin.com:80:${ip}:${process.env.ONEKB_TEST_HTTP_PORT}`);
const resolve=ip?['--resolve',`tomkimberlin.com:443:${ip}`,'--resolve',`www.tomkimberlin.com:443:${ip}`,'--resolve',`tomkimberlin.com:80:${ip}`]:[];
function request(protocol, path='/', encoding='br', method='GET', origin='https://tomkimberlin.com') {
  const data=execFileSync('curl',['-sS','--max-time','20',protocol,...resolve,...connect,'-i',...(method==='HEAD'?['-I']:['-X',method]),'-H',`Accept-Encoding: ${encoding}`,origin+path]);
  const end=data.indexOf('\r\n\r\n');assert(end>=0);
  const lines=data.subarray(0,end).toString().split('\r\n');
  const statusLine=lines.shift();
  if(protocol==='--http2'&&origin.startsWith('https:'))assert(statusLine.startsWith('HTTP/2 '),statusLine);
  const status=Number(statusLine.split(' ')[1]);
  const headers=Object.fromEntries(lines.map(line=>{const n=line.indexOf(':');return [line.slice(0,n).toLowerCase(),line.slice(n+1).trim()]}));
  assert(!lines.some(line=>/^(server|alt-svc|etag|last-modified|accept-ranges|cf-[^:]*|nel|report-to|server-timing):/i.test(line)),lines);
  if(protocol==='--http2'&&origin.startsWith('https:'))assert.equal(headers['content-length'],undefined);
  return {status,headers,body:data.subarray(end+4)};
}
const cases=[['br','br'],['gzip','gzip'],['identity','identity'],['','identity'],['br;q=0,gzip;q=0','identity'],['gzip, deflate, br, zstd','br'],['br;q=0,gzip;q=1','gzip'],['gzip;q=0.5,br;q=1','br'],['gzip;q=1,br;q=0.2','gzip'],['identity;q=1,br;q=0.5','identity'],['*;q=0',null],['*','br'],['br;q=0,*;q=1','gzip'],['br;q=0,gzip;q=0,*;q=0',null],['identity;q=0',null],['identity;q=0,br','br'],['BR;q=0.500,GZIP;q=0.250','br'],['br;q=banana,gzip','gzip'],['br;q=1.1','identity'],['br;q=0,br;q=1','br'],['gzip,identity','gzip'],['br;q=0.001,identity;q=0','br']];
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
 for(const encoding of ['br','gzip','identity']) {
  const r=request(protocol,'/',encoding,'HEAD');assert.equal(r.status,200);assert.equal(r.body.length,0);if(r.headers['content-length']!==undefined)assert.equal(Number(r.headers['content-length']),representations[encoding].length);assert.equal(r.headers['content-encoding'],encoding==='identity'?undefined:encoding);checks++;
 }
 for(const [path,status,location,method,origin] of [
  ['/g',301,'https://github.com/tomkimberlin'],['/t',301,'https://t.me/tomkimberlin'],['/x',301,'https://xmr.surf/'],['/s',301,'https://github.com/tomkimberlin/1kb-website'],['/index.html',301,'/'],['/index.html?a=1',301,'/?a=1'],['/missing',404],['/index.html.br',404],['/Caddyfile',404],['/.well-known/onekb-connectivity',404],['/',405,undefined,'POST'],['/?a=1',301,'https://tomkimberlin.com/?a=1','GET','http://tomkimberlin.com'],['/?a=1',301,'https://tomkimberlin.com/?a=1','GET','https://www.tomkimberlin.com']]) {
  const r=request(protocol,path,'br',method,origin);assert.equal(r.status,status,path);assert.equal(r.body.length,0,path);assert.equal(r.headers.location,location,path);if(status===405)assert.equal(r.headers.allow,'GET, HEAD');checks++;
 }
}
console.log(`${checks} live HTTP/1.1 and HTTP/2 checks passed.`);
