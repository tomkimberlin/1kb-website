# Delivery overhead comparison

Measured September 11, 2026, against five pages from [1kb.club](https://1kb.club/). This website had the lowest delivery overhead in this sample. Each result subtracts the response body, so having less text does not improve the ranking.

Each cell shows the median of three cold connections, in bytes. Both directions are counted.

| Website | TLS through first document, minus body | Estimated TCP/IP + DNS through connection close, minus body |
| --- | ---: | ---: |
| [This website](https://tomkimberlin.com/) | **5,402** | **7,199** |
| [hi.mrkrk.me](https://hi.mrkrk.me/) | 6,762 | 8,702 |
| [cv.btxx.org](https://cv.btxx.org/) | 6,770 | 8,982 |
| [5.vg](https://5.vg/) | 7,246 | 9,095 |
| [pba.im/200B](https://pba.im/200B) | 7,692 | 9,368 |
| [1k.lom.me](https://1k.lom.me/) | 8,892 | 11,005 |

The first column counts encrypted TLS traffic up to completion of the HTML response. The second includes TCP/IP setup, acknowledgments and teardown, an 80 ms idle window, and A/AAAA/HTTPS DNS queries over UDP to 1.1.1.1. It estimates segmentation of offloaded frames at a 1,500-byte MTU. The columns end at different points; subtracting them does not give TCP overhead.

## What accounts for the difference

This server sent a 1,500-byte compressed Certificate handshake message. The other servers sent uncompressed Certificate messages of 3,399–4,124 bytes. It also sent one 57-byte session ticket. Certificate compression and ticket size outweigh the slightly smaller response headers on some other sites.

All sites received the same representative Chromium request fields and compression preferences from OpenSSL 3.5.8, with certificate compression, hybrid key exchange and certificate verification enabled. Every request used a new TLS context, without session resumption or a browser cache.

`pba.im` selected HTTP/1.1; the others selected HTTP/2. `5.vg` selected TLS 1.2. `cv.btxx.org` and `hi.mrkrk.me` selected X25519; this website, `pba.im` and `1k.lom.me` selected X25519MLKEM768. The client did not force smaller, weaker settings to improve a score.

## Scope and reproduction

The measured page at revision `7a11a30` was 570 bytes of HTML, 279 bytes with Brotli and 391 bytes with gzip. Its exact Brotli hash was verified in all three runs. The current design and copy have different [build sizes](build-report.json); the September 12 [delivery audit](measurements/payload-20260912.json) also reduced protocol overhead. The table above remains the original comparison, without substituting newer measurements for one participant. [Raw measurements](measurements/gallery-20260911.json) include every run, ranges, response headers, TLS message lengths and packet metadata. Packet payloads, peer HTML and TLS secrets are not included.

These are controlled document exchanges, not complete browser loads or a global ranking. They exclude favicon/subresource discovery, link clicks, link-layer overhead, ARP/NDP cache misses and recursive DNS traffic beyond the chosen resolver. Subtracting the body does not remove incidental framing differences caused by its length. Client capabilities, connection reuse, cached state, routing and packet timing can change the totals.

The [probe](tools/compare-gallery.py) requires a Linux host with Docker, host networking and raw-socket access. It captures metadata only for the selected peer address and TCP source port. The capture interface is set to `br0` in the probe; change that binding if the host uses a different interface for outbound traffic.

From the repository root, build the OpenSSL/nginx image and then the measurement image:

```sh
docker build -t onekb-nginx:20260912 -f server/Dockerfile .
docker build -t onekb-gallery:20260911 -f tools/gallery.Dockerfile .
```

Collect a sample:

```sh
mkdir -p optimization/gallery
docker run --rm --network host --cap-drop ALL --cap-add NET_RAW \
  --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$PWD/tools/compare-gallery.py:/probe.py:ro" \
  -v "$PWD/optimization/gallery:/out" \
  onekb-gallery:20260911 --out /out/run-1 --port 46280
```

Repeat with distinct output directories and source-port ranges for additional samples. The output directory also receives the fetched HTML for local inspection; only `results.json` metadata is used in the published comparison.
