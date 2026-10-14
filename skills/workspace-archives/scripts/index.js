#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';

const MAX_FILES = 1000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function rejectPath(file) {
  const normalized = path.resolve(file);
  const segments = normalized.split(path.sep);
  if (segments.includes('.git') || segments.includes('node_modules')) throw new Error(`path is excluded by policy: ${file}`);
}
async function pack(inputs, output) {
  if (inputs.length === 0 || inputs.length > MAX_FILES) throw new Error(`pack accepts 1-${MAX_FILES} input files`);
  const names = new Set();
  let outputPath = path.resolve(output);
  try { outputPath = await fsPromises.realpath(outputPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of inputs) {
    const absolute = await fsPromises.realpath(file);
    rejectPath(absolute);
    if (absolute === outputPath) throw new Error(`output must not replace an input file: ${file}`);
    const name = path.basename(absolute);
    if (names.has(name)) throw new Error(`input filenames collide in archive: ${name}`);
    names.add(name);
    const stat = await fsPromises.stat(file);
    if (!stat.isFile()) throw new Error(`not a file: ${file}`);
  }
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(output); const archive = archiver('zip', { zlib: { level: 9 } });
    stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject); archive.pipe(stream);
    for (const file of inputs) archive.file(file, { name: path.basename(file) });
    archive.finalize();
  });
  const stat = await fsPromises.stat(output); return { output, files: inputs.length, size: stat.size };
}
async function list(input) {
  const stat = await fsPromises.stat(input);
  if (!stat.isFile()) throw new Error(`not a file: ${input}`);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error(`archive exceeds ${MAX_ARCHIVE_BYTES} byte limit`);
  const buffer = await fsPromises.readFile(input);
  // Read the central directory: local headers can contain zero sizes when ZIP
  // data descriptors are used, which makes walking local records unreliable.
  const eocd = 0x06054b50;
  let end = -1;
  for (let offset = Math.max(0, buffer.length - 65557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === eocd && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) end = offset;
  }
  if (end < 0) throw new Error('invalid ZIP: end-of-central-directory record not found');
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (offset + directorySize > end) throw new Error('invalid ZIP: central directory is out of bounds');
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid ZIP: malformed central directory entry');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    if (compressedSize === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    if (offset + 46 + nameLength + extraLength + commentLength > buffer.length) throw new Error('invalid ZIP: truncated entry');
    names.push({ name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), compressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { input, files: names };
}
async function main() { const [command, ...rest] = process.argv.slice(2); if (command === 'pack') { if (rest.length < 2) throw new Error('usage: index.js pack <file...> <output.zip>'); const output = rest.at(-1); process.stdout.write(JSON.stringify({ data: await pack(rest.slice(0, -1), output) }) + '\n'); } else if (command === 'list') { if (rest.length !== 1) throw new Error('usage: index.js list <archive.zip>'); process.stdout.write(JSON.stringify({ data: await list(rest[0]) }) + '\n'); } else throw new Error('usage: index.js <pack|list> ...'); }
main().catch((error) => fail(error.message));
