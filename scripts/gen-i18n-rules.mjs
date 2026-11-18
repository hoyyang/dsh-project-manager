/**
 * 生成动态文案模板：scripts/i18n-rules[.<lang>].json → src/client/i18n.rules[.<lang>].ts（+ ru 的整句覆盖）。
 *
 * 数据格式：[pattern, flags, 模板]。模板里：
 *   $1..$9     = 正则捕获组
 *   ~N{a|b|c}  = 俄语三形复数：用第 N 个捕获组当数字，按 1 / 2–4 / 5+ 取 a / b / c
 *                （中文把「数字」和「量词」拆成两个节点，所以复数只能在模板里算）
 * 顺序有意义：先具体后笼统，命中即返回。
 *
 * 用法：node scripts/gen-i18n-rules.mjs [--lang=en|ru]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const lang = ((args.find((a) => a.startsWith('--lang=')) || '--lang=en').split('=')[1] || 'en').toLowerCase()
const suffix = lang === 'en' ? '' : '.' + lang
const dataFile = 'scripts/i18n-rules' + suffix + '.json'
if (!existsSync(join(ROOT, dataFile))) {
  console.error('[gen-i18n-rules] 没有这个语言的规则文件：' + dataFile)
  process.exit(1)
}
const rules = JSON.parse(readFileSync(join(ROOT, dataFile), 'utf8'))
const lines = rules.map(([src, flags, out]) => {
  const hasPlural = typeof out === 'string' && /~\d\{/.test(out)
  const fn = hasPlural ? 'Rp' : 'R'
  return '  ' + fn + '(' + JSON.stringify(src) + ', ' + JSON.stringify(out) + (flags ? ', ' + JSON.stringify(flags) : '') + '),'
})
const header = [
  '/**',
  ' * v182 起：带动态值的界面文案模板（词典只命中整句，拼出来的句子走这里）；v185 起支持俄语（复数模板由生成器编译）。',
  ' *',
  ' * 由 scripts/gen-i18n-rules.mjs 生成，别手改；要加规则改 ' + dataFile + '。',
  ' */',
  'const SUB = (tpl: string, m: RegExpMatchArray): string => tpl.replace(/\\$(\\d)/g, (_: string, d: string) => m[Number(d)] ?? \'\')',
  '/** 俄语三形复数（与 client/i18n.ts 的 pl() 同一份规则；生成物不 import 业务模块，所以算法在这里写一遍）。 */',
  'const PLF = (n: number, forms: string): string => {',
  '  const f = forms.split(\'|\')',
  '  const a = Math.abs(n) % 100',
  '  const l = a % 10',
  '  if (a > 10 && a < 20) return f[2] ?? f[0]',
  '  if (l > 1 && l < 5) return f[1] ?? f[0]',
  '  if (l === 1) return f[0]',
  '  return f[2] ?? f[0]',
  '}',
  'const R = (pattern: string, out: string, flags?: string): readonly [RegExp, string] => [new RegExp(pattern, flags), out]',
  'const Rp = (pattern: string, out: string, flags?: string): readonly [RegExp, (m: RegExpMatchArray) => string] => [',
  '  new RegExp(pattern, flags),',
  '  (m: RegExpMatchArray): string => SUB(out, m).replace(/~(\\d)\\{([^}]+)\\}/g, (_: string, gi: string, forms: string) => PLF(Number(SUB(\'$\' + gi, m)) || 0, forms)),',
  ']',
  '',
  'export const RULES' + (lang === 'en' ? '' : '_' + lang.toUpperCase()) + ': ReadonlyArray<readonly [RegExp, string | ((m: RegExpMatchArray) => string)]> = [',
  ...lines,
  ']',
  '',
].join('\n')
const outFile = 'src/client/i18n.rules' + suffix + '.ts'
writeFileSync(join(ROOT, outFile), header)
console.log('[gen-i18n-rules:' + lang + '] ' + rules.length + ' 条 · ' + outFile + ' · ' + header.length + ' B')

if (lang === 'ru') {
  const sf = 'scripts/i18n-sentences.ru.json'
  const data = existsSync(join(ROOT, sf)) ? JSON.parse(readFileSync(join(ROOT, sf), 'utf8')) : { sentences: {} }
  const sents = data.sentences ?? {}
  const body2 = [
    '/**',
    ' * v185：俄语整句覆盖（拼接型文案）。中文把一句话拆成多个文本节点复用，俄语语序与格变化不允许逐段替换，',
    ' * 所以命中整句中文时整块换成一句俄语（元素级；切回中文按 WeakMap 还原）。',
    ' *',
    ' * 由 scripts/gen-i18n-rules.mjs --lang=ru 从 ' + sf + ' 生成，别手改。',
    ' */',
    'export const SENTENCES_RU: Record<string, string> = ' + JSON.stringify(sents, null, 2),
    '',
  ].join('\n')
  writeFileSync(join(ROOT, 'src/client/i18n.sentences.ru.ts'), body2)
  console.log('[gen-i18n-rules:ru] 整句覆盖 ' + Object.keys(sents).length + ' 条 · src/client/i18n.sentences.ru.ts')
}
