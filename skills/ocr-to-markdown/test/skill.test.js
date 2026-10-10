import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

test('ocr requires an input image', () => {
  const result = spawnSync(process.execPath, [cli, 'ocr'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /usage/);
});

test('unknown command returns structured error', () => {
  const result = spawnSync(process.execPath, [cli, 'wat'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /usage/);
});
