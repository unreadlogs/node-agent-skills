import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts, rgb, degrees as pdfDegrees } from 'pdf-lib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { join } from 'node:path';

export async function getInfo(bytes) {
  const doc = await PDFDocument.load(new Uint8Array(bytes), {
    ignoreEncryption: false,
  });
  const pages = [];
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    pages.push({ page: i + 1, width, height, rotation: page.getRotation().angle });
  }
  return {
    page_count: doc.getPageCount(),
    file_size: bytes.length,
    metadata: {
      title: doc.getTitle() ?? null,
      author: doc.getAuthor() ?? null,
      subject: doc.getSubject() ?? null,
      creator: doc.getCreator() ?? null,
      producer: doc.getProducer() ?? null,
      keywords: doc.getKeywords() ?? null,
      mod_date: doc.getModificationDate() ?? null,
      creation_date: doc.getCreationDate() ?? null,
    },
    pages,
  };
}

export async function mergePdfs(entries) {
  const merged = await PDFDocument.create();
  for (const entry of entries) {
    const source = await PDFDocument.load(new Uint8Array(entry.bytes));
    const indices = entry.pages && entry.pages.length
      ? entry.pages.map((p) => p - 1).filter((i) => i >= 0 && i < source.getPageCount())
      : source.getPageIndices();
    const copied = await merged.copyPages(source, indices);
    copied.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

export async function splitByRangePdf(bytes, outputDir, ranges) {
  mkdirSync(outputDir, { recursive: true });
  const source = await PDFDocument.load(new Uint8Array(bytes));
  const files = [];
  for (let r = 0; r < ranges.length; r += 1) {
    const pages = ranges[r].filter((p) => p >= 1 && p <= source.getPageCount());
    if (!pages.length) continue;
    const single = await PDFDocument.create();
    const copied = await single.copyPages(source, pages.map((p) => p - 1));
    copied.forEach((page) => single.addPage(page));
    const outBytes = await single.save();
    const path = join(outputDir, `chunk_${r + 1}.pdf`);
    writeFileSync(path, outBytes);
    files.push({ chunk: r + 1, pages, path });
  }
  return { files };
}

export async function splitPdf(bytes, outputDir, pageNumbers) {
  mkdirSync(outputDir, { recursive: true });
  const source = await PDFDocument.load(new Uint8Array(bytes));
  const results = [];
  for (const pageNumber of pageNumbers) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [pageNumber - 1]);
    single.addPage(page);
    const outBytes = await single.save();
    const path = join(outputDir, `page_${pageNumber}.pdf`);
    writeFileSync(path, outBytes);
    results.push({ page: pageNumber, path });
  }
  return { files: results };
}

export async function rotatePdf(bytes, degrees, pageNumbers) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const indices = pageNumbers.length
    ? pageNumbers.map((p) => p - 1)
    : doc.getPageIndices();
  for (const index of indices) {
    const page = doc.getPage(index);
    page.setRotation(pdfDegrees((page.getRotation().angle + degrees) % 360));
  }
  return doc.save();
}

export async function addWatermark(bytes, watermarkBytes) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const watermarkDoc = await PDFDocument.load(new Uint8Array(watermarkBytes));
  const [watermarkPage] = await doc.copyPages(watermarkDoc, [0]);
  const embedded = await doc.embedPage(watermarkPage);
  const { width: ww, height: wh } = watermarkPage.getSize();

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const scale = Math.max(width / ww, height / wh);
    const dx = (width - ww * scale) / 2;
    const dy = (height - wh * scale) / 2;
    page.drawPage(embedded, {
      x: dx,
      y: dy,
      width: ww * scale,
      height: wh * scale,
      opacity: 0.35,
    });
  }
  return doc.save();
}

export async function removePagesPdf(bytes, pageNumbers) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const removed = [];
  const sorted = [...pageNumbers].sort((a, b) => b - a);
  for (const pageNumber of sorted) {
    if (pageNumber >= 1 && pageNumber <= doc.getPageCount()) {
      doc.removePage(pageNumber - 1);
      removed.push(pageNumber);
    }
  }
  return { bytes: await doc.save(), removed: removed.length };
}

export async function cropPdf(bytes, pageNumbers, box) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const indices = pageNumbers.length ? pageNumbers.map((p) => p - 1) : doc.getPageIndices();
  for (const index of indices) {
    const page = doc.getPage(index);
    const { height } = page.getSize();
    page.setCropBox(box.x, height - box.y - box.height, box.width, box.height);
  }
  return { bytes: await doc.save(), pages: indices.length };
}

export async function stampTextPdf(bytes, pageNumbers, options) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const font = await doc.embedFont(CREATE_FONTS[options.font] ?? StandardFonts.Helvetica);
  const indices = pageNumbers.length ? pageNumbers.map((p) => p - 1) : doc.getPageIndices();
  const lines = String(options.text ?? '').split('\n');
  const size = options.size ?? 24;
  const lineHeight = size * 1.2;
  const maxWidth = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, size)), 0);
  const totalHeight = lines.length * lineHeight;

  for (const index of indices) {
    const page = doc.getPage(index);
    const { width, height } = page.getSize();
    const x = options.x !== undefined ? options.x : (width - maxWidth) / 2;
    const yTop = options.y !== undefined ? options.y : (height - totalHeight) / 2;
    const color = hexToRgb(options.color ?? '000000');
    const opacity = options.opacity ?? 1;

    if (options.background) {
      const pad = 4;
      page.drawRectangle({
        x: x - pad,
        y: height - yTop - totalHeight - pad,
        width: maxWidth + pad * 2,
        height: totalHeight + pad * 2,
        color: hexToRgb(options.background),
        opacity,
      });
    }

    lines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: height - yTop - index * lineHeight - size,
        size,
        font,
        color,
        opacity,
      });
    });
  }
  return { bytes: await doc.save(), pages: indices.length };
}

export async function pageNumbersPdf(bytes, pageNumbers, options) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const indices = pageNumbers.length ? pageNumbers.map((p) => p - 1) : doc.getPageIndices();
  const size = options.size ?? 10;
  const start = options.start ?? 1;

  for (const index of indices) {
    const page = doc.getPage(index);
    const { width, height } = page.getSize();
    const number = index + start;
    const label = options.withTotal ? `${number} / ${total}` : String(number);
    const textWidth = font.widthOfTextAtSize(label, size);
    const x = options.x !== undefined ? options.x : (width - textWidth) / 2;
    const y = options.y !== undefined ? options.y : 30;
    page.drawText(label, {
      x,
      y,
      size,
      font,
      color: hexToRgb('000000'),
      opacity: 0.7,
    });
  }
  return { bytes: await doc.save(), pages: indices.length };
}

export async function setMetadataPdf(bytes, fields) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  if (fields.title !== undefined) doc.setTitle(fields.title);
  if (fields.author !== undefined) doc.setAuthor(fields.author);
  if (fields.subject !== undefined) doc.setSubject(fields.subject);
  if (fields.keywords !== undefined) doc.setKeywords(fields.keywords);
  if (fields.creator !== undefined) doc.setCreator(fields.creator);
  if (fields.producer !== undefined) doc.setProducer(fields.producer);
  doc.setModificationDate(new Date());
  return doc.save();
}

const CREATE_FONTS = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

function hexToRgb(hex) {
  const value = String(hex).replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value;
  const num = parseInt(full.padEnd(6, '0'), 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

export async function createPdf(spec) {
  const doc = await PDFDocument.create();
  const fontCache = new Map();

  const getFont = async (name) => {
    if (!fontCache.has(name)) {
      fontCache.set(name, await doc.embedFont(CREATE_FONTS[name] ?? StandardFonts.Helvetica));
    }
    return fontCache.get(name);
  };

  for (const pageSpec of spec.pages) {
    const width = pageSpec.width ?? 612;
    const height = pageSpec.height ?? 792;
    const page = doc.addPage([width, height]);

    for (const line of pageSpec.lines ?? []) {
      page.drawLine({
        start: { x: line.x1, y: height - line.y1 },
        end: { x: line.x2, y: height - line.y2 },
        thickness: line.thickness ?? 1,
        color: hexToRgb(line.color ?? '000000'),
      });
    }

    for (const rect of pageSpec.rectangles ?? []) {
      page.drawRectangle({
        x: rect.x,
        y: height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
        color: hexToRgb(rect.color ?? '000000'),
        opacity: rect.opacity ?? 1,
      });
    }

    for (const text of pageSpec.texts ?? []) {
      const font = await getFont(text.font ?? 'Helvetica');
      page.drawText(String(text.text), {
        x: text.x ?? 72,
        y: height - (text.y ?? 72),
        size: text.size ?? 12,
        font,
        color: hexToRgb(text.color ?? '000000'),
        maxWidth: text.maxWidth,
      });
    }

    for (const image of pageSpec.images ?? []) {
      const source = String(image.data ?? '');
      const dataUri = source.startsWith('data:');
      const raw = dataUri ? source.replace(/^data:[^,]+,/, '') : source;
      const decoded = Buffer.from(raw, 'base64');
      const mime = dataUri ? source.split(':')[1].split(';')[0] : null;
      const format = image.format ?? mime ?? 'png';
      const embedded = format.includes('jpeg') || format.includes('jpg')
        ? await doc.embedJpg(decoded)
        : await doc.embedPng(decoded);
      const drawWidth = image.width ?? embedded.width;
      const drawHeight = image.height ?? embedded.height;
      page.drawImage(embedded, {
        x: image.x ?? 0,
        y: height - (image.y ?? 0) - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
    }
  }

  return doc.save();
}

export async function extractEmbeddedImages(bytes, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const images = [];

  for (let p = 0; p < doc.getPageCount(); p += 1) {
    const page = doc.getPage(p);
    const resources = page.node.get(PDFName.of('Resources'));
    const resourcesDict = resources instanceof PDFDict ? resources : doc.context.lookup(resources);
    const xObjects = resourcesDict instanceof PDFDict ? resourcesDict.get(PDFName.of('XObject')) : null;
    const xObjectDict = xObjects instanceof PDFDict ? xObjects : doc.context.lookup(xObjects);
    if (!(xObjectDict instanceof PDFDict)) continue;

    let index = 0;
    for (const key of xObjectDict.keys()) {
      const object = xObjectDict.lookup(key);
      if (!object || !object.dict) continue;
      const subtype = object.dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;

      const width = object.dict.get(PDFName.of('Width'));
      const height = object.dict.get(PDFName.of('Height'));
      const colorSpace = object.dict.get(PDFName.of('ColorSpace'));

      const filter = object.dict.get(PDFName.of('Filter'));
      let filterNames = [];
      if (filter instanceof PDFArray) filterNames = filter.asArray().map((f) => f.toString());
      else if (filter) filterNames = [filter.toString()];

      const contents = object.getContents ? object.getContents() : object.contents;
      if (!contents) {
        index += 1;
        continue;
      }

      const w = typeof width?.asNumber === 'function' ? width.asNumber() : null;
      const h = typeof height?.asNumber === 'function' ? height.asNumber() : null;
      const cs = colorSpace ? colorSpace.toString() : null;

      const result = decodeImageData({ object, contents, filterNames, width: w, height: h, colorSpace: cs });

      const path = join(outputDir, `page_${p + 1}_img_${index + 1}.${result.ext}`);
      writeFileSync(path, result.data);
      images.push({
        page: p + 1,
        path,
        width: w,
        height: h,
        format: result.format,
      });
      index += 1;
    }
  }

  return { images };
}

function decodeImageData({ contents, filterNames, width, height, colorSpace }) {
  if (filterNames.includes('/DCTDecode')) {
    return { data: contents, ext: 'jpg', format: 'jpeg' };
  }
  if (filterNames.includes('/JPXDecode')) {
    return { data: contents, ext: 'jp2', format: 'jpeg2000' };
  }
  if (filterNames.includes('/FlateDecode')) {
    let raw = contents;
    try {
      raw = inflateSync(contents);
    } catch {
      return { data: contents, ext: 'bin', format: 'flate' };
    }
    const comps = colorSpace === '/DeviceGray' ? 1 : colorSpace === '/DeviceCMYK' ? 4 : 3;
    if (!width || !height) {
      return { data: raw, ext: 'bin', format: 'flate' };
    }
    try {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      const imageData = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const src = (y * width + x) * comps;
          const dst = (y * width + x) * 4;
          if (comps === 1) {
            const v = raw[src] ?? 0;
            imageData.data[dst] = v;
            imageData.data[dst + 1] = v;
            imageData.data[dst + 2] = v;
            imageData.data[dst + 3] = 255;
          } else {
            imageData.data[dst] = raw[src] ?? 0;
            imageData.data[dst + 1] = raw[src + 1] ?? 0;
            imageData.data[dst + 2] = raw[src + 2] ?? 0;
            imageData.data[dst + 3] = comps === 4 ? (raw[src + 3] ?? 255) : 255;
          }
        }
      }
      context.putImageData(imageData, 0, 0);
      return { data: canvas.toBuffer('image/png'), ext: 'png', format: 'png' };
    } catch {
      return { data: raw, ext: 'bin', format: 'flate' };
    }
  }
  return { data: contents, ext: 'bin', format: 'raw' };
}
