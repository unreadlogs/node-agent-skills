import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 600;

const KEY_GLOBALS = [
  'window',
  'document',
  'DOMParser',
  'Node',
  'HTMLElement',
  'SVGElement',
  'NodeFilter',
  'CSSStyleSheet',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

function installGlobals(dom) {
  for (const key of KEY_GLOBALS) {
    try {
      globalThis[key] = dom.window[key];
    } catch {
      Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
    }
  }
  try {
    globalThis.navigator = dom.window.navigator;
  } catch {
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  }
}

function installLayoutShims(dom) {
  const hp = dom.window.HTMLElement.prototype;
  const sizeShim = { configurable: true };
  Object.defineProperty(hp, 'offsetWidth', { ...sizeShim, get() { return this._layoutWidth ?? DEFAULT_WIDTH; } });
  Object.defineProperty(hp, 'offsetHeight', { ...sizeShim, get() { return this._layoutHeight ?? DEFAULT_HEIGHT; } });
  Object.defineProperty(hp, 'clientWidth', { ...sizeShim, get() { return this._layoutWidth ?? DEFAULT_WIDTH; } });
  Object.defineProperty(hp, 'clientHeight', { ...sizeShim, get() { return this._layoutHeight ?? DEFAULT_HEIGHT; } });
  Object.defineProperty(hp, 'scrollWidth', { ...sizeShim, get() { return this._layoutWidth ?? DEFAULT_WIDTH; } });
  Object.defineProperty(hp, 'scrollHeight', { ...sizeShim, get() { return this._layoutHeight ?? DEFAULT_HEIGHT; } });

  const origGCS = dom.window.getComputedStyle;
  dom.window.getComputedStyle = function (el, pseudo) {
    const cs = origGCS.call(this, el, pseudo);
    const raw = cs.getPropertyValue.bind(cs);
    cs.getPropertyValue = (name) => {
      const value = raw(name);
      return value === '' ? '0px' : value;
    };
    return cs;
  };
}

function installCanvasShim(dom) {
  const cp = dom.window.HTMLCanvasElement.prototype;
  cp.getContext = function (type, attrs) {
    if (this._napiCanvas) return this._napiCanvas.getContext(type);
    const w = Math.max(Number(this.width) || DEFAULT_WIDTH, 1);
    const h = Math.max(Number(this.height) || DEFAULT_HEIGHT, 1);
    this._napiCanvas = createCanvas(w, h);
    return this._napiCanvas.getContext(type);
  };
  cp.toDataURL = function (type) {
    return this._napiCanvas ? this._napiCanvas.toDataURL(type) : '';
  };
}

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

function fontOf(el) {
  let node = el;
  while (node && node.getAttribute) {
    const size = parseFloat(node.getAttribute('font-size'));
    if (Number.isFinite(size) && size > 0) return size;
    node = node.parentElement;
  }
  return 16;
}

function measureText(el) {
  const textLength = el.getAttribute('textLength');
  const chars = (el.textContent || '').length;
  return textLength ? toNumber(textLength) : Math.max(chars * fontOf(el) * 0.6, 1);
}

function bboxOf(el) {
  const tag = el.tagName;
  if (tag === 'text' || tag === 'tspan') {
    const fs = fontOf(el);
    const y = toNumber(el.getAttribute('y')) || fs;
    return { x: toNumber(el.getAttribute('x')), y: y - fs, width: measureText(el), height: fs };
  }
  if (tag === 'rect' || tag === 'image') {
    return {
      x: toNumber(el.getAttribute('x')),
      y: toNumber(el.getAttribute('y')),
      width: toNumber(el.getAttribute('width')),
      height: toNumber(el.getAttribute('height')),
    };
  }
  if (tag === 'foreignObject') {
    const x = toNumber(el.getAttribute('x'));
    const y = toNumber(el.getAttribute('y'));
    const w = toNumber(el.getAttribute('width'));
    const h = toNumber(el.getAttribute('height'));
    if (w > 0 && h > 0) return { x, y, width: w, height: h };
    const div = el.querySelector('div');
    if (div) {
      const lines = (div.textContent || '').split('\n');
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const fs = fontOf(el);
      return { x, y, width: Math.max(w, maxLen * fs * 0.6 + 8), height: Math.max(h, lines.length * fs + 8) };
    }
    return null;
  }
  if (tag === 'ellipse') {
    const cx = toNumber(el.getAttribute('cx'));
    const cy = toNumber(el.getAttribute('cy'));
    const rx = toNumber(el.getAttribute('rx'));
    const ry = toNumber(el.getAttribute('ry'));
    return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
  }
  if (tag === 'circle') {
    const cx = toNumber(el.getAttribute('cx'));
    const cy = toNumber(el.getAttribute('cy'));
    const r = toNumber(el.getAttribute('r'));
    return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
  }
  if (tag === 'line') {
    const x1 = toNumber(el.getAttribute('x1'));
    const y1 = toNumber(el.getAttribute('y1'));
    const x2 = toNumber(el.getAttribute('x2'));
    const y2 = toNumber(el.getAttribute('y2'));
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '').trim().split(/\s+/).map((p) => p.split(','));
    if (!pts.length || !pts[0][0]) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of pts) {
      const x = toNumber(px);
      const y = toNumber(py);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return null;
}

class Matrix {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
  }
  multiply(o) {
    const r = new Matrix();
    r.a = this.a * o.a + this.c * o.b;
    r.b = this.b * o.a + this.d * o.b;
    r.c = this.a * o.c + this.c * o.d;
    r.d = this.b * o.c + this.d * o.d;
    r.e = this.a * o.e + this.c * o.f + this.e;
    r.f = this.b * o.e + this.d * o.f + this.f;
    return r;
  }
  apply(x, y) {
    return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f];
  }
}

function parseTransform(str) {
  let m = new Matrix();
  if (!str) return m;
  const re = /(translate|scale|rotate|skewX|skewY|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const args = match[2].split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    const t = new Matrix();
    switch (match[1]) {
      case 'translate':
        t.e = args[0] || 0;
        t.f = args[1] || 0;
        break;
      case 'scale':
        t.a = args[0] || 1;
        t.d = args[1] ?? args[0] ?? 1;
        break;
      case 'rotate': {
        const angle = (args[0] || 0) * (Math.PI / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        if (args.length >= 3) {
          t.a = cos;
          t.b = sin;
          t.c = -sin;
          t.d = cos;
          t.e = args[1] - cos * args[1] + sin * args[2];
          t.f = args[2] - sin * args[1] - cos * args[2];
        } else {
          t.a = cos;
          t.b = sin;
          t.c = -sin;
          t.d = cos;
        }
        break;
      }
      case 'skewX':
        t.c = Math.tan((args[0] || 0) * (Math.PI / 180));
        break;
      case 'skewY':
        t.b = Math.tan((args[0] || 0) * (Math.PI / 180));
        break;
      case 'matrix':
        t.a = args[0] || 1;
        t.b = args[1] || 0;
        t.c = args[2] || 0;
        t.d = args[3] || 1;
        t.e = args[4] || 0;
        t.f = args[5] || 0;
        break;
      default:
        break;
    }
    m = m.multiply(t);
  }
  return m;
}

function installSvgMeasurement(dom) {
  const S = dom.window.SVGElement.prototype;
  S.getBBox = function () {
    const els = [this, ...this.querySelectorAll('*')];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;
    for (const el of els) {
      const b = bboxOf(el);
      if (!b || (b.width <= 0 && b.height <= 0)) continue;
      let m = new Matrix();
      let node = el;
      while (node && node !== this) {
        m = m.multiply(parseTransform(node.getAttribute('transform')));
        node = node.parentElement;
      }
      m = m.multiply(parseTransform(this.getAttribute('transform')));
      const corners = [
        m.apply(b.x, b.y),
        m.apply(b.x + b.width, b.y),
        m.apply(b.x, b.y + b.height),
        m.apply(b.x + b.width, b.y + b.height),
      ];
      for (const [x, y] of corners) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      found = true;
    }
    if (!found) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  if (!S.getComputedTextLength) {
    S.getComputedTextLength = function () {
      return measureText(this);
    };
  }
}

let dom = null;

export function setupDom() {
  if (dom) return dom;
  dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
  installGlobals(dom);
  installLayoutShims(dom);
  installCanvasShim(dom);
  installSvgMeasurement(dom);
  return dom;
}
