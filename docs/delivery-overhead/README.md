# Delivery-overhead comparison

The graph counts **TLS bytes sent and received on a cold connection through the first complete HTTP/2 page response, minus the entire encoded body**. TCP/IP, DNS and connection-close traffic are excluded.

| Graph label | Overhead | Meaning |
| --- | ---: | --- |
| Cloudflare (archived) | 6,203 B | September 10, 2026 temporary-route control |
| Default self-hosted (test) | 5,421 B | Stock nginx 1.30.4; median of 5,420 / 5,421 / 5,421 B |
| Optimized self-hosted (test) | 4,432 B | Patched nginx 1.30.4; three samples of 4,432 B |

**The two self-hosted bars are matched test setups, not production measurements.** Both use the same generated ECDSA P-256 leaf/intermediate chain and explicit test CA. No production key or system trust store was accessed or changed. The [separate trusted live measurement](fresh-measurement.json) remains **5,252 B** with its different production certificate. It has not improved to 4,432 B.

Cloudflare's value comes from an [archived controlled experiment](https://github.com/tomkimberlin/1kb-website/blob/d27361142429199c89e300630cbf9eb561eda9fe/TRANSPORT.md), not a historical public-production capture or a universal provider comparison. It is not paired with these new fixtures; no Cloudflare-to-fixture saving is claimed.

## What “default” means here

The stock reference is the existing **official nginx 1.30.4 Alpine image**, manifest `nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c`, running OpenSSL 3.5.8. Its unmodified binary serves the same HTML with ordinary static-response headers. HTTPS, HTTP/2, the test certificate and document root are explicitly configured. Worker count, logs and temporary paths are adapted for unprivileged, read-only isolation. No custom TLS library, certificate compression, ticket tuning, response-header stripping or application compression is enabled.

This is one defined stock-server reference, **not a default for every self-hosted website**. nginx's documented defaults leave [gzip](https://nginx.org/en/docs/http/ngx_http_gzip_module.html#gzip) and [certificate compression](https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_certificate_compression) off; HTTPS and [HTTP/2](https://nginx.org/en/docs/http/ngx_http_v2_module.html#http2) need configuration.

The optimized arm uses the recorded production image and applicable HTTP/2/TLS/handler settings, with that same test chain. It uses runtime certificate compression; the offline certificate-cache optimization is excluded. The exact configurations, public test certificates and probe are in [default-reference/](default-reference/). The [measurement record](default-reference-20261026.json) gives image IDs, software versions, source hashes, all nine samples and safety checks.

Stock serves the complete **1,039 B identity body**; optimized serves **396 B Brotli**. Each whole body is subtracted. A secondary stock control serving the same 396 B Brotli file measured **5,436 B** median (5,436–5,437 B). Thus body bytes are not credited as overhead savings, though representation and headers can affect framing. Stock negotiated AES-256-GCM and optimized AES-128-GCM; both used TLS 1.3, HTTP/2 and X25519MLKEM768.

The primary pair differs by **989 B in this fixture**. Certificate choice, client, server version and configuration affect the result; it is not a universal saving or a speed claim.

## Why the old baseline was replaced

The old **5,377 B** point already had custom OpenSSL with certificate compression, a compact certificate profile/chain, one small stateful ticket, stripped response headers and precompressed page bodies. Calling it “unoptimized” overstated the baseline. It remains in [history-data.json](history-data.json), with its original source references, rather than being rewritten as a stock measurement.

## Method and reproduction

Three rounds rotated stock identity, optimized Brotli and the stock Brotli control. Each request used a fresh TLS context, the same frozen Python/OpenSSL client, ordered request headers, SNI and page source. Only owned loopback container namespaces were reachable: no host port was published, no production mount was used, all capabilities were dropped, and filesystems were read-only. A wrong-CA check failed before publishing a result. Production identity and configuration matched before/after, and all fixture containers were removed.

The probe retains the earlier MemoryBIO byte accounting and records its cutoff at the completed response, before subsequent drain/close traffic. A read can include co-arriving control bytes; the ranges preserve that limitation. No packet-capture total is substituted for TLS bytes.

On a Linux Docker host with the recorded stock, optimized and client images already available, use Python with `cryptography` to prepare a fresh test chain and run the bounded fixture:

```sh
npm run build
stage=$(mktemp -d /tmp/onekb-default-reference-XXXXXX)
python3 docs/delivery-overhead/default-reference/prepare-fixture.py --repo "$PWD" --out "$stage/source"
tar -C "$stage/source" -cf "$stage/input.tar" .
rm "$stage/source/key.pem"
sh docs/delivery-overhead/default-reference/run-fixtures.sh "$stage" "reference-$(date +%s)"
python3 docs/delivery-overhead/default-reference/summarize.py "$stage/results"
```

The harness pulls no images and changes no host service. Image IDs are retained local artifacts, not public tags; rebuilding from the recorded sources creates a new identity that must be reported. New keys, signatures and timestamps can change byte counts, so a rerun is a new sample, not a promised byte-identical replay. The first attempt's auxiliary route failed; none of its partial samples enter the published medians.

Render the graph with Node.js and Sharp 0.35.5:

```sh
npm install --prefix /tmp/onekb-graph-render --no-save --package-lock=false sharp@0.35.5
SHARP_MODULE=/tmp/onekb-graph-render/node_modules/sharp node docs/delivery-overhead/render.mjs
```

The renderer uses the archived Cloudflare point and the new primary fixture medians. Bars start at zero and share one scale; the PNG contains only labels and values. This is documentation only and adds no request to the live page.
