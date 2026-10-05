# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The published page measured **400 bytes** in [DebugBear](https://www.debugbear.com/test/website-speed/SqYs6RrN/overview) on September 22, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/).

| Measurement | Published September 22 | Published September 26 | Local October 5 (unchanged copy) | Published October 5 (revised opening) |
| --- | ---: | ---: | ---: | ---: |
| DebugBear page weight | **400 B** | Not measured | Not measured | Not measured |
| Brotli response body | 319 B | 321 B | 315 B | **326 B** |
| Gzip response body | 471 B | 468 B | 467 B | 481 B |
| Deflate response body | 459 B | 456 B | 455 B | 469 B |
| Raw HTML | 746 B | 743 B | 744 B | 768 B |

The [current October 5 page](measurements/page-20261005-opening-copy.json) says “This is the most optimized 1 KB website on the planet. Probably.” This is playful opinion; the measurements do not establish a world record. The 1KB Club link covers “1 KB website”. Fresh [browser checks](measurements/browser-20261005-opening-copy.json) verify the exact opening, full anchor, unaffected layout and nine keyboard destinations. The [final deployment record](measurements/deployment-20261005-opening-copy.json) verifies all four exact representations, 118 public HTTP checks, 12 alias checks and 16 live browser comparisons.

The [initial approved-copy build](measurements/page-20261005-approved-copy.json) and its [deployment record](measurements/deployment-20261005.json) preserve the earlier 324 B Brotli result and live verification before the link extension. The [intermediate link correction](measurements/deployment-20261005-club-link.json) measured 322 B before the opening changed.

The [earlier October 5 unchanged-copy experiment](measurements/page-20261005-local.json) saved 6 Brotli bytes and one byte in each fallback body. Its 315 B result uses the old sentence and remains distinct from the approved copy.

The September 26 deployment includes “my” in the GitHub hyperlink. The sentence and link destination are unchanged. The [deployment record](measurements/deployment-20260926.json) verifies the public response bytes and live behavior. The 400-byte DebugBear result remains the September 22 snapshot; it has not been remeasured.

The server changes also remove four synchronous file reads from each request by preloading the representations when nginx loads its configuration. The [local runtime comparison](measurements/runtime-20260926-local.json) records the benchmark and reload checks. Its throughput results describe a loopback test, not public-server capacity or browser load time.

DebugBear counts the compressed page and response headers. DNS, connection setup, request headers and other network overhead are outside that page-weight number.

I built the foundation years ago, then let Astra push the optimization. [Making a tiny website smaller](OPTIMIZATION.md) covers the experiments, decisions and tradeoffs.

[Delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [current build measurements](measurements/page-20261005-opening-copy.json), [September 26 build](measurements/page-20260926-link-label.json), [earlier browser comparison](measurements/page-20260926-local.json), [published browser measurements](measurements/page-20260922.json).

## Build locally

Requires Node.js 22+, curl, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. The build writes HTML, Brotli, gzip and deflate files to `public/` and records their sizes in `build-report.json`. It also writes `public/representations.json` for nginx to preload. The source stays ASCII because HTTP/1 and HTTP/2 omit the charset parameter; character references such as `&#233;` preserve Unicode text across protocols. The build and serializer reject literal non-ASCII bytes and non-HTML control characters.

`npm run check:measurements` checks the current build sizes, hashes, preloaded representations and Markdown tables against the dated gallery. The current build-only check verifies the approved-copy files and keeps the dated gallery separate. The current October 5 browser record verifies the approved opening edit against the prior page, retaining the full anchor and every destination. It does not claim pixel equality to the shorter sentence. The September 26 hyperlink edit remains a separate historical measurement.

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

nginx serves the published website from the origin server directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it. Pushing to GitHub does not deploy the site. Finished website edits also require `npm run deploy -- YOUR_SSH_HOST`, using the configured hostname or local SSH alias, followed by a local build and live verification as described in the hosting guide.

The [hosting guide](server/README.md) explains the server configuration, deployment requirements and settings needed to host a copy.
