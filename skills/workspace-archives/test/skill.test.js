import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('pack creates a ZIP and list reads its entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-archive-')); const one = path.join(dir, 'one.txt'); const two = path.join(dir, 'two.txt'); const archive = path.join(dir, 'handoff.zip');
  try { await writeFile(one, 'one'); await writeFile(two, 'two'); const packed = run(['pack', one, two, archive]); assert.equal(packed.status, 0, packed.stderr); const listed = run(['list', archive]); assert.equal(listed.status, 0, listed.stderr); assert.deepEqual(JSON.parse(listed.stdout).data.files.map((f) => f.name), ['one.txt', 'two.txt']); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad command returns structured error', () => { const result = run(['wat']); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
