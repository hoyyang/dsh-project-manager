#!/usr/bin/env node
/**
 * Повторно применяет сохранённую память переводов к бандлу плагина.
 * Нужен после обновления/переустановки плагина: если китайские литералы не
 * изменились, перевод встанет на место одной командой.
 *
 *   node reapply-translations.js <file.js> <work-dir>
 *
 * После этого стоит запустить normalize.js (пунктуация и склейки кавычек).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [, , targetFile, workDir] = process.argv;
const memoryFile = path.join(workDir, 'translated-literals.json');
if (!fs.existsSync(memoryFile)) throw new Error('нет файла памяти переводов: ' + memoryFile);
const memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));

let text = fs.readFileSync(targetFile, 'utf8');
const backup = path.join(workDir, 'backup', 'client.js.before-reapply.orig');
fs.mkdirSync(path.dirname(backup), { recursive: true });
if (!fs.existsSync(backup)) fs.copyFileSync(targetFile, backup);

// Длинные литералы — первыми, чтобы короткий не испортил длинный.
const ordered = [...memory].sort((a, b) => b.zh.length - a.zh.length);
let applied = 0;
let missed = 0;
for (const { zh, ru } of ordered) {
  const parts = text.split(zh);
  const found = parts.length - 1;
  if (found === 0) { missed++; continue; }
  text = parts.join(ru);
  applied += found;
}
fs.writeFileSync(targetFile, text, 'utf8');
console.log('применено вхождений: ' + applied + ', не найдено литералов: ' + missed + ' (из ' + ordered.length + ')');
console.log('бэкап: ' + backup);
