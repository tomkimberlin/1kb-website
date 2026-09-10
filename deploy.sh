#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node build.mjs
release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
base=/mnt/user/appdata/onekb-website
ssh alfred "mkdir -p '$base/releases/$release' '$base/backups'"
COPYFILE_DISABLE=1 tar --no-xattrs -cf - public Caddyfile build-report.json index.html build.mjs | ssh alfred "tar --no-same-owner -xf - -C '$base/releases/$release'"
ssh alfred bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
base=/mnt/user/appdata/onekb-website
image=caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
docker run --rm --network none --read-only --user 99:100 --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges -v "$base:/srv:ro" "$image" caddy validate --config "/srv/releases/$release/Caddyfile" --adapter caddyfile
previous=""
if test -L "$base/current"; then
  previous=$(readlink "$base/current")
  printf '%s\n' "$previous" > "$base/backups/previous-$release"
fi
rollback_on_error() {
  status=$?
  if test -n "$previous"; then
    ln -s "$previous" "$base/current-rollback"
    mv -Tf "$base/current-rollback" "$base/current"
    docker restart onekb-website >/dev/null || true
    printf 'Deployment failed; restored %s\n' "$previous" >&2
  fi
  exit "$status"
}
trap rollback_on_error ERR
ln -s "releases/$release" "$base/current-next"
mv -Tf "$base/current-next" "$base/current"
if docker container inspect onekb-website >/dev/null 2>&1; then
  docker restart onekb-website >/dev/null
else
  docker run -d --name onekb-website --network apps-net --restart unless-stopped \
    --read-only --user 99:100 --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
    --memory 128m --cpus .5 --pids-limit 64 \
    --health-cmd 'wget -q -O /dev/null http://127.0.0.1:8080/' \
    --health-interval 30s --health-timeout 3s --health-retries 3 \
    --log-opt max-size=1m --log-opt max-file=2 \
    -v "$base:/srv:ro" "$image" \
    caddy run --config /srv/current/Caddyfile --adapter caddyfile >/dev/null
fi
address=$(docker inspect onekb-website --format '{{(index .NetworkSettings.Networks "apps-net").IPAddress}}')
test -n "$address" || { docker logs --tail 20 onekb-website; exit 1; }
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 \
  -H 'Accept-Encoding: br' "http://$address:8080/" > "$base/backups/check-$release.br"
cmp "$base/backups/check-$release.br" "$base/current/public/index.html.br"
printf 'Verified release %s\n' "$release"
trap - ERR
REMOTE
printf 'Origin verified. Purge the tomkimberlin.com Cloudflare cache, then verify the public response.\n'
