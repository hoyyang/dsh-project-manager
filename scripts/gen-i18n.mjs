/**
 * 生成插件英文词典（v182）：locales/zh-CN.json + locales/en.json → lib/i18n/en.json。
 *
 * 为什么不在运行时读 locales/：发布包 files 里不含 locales（1.5 MB 的扫描中间产物），
 * 词典只留生成后那一份；client 也不内联它（会把 client.js 从 2.4 MB 撑到 ~4 MB），
 * 走 host 路由 i18n 按需投递 + 浏览器 localStorage 缓存（带版本号）。
 *
 * 覆盖文件 scripts/i18n-overrides.json = 原型里逐条核对过的定稿译文（460 条）：
 *   - 109 条修的是 /localize 产出的措辞（原型验收时改的）；
 *   - 370 条是扫描器抽不出来、原型里手写的整句（含 455 条 DICT 中的定稿）。
 * 覆盖值优先于 locales；两边都没有的中文原样显示（缺失即回退，不静默改写）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

const zh = read('locales/zh-CN.json')
const en = read('locales/en.json')
const overrides = read('scripts/i18n-overrides.json')

const dict = {}
for (const [key, text] of Object.entries(zh)) {
  const t = en[key]
  if (typeof text !== 'string' || typeof t !== 'string' || t === text) continue
  if (dict[text] === undefined) dict[text] = t
}
const base = Object.keys(dict).length
for (const [k, v] of Object.entries(overrides)) dict[k] = v

const payload = JSON.stringify(dict)
const v = createHash('sha1').update(payload).digest('hex').slice(0, 12)
mkdirSync(join(ROOT, 'lib/i18n'), { recursive: true })
writeFileSync(join(ROOT, 'lib/i18n/en.json'), JSON.stringify({ v, dict }) + '\n')
console.log('[gen-i18n] ' + Object.keys(dict).length + ' 条（locales ' + base + ' + 覆盖 ' + Object.keys(overrides).length + '）· v=' + v + ' · ' + payload.length + ' B')
