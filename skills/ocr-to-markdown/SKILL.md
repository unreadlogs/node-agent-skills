---
name: ocr-to-markdown
description: >-
  Extract printed text from a local image into plain-text Markdown and
  structured word-level OCR data with confidence and coordinates. Use for
  receipts, screenshots, signs, and scanned image pages when searchable text is
  needed. OCR may misread text; it does not understand the image or preserve
  reliable document layout.
---

# OCR to Markdown

Run Tesseract.js against one local image. Output is one JSON object on stdout;
errors are JSON on stderr with exit code 1.

```sh
node scripts/index.js ocr receipt.png
node scripts/index.js ocr screenshot.png --language eng
node scripts/index.js ocr sign.jpg --language eng+fra
```

The input must be a regular local file no larger than 20 MiB. This tool does
not read PDFs, follow a multi-page document, or transcribe handwriting. It
does not modify the image. Tesseract may need its trained language data on the
first run; allow the OCR dependency to fetch/cache that data or arrange a local
cache before using it in an offline environment.

## Result shape

```json
{"data":{"input":"receipt.png","language":"eng","text":"TOTAL 12.50",
"markdown":"TOTAL 12.50","confidence":91.2,
"words":[{"text":"TOTAL","confidence":96.5,"bbox":{"x0":12,"y0":8,"x1":70,"y1":24}}]}}
```

`text` is Tesseract's recognized text with surrounding whitespace removed.
`markdown` currently contains the same plain text; the tool does not infer
headings, tables, columns, or reading order beyond Tesseract's output.
`confidence` and each word's confidence are OCR estimates, not calibrated
probabilities. `bbox` gives the recognized word's pixel coordinates in the
source image. A word omitted by OCR will have no box, so compare important
fields with the original image.

`--language` defaults to `eng` and accepts Tesseract language codes supported
by the installed Tesseract.js trained data (for example `eng+fra`). An
unsupported or unavailable language produces a structured error. Keep the
source image available when checking dates, totals, identifiers, names, or
other high-impact values.

## Agent workflow

1. Confirm the image is the intended page and is legible at the text size shown.
   Crop or rotate a copy first if that would make the text easier to read.
2. Run OCR with the language that matches the document.
3. Use the recognized text as a draft for search or extraction. Inspect word
   boxes and the original pixels for ambiguous or consequential values.
4. Preserve uncertainty in the final answer; do not silently guess a character
   from a low-confidence OCR result.

This command returns the complete extracted text and word list in one JSON
payload. It does not expose progress output, generate a layout-aware document,
or verify facts represented in the image.
