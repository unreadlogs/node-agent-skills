import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

function dataOf(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, '', `stderr should stay empty on success, got: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

function errorOf(result) {
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stdout}`);
  assert.equal(result.stdout, '', `stdout should stay empty on failure, got: ${result.stdout}`);
  const parsed = JSON.parse(result.stderr);
  assert.equal(typeof parsed.error, 'string');
  assert.ok(parsed.error.length > 0, 'error message must not be empty');
  assert.equal(Object.keys(parsed).length, 1, 'failure payload has exactly one key');
  return parsed.error;
}

async function withTempDir(run_) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-csv-'));
  try {
    return await run_(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CUSTOMERS = [
  'id,name,email,signup_date,total',
  '1,Ada Lovelace,ADA@Example.com,2024-01-02,10.50',
  '2,Grace Hopper,grace@example.com,2024-02-11,007',
  '3,Katherine Johnson,katherine@example.com,2024-03-05,1e3',
].join('\n');

test('inspect profiles a realistic CSV without dumping rows', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'customers.csv');
    const text = `${CUSTOMERS}\r\n`;
    await writeFile(input, text);

    const data = dataOf(run(['inspect', input]));

    assert.equal(data.input, input);
    assert.deepEqual(data.columns, ['id', 'name', 'email', 'signup_date', 'total']);
    assert.equal(data.rows, 3);
    assert.equal(data.delimiter, ',');
    assert.equal(data.ragged_rows, 0);
    assert.deepEqual(data.errors, []);
    assert.equal(data.truncated, false);
    assert.equal(data.truncated_reason, null);
    assert.equal(data.bytes, Buffer.byteLength(text));
    assert.equal(data.bytes_human, `${data.bytes} B`);
    assert.equal(typeof data.rows, 'number', 'inspect reports a row count, not rows');
    assert.equal(Object.hasOwn(data, 'row'), false, 'inspect must not embed rows');
  });
});

test('inspect sniffs delimiter and BOM, and reports duplicate/blank headers', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'messy.csv');
    await writeFile(input, '\uFEFFname;;age\r\nAda;1;36\r\nBob;;45\r\n');

    const data = dataOf(run(['inspect', input]));

    assert.equal(data.delimiter, ';');
    assert.equal(data.delimiter, ';', 'the BOM must not defeat delimiter sniffing');
    assert.deepEqual(data.columns, ['name', 'column_2', 'age']);
    assert.deepEqual(data.duplicate_columns, []);
    assert.deepEqual(data.generated_columns, ['column_2']);
    assert.equal(data.rows, 2);
  });
});

test('parse writes a bare array of row objects and keeps values as strings', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'customers.csv');
    const output = path.join(dir, 'customers.json');
    await writeFile(input, `${CUSTOMERS}\n`);

    const data = dataOf(run(['parse', input, '--output', output, '--pretty']));

    assert.equal(data.output, output);
    assert.deepEqual(data.rows, [
      { id: '1', name: 'Ada Lovelace', email: 'ADA@Example.com', signup_date: '2024-01-02', total: '10.50' },
      { id: '2', name: 'Grace Hopper', email: 'grace@example.com', signup_date: '2024-02-11', total: '007' },
      { id: '3', name: 'Katherine Johnson', email: 'katherine@example.com', signup_date: '2024-03-05', total: '1e3' },
    ]);
    assert.deepEqual(data.coerced_columns, []);

    const written = JSON.parse(await readFile(output, 'utf8'));
    assert.ok(Array.isArray(written), '--output must be a JSON array');
    assert.equal(written[0].total, '10.50');
    assert.equal(written[2].total, '1e3', '1e3 must not become 1000 without --coerce');
  });
});

test('parse reports ragged rows as structured errors with real line numbers', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'ragged.csv');
    await writeFile(input, ['name,email,city', 'Ada,a@example.com,London', '', 'Bob,', 'Cy,,Paris', 'Dee,d@example.com,Oslo,extra'].join('\n'));

    const data = dataOf(run(['parse', input]));

    assert.equal(data.ragged_rows, 2);
    assert.equal(data.error_count, 2);
    assert.equal(data.truncated, false, 'a malformed row must not truncate the run');

    assert.deepEqual(
      data.errors.map((entry) => entry.line),
      [4, 6],
      'line numbers must count the header and the skipped blank line',
    );
    assert.deepEqual(
      data.errors.map((entry) => entry.code),
      ['CSV_RAGGED_ROW', 'CSV_RAGGED_ROW'],
    );
    assert.equal(data.errors[0].expected, 3);
    assert.equal(data.errors[0].got, 2);
    assert.equal(data.errors[1].got, 4);
    assert.equal(data.rows.length, 4, 'every parsed row still comes through');
    assert.deepEqual(data.rows[3], { name: 'Dee', email: 'd@example.com', city: 'Oslo' });
  });
});

test('an unclosed quote is reported, not thrown', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'quote.csv');
    await writeFile(input, 'name,note\nAda,"never closed\nGrace,ok\n');

    const data = dataOf(run(['inspect', input]));

    assert.equal(data.truncated, true);
    assert.equal(data.truncated_reason, 'parse_error');
    assert.equal(data.error_count, 1);
    assert.equal(data.errors[0].code, 'CSV_QUOTE_NOT_CLOSED');
    assert.equal(typeof data.errors[0].line, 'number');
    assert.equal(data.errors[0].line, 3, 'the parser reports the line where it gave up');
  });
});

test('--limit stops the scan and says so', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'many.csv');
    const lines = ['id,value'];
    for (let i = 0; i < 50; i += 1) lines.push(`${i},v${i}`);
    await writeFile(input, `${lines.join('\n')}\n`);

    const data = dataOf(run(['parse', input, '--limit', '10']));

    assert.equal(data.rows.length, 10);
    assert.equal(data.truncated, true);
    assert.equal(data.truncated_reason, 'max_rows');

    const full = dataOf(run(['parse', input]));
    assert.equal(full.rows.length, 50);
    assert.equal(full.truncated, false);
  });
});

test('--max-errors stops the scan and says so', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'ragged.csv');
    await writeFile(input, ['a,b', '1', '2,3,4', '5', '6,7,8', '9', '10,11,12'].join('\n'));

    const data = dataOf(run(['parse', input, '--max-errors', '2']));

    assert.equal(data.error_count, 2);
    assert.equal(data.truncated, true);
    assert.equal(data.truncated_reason, 'max_errors');
    assert.deepEqual(data.errors.map((entry) => entry.line), [2, 3]);
  });
});

test('--coerce casts only the named column and reports what it did', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'numbers.csv');
    await writeFile(input, ['id,zip,active,note', '1,007,yes,fine', '2,008,no,fine'].join('\n'));

    const data = dataOf(run(['parse', input, '--coerce', 'zip,active']));

    assert.deepEqual(data.coerced_columns, ['zip', 'active']);
    assert.deepEqual(data.coercion, [
      { column: 'zip', to: 'integer', converted: 2, skipped: 0, emptied: 0 },
      { column: 'active', to: 'boolean', converted: 2, skipped: 0, emptied: 0 },
    ]);
    assert.equal(data.rows[0].zip, 7, '007 only becomes 7 because the column was named');
    assert.equal(data.rows[0].active, true);
    assert.equal(data.rows[0].id, '1', 'unnamed columns stay strings');
  });
});

test('normalize changes only what it was asked to and counts the rest', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'messy.csv');
    const output = path.join(dir, 'clean.json');
    await writeFile(input, [
      'name,email,role',
      '  Ada  ,ADA@Example.com,Engineer',
      'grace,GRACE@Example.com,analyst',
      '  Ada  ,ADA@Example.com,Engineer',
      'bob,,analyst',
      '',
    ].join('\n'));

    const data = dataOf(run([
      'normalize', input, '--output', output,
      '--trim', '--lowercase', 'name,email', '--empty-as', 'null', '--dedupe', '--sort', 'name',
    ]));

    assert.equal(data.rows_in, 4);
    assert.equal(data.rows.length, 3);
    assert.deepEqual(data.rows.map((row) => row.name), ['ada', 'bob', 'grace']);
    assert.deepEqual(data.rows[2].email, 'grace@example.com');
    assert.equal(data.rows[1].email, null);
    assert.deepEqual(data.changes, {
      trimmed_values: 2,
      lowercased_values: 5,
      empty_values_as: 'null',
      truncated_values: 0,
      duplicates_removed: 1,
      sorted_by: 'name',
    });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).length, 3);
  });
});

test('normalize --max-length truncates and counts the damage', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'long.csv');
    await writeFile(input, 'name,note\nAda,a-very-long-note\n');

    const data = dataOf(run(['normalize', input, '--max-length', '4']));

    assert.equal(data.rows[0].note, 'a-ve');
    assert.equal(data.changes.truncated_values, 1);
    assert.equal(data.changes.trimmed_values, 0);
  });
});

test('normalize without flags is a no-op', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'plain.csv');
    await writeFile(input, 'name,email\nAda,ada@example.com\n');

    const data = dataOf(run(['normalize', input]));

    assert.deepEqual(data.rows, [{ name: 'Ada', email: 'ada@example.com' }]);
    assert.equal(data.changes.trimmed_values, 0);
    assert.equal(data.changes.sorted_by, null);
    assert.equal(data.changes.empty_values_as, null);
  });
});

test('parse reads from stdin', async () => {
  const result = run(['parse', '-'], { input: 'name,age\nAda,36\n' });
  const data = dataOf(result);
  assert.equal(data.input, '-');
  assert.deepEqual(data.rows, [{ name: 'Ada', age: '36' }]);
});

test('stringify round-trips JSON to CSV, unioning keys and JSON-encoding objects', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'in.json');
    const output = path.join(dir, 'out.csv');
    await writeFile(input, JSON.stringify([
      { id: 1, tags: ['a', 'b'], meta: { x: 1 } },
      { id: 2, extra: 'late' },
    ]));

    const data = dataOf(run(['stringify', input, output]));

    assert.deepEqual(data.columns, ['id', 'tags', 'meta', 'extra'], 'keys from later records must survive');
    assert.equal(data.rows, 2);
    assert.equal(data.missing_cells, 3);
    assert.ok(data.bytes > 0);
    assert.equal(
      await readFile(output, 'utf8'),
      'id,tags,meta,extra\n1,"[""a"",""b""]","{""x"":1}",\n2,,,late\n',
    );
  });
});

test('stringify honours --columns order, --delimiter and --eol', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'in.json');
    const output = path.join(dir, 'out.csv');
    await writeFile(input, JSON.stringify([{ name: 'Ada', email: 'ada@example.com', note: null }]));

    const data = dataOf(run(['stringify', input, output, '--columns', 'email,name', '--delimiter', ';', '--eol', 'crlf']));

    assert.deepEqual(data.columns, ['email', 'name']);
    assert.equal(data.delimiter, ';');
    assert.equal(data.eol, 'crlf');
    assert.equal(await readFile(output, 'utf8'), 'email;name\r\nada@example.com;Ada\r\n');
  });
});

test('--help prints usage as JSON and exits 0', () => {
  const top = run(['--help']);
  assert.equal(top.status, 0);
  assert.equal(top.stderr, '');
  assert.equal(typeof JSON.parse(top.stdout).data.usage, 'string');

  const scoped = run(['parse', '--help']);
  assert.equal(scoped.status, 0);
  assert.match(JSON.parse(scoped.stdout).data.usage, /--coerce/);
});

test('--version prints the package name and version', () => {
  const result = run(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).data).sort(), ['name', 'version']);
  assert.equal(JSON.parse(result.stdout).data.name, '@unreadlogs/skill-streaming-csv-json-normalizer');
});

test('failures are structured JSON on stderr with exit code 1', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'x.csv');
    await writeFile(input, 'a,b\n1,2\n');

    assert.match(errorOf(run(['inspect', path.join(dir, 'missing.csv')])), /input not found/);
    assert.match(errorOf(run(['wat'])), /unknown command/);
    assert.match(errorOf(run(['inspect', input, '--output', 'out.json'])), /never writes a file/);
    assert.match(errorOf(run(['inspect', input, '--limit', 'lots'])), /--limit must be an integer/);
    assert.match(errorOf(run(['parse', input, '--coerce', 'nope'])), /not in the file/);
    assert.match(errorOf(run(['normalize', input, '--empty-as', 'maybe'])), /--empty-as must be one of/);
    assert.match(errorOf(run(['stringify', input])), /stringify <input.json> <output.csv>/);
    assert.match(errorOf(run(['inspect'])), /inspect <input>/);
  });
});

test('failure output never leaks file contents', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'secret.csv');
    await writeFile(input, 'user,api_key\nada,sk-live-SUPERSECRET\n');

    const failure = errorOf(run(['parse', input, '--coerce', 'password']));

    assert.equal(failure.includes('SUPERSECRET'), false, 'raw cell values must not leak into errors');
    assert.equal(failure.includes('sk-live'), false);
    assert.match(failure, /--coerce names a column that is not in the file: password/);
  });
});
