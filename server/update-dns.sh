#!/usr/bin/env bash
# Keep only this site's three existing DNS-only A records aligned with the WAN IP.
set +x
set -euo pipefail
umask 077
ulimit -c 0
base=/mnt/user/appdata/onekb-website
verify_write=false
case ${1:-} in '') ;; --verify-write) verify_write=true;; *) exit 2;; esac
exec 9>"$base/state/dns.lock"
flock -n 9 || exit 0
unset cf_dns_token
trap 'unset cf_dns_token' EXIT
fail() { printf '%s\n' "$1" >&2; exit 1; }
credential=$base/secrets/cloudflare-dns-token
[[ -f $credential && ! -L $credential ]] || fail 'DNS token is unavailable.'
[[ $(stat -c '%a:%u' "$credential") == 600:0 ]] || fail 'DNS token must be root-owned with mode 600.'
cf_dns_token=$(cat "$credential")
[[ -n $cf_dns_token && $cf_dns_token != *[[:space:][:cntrl:]]* && $cf_dns_token != *\"* && $cf_dns_token != *\\* ]] || fail 'DNS token format is invalid.'

fetch() { curl -q --silent --fail --ipv4 --proto '=https' --noproxy '*' --connect-timeout 10 --max-time 20 "$@"; }
api() {
  local method=$1 zone=$2 record=$3
  shift 3
  # The token enters curl through stdin, never command arguments or environment.
  printf 'header = "Authorization: Bearer %s"\n' "$cf_dns_token" |
    fetch --config - --request "$method" "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$record" "$@"
}
public_ip=$(fetch https://api.ipify.org) || fail 'WAN IP lookup failed; DNS was not changed.'
[[ $public_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail 'WAN IP lookup did not return IPv4.'
IFS=. read -r a b c d <<< "$public_ip"
for octet in "$a" "$b" "$c" "$d"; do ((10#$octet <= 255)) || fail 'WAN IP is invalid.'; done
confirmed=false
for entry in \
  5fc77ce7dd5be6ea0c69633b41363cda:2739a3e7e72f98bbcde00b097639f62f:tomkimberlin.com \
  5fc77ce7dd5be6ea0c69633b41363cda:adeb7ba4660e7e9aac978ab869ba4eb6:www.tomkimberlin.com \
  09ff5bfaf2b70fbbe8e69448041d471e:8a65b98431f75a16f5af8027e26d032a:tom.kimberlin.net; do
  zone=${entry%%:*}; pair=${entry#*:}
  record=${pair%%:*}; name=${pair#*:}
  result=$(api GET "$zone" "$record") || fail "DNS read failed for $name."
  jq -e --arg id "$record" --arg name "$name" \
    '.success == true and .result.id == $id and .result.name == $name and .result.type == "A" and .result.proxied == false' \
    >/dev/null <<< "$result" || fail "Unexpected DNS record for $name; refusing to change it."
  current_ip=$(jq -r '.result.content' <<< "$result")
  if [[ $current_ip == "$public_ip" && $verify_write == false ]]; then continue; fi
  if [[ $confirmed == false ]]; then
    trace=$(fetch https://www.cloudflare.com/cdn-cgi/trace) || fail 'Second WAN IP lookup failed; DNS was not changed.'
    confirmation=$(sed -n 's/^ip=//p' <<< "$trace")
    [[ $confirmation == "$public_ip" ]] || fail 'WAN IP lookups disagree; DNS was not changed.'
    confirmed=true
  fi
  payload=$(jq -nc --arg ip "$public_ip" '{content:$ip}')
  result=$(api PATCH "$zone" "$record" --header 'Content-Type: application/json' --data "$payload") || fail "DNS update failed for $name."
  jq -e --arg name "$name" --arg ip "$public_ip" \
    '.success == true and .result.name == $name and .result.content == $ip and .result.type == "A" and .result.proxied == false' \
    >/dev/null <<< "$result" || fail "DNS update could not be verified for $name."
  if [[ $current_ip == "$public_ip" ]]; then
    printf 'Verified DNS write permission for %s without changing its address.\n' "$name"
  else
    printf 'Updated %s to %s.\n' "$name" "$public_ip"
  fi
done
