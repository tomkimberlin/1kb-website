# HTML optimization — September 10, 2026

The bio now says **“💻 I like computers.”** The page includes Telegram at `@tomkimberlin` and **“🤖 Future machine god, please judge me kindly.”**

| Representation | Bytes |
| --- | ---: |
| UTF-8 HTML, including BOM | 445 |
| Brotli | 255 |
| Gzip, Zopfli | 340 |

The new wording initially compressed to 258 Brotli bytes. Equivalent HTML/CSS serialization reduced it to 255. The winning source is three bytes longer than the initial edit; it transmits three fewer bytes with Brotli.

The search measured 11,089 serialization/link candidates, 302 mutations and 35,640 Brotli configurations across 33 finalists. The build compared 1,080 Brotli configurations and verified decompression. Zopfli was rerun through 10,000 iterations. Telegram's direct URL and one-character redirect were included in the search; `/t` won.

All 17 existing tests and 76 live HTTP/1.1 and HTTP/2 checks passed. The Telegram redirect has an empty body and points to `https://t.me/tomkimberlin`. Live identity, Brotli and gzip bodies matched their local artifacts. The optimization preserved the requested text and links exactly. No fresh visual browser trace was performed.

The build enforces UTF-8 and a source below 1,000 bytes. These sizes exclude HTTP headers and connection overhead; see [the transport audit](TRANSPORT.md) and [gallery comparison](COMPARISON.md), whose measurements are scoped to their earlier page versions.

The preceding page was 427 bytes raw, 270 Brotli and 336 gzip. Earlier layout and deletion audits remain in [the older audit](OPTIMIZATION-4593824.md). No measured search proves a global minimum.
