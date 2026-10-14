---
name: image-transform-pipeline
description: >-
  Inspect, resize, and convert local raster images with explicit dimensions
  and output formats. Use when an agent needs deterministic image preparation
  for a document, web page, or handoff. It does not generate images, interpret
  their contents, or perform OCR.
---

# Image transform pipeline

The CLI uses `sharp` and reads local files only. Success is one JSON object on
stdout; failures are one JSON object on stderr with exit code 1. Paths are
resolved from the current working directory.

```sh
node scripts/index.js info photo.jpg
node scripts/index.js resize photo.jpg thumbnail.webp --width 320 --fit inside
node scripts/index.js convert logo.png logo.avif --format avif --quality 75
```

## Commands

| Command | Arguments | Behavior |
| --- | --- | --- |
| `info` | `<input>` | Read metadata without writing a file. |
| `resize` | `<input> <output>` plus `--width N` and/or `--height N` | Resize while preserving aspect ratio unless `--fit fill` is selected. |
| `convert` | `<input> <output> --format jpeg\|png\|webp\|avif` | Convert to the requested format; the output extension must match. |

`resize` options:

- `--fit contain|cover|fill|inside|outside` defaults to `contain`.
- `--quality N` accepts integer values 1–100 for JPEG, WebP, or AVIF output;
  it is invalid for PNG. For resize, the output format comes from the filename.
- `--without-enlargement false` allows an image to grow beyond its source
  dimensions. By default, resizing never enlarges it.

`convert` accepts `--quality N` for JPEG, WebP, and AVIF. PNG ignores quality
semantics, so the CLI rejects `--quality` with PNG rather than silently
pretending to apply it. JPEG extensions may be `.jpg` or `.jpeg`.

## Result fields

`info` returns the input path, file size in bytes, decoded format, dimensions,
color space, channel count, bit depth, density, alpha-channel presence, and
page count when available:

```json
{"data":{"input":"photo.jpg","size":284010,"format":"jpeg","width":1600,
"height":1200,"space":"srgb","channels":3,"depth":"uchar","density":72,
"hasAlpha":false,"pages":1}}
```

`resize` and `convert` return `input`, `output`, actual `format`, output
`width`, output `height`, and output file `size`. Sharp applies EXIF orientation
before resizing, so reported dimensions reflect the oriented output.

## Bounds and workflow

- Input must be a regular local file no larger than 100 MiB.
- Decoded input is limited to 100 million pixels. This helps bound memory use
  for unexpectedly large or compressed images.
- Output parent directories must already exist. The requested output path can
  be overwritten, so choose a new path when preserving the source matters.
- Animated or multi-page formats are not a reliable way to preserve every
  frame through these commands. The metadata may report multiple pages, but
  this CLI is intended for single-frame assets.
- Supported formats are JPEG, PNG, WebP, and AVIF. SVG, PDF, HEIC, and other
  formats depend on the installed `sharp` build and are not promised here.

Inspect first when you need to know the source dimensions or transparency.
Then pick the output dimensions and fit behavior based on the destination:
`inside` keeps the image within a box, `cover` fills and may crop, and `contain`
fits the full image inside the box. Verify the output metadata before using it
in a layout where exact dimensions or transparency matter.
