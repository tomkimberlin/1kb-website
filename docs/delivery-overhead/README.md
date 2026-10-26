# Delivery-overhead graph

The graph counts **TLS connection bytes sent and received through the first complete HTTP/2 page response, minus the entire encoded page body**. It excludes TCP/IP and DNS. This differs from the broader packet-and-DNS estimate in the repository's [dated comparison](../../COMPARISON.md).

| Graph label | Overhead | Evidence |
| --- | ---: | --- |
| Cloudflare | 6,203 B | September 10, 2026: 2,148 + 4,326 − 271 B |
| Unoptimized self-hosted | 5,377 B | September 10, 2026: 2,132 + 3,516 − 271 B |
| Optimized self-hosted | 5,252 B | October 26, 2026: median of 5,253 / 5,252 / 5,252 B; each subtracts the complete 396 B body |

The first two bars come from an [archived controlled comparison](https://github.com/tomkimberlin/1kb-website/blob/d27361142429199c89e300630cbf9eb561eda9fe/TRANSPORT.md): a temporary Cloudflare Worker route and the direct origin served the same page to the same client. The Cloudflare value is **not a historical production capture or a general comparison of hosting providers**.

“Unoptimized” labels the initial self-hosted baseline before later tuning; that setup already included certificate compression and other configured features. The measurements used a home server. “Self-hosted” describes the approach, not a measured VPS result.

The [fresh measurement](fresh-measurement.json) matched the shipped page and retained normal certificate validation. All three captures observed connection setup without reported drops; page, release, image and configuration matched before and after. Historical and current client builds, request details and certificates differ, so the first-to-last difference is descriptive, not an isolated cumulative saving. No page-body saving is credited to overhead.

## Sources and rendering

[history-data.json](history-data.json) preserves the full timeline, source commit/blob IDs, SHA-256 hashes, sample counts and limits. The archived raw controls are [Cloudflare](https://github.com/tomkimberlin/1kb-website/blob/d27361142429199c89e300630cbf9eb561eda9fe/measurements/cloudflare-http2.json) and [direct origin](https://github.com/tomkimberlin/1kb-website/blob/d27361142429199c89e300630cbf9eb561eda9fe/measurements/direct-http2.json). The private capture itself is not published.

The [renderer](render.mjs) selects the first two and final timeline entries. Bars start at zero and share one scale. It produces the [PNG](delivery-overhead.png) and [SVG](delivery-overhead.svg); only the approved labels changed from the supplied three-bar design.

To render again with Node.js and Sharp 0.35.5, without changing the site's dependencies:

```sh
npm install --prefix /tmp/onekb-graph-render --no-save --package-lock=false sharp@0.35.5
SHARP_MODULE=/tmp/onekb-graph-render/node_modules/sharp node docs/delivery-overhead/render.mjs
```

SVG geometry is deterministic. PNG text rasterization can vary with installed fonts and the rendering platform. This is documentation only; it adds no asset or request to the live page.
