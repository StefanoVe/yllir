# Rebuilding the vendored print libraries

`print-libs.mjs` is one ESM file bundled from three npm packages, so the framework needs no
install at the master's computer. It exports `QRCode` (only `QRCode.create`, the matrix API:
no canvas), `PDFDocument`, `StandardFonts`, `rgb`, `cmyk`, `degrees` and `PNG`. The licence
texts of every bundled package are in `LICENSES.md`.

## Pinned versions

| Package | Version | Licence |
|---|---|---|
| qrcode | 1.5.4 | MIT |
| pdf-lib | 1.17.1 | MIT |
| pngjs | 7.0.0 | MIT |
| esbuild (build tool only, not shipped) | 0.25.5 | MIT |

Packages bundled inside the file, with the versions npm resolved for the pins above:
dijkstrajs 1.0.3 (MIT), @pdf-lib/standard-fonts 1.0.0 (MIT), @pdf-lib/upng 1.0.1 (MIT),
pako 1.0.11 (MIT and Zlib), tslib 1.14.1 (0BSD).

## Commands

Work in an empty folder outside the framework (for example a scratch folder):

```sh
mkdir vendor-build && cd vendor-build
npm init -y
npm install --save-exact qrcode@1.5.4 pdf-lib@1.17.1 pngjs@7.0.0 esbuild@0.25.5
```

Create `vendor-entry.mjs` with exactly this content:

```js
// Entry of the vendored print libraries. Only the matrix API of qrcode is used (no canvas).
import qrcodeCore from 'qrcode/lib/core/qrcode.js';
import { PDFDocument, StandardFonts, rgb, cmyk, degrees } from 'pdf-lib';
import pngjs from 'pngjs';

// Returns { modules: { size, data } } for a text; data is row-major, 1 for a dark module.
export const QRCode = {
  create: (text, options) => qrcodeCore.create(text, options),
};
export const PNG = pngjs.PNG;
export { PDFDocument, StandardFonts, rgb, cmyk, degrees };
```

Bundle it. The banner gives the bundle a real `require` for Node built-ins (`util`, `zlib`),
which the libraries use; without it the bundle fails when the libraries load:

```sh
./node_modules/.bin/esbuild vendor-entry.mjs --bundle --format=esm --platform=node --target=node20 \
  --legal-comments=none \
  --banner:js="import { createRequire as __yllirCreateRequire } from 'node:module'; const require = __yllirCreateRequire(import.meta.url);" \
  --outfile=print-libs.mjs
```

Copy `print-libs.mjs` to `yllir/skills/library/print/vendor/print-libs.mjs`, and copy the licence
texts of the bundled packages (as in `LICENSES.md`) when the versions change.

## Checks

```sh
node --input-type=module -e "import('./print-libs.mjs').then(m => console.log(Object.keys(m).join(',')))"
```

The output must list `PDFDocument,PNG,QRCode,StandardFonts,cmyk,degrees,rgb`, and
`grep -c canvas print-libs.mjs` must print 0. The test
`yllir/skills/library/print/scripts/lib/vendor.test.mjs` imports the bundle and builds a PDF and
a QR matrix.
