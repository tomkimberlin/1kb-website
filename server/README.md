# Hosting

This directory contains the nginx configuration and deployment scripts for [tomkimberlin.com](https://tomkimberlin.com/). The server runs in Docker on Unraid. Cloudflare provides DNS; visitors connect directly to nginx.

The custom image includes nginx 1.30.4, OpenSSL 3.5.8, certificate compression and the headers-more module. [Dockerfile](Dockerfile) pins the source versions. The [response-encoding patch](small-responses.patch) compacts HTTP/1.1 headers, combines small buffered HTTP/2 responses into fewer TLS records, and reduces HTTP/2 setup and HPACK/QPACK overhead. The [certificate-compression patch](certificate-compression.patch) compares two Brotli settings and keeps the smaller result.

The September 26 changes have been tested locally and are not deployed. They preserve HTTP/1.0 framing for connection reuse, accept optional whitespace in encoding preferences, and retain the default certificate compression if the optional trial cannot allocate memory. The certificate test now injects allocation failures and checks that successful fallback preserves OpenSSL's error queue. The [local results](../measurements/transport-20260926-local.json) identify the build and checks; the [verification guide](../TRANSPORT.md#verification) describes the isolated runner.

Image `onekb-nginx:20260922g` includes the [TLS flight patch](tls-flight.patch). It combines eligible encrypted TLS 1.3 server handshake records, saving 66 bytes on the tested full handshake and 22 bytes on resumption. It preserves message contents, transcript updates, negotiated keys and Finished verification. A 16 KiB plaintext cap and the existing record writer preserve fragmentation limits; overflow returns to ordinary writes. QUIC, TLS 1.2, client authentication, early data, asynchronous mode and server message callbacks retain their original paths. See [scope and measurements](../TRANSPORT.md#tls-handshake-records).

The image build runs [certificate-compression checks](../tools/verify-certificate-compression.c) and the [23-case TLS regression harness](../tools/verify-tls-flight.c) before copying the libraries into the runtime image. The harness verifies complete handshakes and application data, including forced write retries, record-size limits, resumption, pending-buffer cleanup, allocation-failure alerts, and the separate-record paths for async mode and early data. The September 22 build also passed 219 tests across 23 selected upstream recipes; the complete upstream suite is not claimed.

The [certificate-cache loader](certificate-cache.patch) optionally replaces the normal Brotli result with a smaller offline encoding. It selects the file by the exact Certificate-body hash, fully decompresses it and requires byte-for-byte equality before installation. Missing, stale, malformed or non-improving entries retain ordinary compression. [Published measurements](../measurements/certificate-cache-20260922.json) show 9, 8 and 2 bytes saved for the measured apex, `www` and alternate-host certificates. The [local September 26 recipe](../measurements/certificate-cache-20260926-local.json) retains the 1,478-byte apex result and reduces the two aliases by another 3 and 2 bytes, to 1,497 and 1,488 bytes. This recipe has not been deployed; savings depend on the certificate and client support.

The Docker build also runs the [cache-loader test](../tools/verify-certificate-cache.c): 12 semantic cases, both decoder-creation failures, and a sweep that fails each observed OpenSSL allocation with an empty queue or caller-owned errors and marks. It verifies exact fallback bytes, error-queue preservation and successful retry, including failed cache installation. Allocation counts depend on the build. Its archived public certificate is a byte-validation fixture; expiration does not affect these loader checks. No production private key is part of the fixture.

## Hosting a copy

The scripts target an existing installation. They require Docker, SSH, curl, `timeout`, `flock` and a prepared directory layout with nginx configuration and initial certificates. Building the page requires Node.js 22+, `sh` and Bash.

The following settings are specific to this deployment:

| Setting | Configuration |
| --- | --- |
| Domains and short-link destinations | [nginx.conf](nginx.conf), [site.js](site.js) |
| Host paths, container ports and image | [start.sh](start.sh), [deploy.sh](deploy.sh), [Unraid template](unraid-template.xml) |
| Cloudflare zones and DNS record IDs | [update-dns.sh](update-dns.sh) |
| Certificate paths and hostnames | [publish-certificates.sh](publish-certificates.sh) |
| Public URLs checked after deployment | [verify.mjs](verify.mjs), [verify-alias.mjs](verify-alias.mjs) |

A separate installation needs its own values in these files. The default base directory is `/mnt/user/appdata/onekb-website`:

| Path | Contents |
| --- | --- |
| `nginx/nginx.conf` | Active nginx configuration |
| `site/releases/`, `site/current` | Immutable page releases and the active-release symlink |
| `acme/` | ACME account state and renewed certificates |
| `tls/releases/`, `tls/current` | Validated certificates and keys used by public listeners |
| `tls/compressed/` | Optional Brotli certificate messages keyed by the exact Certificate-body SHA256 |
| `bin/` | Startup, certificate publishing and DNS scripts |
| `backups/` | Previous configuration and release pointers |

The container publishes HTTP on host port 8080 and HTTPS on TCP/UDP 8443. Public ports 80 and 443 must reach those ports. The certificate-management listener on 9443 is internal to the container. DNS records must be unproxied to use nginx's minimal responses directly.

## Build and deploy

Build the server image on the Docker host from the repository root:

```sh
docker build -t onekb-nginx:20260922g -f server/Dockerfile .
docker build --target certificate-optimizer -t onekb-certificate-optimizer:20260922g -f server/Dockerfile .
```

Install [cache-certificates.sh](cache-certificates.sh) as `bin/cache-certificates.sh` under the configured base directory. The optimizer image compiles its encoder during the image build and receives only public PEM certificates when run. Standalone `python3 tools/optimize-certificates.py --build-encoder ENCODER.so` requires Python 3.12+ and a C compiler; `--archive` accepts the pinned source archive for an offline build. Reusing `--encoder ENCODER.so` also requires the emitted `ENCODER.so.json` manifest, which binds the binary hash to the pinned recipe. Rebuild older standalone encoders before reuse.

[start.sh](start.sh) launches the container using the configured paths, page files and initial certificates. The supplied [Unraid template](unraid-template.xml) provides the same mounts and port mappings for Unraid's container interface.

Each page release must include the four built body files, `representations.json`, `site.js` and its nginx configuration. The build writes the JSON snapshot as base64 strings; nginx's `js_preload_object` loads it when validating or reloading configuration. The handler decodes only the selected representation and performs no file reads during a request. This requires njs with `js_preload_object` support (0.7.8 or newer).

For an existing installation, deploy a page from the repository root. `YOUR_SSH_HOST` is the target host's SSH name or alias:

```sh
npm run deploy -- YOUR_SSH_HOST
npm run build
npm run verify:live
npm run verify:alias
```

Deployment takes a private snapshot of the page, build script, compression candidates, request handler and configuration, then builds all four representations and their preload JSON there. Each run uploads its own release, so concurrent builds cannot mix files or overwrite another run's configuration. It pins both the handler and preload paths to that immutable release. Under the deployment lock, it validates nginx, switches the release symlink and reloads. Old workers retain their original preloaded bytes while finishing requests. Direct-origin checks require HTTP 200, the selected encoding and exact bytes; failed activation, verification or interruption restores the previous configuration and release. The server image is managed separately.

Deployment leaves the checkout's `public/` directory unchanged. The explicit local build above refreshes the files used by verification; keep the source consistent with the deployed snapshot. Verification covers encoding negotiation, redirects, errors and aliases, and its configured domains must match the target installation. See [verification details](../TRANSPORT.md#verification).

The [deployment regression tests](../tools/test_deployment.py) exercise concurrent builds, certificate snapshot races and rollback paths with mocked external commands. Run `python3 tools/test_deployment.py`; these tests do not contact a server.

## Certificates

nginx's native ACME module issues and renews ECDSA certificates using Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference. Internal listeners manage renewal; public listeners load static certificates so OpenSSL can precompress certificate messages.

[publish-certificates.sh](publish-certificates.sh) validates trust, hostname, remaining validity and matching keys. Before publishing a new release, it calls [cache-certificates.sh](cache-certificates.sh) with a 45-second deadline and five-second forced-stop grace. The isolated optimizer has no network access and mounts only public certificate PEM files, never their private keys. It atomically writes optional hash-named entries into `tls/compressed/`, retains smaller exact existing candidates with their matching provenance, and rejects output paths that alias its inputs. The [optimizer regression tests](../tools/test_certificate_optimizer.py) cover publication and provenance without native compilation or network access.

Optimizer absence, failure or timeout does not block certificate publication: nginx uses its normal compressed certificate wherever no validated smaller entry exists. The publisher then switches the complete certificate release, tests and reloads nginx, restoring the previous release on activation failure. It publishes and reloads only when the certificate fingerprint changes. Refreshing compression for unchanged certificates requires running the helper and explicitly testing/reloading nginx.

The publishing script runs every five minutes. On Unraid, its schedule is `/boot/config/plugins/user.scripts/onekb-certificates.cron`.

## Dynamic DNS

[update-dns.sh](update-dns.sh) checks the public IPv4 address every five minutes and updates the configured Cloudflare A records only when the address changes. A second HTTPS lookup confirms a new address. The updater preserves other record fields and rejects unexpected names, record types or proxied records.

The credential file is `secrets/cloudflare-dns-token` under the base directory, owned by root with mode 600 inside a mode-700 directory. The token needs Zone / DNS / Edit access for the configured zones and must allow requests after the host's public IP changes. It stays outside the web container and is passed to curl through stdin.

The Unraid schedule is `/boot/config/plugins/user.scripts/onekb-dns.cron`. A lock prevents concurrent runs. Changes and failures use the `onekb-dns` system-log tag; no-change runs are silent. The script's `--verify-write` option checks write access by submitting the current address without changing it.

## Container isolation

The root filesystem, site, configuration and published certificate mounts are read-only. ACME state is writable, and temporary files use tmpfs. Linux capabilities are limited to binding ports and the group initialization required by nginx's manager process.

The container uses `restart=unless-stopped`. Unraid autostart is configured separately from Docker's restart policy.

## Recovery

A page release can be restored by pointing `site/current` to a previous release and restoring its matching `backups/nginx.conf-*` file. nginx validates the configuration with `nginx -t` and loads it with `nginx -s reload`. Certificate state is independent of page releases.

For a server-image rollback, [start.sh](start.sh) accepts `ONEKB_IMAGE=PREVIOUS_IMAGE`. The startup script and Unraid template must reference compatible mounts and configuration for that image.
