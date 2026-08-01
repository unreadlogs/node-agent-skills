import { Resvg } from '@resvg/resvg-js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { setupDom } from './env.js';

const FONT_DIR = new URL('../../assets/fonts/', import.meta.url);
const FONT_FILES = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
].map((f) => new URL(f, FONT_DIR).pathname);

const DEFAULT_DPI = 96;

function parseViewBox(svg) {
  const match = svg.match(/viewBox="([^"]*)"/);
  if (!match) return null;
  const [x, y, w, h] = match[1].split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, width: w, height: h };
}

function collectAncestorClasses(el) {
  const classes = [];
  let node = el;
  while (node) {
    const cls = (node.getAttribute && node.getAttribute('class')) || '';
    for (const c of cls.split(/\s+/)) if (c) classes.push(c);
    node = node.parentElement;
  }
  return classes;
}

function absoluteTransform(el, root) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let node = el;
  while (node && node !== root) {
    m = multiply(m, parseTransformAttr(node.getAttribute('transform')));
    node = node.parentElement;
  }
  return m;
}

function parseTransformAttr(str) {
  const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (!str) return m;
  const re = /(translate|scale|rotate)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const args = match[2].split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (match[1] === 'translate') {
      m.e += args[0] || 0;
      m.f += args[1] || 0;
    } else if (match[1] === 'scale') {
      m.a *= args[0] || 1;
      m.d *= args[1] ?? args[0] ?? 1;
    } else if (match[1] === 'rotate') {
      const angle = (args[0] || 0) * (Math.PI / 180);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const na = m.a * cos + m.c * sin;
      const nb = m.b * cos + m.d * sin;
      const nc = -m.a * sin + m.c * cos;
      const nd = -m.b * sin + m.d * cos;
      m.a = na;
      m.b = nb;
      m.c = nc;
      m.d = nd;
    }
  }
  return m;
}

function multiply(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function foreignObjectsToText(svg) {
  const dom = setupDom();
  const doc = new dom.window.DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;

  const labelStyle = (el) => {
    const classes = collectAncestorClasses(el);
    if (classes.includes('classGroup') || classes.includes('members-group') || classes.includes('methods-group')) {
      return { fontSize: 10, fill: '#9370DB' };
    }
    if (classes.includes('label') || classes.includes('label-group')) {
      return { fontSize: 10, fill: '#131300' };
    }
    return { fontSize: 16, fill: '#333333' };
  };

  const foreigns = [...root.querySelectorAll('foreignObject')];
  for (const fo of foreigns) {
    const div = fo.querySelector('div');
    if (!div) continue;
    const matrix = absoluteTransform(fo, root);
    const baseX = (fo.getAttribute('x') ? parseFloat(fo.getAttribute('x')) : 0) + matrix.e;
    const baseY = (fo.getAttribute('y') ? parseFloat(fo.getAttribute('y')) : 0) + matrix.f;
    const foW = parseFloat(fo.getAttribute('width')) || 0;
    const foH = parseFloat(fo.getAttribute('height')) || 0;

    const lines = [];
    for (const child of div.querySelectorAll('p, br, div, span')) {
      const text = (child.textContent || '').trim();
      if (child.tagName === 'BR') {
        lines.push('');
      } else if (text) {
        lines.push(text);
      }
    }
    if (!lines.length) {
      const text = (div.textContent || '').trim();
      if (text) lines.push(...text.split('\n'));
    }

    const { fontSize, fill } = labelStyle(fo);
    const inlineStyle = div.getAttribute('style') || '';
    const textAlign = /text-align:\s*(left|center|right)/.exec(inlineStyle)?.[1] || 'center';
    const lineHeight = parseFloat(/line-height:\s*([\d.]+)/.exec(inlineStyle)?.[1]) || 1.5;

    const anchor = textAlign === 'center' ? 'middle' : 'start';
    const width = foW || Math.max(1, ...lines.map((l) => l.length)) * fontSize * 0.6 + 8;
    const height = foH || lines.length * fontSize * lineHeight + 6;
    let textX = baseX;
    if (anchor === 'middle') textX = baseX + width / 2;
    else textX = baseX + 2;

    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'converted-labels');
    const firstBaseline = baseY + fontSize;
    lines.forEach((line, i) => {
      const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      tspan.setAttribute('x', String(textX));
      tspan.setAttribute('y', String(firstBaseline + i * fontSize * lineHeight));
      tspan.setAttribute('text-anchor', anchor);
      tspan.setAttribute('font-size', String(fontSize));
      tspan.setAttribute('fill', fill);
      tspan.setAttribute('font-family', 'Liberation Sans, sans-serif');
      tspan.textContent = line;
      g.appendChild(tspan);
    });
    fo.parentNode.insertBefore(g, fo);
    fo.parentNode.removeChild(fo);
  }

  if (!foreigns.length) return svg;
  return new dom.window.XMLSerializer().serializeToString(root);
}

export function rasterizeSvg(svg, options = {}) {
  const clean = svg
    .replace(/NaN/g, '0')
    .replace(/\bundefined\b/g, '0')
    .replace(/\bInfinity\b/g, '0')
    .replace(/\s(clip-path|mask|filter)="[^"]*"/g, '');
  const scale = options.scale || 1;
  const width = options.width;
  const fitTo = width
    ? { mode: 'width', value: Math.max(1, Math.round(width * scale)) }
    : { mode: 'original', value: undefined };
  const resvg = new Resvg(clean, {
    fitTo: width ? fitTo : { mode: 'zoom', value: scale },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Liberation Sans',
    },
    background: options.background && options.background !== 'transparent' ? options.background : null,
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

export async function pngToJpeg(png, quality = 90) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.drawImage(image, 0, 0);
  return canvas.toBuffer('image/jpeg', quality);
}

export async function pngToPdf(png, options = {}) {
  const image = await loadImage(png);
  const dpi = options.dpi || DEFAULT_DPI;
  const widthPt = (image.width * 72) / dpi;
  const heightPt = (image.height * 72) / dpi;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([widthPt, heightPt]);
  const embedded = await pdf.embedPng(png);
  page.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
  return pdf.save();
}

export function buildHtml(svg, source, options = {}) {
  const title = options.title || 'Mermaid diagram';
  const escapedSvg = svg
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
<style>
  body { font-family: sans-serif; margin: 2rem; color: #222; }
  .diagram-box { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: inline-block; background: #fff; }
  pre.source { background: #f6f8fa; padding: 1rem; border-radius: 8px; overflow: auto; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>${escapeXml(title)}</h1>
<div class="diagram-box">${escapedSvg}</div>
<h2>Mermaid source</h2>
<pre class="source"><code>${escapeXml(source)}</code></pre>
</body>
</html>`;
}
