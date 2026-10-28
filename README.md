# 1kb website

My personal page at [tomkimberlin.com](https://tomkimberlin.com/), and an experiment in HTTPS delivery overhead. One HTML document carries the text, CSS and direct links, with native light/dark styling and no scripts or font downloads.

Certificates and connection setup cost more than the page itself. Precompressed bodies and patched nginx/OpenSSL builds reduce those bytes while preserving certificate validation and connection reuse. I built the original page years ago; Astra helped optimize it. [How it works](OPTIMIZATION.md).

## Delivery overhead

![Cold-connection TLS overhead: an archived Cloudflare test measured 6,203 B; matched nginx tests measured 5,421 B stock and 4,432 B optimized.](docs/delivery-overhead/delivery-overhead.svg#gh-light-mode-only) ![Cold-connection TLS overhead: an archived Cloudflare test measured 6,203 B; matched nginx tests measured 5,421 B stock and 4,432 B optimized.](docs/delivery-overhead/delivery-overhead.svg#gh-dark-mode-only)

TLS bytes through the first complete HTTP/2 response, excluding the entire page body, TCP/IP, DNS and connection close. The nginx tests used the same certificate chain; Cloudflare is a separate archived temporary-route control. The October 26 live median was 5,252 B with a different certificate. [Definition, samples and method](docs/delivery-overhead/).

### Separate packet-and-DNS estimate

This broader measure counts traffic through connection close, including estimated TCP/IP and DNS.

**Delivery overhead = measured traffic − the entire encoded page body.**

**Latest measured transport result: 6,945 B estimated overhead, October 25, 2026.** Three cold own-site exchanges (6,944–6,996 B), measured before the project-name update below. [Evidence](measurements/overhead-20261025-adjacent.json).

<details>
<summary>Current page sizes and 1KB Club qualification</summary>

| Measurement | Scope | Verified live October 28, 2026 |
| --- | --- | ---: |
| Brotli response body | Encoded page body | 391 B |
| Gzip response body | Encoded page body | 541 B |
| Deflate response body | Encoded page body | 529 B |
| Raw HTML | Decoded page | 1,040 B |

The [October 25 page update](measurements/maintenance-20261025-intune-name.json) uses **Intune Device Workbench**. At the time, the longer name and URL added 7 B to the Brotli body. The October 27 serialization and October 28 fallback streams are verified live; no new delivery-overhead measurement is claimed.

The last [1KB Club](https://1kb.club/submit/) scanner check was October 5: [report](https://www.debugbear.com/test/website-speed/Gv3z2tDz/overview), [evidence](measurements/debugbear-20261005.json).

</details>

## Build

Use a current supported Node.js release (CI pins 24.22.1), npm, curl, `sh` and Bash:

```sh
npm ci
npm test
npm run check
npm run check:measurements
```

`index.html` is the source; the build writes four representations and nginx's preload snapshot to `public/`, plus [build-report.json](build-report.json). Keep source ASCII and use character references for Unicode. The 128 B response allowance is a build budget. The measurement check validates [build evidence](measurements/page-20261028-brotli-391-local.json) and the separately recorded [live deployment](measurements/deployment-20261028-brotli-391-page-only.json).

Optional browser comparisons need Playwright (`npm install --no-save --package-lock=false playwright`) and Chromium/WebKit (`npx playwright install chromium webkit`). Save the original HTML before editing, then run `npm run test:browser -- --baseline PATH_TO_ORIGINAL_HTML`. Python optimizer tests (`npm run test:optimizers`) need Python 3.

## Hosting

nginx runs directly on an Unraid/Docker host; Cloudflare provides DNS only. This control requires maintaining the server and patches, with availability tied to home power and connectivity. See [hosting and rollback](server/README.md) and [protocol verification](TRANSPORT.md#verification). GitHub pushes do not deploy the site.
