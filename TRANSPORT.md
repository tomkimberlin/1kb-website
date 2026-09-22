# Delivery settings

The page size in [build-report.json](build-report.json) covers the response body. Total traffic also includes request and response headers, TLS, DNS and network framing. Connection reuse, browser caching and client behavior affect that total.

## Main website

nginx serves `tomkimberlin.com` directly. Cloudflare provides DNS only for this hostname.

- **Compression:** nginx serves precompressed Brotli, deflate, gzip or identity bytes according to `Accept-Encoding`, including quality weights and exclusions.
- **Headers:** normal HTTP/2 responses keep Date, Content-Type, Content-Encoding, Vary and Cache-Control. Server is suppressed. Content-Length is omitted for HTTP/2 and HTTP/3 and retained for HTTP/1.1 framing.
- **HTTP/1 persistence:** the redundant `Connection: keep-alive` field is omitted on persistent HTTP/1.1 responses, saving 24 bytes. HTTP/1.0's explicit keep-alive field, close signals and upgrades are preserved. The [before/after checks](measurements/http1-20260922.json) verify framing and actual connection reuse.
- **HTTP/1 syntax:** HTTP/1.1 responses omit optional spaces after header colons and use an empty reason phrase. The required space after the status code remains. The normal 200 response saves eight more bytes, reducing its headers from 177 to 169 bytes. HTTP/1.0 serialization is unchanged. [RFC 9112 §§4–5](https://www.rfc-editor.org/rfc/rfc9112.html#section-4) defines the permitted syntax.
- **Header encoding:** the nginx patch uses HPACK static name indices and QPACK static name/value entries. HTTP/3 explicitly sends `text/html; charset=utf-8`, which has a one-byte QPACK entry.
- **HTTP/2 setup:** the receive window starts at the 65,535-byte protocol default and grows when request data arrives. The maximum inbound frame size stays at the 16,384-byte default. The matching stream-window and frame-size settings, and an unnecessary initial table-size reset, are omitted.
- **HTTP/2 response records:** fully buffered GET 200 responses of at most 1,024 bytes submit HEADERS and DATA together through synchronous `r.return()`. This avoids one 22-byte TLS 1.3 record wrapper in the measured initial response. No timer delays delivery; error and flow-control paths flush pending headers. The [before/after measurements](measurements/response-records-20260922.json) separate this saving from variable handshake sizes.
- **Redirects and errors:** empty bodies avoid HTML boilerplate and omit Content-Type. An HTTP/2 alias redirect sends only Date and Location.
- **Caching:** `max-age=86400` allows a fresh browser cache to satisfy repeat visits. Vary keeps cached representations separate.
- **Certificates:** ECDSA P-256, one hostname per certificate, Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference.
- **Certificate compression:** the pinned OpenSSL build enables Brotli, zlib and Zstandard. nginx loads static certificates and enables compression for clients that support it. The Brotli encoder compares its default with a quality-10, 2,048-byte-window pass and keeps the smaller output. This runs during static-certificate precompression; renewal uses the same comparison for the new certificates.
- **Offline certificate cache:** image `onekb-nginx:20260922g` can load a smaller precomputed Brotli message from `/tls/compressed/`. The [loader](server/certificate-cache.patch) keys files by the exact Certificate-body SHA256 and requires complete decompression, exact length and byte equality before using one. Missing or invalid files preserve ordinary compression. The [comparison](measurements/certificate-cache-20260922.json) saves 9 bytes for the current main-host certificate, 8 for `www` and 2 for `tom.kimberlin.net`, conditional on client certificate-compression support. Renewal may produce different savings.
- **Resumption:** a shared session cache and OpenSSL `NumTickets 1` support reuse with one stateful TLS 1.3 ticket.
- **Protocols:** TLS 1.2/1.3 and HTTP/2 are enabled. HTTP/3 is available without an Alt-Svc or DNS advertisement.

The [transport audit](measurements/payload-20260912.json) measured a 63-byte HTTP/2 header block and a 43-byte HTTP/3 header block. Date compression varies with its value. Changing TLS buffers alone—1, 4, 16 or 32 KB—produced the same traffic totals. The later saving came from avoiding an early response flush.

The [Dockerfile](server/Dockerfile), [nginx configuration](server/nginx.conf) and [request handler](server/site.js) define these settings. [Server configuration](server/README.md) covers certificate renewal and deployment.

The optional [certificate optimizer](server/cache-certificates.sh) runs in a separate container before a new certificate release is published. It receives public PEM files only, has no network access and publishes cache entries atomically. A 45-second deadline with five-second forced-stop grace bounds this optional step; errors retain normal compression and do not delay renewal indefinitely. The runtime loader always validates against the newly loaded certificate, so an old entry cannot substitute a stale chain.

The image build runs 12 cache-loader cases covering valid installation, interrupted and short reads, malformed/stale/non-improving input, file-type checks and preservation of the fallback cache. Six nginx configuration checks cover supported static use and reject incompatible configurations. The archived public fixture tests serialization and cache behavior without relying on its validity dates.

## TLS handshake records

Image `onekb-nginx:20260922g` includes the [TLS flight patch](server/tls-flight.patch). The patch combines the server's encrypted TLS 1.3 handshake messages into fewer records. With the tested AES-128-GCM cipher and no padding, each record adds 22 bytes: a five-byte header, one inner content-type byte and a 16-byte authentication tag.

| Handshake | Original records | Combined records | Record overhead saved |
| --- | ---: | ---: | ---: |
| Full, including Certificate or CompressedCertificate | 4 | 1 | 66 bytes |
| Resumed, without early data | 2 | 1 | 22 bytes |

These figures count record overhead independently of certificate and ECDSA signature sizes. They apply when the messages fit within the permitted record size; smaller negotiated limits can require more records. They are separate from the 22-byte HTTP/2 response saving above and do not change the page body.

The patch accumulates at most 16 KiB of handshake plaintext and uses OpenSSL's existing record writer. Overflow sends the accumulated prefix and returns to ordinary writes. Each logical message still updates the transcript once. Finished remains the final message under the handshake keys, and the existing flush precedes the switch to application keys. [RFC 8446 §5.1](https://www.rfc-editor.org/rfc/rfc8446.html#section-5.1) permits combining handshake messages while preserving record boundaries at key changes; [§4.4.4](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.4.4) defines Finished authentication and the following application-key records.

QUIC, TLS 1.2, client authentication, early data, asynchronous mode, server message callbacks and handshake mutation callbacks retain their original paths. Pending post-handshake authentication is excluded. The change preserves the negotiated keys, cipher, certificate validation and Finished verification.

The [TLS regression harness](tools/verify-tls-flight.c) passes 20 cases using verified client/server handshakes and application data. It covers Brotli certificate compression, HelloRetryRequest, actual session resumption, record-size limits, oversized certificates, partial-write mode, forced write retries, clear/reuse/free during pending output, and allocation failures that deliver alerts and recover. A resumed test with a negotiated test extension forces retries while the combined buffer is pending; the extension is absent from the server configuration. The patched library also passes 219 tests across 23 selected upstream OpenSSL recipes. These checks establish the tested protocol and lifecycle behavior; they are not a claim of universal client compatibility or a complete browser-load measurement.

## Alias

`tom.kimberlin.net` and `www.tomkimberlin.com` use DNS-only A records pointing to the same server. Both HTTP and HTTPS return an empty 301 directly to `https://tomkimberlin.com`, preserving the path and query. Their HTTPS listeners use separate ECDSA certificates with automatic renewal and certificate compression. An alias visit still adds a redirect and, for HTTPS, a separate TLS connection.

## Verification

```sh
npm run build
npm run verify:live
npm run verify:alias
```

These checks use Node.js and curl with HTTP/2 support. They target the published domains and compare responses against the local `public/` files, so the checkout must match the deployed revision. They cover exact page representations, encoding negotiation, HEAD, redirects, errors, and alias path/query preservation. Testing another deployment requires updating the hostnames and expected redirects in `server/verify.mjs` and `server/verify-alias.mjs`.

The transport probes measure protocol framing and connection overhead:

```sh
mkdir -p optimization
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/verify-http1.py --expected-body public/index.html.br --mode patched --compact-headers
.venv/bin/python tools/verify-http2.py
.venv/bin/python tools/measure-transport.py --out optimization/http2.json
.venv/bin/python tools/measure-http3.py --ip YOUR_ORIGIN_IP --out optimization/http3.json
.venv/bin/python tools/measure-dns.py tomkimberlin.com optimization/dns.json
```

Replace `YOUR_ORIGIN_IP` with the public IPv4 address of the website's server. The HTTP/3 probe defaults to `tomkimberlin.com` and checks the response against the local Brotli file. The Python TLS client must use an OpenSSL build with certificate compression enabled to measure that feature. These probes measure controlled exchanges, not a complete browser load; their output states the measurement boundary.

The [response-buffering regression probe](tools/verify-response-buffering.py) uses an isolated TLS server with the [fixture snippets](tools/fixtures/response-buffering.conf) and [request handlers](tools/fixtures/response-buffering.js). Mount `tools/fixtures` at `/response-tests`, placing the import inside `http{}` and the locations inside the test server. Run the baseline with `--out baseline.json`, then the candidate with `--compare baseline.json --out candidate.json`; `--ip` and `--port` select each test listener. It compares statuses, body hashes, stream resets and connection outcomes while exercising zero-window stalls, rate limits, delayed readers, streaming and filter errors. These fixtures are not part of the public server configuration.
