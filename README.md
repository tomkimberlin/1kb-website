# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **823 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/UnVKZJ7U/overview) on September 11, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Bytes |
| --- | ---: |
| DebugBear page weight | **823** |
| Brotli response body | 714 |
| Gzip response body | 892 |
| Raw HTML | 1,667 |

DebugBear counts the compressed page and response headers. Raw HTML is larger than 1 KB. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

## How it stays small

- One ASCII HTML file, inline CSS, native fonts and no external assets.
- Optional syntax omitted; equivalent HTML and CSS forms compared for compressed size.
- An empty data favicon avoids another request.
- One-character links lead to empty redirects.
- Brotli and gzip are compressed ahead of time and checked against the source.
- nginx omits optional headers and supports TLS certificate compression and session reuse.
- Reduced-motion preferences stop the animation.

[HTML optimization](OPTIMIZATION.md), [delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [browser measurements](measurements/copy-20260911.json).

## Build locally

Requires Node.js 22+, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. The build writes HTML, Brotli and gzip files to `public/` and records their sizes in `build-report.json`.

## Hosting

nginx serves the published website directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it.

The [server configuration](server/README.md) documents this deployment, including its Unraid paths, domains and DNS records. Deploying a copy requires adapting those settings and preparing a Docker host with SSH access. The deployment script updates an existing installation; it does not provision a new server.
