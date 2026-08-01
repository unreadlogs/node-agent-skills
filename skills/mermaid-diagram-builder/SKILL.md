---
name: mermaid-diagram-builder
description: >-
  Use this skill whenever the user wants to create, validate, render, analyze,
  or repair Mermaid diagrams. It validates Mermaid syntax (reporting errors with
  line numbers), renders diagrams to SVG/PNG/JPG/PDF/HTML, computes graph stats
  (nodes, edges, actors, tasks, states, etc.), extracts mermaid code blocks from
  Markdown documents, and fixes common formatting issues. If the user pastes
  Mermaid code, wants a diagram image, or needs diagram code fixed, use this
  skill.
---

# mermaid-diagram-builder

Native Node.js toolkit for Mermaid diagrams. All operations are driven from a
single CLI (`scripts/index.js`) with subcommands. Every command follows a
strict JSON I/O contract so results are easy for an agent to parse.

The library stack is 100% JavaScript:
- `mermaid` + `jsdom` for parsing, validation, and SVG generation
- `@resvg/resvg-js` for PNG/JPG rasterization
- `@napi-rs/canvas` for JPG/PDF conversion
- `pdf-lib` for PDF output
- Bundled Liberation Sans fonts (OFL) for text rendering

No Docker, no mermaid-cli, no system fonts or system tools required.

## Execution Command

```bash
node scripts/index.js <command> <arguments...>
```

Run from the `skills/mermaid-diagram-builder/` directory (or use an absolute
path to `scripts/index.js`).

### Input / Output Schema

Inputs:
- First argument is the subcommand name.
- Remaining arguments are flags (`--name value`). Diagram code is supplied via
  `--code "..."`, `--input <file>`, or `--stdin`.

stdout: a single line of JSON: `{ "data": <result> }`
stderr: on error, a single line of JSON: `{ "error": "message" }` and the
process exits with code `1`.

```bash
# success
$ node scripts/index.js validate --code 'graph TD
  A --> B'
{"data":{"valid":true,"type":"flowchart","error":null,"line":null}}

# failure (invalid syntax)
$ node scripts/index.js validate --code 'graph TD
  A -- > B'
{"data":{"valid":false,"type":"flowchart","error":"...","line":2}}
```

## Commands

| Command | Arguments | Output `data` |
| --- | --- | --- |
| `validate` | `--code <mermaid>` \| `--input <file>` \| `--stdin` | `{ valid, type, error, line, source }` |
| `render` | code input, `--format svg\|png\|jpg\|pdf\|html`, `[--output <file>] [--theme default\|dark\|forest\|neutral\|base] [--width N] [--scale N] [--background <hex\|transparent>] [--quality N]` | `{ format, svg }`, `{ format, base64 }`, or `{ output, format, bytes }` |
| `stats` | code input, `[--json]` | `{ type, valid, lines, nonBlankLines, characters, directives, nodes, edges, ... }` |
| `json` | code input | Same as `stats --json` |
| `types` | — | `{ count, types: [{ keyword, label, description }] }` |
| `extract` | code input (markdown), `[--index N] [--title <string>]` | `{ count, blocks: [{ index, startLine, code }] }` |
| `fix` | code input, `[--output <file>]` | `{ fixed, bytes }` |

### Supported diagram types

All 26 Mermaid diagram types are detected and rendered: `flowchart`/`graph`,
`sequenceDiagram`, `classDiagram`, `stateDiagram`/`stateDiagram-v2`,
`erDiagram`, `journey`, `gantt`, `pie`, `quadrantChart`,
`requirementDiagram`, `gitGraph`, `mindmap`, `timeline`, `sankey-beta`,
`xychart-beta`, `block-beta`, `packet-beta`, `architecture-beta`, `kanban`,
`C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`,
`venn-beta`.

## Examples

```bash
# Validate diagram code
node scripts/index.js validate --code 'sequenceDiagram
  Alice->>John: Hello'

# Render a PNG file (flows from --code or --input)
node scripts/index.js render --input diagram.mmd --format png --output out.png --width 800

# Render SVG and capture the markup
node scripts/index.js render --code 'pie title Pets
  "Dogs" : 386
  "Cats" : 85' --format svg

# Diagram stats (JSON for the agent)
node scripts/index.js stats --input diagram.mmd --json

# Extract all mermaid blocks from a Markdown doc
node scripts/index.js extract --input README.md

# Repair line endings / BOM / trailing whitespace
node scripts/index.js fix --input diagram.mmd --output fixed.mmd
```

## Notes

- Validation is non-destructive: invalid diagrams return `valid: false` plus a
  message and line number, with exit code 0. Real errors (missing input,
  unsupported format/theme, out-of-range extract index) exit with code 1.
- Rendered SVG is sanitized (NaN/Infinity replaced) so it rasterizes cleanly
  in any renderer; foreignObject labels are converted to text elements so they
  survive rasterization.
- Text metrics in headless environments are shimmed; output dimensions are
  computed from the actual diagram bounding box.
- The test suite runs with `npm test` (node:test) from this directory.
