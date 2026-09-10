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

Cloudflare's apex and `www` records are DNS-only A records with a 300-second TTL. **Automatic updates when the WAN IP changes are not configured:** creating a dedicated DNS token was unavailable through the connected API. Update both A records if the home IP changes. No token was created or stored during that attempt.

## Deploy

From a built repository checkout with SSH access:

```sh
npm run deploy
npm run verify:live
```

Deployment builds the three representations, validates the candidate nginx configuration against the new handler, switches the release symlink, reloads nginx and compares served bytes with the files. It restores the previous release and configuration if reload or byte verification fails. Browser caches can retain yesterday's page; force reload when checking an edit.

Build the custom image on Alfred before initial startup or a dependency update:

```sh
docker build -t onekb-nginx:20260910 /path/to/repository/server
sh /mnt/user/appdata/onekb-website/bin/start.sh
```

The image uses unmodified upstream nginx and OpenSSL source. A source-built headers-more module removes nginx's otherwise automatic Server header. Rebuild and test deliberately when updating the pinned versions; do not replace this with an unmodified stock image and assume certificate compression still works.

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

To revert hosting to the retained Cloudflare Worker, build and deploy its code using `npm run deploy:worker`, then explicitly replace the two DNS-only A records with Worker custom domains. Reapply the original-encoding transform recorded in `cloudflare-rules.json`. Verify the public domain before stopping nginx or removing router forwards. `wrangler.jsonc` deliberately has no active routes, so a Worker code deployment alone cannot move the live site.

The earlier Caddy data and configuration are retained on Alfred as rollback evidence, with no active Caddy container.
