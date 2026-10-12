import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'index.js');

const SECRET_VALUE = 'sk_live_TESTONLY_9f8e7d6c5b4a3210';

/**
 * Tests must not depend on the developer's shell, so every run gets an
 * explicit, minimal environment.
 */
function testEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    ...extra,
  };
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: testEnv(options.env),
    ...options,
  });
  if (!options.allowStderr) {
    assert.equal(result.stderr, '', `unexpected stderr: ${result.stderr}`);
  }
  return result;
}

function runData(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

async function withProject(build) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-env-'));
  try {
    await build(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function buildBrokenProject(dir) {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    `${JSON.stringify({
      name: 'demo-service',
      version: '2.1.0',
      type: 'module',
      license: 'MIT',
      main: 'dist/index.js',
      packageManager: 'yarn@4.1.0',
      engines: { node: '>=99.0.0' },
      workspaces: ['packages/*'],
      scripts: {
        build: 'npm run compile',
        compile: 'tsc || true',
        release: 'npm run publish && npm run nope',
      },
      dependencies: { 'left-pad': '^1.0.0' },
    }, null, 2)}\n`,
  );
  await writeFile(path.join(dir, 'package-lock.json'), '{\n  "lockfileVersion": 3\n}\n');
  await writeFile(path.join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  await writeFile(path.join(dir, '.gitignore'), 'dist/\n');
  await writeFile(path.join(dir, '.env'), `DATABASE_URL=postgres://u:${SECRET_VALUE}@host/db\n`);
  await writeFile(path.join(dir, '.env.example'), 'export API_KEY=\n# COMMENTED_OUT=yes\nPORT=\n');
  await writeFile(
    path.join(dir, 'src', 'server.js'),
    [
      `const key = process.env.API_KEY;`,
      `const port = process.env['PORT'];`,
      `const session = import.meta.env.SESSION_SECRET;`,
      `const db = process.env.DATABASE_URL;`,
      '',
    ].join('\n'),
  );
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

test('--help prints usage as JSON and exits 0', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout).data;
  assert.match(data.usage, /check \[dir\]/);
  assert.match(data.usage, /--env-names/);
});

test('--version prints the package name and version', () => {
  const data = runData(['--version']);
  assert.equal(data.name, '@unreadlogs/skill-env-doctor');
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
});

test('check reports package, script, workspace and env defects', async () => {
  await withProject(async (dir) => {
    await buildBrokenProject(dir);
    const result = run(['check', dir], { env: { API_KEY: 'set-but-secret', PORT: '', SESSION_SECRET: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(SECRET_VALUE), false, 'an env value leaked into stdout');

    const data = JSON.parse(result.stdout).data;
    const found = codes(data.findings);

    for (const code of [
      'LOCKFILE_CONFLICT',
      'PACKAGE_MANAGER_MISMATCH',
      'ENTRYPOINT_MISSING',
      'DEPENDENCIES_NOT_INSTALLED',
      'ENGINE_NODE_UNSATISFIED',
      'ENGINE_VERSION_FILE_MISSING',
      'SCRIPT_REFERENCE_MISSING',
      'SCRIPT_SWALLOWS_FAILURE',
      'SCRIPT_TEST_MISSING',
      'WORKSPACE_GLOB_UNMATCHED',
      'GITIGNORE_MISSING_NODE_MODULES',
      'ENV_NOT_IGNORED',
      'ENV_USED_UNDOCUMENTED',
    ]) {
      assert.ok(found.includes(code), `expected ${code}, got ${JSON.stringify(found)}`);
    }

    const byCode = (code) => data.findings.find((finding) => finding.code === code);
    assert.equal(byCode('LOCKFILE_CONFLICT').evidence, 'package-lock.json, pnpm-lock.yaml');
    assert.equal(byCode('SCRIPT_REFERENCE_MISSING').evidence, 'nope');
    assert.equal(byCode('SCRIPT_SWALLOWS_FAILURE').evidence, 'compile');
    assert.equal(byCode('WORKSPACE_GLOB_UNMATCHED').evidence, 'packages/*');
    assert.deepEqual(
      data.findings.filter((finding) => finding.code === 'ENV_USED_UNDOCUMENTED').map((finding) => finding.evidence),
      ['DATABASE_URL', 'SESSION_SECRET'],
    );
    assert.equal(byCode('ENTRYPOINT_MISSING').evidence, 'dist/index.js');
    assert.equal(byCode('ENV_NOT_IGNORED').severity, 'error');
    assert.equal(byCode('LOCKFILE_CONFLICT').severity, 'error');

    assert.deepEqual(data.package.lockfiles, ['package-lock.json', 'pnpm-lock.yaml']);
    assert.equal(data.package.package_manager, 'yarn');
    assert.equal(data.package.package_manager_version, '4.1.0');
    assert.deepEqual(data.scripts.dangling_references, ['nope', 'publish']);
    assert.equal(data.scripts.names.includes('release'), true);
    assert.deepEqual(data.workspace.declared, ['packages/*']);
    assert.deepEqual(data.workspace.matched, []);

    assert.equal(data.node.satisfies_engines, false);
    assert.deepEqual(data.node.version_files, []);
    assert.equal(data.node.lts !== null, data.node.major >= 20 && data.node.major % 2 === 0);
    assert.equal(data.node.major, Number.parseInt(process.versions.node.split('.')[0], 10));
    assert.ok(data.summary.errors >= 3);
    assert.ok(data.summary.warnings >= 5);
    assert.ok(data.summary.passed < 6);
  });
});

test('env reconciliation separates unset from empty and never prints a value', async () => {
  await withProject(async (dir) => {
    await buildBrokenProject(dir);
    const result = run(['env', dir, '--env-names', 'REQUIRED_EXTRA'], {
      env: { API_KEY: 'set-but-secret', PORT: '', DATABASE_URL: 'x' },
    });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout).data;

    assert.equal(result.stdout.includes('set-but-secret'), false);
    assert.equal(result.stdout.includes(SECRET_VALUE), false);
    assert.equal(data.package, undefined, 'env must not run package checks');

    assert.deepEqual(data.env.documented, ['API_KEY', 'PORT']);
    assert.deepEqual(data.env.required_by_source, ['API_KEY', 'DATABASE_URL', 'PORT', 'SESSION_SECRET']);
    assert.deepEqual(data.env.example_files, ['.env.example']);
    assert.equal(data.env.unused_documented.includes('API_KEY'), false);

    assert.ok(data.env.empty.includes('PORT'), 'an explicitly empty variable is empty, not unset');
    assert.equal(data.env.unset.includes('PORT'), false);
    assert.ok(data.env.unset.includes('SESSION_SECRET'));
    assert.ok(data.env.missing.includes('REQUIRED_EXTRA'));
    assert.equal(data.env.state.API_KEY, 'set');
    assert.equal(data.env.state.PORT, 'empty');
    assert.equal(data.env.state.SESSION_SECRET, 'unset');

    assert.ok(codes(data.findings).every((code) => code.startsWith('ENV_')));
    assert.ok(codes(data.findings).includes('ENV_EMPTY'));
    assert.ok(codes(data.findings).includes('ENV_UNSET'));
    assert.ok(codes(data.findings).includes('ENV_USED_UNDOCUMENTED'));
  });
});

test('export, quoted and commented env entries are parsed correctly', async () => {
  await withProject(async (dir) => {
    await writeFile(
      path.join(dir, '.env.example'),
      [
        '# COMMENTED_ONLY=nope',
        'export EXPORTED_NAME=',
        'QUOTED_NAME="value"',
        'lowercase_name=1',
        'not an assignment',
        '',
      ].join('\n'),
    );
    const data = runData(['env', dir]);
    assert.deepEqual(data.env.documented, ['EXPORTED_NAME', 'QUOTED_NAME', 'lowercase_name']);
    assert.ok(data.env.unused_documented.includes('EXPORTED_NAME'));
  });
});

test('documented source-scan limits are reported as truncation', async () => {
  await withProject(async (dir) => {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'a.js'), 'process.env.FIRST_FLAG;\n');
    await writeFile(path.join(dir, 'b.js'), 'process.env.SECOND_FLAG;\n');
    await writeFile(path.join(dir, 'c.js'), 'process.env.THIRD_FLAG;\n');

    const limited = runData(['env', dir, '--max-source-files', '1']);
    assert.equal(limited.env.source_files_scanned, 1);
    assert.equal(limited.env.source_scan_truncated, true);
    assert.equal(limited.env.required_by_source.includes('FIRST_FLAG'), true);
    assert.equal(limited.env.required_by_source.includes('THIRD_FLAG'), false);
    assert.ok(codes(limited.findings).includes('ENV_SOURCE_SCAN_TRUNCATED'));

    const byteLimited = runData(['env', dir, '--max-source-bytes', '4']);
    assert.equal(byteLimited.env.source_files_scanned, 0);
    assert.deepEqual(byteLimited.env.required_by_source, []);
  });
});

test('--json-summary emits codes only, and --fail-on controls the exit code', async () => {
  await withProject(async (dir) => {
    await buildBrokenProject(dir);
    const summary = runData(['check', dir, '--json-summary']);
    assert.equal(summary.package, undefined);
    assert.equal(summary.findings.every((finding) => typeof finding.code === 'string'), true);
    assert.equal(summary.findings.every((finding) => ['error', 'warning', 'info'].includes(finding.severity)), true);
    assert.ok(summary.summary.errors > 0);

    const failing = run(['check', dir, '--fail-on', 'error']);
    assert.equal(failing.status, 1);
    assert.equal(failing.stderr, '');
    assert.ok(JSON.parse(failing.stdout).data.findings.length > 0);

    const tolerated = run(['check', dir, '--fail-on', 'none']);
    assert.equal(tolerated.status, 0);

    const warningThreshold = run(['check', dir, '--fail-on', 'warning']);
    assert.equal(warningThreshold.status, 1);
  });
});

test('a healthy minimal project reports no errors', async () => {
  await withProject(async (dir) => {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'tiny',
        version: '1.0.0',
        type: 'module',
        license: 'MIT',
        exports: './src/index.js',
        engines: { node: '>=20' },
        scripts: { test: 'node --test' },
      }),
    );
    await writeFile(
      path.join(dir, 'src', 'index.js'),
      'export const answer = 42;\nexport const level = process.env.LOG_LEVEL;\n',
    );
    await writeFile(path.join(dir, 'package-lock.json'), '{}\n');
    await writeFile(path.join(dir, '.gitignore'), 'node_modules\n.env\n');
    await writeFile(path.join(dir, '.nvmrc'), '20\n');
    await writeFile(path.join(dir, '.env.example'), 'LOG_LEVEL=info\n');

    const data = runData(['check', dir], { env: { LOG_LEVEL: 'debug' } });
    const errors = data.findings.filter((finding) => finding.severity === 'error');
    assert.deepEqual(errors, [], JSON.stringify(data.findings));
    assert.equal(data.package.package_manager, 'npm');
    assert.equal(data.node.satisfies_engines, true);
    assert.deepEqual(data.node.version_files, ['.nvmrc']);
    assert.deepEqual(data.env.missing, []);
    assert.deepEqual(data.env.unused_documented, []);
  });
});

test('malformed input returns a structured error on stderr', async () => {
  await withProject(async (dir) => {
    const missingDir = run(['check', path.join(dir, 'nope')], { allowStderr: true });
    assert.equal(missingDir.status, 1);
    assert.match(JSON.parse(missingDir.stderr).error, /directory not found/);

    const badCommand = run(['nope', dir], { allowStderr: true });
    assert.equal(badCommand.status, 1);
    assert.match(JSON.parse(badCommand.stderr).error, /unknown command/);

    const badFlag = run(['check', dir, '--fail-on', 'sometimes'], { allowStderr: true });
    assert.equal(badFlag.status, 1);
    assert.match(JSON.parse(badFlag.stderr).error, /--fail-on must be one of/);

    const badName = run(['check', dir, '--env-names', 'not a name'], { allowStderr: true });
    assert.equal(badName.status, 1);
    assert.match(JSON.parse(badName.stderr).error, /invalid variable name/);

    const tooManyArgs = run(['check', dir, dir], { allowStderr: true });
    assert.equal(tooManyArgs.status, 1);
    assert.match(JSON.parse(tooManyArgs.stderr).error, /at most one directory/);
  });
});

test('invalid, absent and minimal package.json files are reported, not crashed on', async () => {
  await withProject(async (dir) => {
    await writeFile(path.join(dir, 'package.json'), '{ "name": "broken", ');
    const invalid = runData(['check', dir]);
    assert.equal(invalid.findings[0].code, 'INVALID_PACKAGE_JSON');
    assert.equal(invalid.findings[0].message.includes('not valid JSON'), true);
    assert.equal(
      invalid.findings.filter((finding) => finding.code === 'INVALID_PACKAGE_JSON').length,
      1,
    );
    assert.equal(invalid.summary.errors >= 1, true);
    assert.equal(invalid.package.name, null);
    assert.deepEqual(invalid.package.lockfiles, []);
  });

  await withProject(async (dir) => {
    const absent = runData(['check', dir]);
    assert.ok(codes(absent.findings).includes('NO_PACKAGE_JSON'));
    assert.equal(absent.package.name, null);
    assert.equal(absent.scripts.count, 0);
    assert.ok(codes(absent.findings).includes('GITIGNORE_MISSING'));
  });

  await withProject(async (dir) => {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', license: 'MIT' }));
    const bare = runData(['check', dir]);
    assert.ok(codes(bare.findings).includes('PACKAGE_TYPE_MISSING'));
    assert.ok(codes(bare.findings).includes('PACKAGE_ENTRY_MISSING'));
    assert.ok(codes(bare.findings).includes('NO_LOCKFILE'));
  });

  await withProject(async (dir) => {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', type: 'module', license: 'MIT', packageManager: 'cargo@1.0.0' }),
    );
    const unknown = runData(['check', dir]);
    assert.ok(codes(unknown.findings).includes('PACKAGE_MANAGER_UNKNOWN'));
  });
});