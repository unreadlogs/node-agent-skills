import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

function dataOf(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, '', `stderr must stay empty on success, got: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

function errorOf(result) {
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stdout}`);
  assert.equal(result.stdout, '', `stdout must stay empty on failure, got: ${result.stdout}`);
  const parsed = JSON.parse(result.stderr);
  assert.equal(typeof parsed.error, 'string');
  assert.ok(parsed.error.length > 0, 'the error message must not be empty');
  assert.deepEqual(Object.keys(parsed), ['error'], 'the failure payload has exactly one key');
  return parsed.error;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function withTempDir(body) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-json-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ORDER = {
  id: 'ord_1024',
  customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
  total: 149.5,
  currency: 'GBP',
  tags: ['priority', 'gift'],
};

const ORDER_SCHEMA = {
  type: 'object',
  required: ['id', 'customer', 'total', 'currency'],
  properties: {
    id: { type: 'string', pattern: '^ord_[0-9]+$' },
    customer: {
      type: 'object',
      required: ['name', 'email'],
      properties: { name: { type: 'string' }, email: { type: 'string' } },
    },
    total: { type: 'number' },
    currency: { type: 'string', enum: ['GBP', 'EUR', 'USD'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

test('validate checks a document against a schema', async () => {
  await withTempDir(async (dir) => {
    const data = path.join(dir, 'order.json');
    const schema = path.join(dir, 'order.schema.json');
    await writeFile(data, JSON.stringify(ORDER));
    await writeFile(schema, JSON.stringify(ORDER_SCHEMA));

    const result = dataOf(run(['validate', data, schema]));

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.error_count, 0);
    assert.equal(result.schema_checked, true);
    assert.equal(result.summary, 'the input matches the schema');
    assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(ORDER)));
  });
});

test('validate reports normalized Ajv errors with a JSON pointer and a summary', async () => {
  await withTempDir(async (dir) => {
    const data = path.join(dir, 'order.json');
    const schema = path.join(dir, 'order.schema.json');
    await writeFile(data, JSON.stringify({ ...ORDER, total: '149.50', currency: 'XYZ' }));
    await writeFile(schema, JSON.stringify(ORDER_SCHEMA));

    const result = dataOf(run(['validate', data, '--schema', schema]));

    assert.equal(result.valid, false);
    assert.equal(result.error_count, 2, 'allErrors must report every violation');
    const keys = result.errors.map((error) => error.instancePath).sort();
    assert.deepEqual(keys, ['/currency', '/total']);
    const total = result.errors.find((error) => error.instancePath === '/total');
    assert.deepEqual(Object.keys(total), ['instancePath', 'schemaPath', 'keyword', 'message', 'params', 'summary']);
    assert.equal(total.keyword, 'type');
    assert.deepEqual(total.params, { type: 'number' });
    assert.equal(total.summary, '/total must be number');
    assert.match(result.summary, /must be/);
  });
});

test('validate without a schema says so instead of pretending it checked one', async () => {
  await withTempDir(async (dir) => {
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    await writeFile(good, '{"name":"Ada"}');
    await writeFile(bad, '{"name":"Ada",}');

    const parsed = dataOf(run(['validate', good]));
    assert.equal(parsed.valid, true);
    assert.equal(parsed.schema_checked, false);
    assert.equal(parsed.schema, null);
    assert.match(parsed.summary, /no schema was checked/);

    const broken = dataOf(run(['validate', bad]));
    assert.equal(broken.valid, false);
    assert.equal(broken.schema_checked, false);
    assert.equal(broken.error_count, 1);
    assert.equal(broken.errors[0].keyword, 'json-parse');
    assert.equal(broken.errors[0].instancePath, '/');
  });
});

test('validate reads from stdin', () => {
  const result = dataOf(run(['validate', '-'], { input: '{"name":"Ada"}' }));
  assert.equal(result.input, '<stdin>');
  assert.equal(result.valid, true);
});

test('relative $ref resolves against the schema file directory', async () => {
  await withTempDir(async (dir) => {
    const schema = path.join(dir, 'order.schema.json');
    const common = path.join(dir, 'common.json');
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    await writeFile(common, JSON.stringify({ $defs: { money: { type: 'number', minimum: 0 } } }));
    await writeFile(schema, JSON.stringify({
      type: 'object',
      properties: { total: { $ref: './common.json#/$defs/money' } },
    }));
    await writeFile(good, '{"total": 10}');
    await writeFile(bad, '{"total": -1}');

    assert.equal(dataOf(run(['validate', good, schema])).valid, true);

    const failed = dataOf(run(['validate', bad, schema]));
    assert.equal(failed.valid, false);
    assert.equal(failed.errors[0].instancePath, '/total');
    assert.equal(failed.errors[0].keyword, 'minimum');
  });
});

test('repair fixes broken JSON, proves it, and hashes both sides', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'broken.json');
    const output = path.join(dir, 'fixed.json');
    await writeFile(input, "{id: 'ord_1', total: 10, tags: ['a',], note: None,}");

    const result = dataOf(run(['repair', input, output]));

    assert.equal(result.changed, true);
    assert.equal(result.written, true);
    assert.equal(result.valid_after_repair, true);
    assert.notEqual(result.before.sha256, result.after.sha256);
    assert.ok(result.before.bytes > 0 && result.after.bytes > 0);
    const codes = result.repairs.map((entry) => entry.code).sort();
    assert.ok(codes.includes('unquoted_key'));
    assert.ok(codes.includes('single_quoted_string'));
    assert.ok(codes.includes('trailing_comma'));
    assert.ok(codes.includes('python_literal'));

    const fixed = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(fixed, { id: 'ord_1', total: 10, tags: ['a'], note: null });
  });
});

test('repair leaves an already valid document completely alone', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'good.json');
    const output = path.join(dir, 'must-not-exist.json');
    await writeFile(input, JSON.stringify(ORDER));

    const result = dataOf(run(['repair', input, output]));

    assert.equal(result.changed, false);
    assert.equal(result.written, false);
    assert.deepEqual(result.repairs, []);
    assert.equal(result.valid_after_repair, true);
    assert.deepEqual(result.before, result.after);
    assert.equal(await exists(output), false, 'a no-op repair must not create the output file');
  });
});

test('repair to stdout returns the document inline and still honours the contract', () => {
  const result = dataOf(run(['repair', '-'], { input: "{name: 'Ada',}" }));
  assert.equal(result.output, null);
  assert.equal(result.written, false);
  assert.equal(result.changed, true);
  assert.deepEqual(result.value, { name: 'Ada' });
  assert.equal(result.valid_after_repair, true);
});

test('repair refuses to write when jsonrepair gives up', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'hopeless.json');
    const output = path.join(dir, 'fixed.json');
    await writeFile(input, '{"a": 1 @@@ 2}');

    const message = errorOf(run(['repair', input, output]));

    assert.match(message, /jsonrepair could not repair the input \(at position \d+\)/);
    assert.equal(await exists(output), false);
  });
});

test('repair refuses an over-deep document', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'deep.json');
    const output = path.join(dir, 'fixed.json');
    await writeFile(input, '{"a":'.repeat(40));

    const message = errorOf(run(['repair', input, output, '--max-repair-depth', '10']));

    assert.match(message, /nests 40 levels deep, over the 10 level limit/);
    assert.equal(await exists(output), false);
  });
});

test('--no-verify skips the round trip and says the result is unverified', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'broken.json');
    const output = path.join(dir, 'fixed.json');
    await writeFile(input, "{name: 'Ada',}");

    const result = dataOf(run(['repair', input, output, '--no-verify']));

    assert.equal(result.changed, true);
    assert.equal(result.valid_after_repair, null);
    assert.equal(result.written, true);
  });
});

test('jsonl reports true source line numbers across blank lines', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    await writeFile(input, [
      '{"a":1}',
      '',
      '',
      '{"a":',
      '{"a":2}',
      '',
      '{"a":',
      '',
    ].join('\n'));

    const result = dataOf(run(['jsonl', input]));

    assert.equal(result.lines, 4);
    assert.equal(result.parsed, 2);
    assert.equal(result.invalid, 2);
    assert.equal(result.valid, 2);
    assert.deepEqual(result.errors.map((entry) => entry.line), [4, 7]);
    assert.deepEqual(
      result.errors.map((entry) => entry.keyword),
      ['json-parse', 'json-parse'],
    );
    assert.equal(result.truncated, false);
    assert.equal(result.truncated_reason, null);
  });
});

test('jsonl validates every line against one compiled schema', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    const schema = path.join(dir, 'event.schema.json');
    await writeFile(schema, JSON.stringify({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'integer' } },
    }));
    const lines = [];
    for (let i = 0; i < 5000; i += 1) {
      lines.push(i % 500 === 499 ? '{"a":"not an int"}' : `{"a":${i}}`);
    }
    await writeFile(input, `${lines.join('\n')}\n`);

    const started = process.hrtime.bigint();
    const result = dataOf(run(['jsonl', input, '--schema', schema]));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.equal(result.schema_checked, true);
    assert.equal(result.parsed, 5000);
    assert.equal(result.valid, 4990);
    assert.equal(result.invalid, 10);
    assert.equal(result.error_count, 10);
    assert.deepEqual(result.errors.map((entry) => entry.line), [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
    assert.ok(elapsedMs < 20000, `5000 schema-checked lines took ${elapsedMs}ms`);
  });
});

test('jsonl schema errors carry the normalized Ajv shape', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    const schema = path.join(dir, 'event.schema.json');
    await writeFile(schema, JSON.stringify({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'integer' } },
    }));
    await writeFile(input, '{"a":1}\n{"a":"x"}\n');

    const result = dataOf(run(['jsonl', input, '--schema', schema]));

    assert.equal(result.errors.length, 1);
    const error = result.errors[0];
    assert.equal(error.line, 2);
    assert.equal(error.keyword, 'type');
    assert.match(error.error, /\/a must be integer/);
    assert.equal(error.schema_errors[0].instancePath, '/a');
    assert.equal(error.schema_errors[0].params.type, 'integer');
  });
});

test('jsonl --limit stops the scan and says so', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    const lines = [];
    for (let i = 0; i < 40; i += 1) lines.push(`{"i":${i}}`);
    await writeFile(input, `${lines.join('\n')}\n`);

    const limited = dataOf(run(['jsonl', input, '--limit', '5']));
    assert.equal(limited.lines, 5);
    assert.equal(limited.truncated, true);
    assert.equal(limited.truncated_reason, 'max_lines');

    const full = dataOf(run(['jsonl', input]));
    assert.equal(full.lines, 40);
    assert.equal(full.truncated, false);
  });
});

test('jsonl --max-errors stops the scan and says so', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    await writeFile(input, '{"a":\n{"a":\n{"a":\n{"a":\n{"a":\n');

    const result = dataOf(run(['jsonl', input, '--max-errors', '2']));

    assert.equal(result.error_count, 2);
    assert.deepEqual(result.errors.map((entry) => entry.line), [1, 2]);
    assert.equal(result.truncated, true);
    assert.equal(result.truncated_reason, 'max_errors');
  });
});

test('jsonl --repair-out writes a usable stream and counts the losses', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    const output = path.join(dir, 'events.fixed.jsonl');
    await writeFile(input, [
      "{'a': 1}",
      '{"a": 2}',
      '{"a":',
      '[[[{{{',
      '',
    ].join('\n'));

    const result = dataOf(run(['jsonl', input, '--repair-out', output]));

    assert.equal(result.lines, 4);
    assert.equal(result.parsed, 1);
    assert.equal(result.invalid, 3);
    assert.equal(result.repaired_lines, 3);
    assert.equal(result.unrepairable, 0);
    const written = (await readFile(output, 'utf8')).trim().split('\n');
    assert.equal(written.length, 4);
    assert.deepEqual(written.map((line) => JSON.parse(line)), [
      { a: 1 },
      { a: 2 },
      { a: null },
      [[[{}, {}, {}]]],
    ]);
  });
});

test('jsonl --max-bytes is a hard failure, not a silent truncation', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'events.jsonl');
    await writeFile(input, `${'{"a":1}\n'.repeat(50)}`);

    const message = errorOf(run(['jsonl', input, '--max-bytes', '20']));

    assert.match(message, /input exceeds the 20 B limit/);
  });
});

test('--help prints usage as JSON and exits 0', () => {
  const top = run(['--help']);
  assert.equal(top.status, 0);
  assert.equal(top.stderr, '');
  assert.equal(typeof JSON.parse(top.stdout).data.usage, 'string');

  const scoped = run(['jsonl', '--help']);
  assert.equal(scoped.status, 0);
  assert.match(JSON.parse(scoped.stdout).data.usage, /--repair-out/);
});

test('--version prints the package name and version', () => {
  const result = run(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).data).sort(), ['name', 'version']);
  assert.equal(JSON.parse(result.stdout).data.name, '@unreadlogs/skill-json-repair-and-schema');
});

test('failures are structured JSON on stderr with exit code 1', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'good.json');
    await writeFile(input, '{"name":"Ada"}');

    assert.match(errorOf(run(['wat'])), /unknown command/);
    assert.match(errorOf(run(['validate'])), /validate <input\|-> \[schema.json\]/);
    assert.match(errorOf(run(['jsonl'])), /jsonl <input\|->/);
    assert.match(errorOf(run(['validate', path.join(dir, 'nope.json')])), /input not found/);
    assert.match(errorOf(run(['validate', input, '--max-bytes', '2'])), /input exceeds the 2 B limit/);
    assert.match(errorOf(run(['validate', input, input, 'extra'])), /unexpected argument: extra/);
    assert.match(errorOf(run(['validate', input, 'not-a-schema.json'])), /schema not found: not-a-schema.json/);
    const brokenSchema = path.join(dir, 'broken.schema.json');
    await writeFile(brokenSchema, '{not json');
    assert.match(errorOf(run(['validate', input, brokenSchema])), /broken.schema.json is not valid JSON/);
  });
});

test('failures never echo document contents', async () => {
  await withTempDir(async (dir) => {
    const input = path.join(dir, 'secret.json');
    await writeFile(input, '{"api_key":"sk-live-SUPERSECRET" @@@ }');

    const failure = errorOf(run(['repair', input, path.join(dir, 'out.json')]));

    assert.equal(failure.includes('SUPERSECRET'), false, 'document values must not leak into errors');
    assert.equal(failure.includes('sk-live'), false);

    const tooBig = errorOf(run(['validate', input, '--max-bytes', '5']));
    assert.equal(tooBig.includes('SUPERSECRET'), false);
  });
});
