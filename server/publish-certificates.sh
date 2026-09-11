#!/bin/sh
# Run on the home server. Native nginx ACME renews; this publishes complete, validated
# certificate/key pairs and reloads nginx only when a certificate changes.
set -eu
umask 077
base=/mnt/user/appdata/onekb-website
mkdir -p "$base/tls/releases" "$base/state"
exec 9>"$base/state/certificates.lock"
flock -n 9 || exit 0
fingerprint=$(cat "$base"/acme/tomkimberlin.com-*.crt "$base"/acme/www.tomkimberlin.com-*.crt "$base"/acme/tom.kimberlin.net-*.crt | sha256sum | cut -d' ' -f1)
if test -f "$base/state/certificate-fingerprint" && test "$fingerprint" = "$(cat "$base/state/certificate-fingerprint")"; then exit 0; fi
release="$base/tls/releases/$fingerprint"
mkdir -p "$release"
for domain in tomkimberlin.com www.tomkimberlin.com tom.kimberlin.net; do
    set -- "$base/acme/$domain-"*.crt
    test "$#" -eq 1
    cert=$1
    key=${cert%.crt}.key
    openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null
    openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null
    openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$cert" "$cert" >/dev/null
    cert_public=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
    key_public=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum)
    test "$cert_public" = "$key_public"
    cp "$cert" "$release/$domain.crt"
    cp "$key" "$release/$domain.key"
    chmod 600 "$release/$domain.crt" "$release/$domain.key"
done
previous=$(readlink "$base/tls/current" || true)
ln -s "releases/$fingerprint" "$base/tls/next"
mv -Tf "$base/tls/next" "$base/tls/current"
if test "${ONEKB_PREPARE_ONLY:-0}" != 1; then
    if ! docker exec onekb-website nginx -t || ! docker exec onekb-website nginx -s reload; then
        if test -n "$previous"; then
            ln -s "$previous" "$base/tls/rollback"
            mv -Tf "$base/tls/rollback" "$base/tls/current"
        fi
        exit 1
    fi
fi
printf '%s\n' "$fingerprint" > "$base/state/certificate-fingerprint"
printf 'Published validated website certificates.\n'
