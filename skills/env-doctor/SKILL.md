---
name: env-doctor
description: >-
  Diagnose a Node project that will not start, install or behave in CI, by
  reporting package-manager conflicts, unmet engine ranges, broken entry
  points and scripts, and by reconciling documented environment variables
  against the variables the source actually reads — printing variable names and
  whether each is set, empty or unset, never values. Reach for this skill when
  asked why a repo fails on a fresh clone or in CI, when reconciling `.env`
  documentation with `process.env` usage, when onboarding onto an unfamiliar
  Node repository, or when auditing `packageManager`, lockfiles, `engines` and
  npm scripts for the problems that break installs. It does not run the build
  or the tests, does not install dependencies, does not modify any file, and
  does not reveal secret values.
---

# env-doctor

Static diagnostics for a Node project: runtime, package metadata, scripts,
workspaces and environment-variable reconciliation, emitted as one JSON object
with severity-tagged findings.

## When to use

- "Why does this repo work on my machine but not on a fresh clone or in CI?"
- Reconciling `.env.example` against what the source actually reads
  (`process.env.X`, `process.env['X']`, `import.meta.env.X`, `Deno.env.get`).
- Auditing `packageManager`, lockfiles, `engines.node`, `main`/`exports`/`bin`
  targets and `scripts` before publishing or onboarding a team.
- Getting a machine-readable health report for CI (`--fail-on`, `--json-summary`).
- Checking that a required variable is actually present before running something.

## When not to use

- Installing dependencies, building, or running the test suite. This tool only reads.
- Non-Node projects (no `package.json` means `NO_PACKAGE_JSON`, not a verdict).
- Discovering which variable holds *which* value. Values are never emitted.
- Reading secrets out of `.env` files; only variable names are reported.
- Replacing a linter, type-checker, or `npm doctor`.

## Requirements

- Node.js >= 20.
- One dependency: `semver` (already declared in this skill's `package.json`),
  used only to evaluate `engines.node` ranges.

## Output contract

Success (exit `0`) — one line on stdout, nothing on stderr:

```json
{"data":{"project":"/abs/path","node":{"version":"24.21.0","major":24,"lts":"Krypton","satisfies_engines":true,"engines_node":">=20","version_files":[".nvmrc"]},"package":{"name":"tiny","version":"1.0.0","type":"module","license":"MIT","private":false,"package_manager":"npm","package_manager_version":null,"lockfiles":["package-lock.json"],"dependencies_declared":0,"entrypoints":["exports=./src/index.js"]},"scripts":{"names":["test"],"count":1,"dangling_references":[],"failure_swallowing":[]},"env":{"documented":["LOG_LEVEL"],"required_by_source":["LOG_LEVEL"],"missing":[],"unused_documented":[],"empty":[],"unset":[],"example_files":[".env.example"],"source_files_scanned":1,"source_files_matched":1,"source_scan_truncated":false,"state":{"LOG_LEVEL":"set"}},"workspace":{"declared":[],"matched":[],"unmatched":[]},"files":{"gitignore":true,"env_file_present":false},"findings":[],"summary":{"errors":0,"warnings":0,"infos":0,"passed":6}}}
```

Field notes:

- `node.lts` is the release codename (`Iron`, `Jod`, `Krypton`), or
  `lts-line-<major>` for an even major >= 20 whose codename this build predates,
  or `null` for an odd major or major < 20.
- `package.package_manager` is the `packageManager` field when present, otherwise
  the manager implied by the first lockfile found, otherwise `null`.
- `env.state` maps each required variable to `set` | `empty` | `unset`.
  `env.missing` is the union of `env.empty` and `env.unset` — a variable that is
  set to `""` is *missing* but is reported as **empty**, not **unset**.
- `env.required_by_source` only includes variables found in scanned source files;
  `--env-names` adds to `missing`/`unset`/`state` without appearing there.
- `summary.passed` counts diagnostic groups (`package`, `node`, `scripts`, `env`,
  `workspace`, `files`) with zero `error`-severity findings.
- Every finding is `{code, severity, message, evidence}` where `evidence` is a
  path, a script name, a workspace glob or a variable **name** — never a value.

`env` command payload: `{project, env, findings, summary}` — only `ENV_*` findings.

`--json-summary` payload: `{project, summary, findings:[{code, severity}]}`.

Failure (exit `1`) — one line on stderr, nothing on stdout:

```json
{"error":"directory not found: ./missing"}
```

- `--help` prints `{"data":{"usage":"..."}}` (exit `0`).
- `--version` prints `{"data":{"name":"@unreadlogs/skill-env-doctor","version":"0.1.0"}}` (exit `0`).
- With `--fail-on error|warning` and a matching finding, the report is still
  printed to stdout as `{"data":...}` but the exit code is `1` and stderr stays
  empty. This is the only case where a successful report accompanies a non-zero exit.

## Commands

| Command | Arguments | Output data |
| --- | --- | --- |
| `check` | `[dir]` (default `.`), `[--env-names a,b,c]`, `[--fail-on error\|warning\|none]`, `[--json-summary]`, `[--max-source-files N]`, `[--max-source-bytes N]`, `[--max-total-source-bytes N]` | the full `check` payload above |
| `env` | `[dir]`, plus the same flags as `check` | `{project, env, findings, summary}`; only `ENV_*` findings, and `summary.passed` counts the single `env` group |
| `--help` | — | `{usage}` |
| `--version` | — | `{name, version}` |

Flags in detail:

- `--env-names a,b,c` — treat these variable names as required even if they
  appear in no example file and in no source. Each must match `[A-Za-z_][A-Za-z0-9_]*`.
- `--fail-on error|warning|none` — exit `1` when any finding at that severity or
  worse exists. Default `none` (always exit `0` on a completed check).
- `--json-summary` — print only `project`, `summary` and `{code, severity}` pairs.
- `--max-source-files N` — source files considered when scanning for env access. Default `2000`.
- `--max-source-bytes N` — per-source-file byte cap; larger files are skipped. Default `524288`.
- `--max-total-source-bytes N` — total source bytes read before the scan stops. Default `8388608`.

## Checks

Severity: `error` = broken or dangerous, `warning` = will bite, `info` = worth knowing.

| Code | Severity | Trigger |
| --- | --- | --- |
| `NO_PACKAGE_JSON` | error | no `package.json` in the directory |
| `INVALID_PACKAGE_JSON` | error | `package.json` is not parseable JSON |
| `PACKAGE_NAME_MISSING` | error (warning if `private: true`) | no `name` field |
| `PACKAGE_VERSION_MISSING` | warning | no `version` field |
| `PACKAGE_LICENSE_MISSING` | warning | non-private package with no `license` |
| `PACKAGE_TYPE_MISSING` | warning | no `type` field, so `.js` defaults to CommonJS |
| `PACKAGE_ENTRY_MISSING` | warning | non-private package with neither `main` nor `exports` |
| `PACKAGE_MANAGER_INVALID` | error | `packageManager` is present but not a string |
| `PACKAGE_MANAGER_UNKNOWN` | error | `packageManager` names a manager outside npm/pnpm/yarn/bun/deno/cnpm |
| `PACKAGE_MANAGER_MISMATCH` | warning | `packageManager` disagrees with the lockfile present |
| `NO_LOCKFILE` | info | none of the known lockfiles exist |
| `LOCKFILE_CONFLICT` | error | lockfiles from more than one package manager |
| `ENTRYPOINT_MISSING` | error | `main`, `module`, `types`, `bin`, `bin.<name>` or an `exports` target does not exist on disk |
| `DEPENDENCIES_NOT_INSTALLED` | warning | `dependencies`/`devDependencies` declared but `node_modules` absent |
| `ENGINE_NODE_UNSATISFIED` | error | running Node does not satisfy `engines.node` |
| `ENGINE_RANGE_INVALID` | warning | `engines.node` is not a valid semver range |
| `NODE_VERSION_SKEW` | warning | running major is below the minimum the range allows |
| `ENGINE_VERSION_FILE_MISSING` | warning | `engines.node` declared but no `.nvmrc`, `.node-version`, `.tool-versions` or `mise.toml` |
| `SCRIPT_REFERENCE_MISSING` | error | a script runs `npm run X` / `yarn X` / `run-script X` and `X` is not a script |
| `SCRIPT_SWALLOWS_FAILURE` | warning | a script contains `\|\| true`, `\|\| :`, `\|\| exit 0`, `; exit 0` or `; true` |
| `SCRIPT_TEST_MISSING` | warning | `scripts.build` exists but `scripts.test` does not |
| `SCRIPT_NONE` | info | `package.json` declares no scripts |
| `WORKSPACE_GLOB_UNMATCHED` | error | a `workspaces` glob matches no directory |
| `WORKSPACE_NONE_MATCHED` | error | no `workspaces` glob matched anything |
| `GITIGNORE_MISSING` | error | no `.gitignore` in the project root |
| `GITIGNORE_MISSING_NODE_MODULES` | error | `.gitignore` does not cover `node_modules` |
| `ENV_NOT_IGNORED` | error | `.env` exists and the `.gitignore` does not exclude it |
| `ENV_NO_EXAMPLE` | warning if `.env` exists, otherwise info | no `.env.example` / `.env.sample` / `.env.template` / `env.example` / `config/.env.example` |
| `ENV_USED_UNDOCUMENTED` | warning | variable read by source but documented nowhere |
| `ENV_DOCUMENTED_UNUSED` | info | variable documented but never read by scanned source |
| `ENV_UNSET` | warning | required variable is absent from the current environment |
| `ENV_EMPTY` | info | required variable is set but `""` |
| `ENV_SOURCE_SCAN_TRUNCATED` | info | a source-scan cap was hit, so usage may be incomplete |
| `ENV_NO_SOURCE_USAGE` | info | no `process.env` / `import.meta.env` read found in scanned files |

## Limits

| Limit | Default | Flag |
| --- | --- | --- |
| Source files scanned for env access | `2000` | `--max-source-files` |
| Bytes read per source file | `524288` (512 KB) | `--max-source-bytes` |
| Total source bytes read | `8388608` (8 MB) | `--max-total-source-bytes` |
| CI failure threshold | `none` | `--fail-on` |
| Example files searched | `.env.example`, `.env.sample`, `.env.template`, `env.example`, `config/.env.example` | not configurable |
| Source extensions scanned | `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.mts`, `.cts`, `.vue`, `.svelte` | not configurable |
| Source directories skipped | `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `.venv`, `venv`, `__pycache__`, `vendor`, `target`, `Pods`, `.idea`, `.output` | not configurable |
| Hitting a source cap | sets `env.source_scan_truncated` and emits `ENV_SOURCE_SCAN_TRUNCATED` | — |

Non-text files (`README.md`, `Dockerfile`, YAML config) are not scanned for
`process.env` usage. Scripts bodies are parsed for `npm run` references and
failure-masking patterns only; they are never executed.

## Examples

Full diagnostic pass over a repository:

```bash
node scripts/index.js check .
```

`findings[]` carries one `{code, severity, message, evidence}` per problem and
`summary` gives the counts; `summary.passed` tells you how many of the six
diagnostic groups are error-free.

Reconcile environment variables only — the question agents ask most often:

```bash
node scripts/index.js env . --env-names REDIS_URL
```

`env.missing`, `env.unset`, `env.empty` and `env.unused_documented` tell you what
is required but absent, required but blank, and documented but never read.

Gate CI on real breakage:

```bash
node scripts/index.js check . --fail-on error
```

Exit `1` with the full report on stdout and an empty stderr when any `error`
finding exists; exit `0` otherwise.

Compact machine-readable result for a bot:

```bash
node scripts/index.js check . --json-summary
```

`{"data":{"project":"…","summary":{"errors":2,"warnings":5,"infos":1,"passed":4},"findings":[{"code":"LOCKFILE_CONFLICT","severity":"error"}]}}` —
codes only, no messages, no paths.

Check one variable before starting a server:

```bash
node scripts/index.js env . --env-names DATABASE_URL | grep -o '"DATABASE_URL":"[a-z]*"'
```

Yields `set`, `empty` or `unset`; the value is never in the output.

## Notes and limitations

- **Values are never printed.** Only names, paths and `set`/`empty`/`unset` state
  appear. `env.state` is safe to paste into an issue; a variable's value is not.
- **"Required" means required by something observable**: an example file, a
  `process.env` read in scanned source, or `--env-names`. A variable read only at
  runtime through `process.env[name]` with a computed key is invisible here, and
  so is anything read from a source file that was skipped by a limit or by the
  extension list.
- **`.env.example` parsing is line based**: it accepts `export FOO=bar`, quoted
  values and lowercase names, and skips comments and lines that are not
  assignments. `KEY[0]=v` (phpdotenv array syntax) and multi-line values are not
  fully understood.
- **`.gitignore` handling is a small subset** (literal names, `dir/`, `**/name`,
  and simple globs); negations (`!pattern`) and nested `.gitignore` files are
  ignored. `git check-ignore` is deliberately not shelled out to here, so
  `ENV_NOT_IGNORED` can be a false positive on an exotic ignore setup — verify
  before acting.
- **Script analysis is textual**: it sees `npm run X` and `|| true`, not what the
  command ultimately does. A script that swallows failure through a shell helper
  is not detected.
- **Workspace globs** support `*`, `**` and `?` and are matched against directory
  paths; they are not a full npm/yarn workspace resolver.
- **`ENGINES` vs reality**: only `engines.node` is evaluated, against the Node
  running this tool, not the Node you will deploy with.
- **Nothing is modified and nothing is installed.** `DEPENDENCIES_NOT_INSTALLED`
  is a statement about the current checkout, not a defect in the repository.

## Troubleshooting

| Symptom | Meaning |
| --- | --- |
| `{"error":"directory not found: …"}` | bad path argument; `check` and `env` require an existing directory. |
| `NO_PACKAGE_JSON` everywhere | you pointed at a subdirectory; run the command at the repository root. |
| `INVALID_PACKAGE_JSON` | a trailing comma or comment in `package.json`; the message includes the parser error. |
| `LOCKFILE_CONFLICT` | more than one manager's lockfile is committed; delete the stale ones, keeping the one your `packageManager` names. |
| `PACKAGE_MANAGER_MISMATCH` on a monorepo | the `packageManager` field disagrees with the lockfile — usually a partially migrated repo. |
| `ENV_UNSET` for something you exported | the check ran in a different process; `check` reads *this* process's environment, so pass `--env-names` when auditing a target deployment. |
| `ENV_EMPTY` for a variable you set | it is set to the empty string; that is not the same as unset for most libraries. |
| `ENV_SOURCE_SCAN_TRUNCATED` | raise `--max-source-files` / `--max-total-source-bytes`, or point the command at a smaller subtree. |
| `ENV_USED_UNDOCUMENTED` in a generated file | add the generated path to your ignore list, or document the variable in `.env.example`. |