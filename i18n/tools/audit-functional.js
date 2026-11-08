#!/usr/bin/env node
/**
 * Точный поиск «функциональных» литералов: регэкспы, сравнения, заголовки-маркеры
 * файлов STATE. Такие строки нельзя переводить — сломается логика плагина.
 *
 *   node audit-functional.js <original file> <literals.json> [out.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [, , file, literalsPath, outPath] = process.argv;
const source = fs.readFileSync(file, 'utf8');
const literals = JSON.parse(fs.readFileSync(literalsPath, 'utf8'));

const AFTER_FUNCTIONAL = /^(?:\.test\(|\.exec\(|\.match\(|\.includes\(|\.startsWith\(|\.endsWith\(|\.indexOf\(|\.lastIndexOf\(|\.replace\(|\.split\(|\.trim\(|===|!==|==[^=]|!=[^=]|\.localeCompare\()/;
const BEFORE_METHOD = /\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|replace|split|match|test|exec)\(\s*$/;
const CONST_NAME = /\b(?:BLOCK_TITLE|BLOCK|HEADING|MARKER|SECTION|CHECKS|TITLE_RE|PREFIX|SUFFIX|RE|PATTERN|KEYS?)\b\s*[:=]\s*$/;

function occurrences(text) {
  const result = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(text, from);
    if (at === -1) break;
    result.push(at);
    from = at + Math.max(1, text.length);
    if (result.length > 30) break;
  }
  return result;
}

const flagged = [];
for (let index = 0; index < literals.length; index++) {
  const { text } = literals[index];
  const reasons = new Set();
  for (const at of occurrences(text)) {
    const quote = source[at - 1];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    const beforeQuote = source.slice(Math.max(0, at - 60), at - 1);
    const afterClose = source.slice(at + text.length + 1, at + text.length + 90);
    if (/\/\s*$/.test(beforeQuote) || /new\s+RegExp\(\s*$/.test(beforeQuote)) reasons.add('regex');
    if (AFTER_FUNCTIONAL.test(afterClose.replace(/^\s+/, ''))) reasons.add('сравнение/метод');
    if (BEFORE_METHOD.test(beforeQuote)) reasons.add('аргумент метода');
    if (CONST_NAME.test(beforeQuote)) reasons.add('константа-маркер');
  }
  // Заголовки файлов STATE и списки частиц регулярки — это содержимое файлов,
  // а не текст интерфейса.
  if (/^#{1,3}\s/.test(text) || /\n#{1,3}\s/.test(text)) reasons.add('заголовок файла');
  if (/^[^ ]+\|[^ ]+/.test(text)) reasons.add('список частиц/альтернатив');
  if (/\\/.test(text) && /[\^$.*+?()[\]{}]/.test(text)) reasons.add('тело регэкспа');
  // Маркеры и токены формата STATE: их проверяют китайские регэкспы в коде,
  // поэтому подсказки с ними переводить нельзя.
  if (/#{1,3}\s|📁|🗂|🔄/.test(text)) reasons.add('токен формата STATE');
  if (/必读|参考/.test(text)) reasons.add('тег индекса файлов');
  if (/落盘项目\s*STATE|aliases:|^\s*[-*]\s*\[/.test(text)) reasons.add('строка формата STATE');
  if (reasons.size > 0) flagged.push({ index, reasons: [...reasons], text });
}

if (outPath) fs.writeFileSync(outPath, JSON.stringify(flagged, null, 1), 'utf8');
console.log('файл: ' + path.basename(file) + ', литералов: ' + literals.length + ', функциональных: ' + flagged.length);
for (const item of flagged) console.log('  #' + item.index + ' [' + item.reasons.join(', ') + '] ' + JSON.stringify(item.text.slice(0, 150)));
