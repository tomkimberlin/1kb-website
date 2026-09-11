import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,constants as c} from 'node:zlib';
const data=readFileSync('index.html');
// The page promises less than 1 KB even before compression (decimal kilobytes).
if(data.length>=1000)throw Error('The under-1-KB claim no longer holds');
new TextDecoder('utf-8',{fatal:true}).decode(data);
let best;
let attempts=0;
for(let quality=0;quality<=11;quality++) for(let mode=0;mode<=2;mode++) for(let window=10;window<=24;window++) for(const hint of [0,data.length]) {
 const params={[c.BROTLI_PARAM_QUALITY]:quality,[c.BROTLI_PARAM_MODE]:mode,[c.BROTLI_PARAM_LGWIN]:window,[c.BROTLI_PARAM_SIZE_HINT]:hint};
 const compressed=brotliCompressSync(data,{params});attempts++;
 if(!best||compressed.length<best.data.length)best={data:compressed,params};
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
if(!brotliDecompressSync(best.data).equals(data)||!gunzipSync(gzip).equals(data))throw Error('Compression round trip failed');
mkdirSync('public',{recursive:true});
writeFileSync('public/index.html',data);
writeFileSync('public/index.html.br',best.data);
writeFileSync('public/index.html.gz',gzip);
const report={html:data.length,brotli:best.data.length,gzip:gzip.length,attempts,brotliParams:best.params};
writeFileSync('build-report.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
