import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');
test('scan finds and redacts likely secrets', async () => { const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-secrets-')); try { await writeFile(path.join(dir, 'config.env'), 'API_KEY=super-secret-value-12345\n'); const result = spawnSync(process.execPath, [cli, 'scan', dir], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); const text = result.stdout; assert.doesNotMatch(text, /super-secret-value-12345/); assert.equal(JSON.parse(text).data.findings[0].value, '[REDACTED]'); } finally { await rm(dir, { recursive: true, force: true }); } });
test('bad command returns structured error', () => { const result = spawnSync(process.execPath, [cli, 'wat'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
