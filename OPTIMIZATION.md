# Optimization verification — September 10, 2026

Final content: **Hi, I'm Tom! GitHub**. Document title: **Tom Kimberlin**. The link follows `/g` to the GitHub profile.

## Response bodies

| Requested encoding | Received | Bytes | Compared to built file |
| --- | --- | ---: | --- |
| `br` | Brotli | 128 | Exact |
| `gzip` | Gzip | 195 | Exact |
| `identity` | Uncompressed | 230 | Exact |
| `br;q=0,gzip;q=0` | Uncompressed | 230 | Exact |
| `gzip, deflate, br, zstd` | Brotli | 128 | Exact |
| `br;q=0,gzip;q=1` | Gzip | 195 | Exact |
| `gzip;q=0.5,br;q=1` | Brotli | 128 | Exact |

Brotli was checked across 12 quality levels, three modes, 15 window sizes, and two size hints: **1,080 configurations**. The selected parameters are in `build-report.json`. Zopfli searches with 15, 100, 1,000, and 10,000 iterations all reached 195 bytes for this final source.

## Single-byte deletion check

All **230 possible single-byte deletions** were rendered in Chromium, Firefox, and WebKit at desktop and phone dimensions. The comparison covered document mode, title, viewport metadata, favicon target, visible content, hyperlink target, element geometry, and relevant computed styles.

The same two deletions survived the rendering checks in every engine:

| Variant | Raw HTML | Smallest Brotli found |
| --- | ---: | ---: |
| Final source | 230 | **128** |
| Remove the doctype separator | 229 | 133 |
| Remove the final CSS closing brace | 229 | 131 |

Neither improves the delivered Brotli size. This establishes a measured result for this deletion neighborhood; it does not prove global optimality across all possible HTML, CSS, compression encoders, or designs.

## Browser and cache checks

Chromium and Firefox cold navigations received HTTP 200, a 128-byte Brotli body, and 230 decoded bytes. A fresh revisit in each browser reported **zero transferred bytes**. The page loaded no subresources. Following the visible GitHub link reached `https://github.com/tomkimberlin`.

WebKit also rendered the production page in a mobile context without horizontal overflow. Observed cold largest-contentful-paint samples were approximately 224 ms in Chromium and 284 ms in Firefox; these are individual lab samples, not a Lighthouse score or a field-performance guarantee. Firefox negotiated HTTP/3, while the Chromium sample used HTTP/2.

The test Mac retained a stale negative system DNS entry after the new record was created. Authoritative DNS, public recursive DNS, Firefox, WebKit, and the origin server resolved the new site. Chromium's isolated test browser used a resolver override to the verified Cloudflare edge address; HTTPS hostname and certificate verification remained enabled. No system DNS settings were changed.

## Headers and framing

Two low-level HTTP/2 samples counted the decrypted response frames directly:

| Sample | First compressed header block | Body | Response frame overhead | First response total | Second response on same connection |
| --- | ---: | ---: | ---: | ---: | ---: |
| Basic request | 184 | 128 | 27 | **339** | 216 |
| Request with browser-style headers | 187 | 128 | 27 | **342** | 208 |

These totals exclude DNS, TCP/IP, TLS handshake and record overhead, request bytes, and connection-level HTTP/2 settings/window-update frames. The samples are observations, not fixed transfer sizes: cache status, timestamps, Cloudflare locations, header compression state, and optional edge-generated metadata vary.

Cloudflare refuses removal of its `Server` and `CF-*` headers. The API also refused removal of `Content-Length`. Attempts to shorten `Alt-Svc` were accepted as rules but overwritten in live responses, so that ineffective override was removed. `Server-Timing` and, for some HTTP/3 responses, `Priority` can be injected after response-header transforms; browser checks caught these even though a minimal curl request did not show them. The removal rule remains in place, but these fields are not claimed to be universally absent.

Verified removed optional fields include NEL/Report-To network reporting and cache-generated Last-Modified/Accept-Ranges metadata. `Date`, `Cache-Control`, `Vary`, encoding metadata, and HTTP/3 advertisement retain useful protocol and cache behavior.

The final origin returns empty bodies for redirects and 404s. HTTP-to-HTTPS redirection is handled by the origin rather than Cloudflare's Always Use HTTPS feature, avoiding that feature's 167-byte redirect body. Cloudflare still terminates public HTTPS, and the server remains reachable through the existing outbound tunnel.

## Operational checks

Caddy configuration validation and compressed round-trip checks passed. The Docker container was healthy, used about 12 MiB of RAM in the observed idle sample, and had no published host ports. The existing tunnel routes were preserved. Startup registration, version pinning, immutable releases, source hashes, and rollback procedures are recorded in the private operational runbook.
