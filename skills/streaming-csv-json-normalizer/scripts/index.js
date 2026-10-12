#!/usr/bin/env node

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import {
  boolFlag,
  enumFlag,
  fail,
  formatBytes,
  intFlag,
  listFlag,
  parseArgs,
  printData,
  stringFlag,
} from './lib/cli.js';

const require = createRequire(import.meta.url);
const { name: PACKAGE_NAME, version: VERSION } = require('../package.json');

/** Hard guard on bytes pulled out of the input stream. Not configurable. */
const MAX_BYTES = 50 * 1024 * 1024;
/** Default number of data rows (header excluded) collected by a read command. */
const MAX_ROWS = 100_000;
/** Default number of row-level errors kept before the scan gives up. */
const MAX_ERRORS = 100;
/** Bytes of the input inspected to guess the delimiter. */
const SNIFF_BYTES = 64 * 1024;
/** Delimiters the sniffer considers; ties fall back to this order. */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

const USAGE = `Usage: node scripts/index.js <command> [arguments] [flags]

Commands:
  inspect <input>                      Profile a CSV file (shape, no record dump)
  parse <input> [--output f]           Rows as JSON, with per-row errors
  normalize <input> [--output f]       Explicit, opt-in cleaning of rows
  stringify <input.json> <output.csv>  JSON array of objects -> CSV

inspect, parse and normalize accept "-" as <input> to read from stdin.
Every command accepts --help and --version.`;

const COMMAND_USAGE = {
  inspect: `Usage: node scripts/index.js inspect <input>

Profiles the file: byte size, delimiter, row count, column names, duplicate and
generated column names, empty values, ragged rows and row errors. No rows are
printed and there is no --output flag.

Flags:
  --delimiter <char>  Force a delimiter instead of sniffing (, ; tab |)
  --limit <n>         Stop after n data rows (default ${MAX_ROWS})
  --max-errors <n>    Stop after n row errors (default ${MAX_ERRORS})
  --keep-empty        Treat blank lines as rows instead of skipping them`,
  parse: `Usage: node scripts/index.js parse <input> [--output <file.json>]

Prints every row as an object under data.rows and every problem under
data.errors, each with a 1-based source line number. --output writes the same
rows as a bare JSON array (an array of row objects), which is the array the
stringify command consumes.

Flags:
  --delimiter <char>  Force a delimiter instead of sniffing (, ; tab |)
  --limit <n>         Stop after n data rows (default ${MAX_ROWS})
  --max-errors <n>    Stop after n row errors (default ${MAX_ERRORS})
  --coerce <cols>     Comma-separated columns to cast to integer/float/boolean
  --pretty            Pretty-print the file written by --output
  --keep-empty        Keep blank lines as empty rows instead of skipping them`,
  normalize: `Usage: node scripts/index.js normalize <input> [--output <file.json>]

Cleaning is opt-in: nothing changes unless a flag asks for it. Every change is
counted under data.changes.

Flags:
  --delimiter <char>  Force a delimiter instead of sniffing (, ; tab |)
  --trim              Trim surrounding whitespace from every value
  --lowercase <cols>  Comma-separated columns to lowercase
  --empty-as <mode>   "null" turns empty values into null, "empty" keeps ""
  --max-length <n>    Truncate values longer than n characters
  --dedupe            Drop rows that are exact duplicates
  --sort <col>        Sort rows by a column
  --limit <n>         Stop after n data rows (default ${MAX_ROWS})
  --max-errors <n>    Stop after n row errors (default ${MAX_ERRORS})
  --pretty            Pretty-print the file written by --output`,
  stringify: `Usage: node scripts/index.js stringify <input.json> <output.csv>

Reads a JSON array of objects and writes CSV. Columns default to the union of
every key of every record in first-seen order, so no field is silently dropped.
Objects and arrays are written as JSON text.

Flags:
  --columns <a,b,c>   Column order (default: union of every key, first seen)
  --delimiter <char>  Output delimiter (default ,)
  --eol <lf|crlf>     Line ending (default lf)`,
};

const INTEGER_PATTERN = /^[+-]?\d+$/;
const FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN_VALUES = new Map([
  ['true', true],
  ['false', false],
  ['yes', true],
  ['no', false],
  ['1', true],
  ['0', false],
]);

/** Raised by the byte guard inside the source generator; never a hard failure. */
class ByteLimitError extends Error {
  constructor() {
    super('input exceeds the byte limit');
    this.name = 'ByteLimitError';
  }
}

function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
}

function requirePositional(positionals, count, usage) {
  if (positionals.length < count) throw new Error(usage);
}

function rejectExtraPositionals(positionals, allowed) {
  if (positionals.length > allowed) {
    throw new Error(`unexpected argument: ${positionals[allowed]}`);
  }
}

function readDelimiterFlag(flags) {
  const raw = stringFlag(flags, 'delimiter');
  if (raw === null) return null;
  if (raw.length !== 1) {
    throw new Error(`--delimiter must be a single character, got: ${raw}`);
  }
  return raw;
}

function readRowLimits(flags) {
  return {
    limit: intFlag(flags, 'limit', MAX_ROWS, { min: 1, max: MAX_ROWS }),
    maxErrors: intFlag(flags, 'max-errors', MAX_ERRORS, { min: 0, max: 100_000 }),
    keepEmpty: boolFlag(flags, 'keep-empty', false),
  };
}

function describeDelimiter(delimiter) {
  return delimiter === '\t' ? '\\t' : delimiter;
}

async function assertReadableInput(input) {
  if (input === '-') return null;
  const stat = await fsPromises.stat(input).catch(() => null);
  if (stat === null) throw new Error(`input not found: ${input}`);
  if (!stat.isFile()) throw new Error(`input is not a regular file: ${input}`);
  if (stat.size > MAX_BYTES) {
    throw new Error(
      `input is ${formatBytes(stat.size)} which exceeds the ${formatBytes(MAX_BYTES)} limit`,
    );
  }
  return stat;
}

/**
 * Reads the head of a stream so the delimiter can be sniffed. The peeked
 * buffers are returned so they can be replayed into the parser: the file is
 * never buffered whole and the parse still starts at offset 0.
 */
async function peekStream(stream, maxBytes) {
  const iterator = stream.iterator({ destroyOnReturn: false });
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const next = await iterator.next();
    if (next.done) {
      return { prefix: Buffer.concat(chunks), iterator, ended: true };
    }
    const chunk = toBuffer(next.value);
    chunks.push(chunk);
    bytes += chunk.length;
    if (bytes >= maxBytes) return { prefix: Buffer.concat(chunks), iterator, ended: false };
  }
}

/**
 * Counts candidates outside quotes in the first line and returns the most
 * frequent one. Ties fall back to the CANDIDATE_DELIMITERS order.
 */
function sniffDelimiter(text) {
  const counts = new Map(CANDIDATE_DELIMITERS.map((char) => [char, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) continue;
    if (char === '\n' || char === '\r') break;
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  let best = CANDIDATE_DELIMITERS[0];
  let bestCount = 0;
  for (const char of CANDIDATE_DELIMITERS) {
    const count = counts.get(char);
    if (count > bestCount) {
      best = char;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Opens a bounded, byte-accounted Readable over the input. Throws
 * ByteLimitError from inside the generator once the guard is crossed; the
 * scanner turns that into a truncation report.
 */
async function openSource(input, forcedDelimiter) {
  const stream = input === '-' ? process.stdin : fs.createReadStream(input, {
    highWaterMark: 64 * 1024,
  });
  const { prefix, iterator, ended } = await peekStream(stream, SNIFF_BYTES);
  const head = prefix.subarray(0, SNIFF_BYTES).toString('utf8');
  const delimiter = forcedDelimiter ?? sniffDelimiter(head);
  if (ended) return { source: Readable.from([prefix]), delimiter };

  async function* bounded() {
    let bytes = prefix.length;
    if (bytes > MAX_BYTES) throw new ByteLimitError();
    yield prefix;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const chunk = toBuffer(next.value);
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new ByteLimitError();
      yield chunk;
    }
  }

  return { source: Readable.from(bounded()), delimiter };
}

/**
 * Unique, non-empty column names for the raw header record. Blank names become
 * `column_<n>` (1-based field index) and repeats get a `_2`, `_3`, ... suffix,
 * because csv-parse would otherwise mangle them silently.
 */
function buildHeader(rawNames) {
  const names = [];
  const duplicates = [];
  const generated = [];
  const seen = new Map();
  rawNames.forEach((raw, index) => {
    const cleaned = String(raw).replace(/^\uFEFF/, '').trim();
    if (cleaned === '') {
      generated.push(`column_${index + 1}`);
      names.push(`column_${index + 1}`);
      return;
    }
    const count = (seen.get(cleaned) ?? 0) + 1;
    seen.set(cleaned, count);
    if (count > 1) {
      duplicates.push(cleaned);
      names.push(`${cleaned}_${count}`);
      return;
    }
    names.push(cleaned);
  });
  return { names, duplicates, generated };
}

function emptyHeaderRecord() {
  return { names: [], duplicates: [], generated: [] };
}

/**
 * Streams the CSV into row objects. Bad rows never abort the run: they become
 * `errors` entries carrying a 1-based source line number, and the scan stops
 * early only when a documented limit is reached.
 */
async function scanCsv({ input, delimiter: forced, limit, maxErrors, keepEmpty }) {
  await assertReadableInput(input);
  const lineQueue = [];
  const { source, delimiter } = await openSource(input, forced);

  const parser = parse({
    bom: true,
    crlf: true,
    delimiter,
    rtrim: true,
    columns: false,
    relax_column_count: true,
    skip_empty_lines: !keepEmpty,
    on_record: (record, info) => {
      lineQueue.push(Number.isInteger(info.lines) ? info.lines : null);
      return record;
    },
  });

  const state = {
    header: null,
    rows: [],
    errors: [],
    bytes: 0,
    emptyValues: 0,
    raggedRows: 0,
    truncated: false,
    truncatedReason: null,
    delimiter,
  };

  const pump = (async () => {
    try {
      for await (const chunk of source) {
        state.bytes += chunk.length;
        if (!parser.write(chunk)) await once(parser, 'drain');
      }
      parser.end();
    } catch (error) {
      parser.destroy(error);
    }
  })();

  function stop(reason) {
    state.truncated = true;
    state.truncatedReason = reason;
  }

  function pushError(entry) {
    if (state.errors.length >= maxErrors) {
      stop('max_errors');
      return false;
    }
    state.errors.push(entry);
    return true;
  }

  function toObject(values) {
    const object = {};
    state.header.names.forEach((name, index) => {
      const value = values[index];
      object[name] = value === undefined ? '' : value;
    });
    return object;
  }

  let fatal = null;
  try {
    for await (const record of parser) {
      const line = lineQueue.shift() ?? null;
      const values = Array.isArray(record) ? record : Object.values(record);

      if (state.header === null) {
        const hasHeader = values.some((value) => value !== '');
        state.header = hasHeader ? buildHeader(values) : emptyHeaderRecord();
        if (!hasHeader) {
          state.header.names = values.map((_, index) => `column_${index + 1}`);
        }
        continue;
      }

      if (values.length !== state.header.names.length) {
        state.raggedRows += 1;
        pushError({
          line,
          code: 'CSV_RAGGED_ROW',
          message: `expected ${state.header.names.length} fields, got ${values.length}`,
          expected: state.header.names.length,
          got: values.length,
          row: toObject(values),
        });
        if (state.truncated) break;
      }

      const object = toObject(values);
      for (const value of Object.values(object)) {
        if (value === '') state.emptyValues += 1;
      }
      state.rows.push(object);
      if (state.rows.length >= limit) {
        stop('max_rows');
        break;
      }
    }
  } catch (error) {
    if (error instanceof ByteLimitError) {
      stop('max_bytes');
    } else {
      fatal = error;
    }
  }

  await pump.catch(() => {});

  if (fatal !== null) {
    pushError({
      line: Number.isInteger(fatal.lines) ? fatal.lines : null,
      code: fatal.code ?? 'CSV_PARSE_ERROR',
      message: fatal.message,
    });
    stop('parse_error');
  }

  if (state.header === null) state.header = emptyHeaderRecord();
  return state;
}

function commonFields(input, state) {
  return {
    input,
    bytes: state.bytes,
    bytes_human: formatBytes(state.bytes),
    delimiter: describeDelimiter(state.delimiter),
    columns: state.header.names,
    duplicate_columns: state.header.duplicates,
    generated_columns: state.header.generated,
    ragged_rows: state.raggedRows,
    empty_values: state.emptyValues,
    truncated: state.truncated,
    truncated_reason: state.truncatedReason,
    error_count: state.errors.length,
  };
}

async function commandInspect(positionals, flags) {
  rejectExtraPositionals(positionals, 1);
  requirePositional(positionals, 1, COMMAND_USAGE.inspect);
  if (stringFlag(flags, 'output') !== null) {
    throw new Error('inspect never writes a file; use parse or normalize --output');
  }
  const input = positionals[0];
  const state = await scanCsv({ input, ...readRowLimits(flags), delimiter: readDelimiterFlag(flags) });
  printData({
    ...commonFields(input, state),
    rows: state.rows.length,
    errors: state.errors,
  });
}

function classifyValue(value) {
  if (INTEGER_PATTERN.test(value)) return 'integer';
  if (FLOAT_PATTERN.test(value)) return 'float';
  if (BOOLEAN_VALUES.has(value.toLowerCase())) return 'boolean';
  return null;
}

/**
 * Casts the requested columns only. The cast kind is decided per column by
 * majority over the whole column, and values that do not match stay strings,
 * so "007" never becomes 7 unless that column was asked for explicitly.
 */
function applyCoercion(rows, columns, requested) {
  const report = [];
  for (const column of requested) {
    if (columns.includes(column) === false) {
      throw new Error(`--coerce names a column that is not in the file: ${column}`);
    }
    const tally = { integer: 0, float: 0, boolean: 0 };
    for (const row of rows) {
      const kind = classifyValue(row[column]);
      if (kind !== null) tally[kind] += 1;
    }
    const kind = ['integer', 'float', 'boolean'].reduce(
      (best, key) => (tally[key] > tally[best] ? key : best),
      'integer',
    );
    let converted = 0;
    let skipped = 0;
    let emptied = 0;
    for (const row of rows) {
      const value = row[column];
      if (value === '') {
        row[column] = null;
        emptied += 1;
        continue;
      }
      if (classifyValue(value) !== kind) {
        skipped += 1;
        continue;
      }
      if (kind === 'boolean') row[column] = BOOLEAN_VALUES.get(value.toLowerCase());
      else if (kind === 'integer') row[column] = Number.parseInt(value, 10);
      else row[column] = Number.parseFloat(value);
      converted += 1;
    }
    report.push({ column, to: kind, converted, skipped, emptied });
  }
  return report;
}

/** Applies the opt-in cleaning steps and reports what each of them changed. */
function applyNormalizations(rows, options) {
  const changes = {
    trimmed_values: 0,
    lowercased_values: 0,
    empty_values_as: null,
    truncated_values: 0,
    duplicates_removed: 0,
    sorted_by: null,
  };
  let output = rows;
  for (const row of output) {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== 'string') continue;
      let next = value;
      if (options.trim) {
        const trimmed = next.trim();
        if (trimmed !== next) changes.trimmed_values += 1;
        next = trimmed;
      }
      if (options.lowercase.includes(column)) {
        const lowered = next.toLowerCase();
        if (lowered !== next) changes.lowercased_values += 1;
        next = lowered;
      }
      if (next === '' && options.emptyAs === 'null') {
        row[column] = null;
      } else if (next.length > options.maxLength) {
        row[column] = next.slice(0, options.maxLength);
        changes.truncated_values += 1;
      } else {
        row[column] = next;
      }
    }
  }
  if (options.emptyAs !== null) changes.empty_values_as = options.emptyAs;

  if (options.dedupe) {
    const seen = new Set();
    const kept = [];
    for (const row of output) {
      const key = JSON.stringify(Object.entries(row));
      if (seen.has(key)) {
        changes.duplicates_removed += 1;
        continue;
      }
      seen.add(key);
      kept.push(row);
    }
    output = kept;
  }

  if (options.sort !== null) {
    const column = options.sort;
    if (output.length > 0 && Object.hasOwn(output[0], column) === false) {
      throw new Error(`--sort names a column that is not in the file: ${column}`);
    }
    changes.sorted_by = column;
    output = [...output].sort((left, right) => {
      const a = left[column];
      const b = right[column];
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'en', { numeric: true });
    });
  }

  return { rows: output, changes };
}

async function writeJsonOutput(rows, output, pretty) {
  if (output === null) return null;
  await fsPromises.writeFile(output, `${JSON.stringify(rows, null, pretty ? 2 : 0)}\n`);
  return output;
}

async function commandParse(positionals, flags) {
  rejectExtraPositionals(positionals, 1);
  requirePositional(positionals, 1, COMMAND_USAGE.parse);
  const input = positionals[0];
  const output = stringFlag(flags, 'output');
  const state = await scanCsv({ input, ...readRowLimits(flags), delimiter: readDelimiterFlag(flags) });

  const coerceColumns = listFlag(flags, 'coerce') ?? [];
  const coerced = coerceColumns.length === 0
    ? []
    : applyCoercion(state.rows, state.header.names, coerceColumns);
  const written = await writeJsonOutput(state.rows, output, boolFlag(flags, 'pretty', false));

  printData({
    ...commonFields(input, state),
    output: written,
    rows: state.rows,
    errors: state.errors,
    coerced_columns: coerced.map((entry) => entry.column),
    coercion: coerced,
  });
}

async function commandNormalize(positionals, flags) {
  rejectExtraPositionals(positionals, 1);
  requirePositional(positionals, 1, COMMAND_USAGE.normalize);
  const input = positionals[0];
  const output = stringFlag(flags, 'output');
  const state = await scanCsv({ input, ...readRowLimits(flags), delimiter: readDelimiterFlag(flags) });

  const options = {
    trim: boolFlag(flags, 'trim', false),
    lowercase: listFlag(flags, 'lowercase') ?? [],
    emptyAs: stringFlag(flags, 'empty-as') === null
      ? null
      : enumFlag(flags, 'empty-as', ['null', 'empty'], 'empty'),
    maxLength: intFlag(flags, 'max-length', Number.MAX_SAFE_INTEGER, { min: 1 }),
    dedupe: boolFlag(flags, 'dedupe', false),
    sort: stringFlag(flags, 'sort'),
  };
  for (const column of options.lowercase) {
    if (state.header.names.includes(column) === false) {
      throw new Error(`--lowercase names a column that is not in the file: ${column}`);
    }
  }

  const normalized = applyNormalizations(state.rows, options);
  const written = await writeJsonOutput(normalized.rows, output, boolFlag(flags, 'pretty', false));

  printData({
    ...commonFields(input, state),
    output: written,
    rows_in: state.rows.length,
    rows: normalized.rows,
    changes: normalized.changes,
    errors: state.errors,
  });
}

function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function unionColumns(records) {
  const columns = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

async function commandStringify(positionals, flags) {
  requirePositional(positionals, 2, COMMAND_USAGE.stringify);
  rejectExtraPositionals(positionals, 2);
  const [input, output] = positionals;
  await assertReadableInput(input);

  const raw = await fsPromises.readFile(input, 'utf8');
  let records;
  try {
    records = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${input} is not valid JSON: ${error.message}`);
  }
  if (Array.isArray(records) === false) throw new Error('input JSON must be an array of objects');
  records.forEach((record, index) => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`input JSON must be an array of objects; element ${index} is not`);
    }
  });

  const requested = listFlag(flags, 'columns');
  const columns = requested ?? unionColumns(records);
  if (columns.length === 0) throw new Error('no columns to write: the array is empty or has no keys');
  for (const column of columns) {
    if (records.some((record) => Object.hasOwn(record, column)) === false) {
      throw new Error(`--columns names "${column}", which no record has`);
    }
  }
  let missingCells = 0;
  for (const record of records) {
    for (const column of columns) {
      if (Object.hasOwn(record, column) === false) missingCells += 1;
    }
  }

  const delimiter = readDelimiterFlag(flags) ?? ',';
  const eol = enumFlag(flags, 'eol', ['lf', 'crlf'], 'lf');
  const writer = fs.createWriteStream(output, { encoding: 'utf8' });
  const transformer = stringify({
    header: true,
    columns,
    delimiter,
    record_delimiter: eol === 'crlf' ? '\r\n' : '\n',
  });
  transformer.pipe(writer);
  const done = new Promise((resolve, reject) => {
    writer.on('error', reject);
    transformer.on('error', reject);
    writer.on('finish', resolve);
  });
  for (const record of records) {
    const row = columns.map((column) => stringifyValue(record[column]));
    if (!transformer.write(row)) await once(transformer, 'drain');
  }
  transformer.end();
  await done;

  const stat = await fsPromises.stat(output);
  printData({
    input,
    output,
    rows: records.length,
    columns,
    delimiter: describeDelimiter(delimiter),
    eol,
    missing_cells: missingCells,
    bytes: stat.size,
    bytes_human: formatBytes(stat.size),
  });
}

async function dispatch(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  if (flags.version === true) {
    printData({ name: PACKAGE_NAME, version: VERSION });
    return;
  }
  if (command === undefined || command === 'help') {
    printData({ usage: USAGE });
    return;
  }
  if (flags.help === true) {
    printData({ usage: COMMAND_USAGE[command] ?? USAGE });
    return;
  }

  const handlers = {
    inspect: commandInspect,
    parse: commandParse,
    normalize: commandNormalize,
    stringify: commandStringify,
  };
  const handler = handlers[command];
  if (handler === undefined) {
    throw new Error(`unknown command: ${command}\n${USAGE}`);
  }
  await handler(positionals.slice(1), flags);
}

dispatch(process.argv.slice(2)).catch((error) => fail(error));
