#!/usr/bin/env node
import { ESLint } from 'eslint';

function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function parseArgs(values) { const positional = []; const flags = {}; for (let i = 0; i < values.length; i += 1) { if (!values[i].startsWith('--')) positional.push(values[i]); else if (values[i + 1] && !values[i + 1].startsWith('--')) flags[values[i].slice(2)] = values[++i]; else flags[values[i].slice(2)] = true; } return { positional, flags }; }
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (command !== 'lint' || positional.length === 0 || Object.keys(flags).some((key) => !['format', 'config'].includes(key))) {
    throw new Error('usage: index.js lint <file-or-directory...> [--config path] [--format json]');
  }
  if (flags.format && flags.format !== 'json') throw new Error('--format only supports json');

  // With no project config ESLint v9 otherwise reports no rules. Keep a useful,
  // deterministic baseline; an explicit --config delegates rule choice to repo.
  const eslint = new ESLint(flags.config
    ? { cwd: process.cwd(), overrideConfigFile: flags.config }
    : {
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: [{ rules: {
        'no-constant-condition': 'error',
        'no-debugger': 'error',
        'no-dupe-keys': 'error',
        'no-duplicate-case': 'error',
        'no-unreachable': 'error',
        'no-unsafe-negation': 'error',
        'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
        'valid-typeof': 'error',
      } }],
    });
  const results = await eslint.lintFiles(positional);
  const findings = results.flatMap((result) => result.messages.map((message) => ({
    file: result.filePath,
    line: message.line ?? null,
    column: message.column ?? null,
    endLine: message.endLine ?? null,
    endColumn: message.endColumn ?? null,
    severity: message.severity,
    ruleId: message.ruleId,
    message: message.message,
  })));
  const data = {
    targets: positional,
    files: results.length,
    errorCount: findings.filter((finding) => finding.severity === 2).length,
    warningCount: findings.filter((finding) => finding.severity === 1).length,
    findings,
  };
  process.stdout.write(JSON.stringify({ data }, null, flags.format === 'json' ? 2 : 0) + '\n');
}
main().catch((error) => fail(error.message));
