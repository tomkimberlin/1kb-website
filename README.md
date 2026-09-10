# 1kb website

My personal website: [tomkimberlin.com](https://tomkimberlin.com/). Hosted on a Cloudflare Worker.

## Size

Measured September 10, 2026:

| Encoding | Response body |
| --- | ---: |
| Uncompressed | 428 bytes |
| Brotli | 271 bytes |
| Gzip | 338 bytes |

These sizes exclude HTTP headers and connection overhead. The build rejects HTML of 1,000 bytes or more.

## Optimizations

- Inline CSS, system fonts, and Unicode emojis keep everything in one file. An empty data-URL favicon prevents a separate icon request.
- Optional HTML tags, attribute quotes, and CSS punctuation are omitted where the browser permits it. `5vmin` replaces `min(5vw,5vh)`.
- Markup and CSS ordering are tested for compressed size. Fewer source bytes do not always produce a smaller compressed file.
- A UTF-8 BOM specifies the encoding for the emojis.
- One-character links (`/g`, `/x`, `/s`) shorten the HTML. Each adds an empty redirect when clicked.
- The build tries 1,080 Brotli configurations and compares gzip settings with a precomputed Zopfli file. Every compressed result is checked against the source after decompression.
- The Worker embeds all three representations and sends precompressed bytes with `encodeBody: 'manual'`.
- A request transform preserves the original `Accept-Encoding` so the Worker can respect quality weights and exclusions.
- `Cache-Control: no-transform` and disabled content injection prevent Cloudflare from modifying the page. Response transforms remove optional headers; Cloudflare still adds some headers that cannot be removed.
- Browser caching lasts one day. HTTPS and hostname redirects have empty bodies.

See [OPTIMIZATION.md](OPTIMIZATION.md) for measurements and validation. The search does not prove a global minimum.

## Build and check

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. `build.mjs` generates the compressed files and `public/worker.mjs`; `worker.mjs` handles routing and content negotiation.

To search for smaller equivalent markup:

```sh
node optimize.mjs
node mutate.mjs
node tune.mjs
```

Candidates are written to `optimization/`. Review their rendering before replacing `index.html`.

To regenerate the Zopfli candidate, install `zopfli==0.4.3` in a Python virtual environment and run `python optimize-gzip.py`. The build uses `compression/index.html.gz` only when it matches the source and is smaller than zlib's output.

## Deploy

```sh
npx wrangler login
npm run deploy
```

`wrangler.jsonc` configures the Worker and custom domains. Zone settings and transform rules are recorded in `cloudflare-rules.json` and must be applied separately. The encoding rule must overwrite `x-onekb-accept-encoding` with the incoming `Accept-Encoding` value.

After deployment, compare live response bodies with the built files. Force reload to bypass the one-day browser cache. To roll back, rebuild and deploy a previous commit.
