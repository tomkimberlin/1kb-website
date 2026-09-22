#!/bin/sh
# Start the container on the Docker host after preparing the image and bind mounts.
set -eu
base=/mnt/user/appdata/onekb-website
name=${ONEKB_CONTAINER:-onekb-website}
http_port=${ONEKB_HTTP_PORT:-8080}
https_port=${ONEKB_HTTPS_PORT:-8443}
image=${ONEKB_IMAGE:-onekb-nginx:20260922g}
test -f "$base/nginx/nginx.conf"
test -f "$base/site/current/index.html.br"
test -f "$base/tls/current/tomkimberlin.com.crt"
docker run -d --name "$name" --restart unless-stopped \
  --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --cap-add SETGID \
  --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=16m \
  --log-opt max-size=1m --log-opt max-file=2 \
  -p "192.168.0.2:$http_port:80/tcp" -p "192.168.0.2:$https_port:443/tcp" -p "192.168.0.2:$https_port:443/udp" \
  --mount "type=bind,src=$base/nginx,dst=/etc/nginx,readonly" \
  --mount "type=bind,src=$base/site,dst=/srv,readonly" \
  --mount "type=bind,src=$base/tls,dst=/tls,readonly" \
  --mount "type=bind,src=$base/acme,dst=/acme" \
  --entrypoint sh "$image" -c "umask 077; exec nginx -g 'daemon off;'"
