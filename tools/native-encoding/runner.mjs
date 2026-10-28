import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {closeSync, lstatSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {CODINGS, EXPECTED, loadFixtures, need, sha256} from './fixture.mjs';
import {makeHandler} from './handler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINES = ['chromium', 'webkit'];

async function runNative({bodies, manifestSha256, playwright, playwrightVersion}) {
  const rows = [];
  const serverRequests = [];
  const routes = new Map();
  const nonce = randomUUID();
  const server = createServer(makeHandler({bodies, routes, serverRequests}));
  let browser, context, serverError, failure;
  let cleanupComplete = false;
  try {
    await new Promise((done, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        server.on('error', error => { serverError = error; });
        done();
      });
    });
    const address = server.address();
    need(address && typeof address === 'object' && address.address === '127.0.0.1', 'E_LOOPBACK_ADDRESS');
    for (const engine of ENGINES) {
      browser = await playwright[engine].launch({headless: true, timeout: 20000});
      const browserVersion = browser.version();
      need(typeof browserVersion === 'string' && browserVersion.trim(), `E_BROWSER_VERSION:${engine}`);
      let reference;
      for (const coding of CODINGS) {
        const path = `/${nonce}/${engine}/${coding}`;
        const url = `http://127.0.0.1:${address.port}${path}`;
        routes.set(path, coding);
        let requests = 0, badRequests = 0, failedRequests = 0;
        context = await browser.newContext({
          javaScriptEnabled: false,
          serviceWorkers: 'block',
          extraHTTPHeaders: {'accept-encoding': coding},
        });
        context.on('request', request => {
          requests++;
          if (request.url() !== url || request.method() !== 'GET'
            || request.resourceType() !== 'document' || !request.isNavigationRequest()) badRequests++;
        });
        context.on('requestfailed', () => { failedRequests++; });
        const before = serverRequests.length;
        let decoded, exactDecodedSource, domJson, contentMatchesIdentityControl;
        try {
          const page = await context.newPage();
          const response = await page.goto(url, {waitUntil: 'networkidle', timeout: 10000});
          need(response && response.status() === 200 && response.url() === url
            && page.url() === url && !response.fromServiceWorker(), `E_RESPONSE:${engine}:${coding}`);
          const headers = await response.allHeaders();
          need(headers['content-encoding'] === (coding === 'identity' ? undefined : coding)
            && headers['content-type'] === 'text/html; charset=utf-8'
            && headers['content-length'] === String(bodies[coding].length), `E_RESPONSE_HEADERS:${engine}:${coding}`);
          // Playwright reads the browser's received response body. The server
          // sent the pinned encoded bytes directly, without route interception.
          decoded = await response.body();
          exactDecodedSource = decoded.equals(bodies.identity);
          need(exactDecodedSource, `E_BROWSER_DECODE:${engine}:${coding}`);
          const dom = await page.evaluate(() => ({
            doctype: document.doctype?.name ?? null,
            html: document.documentElement.outerHTML,
            title: document.title,
            text: document.body.textContent,
            links: [...document.querySelectorAll('a')].map(link => link.getAttribute('href')),
            scripts: document.scripts.length,
          }));
          domJson = JSON.stringify(dom);
          if (coding === 'identity') reference = domJson;
          contentMatchesIdentityControl = domJson === reference;
          need(contentMatchesIdentityControl && dom.doctype === 'html' && dom.title === 'Tom Kimberlin'
            && dom.scripts === 0 && dom.links.length === 9, `E_DOCUMENT:${engine}:${coding}`);
        } finally {
          await context.close();
          context = undefined;
        }
        // Capture the request counts only after context closure, including any
        // late page events emitted between network idle and that closure.
        const observed = serverRequests.at(-1);
        const requestedEncodingAdvertised = observed?.acceptEncoding === coding;
        need(requests === 1 && badRequests === 0 && failedRequests === 0
          && serverRequests.length === before + 1 && observed?.expected && observed.path === path
          && observed.coding === coding && requestedEncodingAdvertised
          && observed.encodedBytes === EXPECTED[coding].bytes
          && observed.encodedSha256 === EXPECTED[coding].sha256, `E_REQUESTS:${engine}:${coding}`);
        rows.push({
          engine, browserVersion, encoding: coding,
          encodedBytes: observed.encodedBytes, encodedSha256: observed.encodedSha256,
          htmlBytes: decoded.length, htmlSha256: sha256(decoded),
          exactDecodedSource, contentMatchesIdentityControl, explicitAcceptEncoding: coding,
          requestedEncodingAdvertised, pageDocumentRequests: requests,
          unexpectedPageRequests: badRequests,
          decodedBytes: decoded.length, decodedSha256: sha256(decoded),
          domMatchesIdentityControl: contentMatchesIdentityControl, domSha256: sha256(domJson),
          acceptEncoding: observed.acceptEncoding, pageRequests: requests, failedPageRequests: failedRequests,
          serverRequests: serverRequests.length - before,
        });
        process.stdout.write(JSON.stringify({event: 'case-passed', engine, encoding: coding}) + '\n');
      }
      await browser.close();
      browser = undefined;
    }
    need(!serverError && rows.length === ENGINES.length * CODINGS.length
      && serverRequests.length === rows.length && serverRequests.every(request => request.expected), 'E_CASES');
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    if (context) try { await context.close(); } catch (error) { cleanupErrors.push(error); }
    if (browser) try { await browser.close(); } catch (error) { cleanupErrors.push(error); }
    if (server.listening) {
      try {
        server.closeAllConnections();
        await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      }
      catch (error) { cleanupErrors.push(error); }
    }
    cleanupComplete = cleanupErrors.length === 0 && !server.listening;
    if (serverError && !failure) failure = serverError;
    if (!cleanupComplete && !failure) failure = new AggregateError(cleanupErrors, 'E_CLEANUP');
  }
  if (failure) throw failure;
  need(cleanupComplete, 'E_CLEANUP');
  const sourceSha256 = Object.fromEntries(['runner.mjs', 'fixture.mjs', 'handler.mjs', 'runner.test.mjs'].map(file => [file, sha256(readFileSync(join(HERE, file)))]));
  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    passed: true,
    cleanupComplete,
    runtime: {node: process.version, platform: process.platform, arch: process.arch, playwright: playwrightVersion},
    fixtureManifestSha256: manifestSha256,
    fixtureSourceSha256: sourceSha256['runner.mjs'],
    runnerSourceSha256: sourceSha256['runner.mjs'],
    sourceSha256,
    requestInterception: false,
    javaScriptEnabled: false,
    serviceWorkers: 'block',
    loopbackOnly: true,
    fixtureSelection: 'Each case explicitly selects its route and Accept-Encoding; default plaintext-browser encoding advertisement is not measured.',
    scope: 'Native Chromium/WebKit HTTP Content-Encoding decoding of the pinned local build bodies. This does not establish public traffic, TLS, timing, layout, transfer totals, or deployment behavior.',
    totalServerRequests: serverRequests.length,
    rows,
  };
}

async function main() {
  const {values} = parseArgs({options: {
    run: {type: 'boolean'}, 'check-inputs': {type: 'boolean'}, fixtures: {type: 'string'}, out: {type: 'string'},
  }, strict: true});
  need(Boolean(values.run) !== Boolean(values['check-inputs']) && values.fixtures, 'E_ARGUMENTS');
  need(values.run ? Boolean(values.out) : !values.out, 'E_ARGUMENTS');
  const {bodies, manifestSha256} = loadFixtures(resolve(values.fixtures));
  if (values['check-inputs']) {
    process.stdout.write(JSON.stringify({inputValidationPassed: true, nativeBrowserVerified: false,
      fixtureManifestSha256: manifestSha256,
      bodies: Object.fromEntries(CODINGS.map(coding => [coding, {bytes: bodies[coding].length, sha256: sha256(bodies[coding])}]))}) + '\n');
    return;
  }
  const out = resolve(values.out);
  try { lstatSync(out); throw new Error('E_OUTPUT_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Resolve from the caller's cwd, so a checked-out CI project can install the
  // dependency locally even if this standalone runner resides elsewhere.
  const require = createRequire(join(process.cwd(), '__native_browser__.cjs'));
  const playwright = require('playwright');
  const playwrightVersion = require('playwright/package.json').version;
  need(playwrightVersion === '1.63.0' && ENGINES.every(engine => typeof playwright[engine]?.launch === 'function'), 'E_PLAYWRIGHT_VERSION');
  const deadline = setTimeout(() => {
    process.stderr.write('E_PROCESS_DEADLINE\n');
    process.exit(124);
  }, 120000);
  try {
    const report = await runNative({bodies, manifestSha256, playwright, playwrightVersion});
    const descriptor = openSync(out, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify(report, null, 2) + '\n'); }
    finally { closeSync(descriptor); }
    process.stdout.write(JSON.stringify({passed: true, cases: report.rows.length, cleanupComplete: report.cleanupComplete, output: out}) + '\n');
  } finally {
    clearTimeout(deadline);
  }
}

main().catch(error => {
  process.stderr.write(`${error.code ?? error.message ?? 'E_VERIFICATION'}\n`);
  process.exitCode = 1;
});
