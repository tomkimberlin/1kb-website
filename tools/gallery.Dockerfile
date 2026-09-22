FROM onekb-nginx:20260922d
RUN LD_LIBRARY_PATH= apk add --no-cache python3 py3-h2 py3-h11 py3-brotli
ENV SSL_CERT_FILE=/etc/ssl/cert.pem
ENTRYPOINT ["python3","/probe.py"]
