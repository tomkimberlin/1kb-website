FROM nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS build
RUN apk add --no-cache build-base perl linux-headers curl brotli-dev zlib-dev zstd-dev
WORKDIR /build
RUN curl -fLsS https://www.openssl.org/source/openssl-3.5.8.tar.gz -o openssl.tar.gz \
 && echo 'a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2  openssl.tar.gz' | sha256sum -c - \
 && tar xzf openssl.tar.gz
WORKDIR /build/openssl-3.5.8
COPY server/certificate-compression.patch /build/certificate-compression.patch
RUN patch --fuzz=0 -p1 < /build/certificate-compression.patch
COPY server/tls-flight.patch /build/tls-flight.patch
RUN patch --fuzz=0 -p1 < /build/tls-flight.patch
RUN ./Configure --prefix=/opt/openssl --libdir=lib shared zlib enable-brotli enable-zstd no-tests \
 && make -j4 >/tmp/build.log 2>&1 && make install_sw >/tmp/install.log 2>&1
FROM build AS compression-test
COPY tools/verify-certificate-compression.c /build/verify-certificate-compression.c
RUN cc -Wall -Wextra -Werror -I/opt/openssl/include /build/verify-certificate-compression.c -L/opt/openssl/lib -Wl,-rpath,/opt/openssl/lib -lcrypto -lbrotlienc -lbrotlidec -o /build/verify-certificate-compression \
 && /build/verify-certificate-compression

COPY tools/verify-tls-flight.c /build/verify-tls-flight.c
RUN cc -O2 -Wall -Wextra -Werror -Wno-unused-parameter -DCOALESCE_INTERNAL -DRESUME_COALESCING -I/build/openssl-3.5.8 -I/build/openssl-3.5.8/include /build/verify-tls-flight.c /build/openssl-3.5.8/libssl.a /build/openssl-3.5.8/libcrypto.a -lbrotlienc -lbrotlidec -lbrotlicommon -lzstd -lz -ldl -pthread -o /build/verify-tls-flight \
 && /build/verify-tls-flight

FROM nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS headers
RUN apk add --no-cache build-base curl pcre2-dev zlib-dev brotli-dev linux-headers
WORKDIR /build
RUN curl -fLsS https://nginx.org/download/nginx-1.30.4.tar.gz -o nginx.tar.gz \
 && echo '4261dc90e9e47c1c4041276e9aaa3d48ebe2e664f728e14fa95ae6c67d57a08b  nginx.tar.gz' | sha256sum -c - \
 && curl -fLsS https://github.com/openresty/headers-more-nginx-module/archive/refs/tags/v0.40.tar.gz -o headers.tar.gz \
 && echo 'c14cb5e6c998590c209efbf77bd7637ce2cab02332e4192756a8af5b26ba4284  headers.tar.gz' | sha256sum -c - \
 && tar xzf nginx.tar.gz && tar xzf headers.tar.gz
COPY --from=compression-test /opt/openssl /opt/openssl
WORKDIR /build/nginx-1.30.4
COPY server/small-responses.patch /build/small-responses.patch
RUN patch --fuzz=0 -p1 < /build/small-responses.patch
COPY server/certificate-cache.patch /build/certificate-cache.patch
RUN patch --fuzz=0 -p1 < /build/certificate-cache.patch
RUN ./configure --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/dev/stderr --http-log-path=/dev/stdout --pid-path=/tmp/nginx.pid --lock-path=/tmp/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --with-cc-opt="-DNGX_SSL_CERT_BROTLI_CACHE=1 -I/opt/openssl/include -Os -fstack-clash-protection -Wformat -Werror=format-security -fno-plt" --with-ld-opt="-L/opt/openssl/lib -lbrotlidec -Wl,--as-needed,-O1,--sort-common -Wl,-z,pack-relative-relocs" --with-compat --with-http_ssl_module --with-http_v2_module --with-http_v3_module --add-dynamic-module=/build/headers-more-nginx-module-0.40 >/tmp/configure.log \
 && make -j4 >/tmp/modules.log
FROM compression-test AS certificate-cache-test
COPY --from=headers /build/nginx-1.30.4/src/http/modules/ngx_http_ssl_brotli_cache.h /build/
COPY tools/verify-certificate-cache.c /build/verify-certificate-cache.c
COPY tools/fixtures/certificate-cache.pem tools/fixtures/certificate-cache.br /build/fixtures/
RUN cc -O2 -Wall -Wextra -Werror -Wno-unused-parameter -I/build -I/build/openssl-3.5.8 -I/build/openssl-3.5.8/include /build/verify-certificate-cache.c /build/openssl-3.5.8/libssl.a /build/openssl-3.5.8/libcrypto.a -lbrotlienc -lbrotlidec -lbrotlicommon -lzstd -lz -ldl -pthread -o /build/verify-certificate-cache \
 && mkdir /tmp/cache-check && cd /tmp/cache-check \
 && /build/verify-certificate-cache /build/fixtures/certificate-cache.pem /build/fixtures/certificate-cache.br

FROM nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS certificate-encoder
RUN apk add --no-cache build-base python3
COPY tools/optimize-certificates.py /opt/optimize-certificates.py
RUN python3 /opt/optimize-certificates.py --build-encoder /opt/onekb-encoder.so

FROM nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS certificate-optimizer
RUN apk add --no-cache python3
COPY --from=certificate-encoder /opt/onekb-encoder.so /opt/onekb-encoder.so
COPY --from=certificate-encoder /opt/onekb-encoder.so.json /opt/onekb-encoder.so.json
COPY tools/optimize-certificates.py /opt/optimize-certificates.py
ENTRYPOINT ["python3","/opt/optimize-certificates.py","--encoder","/opt/onekb-encoder.so"]

FROM nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c
RUN apk add --no-cache brotli-libs zlib zstd-libs
COPY --from=certificate-cache-test /opt/openssl/lib/libssl.so.3 /opt/openssl/lib/libcrypto.so.3 /opt/openssl/lib/
COPY --from=certificate-cache-test /opt/openssl/bin/openssl /opt/openssl/bin/openssl
ENV LD_LIBRARY_PATH=/opt/openssl/lib
COPY --from=headers /build/nginx-1.30.4/objs/ngx_http_headers_more_filter_module.so /usr/lib/nginx/modules/

COPY --from=headers /build/nginx-1.30.4/objs/nginx /usr/sbin/nginx
