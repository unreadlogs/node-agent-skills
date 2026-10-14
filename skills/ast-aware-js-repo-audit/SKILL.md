---
name: ast-aware-js-repo-audit
description: >-
  Run ESLint's parser and rule engine over JavaScript and TypeScript files, then
  return structured findings with file locations. Use when an agent needs a
  focused static lint pass or machine-readable diagnostics. This reports only;
  it does not fix files, type-check, or run application code.
---

# JavaScript repository audit

Run the skill from this directory or invoke its `scripts/index.js` by absolute
path. It uses ESLint's Node API and writes one JSON object to stdout. Errors use
one JSON object on stderr and exit code 1.

```sh
node scripts/index.js lint src
node scripts/index.js lint src/index.js test/ --format json
node scripts/index.js lint src --config eslint.config.js
```

## Choose scope and configuration

Pass one or more paths or ESLint globs. Prefer the changed source paths for a
small review; use `.` when a repository-wide pass is intended. ESLint applies
its normal ignore behavior. Run from the repository root so config discovery
and relative paths mean what the project expects.

Without `--config`, this tool disables ambient config discovery and applies a
small built-in set of correctness rules: unreachable code, duplicate keys and
cases, unsafe negation, constant conditions, `debugger`, suspicious `typeof`,
and unused variables. This keeps a no-config run meaningful and predictable.
It is not a substitute for a project's own ESLint configuration. Supply
`--config <path>` to use the repository's ESLint config; that config owns the
rule set. ESLint 9 flat config is expected by the bundled dependency.

TypeScript syntax can be parsed only when a compatible parser is configured.
This tool does not install TypeScript parsers or plugins and does not infer
types. If a TS path fails parsing, use the project's configured parser or limit
the audit to JavaScript.

## Read the result

Successful output has this shape:

```json
{"data":{"targets":["src"],"files":2,"errorCount":1,"warningCount":1,
"findings":[{"file":"/repo/src/app.js","line":4,"column":1,"endLine":4,
"endColumn":8,"severity":2,"ruleId":"no-debugger","message":"Unexpected 'debugger' statement."}]}}
```

`severity` is ESLint's numeric value (`2` error, `1` warning); `ruleId` can be
`null` for parser/configuration diagnostics. Location end fields can also be
null. `files` counts lint results, including files with no findings. A clean
report is not proof of type safety, runtime correctness, security, or that every
relevant file was included.

The process exits 0 when lint completes, even if findings have severity 2. Use
`errorCount` and `warningCount` to decide whether to block a workflow. Exit 1
means the command or ESLint execution failed, not that lint findings exist.

## Agent workflow

1. Establish the repository root and inspect its ESLint config and package
   scripts before selecting the default rules or project config.
2. Run the narrowest useful path set. For a user-requested repository audit,
   use the repository's own config if present.
3. Triage findings by file, line, and rule. Inspect surrounding code before
   proposing a fix; a lint message is evidence to investigate, not an automatic
   license to edit.
4. If asked to fix findings, make focused edits and rerun the same command. Say
   which scope and config were used, and call out skipped TypeScript support or
   ignored paths.

## CLI

```text
lint <path-or-glob...> [--config <path>] [--format json]
```

Only `json` is accepted for `--format`; it pretty-prints the same JSON shape.
Unknown flags, missing targets, and unsupported formats are errors. The skill
does not shell out to the `eslint` executable, modify source files, or run
project scripts.
