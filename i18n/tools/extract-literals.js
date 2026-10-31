#!/usr/bin/env node
/**
 * Извлекает строковые литералы с китайским текстом из бандла плагина.
 *
 * Бандл — сгенерированный JS (модуль-обёртка), поэтому нужен собственный
 * сканер: он пропускает комментарии, корректно читает кавычки и шаблонные
 * строки и возвращает исходный (экранированный) текст литерала.
 *
 *   node extract-literals.js <file.js> <out.json>
 */
'use strict';

const fs = require('node:fs');
const CJK = /[\u4e00-\u9fff]/;

function scan(source) {
  const literals = [];
  const n = source.length;
  let i = 0;
  let prevSignificant = '';
  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '/' && !/[A-Za-z0-9_$)\]}]/.test(prevSignificant)) {
      // Похоже на регулярное выражение — пропускаем его тело.
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
      const raw = source.slice(start, i);
      literals.push({ text: raw, quote });
      i++;
      prevSignificant = quote;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return literals;
}

const [, , file, out] = process.argv;
const source = fs.readFileSync(file, 'utf8');
const literals = scan(source);

const unique = new Map();
for (const literal of literals) {
  if (!CJK.test(literal.text)) continue;
  const entry = unique.get(literal.text) || { text: literal.text, quote: literal.quote, count: 0 };
  entry.count++;
  unique.set(literal.text, entry);
}

const list = [...unique.values()].sort((a, b) => b.text.length - a.text.length);
const totalChars = list.reduce((sum, e) => sum + e.text.length, 0);
const templates = list.filter((e) => e.quote === '`').length;
const markup = list.filter((e) => /<[a-zA-Z/]/.test(e.text)).length;

fs.mkdirSync(require('node:path').dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list, null, 1), 'utf8');

console.log('literals total: ' + literals.length + ', unique CJK literals: ' + list.length);
console.log('chars to translate: ' + totalChars + ', template literals: ' + templates + ', with HTML markup: ' + markup);
console.log('longest: ' + list.filter((e) => e.text.length > 400).length + ' >400 chars');
console.log('out: ' + out);
