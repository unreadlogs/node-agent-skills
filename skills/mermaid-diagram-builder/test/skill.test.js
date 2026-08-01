import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'scripts', 'index.js');

const FLOWCHART = `graph TD
  A[Start] --> B{Decide}
  B -->|Yes| C[Go]
  B -->|No| D[Stop]`;

function run(args, input = null) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function runJson(args, input = null) {
  const res = run(args, input);
  const line = (res.stdout || '').trim() || (res.stderr || '').trim();
  return { parsed: JSON.parse(line), res };
}

test('version command reports tool metadata', () => {
  const { parsed } = runJson(['--version']);
  assert.equal(parsed.data.name, 'mermaid-diagram-builder');
  assert.ok(parsed.data.version);
  assert.ok(parsed.data.formats.includes('png'));
});

test('validate accepts valid flowchart', () => {
  const { parsed } = runJson(['validate', '--code', 'graph TD\n  A --> B']);
  assert.equal(parsed.data.valid, true);
  assert.equal(parsed.data.type, 'flowchart');
});

test('validate rejects broken syntax with line number', () => {
  const { parsed } = runJson(['validate', '--code', 'graph TD\n  A --> B\n  B -- > C']);
  assert.equal(parsed.data.valid, false);
  assert.ok(parsed.data.error.includes('line'));
});

test('validate reads from --stdin', () => {
  const { parsed } = runJson(['validate', '--stdin'], 'sequenceDiagram\n  A->>B: hi');
  assert.equal(parsed.data.valid, true);
  assert.equal(parsed.data.type, 'sequenceDiagram');
});

test('validate reports unknown command gracefully', () => {
  const { parsed, res } = runJson(['bogus']);
  assert.ok(parsed.error.includes('Unknown command'));
  assert.equal(res.status, 1);
});

test('types lists all 26 diagram types', () => {
  const { parsed } = runJson(['types']);
  assert.equal(parsed.data.count, 26);
  const keywords = parsed.data.types.map((t) => t.keyword);
  for (const k of ['flowchart', 'sequenceDiagram', 'classDiagram', 'gantt', 'mindmap', 'erDiagram', 'C4Context', 'venn-beta']) {
    assert.ok(keywords.includes(k));
  }
});

test('stats reports line/node/edge counts', () => {
  const { parsed } = runJson(['stats', '--code', FLOWCHART]);
  assert.equal(parsed.data.type, 'flowchart');
  assert.equal(parsed.data.valid, true);
  assert.equal(parsed.data.nodes, 4);
  assert.equal(parsed.data.edges, 3);
});

test('stats detects invalid input', () => {
  const { parsed } = runJson(['stats', '--code', 'graph TD\n  A --> B\n  B -- > C']);
  assert.equal(parsed.data.valid, false);
});

test('json command returns machine-readable stats', () => {
  const { parsed } = runJson(['json', '--code', FLOWCHART]);
  assert.equal(parsed.data.lines, 4);
  assert.equal(parsed.data.characters > 0, true);
});

test('extract pulls mermaid blocks from markdown', () => {
  const md = `# Docs

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

text

\`\`\`mermaid
pie
  "A" : 1
\`\`\`
`;
  const { parsed } = runJson(['extract', '--code', md]);
  assert.equal(parsed.data.count, 2);
  assert.equal(parsed.data.blocks[0].code.includes('A --> B'), true);
  assert.equal(parsed.data.blocks[1].code.includes('pie'), true);
});

test('extract supports index selection', () => {
  const md = '```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\npie\n  "A" : 1\n```';
  const { parsed } = runJson(['extract', '--code', md, '--index', '1']);
  assert.equal(parsed.data.count, 1);
  assert.equal(parsed.data.blocks[0].code.includes('pie'), true);
});

test('fix normalizes line endings, BOM, and trailing whitespace', () => {
  const dirty = '\uFEFFgraph TD\r\n  A --> B   \r\n\r\n\r\n\r\n  B --> C';
  const { parsed } = runJson(['fix', '--code', dirty]);
  const fixed = parsed.data.fixed;
  assert.equal(fixed.includes('\r'), false);
  assert.equal(fixed.includes('   \n'), false);
  assert.equal(fixed.includes('\n\n\n'), false);
  assert.ok(fixed.endsWith('\n'));
});

test('render svg produces standalone svg with viewBox', () => {
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'svg']);
  assert.ok(parsed.data.svg.startsWith('<svg'));
  assert.ok(parsed.data.svg.includes('viewBox'));
  assert.ok(parsed.data.svg.includes('Start'));
});

test('render svg to file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mermaid-skill-'));
  const out = path.join(dir, 'd.svg');
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'svg', '--output', out]);
  assert.equal(parsed.data.output, out);
  const content = readFileSync(out, 'utf8');
  assert.ok(content.includes('<svg'));
});

test('render png produces valid png file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mermaid-skill-'));
  const out = path.join(dir, 'd.png');
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'png', '--output', out]);
  assert.ok(parsed.data.bytes > 500);
  const buf = readFileSync(out);
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('render png with explicit width', () => {
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'png', '--width', '400']);
  assert.ok(parsed.data.base64.length > 500);
});

test('render jpg produces jpeg file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mermaid-skill-'));
  const out = path.join(dir, 'd.jpg');
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'jpg', '--output', out]);
  assert.ok(parsed.data.bytes > 300);
  const buf = readFileSync(out);
  assert.equal(buf.slice(0, 2).toString('hex'), 'ffd8');
});

test('render pdf produces pdf file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mermaid-skill-'));
  const out = path.join(dir, 'd.pdf');
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'pdf', '--output', out]);
  assert.ok(parsed.data.bytes > 500);
  const buf = readFileSync(out);
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
});

test('render html produces html wrapper with source', () => {
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'html']);
  assert.ok(parsed.data.svg.startsWith('<!DOCTYPE html>'));
  assert.ok(parsed.data.svg.includes('graph TD'));
  assert.ok(parsed.data.svg.includes('diagram-box'));
});

test('render rejects unknown format', () => {
  const { parsed, res } = runJson(['render', '--code', FLOWCHART, '--format', 'bmp']);
  assert.ok(parsed.error.includes('Unsupported format'));
  assert.equal(res.status, 1);
});

test('render supports dark theme', () => {
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--format', 'svg', '--theme', 'dark']);
  assert.ok(parsed.data.svg.startsWith('<svg'));
});

test('render rejects unknown theme', () => {
  const { parsed } = runJson(['render', '--code', FLOWCHART, '--theme', 'neon']);
  assert.ok(parsed.error.includes('Unsupported theme'));
});

test('render sequence diagram works', () => {
  const { parsed } = runJson(['render', '--format', 'svg', '--code', 'sequenceDiagram\n  Alice->>John: Hello']);
  assert.ok(parsed.data.svg.includes('viewBox'));
});

test('render class diagram converts foreignObject labels to text', () => {
  const { parsed } = runJson(['render', '--format', 'svg', '--code', 'classDiagram\n  class A {\n    +name\n  }']);
  assert.ok(parsed.data.svg.includes('viewBox'));
});

test('render mindmap works end-to-end', () => {
  const { parsed } = runJson(['render', '--format', 'png', '--code', 'mindmap\n  root((root))\n    Origins']);
  assert.ok(parsed.data.base64.length > 500);
});

test('render pie chart works', () => {
  const { parsed } = runJson(['render', '--format', 'png', '--code', 'pie title P\n  "Dogs" : 386']);
  assert.ok(parsed.data.base64.length > 500);
});

test('render gantt works', () => {
  const { parsed } = runJson(['render', '--format', 'png', '--code', 'gantt\n  title G\n  dateFormat YYYY-MM-DD\n  section S\n    A: a1, 2024-01-01, 30d']);
  assert.ok(parsed.data.base64.length > 500);
});

test('render git graph works', () => {
  const { parsed } = runJson(['render', '--format', 'svg', '--code', 'gitGraph\n  commit\n  branch hotfix\n  checkout hotfix\n  commit\n  checkout main\n  merge hotfix']);
  assert.ok(parsed.data.svg.includes('viewBox'));
});

test('error output is single-line JSON with exit 1', () => {
  const res = run(['extract', '--code', '```mermaid\ngraph TD\n  A --> B\n```', '--index', '5']);
  assert.equal(res.status, 1);
  assert.equal(res.stdout.trim(), '');
  const parsed = JSON.parse(res.stderr.trim());
  assert.ok(parsed.error.includes('out of range'));
});

test('no input produces error', () => {
  const { parsed, res } = runJson(['validate']);
  assert.ok(parsed.error.includes('No input'));
  assert.equal(res.status, 1);
});

test('unknown diagram type detected as unknown', () => {
  const { parsed } = runJson(['validate', '--code', 'bogusDiagram\n  x']);
  assert.equal(parsed.data.type, 'unknown');
  assert.equal(parsed.data.valid, false);
});
