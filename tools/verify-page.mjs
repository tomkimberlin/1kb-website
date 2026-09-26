// Compare equivalent HTML in real browsers. Requires Playwright and its browsers.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, statSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve, join} from 'node:path';
import {parseArgs} from 'node:util';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

const {values} = parseArgs({options: {
  baseline: {type: 'string'}, candidate: {type: 'string', default: 'index.html'},
  out: {type: 'string', default: 'optimization/browser'},
  'playwright-module': {type: 'string', default: 'playwright'},
  // A single existing matrix case keeps adversarial regression fixtures focused.
  case: {type: 'string'},
}});
assert(values.baseline, 'Usage: node tools/verify-page.mjs --baseline ORIGINAL.html [--candidate index.html]');
const matrix=['chromium','webkit'].flatMap(engine=>[320,402,768,1440].flatMap(width=>['light','dark'].map(theme=>({engine,width,theme,name:`${engine}-${width}-${theme}`}))));
assert(!values.case || matrix.some(entry=>entry.name===values.case),'Unknown browser matrix case: '+values.case);
const selected=values.case ? matrix.filter(entry=>entry.name===values.case) : matrix;
const sources=Object.fromEntries(['baseline','candidate'].map(name=>[name,readFileSync(values[name])]));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=resolve(values.out);
const verifierPath=fileURLToPath(import.meta.url);
const handlerPath=fileURLToPath(new URL('../server/site.js',import.meta.url));
const protectedPaths=new Set([values.baseline,values.candidate,verifierPath,handlerPath].map(path=>resolve(path)));
const inode=stat=>`${stat.dev}:${stat.ino}`;
const protectedInodes=new Set([...protectedPaths].map(path=>inode(statSync(path))));
const outputInodes=new Set();
const outputNames=['report.json',...selected.flatMap(({name})=>['baseline','candidate'].flatMap(version=>[
 `${name}-${version}.png`,...Array.from({length:9},(_,index)=>`${name}-${version}-focus-${index+1}.png`)]))];
for(const name of outputNames) {
 const path=join(output,name);
 const stat=lstatSync(path,{throwIfNoEntry:false});
 if(stat?.isSymbolicLink())throw Error('Browser output must not be a symbolic link: '+name);
 if(stat&&!stat.isFile())throw Error('Browser output must be a regular file: '+name);
 if(protectedPaths.has(path)||stat&&protectedInodes.has(inode(stat)))
  throw Error('Browser output must not overwrite an input or source: '+name);
 if(stat) {
  const key=inode(stat);
  if(outputInodes.has(key))throw Error('Browser outputs must not alias each other: '+name);
  outputInodes.add(key);
 }
}
mkdirSync(output,{recursive:true});
const verifierSha256=sha256(readFileSync(new URL(import.meta.url)));


// Resolve aliases through the actual handler, including each Enter probe below.
const handlerSource=readFileSync(new URL('../server/site.js',import.meta.url));
const handlerSha256=sha256(handlerSource);
const code=handlerSource.toString('utf8')
 .replace('export default {serve, headers};','({serve, headers});');
// Short-link redirects must not require filesystem access or page data.
const handler=runInNewContext(code,{});
function destination(href) {
 assert.match(href,/^[a-z]$/,'Each anchor must retain a one-character relative path');
 const request={method:'GET',uri:'/'+href,variables:{scheme:'https',host:'tomkimberlin.com'},headersOut:{},sendHeader(){},finish(){}};
 handler.serve(request);
 assert.equal(request.status,301,'Unrecognized short link: '+href);
 return request.headersOut.Location;
}

let serverRequests=[];
const server=createServer((request,response)=>{
 serverRequests.push(request.url);
 const url=new URL(request.url,'http://localhost');
 const source=sources[url.searchParams.get('version')];
 if(url.pathname!=='/' || !source) {response.writeHead(404).end();return;}
 // Match HTTP/1 and HTTP/2's deployed charset behavior, including entities.
 response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(source);
});
const cases=[];

async function snapshot(page) {
 return page.evaluate(()=>{
  const rect=r=>[r.x,r.y,r.width,r.height];
  const properties=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor',
   'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft',
   'maxWidth','colorScheme','outlineStyle','outlineWidth'];
  // HTML collapses ASCII whitespace; NBSP and other Unicode spaces remain content.
  const clean=text=>text.replace(/[\t\n\f\r ]+/g,' ').replace(/^ +| +$/g,'');
  const comments=[];
  const walker=document.createTreeWalker(document,NodeFilter.SHOW_COMMENT);
  while(walker.nextNode()) comments.push(walker.currentNode.data);
  const inlineHandlers=[...document.querySelectorAll('*')].flatMap(element=>[...element.attributes]
   .filter(attribute=>/^on/i.test(attribute.name)).map(attribute=>({tag:element.tagName,attribute:attribute.name})));
  return {
   title:document.title,mode:document.compatMode,scripts:document.scripts.length,inlineHandlers,
   embeddedContexts:document.querySelectorAll('iframe,frame,object,embed').length,
   text:clean(document.body.innerText),comments,
   viewport:[...document.querySelectorAll('meta[name=viewport]')].map(element=>element.content),
   icons:[...document.querySelectorAll('link')].map(element=>({rel:element.rel,href:element.getAttribute('href')})),
   overflow:document.documentElement.scrollWidth>innerWidth,
   nodes:[...document.querySelectorAll('html,body,h1,p,a')].map(element=>{
    const css=getComputedStyle(element);
    return {tag:element.tagName,rect:rect(element.getBoundingClientRect()),fragments:[...element.getClientRects()].map(rect),style:Object.fromEntries(properties.map(key=>[key,css[key]]))};
   }),
   links:[...document.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.getAttribute('href'),target:a.target,
    download:a.getAttribute('download'),ping:a.ping,rel:a.rel,referrerPolicy:a.referrerPolicy,contentEditable:a.contentEditable})),
  };
 });
}

async function focusedSnapshot(page) {
 return page.evaluate(()=>{
  const active=document.activeElement;
  const css=getComputedStyle(active);
  const rect=r=>[r.x,r.y,r.width,r.height];
  return {tag:active.tagName,href:active.getAttribute('href'),visible:active.matches(':focus-visible'),
   rect:rect(active.getBoundingClientRect()),fragments:[...active.getClientRects()].map(rect),
   style:Object.fromEntries([...css].map(property=>[property,css.getPropertyValue(property)]))};
 });
}

try {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const playwright=await import(values['playwright-module']);
 for(const engine of ['chromium','webkit']) {
  const entries=selected.filter(entry=>entry.engine===engine);
  if(!entries.length) continue;
  const browser=await playwright[engine].launch();
  // https://support.apple.com/guide/safari/cpsh003/mac
  const focusKey=engine==='webkit' && process.platform==='darwin' ? 'Alt+Tab' : 'Tab';
  try {
   for(const {width,theme,name} of entries) {
    const results={};
    for(const version of ['baseline','candidate']) {
     const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,isMobile:width<=402,hasTouch:width<=402});
     try {
      const page=await context.newPage();
      const errors=[],observed=[],unexpected=[],activations=[];
      let probe=null;
      const documentUrl=`${origin}/?version=${version}`;
      page.on('pageerror',error=>errors.push(error.message));
      // The browser observes every origin; a local server log alone misses remote assets.
      context.on('request',request=>observed.push({url:request.url(),method:request.method(),type:request.resourceType()}));
      await context.route('**/*',async route=>{
       const request=route.request();
       if(request.url()===documentUrl && request.method()==='GET' && request.isNavigationRequest()) {await route.continue();return;}
       if(probe && request.url()===`${origin}/${probe.href}` && request.method()==='GET' && request.isNavigationRequest()) {
        const current=probe;probe=null;
        const actual=destination(new URL(request.url()).pathname.slice(1));
        activations.push(actual);
        // A 204 verifies native Enter activation while keeping this document open.
        // The real redirect destination is checked without contacting it.
        await route.fulfill({status:204,body:''});
        current.resolve(actual);
        return;
       }
       unexpected.push(request.url());
       if(probe) {probe.reject(new Error(name+' unexpected keyboard request: '+request.url()));probe=null;}
       await route.abort('blockedbyclient');
      });
      serverRequests=[];
      const response=await page.goto(documentUrl,{waitUntil:'networkidle'});
      assert.equal(response.status(),200);
      assert.deepEqual(unexpected,[],name+' unexpected requests (blocked before sending)');
      assert.deepEqual(observed,[{url:documentUrl,method:'GET',type:'document'}],name+' page load requests');
      const state=await snapshot(page);
      assert.equal(state.mode,'CSS1Compat',name);
      assert.equal(state.overflow,false,name+' horizontal overflow');
      assert.equal(state.links.length,9,name);
      assert.equal(state.scripts,0,name+' unexpected script elements');
      assert.deepEqual(state.inlineHandlers,[],name+' unexpected inline event handlers');
      assert.equal(state.embeddedContexts,0,name+' unexpected embedded browsing contexts');
      assert.deepEqual(state.icons,[{rel:'icon',href:'data:,'}],name+' favicon or extra resource links');
      const links=state.links;
      state.links=links.map(({href,...link})=>({...link,destination:destination(href)}));
      const png=await page.screenshot({fullPage:true});
      writeFileSync(join(output,`${name}-${version}.png`),png);
      if(version==='candidate') {
       assert.deepEqual(state,results.baseline.state,name+' content or layout changed');
       assert(png.equals(results.baseline.png),name+' pixels changed');
      }
      const focus=[];
      for(let index=0;index<links.length;index++) {
       await page.keyboard.press(focusKey);
       const active=await focusedSnapshot(page);
       assert.equal(active.tag,'A',name+' keyboard navigation');
       assert.equal(active.visible,true,name+' focus-visible state');
       const target=destination(active.href);
       assert.equal(target,state.links[index].destination,name+' keyboard order');
       const focusedPng=await page.screenshot({fullPage:true});
       writeFileSync(join(output,`${name}-${version}-focus-${index+1}.png`),focusedPng);
       const focused={...active,href:undefined,destination:target,png:focusedPng};
       focus.push(focused);
       if(version==='candidate') {
        const {png:before,...beforeState}=results.baseline.focus[index];
        const {png:after,...afterState}=focused;
        assert.deepEqual(afterState,beforeState,name+' focused appearance changed at link '+(index+1));
        assert(after.equals(before),name+' focused pixels changed at link '+(index+1));
       }
       let timer;
       const activated=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new Error(name+' keyboard Enter did not activate link '+(index+1))),3000);
        probe={href:active.href,resolve,reject};
       });
       try {
        const [,actual]=await Promise.all([page.keyboard.press('Enter'),activated]);
        assert.equal(actual,target,name+' activated redirect destination');
       } finally {clearTimeout(timer);probe=null;}
       assert.equal(page.url(),documentUrl,name+' Enter probe changed the document');
      }
      assert.deepEqual(errors,[],name+' script errors');
      assert.deepEqual(unexpected,[],name+' unexpected requests (blocked before sending)');
      assert.equal(observed.length,1+links.length,name+' page load plus deliberate Enter probes');
      assert.deepEqual(serverRequests,[`/?version=${version}`],name+' unexpected local server requests');
      assert.deepEqual(activations,state.links.map(link=>link.destination),name+' keyboard activation destinations');
      results[version]={state,png,focus,activations};
     } finally {await context.close();}
    }
    assert.deepEqual(results.candidate.activations,results.baseline.activations,name+' activated destinations changed');
    cases.push({engine,browserVersion:browser.version(),width,theme,mobile:width<=402,identicalPixels:true,
     identicalContentAndGeometry:true,keyboardLinks:9,focusKey,identicalFocusedPixels:9,keyboardEnterDestinations:9,
     pageLoadRequests:1,keyboardProbeRequests:9,unexpectedRequests:0,externalRequestsBlocked:true});
    console.log(name+': identical pixels, content, geometry, focused appearance and Enter destinations; one page-load request');
   }
  } finally {await browser.close();}
 }
 const report={measuredAt:new Date().toISOString(),verifierSha256,handlerSha256,scope:'Local browser equivalence; all unexpected requests are blocked. Enter probes receive local 204 responses after checking the actual redirect handler. No public deployment or network-weight measurement.',
  baseline:{htmlBytes:sources.baseline.length,htmlSha256:sha256(sources.baseline)},
  candidate:{htmlBytes:sources.candidate.length,htmlSha256:sha256(sources.candidate)},cases};
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`${cases.length} browser comparisons passed; report: ${join(output,'report.json')}`);
} finally {if(server.listening) await new Promise(resolve=>server.close(resolve));}
