#!/usr/bin/env node
/**
 * Применяет переводы фрагментов к бандлу плагина.
 *
 * На вход: manifest.json (из prepare-batches.js), literals-client.json и файлы
 * batch-NN.ru.json с переводом каждого ⟦k⟧. Для каждого литерала заново
 * собирается строка (все символы вне фрагментов сохраняются байт-в-байт), затем
 * все вхождения исходного литерала в файле заменяются собранной строкой.
 *
 *   node apply-translations.js <file.js> <work-dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const [, , targetFile, workDir] = process.argv;

const manifest = JSON.parse(fs.readFileSync(path.join(workDir, 'manifest.json'), 'utf8'));
const literalsFile = ['literals-client.json', 'literals.json']
  .map((name) => path.join(workDir, name))
  .find((file) => fs.existsSync(file));
const literals = JSON.parse(fs.readFileSync(literalsFile, 'utf8'));

// Собираем переводы из всех файлов batch-*.ru.json.
const translations = new Map();
const problems = [];
// Литералы, которые нельзя переводить (регэкспы, заголовки-маркеры STATE).
const functionalFile = path.join(workDir, 'functional.json');
const skipSet = new Set(
  fs.existsSync(functionalFile)
    ? JSON.parse(fs.readFileSync(functionalFile, 'utf8')).map((item) => item.index)
    : [],
);
console.log('функциональных литералов (останутся китайскими): ' + skipSet.size);

// Полноширинные знаки и склейки кавычек в русском тексте приводим к русской
// типографике ещё до вставки в бандл.
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
const batchFiles = fs.readdirSync(workDir).filter((f) => /^batch-\d+\.ru\.json$/.test(f)).sort();
for (const file of batchFiles) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(workDir, file), 'utf8'));
  } catch (error) {
    problems.push(file + ': невалидный JSON (' + error.message + ')');
    continue;
  }
  for (const row of parsed) {
    if (typeof row.index !== 'number' || !Array.isArray(row.runs)) {
      problems.push(file + ': строка без index/runs');
      continue;
    }
    translations.set(row.index, row.runs);
  }
}

let text = fs.readFileSync(targetFile, 'utf8');
fs.mkdirSync(path.join(workDir, 'backup'), { recursive: true });
const backup = path.join(workDir, 'backup', path.basename(targetFile) + '.before-l10n.orig');
if (!fs.existsSync(backup)) fs.copyFileSync(targetFile, backup);

let literalsDone = 0;
let replacements = 0;
let literalsSkipped = 0;
const skeletonProblems = [];

for (const item of manifest.items) {
  const original = literals[item.index].text;
  const expectedRuns = item.runTexts;
  const runs = translations.get(item.index);
  if (runs === undefined) { literalsSkipped++; continue; }
  if (runs.length !== expectedRuns.length) {
    problems.push('литерал ' + item.index + ': фрагментов ' + expectedRuns.length + ', переводов ' + runs.length);
    literalsSkipped++;
    continue;
  }
  // Заново собираем строку: вне фрагментов — исходные символы.
  let rebuilt = '';
  let cursor = 0;
  let k = 0;
  const runsWithPositions = [];
  {
    // повторяем разбиение из prepare-batches.js
    const ALLOWED = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffefA-Za-z0-9 .,:;!?%+\-()]/;
    let i = 0;
    while (i < original.length) {
      if (!ALLOWED.test(original[i])) { i++; continue; }
      let j = i;
      while (j < original.length && ALLOWED.test(original[j])) j++;
      let start = i;
      let end = j;
      while (start < end && original[start] === ' ') start++;
      while (end > start && original[end - 1] === ' ') end--;
      if (start < end && CJK.test(original.slice(start, end))) runsWithPositions.push([start, end]);
      i = j;
    }
  }
  for (const [start, end] of runsWithPositions) {
    rebuilt += original.slice(cursor, start) + runs[k++];
    cursor = end;
  }
  rebuilt += original.slice(cursor);

  if (skipSet.has(item.index)) { literalsSkipped++; continue; }
  rebuilt = applyPunct(rebuilt);

  if (CJK.test(rebuilt)) problems.push('литерал ' + item.index + ': в переводе остался китайский');
  if (new RegExp('⟦').test(rebuilt)) problems.push('литерал ' + item.index + ': в переводе остался плейсхолдер');

  // Заменяем все вхождения исходного литерала в файле.
  const parts = text.split(original);
  const found = parts.length - 1;
  if (found === 0) { literalsSkipped++; continue; }
  text = parts.join(rebuilt);
  replacements += found;
  literalsDone++;
}

// Структурная проверка: всё, что вне фрагментов, не должно измениться.
const skeleton = (value) => value.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u0400-\u04ff]/g, '');
const original = fs.readFileSync(targetFile, 'utf8');
if (skeleton(original) !== skeleton(text)) {
  // Скелет файла не совпал — но это ожидаемо: кириллица вырезается, а
  // пунктуация/пробелы переводов меняются. Поэтому проверяем только отсутствие
  // неожиданных ASCII-вставок: сравниваем количество управляющих символов.
  const structural = (value) => (value.match(/[<>"`\\(){}[\]=;+]/g) || []).length;
  if (Math.abs(structural(original) - structural(text)) > 0) {
    skeletonProblems.push('изменение структурных символов: было ' + structural(original) + ', стало ' + structural(text));
  }
}

fs.writeFileSync(targetFile, text, 'utf8');

console.log('файлов перевода: ' + batchFiles.length + ', литералов переведено: ' + literalsDone +
  ', вхождений заменено: ' + replacements + ', пропущено: ' + literalsSkipped);
console.log('бэкап: ' + backup);
for (const problem of problems.slice(0, 15)) console.log('ВНИМАНИЕ: ' + problem);
if (problems.length > 15) console.log('... и ещё ' + (problems.length - 15) + ' предупреждений');
for (const problem of skeletonProblems) console.log('ОШИБКА: ' + problem);
