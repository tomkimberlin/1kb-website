# 1kb website

My personal website: [tomkimberlin.com](https://tomkimberlin.com/). Served directly from my home server, Alfred. Cloudflare provides DNS only.

## Size

| Response body | Bytes |
| --- | ---: |
| HTML | 428 |
| Brotli | 271 |
| Gzip | 338 |

The **page** is under 1 KB. A complete HTTPS connection is larger. On September 10, 2026, the controlled cold-load test counted **5,648 bytes through TLS in both directions**, versus **6,474 through Cloudflare**, with certificate compression enabled on both. TCP/IP and DNS add more; [the transport audit](TRANSPORT.md) includes those measurements and their limits.

## Optimizations

- One HTML file with inline CSS, system fonts and Unicode emojis. An empty data favicon prevents another request.
- Optional tags, quotes and punctuation are omitted. Markup order is tested for compressed size; shorter source can compress worse.
- A UTF-8 BOM identifies the encoding. Removing it did not reduce the Brotli body and would require a longer charset declaration.
- One-character links shorten the page. Clicking one adds an empty redirect.
- The build compares 1,080 Brotli configurations, gzip and a Zopfli candidate, then verifies decompression.
- nginx serves the precompressed bytes and respects `Accept-Encoding` weights and exclusions.
- Optional response headers are removed. HTTP/2 and HTTP/3 omit redundant `Content-Length`; HTTP/1.1 retains it.
- TLS uses a small ECDSA certificate, Let's Encrypt's `tlsserver` profile and the chain ending at ISRG Root X2. OpenSSL is built with certificate compression enabled.
- One small, stateful session ticket supports resumption. Browser caching lasts one day. HTTP/3 remains available without an `Alt-Svc` advertisement.

[HTML measurements](OPTIMIZATION.md) and [transport measurements](TRANSPORT.md) document the search. Neither proves an absolute minimum.

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

The former Cloudflare Worker is retained as a fallback. `deploy:worker` updates its code; it does not move DNS or attach the domain.
