import { readFileSync } from 'node:fs';

/**
 * Shared CLI plumbing for this skill.
 *
 * Output contract (identical across every tool skill in this repository):
 *   success -> stdout: {"data": ...}   exit 0
 *   failure -> stderr: {"error": "..."} exit 1
 */

export function printData(data) {
  process.stdout.write(`${JSON.stringify({ data })}\n`);
}

export function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}

/**
 * Parses `--flag value`, `--flag=value`, `--no-flag`, boolean `--flag`, and
 * positionals. Everything after a bare `--` is treated as a positional so
 * callers can pass values that look like flags.
 */
export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      continue;
    }
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positionals, flags };
}

export function stringFlag(flags, name, fallback = null) {
  const value = flags[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (value === true) return '';
  return fallback;
}

export function boolFlag(flags, name, fallback = false) {
  const value = flags[name];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function intFlag(flags, name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer, got: ${raw}`);
  if (value < min || value > max) throw new Error(`--${name} must be between ${min} and ${max}, got: ${value}`);
  return value;
}

export function numberFlag(flags, name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got: ${raw}`);
  if (value < min || value > max) throw new Error(`--${name} must be between ${min} and ${max}, got: ${value}`);
  return value;
}

export function listFlag(flags, name) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return null;
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function enumFlag(flags, name, allowed, fallback) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = String(raw).toLowerCase();
  if (!allowed.includes(value)) {
    throw new Error(`--${name} must be one of ${allowed.join(', ')}, got: ${raw}`);
  }
  return value;
}

export function requireString(flags, name) {
  const value = stringFlag(flags, name);
  if (value === null) throw new Error(`--${name} is required`);
  return value;
}

export function readJsonFile(file) {
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

/**
 * Parses page selections shared by every PDF command: `3`, `1-5`, `1,3`,
 * `1-3,7`, `1, 3 5`. Returns a de-duplicated, ascending list of 1-based pages.
 */
export function parsePageSelection(selection, totalPages = null) {
  const pages = [];
  const seen = new Set();
  for (const part of String(selection).split(/[,\s]+/)) {
    if (!part) continue;
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`invalid page selection: "${part}" (expected "3", "1-5", or "1,3")`);
    const start = Number.parseInt(match[1], 10);
    const end = match[2] !== undefined ? Number.parseInt(match[2], 10) : start;
    if (start < 1) throw new Error(`page numbers are 1-based: "${part}"`);
    if (end < start) throw new Error(`range end is before its start: "${part}"`);
    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }
  if (pages.length === 0) throw new Error('page selection is empty');
  if (totalPages !== null) {
    const outOfRange = pages.filter((page) => page > totalPages);
    if (outOfRange.length > 0) {
      throw new Error(
        `page ${outOfRange.length === 1 ? 'number' : 'numbers'} ${outOfRange.join(', ')} out of range (document has ${totalPages} ${totalPages === 1 ? 'page' : 'pages'})`,
      );
    }
  }
  return pages;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}