#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { classifyValue, ORDERED_RULES, RULES } from './lib/rules.js';
import {
  boolFlag,
  enumFlag,
  fail,
  intFlag,
  listFlag,
  parseArgs,
  printData,
} from './lib/cli.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

const SEVERITIES = ['high', 'medium', 'low'];
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/** Directories that are build output, vendored code or tooling caches. */
const DEFAULT_SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode-test',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.svelte-kit',
  '.next',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',
  '.terraform',
  '.gradle',
  '.mvn',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'node_modules',
  'bower_components',
  'vendor',
  'Pods',
  'target',
  'out',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.serverless',
  '.expo',
  'DerivedData',
  'tmp',
]);

const DEFAULT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.properties',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php', '.scala', '.swift',
  '.tf', '.tfvars', '.hcl', '.sql', '.graphql', '.gql', '.xml', '.html', '.htm',
  '.css', '.scss', '.less',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore',
  '.env', '.dockercfg', '.rdl',
]);

const DEFAULT_NAMES = new Set([
  'Dockerfile', 'dockerfile', 'Containerfile', 'Makefile', 'makefile',
  'Procfile', 'Jenkinsfile', 'Vagrantfile', 'Rakefile', 'Gemfile',
  '.npmrc', '.pypirc', '.netrc', '.gitignore', '.dockerignore', '.editorconfig',
  '.env.local', '.env.development', '.env.production', '.env.test', '.env.sample', '.env.template',
]);

const DEFAULTS = {
  maxFileBytes: 1024 * 1024,
  maxFiles: 20000,
  maxFindings: 500,
  minSeverity: 'low',
  failOn: 'none',
  respectGitignore: true,
};

const USAGE = [
  'secret-and-config-audit — heuristic secret and risky-config scanner (values are never printed)',
  '',
  'Usage:',
  '  node scripts/index.js scan [dir] [options]',
  '  node scripts/index.js rules',
  '  node scripts/index.js --help',
  '  node scripts/index.js --version',
  '',
  'Options for scan:',
  '  --exclude a,b          extra glob patterns (files or directories) to skip',
  '  --include a,b          glob patterns scanned even if not text/known-extension',
  '  --max-file-bytes N     per-file size cap before the file is skipped (default 1048576)',
  '  --max-files N          maximum number of files scanned (default 20000)',
  '  --max-findings N       maximum number of findings returned (default 500)',
  '  --min-severity LEVEL   report only high, medium or low findings (default low)',
  '  --rules a,b            restrict the scan to these rule ids (see the `rules` command)',
  '  --no-gitignore         do not honour .gitignore via git check-ignore',
  '  --fail-on LEVEL        exit 1 when a finding of LEVEL or worse exists (high|medium|low|none)',
].join('\n');

function globToRegExp(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function matchesGlob(relativePath, name, patterns) {
  return patterns.some((pattern) => pattern.test(name) || pattern.test(relativePath));
}

function shouldScanFile(name, includePatterns) {
  if (matchesGlob(name, name, includePatterns)) return true;
  if (DEFAULT_NAMES.has(name)) return true;
  if (name.startsWith('.env')) return true;
  const extension = path.extname(name).toLowerCase();
  return extension !== '' && DEFAULT_EXTENSIONS.has(extension);
}

/**
 * Non-reversible rendering of a matched value: first four and last four
 * characters only. Values shorter than 12 characters are never rendered.
 */
function redact(value) {
  if (value.length < 12) return '[redacted:too-short]';
  return `${value.slice(0, 4)}\u2026${value.slice(-4)}`;
}

function maskLine(line, matchText, replacement) {
  const index = line.indexOf(matchText);
  if (index === -1) return truncate(line);
  const masked = `${line.slice(0, index)}${replacement}${line.slice(index + matchText.length)}`;
  return truncate(masked);
}

function truncate(text, limit = 240) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\u2026`;
}

function emptySkipCounts() {
  return {
    excluded: 0,
    extension: 0,
    gitignored: 0,
    too_large: 0,
    binary: 0,
    unreadable: 0,
    symlink: 0,
    other: 0,
  };
}

async function collectFiles(root, options, skipped) {
  const queue = [''];
  const files = [];
  const symlinks = [];

  while (queue.length > 0) {
    const relativeDir = queue.shift();
    const absoluteDir = relativeDir === '' ? root : path.join(root, relativeDir);
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      skipped.unreadable += 1;
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

      if (entry.isSymbolicLink()) {
        skipped.symlink += 1;
        if (symlinks.length < 20) symlinks.push(relativePath);
        continue;
      }
      if (matchesGlob(relativePath, entry.name, options.exclude)) {
        skipped.excluded += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const forced = matchesGlob(relativePath, entry.name, options.include);
        if (DEFAULT_SKIP_DIRS.has(entry.name) && !forced) {
          skipped.excluded += 1;
          continue;
        }
        queue.push(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        skipped.other += 1;
        continue;
      }
      if (!shouldScanFile(entry.name, options.include)) {
        skipped.extension += 1;
        continue;
      }
      files.push(relativePath);
    }
  }

  return { files, symlinks };
}

function gitAvailable() {
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * Asks git which of the candidate paths are ignored. Returns null when the
 * project is not a git work tree, so the caller can fall back.
 */
function gitIgnoredPaths(root, files) {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  if (inside.status !== 0) return null;

  const ignored = new Set();
  const batchSize = 400;
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = files.slice(index, index + batchSize);
    const result = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '-z'], {
      input: `${batch.join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) continue;
    for (const entry of result.stdout.split('\0')) {
      if (entry) ignored.add(entry.replace(/^\.\//, ''));
    }
  }
  return ignored;
}

/** Best-effort root .gitignore reader used when git is unavailable. */
async function fallbackIgnoredPaths(root, files) {
  let text;
  try {
    text = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
  } catch {
    return new Set();
  }

  const patterns = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    patterns.push(globToRegExp(trimmed.replace(/^\//, '').replace(/\/$/, '/**')));
  }

  const ignored = new Set();
  for (const file of files) {
    const segments = file.split('/');
    const matched = patterns.some((pattern) =>
      pattern.test(file) || segments.some((segment) => pattern.test(segment)) ||
      segments.some((_, index) => pattern.test(segments.slice(0, index + 1).join('/'))));
    if (matched) ignored.add(file);
  }
  return ignored;
}

function scanText(relativePath, text, rules, state) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) continue;

    for (const rule of rules) {
      const match = rule.regex.exec(line);
      if (match === null) continue;
      rule.regex.lastIndex = 0;

      const raw = match[rule.capture ?? 0] ?? match[0];
      const placeholder = classifyValue(raw);
      if (placeholder !== null) {
        state.placeholders += 1;
        if (state.placeholderSamples.length < 10) {
          state.placeholderSamples.push({
            file: relativePath,
            line: index + 1,
            rule: rule.id,
            reason: placeholder,
          });
        }
        continue;
      }

      const severity = rule.severity;
      if (SEVERITY_RANK[severity] < SEVERITY_RANK[state.minSeverity]) continue;

      if (state.findings.length >= state.maxFindings) {
        state.truncated = true;
        return;
      }

      const matchText = match[0];
      state.findings.push({
        file: relativePath,
        line: index + 1,
        column: match.index + 1,
        rule: rule.id,
        severity,
        kind: rule.kind,
        match: redact(raw),
        evidence: maskLine(line, matchText, '[redacted]'),
      });
    }
  }
}

async function scanFiles(root, files, rules, state) {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (const relativePath of files) {
    if (state.findings.length >= state.maxFindings) {
      state.truncated = true;
      break;
    }

    const absolute = path.join(root, relativePath);
    let buffer;
    try {
      const stat = await fs.stat(absolute);
      if (stat.size > state.maxFileBytes) {
        state.skipped.too_large += 1;
        continue;
      }
      buffer = await fs.readFile(absolute);
    } catch {
      state.skipped.unreadable += 1;
      continue;
    }

    if (buffer.subarray(0, 8192).includes(0)) {
      state.skipped.binary += 1;
      continue;
    }

    let text;
    try {
      text = decoder.decode(buffer);
    } catch {
      state.skipped.binary += 1;
      continue;
    }
    if (text.includes('\u0000')) {
      state.skipped.binary += 1;
      continue;
    }

    state.bytes += buffer.byteLength;
    state.scanned += 1;
    scanText(relativePath, text, rules, state);
  }
}

async function commandScan(flags, positionals) {
  if (positionals.length > 1) {
    throw new Error(`scan takes at most one directory, got ${positionals.length}`);
  }

  const target = positionals[0] ?? '.';
  const root = path.resolve(target);
  const stats = await fs.stat(root).catch(() => null);
  if (stats === null) throw new Error(`directory not found: ${target}`);
  if (!stats.isDirectory()) throw new Error(`not a directory: ${target}`);

  const options = {
    exclude: listFlag(flags, 'exclude')?.map(globToRegExp) ?? [],
    include: listFlag(flags, 'include')?.map(globToRegExp) ?? [],
  };

  const minSeverity = enumFlag(flags, 'min-severity', SEVERITIES, DEFAULTS.minSeverity);
  const failOn = enumFlag(flags, 'fail-on', [...SEVERITIES, 'none'], DEFAULTS.failOn);
  const respectGitignore = boolFlag(flags, 'gitignore', DEFAULTS.respectGitignore);

  const requestedRules = listFlag(flags, 'rules');
  if (requestedRules !== null) {
    const known = new Set(RULES.map((rule) => rule.id));
    const unknown = requestedRules.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`unknown rule id(s): ${unknown.join(', ')}`);
    }
  }
  const rules = requestedRules === null
    ? ORDERED_RULES
    : ORDERED_RULES.filter((rule) => requestedRules.includes(rule.id));

  const state = {
    findings: [],
    placeholders: 0,
    placeholderSamples: [],
    scanned: 0,
    bytes: 0,
    skipped: emptySkipCounts(),
    symlinks: [],
    maxFileBytes: intFlag(flags, 'max-file-bytes', DEFAULTS.maxFileBytes, { min: 1 }),
    maxFiles: intFlag(flags, 'max-files', DEFAULTS.maxFiles, { min: 1 }),
    maxFindings: intFlag(flags, 'max-findings', DEFAULTS.maxFindings, { min: 1 }),
    minSeverity,
    truncated: false,
  };

  const collected = await collectFiles(root, options, state.skipped);
  let candidates = collected.files;
  let gitignoreMode = 'disabled';
  let ignoredCount = 0;

  if (respectGitignore && candidates.length > 0) {
    const ignored = gitAvailable() ? gitIgnoredPaths(root, candidates) : null;
    if (ignored !== null) {
      gitignoreMode = 'git';
      candidates = candidates.filter((file) => {
        if (ignored.has(file)) {
          ignoredCount += 1;
          return false;
        }
        return true;
      });
    } else {
      gitignoreMode = 'fallback';
      const fallback = await fallbackIgnoredPaths(root, candidates);
      candidates = candidates.filter((file) => {
        if (fallback.has(file)) {
          ignoredCount += 1;
          return false;
        }
        return true;
      });
    }
  }

  const totalCandidates = candidates.length;
  const files = candidates.slice(0, state.maxFiles);
  if (totalCandidates > files.length) {
    state.skipped.excluded += totalCandidates - files.length;
    state.truncated = true;
  }

  await scanFiles(root, files, rules, state);

  const byRule = {};
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const finding of state.findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    bySeverity[finding.severity] += 1;
  }

  const filesSkipped = Object.values(state.skipped).reduce((total, value) => total + value, 0);
  const shouldFail = failOn !== 'none' && Object.entries(bySeverity).some(
    ([severity, count]) => count > 0 && SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn],
  );

  printData({
    root,
    files_scanned: state.scanned,
    files_skipped: filesSkipped,
    bytes_scanned: state.bytes,
    findings: state.findings,
    counts: { by_rule: byRule, by_severity: bySeverity, placeholder: state.placeholders },
    skipped: { ...state.skipped, gitignored: ignoredCount },
    symlinks: { count: state.skipped.symlink, sample: state.skipped.symlink ? collected.symlinks : [] },
    placeholders_sample: state.placeholderSamples,
    gitignore: { mode: gitignoreMode, files_ignored: ignoredCount },
    truncated: state.truncated,
    exit_recommended: bySeverity.high > 0,
  });

  if (shouldFail) {
    process.exitCode = 1;
  }
}

function commandRules() {
  printData({
    count: RULES.length,
    rules: RULES.map((rule) => ({
      id: rule.id,
      severity: rule.severity,
      kind: rule.kind,
      pattern: rule.summary,
      false_positives: rule.falsePositives,
    })),
    placeholders: [
      'example', 'placeholder', 'redacted', 'changeme', 'your-*', 'xxx…', '<…>',
      '${VAR}', '$VAR', 'process.env.X', 'import.meta.env.X', 'os.environ[…]', '%s',
      'dummy/fake/testing', 'purely numeric values',
    ],
  });
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  if (flags.version === true) {
    printData({ name: '@unreadlogs/skill-secret-and-config-audit', version: VERSION });
    return;
  }
  if (flags.help === true || positionals[0] === 'help') {
    printData({ usage: USAGE });
    return;
  }

  const [command, ...rest] = positionals;
  switch (command) {
    case 'scan':
      await commandScan(flags, rest);
      return;
    case 'rules':
      if (Object.keys(flags).length > 0) throw new Error('rules takes no flags');
      commandRules();
      return;
    default:
      throw new Error(`unknown command: ${command ?? '(none)'}\n\n${USAGE}`);
  }
}

main().catch((error) => fail(error));