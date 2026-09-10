# 1kb website

My personal website at **[tomkimberlin.com](https://tomkimberlin.com/)**. A greeting, a GitHub link, and a deliberately tiny payload. Hosted on my Unraid home server through Cloudflare Tunnel.

## How small?

Measured on September 10, 2026, with the page title **Tom Kimberlin**:

| Representation | HTML response body |
| --- | ---: |
| Uncompressed | **230 bytes** |
| Brotli | **128 bytes** |
| Gzip, optimized with Zopfli | **195 bytes** |
| A fresh repeat visit from browser cache | **0 network bytes** |

These are **body sizes**, not the complete TLS/TCP/HTTP exchange. Cloudflare adds response headers, and establishing a new connection costs additional bytes. The original version in commit `715f2de` was already only 456 bytes raw / 247 bytes Brotli. The new version also contains less text, so that before/after difference is not entirely a minification gain.

## What was optimized

- **One document, one request.** Inline CSS, a system monospace font, no JavaScript, frameworks, images, external fonts, stylesheets, analytics, or trackers.
- **An empty data-URL favicon.** `<link rel=icon href=data:,>` prevents an automatic request for `/favicon.ico`.
- **Short equivalent CSS.** `5vmin` replaces `min(5vw,5vh)`. Unnecessary declarations, punctuation, whitespace, and explicit document wrappers were removed. The final hyperlink closes at end of file through the browser's HTML parser.
- **A one-character link target.** `href=g` uses the original site's `/g` redirect convention. The redirect returns an empty body and points to my GitHub profile. This reduces the initial page, with the explicit tradeoff of one redirect after a click.
- **Compression-aware ordering.** 41,472 combinations of head-element order, CSS order, quoting, equivalent spellings, and markup omissions were measured, followed by a smaller mutation search. Shorter source does not always mean a smaller download.
- **Offline compression.** The build tries 1,080 Brotli parameter combinations and keeps the smallest output. Gzip is also compared across zlib settings and a precomputed Zopfli result, including searches up to 10,000 iterations. All outputs are decompressed and checked against the source.
- **Static precompressed serving.** Caddy serves the chosen `.br` or `.gz` file directly. Compression work happens at build time, not on every request.
- **No edge rewriting.** `Cache-Control: no-transform` preserves the precompressed body. Cloudflare's email rewriting and other content-changing features are disabled for this dedicated domain.
- **Lean response headers.** Optional reporting, range, validator, and server-identification headers are stripped wherever the origin and Cloudflare allow it. Cloudflare's protected or later-injected headers remain; removing a header in a rule does not guarantee it disappears on the wire.
- **Empty redirects.** HTTP-to-HTTPS, `www`, and GitHub redirects return no body. The origin handles the HTTPS redirect to avoid Cloudflare's default 167-byte redirect page.
- **Caching.** The page has a one-day browser lifetime. Ordinary Brotli requests also use Cloudflare's edge cache. A measured fresh revisit uses zero network bytes.
- **Correct negotiation.** Cloudflare normally rewrites the origin's `Accept-Encoding`. A request transform preserves the visitor's original value for the origin. Other encodings and weighted preferences bypass the edge HTML cache, avoiding an incompatible cached Brotli representation. Browser caching still applies.

## Verification and limits

The page is checked in Chromium, Firefox, and WebKit at desktop and phone dimensions, including visible text, title, GitHub navigation, and overflow. Byte-for-byte live compression checks cover Brotli, gzip, identity, and quality-weighted encoding preferences.

Each single-byte deletion is also tested against the rendered layout, content, metadata, and link target. Deletions that still render identically are recompressed: some remove source bytes but increase the download. This is an extensive measured search, **not a mathematical proof of the globally smallest possible page**.

HTTP/2 measurements count compressed header blocks, the body, and frame overhead separately. Browser Resource Timing uses its own transfer-size accounting, so it is not substituted for a packet capture. See [OPTIMIZATION.md](OPTIMIZATION.md) for the verification record and header caveats.

## Reproduce and maintain

```sh
node build.mjs
node optimize.mjs
node mutate.mjs
```

Node.js 22+ is sufficient. Search output is written to ignored `optimization/`; it does not overwrite the actual page. Review and browser-check a candidate before replacing `index.html`.

`build.mjs` reuses `compression/index.html.gz` only if decompression matches the current source and it beats zlib. After an edit, a stale precomputed file is ignored. To regenerate the Zopfli candidate, install `zopfli==0.4.3` in a Python virtual environment and run `python optimize-gzip.py`.

`Caddyfile`, `deploy.sh`, and `unraid-template.xml` describe the deployment. The container uses a pinned Caddy image, read-only files, resource limits, a health check, bounded logs, and automatic startup. Updates use immutable release directories with an atomic symlink switch and rollback on verification failure. No Cloudflare credentials are stored in the repository.

After a deployment, purge this domain's Cloudflare cache and verify the public response. Browser-cached pages may remain for one day; a force reload fetches the update immediately.

## References

- [Cloudflare compression and no-transform behavior](https://developers.cloudflare.com/speed/optimization/content/compression/)
- [Cloudflare response-header restrictions](https://developers.cloudflare.com/rules/transform/response-header-modification/)
- [Caddy precompressed static files](https://caddyserver.com/docs/caddyfile/directives/file_server)
