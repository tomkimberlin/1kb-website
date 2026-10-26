#!/bin/sh
# Run only owned, isolated fixtures. No host ports, production mounts or network.
set -eu
stage=$1
run=$2
stock=sha256:1ae82dcc4a34bcd976195b3c4c5a6b7e569505527a1e2a28c2101e032159a5c7
optimized=sha256:bd2a90f1661d741e5a2788ac19b6054116b5bca44103a8b6a8af6ab09ec127e3
client=sha256:597ef273b8ca5b3abb5710801fb111005c53374718952191940af032b9424ac9
case "$stage" in /tmp/onekb-default-reference-*) ;; *) exit 2;; esac
case "$run" in *[!a-z0-9-]*|'') exit 2;; esac
cd "$stage"
test -f input.tar
test ! -e input
mkdir input results
owned_names=''
cleanup() {
 result=$?
 trap - EXIT HUP INT TERM
 cleanup_ok=true
 for name in $owned_names; do
  if docker container inspect "$name" >/dev/null 2>&1; then
   owner=$(docker inspect --format '{{index .Config.Labels "onekb.default-reference"}}' "$name")
   if test "$owner" = "$run"; then
    docker logs "$name" > "results/$name.log" 2>&1 || true
    docker rm -f "$name" >/dev/null || cleanup_ok=false
   else cleanup_ok=false; fi
  fi
 done
 remaining=$(docker ps -aq --filter "label=onekb.default-reference=$run") || cleanup_ok=false
 if test -n "$remaining"; then cleanup_ok=false; fi
 if "$cleanup_ok"; then printf 'owned containers removed\n' > results/cleanup.txt; else printf 'cleanup failed\n' > results/cleanup.txt; result=1; fi
 # Keys are disposable test data; never copy production credentials.
 rm -f input/key.pem input/wrong-root.pem input.tar
 exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tar -xf input.tar -C input
chmod 755 input
sha256sum -c input/SHA256SUMS
for image in "$stock" "$optimized" "$client"; do docker image inspect "$image" --format '{{.Id}}' >> results/images.txt; done
for arm in stock-identity stock-brotli optimized; do
 name="onekb-default-$run-$arm"
 if docker container inspect "$name" >/dev/null 2>&1; then printf 'Existing fixture name refused\n' >&2; exit 1; fi
 owned_names="$owned_names $name"
 image=$stock
 if test "$arm" = optimized; then image=$optimized; fi
 docker run -d --pull=never --name "$name" --label "onekb.default-reference=$run" \
  --network none --read-only --user 101:101 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,mode=1777,size=16m --mount "type=bind,src=$stage/input,dst=/fixture,readonly" \
  --entrypoint nginx "$image" -c "/fixture/$arm.conf" -g 'daemon off;' > "results/$arm.cid"
 attempt=0
 until docker exec "$name" test -f /tmp/nginx.pid; do
  attempt=$((attempt+1))
  if test "$attempt" -ge 30; then docker logs "$name" > "results/$arm-start.log" 2>&1; exit 1; fi
  sleep 0.1
 done
 docker inspect "$name" > "results/$arm-inspect.json"
 docker exec "$name" nginx -V > "results/$arm-version.txt" 2>&1
 docker exec "$name" nginx -T -c "/fixture/$arm.conf" > "results/$arm-config.txt" 2>&1
 done
probe() {
 arm=$1
 encoding=$2
 target=$3
 shift 3
 name="onekb-default-$run-client"
 if docker container inspect "$name" >/dev/null 2>&1; then exit 1; fi
 case " $owned_names " in *" $name "*) ;; *) owned_names="$owned_names $name";; esac
 timeout 45 docker run --rm --pull=never --name "$name" --label "onekb.default-reference=$run" \
  --network "container:onekb-default-$run-$arm" --read-only --user 101:101 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,mode=1777,size=16m --mount "type=bind,src=$stage/input,dst=/fixture,readonly" \
  --entrypoint python3 "$client" /fixture/probe.py --encoding "$encoding" "$@" > "$target" 2> "$target.stderr"
}
# A wrong test trust anchor must fail before any result is published.
if probe stock-identity identity results/wrong-ca.json --ca /fixture/wrong-root.pem; then exit 1; fi
test ! -s results/wrong-ca.json
grep -q CERTIFICATE_VERIFY_FAILED results/wrong-ca.json.stderr
printf 'wrong CA rejected without a result\n' > results/trust-negative.txt
# Rotate ordering to avoid giving one arm a consistent first/last position.
round=1
for order in 'stock-identity optimized stock-brotli' 'optimized stock-brotli stock-identity' 'stock-brotli stock-identity optimized'; do
 for arm in $order; do
  encoding=br
  if test "$arm" = stock-identity; then encoding=identity; fi
  probe "$arm" "$encoding" "results/$arm-$round.json"
 done
 round=$((round+1))
done
printf 'all nine measured exchanges completed\n' > results/completed.txt
