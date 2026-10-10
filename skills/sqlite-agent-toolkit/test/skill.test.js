import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

async function fixture() { const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-sqlite-')); const file = path.join(dir, 'data.db'); const db = new Database(file); db.exec("CREATE TABLE users (id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'Ada'), (2, 'Grace');"); db.close(); return { dir, file }; }

test('schema and query return structured data', async () => { const { dir, file } = await fixture(); try { const schema = spawnSync(process.execPath, [cli, 'schema', file], { encoding: 'utf8' }); assert.equal(schema.status, 0, schema.stderr); assert.equal(JSON.parse(schema.stdout).data.tables.length, 1); const query = spawnSync(process.execPath, [cli, 'query', file, 'SELECT * FROM users'], { encoding: 'utf8' }); assert.equal(query.status, 0, query.stderr); assert.equal(JSON.parse(query.stdout).data.count, 2); } finally { await rm(dir, { recursive: true, force: true }); } });

test('mutating queries are rejected', async () => { const { dir, file } = await fixture(); try { const result = spawnSync(process.execPath, [cli, 'query', file, 'DROP TABLE users'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /read-only/); } finally { await rm(dir, { recursive: true, force: true }); } });

test('bad command returns structured error', () => { const result = spawnSync(process.execPath, [cli, 'wat'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /usage/); });
