// Offline subprocess fixture: never launch curl or contact any origin.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

const root=process.env.ONEKB_VERIFY_FIXTURE;
const scenario=process.env.ONEKB_VERIFY_SCENARIO;
const source=readFileSync(join(root,'server/site.js'),'utf8')
 .replace('export default {serve, headers};','globalThis.site={serve,headers};');
const context={Buffer,onekbRepresentations:JSON.parse(readFileSync(join(root,'public/representations.json')))};
runInNewContext(source,context);
function response(url,args) {
 const method=args.includes('-I')?'HEAD':args.includes('-X')?args[args.indexOf('-X')+1]:'GET';
 const http2=args.includes('--http2')&&url.protocol==='https:';
 const request={method,uri:url.pathname,httpVersion:http2?'2.0':'1.1',
  variables:{scheme:url.protocol.slice(0,-1),host:url.hostname,request_uri:url.pathname+url.search,is_args:url.search?'?':'',args:url.search.slice(1)},
  headersIn:{'Accept-Encoding':args[args.indexOf('-H')+1]?.replace(/^Accept-Encoding: /,'')||''},headersOut:{},status:0,
  sendHeader(){},finish(){},return(status,body){this.status=status;this.body=body;this.headersOut['Content-Length']=String(body.length);}};
 context.site.serve(request);context.site.headers(request);
 let fields=Object.entries(request.headersOut);
 if(scenario!=='missing-date') fields.push(['Date',scenario==='invalid-date'?'Invalid Date':'Sat, 26 Sep 2026 01:00:00 GMT']);
 if(scenario==='duplicate-encoding'&&fields.some(([name])=>name==='Content-Encoding')) fields.unshift(['Content-Encoding','gzip']);
 if(scenario==='duplicate-location'&&request.status===301) {
  const other=['lOcAtIoN','https://unexpected.invalid/'];
  if(url.hostname==='tom.kimberlin.net') fields.push(other); else fields.unshift(other);
 }
 if(scenario==='missing-content-type') fields=fields.filter(([name])=>name!=='Content-Type');
 if(scenario==='follow-wrong-status'&&url.hostname==='tomkimberlin.com') request.status=201;
 if(scenario==='follow-wrong-encoding'&&url.hostname==='tomkimberlin.com') fields=fields.map(([name,value])=>[name,name==='Content-Encoding'?'gzip':value]);
 const header=`HTTP/${http2?'2':'1.1'} ${request.status}\r\n${fields.map(([name,value])=>`${name}: ${value}\r\n`).join('')}\r\n`;
 return {header,body:method==='HEAD'?Buffer.alloc(0):Buffer.from(request.body||'')};
}
childProcess.execFileSync=(command,args)=>{
 if(command!=='curl') throw new Error('The offline fixture may only intercept curl');
 appendFileSync(join(root,'calls.jsonl'),JSON.stringify(args)+'\n');
 if(scenario==='direct-request') {
  if(args[0]!=='-q'||args[args.indexOf('--noproxy')+1]!=='*') throw new Error('The verifier must disable curlrc and proxy routing');
 }
 const url=new URL(args.find(value=>/^https?:\/\//.test(value)));
 const initial=response(url,args);
 let header=initial.header,body=initial.body;
 if(args.some(arg=>arg==='-fsSL'||arg==='--location'||arg==='-L')) {
  const followed=response(new URL('https://tomkimberlin.com/'),args);
  header+=followed.header;body=followed.body;
 }
 if(scenario==='informational') header='HTTP/1.1 103 Early Hints\r\nLink: </unused>; rel=preload\r\n\r\n'+header;
 const dump=args.indexOf('--dump-header');
 if(dump>=0) writeFileSync(args[dump+1],header);
 if(args.includes('-i')||(args.includes('-I')&&!args.includes('--no-include'))) return Buffer.concat([Buffer.from(header),body]);
 return body;
};
syncBuiltinESMExports();
