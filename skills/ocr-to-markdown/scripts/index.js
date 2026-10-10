#!/usr/bin/env node
import fs from 'node:fs/promises';
import tesseract from 'tesseract.js';

const MAX_BYTES = 20 * 1024 * 1024;

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
}

function parseArgs(values) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith('--')) positional.push(values[i]);
    else if (values[i + 1] && !values[i + 1].startsWith('--')) flags[values[i].slice(2)] = values[++i];
    else flags[values[i].slice(2)] = true;
  }
  return { positional, flags };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (command !== 'ocr' || positional.length !== 1) throw new Error('usage: index.js ocr <image> [--language eng]');
  const input = positional[0];
  const stat = await fs.stat(input);
  if (!stat.isFile()) throw new Error(`input is not a file: ${input}`);
  if (stat.size > MAX_BYTES) throw new Error(`input exceeds ${MAX_BYTES} byte limit`);
  const language = String(flags.language ?? 'eng');
  const worker = await tesseract.createWorker(language);
  try {
    const result = await worker.recognize(input);
    const data = result.data;
    const words = (data.words ?? []).map((word) => ({ text: word.text, confidence: word.confidence, bbox: word.bbox }));
    process.stdout.write(JSON.stringify({ data: { input, language, text: data.text.trim(), markdown: data.text.trim(), confidence: data.confidence, words } }) + '\n');
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => fail(error.message));
