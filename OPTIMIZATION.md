# HTML optimization — September 10, 2026

The link label is now `xmr.surf`. The bio, other visible wording and link destinations are unchanged.

| Representation | Bytes |
| --- | ---: |
| UTF-8 HTML, including BOM | 427 |
| Brotli | 270 |
| Gzip, Zopfli | 336 |

The direct lowercase edit produced 274 Brotli bytes. Reordering the same CSS rules and declarations, and omitting the final CSS closing brace at the stylesheet boundary, reduced this to 270. The source dropped one byte; gzip dropped two bytes compared with the preceding version.

The renewed search measured 6,769 serialization/link candidates, 376 mutations, and 47,520 Brotli configurations across 44 finalists. The build then compared 1,080 Brotli configurations and verified decompression. Zopfli was rerun through 10,000 iterations.

All 17 existing tests and 74 live HTTP/1.1 and HTTP/2 checks passed. Live identity, Brotli and gzip bodies matched their local artifacts. An external host independently verified the public Brotli SHA-256. A direct source comparison confirmed that the only visible-text change was the lowercase link label. No fresh visual browser check was performed.

The build enforces UTF-8 and a source below 1,000 bytes. These sizes exclude HTTP headers and connection overhead; see [the transport audit](TRANSPORT.md) and [gallery comparison](COMPARISON.md).

The preceding version in commit `d273611` was 428 bytes raw, 271 Brotli and 338 gzip. Earlier layout and deletion audits are retained in [the older audit](OPTIMIZATION-4593824.md), scoped to that version. No measured search proves a global minimum.
