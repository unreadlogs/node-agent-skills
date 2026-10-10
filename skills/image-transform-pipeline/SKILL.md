---
name: image-transform-pipeline
description: >-
  Deterministic image transformation and inspection for agent workflows.
  Features: metadata inspection, aspect-ratio-preserving resize, and format conversion.
---

# image-transform-pipeline

Deterministic, high-performance image processing for AI agents using `sharp`.

## Commands

| Command | Arguments | Output `data` |
| --- | --- | --- |
| `info` | `<input>` | `{ format, width, height, space, channels, depth, density, size }` |
| `resize` | `<input> <output> --width N --height N [--fit contain\|cover\|fill\|inside\|outside]` | `{ output, width, height }` |
| `convert` | `<input> <output> --format png\|jpg\|webp\|avif [--quality N]` | `{ output, format }` |

## Usage

```bash
node scripts/index.js info image.jpg
node scripts/index.js resize image.jpg thumb.jpg --width 200 --fit contain
node scripts/index.js convert image.png output.webp --format webp --quality 80
```

The CLI accepts local files, writes to a new output path, preserves orientation, and enforces input-size and pixel-count limits. It does not perform OCR, image understanding, generation, or arbitrary shell/ImageMagick execution.
