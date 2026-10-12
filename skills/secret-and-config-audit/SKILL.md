---
name: secret-and-config-audit
description: >-
  Scan a repository for likely committed secrets and risky configuration and
  report each lead with file, line, rule and severity while never printing the
  matched value. Reach for this skill when auditing or reviewing a codebase for
  leaked credentials before a release or open-source publication, when triaging
  a "did we commit a key?" question from CI or a security review, when
  inventorying which provider token formats a repo could plausibly contain, or
  when you need a machine-readable (CI-gateable) secret-leak report as JSON.
  It does not validate credentials against a provider, does not scan git
  history or remote branches, does not attempt to decode or use anything it
  finds, and does not repair or remove the secrets it reports.
---

# secret-and-config-audit

Heuristic, redacting scanner for committed secrets and risky configuration in a
directory tree. It reports *leads* — file, line, rule, severity and a masked
shape of the match — and never emits the original value.

## When to use

- Pre-release or pre-publication audit of a repository that will become public.
- A reviewer or CI job asking "does this tree contain a credential-shaped string?".
- Establishing which token formats a codebase is even capable of containing, via `rules`.
- Producing a JSON report an agent or shell script can gate on (`--fail-on`).
- Sanity-checking a newly introduced integration file (CI config, terraform, `.npmrc`).

## When not to use

- Proving a credential is **live**. Nothing here contacts a provider.
- Scanning git history, other branches, or a remote. Only the working tree is read.
- Replacing a dedicated tool such as Gitleaks, TruffleHog or `detect-secrets`.
  Those maintain richer fingerprints and entropy checks.
- Deciding *what* to do about a finding. Rotation and cleanup are human decisions.
- Grepping binary artefacts: binary files are skipped by design, not scanned.

## Requirements

- Node.js >= 20 (uses `node:fs/promises`, `TextDecoder`, `createRequire`).
- No npm dependencies.
- `git` on `PATH` is optional: used for `.gitignore` resolution
  (`git check-ignore --stdin -z`). Without it, a root-`.gitignore` fallback reader is used.

## Output contract

Success (exit `0`) — one line on stdout, nothing on stderr:

```json
{"data":{"root":"/abs/path","files_scanned":12,"files_skipped":3,"bytes_scanned":48213,"findings":[],"counts":{"by_rule":{},"by_severity":{"high":0,"medium":0,"low":0},"placeholder":4},"skipped":{"excluded":2,"extension":1,"gitignored":0,"too_large":0,"binary":0,"unreadable":0,"symlink":1,"other":0},"symlinks":{"count":1,"sample":["escape"]},"placeholders_sample":[{"file":"README.md","line":4,"rule":"github-token","reason":"example"}],"gitignore":{"mode":"git","files_ignored":0},"truncated":false,"exit_recommended":false}}
```

- `findings[]` entries: `{file, line, column, rule, severity, kind, match, evidence}`.
  - `file` is relative to `root`; `line` is 1-based; `column` is 1-based.
  - `severity` is `high` | `medium` | `low`.
  - `match` is the **non-reversible** shape `abcd…wxyz` (first 4 + last 4 characters).
    Values shorter than 12 characters render as `[redacted:too-short]` and are never shown.
  - `evidence` is the source line with the match replaced by `[redacted]`, truncated to 240 characters.
- `counts.placeholder` is the number of matches suppressed as documentation.
  `placeholders_sample[]` shows up to 10 of them with `file`, `line`, `rule`, `reason`.
- `skipped` breaks `files_skipped` down by reason; `gitignore.mode` is
  `git` | `fallback` | `disabled`.
- `exit_recommended` is `true` when at least one `high` finding exists.
- `truncated` is `true` when `--max-files` or `--max-findings` cut the report short.

Failure (exit `1`) — one line on stderr, nothing on stdout:

```json
{"error":"directory not found: ./missing"}
```

- `--help` prints `{"data":{"usage":"..."}}` (exit `0`).
- `--version` prints `{"data":{"name":"@unreadlogs/skill-secret-and-config-audit","version":"0.1.0"}}` (exit `0`).
- With `--fail-on high|medium|low` and a matching finding, the report is still
  printed to stdout as `{"data":...}` but the exit code is `1` and stderr stays
  empty. This is the only case where a successful report accompanies a non-zero exit.

## Commands

| Command | Arguments | Output data |
| --- | --- | --- |
| `scan` | `[dir]` (default `.`), `[--exclude a,b]`, `[--include a,b]`, `[--max-file-bytes N]`, `[--max-files N]`, `[--max-findings N]`, `[--min-severity high\|medium\|low]`, `[--rules a,b]`, `[--no-gitignore]`, `[--fail-on high\|medium\|low\|none]` | the `scan` payload above |
| `rules` | none | `{count, rules:[{id, severity, kind, pattern, false_positives}], placeholders:[...]}` |
| `--help` | — | `{usage}` |
| `--version` | — | `{name, version}` |

Flags in detail:

- `--exclude a,b` — extra comma-separated glob patterns (`*`, `?`, `**`) matched
  against both the file name and the repo-relative path; skipped files count as
  `skipped.excluded`. Added to (never replaces) the built-in directory skip list.
- `--include a,b` — comma-separated globs. A matching file is scanned even when
  its extension is not text-like, **and** a matching directory is traversed even
  when it is in the built-in skip list. This is the escape hatch for `node_modules`,
  but it also means `--include '**/*'` will happily walk a vendor tree.
- `--max-file-bytes N` — files larger than this are skipped as `too_large`
  without being read. Default `1048576`.
- `--max-files N` — only the first N candidate files are scanned; the rest count
  as `excluded` and `truncated` becomes `true`. Default `20000`.
- `--max-findings N` — scanning stops once N findings exist. Default `500`.
- `--min-severity LEVEL` — report only `LEVEL` or worse (`high`, `medium`, `low`).
  Default `low`, i.e. report everything. Placeholders are counted before this filter
  applies, so `counts.placeholder` does not shrink when you raise the bar.
- `--rules a,b` — restrict to specific rule ids; an unknown id is an error.
- `--no-gitignore` — disables `.gitignore` filtering (`gitignore.mode` becomes `disabled`).
- `--fail-on LEVEL` — exit `1` when any finding at `LEVEL` or worse exists
  (`high`, `medium`, `low`, or `none`, the default).

## Rules

23 rules. `kind` groups them; `false_positives` is the honest caveat for each.
`rules` prints the same table at runtime, including the false-positive notes.

| Rule | Severity | Kind | Pattern summary | Typical false positive |
| --- | --- | --- | --- | --- |
| `private-key` | high | private-key | `-----BEGIN [RSA\|DSA\|EC\|OPENSSH\|PGP\|ENCRYPTED] PRIVATE KEY-----` | fixture keys committed for tests |
| `credential-uri` | high | credential-uri | `postgres(ql)://`, `mysql://`, `mongodb+srv://`, `redis://`, `amqp(s)://`, `ftp(s)://`, `sftp://` with `user:pass@` | localhost DSNs, `${VAR}` placeholders |
| `basic-auth-url` | medium | credential-uri | `http(s)://user:password@host` | docs with obvious placeholder users |
| `github-token` | high | provider-token | `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_`, 36+ chars | revoked tokens in changelogs, `...EXAMPLE` |
| `gitlab-token` | high | provider-token | `glpat-` + 20+ chars | none known |
| `slack-token` | high | provider-token | `xoxb`/`xoxa`/`xoxp`/`xoxr`/`xoxs` + 10+ chars | `xoxe-` workspace tokens (not matched) |
| `slack-webhook` | high | provider-token | `hooks.slack.com/services/T…/B…/…` | disabling a webhook does not revoke the URL |
| `stripe-key` | high | provider-token | `sk_live_`/`sk_test_`/`rk_live_`/`rk_test_` + 10+ chars | sandbox keys are still not committable |
| `anthropic-key` | high | provider-token | `sk-ant-` + 20+ chars | none known |
| `openai-key` | high | provider-token | `sk-` (excluding `sk-ant-`) + 20+ chars | other vendors reuse the `sk-` prefix |
| `google-api-key` | high | provider-token | `AIza` + 35 chars | none known (OAuth client secrets are not caught) |
| `sendgrid-key` | high | provider-token | `SG.` + 16+ chars | none known |
| `twilio-key` | high | provider-token | `SK`/`AC` + 32 hex chars | account SIDs are semi-public identifiers |
| `npm-token` | high | provider-token | `npm_` + 36 chars | none known |
| `pypi-token` | high | provider-token | `pypi-AgEIcHlwaS5vcmc` + 50+ chars | none known |
| `shopify-token` | high | provider-token | `shpat_`/`shpca_`/`shppa_`/`shpss_` + 32 hex chars | none known |
| `square-token` | high | provider-token | `sq0atp-`/`sq0csp-`/`EAAA` + 20+ chars | none known |
| `telegram-bot-token` | high | provider-token | 8-10 digit bot id + `:` + 35 chars | numeric log timestamps |
| `aws-access-key` | high | provider-token | `AKIA`/`ASIA`/`ABIA`/`ACCA` + 16 uppercase alnum | key id without its secret is inert but still noise |
| `jwt` | medium | jwt | three base64url segments starting `eyJ` | public/expired/test tokens dominate this class |
| `npmrc-token` | medium | assigned-secret | `_authToken=` / `_auth=` in `.npmrc` | local Verdaccio registries |
| `assigned-secret` | low | assigned-secret | `api_key`, `secret`, `token`, `password`, `credential(s)`, … `[:=]` a 12+ char value | docs prose, JSON Schema constraints |
| `certificate` | low | certificate | `-----BEGIN CERTIFICATE-----` | benign by design: certificates are public |

A value that matches a rule but looks like documentation is **not** reported as a
finding. It is counted in `counts.placeholder` and sampled in `placeholders_sample`.
The placeholder reasons are: `example`, `placeholder`, `redacted`, `changeme`,
`pronoun-prefix`, `your-thing-here`, `x-mask`, `angle-mask`, `shell-expansion`
(`${VAR}`, `$VAR`), `shell-variable`, `env-reference` (`process.env.X`,
`import.meta.env.X`, `os.environ[…]`), `printf-format` (`%s`), `dummy-word`,
`numeric`, and `prose`.

## Limits

| Limit | Default | Flag |
| --- | --- | --- |
| Maximum bytes read per file | `1048576` (1 MB) | `--max-file-bytes` |
| Maximum files scanned | `20000` | `--max-files` |
| Maximum findings returned | `500` | `--max-findings` |
| Minimum reportable severity | `low` | `--min-severity` |
| CI failure threshold | `none` | `--fail-on` |
| Evidence line length | 240 characters | not configurable |
| Revealed characters per match | 4 + 4, masked middle | not configurable |
| Matches per line per rule | 1 (the first) | not configurable |
| Placeholder samples kept | 10 | not configurable |
| Symlink samples kept | 20 | not configurable |
| Binary detection window | first 8192 bytes | not configurable |

Directories skipped by default: `.git`, `.hg`, `.svn`, `.idea`, `.vscode-test`,
`.cache`, `.parcel-cache`, `.turbo`, `.svelte-kit`, `.next`, `.nuxt`, `.output`,
`.vercel`, `.netlify`, `.terraform`, `.gradle`, `.mvn`, `.venv`, `venv`, `env`,
`__pycache__`, `node_modules`, `bower_components`, `vendor`, `Pods`, `target`,
`out`, `dist`, `build`, `coverage`, `.nyc_output`, `.serverless`, `.expo`,
`DerivedData`, `tmp`.

## Examples

Confirm nothing was committed before publishing a package:

```bash
node scripts/index.js scan . --min-severity high --fail-on high
```

Exit `1` with the report on stdout means at least one high-severity lead.

See what the scanner is capable of finding before trusting a clean result:

```bash
node scripts/index.js rules
```

`{"data":{"count":23,"rules":[{"id":"private-key","severity":"high",...}]}}` — every
rule with its severity and its known false positives.

Audit only the files you are about to change, ignoring vendored trees:

```bash
node scripts/index.js scan services/api --exclude '**/*.snap' --min-severity medium
```

`files_skipped.excluded` tells you how many paths the `--exclude` patterns removed.

Triage a noisy report down to one provider and cap the output:

```bash
node scripts/index.js scan . --rules github-token,gitlab-token --max-findings 20
```

Shape of one finding — note that the value itself is absent and the masked shape
cannot be reversed into it:

```json
{
  "file": "src/billing.js",
  "line": 2,
  "column": 18,
  "rule": "stripe-key",
  "severity": "high",
  "kind": "provider-token",
  "match": "sk_l…mnop",
  "evidence": "const stripeKey = '[redacted]';"
}
```

## Notes and limitations

- **This is a heuristic scanner.** A finding is a lead, not proof of a live
  credential; a clean scan is not proof of safety. Regexes cannot tell a real key
  from a 40-character fixture that happens to look like one.
- **Values are never printed.** `match` is first-4 + `…` + last-4. Eight
  characters of a key are not enough to use it, but they are enough to confirm a
  finding by eye — treat stdout as sensitive anyway. Values under 12 characters
  are not shown at all. `evidence` masks the match and truncates the line.
- **False negatives are expected**: secrets split across lines, base64 blobs with
  no keyword, encrypted blobs, and providers without a rule here.
- **False positives are expected**: see the `false_positives` column, and the
  generic `assigned-secret` rule especially, which is `low` severity for a reason.
- **Not scanned**: git history, submodules, packed objects, files whose extension
  is unknown, anything skipped by the directory list, anything ignored by
  `.gitignore` (unless `--no-gitignore`), and every file above `--max-file-bytes`.
- **Symlinks are never followed**, so no symlinked directory can cause infinite
  recursion or pull the scan outside `root`. Symlinks are counted in
  `skipped.symlink` and sampled in `symlinks.sample`.
- **Binary detection** uses a NUL byte in the first 8192 bytes plus a fatal UTF-8
  decode. Valid-UTF-8 binaries are rare, so a misclassification is possible in
  both directions; both outcomes are visible in `skipped.binary`.
- **`.gitignore` resolution** prefers `git check-ignore` (correct, includes nested
  `.gitignore` files and negations). Outside a git work tree, or without `git` on
  `PATH`, only the root `.gitignore` is honoured and negations (`!pattern`) are
  ignored; `gitignore.mode` tells you which path was taken.
- **What to do with a hit**: treat it as compromised. Revoke/rotate at the
  provider first, then remove it from the tree — deleting the file does not remove
  it from git history.

## Troubleshooting

| Symptom | Meaning |
| --- | --- |
| `{"error":"directory not found: …"}` | the path argument does not exist; `scan` requires a directory, not a file. |
| `{"error":"unknown rule id(s): …"}` | typo in `--rules`; run `rules` for the valid ids. |
| `{"error":"--min-severity must be one of high, medium, low"}` | invalid severity; the flag is case-insensitive. |
| `{"error":"--max-files must be an integer, got: …"}` | numeric flags reject units and suffixes. |
| `files_scanned` is 0 | everything was excluded: check `--exclude`, `.gitignore` (try `--no-gitignore`), or the file extensions. |
| `truncated: true` | a `--max-files` / `--max-findings` cap was hit; raise it or narrow with `--rules`. |
| `gitignore.mode` is `fallback` | not a git work tree, or `git` is missing; only the root `.gitignore` was applied. |
| Many `skipped.excluded` / `skipped.too_large` entries | generated or vendored files were pruned; raise `--max-file-bytes` or pass `--include` for a specific tree. |