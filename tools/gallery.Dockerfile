FROM onekb-nginx:20260922g
RUN LD_LIBRARY_PATH= apk add --no-cache python3 py3-h2 py3-h11 'py3-brotli>=1.2.0' py3-zstandard
ENV SSL_CERT_FILE=/etc/ssl/cert.pem
COPY tools/dns_measurement.py /dns_measurement.py
COPY tools/probe_response.py /probe_response.py
ENTRYPOINT ["python3","/probe.py"]
