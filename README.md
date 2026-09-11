# 1kb website

My website: [tomkimberlin.com](https://tomkimberlin.com/).

| Response body | Bytes |
| --- | ---: |
| HTML | 493 |
| Brotli | 255 |
| Gzip | 352 |

These sizes cover the page. Headers, TLS, DNS and network framing add to the total transfer.

## How it stays small

- One ASCII HTML file, inline CSS and a system font.
- Optional markup omitted; equivalent HTML and CSS orderings compared for compressed size.
- An empty data favicon avoids another request.
- One-character links lead to empty redirects.
- Brotli and gzip are compressed ahead of time and checked against the source.
- nginx omits optional headers and supports TLS certificate compression and session reuse.

[HTML optimization](OPTIMIZATION.md) and [delivery settings](TRANSPORT.md) explain the implementation. [build-report.json](build-report.json) contains the current build sizes.

## Build and deploy

Requires Node.js 22+, curl and SSH access to Alfred.

```sh
npm ci
npm test
npm run check
npm run deploy
npm run verify:live
```

`index.html` is the page source. Alfred serves it directly; Cloudflare provides DNS. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it through Cloudflare. See [server operations](server/README.md) for DNS, certificates, the alias and rollback.
