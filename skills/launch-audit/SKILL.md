---
name: launch-audit
description: >-
  Pre-launch and pre-commit audit for fast-moving projects. Use when the user
  asks whether a project is ready to ship, deploy, merge, or commit, especially
  AI-generated or "vibe coded" apps. Covers repository hygiene, committed
  secrets, environment variable documentation, database migration readiness,
  unsafe database access, dead code, weak auth, missing tests, broken builds,
  and deployment configuration footguns. If the user wants to verify their
  project before a launch, deploy, pull request, or commit, use this skill.
---

# launch-audit

A hard-nosed readiness review for projects about to be shipped. The goal is a
concrete list of blockers with evidence, not a generic best-practices essay.
Work inside the actual repository using the agent's own tools (git, ripgrep,
file inspection, existing scripts). This skill provides guidance only; no
helper CLI is needed — the agent's shell is the tool.

## Operating Principles

- **Scope first.** Audit the current branch, staged changes, a PR diff, or the
  whole worktree. If the user did not specify, audit the current worktree plus
  files that affect deploy and runtime.
- **Evidence over opinion.** Every finding must point to a file, a line, a
  command result, or a missing expected artifact.
- **Redact secrets.** Never print secret values. Name the file and the
  variable/key shape, and replace the value with `***`.
- **Stay in review mode** unless the user asks for fixes. If they do ask, make
  the fixes after presenting the audit and verify them.
- **Preserve user work.** Do not modify unrelated files or discard uncommitted
  changes.

## Workflow

1. **Map the project.** Identify framework, language, package manager, runtime
   version, deployment target, database, ORM, auth approach, and the
   build/test/lint commands. Note whether the worktree is clean or dirty.
2. **Repository hygiene.** Check for tracked junk: `.env*` files other than
   safe examples, local databases, logs, caches, build output, coverage,
   screenshots, uploads. Use `git ls-files` to separate tracked junk from
   ignored local files, and verify `.gitignore` covers the framework's
   artifacts (`.next`, `dist`, `build`, `coverage`, `node_modules`, lockfile
   exceptions, local SQLite files, logs, cache and upload directories).
3. **Secrets and environment.** Scan for tokens, private keys, API keys, JWT
   secrets, database URLs with embedded credentials, webhook secrets, and
   cloud credentials (AWS, Stripe, GitHub, Slack, OpenAI, Anthropic, Google,
   SendGrid, Twilio, and generic `*_SECRET` / `*_KEY` / `*_TOKEN` /
   `*_PASSWORD` assignments with real values). Confirm required env vars are
   documented in `.env.example`, docs, or typed config. Watch for accidental
   logging of auth headers, cookies, sessions, or provider responses.
4. **Database readiness.** Identify the migration system (Prisma, Drizzle,
   TypeORM, Sequelize, Knex, Alembic, Rails/Django migrations, or raw SQL).
   Confirm schema changes have committed migrations, deploys run migrations,
   and destructive changes have a backfill or rollback plan. Flag raw SQL that
   is not parameterized, and call out database-backed apps with no migration
   mechanism at all.
5. **Correctness and security basics.** Run the project's own `lint`,
   `typecheck`, `test`, and `build` scripts when practical and report results.
   Review auth boundaries, admin-only actions, server/client separation, CORS,
   CSRF, rate limiting, upload validation, SSRF surfaces, open redirects, and
   unsafe eval/shell execution. Production errors should not leak stack
   traces, secrets, or internal identifiers.
6. **Dead code.** Look for unused routes, duplicate pages or components,
   abandoned handlers, stale feature flags, large commented blocks, leftover
   TODO/FIXME/HACK notes, debugging output (`console.log`, `debugger`), and
   dependencies nothing imports. Prefer real signals: TypeScript compiler
   output, ESLint, framework route manifests, depcheck-style import scans.
   Dead code is low severity unless it touches security, deploy size,
   routing, migrations, or visible behavior.
7. **Deployment shape.** Inspect Dockerfiles, CI workflows, serverless
   configs (vercel/wrangler/netlify/fly/render/railway), release scripts, and
   runtime version pins. Flag missing production build steps, wrong package
   manager commands, missing migration steps, secrets required at build time
   versus runtime, and local-only assumptions.

## Useful Commands

Adapt to the repository. Never run broad destructive commands.

```bash
git status --short
git ls-files
rg -n --hidden --glob '!node_modules' --glob '!.git' \
  'AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{36}|sk_live_|sk-[A-Za-z0-9]{20,}|xox[baprs]-|AIza[0-9A-Za-z_-]{35}|SG\.[A-Za-z0-9_-]{16,}' .
rg -n --hidden --glob '!node_modules' --glob '!.git' \
  '(DATABASE_URL|JWT_SECRET|SECRET_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|WEBHOOK_SECRET|PASSWORD)=[^"'"'"' ]' .
rg -n --hidden --glob '!node_modules' --glob '!.git' 'TODO|FIXME|HACK|console\.log|debugger|@ts-ignore' .
```

For JavaScript/TypeScript projects, inspect `package.json` scripts first and
run only the relevant existing ones: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`.

## Severity Levels

- **P0 Blocker** — likely secret exposure, data loss, auth bypass, deploy
  failure, broken migration, or user-data corruption.
- **P1 High** — strong launch risk: undocumented required envs, unsafe
  database access, unprotected sensitive routes, failing build or tests,
  tracked build/cache artifacts.
- **P2 Medium** — maintainability or reliability issues that will slow future
  work: stale duplicates, missing focused tests, weak error handling, unused
  dependencies.
- **P3 Low** — cleanup and polish that is not launch-blocking.

## Output Format

Lead with findings ordered by severity. For each finding include severity and
short title, evidence (file:line, command output, or missing expected file),
impact (what breaks or leaks), and the smallest practical fix. Close with:

- **Verified** — commands actually run and their results.
- **Not verified** — checks skipped and why (no git repo, scripts too heavy,
  credentials unavailable).
- **Residual risk** — what the repository shape prevented you from proving
  (e.g., runtime-only behavior, secrets held outside the repo).
