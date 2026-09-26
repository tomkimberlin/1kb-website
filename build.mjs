import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,inflateSync,inflateRawSync,constants as c} from 'node:zlib';
// Check every destination before searching or writing. Output symlinks are
// rejected even when dangling; hardlinks must not alias inputs or each other.
const protectedPaths=['index.html',fileURLToPath(import.meta.url),
 'compression/index.html.br','compression/index.html.gz'];
const outputPaths=['public/index.html','public/index.html.br','public/index.html.gz',
 'public/index.html.deflate','public/representations.json','build-report.json'];
for(const path of outputPaths) {
 let output;
 try {output=lstatSync(path);} catch(error) {if(error.code!=='ENOENT')throw error;}
 if(output?.isSymbolicLink())throw Error('Output must not overwrite the input or another file through a symbolic link: '+path);
 if(output && !output.isFile())throw Error('Output must be a regular file: '+path);
 for(const input of protectedPaths) {
  const prior=existsSync(input) ? statSync(input) : null;
  if(resolve(input)===resolve(path) || output && prior && output.dev===prior.dev && output.ino===prior.ino)
   throw Error('Output must not overwrite the input, a build dependency or another output: '+path);
 }
 protectedPaths.push(path);
}
const data=readFileSync('index.html');
// 1KB Club measures transferred bytes, including response headers, not raw HTML.
// Reserve 128 bytes for response headers/framing; the measured HTTP/2 cost is 81.
// Confirm the published page with the club's linked DebugBear scanner as well.
const limit=1024, overheadAllowance=128;
new TextDecoder('utf-8',{fatal:true}).decode(data);
// HTTP/1 and HTTP/2 intentionally omit a charset. Character references keep
// Unicode text identical under those headers and HTTP/3's explicit UTF-8.
if(data.some(byte=>byte>0x7f))
 throw Error('HTML source must be ASCII; use character references for Unicode text');
if(data.some(byte=>byte===0x7f || byte<0x20 && ![9,10,12,13].includes(byte)))
 throw Error('HTML source must not contain non-HTML control characters');
let best;
let attempts=0;
for(let quality=0;quality<=11;quality++) for(let mode=0;mode<=2;mode++) for(let window=10;window<=24;window++) for(const hint of [0,data.length]) {
 const params={[c.BROTLI_PARAM_QUALITY]:quality,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:window,[c.BROTLI_PARAM_SIZE_HINT]:hint};
 const compressed=brotliCompressSync(data,{params});attempts++;
 if(!best||compressed.length<best.data.length)best={data:compressed,params};
}
// Search literal-context and distance-code settings omitted by the defaults.
for(let quality=0;quality<=11;quality++) for(let mode=0;mode<=2;mode++) for(let context=0;context<=1;context++) for(let postfix=0;postfix<=3;postfix++) for(let direct=0;direct<=15<<postfix;direct+=1<<postfix) {
 const params={[c.BROTLI_PARAM_QUALITY]:quality,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:16,[c.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]:context,[c.BROTLI_PARAM_NPOSTFIX]:postfix,[c.BROTLI_PARAM_NDIRECT]:direct};
 const compressed=brotliCompressSync(data,{params});attempts++;
 if(compressed.length<best.data.length)best={data:compressed,params};
}
const advanced=best.params;
for(let window=10;window<=24;window++) for(const block of [0,16,17,18,19,20,21,22,23,24]) for(const hint of [0,data.length]) {
 const params={...advanced,[c.BROTLI_PARAM_LGWIN]:window,[c.BROTLI_PARAM_LGBLOCK]:block,[c.BROTLI_PARAM_SIZE_HINT]:hint};
 const compressed=brotliCompressSync(data,{params});attempts++;
 if(compressed.length<best.data.length)best={data:compressed,params};
}
let brotliSource='node:zlib';
const brotliCandidate='compression/index.html.br';
if(existsSync(brotliCandidate)) {
 const optimized=readFileSync(brotliCandidate);
 let decoded;
 try {
  const result=brotliDecompressSync(optimized,{info:true});
  if(result.engine.bytesWritten!==optimized.length)throw Error('Trailing compressed bytes');
  decoded=result.buffer;
 }
 catch(error) { throw new Error('Invalid Brotli candidate: '+brotliCandidate,{cause:error}); }
 if(decoded.equals(data)&&optimized.length<best.data.length) {
  best={data:optimized,params:null};
  brotliSource=brotliCandidate;
 }
}
let gzip;
for(let level=1;level<=9;level++) for(let strategy=0;strategy<=4;strategy++) {
 const compressed=gzipSync(data,{level,strategy});
 if(!gzip||compressed.length<gzip.length)gzip=compressed;
}
const gzipCandidate='compression/index.html.gz';
if(existsSync(gzipCandidate)) {
 const optimized=readFileSync(gzipCandidate);
 let decoded;
 try {
  const result=gunzipSync(optimized,{info:true});
  // The deflate representation reuses exactly one member's compressed stream.
  if(optimized[3]!==0||result.engine.bytesWritten!==optimized.length)
   throw Error('Expected a gzip member without optional fields or trailing bytes');
  const stream=inflateRawSync(optimized.subarray(10,-8),{info:true});
  if(stream.engine.bytesWritten!==optimized.length-18)throw Error('Expected exactly one gzip member');
  decoded=result.buffer;
 }
 catch(error) { throw new Error('Invalid gzip candidate: '+gzipCandidate,{cause:error}); }
 if(decoded.equals(data)&&optimized.length<gzip.length)gzip=optimized;
}
// HTTP deflate uses a zlib wrapper around the same optimized DEFLATE stream.
if(gzip[3]!==0)throw Error('Unexpected optional gzip fields');
let a=1,b=0;
for(const byte of data){a=(a+byte)%65521;b=(b+a)%65521;}
const checksum=Buffer.alloc(4);checksum.writeUInt32BE((b*65536+a)>>>0);
const deflate=Buffer.concat([Buffer.from([120,218]),gzip.subarray(10,-8),checksum]);
if(!inflateSync(deflate).equals(data))throw Error('Deflate round trip failed');
if(!brotliDecompressSync(best.data).equals(data)||!gunzipSync(gzip).equals(data))throw Error('Compression round trip failed');
if(best.data.length+overheadAllowance>=limit)throw Error('Brotli plus the response framing allowance must stay below 1,024 bytes');
if(gzip.length>=limit)throw Error('The gzip response body must stay below 1,024 bytes');
mkdirSync('public',{recursive:true});
writeFileSync('public/index.html',data);
writeFileSync('public/index.html.br',best.data);
writeFileSync('public/index.html.gz',gzip);
writeFileSync('public/index.html.deflate',deflate);
// njs preloads this immutable object once per nginx configuration load.
writeFileSync('public/representations.json',JSON.stringify(Object.fromEntries(
 Object.entries({br:best.data,deflate,gzip,identity:data}).map(([encoding,body])=>[encoding,body.toString('base64')])
))+'\n');
const report={html:data.length,brotli:best.data.length,gzip:gzip.length,deflate:deflate.length,attempts,brotliParams:best.params,brotliSource,budget:{limit,overheadAllowance,brotliWithAllowance:best.data.length+overheadAllowance}};
writeFileSync('build-report.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
