#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { printData, fail, getFlag, parsePageRange, parsePageList, parsePageSelection, readJson } from './lib/cli.js';
import { loadDocument, extractText, searchText, getPageAnnotations, getOutline } from './lib/pdfjs.js';
import { renderPdfToImages } from './lib/render.js';
import {
  getInfo,
  mergePdfs,
  splitPdf,
  splitByRangePdf,
  rotatePdf,
  addWatermark,
  createPdf,
  extractEmbeddedImages,
  removePagesPdf,
  cropPdf,
  stampTextPdf,
  pageNumbersPdf,
  setMetadataPdf,
} from './lib/ops.js';

const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version;

const USAGE = `Usage:
  node scripts/index.js <command> [arguments...]

Commands:
  info <input.pdf>                         Document info: pages, size, rotation, metadata
  text <input.pdf> [--pages 1-3]           Extract text (JSON, one entry per page)
  search <input.pdf> <query> [--pages 1-3] [--case-sensitive] [--regex]
                                           Find text occurrences with coordinates
  metadata <input.pdf> [<output.pdf>]      Read document metadata; with an output
                                           path, write it from --title/--author/
                                           --subject/--keywords/--creator/--producer
  render <input.pdf> <out-dir> [--scale N] [--max-dim N] [--format png|jpg]
                                           [--quality N] [--pages 1-3]
  thumbnail <input.pdf> <out-dir> [--size N] [--pages 1-3] [--format png|jpg]
                                           Render small preview images
  extract-images <input.pdf> <out-dir>     Extract embedded images
  annotations <input.pdf> [--pages 1-3]    List link/text/highlight annotations
  outline <input.pdf>                      Extract bookmarks (table of contents)
  remove-pages <input.pdf> <output.pdf> --pages 1,3,5
                                           Delete pages by list or range (e.g. 1-3)
  crop <input.pdf> <output.pdf> --x N --y N --width N --height N [--page N]
                                           Set the crop box (top-down coordinates)
  stamp <input.pdf> <output.pdf> --text "..." [--pages 1-3] [--x N] [--y N]
                                           [--size N] [--font NAME] [--color HEX]
                                           [--background HEX] [--opacity N]
                                           Overlay text on pages (multi-line via \\n)
  page-numbers <input.pdf> <output.pdf> [--pages 1-3] [--x N] [--y N] [--size N]
                                           [--start N] [--with-total]
                                           Draw page numbers on pages
  merge <output.pdf> <input1.pdf[:range]> [input2.pdf[:range] ...]
                                           Combine PDFs; optionally take a page
                                           range per input (e.g. file.pdf:1-3)
  split <input.pdf> <out-dir> [--pages 1-3] [--by-range "1-2,4-5"]
                                           Split into single pages or chunks
  rotate <input.pdf> <output.pdf> --pages 1,2 --deg 90
  create <output.pdf> [--json spec.json] [--text "line1\\nline2"]
  watermark <input.pdf> <watermark.pdf> <output.pdf>

stdout: JSON object { "data": ... }
stderr: JSON object { "error": "..." } (exits with code 1)`;

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printData({ usage: USAGE });
    return;
  }

  if (command === '--version' || command === '-v') {
    printData({ name: 'skill-pdf', version: VERSION });
    return;
  }

  const readPdf = (path) => readFileSync(path);

  if (command === 'info') {
    requireArgs(argv, ['<input.pdf>'], 2);
    printData(await getInfo(readPdf(argv[1])));
    return;
  }

  if (command === 'text') {
    requireArgs(argv, ['<input.pdf>'], 2);
    const pdfDoc = await loadDocument(readPdf(argv[1]));
    const range = parsePageRange(getFlag(argv, '--pages'), pdfDoc.numPages);
    const pages = await extractText(pdfDoc, range);
    printData({ file: argv[1], pages: pages.length, text: pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n'), pageTexts: pages });
    return;
  }

  if (command === 'search') {
    requireArgs(argv, ['<input.pdf>', '<query>'], 3);
    const pdfDoc = await loadDocument(readPdf(argv[1]));
    const range = parsePageRange(getFlag(argv, '--pages'), pdfDoc.numPages);
    const result = await searchText(pdfDoc, argv[2], range, {
      caseSensitive: argv.includes('--case-sensitive'),
      regex: argv.includes('--regex'),
    });
    printData({ query: argv[2], ...result });
    return;
  }

  if (command === 'metadata') {
    requireArgs(argv, ['<input.pdf>'], 2);
    const rawFields = {
      title: getFlag(argv, '--title'),
      author: getFlag(argv, '--author'),
      subject: getFlag(argv, '--subject'),
      keywords: getFlag(argv, '--keywords'),
      creator: getFlag(argv, '--creator'),
      producer: getFlag(argv, '--producer'),
    };
    const fields = Object.fromEntries(
      Object.entries(rawFields).filter(([, value]) => value !== null),
    );
    const output = argv[2];
    if (output) {
      const bytes = await setMetadataPdf(readPdf(argv[1]), fields);
      writeBytes(output, bytes);
      const updated = await getInfo(bytes);
      printData({ output, metadata: updated.metadata });
      return;
    }
    const current = await getInfo(readPdf(argv[1]));
    printData({ metadata: current.metadata });
    return;
  }

  if (command === 'render') {
    requireArgs(argv, ['<input.pdf>', '<output-dir>'], 3);
    const scale = Number(getFlag(argv, '--scale') ?? '1');
    const maxDim = Number(getFlag(argv, '--max-dim') ?? '1000');
    const pages = getFlag(argv, '--pages') ? parsePageList(getFlag(argv, '--pages')) : [];
    const result = await renderPdfToImages(readPdf(argv[1]), argv[2], {
      scale,
      maxDim,
      format: getFlag(argv, '--format') ?? 'png',
      quality: getFlag(argv, '--quality') !== null ? Number(getFlag(argv, '--quality')) : undefined,
      pages,
    });
    printData({ output_dir: argv[2], images: result.images });
    return;
  }

  if (command === 'thumbnail') {
    requireArgs(argv, ['<input.pdf>', '<output-dir>'], 3);
    const size = Number(getFlag(argv, '--size') ?? '120');
    const pages = getFlag(argv, '--pages') ? parsePageList(getFlag(argv, '--pages')) : [];
    const result = await renderPdfToImages(readPdf(argv[1]), argv[2], {
      scale: 1,
      maxDim: size,
      format: getFlag(argv, '--format') ?? 'png',
      pages,
      prefix: 'thumb_',
    });
    printData({ output_dir: argv[2], thumb_size: size, images: result.images });
    return;
  }

  if (command === 'extract-images') {
    requireArgs(argv, ['<input.pdf>', '<output-dir>'], 3);
    const result = await extractEmbeddedImages(readPdf(argv[1]), argv[2]);
    printData({ output_dir: argv[2], images: result.images });
    return;
  }

  if (command === 'annotations') {
    requireArgs(argv, ['<input.pdf>'], 2);
    const pdfDoc = await loadDocument(readPdf(argv[1]));
    const range = parsePageRange(getFlag(argv, '--pages'), pdfDoc.numPages);
    const annotations = await getPageAnnotations(pdfDoc, range);
    printData({ file: argv[1], annotation_count: annotations.length, annotations });
    return;
  }

  if (command === 'outline') {
    requireArgs(argv, ['<input.pdf>'], 2);
    const pdfDoc = await loadDocument(readPdf(argv[1]));
    const outline = await getOutline(pdfDoc);
    printData({ file: argv[1], outline });
    return;
  }

  if (command === 'remove-pages') {
    requireArgs(argv, ['<input.pdf>', '<output.pdf>'], 3);
    const selection = getFlag(argv, '--pages');
    if (!selection) {
      fail(new Error('remove-pages requires --pages <list|range> (e.g. --pages 1-3,5)'));
    }
    const pages = parsePageSelection(selection);
    const result = await removePagesPdf(readPdf(argv[1]), pages);
    writeBytes(argv[2], result.bytes);
    printData({ output: argv[2], removed: result.removed, requested: pages });
    return;
  }

  if (command === 'crop') {
    requireArgs(argv, ['<input.pdf>', '<output.pdf>'], 3);
    const x = Number(getFlag(argv, '--x'));
    const y = Number(getFlag(argv, '--y'));
    const width = Number(getFlag(argv, '--width'));
    const height = Number(getFlag(argv, '--height'));
    if (![x, y, width, height].every(Number.isFinite)) {
      fail(new Error('crop requires numeric --x, --y, --width, --height'));
    }
    const pages = getFlag(argv, '--page') ? parsePageList(getFlag(argv, '--page')) : [];
    const result = await cropPdf(readPdf(argv[1]), pages, { x, y, width, height });
    writeBytes(argv[2], result.bytes);
    printData({ output: argv[2], crop_box: { x, y, width, height }, pages: result.pages });
    return;
  }

  if (command === 'stamp') {
    requireArgs(argv, ['<input.pdf>', '<output.pdf>'], 3);
    const text = getFlag(argv, '--text');
    if (text === null) {
      fail(new Error('stamp requires --text "..."'));
    }
    const pages = getFlag(argv, '--pages') ? parsePageList(getFlag(argv, '--pages')) : [];
    const options = {
      text,
      x: getFlag(argv, '--x') !== null ? Number(getFlag(argv, '--x')) : undefined,
      y: getFlag(argv, '--y') !== null ? Number(getFlag(argv, '--y')) : undefined,
      size: Number(getFlag(argv, '--size') ?? '24'),
      font: getFlag(argv, '--font'),
      color: getFlag(argv, '--color'),
      background: getFlag(argv, '--background'),
      opacity: Number(getFlag(argv, '--opacity') ?? '1'),
    };
    const result = await stampTextPdf(readPdf(argv[1]), pages, options);
    writeBytes(argv[2], result.bytes);
    printData({ output: argv[2], pages: result.pages });
    return;
  }

  if (command === 'page-numbers') {
    requireArgs(argv, ['<input.pdf>', '<output.pdf>'], 3);
    const pages = getFlag(argv, '--pages') ? parsePageList(getFlag(argv, '--pages')) : [];
    const options = {
      x: getFlag(argv, '--x') !== null ? Number(getFlag(argv, '--x')) : undefined,
      y: getFlag(argv, '--y') !== null ? Number(getFlag(argv, '--y')) : undefined,
      size: Number(getFlag(argv, '--size') ?? '10'),
      start: Number(getFlag(argv, '--start') ?? '1'),
      withTotal: argv.includes('--with-total'),
    };
    const result = await pageNumbersPdf(readPdf(argv[1]), pages, options);
    writeBytes(argv[2], result.bytes);
    printData({ output: argv[2], pages: result.pages });
    return;
  }

  if (command === 'merge') {
    requireArgs(argv, ['<output.pdf>', '<input1.pdf>', '...'], 3);
    const inputs = argv.slice(2).map(parseMergeInput).map((entry) => ({
      bytes: readPdf(entry.path),
      pages: entry.pages,
    }));
    const outBytes = await mergePdfs(inputs);
    writeBytes(argv[1], outBytes);
    printData({ output: argv[1], merged: argv.slice(2).length });
    return;
  }

  if (command === 'split') {
    requireArgs(argv, ['<input.pdf>', '<output-dir>'], 3);
    const byRange = getFlag(argv, '--by-range');
    if (byRange) {
      if (getFlag(argv, '--pages')) {
        fail(new Error('split accepts either --pages or --by-range, not both'));
      }
      const ranges = String(byRange)
        .split(/[,\s]+/)
        .map(parseRangeToken)
        .filter(Boolean);
      const result = await splitByRangePdf(readPdf(argv[1]), argv[2], ranges);
      printData({ output_dir: argv[2], chunks: result.files.length, files: result.files });
      return;
    }
    const source = await loadPdfLibDocument(readPdf(argv[1]));
    const range = parsePageRange(getFlag(argv, '--pages'), source.getPageCount());
    const result = await splitPdf(readPdf(argv[1]), argv[2], range);
    printData({ output_dir: argv[2], files: result.files });
    return;
  }

  if (command === 'rotate') {
    requireArgs(argv, ['<input.pdf>', '<output.pdf>'], 3);
    const deg = Number(getFlag(argv, '--deg') ?? '90');
    const pages = getFlag(argv, '--pages') ? parsePageList(getFlag(argv, '--pages')) : [];
    const outBytes = await rotatePdf(readPdf(argv[1]), deg, pages);
    writeBytes(argv[2], outBytes);
    printData({ output: argv[2], degrees: deg, pages: pages.length ? pages : 'all' });
    return;
  }

  if (command === 'create') {
    requireArgs(argv, ['<output.pdf>'], 2);
    const specJson = getFlag(argv, '--json');
    const text = getFlag(argv, '--text');
    let spec;
    if (specJson) {
      spec = readJson(specJson);
    } else if (text !== null) {
      spec = {
        pages: [
          {
            width: 612,
            height: 792,
            texts: String(text).split('\n').map((line, index) => ({
              text: line,
              x: 72,
              y: 720 - index * 24,
              size: 12,
              font: 'Helvetica',
              color: '000000',
            })),
          },
        ],
      };
    } else {
      fail(new Error('create requires --json <spec.json> or --text "..."'));
    }
    const outBytes = await createPdf(spec);
    writeBytes(argv[1], outBytes);
    printData({ output: argv[1], pages: spec.pages.length });
    return;
  }

  if (command === 'watermark') {
    requireArgs(argv, ['<input.pdf>', '<watermark.pdf>', '<output.pdf>'], 4);
    const outBytes = await addWatermark(readPdf(argv[1]), readPdf(argv[2]));
    writeBytes(argv[3], outBytes);
    printData({ output: argv[3] });
    return;
  }

  fail(new Error(`Unknown command: ${command}\n\n${USAGE}`));
}

function requireArgs(argv, names, min) {
  if (argv.length < min) {
    fail(new Error(`Missing arguments for \`${argv[0]}\`. Expected: ${names.join(' ')}`));
  }
}

function parseMergeInput(arg) {
  const separator = arg.lastIndexOf(':');
  if (separator > 0) {
    const path = arg.slice(0, separator);
    const selection = arg.slice(separator + 1);
    if (/^[\d\s,\-]+$/.test(selection)) {
      return { path, pages: parsePageSelection(selection) };
    }
  }
  return { path: arg, pages: null };
}

function parseRangeToken(token) {
  const match = String(token).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] !== undefined ? parseInt(match[2], 10) : start;
  const pages = [];
  for (let page = start; page <= end; page += 1) {
    if (page >= 1) pages.push(page);
  }
  return pages.length ? pages : null;
}

function writeBytes(path, bytes) {
  writeFileSync(path, bytes);
}

async function loadPdfLibDocument(bytes) {
  const { PDFDocument } = await import('pdf-lib');
  return PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
}

main().catch((err) => fail(err));
