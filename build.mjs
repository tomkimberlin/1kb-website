import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,inflateSync,constants as c} from 'node:zlib';
const data=readFileSync('index.html');
// 1KB Club measures transferred bytes, including response headers, not raw HTML.
// Reserve 128 bytes for response headers/framing; the measured HTTP/2 cost is 81.
// Confirm the published page with the club's linked DebugBear scanner as well.
const limit=1024, overheadAllowance=128;
new TextDecoder('utf-8',{fatal:true}).decode(data);
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
let gzip;
for(let level=1;level<=9;level++) for(let strategy=0;strategy<=4;strategy++) {
 const compressed=gzipSync(data,{level,strategy});
 if(!gzip||compressed.length<gzip.length)gzip=compressed;
}
if(existsSync('compression/index.html.gz')) {
 const optimized=readFileSync('compression/index.html.gz');
 if(gunzipSync(optimized).equals(data)&&optimized.length<gzip.length)gzip=optimized;
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
const report={html:data.length,brotli:best.data.length,gzip:gzip.length,deflate:deflate.length,attempts,brotliParams:best.params,budget:{limit,overheadAllowance,brotliWithAllowance:best.data.length+overheadAllowance}};
writeFileSync('build-report.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
