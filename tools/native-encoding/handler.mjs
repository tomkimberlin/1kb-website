import {sha256} from './fixture.mjs';

// Each case installs an unpredictable path before navigation. This handler never
// negotiates or transforms bytes; it sends the explicitly selected build body.
export function makeHandler({bodies, routes, serverRequests}) {
  return (request, response) => {
    const coding = routes.get(request.url);
    const advertised = String(request.headers['accept-encoding'] ?? '').trim().toLowerCase();
    const expected = request.method === 'GET' && coding !== undefined && advertised === coding;
    const record = {
      path: request.url, method: request.method, coding: coding ?? 'unexpected',
      acceptEncoding: advertised, expected,
    };
    serverRequests.push(record);
    if (!expected) {
      response.writeHead(400, {'content-length': 0, 'cache-control': 'no-store'});
      response.end();
      return;
    }
    const body = bodies[coding];
    record.encodedBytes = body.length;
    record.encodedSha256 = sha256(body);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'vary': 'accept-encoding',
      ...(coding === 'identity' ? {} : {'content-encoding': coding}),
    });
    response.end(body);
  };
}
