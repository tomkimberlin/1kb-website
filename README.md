# 1kb website

My website: [tomkimberlin.com](https://tomkimberlin.com/).

| Response body | Bytes |
| --- | ---: |
| HTML | 570 |
| Brotli | 279 |
| Gzip | 391 |

These sizes cover the page. Headers, TLS, DNS and network framing add to the total transfer.

## How it stays small

- One ASCII HTML file, inline CSS and a system font.
- Optional markup omitted; equivalent HTML and CSS orderings compared for compressed size.
- An empty data favicon avoids another request.
- One-character links lead to empty redirects.
- Brotli and gzip are compressed ahead of time and checked against the source.
- nginx omits optional headers and supports TLS certificate compression and session reuse.

[HTML optimization](OPTIMIZATION.md) and [delivery settings](TRANSPORT.md) explain the implementation. [Compare delivery overhead with other 1kb.club sites](COMPARISON.md). [build-report.json](build-report.json) contains the current build sizes.

## Build and deploy

Requires Node.js 22+, curl and SSH access to the home server.

```sh
npm ci
npm test
npm run check
npm run deploy -- YOUR_SSH_HOST
npm run verify:live
```

`index.html` is the page source. The home server serves it directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it on the same server. See [server operations](server/README.md) for DNS, certificates, the alias and rollback.
