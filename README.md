# Node Agent Skills

[![CI](https://github.com/unreadlogs/node-agent-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/unreadlogs/node-agent-skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E.svg)](https://nodejs.org)

**Small, dependable tools for AI agents running in JavaScript environments.**

Most agent workflows are written in JavaScript or TypeScript, but many useful tools still assume Python, a system binary, Docker, or a long setup guide. This project takes a simpler approach: package the useful parts as focused Node.js skills with predictable inputs, safe defaults, and machine-readable results.

The goal is not to build another giant agent framework. It is to make everyday operations feel boring—in a good way.

## Why this exists

An agent should be able to say:

- “Read this PDF and tell me what is inside.”
- “Fill these fields and return the completed document.”
- “Resize these images and give me web-ready files.”
- “Turn this CSV into validated JSON without loading the whole file into memory.”
- “Create a workspace archive I can hand to another agent.”
- “Audit this JavaScript repository and show me the real problems.”

It should not need a Python virtual environment, a system-wide binary, or a fragile shell pipeline to do those things.

## What you get

The repository contains two kinds of skills:

- **Tool skills** are executable Node.js CLIs. They accept explicit arguments and return structured JSON, so an agent can call them without scraping human-oriented terminal output.
- **Guidance skills** are focused playbooks for agents. They explain how to approach a task, what to check, and what not to claim.

### Tool skills

- [`pdf`](skills/pdf/SKILL.md) — read, search, split, merge, stamp, render, and fill digital PDFs and forms.
- [`image-transform-pipeline`](skills/image-transform-pipeline/SKILL.md) — inspect, resize, and convert images locally with `sharp`.
- [`ocr-to-markdown`](skills/ocr-to-markdown/SKILL.md) — pull printed text out of images, with confidence and word coordinates as evidence.
- [`streaming-csv-json-normalizer`](skills/streaming-csv-json-normalizer/SKILL.md) — parse, normalize, and export CSV data without loading a whole file into memory.
- [`workspace-archives`](skills/workspace-archives/SKILL.md) — build ZIP handoff archives from explicit file lists and inspect their entry names.
- [`ast-aware-js-repo-audit`](skills/ast-aware-js-repo-audit/SKILL.md) — run ESLint through its Node API and return normalized, location-rich findings.
- [`json-repair-and-schema`](skills/json-repair-and-schema/SKILL.md) — validate, conservatively repair, and schema-check JSON and JSONL with explicit diagnostics.
- [`git-change-intelligence`](skills/git-change-intelligence/SKILL.md) — structured read-only Git status, history, and diff summaries without shelling out.
- [`env-doctor`](skills/env-doctor/SKILL.md) — diagnose runtime, package manager, scripts, and environment problems without exposing secret values.
- [`secret-and-config-audit`](skills/secret-and-config-audit/SKILL.md) — scan for likely secrets and risky configuration, with every value redacted.
- [`sqlite-agent-toolkit`](skills/sqlite-agent-toolkit/SKILL.md) — inspect SQLite schemas and run bounded read-only queries.

Every tool skill follows the same small contract: success prints one JSON object to `stdout`, failures print one JSON object to `stderr` and exit with code `1`. That makes them equally usable from an agent, a shell script, or a CI job.

```json
{"data":{"page_count":4,"metadata":{}}}
```

Commands are explicit rather than magical. Inputs, output paths, page ranges, and mutations stay visible in the call.

### Guidance skills

- [`launch-audit`](skills/launch-audit/SKILL.md) — a practical pre-launch and pre-commit review for fast-moving projects.
- [`frontend-ui`](skills/frontend-ui/SKILL.md) — guidance for making interfaces feel intentional rather than generic.

Every tool skill folder holds its `SKILL.md`, `package.json`, implementation under `scripts/`, and tests under `test/`. Small tools keep the CLI in `scripts/index.js`; larger tools split implementation helpers into `scripts/lib/`. Guidance skills ship as a `SKILL.md` and a `package.json`, with no executable script or test folder.

## Quick start

Requirements: **Node.js 20 or newer**.

```bash
git clone https://github.com/unreadlogs/node-agent-skills.git
cd node-agent-skills
npm install
npm test
```

Try a tool directly:

```bash
node skills/pdf/scripts/index.js create hello.pdf --text "Hello from Node"
node skills/pdf/scripts/index.js text hello.pdf
```

To use one skill with an Agent Skills-compatible setup:

```bash
npx skills add unreadlogs/node-agent-skills/pdf
```

If your agent uses a local skills directory, copy the skill folder and install its dependencies from the repository root.

## Development

Each executable skill owns its implementation, documentation, and tests:

```text
skills/<skill-name>/
├── SKILL.md
├── package.json
├── scripts/           # tool skills only
│   ├── index.js
│   └── lib/            # optional implementation modules
└── test/               # tool skills only
```

Run everything from the repository root:

```bash
npm install
npm test
```

When adding a tool skill:

1. Keep the scope narrow enough to explain in one paragraph.
2. Prefer maintained Node libraries over wrappers around Python or system commands.
3. Put limits around bytes, pages, pixels, records, time, and concurrency.
4. Return evidence and diagnostics, not just a success message.
5. Add tests for happy paths, malformed input, limits, and failure output.
6. Add a realistic example to the documentation.

## Design principles

**Node-native.** A JavaScript project should not have to become a Python project to gain a useful capability.

**Deterministic where possible.** The same input and options should produce an understandable result.

**Safe by default.** Untrusted files, URLs, archives, and agent-generated arguments need boundaries.

**Useful to agents.** Results should include paths, counts, locations, hashes, warnings, and other evidence an agent can reason about.

**Small surfaces.** A skill should solve a recurring job, not become an entire platform.

**Honest compatibility.** We document what has been tested instead of claiming that every agent behaves the same way.

## Status

This is an early, actively shaped project, and every skill here is a first release that will keep tightening. The PDF tool is the most mature part of the collection. The scope is intentionally opinionated: some tempting areas—generic browser automation and general audio/video conversion—are excluded because existing Node ecosystems already cover them well or because the current runtime options are not dependable enough.

Expect the interfaces to improve as more skills are added. Pin the repository revision if you need reproducible behavior.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, including what a good skill looks like, how to structure a pull request, and how to run the tests.

In short: start with a recurring agent problem that is awkward in a JavaScript-only environment, keep the skill narrow, put explicit limits around untrusted input, and return evidence rather than a success message. Small, focused pull requests are easier to review than a new mega-skill.

Security reports do not belong in public issues — see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Third-party assets and dependencies keep their own licenses; see the relevant skill directory for additional notices.
