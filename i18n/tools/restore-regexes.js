#!/usr/bin/env node
/**
 * Восстанавливает тела регэкспов, изменённые глобальными заменами строк:
 * сравнивает регэкспы в текущем файле и в чистом исходнике и возвращает
 * исходные тела. Регэкспы нумеруются в порядке появления, поэтому пары
 * сопоставляются по индексу.
 *
 *   node restore-regexes.js <pristine file> <target file>
 */
'use strict';

const fs = require('node:fs');

/** @returns {Array<{start:number,end:number,body:string}>} позиции тел регэкспов */
function scanRegexes(source) {
  const regexes = [];
  const n = source.length;
  let i = 0;
  let prevSignificant = '';
  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '/' && !/[A-Za-z0-9_$)\]}]/.test(prevSignificant)) {
      const start = i + 1;
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i++;
      }
      regexes.push({ start, end: i, body: source.slice(start, i) });
      i++;
      while (i < n && /[a-z]/.test(source[i])) i++; // флаги
      prevSignificant = '/';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) break;
        i++;
      }
      i++;
      prevSignificant = quote;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return regexes;
}

const [, , pristineFile, targetFile] = process.argv;
const pristine = scanRegexes(fs.readFileSync(pristineFile, 'utf8'));
let text = fs.readFileSync(targetFile, 'utf8');
const current = scanRegexes(text);

console.log('регэкспов: чистом ' + pristine.length + ', текущем ' + current.length);
if (pristine.length !== current.length) {
  console.error('ОШИБКА: количество регэкспов различается — сопоставление невозможно');
  process.exit(1);
}
const edits = [];
let restored = 0;
for (let i = 0; i < current.length; i++) {
  if (current[i].body === pristine[i].body) continue;
  edits.push({ start: current[i].start, end: current[i].end, value: pristine[i].body });
  restored++;
  if (restored <= 10) console.log('  восстановлен регэксп #' + (i + 1) + ': ' + JSON.stringify(pristine[i].body.slice(0, 80)));
}
edits.sort((a, b) => b.start - a.start);
for (const edit of edits) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
fs.writeFileSync(targetFile, text, 'utf8');
console.log('восстановлено тел регэкспов: ' + restored);
