# HTML optimization — September 10, 2026

The page introduces Tom as “a tinkerer near Cleveland, Ohio, USA.” It displays `<1 KB` with no space after the less-than sign. The footer links are GitHub, Telegram, Monero node and Source; Monero node links to `https://xmr.surf/`.

| Representation | Bytes |
| --- | ---: |
| ASCII HTML | 437 |
| Brotli | 220 |
| Gzip, Zopfli | 301 |

The copy edit initially produced 431 raw bytes and 226 Brotli bytes. Equivalent source ordering reduced Brotli to 221. Changing the three middle-dot references from `&#183` to `&middot` increased the raw source to 437 bytes but reduced Brotli to 220. The source remains ASCII, so no encoding marker or charset declaration is needed. A parser check verified the approved text, line and paragraph breaks, and footer link order.

The search checked 13,393 serializations, 109 mutations and 476 character-reference variants. Seventeen shortlisted sources were tested across 18,360 Brotli configurations. The final build tested 1,080 configurations and verified decompression. Zopfli was rerun through 10,000 iterations. [Candidate and measurements](measurements/tinkerer-20260910.json) preserve the selected source and search counts.

## Styling and markup

The page keeps `font:1em monospace`, browser-default link colors, its dark scheme and padding. The greeting and location occupy separate lines in the opening paragraph. The remaining sections use normal paragraph spacing.

The title, doctype, mobile viewport declaration and empty data favicon remain. Removing them affects tab identification, standards-mode rendering, mobile layout or automatic favicon requests. Optional tags, quotes and the final CSS closing brace are omitted. The literal `<` before `1` is parsed as text, not a tag. One-character links use the existing empty redirects.

The previous page was 405 raw / 217 Brotli / 294 gzip bytes. Earlier [styling measurements](measurements/style-options-20260910.json) apply to that earlier copy. Lower raw byte count does not necessarily mean lower transfer size.

## Verification

All 17 existing tests and 76 live HTTP/1.1 and HTTP/2 checks passed. Exact identity, Brotli and gzip responses matched their artifacts, and redirects retained empty bodies. An external HTTPS request matched the Brotli artifact. No fresh visual browser trace was taken. Earlier transport/gallery results remain scoped to their original page versions.

Reproduce the equivalent-source search with `node optimize.mjs`, `node mutate.mjs`, `node tune.mjs`, then `node slim.mjs`. The search preserves the current link-color rule, including its absence. These scripts write candidates under `optimization/`; inspect a candidate before replacing `index.html`, rebuilding and deploying. The build enforces UTF-8-compatible source below 1,000 bytes. No finite search proves a global minimum.
