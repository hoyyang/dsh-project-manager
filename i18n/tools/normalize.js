#!/usr/bin/env node
/**
 * Постобработка локализованного бандла:
 *  1) чинит один регэксп, который задели замены фрагментов;
 *  2) нормализует полноширинные знаки препинания, оставшиеся вне переведённых
 *     фрагментов (китайские скобки/запятые внутри HTML, join("、") и т.п.);
 *  3) сохраняет память переводов "китайский литерал → русский литерал".
 *
 *   node normalize.js <file.js> <work-dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [, , targetFile, workDir] = process.argv;

// Замена, которую нужно внести: регэксп поиска кнопки «Новая сессия» был
// частично переведён вместе со строковыми литералами.
const REGEX_FIX = [
  ['/新建Сессий|New session/i', '/New session|Новая сессия/i'],
];

const PUNCT = [
  ['（', ' ('],
  ['）', ')'],
  ['，', ', '],
  ['。', '. '],
  ['、', ', '],
  ['：', ': '],
  ['；', '; '],
  ['？', '?'],
  ['！', '!'],
  ['「', '«'],
  ['」', '»'],
  ['『', '«'],
  ['』', '»'],
  ['　', ' '],
  ['～', '~'],
];

// Склейки кавычек с русским словом, унаследованные от китайской расстановки
// (в китайском пробел перед 「 не нужен, в русском перед « нужен).
const GLUE = [
  [/([А-Яа-яЁё])«/g, '$1 «'],
  [/»([А-Яа-яЁё])/g, '» $1'],
];

let text = fs.readFileSync(targetFile, 'utf8');
for (const [from, to] of REGEX_FIX) {
  const count = text.split(from).length - 1;
  console.log('регэксп ' + from + ': ' + count + ' вхождений');
  text = text.split(from).join(to);
}
for (const [from, to] of PUNCT) {
  const count = text.split(from).length - 1;
  if (count === 0) continue;
  if (from === '（') {
    // Пробел перед скобкой — только когда она продолжает слово.
    text = text.replace(/（/g, (match, offset) => {
      const prev = text[offset - 1];
      return offset === 0 || /[\s"'>]/.test(prev) ? '(' : ' (';
    });
  } else {
    text = text.split(from).join(to);
  }
  console.log('знак ' + JSON.stringify(from) + ' → ' + JSON.stringify(to) + ': ' + count);
}
for (const [pattern, replacement] of GLUE) {
  const matches = text.match(pattern) || [];
  console.log('склейка ' + pattern + ': ' + matches.length);
  text = text.replace(pattern, replacement);
}
fs.writeFileSync(targetFile, text, 'utf8');

// --- память переводов: исходный китайский литерал → итоговый русский ---
const manifest = JSON.parse(fs.readFileSync(path.join(workDir, 'manifest.json'), 'utf8'));
const literalsFile = ['literals-client.json', 'literals.json']
  .map((name) => path.join(workDir, name))
  .find((file) => fs.existsSync(file));
const literals = JSON.parse(fs.readFileSync(literalsFile, 'utf8'));
const ALLOWED = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffefA-Za-z0-9 .,:;!?%+\-()]/;
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const translations = new Map();
const batchDirs = [workDir, path.join(workDir, 'batches')].filter((dir) => fs.existsSync(dir));
for (const dir of batchDirs) {
  for (const file of fs.readdirSync(dir).filter((f) => /^batch-\d+\.ru\.json$/.test(f))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) translations.set(row.index, row.runs);
  }
}
const applyPunct = (value) => {
  let out = value;
  for (const [from, to] of PUNCT) out = out.split(from).join(to);
  for (const [pattern, replacement] of GLUE) out = out.replace(pattern, replacement);
  return out;
};
const memory = [];
for (const item of manifest.items) {
  const original = literals[item.index].text;
  const runs = translations.get(item.index);
  if (!runs || runs.length !== item.runTexts.length) continue;
  let rebuilt = '';
  let cursor = 0;
  let k = 0;
  let i = 0;
  const positions = [];
  while (i < original.length) {
    if (!ALLOWED.test(original[i])) { i++; continue; }
    let j = i;
    while (j < original.length && ALLOWED.test(original[j])) j++;
    let start = i;
    let end = j;
    while (start < end && original[start] === ' ') start++;
    while (end > start && original[end - 1] === ' ') end--;
    if (start < end && CJK.test(original.slice(start, end))) positions.push([start, end]);
    i = j;
  }
  for (const [start, end] of positions) {
    rebuilt += original.slice(cursor, start) + runs[k++];
    cursor = end;
  }
  rebuilt += original.slice(cursor);
  memory.push({ zh: original, ru: applyPunct(rebuilt) });
}
fs.writeFileSync(path.join(workDir, 'translated-literals.json'), JSON.stringify(memory, null, 1), 'utf8');
console.log('память переводов: ' + memory.length + ' пар → ' + path.join(workDir, 'translated-literals.json'));
