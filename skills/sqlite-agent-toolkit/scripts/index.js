#!/usr/bin/env node
import Database from 'better-sqlite3';

const MAX_ROWS = 1000;
function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function main() {
  const [command, database, ...rest] = process.argv.slice(2);
  if (!['schema', 'query'].includes(command) || !database) throw new Error('usage: index.js <schema|query> <database> [sql]');
  const db = new Database(database, { readonly: true, fileMustExist: true, timeout: 1000 });
  try {
    if (command === 'schema') {
      if (rest.length) throw new Error('schema does not accept SQL arguments');
      const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      process.stdout.write(JSON.stringify({ data: { database, tables } }) + '\n');
      return;
    }
    const sql = rest.join(' ').trim();
    if (!/^(select|pragma|with|explain)\b/i.test(sql)) throw new Error('query must be a single read-only SELECT, PRAGMA, WITH, or EXPLAIN statement');
    // prepare() rejects trailing statements. Iteration stops after one sentinel
    // row, so a large result set is never materialized just to discard its tail.
    const statement = db.prepare(sql);
    const rows = [];
    let truncated = false;
    for (const row of statement.iterate()) {
      if (rows.length === MAX_ROWS) { truncated = true; break; }
      rows.push(row);
    }
    process.stdout.write(JSON.stringify({ data: { database, rows, count: rows.length, truncated } }) + '\n');
  } finally { db.close(); }
}
try { main(); } catch (error) { fail(error.message); }
