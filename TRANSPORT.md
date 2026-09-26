# Delivery settings

The page size in [build-report.json](build-report.json) covers the response body. Total traffic also includes request and response headers, TLS, DNS and network framing. Connection reuse, browser caching and client behavior affect that total.

The September 26 changes are local. The dated September 22 measurements describe the published deployment; the [local transport checks](measurements/transport-20260926-local.json) cover the current handler and optional certificate-compression fallback on an isolated server.

## Main website

nginx serves `tomkimberlin.com` directly. Cloudflare provides DNS only for this hostname.

- **Compression:** nginx serves precompressed Brotli, deflate, gzip or identity bytes according to `Accept-Encoding`, including quality weights, optional whitespace and exclusions.
- **Preloading:** the local handler uses `js_preload_object` to load the built `representations.json` with its configuration. It decodes only the selected base64 value and returns the same bytes synchronously. This removes four file reads per request and keeps each worker on one release until reload; the JSON file is an internal build artifact.
- **Headers:** normal HTTP/2 responses keep Date, Content-Type, Content-Encoding, Vary and Cache-Control. Server is suppressed. Content-Length is omitted for HTTP/2 and HTTP/3 and retained for HTTP/1 framing. Retaining it for HTTP/1.0 lets clients that request keep-alive reuse the connection; the earlier handler closed GET connections instead.
- **HTTP/1 persistence:** the redundant `Connection: keep-alive` field is omitted on persistent HTTP/1.1 responses, saving 24 bytes. HTTP/1.0's explicit keep-alive field, close signals and upgrades are preserved. The [before/after checks](measurements/http1-20260922.json) verify framing and actual connection reuse.
- **HTTP/1 syntax:** HTTP/1.1 responses omit optional spaces after header colons and use an empty reason phrase. The required space after the status code remains. The normal 200 response saves eight more bytes, reducing its headers from 177 to 169 bytes. HTTP/1.0 serialization is unchanged. [RFC 9112 §§4–5](https://www.rfc-editor.org/rfc/rfc9112.html#section-4) defines the permitted syntax.
- **Header encoding:** the nginx patch uses HPACK static name indices and QPACK static name/value entries. HTTP/3 explicitly sends `text/html; charset=utf-8`, which has a one-byte QPACK entry.
- **HTTP/2 setup:** the receive window starts at the 65,535-byte protocol default and grows when request data arrives. The maximum inbound frame size stays at the 16,384-byte default. The matching stream-window and frame-size settings, and an unnecessary initial table-size reset, are omitted.
- **HTTP/2 response records:** fully buffered GET 200 responses of at most 1,024 bytes submit HEADERS and DATA together through synchronous `r.return()`. This avoids one 22-byte TLS 1.3 record wrapper in the measured initial response. No timer delays delivery; error and flow-control paths flush pending headers. The [before/after measurements](measurements/response-records-20260922.json) separate this saving from variable handshake sizes.
- **Redirects and errors:** empty bodies avoid HTML boilerplate and omit Content-Type. An HTTP/2 alias redirect sends only Date and Location.
- **Caching:** `max-age=86400` allows a fresh browser cache to satisfy repeat visits. Vary keeps cached representations separate.
- **Certificates:** ECDSA P-256, one hostname per certificate, Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference.
- **Certificate compression:** the pinned OpenSSL build enables Brotli, zlib and Zstandard. nginx loads static certificates and enables compression for clients that support it. The Brotli encoder compares its default with a quality-10, 2,048-byte-window pass and keeps the smaller output. If the optional pass cannot allocate its buffer, the successful default and the caller's error queue are preserved. This runs during static-certificate precompression; renewal uses the same comparison for the new certificates.
- **Offline certificate cache:** image `onekb-nginx:20260922g` can load a smaller precomputed Brotli message from `/tls/compressed/`. The [loader](server/certificate-cache.patch) keys files by the exact Certificate-body SHA256 and requires complete decompression, exact length and byte equality before using one. Missing or invalid files preserve ordinary compression. The [published comparison](measurements/certificate-cache-20260922.json) saved 9 bytes for the measured main-host certificate, 8 for `www` and 2 for `tom.kimberlin.net`, conditional on client certificate-compression support. The [local September 26 recipe](measurements/certificate-cache-20260926-local.json) keeps the same main chain at 1,478 bytes and saves another 3 and 2 bytes on the two aliases, producing 1,497 and 1,488 bytes. It has not been deployed; renewal may produce different savings.
- **Resumption:** a shared session cache and OpenSSL `NumTickets 1` support reuse with one stateful TLS 1.3 ticket.
- **Protocols:** TLS 1.2/1.3 and HTTP/2 are enabled. HTTP/3 is available without an Alt-Svc or DNS advertisement.

The [transport audit](measurements/payload-20260912.json) measured a 63-byte HTTP/2 header block and a 43-byte HTTP/3 header block. Date compression varies with its value. Changing TLS buffers alone—1, 4, 16 or 32 KB—produced the same traffic totals. The later saving came from avoiding an early response flush.

The [Dockerfile](server/Dockerfile), [nginx configuration](server/nginx.conf) and [request handler](server/site.js) define these settings. [Server configuration](server/README.md) covers certificate renewal and deployment.

The optional [certificate optimizer](server/cache-certificates.sh) runs in a separate container before a new certificate release is published. It receives public PEM files only, has no network access and publishes cache entries atomically. It retains any smaller exact saved candidate and its matching provenance, rejects output paths that alias its inputs, and checks the prebuilt encoder's recipe and binary hash against its adjacent manifest before loading it. A 45-second deadline with five-second forced-stop grace bounds this optional step; errors retain normal compression and do not delay renewal indefinitely. The runtime loader always validates against the newly loaded certificate, so an old entry cannot substitute a stale chain.

The image build runs 12 cache-loader cases covering valid installation, interrupted and short reads, malformed/stale/non-improving input, file-type checks and preservation of the fallback cache. The harness also injects allocation failures, checks existing OpenSSL errors and marks, and verifies successful retries. The September 22 audit also recorded six nginx configuration checks covering supported static use and rejecting incompatible configurations. The archived public fixture tests serialization and cache behavior without relying on its validity dates. The [local results](measurements/transport-20260926-local.json) record the allocation sweep and ASan/UBSan runs, including their platform limits.

## TLS handshake records

Image `onekb-nginx:20260922g` includes the [TLS flight patch](server/tls-flight.patch). The patch combines the server's encrypted TLS 1.3 handshake messages into fewer records. With the tested AES-128-GCM cipher and no padding, each record adds 22 bytes: a five-byte header, one inner content-type byte and a 16-byte authentication tag.

| Handshake | Original records | Combined records | Record overhead saved |
| --- | ---: | ---: | ---: |
| Full, including Certificate or CompressedCertificate | 4 | 1 | 66 bytes |
| Resumed, without early data | 2 | 1 | 22 bytes |

These figures count record overhead independently of certificate and ECDSA signature sizes. They apply when the messages fit within the permitted record size; smaller negotiated limits can require more records. They are separate from the 22-byte HTTP/2 response saving above and do not change the page body.

The patch accumulates at most 16 KiB of handshake plaintext and uses OpenSSL's existing record writer. Overflow sends the accumulated prefix and returns to ordinary writes. Each logical message still updates the transcript once. Finished remains the final message under the handshake keys, and the existing flush precedes the switch to application keys. [RFC 8446 §5.1](https://www.rfc-editor.org/rfc/rfc8446.html#section-5.1) permits combining handshake messages while preserving record boundaries at key changes; [§4.4.4](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.4.4) defines Finished authentication and the following application-key records.

QUIC, TLS 1.2, client authentication, early data, asynchronous mode, server message callbacks and handshake mutation callbacks retain their original paths. Pending post-handshake authentication is excluded. The change preserves the negotiated keys, cipher, certificate validation and Finished verification.

The [TLS regression harness](tools/verify-tls-flight.c) passes 23 cases using verified client/server handshakes and application data. It covers Brotli certificate compression, HelloRetryRequest, actual session resumption, record-size limits, oversized certificates, partial-write mode, forced write retries, clear/reuse/free during pending output, and allocation failures that deliver alerts and recover. Async mode and accepted or rejected early data retain separate handshake records. A resumed test with a negotiated test extension forces retries while the combined buffer is pending; the extension is absent from the server configuration. The September 22 build also passed 219 tests across 23 selected upstream OpenSSL recipes. These checks establish the tested protocol and lifecycle behavior; they are not a claim of universal client compatibility or a complete browser-load measurement.

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

Replace `YOUR_ORIGIN_IP` with the public IPv4 address of the website's server. Both HTTP measurement probes require status 200, Brotli encoding and exact bytes on every response, including reused connections. They default to the local Brotli file; `--expected-body` selects an explicit deployment fixture, and `--ca` supplies a test CA. The HTTP/3 probe defaults to `tomkimberlin.com`. Reports redact cookie header values, including nested HTTP/3 header events. The Python TLS client must use an OpenSSL build with certificate compression enabled to measure that feature. These probes measure controlled exchanges, not a complete browser load; their output states the measurement boundary.

The DNS probe accepts ordinary, fully qualified and IDNA hostnames. It verifies the resolver, response flags and echoed question before counting bytes; truncated or mismatched replies fail instead of becoming measurements. Its tests use local datagram fixtures and need no network access: `python3 tools/test_measure_dns.py`.

To run all Python regression fixtures without contacting the published servers, install both `tools/requirements.txt` and `tools/gallery-requirements.txt` in the virtual environment, then run `.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v`. `npm run test:probes` runs the same command with `python3` from the active environment.

The [response-buffering regression probe](tools/verify-response-buffering.py) uses an isolated TLS server with the [fixture snippets](tools/fixtures/response-buffering.conf) and [request handlers](tools/fixtures/response-buffering.js). Mount `tools/fixtures` at `/response-tests`, placing the import inside `http{}` and the locations inside the test server. Run the baseline with `--out baseline.json`, then the candidate with `--compare baseline.json --out candidate.json`; `--ip` and `--port` select each test listener. It compares statuses, body hashes, stream resets and connection outcomes while exercising stream and connection window stalls, rate limits, delayed readers, streaming and filter errors. These fixtures are not part of the public server configuration.

For an already built nginx with these patches and statically linked njs and headers-more, [run-local-transport.py](tools/run-local-transport.py) prepares and removes the test configuration. It needs the Python dependencies above, Node.js 22+, curl with HTTP/2, and a test certificate valid for all three configured hostnames. With a local self-signed test certificate:

```sh
.venv/bin/python tools/run-local-transport.py \
  --nginx /path/to/patched/nginx \
  --ca /path/to/test-certificate.pem --key /path/to/test-key.pem \
  --baseline-ref da7b5f5 --baseline-legacy-http10 \
  --out optimization/transport-local.json
```

The runner binds only to loopback, serves identical current page files through the baseline and current handlers, and stops its nginx process on success or failure. `--cert` supplies a separate server chain when `--ca` is an issuer certificate. The probes verify against that explicit CA; they do not change system trust. The local checks include HTTP/1.0 reuse, encoding whitespace, HTTP/2 headers split across CONTINUATION frames, request bodies larger than the initial receive window, and response delivery after connection credit is exhausted. Building nginx and the OpenSSL C harnesses remains a separate step; the measurement records the tested source versions and build configuration.

The separate [HTTP/3 regression probe](tools/verify-http3.py) requires a QUIC listener. With the same test certificate, run `.venv/bin/python tools/verify-http3.py --ip 127.0.0.1 --port TEST_PORT --ca /path/to/test-certificate.pem --public-dir public --out optimization/http3-checks.json`. Its 36 checks cover the four exact representations, HEAD, encoding whitespace, redirects, errors, aliases and 16 concurrent requests. The local measurements include decoded QPACK fields and cold/resumed exchanges; the HTTP/1–2 runner does not launch QUIC.

The [header-encoding probe](tools/verify-header-encoding.py) uses its own [fixture snippets](tools/fixtures/header-encoding.conf) and [handler](tools/fixtures/header-encoding.js). After loading those on an isolated TLS/QUIC listener, run `.venv/bin/python tools/verify-header-encoding.py --ip 127.0.0.1 --port TEST_PORT --ca /path/to/test-certificate.pem`. Its 24 checks cover HPACK table-size changes, QPACK with no dynamic table, static and literal fields, duplicate values, and a response header block large enough to require CONTINUATION. `--protocol h2` selects TCP-only fixtures.
