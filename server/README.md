# Server configuration

This directory contains the Docker, nginx, certificate and DNS configuration used by `tomkimberlin.com`. The deployment runs on Unraid in container `onekb-website`, using image `onekb-nginx:20260910` built from the pinned sources in [Dockerfile](Dockerfile). Native nginx ACME issues and renews ECDSA certificates with the `tlsserver` profile and ISRG Root X2 chain preference.

The paths, LAN address, domains and Cloudflare record IDs below describe that installation. To deploy a copy, adapt them in the shell scripts, nginx configuration, request handler, verification scripts and Unraid template. The scripts assume the container, directory layout and certificates have already been prepared; they are not a general-purpose installer.

## Paths and networking

Base directory: `/mnt/user/appdata/onekb-website`.

- `nginx/nginx.conf`: active configuration.
- `site/releases/` and `site/current`: static representations and the server-side request handler.
- `acme/`: private ACME state and automatically renewed certificates.
- `tls/releases/` and `tls/current`: validated certificate/key pairs used by public listeners.
- `bin/`: startup and certificate publishing scripts.
- `backups/`: prior configuration and release pointers.

Only `acme/` is writable by the web container. Certificate keys remain on the Docker host. The root filesystem and site/config/published-certificate mounts are read-only; temporary files use tmpfs. Capabilities are limited to binding ports and the group initialization required by nginx's manager process.

The router forwards TCP 80 to `192.168.0.2:8080`, and TCP/UDP 443 to `192.168.0.2:8443`. These map to the container's ports 80/443. nginx's certificate-management listener on 9443 is container-loopback only.

Cloudflare's apex, `www` and `tom.kimberlin.net` records are DNS-only A records with a 300-second TTL. `bin/update-dns.sh` checks the WAN IPv4 every five minutes and updates those three existing records only when necessary. It confirms a changed address using a second HTTPS lookup, preserves other record fields, and refuses unexpected record types/names or proxied records.

## Additional hostname

`tom.kimberlin.net` redirects directly to `https://tomkimberlin.com`, preserving the path and query. It uses the same DNS-only A record setup, DDNS updater and native ACME renewal process as the main domain. HTTP and HTTPS redirects have empty bodies; HTTP/2 sends only Date and Location headers.

## Automatic DNS updates

The updater reads its credential from `/mnt/user/appdata/onekb-website/secrets/cloudflare-dns-token`, owned by root with mode 600 in a mode-700 directory. It is not mounted into the web container. For this configuration, the token needs Zone / DNS / Edit for the `tomkimberlin.com` and `kimberlin.net` zones, without a fixed client-IP restriction. For a separate deployment, replace the zone and record IDs in `update-dns.sh` and provide a token for those zones. The script passes the token to curl through stdin, with tracing disabled.

`/boot/config/plugins/user.scripts/onekb-dns.cron` supplies the five-minute schedule. Concurrent runs are prevented by `state/dns.lock`. No-change runs are silent; changes and failures go to the `onekb-dns` system-log tag.

```sh
# Check normally; updates only if the WAN IP differs.
/bin/bash /mnt/user/appdata/onekb-website/bin/update-dns.sh
# Explicitly verify write access by PATCHing the already-current address.
/bin/bash /mnt/user/appdata/onekb-website/bin/update-dns.sh --verify-write
crontab -c /etc/cron.d -l | grep onekb-dns
```

To disable automatic updates, rename `onekb-dns.cron` to `onekb-dns.cron.disabled` and run `update_cron`. The current DNS addresses and website continue working; future IP changes then require manual updates. Keep the credential private or revoke it if retiring this updater.

## Deploy

After adapting the configuration and preparing the target installation, run from the repository root. Replace `YOUR_SSH_HOST` with its SSH hostname or alias; deployment also requires curl and permission to manage Docker on the target.

```sh
npm run deploy -- YOUR_SSH_HOST
npm run verify:live
npm run verify:alias
```

Deployment builds the three representations, validates the candidate nginx configuration against the new handler, switches the release symlink, reloads nginx and compares served bytes with the files. It restores the previous release and configuration if reload or byte verification fails. The verification commands target the domains configured in their scripts; see [verification requirements](../TRANSPORT.md#verification). Force reload when checking an edit to bypass the one-day browser cache.

On the target Docker host, build the custom image from the repository root:

```sh
docker build -t onekb-nginx:20260910 -f server/Dockerfile .
```

The image builds nginx and OpenSSL from pinned upstream sources, with certificate compression and the headers-more module enabled. `server/start.sh` starts the container after the configuration, page files and initial certificates exist at its configured paths. Rebuild and test the image when updating pinned versions.

## Certificates and startup

`publish-certificates.sh` runs every five minutes through `/boot/config/plugins/user.scripts/onekb-certificates.cron`. Native ACME performs renewal itself. The script checks certificate trust, hostname, remaining validity and matching public keys; publishes all three hostname pairs together; and reloads nginx only when the certificate fingerprint changes. Failed checks leave the previous published certificates in service.

Static certificate loading allows OpenSSL to precompress its TLS certificate messages. The internal ACME listeners use nginx's dynamic certificate variables; they are not public website listeners. The five-minute publishing interval does not create visitor traffic.

The container has `restart=unless-stopped`, an entry in `/var/lib/docker/unraid-autostart`, and template `/boot/config/plugins/dockerMan/templates-user/my-onekb-website.xml`.

For an installation using the paths and container name above, run these checks on the Docker host:

```sh
docker exec onekb-website nginx -t
docker inspect onekb-website --format '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}'
sh /mnt/user/appdata/onekb-website/bin/publish-certificates.sh
crontab -c /etc/cron.d -l | grep onekb-certificates
```

## Rollback

For a page/configuration regression, restore the prior `site/current` target and matching `backups/nginx.conf-*`, run `nginx -t`, then `nginx -s reload`. Retain the working certificate state.

For an alias-only problem, retain the working main-domain configuration and certificates while repairing the alias listener or DNS record. Keep DNS records unproxied to preserve the minimal responses.
