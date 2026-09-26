#!/bin/sh
# Generate optional compressed messages from public certificate chains.
# Run nginx -t and reload separately when refreshing the current certificates.
set -eu
umask 077
base=/mnt/user/appdata/onekb-website
release=${1:-$base/tls/current}
image=onekb-certificate-optimizer:20260926a
container=onekb-certificate-cache-$$-$(date +%s)
cleanup() { timeout -k 1 3 docker rm -f "$container" >/dev/null 2>&1 || :; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$base/tls/compressed" "$base/state"
exec 8>"$base/state/certificate-optimizer.lock"
flock -n 8 || exit 0
timeout -k 1 5 docker image inspect "$image" >/dev/null
status=0
for domain in tomkimberlin.com www.tomkimberlin.com tom.kimberlin.net; do
    cert=$(readlink -f "$release/$domain.crt")
    test -f "$cert"
    # Only this public PEM is mounted, never its adjacent private key.
    if ! timeout -k 2 10 docker run --name "$container" --rm \
        --network none --read-only --pids-limit 32 \
        --memory 128m --cpus 1 --cap-drop ALL \
        --security-opt no-new-privileges \
        --tmpfs /tmp:rw,noexec,nosuid,size=1m \
        --mount "type=bind,src=$cert,dst=/chain.pem,readonly" \
        --mount "type=bind,src=$base/tls/compressed,dst=/out" \
        "$image" --pem /chain.pem --output /out; then
        printf 'Optional certificate compression failed for %s.\n' "$domain" >&2
        cleanup
        status=1
    fi
done
exit "$status"
