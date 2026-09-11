import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import worker from './worker.mjs';

const source = readFileSync('index.html');
const call = (path='/', encoding='', method='GET', cf) => {
  const request = new Request(new URL(path,'https://tomkimberlin.com'),{method,headers:{'accept-encoding':encoding}});
  if (cf !== undefined) Object.defineProperty(request,'cf',{value:cf});
  return worker.fetch(request);
};
const cases = [
  ['br','br'], ['gzip','gzip'], ['identity','identity'], ['', 'identity'],
  ['gzip, deflate, br, zstd','br'], ['br;q=0,gzip;q=0','identity'],
  ['br;q=0,gzip;q=1','gzip'], ['gzip;q=0.5,br;q=1','br'],
  ['gzip;q=1,br;q=0.2','gzip'], ['identity;q=1,br;q=0.5','identity'],
  ['*;q=1','br'], ['*;q=0,identity;q=1','identity'], ['BR; Q=1','br'],
];
for (const [accepted,encoding] of cases) test('encoding: '+JSON.stringify(accepted),async()=>{
  const response=call('/',accepted);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-encoding'),encoding==='identity'?null:encoding);
  const bytes=Buffer.from(await response.arrayBuffer());
  const suffix=encoding==='identity'?'':encoding==='br'?'.br':'.gz';
  assert.deepEqual(bytes,readFileSync('public/index.html'+suffix));
  const decoded=encoding==='br'?brotliDecompressSync(bytes):encoding==='gzip'?gunzipSync(bytes):bytes;
  assert.deepEqual(decoded,source);
});
test('Cloudflare original encoding wins, including an empty value',()=>{
  assert.equal(call('/','gzip, br','GET',{clientAcceptEncoding:'gzip'}).headers.get('content-encoding'),'gzip');
  assert.equal(call('/','gzip, br','GET',{clientAcceptEncoding:''}).headers.get('content-encoding'),null);
});
test('unacceptable representations, HEAD and method handling',async()=>{
  for (const accepted of ['*;q=0','br;q=0,gzip;q=0,identity;q=0']) assert.equal(call('/',accepted).status,406);
  const head=call('/','br','HEAD');
  assert.equal(head.headers.get('content-encoding'),'br');
  assert.equal(head.headers.get('content-length'),String(readFileSync('public/index.html.br').length));
  assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal(call('/','','POST').status,405);
});
test('zone transform preserves weighted visitor preferences',()=>{
  const request=new Request('https://tomkimberlin.com/',{headers:{'accept-encoding':'gzip, br','x-onekb-accept-encoding':'br;q=0,gzip;q=0'}});
  Object.defineProperty(request,'cf',{value:{clientAcceptEncoding:'gzip, br'}});
  assert.equal(worker.fetch(request).headers.get('content-encoding'),null);
});
test('redirects and missing paths have empty bodies',async()=>{
  for(const [url,location] of [
    ['http://tomkimberlin.com/?x=1','https://tomkimberlin.com/?x=1'],
    ['https://www.tomkimberlin.com/g','https://tomkimberlin.com/g'],
    ['/g','https://github.com/tomkimberlin'],['/index.html?x=1','/?x=1'],
    ['/t','https://t.me/tomkimberlin'],['/x','https://xmr.surf/'],['/s','https://github.com/tomkimberlin/1kb-website'],
  ]) {
    const response=call(url);
    assert.equal(response.status,301);assert.equal(response.headers.get('location'),location);
    assert.equal((await response.arrayBuffer()).byteLength,0);
  }
  assert.equal(call('/missing').status,404);
  assert.equal((await call('/missing').arrayBuffer()).byteLength,0);
});
