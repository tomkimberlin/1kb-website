# Delivery overhead comparison — September 10, 2026

Tom's site had the lowest overhead in this six-site sample after subtracting each response body. This does not establish a global record or an absolute minimum.

The other sites were selected from [1kb.club](https://1kb.club/), including several of its smallest listed pages and `hi.mrkrk.me`, the possible match for the remembered Telegram contact. Their different amounts of content are excluded from the totals below.

| Site | TLS traffic through first document, minus body | Estimated TCP/IP + DNS through connection close, minus body |
| --- | ---: | ---: |
| [tomkimberlin.com](https://tomkimberlin.com/) | 5,403 B | 7,303 B |
| [pba.im/200B](https://pba.im/200B) | 7,692 B | 9,368 B |
| [cv.btxx.org](https://cv.btxx.org/) | 6,770 B | 8,930 B |
| [5.vg](https://5.vg/) | 7,246 B | 9,043 B |
| [1k.lom.me](https://1k.lom.me/) | 8,893 B | 10,943 B |
| [hi.mrkrk.me](https://hi.mrkrk.me/) | 6,764 B | 8,764 B |

Both columns count traffic in both directions. The second column additionally includes TCP/IP headers, connection setup and teardown, an 80 ms idle window, and A/AAAA/HTTPS DNS lookups over UDP to 1.1.1.1. It estimates segmentation of captured offload frames at a 1,500-byte MTU. The columns have different stopping points and should not be subtracted to calculate TCP overhead.

All six received the same representative Chromium request fields and compression preferences from the same OpenSSL 3.5.8 client. It offered HTTP/2 and HTTP/1.1, certificate compression and hybrid key exchange. Certificate and hostname verification stayed enabled. Each request used a new TLS context, with no resumption or browser cache.

The servers negotiated different capabilities: `pba.im` used HTTP/1.1; the rest used HTTP/2. `5.vg` selected TLS 1.2. `cv.btxx.org` and `hi.mrkrk.me` selected classical X25519; Tom's site, `pba.im` and `1k.lom.me` selected X25519MLKEM768. The client did not force a downgrade to make the numbers smaller.

Tom's compressed Certificate handshake message was 1,500 bytes. The comparison sites sent uncompressed Certificate messages of 3,399–4,124 bytes. Tom's server sent one 57-byte session ticket. This outweighed the smaller response headers on some other sites. The retained caching and encoding headers support cache reuse and correct representation selection.

These are controlled document exchanges, not complete browser traces. They exclude favicon/subresource discovery, redirect clicks, link-layer overhead, ARP/NDP cache misses and recursive DNS traffic beyond the chosen resolver. Different clients, routes, packet timing, trust stores, cached state and network links change the totals. Subtracting the body removes its bytes, but does not normalize incidental framing or packetization differences caused by its size. No physical-wire minimum is claimed.

[Raw measurements](measurements/gallery-20260910.json) include headers, TLS message lengths and packet metadata. No packet payloads or TLS secrets were saved. [The probe](tools/compare-gallery.py) ran in an ephemeral container on Alfred, using the site's compression-enabled OpenSSL and Python packages `h2`, `h11` and `brotli`. It captures only its explicitly selected remote address and owned TCP source port on `br0`; it does not alter server settings.
