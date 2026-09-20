# Local PDF dependencies

These assets are loaded from this site's own origin only when the visitor downloads a proposal. There is no remote PDF service, runtime CDN import, browser printing, or upload of the proposal. PDF text uses an embedded subset of the font and remains searchable.

- `pdf-lib-1.17.1.mjs`: pdf-lib 1.17.1 ESM minified distribution, copied unchanged from the bundled runtime. MIT, see `pdf-lib-LICENSE.txt`. Source: https://github.com/Hopding/pdf-lib
- `fontkit-1.1.1.mjs`: `@pdf-lib/fontkit` 1.1.1 ESM minified distribution. The only change is its pako import, rewritten to `./pako-1.0.11.mjs`. MIT declaration and attribution in `fontkit-LICENSE.txt`; retained bundled dependency notices in `fontkit-NOTICES.txt`; Apache 2.0 text in `Apache-2.0.txt`. Source: https://github.com/Hopding/fontkit. This fork removes dynamic `new Function` usage for CSP compatibility.
- `pako-1.0.11.mjs`: pako 1.0.11 minified UMD distribution inside a local module/exports wrapper, then exported as ESM; no global object is modified. MIT, see `pako-LICENSE.txt`. Source: https://github.com/nodeca/pako
- `EcoGEONotoSC-Regular.ttf.gz`: derived from Noto Sans SC Regular, source `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf` from https://github.com/notofonts/noto-cjk. SIL OFL 1.1, see `NotoSansSC-LICENSE.txt`. The source font's copyright is retained in the font metadata. The derived family and PostScript names are renamed to **Eco GEO Noto SC** and **EcoGEONotoSC-Regular**, respectively. No endorsement is implied.

The Noto source was retrieved on 2026-09-20. `build-font.py` converts its cubic CFF outlines to standard quadratic TrueType outlines with fonttools 4.65.0 (`Cu2QuPen`, 1/1000-em maximum error), retains the source Unicode character map and horizontal metrics, and renames the derivative. This avoids CFF/WOFF subsetting compatibility problems observed during Poppler validation. The complete 30,890-codepoint font is gzip-compressed for transport (about 6 MB), decompressed locally with pako, then only the characters used in the current proposal are embedded into the PDF. No characters are removed from the deployed font solely to shrink its download.

The exported PDF typically contains tens to hundreds of KB, independent of the original font size. Characters not present in this font are visibly represented as `[U+XXXX]`, accompanied by a note; missing glyphs never silently disappear or prevent downloading a proposal.

To rebuild the font asset after obtaining the official OTF:

```sh
python build-font.py /path/to/NotoSansSC-Regular.otf
```

The Python builder is not needed in the browser. Use `node --test tests/test-advisor-pdf.mjs` from the repository root for the exporter tests; `node tests/test-advisor-pdf.mjs --write-qa` also writes one QA PDF under `tmp/pdfs/`.
