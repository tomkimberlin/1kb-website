#!/bin/sh
# Pinned configured nginx only. No Python or copied implementation source.
set -eu
if [ "$#" -ne 2 ]; then
    echo 'Usage: extract-quic-packet-end-len.sh SOURCE_ROOT OUTPUT_INCLUDE' >&2
    exit 2
fi
root=$1
destination=$2
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum < "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 < "$1" | awk '{print $1}'; }
else
    echo 'A SHA256 utility is required' >&2
    exit 1
fi
if [ -e "$destination" ] && [ "$0" -ef "$destination" ]; then
    echo 'Output aliases this extractor' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_output.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != 95ba0fc8c9f6825a95707cf3624624903ec5d46e721b11ba79121a191fc402b4 ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_output.c' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_transport.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != 26c2dc2a3bd340837bab07af2569c2491f9d276bf8d66f727c197f6cdb51e5f6 ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_transport.c' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_frames.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != aeae39ebe24fc2a73158ddfa2ebafb33b2f053e270271a908b4bec0abbe8c53f ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_frames.c' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_protection.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != 3e8dac5ff56e3de319eae327e7b64233b658c17107950476cbcbd24a44d5202a ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_protection.c' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_streams.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != 546d0f07ebd91149cca56058cae973ab8f520edf9d5227c8f684d8cb689f51ad ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_streams.c' >&2
    exit 1
fi
source="$root/src/event/quic/ngx_event_quic_ack.c"
if [ -e "$destination" ] && [ "$source" -ef "$destination" ]; then
    echo 'Output aliases an implementation source' >&2
    exit 1
fi
if [ "$(checksum "$source")" != 256b238edb0b3c757c341d4b0c2d482b38d56698a72d88638ff8353383cad763 ]; then
    echo 'Pinned nginx source changed: ngx_event_quic_ack.c' >&2
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
ack="$root/src/event/quic/ngx_event_quic_ack.c"
streams="$root/src/event/quic/ngx_event_quic_streams.c"
{
    LC_ALL=C awk '
        /^#define NGX_QUIC_MAX_ACK_GAP[ \t]+2$/ { count++; value = $0 }
        END { if (count != 1) exit 1; print value }
    ' "$ack"
    extract_function "$ack" ngx_quic_resend_frames void
    printf '\n'
    extract_function "$streams" ngx_quic_set_event 'static void'
    printf '\n'
    extract_function "$streams" ngx_quic_handle_stream_ack void
} > "$temporary"
if [ "$(checksum "$temporary")" != 2e66d450a997218c2b2fd49e6e223b91abf53ae4d09642be39858eb22d0967f3 ]; then
    echo 'Extracted packet lifecycle functions differ' >&2
    exit 1
fi
mv -f "$temporary" "$destination"
