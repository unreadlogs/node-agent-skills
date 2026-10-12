---
name: json-repair-and-schema
description: >-
  Validate, repair and schema-check JSON and JSONL with explicit, line-accurate
  diagnostics. Use this skill whenever an agent hands back a JSON or JSONL
  payload that may be malformed (trailing commas, single quotes, unquoted keys,
  Python literals, truncated streams), whenever you need to prove a document
  matches a JSON Schema before you trust it, when a model response arrives as
  broken JSON on stdin, or when you need to find which line of a large JSONL
  file is bad without loading the whole file into memory. Repair is best-effort
  and can silently invent data, so this skill always reports before/after hashes
  and proves the repaired text parses. It does not generate schemas, infer
  schemas from examples, fetch remote $ref targets, enforce `format` keywords,
  coerce types, or guarantee that repaired data is correct rather than merely
  parseable.
---

# json-repair-and-schema

Three commands for the boundary between text a model produced and JSON a program
can consume: `validate` (does it parse, does it match), `repair` (best-effort
make it parse, prove it, hash it), `jsonl` (which line is broken).

```bash
node scripts/index.js validate response.json schema.json
node scripts/index.js repair   broken.json fixed.json
node scripts/index.js jsonl    events.jsonl --schema event.schema.json
```

## When to use

- A model, tool, or log produced text that is *almost* JSON: single quotes, unquoted keys, trailing commas, `True/False/None`, `//` comments, a truncated object.
- You need to know whether a document matches a JSON Schema before you act on it, and you need errors with a JSON pointer path, not just "invalid".
- You need to know which **line** of a JSONL file is broken, on a file too large to hold in memory.
- You want to repair a schema folder that uses `"$ref": "./common.json#/$defs/pos"` and have the relative reference resolve.
- You need to prove a repair actually changed something: byte counts and sha256 of the input and the output.
- The payload is arriving on stdin and you do not want to write it to disk first.

## When not to use

- You need to *produce* a schema or infer one from examples: write the schema yourself or use a different tool.
- You need `format` assertions (`email`, `date-time`, `uri`, ...). Ajv treats `format` as an annotation here because `ajv-formats` is not a dependency; a document with `"email": "nope"` passes.
- You need to fetch a remote `$ref` over HTTP. Only schemas that sit next to the schema file (or are already on disk) resolve; this skill never touches the network.
- You need YAML, TOML, XML, CSV or protobuf: convert first.
- You need type coercion (`"36"` to `36`) or default filling. A schema tells you a value is wrong; fixing it is your job.
- You need the repaired data to be *correct*. Repair proves the text parses. That is all it proves.
- You need draft 2019-09/2020-12 features Ajv does not implement (`unevaluatedProperties`, dynamic refs across files, vocabularies). Draft-07 works.

## Requirements

- Node.js >= 20.
- Dependencies already installed in the repository: `ajv` (JSON Schema, draft-07 by default) and `jsonrepair` (best-effort text repair). Nothing is downloaded at run time; this skill makes no network calls.
- No input file is modified. `repair <output.json>` and `jsonl --repair-out` create or overwrite exactly one path that you pass in.

## Output contract

Success (exit code 0, one line of JSON on stdout, nothing on stderr):

```json
{"data": <object described per command below>}
```

Failure (exit code 1, one line of JSON on stderr, nothing on stdout):

```json
{"error": "<human readable message>"}
```

Nothing else is written to stdout or stderr: no banners, no progress logs, no stack traces. `--help` prints `{"data":{"usage":"..."}}` and exits 0. `--version` prints `{"data":{"name":"@unreadlogs/skill-json-repair-and-schema","version":"0.1.0"}}` and exits 0. `-` as the input path reads stdin and is reported as `"input": "<stdin>"`.

### validate

```json
{"data":{"input":"response.json","schema":"schema.json","schema_checked":true,
"schema_siblings":3,"valid":false,"errors":[{"instancePath":"/age",
"schemaPath":"#/properties/age/type","keyword":"type","message":"must be integer",
"params":{"type":"integer"},"summary":"/age must be integer"}],
"error_count":1,"summary":"/age must be integer","bytes":25,"bytes_human":"25 B"}}
```

- Without a schema: `schema` is `null`, `schema_checked` is `false`, and `valid` means only "this text is valid JSON". The top-level `summary` says so.
- Each error entry is `{instancePath, schemaPath, keyword, message, params, summary}`. `instancePath` is a JSON pointer and is `/` (not `""`) for the document root. A parse failure uses `keyword: "json-parse"` and `schemaPath: null`.
- `schema_siblings` is the number of sibling `*.json` files that were registered so that relative `$ref` can resolve.

### repair

```json
{"data":{"input":"broken.json","output":"fixed.json","written":true,"changed":true,
"repairs":[{"code":"unquoted_key","occurrences":2},{"code":"single_quoted_string","occurrences":2},
{"code":"trailing_comma","occurrences":1}],"valid_after_repair":true,"depth":1,
"before":{"bytes":23,"sha256":"b2fb7476..."},"after":{"bytes":26,"sha256":"23487ee9..."}}}
```

- `changed: false` means the input already parsed. `written` is `false` and no file is created or overwritten, even if you named an output path.
- `repairs` lists the defect *classes* jsonrepair most likely fixed, with occurrence counts. It never quotes your data.
- `valid_after_repair` is the result of round-tripping the repaired text through `JSON.parse`. It is `null` under `--no-verify`.
- With no output path, nothing is written to disk and the repaired document is returned inline as `data.value` (never as raw stdout text), so the one-line contract still holds.

### jsonl

```json
{"data":{"input":"events.jsonl","schema":null,"schema_checked":false,"repair_out":null,
"lines":3,"parsed":2,"valid":2,"invalid":1,"unrepairable":0,"repaired_lines":0,
"error_count":1,"errors":[{"line":3,"error":"not valid JSON: Unexpected end of JSON input",
"keyword":"json-parse","data":"{\"a\":","data_truncated":false}],
"truncated":false,"truncated_reason":null,"bytes":25,"bytes_human":"25 B"}}
```

- `lines` counts non-empty lines; `parsed` counts lines that produced a value; `valid` counts lines that passed everything; `invalid` counts failures; `error_count` is `errors.length`.
- `line` is the true 1-based source line, blank lines included, so it matches what an editor shows.
- Each error entry has `error` (one human sentence), `keyword`, an optional `schema_errors` array, and the offending text as `data` (first 200 characters; `data_truncated` says if it was cut).
- `--repair-out` writes valid lines verbatim and broken lines replaced by their repaired text. Lines jsonrepair cannot fix are skipped and counted in `unrepairable`.

## Commands

| Command | Arguments | Output data |
| --- | --- | --- |
| `validate` | `<input\|->` `[schema.json]` `[--schema f]` `[--max-bytes n]` | `input, schema, schema_checked, schema_siblings, valid, errors, error_count, summary, bytes, bytes_human` |
| `repair` | `<input\|->` `[output.json]` `[--no-verify]` `[--max-bytes n]` `[--max-repair-depth n]` | `input, output, written, changed, repairs, valid_after_repair, depth, before, after`, plus `value` when there is no output path |
| `jsonl` | `<input\|->` `[--schema f]` `[--repair-out f]` `[--limit n]` `[--max-errors n]` `[--max-bytes n]` | `input, schema, schema_checked, repair_out, lines, parsed, valid, invalid, unrepairable, repaired_lines, error_count, errors, truncated, truncated_reason, bytes, bytes_human` |

Flag details:

- `--schema <file>` — the schema to check against, equivalent to the positional `validate` argument. Required for schema checking; without it only JSON syntax is checked.
- `--no-verify` — `repair` only. Skips the `JSON.parse` round trip that proves the repaired text is valid, and writes the raw repaired text anyway. `valid_after_repair` becomes `null`.
- `--repair-out <file>` — `jsonl` only. Writes the usable JSONL stream described above.
- `--limit <n>` — `jsonl` only. Maximum non-empty lines to read, 1..100000. Reaching it sets `truncated: true`, `truncated_reason: "max_lines"`.
- `--max-errors <n>` — `jsonl` only. Maximum problems to report, 0..100000. Reaching it sets `truncated_reason: "max_errors"`.
- `--max-bytes <n>` — all three. 1..52428800. Exceeding it is a hard failure (exit 1), never a silent truncation.
- `--max-repair-depth <n>` — `repair` only. 1..100000, default 1000. A repaired document nesting deeper than this is refused and nothing is written.

## Limits

| Limit | Default | Flag | Behaviour when exceeded |
| --- | --- | --- | --- |
| `MAX_BYTES` | 50 MB (52 428 800 bytes) | `--max-bytes` | Hard failure, exit 1, nothing written |
| `MAX_LINES` | 100 000 non-empty lines | `--limit` (`jsonl`) | Reading stops: `truncated: true`, `truncated_reason: "max_lines"` |
| `MAX_ERRORS` | 100 reported problems | `--max-errors` (`jsonl`) | Reading stops: `truncated: true`, `truncated_reason: "max_errors"` |
| `MAX_REPAIR_DEPTH` | 1000 nesting levels | `--max-repair-depth` (`repair`) | Hard failure, exit 1, nothing written |
| Line preview | 200 characters | none | `data` is cut, `data_truncated: true` |

## Examples

Check a model response against a schema and read the failure as a sentence:

```bash
node scripts/index.js validate response.json schema.json
```

`"valid": false` with `errors[0].summary` of `/age must be integer` tells you the exact JSON pointer to fix, and `error_count` tells you whether it is one problem or thirty.

Just prove it parses:

```bash
node scripts/index.js validate - < response.json
```

`"schema_checked": false` and `summary: "the input is valid JSON (no schema was checked)"` — syntax only, and the payload says so instead of pretending a schema ran.

Repair a broken file and keep the proof:

```bash
node scripts/index.js repair broken.json fixed.json
```

`changed: true`, `valid_after_repair: true`, `repairs` naming `unquoted_key`/`single_quoted_string`/`trailing_comma`, and `before.sha256 !== after.sha256` together prove the file was rewritten *and* that the result parses.

Repair straight from a pipe:

```bash
curl -s "$URL" | node scripts/index.js repair -
```

The repaired document comes back as `data.value` in the single stdout line, so you can capture it with `jq .data.value`.

Find the broken line in a big log without loading it:

```bash
node scripts/index.js jsonl events.jsonl --schema event.schema.json
```

`errors[0].line` is the real file line, `errors[0].data` shows the offending text, and `lines`/`parsed`/`valid` tell you whether the damage is one line or the whole tail.

Rebuild a usable JSONL from the salvageable parts:

```bash
node scripts/index.js jsonl events.jsonl --repair-out events.fixed.jsonl
```

`repaired_lines` and `unrepairable` add up to the number of broken lines, so you know exactly how much was salvaged and how much was dropped.

## Notes and limitations

- **Repair can silently change data.** `{"a": "unterminated` becomes `{"a":"unterminated"}`: the missing quote and brace are invented. A successful repair is not evidence that the data is correct, only that it parses. Always run `validate` against a schema afterwards.
- Repair is conservative in one specific way: if the input already parses, it is left alone (`changed: false`, `written: false`, no file created).
- `changed` compares the trimmed input to the trimmed repaired text, so pure whitespace/formatting differences count as `changed: false`.
- `repairs` is a heuristic scan of the *input text* for known defect classes (`unquoted_key`, `single_quoted_string`, `trailing_comma`, `comment`, `python_literal`, `unquoted_value`, `missing_value`, `ellipsis`, `unclosed_bracket`). It is a hint about what was wrong, not a log of what jsonrepair did, and it never contains your values.
- `before`/`after` sha256 hashes are of the exact texts, so you can verify the change independently of this tool.
- Ajv is configured with `strict: false`, `allErrors: true` and `allowUnionTypes: true`: unknown keywords are ignored rather than fatal, every violation is reported, and `["string","null"]` is accepted.
- `format` is not asserted (`ajv-formats` is not installed). Use `pattern`, `minLength` or a real check if you need the constraint enforced.
- Relative `$ref` resolves against the schema file's own directory: every `*.json` file sitting next to the schema is registered under its bare name and its `file://` URL. A `$ref` to a file one directory up, or to `http(s)://`, fails to compile and exits 1.
- Draft-07 is the supported dialect. A 2020-12 `$schema` line is accepted but its vocabulary keywords are not implemented.
- `validate` returns exit code 0 even when the document is invalid: invalid data is a result, not a crash. Exit 1 means the tool could not do its job (missing file, uncompilable schema, unreadable input).
- `jsonl` counts a line as valid only if it parses *and* passes the schema when one is given. Without `--schema`, `valid` just means "parsed".
- Blank lines in a JSONL file are skipped and do not shift the reported line numbers, which always refer to the physical file.
- `jsonl` streams; it never holds more than one line plus the error list in memory. `validate` and `repair` do hold the whole document, bounded by `MAX_BYTES`.

## Troubleshooting

- `the input is not valid JSON: Expected property name or '}' ...` with exit code 0 — the file is broken; run `repair` and then `validate` again.
- `jsonrepair could not repair the input (at position 9): ...` — jsonrepair gave up. Nothing was written. The position is a character offset in the input.
- `the repaired document nests N levels deep, over the N level limit` — jsonrepair closed thousands of brackets for you. Raise `--max-repair-depth` only if you trust the input.
- `the repaired text still does not parse, nothing was written: ...` — jsonrepair produced text that `JSON.parse` rejects. Use `--no-verify` to get the raw text for inspection, or fix the input by hand.
- `schema X could not be compiled: can't resolve reference ./y.json` — the referenced schema is not a `*.json` file in the same directory, or it is not valid JSON. Move it next to the schema or inline it.
- `input not found: X` / `input is not a regular file: X` — bad path. `-` is the only way to read stdin.
- `unexpected argument: ...` — you passed a third positional; run `node scripts/index.js <command> --help`.
- `truncated: true` in `jsonl` — you hit `--limit` or `--max-errors`; the counts in `lines`/`valid`/`invalid` describe only what was examined.
