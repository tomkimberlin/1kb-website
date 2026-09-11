# HTML optimization — September 10, 2026

The greeting and tinkerer introduction have separate paragraphs. “<1 KB website” links to [1kb.club](https://1kb.club/). The footer links to GitHub, PrivateBin and the Monero node; Telegram has been removed.

| Representation | Bytes |
| --- | ---: |
| ASCII HTML | 428 |
| Brotli | 229 |
| Gzip, Zopfli | 310 |

The initial edit was 433 raw / 237 Brotli bytes. The equivalent-source search checked 13,393 serializations, 14 mutations and 84 character-reference variants. Three shortlisted sources were tested across 3,240 Brotli configurations; the final build tests 1,080 configurations and verifies decompression. Zopfli was rerun through 10,000 iterations. [Candidate and measurements](measurements/links-layout-20260910.json) preserve the selected source and search counts.

The previous page was 409 raw / 211 Brotli / 300 gzip bytes. The added links and more readable layout cost 18 Brotli bytes. Earlier measurements remain scoped to their original copy.

## Styling and markup

`font:1.125rem/1.5 monospace` produced 18-pixel text and 27-pixel line height in the test browser. Relative sizing respects the browser's root font setting. WCAG does not prescribe one minimum font size; [text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) matters. The dark scheme, padding and browser-default link colors remain.

The title, doctype, mobile viewport declaration and empty data favicon remain because removing them affects tab identification, standards-mode rendering, mobile layout or automatic favicon requests. Optional document tags, eligible quotes, the final CSS brace and final anchor closing tag are omitted. Literal `<1` is valid text here. Middle dots use `&#xb7`, keeping the source ASCII without an encoding marker or charset declaration. One-character links shorten the page and add an empty redirect when clicked.

## Verification

All 17 Worker tests, syntax checks and 80 live origin HTTP/1.1 and HTTP/2 checks passed. The three representations match their artifacts; the removed `/t` returns an empty 404. Twelve alias checks cover path/query preservation and both URL schemes, including six empty HTTPS redirects with no reporting headers. Following the alias from an external server returned the exact Brotli artifact.

A separate headless Firefox browser verified the live text, four links, paragraph spacing, 18-pixel text and 1.5 line height. Mobile checks at 320 and 390 pixels, including 200% text sizing at 320 pixels, found no horizontal overflow. The page loaded no scripts or external assets. This is a focused layout check, not a full accessibility audit.

Reproduce the equivalent-source search with `node optimize.mjs`, `node mutate.mjs`, `node tune.mjs`, then `node slim.mjs`. These scripts write candidates under `optimization/`; inspect a candidate before replacing `index.html`, rebuilding and deploying. The build enforces UTF-8-compatible source below 1,000 bytes. No finite search proves a global minimum.
