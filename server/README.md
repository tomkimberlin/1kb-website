# Hosting

This directory contains the nginx configuration and deployment scripts for [tomkimberlin.com](https://tomkimberlin.com/). The server runs in Docker on Unraid. Cloudflare provides DNS; visitors connect directly to nginx.

The custom image includes nginx 1.30.4, OpenSSL 3.5.8, certificate compression and the headers-more module. [Dockerfile](Dockerfile) pins the source versions. The [response-encoding patch](small-responses.patch) reduces HTTP/2 setup and HPACK/QPACK header overhead.

## Hosting a copy

The scripts target an existing installation. They require Docker, SSH, curl and a prepared directory layout with nginx configuration and initial certificates. Building the page requires Node.js 22+, `sh` and Bash.

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
| `bin/` | Startup, certificate publishing and DNS scripts |
| `backups/` | Previous configuration and release pointers |

The container publishes HTTP on host port 8080 and HTTPS on TCP/UDP 8443. Public ports 80 and 443 must reach those ports. The certificate-management listener on 9443 is internal to the container. DNS records must be unproxied to use nginx's minimal responses directly.

## Build and deploy

Build the server image on the Docker host from the repository root:

```sh
docker build -t onekb-nginx:20260912 -f server/Dockerfile .
```

[start.sh](start.sh) launches the container using the configured paths, page files and initial certificates. The supplied [Unraid template](unraid-template.xml) provides the same mounts and port mappings for Unraid's container interface.

For an existing installation, deploy a page from the repository root. `YOUR_SSH_HOST` is the target host's SSH name or alias:

```sh
npm run deploy -- YOUR_SSH_HOST
npm run verify:live
npm run verify:alias
```

Deployment builds the HTML, Brotli, gzip and deflate files, validates nginx with the new request handler, switches the release symlink and reloads nginx. It checks the served bytes and restores the previous configuration and release if activation fails. The server image is managed separately.

The verification commands compare responses with the local build and cover encoding negotiation, redirects, errors and aliases. Their configured domains must match the target installation. See [verification details](../TRANSPORT.md#verification).

## Certificates

nginx's native ACME module issues and renews ECDSA certificates using Let's Encrypt's `tlsserver` profile and ISRG Root X2 chain preference. Internal listeners manage renewal; public listeners load static certificates so OpenSSL can precompress certificate messages.

[publish-certificates.sh](publish-certificates.sh) validates trust, hostname, remaining validity and matching keys, then publishes the certificates together. It reloads nginx only when the certificate fingerprint changes. Failed checks leave the previous certificates in service.

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
