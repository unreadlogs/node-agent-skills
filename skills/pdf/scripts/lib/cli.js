import { readFileSync, mkdirSync } from 'node:fs';

export function printData(data) {
  process.stdout.write(`${JSON.stringify({ data })}\n`);
}

export function fail(err) {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}

export function getFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1] !== undefined) {
    return argv[index + 1];
  }
  return null;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function parsePageRange(range, totalPages) {
  if (!range) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const parts = String(range)
    .split(/[-:,]+/)
    .map((part) => parseInt(part, 10));
  if (parts.length === 1 && Number.isInteger(parts[0])) {
    return parts[0] < 1 ? [] : [parts[0]];
  }
  if (parts.length === 2 && parts.every(Number.isInteger)) {
    const [start, end] = parts;
    if (start < 1 || end < start) {
      return [];
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  return [];
}

export function parsePageList(list) {
  return String(list)
    .split(/[,\s]+/)
    .map((part) => parseInt(part, 10))
    .filter(Number.isInteger)
    .filter((page) => page >= 1);
}

export function parsePageSelection(selection) {
  const pages = [];
  for (const part of String(selection).split(/[,\s]+/)) {
    if (!part) continue;
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const start = parseInt(match[1], 10);
    const end = match[2] !== undefined ? parseInt(match[2], 10) : start;
    for (let page = start; page <= end; page += 1) {
      if (page >= 1) pages.push(page);
    }
  }
  return pages;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function ensureOutputDir(dir) {
  mkdirSync(dir, { recursive: true });
}
