#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
}

function parseArgs(values) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function positiveNumber(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a positive number`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function assertFlags(flags, allowed) {
  const unknown = Object.keys(flags).filter((flag) => !allowed.includes(flag));
  if (unknown.length) throw new Error(`unknown option: --${unknown[0]}`);
}

async function checkInput(input) {
  const stat = await fs.stat(input);
  if (!stat.isFile()) throw new Error(`input is not a file: ${input}`);
  if (stat.size > MAX_INPUT_BYTES) throw new Error(`input exceeds ${MAX_INPUT_BYTES} byte limit`);
  return stat;
}

async function inspect(input) {
  const stat = await checkInput(input);
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
  if (pixels > MAX_PIXELS) throw new Error(`image exceeds ${MAX_PIXELS} pixel limit`);
  return {
    input,
    size: stat.size,
    format: metadata.format ?? null,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    space: metadata.space ?? null,
    channels: metadata.channels ?? null,
    depth: metadata.depth ?? null,
    density: metadata.density ?? null,
    hasAlpha: metadata.hasAlpha ?? false,
    pages: metadata.pages ?? 1
  };
}

function outputFormat(output) {
  const ext = path.extname(output).toLowerCase();
  const formats = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.avif': 'avif' };
  if (!formats[ext]) throw new Error('output extension must be .jpg, .jpeg, .png, .webp, or .avif');
  return formats[ext];
}

function applyFormat(pipeline, format, quality) {
  const normalized = format === 'jpg' ? 'jpeg' : format;
  if (!['jpeg', 'png', 'webp', 'avif'].includes(normalized)) throw new Error(`unsupported format: ${format}`);
  const boundedQuality = quality === undefined ? undefined : positiveNumber(quality, 'quality');
  if (boundedQuality !== undefined && (!Number.isInteger(boundedQuality) || boundedQuality > 100)) {
    throw new Error('quality must be an integer from 1 to 100');
  }
  if (boundedQuality !== undefined && normalized === 'png') throw new Error('--quality is only supported for jpeg, webp, or avif output');
  if (normalized === 'jpeg') pipeline.jpeg(boundedQuality ? { quality: boundedQuality } : {});
  if (normalized === 'png') pipeline.png();
  if (normalized === 'webp') pipeline.webp(boundedQuality ? { quality: boundedQuality } : {});
  if (normalized === 'avif') pipeline.avif(boundedQuality ? { quality: boundedQuality } : {});
  return normalized;
}

async function transform(input, output, flags, command) {
  await checkInput(input);
  if (path.resolve(input) === path.resolve(output)) throw new Error('output must be different from input');
  const dimension = (value, label) => {
    if (value === undefined) return undefined;
    const number = positiveNumber(value, label);
    if (!Number.isInteger(number)) throw new Error(`${label} must be a positive integer`);
    return number;
  };
  const width = dimension(flags.width, '--width');
  const height = dimension(flags.height, '--height');
  if (command === 'resize' && !width && !height) throw new Error('resize requires --width or --height');
  if (command === 'convert' && !flags.format) throw new Error('convert requires --format');
  const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
  if (command === 'resize') {
    const fit = flags.fit ?? 'contain';
    if (!['contain', 'cover', 'fill', 'inside', 'outside'].includes(fit)) throw new Error(`unsupported fit: ${fit}`);
    const enlargement = flags['without-enlargement'];
    if (enlargement !== undefined && ![true, 'true', 'false'].includes(enlargement)) {
      throw new Error('--without-enlargement accepts only true or false');
    }
    pipeline.resize({ width, height, fit, withoutEnlargement: flags['without-enlargement'] !== 'false' });
  }
  const outputType = command === 'convert' ? String(flags.format).toLowerCase() : outputFormat(output);
  const format = applyFormat(pipeline, outputType, flags.quality);
  if (command === 'convert') {
    const extensionFormat = outputFormat(output);
    if (extensionFormat !== format) throw new Error(`output extension does not match --format ${format}`);
  }
  const result = await pipeline.toFile(output);
  return { input, output, format, width: result.width, height: result.height, size: result.size };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === '--help') throw new Error('usage: index.js <info|resize|convert> ...');
  let data;
  if (command === 'info') {
    assertFlags(flags, []);
    if (positional.length !== 1) throw new Error('info requires <input>');
    data = await inspect(positional[0]);
  } else if (command === 'resize' || command === 'convert') {
    assertFlags(flags, command === 'resize'
      ? ['width', 'height', 'fit', 'quality', 'without-enlargement']
      : ['format', 'quality']);
    if (positional.length !== 2) throw new Error(`${command} requires <input> <output>`);
    data = await transform(positional[0], positional[1], flags, command);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(JSON.stringify({ data }) + '\n');
}

main().catch((error) => fail(error.message));
