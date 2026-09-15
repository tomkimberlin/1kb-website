# HTML optimization

`index.html` contains the entire page: content and styling. [build-report.json](build-report.json) records the raw HTML and compressed response sizes.

## What the 1 KB limit measures

[1KB Club's submission instructions](https://1kb.club/submit/) use the Network → Bytes total result from its linked DebugBear scanner, with a limit of 1,024 bytes. This counts the compressed response and response headers. It is not the raw source length or the full DNS/TCP/TLS exchange.

The build reserves 128 bytes above the Brotli body and rejects a combined size of 1,024 bytes or more. The measured HTTP/2 header/framing cost is 81 bytes. This allowance leaves margin for variation; the published page is also checked with the club's scanner. Chromium's Resource Timing API adds a fixed 300-byte estimate, which is not the actual compressed header size. The gzip body must also remain below 1,024 bytes. [Delivery settings](TRANSPORT.md) explain the remaining network overhead.

## Markup and styling

- One ASCII document, inline CSS and native fonts; no external assets.
- Optional HTML tags and safe attribute quotes omitted. CSS closes open blocks at stylesheet EOF.
- The doctype, title and viewport declaration preserve standards mode, tab identification and mobile sizing.
- An empty data favicon prevents a separate favicon request.
- Two CSS rules set type size, line height, column width, spacing and automatic light/dark colors.
- `color-scheme:light dark` uses native page, text and link colors.
- Body text is 18px; links retain their native underlines.
- All nine anchor hrefs are one character. Their redirects have empty bodies; the email address remains visible and copyable.

## Compression

`build.mjs` compares 5,988 Brotli configurations and gzip settings, then verifies that all compressed files decode exactly to the source. It also uses `compression/index.html.gz` when that Zopfli candidate matches the source and is smaller. Deflate reuses the optimized DEFLATE stream with a 6-byte zlib wrapper instead of gzip's 18-byte wrapper.

Optimization used 64,000 equivalent serialization trials, 138,240 combined Brotli parameter settings, 4,896 short-link assignments, and Zopfli through 100,000 iterations. The final 16,000-trial serialization pass and parameter/link searches found no smaller Brotli result than 337 bytes. Chromium and WebKit confirmed identical text, links and layout at 320, 402 and 1440 pixels in both themes. This is a measured search, not a proof of a global minimum.

To search equivalent CSS declarations, independent rule order and head order:

```sh
node optimize.mjs
```

This deterministic search writes `optimization/candidate.html` and `optimization/search.json`, never replacing the source. It preserves media-query order after the base rules and assumes other rules have no order-dependent declarations of equal specificity. Smaller source does not always compress better.

To generate the optional Zopfli candidate, use a Python environment with `zopfli==0.4.3`:

```sh
python optimize-gzip.py
npm test
npm run check
```
