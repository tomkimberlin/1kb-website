import {representations} from './public/representations.mjs';

// Server code is never sent to the browser. Prefer the smallest accepted body.
function selectEncoding(value) {
  const weights = new Map();
  for (const item of value.toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    if (!name) continue;
    const parameter = parameters.find(p => /^\s*q\s*=/.test(p));
    const q = parameter === undefined ? 1 : Number(parameter.split('=')[1]);
    weights.set(name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0);
  }
  let selected;
  let best = 0;
  for (const name of ['br', 'gzip']) {
    const q = weights.get(name) ?? weights.get('*') ?? 0;
    if (q > best) { selected = name; best = q; }
  }
  // Implicit identity is a fallback. An explicit preference is respected.
  const identity = weights.get('identity');
  if (identity !== undefined && identity > best) return 'identity';
  if (selected) return selected;
  if (identity === undefined ? weights.get('*') !== 0 : identity > 0) return 'identity';
  return null;
}

function redirect(location) {
  return new Response(null, {status: 301, headers: {location, 'cache-control': 'max-age=86400'}});
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' || url.hostname === 'www.tomkimberlin.com' || url.hostname === 'tom.kimberlin.net') {
      return redirect('https://tomkimberlin.com' + url.pathname + url.search);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {status: 405, headers: {allow: 'GET, HEAD'}});
    }
    if (url.pathname === '/g') return redirect('https://github.com/tomkimberlin');
    if (url.pathname === '/x') return redirect('https://xmr.surf/');
    if (url.pathname === '/p') return redirect('https://paste.kimberlin.net/');
    if (url.pathname === '/k') return redirect('https://1kb.club/');
    if (url.pathname === '/s') return redirect('https://github.com/tomkimberlin/1kb-website');
    if (url.pathname === '/index.html') return redirect('/' + url.search);
    if (url.pathname !== '/') return new Response(null, {status: 404});

    // The zone request transform preserves quality weights before normalization.
    // In live tests, even cf.clientAcceptEncoding had lost these weights.
    const accepted = request.headers.get('x-onekb-accept-encoding') ?? request.cf?.clientAcceptEncoding ?? request.headers.get('accept-encoding') ?? '';
    const encoding = selectEncoding(accepted);
    if (!encoding) return new Response(null, {status: 406, headers: {vary: 'accept-encoding'}});
    const bytes = representations[encoding];
    const headers = {
      'content-type': 'text/html',
      'cache-control': 'max-age=86400,no-transform',
      vary: 'accept-encoding',
      'content-length': String(bytes.length),
    };
    if (encoding !== 'identity') headers['content-encoding'] = encoding;
    return new Response(request.method === 'HEAD' ? null : bytes, {
      headers,
      // These bytes are already compressed. Never compress them a second time.
      encodeBody: 'manual',
    });
  },
};
