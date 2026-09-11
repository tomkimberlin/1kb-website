# HTML optimization

`index.html` contains the entire page. [build-report.json](build-report.json) records its HTML, Brotli and gzip sizes.

## Markup and styling

- ASCII source avoids an encoding marker or charset declaration.
- Optional document tags, eligible quotes, the final CSS brace and final anchor closing tag are omitted.
- The doctype, title and viewport declaration preserve standards mode, tab identification and mobile layout.
- An empty data favicon prevents an automatic favicon request.
- `font:1.125rem/1.5 monospace` uses a system font and relative sizing. The page keeps browser-default link colors.
- Paragraphs separate the text. Two `<br>` elements stack the footer links without blank lines.
- One-character URLs keep the HTML short; each link adds an empty redirect when clicked.

## Compression

`build.mjs` compares 1,080 Brotli configurations and gzip settings, then verifies that each compressed file decodes to the source. It also uses `compression/index.html.gz` when that Zopfli candidate matches the source and beats the built-in gzip result. The build rejects pages of 1,000 bytes or more.

To search equivalent markup and CSS orderings:

```sh
node optimize.mjs
node mutate.mjs
node tune.mjs
node slim.mjs
```

Candidates go into the ignored `optimization/` directory. Review `optimization/candidate.html` before replacing `index.html`; smaller source does not always mean smaller compressed output. Check the resulting text, links and layout in a browser.

`optimize-gzip.py` regenerates the Zopfli candidate. Run it from the repository root in a Python environment with `zopfli==0.4.3`, then rebuild.

```sh
python optimize-gzip.py
npm test
npm run check
```
