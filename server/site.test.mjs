import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,inflateSync,constants as zlibConstants} from 'node:zlib';

// Exercise the deployed njs handler with the same preloaded build data.
// Live checks separately cover nginx's framing, HEAD handling and TLS.
const code=readFileSync(new URL('./site.js',import.meta.url),'utf8')
  .replace('export default {serve, headers};','({serve, headers});');
const onekbRepresentations=JSON.parse(readFileSync(new URL('../public/representations.json',import.meta.url)));
const handler=runInNewContext(code,{onekbRepresentations,Buffer});
function call(path='/',encoding='',method='GET',httpVersion='2.0',activeHandler=handler) {
  const url=new URL(path,'https://tomkimberlin.com');
  const r={
    method,httpVersion,uri:url.pathname,status:0,
    variables:{scheme:url.protocol.slice(0,-1),host:url.hostname,request_uri:url.pathname+url.search,is_args:url.search?'?':'',args:url.search.slice(1)},
    headersIn:{'Accept-Encoding':encoding},headersOut:{},body:Buffer.alloc(0),
    sendHeader(){},finish(){},return(status,body){this.status=status;this.body=Buffer.from(body);}
  };
  activeHandler.serve(r);
  activeHandler.headers(r);
  return r;
}
const cases=[
  ['br','br'],['deflate','deflate'],['gzip,deflate','deflate'],['deflate;q=0.5,gzip','gzip'],['deflate;q=0,gzip','gzip'],['gzip','gzip'],['identity','identity'],['','identity'],
  ['gzip, deflate, br, zstd','br'],['br;q=0,gzip;q=0','identity'],
  ['br;q=0,gzip;q=1','gzip'],['gzip;q=0.5,br;q=1','br'],
  ['gzip;q=1,br;q=0.2','gzip'],['identity;q=1,br;q=0.5','identity'],
  ['*;q=1','br'],['*;q=0,identity;q=1','identity'],['BR; Q=1','br'],
  ['br;q=0,*;q=1','deflate'],['br;q=banana,gzip','gzip'],
  ['br ; q=1','br'],['gzip\t; q=1, br ;q=0','gzip'],
  ['br ;q=0, * ;q=1','deflate'],['identity ;q=1,br;q=0.5','identity']
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
  for(const accepted of ['*;q=0','* ;q=0','br;q=0,gzip;q=0,identity;q=0','identity ;q=0, * ;q=0']) {
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
  const links=[...readFileSync('index.html','utf8').matchAll(/<a href=(?:"([^"]+)"|'([^']+)'|([^ >]+))>/g)];
  assert.equal(links.length,9);
  for(const match of links) {
    const path=match[1]??match[2]??match[3];
    assert.match(path,/^[a-z]$/);
    assert.equal(call('/'+path).status,301,path);
  }
  for(const [url,location] of [
    ['http://tomkimberlin.com/?x=1','https://tomkimberlin.com/?x=1'],
    ['https://www.tomkimberlin.com/g','https://tomkimberlin.com/g'],
    ['http://tom.kimberlin.net/','https://tomkimberlin.com/'],
    ['https://tom.kimberlin.net/p?from=alias&check=1','https://tomkimberlin.com/p?from=alias&check=1'],
    ['/b','https://github.com/tomkimberlin'],['/a','https://github.com/tomkimberlin/1kb-website'],['/o','https://1kb.club/'],['/w','https://euthenics.com/'],['/e','https://euthenics.com/'],['/g','https://github.com/tomkimberlin'],['/index.html?x=1','/?x=1'],
    ['/p','https://paste.kimberlin.net/'],['/k','https://1kb.club/'],
    ['/c','mailto:tomkimberlin@gmail.com'],['/m','https://github.com/tomkimberlin/m365-workbench'],['/i','https://github.com/tomkimberlin/Save-Image-As'],
    ['/x','https://xmr.surf/'],['/s','https://github.com/tomkimberlin/1kb-website']
  ]) {
    const r=call(url);
    assert.equal(r.status,301);
    assert.equal(r.headersOut.Location,location);
    assert.equal(r.body.length,0);
  }
  for(const path of ['/missing','/t','/representations.json']) {
    const r=call(path);
    assert.equal(r.status,404);
    assert.equal(r.body.length,0);
  }
});

test('preloaded data requires no request-time files or decoding for redirects and errors',()=>{
  const decoded=[];
  const traced=runInNewContext(code,{onekbRepresentations,Buffer:{from(value,format){
    decoded.push({value,format});return Buffer.from(value,format);
  }}});
  assert.equal(decoded.length,0,'Initializing the handler must not decode representations');
  for(const [path,accepted,method] of [['/g','','GET'],['/missing','','GET'],['/','*;q=0','GET'],['/','','POST']])
    call(path,accepted,method,'2.0',traced);
  assert.equal(decoded.length,0,'Redirects and errors do not need page data');
  for(const encoding of ['br','gzip','deflate','identity']) for(const method of ['GET','HEAD']) {
    decoded.length=0;
    const result=call('/',encoding,method,'2.0',traced);
    assert.equal(result.status,200);
    assert.deepEqual(decoded,[{value:onekbRepresentations[encoding],format:'base64'}]);
  }
});
test('HTTP/1 responses retain framing lengths while HTTP/2 and HTTP/3 omit them',()=>{
  for(const protocol of ['1.0','1.1','2.0','3.0']) {
    const framed = protocol === '1.0' || protocol === '1.1';
    assert.equal(call('/g','','GET',protocol).headersOut['Content-Length'],framed?'0':undefined);
    const r={httpVersion:protocol,headersOut:{'Content-Length':'319'}};
    handler.headers(r);
    assert.equal(r.headersOut['Content-Length'],framed?'319':undefined);
  }
});

test('HTTP/3 uses the complete QPACK content-type entry',()=>{
  for(const version of ['1.1','2.0','3.0']) {
    const r=call('/','br','GET',version);
    assert.equal(r.headersOut['Content-Type'],version==='3.0'?'text/html; charset=utf-8':'text/html');
    assert.deepEqual(r.body,readFileSync('public/index.html.br'));
  }
});

const buildFixture=Buffer.from('<!DOCTYPE html><title>Build fixture</title><p>'+Array.from({length:24},(_,i)=>'Paragraph '+i+': the precompressed response must decode to the current document.').join('<p>'));
const fixtureBrotli=quality=>brotliCompressSync(buildFixture,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:quality}});
const fixtureStock=fixtureBrotli(1),fixtureSmaller=fixtureBrotli(11),fixtureLarger=fixtureBrotli(0);
function runBuildFixture(t,candidate,gzipCandidate,source=buildFixture,prepare=()=>{}) {
  const directory=mkdtempSync(join(tmpdir(),'onekb-build-test-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  writeFileSync(join(directory,'index.html'),source);
  writeFileSync(join(directory,'build.mjs'),readFileSync(new URL('../build.mjs',import.meta.url)));
  writeFileSync(join(directory,'stock.br'),source.equals(buildFixture) ? fixtureStock : brotliCompressSync(source,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:1}}));
  mkdirSync(join(directory,'compression'));
  writeFileSync(join(directory,'compression/index.html.br'),candidate);
  if(gzipCandidate !== undefined) writeFileSync(join(directory,'compression/index.html.gz'),gzipCandidate);
  // Keep the stock search deterministic and fast; candidate decoding, output
  // generation and all other compression use the real Node implementations.
  writeFileSync(join(directory,'stock-encoder.mjs'),`import zlib from 'node:zlib';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const stock=readFileSync(new URL('./stock.br',import.meta.url));
zlib.brotliCompressSync=()=>stock;
syncBuiltinESMExports();
`);
  prepare(directory);
  const result=spawnSync(process.execPath,['--import',join(directory,'stock-encoder.mjs'),'build.mjs'],{cwd:directory,encoding:'utf8'});
  return {directory,...result};
}
function assertStockBuild(result) {
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(readFileSync(join(result.directory,'build-report.json')));
  assert.equal(report.brotliSource,'node:zlib');
  assert.notEqual(report.brotliParams,null);
  assert.equal(report.brotli,fixtureStock.length);
  assert.deepEqual(readFileSync(join(result.directory,'public/index.html.br')),fixtureStock);
}
test('precompressed Brotli accepts a smaller exact match and reports its source',t=>{
  assert(fixtureSmaller.length<fixtureStock.length);
  const result=runBuildFixture(t,fixtureSmaller);
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(readFileSync(join(result.directory,'build-report.json')));
  assert.equal(report.brotliSource,'compression/index.html.br');
  assert.equal(report.brotliParams,null);
  assert.equal(report.brotli,fixtureSmaller.length);
  assert.equal(report.attempts,5988);
  const output=readFileSync(join(result.directory,'public/index.html.br'));
  assert.deepEqual(output,fixtureSmaller);
  assert.deepEqual(brotliDecompressSync(output),buildFixture);
});

test('the generated preload map contains exactly the four emitted representations',t=>{
  const result=runBuildFixture(t,fixtureSmaller);
  assert.equal(result.status,0,result.stderr);
  const preloaded=JSON.parse(readFileSync(join(result.directory,'public/representations.json')));
  assert.deepEqual(Object.keys(preloaded).sort(),['br','deflate','gzip','identity']);
  for(const [encoding,suffix] of [['br','.br'],['gzip','.gz'],['deflate','.deflate'],['identity','']]) {
    const bytes=readFileSync(join(result.directory,'public/index.html'+suffix));
    assert.equal(preloaded[encoding],bytes.toString('base64'));
    assert.deepEqual(Buffer.from(preloaded[encoding],'base64'),bytes);
  }
});

test('build output paths cannot overwrite source, script or compression inputs',t=>{
  for(const [input,output] of [
    ['index.html','public/index.html.br'],['build.mjs','public/representations.json'],
    ['compression/index.html.br','public/index.html.br'],['compression/index.html.gz','public/index.html.gz'],
    ['index.html','build-report.json']
  ]) for(const link of [symlinkSync,linkSync]) {
    let before;
    const result=runBuildFixture(t,fixtureStock,gzipSync(buildFixture),buildFixture,directory=>{
      mkdirSync(join(directory,'public'));
      before=readFileSync(join(directory,input));
      link(join(directory,input),join(directory,output));
    });
    assert.notEqual(result.status,0,input+' via '+output);
    assert.match(result.stderr,/must not overwrite/);
    assert.deepEqual(readFileSync(join(result.directory,input)),before);
    assert.equal(existsSync(join(result.directory,'public/index.html')),false);
  }
});

test('build outputs cannot alias one another before any output is published',t=>{
  for(const link of [symlinkSync,linkSync]) {
    const result=runBuildFixture(t,fixtureStock,undefined,buildFixture,directory=>{
      mkdirSync(join(directory,'public'));
      const output=join(directory,'public/index.html');
      if(link===linkSync)writeFileSync(output,'previous build output');
      link(output,join(directory,'build-report.json'));
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/must not overwrite/);
    assert.equal(existsSync(join(result.directory,'public/index.html.br')),false);
    if(link===linkSync)assert.equal(readFileSync(join(result.directory,'public/index.html'),'utf8'),'previous build output');
    else assert.equal(existsSync(join(result.directory,'public/index.html')),false);
  }
});
test('precompressed Brotli ignores a smaller stale document',t=>{
  const stale=brotliCompressSync(Buffer.from('<!DOCTYPE html><title>Old revision</title>'));
  assert(stale.length<fixtureStock.length);
  assertStockBuild(runBuildFixture(t,stale));
});
test('precompressed Brotli rejects malformed input with its path',t=>{
  const result=runBuildFixture(t,Buffer.from([0xff]));
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Invalid Brotli candidate: compression\/index\.html\.br/);
  assert.equal(existsSync(join(result.directory,'build-report.json')),false);
  assert.equal(existsSync(join(result.directory,'public')),false);
});
test('precompressed Brotli ignores a larger exact match',t=>{
  assert(fixtureLarger.length>fixtureStock.length);
  assertStockBuild(runBuildFixture(t,fixtureLarger));
});
test('precompressed Brotli keeps stock provenance when the size ties',t=>{
  assertStockBuild(runBuildFixture(t,fixtureStock));
});

test('precompressed Brotli rejects trailing bytes before publishing output',t=>{
  const candidate=Buffer.concat([fixtureSmaller,Buffer.from([0])]);
  assert.deepEqual(brotliDecompressSync(candidate),buildFixture);
  const result=runBuildFixture(t,candidate);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Invalid Brotli candidate: compression\/index\.html\.br/);
  assert.equal(existsSync(join(result.directory,'public')),false);
});

test('precompressed gzip rejects incomplete, padded and multi-member streams',t=>{
  const valid=gzipSync(buildFixture);
  const named=Buffer.concat([valid.subarray(0,3),Buffer.from([8]),valid.subarray(4,10),Buffer.from('page.html\0'),valid.subarray(10)]);
  for(const candidate of [Buffer.from([0xff]),valid.subarray(0,-1),
    Buffer.concat([valid,Buffer.from([0])]),
    Buffer.concat([valid,gzipSync(Buffer.alloc(0))]),named]) {
    const result=runBuildFixture(t,fixtureStock,candidate);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Invalid gzip candidate: compression\/index\.html\.gz/);
    assert.equal(existsSync(join(result.directory,'public')),false);
  }
});

test('a valid stale gzip file remains harmless after shortening the page',t=>{
  const longer=Buffer.concat([buildFixture,Buffer.from(' Old text that has since been removed.')]);
  const result=runBuildFixture(t,fixtureStock,gzipSync(longer));
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(gunzipSync(readFileSync(join(result.directory,'public/index.html.gz'))),buildFixture);
  assert.deepEqual(inflateSync(readFileSync(join(result.directory,'public/index.html.deflate'))),buildFixture);
});


test('build rejects literal Unicode before compact headers can misdecode it',t=>{
  for(const text of ['Café','I’m','nonbreaking\u00a0space','\ufeffBOM']) {
    const source=Buffer.concat([buildFixture,Buffer.from(text)]);
    const result=runBuildFixture(t,fixtureStock,undefined,source);
    assert.notEqual(result.status,0,text);
    assert.match(result.stderr,/source must be ASCII; use character references/);
    assert.equal(existsSync(join(result.directory,'public')),false);
    assert.deepEqual(readFileSync(join(result.directory,'index.html')),source);
  }
});

test('build rejects non-HTML controls that JavaScript whitespace might erase',t=>{
  for(const byte of [0,11,27,127]) {
    const source=Buffer.concat([buildFixture,Buffer.from([byte])]);
    const result=runBuildFixture(t,fixtureStock,undefined,source);
    assert.notEqual(result.status,0,String(byte));
    assert.match(result.stderr,/non-HTML control characters/);
    assert.equal(existsSync(join(result.directory,'public')),false);
  }
});

test('ASCII character references and HTML whitespace survive every build representation',t=>{
  const source=Buffer.concat([buildFixture,Buffer.from('<p>Caf&#233; &rsquo; &#x1f600;\t\n\f\r')]);
  const result=runBuildFixture(t,fixtureStock,undefined,source);
  assert.equal(result.status,0,result.stderr);
  for(const [suffix,decode] of [['',value=>value],['.br',brotliDecompressSync],['.gz',gunzipSync],['.deflate',inflateSync]])
    assert.deepEqual(decode(readFileSync(join(result.directory,'public/index.html'+suffix))),source);
});
