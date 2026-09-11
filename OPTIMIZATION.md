# HTML optimization — September 10, 2026

The page uses the user's five lines, with no emojis. It displays `<1 KB` with no space after the less-than sign, and keeps the Monero, GitHub, Telegram and Source links.

| Representation | Bytes |
| --- | ---: |
| ASCII HTML | 423 |
| Brotli | 224 |
| Gzip, Zopfli | 306 |

The initial copy edit was 420 raw bytes and 242 Brotli bytes. Equivalent serialization reduced Brotli to 234. Replacing the two literal middle dots with `&#183` references made the document entirely ASCII, allowing removal of the UTF-8 BOM. Further ordering tests produced 224 Brotli bytes. A parser check confirmed the exact five displayed lines and all four link destinations. The literal `<` before `1` is parsed as text, not a tag.

Two serialization passes checked 11,089 and 13,393 candidates. `slim.mjs` compared equivalent character references and encoding markers (1,924 candidates, then 868 after reordering the ASCII version). The final build tested 1,080 Brotli configurations and verified decompression. Zopfli was rerun through 10,000 iterations. The preceding page was 445 raw / 255 Brotli / 340 gzip.

## Styling options measured separately

The deployed styling retains its dark scheme, white links, padding and `5vmin` monospace text. These alternatives were measured with the same visible copy and equivalent HTML/CSS orderings; they have not been deployed.

| Option | Raw HTML | Brotli |
| --- | ---: | ---: |
| Current appearance | 423 | 224 |
| `font:1em monospace` | 420 | 221 |
| `font:1em/1.5 monospace` | 422 | 226 |
| Browser-default link colors | 407 | 220 |
| `1em` text and browser-default link colors | 405 | 217 |

Font-relative sizing avoids the large text produced by viewport-relative sizing on large displays. It also follows the inherited font size. The line-height option adds breathing room. Browser link colors restore the browser's normal unvisited/visited distinction. These are design recommendations, not screenshot-verified results. [CSS length units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length)

[Candidate source and measurements](measurements/style-options-20260910.json) record the exact alternatives. A straight deletion can compress worse until the remaining source is reordered. Lower raw byte count is not sufficient evidence of lower transfer size.

The title, doctype, mobile viewport declaration and empty data favicon remain. Removing them affects tab identification, standards-mode rendering, mobile layout or automatic favicon requests. Dropping extra padding or the dark scheme would change the appearance for small savings; they were retained.

## Verification

All 17 existing tests and 76 live HTTP/1.1 and HTTP/2 checks passed. Exact identity, Brotli and gzip responses matched their artifacts, and redirects retained empty bodies. No fresh visual browser trace was available because the Mac was locked. Earlier transport/gallery results remain scoped to their original page versions.

Reproduce the equivalent-source search with `node optimize.mjs`, `node mutate.mjs`, `node tune.mjs`, then `node slim.mjs`. These write candidates under `optimization/`; inspect a candidate before replacing `index.html`, rebuilding and deploying. The build enforces UTF-8-compatible source below 1,000 bytes. No finite search proves a global minimum.
