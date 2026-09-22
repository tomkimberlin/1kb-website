# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **399 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/lisc2502/overview) on September 22, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Bytes |
| --- | ---: |
| DebugBear page weight | **399** |
| Brotli response body | 318 |
| Gzip response body | 462 |
| Deflate response body | 450 |
| Raw HTML | 728 |

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

I built the foundation years ago, then let Astra in Codex tackle the recent optimization work. [Making a tiny website smaller](OPTIMIZATION.md) explains that AI-assisted process, the hosting, HTML and protocol decisions, what they saved and what they cost.

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
