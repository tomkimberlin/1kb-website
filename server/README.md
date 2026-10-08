# Hosting

nginx serves [tomkimberlin.com](https://tomkimberlin.com/) from Docker on an Unraid host. Cloudflare provides DNS only. This directory contains the image, configuration and scripts for that installation.

The [Dockerfile](Dockerfile) pins nginx 1.30.4 and OpenSSL 3.5.8, with headers-more, certificate compression and patches for small responses and TLS records. The page representations are preloaded when nginx loads its configuration. [Delivery settings](../TRANSPORT.md) explains the patches, client-dependent savings and regression coverage, including the Alpine async-test limitation.

The latest recorded deployments are the [September 26 server release](../measurements/deployment-20260926.json) and [October 5 direct-link page release](../measurements/deployment-20261005-direct-links.json). Page deployment does not replace the server image or host scripts.

## Prepare an installation

These scripts target an existing Linux/Docker installation, with nginx configuration, an initial page release and certificates already in place. They are not a general installer.

The build/deploy client needs Node.js 22+, `sh`, SSH/SCP and `shasum`. Public verification also needs curl with HTTP/2. The Docker host needs curl, OpenSSL, a CA bundle, `flock`, `timeout` and GNU utilities including `mv -T`, `readlink -f`, `stat` and `sha256sum`; DNS updates also need Bash and jq.

Adapt these deployment-specific settings before hosting a copy:

| Setting | Files |
| --- | --- |
| Domains, redirects and link destinations | [nginx.conf](nginx.conf), [site.js](site.js) |
| Base paths, LAN address, ports, container name and image tags | [start.sh](start.sh), [deploy.sh](deploy.sh), [publish-certificates.sh](publish-certificates.sh), [cache-certificates.sh](cache-certificates.sh), [Unraid template](unraid-template.xml) |
| Cloudflare zones and record IDs | [update-dns.sh](update-dns.sh) |
| Certificate hostnames and trust-bundle path | [publish-certificates.sh](publish-certificates.sh), [cache-certificates.sh](cache-certificates.sh) |
| Public verification targets | [verify.mjs](verify.mjs), [verify-alias.mjs](verify-alias.mjs) |

The scripts use `/mnt/user/appdata/onekb-website`. Several hardcode the container name `onekb-website`; changing `ONEKB_CONTAINER` in the startup script alone is insufficient. Startup and deployment checks use LAN address `192.168.0.2`.

| Path under the base directory | Contents |
| --- | --- |
| `nginx/nginx.conf` | Active configuration |
| `site/releases/`, `site/current` | Immutable page releases and active symlink |
| `acme/` | ACME state and renewed certificates |
| `tls/releases/`, `tls/current` | Validated certificate/key releases |
| `tls/compressed/` | Optional public certificate encodings keyed by Certificate-body hash |
| `bin/`, `state/`, `backups/` | Host scripts, locks/state and rollback records |

Forward public port 80 to host TCP 8080, and 443 to host TCP/UDP 8443. The certificate-management listener on 9443 stays internal. DNS records must be unproxied. The container mounts site, configuration and published certificates read-only; ACME state is writable and temporary files use tmpfs. Docker uses `restart=unless-stopped`; Unraid autostart is separate.

## Deploy a page

GitHub pushes do not deploy this installation. Commit and push finished website changes, then run these commands from the repository root, replacing `YOUR_SSH_HOST` with the configured hostname or SSH alias:

```sh
npm run deploy -- YOUR_SSH_HOST
npm run build
npm run verify:live
npm run verify:alias
```

Deployment snapshots the source, build inputs, handler and configuration, builds all four representations plus `representations.json`, and uploads one immutable release. Under the certificate/deployment lock it validates nginx, switches the page symlink and reloads. Direct-origin checks require HTTP 200, the selected encoding and exact bytes; activation or verification failure restores the previous configuration and release. Old workers finish requests using their original preload snapshot.

Deployment leaves local `public/` unchanged. The explicit build refreshes it for verification; keep the checkout consistent with the deployed snapshot. The verifiers target the configured public domains. See [verification details](../TRANSPORT.md#verification).

The one-day browser cache may retain an older page. A fresh query string such as `?v=RELEASE_ID` checks the new version. Run `python3 tools/test_deployment.py` for mocked concurrency and rollback regressions without contacting a server.

## Build and deploy

Build on the Docker host from the repository root. Choose a fresh tag and retain previous images for rollback:

```sh
release_tag=YOUR_NEW_RELEASE_TAG
docker build -t "onekb-nginx:$release_tag" -f server/Dockerfile .
docker build --target certificate-optimizer \
  -t "onekb-certificate-optimizer:$release_tag" -f server/Dockerfile .
```

Install changed host scripts atomically under `bin/`, with backups. Set the runtime image in [start.sh](start.sh) or `ONEKB_IMAGE`, the optimizer image in [cache-certificates.sh](cache-certificates.sh), and the image/mount settings in the Unraid template. Validate the new image against the active configuration before replacing the container; verify the live service before removing rollback resources. A page deploy does not perform this activation.

Each page release includes the four body files, `representations.json`, `site.js` and `nginx.conf`. A replacement image needs njs with `js_preload_object` support (0.7.8+), alongside the required modules and patches.

## Certificates and DNS

nginx's native ACME module renews ECDSA certificates using Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference. Public listeners load static certificates so OpenSSL can precompress them.

[publish-certificates.sh](publish-certificates.sh) validates trust, hostname, at least one day's remaining validity and matching keys before atomically publishing a complete release. It tests/reloads nginx and restores the previous release on activation failure. It runs the optional certificate optimizer with a 45-second deadline and five-second forced-stop grace. Failure retains normal compression and does not block renewal.

[cache-certificates.sh](cache-certificates.sh) gives its isolated container only public PEM files, with no network or private-key mount. The runtime loader accepts a smaller cached encoding only after complete decompression and exact byte comparison. Missing, stale or invalid entries fall back to ordinary compression. The optimizer image includes the pinned encoder and provenance manifest. See [certificate-cache details](../TRANSPORT.md#main-website) for validation details. Standalone `python3 tools/optimize-certificates.py --build-encoder ENCODER.so` needs Python 3.12+ and a C compiler; reusing `--encoder ENCODER.so` also needs its emitted `ENCODER.so.json` manifest. `--archive` supplies the pinned source archive for an offline build.

The publisher reloads only when certificate fingerprints change. Refreshing compression for unchanged certificates requires running the cache helper, then explicitly testing/reloading nginx.

[update-dns.sh](update-dns.sh) checks the public IPv4 address, confirms changes with a second HTTPS lookup and updates configured unproxied Cloudflare A records. Its token belongs at `secrets/cloudflare-dns-token`, root-owned with mode 600 in a mode-700 directory, outside the web container. It needs Zone / DNS / Edit access for the configured zones and must remain usable after an IP change.

The recorded Unraid setup runs both host jobs every five minutes, using `/boot/config/plugins/user.scripts/onekb-certificates.cron` and `onekb-dns.cron`. Locks prevent overlapping runs. DNS changes/failures use syslog tag `onekb-dns`; `--verify-write` submits the current address to check write access. The scripts do not install these schedules.

## Recovery

To undo a page deployment, use its matching `backups/nginx.conf-RELEASE_ID` and `backups/previous-RELEASE_ID`: they hold the configuration and symlink target from **before that deployment**. Under the same `state/certificates.lock`, restore both, run `docker exec onekb-website nginx -t`, then `docker exec onekb-website nginx -s reload`. Certificate releases are independent of page releases.

For an image rollback, recreate the container with `ONEKB_IMAGE=PREVIOUS_IMAGE` and compatible startup/template settings. Keep the previous image, scripts and configuration until live verification passes.
