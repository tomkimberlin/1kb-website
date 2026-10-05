# 1kb website

Source code and size measurements for [tomkimberlin.com](https://tomkimberlin.com/).

The current published page measured **472 bytes** in a real [DebugBear test](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview) on October 5, 2026, below [1KB Club's 1,024-byte limit](https://1kb.club/submit/). The [original September 22 report](https://www.debugbear.com/test/website-speed/SqYs6RrN/overview) recorded **400 bytes**. The current first-load page weight is **72 bytes larger (+18%)**; the local compression savings did not make the final page smaller than that original published version.

| Measurement | Published September 22 | Published September 26 | Local October 5 (unchanged copy) | Published October 5 (revised opening) | Published October 5 (direct links) |
| --- | ---: | ---: | ---: | ---: | ---: |
| DebugBear page weight | **400 B** | Not measured | Not measured | Not measured | **472 B** |
| Brotli response body | 319 B | 321 B | 315 B | 326 B | **391 B** |
| Gzip response body | 471 B | 468 B | 467 B | 481 B | 536 B |
| Deflate response body | 459 B | 456 B | 455 B | 469 B | 524 B |
| Raw HTML | 746 B | 743 B | 744 B | 768 B | 1,021 B |

The intermediate columns have no saved DebugBear scans; their scanner results remain unknown. Their body sizes are independently measured and are not substituted for page weight. [Recovered September evidence](measurements/debugbear-20260922-recovered.json), [current scan evidence](measurements/debugbear-20261005.json) and the [completed report screenshot](measurements/debugbear-20261005.png) preserve the actual results.

The [published October 5 page](measurements/page-20261005-opening-copy.json) says “This is the most optimized 1 KB website on the planet. Probably.” This is playful opinion; the measurements do not establish a world record. The 1KB Club link covers “1 KB website”. Fresh [browser checks](measurements/browser-20261005-opening-copy.json) verify the exact opening, full anchor, unaffected layout and nine keyboard destinations. The [final deployment record](measurements/deployment-20261005-opening-copy.json) verifies all four exact representations, 118 public HTTP checks, 12 alias checks and 16 live browser comparisons.

The [published direct-link version](measurements/page-20261005-direct-links-local.json) keeps that exact copy. The [deployment record](measurements/deployment-20261005-direct-links.json) verifies all four representations, 118 public HTTP checks, 12 alternate-domain checks and 16 [live browser comparisons](measurements/browser-20261005-direct-links-live.json). It replaces nine relative redirect paths with explicit HTTPS/mailto destinations and retains every server alias for compatibility. Its 1,021-byte HTML and 391-byte Brotli body both stay below 1,024 bytes. This adds 65 Brotli bytes relative to the earlier 326-byte alias version and avoids one uncached same-origin redirect per click. [Sixteen normal browser comparisons](measurements/browser-20261005-direct-links-local.json) and [16 enlarged-font comparisons](measurements/browser-20261005-font-override-local.json) match pixels, layout, focus and all nine destinations. The dated [redirect review](measurements/link-review-20261005-local.json) preserves the earlier live baseline; the deployment record confirms all 13 compatibility aliases still work.

The [initial approved-copy build](measurements/page-20261005-approved-copy.json) and its [deployment record](measurements/deployment-20261005.json) preserve the earlier 324 B Brotli result and live verification before the link extension. The [intermediate link correction](measurements/deployment-20261005-club-link.json) measured 322 B before the opening changed.

The [earlier October 5 unchanged-copy experiment](measurements/page-20261005-local.json) saved 6 Brotli bytes and one byte in each fallback body. Its 315 B result uses the old sentence and remains distinct from the approved copy.

The September 26 deployment includes “my” in the GitHub hyperlink. The sentence and link destination are unchanged. The [deployment record](measurements/deployment-20260926.json) verifies the public response bytes and live behavior. The September 22 scanner result remains a historical snapshot. Its original public data was recovered, and the current direct-link page was scanned separately on October 5.

The server changes also remove four synchronous file reads from each request by preloading the representations when nginx loads its configuration. The [local runtime comparison](measurements/runtime-20260926-local.json) records the benchmark and reload checks. Its throughput results describe a loopback test, not public-server capacity or browser load time.

[1KB Club's submission instructions](https://1kb.club/submit/) use the linked scanner's Network Bytes total. The saved DebugBear page-weight counter (`lhData.totalEncodedBodyLength`) is **472 B**, agreeing with the request's encoded-response counter and Lighthouse's exact transfer total. The explicit compressed body (`netlogData.encodedSize`) is **391 B**, and decoded HTML is **1,021 B**. There is one uncached HTTP/2 document request and no subresources. The counter exceeds the body by 81 B in both the original and current scans; this difference is not an independently measured header length or the complete DNS/TCP/TLS exchange. [DebugBear explains compressed and decoded resource sizes](https://www.debugbear.com/blog/page-weight-website-speed).

The 72-byte increase is entirely reflected in the compressed-body difference: 319 → 326 → 391 B. The direct-link version accounts for 65 B relative to the approved opening with aliases; the remaining 7 B is the net result of preceding copy, link-label, serialization and compression changes, not an isolated wording cost. Both scans use Mobile 412×660, US East, packet-level 70 ms RTT /12,288 Kbps and CPU 2×. Chrome and Lighthouse versions changed, so these byte counts do not establish a load-time improvement.

[Eight independent live HTTP checks](measurements/http-20261005-debugbear-check.json) confirmed all four exact representations over both HTTP/1.1 and HTTP/2 and decoded each to the same HTML. Their header dumps have a different scope: the HTTP/1.1 Brotli body plus textual status/headers is 560 B; HTTP/2 dumps are decoded text, not wire framing. The separately recorded browser Resource Timing transfer estimate is 691 B (391 + the specification's fixed 300-byte allowance), rather than DebugBear's 472 B. The local 128-byte response allowance is a build policy, not a scanner measurement.

A later [local compression-only option](measurements/compression-20261005-exact-source-390-local.json) reproduces the exact current HTML in **390 B Brotli**, saving one body byte without changing the approved wording, direct links or design. Two fresh pinned builds and independent complete-stream decoders verify it. It remains local and has no DebugBear result; the deployed page is still **391 B body /472 B page weight**.

I built the foundation years ago, then let Astra push the optimization. [Making a tiny website smaller](OPTIMIZATION.md) covers the experiments, decisions and tradeoffs.

[Delivery settings](TRANSPORT.md), [gallery comparison](COMPARISON.md), [build sizes](build-report.json), [current build measurements](measurements/page-20261005-direct-links-local.json), [September 26 build](measurements/page-20260926-link-label.json), [earlier browser comparison](measurements/page-20260926-local.json), [published browser measurements](measurements/page-20260922.json).

## Build locally

Requires Node.js 22+, curl, `sh` and Bash. From the repository root:

```sh
npm ci
npm test
npm run check
```

`index.html` is the page source. The build writes HTML, Brotli, gzip and deflate files to `public/` and records their sizes in `build-report.json`. It also writes `public/representations.json` for nginx to preload. The source stays ASCII because HTTP/1 and HTTP/2 omit the charset parameter; character references such as `&#233;` preserve Unicode text across protocols. The build and serializer reject literal non-ASCII bytes and non-HTML control characters.

`npm run check:measurements` checks the current build sizes, hashes, preloaded representations and Markdown tables against the dated gallery. The current check binds the local direct-link build to all 16 normal browser comparisons, exact source/encoder/verifier hashes and the dated published baseline. It also binds the current DebugBear record to the same source/body sizes and checks the final scanner table cell against that completed report. It verifies eight intercepted HTTP Enter probes and one intercepted trusted mailto activation in each case. The separate enlarged-font record uses explicitly augmented fixtures; historical opening and hyperlink edits remain dated evidence.

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

The comparison checks pixels, text, comments, layout, link destinations, keyboard order, focused appearance and Enter activation in Chromium and WebKit at four widths and in both themes. Unexpected requests are blocked. HTTP keyboard probes receive intercepted local responses after destination checks; trusted native mailto clicks are prevented and inspected without launching a mail client. Reports and screenshots stay in `optimization/`.

## Hosting

nginx serves the published website from the origin server directly; Cloudflare provides DNS only. [tom.kimberlin.net](https://tom.kimberlin.net/) redirects to it. Pushing to GitHub does not deploy the site. Finished website edits also require `npm run deploy -- YOUR_SSH_HOST`, using the configured hostname or local SSH alias, followed by a local build and live verification as described in the hosting guide.

The [hosting guide](server/README.md) explains the server configuration, deployment requirements and settings needed to host a copy.
