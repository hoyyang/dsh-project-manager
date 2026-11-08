#!/usr/bin/env node
/**
 * Безопасное применение переводов к исходному JS-модулю: замены выполняются
 * ТОЛЬКО для целых строковых литералов (по позициям сканера), поэтому тела
 * регэкспов, комментарии и код не затрагиваются.
 *
 *   node apply-safe.js <pristine-or-current file> <work-dir>
 *
 * В work-dir: manifest.json, literals.json, functional.json, batch-NN.ru.json.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const FULLWIDTH = /[\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f\u3001\u3002\u300c\u300d\u300e\u300f\u3000\uff5e]/;

const PUNCT = [
  ['（', ' ('], ['）', ')'], ['，', ', '], ['。', '. '], ['、', ', '],
  ['：', ': '], ['；', '; '], ['？', '?'], ['！', '!'],
  ['「', '«'], ['」', '»'], ['『', '«'], ['』', '»'], ['　', ' '], ['～', '~'],
];
const GLUE = [
  [/([А-Яа-яЁё])«/g, '$1 «'],
  [/»([А-Яа-яЁё])/g, '» $1'],
];
function applyPunct(value) {
  let out = value;
  for (const [from, to] of PUNCT) out = out.split(from).join(to);
  for (const [pattern, replacement] of GLUE) out = out.replace(pattern, replacement);
  return out;
}

/** Позиции содержимого строковых литералов (без кавычек). */
function scanStrings(source) {
  const regions = [];
  const n = source.length;
  let i = 0;
  let prevSignificant = '';
  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '/' && !/[A-Za-z0-9_$)\]}]/.test(prevSignificant)) {
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        i++;
      }
      prevSignificant = '/';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const start = i + 1;
      i++;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) break;
        i++;
      }
      regions.push({ start, end: i });
      i++;
      prevSignificant = quote;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return regions;
}

const [, , targetFile, workDir] = process.argv;

const manifest = JSON.parse(fs.readFileSync(path.join(workDir, 'manifest.json'), 'utf8'));
const literals = JSON.parse(fs.readFileSync(path.join(workDir, 'literals.json'), 'utf8'));
const functionalFile = path.join(workDir, 'functional.json');
const skipSet = new Set(fs.existsSync(functionalFile) ? JSON.parse(fs.readFileSync(functionalFile, 'utf8')).map((x) => x.index) : []);

const ru = new Map();
for (const dir of [workDir, path.join(workDir, 'batches')]) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => /^batch-\d+\.ru\.json$/.test(f))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) ru.set(row.index, row.runs);
  }
}

let text = fs.readFileSync(targetFile, 'utf8');
fs.mkdirSync(path.join(workDir, 'backup'), { recursive: true });
const backup = path.join(workDir, 'backup', path.basename(targetFile) + '.pristine.orig');
if (!fs.existsSync(backup)) fs.copyFileSync(targetFile, backup);

const rebuild = (item) => {
  const original = literals[item.index].text;
  const runs = ru.get(item.index);
  if (!runs || runs.length !== item.runTexts.length) return undefined;
  const ALLOWED = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffefA-Za-z0-9 .,:;!?%+\-()]/;
  const positions = [];
  let i = 0;
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
  let out = '';
  let cursor = 0;
  let k = 0;
  for (const [start, end] of positions) {
    out += original.slice(cursor, start) + runs[k++];
    cursor = end;
  }
  out += original.slice(cursor);
  return out;
};

// 1) Переводы: заменяем только целые строковые литералы.
let regions = scanStrings(text);
const regionStarts = new Map(regions.map((region) => [region.start, region]));
let edits = [];
let literalsDone = 0;
let occurrences = 0;
for (const item of manifest.items) {
  if (skipSet.has(item.index)) continue;
  const original = literals[item.index].text;
  const translated = rebuild(item);
  if (translated === undefined) continue;
  const next = applyPunct(translated);
  let from = 0;
  let hit = 0;
  for (;;) {
    const at = text.indexOf(original, from);
    if (at === -1) break;
    from = at + Math.max(1, original.length);
    const region = regionStarts.get(at);
    if (region === undefined || region.end !== at + original.length) continue; // не целый литерал
    edits.push({ start: at, end: at + original.length, value: next });
    hit++;
  }
  if (hit > 0) { literalsDone++; occurrences += hit; }
}
edits.sort((a, b) => b.start - a.start);
for (const edit of edits) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);

// 2) Одиночная полноширинная пунктуация в литералах без китайского.
regions = scanStrings(text);
edits = [];
let punct = 0;
for (const region of regions) {
  const content = text.slice(region.start, region.end);
  if (CJK.test(content) || !FULLWIDTH.test(content)) continue;
  const next = applyPunct(content);
  if (next === content) continue;
  edits.push({ start: region.start, end: region.end, value: next });
  punct++;
}
edits.sort((a, b) => b.start - a.start);
for (const edit of edits) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);

fs.writeFileSync(targetFile, text, 'utf8');
console.log(path.basename(targetFile) + ': литералов переведено ' + literalsDone + ', вхождений ' + occurrences +
  ', пунктуационных литералов ' + punct + ', пропущено функциональных ' + skipSet.size);
console.log('бэкап (исходник до применения): ' + backup);
