# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **400 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/SqYs6RrN/overview) on September 22, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Published September 22 | Local build September 26 |
| --- | ---: | ---: |
| DebugBear page weight | **400 B** | Not measured |
| Brotli response body | 319 B | **321 B** |
| Gzip response body | 471 B | 468 B |
| Deflate response body | 459 B | 456 B |
| Raw HTML | 746 B | 743 B |

The local build now includes “my” in the GitHub hyperlink. The sentence and link destination are unchanged. It has not been deployed; the published measurements remain the September 22 snapshot.

The server changes also remove four synchronous file reads from each request by preloading the representations when nginx loads its configuration. The [local runtime comparison](measurements/runtime-20260926-local.json) records the benchmark and reload checks.

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

I built the foundation years ago, then let Astra push the optimization. [Making a tiny website smaller](OPTIMIZATION.md) covers the experiments, decisions and tradeoffs.

[Delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [current build measurements](measurements/page-20260926-link-label.json), [earlier browser comparison](measurements/page-20260926-local.json), [published browser measurements](measurements/page-20260922.json).

## Build locally

Requires Node.js 22+, curl, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. The build writes HTML, Brotli, gzip and deflate files to `public/` and records their sizes in `build-report.json`. It also writes `public/representations.json` for nginx to preload. The source stays ASCII because HTTP/1 and HTTP/2 omit the charset parameter; character references such as `&#233;` preserve Unicode text across protocols. The build and serializer reject literal non-ASCII bytes and non-HTML control characters.

`npm run check:measurements` checks the current build sizes, hashes, preloaded representations and Markdown tables against the dated gallery. This build-only check does not claim visual equivalence to the earlier page, whose hyperlink covered only “GitHub”.

`npm run test:optimizers` checks compression-candidate validation and atomic publication. It also requires Python 3, but no compiler or optional compressor packages. `npm run check:python` checks the Python tools' syntax.

For browser comparisons of equivalent serializations, install the optional test tools and save the original page before editing:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
mkdir -p optimization
cp index.html optimization/baseline.html
# Make equivalent serialization changes before running the comparison.
npm run test:browser -- --baseline optimization/baseline.html
npm run test:browser:guards
```

The comparison checks pixels, text, comments, layout, link destinations, keyboard order, focused appearance and Enter activation in Chromium and WebKit at four widths and in both themes. Unexpected requests are blocked, and keyboard probes receive local responses after checking the redirect handler. Reports and screenshots stay in `optimization/`.

## Hosting

nginx serves the published website directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it.

The [hosting guide](server/README.md) explains the server configuration, deployment requirements and settings needed to host a copy.
