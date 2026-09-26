import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Curl writes each informational/redirect response to the header file and only
// the final body to stdout. Keep binary body bytes out of header parsing.
export function parseResponseHeaders(data) {
 const blocks=data.toString('latin1').split('\r\n\r\n');
 assert(blocks.pop()==='','Incomplete response headers');
 assert(blocks.length>0,'Missing response headers');
 const responses=blocks.map(block=>{
  const lines=block.split('\r\n');
  const statusLine=lines.shift();
  const status=statusLine.match(/^HTTP\/(1\.0|1\.1|2|3) ([1-5]\d\d)(?:[ \t].*)?$/);
  assert(status,'Malformed response status line');
  assert.notEqual(status[2],'101','Protocol upgrades are unexpected');
  const headers=Object.create(null);
  for(const line of lines) {
   const field=line.match(/^([!#$%&'*+.^_`|~\da-z-]+):([^\x00-\x08\x0a-\x1f\x7f]*)$/i);
   assert(field,'Malformed response header');
   const name=field[1].toLowerCase();
   assert(!Object.hasOwn(headers,name),`Duplicate response header: ${name}`);
   headers[name]=field[2].replace(/^[ \t]+|[ \t]+$/g,'');
  }
  return {statusLine,status:Number(status[2]),version:status[1],headers};
 });
 assert(responses.at(-1).status>=200,'Missing final response');
 return responses.filter(response=>response.status>=200);
}

export function curlResponse(args,{follow=false}={}) {
 const directory=mkdtempSync(join(tmpdir(),'onekb-curl-'));
 try {
  const headerPath=join(directory,'headers');
  const body=execFileSync('curl',['-q','-sS','--max-time','20','--noproxy','*',
   ...(follow?['--location','--max-redirs','1','--proto-redir','=https']:[]),...args,
   '--no-include','--dump-header',headerPath]);
  const responses=parseResponseHeaders(readFileSync(headerPath));
  if(!follow) assert.equal(responses.length,1,'Unexpected additional response');
  for(const response of responses) {
   const date=response.headers.date;
   assert(date&&Number.isFinite(Date.parse(date))&&new Date(date).toUTCString()===date,'Missing or invalid Date header');
  }
  return {...responses.at(-1),body,responses};
 } finally {
  rmSync(directory,{recursive:true,force:true});
 }
}
