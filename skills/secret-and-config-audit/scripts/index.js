#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const RULES = [
  { type: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { type: 'token-assignment', regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[^\s"']{12,}/i },
  { type: 'cloud-key', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }
];
function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
async function files(dir, output = []) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { if (SKIP.has(entry.name)) continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) await files(full, output); else if (entry.isFile() && (entry.name.startsWith('.') || /\.(?:js|ts|json|ya?ml|toml|env|md|txt|mjs|cjs)$/i.test(entry.name))) output.push(full); } return output; }
async function main() { const [command, target = '.'] = process.argv.slice(2); if (command !== 'scan') throw new Error('usage: index.js scan <directory>'); const root = path.resolve(target); const findings = []; for (const file of await files(root)) { const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/); lines.forEach((line, index) => { for (const rule of RULES) if (rule.regex.test(line)) findings.push({ file: path.relative(root, file), line: index + 1, type: rule.type, value: '[REDACTED]', confidence: rule.type === 'private-key' ? 1 : 0.8 }); }); } process.stdout.write(JSON.stringify({ data: { root, findings, count: findings.length } }) + '\n'); }
main().catch((error) => fail(error.message));
