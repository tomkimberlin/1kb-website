# Making a tiny website smaller

I built the foundation of this website years ago, then let Astra cook on it. The optimization had a tight loop: change, measure, verify, repeat. A smaller result had to preserve the content, links and layout.

Fitting into [1KB Club](https://1kb.club/) was the starting point. The work went from HTML and CSS to nginx and TLS. Astra ran the experiments, implemented the changes and drafted this write-up.

## First, decide what “small” means

There are three different sizes worth keeping separate:

| Measurement | What it includes |
| --- | --- |
| HTML source | The text in `index.html`, including its CSS |
| Compressed response body | The Brotli, gzip or deflate bytes carrying that file |
| Complete exchange | Requests, responses, DNS, connection setup, TLS and network framing |

[1KB Club's submission test](https://1kb.club/submit/) sits between the last two: its linked DebugBear scanner counts page weight, including response headers, but excludes DNS and connection setup. The [README](README.md) shows the current result alongside the raw and compressed sizes.

A page can qualify for the club and still require several kilobytes to establish a secure connection. Getting the HTML smaller helps one part of that exchange. It doesn't shrink a certificate or a browser's request headers.

## Why this ended up on a home server

For a while, the website ran entirely in a Cloudflare Worker. It served the same compressed HTML without depending on the home server. That worked.

The reason to move back was control over the bytes surrounding the page. Cloudflare's edge adds headers, and its [response-header rules](https://developers.cloudflare.com/rules/transform/response-header-modification/) restrict changes to fields such as `cf-*` and `server`. [Netlify's custom-header support](https://docs.netlify.com/manage/routing/headers/#limitations) also leaves fields such as `Server`, `Content-Encoding` and `Content-Length` under platform control. Neither arrangement provides a place to install this project's patched nginx and OpenSSL builds at the public endpoint.

The Cloudflare decision was measured. On September 10, 2026, a controlled comparison served the **same 271-byte Brotli body** through both paths:

| Earlier hosting comparison | Direct nginx | Cloudflare Worker |
| --- | ---: | ---: |
| Encoded HTTP/2 response headers | 91 B | 181 B |
| Cold TLS traffic through the first response, both directions | 5,648 B | 6,474 B |

That was an 826-byte reduction in the cold TLS exchange, about 13%. Both clients offered certificate compression, both servers used it, and certificate verification stayed enabled. These are historical results from an earlier page version; the [original audit](https://github.com/tomkimberlin/1kb-website/blob/d273611/TRANSPORT.md) gives the conditions and raw measurements. Netlify wasn't part of that benchmark.

Caddy was tested too. Its compact response headers looked promising, but the tested build lacked TLS certificate compression. nginx with a suitable OpenSSL build produced the smaller overall exchange. The particular builds and settings mattered more than the server names.

Cloudflare still provides DNS. The records are DNS-only, so visitors connect directly to nginx. A small updater handles changes to the public IP address.

There is a cost to that control: the site depends on home power and connectivity, and the server, certificates and custom patches need maintenance. A managed host would remove much of that work, and an edge location closer to a visitor may respond faster. This setup was chosen for this byte-counting exercise; that 13% result isn't a claim that home hosting is generally faster.

## Keep enough CSS to make reading comfortable

The page had a detour through animated backgrounds, tilted rows and a waving hand. It was possible to fit quite a lot of CSS into the budget. Eventually I preferred a quiet page and a lower byte count.

The current CSS buys a narrow centered column, padding, 18px text, a larger heading and comfortable line spacing. Native fonts avoid a font download. `color-scheme:light dark` lets the browser supply matching page, text and link colors without a theme script or toggle.

Those are deliberate constraints on the optimization. Removing the viewport declaration can break mobile sizing. Removing the doctype can change layout rules. Removing a style declaration can make a narrow screenshot look unchanged while breaking the desktop layout. A smaller result has to survive both.

The empty `data:,` favicon is another small expense with a purpose: it avoids a separate favicon request. Everything needed to display the page arrives in one document.

## Let the compressor settle arguments

HTML permits some closing tags and attribute quotes to be omitted. Those are straightforward savings. After that, the results get less intuitive.

Brotli takes advantage of repeated strings, a built-in dictionary and the distribution of symbols. Changing declaration order, quote styles or whitespace can change the compressed result without changing the rendered page. Some apparently unnecessary whitespace survived because deleting it made the download larger.

The build compares thousands of Brotli settings and checks that every compressed file decodes exactly to the source. Broader searches try different serializations of the same page. An alternate encoder and longer gzip searches provide another check on the result. “Maximum quality” is a search setting, not a guarantee that every other configuration produces a larger file.

A serialization that wins with Brotli can lose with gzip. This search prioritizes Brotli while checking the fallback sizes too; all encodings still decompress to the same HTML.

All of that work happens before deployment. nginx reads precompressed files; visitors don't wait for a compression search. Brotli is preferred when accepted, with gzip, deflate and plain HTML available according to the request's encoding preferences. Deflate reuses the optimized gzip compression stream with a smaller wrapper.

The [build report](build-report.json) records the selected settings. `node optimize.mjs` writes a candidate under `optimization/` for comparison, and `python optimize-gzip.py`, with `zopfli==0.4.3` installed, generates the optional gzip candidate. The build verifies the gzip candidate still matches the current HTML before using it.

## What the short links cost

All nine links use one-character paths. A link such as `<a href=b>GitHub</a>` leaves the long destination URL on the server. Following it returns an empty redirect with the destination in its `Location` header.

This reduces the initial document, but clicking a link adds a request. That's the tradeoff. It suits a small page of outbound links; it would be less attractive for navigation people use repeatedly. Even the choice of letter can affect compression. Redirects retain their destinations as the page evolves, so older bookmarks and cached copies keep working. The email address stays visible and copyable.

## The response has its own overhead

A normal response retains Date, Content-Type, Content-Encoding, Vary and Cache-Control. They describe the document, its encoding and how it can be cached. Server identification and unnecessary fields are omitted. Even the Date header can change the total slightly as its text changes.

`Content-Length` stays on HTTP/1.1 responses to delimit the body and permit connection reuse. HTTP/2 and HTTP/3 already frame their data, so it is omitted there. Error pages and redirects have empty bodies rather than generated HTML explanations.

The nginx patch also uses the compact entries available in HTTP/2's HPACK and HTTP/3's QPACK header tables. In HTTP/3, the longer value `text/html; charset=utf-8` is cheaper to encode than `text/html` because the complete value has a predefined table entry. Counting characters would have picked the wrong winner.

Connection setup has similar opportunities. Keeping HTTP/2's default 16,384-byte inbound frame limit lets the server omit a six-byte setting. The limit is enforced: a frame one byte too large is rejected, while larger requests split across valid frames still work. Protocol defaults save bytes only when the implementation actually follows them.

Caching earns its space. The one-day cache policy lets returning visitors use a fresh local copy. Removing that header would give up an explicit freshness period to save a few bytes on the first response.

## The certificate was bigger than the page

TLS certificates were one of the largest useful targets. The server uses ECDSA certificates, a compact Let's Encrypt profile and a shorter trusted chain. A still-shorter chain that failed trust validation was discarded.

Certificate compression reduces the certificate message for clients that support it. This preserves the same certificate and verification process. In the gallery measurements, that compressed message was around 1.5 KB; several other sites sent uncompressed messages over 3 KB. That difference outweighed small advantages in their HTML-response headers.

Session reuse matters too. Sending one small session ticket allows a later connection to resume. Completely disabling tickets saved a little on the first connection but gave up the larger saving available on a return visit.

Even the compressor settings got another pass. A smaller Brotli window saved one byte on the main domain's certificate, but made both alias certificates larger. The OpenSSL patch tries that alternative and keeps it only when it beats the default. Tests compare both sizes, decompress the result and exercise buffer limits. For the current main certificate, that saves one byte on a full handshake when Brotli certificate compression is negotiated. The certificate and its signature are unchanged.

HTTP/3 remains available, although the server doesn't spend bytes advertising it in every response. TLS 1.2 and 1.3 remain supported. The [delivery reference](TRANSPORT.md) documents the exact settings and the limits of the measurements.

## Checking the result

Every candidate has to preserve the text, links and layout. Chromium and WebKit checks cover narrow and wide viewports, light and dark appearance, unexpected requests and horizontal overflow. Network checks compare the exact response bytes and exercise encoding negotiation, redirects, protocol limits and session reuse.

The [gallery comparison](COMPARISON.md) subtracts each site's response body. That makes it useful for comparing delivery overhead without rewarding a site simply for having less to say. It uses repeated measurements and identifies the clients and stopping points; packet timing and browser behavior still vary.

This is the smallest Brotli result found for the current content and layout, with reproducible measurements and a working rollback. A new idea gets a separate test first. The number has to go down, and the website still has to work.
