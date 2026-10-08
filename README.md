# 1kb website

My personal page at [tomkimberlin.com](https://tomkimberlin.com/), and an experiment in HTTPS delivery overhead. One HTML document carries the text, CSS and direct links, with native light/dark styling and no scripts or font downloads.

Certificates and connection setup cost more than the page itself. Precompressed bodies and patched nginx/OpenSSL builds reduce those bytes while preserving certificate validation and connection reuse. I built the original page years ago; Astra helped optimize it. [How it works](OPTIMIZATION.md).

## Delivery overhead

**Delivery overhead = measured traffic − the entire encoded page body.** Text and direct links belong to the body. The goal is to reduce the cost around it; framing can still vary with body length.

| Body-subtracted response measure | September 22, 2026 | October 5, 2026 |
| --- | ---: | ---: |
| HTTP/2 plaintext minus body | **105 B** | **105 B** |
| DebugBear response counter minus Brotli body | **81 B** | **81 B** |

The 72 B increase in DebugBear's total came entirely from its Brotli body growing 319 → 391 B after copy and direct-link updates.

The [HTTP/2 measurement](measurements/overhead-20261005.json) includes headers, control frames and DATA framing. The [DebugBear residual](measurements/debugbear-20261005.json) is a separate counter difference, not literal header length. Neither covers a full connection.

The [cold-connection comparison](COMPARISON.md) separately counts TLS and estimated TCP/IP + DNS traffic in both directions, subtracting each response's body. This site had the lowest overhead in that six-site September 22 sample. October 5 checked this site only; signature and packet variation do not establish a repeatable saving.

<details>
<summary>Page sizes and 1KB Club qualification</summary>

| Measurement | Scope | Published October 5, 2026 |
| --- | --- | ---: |
| DebugBear page weight | Encoded-response counter | 472 B |
| Brotli response body | Encoded page body | 391 B |
| Gzip response body | Encoded page body | 536 B |
| Deflate response body | Encoded page body | 524 B |
| Raw HTML | Decoded page | 1,021 B |

The [saved report](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview) meets the [1KB Club limit](https://1kb.club/submit/). [Historical sizes and experiments](OPTIMIZATION.md#actual-october-5-scanner-check).

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
