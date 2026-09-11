# 1kb website

My personal website: [tomkimberlin.com](https://tomkimberlin.com/). Served directly from my home server, Alfred. Cloudflare provides DNS for the main site. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it through Cloudflare.

## Size

| Response body | Bytes |
| --- | ---: |
| HTML | 416 |
| Brotli | 224 |
| Gzip | 300 |

The **page** is under 1 KB. A complete HTTPS connection is larger. In the September 10, 2026 hosting comparison, the then-current 271-byte Brotli page used **5,648 bytes through TLS in both directions**, versus **6,474 through Cloudflare**, with certificate compression enabled on both. TCP/IP and DNS add more; [the transport audit](TRANSPORT.md) includes those measurements and their limits.

## Optimizations

- One ASCII HTML file with inline CSS, system fonts and browser-default link colors. An empty data favicon prevents another request.
- Optional tags, quotes and punctuation are omitted. Markup order is tested for compressed size; shorter source can compress worse.
- ASCII-only source needs no encoding marker or charset declaration.
- One-character links shorten the page. Clicking one adds an empty redirect.
- The build compares 1,080 Brotli configurations, gzip and a Zopfli candidate, then verifies decompression.
- nginx serves the precompressed bytes and respects `Accept-Encoding` weights and exclusions.
- Optional response headers are removed. HTTP/2 and HTTP/3 omit redundant `Content-Length`; HTTP/1.1 retains it.
- TLS uses a small ECDSA certificate, Let's Encrypt's `tlsserver` profile and the chain ending at ISRG Root X2. OpenSSL is built with certificate compression enabled.
- One small, stateful session ticket supports resumption. Browser caching lasts one day. HTTP/3 remains available without an `Alt-Svc` advertisement.

[HTML measurements](OPTIMIZATION.md), [transport measurements](TRANSPORT.md), and [comparison with other 1 KB sites](COMPARISON.md) document the results. They do not prove an absolute minimum.

## Build, test and deploy

Requires Node.js 22+, `curl`, and SSH access to Alfred.

```sh
npm ci
npm test
npm run check
npm run deploy
npm run verify:live
```

`index.html` is the page source. `server/` contains nginx configuration, its reproducible image build, deployment and certificate renewal support. See [server operations](server/README.md) for setup and rollback.

The Cloudflare Worker handles only `tom.kimberlin.net/*`, returning an empty redirect. Its page-serving code remains available for rollback. `npm run deploy:worker` updates this Worker and its alias route; the main domain continues to use Alfred.
