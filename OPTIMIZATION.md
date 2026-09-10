# Optimization verification — September 10, 2026

The size note now reads **“⚡ This page is under 1 KB.”** The scripts/tracking wording was removed. The bio, Monero link, emojis, and GitHub/Source links remain.

| Representation | Current HTML response body |
| --- | ---: |
| Identity | 378 bytes |
| Brotli | 237 bytes |
| Gzip, Zopfli | 310 bytes |

These count UTF-8 bytes including the BOM, excluding HTTP headers and connection overhead. The build enforces a source below 1,000 bytes. The previous 400-byte / 238-byte Brotli profile is documented in [its detailed audit](OPTIMIZATION-4593824.md).

The new wording was optimized across 6,769 serialization/link candidates, 356 mutations, and 43,200 Brotli trials over 40 finalists. The direct edit initially compressed to 260 bytes; reordering the equivalent markup and CSS reduced it to 237. The final build compares 1,080 Brotli configurations and verifies decompression. Zopfli was rerun through 10,000 iterations.

Seventeen Worker tests and the Wrangler production dry run passed. A browser check verified the new text, title, UTF-8 emojis, and mobile layout. Live responses were compared byte for byte against Brotli, gzip, and identity artifacts, including weighted preferences and exclusions. This copy update did not change the Worker routing or Cloudflare zone configuration.

The earlier three-engine layout/link/deletion audits and HTTP/2 header measurements are retained in the linked audit, with their original sizes explicitly scoped to that version. They are not presented as fresh exhaustive checks of this wording revision. The measured search does not prove global optimality.
