---
name: streaming-csv-json-normalizer
description: >-
  Inspect, parse, normalize and re-export CSV as JSON without loading it into
  memory, with explicit per-row errors, real source line numbers and honest
  truncation reporting. Use this skill whenever a task hands you a .csv, .tsv
  or pipe-delimited export and you need to profile its shape, turn rows into
  JSON objects for an agent, clean messy columns (trimming, case, blanks,
  duplicates, sorting), cast numbers or booleans on purpose, or write JSON back
  out to CSV. It does not do fuzzy header matching, spreadsheet formula
  evaluation, binary encodings other than UTF-8, database loading, or XLS/XLSX
  parsing, and it never invents a column type: values stay strings unless
  --coerce names them.
---

# streaming-csv-json-normalizer

Streams a delimited text file into row objects, and streams row objects back
out to CSV. Every value is a string unless you explicitly ask for a cast, and
every row-level problem is reported as data rather than as a crash.

```bash
node scripts/index.js inspect  data.csv
node scripts/index.js parse    data.csv --output data.json
node scripts/index.js normalize data.csv --trim --lowercase email --sort name
node scripts/index.js stringify data.json out.csv --columns name,email
```

## When to use

- A file or an export ends in `.csv`, `.tsv`, `.txt`, or is comma/semicolon/tab/pipe separated and you need JSON.
- You need to know a file's shape before committing to it (rows, columns, duplicate or blank headers, ragged rows, empty cells).
- You need row-level errors with source line numbers instead of a parser stack trace.
- You need to clean a messy export: surrounding whitespace, mixed case keys, empty-string cells, over-long values, duplicate rows, unsorted rows.
- You need `007`, `1e3` or `true` to become `7`, `1000` or `true`, and you want the report to prove which columns were cast.
- You need to go back to CSV after an agent edited the JSON, without losing fields that only appear on later rows.
- The CSV is arriving on stdin (`curl ... | node scripts/index.js parse -`).

## When not to use

- The file is XLS/XLSX, ODS, or a PDF table: convert it to CSV first.
- The file is not UTF-8 (latin-1, UTF-16, Shift-JIS): transcode it first; only UTF-8, with or without a BOM, is supported.
- The CSV has more than one table, or the header spans several rows: flatten it first.
- You need spreadsheet semantics: formulas, `001` displayed as a number, locale decimal commas, or type inference from the cell format. This tool has none of that.
- You need fuzzy or approximate header matching, dedup by business key, or schema inference. Those are your code's job, not this tool's.
- You need to load a 200k-row CSV into a database: use `parse --output` and then a real importer.

## Requirements

- Node.js >= 20 (uses `node:stream`, `Buffer.subarray`, `Readable.iterator`).
- Dependencies are already installed in the repository: `csv-parse` (streaming reader) and `csv-stringify` (streaming writer). Nothing is downloaded at run time and this skill never touches the network.
- No input file is modified. `--output` and `stringify <output.csv>` create or overwrite exactly one file, whose path comes from your argument.

## Output contract

Success (exit code 0, one line of JSON on stdout, nothing on stderr):

```json
{"data": <object described per command below>}
```

Failure (exit code 1, one line of JSON on stderr, nothing on stdout):

```json
{"error": "<human readable message>"}
```

Nothing else is ever written to stdout or stderr: no banners, no progress logs, no stack traces. `--help` prints `{"data":{"usage":"..."}}` and exits 0. `--version` prints `{"data":{"name":"@unreadlogs/skill-streaming-csv-json-normalizer","version":"0.1.0"}}` and exits 0.

### inspect

```json
{"data":{"input":"data.csv","bytes":4063232,"bytes_human":"3.9 MB","delimiter":",",
"columns":["id","name","email"],"duplicate_columns":[],"generated_columns":[],
"truncated":false,"truncated_reason":null,"error_count":0,"rows":199998,
"empty_values":12,"ragged_rows":2,"errors":[]}}
```

- `delimiter` is the sniffed character; a tab is reported as the string `"\\t"`.
- `columns` is the de-duplicated header. `duplicate_columns` lists names that appeared more than once, `generated_columns` lists the `column_<n>` placeholders created for blank header cells. `ragged_rows` counts rows whose field count differs from the header, `empty_values` counts cells that are the empty string.
- `rows` is a count here (an array in `parse`/`normalize`).
- `bytes` is the number of bytes actually consumed, not `ls -l`.

### parse

```json
{"data":{"input":"data.csv","bytes":68,"bytes_human":"68 B","delimiter":",",
"columns":["name","email","age"],"duplicate_columns":[],"generated_columns":[],
"ragged_rows":1,"empty_values":0,"truncated":false,"truncated_reason":null,
"error_count":1,"output":"data.json",
"rows":[{"name":"Ada","email":"ada@example.com","age":"36"}],
"errors":[{"line":4,"code":"CSV_RAGGED_ROW","message":"expected 3 fields, got 2",
"expected":3,"got":2,"row":{"name":"Grace","email":"","age":""}}],
"coerced_columns":["age"],"coercion":[{"column":"age","to":"integer","converted":1,"skipped":0,"emptied":0}]}}
```

- `rows` is the array of row objects. `errors` is the array of row problems; each entry has a 1-based `line` counted from the physical file, including the header, so `line: 4` is the fourth line of the file.
- `output` is the path written by `--output`, or `null`.
- `coerced_columns` and `coercion` are only populated by `--coerce`; otherwise both are empty arrays.

### normalize

Same envelope as `parse`, plus `rows_in` and `changes`:

```json
"changes":{"trimmed_values":2,"lowercased_values":2,"empty_values_as":"null",
"truncated_values":0,"duplicates_removed":1,"sorted_by":"name"}
```

`empty_values_as` is `null` unless `--empty-as` was passed; `sorted_by` is `null` unless `--sort` was passed.

### stringify

```json
{"data":{"input":"data.json","output":"out.csv","rows":2,"columns":["name","email","age"],
"delimiter":",","eol":"lf","missing_cells":0,"bytes":65,"bytes_human":"65 B"}}
```

## Commands

| Command | Arguments | Output data |
| --- | --- | --- |
| `inspect` | `<input>` `[--delimiter c]` `[--limit n]` `[--max-errors n]` `[--keep-empty]` | `input, bytes, bytes_human, delimiter, columns, duplicate_columns, generated_columns, ragged_rows, empty_values, truncated, truncated_reason, error_count, rows, errors` |
| `parse` | `<input>` `[--output f]` `[--delimiter c]` `[--limit n]` `[--max-errors n]` `[--coerce cols]` `[--pretty]` `[--keep-empty]` | `input, bytes, bytes_human, delimiter, columns, duplicate_columns, generated_columns, ragged_rows, empty_values, truncated, truncated_reason, error_count, output, rows (array), errors, coerced_columns, coercion` |
| `normalize` | `<input>` `[--output f]` `[--trim]` `[--lowercase cols]` `[--empty-as null\|empty]` `[--max-length n]` `[--dedupe]` `[--sort col]` `[--delimiter c]` `[--limit n]` `[--max-errors n]` `[--pretty]` | `input, bytes, bytes_human, delimiter, columns, duplicate_columns, generated_columns, ragged_rows, empty_values, truncated, truncated_reason, error_count, output, rows_in, rows (array), changes, errors` |
| `stringify` | `<input.json> <output.csv>` `[--columns a,b]` `[--delimiter c]` `[--eol lf\|crlf]` | `input, output, rows, columns, delimiter, eol, missing_cells, bytes, bytes_human` |

Flag details:

- `--delimiter <char>` — exactly one character. Without it, `,` `;` tab `|` are counted outside quotes in the first line and the winner wins (ties go to `,`).
- `--limit <n>` — maximum number of data rows collected, 1..100000. Reaching the limit always sets `truncated: true`.
- `--max-errors <n>` — maximum number of row errors kept, 0..100000. Reaching it stops the scan with `truncated_reason: "max_errors"`.
- `--keep-empty` — treat a blank line as a one-field row instead of skipping it. Such a row is ragged unless the file has exactly one column.
- `--output <file>` — `parse` and `normalize` write the row array (a bare JSON array, plus a trailing newline) to that path. `inspect` rejects `--output`; `stringify` takes its output path as a positional.
- `--coerce <cols>` — comma-separated column names, or nothing to disable. The cast kind (`integer`, `float`, `boolean`) is decided per column by majority over the whole column. Empty cells in a coerced column become `null`. Values that do not match the majority kind stay strings and are counted in `skipped`. An unknown column name is an error.
- `--trim` — trim surrounding whitespace from every value.
- `--lowercase <cols>` — comma-separated column names to lowercase.
- `--empty-as null|empty` — after trimming, an empty value becomes `null` or stays `""`.
- `--max-length <n>` — truncate any value longer than `n` characters.
- `--dedupe` — drop rows whose key/value list is identical to a row already kept.
- `--sort <col>` — sort ascending; numeric when both values are numbers, otherwise `localeCompare` with numeric collation. `null` sorts last.
- `--columns a,b` — `stringify` only. Explicit column order. A column no record has is an error; a record missing some columns contributes `missing_cells` and empty cells.
- `--eol lf|crlf` — `stringify` only, `\n` or `\r\n`.
- `--pretty` — 2-space indented JSON in the `--output` file. stdout is always one compact line.

## Limits

| Limit | Default | Flag | Behaviour when exceeded |
| --- | --- | --- | --- |
| `MAX_BYTES` | 50 MB (52 428 800 bytes) | none, not configurable | `inspect`/`parse`/`normalize` fail with exit 1 before reading anything; the streaming guard also stops mid-read if a growing file crosses it (`truncated_reason: "max_bytes"`) |
| `MAX_ROWS` | 100 000 data rows | `--limit` | Reading stops; `truncated: true`, `truncated_reason: "max_rows"` |
| `MAX_ERRORS` | 100 row errors | `--max-errors` | Reading stops; `truncated: true`, `truncated_reason: "max_errors"` |
| `SNIFF_BYTES` | 64 KB of head | none | Only used to guess the delimiter |
| `stringify` input size | 50 MB | none | Fails with exit 1 |

Every partial result carries `truncated: true` and a `truncated_reason` of `max_rows`, `max_errors`, `max_bytes` or `parse_error`. A dataset is never silently cut short.

## Examples

Profile a file before you trust it:

```bash
node scripts/index.js inspect exports/customers.csv
```

`rows` tells you how much you are dealing with, `duplicate_columns` and `generated_columns` tell you the header needed repair, `ragged_rows` tells you the file is inconsistent, `truncated` tells you whether you saw all of it.

Turn it into JSON and see the ragged rows with their real line numbers:

```bash
node scripts/index.js parse exports/customers.csv --output customers.json --pretty
```

```json
{"data":{"input":"exports/customers.csv","bytes":68,"bytes_human":"68 B","delimiter":",",
"columns":["name","email"],"duplicate_columns":[],"generated_columns":[],
"ragged_rows":1,"empty_values":0,"truncated":false,"truncated_reason":null,
"error_count":1,"output":"customers.json",
"rows":[{"name":"Ada","email":"ada@example.com"},{"name":"Grace","email":"grace@example.com"}],
"errors":[{"line":4,"code":"CSV_RAGGED_ROW","message":"expected 2 fields, got 1",
"expected":2,"got":1,"row":{"name":",,","email":""}}],
"coerced_columns":[],"coercion":[]}}
```

Exit code 0 even though a row was malformed: the file is written and the problems are in `data.errors` with the line number you can open in an editor.

Clean it up without changing anything you did not ask about:

```bash
node scripts/index.js normalize exports/customers.csv --trim --lowercase email \
  --empty-as null --dedupe --sort name --output customers.clean.json
```

`data.changes` counts exactly what moved (`trimmed_values`, `lowercased_values`, `duplicates_removed`, `sorted_by`); if it is all zero, the file was already clean.

Cast a column on purpose:

```bash
node scripts/index.js parse orders.csv --coerce total --pretty
```

`coercion: [{"column":"total","to":"float","converted":812,"skipped":3,"emptied":0}]` tells you the column became numbers and that 3 cells did not match the majority kind and stayed strings. `"007"` is only ever a number if you name that column.

Pipe an export straight in and go straight back out:

```bash
curl -s 'https://example.internal/export.csv' | node scripts/index.js parse - --output out.json
node scripts/index.js stringify out.json roundtrip.csv --eol crlf
```

`missing_cells: 0` proves the round trip lost nothing; a non-zero value means some record did not have a key that later records introduced.

## Notes and limitations

- **Values are always strings.** `"007"` stays `"007"`, `"1e3"` stays `"1e3"`, `"TRUE"` stays `"TRUE"`. `--coerce` is the only thing that casts, and it reports what it cast.
- The first non-empty line is always the header. There is no `--no-header`.
- Blank header cells become `column_1`, `column_2`, ... by 1-based field position. Repeated names become `name`, `name_2`, `name_3`, ... Both are reported in `inspect`; the original header text is never recovered, because the file does not contain it.
- Header names are trimmed of surrounding whitespace before comparison, so `"email "` and `"email"` collide and become `email` and `email_2`.
- Ragged rows are padded with `""` or truncated to the header width, and every one is listed in `errors`. Extra fields on a long row are dropped: their content is in the `row` preview of the error entry, but not in `rows`.
- Delimiter sniffing looks at the first line only and counts only unquoted characters. A file whose first line has no delimiter at all falls back to `,`.
- `rtrim` is on: trailing whitespace outside quotes is dropped from every field. Leading whitespace is preserved unless `--trim` is used.
- Quoting follows RFC 4180. An unclosed quote, or a stray quote in the middle of an unquoted field, is a hard parse error: rows parsed so far are still returned, with `truncated_reason: "parse_error"` and the parser's own message in `errors`.
- `bytes` counts bytes consumed from the input, so on a truncated run it is smaller than the file size on disk.
- `stringify` writes `null` and `undefined` as an empty cell and objects/arrays as JSON text (`{"x":[1,2]}`), which is not reversible to the original shape.
- `stringify` unions the keys of all records in first-seen order, so later records never silently lose a field, but a 10 000-key union is still a 10 000-column CSV.
- Nothing is sorted, deduplicated or deduplicated-by-key implicitly. `--dedupe` is exact whole-row equality only.

## Troubleshooting

- `input not found: x.csv` / `input is not a regular file` — the path is wrong or is a directory/FIFO. `-` is the only way to read stdin.
- `input is 52.0 MB which exceeds the 50.0 MB limit` — the file is over the hard byte guard. Split it or raise your own limits by chunking.
- `columns` contains `column_4` and you expected `date` — that header cell was blank, so the name could not be recovered.
- Every row is `CSV_RAGGED_ROW` — the file uses a delimiter that is not `, ; tab |`. Pass `--delimiter '|'` (or whatever it is).
- `unknown command: ...` or `unexpected argument: ...` — you are past the flags; run `node scripts/index.js <command> --help`.
- `--coerce names a column that is not in the file: total` — check `inspect`'s `columns` array; the header cell was blank or renamed to `column_n`.
- `truncated: true` with `truncated_reason: "max_rows"` — the file is bigger than `--limit`; raise it or narrow the query upstream.
