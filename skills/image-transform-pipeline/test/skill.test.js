import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'scripts', 'index.js');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('info reports image metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-image-'));
  try {
    const input = path.join(dir, 'input.png');
    await sharp({ create: { width: 32, height: 20, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toFile(input);
    const result = run(['info', input]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout).data;
    assert.equal(payload.format, 'png');
    assert.equal(payload.width, 32);
    assert.equal(payload.height, 20);
    assert.equal(payload.hasAlpha, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resize uses contain and writes output', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-image-'));
  try {
    const input = path.join(dir, 'input.png');
    const output = path.join(dir, 'thumb.webp');
    await sharp({ create: { width: 100, height: 50, channels: 3, background: 'red' } }).png().toFile(input);
    const result = run(['resize', input, output, '--width', '40', '--fit', 'contain']);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout).data;
    assert.equal(payload.output, output);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('convert writes the requested format', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-image-'));
  try {
    const input = path.join(dir, 'input.png');
    const output = path.join(dir, 'output.jpg');
    await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toFile(input);
    const result = run(['convert', input, output, '--format', 'jpeg', '--quality', '80']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.format, 'jpeg');
    const bytes = await readFile(output);
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid command returns JSON error and exit 1', () => {
  const result = run(['wat']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command/);
  assert.doesNotThrow(() => JSON.parse(result.stderr));
});
