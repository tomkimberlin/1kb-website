# 1kb website

My personal website at **[tomkimberlin.com](https://tomkimberlin.com/)**. A greeting, a short sysadmin bio, my Monero node, and a deliberately tiny payload. A Cloudflare Worker serves the complete site directly, with no home server, tunnel, database, or external origin.

## How small?

Measured on September 10, 2026, with the page title **Tom Kimberlin**:

| Representation | HTML response body |
| --- | ---: |
| Uncompressed | **400 bytes** |
| Brotli | **238 bytes** |
| Gzip, optimized with Zopfli | **325 bytes** |
| A fresh repeat visit in Chromium/Firefox | **0 network bytes** |

These are **body sizes**, not the complete TLS/TCP/HTTP exchange. Cloudflare adds response headers, and establishing a new connection costs additional bytes. The original version in commit `715f2de` was already only 456 bytes raw / 247 bytes Brotli. The intervening greeting-only version was 230 bytes raw / 128 bytes Brotli. The current page adds a bio, Monero and source links, and four emojis. Different versions contain different text, so their size differences are not solely minification gains. The on-page claim uses decimal kilobytes and holds even before compression; the build fails at 1,000 bytes.

## What was optimized

- **One document, one request.** Inline CSS, a system monospace font, no JavaScript, frameworks, images, external fonts, stylesheets, analytics, or trackers.
- **An empty data-URL favicon.** `<link rel=icon href=data:,>` prevents an automatic request for `/favicon.ico`.
- **Short equivalent CSS.** `5vmin` replaces `min(5vw,5vh)`. Unnecessary declarations, punctuation, whitespace, and explicit document wrappers were removed. The final hyperlink closes at end of file through the browser's HTML parser.
- **One-character link targets.** `/g`, `/x`, and `/s` redirect to GitHub, XMR.surf, and this repository. Each redirect has an empty body. This minimizes the initial page, with the explicit tradeoff of one redirect after a click. Direct and protocol-relative URLs were also compared.
- **Compression-aware ordering.** The richer page went through 6,769 serialization/link candidates and 376 follow-up mutations. Then 43 shortlisted variants were compared across the full Brotli grid: another 46,440 compression trials. The initial richer draft was 267 bytes Brotli; the chosen equivalent form is 238 bytes. Shorter source does not always mean a smaller download.
- **Color without downloads.** Four Unicode emojis use the device's existing emoji font. A three-byte UTF-8 BOM makes decoding explicit. For this source, removing the BOM increased Brotli size to 248 bytes before even adding an HTTP charset declaration; replacing it with a charset meta tag reached 255 bytes. All three browser engines correctly decoded the chosen form.
- **Offline compression.** The build tries 1,080 Brotli parameter combinations and keeps the smallest output. Gzip is also compared across zlib settings and a precomputed Zopfli result, including searches up to 10,000 iterations. All outputs are decompressed and checked against the source.
- **Precompressed bytes embedded in the Worker.** The three representations are bundled into the server code. `encodeBody: 'manual'` sends them unchanged, with no origin fetch or runtime compression. The Worker code itself is never downloaded by the browser.
- **No edge rewriting.** `Cache-Control: no-transform` preserves the precompressed body. Cloudflare's email rewriting and other content-changing features are disabled for this dedicated domain.
- **Lean response headers.** Optional reporting, range, validator, and server-identification headers are stripped wherever the origin and Cloudflare allow it. Cloudflare's protected or later-injected headers remain; removing a header in a rule does not guarantee it disappears on the wire.
- **Empty redirects.** HTTP-to-HTTPS, `www`, and GitHub redirects return no body. The Worker handles the HTTPS redirect to avoid Cloudflare's default 167-byte redirect page.
- **Caching.** The page has a one-day browser lifetime. A measured fresh revisit uses zero network bytes. The Worker already holds the complete content at the edge; it does not need an origin-response cache or a Cache API lookup.
- **Correct negotiation.** A zone request transform preserves the visitor's `Accept-Encoding` before normalization. In live tests, even `request.cf.clientAcceptEncoding` dropped quality weights. The Worker reads the preserved header, respects exclusions and weighted preferences, and chooses the smallest equally preferred representation.

## Verification and limits

The page is checked in Chromium, Firefox, and WebKit at desktop and phone dimensions, including UTF-8 decoding, visible text, title, all three links, and overflow. Byte-for-byte live compression checks cover Brotli, gzip, identity, and quality-weighted encoding preferences.

Each single-byte deletion is checked for valid UTF-8, then tested against the rendered layout, content, metadata, and link targets. Deletions that still render identically are recompressed: some remove source bytes but increase the download. This is an extensive measured search, **not a mathematical proof of the globally smallest possible page**.

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
node tune.mjs
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
