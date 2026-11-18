/**
 * 生成插件界面词典（v182 起 en，v185 起任意语言）：locales/zh-CN.json + locales/<lang>.json + 覆盖表 + 保护清单
 *   → lib/i18n/<lang>.json（{ v, dict, total }）。
 *
 * 为什么不在运行时读 locales/：发布包 files 里不含 locales（1.5 MB 的扫描中间产物），
 * 词典只留生成后那一份；client 也不内联它（会把 client.js 从 2.4 MB 撑到 ~4 MB），
 * 走 host 路由 GET /i18n?lang= 按需投递 + 浏览器 localStorage 缓存（按语言 + 版本号）。
 *
 * 三层数据，后者覆盖前者：
 *   ① locales/<lang>.json           —— 扫描键空间里的逐键译文（/localize 管线产出，增量靠 .loc-meta.<lang>.json）
 *   ② scripts/i18n-overrides.<lang>.json —— 原型里逐条核对过的定稿译文（按中文原文覆盖）
 *   ③ scripts/i18n-protect.json     —— 永不翻译清单（正则体 / STATE 标记 / [必读]），命中的键直接丢弃
 * 缺条目就保留中文原样显示（缺失即回退，不静默改写）。
 *
 * 用法：node scripts/gen-i18n.mjs [--lang=en|ru]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const args = process.argv.slice(2)
const lang = ((args.find((a) => a.startsWith('--lang=')) || '--lang=en').split('=')[1] || 'en').toLowerCase()
const LANGS = ['en', 'ru']
if (!LANGS.includes(lang)) {
  console.error('[gen-i18n] 不支持的语言：' + lang + '（可选 ' + LANGS.join(' / ') + '）')
  process.exit(1)
}

const zh = read('locales/zh-CN.json')
const locFile = 'locales/' + lang + '.json'
const loc = existsSync(join(ROOT, locFile)) ? read(locFile) : {}
const ovFile = 'scripts/i18n-overrides' + (lang === 'en' ? '' : '.' + lang) + '.json'
const overrides = existsSync(join(ROOT, ovFile)) ? read(ovFile) : {}
const protect = new Set((read('scripts/i18n-protect.json').list || []).filter((x) => typeof x === 'string'))

/** 语言引擎只匹配文本节点与属性值：以 < 开头的整段 HTML 模板 / 样式表永远匹配不到，不进词典也不进覆盖分母。 */
const unmatchable = (text) => text.startsWith('<')

const dict = {}
/** 覆盖率分母 = 「中文原文全集（去掉保护清单与匹配不到的模板）∪ 覆盖表键」—— 覆盖表里有扫描器抽不出来、原型里手写的整句。 */
const total = new Set()
let skipped = 0
let fragments = 0
for (const [key, text] of Object.entries(zh)) {
  if (typeof text !== 'string' || !text.trim()) continue
  if (protect.has(text)) { skipped++; continue }
  if (unmatchable(text)) { fragments++; continue }
  total.add(text)
  const t = loc[key]
  if (typeof t === 'string' && t !== text && !protect.has(t) && dict[text] === undefined) dict[text] = t
}
const base = Object.keys(dict).length
let ovAdded = 0
for (const [k, v] of Object.entries(overrides)) {
  if (typeof v !== 'string' || protect.has(k) || unmatchable(k)) continue
  total.add(k)
  if (dict[k] === undefined) ovAdded++
  dict[k] = v
}

const payload = JSON.stringify(dict)
const v = createHash('sha1').update(payload).digest('hex').slice(0, 12)
mkdirSync(join(ROOT, 'lib/i18n'), { recursive: true })
writeFileSync(join(ROOT, 'lib/i18n', lang + '.json'), JSON.stringify({ v, dict, total: total.size }) + '\n')
const cover = ((100 * Object.keys(dict).length) / Math.max(1, total.size)).toFixed(1)
console.log('[gen-i18n:' + lang + '] ' + Object.keys(dict).length + ' / ' + total.size + ' 条（' + cover + '%）· locales ' + base + ' + 覆盖 ' + Object.keys(overrides).length + '（其中新增 ' + ovAdded + '）· 保护清单排除 ' + skipped + ' · HTML 模板排除 ' + fragments + ' · v=' + v + ' · ' + payload.length + ' B')
