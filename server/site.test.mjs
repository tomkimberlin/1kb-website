import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {brotliDecompressSync,gunzipSync,inflateSync} from 'node:zlib';

// Exercise the deployed njs handler with file reads mapped to the local build.
// Live checks separately cover nginx's framing, HEAD handling and TLS.
const code=readFileSync(new URL('./site.js',import.meta.url),'utf8')
  .replace("import fs from 'fs';",'')
  .replace('export default {serve, headers};','({serve, headers});');
const handler=runInNewContext(code,{fs:{readFileSync:path=>readFileSync(path.replace('/srv/current/','public/'))}});
function call(path='/',encoding='',method='GET',httpVersion='2.0') {
  const url=new URL(path,'https://tomkimberlin.com');
  const r={
    method,httpVersion,uri:url.pathname,status:0,
    variables:{scheme:url.protocol.slice(0,-1),host:url.hostname,request_uri:url.pathname+url.search,is_args:url.search?'?':'',args:url.search.slice(1)},
    headersIn:{'Accept-Encoding':encoding},headersOut:{},body:Buffer.alloc(0),
    sendHeader(){},finish(){},return(status,body){this.status=status;this.body=Buffer.from(body);}
  };
  handler.serve(r);
  handler.headers(r);
  return r;
}
const cases=[
  ['br','br'],['deflate','deflate'],['gzip,deflate','deflate'],['deflate;q=0.5,gzip','gzip'],['deflate;q=0,gzip','gzip'],['gzip','gzip'],['identity','identity'],['','identity'],
  ['gzip, deflate, br, zstd','br'],['br;q=0,gzip;q=0','identity'],
  ['br;q=0,gzip;q=1','gzip'],['gzip;q=0.5,br;q=1','br'],
  ['gzip;q=1,br;q=0.2','gzip'],['identity;q=1,br;q=0.5','identity'],
  ['*;q=1','br'],['*;q=0,identity;q=1','identity'],['BR; Q=1','br'],
  ['br;q=0,*;q=1','deflate'],['br;q=banana,gzip','gzip']
];
for(const [accepted,encoding] of cases) test('encoding: '+JSON.stringify(accepted),()=>{
  const r=call('/',accepted);
  assert.equal(r.status,200);
  assert.equal(r.headersOut['Content-Encoding'],encoding==='identity'?undefined:encoding);
  const suffix=encoding==='identity'?'':encoding==='br'?'.br':encoding==='deflate'?'.deflate':'.gz';
  assert.deepEqual(r.body,readFileSync('public/index.html'+suffix));
  const decoded=encoding==='br'?brotliDecompressSync(r.body):encoding==='gzip'?gunzipSync(r.body):encoding==='deflate'?inflateSync(r.body):r.body;
  assert.deepEqual(decoded,readFileSync('index.html'));
});
test('unacceptable encodings and methods return empty errors',()=>{
  for(const accepted of ['*;q=0','br;q=0,gzip;q=0,identity;q=0']) {
    const r=call('/',accepted);
    assert.equal(r.status,406);
    assert.equal(r.body.length,0);
    assert.equal(r.headersOut.Vary,'accept-encoding');
  }
  const r=call('/','','POST');
  assert.equal(r.status,405);
  assert.equal(r.headersOut.Allow,'GET, HEAD');
  assert.equal(r.body.length,0);
});
test('aliases and short links preserve their redirect destinations',()=>{
  for(const [,path] of readFileSync('index.html','utf8').matchAll(/<a href=([^ >]+)>/g)) {
    assert.match(path,/^[a-z]$/);
    assert.equal(call('/'+path).status,301,path);
  }
  for(const [url,location] of [
    ['http://tomkimberlin.com/?x=1','https://tomkimberlin.com/?x=1'],
    ['https://www.tomkimberlin.com/g','https://tomkimberlin.com/g'],
    ['http://tom.kimberlin.net/','https://tomkimberlin.com/'],
    ['https://tom.kimberlin.net/p?from=alias&check=1','https://tomkimberlin.com/p?from=alias&check=1'],
    ['/w','https://euthenics.com/'],['/e','https://euthenics.com/'],['/g','https://github.com/tomkimberlin'],['/index.html?x=1','/?x=1'],
    ['/p','https://paste.kimberlin.net/'],['/k','https://1kb.club/'],
    ['/c','mailto:tomkimberlin@gmail.com'],['/m','https://github.com/tomkimberlin/m365-workbench'],['/i','https://github.com/tomkimberlin/Save-Image-As'],
    ['/x','https://xmr.surf/'],['/s','https://github.com/tomkimberlin/1kb-website']
  ]) {
    const r=call(url);
    assert.equal(r.status,301);
    assert.equal(r.headersOut.Location,location);
    assert.equal(r.body.length,0);
  }
  for(const path of ['/missing','/t']) {
    const r=call(path);
    assert.equal(r.status,404);
    assert.equal(r.body.length,0);
  }
});
test('empty responses retain length only for HTTP/1.1',()=>{
  for(const protocol of ['1.1','2.0','3.0']) {
    assert.equal(call('/g','','GET',protocol).headersOut['Content-Length'],protocol==='1.1'?'0':undefined);
  }
});

test('HTTP/3 uses the complete QPACK content-type entry',()=>{
  for(const version of ['1.1','2.0','3.0']) {
    const r=call('/','br','GET',version);
    assert.equal(r.headersOut['Content-Type'],version==='3.0'?'text/html; charset=utf-8':'text/html');
    assert.deepEqual(r.body,readFileSync('public/index.html.br'));
  }
});
