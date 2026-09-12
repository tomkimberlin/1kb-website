#!/bin/sh
# Build locally, then atomically activate the four static representations.
set -eu
cd "$(dirname "$0")/.."
host=${1:-${ONEKB_SSH_HOST:-}}
if test -z "$host"; then
  printf 'Usage: npm run deploy -- YOUR_SSH_HOST\n' >&2
  exit 2
fi
node build.mjs
release=$(date -u +%Y%m%dT%H%M%SZ)-$(shasum -a 256 index.html | cut -c1-12)
base=/mnt/user/appdata/onekb-website
ssh "$host" "mkdir -p '$base/site/releases/$release' '$base/nginx' '$base/backups'"
scp public/index.html public/index.html.br public/index.html.gz public/index.html.deflate server/site.js "$host:$base/site/releases/$release/"
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
mv nginx/nginx.conf.next nginx/nginx.conf
if ! docker exec onekb-website nginx -s reload; then rollback; exit 1; fi
verified=false
for attempt in 1 2 3 4 5; do
  verified=true
  for pair in br:br gzip:gz deflate:deflate identity:html; do
    encoding=${pair%:*}; suffix=${pair#*:}
    case "$suffix" in html) file=index.html;; *) file=index.html.$suffix;; esac
    if ! curl -fsS --max-time 20 --connect-to tomkimberlin.com:443:192.168.0.2:8443 \
      -H "Accept-Encoding: $encoding" https://tomkimberlin.com/ -o "backups/check-$release" || \
      ! cmp -s "backups/check-$release" "site/current/$file"; then verified=false; break; fi
  done
  if "$verified"; then break; fi
  sleep 1
done
if ! "$verified"; then rollback; exit 1; fi
rm -f nginx/nginx.conf.new "backups/check-$release"
printf 'Active release: %s\n' "$release"
REMOTE
