# Delivery settings

The page size in [build-report.json](build-report.json) covers the response body. Total traffic also includes request and response headers, TLS, DNS and network framing. Connection reuse, browser caching and client behavior affect that total.

## Main website

nginx serves `tomkimberlin.com` directly. Cloudflare provides DNS only for this hostname.

- **Compression:** nginx serves precompressed Brotli, deflate, gzip or identity bytes according to `Accept-Encoding`, including quality weights and exclusions.
- **Headers:** normal HTTP/2 responses keep Date, Content-Type, Content-Encoding, Vary and Cache-Control. Server is suppressed. Content-Length is omitted for HTTP/2 and HTTP/3 and retained for HTTP/1.1 framing.
- **HTTP/1 persistence:** the redundant `Connection: keep-alive` field is omitted on persistent HTTP/1.1 responses, saving 24 bytes. HTTP/1.0's explicit keep-alive field, close signals and upgrades are preserved. The [before/after checks](measurements/http1-20260922.json) verify framing and actual connection reuse.
- **Header encoding:** the nginx patch uses HPACK static name indices and QPACK static name/value entries. HTTP/3 explicitly sends `text/html; charset=utf-8`, which has a one-byte QPACK entry.
- **HTTP/2 setup:** the receive window starts at the 65,535-byte protocol default and grows when request data arrives. The maximum inbound frame size stays at the 16,384-byte default. The matching stream-window and frame-size settings, and an unnecessary initial table-size reset, are omitted.
- **Redirects and errors:** empty bodies avoid HTML boilerplate and omit Content-Type. An HTTP/2 alias redirect sends only Date and Location.
- **Caching:** `max-age=86400` allows a fresh browser cache to satisfy repeat visits. Vary keeps cached representations separate.
- **Certificates:** ECDSA P-256, one hostname per certificate, Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference.
- **Certificate compression:** the pinned OpenSSL build enables Brotli, zlib and Zstandard. nginx loads static certificates and enables compression for clients that support it. The Brotli encoder compares its default with a quality-10, 2,048-byte-window pass and keeps the smaller output. This runs during static-certificate precompression; renewal uses the same comparison for the new certificates.
- **Resumption:** a shared session cache and OpenSSL `NumTickets 1` support reuse with one stateful TLS 1.3 ticket.
- **Protocols:** TLS 1.2/1.3 and HTTP/2 are enabled. HTTP/3 is available without an Alt-Svc or DNS advertisement.

The [transport audit](measurements/payload-20260912.json) measured a 63-byte HTTP/2 header block and a 43-byte HTTP/3 header block. Date compression varies with its value. TLS buffers of 1, 4, 16 and 32 KB produced the same traffic totals.

The [Dockerfile](server/Dockerfile), [nginx configuration](server/nginx.conf) and [request handler](server/site.js) define these settings. [Server configuration](server/README.md) covers certificate renewal and deployment.

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
.venv/bin/python tools/verify-http1.py --expected-body public/index.html.br --mode patched
.venv/bin/python tools/verify-http2.py
.venv/bin/python tools/measure-transport.py --out optimization/http2.json
.venv/bin/python tools/measure-http3.py --ip YOUR_ORIGIN_IP --out optimization/http3.json
.venv/bin/python tools/measure-dns.py tomkimberlin.com optimization/dns.json
```

Replace `YOUR_ORIGIN_IP` with the public IPv4 address of the website's server. The HTTP/3 probe defaults to `tomkimberlin.com` and checks the response against the local Brotli file. The Python TLS client must use an OpenSSL build with certificate compression enabled to measure that feature. These probes measure controlled exchanges, not a complete browser load; their output states the measurement boundary.
