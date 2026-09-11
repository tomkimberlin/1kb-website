# HTML optimization — September 10, 2026

The page introduces Tom as “a tinkerer near Cleveland, Ohio, USA.” It displays `<1 KB` with no space after the less-than sign. The footer links are GitHub, Telegram and Monero node; Monero node links to `https://xmr.surf/`.

| Representation | Bytes |
| --- | ---: |
| ASCII HTML | 409 |
| Brotli | 211 |
| Gzip, Zopfli | 300 |

Removing the Source link initially produced 408 raw bytes and 216 Brotli bytes. Equivalent ordering and character references produced 409 raw bytes and 211 Brotli bytes. The middle dots use `&#183`, and `&lt1` displays `<1` in text. The source remains ASCII, so no encoding marker or charset declaration is needed. A parser check verified the copy, line and paragraph breaks, and three footer links.

The search checked 13,393 serializations, 79 mutations and 504 character-reference variants. Eighteen shortlisted sources were tested across 19,440 Brotli configurations. The final build tested 1,080 configurations and verified decompression. Zopfli was rerun through 10,000 iterations. [Candidate and measurements](measurements/no-source-20260910.json) preserve the selected source and search counts.

## Styling and markup

The page keeps `font:1em monospace`, browser-default link colors, its dark scheme and padding. The greeting and location occupy separate lines in the opening paragraph. The remaining sections use normal paragraph spacing.

The title, doctype, mobile viewport declaration and empty data favicon remain. Removing them affects tab identification, standards-mode rendering, mobile layout or automatic favicon requests. Optional document tags and the final anchor closing tag are omitted. This serialization retains viewport quotes and the CSS closing brace because it compresses better. One-character links use the existing empty redirects.

The previous page with the Source link was 437 raw / 220 Brotli / 301 gzip bytes; its [measurements](measurements/tinkerer-20260910.json) are retained. Earlier [styling measurements](measurements/style-options-20260910.json) apply to their original copy. Lower raw byte count does not necessarily mean lower transfer size.

## Verification

All 17 existing tests and 76 live HTTP/1.1 and HTTP/2 checks passed. Exact identity, Brotli and gzip responses matched their artifacts, and redirects retained empty bodies. An external HTTPS request matched the Brotli artifact. No fresh visual browser trace was taken. Earlier transport/gallery results remain scoped to their original page versions.

Reproduce the equivalent-source search with `node optimize.mjs`, `node mutate.mjs`, `node tune.mjs`, then `node slim.mjs`. The search preserves the current link-color rule, including its absence. These scripts write candidates under `optimization/`; inspect a candidate before replacing `index.html`, rebuilding and deploying. The build enforces UTF-8-compatible source below 1,000 bytes. No finite search proves a global minimum.
