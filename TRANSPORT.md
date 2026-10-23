# Delivery settings

The page size in [build-report.json](build-report.json) covers the response body. Total traffic also includes request and response headers, TLS, DNS and network framing. Connection reuse, browser caching and client behavior affect that total.

The [October 23 deployment](measurements/deployment-20261023-native-quic.json) verifies the current page, runtime image and host scripts. It serves 1,021-byte HTML and a 389-byte Brotli body. [Current measurements](measurements/overhead-20261023-native-quic.json) subtract the full encoded body and retain signature and packet variation. Historical records remain dated evidence.

## Main website

nginx serves `tomkimberlin.com` directly. Cloudflare provides DNS only for this hostname.

- **Compression:** nginx serves precompressed Brotli, deflate, gzip or identity bytes according to `Accept-Encoding`, including quality weights, optional whitespace and exclusions.
- **Preloading:** the handler uses `js_preload_object` to load the built `representations.json` with its configuration. It decodes only the selected base64 value and returns the same bytes synchronously. This removes four file reads per request and keeps each worker on one release until reload; the JSON file is an internal build artifact.
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
- **Offline certificate cache:** the runtime can load a smaller precomputed Brotli message from `/tls/compressed/`. The [loader](server/certificate-cache.patch) keys files by the exact Certificate-body SHA256 and requires complete decompression, exact length and byte equality before using one. Missing or invalid files preserve ordinary compression. The [September 22 comparison](measurements/certificate-cache-20260922.json) saved 9 bytes for the measured main-host certificate, 8 for `www` and 2 for `tom.kimberlin.net`, conditional on client certificate-compression support. The [September 26 recipe tests](measurements/certificate-cache-20260926-local.json) keep the same main chain at 1,478 bytes and save another 3 and 2 bytes on the two aliases, producing 1,497 and 1,488 bytes. That recipe is now deployed; renewal may produce different savings.
- **Resumption:** a shared session cache and OpenSSL `NumTickets 1` support reuse with one stateful TLS 1.3 ticket.
- **Protocols:** TLS 1.2/1.3 and HTTP/2 are enabled. HTTP/3 is available without an Alt-Svc or DNS advertisement.
- **QUIC parameters:** omit `ack_delay_exponent=3` and `max_ack_delay=25`, their [RFC 9000 defaults](https://www.rfc-editor.org/rfc/rfc9000.html#section-18.2), saving [6 B](measurements/quic-defaults-20261023-live.json). Native OpenSSL QUIC also omits `max_udp_payload_size=65527` and `active_connection_id_limit=2`, saving [another 9 B](measurements/quic-native-defaults-20261023-live.json): 102 → 96 → 87 B, with unchanged effective values. Nondefaults stay explicit. The pinned native caller uses the full parameter buffer; other backends retain their existing encoding and early-data context. Builds check 207 serializer cases and 129 rejection controls per backend guard variant.

The [transport audit](measurements/payload-20260912.json) measured a 63-byte HTTP/2 header block and a 43-byte HTTP/3 header block. Date compression varies with its value. Changing TLS buffers alone—1, 4, 16 or 32 KB—produced the same traffic totals. The later saving came from avoiding an early response flush.

The [Dockerfile](server/Dockerfile), [nginx configuration](server/nginx.conf) and [request handler](server/site.js) define these settings. [Server configuration](server/README.md) covers certificate renewal and deployment.

The optional [certificate optimizer](server/cache-certificates.sh) runs in a separate container before a new certificate release is published. It receives public PEM files only, has no network access and publishes cache entries atomically. It retains any smaller exact saved candidate and its matching provenance, rejects output paths that alias its inputs, and checks the prebuilt encoder's recipe and binary hash against its adjacent manifest before loading it. A 45-second deadline with five-second forced-stop grace bounds this optional step; errors retain normal compression and do not delay renewal indefinitely. The runtime loader always validates against the newly loaded certificate, so an old entry cannot substitute a stale chain.

The image build runs 12 cache-loader cases covering valid installation, interrupted and short reads, malformed/stale/non-improving input, file-type checks and preservation of the fallback cache. The harness also injects allocation failures, checks existing OpenSSL errors and marks, and verifies successful retries. The September 22 audit also recorded six nginx configuration checks covering supported static use and rejecting incompatible configurations. The archived public fixture tests serialization and cache behavior without relying on its validity dates. The [local results](measurements/transport-20260926-local.json) record the allocation sweep and ASan/UBSan runs, including their platform limits.

The [October 22 bounded distance search](measurements/certificate-distance-pool-20261022-local.json) compares 64 legal distance-code choices while retaining the existing recipe, exact decoder checks and saved smaller output. Local and constrained Docker checks reduce the main certificate payload from 1,489 to 1,487 bytes, with 2–4 bytes saved on the aliases. [Live activation](measurements/deployment-20261022-followup.json) confirms complete messages of 1,499/1,505/1,503 bytes, including framing. Three cold exchanges show a two-byte median TLS reduction; packet-estimate ranges overlap. [Fresh measurements](measurements/overhead-20261022-certificate.json). Optional trial errors keep the validated baseline; a five-second trial-launch budget supplements the existing external deadline.

The [October 23 cache update](measurements/deployment-20261023-certificate.json) saves another 1 B on the main host and 3 B on `www`, preserving the exact decoded certificates. Complete messages are 1,498/1,502/1,503 B. The [saved streams](compression/certificates/README.md) retain their original producer metadata; the deployed encoder and renewal recipe are unchanged.

## TLS handshake records

The runtime includes the [TLS flight patch](server/tls-flight.patch). The patch combines the server's encrypted TLS 1.3 handshake messages into fewer records. With the tested AES-128-GCM cipher and no padding, each record adds 22 bytes: a five-byte header, one inner content-type byte and a 16-byte authentication tag.

| Handshake | Original records | Combined records | Record overhead saved |
| --- | ---: | ---: | ---: |
| Full, including Certificate or CompressedCertificate | 4 | 1 | 66 bytes |
| Resumed, without early data | 2 | 1 | 22 bytes |

These figures count record overhead independently of certificate and ECDSA signature sizes. They apply when the messages fit within the permitted record size; smaller negotiated limits can require more records. They are separate from the 22-byte HTTP/2 response saving above and do not change the page body.

The patch accumulates at most 16 KiB of handshake plaintext and uses OpenSSL's existing record writer. Overflow sends the accumulated prefix and returns to ordinary writes. Each logical message still updates the transcript once. Finished remains the final message under the handshake keys, and the existing flush precedes the switch to application keys. [RFC 8446 §5.1](https://www.rfc-editor.org/rfc/rfc8446.html#section-5.1) permits combining handshake messages while preserving record boundaries at key changes; [§4.4.4](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.4.4) defines Finished authentication and the following application-key records.

QUIC, TLS 1.2, client authentication, early data, asynchronous mode, server message callbacks and handshake mutation callbacks retain their original paths. Pending post-handshake authentication is excluded. The change preserves the negotiated keys, cipher, certificate validation and Finished verification.

The [TLS regression harness](tools/verify-tls-flight.c) passed 23 cases locally on macOS using verified client/server handshakes and application data. It covers Brotli certificate compression, HelloRetryRequest, actual session resumption, record-size limits, oversized certificates, partial-write mode, forced write retries, clear/reuse/free during pending output, and allocation failures that deliver alerts and recover. Async mode and accepted or rejected early data retain separate handshake records. A resumed test with a negotiated test extension forces retries while the combined buffer is pending; the extension is absent from the server configuration. The September 22 build also passed 219 tests across 23 selected upstream OpenSSL recipes. These checks establish the tested protocol and lifecycle behavior; they are not a claim of universal client compatibility or a complete browser-load measurement.

The September 26 Alpine image build passes 22 TLS cases and explicitly skips the async case: its OpenSSL reports `ASYNC_is_capable() == 0`. That platform limit is recorded in the [deployment evidence](measurements/deployment-20260926.json); the earlier macOS async check remains separate evidence. The runtime patch is unchanged by the test's capability check.

A broader [October 22 upstream check](measurements/upstream-tls-20261022-local.json) runs 42 selected recipes with zlib and Brotli: 41 pass, and one exposes an upstream TLSProxy bookkeeping defect when repacking several messages in one record. An isolated diagnostic correction preserves the record byte-for-byte and passes that test. The zlib-only control also identifies an exact-trace fixture that assumes separate records. Original upstream fixtures remain unchanged; these are documented representation-sensitive limitations, not silently counted passes.

[OpenSSL 3.5.9](https://openssl-library.org/news/openssl-3.5-notes/) fixes signature-validity bounds when `SSL_set_SSL_CTX` changes context; nginx calls that API during SNI selection. The [compatibility checks](measurements/openssl-359-20261022-local.json) preserve the patches and tested defaults, including 28 nonce, 22 flight and 96 cache cases in the full Linux image, with one unsupported async case skipped. The triggering provider mismatch was not demonstrated on these hosts, and no byte or timing gain is established.

## Compact ticket nonces

The [ticket nonce patch](server/ticket-nonce.patch) encodes OpenSSL's existing public ticket counter in its shortest unsigned big-endian form, with zero represented by an empty value. [RFC 8446 §4.6.1](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.6.1) permits a zero-length nonce and requires uniqueness across tickets on the same connection. The encoding is injective; the counter fails before wrap. The exact transmitted bytes also feed HKDF, so both endpoints derive the same PSK. Random ticket generation, secret entropy, cipher suites, certificate verification and replay settings are unchanged.

For this site's stateful configuration, the first NewSessionTicket shrinks from 57 to 49 bytes while retaining its 32-byte random ticket identity. This is a component measurement, separate from complete-exchange overhead. The [28-case harness](tools/verify-ticket-nonce.c) exercises full/resumed stateful and stateless handshakes, SHA-256/SHA-384, counter boundaries and exhaustion, retries, lifecycle reuse, parser limits and TLS 1.2. It runs against the combined production-feature OpenSSL build. Chromium resumed sessions with both nonce formats in isolated tests. WebKit loaded both variants but resumed neither control, so WebKit resumption remains unverified. [Local evidence](measurements/ticket-nonce-20261022-local.json).

Deployment readiness uses the existing private TLS listener with normal hostname and CA verification, and requires the exact immutable release path before checking the four public representations. The readiness URI returns an empty 404 publicly. Certificate publication similarly verifies the full served chains, including intermediates, before stamping success. Both paths have bounded probes and verify rollback as well as forward activation; a reload command alone only confirms signal delivery. Lock contention skips an overlapping job, while operational lock failures remain errors. [Recovery and accessibility regression evidence](measurements/recovery-accessibility-20261022-local.json).

[Public browser observations](measurements/browser-resumption-20261022-live.json) confirm Chromium resumption with ordinary certificate trust. WebKit loads the exact page but offers no PSK on repeat connections, including after natural idle closure, with a persistent profile and without request interception. No equivalent trusted eight-byte-nonce control was deployed in that investigation, so empty-nonce resumption compatibility remains unestablished.

A [direct persistent WebKit 26.6 trial on October 23](measurements/browser-resumption-20261023-direct-live.json) loaded the exact page three times with normal certificate validation. The calibrated passive observer captured complete TLS 1.3 Hello pairs on three flows without PSK offers, but process ownership could not be established. No equivalent trusted positive WebKit control was available, so resumption compatibility remains unresolved.

## Alias

`tom.kimberlin.net` and `www.tomkimberlin.com` use DNS-only A records pointing to the same server. Both HTTP and HTTPS return an empty 301 directly to `https://tomkimberlin.com`, preserving the path and query. Their HTTPS listeners use separate ECDSA certificates with automatic renewal and certificate compression. An alias visit still adds a redirect and, for HTTPS, a separate TLS connection.

## Verification

For this installation, commit and push finished website changes, then deploy with `npm run deploy -- YOUR_SSH_HOST`, using the configured hostname or local SSH alias, before running these checks. GitHub pushes alone do not update the origin server; server images and host scripts have a separate activation step in the [hosting guide](server/README.md#build-and-deploy).

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
