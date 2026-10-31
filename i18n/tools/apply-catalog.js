#!/usr/bin/env node
/**
 * Применяет каталог перевода к собранному JS-модулю.
 *
 * Заменяются только ЦЕЛЫЕ строковые литералы (позиции берутся сканером),
 * поэтому тела регэкспов, комментарии и код не затрагиваются. Каталог содержит
 * пары «китайский литерал → русский литерал» (см. ru/strings-*.json).
 *
 *   node apply-catalog.js <target.js> <catalog.json> [--write]
 *
 * Без --write — только отчёт (сколько литералов найдено), файл не меняется.
 */
'use strict';

const fs = require('node:fs');

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

const [, , targetFile, catalogFile] = process.argv;
const write = process.argv.includes('--write');
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const entries = catalog.entries || [];

let text = fs.readFileSync(targetFile, 'utf8');
const starts = new Map(scanStrings(text).map((region) => [region.start, region]));

// Длинные литералы — первыми, чтобы короткий не испортил длинный.
const ordered = [...entries].sort((a, b) => b.zh.length - a.zh.length);
const edits = [];
let applied = 0;
let missing = 0;
for (const { zh, ru } of ordered) {
  let from = 0;
  let hit = 0;
  for (;;) {
    const at = text.indexOf(zh, from);
    if (at === -1) break;
    from = at + Math.max(1, zh.length);
    const region = starts.get(at);
    if (region === undefined || region.end !== at + zh.length) continue; // не целый литерал
    edits.push({ start: at, end: at + zh.length, value: ru });
    hit++;
  }
  if (hit === 0) missing++;
  applied += hit;
}
edits.sort((a, b) => b.start - a.start);
for (const edit of edits) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);

console.log(
  require('node:path').basename(targetFile) + ': литералов в каталоге ' + entries.length +
  ', применено вхождений ' + applied + ', не найдено литералов ' + missing +
  (write ? ' — файл записан' : ' (режим проверки, добавьте --write)'),
);
if (write) fs.writeFileSync(targetFile, text, 'utf8');
