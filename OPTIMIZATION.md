# HTML optimization — September 10, 2026

The greeting and tinkerer introduction have separate paragraphs. “Welcome to my 1 KB website.” links “1 KB website” to [1kb.club](https://1kb.club/). The footer links to GitHub, PrivateBin and the Monero node on consecutive lines, without blank lines between them.

| Representation | Bytes |
| --- | ---: |
| ASCII HTML | 416 |
| Brotli | 224 |
| Gzip, Zopfli | 300 |

The initial edit was 416 raw / 232 Brotli bytes. The equivalent-source search checked 13,393 serializations and 19 mutations. Four shortlisted sources were tested across 4,320 Brotli configurations; the final build tests 1,080 configurations and verifies decompression. Zopfli was rerun through 10,000 iterations. [Candidate and measurements](measurements/welcome-links-20260910.json) preserve the selected source and search counts.

The previous page was 428 raw / 229 Brotli / 310 gzip bytes. This wording and link-layout update saves 5 Brotli bytes. Earlier measurements remain scoped to their original copy.

## Styling and markup

`font:1.125rem/1.5 monospace` produced 18-pixel text and 27-pixel line height in the test browser. Relative sizing respects the browser's root font setting. WCAG does not prescribe one minimum font size; [text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) matters. The dark scheme, padding and browser-default link colors remain.

The title, doctype, mobile viewport declaration and empty data favicon remain because removing them affects tab identification, standards-mode rendering, mobile layout or automatic favicon requests. Optional document tags, eligible quotes, the final CSS brace and final anchor closing tag are omitted. Two `<br>` elements separate the footer links without paragraph margins. The source remains ASCII without an encoding marker or charset declaration. One-character links shorten the page and add an empty redirect when clicked.

## Verification

All 17 Worker tests, syntax checks and 80 live origin HTTP/1.1 and HTTP/2 checks passed. The three representations match their artifacts; the removed `/t` returns an empty 404. The earlier twelve alias checks cover path/query preservation and both URL schemes, including six empty HTTPS redirects with no reporting headers. A fresh external request followed the unchanged alias and returned the new exact Brotli artifact.

A separate headless Firefox browser verified the new live text and four links at 390 pixels. The three footer links align vertically at one 27-pixel line-height interval each, with no blank lines. No horizontal overflow occurred. Earlier checks of the same font sizing at 320 pixels and 200% text sizing also passed. The page loaded no scripts or external assets. This is a focused layout check, not a full accessibility audit.

Reproduce the equivalent-source search with `node optimize.mjs`, `node mutate.mjs`, `node tune.mjs`, then `node slim.mjs`. These scripts write candidates under `optimization/`; inspect a candidate before replacing `index.html`, rebuilding and deploying. The build enforces UTF-8-compatible source below 1,000 bytes. No finite search proves a global minimum.
