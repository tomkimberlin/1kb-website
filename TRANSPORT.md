# Transport audit — September 10, 2026

The current page is 428 ASCII bytes. Its Brotli body is 229 bytes. “Under 1 KB” describes the HTML, not an entire HTTPS connection.

`https://tom.kimberlin.net` uses an empty Cloudflare Worker 301 redirect to the canonical domain. NEL and Report-To are removed by a hostname-scoped transform; Cloudflare identification and Alt-Svc remain. Plain HTTP uses a direct-to-canonical edge rule with a 167-byte body, avoiding the zone-wide HTTPS upgrade's additional redirect hop. The alias entry path adds Cloudflare response headers before the direct homepage request, and HTTPS adds a separate TLS connection. The historical measurements below cover `tomkimberlin.com`, not this additional alias path.

## Controlled hosting comparison

This comparison predates the lowercase `xmr.surf` label. Both endpoints used the same 271-byte Brotli body. The later copy edit did not change the server settings. See [the gallery comparison](COMPARISON.md) for subsequent measurements with the HTML body excluded.

Both endpoints served the exact same Brotli bytes for `tomkimberlin.com`. The client offered TLS certificate compression and post-quantum hybrid key exchange. Certificate and hostname verification remained enabled. These are controlled Python/OpenSSL requests with representative Chromium headers, not a browser trace.

| Through completion of the first response | Direct nginx | Cloudflare Worker |
| --- | ---: | ---: |
| HTTP/2 response headers, HPACK encoded | 91 B | 181 B |
| Body | 271 B | 271 B |
| Response HTTP/2 framing | 18 B | 27 B |
| Cold connection: encrypted TLS bytes, both directions | 5,648 B | 6,474 B |
| Resumed connection: encrypted TLS bytes, both directions | 4,111 B | 4,855 B |
| Cold connection: observed IPv4/TCP bytes | 6,496 B | 7,426 B |
| Cold connection: IPv4/TCP estimate at a 1,500-byte MTU | 6,600 B | 7,530 B |
| DNS: A + AAAA + HTTPS queries, including IPv4/UDP | 508 B | 608 B |
| Cold connection + those DNS queries, estimated | **7,108 B** | **8,138 B** |

The cold TLS reduction is **826 bytes, or 12.8%**. The last row saves approximately **1,030 bytes, or 12.7%**. These are measured samples, not fixed costs for every visitor. ECDSA signatures, edge selection, headers, packet timing and client implementations change the totals.

The final Cloudflare comparison used a temporary Worker route and a forced edge address while public DNS continued pointing directly to Alfred. That route was removed afterward. Both sides used the same client, hostname, request headers and body. Cloudflare also compressed its certificate; the comparison does not give only the direct server that advantage.

Raw results are in [measurements/](measurements/). The capture used Alfred's `br0` interface, filtered to the test client's two owned source ports and the destination. Packet payloads and TLS secrets were not saved. GSO/GRO produced oversized frames, so the MTU row adds estimated segmentation headers; it is not a literal physical-wire capture.

DNS used three individual UDP queries to `1.1.1.1`, without EDNS or DNSSEC. A browser may issue fewer queries or use a shared DoH/DoT connection. Recursive resolver traffic beyond the client's resolver is excluded. Both domains use direct A records, without a CNAME chain. No global IPv6 address is available on Alfred.

Ethernet, Wi-Fi, VPN, PPPoE, retransmissions and connection teardown are separate costs. An ordinary Ethernet link adds a header, FCS, preamble and inter-frame gap for each frame. Wi-Fi retransmission and aggregation depend on the radio link. A server setting cannot eliminate the client's browser headers, DNS method, TCP options or link-layer framing. The first-response boundary also differs from waiting for delayed acknowledgments or closing the connection; a separate single-request capture accounts for that lifecycle. It observed **6,833 IPv4/TCP bytes** for a cold connection including an 80 ms idle window and client close, or approximately **6,937 bytes** after segmentation. Adding the measured DNS queries gives **7,445 bytes**. On an ordinary Ethernet segment, an estimated 30 frames including DNS would add about 1,140 bytes of framing/preamble/gaps, bringing that example to roughly **8,585 bytes**. This excludes ARP/NDP cache misses and is not a Wi-Fi airtime measurement. See [the complete-connection result](measurements/direct-complete-connection.json).

## Server settings

- **Direct hosting:** Cloudflare is DNS-only. This removes its identification, reporting, timing and protocol advertisement headers from website responses. Some Cloudflare response fields are protected or inserted after transforms. [Cloudflare documentation](https://developers.cloudflare.com/rules/transform/response-header-modification/)
- **nginx 1.30.4:** the base image is pinned by digest. The build adds headers-more 0.40 and rebuilds OpenSSL 3.5.8 with Brotli, zlib and Zstandard certificate compression. Source archives have SHA-256 checks. The stock image's OpenSSL had all three algorithms disabled.
- **Certificate compression:** enabled for static certificate files, negotiated only with clients that support it. The final compressed Certificate handshake message was 1,500 bytes, versus Cloudflare's 1,813. This is TLS 1.3 certificate compression, not compression of application secrets. [nginx documentation](https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_certificate_compression), [RFC 8879](https://www.rfc-editor.org/rfc/rfc8879.html)
- **Certificate profile:** ECDSA P-256, one hostname per certificate, Let's Encrypt `tlsserver`. The apex leaf is 858 DER bytes; the earlier classic leaf was 914. The profile omits redundant certificate fields and renews automatically on its shorter lifetime. The `shortlived` profile currently retains the same revocation information, so shortening the lifetime further offers no structural size reduction. [Let's Encrypt profiles](https://letsencrypt.org/ca/docs/profiles/)
- **Certificate chain:** prefer ISRG Root X2. For the original certificate, this saved 1,140 DER bytes versus the default X1-compatible chain. The still-shorter Root YE chain failed strict trust validation and was rejected. [Let's Encrypt certificate chains](https://letsencrypt.org/ca/certificates/)
- **Resumption:** a shared server-side session cache, `ssl_session_tickets off`, and OpenSSL `NumTickets 1` produce one small stateful TLS 1.3 ticket. Resumption was verified. Completely disabling tickets saved a little on a cold connection but required full certificate handshakes later. [OpenSSL configuration](https://docs.openssl.org/3.5/man3/SSL_CONF_cmd/)
- **Headers:** retain Date, Content-Type, Content-Encoding, Vary and Cache-Control. Suppress Server and redundant Content-Length on HTTP/2 and HTTP/3. HTTP/1.1 keeps a length to delimit the response and preserve connection reuse. Empty redirects and errors have no HTML boilerplate.
- **Caching:** `max-age=86400` lets a fresh browser cache satisfy a repeat visit without fetching the page. Vary preserves encoding correctness. A new browser cache trace was unavailable because the test Mac was locked; the live headers were verified.
- **Protocols:** HTTP/2 is the normal HTTPS path. HTTP/3 remains reachable for clients with a cached advertisement, but nginx does not send Alt-Svc or advertise H3 through DNS. The controlled QUIC test had higher first-load byte overhead for this one-file page. Its client used classical key exchange, so it is not a pure protocol-only comparison with the hybrid-key HTTP/2 test.

Caddy 2.11.4 was also tested. It provided compact HTTP/2 headers and automatic HTTPS, but the tested Go build did not expose TLS certificate compression. The final nginx setup was smaller on cold and resumed connections. Native nginx ACME manages renewal; a local job validates and publishes certificate/key pairs and reloads nginx only when certificates change. No additional web proxy is involved.

TLS 1.2/1.3 support and hybrid key exchange remain enabled. Disabling modern cryptography, removing required metadata, abandoning HTTPS or sacrificing cache reuse can lower a selected counter while changing the service. There is no claim of a universal minimum.

## Verification and reproduction

`npm run verify:live` checks 80 HTTP/1.1 and HTTP/2 cases, including the PrivateBin and 1kb.club redirects and the removed Telegram path: exact Brotli/gzip/identity bodies, weighted negotiation, exclusions, HEAD, empty redirects/errors and unavailable internal files. HTTP/3, TLS resumption, strict certificate validation and access from an external server were checked separately. The hosting comparison kept the approved HTML and visible wording unchanged.

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/measure-transport.py --out http2.json
.venv/bin/python tools/measure-http3.py --ip YOUR_ORIGIN_IP --out http3.json
.venv/bin/python tools/measure-dns.py tomkimberlin.com dns.json
```

The Python interpreter must load an OpenSSL build with certificate compression enabled to reproduce that feature. macOS Homebrew OpenSSL on the test machine lacked those compression algorithms; the final comparison ran in a temporary client container using the same OpenSSL libraries as the server. `--single` measures one request per connection; the default also measures a second request on each connection.
