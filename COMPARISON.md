# Delivery overhead comparison

<!-- comparison:current:start -->
## Latest verified own-site result

Measured 2026-10-23: **1,021 B HTML; 389 B Brotli; 536 B gzip; 524 B deflate.** Three cold first-document exchanges count both directions. Delivery overhead subtracts the entire encoded body from each exchange.

Verified certificate components: **tomkimberlin.com 1,498 B; www.tomkimberlin.com 1,502 B; tom.kimberlin.net 1,503 B** (complete compressed Certificate handshake messages). These are component bytes; aliases have no complete-exchange measurement here.

| Measurement | Median | Range |
| --- | ---: | ---: |
| Complete TLS through first document | 5,641 B | 5,641–5,641 B |
| TLS minus complete body | 5,252 B | 5,252–5,252 B |
| Estimated TCP/IP + DNS through close | 7,281 B | 7,281–7,333 B |
| TCP/IP + DNS minus complete body | 6,892 B | 6,892–6,944 B |
| HTTP/2 plaintext minus complete body | 105 B | 105–105 B |

HTTP/3 transport-parameter component: **96 B → 87 B (9 B less)** with unchanged effective parameters ([verified component evidence](measurements/quic-parameters-20261023-status-live.json)); this does not establish a fixed complete-exchange or HTTP/2 saving.

Status-field components: **301: HTTP/2 5 → 4 B; HTTP/3 6 → 5 B. HTTP/3 404: 6 → 1 B; main 200 unchanged.** [Verified component evidence](measurements/status-encoding-20261023-live.json); no fixed whole-exchange saving is established.

[Overhead evidence](measurements/overhead-20261023-status.json), [verified deployment](measurements/deployment-20261023-status.json) and [page measurements](measurements/page-20261022-accessibility-local.json). Only this website was remeasured; this creates no new peer ranking. TLS and packet totals stop at different points, so their difference does not isolate TCP overhead. Three samples do not establish a timing or universal saving.

Refresh this section after every verified body or transport byte reduction. Complete totals show body savings even when body-subtracted overhead stays unchanged.
<!-- comparison:current:end -->

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

`npm run check:measurements` checks the current comparison against hashed live evidence, exact page bodies and the latest published verification. A changed working build requires a separate local-candidate section and matching evidence until deployed and measured. Update `measurements/comparison-current.json` and the latest figures together; the historical peer sample stays dated.

The [probe](tools/compare-gallery.py) requires a Linux host with Docker, host networking and raw-socket access. It captures metadata only for the connected local address, selected peer address and TCP source port, and requires HTTP 200 before publishing a decoded document. The capture interface is set to `br0` in the probe; change that binding if the host uses a different interface for outbound traffic.

From the repository root, build the OpenSSL/nginx image and then the measurement image:

```sh
docker build -t onekb-nginx:20261023c -f server/Dockerfile .
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
