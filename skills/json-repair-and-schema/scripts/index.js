#!/usr/bin/env node

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Transform } from 'node:stream';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { jsonrepair } from 'jsonrepair';
import {
  boolFlag,
  fail,
  formatBytes,
  intFlag,
  parseArgs,
  printData,
  readJsonFile,
  stringFlag,
} from './lib/cli.js';

const require = createRequire(import.meta.url);
const { name: PACKAGE_NAME, version: VERSION } = require('../package.json');

/** Hard guard on the size of anything this skill reads. */
const MAX_BYTES = 50 * 1024 * 1024;
/** Hard guard on how deep a repaired document may nest. */
const MAX_REPAIR_DEPTH = 1000;
/** Default number of JSONL lines examined. */
const MAX_LINES = 100_000;
/** Default number of JSONL problems reported. */
const MAX_ERRORS = 100;
/** Longest raw offending line echoed back in a JSONL error entry. */
const MAX_LINE_PREVIEW = 200;

const USAGE = `Usage: node scripts/index.js <command> [arguments] [flags]

Commands:
  validate <input|-> [schema.json]   Parse and check JSON against a schema
  repair <input|-> [output.json]     Best-effort repair of broken JSON
  jsonl <input|->                    Stream a JSONL file line by line

Every command accepts --help and --version. "-" reads from stdin.`;

const COMMAND_USAGE = {
  validate: `Usage: node scripts/index.js validate <input|-> [schema.json] [flags]

Without a schema, "valid" only means "this text is valid JSON"; the payload
then says schema_checked: false.

Flags:
  --schema <file>     Schema to check against (same as the positional argument)
  --max-bytes <n>     Refuse inputs larger than n bytes (default ${MAX_BYTES})`,
  repair: `Usage: node scripts/index.js repair <input|-> [output.json] [flags]

Repairs are best-effort and conservative. If the input already parses, nothing
is written and changed is false. The repaired text is always round-tripped
through JSON.parse before it is written, unless --no-verify is given.

Flags:
  --no-verify         Write the repaired text without proving it parses
  --max-bytes <n>     Refuse inputs larger than n bytes (default ${MAX_BYTES})
  --max-repair-depth <n>  Refuse repaired documents nested deeper than n
                      (default ${MAX_REPAIR_DEPTH})`,
  jsonl: `Usage: node scripts/index.js jsonl <input|-> [flags]

Streams the file line by line. Line numbers are true 1-based source lines,
blank lines included, so they line up with what an editor shows.

Flags:
  --schema <file>     Check every parsed line against this schema
  --repair-out <file> Write a usable JSONL stream here (valid lines verbatim,
                      broken lines replaced by their repaired text)
  --limit <n>         Stop after n non-empty lines (default ${MAX_LINES})
  --max-errors <n>    Stop after n reported problems (default ${MAX_ERRORS})
  --max-bytes <n>     Refuse inputs larger than n bytes (default ${MAX_BYTES})`,
};

/**
 * Heuristics that explain *why* jsonrepair changed something. They describe the
 * input text, never quote it, so no payload value can leak into the report.
 */
const REPAIR_PATTERNS = [
  { code: 'unquoted_key', pattern: /[{,]\s*[A-Za-z_$][\w$-]*\s*:/g },
  { code: 'single_quoted_string', pattern: /'/g },
  { code: 'trailing_comma', pattern: /,\s*[}\]]/g },
  { code: 'comment', pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g },
  { code: 'python_literal', pattern: /\b(?:True|False|None|NaN|Infinity)\b/g },
  { code: 'unquoted_value', pattern: /:\s*[A-Za-z_][\w-]*(?=\s*[,}])/g },
  { code: 'missing_value', pattern: /[:{,]\s*[}\]]/g },
  { code: 'ellipsis', pattern: /\.\.\./g },
];

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Maximum `{`/`[` nesting depth, ignoring anything inside a JSON string. */
function measureDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (char === '}' || char === ']') depth -= 1;
  }
  return max;
}

function detectRepairs(source) {
  const found = [];
  for (const { code, pattern } of REPAIR_PATTERNS) {
    const occurrences = source.match(pattern)?.length ?? 0;
    if (occurrences > 0) found.push({ code, occurrences });
  }
  const opens = (source.match(/[{[]/g) ?? []).length;
  const closes = (source.match(/[}\]]/g) ?? []).length;
  if (opens > closes) {
    found.push({ code: 'unclosed_bracket', occurrences: opens - closes });
  }
  return found;
}

function byteLimits(flags) {
  return {
    maxBytes: intFlag(flags, 'max-bytes', MAX_BYTES, { min: 1, max: MAX_BYTES }),
    maxRepairDepth: intFlag(flags, 'max-repair-depth', MAX_REPAIR_DEPTH, { min: 1, max: 100_000 }),
  };
}

async function readStream(stream, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new Error(
        `input exceeds the ${formatBytes(maxBytes)} limit (use --max-bytes to change it)`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readInputText(input, maxBytes) {
  if (input === '-') return readStream(process.stdin, maxBytes);
  const stat = await fsPromises.stat(input).catch(() => null);
  if (stat === null) throw new Error(`input not found: ${input}`);
  if (!stat.isFile()) throw new Error(`input is not a regular file: ${input}`);
  return readStream(fs.createReadStream(input), maxBytes);
}

/**
 * Builds one Ajv instance and compiles the schema exactly once. Every other
 * JSON file in the schema's own directory is registered so that a relative
 * "$ref": "./common.json#/definitions/x" resolves like it does in an editor.
 */
function compileSchema(schemaFile) {
  const resolved = path.resolve(schemaFile);
  if (fs.existsSync(resolved) === false) throw new Error(`schema not found: ${schemaFile}`);
  const directory = path.dirname(resolved);
  const schema = readJsonFile(resolved);
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
  const register = (content, key) => {
    try {
      ajv.addSchema(content, key);
      return true;
    } catch {
      return false;
    }
  };

  let siblings = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const absolute = path.join(directory, entry);
    if (absolute === resolved) continue;
    let content;
    try {
      content = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch {
      continue;
    }
    if (register(content, entry)) siblings += 1;
    register(content, pathToFileURL(absolute).href);
  }

  const baseUri = pathToFileURL(resolved).href;
  register(schema, baseUri);
  let validate;
  try {
    validate = ajv.getSchema(baseUri) ?? ajv.compile(schema);
  } catch (error) {
    throw new Error(`schema ${schemaFile} could not be compiled: ${error.message}`);
  }
  return { validate, schemaFile, siblings };
}

/** Ajv errors -> flat, self-describing entries with a human summary. */
function normalizeAjvErrors(errors) {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath === '' ? '/' : error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message,
    params: error.params,
    summary: `${error.instancePath === '' ? '(root)' : error.instancePath} ${error.message}`,
  }));
}

function summarizeErrors(errors, limit = 3) {
  if (errors.length === 0) return 'no schema errors';
  const shown = errors.slice(0, limit).map((error) => error.summary).join('; ');
  const rest = errors.length - limit;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

function preview(text) {
  return text.length > MAX_LINE_PREVIEW
    ? { data: text.slice(0, MAX_LINE_PREVIEW), data_truncated: true }
    : { data: text, data_truncated: false };
}

function describeInput(input) {
  return input === '-' ? '<stdin>' : input;
}

async function commandValidate(positionals, flags) {
  const input = positionals[0];
  if (input === undefined) throw new Error(COMMAND_USAGE.validate);
  if (positionals.length > 2) throw new Error(`unexpected argument: ${positionals[2]}`);
  const { maxBytes } = byteLimits(flags);
  const schemaFile = stringFlag(flags, 'schema') ?? positionals[1] ?? null;

  const text = await readInputText(input, maxBytes);
  const bytes = Buffer.byteLength(text, 'utf8');

  let value;
  let parseError = null;
  try {
    value = JSON.parse(text);
  } catch (error) {
    parseError = error.message;
  }

  if (schemaFile === null) {
    printData({
      input: describeInput(input),
      schema: null,
      schema_checked: false,
      schema_siblings: 0,
      valid: parseError === null,
      errors: parseError === null ? [] : [{
        instancePath: '/',
        schemaPath: null,
        keyword: 'json-parse',
        message: parseError,
        params: {},
        summary: `the input is not valid JSON: ${parseError}`,
      }],
      error_count: parseError === null ? 0 : 1,
      summary: parseError === null
        ? 'the input is valid JSON (no schema was checked)'
        : `the input is not valid JSON: ${parseError}`,
      bytes,
      bytes_human: formatBytes(bytes),
    });
    return;
  }

  const { validate, siblings } = compileSchema(schemaFile);
  const valid = parseError === null && validate(value);
  const schemaErrors = parseError === null && valid === false ? normalizeAjvErrors(validate.errors) : [];
  const errors = parseError === null
    ? schemaErrors
    : [{
      instancePath: '/',
      schemaPath: null,
      keyword: 'json-parse',
      message: parseError,
      params: {},
      summary: `the input is not valid JSON: ${parseError}`,
    }];

  printData({
    input: describeInput(input),
    schema: schemaFile,
    schema_checked: true,
    schema_siblings: siblings,
    valid: Boolean(valid),
    errors,
    error_count: errors.length,
    summary: errors.length === 0
      ? 'the input matches the schema'
      : summarizeErrors(errors),
    bytes,
    bytes_human: formatBytes(bytes),
  });
}

async function commandRepair(positionals, flags) {
  const input = positionals[0];
  if (input === undefined) throw new Error(COMMAND_USAGE.repair);
  if (positionals.length > 2) throw new Error(`unexpected argument: ${positionals[2]}`);
  const output = positionals[1] ?? null;
  const verify = boolFlag(flags, 'verify', true);
  const { maxBytes, maxRepairDepth } = byteLimits(flags);

  const source = await readInputText(input, maxBytes);
  const before = { bytes: Buffer.byteLength(source, 'utf8'), sha256: sha256(source) };

  let alreadyValid = false;
  try {
    JSON.parse(source);
    alreadyValid = true;
  } catch {
    alreadyValid = false;
  }

  if (alreadyValid) {
    printData({
      input: describeInput(input),
      output,
      written: false,
      changed: false,
      repairs: [],
      valid_after_repair: true,
      note: 'the input already parsed as JSON, so nothing was rewritten',
      before,
      after: before,
    });
    return;
  }

  let repaired;
  try {
    repaired = jsonrepair(source);
  } catch (error) {
    const position = Number.isInteger(error.position) ? error.position : null;
    throw new Error(
      `jsonrepair could not repair the input${position === null ? '' : ` (at position ${position})`}: ${error.message}`,
    );
  }

  const depth = measureDepth(repaired);
  if (depth > maxRepairDepth) {
    throw new Error(
      `the repaired document nests ${depth} levels deep, over the ${maxRepairDepth} level limit (use --max-repair-depth to change it)`,
    );
  }

  let validAfterRepair = null;
  if (verify) {
    try {
      JSON.parse(repaired);
      validAfterRepair = true;
    } catch (error) {
      throw new Error(`the repaired text still does not parse, nothing was written: ${error.message}`);
    }
  }

  const after = { bytes: Buffer.byteLength(repaired, 'utf8'), sha256: sha256(repaired) };
  const changed = source.trim() !== repaired.trim();

  if (output !== null) {
    await fsPromises.writeFile(output, `${repaired}\n`);
  }

  printData({
    input: describeInput(input),
    output,
    written: output !== null,
    changed,
    repairs: detectRepairs(source),
    valid_after_repair: validAfterRepair,
    depth,
    before,
    after,
    ...(output === null ? { value: JSON.parse(repaired) } : {}),
  });
}

async function commandJsonl(positionals, flags) {
  const input = positionals[0];
  if (input === undefined) throw new Error(COMMAND_USAGE.jsonl);
  if (positionals.length > 1) throw new Error(`unexpected argument: ${positionals[1]}`);
  const schemaFile = stringFlag(flags, 'schema');
  const repairOut = stringFlag(flags, 'repair-out');
  const limit = intFlag(flags, 'limit', MAX_LINES, { min: 1, max: MAX_LINES });
  const maxErrors = intFlag(flags, 'max-errors', MAX_ERRORS, { min: 0, max: 100_000 });
  const { maxBytes } = byteLimits(flags);

  const stat = input === '-' ? null : await fsPromises.stat(input).catch(() => null);
  if (input !== '-' && stat === null) throw new Error(`input not found: ${input}`);
  if (stat !== null && stat.size > maxBytes) {
    throw new Error(`input exceeds the ${formatBytes(maxBytes)} limit (use --max-bytes to change it)`);
  }

  const validator = schemaFile === null ? null : compileSchema(schemaFile);

  let bytes = 0;
  let sourceLine = 0;
  let lines = 0;
  let parsed = 0;
  let valid = 0;
  let invalid = 0;
  let unrepairable = 0;
  let repairedLines = 0;
  let truncated = false;
  let truncatedReason = null;
  const errors = [];

  const source = input === '-'
    ? process.stdin
    : fs.createReadStream(input);
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new Error(
          `input exceeds the ${formatBytes(maxBytes)} limit (use --max-bytes to change it)`,
        ));
        return;
      }
      callback(null, chunk);
    },
  });
  source.on('error', (error) => counter.destroy(error));
  counter.on('error', () => {});
  source.pipe(counter);

  let repairStream = null;
  if (repairOut !== null) {
    repairStream = fs.createWriteStream(repairOut, { encoding: 'utf8' });
  }

  const reader = createInterface({ input: counter, crlfDelay: Infinity });
  try {
    for await (const rawLine of reader) {
      sourceLine += 1;
      const line = rawLine.trim();
      if (line === '') continue;
      if (lines >= limit) {
        truncated = true;
        truncatedReason = 'max_lines';
        break;
      }
      const lineNumber = sourceLine;
      lines += 1;

      let value = null;
      let parseError = null;
      try {
        value = JSON.parse(line);
        parsed += 1;
      } catch (error) {
        parseError = error.message;
      }

      if (repairStream !== null) {
        if (parseError === null) {
          repairStream.write(`${line}\n`);
        } else {
          let repaired = null;
          try {
            repaired = jsonrepair(line);
            JSON.parse(repaired);
          } catch {
            repaired = null;
          }
          if (repaired === null) {
            unrepairable += 1;
          } else {
            repairStream.write(`${repaired}\n`);
            repairedLines += 1;
          }
        }
      }

      if (parseError !== null) {
        invalid += 1;
        errors.push({
          line: lineNumber,
          error: `not valid JSON: ${parseError}`,
          keyword: 'json-parse',
          ...preview(line),
        });
      } else if (validator !== null && validator.validate(value) === false) {
        invalid += 1;
        errors.push({
          line: lineNumber,
          error: summarizeErrors(normalizeAjvErrors(validator.validate.errors)),
          keyword: validator.validate.errors?.[0]?.keyword ?? null,
          schema_errors: normalizeAjvErrors(validator.validate.errors),
          ...preview(line),
        });
      } else {
        valid += 1;
      }

      if (errors.length >= maxErrors) {
        truncated = true;
        truncatedReason = 'max_errors';
        break;
      }
    }
  } finally {
    reader.close();
    source.destroy();
    counter.destroy();
    if (repairStream !== null) {
      await new Promise((resolve) => {
        repairStream.on('error', () => resolve());
        repairStream.end(resolve);
      });
    }
  }

  printData({
    input: describeInput(input),
    schema: schemaFile,
    schema_checked: validator !== null,
    repair_out: repairOut,
    lines,
    parsed,
    valid,
    invalid,
    unrepairable,
    repaired_lines: repairedLines,
    error_count: errors.length,
    errors,
    truncated,
    truncated_reason: truncatedReason,
    bytes,
    bytes_human: formatBytes(bytes),
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
    validate: commandValidate,
    repair: commandRepair,
    jsonl: commandJsonl,
  };
  const handler = handlers[command];
  if (handler === undefined) throw new Error(`unknown command: ${command}\n${USAGE}`);
  await handler(positionals.slice(1), flags);
}

dispatch(process.argv.slice(2)).catch((error) => fail(error));
