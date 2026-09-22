import fs from 'fs';

// Loaded together on nginx reload; never sent as JavaScript to the browser.
const representations = {
  br: fs.readFileSync('/srv/current/index.html.br'),
  deflate: fs.readFileSync('/srv/current/index.html.deflate'),
  gzip: fs.readFileSync('/srv/current/index.html.gz'),
  identity: fs.readFileSync('/srv/current/index.html')
};
function selectEncoding(value) {
  const weights = Object.create(null);
  const items = value.toLowerCase().split(',');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const parts = item.trim().split(';');
    const name = parts.shift();
    if (!name) continue;
    const parameter = parts.find(p => /^\s*q\s*=/.test(p));
    const q = parameter === undefined ? 1 : Number(parameter.split('=')[1]);
    weights[name] = Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
  }
  let selected, best = 0;
  const names = ['br', 'deflate', 'gzip'];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const q = weights[name] === undefined ? (weights['*'] || 0) : weights[name];
    if (q > best) { selected = name; best = q; }
  }
  const identity = weights.identity;
  if (identity !== undefined && identity > best) return 'identity';
  if (selected) return selected;
  if (identity === undefined ? weights['*'] !== 0 : identity > 0) return 'identity';
  return null;
}
function empty(r, status, location) {
  r.status = status;
  r.headersOut['Content-Length'] = '0';
  if (location !== undefined) r.headersOut.Location = location;
  r.sendHeader();
  r.finish();
}
function serve(r) {
  if (r.variables.scheme === 'http' || r.variables.host === 'www.tomkimberlin.com' || r.variables.host === 'tom.kimberlin.net') {
    return empty(r,301,'https://tomkimberlin.com'+r.variables.request_uri);
  }
  if (r.method !== 'GET' && r.method !== 'HEAD') {
    r.headersOut.Allow = 'GET, HEAD';
    return empty(r,405);
  }
  const redirects = {'/b':'https://github.com/tomkimberlin','/a':'https://github.com/tomkimberlin/1kb-website','/o':'https://1kb.club/','/c':'mailto:tomkimberlin@gmail.com','/m':'https://github.com/tomkimberlin/m365-workbench','/i':'https://github.com/tomkimberlin/Save-Image-As','/w':'https://euthenics.com/','/e':'https://euthenics.com/','/g':'https://github.com/tomkimberlin','/x':'https://xmr.surf/','/s':'https://github.com/tomkimberlin/1kb-website','/p':'https://paste.kimberlin.net/','/k':'https://1kb.club/'};
  if (Object.prototype.hasOwnProperty.call(redirects,r.uri)) return empty(r,301,redirects[r.uri]);
  if (r.uri === '/index.html') return empty(r,301,'/'+(r.variables.is_args||'')+(r.variables.args||''));
  if (r.uri !== '/') return empty(r,404);
  r.headersOut.Vary = 'accept-encoding';
  const encoding = selectEncoding(r.headersIn['Accept-Encoding'] || '');
  if (!encoding) return empty(r,406);
  // QPACK has a one-byte static entry for this complete UTF-8 content type.
  r.headersOut['Content-Type'] = r.httpVersion === '3.0' ? 'text/html; charset=utf-8' : 'text/html';
  r.headersOut['Cache-Control'] = 'max-age=86400';
  if (encoding !== 'identity') r.headersOut['Content-Encoding'] = encoding;
  r.return(200,representations[encoding]);
}
function headers(r) {
  // HTTP/2 and HTTP/3 frame the body themselves; retain length for HTTP/1.1.
  if (r.httpVersion !== '1.1') delete r.headersOut['Content-Length'];
}
export default {serve, headers};
