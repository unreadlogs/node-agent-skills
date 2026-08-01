import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));

const standardFontDataUrl = `${join(pdfjsRoot, 'standard_fonts')}/`;
const cMapUrl = `${join(pdfjsRoot, 'cmaps')}/`;

export class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset({ canvas }, width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  destroy({ canvas }) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function loadDocument(bytes) {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    standardFontDataUrl,
    cMapUrl,
    canvasFactory: new NodeCanvasFactory(),
  });
  return task.promise;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export async function extractText(pdfDoc, pageNumbers) {
  const pages = [];
  for (const pageNumber of pageNumbers) {
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => (item.str !== undefined ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ page: pageNumber, text });
  }
  return pages;
}

async function getPageWords(page) {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const words = [];

  for (const item of textContent.items) {
    if (item.str === undefined) continue;
    const text = String(item.str).trim();
    if (!text) continue;

    const x = item.transform[4];
    const baseline = item.transform[5];
    const width = item.width ?? 0;
    const height = item.height ?? 0;

    const pieces = text.split(/\s+/);
    const totalChars = text.length;
    let cursor = x;

    for (const piece of pieces) {
      if (!piece) continue;
      const charWidth = width * (piece.length / totalChars);
      words.push({
        text: piece,
        x0: cursor,
        top: pageHeight - (baseline + height),
        x1: cursor + charWidth,
        bottom: pageHeight - baseline,
      });
      cursor += charWidth;
    }
  }

  return words;
}

export async function searchText(pdfDoc, query, pageNumbers, { caseSensitive = false, regex = false } = {}) {
  const needle = String(query ?? '');
  if (!needle) {
    return { total_matches: 0, matches: [] };
  }

  let compiledRegex = null;
  if (regex) {
    try {
      compiledRegex = new RegExp(needle, caseSensitive ? 'gm' : 'gim');
    } catch {
      throw new Error(`Invalid regular expression: ${needle}`);
    }
  }

  const matches = [];

  for (const pageNumber of pageNumbers) {
    const page = await pdfDoc.getPage(pageNumber);
    const words = await getPageWords(page);
    if (!words.length) continue;

    const wordStart = [];
    let concat = '';
    for (const word of words) {
      wordStart.push(concat.length);
      concat += (concat ? (compiledRegex ? '\n' : ' ') : '') + word.text;
    }

    const wordIndexOf = (charIndex) => {
      let lo = 0;
      let hi = words.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (wordStart[mid] <= charIndex) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    const addMatch = (start, end) => {
      const firstWord = wordIndexOf(start);
      const lastWord = wordIndexOf(end - 1);
      const span = words.slice(firstWord, lastWord + 1);
      matches.push({
        page: pageNumber,
        text: concat.slice(start, end),
        x0: round1(Math.min(...span.map((w) => w.x0))),
        top: round1(Math.min(...span.map((w) => w.top))),
        x1: round1(Math.max(...span.map((w) => w.x1))),
        bottom: round1(Math.max(...span.map((w) => w.bottom))),
      });
    };

    if (compiledRegex) {
      for (const result of concat.matchAll(compiledRegex)) {
        if (result.index === undefined) continue;
        addMatch(result.index, result.index + result[0].length);
      }
    } else {
      const haystackNeedle = caseSensitive ? needle : needle.toLowerCase();
      const haystack = caseSensitive ? concat : concat.toLowerCase();
      let fromIndex = 0;
      while (true) {
        const index = haystack.indexOf(haystackNeedle, fromIndex);
        if (index === -1) break;
        addMatch(index, index + haystackNeedle.length);
        fromIndex = index + haystackNeedle.length;
      }
    }
  }

  return { total_matches: matches.length, matches };
}

export async function getPageAnnotations(pdfDoc, pageNumbers) {
  const entries = [];
  for (const pageNumber of pageNumbers) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const annotations = await page.getAnnotations();

    for (const annotation of annotations) {
      if (!Array.isArray(annotation.rect) || annotation.rect.length < 4) continue;
      const [x0, y0, x1, y1] = annotation.rect;
      entries.push({
        page: pageNumber,
        type: annotation.subtype ?? 'Unknown',
        rect: [round1(x0), round1(pageHeight - y1), round1(x1), round1(pageHeight - y0)],
        text: annotation.contentsObj?.str || null,
        url: annotation.url || annotation.unsafeUrl || null,
        name: annotation.name || null,
      });
    }
  }
  return entries;
}

export async function getOutline(pdfDoc) {
  const outline = await pdfDoc.getOutline();
  if (!outline) return [];

  const resolveDestPage = async (dest) => {
    if (!Array.isArray(dest) || dest.length === 0) return null;
    try {
      const index = await pdfDoc.getPageIndex(dest[0]);
      return index + 1;
    } catch {
      return null;
    }
  };

  const formatItems = async (items) => {
    const result = [];
    for (const item of items) {
      result.push({
        title: item.title ?? null,
        url: item.url ?? null,
        page: await resolveDestPage(item.dest),
        children: (item.items?.length ? await formatItems(item.items) : []),
      });
    }
    return result;
  };

  return formatItems(outline);
}
