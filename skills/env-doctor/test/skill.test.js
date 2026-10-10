import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');
test('check reports scripts and missing example variables', async () => { const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-env-')); try { await writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' }, engines: { node: '>=20' } })); await writeFile(path.join(dir, '.env.example'), 'DATABASE_URL=\n'); const result = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } }); assert.equal(result.status, 0, result.stderr); const data = JSON.parse(result.stdout).data; assert.deepEqual(data.scripts, ['test']); assert.equal(data.findings[0].code, 'MISSING_ENV'); } finally { await rm(dir, { recursive: true, force: true }); } });
test('bad command returns structured error', () => { const result = spawnSync(process.execPath, [cli, 'wat'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
