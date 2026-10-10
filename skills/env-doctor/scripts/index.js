#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import semver from 'semver';

function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function requiredEnv(source) { return [...source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function main() {
  const [command, target = '.'] = process.argv.slice(2);
  if (command !== 'check') throw new Error('usage: index.js check <project>');
  const root = path.resolve(target); const findings = []; const packageFile = path.join(root, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(await fs.readFile(packageFile, 'utf8')); } catch { findings.push({ code: 'NO_PACKAGE_JSON', severity: 'error', message: 'package.json was not found or is invalid' }); }
  const locks = [];
  for (const file of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) if (await exists(path.join(root, file))) locks.push(file);
  let envExample = ''; try { envExample = await fs.readFile(path.join(root, '.env.example'), 'utf8'); } catch {}
  for (const name of requiredEnv(envExample)) if (!process.env[name]) findings.push({ code: 'MISSING_ENV', severity: 'warning', name });
  const scripts = pkg?.scripts ?? {};
  if (pkg?.engines?.node && !semver.satisfies(process.versions.node, pkg.engines.node, { includePrerelease: true })) findings.push({ code: 'NODE_VERSION', severity: 'error', required: pkg.engines.node, actual: process.versions.node });
  process.stdout.write(JSON.stringify({ data: { project: root, node: process.versions.node, packageManager: locks[0] ?? 'unknown', scripts: Object.keys(scripts), findings } }) + '\n');
}
main().catch((error) => fail(error.message));
