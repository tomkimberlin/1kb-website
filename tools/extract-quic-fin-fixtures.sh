#!/bin/sh
# Exact reviewed source only; this is deliberately not a general C parser.
set -eu
if [ "$#" -ne 4 ]; then
    echo 'Usage: extract-quic-fin-fixtures.sh STREAMS_SOURCE ACK_SOURCE OUTPUT_SOURCE OUTPUT_INCLUDE' >&2
    exit 2
fi
streams=$1
ack=$2
output_source=$3
destination=$4
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum < "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 < "$1" | awk '{print $1}'; }
else
    echo 'A SHA256 utility is required' >&2
    exit 1
fi
for protected in "$streams" "$ack" "$output_source" "$0"; do
    if [ -e "$destination" ] && [ "$protected" -ef "$destination" ]; then
        echo 'The output must not alias a source or this extractor' >&2
        exit 1
    fi
done
if [ "$(checksum "$streams")" != 546d0f07ebd91149cca56058cae973ab8f520edf9d5227c8f684d8cb689f51ad ] \
   || [ "$(checksum "$ack")" != 256b238edb0b3c757c341d4b0c2d482b38d56698a72d88638ff8353383cad763 ] \
   || [ "$(checksum "$output_source")" != fff23e8f68bc2a49fe33a7446f64b82d88ece92d990c765f11ddf22df6f6fe22 ]; then
    echo 'Pinned nginx stream/ACK/output source changed; review this gate' >&2
    exit 1
fi

extract_function() {
    LC_ALL=C awk -v function_name="$2" -v return_type="$3" '
        $0 ~ "^" function_name "\\(" {
            if (previous != return_type || active || signatures) bad = 1
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
            if (bad || signatures != 1 || complete != 1 || active) exit 1
            printf "%s", body
        }
    ' "$1"
}

temporary=$(mktemp "${destination}.tmp.XXXXXX")
trap 'rm -f "$temporary"' 0
trap 'exit 1' 1 2 3 15
{
    LC_ALL=C awk '
        /^#define NGX_QUIC_MAX_ACK_GAP[ \t]+2$/ { count++; value = $0 }
        END { if (count != 1) exit 1; print value }
    ' "$ack"
    extract_function "$ack" ngx_quic_resend_frames void
    extract_function "$output_source" ngx_quic_revert_send 'static void'
    extract_function "$streams" ngx_quic_stream_flush 'static ngx_int_t'
    printf '\n'
    extract_function "$streams" ngx_quic_stream_send_chain 'static ngx_chain_t *'
    printf '\n'
    extract_function "$streams" ngx_quic_shutdown_stream_send 'static ngx_int_t'
    printf '\n'
    extract_function "$streams" ngx_quic_do_reset_stream 'static ngx_int_t'
    printf '\n'
    extract_function "$streams" ngx_quic_set_event 'static void'
    printf '\n'
    extract_function "$streams" ngx_quic_handle_stream_ack void
} > "$temporary"
if [ "$(checksum "$temporary")" != 31f0f06fa8003c3473d0a1a089b6e30df2093f07043f2476cb199db8d7427250 ]; then
    echo 'Extracted component functions differ from their reviewed bytes' >&2
    exit 1
fi
mv -f "$temporary" "$destination"
