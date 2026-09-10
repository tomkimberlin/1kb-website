#!/bin/sh
# Build locally, then atomically activate the three static representations.
set -eu
cd "$(dirname "$0")/.."
host=${1:-alfred}
node build.mjs
release=$(date -u +%Y%m%dT%H%M%SZ)-$(shasum -a 256 index.html | cut -c1-12)
base=/mnt/user/appdata/onekb-website
ssh "$host" "mkdir -p '$base/site/releases/$release' '$base/nginx' '$base/backups'"
scp public/index.html public/index.html.br public/index.html.gz server/site.js "$host:$base/site/releases/$release/"
scp server/nginx.conf "$host:$base/nginx/nginx.conf.new"
ssh "$host" sh -s -- "$release" <<'REMOTE'
set -eu
release=$1
base=/mnt/user/appdata/onekb-website
cd "$base"
mkdir -p state
exec 9>state/certificates.lock
flock 9
sed "s@/srv/current/site.js@/srv/releases/$release/site.js@" nginx/nginx.conf.new > nginx/nginx.conf.next
docker exec onekb-website nginx -t -c /etc/nginx/nginx.conf.next
previous=$(readlink site/current)
cp nginx/nginx.conf "backups/nginx.conf-$release"
printf '%s\n' "$previous" > "backups/previous-$release"
rollback() {
  cp "backups/nginx.conf-$release" nginx/nginx.conf
  ln -s "$previous" site/rollback
  mv -Tf site/rollback site/current
  docker exec onekb-website nginx -s reload
}
ln -s "releases/$release" site/next
mv -Tf site/next site/current
mv nginx/nginx.conf.new nginx/nginx.conf
if ! docker exec onekb-website nginx -s reload; then rollback; exit 1; fi
for pair in br:br gzip:gz identity:html; do
  encoding=${pair%:*}; suffix=${pair#*:}
  case "$suffix" in html) file=index.html;; *) file=index.html.$suffix;; esac
  if ! curl -fsS --max-time 20 --connect-to tomkimberlin.com:443:192.168.0.2:8443 \
    -H "Accept-Encoding: $encoding" https://tomkimberlin.com/ -o "backups/check-$release" || \
    ! cmp "backups/check-$release" "site/current/$file"; then rollback; exit 1; fi
done
printf 'Active release: %s\n' "$release"
REMOTE
