import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument, NodeCanvasFactory } from './pdfjs.js';

export async function renderPdfToImages(bytes, outputDir, options = {}) {
  const {
    scale = 1,
    maxDim = 1000,
    format = 'png',
    quality,
    pages = [],
    prefix = 'page_',
  } = options;
  mkdirSync(outputDir, { recursive: true });

  const doc = await loadDocument(bytes);
  const images = [];
  const pageNumbers = pages.length
    ? pages
    : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  for (const pageNumber of pageNumbers) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    let effectiveScale = scale;
    if (viewport.width > maxDim || viewport.height > maxDim) {
      effectiveScale = scale * Math.min(maxDim / viewport.width, maxDim / viewport.height);
    }

    const finalViewport = page.getViewport({ scale: effectiveScale });
    const width = Math.ceil(finalViewport.width);
    const height = Math.ceil(finalViewport.height);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context,
      viewport: finalViewport,
      canvasFactory: new NodeCanvasFactory(),
    }).promise;

    const isJpeg = format === 'jpg' || format === 'jpeg';
    const ext = isJpeg ? 'jpg' : 'png';
    const buffer = isJpeg
      ? canvas.toBuffer('image/jpeg', quality ?? 0.9)
      : canvas.toBuffer('image/png');
    const path = join(outputDir, `${prefix}${pageNumber}.${ext}`);
    writeFileSync(path, buffer);
    images.push({ page: pageNumber, path, width, height, format: ext });
  }

  return { images };
}
