#!/usr/bin/env node
import Database from 'better-sqlite3';

const MAX_ROWS = 1000;
function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function main() { const [command, database, ...rest] = process.argv.slice(2); if (!['schema', 'query'].includes(command) || !database) throw new Error('usage: index.js <schema|query> <database> [sql]'); const db = new Database(database, { readonly: true, fileMustExist: true }); try { if (command === 'schema') { const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all(); process.stdout.write(JSON.stringify({ data: { database, tables } }) + '\n'); } else { const sql = rest.join(' ').trim(); if (!sql || !/^(select|pragma|with|explain)\b/i.test(sql) || sql.includes(';')) throw new Error('query must be a single read-only SELECT, PRAGMA, WITH, or EXPLAIN statement'); const rows = db.prepare(sql).all().slice(0, MAX_ROWS); process.stdout.write(JSON.stringify({ data: { database, rows, count: rows.length, truncated: rows.length === MAX_ROWS } }) + '\n'); } } finally { db.close(); } }
try { main(); } catch (error) { fail(error.message); }
