# Optimization verification — September 10, 2026

Current content: a greeting, **IT manager. Sysadmin at heart.**, the **XMR.surf** Monero node, an **under 1 KB of HTML** note, four emojis, and GitHub/Source links. Document title: **Tom Kimberlin**.

## Response bodies

| Requested encoding | Received | Bytes | Compared to built file |
| --- | --- | ---: | --- |
| `br` | Brotli | 238 | Exact |
| `gzip` | Gzip | 325 | Exact |
| `identity` | Uncompressed | 400 | Exact |
| `br;q=0,gzip;q=0` | Uncompressed | 400 | Exact |
| `gzip, deflate, br, zstd` | Brotli | 238 | Exact |
| `br;q=0,gzip;q=1` | Gzip | 325 | Exact |
| `gzip;q=0.5,br;q=1` | Brotli | 238 | Exact |
| `gzip;q=1,br;q=0.2` | Gzip | 325 | Exact |
| `identity;q=1,br;q=0.5` | Uncompressed | 400 | Exact |
| Empty `Accept-Encoding` | Uncompressed | 400 | Exact |
| `*;q=0` | HTTP 406 | 0 | Empty |

Brotli was checked across 12 quality levels, three modes, 15 window sizes, and two size hints: **1,080 configurations**. The selected parameters are in `build-report.json`. Zopfli searches with 15, 100, 1,000, and 10,000 iterations produced a best result of 325 bytes for this final source.

## Single-byte deletion check

All **400 possible single-byte deletions** were checked. Twenty would corrupt UTF-8 and were rejected. The remaining **380** were rendered in Chromium, Firefox, and WebKit at desktop and phone dimensions, using HTML responses so encoding detection was tested. Comparisons covered encoding, document mode, title, viewport metadata, favicon target, visible text, all link targets, paragraph/link geometry, and relevant computed styles.

Only deletion of the doctype separator survived the rendering checks in all three engines:

| Variant | Raw HTML | Smallest Brotli found |
| --- | ---: | ---: |
| Final source | 400 | **238** |
| Remove the doctype separator | 399 | 250 |

The deletion increases the delivered size. The final CSS closing brace and final anchor closing tag are already omitted. This establishes a measured result for this deletion neighborhood; it does not prove global optimality across all possible HTML, CSS, compression encoders, or designs.

The wider source search considered 6,769 candidates, 376 mutations, and 46,440 parameter trials across 43 finalists. The three-byte UTF-8 BOM was smaller after compression than either a charset meta tag or removing the BOM and declaring the charset in HTTP. The build validates UTF-8 and rejects a source of 1,000 bytes or more, keeping the on-page claim true.

## Browser and cache checks

Chromium and Firefox cold navigations received HTTP 200, a 238-byte Brotli body, and 400 decoded bytes. A fresh revisit in each browser reported **zero transferred bytes**. The page loaded no subresources. The GitHub, XMR.surf, and Source links reached their intended destinations. The emojis decoded as UTF-8 and loaded no font or image resources.

WebKit also rendered the production page in a mobile context without horizontal overflow. Firefox negotiated HTTP/3, while the Chromium sample used HTTP/2. These are functional and transfer checks, not a Lighthouse score or a field-performance guarantee.

The mobile checks also covered a 320-pixel viewport. WebKit refetched the document after navigating to the Monero site and back, reporting 543 Resource Timing transfer bytes; the zero-transfer repeat result above is specific to the Chromium and Firefox checks.

The test Mac retained a stale negative system DNS entry after the new record was created. Authoritative DNS, public recursive DNS, Firefox, WebKit, and the origin server resolved the new site. Chromium's isolated test browser used a resolver override to the verified Cloudflare edge address; HTTPS hostname and certificate verification remained enabled. No system DNS settings were changed.

## Headers and framing

Two low-level HTTP/2 samples counted the decrypted response frames directly:

| Sample | First compressed header block | Body | Response frame overhead | First response total | Second response on same connection |
| --- | ---: | ---: | ---: | ---: | ---: |
| Basic request | 178 | 238 | 27 | **443** | 327 |
| Request with browser-style headers | 179 | 238 | 27 | **444** | 327 |

These totals exclude DNS, TCP/IP, TLS handshake and record overhead, request bytes, and connection-level HTTP/2 settings/window-update frames. The samples are observations, not fixed transfer sizes: cache status, timestamps, Cloudflare locations, header compression state, and optional edge-generated metadata vary.

Cloudflare refuses removal of its `Server` and `CF-*` headers. The API also refused removal of `Content-Length`. Attempts to shorten `Alt-Svc` were accepted as rules but overwritten in live responses, so that ineffective override was removed. `Server-Timing` and, for some HTTP/3 responses, `Priority` can be injected after response-header transforms; browser checks caught these even though a minimal curl request did not show them. The removal rule remains in place, but these fields are not claimed to be universally absent.

Verified removed optional fields include NEL/Report-To network reporting and cache-generated Last-Modified/Accept-Ranges metadata. `Date`, `Cache-Control`, `Vary`, encoding metadata, and HTTP/3 advertisement retain useful protocol and cache behavior.

The Worker returns empty bodies for redirects and 404s. HTTP-to-HTTPS redirection is handled by the Worker rather than Cloudflare's Always Use HTTPS feature, avoiding that feature's 167-byte redirect body.

During the earlier migration, the greeting-only home-server and Worker deployments delivered identical precompressed files. Removing the home server did not increase the HTML body. The Worker also omits origin-cache metadata such as `CF-Cache-Status`; header totals still vary between requests and protocols.

## Operational checks

Seventeen Worker tests cover exact compressed representations, quality weights and exclusions, the original-header workaround, HEAD responses, method handling, redirects, and missing paths. The Wrangler production dry run passed. Live custom-domain tests validated runtime-specific manual compression and HEAD metadata.

During that migration, the live encoding matrix passed with the home-server container stopped. The container was then removed, along with its Unraid startup entry, template, and both website tunnel ingress entries. Existing unrelated tunnel services were preserved. The custom domains point to the Worker, whose deployment has no bindings and whose source performs no fetch. Its temporary workers.dev endpoint and preview URLs are disabled.

The request transform remains necessary: on the temporary workers.dev endpoint, both `Accept-Encoding` and `cf.clientAcceptEncoding` reported `gzip, br` for an incoming `br;q=0,gzip;q=0`. On the production custom domain, the transform preserved that input and the Worker correctly returned uncompressed HTML. This was verified on the live edge, beyond the unit tests.

Removal details, archived files, and rollback notes are recorded in the private Alfred BookStack runbook and dated change log.
