# Delivery overhead comparison

<!-- comparison:current:start -->
## Latest verified page

Verified 2026-10-28: **1,040 B HTML; 391 B Brotli; 541 B gzip; 529 B deflate.** [Page evidence](measurements/page-20261028-brotli-391-local.json) and [deployment evidence](measurements/deployment-20261028-brotli-391-page-only.json) bind the verified representations. This page verification does not measure delivery overhead.
<!-- comparison:current:end -->

The deployment record lists expected alias destinations; verifier logs retain aggregate pass results rather than per-request response records. The www check covers an HTTPS query redirect, while the other alias includes root, path and query checks. The readback trust flag includes a separate private readiness probe that clears CA overrides in its own process and uses normal certificate validation. Log hashes identify retained private files; they do not authenticate observations, identify the trust store or libraries, or establish which worker served each public request.

The October 27 deployment record does not specify Node or zlib versions. The checker recomputes gzip selection using the current runtime, which establishes present reproducibility rather than the deployment's original selection process.

The checker rejects committed symlinks and limits decompression of saved gzip and Brotli candidates to the larger of 1 MiB or the source size plus one byte. The build can follow symlinks or ignore an unrelated candidate exceeding that limit, so those cases need separate evidence. The Brotli check repeats the build's stock encoder grid on the checker's Node/Brotli runtime; a different runtime can select different bytes and needs separate evidence.


<!-- comparison:measured:start -->
## Latest measured transport and dated components

Measured 2026-10-25: **1,021 B HTML; 389 B Brotli; 535 B gzip; 523 B deflate.** Three cold first-document exchanges count both directions. Delivery overhead subtracts the entire encoded body from each exchange.

Certificate components at this measurement: **tomkimberlin.com 1,498 B; www.tomkimberlin.com 1,502 B; tom.kimberlin.net 1,503 B** (complete compressed Certificate handshake messages). These are component bytes; aliases have no complete-exchange measurement here.

| Measurement | Median | Range |
| --- | ---: | ---: |
| Complete TLS through first document | 5,641 B | 5,641–5,642 B |
| TLS minus complete body | 5,252 B | 5,252–5,253 B |
| Estimated TCP/IP + DNS through close | 7,334 B | 7,333–7,385 B |
| TCP/IP + DNS minus complete body | 6,945 B | 6,944–6,996 B |
| HTTP/2 plaintext minus complete body | 105 B | 105–105 B |

Earlier verified HTTP/3 transport-parameter component: **96 B → 87 B (9 B less)** with unchanged effective parameters ([verified component evidence](measurements/quic-parameters-20261025-adjacent-live.json)); this does not establish a fixed complete-exchange or HTTP/2 saving.

Earlier verified status-field components: **301: HTTP/2 5 → 4 B; HTTP/3 6 → 5 B. HTTP/3 404: 6 → 1 B; main 200 unchanged.** [Verified component evidence](measurements/status-encoding-20261025-adjacent-live.json); no fixed whole-exchange saving is established.

HTTP/3 STREAM components: **1 B less in each of 3 first-accepted zero-offset frames** ([component evidence](measurements/quic-stream-offset-20261025-adjacent-live.json)); no fixed whole-exchange saving is established.

Earlier verified HTTP/3 response STREAM framing: **9 → 4 B (5 B less)** across the accepted response frames; the final marker is attached to the data frame ([component evidence](measurements/quic-fin-20261023-live.json)). Type-byte size is source-derived; other widths are observed. This does not establish a fixed complete-exchange saving.

Earlier verified HTTP/3 response STREAM headers: **4 → 2 B (2 B less)** in the one accepted FIN response frame; its two-byte LEN field is omitted ([component evidence](measurements/quic-stream-length-20261023-live.json)). The earlier FIN 9 → 4 B result remains dated evidence; this is a separate response-only field observation, not a fixed packet or complete-exchange saving.

HTTP/3 accepted control STREAM headers: **7 → 3 B (4 B less)** across the complete nine-byte setup sequence through the first exact document response ([component evidence](measurements/quic-adjacent-20261025-adjacent-live.json)); type-byte width is source-derived. No fixed packet, complete-exchange, HTTP/2 or latency saving is established.

<!-- comparison:fresh-gallery:start -->
### Six-site sample — October 23, 2026

Three cold first-document exchanges per site count both directions and subtract each complete encoded body. Values are median (range), in bytes.

| Website | TLS through first document, minus body | Estimated TCP/IP + DNS through close, minus body |
| --- | ---: | ---: |
| [This website](https://tomkimberlin.com/) | 5,253 (5,252–5,253) | 6,893 (6,892–6,945) |
| [cv.btxx.org](https://cv.btxx.org/) | 6,541 (6,539–6,570) | 8,753 (8,742–8,843) |
| [hi.mrkrk.me](https://hi.mrkrk.me/) | 6,765 (6,764–6,765) | 8,693 (8,653–8,764) |
| [5.vg](https://5.vg/) | 7,251 (7,251–7,251) | 9,048 (8,996–9,100) |
| [pba.im/200B](https://pba.im/200B) | 7,693 (7,693–7,693) | 9,369 (9,369–9,421) |
| [1k.lom.me](https://1k.lom.me/) | 8,894 (8,893–8,895) | 11,047 (10,945–11,048) |

[Peer evidence](measurements/gallery-20261023-integrated.json). All 18 requests passed normal certificate validation, complete SYN visibility and zero capture-drop checks. The frozen Python/OpenSSL client measured document exchanges. This dated sample remains separate from later own-site updates; three samples do not establish a timing or universal ranking claim.
<!-- comparison:fresh-gallery:end -->

[Overhead evidence](measurements/overhead-20261025-adjacent.json), [verified deployment](measurements/deployment-20261025-adjacent.json) and [page measurements](measurements/page-20261025-font-validation-local.json). The own-site result above and the dated peer sample have separate evidence. TLS and packet totals stop at different points, so their difference does not isolate TCP overhead. Three samples do not establish a timing or universal saving.

These figures remain tied to the measured page and deployment above. They do not describe the later verified page; a fresh measurement is required to update transport totals.
<!-- comparison:measured:end -->

The [October 26 hosting graph](docs/delivery-overhead/) now uses matched stock and optimized nginx test fixtures for its self-hosted bars. The separate live TLS reference and the broader packet/DNS evidence above remain dated.

The [project-name update](measurements/maintenance-20261025-intune-name.json) is deployed. The earlier transport figures above remain tied to their original page; no fresh overhead measurement is claimed.

<!-- comparison:gallery:start -->
## Historical six-site sample — September 22, 2026

Measured September 22, 2026, against five pages from [1kb.club](https://1kb.club/). This website had the lowest delivery overhead in this sample. Each result subtracts the response body, so having less text does not improve the ranking.

Each cell shows the median of three cold connections, in bytes. Both directions are counted.

| Website | TLS through first document, minus body | Estimated TCP/IP + DNS through connection close, minus body |
| --- | ---: | ---: |
| [This website](https://tomkimberlin.com/) | **5,251** | **6,995** |
| [cv.btxx.org](https://cv.btxx.org/) | 6,737 | 8,947 |
| [hi.mrkrk.me](https://hi.mrkrk.me/) | 6,763 | 8,692 |
| [5.vg](https://5.vg/) | 7,246 | 9,043 |
| [pba.im/200B](https://pba.im/200B) | 7,692 | 9,393 |
| [1k.lom.me](https://1k.lom.me/) | 8,892 | 11,098 |

The first column counts encrypted TLS traffic up to completion of the HTML response. The second includes TCP/IP setup, acknowledgments and teardown, an 80 ms idle window, and A/AAAA/HTTPS DNS queries over UDP to 1.1.1.1. It estimates segmentation of offloaded frames at a 1,500-byte MTU. The columns end at different points; subtracting them does not give TCP overhead.

## What accounts for the difference

This server sent a 1,490-byte compressed Certificate handshake message. The other servers sent uncompressed Certificate messages of 3,399–4,124 bytes. It also sent one 57-byte session ticket. Certificate compression and ticket size outweigh the slightly smaller response headers on some other sites. Combining the encrypted handshake messages also removes 66 bytes of TLS record overhead; the [before/after measurements](measurements/tls-flight-20260922.json) separate that saving from signature-length variation.

All sites received the same representative Chromium request fields and compression preferences from OpenSSL 3.5.8, with certificate compression, hybrid key exchange and certificate verification enabled. Every request used a new TLS context, without session resumption or a browser cache.

`pba.im` selected HTTP/1.1; the others selected HTTP/2. `5.vg` selected TLS 1.2. `cv.btxx.org` and `hi.mrkrk.me` selected X25519; this website, `pba.im` and `1k.lom.me` selected X25519MLKEM768.

## Scope and reproduction

At measurement time, the page was 742 bytes of HTML, 317 bytes with Brotli and 468 bytes with gzip. The [raw measurements](measurements/gallery-20260922.json) identify that HTML and Brotli by SHA-256 and include all three runs, ranges, response headers, TLS message lengths and packet metadata. The live Brotli hash matched in every run. Packet payloads, peer HTML and TLS secrets are not included.

The measurements cover the first document exchange on a cold connection. They exclude favicon/subresource discovery, link clicks, link-layer overhead, ARP/NDP cache misses and recursive DNS traffic beyond the chosen resolver. Subtracting the body does not remove incidental framing differences caused by its length. Client capabilities, connection reuse, cached state, routing and packet timing can change the totals.

The [October 5 own-site check](measurements/overhead-20261005.json) and [October 22 certificate check](measurements/overhead-20261022-certificate.json) remain dated evidence. The latest section above replaces their own-site figures; peer results remain the September 22 sample.

The October 22 runtime comparison used a frozen OpenSSL 3.5.8 client against the updated OpenSSL 3.5.9 server, with the same request fields and exact page bodies before and after. TLS and packet-overhead medians did not change during that runtime update. The evidence identifies client and server separately, including source hashes and versions. Historical package versions were not recorded, so the September client is not claimed bit-for-bit identical.

<!-- comparison:gallery:end -->

## Reproduce a new sample

`npm run check:measurements` checks the current comparison against hashed live evidence, exact page bodies and the latest published verification. A changed working build requires a separate local-candidate section and matching evidence until deployed and verified. Advance the page references with verified deployment evidence; transport remains tied to its measured page until a fresh measurement is reviewed. The historical peer sample stays dated.

The latest verified page and the dated transport measurement have separate evidence. Verifying a later page does not change earlier transport values; collect and review a fresh measurement before updating them.

The [probe](tools/compare-gallery.py) requires a Linux host with Docker, host networking and raw-socket access. It captures metadata only for the connected local address, selected peer address and TCP source port, and requires HTTP 200 before publishing a decoded document. The capture interface is set to `br0` in the probe; change that binding if the host uses a different interface for outbound traffic.

A socket-local kernel filter limits queued traffic to the selected peer and ports; the Python parser still checks the actual local address. Missing SYN/SYN-ACK, unavailable or inconsistent packet counters, or any reported socket drops fail the capture before a decoded document is published. Passing these checks supplies necessary capture-integrity evidence, not proof of complete link visibility. The September sample predates the counter checks.

From the repository root, build the OpenSSL/nginx image and then the measurement image:

```sh
docker build -t onekb-nginx:20261025a -f server/Dockerfile .
docker build -t onekb-gallery:local -f tools/gallery.Dockerfile .
```

These commands build a new client from the current sources; they do not recreate or overwrite the frozen October 22 measurement image. Record the actual image identity and dependency versions for each new comparison.

Collect a sample:

```sh
mkdir -p optimization/gallery
docker run --rm --network host --cap-drop ALL --cap-add NET_RAW \
  --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$PWD/tools/compare-gallery.py:/probe.py:ro" \
  -v "$PWD/optimization/gallery:/out" \
  onekb-gallery:local --out /out/run-1 --port 46280
```

Repeat with distinct output directories and source-port ranges for additional samples. Failed requests remain in `results.json` and make the command exit unsuccessfully; the runner still attempts every site. The output directory also receives the fetched HTML for local inspection; only `results.json` metadata is used in the published comparison.

The September 26 probe fixes preserve query strings and reject failed captures, incomplete responses and unrequested HTTP/2 streams; decoding is capped at 1 MiB per layer and each TLS/HTTP exchange at 30 seconds. These checks apply to future runs, leaving the September 22 table unchanged; run the offline regressions with `python3 tools/test_compare_gallery.py` after installing `tools/gallery-requirements.txt` in a Python virtual environment.
