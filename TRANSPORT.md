# Delivery settings

The page size in [build-report.json](build-report.json) covers the response body. Total traffic also includes request and response headers, TLS, DNS and network framing. Connection reuse, browser caching and client behavior affect that total.

## Main website

Alfred serves `tomkimberlin.com` directly. Cloudflare provides DNS only for this hostname.

- **Compression:** nginx serves precompressed Brotli, gzip or identity bytes according to `Accept-Encoding`, including quality weights and exclusions.
- **Headers:** normal HTTP/2 responses keep Date, Content-Type, Content-Encoding, Vary and Cache-Control. Server is suppressed. Content-Length is omitted for HTTP/2 and HTTP/3 and retained for HTTP/1.1 framing.
- **Redirects and errors:** empty bodies avoid HTML boilerplate.
- **Caching:** `max-age=86400` allows a fresh browser cache to satisfy repeat visits. Vary keeps cached representations separate.
- **Certificates:** ECDSA P-256, one hostname per certificate, Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference.
- **Certificate compression:** the pinned OpenSSL build enables Brotli, zlib and Zstandard. nginx loads static certificates and enables compression for clients that support it.
- **Resumption:** a shared session cache and OpenSSL `NumTickets 1` support reuse with one stateful TLS 1.3 ticket.
- **Protocols:** TLS 1.2/1.3 and HTTP/2 are enabled. HTTP/3 is available without an Alt-Svc or DNS advertisement.

The [Dockerfile](server/Dockerfile), [nginx configuration](server/nginx.conf) and [request handler](server/site.js) define these settings. [Server operations](server/README.md) covers certificate renewal and deployment.

## Alias

`https://tom.kimberlin.net` returns an empty Cloudflare Worker 301 to the main website. A hostname-scoped transform removes NEL and Report-To; Cloudflare identification and Alt-Svc headers remain. This entry path adds a separate TLS connection and redirect.

Plain HTTP uses an edge rule that redirects directly to the main HTTPS address, avoiding an intermediate HTTPS-alias hop. Cloudflare supplies a 167-byte body for that HTTP response.

## Verification

```sh
npm run verify:live
npm run verify:alias
```

These checks cover exact page representations, encoding negotiation, HEAD, redirects, errors, and alias path/query preservation.

For fresh transport measurements:

```sh
mkdir -p optimization
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/measure-transport.py --out optimization/http2.json
.venv/bin/python tools/measure-http3.py --ip YOUR_ORIGIN_IP --out optimization/http3.json
.venv/bin/python tools/measure-dns.py tomkimberlin.com optimization/dns.json
```

The Python TLS client must use an OpenSSL build with certificate compression enabled to measure that feature. These probes measure controlled exchanges, not a complete browser load; their output states the measurement boundary.
