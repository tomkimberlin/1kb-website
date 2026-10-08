# 1kb website

My personal page at [tomkimberlin.com](https://tomkimberlin.com/), and an experiment in HTTPS delivery overhead. One HTML document carries the text, CSS and direct links, with native light/dark styling and no scripts or font downloads.

Certificates and connection setup cost more than the page itself. Precompressed bodies and patched nginx/OpenSSL builds reduce those bytes while preserving certificate validation and connection reuse. I built the original page years ago; Astra helped optimize it. [How it works](OPTIMIZATION.md).

## Measurements

**Delivery overhead = measured traffic − the entire encoded page body.** Useful content growth does not itself count as added overhead. Each test defines its client and stopping point; framing can still vary with body length.

This site had the lowest overhead in the [six-site September 22, 2026 sample](COMPARISON.md). The [October 5 own-site check](measurements/overhead-20261005.json) found unchanged HTTP/2 plaintext overhead of **105 B**; it did not rescan the peers.

DebugBear measures a narrower response counter:

| Measurement | Published September 22, 2026 | Published October 5, 2026 |
| --- | ---: | ---: |
| DebugBear page weight | 400 B | **472 B** |
| DebugBear counter minus Brotli body | 81 B | **81 B** |
| Brotli response body | 319 B | **391 B** |
| Gzip response body | 471 B | 536 B |
| Deflate response body | 459 B | 524 B |
| Raw HTML | 746 B | 1,021 B |

The [October 5 report](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview) and [saved evidence](measurements/debugbear-20261005.json) confirm the [1KB Club limit](https://1kb.club/submit/) is met. The 72 B increase is in the body; the 81 B residual is unchanged. That residual is neither literal header length nor full connection overhead. Direct links cost 65 Brotli bytes over the 326 B alias version, avoiding an uncached redirect per click. [Historical results and experiments](OPTIMIZATION.md#actual-october-5-scanner-check).

## Build

Requires Node.js 22+ with npm, curl, `sh` and Bash:

```sh
npm ci
npm test
npm run check
npm run check:measurements
```

`index.html` is the source; the build writes four representations and nginx's preload snapshot to `public/`, plus [build-report.json](build-report.json). Keep source ASCII and use character references for Unicode. The 128 B response allowance is a build budget. The measurement check validates [saved evidence](measurements/page-20261005-direct-links-local.json), not a new live result.

Optional browser comparisons need Playwright (`npm install --no-save --package-lock=false playwright`) and Chromium/WebKit (`npx playwright install chromium webkit`). Save the original HTML before editing, then run `npm run test:browser -- --baseline PATH_TO_ORIGINAL_HTML`. Python optimizer tests (`npm run test:optimizers`) need Python 3.

## Hosting

nginx runs directly on an Unraid/Docker host; Cloudflare provides DNS only. This control requires maintaining the server and patches, with availability tied to home power and connectivity. See [hosting and rollback](server/README.md) and [protocol verification](TRANSPORT.md#verification). GitHub pushes do not deploy the site.
