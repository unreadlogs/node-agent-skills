# Contributing

Thanks for helping. This project stays useful by staying small, so a focused pull request is worth more than a large one.

## Start with a problem

A good contribution begins with a recurring agent problem that is awkward in a JavaScript-only environment — something that currently needs Python, a system binary, Docker, or a fragile shell pipeline to get done. If you cannot describe the problem in a paragraph, it probably is not ready to be a skill yet.

## Getting set up

Requirements: **Node.js 20 or newer**.

```bash
git clone https://github.com/unreadlogs/node-agent-skills.git
cd node-agent-skills
npm install
npm test
```

The repository is an npm workspace, so each skill under `skills/` carries its own `package.json` and dependencies. One install at the root sets up everything.

## Adding a skill

1. Create `skills/<skill-name>/` with a `SKILL.md`, a `package.json`, a `scripts/index.js`, and a `test/skill.test.js`.
2. Name the package `@unreadlogs/skill-<skill-name>`.
3. Write the `name` and `description` frontmatter carefully. That description is the trigger an agent reads before deciding whether to load the skill, so be specific about the situations it covers.
4. Add the skill to the right list in `README.md` so the collection stays discoverable.
5. Run `npm test` from the repository root.

Guidance skills are simpler: they ship a `SKILL.md` and a `package.json`, with no CLI and no tests.

## What a good tool skill looks like

- **Narrow scope.** Something you can explain in one paragraph.
- **Node-native.** Built on maintained Node libraries instead of wrappers around Python or system commands.
- **Bounded.** Explicit limits around bytes, pages, pixels, records, time, and concurrency.
- **Explicit.** Inputs, output paths, ranges, and mutations stay visible in the call. No hidden magic.
- **Evidence-rich.** Returns paths, counts, locations, hashes, and warnings rather than a bare "done".
- **Safe by default.** Treats files, archives, agent-generated arguments, and secrets as untrusted, and redacts secret values everywhere they could be printed.

## The output contract

Tool skills follow one contract, and anything scripted depends on it:

- Success prints one JSON object to `stdout`: `{"data": ...}`
- Failure prints one JSON object to `stderr`: `{"error": "..."}`
- Failure exits with code `1`

## Tests

Every tool skill needs tests that cover the happy path with realistic input, malformed input, the documented limits, and the shape of failure output including the exit code.

Run the whole suite from the repository root with `npm test`, or work inside one skill with `npm test --workspace <package-name>`.

## Commits and pull requests

Keep commits focused and write messages in the imperative mood. In the pull request, describe the user problem with a small before-and-after example, list the Node libraries you built on and why they fit, and note the limits, the failure modes, and anything you deliberately left out. If you could not verify something, say so and explain why.

Small, focused pull requests are easier to review than a new mega-skill.

By contributing, you agree that your work is licensed under the [MIT License](LICENSE).