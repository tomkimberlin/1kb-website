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
    const selected = cases[r.uri.slice('/_encoding/'.length)];
    if (!selected) return r.return(404, '');
    for (const key in selected) r.headersOut[key] = selected[key];
    r.return(200, '');
}
function headers(r) { delete r.headersOut['Content-Length']; }
export default {serve, headers};
