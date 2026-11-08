#!/usr/bin/env node
/**
 * Готовит пакеты для перевода: разбивает литералы на «текстовые фрагменты»
 * (непрерывные куски с китайским текстом, без HTML/JS-синтаксиса) и строит
 * контекст вида "…⟦0⟧…⟦1⟧…", чтобы переводчик видел всю строку целиком.
 *
 *   node prepare-batches.js <literals.json> <out-dir> [размер пакета]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
// Символы, которые могут быть внутри переводимого фрагмента.
const ALLOWED = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffefA-Za-z0-9 .,:;!?%+\-()]/;

function runsOf(text) {
  const runs = [];
  let i = 0;
  while (i < text.length) {
    if (!ALLOWED.test(text[i])) { i++; continue; }
    let j = i;
    while (j < text.length && ALLOWED.test(text[j])) j++;
    let start = i;
    let end = j;
    while (start < end && text[start] === ' ') start++;
    while (end > start && text[end - 1] === ' ') end--;
    if (start < end && CJK.test(text.slice(start, end))) runs.push([start, end]);
    i = j;
  }
  return runs;
}

// Окно контекста вокруг фрагмента: переводчику нужна фраза, а не весь
// HTML/CSS-литерал (некоторые занимают >100 тыс. знаков).
const PRE = 120;
const GAP = 160;
const POST = 120;

function contextOf(text, runs) {
  let context = '';
  let cursor = 0;
  runs.forEach(([start, end], k) => {
    if (k === 0) {
      context += (start > PRE ? '…' : '') + text.slice(Math.max(0, start - PRE), start);
    } else {
      const gap = text.slice(cursor, start);
      context += gap.length > GAP ? '…' + gap.slice(gap.length - GAP) : gap;
    }
    context += '⟦' + k + '⟧';
    cursor = end;
  });
  const tail = text.slice(cursor);
  context += tail.length > POST ? tail.slice(0, POST) + '…' : tail;
  return context;
}

const [, , literalsPath, outDir, batchArg] = process.argv;
const batchSize = Number(batchArg || 100);
const literals = JSON.parse(fs.readFileSync(literalsPath, 'utf8'));

const items = [];
let totalRunChars = 0;
for (let index = 0; index < literals.length; index++) {
  const { text } = literals[index];
  const runs = runsOf(text);
  if (runs.length === 0) continue;
  const runTexts = runs.map(([start, end]) => text.slice(start, end));
  totalRunChars += runTexts.reduce((sum, r) => sum + r.length, 0);
  items.push({ index, runTexts, context: contextOf(text, runs) });
}

fs.mkdirSync(outDir, { recursive: true });
const batches = [];
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize).map((item) => ({ index: item.index, context: item.context }));
  const file = path.join(outDir, 'batch-' + String(batches.length + 1).padStart(2, '0') + '.json');
  fs.writeFileSync(file, JSON.stringify(batch, null, 1), 'utf8');
  batches.push({ file, count: batch.length, runChars: items.slice(i, i + batchSize).reduce((s, it) => s + it.runTexts.reduce((a, r) => a + r.length, 0), 0) });
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ source: literalsPath, items, batches }, null, 1), 'utf8');
console.log('literals with CJK: ' + literals.length + ', with text runs: ' + items.length);
console.log('total text chars to translate: ' + totalRunChars);
console.log('batches: ' + batches.length);
for (const b of batches) console.log('  ' + path.basename(b.file) + ': ' + b.count + ' strings, ' + b.runChars + ' chars');
