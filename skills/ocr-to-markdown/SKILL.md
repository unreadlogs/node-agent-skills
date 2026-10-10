---
name: ocr-to-markdown
description: >-
  Extract printed text from images into Markdown and structured OCR data using
  Tesseract.js, with bounded local inputs and confidence evidence.
---

# ocr-to-markdown

Use this skill for printed text in local images. OCR is probabilistic; confidence and source coordinates are evidence, not a guarantee. Scanned PDF rendering and handwriting are not included in this first version.

```bash
node scripts/index.js ocr receipt.png --language eng
```

Output includes Markdown text, confidence, and word-level bounding boxes.
