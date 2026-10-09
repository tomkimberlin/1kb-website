# Hosting

Configuration and scripts for nginx on an Unraid/Docker host, with Cloudflare providing DNS only. The [Dockerfile](Dockerfile) pins nginx/OpenSSL and the required modules. [Delivery settings](../TRANSPORT.md) covers patches and test limits; [server](../measurements/deployment-20260926.json) and [page](../measurements/deployment-20261009-serif.json) records identify the latest verified deployments.

## Prepare an installation

Start with an existing Linux/Docker host, initial page release, nginx configuration and certificates.

The deploy client needs Node.js 22+ with npm, `sh`, SSH/SCP and `shasum`; public verification needs curl with HTTP/2. The host needs curl, OpenSSL, `/etc/ssl/certs/ca-certificates.crt`, `flock`, `timeout` and GNU utilities (`mv -T`, `readlink -f`, `stat`, `sha256sum`). DNS updates also need Bash and jq.

Adapt these installation-specific values:

| Setting | Files |
| --- | --- |
| Domains and redirects | [nginx.conf](nginx.conf), [site.js](site.js) |
| Paths, LAN address, ports, container/image names | [start.sh](start.sh), [deploy.sh](deploy.sh), [Unraid template](unraid-template.xml) |
| Certificate paths, hostnames, container/optimizer names | [publish-certificates.sh](publish-certificates.sh), [cache-certificates.sh](cache-certificates.sh) |
| Cloudflare zones and record IDs | [update-dns.sh](update-dns.sh) |
| Verification targets | [verify.mjs](verify.mjs), [verify-alias.mjs](verify-alias.mjs) |

Defaults are `/mnt/user/appdata/onekb-website`, LAN address `192.168.0.2` and container `onekb-website`. Deployment and certificate scripts hardcode the container name; startup overrides alone do not update them.

Under the base directory, `nginx/nginx.conf` is active configuration; `site/releases/` and `tls/releases/` hold immutable releases with `current` symlinks. `acme/` holds renewal state, `tls/compressed/` optional certificate encodings, `bin/` host scripts, `state/` locks and `backups/` rollback records.

Forward public 80 to host TCP 8080 and 443 to TCP/UDP 8443; keep listener 9443 internal and DNS unproxied. Site/configuration/TLS mounts are read-only; ACME state is writable. Unraid autostart is separate from Docker's `restart=unless-stopped`.

## Deploy a page

Commit and push finished website changes, then run from the repository root with the configured SSH hostname or alias:

```sh
npm run deploy -- YOUR_SSH_HOST
npm run build
npm run verify:live
npm run verify:alias
```

Deployment builds a private snapshot into an immutable release: four bodies, `representations.json`, `site.js` and `nginx.conf`. Under the certificate lock it validates nginx, activates and reloads, then checks exact bytes and encodings; failure restores the previous configuration/release. Server images and host scripts need separate activation.

Deployment leaves local `public/` unchanged; the subsequent build refreshes it for [public verification](../TRANSPORT.md#verification). Keep the checkout consistent with the deployed snapshot. A fresh query such as `?v=RELEASE_ID` bypasses the one-day browser cache. Offline deployment regressions: `python3 tools/test_deployment.py`.

## Build and deploy

Build images on the Docker host with fresh tags:

```sh
release_tag=YOUR_NEW_RELEASE_TAG
docker build -t "onekb-nginx:$release_tag" -f server/Dockerfile .
docker build --target certificate-optimizer \
  -t "onekb-certificate-optimizer:$release_tag" -f server/Dockerfile .
```

Set the runtime tag through `ONEKB_IMAGE` or `start.sh`, the optimizer tag in `cache-certificates.sh`, and update the Unraid template. Install changed host scripts atomically under `bin/`, retaining backups. Validate against the active configuration, recreate the container and verify publicly before removing rollback resources. Replacement images need the required patches/modules and njs `js_preload_object` support (0.7.8+).

## Certificates and DNS

Native nginx ACME renews ECDSA certificates using Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference. The publisher checks trust, hostname, at least one day's validity and matching keys before atomically activating a complete release; failed activation rolls back.

Optional compression receives public PEM files only, without network or private keys, with a 45-second deadline and five-second stop grace. Failure permits renewal with normal compression. The runtime accepts cached encodings only after complete decompression and exact comparison. Refreshing unchanged certificates' compression requires running the helper, testing and reloading nginx.

Standalone `python3 tools/optimize-certificates.py --build-encoder ENCODER.so` needs Python 3.12+ and a C compiler. Reusing `--encoder ENCODER.so` requires its generated `ENCODER.so.json`; `--archive` supplies pinned sources offline.

DNS updates confirm IPv4 changes with a second lookup. Store the Cloudflare token at `secrets/cloudflare-dns-token`, root-owned mode 600 inside a mode-700 directory, outside the container. It needs Zone / DNS / Edit access and must work after an IP change. `--verify-write` submits the current address to check access.

The recorded five-minute Unraid schedules are `/boot/config/plugins/user.scripts/onekb-certificates.cron` and `onekb-dns.cron`; install them separately. Locks prevent overlapping runs.

## Recovery

Undo a page deployment using its paired `backups/nginx.conf-RELEASE_ID` and `backups/previous-RELEASE_ID`: both describe the state **before that deployment**. Under `state/certificates.lock`, restore configuration and the `site/current` symlink, then run `docker exec onekb-website nginx -t` and `docker exec onekb-website nginx -s reload`. Certificate releases are independent.

For image rollback, recreate the container with `ONEKB_IMAGE=PREVIOUS_IMAGE` and compatible scripts, mounts and configuration. Retain rollback resources until live checks pass.
