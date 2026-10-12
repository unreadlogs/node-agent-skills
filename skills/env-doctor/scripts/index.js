#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import semver from 'semver';
import { enumFlag, fail, intFlag, listFlag, parseArgs, printData } from './lib/cli.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

const SEVERITY_RANK = { error: 3, warning: 2, info: 1 };
const KNOWN_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'deno', 'cnpm', 'yarnpkg'];
const LOCKFILES = [
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'deno.lock', manager: 'deno' },
];
const ENV_EXAMPLE_FILES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  'env.example',
  'config/.env.example',
];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte']);
const SOURCE_SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', '.venv', 'venv', '__pycache__', 'vendor',
  'target', 'Pods', '.idea', '.output',
]);
const SOURCE_LIMITS = { maxFiles: 2000, maxFileBytes: 512 * 1024, maxTotalBytes: 8 * 1024 * 1024 };
const LTS_CODENAMES = { 20: 'Iron', 22: 'Jod', 24: 'Krypton' };

const DEFAULTS = { failOn: 'none' };

const USAGE = [
  'env-doctor — Node project runtime, package manager, script and environment diagnostics',
  '',
  'Usage:',
  '  node scripts/index.js check [dir] [options]',
  '  node scripts/index.js env [dir]',
  '  node scripts/index.js --help',
  '  node scripts/index.js --version',
  '',
  'Options for check:',
  '  --env-names a,b,c   extra variable names to treat as required',
  '  --fail-on LEVEL      exit 1 on error|warning|none (default none)',
  '  --json-summary       print only the summary and the finding codes',
  '  --max-source-files N    source files scanned for env access (default 2000)',
  '  --max-source-bytes N    per-source-file byte cap (default 524288)',
  '  --max-total-source-bytes N  total source bytes read (default 8388608)',
  '',
  'Variable values are never printed, only names and whether they are set,',
  'empty or unset.',
].join('\n');

const DIAGNOSTIC_GROUPS = ['package', 'node', 'scripts', 'env', 'workspace', 'files'];

/** Runs `fn` with the report's group pointer set, so `passed` can be computed. */
async function inGroup(report, group, fn) {
  const previous = report.group;
  report.group = group;
  try {
    return await fn();
  } finally {
    report.group = previous;
  }
}

function makeReport() {
  return {
    findings: [],
    groups: new Map(DIAGNOSTIC_GROUPS.map((group) => [group, { errors: 0 }])),
    add(code, severity, message, evidence) {
      this.findings.push({ code, severity, message, evidence: String(evidence) });
      if (severity === 'error' && this.groups.has(this.group)) this.groups.get(this.group).errors += 1;
      return this;
    },
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readJsonIfPresent(file) {
  const text = await readTextIfPresent(file);
  if (text === null) return { present: false, value: null, error: null };
  try {
    return { present: true, value: JSON.parse(text), error: null };
  } catch (error) {
    return { present: true, value: null, error: error.message };
  }
}

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

function matchesGlob(relativePath, patterns) {
  return patterns.some((pattern) => pattern.test(relativePath));
}

/** Extracts variable names from a dotenv-style file, honouring `export` prefixes. */
function parseEnvFile(text) {
  const names = new Set();
  if (text === null) return names;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match === null) continue;
    names.add(match[1]);
  }
  return names;
}

const ENV_ACCESS_PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
];

async function collectSourceFiles(root, maxFiles) {
  const queue = [''];
  const files = [];
  while (queue.length > 0) {
    const relativeDir = queue.shift();
    const absoluteDir = relativeDir === '' ? root : path.join(root, relativeDir);
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SOURCE_SKIP_DIRS.has(entry.name)) queue.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(relativePath);
      if (files.length >= maxFiles) return { files, truncated: true };
    }
  }
  return { files, truncated: false };
}

async function readSourceEnvNames(root, limits) {
  const { files, truncated } = await collectSourceFiles(root, limits.maxFiles);
  const names = new Map();
  let bytes = 0;
  let read = 0;
  let cut = truncated;

  for (const relativePath of files) {
    let text;
    try {
      const stat = await fs.stat(path.join(root, relativePath));
      if (stat.size > limits.maxFileBytes) continue;
      text = await fs.readFile(path.join(root, relativePath), 'utf8');
    } catch {
      continue;
    }
    if (bytes + text.length > limits.maxTotalBytes) {
      cut = true;
      break;
    }
    bytes += text.length;
    read += 1;

    for (const pattern of ENV_ACCESS_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (!names.has(name)) names.set(name, relativePath);
      }
    }
  }

  return { names, files_scanned: read, files_matched: files.length, truncated: cut };
}

/** Collects entry-point targets declared by `main`, `module` and `exports`. */
function collectEntryTargets(pkg) {
  const targets = [];
  if (typeof pkg.main === 'string') targets.push({ field: 'main', value: pkg.main });
  if (typeof pkg.module === 'string') targets.push({ field: 'module', value: pkg.module });
  if (typeof pkg.types === 'string') targets.push({ field: 'types', value: pkg.types });
  if (typeof pkg.bin === 'string') targets.push({ field: 'bin', value: pkg.bin });
  if (pkg.bin !== null && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
    for (const [name, value] of Object.entries(pkg.bin)) {
      if (typeof value === 'string') targets.push({ field: `bin.${name}`, value });
    }
  }

  const walkExports = (node, depth) => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (typeof node === 'string') {
      targets.push({ field: 'exports', value: node });
      return;
    }
    for (const value of Object.values(node)) walkExports(value, depth + 1);
  };
  if (pkg.exports !== undefined) walkExports(pkg.exports, 0);

  return targets.filter((target) => !target.value.startsWith('node:'));
}

function collectRunReferences(command) {
  const referenced = new Set();
  const patterns = [
    /\b(?:npm|pnpm)\s+run(?:-script)?\s+([A-Za-z0-9:._-]+)/g,
    /\byarn\s+(?:run\s+)?([A-Za-z0-9:._-]+)/g,
    /\brun-script\s+([A-Za-z0-9:._-]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) referenced.add(match[1]);
  }
  return referenced;
}

const FAILURE_SWALLOWING = [/\|\|\s*true\b/, /\|\|\s*:\s*$/, /\|\|\s*exit\s+0\b/, /;\s*exit\s+0\b/, /;\s*true\b/, /--ignore-scripts\s*\|\|\s*true/];

function workspaceGlobs(pkg) {
  if (pkg === null || pkg === undefined) return [];
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg.workspaces !== null && typeof pkg.workspaces === 'object' && Array.isArray(pkg.workspaces.packages)) {
    return pkg.workspaces.packages;
  }
  return [];
}

/** Very small gitignore subset: literal names and `dir/` style patterns. */
function gitignoreMatcher(text) {
  if (text === null) return () => false;
  const patterns = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const body = trimmed.replace(/^\//, '');
    if (body.endsWith('/')) patterns.push(globToRegExp(`${body}**`));
    else if (body.includes('/')) patterns.push(globToRegExp(body));
    else patterns.push(globToRegExp(body), globToRegExp(`**/${body}`));
  }
  return (relativePath) => patterns.some((pattern) => pattern.test(relativePath));
}

function ltsLabel(major) {
  if (major < 20 || major % 2 === 1) return null;
  return LTS_CODENAMES[major] ?? `lts-line-${major}`;
}

async function collectLockfiles(root) {
  const found = [];
  for (const entry of LOCKFILES) {
    if (await exists(path.join(root, entry.file))) found.push({ file: entry.file, manager: entry.manager });
  }
  return found;
}

async function readVersionFiles(root) {
  const files = ['.nvmrc', '.node-version', '.tool-versions', 'mise.toml'];
  const present = [];
  for (const file of files) {
    if (await exists(path.join(root, file))) present.push(file);
  }
  return present;
}

function splitPackageManager(field) {
  if (typeof field !== 'string') return null;
  const trimmed = field.trim();
  const at = trimmed.lastIndexOf('@');
  const name = at > 0 ? trimmed.slice(0, at) : trimmed;
  const version = at > 0 ? trimmed.slice(at + 1) : null;
  return { name: name.toLowerCase(), version };
}

async function inspectEnv(root, extraNames, hasEnvFile, limits, report) {
  const documented = new Set();
  const exampleFiles = [];
  for (const file of ENV_EXAMPLE_FILES) {
    const text = await readTextIfPresent(path.join(root, file));
    if (text === null) continue;
    exampleFiles.push(file);
    for (const name of parseEnvFile(text)) documented.add(name);
  }

  const source = await readSourceEnvNames(root, limits);
  const used = new Map(source.names);

  const required = new Set([...documented, ...used.keys(), ...extraNames]);
  const missing = [];
  const unset = [];
  const empty = [];
  for (const name of [...required].sort()) {
    const value = Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined;
    if (value === undefined) {
      missing.push(name);
      unset.push(name);
    } else if (value === '') {
      missing.push(name);
      empty.push(name);
    }
  }

  const unusedDocumented = [...documented].filter((name) => !used.has(name)).sort();

  for (const name of unusedDocumented) {
    report.add(
      'ENV_DOCUMENTED_UNUSED',
      'info',
      `documented in an env example but never read by any source file`,
      name,
    );
  }
  for (const name of [...used.keys()].sort()) {
    if (documented.has(name)) continue;
    report.add(
      'ENV_USED_UNDOCUMENTED',
      'warning',
      `read by ${used.get(name)} but absent from every .env example`,
      name,
    );
  }
  for (const name of unset.sort()) {
    report.add('ENV_UNSET', 'warning', 'required variable is not present in the current environment', name);
  }
  for (const name of empty.sort()) {
    report.add('ENV_EMPTY', 'info', 'required variable is set but empty; the process cannot distinguish unset from blank', name);
  }
  if (exampleFiles.length === 0) {
    report.add(
      'ENV_NO_EXAMPLE',
      hasEnvFile ? 'warning' : 'info',
      hasEnvFile
        ? '.env exists but no .env.example documents which variables it must contain'
        : 'no .env.example / .env.sample / .env.template in the project root',
      hasEnvFile ? '.env' : 'root',
    );
  }
  if (source.truncated) {
    report.add('ENV_SOURCE_SCAN_TRUNCATED', 'info', 'source scan hit a file or byte cap; env usage may be incomplete', 'source');
  }
  if (used.size === 0) {
    report.add('ENV_NO_SOURCE_USAGE', 'info', 'no process.env or import.meta.env reads found in scanned source files', 'source');
  }

  return {
    documented: [...documented].sort(),
    required_by_source: [...used.keys()].sort(),
    missing,
    unused_documented: unusedDocumented,
    empty,
    unset,
    example_files: exampleFiles,
    source_files_scanned: source.files_scanned,
    source_files_matched: source.files_matched,
    source_scan_truncated: source.truncated,
    state: Object.fromEntries([...required].sort().map((name) => {
      const present = Object.prototype.hasOwnProperty.call(process.env, name);
      if (!present) return [name, 'unset'];
      return [name, process.env[name] === '' ? 'empty' : 'set'];
    })),
  };
}

async function inspectLocalFiles(root, report) {
  const gitignoreText = await readTextIfPresent(path.join(root, '.gitignore'));
  const isIgnored = gitignoreMatcher(gitignoreText);
  const hasEnv = await exists(path.join(root, '.env'));

  if (gitignoreText === null) {
    report.add('GITIGNORE_MISSING', 'error', 'no .gitignore in the project root', '.gitignore');
    return { gitignore: false, env_file_present: hasEnv };
  }
  if (!isIgnored('node_modules')) {
    report.add('GITIGNORE_MISSING_NODE_MODULES', 'error', '.gitignore does not cover node_modules', '.gitignore');
  }
  if (hasEnv && !isIgnored('.env') && !isIgnored('.env*')) {
    report.add('ENV_NOT_IGNORED', 'error', '.env exists but the .gitignore does not exclude it', '.env');
  }

  return { gitignore: true, env_file_present: hasEnv };
}

async function inspectPackage(root, report) {
  const packageFile = path.join(root, 'package.json');
  const read = await readJsonIfPresent(packageFile);

  if (!read.present) {
    report.add('NO_PACKAGE_JSON', 'error', 'package.json was not found', 'package.json');
    return null;
  }
  if (read.error !== null) {
    report.add('INVALID_PACKAGE_JSON', 'error', `package.json is not valid JSON: ${read.error}`, 'package.json');
    return null;
  }

  const pkg = read.value;
  const isPrivate = pkg.private === true;
  const lockfiles = await collectLockfiles(root);

  if (typeof pkg.name !== 'string' || pkg.name === '') {
    report.add('PACKAGE_NAME_MISSING', isPrivate ? 'warning' : 'error', 'package.json has no name field', 'package.json');
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    report.add('PACKAGE_VERSION_MISSING', 'warning', 'package.json has no version field', 'package.json');
  }
  if (typeof pkg.license !== 'string' && !isPrivate) {
    report.add('PACKAGE_LICENSE_MISSING', 'warning', 'non-private package without a license field', 'package.json');
  }
  if (typeof pkg.type !== 'string') {
    report.add('PACKAGE_TYPE_MISSING', 'warning', 'no "type" field: .js is treated as CommonJS, which surprises ESM authors', 'package.json');
  }
  if (!isPrivate && typeof pkg.main !== 'string' && pkg.exports === undefined) {
    report.add('PACKAGE_ENTRY_MISSING', 'warning', 'non-private package declares neither main nor exports', 'package.json');
  }

  const declared = pkg.packageManager;
  const parsedManager = splitPackageManager(declared);
  if (declared !== undefined && typeof declared !== 'string') {
    report.add('PACKAGE_MANAGER_INVALID', 'error', 'packageManager must be a string', 'package.json');
  } else if (parsedManager !== null && !KNOWN_PACKAGE_MANAGERS.includes(parsedManager.name)) {
    report.add('PACKAGE_MANAGER_UNKNOWN', 'error', `packageManager names an unsupported package manager: ${parsedManager.name}`, 'package.json');
  }

  if (lockfiles.length === 0) {
    report.add('NO_LOCKFILE', 'info', 'no lockfile found; installs are not reproducible', 'root');
  } else {
    const lockfileNames = lockfiles.map((lock) => lock.file).join(', ');
    const managers = new Set(lockfiles.map((lock) => lock.manager));
    if (managers.size > 1) {
      report.add(
        'LOCKFILE_CONFLICT',
        'error',
        `multiple lockfiles from different package managers: ${lockfileNames}`,
        lockfileNames,
      );
    }
    if (parsedManager !== null && !managers.has(parsedManager.name)) {
      report.add(
        'PACKAGE_MANAGER_MISMATCH',
        'warning',
        `packageManager declares ${parsedManager.name} but the lockfile present belongs to ${[...managers].join(' or ')}`,
        lockfileNames,
      );
    }
  }

  for (const target of collectEntryTargets(pkg)) {
    const relative = target.value.replace(/^\.\//, '');
    if (relative === '') continue;
    if (!(await exists(path.join(root, relative)))) {
      report.add('ENTRYPOINT_MISSING', 'error', `${target.field} points at a file that does not exist`, target.value);
    }
  }

  const dependencyCount = Object.keys(pkg.dependencies ?? {}).length +
    Object.keys(pkg.devDependencies ?? {}).length;
  if (dependencyCount > 0 && !(await exists(path.join(root, 'node_modules')))) {
    report.add('DEPENDENCIES_NOT_INSTALLED', 'warning', `${dependencyCount} dependencies are declared but node_modules is absent; run an install`, 'node_modules');
  }

  return { pkg, lockfiles, declaredManager: parsedManager, dependencyCount, isPrivate };
}

async function inspectScripts(pkg, report) {
  const scripts = pkg?.scripts ?? {};
  const names = Object.keys(scripts);
  const dangling = new Set();
  const swallowing = [];

  for (const name of names) {
    const command = String(scripts[name] ?? '');
    for (const reference of collectRunReferences(command)) {
      if (reference === name) continue;
      if (!Object.prototype.hasOwnProperty.call(scripts, reference)) dangling.add(reference);
    }
    if (FAILURE_SWALLOWING.some((pattern) => pattern.test(command))) swallowing.push(name);
  }

  for (const reference of [...dangling].sort()) {
    report.add('SCRIPT_REFERENCE_MISSING', 'error', 'a script invokes another script that does not exist', reference);
  }
  for (const name of swallowing.sort()) {
    report.add('SCRIPT_SWALLOWS_FAILURE', 'warning', 'script masks failures (`|| true`, `; exit 0`), so CI cannot trust it', name);
  }
  if (scripts.build !== undefined && scripts.test === undefined) {
    report.add('SCRIPT_TEST_MISSING', 'warning', 'scripts.build exists but scripts.test does not', 'package.json');
  }
  if (names.length === 0) {
    report.add('SCRIPT_NONE', 'info', 'package.json declares no scripts', 'package.json');
  }

  return { names: names.sort(), count: names.length, dangling_references: [...dangling].sort(), failure_swallowing: swallowing.sort() };
}

async function inspectWorkspace(root, pkg, report) {
  const globs = workspaceGlobs(pkg);
  if (globs.length === 0) {
    return { declared: [], matched: [], unmatched: [] };
  }

  const matchers = globs.map((glob) => globToRegExp(glob.replace(/\/$/, '')));
  const matched = new Set();
  const queue = [''];
  while (queue.length > 0) {
    const relativeDir = queue.shift();
    const absoluteDir = relativeDir === '' ? root : path.join(root, relativeDir);
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (relativePath.split('/').some((segment) => SOURCE_SKIP_DIRS.has(segment))) continue;
      if (matchesGlob(relativePath, matchers)) matched.add(relativePath);
      queue.push(relativePath);
    }
  }

  const matchedList = [...matched].sort();
  const unmatched = globs.filter((_, index) => !matchedList.some((dir) => matchers[index].test(dir)));
  for (const glob of unmatched) {
    report.add('WORKSPACE_GLOB_UNMATCHED', 'error', 'workspaces glob matches no directory', glob);
  }
  if (matchedList.length === 0) {
    report.add('WORKSPACE_NONE_MATCHED', 'error', 'no workspace glob matched a directory', 'package.json');
  }

  return { declared: globs, matched: matchedList, unmatched };
}

function inspectNode(pkg, versionFiles, report) {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0], 10);
  const engines = pkg?.engines;
  const nodeRange = typeof engines?.node === 'string' ? engines.node : null;
  let satisfies = null;
  let minimum = null;

  if (nodeRange !== null) {
    try {
      satisfies = semver.satisfies(version, nodeRange, { includePrerelease: true });
      minimum = semver.minVersion(nodeRange);
    } catch {
      report.add('ENGINE_RANGE_INVALID', 'warning', 'engines.node is not a valid semver range', nodeRange);
    }
    if (satisfies === false) {
      report.add('ENGINE_NODE_UNSATISFIED', 'error', `engines.node is not satisfied by the running Node ${version}`, nodeRange);
    } else if (minimum !== null && major < minimum.major) {
      report.add('NODE_VERSION_SKEW', 'warning', `running Node ${version} is older than the declared minimum ${minimum.version}`, nodeRange);
    }
  }

  if (nodeRange !== null && versionFiles.length === 0) {
    report.add(
      'ENGINE_VERSION_FILE_MISSING',
      'warning',
      'engines.node is declared but the repository pins no Node version file, so contributors drift',
      'root',
    );
  }

  return {
    version,
    major,
    lts: ltsLabel(major),
    satisfies_engines: satisfies,
    engines_node: nodeRange,
    version_files: versionFiles,
  };
}

async function runCheck(flags, positionals, { envOnly = false } = {}) {
  if (positionals.length > 1) {
    throw new Error(`this command takes at most one directory, got ${positionals.length}`);
  }

  const target = positionals[0] ?? '.';
  const root = path.resolve(target);
  const stats = await fs.stat(root).catch(() => null);
  if (stats === null) throw new Error(`directory not found: ${target}`);
  if (!stats.isDirectory()) throw new Error(`not a directory: ${target}`);

  const extraNames = listFlag(flags, 'env-names') ?? [];
  for (const name of extraNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`--env-names contains an invalid variable name: ${name}`);
  }

  const failOn = enumFlag(flags, 'fail-on', ['error', 'warning', 'none'], DEFAULTS.failOn);
  const report = makeReport(root);

  const inspected = envOnly ? null : await inGroup(report, 'package', () => inspectPackage(root, report));
  const pkg = inspected?.pkg ?? null;
  const hasEnvFile = await exists(path.join(root, '.env'));
  const sourceLimits = {
    maxFiles: intFlag(flags, 'max-source-files', SOURCE_LIMITS.maxFiles, { min: 1 }),
    maxFileBytes: intFlag(flags, 'max-source-bytes', SOURCE_LIMITS.maxFileBytes, { min: 1 }),
    maxTotalBytes: intFlag(flags, 'max-total-source-bytes', SOURCE_LIMITS.maxTotalBytes, { min: 1 }),
  };
  const env = await inGroup(report, 'env', () => inspectEnv(root, extraNames, hasEnvFile, sourceLimits, report));

  let node = null;
  let scripts = null;
  let workspace = null;
  let files = null;

  if (!envOnly) {
    const versionFiles = await readVersionFiles(root);
    node = await inGroup(report, 'node', async () => inspectNode(pkg, versionFiles, report));
    scripts = await inGroup(report, 'scripts', () => inspectScripts(pkg, report));
    workspace = await inGroup(report, 'workspace', () => inspectWorkspace(root, pkg, report));
    files = await inGroup(report, 'files', () => inspectLocalFiles(root, report));
  }

  const summary = { errors: 0, warnings: 0, infos: 0, passed: 0 };
  for (const finding of report.findings) {
    if (finding.severity === 'error') summary.errors += 1;
    else if (finding.severity === 'warning') summary.warnings += 1;
    else summary.infos += 1;
  }
  const activeGroups = envOnly ? ['env'] : DIAGNOSTIC_GROUPS;
  summary.passed = activeGroups.filter((group) => report.groups.get(group).errors === 0).length;

  const data = envOnly
    ? { project: root, env, findings: report.findings, summary }
    : {
      project: root,
      node,
      package: {
        name: pkg?.name ?? null,
        version: pkg?.version ?? null,
        type: pkg?.type ?? null,
        license: pkg?.license ?? null,
        private: inspected?.isPrivate ?? null,
        package_manager: inspected?.declaredManager?.name ??
          (inspected?.lockfiles[0]?.manager ?? null),
        package_manager_version: inspected?.declaredManager?.version ?? null,
        lockfiles: inspected?.lockfiles.map((lock) => lock.file) ?? [],
        dependencies_declared: inspected?.dependencyCount ?? 0,
        entrypoints: collectEntryTargets(pkg ?? {}).map((target) => `${target.field}=${target.value}`),
      },
      scripts,
      env,
      workspace,
      files,
      findings: report.findings,
      summary,
    };

  if (flags['json-summary'] === true) {
    printData({
      project: root,
      summary,
      findings: report.findings.map((finding) => ({ code: finding.code, severity: finding.severity })),
    });
  } else {
    printData(data);
  }

  if (failOn !== 'none') {
    const threshold = SEVERITY_RANK[failOn];
    const triggered = report.findings.some((finding) => SEVERITY_RANK[finding.severity] >= threshold);
    if (triggered) process.exitCode = 1;
  }
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  if (flags.version === true) {
    printData({ name: '@unreadlogs/skill-env-doctor', version: VERSION });
    return;
  }
  if (flags.help === true || positionals[0] === 'help') {
    printData({ usage: USAGE });
    return;
  }

  const [command, ...rest] = positionals;
  switch (command) {
    case 'check':
      await runCheck(flags, rest);
      return;
    case 'env':
      await runCheck(flags, rest, { envOnly: true });
      return;
    default:
      throw new Error(`unknown command: ${command ?? '(none)'}\n\n${USAGE}`);
  }
}

main().catch((error) => fail(error));