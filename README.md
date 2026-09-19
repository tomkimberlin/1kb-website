# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **416 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/yzmC1DkC/overview) on September 19, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Bytes |
| --- | ---: |
| DebugBear page weight | **416** |
| Brotli response body | 335 |
| Gzip response body | 456 |
| Deflate response body | 444 |
| Raw HTML | 734 |

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

## How it stays small

- One ASCII HTML file, inline CSS, native fonts and no external assets.
- Optional syntax omitted; equivalent HTML and CSS forms compared for compressed size.
- An empty data favicon avoids another request.
- All nine anchor hrefs use one-character paths and empty redirects.
- Brotli, gzip and deflate are compressed ahead of time and checked against the source.
- nginx uses compact HPACK/QPACK encodings, omits optional headers and supports TLS certificate compression and session reuse.
- Native browser colors follow the device's light/dark preference.

[HTML optimization](OPTIMIZATION.md), [delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [browser measurements](measurements/page-20260919.json).

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
