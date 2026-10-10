#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';

const MAX_FILES = 1000;
function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function rejectPath(file) { const normalized = path.resolve(file); if (normalized.includes(`${path.sep}.git${path.sep}`) || normalized.includes(`${path.sep}node_modules${path.sep}`)) throw new Error(`path is excluded by policy: ${file}`); }
async function pack(inputs, output) {
  if (inputs.length === 0 || inputs.length > MAX_FILES) throw new Error(`pack accepts 1-${MAX_FILES} input files`);
  for (const file of inputs) { rejectPath(file); const stat = await fsPromises.stat(file); if (!stat.isFile()) throw new Error(`not a file: ${file}`); }
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(output); const archive = archiver('zip', { zlib: { level: 9 } });
    stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject); archive.pipe(stream);
    for (const file of inputs) archive.file(file, { name: path.basename(file) });
    archive.finalize();
  });
  const stat = await fsPromises.stat(output); return { output, files: inputs.length, size: stat.size };
}
async function list(input) {
  const buffer = await fsPromises.readFile(input); const names = []; let offset = 0;
  while (offset + 30 <= buffer.length) { if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; } const nameLength = buffer.readUInt16LE(offset + 26); const extraLength = buffer.readUInt16LE(offset + 28); const compressed = buffer.readUInt32LE(offset + 18); const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString(); names.push({ name, compressedSize: compressed }); offset += 30 + nameLength + extraLength + compressed; }
  return { input, files: names };
}
async function main() { const [command, ...rest] = process.argv.slice(2); if (command === 'pack') { if (rest.length < 2) throw new Error('usage: index.js pack <file...> <output.zip>'); const output = rest.at(-1); process.stdout.write(JSON.stringify({ data: await pack(rest.slice(0, -1), output) }) + '\n'); } else if (command === 'list') { if (rest.length !== 1) throw new Error('usage: index.js list <archive.zip>'); process.stdout.write(JSON.stringify({ data: await list(rest[0]) }) + '\n'); } else throw new Error('usage: index.js <pack|list> ...'); }
main().catch((error) => fail(error.message));
