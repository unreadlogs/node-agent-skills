# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses semantic versioning.

Nothing is published to npm yet, so versions here track repository milestones rather than released packages.

## [Unreleased]

### Added

- `pdf` — text, field, and structure extraction, form filling, rendering, merging, splitting, stamping, watermarking, and embedded image extraction.
- `image-transform-pipeline` — local image inspection, aspect-ratio-preserving resize, and format conversion via `sharp`.
- `ocr-to-markdown` — printed-text OCR with confidence scores and word coordinates via `tesseract.js`.
- `streaming-csv-json-normalizer` — streaming CSV inspection, parsing, normalization, and export with per-row errors.
- `workspace-archives` — allowlisted ZIP handoff archives with manifests and path containment checks.
- `ast-aware-js-repo-audit` — ESLint audits run through its Node API, normalized into location-rich findings.
- `json-repair-and-schema` — JSON and JSONL validation, conservative repair, and schema checking with explicit diagnostics.
- `git-change-intelligence` — structured read-only Git status, history, and diff summaries via `isomorphic-git`.
- `env-doctor` — Node runtime, package manager, script, and environment diagnostics that never print secret values.
- `secret-and-config-audit` — heuristic secret and risky-configuration scanning with redacted output.
- `sqlite-agent-toolkit` — bounded read-only SQLite schema inspection and queries via `better-sqlite3`.
- `launch-audit` — guidance for pre-launch and pre-commit readiness reviews.
- `frontend-ui` — guidance for interface design, typography, color, layout, motion, and interface copy.
- Continuous integration running the full test suite on Node 20 and Node 22.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`.

### Changed

- The repository is now an npm workspace, and each skill owns its `package.json` and dependencies.
- The root `package.json` no longer carries runtime dependencies of its own.
- The README is organized around a plain list of skills and the shared output contract.

### Removed

- `mermaid-diagram-builder` 
- `package-lock.json` is no longer tracked, and `.gitignore` covers it.

## [0.1.0]

- Initial repository structure.