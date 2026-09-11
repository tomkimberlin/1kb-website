import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const alias='tom.kimberlin.net';
const resolve=process.env.ONEKB_ALIAS_IP?['--resolve',`${alias}:443:${process.env.ONEKB_ALIAS_IP}`,'--resolve',`${alias}:80:${process.env.ONEKB_ALIAS_IP}`]:[];
let checks=0;
for(const protocol of ['--http1.1','--http2'])for(const scheme of ['http','https'])for(const path of ['/','/p','/?from=alias&check=1']) {
  const data=execFileSync('curl',['-fsS','--max-time','20',protocol,...resolve,'-i',`${scheme}://${alias}${path}`]);
  const split=data.indexOf('\r\n\r\n');
  assert(split>=0);
  const header=data.subarray(0,split).toString();
  assert.match(header,/^HTTP\/\S+ 301/);
  assert.equal(header.match(/^location:\s*(.+)$/im)?.[1].trim(),`https://tomkimberlin.com${path}`);
  assert.equal(data.subarray(split+4).length,0,'Alias redirects must have an empty body');
  assert.doesNotMatch(header,/^(server|alt-svc|cf-[^:]*|nel|report-to|server-timing|content-type):/im);
  if(protocol==='--http2'&&scheme==='https') {
    assert.match(header,/^HTTP\/2 301/);
    assert.doesNotMatch(header,/^content-length:/im);
  }
  checks++;
}
const body=execFileSync('curl',['-fsSL','--max-time','20',...resolve,'-H','Accept-Encoding: br',`https://${alias}/`]);
assert.deepEqual(body,readFileSync(new URL('../public/index.html.br',import.meta.url)));
console.log(`${checks} alias redirect checks passed (all with empty bodies); following HTTPS returned the exact Brotli page.`);
