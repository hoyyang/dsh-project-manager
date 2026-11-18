/* v182：设置 → 项目看板（界面语言三档）+ 词典 / 模板 / 偏好 / 作用域 / 构建产物 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as M from '../lib/model.js'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const SRC = (p) => read('src/client/' + p)
const S = (p) => read('src/' + p)
const log = read('CHANGELOG.md')

test('v182：版本 0.78.0 + CHANGELOG + 设置页里的版本一致', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.ok(log.includes('0.80.0'), 'CHANGELOG 没有 0.80.0')
  const set = SRC('settings.ts')
  const m = set.match(/export const VERSION = '([^']+)'/)
  assert.ok(m, 'settings.ts 缺 VERSION')
  assert.equal(m[1], pkg.version, '设置页版本行与 package.json 不一致')
})

test('v182：词典产物 lib/i18n/en.json 有货且带版本号', () => {
  const file = new URL('../lib/i18n/en.json', import.meta.url)
  assert.ok(existsSync(file), 'lib/i18n/en.json 不存在（跑 npm run build:client）')
  const d = JSON.parse(readFileSync(file, 'utf8'))
  assert.match(d.v, /^[0-9a-f]{12}$/)
  const n = Object.keys(d.dict).length
  // 生成器排除「以 < 开头的整段 HTML 模板」——引擎只匹配文本节点与属性值，这类键永远匹配不到（v185 起）。
  assert.ok(n > 3600, '词典条数偏少：' + n)
  // 原型验收时逐个点过的界面文案必须命中
  for (const [zh, en] of [['项目看板', 'Project Board'], ['知识库', 'Knowledge Base'], ['界面语言', 'Interface language'], ['任务日程看板', 'Task Schedule']]) {
    assert.equal(d.dict[zh], en, zh + ' → ' + en)
  }
})

test('v182：动态模板与 scripts/i18n-rules.json 一致，且能翻带变量的句子', () => {
  const src = SRC('i18n.rules.ts')
  const n = (src.match(/^  R\(/gm) ?? []).length
  const want = JSON.parse(read('scripts/i18n-rules.json')).length
  assert.equal(n, want, 'RULES 条数与数据源不一致：' + n + ' vs ' + want)
  assert.ok(n >= 86, '原型那 86 条模板必须都在：' + n)
  // 抽一条出来实际跑一遍（台账：不是「元素存在」式的空断言）
  const one = src.match(/R\("(\^复制卡片「\(\.\+\)」\$)", "([^"]+)"\)/)
  assert.ok(one, '缺「复制卡片」模板')
  const re = new RegExp(JSON.parse('"' + one[1].replaceAll('\\', '\\\\') + '"'))
  assert.equal('复制卡片「项目看板」'.match(re) !== null, true)
  assert.equal(JSON.parse('"' + one[2] + '"').replace(/\$(\d)/g, (_, d) => '项目看板'), 'Copy card — 项目看板')
})

test('v182：语言偏好存 host 侧（prefs.lang），三档校验，缺省 auto', () => {
  const b = { version: 1, groups: [], cards: [], sessions: [] }
  assert.equal(M.prefsOf(b).lang, undefined, '缺省不该写死成某一档（= 跟随 DSH）')
  assert.equal(M.setPrefs(b, { lang: 'en' }).lang, 'en')
  assert.equal(M.prefsOf(b).lang, 'en', 'prefsOf 要把 lang 带出来')
  assert.equal(M.setPrefs(b, { lang: 'auto' }).lang, 'auto')
  assert.throws(() => M.setPrefs(b, { lang: 'fr' }), /lang 必须是 auto \/ zh \/ en \/ ru/)
})

test('v182：host 词典路由与模块在位（GET /i18n + 旧宿主 404 点名）', () => {
  const routes = S('routes.ts')
  assert.ok(routes.includes("if (sub === '/i18n')"), 'routes.ts 没有 /i18n 分支')
  assert.ok(routes.includes("NOT_FOUND', '当前宿主还没有 ' + lang + ' 词典"), '旧宿主降级要点名原因')
  assert.ok(routes.includes("i18n?(lang?: 'en' | 'ru')"), '服务接口要按语言取词典')
  const i18n = S('i18n.ts')
  assert.ok(i18n.includes("join(dirname(fileURLToPath(import.meta.url)), 'i18n', lang + '.json')"), '词典路径要落在 lib/i18n/<lang>.json')
  assert.ok(S('index.ts').includes("i18n: (lang) => loadDict(lang === 'ru' ? 'ru' : 'en')"), 'host 没把词典按语言接进路由服务')
})

test('v182：client 引擎不碰宿主语言设置、不把词典内联进包', () => {
  const eng = SRC('i18n.ts')
  assert.ok(!/documentElement\.lang\s*=/.test(eng), '引擎不许改宿主 <html lang>（那是官方 locale 服务的地盘）')
  assert.ok(eng.includes("document.documentElement.lang"), '「跟随 DSH」要读 <html lang>')
  assert.ok(eng.includes("ROOT_ATTR = 'data-dpm-i18n'"), '缺作用域标记')
  assert.ok(eng.includes('getI18n(lang)'), '词典要走 host 路由（按语言）')
  assert.ok(!eng.includes("from '../../locales/"), '不许把 locales 打进 client')
})

test('v182：设置页挂在 settings.section（order 30 = Agent 预设之后、插件之前）', () => {
  const set = SRC('settings.ts')
  assert.ok(set.includes("name: 'settings.section'"))
  assert.ok(set.includes("id: 'project-board'"))
  assert.ok(set.includes('order: 30'))
  assert.ok(set.includes("label: () => tr('项目看板')"), '导航文案要跟插件语言')
  assert.ok(set.includes("ctx.slots.inject('settings.section'"), '没 inject 就拿不到插槽（旧宿主降级）')
  // 三档选项与说明（原型逐字）
  for (const t of ['跟随 DSH', '中文', 'English', '固定中文', '固定英文']) assert.ok(set.includes(t), '缺文案：' + t)
  // 旧宿主：词典 404 时点名「重启后可用」，不静默回退
  assert.ok(set.includes("getDictState() === 'dead'"))
  assert.ok(set.includes('重启 DSH 后可用'), '旧宿主降级要点名「重启 DSH 后可用」')
})

test('v182：日期 / 天数 / 文件数这类在引擎里按语义算（不是模板 $1 能表达的）', () => {
  const eng = SRC('i18n.ts')
  for (const bit of ["const MONTHS = ['Jan'", 'WEEKDAYS', '个文件']) assert.ok(eng.includes(bit), '缺 ' + bit)
  // 月份表与星期表必须齐全，否则日期标签会漏
  assert.ok(eng.includes("'Sep'") && eng.includes("'Dec'") && eng.includes("日: 'Sun'"))
})

test('v182：切语言只改文本 / 属性，不重建 DOM（保住焦点与滚动）', () => {
  const eng = SRC('i18n.ts')
  assert.ok(eng.includes("const ATTRS = ['placeholder', 'title', 'aria-label']"))
  assert.ok(eng.includes('createTreeWalker'), '要走文本节点，不能 innerHTML 重画')
  assert.ok(!/innerHTML\s*=/.test(eng), '引擎里不许有 innerHTML 赋值')
  assert.ok(eng.includes('requestAnimationFrame'), '重画频繁，要 rAF 合并')
})
