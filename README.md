# node-agent-skills

A curated collection of native **Node.js** skills for AI agents. Designed to
work across modern coding agents — **Claude Code**, **Cursor**, **Windsurf**,
and others that support the Agent Skills standard.

## Features

- **Native Node.js** — no Docker, no Python, no system toolchains. Binary
  libraries (`@napi-rs/canvas`, `@resvg/resvg-js`, `pdfjs-dist`) are bundled
  as npm dependencies and install cleanly on Linux/macOS/Windows.
- **Standards-compliant** — follows the Agent Skills specification; each skill
  exposes a strict JSON I/O CLI or an agent-facing guide.
- **Workspace-managed** — npm workspaces keep every skill an isolated package
  while sharing one dependency tree and one lockfile.
- **Tested** — every skill ships a `node:test` suite; `npm test` runs them all.

## Repository Structure

```
node-agent-skills/
├── skills/
│   ├── <tool-skill>/         # e.g. pdf, mermaid-diagram-builder
│   │   ├── SKILL.md          # Agent-facing guide (required)
│   │   ├── package.json      # Workspace manifest + deps
│   │   ├── scripts/          # CLI entry point + lib modules
│   │   ├── assets/           # Bundled resources (e.g. fonts)
│   │   └── test/             # node:test suites
│   └── <guidance-skill>/     # e.g. frontend-ui, launch-audit
│       └── SKILL.md          # Guidance-only skills need no code
├── package.json              # Workspace root (private)
├── package-lock.json         # Single lockfile for all skills
├── LICENSE
└── README.md
```

Two kinds of skills live here:

- **Tool skills** — wrap native JavaScript libraries in a single CLI with a
  strict JSON contract on stdout (`{"data": ...}`) and errors on stderr
  (`{"error": "..."}`, exit code 1).
- **Guidance skills** — agent-driven workflow guides; no code required.

## Quick Start

```bash
# Validate Mermaid diagram syntax
node skills/mermaid-diagram-builder/scripts/index.js validate --code 'graph TD
  A --> B'

# Render a diagram to PNG
node skills/mermaid-diagram-builder/scripts/index.js render \
  --input diagram.mmd --format png --output out.png --width 800

# Extract text from a PDF
node skills/pdf/scripts/index.js text document.pdf

# Merge PDFs
node skills/pdf/scripts/index.js merge out.pdf a.pdf b.pdf
```

## Installation

Install a single skill into your project or agent configuration:

```bash
npx skills add unreadloags/node-agent-skills/<skill-name>
```

Replace `<skill-name>` with the slug of the skill you want (see the table
below). Alternatively, copy a skill's folder into your agent's skill directory
— tool skills only need `npm install` inside their folder.

## Development

```bash
npm install   # installs all workspace dependencies (hoisted to the root)
npm test      # runs every skill's node:test suite
```

### Adding a skill

1. Create `skills/<slug>/` with a `SKILL.md` (agent-facing guide) and, for
   tool skills, a `package.json` + `scripts/index.js` CLI.
2. Keep the JSON I/O contract: stdout `{"data": <result>}`, stderr
   `{"error": "..."}` + exit 1.
3. Add a `test/` suite using `node:test` and `spawnSync` against the CLI.
4. Run `npm install` at the root to update the workspace lockfile, then
   `npm test`.
5. Add the skill to the table below.

## Available Skills

| Skill | Type | Description | Status |
| ----- | ---- | ----------- | ------ |
| `pdf` | tool | Native Node.js PDF toolkit: text extraction and search (incl. regex), metadata, bookmarks and annotations, page editing (merge with ranges/split/rotate/crop/remove), create (text or spec with images), stamps, page numbers, watermark, rendering and thumbnails, image extraction. | Available |
| `mermaid-diagram-builder` | tool | Native Node.js Mermaid toolkit: syntax validation with line numbers, rendering to SVG/PNG/JPG/PDF/HTML, graph stats (nodes/edges/actors/tasks/states...), mermaid block extraction from markdown, and code repair. | Available |
| `launch-audit` | guidance | Pre-launch and pre-commit readiness audit: repo hygiene, committed secrets (redacted), env var documentation, database migration readiness, dead code, weak auth, failing builds, and deployment footguns. | Available |
| `frontend-ui` | guidance | Guidance for intentional, distinctive visual design: art direction, typography, color systems, layout, motion, and interface copy. | Available |

## Deploying

This repository is deployed as a **GitHub repository**, which is how
`npx skills add` resolves skills. Before publishing:

```bash
npm test          # all suites green
npm ci            # installs exactly from the lockfile (CI-friendly)
git add . && git commit -m "..." && git push
```

Commit `package-lock.json` — it is the single source of truth for every skill
workspace. Keep `node_modules/` out of git (already ignored). Do not commit
`.env` files; use `.env.example` templates only.

## License

MIT — see [LICENSE](./LICENSE). Third-party assets retain their own licenses
(e.g. the Liberation fonts bundled with `mermaid-diagram-builder` ship their
OFL license alongside the fonts).
