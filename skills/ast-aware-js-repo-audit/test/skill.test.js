import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('lint returns normalized findings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-audit-')); const file = path.join(dir, 'bad.js');
  try { await writeFile(file, 'const unused = 1;\n'); const result = run(['lint', file], dir); assert.equal(result.status, 0, result.stderr); const data = JSON.parse(result.stdout).data; assert.equal(data.files, 1); assert.ok(Array.isArray(data.findings)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad command returns structured error', () => { const result = run(['wat'], process.cwd()); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
