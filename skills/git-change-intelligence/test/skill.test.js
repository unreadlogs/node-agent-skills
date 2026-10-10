import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

test('status returns structured changed files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-git-'));
  try { execFileSync('git', ['init', '-q'], { cwd: dir }); await writeFile(path.join(dir, 'file.txt'), 'hello'); const result = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.files[0].state, 'untracked'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('commits returns repository history', () => { const result = spawnSync(process.execPath, [cli, 'commits', '.', '--limit', '2'], { cwd: path.resolve(import.meta.dirname, '../../../'), encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.ok(Array.isArray(JSON.parse(result.stdout).data.commits)); });

test('bad command returns structured error', () => { const result = spawnSync(process.execPath, [cli, 'wat', '.'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
