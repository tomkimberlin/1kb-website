#!/bin/sh
# Reuse the exact FIN source pins/extraction. Only calls to read_buffer are
# redirected to the transparent malformed-view seam in the adjacent test.
set -eu
if [ "$#" -ne 5 ]; then
    echo 'Usage: extract-quic-adjacent-fixtures.sh FIN_EXTRACTOR STREAMS ACK OUTPUT INCLUDE' >&2
    exit 2
fi
extractor=$1
streams=$2
ack=$3
output_source=$4
destination=$5
for protected in "$extractor" "$streams" "$ack" "$output_source" "$0"; do
    if [ -e "$destination" ] && [ "$protected" -ef "$destination" ]; then
        echo 'The output must not alias an input or extractor' >&2
        exit 1
    fi
done
raw=$(mktemp "${destination}.raw.XXXXXX")
wrapped=$(mktemp "${destination}.wrapped.XXXXXX")
trap 'rm -f "$raw" "$wrapped"' 0
trap 'exit 1' 1 2 3 15
sh "$extractor" "$streams" "$ack" "$output_source" "$raw"
{
    printf '#define ngx_quic_read_buffer adjacent_read_buffer\n'
    cat "$raw"
    printf '\n#undef ngx_quic_read_buffer\n'
} > "$wrapped"
mv -f "$wrapped" "$destination"
