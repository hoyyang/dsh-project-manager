#!/usr/bin/env node
/**
 * Готовит каталоги переводов для PR: китайская строка → русская, для клиента и
 * для хостовых модулей плагина dsh-project-manager@0.20.1.
 *
 *   node make-catalogs.js <pm-l10n dir> <pristine lib dir> <out dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [, , workRoot, pristineLib, outDir] = process.argv;
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const ALLOWED = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffefA-Za-z0-9 .,:;!?%+\-()]/;
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

function rebuild(original, runs) {
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
}

const wrapper = (file, entries, functional) => ({
  $schema: 'dsh-project-manager/translation-catalog@1',
  source: 'dsh-project-manager@0.20.1',
  file,
  generated: new Date().toISOString().slice(0, 10),
  license: 'MIT (derivative work; original plugin © 2026 hoyyang)',
  entries: entries.map(({ zh, ru }) => ({ zh, ru })),
  ...(functional && functional.length ? { intentionally_untranslated: functional } : {}),
});

fs.mkdirSync(path.join(outDir, 'ru'), { recursive: true });

// Клиент: память переводов уже в готовом виде.
const clientMemory = JSON.parse(fs.readFileSync(path.join(workRoot, 'batches', 'translated-literals.json'), 'utf8'));
fs.writeFileSync(
  path.join(outDir, 'ru', 'strings-client.json'),
  JSON.stringify(wrapper('lib/client.js', clientMemory), null, 1) + '\n',
  'utf8',
);
console.log('клиент: ' + clientMemory.length + ' строк');

// Хост: собираем из литералов, переводов и списка функциональных исключений.
const hostRoot = path.join(workRoot, 'host');
const files = fs.existsSync(hostRoot) ? fs.readdirSync(hostRoot) : [];
const hostCatalog = {};
let hostTotal = 0;
const intentionally = {};
for (const name of files) {
  const dir = path.join(hostRoot, name);
  const literalsPath = path.join(dir, 'literals.json');
  const functionalPath = path.join(dir, 'functional.json');
  const batchesDir = path.join(dir, 'batches');
  if (!fs.existsSync(literalsPath) || !fs.existsSync(batchesDir)) continue;
  const literals = JSON.parse(fs.readFileSync(literalsPath, 'utf8'));
  const functional = fs.existsSync(functionalPath) ? JSON.parse(fs.readFileSync(functionalPath, 'utf8')) : [];
  const skip = new Set(functional.map((item) => item.index));
  const manifest = JSON.parse(fs.readFileSync(path.join(batchesDir, 'manifest.json'), 'utf8'));
  const ru = new Map();
  for (const f of fs.readdirSync(batchesDir).filter((x) => /^batch-\d+\.ru\.json$/.test(x))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(batchesDir, f), 'utf8'))) ru.set(row.index, row.runs);
  }
  const entries = [];
  for (const item of manifest.items) {
    if (skip.has(item.index)) continue;
    const runs = ru.get(item.index);
    if (!runs || runs.length !== item.runTexts.length) continue;
    const original = literals[item.index].text;
    entries.push({ zh: original, ru: applyPunct(rebuild(original, runs)) });
  }
  hostCatalog[name] = entries.length;
  hostTotal += entries.length;
  intentionally[name] = functional.map((item) => ({ zh: literals[item.index].text, reasons: item.reasons }));
  fs.writeFileSync(
    path.join(outDir, 'ru', 'strings-host-' + name + '.json'),
    JSON.stringify(wrapper('lib/' + name + '.js', entries), null, 1) + '\n',
    'utf8',
  );
}
console.log('хост: ' + hostTotal + ' строк в ' + Object.keys(hostCatalog).length + ' файлах');

fs.writeFileSync(
  path.join(outDir, 'ru', 'intentionally-untranslated.json'),
  JSON.stringify(
    {
      note: 'Strings that must stay Chinese: they are parsed by the plugin\'s own Chinese regexps or specify the on-disk STATE format (see tools/audit-functional.js).',
      by_file: intentionally,
    },
    null,
    1,
  ) + '\n',
  'utf8',
);
console.log('каталоги: ' + outDir);
