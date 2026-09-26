#!/bin/sh
# Build locally, then atomically activate the four static representations.
set -eu
cd "$(dirname "$0")/.."
host=${1:-${ONEKB_SSH_HOST:-}}
if test -z "$host"; then
  printf 'Usage: npm run deploy -- YOUR_SSH_HOST\n' >&2
  exit 2
fi
run=$(mktemp -d "${TMPDIR:-/tmp}/onekb-deploy.XXXXXX")
trap 'rm -rf "$run"' EXIT
trap 'exit 1' HUP INT TERM
# Build from private inputs; another build may replace public/ during upload.
cp index.html build.mjs server/site.js server/nginx.conf "$run/"
mkdir "$run/compression"
for candidate in compression/index.html.br compression/index.html.gz; do
  if test -f "$candidate"; then cp "$candidate" "$run/compression/"; fi
done
(cd "$run"; node build.mjs)
release=$(date -u +%Y%m%dT%H%M%SZ)-$(shasum -a 256 "$run/index.html" | cut -c1-12)-${run##*/}
base=/mnt/user/appdata/onekb-website
ssh "$host" "mkdir -p '$base/site/releases' '$base/nginx' '$base/backups' && mkdir '$base/site/releases/$release'"
# Keep the handler, representations and configuration in this run's own release.
scp "$run/public/index.html" "$run/public/index.html.br" "$run/public/index.html.gz" "$run/public/index.html.deflate" "$run/public/representations.json" "$run/site.js" "$run/nginx.conf" "$host:$base/site/releases/$release/"
ssh "$host" sh -s -- "$release" <<'REMOTE'
set -eu
umask 077
release=$1
base=/mnt/user/appdata/onekb-website
cd "$base"
mkdir -p state
exec 9>state/certificates.lock
flock 9
next=nginx/nginx.conf.next-$release
next_link=site/next-$release
rollback_link=site/rollback-$release
activation_started=false
committed=false
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if "$activation_started" && ! "$committed"; then
    if ! rollback; then printf 'Deployment rollback failed; inspect the saved release and configuration.\n' >&2; status=1; fi
  fi
  rm -f "$next" "$next_link" "$rollback_link" "backups/check-$release" "backups/headers-$release"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
sed "s@/srv/current/@/srv/releases/$release/@g" "site/releases/$release/nginx.conf" > "$next"
docker exec onekb-website nginx -t -c "/etc/nginx/${next##*/}"
previous=$(readlink site/current)
cp nginx/nginx.conf "backups/nginx.conf-$release"
printf '%s\n' "$previous" > "backups/previous-$release"
rollback() {
  cp "backups/nginx.conf-$release" nginx/nginx.conf || return 1
  ln -s "$previous" "$rollback_link" || return 1
  mv -Tf "$rollback_link" site/current || return 1
  docker exec onekb-website nginx -s reload
}
ln -s "releases/$release" "$next_link"
activation_started=true
mv -Tf "$next_link" site/current
mv "$next" nginx/nginx.conf
docker exec onekb-website nginx -s reload
verified=false
for attempt in 1 2 3 4 5; do
  verified=true
  for pair in br:br gzip:gz deflate:deflate identity:html; do
    encoding=${pair%:*}; suffix=${pair#*:}
    case "$suffix" in html) file=index.html;; *) file=index.html.$suffix;; esac
    if ! status=$(curl -q -fsS --max-time 20 --noproxy '*' --connect-to tomkimberlin.com:443:192.168.0.2:8443 \
      -H "Accept-Encoding: $encoding" https://tomkimberlin.com/ -D "backups/headers-$release" \
      -o "backups/check-$release" -w '%{http_code}') || test "$status" != 200 || \
      ! cmp -s "backups/check-$release" "site/current/$file"; then verified=false; break; fi
    received_encoding=$(awk '
      /^HTTP\/[0-9.]+[[:space:]]/ { value=""; count=0 }
      tolower($0) ~ /^content-encoding:/ {
        sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*$/, "")
        value=value (count++ ? "\n" : "") tolower($0)
      }
      END { print count ":" value }
    ' "backups/headers-$release")
    expected_encoding=1:$encoding
    if test "$encoding" = identity; then expected_encoding=0:; fi
    if test "$received_encoding" != "$expected_encoding"; then verified=false; break; fi
  done
  if "$verified"; then break; fi
  sleep 1
done
if ! "$verified"; then exit 1; fi
committed=true
printf 'Active release: %s\n' "$release"
REMOTE
