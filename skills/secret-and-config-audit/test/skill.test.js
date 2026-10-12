import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

const PLANTED = {
  stripe: 'sk_live_51AbCdEfGhIjKlMnOpQr',
  github: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  dbPassword: 's3cr3tP4ssw0rd',
  anthropic: 'sk-ant-api03-QQQQWWWWEEEERRRRTTTTYYYY1234',
};

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
  assert.equal(result.stderr === '' || options.allowStderr, true, `unexpected stderr: ${result.stderr}`);
  return result;
}

function runData(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.status, 0, `${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

async function withFixture(body) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-secrets-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function buildProject(dir) {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'keys'), { recursive: true });

  await writeFile(
    path.join(dir, 'src', 'billing.js'),
    [
      `const stripeKey = '${PLANTED.stripe}';`,
      `const openai = '${PLANTED.anthropic}';`,
      `const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';`,
      'const password = process.env.DB_PASSWORD;',
      "const apiKey = 'your-api-key-here';",
      "const token = '<REDACTED>';",
      '',
    ].join('\n'),
  );

  await writeFile(
    path.join(dir, 'src', 'ci.env'),
    [
      'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      `DATABASE_URL=postgres://admin:${PLANTED.dbPassword}@db.internal:5432/app`,
      'EXAMPLE_API_KEY=example-key-not-real-1234',
      '',
    ].join('\n'),
  );

  await writeFile(
    path.join(dir, 'keys', 'deploy.pem'),
    `${'-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n'}\n-----END RSA PRIVATE KEY-----\n`,
  );
  await writeFile(path.join(dir, 'keys', 'pgp.key'), '-----BEGIN PGP PRIVATE KEY BLOCK-----\n');
  await writeFile(path.join(dir, 'keys', 'tls.crt'), '-----BEGIN CERTIFICATE-----\nMIIB\n');
  await writeFile(path.join(dir, 'src', 'notes.md'), 'Set `password: use a strong password here` in production.\n');
}

test('--help prints usage as JSON and exits 0', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout).data;
  assert.match(data.usage, /scan \[dir\]/);
  assert.match(data.usage, /--max-file-bytes/);
});

test('--version prints the package name and version', () => {
  const data = runData(['--version']);
  assert.equal(data.name, '@unreadlogs/skill-secret-and-config-audit');
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
});

test('scan reports named rules and never prints a secret value', async () => {
  await withFixture(async (dir) => {
    await buildProject(dir);
    const result = run(['scan', dir]);
    assert.equal(result.status, 0);
    const data = JSON.parse(result.stdout).data;

    for (const value of Object.values(PLANTED)) {
      assert.equal(result.stdout.includes(value), false, `secret leaked into stdout: ${value}`);
    }

    const rules = data.findings.map((finding) => finding.rule);
    assert.ok(rules.includes('stripe-key'), 'expected stripe-key');
    assert.ok(rules.includes('anthropic-key'), 'expected anthropic-key');
    assert.ok(rules.includes('github-token'), 'expected github-token');
    assert.ok(rules.includes('credential-uri'), 'expected credential-uri');
    assert.ok(rules.includes('jwt'), 'expected jwt');
    assert.ok(rules.includes('private-key'), 'expected private-key');
    assert.ok(rules.includes('certificate'), 'expected certificate');

    const severityOf = (id) => data.findings.find((finding) => finding.rule === id).severity;
    assert.equal(severityOf('private-key'), 'high');
    assert.equal(severityOf('credential-uri'), 'high');
    assert.equal(severityOf('jwt'), 'medium');
    assert.equal(severityOf('certificate'), 'low');

    for (const finding of data.findings) {
      assert.match(finding.match, /^[^\u2026]{4}\u2026[^\u2026]{4}$/, `match must be masked: ${finding.match}`);
      assert.equal(finding.evidence.includes('[redacted]'), true);
      assert.ok(finding.line > 0 && finding.column > 0);
      assert.equal(finding.evidence.includes(PLANTED.dbPassword), false);
    }
    assert.deepEqual(
      data.findings.map((finding) => finding.evidence),
      data.findings.map((finding) => finding.evidence.replace(/sk_live_51AbCdEfGhIjKlMnOpQr|sk-ant-api03-QQQQWWWWEEEERRRRTTTTYYYY1234|ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789|eyJhbGciOiJIUzI1NiJ9[^']*|-----BEGIN RSA PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----|-----BEGIN CERTIFICATE-----|postgres:\/\/admin:s3cr3tP4ssw0rd@db.internal:5432\/app/g, '[redacted]')),
      'evidence must contain nothing but the redacted marker',
    );

    assert.equal(data.counts.by_severity.high >= 3, true);
    assert.equal(data.exit_recommended, true);
    assert.ok(data.files_scanned >= 6);
    assert.ok(data.bytes_scanned > 0);

    const placeholderRules = data.placeholders_sample.map((entry) => entry.reason);
    assert.ok(placeholderRules.includes('env-reference'), 'process.env.DB_PASSWORD is a placeholder');
    assert.equal(data.findings.some((finding) => finding.evidence.includes('your-api-key-here')), false);
  });
});

test('documentation prose and placeholders are not reported as findings', async () => {
  await withFixture(async (dir) => {
    await writeFile(path.join(dir, 'README.md'), [
      'Set `password: use-a-strong-password-here` in production.',
      'Set `api_key: ${STRIPE_KEY}` for the live account.',
      'A token looks like AKIAIOSFODNN7EXAMPLE in the AWS docs.',
      'While testing, set `token: xxxxxxxxxxxxxxxxxxxxxxxx`.',
      '',
    ].join('\n'));
    await writeFile(path.join(dir, '.env.example'), 'API_KEY=changeme-before-deploy\nTOKEN=<REDACTED-TOKEN-VALUE>\n');
    const data = runData(['scan', dir, '--no-gitignore']);
    assert.deepEqual(data.findings, []);
    assert.ok(data.counts.placeholder >= 5, `expected placeholders, got ${data.counts.placeholder}`);
    const reasons = data.placeholders_sample.map((entry) => entry.reason);
    assert.ok(reasons.includes('prose'));
    assert.ok(reasons.includes('shell-expansion'));
    assert.ok(reasons.includes('example'));
    assert.ok(reasons.includes('x-mask'));
    assert.ok(reasons.includes('changeme'));
    assert.ok(reasons.includes('redacted'));
  });
});

test('binary files are skipped, symlinks are refused and reported', async () => {
  await withFixture(async (dir) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'skill-secrets-outside-'));
    try {
      await writeFile(path.join(outside, 'leaked.env'), `API_KEY=${PLANTED.stripe}\n`);
      await writeFile(path.join(dir, 'blob.txt'), `binary\x00${PLANTED.github}`);
      await symlink(dir, path.join(dir, 'self'));
      await symlink(outside, path.join(dir, 'escape'));

      const data = runData(['scan', dir]);
      assert.equal(data.skipped.binary, 1);
      assert.equal(data.symlinks.count, 2);
      assert.ok(data.symlinks.sample.includes('escape'));
      assert.deepEqual(data.findings, [], 'symlinked and binary files must not be scanned');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('documented limits truncate the scan', async () => {
  await withFixture(async (dir) => {
    await buildProject(dir);

    const fileLimited = runData(['scan', dir, '--max-file-bytes', '20']);
    assert.ok(fileLimited.skipped.too_large > 0);
    assert.equal(fileLimited.truncated, false, 'size skips are not truncation');

    const countLimited = runData(['scan', dir, '--max-files', '2']);
    assert.equal(countLimited.files_scanned, 2);
    assert.equal(countLimited.truncated, true);

    const findingLimited = runData(['scan', dir, '--max-findings', '1']);
    assert.equal(findingLimited.findings.length, 1);
    assert.equal(findingLimited.truncated, true);
  });
});

test('filters narrow the report: --min-severity, --rules, --exclude, --include', async () => {
  await withFixture(async (dir) => {
    await buildProject(dir);

    const highOnly = runData(['scan', dir, '--min-severity', 'high']);
    assert.ok(highOnly.findings.length > 0);
    assert.equal(highOnly.findings.every((finding) => finding.severity === 'high'), true);

    const singleRule = runData(['scan', dir, '--rules', 'jwt']);
    assert.deepEqual(singleRule.findings.map((finding) => finding.rule), ['jwt']);

    const excluded = runData(['scan', dir, '--exclude', 'src/*', '--no-gitignore']);
    assert.ok(excluded.skipped.excluded > 0);
    assert.equal(excluded.findings.every((finding) => !finding.file.startsWith('src/')), true);

    await writeFile(path.join(dir, 'extra.custom'), `API_KEY=${PLANTED.stripe}\n`);
    assert.equal(runData(['scan', dir, '--no-gitignore']).findings.some((f) => f.file === 'extra.custom'), false);
    const included = runData(['scan', dir, '--include', '*.custom', '--no-gitignore']);
    assert.equal(included.findings.some((f) => f.file === 'extra.custom'), true);
  });
});

test('gitignore is honoured through the fallback reader outside a git work tree', async () => {
  await withFixture(async (dir) => {
    await writeFile(path.join(dir, '.gitignore'), 'secrets/\n*.pem\n');
    await mkdir(path.join(dir, 'secrets'), { recursive: true });
    await writeFile(path.join(dir, 'secrets', 'prod.env'), `API_KEY=${PLANTED.stripe}\n`);
    await writeFile(path.join(dir, 'server.pem'), '-----BEGIN RSA PRIVATE KEY-----');

    const respected = runData(['scan', dir]);
    assert.notEqual(respected.gitignore.mode, 'disabled');
    assert.ok(respected.gitignore.files_ignored >= 2);
    assert.deepEqual(respected.findings, []);

    const ignored = runData(['scan', dir, '--no-gitignore']);
    assert.equal(ignored.gitignore.mode, 'disabled');
    assert.deepEqual(
      ignored.findings.map((finding) => finding.rule).sort(),
      ['assigned-secret', 'private-key', 'stripe-key'],
    );
  });
});

test('node_modules and build output are skipped by default', async () => {
  await withFixture(async (dir) => {
    await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(dir, '.next'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), `const k='${PLANTED.stripe}';`);
    await writeFile(path.join(dir, '.next', 'build.js'), `const k='${PLANTED.stripe}';`);
    await writeFile(path.join(dir, 'app.js'), `const k='${PLANTED.stripe}';`);
    const data = runData(['scan', dir, '--no-gitignore']);
    assert.deepEqual(data.findings.map((finding) => finding.file), ['app.js']);
  });
});

test('rules lists every rule with severity and false-positive notes', () => {
  const data = runData(['rules']);
  assert.ok(data.count >= 20);
  for (const rule of data.rules) {
    assert.equal(typeof rule.id, 'string');
    assert.ok(['high', 'medium', 'low'].includes(rule.severity), rule.id);
    assert.ok(rule.pattern.length > 10, rule.id);
    assert.ok(rule.false_positives.length > 10, rule.id);
  }
  assert.ok(data.placeholders.includes('example'));
});

test('--fail-on high exits 1 with the report on stdout and an empty stderr', async () => {
  await withFixture(async (dir) => {
    await writeFile(path.join(dir, 'ci.env'), `GITHUB_TOKEN=${PLANTED.github}\n`);
    const result = run(['scan', dir, '--fail-on', 'high']);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).data.exit_recommended, true);
  });

  await withFixture(async (dir) => {
    await writeFile(path.join(dir, 'index.js'), 'export const answer = 42;\n');
    const result = run(['scan', dir, '--fail-on', 'high']);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout).data.findings, []);
  });
});

test('malformed input returns a structured error on stderr', async () => {
  await withFixture(async (dir) => {
    const missing = run(['scan', path.join(dir, 'nope')], { allowStderr: true });
    assert.equal(missing.status, 1);
    assert.match(JSON.parse(missing.stderr).error, /directory not found/);

    await writeFile(path.join(dir, 'file.txt'), 'x');
    const notADirectory = run(['scan', path.join(dir, 'file.txt')], { allowStderr: true });
    assert.equal(notADirectory.status, 1);
    assert.match(JSON.parse(notADirectory.stderr).error, /not a directory/);

    const badCommand = run(['wat'], { allowStderr: true });
    assert.equal(badCommand.status, 1);
    assert.match(JSON.parse(badCommand.stderr).error, /unknown command/);

    const badSeverity = run(['scan', dir, '--min-severity', 'urgent'], { allowStderr: true });
    assert.equal(badSeverity.status, 1);
    assert.match(JSON.parse(badSeverity.stderr).error, /--min-severity must be one of/);

    const badRule = run(['scan', dir, '--rules', 'nope'], { allowStderr: true });
    assert.equal(badRule.status, 1);
    assert.match(JSON.parse(badRule.stderr).error, /unknown rule id/);

    const badNumber = run(['scan', dir, '--max-files', 'many'], { allowStderr: true });
    assert.equal(badNumber.status, 1);
    assert.match(JSON.parse(badNumber.stderr).error, /--max-files must be an integer/);

    const tooManyArgs = run(['scan', dir, dir], { allowStderr: true });
    assert.equal(tooManyArgs.status, 1);
    assert.match(JSON.parse(tooManyArgs.stderr).error, /at most one directory/);
  });
});