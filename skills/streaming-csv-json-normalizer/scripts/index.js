#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const MAX_BYTES = 50 * 1024 * 1024;

function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function args(values) {
  const positional = []; const flags = {};
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith('--')) positional.push(values[i]);
    else if (values[i + 1] && !values[i + 1].startsWith('--')) flags[values[i].slice(2)] = values[++i];
    else flags[values[i].slice(2)] = true;
  }
  return { positional, flags };
}
async function readInput(file) {
  const stat = await fsPromises.stat(file);
  if (!stat.isFile()) throw new Error(`input is not a file: ${file}`);
  if (stat.size > MAX_BYTES) throw new Error(`input exceeds ${MAX_BYTES} byte limit`);
  return fsPromises.readFile(file, 'utf8');
}
function columns(records) { return records.length ? Object.keys(records[0]) : []; }
async function main() {
  const [command, ...rest] = process.argv.slice(2); const { positional, flags } = args(rest);
  if (command === 'inspect' || command === 'parse') {
    if (positional.length !== 1) throw new Error(`${command} requires <input>`);
    const source = await readInput(positional[0]);
    const records = parse(source, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: false });
    const data = command === 'inspect' ? { input: positional[0], bytes: Buffer.byteLength(source), rows: records.length, columns: columns(records), emptyValues: records.reduce((n, row) => n + Object.values(row).filter((v) => v === '').length, 0) } : records;
    if (flags.output) await fsPromises.writeFile(flags.output, JSON.stringify(records, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ data }) + '\n');
  } else if (command === 'stringify') {
    if (positional.length !== 2) throw new Error('stringify requires <input.json> <output.csv>');
    const records = JSON.parse(await fsPromises.readFile(positional[0], 'utf8'));
    if (!Array.isArray(records) || records.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('input JSON must be an array of objects');
    const selected = flags.columns ? String(flags.columns).split(',').map((v) => v.trim()).filter(Boolean) : columns(records);
    await fsPromises.writeFile(positional[1], stringify(records, { header: true, columns: selected }));
    process.stdout.write(JSON.stringify({ data: { input: positional[0], output: positional[1], rows: records.length, columns: selected } }) + '\n');
  } else throw new Error('usage: index.js <inspect|parse|stringify> ...');
}
main().catch((error) => fail(error.message));
