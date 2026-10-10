# Node Agent Skills

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

The current collection is intentionally small. 

## Quick start

Requirements: **Node.js 20 or newer**.

```bash
git clone https://github.com/unreadlogs/node-agent-skills.git
cd node-agent-skills
npm ci
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
├── scripts/
└── test/
```

Run everything from the repository root:

```bash
npm ci
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

This is an early, actively shaped project. The PDF tool is the most mature part of the collection. The roadmap is intentionally opinionated: some tempting areas—generic browser automation and general audio/video conversion—are excluded because existing Node ecosystems already cover them well or because the current runtime options are not dependable enough.

Expect the interfaces to improve as more skills are added. Pin the repository revision if you need reproducible behavior.

## Contributing

A good contribution starts with a recurring agent problem that is awkward in a JavaScript-only environment.

Please include:

- the user problem and a small example;
- the Node libraries you are building on and why they are a good fit;
- the limits and failure modes;
- tests that exercise real input and invalid input;
- documentation that shows the output an agent receives.

Small, focused pull requests are easier to review than a new mega-skill.

## License

MIT. Third-party assets and dependencies keep their own licenses

