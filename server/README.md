# Server operations

Alfred runs container `onekb-website`, built as `onekb-nginx:20260910` from the pinned sources in [Dockerfile](Dockerfile). Native nginx ACME issues and renews ECDSA certificates with the `tlsserver` profile and ISRG Root X2 chain preference.

## Paths and networking

Base directory: `/mnt/user/appdata/onekb-website`.

- `nginx/nginx.conf`: active configuration.
- `site/releases/` and `site/current`: static representations and the server-side request handler.
- `acme/`: private ACME state and automatically renewed certificates.
- `tls/releases/` and `tls/current`: validated certificate/key pairs used by public listeners.
- `bin/`: startup and certificate publishing scripts.
- `backups/`: prior configuration and release pointers.

Only `acme/` is writable by the web container. Certificate keys stay on Alfred. The root filesystem and site/config/published-certificate mounts are read-only; temporary files use tmpfs. Capabilities are limited to binding ports and the group initialization required by nginx's manager process.

The router forwards TCP 80 to `192.168.0.2:8080`, and TCP/UDP 443 to `192.168.0.2:8443`. These map to the container's ports 80/443. nginx's certificate-management listener on 9443 is container-loopback only.

Cloudflare's apex and `www` records are DNS-only A records with a 300-second TTL. `bin/update-dns.sh` checks the WAN IPv4 every five minutes and updates those two existing records only when necessary. It confirms a changed address using a second HTTPS lookup, preserves other record fields, and refuses unexpected record types/names or proxied records.

## Additional hostname

`tom.kimberlin.net` uses a Cloudflare edge redirect to `https://tomkimberlin.com`, preserving the path and query. Its proxied A record uses documentation address `192.0.2.1`; the redirect does not contact an origin and needs no DDNS. It uses Cloudflare's certificate for HTTPS.

Worker `onekb-website` handles the exact route `tom.kimberlin.net/*`, recorded in `wrangler.jsonc`. Zone: `09ff5bfaf2b70fbbe8e69448041d471e`; route: `ecd892906a7a4061a38598776ecfc859`; DNS record: `8a65b98431f75a16f5af8027e26d032a`. HTTPS redirects have an empty body. An HTTP-only rule avoids the zone-wide HTTPS upgrade's intermediate hop: ruleset `4a23f11619fc4e55af19cc0b220c6161`, rule `d961f46f03ea4bc194b8cc753dbea272`. That HTTP response still contains Cloudflare's 167-byte body.

Response rule `2153cf6d748a4e099258d0e6458507ea` in ruleset `6a8894fe35e248b78438bdf07b79fabd` removes `NEL` and `Report-To` only for this alias. Cloudflare still adds `Alt-Svc` and identification headers. The main domain bypasses these headers.

## Automatic DNS updates

The credential is stored only in `/mnt/user/appdata/onekb-website/secrets/cloudflare-dns-token`, owned by root with mode 600 in a mode-700 directory. It is not mounted into the web container. The token needs Zone / DNS / Edit for `tomkimberlin.com` only, without a fixed client-IP restriction. The script passes it to curl through stdin, with tracing disabled.

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

From a built repository checkout with SSH access:

```sh
npm run deploy
npm run verify:live
npm run verify:alias
```

Deployment builds the three representations, validates the candidate nginx configuration against the new handler, switches the release symlink, reloads nginx and compares served bytes with the files. It restores the previous release and configuration if reload or byte verification fails. Force reload when checking an edit to bypass the one-day browser cache.

Build the custom image on Alfred before initial startup or a dependency update:

```sh
docker build -t onekb-nginx:20260910 /path/to/repository/server
sh /mnt/user/appdata/onekb-website/bin/start.sh
```

The image builds nginx and OpenSSL from pinned upstream sources, with certificate compression and the headers-more module enabled. Rebuild and test when updating those versions.

## Certificates and startup

`publish-certificates.sh` runs every five minutes through `/boot/config/plugins/user.scripts/onekb-certificates.cron`. Native ACME performs renewal itself. The script checks certificate trust, hostname, remaining validity and matching public keys; publishes both hostname pairs together; and reloads nginx only when the certificate fingerprint changes. Failed checks leave the previous published pair in service.

Static certificate loading allows OpenSSL to precompress its TLS certificate messages. The internal ACME listeners use nginx's dynamic certificate variables; they are not public website listeners. The five-minute publishing interval does not create visitor traffic.

The container has `restart=unless-stopped`, an entry in `/var/lib/docker/unraid-autostart`, and template `/boot/config/plugins/dockerMan/templates-user/my-onekb-website.xml`.

Useful checks on Alfred:

```sh
docker exec onekb-website nginx -t
docker inspect onekb-website --format '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}'
sh /mnt/user/appdata/onekb-website/bin/publish-certificates.sh
crontab -c /etc/cron.d -l | grep onekb-certificates
```

## Rollback

For a page/configuration regression, restore the prior `site/current` target and matching `backups/nginx.conf-*`, run `nginx -t`, then `nginx -s reload`. Retain the working certificate state.

`npm run deploy:worker` updates the Worker and its `tom.kimberlin.net/*` route. It does not move the main website. To retire this alias, remove its route from the configuration and Cloudflare, then remove its DNS record, HTTP-only redirect ruleset and alias response-header rule. Preserve the BookStack response-header rule.
