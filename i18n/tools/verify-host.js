#!/usr/bin/env node
/**
 * Проверка переведённых хостовых файлов: синтаксис, остатки китайского,
 * переводы в функциональных позициях (сравнения/регэкспы/методы) и русский
 * текст с токенами формата STATE.
 *
 *   node verify-host.js <lib-dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [, , libDir] = process.argv;
const files = ['index.js', 'tools.js', 'routes.js', 'landfill.js', 'model.js', 'merge.js', 'memory.js', 'migrate.js', 'hub.js', 'lfspec.js', 'states.js', 'store.js'];
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const RU = /[\u0400-\u04ff]/;

let bad = 0;
for (const name of files) {
  const file = path.join(libDir, name);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  let syntax = 'OK';
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    syntax = 'ОШИБКА: ' + String(error.stderr || error.message).split('\n').slice(0, 4).join(' ');
    bad++;
  }

  const cjk = lines.filter((l) => CJK.test(l)).length;

  // Русские литералы в функциональных позициях — почти наверняка ошибка перевода.
  const functionalRu = [];
  const checks = [
    [/new\s+RegExp\(\s*["'`][^"'`]*[А-Яа-яЁё]/, 'new RegExp'],
    [/\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|match|replace|split)\(\s*["'`][^"'`]*[А-Яа-яЁё]/, 'метод со строкой'],
    [/(?:===|!==|==[^=]|!=[^=])\s*["'`][^"'`]*[А-Яа-яЁё]/, 'сравнение со строкой'],
  ];
  for (const [re, label] of checks) {
    for (const line of lines) if (re.test(line)) functionalRu.push(label + ': ' + line.trim().slice(0, 120));
  }

  // Русский литерал с китайским токеном формата — значит перевели подсказку формата.
  const formatRu = [];
  for (const line of lines) {
    if (!RU.test(line)) continue;
    if (/##|📁|🗂|🔄|必读|参考/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) formatRu.push(line.trim().slice(0, 140));
  }

  console.log('=== ' + name + ' ===');
  console.log('  синтаксис: ' + syntax + ', строк с иероглифами: ' + cjk);
  if (functionalRu.length) {
    bad++;
    console.log('  ВНИМАНИЕ: русские строки в функциональных позициях: ' + functionalRu.length);
    for (const item of functionalRu.slice(0, 6)) console.log('    ' + item);
  }
  if (formatRu.length) {
    console.log('  ВНИМАНИЕ: русский текст с токенами формата: ' + formatRu.length);
    for (const item of formatRu.slice(0, 6)) console.log('    ' + item);
  }
}
process.exitCode = bad ? 1 : 0;
