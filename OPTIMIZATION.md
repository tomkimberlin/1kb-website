# Making a tiny website smaller

I built the foundation of this website years ago, then let Astra cook on it. The tight loop of changing, measuring and verifying made it an ideal problem for AI to tackle.

The initial goal was fitting into [1KB Club](https://1kb.club/). Once it qualified, I wanted to see just how far Astra could take it. That expanded the work from HTML and CSS into headers, caching, nginx and TLS.

Every optimization had to preserve these minimum requirements:

- All content, including the hidden comment, and every link destination.
- The mobile and desktop layout, readable text, light/dark appearance and keyboard navigation.
- Valid HTTPS, supported protocols and encodings, caching and session reuse.

A candidate only counted as an improvement after its smaller size and preserved behavior were verified.

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

Brotli takes advantage of repeated strings, a built-in dictionary and the distribution of symbols. Changing declaration order, quote styles or whitespace can change the compressed result without changing the rendered page. Some apparently unnecessary whitespace survived because deleting it made the download larger. One pass added five bytes to the HTML source but removed four from its Brotli response; gzip and deflate stayed the same.

The build compares thousands of Brotli settings and checks that every compressed file decodes exactly to the source. Broader searches try different serializations of the same page. An alternate encoder and longer gzip searches provide another check on the result. “Maximum quality” is a search setting, not a guarantee that every other configuration produces a larger file.

Eventually the stock encoder stopped at 320 bytes. Two changes to its internal search found a 318-byte encoding of exactly the same HTML: a shorter window for estimating nearby literal frequencies, and a slightly higher estimated cost for those literals. That nudged the encoder toward different matches. The output is still ordinary Brotli, readable by an unmodified decoder; neither the browser nor the server needs a custom compression library.

The Huffman stage saved another byte. Preserving shorter runs of zero counts and adjusting the bias used to smooth nearby counts made the code trees cheaper to describe. That version reached 317 bytes, with the HTML unchanged.

The earlier September 26 local build reached 315 bytes before “my” was moved inside the GitHub hyperlink. Equivalent CSS values and changes to quoting, whitespace and existing short-link aliases gave the encoder a different input; another pass tuned its literal, command and distance estimates. That result also reduced gzip from 471 to 468 bytes and raw HTML from 746 to 743 bytes. Sixteen Chromium/WebKit comparisons found identical pixels, content, layout and keyboard order. The [local measurements](measurements/page-20260926-local.json) record the exact hashes and encoder recipe; the published DebugBear result remains a separate, dated measurement.

Expanding the link text to “my GitHub” leaves the visible sentence and raw HTML size unchanged. The updated build is 321 bytes with Brotli, 468 with gzip and 456 with deflate; the [new measurements](measurements/page-20260926-link-label.json) keep that edit separate from the earlier visual-equivalence results.

A serialization that wins with Brotli can lose with gzip. This search prioritizes Brotli while checking the fallback sizes too; all encodings still decompress to the same HTML.

All of that work happens before deployment. nginx serves precompressed bytes; visitors don't wait for a compression search. At equal quality weights, Brotli is preferred, with gzip, deflate and plain HTML available according to the request's encoding preferences. Deflate reuses the optimized gzip compression stream with a smaller wrapper.

The server had another avoidable cost: njs ran the module's four file reads on every request, including redirects. The local build now also packs the representations into one JSON file, which nginx preloads when loading its configuration. The handler decodes only the selected representation and still returns it synchronously, preserving the response buffering. Existing workers keep their snapshot through a release switch; new workers receive the new snapshot on reload. The [local runtime comparison](measurements/runtime-20260926-local.json) checks the exact bytes, headers and reload behavior alongside a loopback benchmark.

The [build report](build-report.json) records the selected settings or precompressed source. `node optimize.mjs` writes a candidate and a shortlist under `optimization/` for comparison. Its seed, attempt count, input and output paths can be specified, and its default search caps each candidate's Node-gzip size at the source's Node-gzip size. That is an early filter; the final comparison still uses the optimized gzip files and real browsers. The serializer rejects unfamiliar page structure rather than silently dropping it.

`python3 optimize-gzip.py`, with `zopfli==0.4.3` installed, generates the optional gzip candidate. Its `--tuned` mode changes one Huffman histogram threshold in that encoder and reproduces the 468-byte result. `python3 optimize-brotli.py` reproduced the earlier tuned Brotli result; after the link edit, the normal build selects a smaller stock-encoder result. Both tuned encoders compile checksum-verified source archives and need Python 3.12+ and a C compiler; the Brotli validator also needs Node. `--archive` supplies an already downloaded archive.

Both optimizers accept `--input` and `--output` for experiments. They validate the complete compressed stream, retain an existing smaller encoding of the same input and publish replacements atomically. Input and output cannot refer to the same file. The normal build uses either saved candidate only if it is smaller and decodes to the current HTML. An old compressed file cannot override an edit to the page.

## What the short links cost

All nine links use one-character paths. A link such as `<a href=g>my GitHub</a>` leaves the long destination URL on the server. Following it returns an empty redirect with the destination in its `Location` header.

This reduces the initial document, but clicking a link adds a request. That's the tradeoff. It suits a small page of outbound links; it would be less attractive for navigation people use repeatedly. Even the choice of letter can affect compression. Redirects retain their destinations as the page evolves, so older bookmarks and cached copies keep working. The email address stays visible and copyable.

## The response has its own overhead

A normal response retains Date, Content-Type, Content-Encoding, Vary and Cache-Control. They describe the document, its encoding and how it can be cached. Server identification and unnecessary fields are omitted. Even the Date header can change the total slightly as its text changes.

`Content-Length` stays on HTTP/1 responses to delimit the body and permit connection reuse. The local handler now retains it for HTTP/1.0 too: the earlier handler omitted it and closed GET connections even when the client requested keep-alive. HTTP/2 and HTTP/3 already frame their data, so it is omitted there. Error pages and redirects have empty bodies rather than generated HTML explanations.

HTTP/1.1 also [defaults to persistent connections](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.3). nginx still emitted `Connection: keep-alive`, so omitting that redundant field saved 24 bytes per persistent HTTP/1.1 response. The patch retains HTTP/1.0's explicit keep-alive field, close signals and upgrades. Tests send multiple requests over the same TLS socket to verify actual reuse. HTTP/2 and HTTP/3 are unaffected.

HTTP/1.1 leaves a little room in its text format too. The space after each header colon is optional, and a status line can omit its reason phrase. The response still says `200`; it simply stops spelling out `OK`. Removing six optional spaces and those two letters reduces the normal response headers from 177 to 169 bytes. The required space after the status code stays. Both choices follow [HTTP/1.1's message syntax](https://www.rfc-editor.org/rfc/rfc9112.html#section-4), including its [header-field grammar](https://www.rfc-editor.org/rfc/rfc9112.html#section-5). HTTP/1.0 keeps its existing format.

The nginx patch also uses the compact entries available in HTTP/2's HPACK and HTTP/3's QPACK header tables. In HTTP/3, the longer value `text/html; charset=utf-8` is cheaper to encode than `text/html` because the complete value has a predefined table entry. Counting characters would have picked the wrong winner.

Connection setup has similar opportunities. Keeping HTTP/2's default 16,384-byte inbound frame limit lets the server omit a six-byte setting. The limit is enforced: a frame one byte too large is rejected, while larger requests split across valid frames still work. Protocol defaults save bytes only when the implementation actually follows them.

There was also a saving between HTTP/2 and TLS. The page is already compressed and held in memory, but nginx was flushing its response headers before sending the body. Sending both together lets their separate HTTP/2 frames share one TLS record. The measured initial TLS 1.3 response loses one 22-byte record wrapper without changing the page or its HTTP headers. This adds no timer or waiting period: the patch applies only to fully buffered GET responses of at most 1,024 bytes, and headers still leave when flow control blocks the body. Larger or streaming responses keep their existing behavior.

Caching earns its space. The one-day cache policy lets returning visitors use a fresh local copy. Removing that header would give up an explicit freshness period to save a few bytes on the first response.

## The certificate was bigger than the page

TLS certificates were one of the largest useful targets. The server uses ECDSA certificates, a compact Let's Encrypt profile and a shorter trusted chain. A still-shorter chain that failed trust validation was discarded.

Certificate compression reduces the certificate message for clients that support it. This preserves the same certificate and verification process. In the gallery measurements, that compressed message was around 1.5 KB; several other sites sent uncompressed messages over 3 KB. That difference outweighed small advantages in their HTML-response headers.

Session reuse matters too. Sending one small session ticket allows a later connection to resume. Completely disabling tickets saved a little on the first connection but gave up the larger saving available on a return visit.

Even the compressor settings got another pass. A smaller Brotli window saved one byte on the main domain's certificate, but made both alias certificates larger. The OpenSSL patch tries that alternative and keeps it only when it beats the default. Tests compare both sizes, decompress the result and exercise buffer limits. The optional pass also retains the successful default if its allocation fails, without leaving a new error in OpenSSL's queue; fault-injection tests check both an empty queue and an existing caller error. For the measured main certificate, the smaller window saved one byte on a full handshake when Brotli certificate compression was negotiated. The certificate and its signature are unchanged.

The same idea used for the HTML also helped the certificates: tune the encoder offline, then serve the resulting standard Brotli bytes. The published optimizer saved another nine bytes on the main certificate, eight on `www`, and two on the alternate domain. The [September 26 local recipe](measurements/certificate-cache-20260926-local.json) keeps the main certificate at 1,478 bytes and reduces the same `www` and alternate chains from 1,500 to 1,497 bytes and 1,490 to 1,488 bytes. Fresh pinned compilations and 80 independent decode checks confirm the exact bytes. Two synthetic single-certificate variants grew one byte; the optimizer preserves any smaller exact entry already saved. It receives only public certificate chains, with no network access or private-key mount. The new recipe has not been deployed.

The server cannot simply trust a compressed file. It regenerates the exact Certificate message, uses its hash to find the candidate, decompresses it, and checks every byte before accepting a smaller result. Renewed certificates get their own entries. Missing, stale or damaged entries fall back to ordinary compression; a timeout prevents the optional optimizer from holding up renewal. The [measurements and rejection tests](measurements/certificate-cache-20260922.json) record that boundary. These savings affect a full TLS handshake, separately from the page's size.

The handshake messages had their own wrappers. OpenSSL sent EncryptedExtensions, the compressed certificate, CertificateVerify and Finished in four encrypted records. Each added 22 bytes with the cipher used in these measurements. They can share a record because they use the same handshake keys. Combining them removed 66 bytes; combining the two messages in a resumed handshake removed 22.

This needed more care than changing an encoder setting. A small buffer holds the messages, while the existing transcript calculation and record writer keep their jobs. Finished must still leave before the keys change. Tests forced partial writes, exhausted buffers and failed allocations to check that retries neither duplicate a message nor lose it. Oversized flights fall back to ordinary writes, and paths such as QUIC and client authentication keep their original behavior. The current harness passes 23 focused cases, including async mode and accepted or rejected early data. The September 22 build passed 219 selected upstream tests and address/undefined-behavior sanitizer checks alongside Chromium and WebKit checks. The [delivery reference](TRANSPORT.md#tls-handshake-records) gives the scope and measurements.

HTTP/3 remains available, although the server doesn't spend bytes advertising it in every response. TLS 1.2 and 1.3 remain supported. The [delivery reference](TRANSPORT.md) documents the exact settings and the limits of the measurements.

## Checking the result

Every candidate has to preserve the text, links and layout. Chromium and WebKit checks cover narrow and wide viewports, light and dark appearance, unexpected requests and horizontal overflow. Network checks compare the exact response bytes and exercise encoding negotiation, redirects, protocol limits and session reuse.

The [gallery comparison](COMPARISON.md) subtracts each site's response body. That makes it useful for comparing delivery overhead without rewarding a site simply for having less to say. It uses repeated measurements and identifies the clients and stopping points; packet timing and browser behavior still vary.

The recorded optimization passes found smaller Brotli representations while preserving the content and layout of each baseline, with reproducible measurements and a working rollback. A new idea gets a separate test first. The number has to go down, and the website still has to work.
