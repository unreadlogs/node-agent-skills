#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, getFlag, getNumberFlag, readStdin } from './lib/cli.js';
import { DIAGRAM_TYPES, detectType, renderMermaid, sanitizeSvg, validateMermaid } from './lib/render.js';
import { buildStats, extractMermaidBlocks, fixCode } from './lib/analyze.js';
import { foreignObjectsToText, rasterizeSvg, pngToJpeg, pngToPdf, buildHtml } from './lib/output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

function ok(data) {
  process.stdout.write(JSON.stringify({ data }));
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
}

async function readSource(flags) {
  const input = getFlag(flags, ['input', 'file']);
  const code = getFlag(flags, ['code', 'text']);
  const useStdin = getFlag(flags, ['stdin'], false) === true || getFlag(flags, ['stdin'], false) === 'true';
  if (input) {
    try {
      return { code: readFileSync(input, 'utf8'), name: input };
    } catch (err) {
      return fail(`Cannot read input file "${input}": ${err.code || err.message}`);
    }
  }
  if (code !== null) return { code, name: null };
  if (useStdin || process.stdin.isTTY === undefined || !process.stdin.isTTY) {
    const stdin = await readStdin();
    if (!stdin.trim()) return null;
    return { code: stdin, name: null };
  }
  return null;
}

async function cmdValidate(flags) {
  const src = await readSource(flags);
  if (!src) return fail('No input. Use --input <file>, --code "<mermaid>", or --stdin.');
  const result = await validateMermaid(src.code);
  ok({ ...result, source: src.name });
}

async function cmdTypes() {
  ok({ count: DIAGRAM_TYPES.length, types: DIAGRAM_TYPES });
}

async function cmdStats(flags) {
  const src = await readSource(flags);
  if (!src) return fail('No input. Use --input <file>, --code "<mermaid>", or --stdin.');
  const asJson = getFlag(flags, ['json'], false) === true || getFlag(flags, ['json'], false) === 'true';
  const stats = await buildStats(src.code, src.name);
  if (asJson) return ok(stats);
  const lines = [
    `type:           ${stats.type}`,
    `valid:          ${stats.valid ? 'yes' : 'no'}`,
    `lines:          ${stats.lines}`,
    `non-blank:      ${stats.nonBlankLines}`,
    `characters:     ${stats.characters}`,
    `directives:     ${stats.directives}`,
  ];
  for (const key of ['nodes', 'edges', 'actors', 'messages', 'classes', 'relations', 'sections', 'tasks', 'milestones', 'states', 'transitions', 'entities']) {
    if (stats[key] !== undefined) lines.push(`${key}:          ${stats[key]}`);
  }
  ok({ summary: lines.join('\n'), ...stats });
}

async function cmdExtract(flags) {
  const src = await readSource(flags);
  if (!src) return fail('No input. Use --input <markdown-file>, --code "<markdown>", or --stdin.');
  const blocks = extractMermaidBlocks(src.code);
  const index = getNumberFlag(flags, ['index', 'i']);
  const title = getFlag(flags, ['title', 't']);
  if (title !== null) {
    const found = blocks.filter((b) => b.code.split('\n')[0].includes(title));
    if (!found.length) return fail(`No mermaid block matching title "${title}".`);
    return ok({ count: found.length, blocks: found });
  }
  if (index !== null) {
    const block = blocks[index];
    if (!block) return fail(`Block index ${index} out of range (0-${Math.max(blocks.length - 1, 0)}).`);
    return ok({ count: 1, blocks: [block] });
  }
  ok({ count: blocks.length, blocks });
}

async function cmdFix(flags) {
  const src = await readSource(flags);
  if (!src) return fail('No input. Use --input <file>, --code "<mermaid>", or --stdin.');
  const fixed = fixCode(src.code);
  const output = getFlag(flags, ['output', 'o']);
  if (output) {
    writeFileSync(output, fixed, 'utf8');
    return ok({ output, bytes: Buffer.byteLength(fixed, 'utf8') });
  }
  ok({ fixed, bytes: Buffer.byteLength(fixed, 'utf8') });
}

async function cmdRender(flags) {
  const src = await readSource(flags);
  if (!src) return fail('No input. Use --input <file>, --code "<mermaid>", or --stdin.');
  const format = String(getFlag(flags, ['format', 'f'], 'png')).toLowerCase();
  if (!['svg', 'png', 'jpg', 'jpeg', 'pdf', 'html'].includes(format)) {
    return fail(`Unsupported format "${format}". Supported: svg, png, jpg, pdf, html.`);
  }
  const theme = getFlag(flags, ['theme'], 'default');
  const rawSvg = await renderMermaid(src.code, { theme });
  const svg = sanitizeSvg(rawSvg);

  if (format === 'svg' || format === 'html') {
    const content = format === 'html' ? buildHtml(svg, src.code) : svg;
    const output = getFlag(flags, ['output', 'o']);
    if (output) {
      writeFileSync(output, content, 'utf8');
      return ok({ output, format, bytes: Buffer.byteLength(content, 'utf8') });
    }
    return ok({ format, svg: content });
  }

  const width = getNumberFlag(flags, ['width', 'w']);
  const scale = getNumberFlag(flags, ['scale', 's'], 1) || 1;
  const background = getFlag(flags, ['background', 'bg'], 'transparent');
  const forRaster = foreignObjectsToText(svg);
  let png = null;
  try {
    png = rasterizeSvg(forRaster, { width, scale, background });
  } catch (err) {
    return fail(`Rasterization failed: ${String(err.message || err).slice(0, 200)}`);
  }

  if (format === 'png') {
    const output = getFlag(flags, ['output', 'o']);
    if (output) {
      writeFileSync(output, png);
      return ok({ output, format, bytes: png.length });
    }
    return ok({ format, base64: png.toString('base64') });
  }

  if (format === 'jpg' || format === 'jpeg') {
    const quality = getNumberFlag(flags, ['quality', 'q'], 90);
    const jpg = await pngToJpeg(png, quality);
    const output = getFlag(flags, ['output', 'o']);
    if (output) {
      writeFileSync(output, jpg);
      return ok({ output, format: 'jpg', bytes: jpg.length });
    }
    return ok({ format: 'jpg', base64: jpg.toString('base64') });
  }

  if (format === 'pdf') {
    const dpi = getNumberFlag(flags, ['dpi'], 96);
    const pdf = await pngToPdf(png, { dpi });
    const output = getFlag(flags, ['output', 'o']);
    if (output) {
      writeFileSync(output, pdf);
      return ok({ output, format, bytes: pdf.length });
    }
    return ok({ format, base64: Buffer.from(pdf).toString('base64') });
  }
}

const COMMANDS = {
  validate: cmdValidate,
  render: cmdRender,
  stats: cmdStats,
  types: cmdTypes,
  extract: cmdExtract,
  fix: cmdFix,
  json: cmdStats,
};

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (getFlag(flags, ['version', 'v']) === true) {
    return ok({ name: 'mermaid-diagram-builder', version: VERSION, engine: 'mermaid', formats: ['svg', 'png', 'jpg', 'pdf', 'html'] });
  }
  const command = positionals[0];
  if (!command) {
    return fail(`No command. Usage: skill-mermaid <command> [options]
Commands: ${Object.keys(COMMANDS).join(', ')}`);
  }
  const handler = COMMANDS[command];
  if (!handler) return fail(`Unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
  try {
    await handler(flags, positionals.slice(1));
  } catch (err) {
    fail(String(err && err.message ? err.message : err).slice(0, 500));
  }
}

main();
