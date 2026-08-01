import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const CLI = join(import.meta.dirname, '..', 'scripts', 'index.js');

const dir = mkdtempSync(join(tmpdir(), 'pdf-skill-'));
const samplePath = join(dir, 'sample.pdf');
const multiPath = join(dir, 'multi.pdf');
const fixturePath = join(dir, 'fixture.pdf');
const imagePath = join(dir, 'image.pdf');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function parseData(result) {
  assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

async function buildSample() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Hello World from the PDF toolkit', { x: 72, y: 700, size: 12, font: helv });
  page.drawText('Invoice Number 2024-0001', { x: 72, y: 670, size: 10, font: helv });
  writeFileSync(samplePath, await doc.save());
}

async function buildMulti() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page number ${i}`, { x: 72, y: 700, size: 12, font: helv });
  }
  writeFileSync(multiPath, await doc.save());
}

async function buildFixture() {
  const doc = await PDFDocument.create();
  doc.setTitle('Fixture Document');
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Chapter One text', { x: 100, y: 700, size: 12, font: helv });

  const linkDict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [100, 690, 260, 710],
    Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of('https://example.com') },
  });
  const noteDict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [300, 690, 320, 710],
    Contents: PDFString.of('A helpful note'),
    Name: 'Comment',
  });
  page.node.set(PDFName.of('Annots'), doc.context.obj([linkDict, noteDict]));

  const outlineItem = doc.context.obj({
    Title: PDFString.of('Chapter One'),
    Dest: [page.ref, 'XYZ', 0, 700, 0],
  });
  const outlineItemRef = doc.context.register(outlineItem);
  const outlineRef = doc.context.register(
    doc.context.obj({ Type: 'Outlines', Count: 1, First: outlineItemRef, Last: outlineItemRef }),
  );
  outlineItem.set(PDFName.of('Parent'), outlineRef);
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);

  writeFileSync(fixturePath, await doc.save());
}

async function buildImage() {
  const canvas = createCanvas(100, 80);
  const context = canvas.getContext('2d');
  context.fillStyle = '#3366ff';
  context.fillRect(0, 0, 100, 80);
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(canvas.toBuffer('image/png'));
  const page = doc.addPage([200, 200]);
  page.drawImage(image, { x: 50, y: 50, width: 100, height: 80 });
  writeFileSync(imagePath, await doc.save());
}

test.before(async () => {
  await Promise.all([buildSample(), buildMulti(), buildFixture(), buildImage()]);
});

test('info returns page count and metadata', () => {
  const data = parseData(run(['info', samplePath]));
  assert.equal(data.page_count, 1);
  assert.equal(data.pages[0].width, 612);
  assert.equal(data.pages[0].height, 792);
});

test('text extracts page content', () => {
  const data = parseData(run(['text', samplePath]));
  assert.match(data.text, /Hello World/);
  assert.match(data.text, /toolkit/);
});

test('text honors --pages range', () => {
  const data = parseData(run(['text', multiPath, '--pages', '2-3']));
  assert.equal(data.pages, 2);
  assert.match(data.text, /Page number 2/);
  assert.doesNotMatch(data.text, /Page number 1/);
});

test('search finds matches with coordinates', () => {
  const data = parseData(run(['search', samplePath, 'world']));
  assert.ok(data.total_matches >= 1);
  const match = data.matches[0];
  assert.equal(match.page, 1);
  assert.match(match.text.toLowerCase(), /world/);
  assert.ok(typeof match.x0 === 'number');
  assert.ok(typeof match.top === 'number');
});

test('search is case-insensitive by default and sensitive with flag', () => {
  assert.ok(parseData(run(['search', samplePath, 'WORLD'])).total_matches >= 1);
  const sensitive = parseData(run(['search', samplePath, 'WORLD', '--case-sensitive']));
  assert.equal(sensitive.total_matches, 0);
});

test('search with no matches reports zero', () => {
  const data = parseData(run(['search', samplePath, 'zzzqqq']));
  assert.equal(data.total_matches, 0);
  assert.deepEqual(data.matches, []);
});

test('metadata reads document metadata', () => {
  const data = parseData(run(['metadata', fixturePath]));
  assert.equal(data.metadata.title, 'Fixture Document');
});

test('metadata writes new values', () => {
  const outPath = join(dir, 'meta.pdf');
  parseData(run(['metadata', samplePath, outPath, '--title', 'Renamed', '--author', 'Agent']));
  const data = parseData(run(['metadata', outPath]));
  assert.equal(data.metadata.title, 'Renamed');
  assert.equal(data.metadata.author, 'Agent');
});

test('render produces PNG images', async () => {
  const outDir = join(dir, 'render');
  const data = parseData(run(['render', samplePath, outDir]));
  assert.equal(data.images.length, 1);
  const image = await loadImage(readFileSync(data.images[0].path));
  assert.equal(image.width, 612);
  assert.equal(image.height, 792);
});

test('extract-images extracts embedded images', () => {
  const outDir = join(dir, 'images');
  const data = parseData(run(['extract-images', imagePath, outDir]));
  assert.equal(data.images.length, 1);
  assert.equal(data.images[0].width, 100);
  assert.equal(data.images[0].height, 80);
  assert.ok(existsSync(data.images[0].path));
});

test('annotations lists link and note annotations', () => {
  const data = parseData(run(['annotations', fixturePath]));
  assert.equal(data.annotation_count, 2);
  const link = data.annotations.find((a) => a.type === 'Link');
  assert.ok(link);
  assert.match(link.url, /example\.com/);
  const note = data.annotations.find((a) => a.type === 'Text');
  assert.equal(note.text, 'A helpful note');
  assert.equal(note.page, 1);
});

test('outline extracts bookmarks', () => {
  const data = parseData(run(['outline', fixturePath]));
  assert.equal(data.outline.length, 1);
  assert.equal(data.outline[0].title, 'Chapter One');
  assert.equal(data.outline[0].page, 1);
});

test('remove-pages drops selected pages', () => {
  const outPath = join(dir, 'removed.pdf');
  parseData(run(['remove-pages', multiPath, outPath, '--pages', '1,3']));
  const info = parseData(run(['info', outPath]));
  assert.equal(info.page_count, 2);
  const data = parseData(run(['text', outPath]));
  assert.match(data.text, /Page number 2/);
  assert.match(data.text, /Page number 4/);
  assert.doesNotMatch(data.text, /Page number 1/);
});

test('remove-pages accepts a range', () => {
  const outPath = join(dir, 'removed-range.pdf');
  parseData(run(['remove-pages', multiPath, outPath, '--pages', '2-3']));
  assert.equal(parseData(run(['info', outPath])).page_count, 2);
});

test('crop sets the crop box', async () => {
  const outPath = join(dir, 'cropped.pdf');
  parseData(run(['crop', multiPath, outPath, '--x', '100', '--y', '200', '--width', '300', '--height', '400']));
  const doc = await PDFDocument.load(readFileSync(outPath));
  const box = doc.getPage(0).getCropBox();
  assert.equal(box.x, 100);
  assert.equal(box.width, 300);
  assert.equal(box.height, 400);
});

test('stamp overlays text on pages', () => {
  const outPath = join(dir, 'stamped.pdf');
  parseData(run(['stamp', samplePath, outPath, '--text', 'CONFIDENTIAL', '--x', '50', '--y', '50', '--size', '18']));
  const data = parseData(run(['text', outPath]));
  assert.match(data.text, /CONFIDENTIAL/);
  assert.match(data.text, /Hello World/);
});

test('page-numbers draws numbers', () => {
  const outPath = join(dir, 'numbered.pdf');
  parseData(run(['page-numbers', multiPath, outPath, '--with-total']));
  const data = parseData(run(['text', outPath]));
  assert.match(data.text, /1 \/ 4/);
  assert.match(data.text, /4 \/ 4/);
});

test('merge and split round-trip', () => {
  const mergedPath = join(dir, 'merged.pdf');
  const merged = parseData(run(['merge', mergedPath, samplePath, samplePath]));
  assert.equal(merged.merged, 2);
  assert.equal(parseData(run(['info', mergedPath])).page_count, 2);

  const splitDir = join(dir, 'split');
  const split = parseData(run(['split', mergedPath, splitDir, '--pages', '2']));
  assert.equal(split.files.length, 1);
  assert.ok(existsSync(split.files[0].path));
});

test('merge accepts a page range per input', () => {
  const outPath = join(dir, 'merged-range.pdf');
  const merged = parseData(run(['merge', outPath, `${multiPath}:1-2`, samplePath]));
  assert.equal(merged.merged, 2);
  assert.equal(parseData(run(['info', outPath])).page_count, 3);
});

test('split with --by-range produces chunks', () => {
  const outDir = join(dir, 'chunks');
  const data = parseData(run(['split', multiPath, outDir, '--by-range', '1-2,4']));
  assert.equal(data.chunks, 2);
  assert.deepEqual(data.files[0].pages, [1, 2]);
  assert.deepEqual(data.files[1].pages, [4]);
  assert.ok(existsSync(data.files[0].path));
});

test('split rejects --pages with --by-range', () => {
  const result = run(['split', multiPath, join(dir, 'x'), '--pages', '1', '--by-range', '1-2']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /either/);
});

test('stamp supports multi-line text and background', () => {
  const outPath = join(dir, 'stamped-multi.pdf');
  parseData(run([
    'stamp', samplePath, outPath,
    '--text', 'CONFIDENTIAL\nFOR REVIEW',
    '--background', 'FFCC00',
    '--size', '14',
  ]));
  const data = parseData(run(['text', outPath]));
  assert.match(data.text, /CONFIDENTIAL/);
  assert.match(data.text, /FOR REVIEW/);
  assert.match(data.text, /Hello World/);
});

test('render supports jpg output', () => {
  const outDir = join(dir, 'render-jpg');
  const data = parseData(run(['render', samplePath, outDir, '--format', 'jpg', '--quality', '0.8']));
  assert.equal(data.images.length, 1);
  assert.equal(data.images[0].format, 'jpg');
  assert.ok(existsSync(data.images[0].path));
});

test('thumbnail produces small preview images', () => {
  const outDir = join(dir, 'thumbs');
  const data = parseData(run(['thumbnail', multiPath, outDir, '--size', '120']));
  assert.equal(data.images.length, 4);
  assert.ok(data.images.every((img) => img.width <= 120 && img.height <= 120));
  assert.match(data.images[0].path, /thumb_1\.png/);
});

test('search supports regex queries', () => {
  const data = parseData(run(['search', samplePath, '\\d{4}-\\d{4}', '--regex']));
  assert.equal(data.total_matches, 1);
  assert.match(data.matches[0].text, /2024-0001/);
});

test('search regex supports anchored single-word patterns', () => {
  const data = parseData(run(['search', samplePath, '^World$', '--regex']));
  assert.ok(data.total_matches >= 1);
  assert.match(data.matches[0].text, /World/);
});

test('search with invalid regex errors cleanly', () => {
  const result = run(['search', samplePath, '([', '--regex']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /regular expression/);
});

test('create embeds images from a spec', () => {
  const canvas = createCanvas(20, 20);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 20, 20);
  const b64 = canvas.toBuffer('image/png').toString('base64');

  const specPath = join(dir, 'spec-with-image.json');
  writeFileSync(specPath, JSON.stringify({
    pages: [
      {
        width: 200,
        height: 200,
        images: [{ x: 20, y: 20, width: 40, height: 40, data: b64 }],
      },
    ],
  }));
  const outPath = join(dir, 'created-image.pdf');
  parseData(run(['create', outPath, '--json', specPath]));
  const extractedDir = join(dir, 'created-img');
  const extracted = parseData(run(['extract-images', outPath, extractedDir]));
  assert.equal(extracted.images.length, 1);
  assert.equal(extracted.images[0].width, 20);
  assert.equal(extracted.images[0].height, 20);
});

test('version flag returns the package version', () => {
  const data = parseData(run(['--version']));
  assert.equal(data.name, 'skill-pdf');
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
});

test('rotate changes page rotation', () => {
  const outPath = join(dir, 'rotated.pdf');
  parseData(run(['rotate', samplePath, outPath, '--pages', '1', '--deg', '90']));
  assert.equal(parseData(run(['info', outPath])).page_count, 1);
});

test('create makes a pdf from text', () => {
  const outPath = join(dir, 'created.pdf');
  const data = parseData(run(['create', outPath, '--text', 'Hello World']));
  assert.equal(data.pages, 1);
  assert.ok(existsSync(outPath));
});

test('watermark overlays a source page', () => {
  const outPath = join(dir, 'watermarked.pdf');
  parseData(run(['watermark', samplePath, multiPath, outPath]));
  assert.equal(parseData(run(['info', outPath])).page_count, 1);
});

test('unknown command fails with JSON error and exit 1', () => {
  const result = run(['frobnicate']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /Unknown command/);
});

test('missing file fails with JSON error and exit 1', () => {
  const result = run(['info', join(dir, 'missing.pdf')]);
  assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stderr).error);
});

test('stamp requires --text', () => {
  const result = run(['stamp', samplePath, join(dir, 'x.pdf')]);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /--text/);
});

test('remove-pages requires --pages', () => {
  const result = run(['remove-pages', samplePath, join(dir, 'x.pdf')]);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /--pages/);
});
