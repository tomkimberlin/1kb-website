#!/bin/sh
# Run on the Docker host. Native nginx ACME renews; this publishes complete, validated
# certificate/key pairs and reloads nginx only when a certificate changes.
set -eu
umask 077
base=/mnt/user/appdata/onekb-website
mkdir -p "$base/tls/releases" "$base/state"
exec 9>"$base/state/certificates.lock"
if flock -n 9; then
    :
else
    lock_status=$?
    if test "$lock_status" = 1; then exit 0; fi
    printf 'Certificate publication lock failed (exit %s).\n' "$lock_status" >&2
    exit "$lock_status"
fi
snapshot=$(mktemp -d "$base/tls/releases/.pending.XXXXXX")
run=${snapshot##*/}
next="$base/tls/next-$run"
rollback_link="$base/tls/rollback-$run"
state_next="$base/state/certificate-fingerprint-$run"
state_previous="$base/state/certificate-fingerprint-previous-$run"
verification=
activation_started=false
reload_requested=false
committed=false
previous=
rollback() {
    rollback_ok=true
    rollback_pointer_ok=true
    if test -n "$previous"; then
        if ln -s "$previous" "$rollback_link"; then
            mv -Tf "$rollback_link" "$base/tls/current" || rollback_pointer_ok=false
        else
            rollback_pointer_ok=false
        fi
    else
        rm -f "$base/tls/current" || rollback_pointer_ok=false
    fi
    if test -f "$state_previous"; then
        mv "$state_previous" "$base/state/certificate-fingerprint" || rollback_ok=false
    else
        rm -f "$base/state/certificate-fingerprint" || rollback_ok=false
    fi
    if ! "$rollback_pointer_ok"; then return 1; fi
    if "$reload_requested"; then
        if test -z "$previous"; then
            printf 'No previous certificate release exists; live recovery cannot be verified.\n' >&2
            return 1
        fi
        docker exec onekb-website nginx -s reload || return 1
        case "$previous" in /*) rollback_expected=$previous;; *) rollback_expected=$base/tls/$previous;; esac
        verify_certificates "$rollback_expected" || return 1
    fi
    "$rollback_ok"
}
cleanup() {
    status=$?
    trap - EXIT
    trap '' HUP INT TERM
    if "$activation_started" && ! "$committed"; then
        if ! rollback; then printf 'Certificate rollback failed; inspect the previous release.\n' >&2; status=1; fi
    fi
    if test -n "$snapshot"; then rm -rf "$snapshot"; fi
    if test -n "$verification"; then rm -rf "$verification"; fi
    rm -f "$next" "$rollback_link" "$state_next" "$state_previous"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
# A successful reload command only sends a signal. Check fresh, verified TLS
# connections before recording that nginx serves this complete certificate set.
verify_certificates() {
    expected=$1
    if test -z "$verification"; then
        verification=$(mktemp -d "$base/state/.certificate-check.XXXXXX") || return 1
    fi
    for domain in tomkimberlin.com www.tomkimberlin.com tom.kimberlin.net; do
        # Canonical DER compares all certificates, including a changed chain
        # whose leaf certificate is unchanged. No private keys enter this step.
        openssl crl2pkcs7 -nocrl -certfile "$expected/$domain.crt" -outform DER \
            -out "$verification/$domain.expected.der" >/dev/null 2>&1 || return 1
    done
    for attempt in 1 2 3; do
        verified=true
        for domain in tomkimberlin.com www.tomkimberlin.com tom.kimberlin.net; do
            # The transcript may contain session material. Keep it private,
            # extract only certificate PEM blocks, then remove it immediately.
            if ! timeout -k 1 4 openssl s_client -connect 192.168.0.2:8443 \
                -servername "$domain" -verify_hostname "$domain" \
                -verify_return_error -CAfile /etc/ssl/certs/ca-certificates.crt \
                -showcerts </dev/null >"$verification/peer.txt" 2>"$verification/peer.err"; then
                rm -f "$verification/peer.txt" "$verification/peer.err"
                verified=false
                break
            fi
            if ! awk '
                /^-----BEGIN CERTIFICATE-----$/ {
                    if (inside) { invalid=1; exit 1 }
                    inside=1; count++
                }
                inside { print }
                /^-----END CERTIFICATE-----$/ {
                    if (!inside) { invalid=1; exit 1 }
                    inside=0
                }
                END { if (invalid || inside || !count) exit 1 }
            ' "$verification/peer.txt" >"$verification/peer.pem"; then
                rm -f "$verification/peer.txt" "$verification/peer.err"
                verified=false
                break
            fi
            rm -f "$verification/peer.txt" "$verification/peer.err"
            if ! openssl crl2pkcs7 -nocrl -certfile "$verification/peer.pem" -outform DER \
                -out "$verification/peer.der" >/dev/null 2>&1 || \
                ! cmp -s "$verification/peer.der" "$verification/$domain.expected.der"; then
                verified=false
                break
            fi
        done
        if "$verified"; then return 0; fi
        if test "$attempt" != 3; then sleep 1; fi
    done
    return 1
}
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
if test -f "$base/state/certificate-fingerprint" && test "$fingerprint" = "$(cat "$base/state/certificate-fingerprint")"; then
    if test "${ONEKB_PREPARE_ONLY:-0}" = 1 || verify_certificates "$snapshot"; then exit 0; fi
fi
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
    if ! verify_certificates "$release"; then
        printf 'Published website certificate verification failed.\n' >&2
        exit 1
    fi
fi
printf '%s\n' "$fingerprint" > "$state_next"
mv "$state_next" "$base/state/certificate-fingerprint"
committed=true
printf 'Published validated website certificates.\n'
