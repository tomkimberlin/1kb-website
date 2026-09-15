# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **418 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/dMalgIOJ/overview) on September 15, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Bytes |
| --- | ---: |
| DebugBear page weight | **418** |
| Brotli response body | 337 |
| Gzip response body | 460 |
| Deflate response body | 448 |
| Raw HTML | 733 |

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

## How it stays small

- One ASCII HTML file, inline CSS, native fonts and no external assets.
- Optional syntax omitted; equivalent HTML and CSS forms compared for compressed size.
- An empty data favicon avoids another request.
- All nine anchor hrefs use one-character paths and empty redirects.
- Brotli, gzip and deflate are compressed ahead of time and checked against the source.
- nginx uses compact HPACK/QPACK encodings, omits optional headers and supports TLS certificate compression and session reuse.
- Native browser colors follow the device's light/dark preference.

[HTML optimization](OPTIMIZATION.md), [delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [browser measurements](measurements/minimal-20260915.json).

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

The [server configuration](server/README.md) documents this deployment, including its Unraid paths, domains and DNS records. Deploying a copy requires adapting those settings and preparing a Docker host with SSH access. The deployment script updates an existing installation; it does not provision a new server.
