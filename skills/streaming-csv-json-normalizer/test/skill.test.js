import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('inspect and parse CSV records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-csv-')); const input = path.join(dir, 'data.csv'); const output = path.join(dir, 'data.json');
  try {
    await writeFile(input, 'name,email\nAda,ada@example.com\nGrace,grace@example.com\n');
    const inspected = run(['inspect', input]); assert.equal(inspected.status, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).data.rows, 2);
    const parsed = run(['parse', input, '--output', output]); assert.equal(parsed.status, 0, parsed.stderr); assert.match(await readFile(output, 'utf8'), /Ada/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stringify JSON objects to CSV', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-csv-')); const input = path.join(dir, 'data.json'); const output = path.join(dir, 'data.csv');
  try { await writeFile(input, JSON.stringify([{ name: 'Ada', age: '36' }])); const result = run(['stringify', input, output, '--columns', 'name,age']); assert.equal(result.status, 0, result.stderr); assert.equal(await readFile(output, 'utf8'), 'name,age\nAda,36\n'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad command returns structured error', () => { const result = run(['wat']); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
