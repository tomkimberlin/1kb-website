import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {curlResponse} from './verify-response.mjs';

const alias='tom.kimberlin.net';
const resolve=process.env.ONEKB_ALIAS_IP?['--resolve',`${alias}:443:${process.env.ONEKB_ALIAS_IP}`,'--resolve',`${alias}:80:${process.env.ONEKB_ALIAS_IP}`]:[];
let checks=0;
for(const protocol of ['--http1.1','--http2'])for(const scheme of ['http','https'])for(const path of ['/','/p','/?from=alias&check=1']) {
  const response=curlResponse([protocol,...resolve,`${scheme}://${alias}${path}`]);
  assert.equal(response.status,301);
  assert.equal(response.headers.location,`https://tomkimberlin.com${path}`);
  assert.equal(response.body.length,0,'Alias redirects must have an empty body');
  const names=Object.keys(response.headers);
  assert(!names.some(name=>/^(server|alt-svc|cf-.*|nel|report-to|server-timing|content-type)$/.test(name)),`Unexpected response headers: ${names.join(', ')}`);
  if(protocol==='--http2'&&scheme==='https') {
    assert.equal(response.version,'2');
    assert.equal(response.headers['content-length'],undefined);
  } else assert.equal(response.headers['content-length'],'0');
  checks++;
}
const followed=curlResponse([...resolve,'-H','Accept-Encoding: br',`https://${alias}/`],{follow:true});
assert.equal(followed.responses.length,2,'The alias must redirect once to the canonical page');
assert.equal(followed.responses[0].status,301);
assert.equal(followed.responses[0].headers.location,'https://tomkimberlin.com/');
assert.equal(followed.status,200);
assert.equal(followed.headers['content-encoding'],'br');
assert.equal(followed.headers['content-type'],'text/html');
assert.equal(followed.headers.vary,'accept-encoding');
assert.equal(followed.headers['cache-control'],'max-age=86400');
assert.deepEqual(followed.body,readFileSync(new URL('../public/index.html.br',import.meta.url)));
console.log(`${checks} alias redirect checks passed (all with empty bodies); following HTTPS returned the exact Brotli page.`);
