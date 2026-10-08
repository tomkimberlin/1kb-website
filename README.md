# 1kb website

My personal page at [tomkimberlin.com](https://tomkimberlin.com/), and an experiment in HTTPS delivery overhead. One HTML document carries the text, CSS and direct links, with native light/dark styling and no scripts or font downloads.

Certificates and connection setup cost more than the page itself. Precompressed bodies and patched nginx/OpenSSL builds reduce those bytes while preserving certificate validation and connection reuse. I built the original page years ago; Astra helped optimize it. [How it works](OPTIMIZATION.md).

## Delivery overhead

**Delivery overhead = measured traffic − the entire encoded page body.**

**Latest verified result: 6,945 B estimated overhead, October 5, 2026.** Median of three cold first-document exchanges, counting IPv4 TCP/IP traffic through connection close plus DNS queries to the selected resolver, in both directions, then subtracting each response's complete encoded body. [Measurement and methodology](measurements/overhead-20261005.json).

<details>
<summary>Current page sizes and 1KB Club qualification</summary>

| Measurement | Scope | Verified October 5, 2026 |
| --- | --- | ---: |
| DebugBear page weight | Encoded-response counter | 472 B |
| Brotli response body | Encoded page body | 391 B |
| Gzip response body | Encoded page body | 536 B |
| Deflate response body | Encoded page body | 524 B |
| Raw HTML | Decoded page | 1,021 B |

The [saved report](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview) and [scan evidence](measurements/debugbear-20261005.json) confirm the [1KB Club limit](https://1kb.club/submit/) is met.

</details>

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
