# HTML optimization

`index.html` contains the entire page: content, styling and animation. [build-report.json](build-report.json) records the raw HTML and compressed response sizes.

## What the 1 KB limit measures

[1KB Club's submission instructions](https://1kb.club/submit/) use the Network → Bytes total result from its linked DebugBear scanner, with a limit of 1,024 bytes. This counts the compressed response and response headers. It is not the raw source length or the full DNS/TCP/TLS exchange.

The build reserves 309 bytes above the Brotli body and rejects a combined size of 1,024 bytes or more. This is a conservative local budget, not a substitute for measuring the published page. The gzip body must also remain below 1,024 bytes. [Delivery settings](TRANSPORT.md) explain the remaining network overhead.

## Markup and styling

- One ASCII document, inline CSS, native fonts and a character reference for the hand; no script or downloaded artwork.
- Optional HTML tags and safe attribute quotes omitted. CSS closes the final open blocks at the end of the stylesheet; the hand's numeric reference needs no semicolon before the next tag.
- A doctype, title and viewport declaration preserve standards mode, tab identification and mobile sizing. The unused viewport-fit setting is removed.
- An empty data favicon prevents a separate favicon request.
- A repeating conic gradient draws the rays. CSS `rotate` replaces longer transform declarations, and one keyframe serves both the background and hand through a custom property.
- Flex layout places the hand beside the two-line greeting. The equal-height items need no explicit cross-axis alignment.
- The page uses an 18px base font, a responsive heading, underlined links and wrapping for long addresses. Reduced-motion preferences disable all animation.
- The final sentence stays in the source inside a hidden paragraph.
- Short service links use empty redirects. GitHub repository links and the visible email address keep their direct destinations.

## Color and motion

Cyan, magenta and yellow sit against near-black, with narrow white highlights on the rays. Background and strip colors share a 48-second hue cycle. The white greeting retains an opaque dark backing; its shadow and the hand's shadow share a magenta-to-cyan cycle. The hand stays yellow and swings continuously from the wrist. Heading and strip tilts alternate. No colors or timings are randomized in the page.

The fixed background keeps the compact layout. Native Safari overscroll can expose the canvas beyond that layer; the page does not add artificial scroll space to compensate.

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

Deploy, verify the exact served representations and rerun the club's scanner. Experiments and screenshots remain outside the published page and repository history.
