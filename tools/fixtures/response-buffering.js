// Fixtures for verify-response-buffering.py. Load only on an isolated test server.
// The intentional exception tests stream failure and subsequent server health.
const small = 's'.repeat(318);
const large = 'L'.repeat(200000);
function serve(r) {
    r.headersOut['Content-Type'] = 'application/octet-stream';
    if (r.uri === '/_coalesce/small' || r.uri === '/_coalesce/slow'
        || r.uri === '/_coalesce/no-body'
        || r.uri === '/_coalesce/headonly' || r.uri === '/_coalesce/header-error') {
        r.return(200, small);
    } else if (/^\/_coalesce\/threshold-(1023|1024|1025)$/.test(r.uri)) {
        r.return(200, 't'.repeat(Number(r.uri.split('-')[1])));
    } else if (r.uri === '/_coalesce/large') {
        r.return(200, large);
    } else if (r.uri === '/_coalesce/empty') {
        r.return(200, '');
    } else if (r.uri === '/_coalesce/redirect') {
        r.headersOut['Content-Length'] = '0';
        r.headersOut.Location = '/_coalesce/small';
        r.status = 301;
        r.sendHeader();
        r.finish();
    } else if (r.uri === '/_coalesce/stream') {
        r.status = 200;
        r.sendHeader();
        r.send('first');
        setTimeout(() => { r.send('last'); r.finish(); }, 800);
    } else {
        r.return(404, '');
    }
}
function headers(r) {
    if (r.httpVersion !== '1.1') delete r.headersOut['Content-Length'];
    if (r.uri === '/_coalesce/headonly') r.status = 204;
    if (r.uri === '/_coalesce/header-error') throw Error('intentional staging header error');
}
function noBody(r, data, flags) {
    if (flags.last) r.sendBuffer('', {last: true});
}
export default {serve, headers, noBody};
