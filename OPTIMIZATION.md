# HTML optimization

`index.html` contains the entire page: content, styling and animation. [build-report.json](build-report.json) records the raw HTML and compressed response sizes.

## What the 1 KB limit measures

[1KB Club's submission instructions](https://1kb.club/submit/) use the Network → Bytes total result from its linked DebugBear scanner, with a limit of 1,024 bytes. This counts the compressed response and response headers. It is not the raw source length or the full DNS/TCP/TLS exchange.

The build reserves 309 bytes above the Brotli body and rejects a combined size of 1,024 bytes or more. This is a conservative local budget, not a substitute for measuring the published page. The gzip body must also remain below 1,024 bytes. [Delivery settings](TRANSPORT.md) explain the remaining network overhead.

## Markup and styling

- One ASCII document, inline CSS, native fonts and numeric character references; no external assets.
- Optional HTML tags and safe attribute quotes omitted. CSS closes open blocks at stylesheet EOF; numeric references need no semicolon before a tag.
- The doctype, title and viewport declaration preserve standards mode, tab identification and mobile sizing.
- An empty data favicon prevents a separate favicon request.
- CSS gradients replace images; individual `rotate` declarations and shared keyframes reduce animation code.
- An 18px base font, underlined links, text wrapping and reduced-motion support remain.
- Short links use empty redirects.

## Compression and further edits

`build.mjs` compares 1,080 Brotli configurations and gzip settings, then verifies that both compressed files decode exactly to the source. It also uses `compression/index.html.gz` when that Zopfli candidate matches the source and is smaller.

To search equivalent CSS declarations, independent rule order and head order:

```sh
node optimize.mjs
```

This deterministic search writes `optimization/candidate.html` and `optimization/search.json`, never replacing the source. It is tailored to the current stylesheet: its rules have no conflicting declarations of equal specificity. Recheck that assumption after adding rules. Smaller source does not always compress better.

Before adopting a candidate, compare the text, links, layout, animation phases and reduced-motion behavior at mobile and desktop widths. After replacing `index.html`, regenerate the optional Zopfli candidate in a Python environment with `zopfli==0.4.3`:

```sh
python optimize-gzip.py
npm test
npm run check
```

Deploy, verify the exact served representations and rerun the club's scanner.
