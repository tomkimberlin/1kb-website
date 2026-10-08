# 1kb website

My personal page at [tomkimberlin.com](https://tomkimberlin.com/), and an experiment in how few bytes it takes to deliver it over HTTPS. One document contains the text, CSS and direct links, with light/dark appearance and keyboard navigation. No scripts, fonts or other resources need downloading.

The interesting part is outside the HTML. A tiny page still needs headers, certificates and a connection. This project uses precompressed bodies and patched nginx/OpenSSL builds to reduce that cost while preserving certificate validation, protocol behavior and connection reuse. I built the original page years ago; Astra helped with the optimization. [Making a tiny website smaller](OPTIMIZATION.md) explains the work and tradeoffs.

## What the measurements show

**Delivery overhead = measured traffic − the entire encoded page body.** Adding useful content does not itself count against the overhead ranking. Each result names its client and stopping point; body length can still affect framing and packetization.

In the [September 22, 2026 six-site comparison](COMPARISON.md), this website had the lowest overhead in the sample. The [October 5 check](measurements/overhead-20261005.json) repeats three cold connections to this site; it does not rescan the five peers.

| Body-subtracted measurement | September 22 gallery | October 5 current page |
| --- | ---: | ---: |
| TLS through first document, median | 5,251 B | 5,253 B |
| Estimated TCP/IP + DNS through close, median | 6,995 B | 6,945 B |
| HTTP/2 plaintext minus body, every run | 105 B | 105 B |

Both traffic totals count both directions. Their stopping points differ. The TLS change tracks variable CertificateVerify lengths; overlapping packet/DNS ranges do not establish a repeatable saving. HTTP/2 framing is unchanged. These samples subtract their own bodies: 317 B in the gallery and 391 B on October 5.

The narrower DebugBear page-weight counter gives a separate view:

| Measurement | Published September 22, 2026 | Published October 5, 2026 |
| --- | ---: | ---: |
| DebugBear page weight | 400 B | **472 B** |
| DebugBear counter minus Brotli body | 81 B | **81 B** |
| Brotli response body | 319 B | **391 B** |
| Gzip response body | 471 B | 536 B |
| Deflate response body | 459 B | 524 B |
| Raw HTML | 746 B | 1,021 B |

The [original report](https://www.debugbear.com/test/website-speed/SqYs6RrN/overview) and [October 5 report](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview) have [historical](measurements/debugbear-20260922-recovered.json) and [current](measurements/debugbear-20261005.json) evidence. The 72 B increase is entirely in the compressed body; the 81 B residual is unchanged. That residual measures neither literal header length nor the full DNS/TCP/TLS exchange. The September scanner and gallery used different page snapshots.

The current scan meets [1KB Club's 1,024-byte limit](https://1kb.club/submit/). Direct destinations add 65 Brotli bytes relative to the earlier alias version and avoid an uncached redirect on each click. [Deployment evidence](measurements/deployment-20261005-direct-links.json) records exact response and browser checks. A [390 B compression candidate](measurements/compression-20261005-exact-source-390-local.json) remains local and unscanned. These byte counts establish neither a world record nor faster load times.

## Build locally

Requires Node.js 22+ with npm, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
npm run check:measurements
```

`index.html` is the source. The build writes HTML, Brotli, gzip, deflate and nginx's preload snapshot to `public/`, with sizes in [build-report.json](build-report.json). Saved compression candidates are accepted only when smaller and decoding exactly to the source. Keep the source ASCII; use character references for Unicode because HTTP/1 and HTTP/2 omit a charset. The build's 128 B response allowance is a budget, not a scanner measurement.

The measurement check binds the build, README tables and [browser evidence](measurements/page-20261005-direct-links-local.json) to saved hashes and dated results. It does not collect a new live measurement. For browser comparisons, install the optional tools and save the source before editing:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
mkdir -p optimization
cp index.html optimization/baseline.html
# Make equivalent serialization changes, then compare.
npm run test:browser -- --baseline optimization/baseline.html
npm run test:browser:guards
```

Compare equivalent serializations against that baseline. Python optimizer tests (`npm run test:optimizers`) require Python 3. See [optimization tools](OPTIMIZATION.md#let-the-compressor-settle-arguments) and [verification](TRANSPORT.md#verification) for additional dependencies and protocol probes.

## Hosting

Docker on an Unraid host serves the site directly through nginx; Cloudflare provides DNS only. This gives control over delivery bytes and requires maintaining the host, certificates and patches. Availability depends on home power and connectivity.

Pushing to GitHub does not deploy the site. The [hosting guide](server/README.md) covers configuration, page and image deployment, certificates and rollback. [Delivery settings](TRANSPORT.md) documents the patches and protocol checks.
