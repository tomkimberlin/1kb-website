#!/bin/sh
# Run on the Docker host. Native nginx ACME renews; this publishes complete, validated
# certificate/key pairs and reloads nginx only when a certificate changes.
set -eu
umask 077
base=/mnt/user/appdata/onekb-website
mkdir -p "$base/tls/releases" "$base/state"
exec 9>"$base/state/certificates.lock"
flock -n 9 || exit 0
snapshot=$(mktemp -d "$base/tls/releases/.pending.XXXXXX")
run=${snapshot##*/}
next="$base/tls/next-$run"
rollback_link="$base/tls/rollback-$run"
state_next="$base/state/certificate-fingerprint-$run"
state_previous="$base/state/certificate-fingerprint-previous-$run"
activation_started=false
reload_requested=false
committed=false
previous=
rollback() {
    if test -n "$previous"; then
        ln -s "$previous" "$rollback_link" || return 1
        mv -Tf "$rollback_link" "$base/tls/current" || return 1
    else
        rm -f "$base/tls/current" || return 1
    fi
    if test -f "$state_previous"; then
        mv "$state_previous" "$base/state/certificate-fingerprint" || return 1
    else
        rm -f "$base/state/certificate-fingerprint" || return 1
    fi
    if test -n "$previous" && "$reload_requested"; then
        docker exec onekb-website nginx -s reload || return 1
    fi
}
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    if "$activation_started" && ! "$committed"; then
        if ! rollback; then printf 'Certificate rollback failed; inspect the previous release.\n' >&2; status=1; fi
    fi
    if test -n "$snapshot"; then rm -rf "$snapshot"; fi
    rm -f "$next" "$rollback_link" "$state_next" "$state_previous"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
for domain in tomkimberlin.com www.tomkimberlin.com tom.kimberlin.net; do
    set -- "$base/acme/$domain-"*.crt
    test "$#" -eq 1
    # ACME does not take this host lock. Validate only the private snapshot:
    # renewal during copying either yields a complete pair or fails validation.
    cp "$1" "$snapshot/$domain.crt"
    cp "${1%.crt}.key" "$snapshot/$domain.key"
    cert="$snapshot/$domain.crt"
    key="$snapshot/$domain.key"
    chmod 600 "$cert" "$key"
    openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null
    openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null
    openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$cert" "$cert" >/dev/null
    openssl x509 -in "$cert" -pubkey -noout > "$snapshot/cert.pub"
    openssl pkey -pubin -in "$snapshot/cert.pub" -outform DER > "$snapshot/cert.der"
    openssl pkey -in "$key" -pubout -outform DER > "$snapshot/key.der"
    cmp -s "$snapshot/cert.der" "$snapshot/key.der"
done
rm -f "$snapshot/cert.pub" "$snapshot/cert.der" "$snapshot/key.der"
fingerprint=$(cat "$snapshot/tomkimberlin.com.crt" "$snapshot/www.tomkimberlin.com.crt" "$snapshot/tom.kimberlin.net.crt" | sha256sum | cut -d' ' -f1)
if test -f "$base/state/certificate-fingerprint" && test "$fingerprint" = "$(cat "$base/state/certificate-fingerprint")"; then exit 0; fi
# A unique immutable directory also avoids rewriting an older active release.
release="$base/tls/releases/$fingerprint-$run"
mv "$snapshot" "$release"
snapshot=
# Compression is optional: renewal must succeed even if its optimizer is absent.
if ! timeout -k 5 45 "$base/bin/cache-certificates.sh" "$release"; then
    printf 'Using normal certificate compression where no valid cache exists.\n' >&2
fi
previous=$(readlink "$base/tls/current" || true)
if test -f "$base/state/certificate-fingerprint"; then
    cp "$base/state/certificate-fingerprint" "$state_previous"
fi
ln -s "releases/${release##*/}" "$next"
activation_started=true
mv -Tf "$next" "$base/tls/current"
if test "${ONEKB_PREPARE_ONLY:-0}" != 1; then
    docker exec onekb-website nginx -t
    reload_requested=true
    docker exec onekb-website nginx -s reload
fi
printf '%s\n' "$fingerprint" > "$state_next"
mv "$state_next" "$base/state/certificate-fingerprint"
committed=true
printf 'Published validated website certificates.\n'
