#!/bin/sh
# Extract the exact reviewed loss-requeue function from configured nginx source.
set -eu
if [ "$#" -ne 2 ]; then
    echo 'Usage: extract-quic-stream-resend.sh ACK_SOURCE OUTPUT_INCLUDE' >&2
    exit 2
fi
source_file=$1
output_file=$2
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum < "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 < "$1" | awk '{print $1}'; }
else
    echo 'A SHA256 utility is required' >&2
    exit 1
fi
for protected_file in "$source_file" "$0"; do
    if [ -e "$output_file" ] && [ "$protected_file" -ef "$output_file" ]; then
        echo 'The output must not alias an input or this extractor' >&2
        exit 1
    fi
done
expected_source=256b238edb0b3c757c341d4b0c2d482b38d56698a72d88638ff8353383cad763
expected_include=23f74bc0fc119f21a9e9911a0e6965a916b43582bbe225f27698bc6a3ff12b56
if [ "$(checksum "$source_file")" != "$expected_source" ]; then
    echo 'Pinned nginx ACK source changed; review the loss-requeue fixture' >&2
    exit 1
fi
temporary=$(mktemp "${output_file}.tmp.XXXXXX")
trap 'rm -f "$temporary"' 0
trap 'exit 1' 1 2 3 15
LC_ALL=C awk '
    /^#define NGX_QUIC_MAX_ACK_GAP[ \t]+2$/ { constants++; constant = $0 }
    /^ngx_quic_resend_frames\(ngx_connection_t \*c, ngx_quic_send_ctx_t \*ctx\)$/ {
        if (previous != "void" || active || signatures) bad = 1
        signatures++; active = 1; body = previous ORS $0 ORS
        next
    }
    active {
        body = body $0 ORS
        line = $0; opens = gsub(/\{/, "", line)
        line = $0; closes = gsub(/\}/, "", line)
        if (opens) begun = 1
        depth += opens - closes
        if (depth < 0) bad = 1
        if (begun && depth == 0) { active = 0; complete++ }
    }
    { previous = $0 }
    END {
        if (bad || constants != 1 || signatures != 1 || complete != 1 || active) exit 1
        print constant
        printf "%s", body
    }
' "$source_file" > "$temporary"
if [ "$(checksum "$temporary")" != "$expected_include" ]; then
    echo 'Extracted loss-requeue fixture differs from its reviewed bytes' >&2
    exit 1
fi
mv -f "$temporary" "$output_file"
