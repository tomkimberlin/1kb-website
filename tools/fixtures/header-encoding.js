// Isolated HPACK/QPACK serializer fixtures; never load on a public listener.
const cases = {
    'static': {'CaChE-CoNtRoL': 'max-age=86400', 'CONTENT-ENCODING': 'br',
        'VaRy': 'accept-encoding', 'Content-Type': 'text/html; charset=utf-8'},
    'gzip': {'Cache-Control': 'no-cache', 'Content-Encoding': 'gzip',
        'Vary': 'accept-encoding', 'Content-Type': 'text/html; charset=utf-8'},
    'literal-values': {'Cache-Control': 'private, max-age=17', 'Content-Encoding': 'Br',
        'Vary': 'Accept-Encoding, X-Custom', 'Content-Type': 'Text/HTML; Charset=UTF-8'},
    'other-coding': {'Cache-Control': 'max-age=604800', 'Content-Encoding': 'zstd',
        'Vary': '*', 'Content-Type': 'application/octet-stream'},
    'similar-names': {'cache-control-x': 'a', 'content-encoding-x': 'b', 'vary-x': 'c',
        'X-MiXeD-CaSe': 'Some Mixed VALUE', 'Content-Type': 'text/plain'},
    'duplicate-values': {'Cache-Control': ['max-age=10', 'public'],
        'Vary': ['accept-encoding', 'x-test'], 'X-Multi': ['first', 'second'],
        'Content-Type': 'text/plain'},
    'large-literal': {'X-Long-Literal': 'Z'.repeat(26000), 'Content-Type': 'text/plain'},
    'empty-values': {'Cache-Control': '', 'Content-Encoding': '', 'Vary': '',
        'X-Empty': '', 'Content-Type': 'text/plain'}
};
function serve(r) {
    // Final-status serializer fixtures only. Informational 1xx is covered by
    // the offline actual-source regression, not treated as a final response.
    const status = /^status-([2-5][0-9][0-9])$/.exec(r.uri.slice('/_encoding/'.length));
    if (status) {
        r.status = Number(status[1]);
        r.headersOut['Content-Length'] = '0';
        r.sendHeader();
        return r.finish();
    }
    const selected = cases[r.uri.slice('/_encoding/'.length)];
    if (!selected) return r.return(404, '');
    for (const key in selected) r.headersOut[key] = selected[key];
    r.return(200, '');
}
function headers(r) { delete r.headersOut['Content-Length']; }
export default {serve, headers};
