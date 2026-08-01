---
name: pdf
description: >-
  Use this skill whenever the user wants to do anything with PDF files, including
  reading or extracting text, searching for text, inspecting document metadata,
  reading bookmarks (outlines) and link/note annotations, merging/splitting/
  rotating/cropping documents, removing pages, creating new PDFs, adding text
  stamps and page numbers, watermarking, rendering pages to images, and
  extracting embedded images. If the user mentions a .pdf file or asks to
  produce one, use this skill.
---

# pdf

Native Node.js toolkit for PDF processing. All operations are driven from a
single CLI (`scripts/index.js`) with subcommands. Every command follows a
strict JSON I/O contract so results are easy for an agent to parse.

The library stack is 100% JavaScript:
- `pdf-lib` for create/modify/merge/split/rotate/crop/remove/metadata
- `pdfjs-dist` for text extraction, search, annotations, bookmarks, and rendering
- `@napi-rs/canvas` for PNG/JPG rasterization

No Python, no system PDF utilities required.

## Execution Command

```bash
node scripts/index.js <command> <arguments...>
```

Run from the `skills/pdf/` directory (or use an absolute path to `scripts/index.js`).

### Input / Output Schema

Inputs:
- First argument is the subcommand name.
- Remaining arguments are positional (paths) and flags (`--name value`).

stdout: a single line of JSON: `{ "data": <result> }`
stderr: on error, a single line of JSON: `{ "error": "message" }` and the process
exits with code `1`.

```bash
# success
$ node scripts/index.js info document.pdf
{"data":{"page_count":2,"metadata":{...},"pages":[...]}}

# failure
$ node scripts/index.js info missing.pdf
{"error":"ENOENT: no such file or directory, open 'missing.pdf'"}
```

## Commands

### Read & inspect

| Command | Arguments | Output `data` |
| --- | --- | --- |
| `info` | `<input.pdf>` | `{ page_count, file_size, metadata, pages: [{page,width,height,rotation}] }` |
| `text` | `<input.pdf>` `[--pages 1-3]` | `{ file, pages, text, pageTexts }` |
| `search` | `<input.pdf> <query>` `[--pages 1-3] [--case-sensitive] [--regex]` | `{ query, total_matches, matches: [{page,text,x0,top,x1,bottom}] }` |
| `metadata` | `<input.pdf>` | `{ metadata }` |
| `annotations` | `<input.pdf>` `[--pages 1-3]` | `{ file, annotation_count, annotations }` |
| `outline` | `<input.pdf>` | `{ file, outline: [{title,url,page,children}] }` |
| `render` | `<input.pdf> <out-dir>` `[--scale N] [--max-dim N] [--format png\|jpg] [--quality N] [--pages 1-3]` | `{ output_dir, images }` |
| `thumbnail` | `<input.pdf> <out-dir>` `[--size N] [--pages 1-3] [--format png\|jpg]` | `{ output_dir, thumb_size, images }` |
| `extract-images` | `<input.pdf> <out-dir>` | `{ output_dir, images }` |

### Modify

| Command | Arguments | Output `data` |
| --- | --- | --- |
| `merge` | `<output.pdf> <input1.pdf[:range]> [input2.pdf[:range] ...]` | `{ output, merged }` |
| `split` | `<input.pdf> <out-dir>` `[--pages 1-3]` `[--by-range "1-2,4-5"]` | `{ output_dir, files }` or `{ output_dir, chunks, files }` |
| `rotate` | `<input.pdf> <output.pdf> --pages 1,2 --deg 90` | `{ output, degrees, pages }` |
| `remove-pages` | `<input.pdf> <output.pdf> --pages 1,3,5` | `{ output, removed, requested }` |
| `crop` | `<input.pdf> <output.pdf> --x N --y N --width N --height N [--page N]` | `{ output, crop_box, pages }` |
| `stamp` | `<input.pdf> <output.pdf> --text "..." [--pages 1-3] [--x N] [--y N] [--size N] [--font NAME] [--color HEX] [--background HEX] [--opacity N]` | `{ output, pages }` |
| `page-numbers` | `<input.pdf> <output.pdf> [--pages 1-3] [--x N] [--y N] [--size N] [--start N] [--with-total]` | `{ output, pages }` |
| `watermark` | `<input.pdf> <watermark.pdf> <output.pdf>` | `{ output }` |
| `metadata` | `<input.pdf> <output.pdf> --title "..." --author "..." ...` | `{ output, metadata }` |

### Create

| Command | Arguments | Output `data` |
| --- | --- | --- |
| `create` | `<output.pdf> --json <spec.json>` or `--text "..."` | `{ output, pages }` |
| `--version` | (no arguments) | `{ name, version }` |

## Reading a document

Start with `info` to learn the page count, dimensions, and metadata. Use `text`
to read the content. For a large document, scope reads with `--pages` (e.g.
`--pages 1-5` or `--pages 3`).

```bash
node scripts/index.js info report.pdf
node scripts/index.js text report.pdf --pages 1-3
```

## Search

`search` returns every occurrence of a query with its page and bounding box in
top-down PDF coordinates (y = 0 at the top of the page):

```bash
node scripts/index.js search report.pdf "invoice total"
```

Matching is case-insensitive by default; pass `--case-sensitive` for exact
matching. Pass `--regex` to treat the query as a regular expression (useful for
patterns like invoice numbers). Each word is treated as a separate line, so
`^`/`$` anchors match word boundaries; use `\s+` between words for phrases:

```bash
node scripts/index.js search report.pdf "\d{4}-\d{4}" --regex
node scripts/index.js search report.pdf "^Total$" --regex
```

Use the returned `x0/top/x1/bottom` values to locate the text visually.

## Annotations and bookmarks

`annotations` lists links, text notes, and highlights with their page, type,
rectangle, and (for links) URL. `outline` returns the document's bookmark tree
with the target page number of each entry:

```bash
node scripts/index.js annotations report.pdf
node scripts/index.js outline report.pdf
```

## Metadata

Read metadata with no output argument. Write metadata by supplying an output
path and any of `--title`, `--author`, `--subject`, `--keywords`, `--creator`,
`--producer`:

```bash
node scripts/index.js metadata report.pdf
node scripts/index.js metadata report.pdf updated.pdf --title "Q3 Report" --author "Finance"
```

## Editing pages

All page selections accept a list, a range, or both (`1,3`, `1-5`, `1-3,7`).

```bash
# combine documents; optionally take only some pages from an input
node scripts/index.js merge combined.pdf part1.pdf part2.pdf:1-3

# split out pages 2-4 into individual files
node scripts/index.js split full.pdf out/ --pages 2-4

# split into chunks of pages
node scripts/index.js split full.pdf out/ --by-range "1-2,4-5"

# rotate pages 1 and 3 by 90 degrees
node scripts/index.js rotate full.pdf out.pdf --pages 1,3 --deg 90

# delete pages
node scripts/index.js remove-pages full.pdf trimmed.pdf --pages 2,5-6

# crop page 1 to a region (coordinates are top-down: x/y = top-left corner)
node scripts/index.js crop full.pdf out.pdf --x 50 --y 60 --width 400 --height 600 --page 1
```

## Stamping and page numbers

`stamp` overlays text on one or more pages. Coordinates are top-down (x/y =
top-left of the text); by default the text is centered on the page. Multi-line
text is supported with `\n`. Fonts: `Helvetica`, `HelveticaBold`, `Times`,
`Courier`. `--color` and `--background` are hex values like `FF0000`.

```bash
node scripts/index.js stamp full.pdf out.pdf --text "CONFIDENTIAL\nFOR REVIEW" --pages 1-3 --size 36 --color FF0000 --background FFFF00 --opacity 0.5
```

`page-numbers` draws page numbers (optionally "N / M") at the bottom center:

```bash
node scripts/index.js page-numbers full.pdf out.pdf --with-total --start 5
```

## Watermark

`watermark` stamps the first page of a second PDF over every page of the input:

```bash
node scripts/index.js watermark draft.pdf watermark.pdf out.pdf
```

## Creating PDFs

Minimal text PDF:

```bash
node scripts/index.js create hello.pdf --text "Hello World!"
```

Structured PDF via a spec file (coordinates are top-down, y = 0 at the top):

```json
{
  "pages": [
    {
      "width": 612,
      "height": 792,
      "texts": [{ "text": "Invoice", "x": 50, "y": 50, "size": 18, "font": "HelveticaBold" }],
      "lines": [{ "x1": 50, "y1": 60, "x2": 300, "y2": 60, "thickness": 1 }],
      "rectangles": [{ "x": 50, "y": 80, "width": 200, "height": 20, "color": "DDDDDD" }],
      "images": [{ "x": 20, "y": 120, "width": 100, "height": 50, "data": "<base64 or data URI>" }]
    }
  ]
}
```

## Rendering

`render` converts pages to PNG (default) or JPG images. By default pages render
at 1:1 up to a max dimension of 1000px; adjust with `--scale` and `--max-dim`:

```bash
node scripts/index.js render report.pdf images/ --scale 2
node scripts/index.js render report.pdf images/ --format jpg --quality 0.9 --pages 1-5
```

Images are written as `page_<N>.png` (or `.jpg`) in the output directory.

`thumbnail` renders small preview images for quickly scanning many pages:

```bash
node scripts/index.js thumbnail report.pdf thumbs/ --size 150
```

Thumbnails are written as `thumb_<N>.png`.

## Notes and limitations

- All bounding-box and stamp coordinates are top-down PDF points (y = 0 at the
  top), matching how pages are laid out visually.
- Password-protected PDFs are not supported. Use `qpdf --password=... --decrypt`
  or `tesseract` for OCR as needed.
- Rendering requires embedded fonts to be available; standard fonts are loaded
  from `pdfjs-dist` automatically.
