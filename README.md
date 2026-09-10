# 1kb website

My personal website at **[tomkimberlin.com](https://tomkimberlin.com/)**. A greeting, a GitHub link, and a deliberately tiny payload. A Cloudflare Worker serves the complete site directly, with no home server, tunnel, database, or external origin.

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
- **Precompressed bytes embedded in the Worker.** The three representations are bundled into the server code. `encodeBody: 'manual'` sends them unchanged, with no origin fetch or runtime compression. The Worker code itself is never downloaded by the browser.
- **No edge rewriting.** `Cache-Control: no-transform` preserves the precompressed body. Cloudflare's email rewriting and other content-changing features are disabled for this dedicated domain.
- **Lean response headers.** Optional reporting, range, validator, and server-identification headers are stripped wherever the origin and Cloudflare allow it. Cloudflare's protected or later-injected headers remain; removing a header in a rule does not guarantee it disappears on the wire.
- **Empty redirects.** HTTP-to-HTTPS, `www`, and GitHub redirects return no body. The Worker handles the HTTPS redirect to avoid Cloudflare's default 167-byte redirect page.
- **Caching.** The page has a one-day browser lifetime. A measured fresh revisit uses zero network bytes. The Worker already holds the complete content at the edge; it does not need an origin-response cache or a Cache API lookup.
- **Correct negotiation.** A zone request transform preserves the visitor's `Accept-Encoding` before normalization. In live tests, even `request.cf.clientAcceptEncoding` dropped quality weights. The Worker reads the preserved header, respects exclusions and weighted preferences, and chooses the smallest equally preferred representation.

## Verification and limits

The page is checked in Chromium, Firefox, and WebKit at desktop and phone dimensions, including visible text, title, GitHub navigation, and overflow. Byte-for-byte live compression checks cover Brotli, gzip, identity, and quality-weighted encoding preferences.

Each single-byte deletion is also tested against the rendered layout, content, metadata, and link target. Deletions that still render identically are recompressed: some remove source bytes but increase the download. This is an extensive measured search, **not a mathematical proof of the globally smallest possible page**.

HTTP/2 measurements count compressed header blocks, the body, and frame overhead separately. Browser Resource Timing uses its own transfer-size accounting, so it is not substituted for a packet capture. See [OPTIMIZATION.md](OPTIMIZATION.md) for the verification record and header caveats.

## Reproduce and maintain

```sh
npm ci
npm test
npm run check
```

To repeat the optional source search:

```sh
node optimize.mjs
node mutate.mjs
```

Node.js 22+ is sufficient. Search output is written to ignored `optimization/`; it does not overwrite the actual page. Review and browser-check a candidate before replacing `index.html`.

`build.mjs` reuses `compression/index.html.gz` only if decompression matches the current source and it beats zlib. After an edit, a stale precomputed file is ignored. To regenerate the Zopfli candidate, install `zopfli==0.4.3` in a Python virtual environment and run `python optimize-gzip.py`.

`worker.mjs` contains routing and content negotiation. `build.mjs` generates the self-contained `public/worker.mjs`. `wrangler.jsonc` defines the Worker and its apex and `www` custom domains. Deploy from an authenticated Cloudflare account with:

```sh
npx wrangler login
npm run deploy
```

The deployed zone settings and request/response transform rules are recorded in `cloudflare-rules.json`; Wrangler does not install these zone rules. When recreating the site in another zone, install equivalent rules, disable browser analytics/content injection, and update the hostnames and profile link. The request rule must overwrite `x-onekb-accept-encoding` from the actual incoming `Accept-Encoding`; it must not trust a visitor-supplied value.

The Worker has no resource bindings, secrets, schedules, or origin requests. Server-side logs and traces are sampled at 1%; they do not inject browser analytics. No Cloudflare credentials are stored in the repository. The deployment uses Workers and is subject to the account's Workers limits.

After a deployment, verify the public compressed response against the built file. Browser-cached pages may remain for one day; a force reload fetches the update immediately. A previous Worker version can be redeployed for rollback. The former home-server deployment is preserved in Git history at `28e5576`; it is no longer running or required.

## References

- [Cloudflare compression and no-transform behavior](https://developers.cloudflare.com/speed/optimization/content/compression/)
- [Cloudflare response-header restrictions](https://developers.cloudflare.com/rules/transform/response-header-modification/)
- [Workers precompressed response handling](https://developers.cloudflare.com/workers/runtime-apis/response/#the-encodebody-option)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
