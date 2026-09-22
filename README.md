# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **405 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/v6pn1eLl/overview) on September 22, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Bytes |
| --- | ---: |
| DebugBear page weight | **405** |
| Brotli response body | 324 |
| Gzip response body | 468 |
| Deflate response body | 456 |
| Raw HTML | 737 |

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

I built the foundation years ago, then let Astra push the optimization. [Making a tiny website smaller](OPTIMIZATION.md) covers the experiments, decisions and tradeoffs.

[Delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [browser measurements](measurements/page-20260922.json).

## Build locally

Requires Node.js 22+, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. The build writes HTML, Brotli, gzip and deflate files to `public/` and records their sizes in `build-report.json`.

## Hosting

nginx serves the published website directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it.

The [hosting guide](server/README.md) explains the server configuration, deployment requirements and settings needed to host a copy.
