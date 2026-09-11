# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

| Response body | Bytes |
| --- | ---: |
| HTML | 781 |
| Brotli | 342 |
| Gzip | 446 |

These sizes cover the page. Headers, TLS, DNS and network framing add to the total transfer.

## How it stays small

- One ASCII HTML file, inline CSS and a system font.
- Optional markup omitted; equivalent HTML and CSS orderings compared for compressed size.
- An empty data favicon avoids another request.
- One-character links lead to empty redirects.
- Brotli and gzip are compressed ahead of time and checked against the source.
- nginx omits optional headers and supports TLS certificate compression and session reuse.

[HTML optimization](OPTIMIZATION.md) and [delivery settings](TRANSPORT.md) explain the implementation. [Compare delivery overhead with other 1kb.club sites](COMPARISON.md). [build-report.json](build-report.json) contains the current build sizes.

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
