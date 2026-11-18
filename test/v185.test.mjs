/* v185（0.80.0）：俄语本地化（Русский）+ 四档界面语言 —— 词典 / 复数 / 模板 / 保护清单 / 路由 / 设置页 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as M from '../lib/model.js'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const SRC = (p) => read('src/client/' + p)
const S = (p) => read('src/' + p)
const log = read('CHANGELOG.md')

test('v185：版本 0.80.0 + CHANGELOG + 设置页版本行一致', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.ok(log.includes('0.80.0'), 'CHANGELOG 没有 0.80.0')
  const m = SRC('settings.ts').match(/export const VERSION = '([^']+)'/)
  assert.ok(m, 'settings.ts 缺 VERSION')
  assert.equal(m[1], pkg.version, '设置页版本行与 package.json 不一致')
})

test('v185：四档语言（auto / zh / en / ru）三处类型同源 + 偏好校验放行 ru', () => {
  for (const [file, src] of [['src/model.ts', S('model.ts')], ['src/client/api.ts', SRC('api.ts')]]) {
    const m = src.match(/export type LangMode = 'auto' \| 'zh' \| 'en' \| 'ru'/)
    assert.ok(m, file + ' 的 LangMode 不是四档')
  }
  assert.ok(SRC('i18n.ts').includes("export type Lang = 'zh' | 'en' | 'ru'"), 'client/i18n.ts 的 Lang 不是三值')
  const b = { version: 1, groups: [], cards: [], sessions: [] }
  assert.equal(M.setPrefs(b, { lang: 'ru' }).lang, 'ru', 'prefs 要能存 ru')
  assert.equal(M.prefsOf(b).lang, 'ru', 'prefsOf 要把 ru 带出来')
  assert.equal(M.setPrefs(b, { lang: 'auto' }).lang, 'auto')
  assert.throws(() => M.setPrefs(b, { lang: 'de' }), /lang 必须是 auto \/ zh \/ en \/ ru/)
})

test('v185：host 词典出口按语言（lib/i18n/<lang>.json）+ 路由 ?lang= 与非法值 400', () => {
  const i18n = S('i18n.ts')
  assert.ok(i18n.includes("export type DictLang = 'en' | 'ru'"), 'src/i18n.ts 缺 DictLang')
  assert.ok(i18n.includes("export function loadDict(lang: DictLang = 'en')"), 'loadDict 未参数化')
  assert.ok(i18n.includes("lang + '.json'"), '没按语言拼文件名')
  const routes = S('routes.ts')
  assert.ok(routes.includes("u.searchParams.get('lang')"), 'routes 没读 ?lang=')
  assert.ok(routes.includes("raw === 'en' || raw === 'ru'"), 'routes 没校验 en / ru')
  assert.ok(routes.includes("fail(res, 400, 'BAD_ARG'"), '非法 lang 要 400')
  assert.ok(routes.includes('lib/i18n/'), '404 文案要点名缺哪个词典文件')
  assert.ok(S('index.ts').includes("i18n: (lang) => loadDict(lang === 'ru' ? 'ru' : 'en')"), 'index 没把 lang 透下去')
})

test('v185：俄语词典产物 lib/i18n/ru.json 有货、带 v / total，且关键界面文案到位', () => {
  const file = new URL('../lib/i18n/ru.json', import.meta.url)
  assert.ok(existsSync(file), 'lib/i18n/ru.json 不存在（跑 npm run build:client）')
  const d = JSON.parse(readFileSync(file, 'utf8'))
  assert.match(d.v, /^[0-9a-f]{12}$/)
  assert.ok(d.total > 3000, 'total（覆盖率分母）偏小：' + d.total)
  const n = Object.keys(d.dict).length
  assert.ok(n > 1200, '俄语词典条数偏少：' + n)
  for (const [zh, ru] of [['项目看板', 'Доска проекта'], ['任务日程看板', 'Расписание задач'], ['知识库', 'База знаний'], ['卡片组', 'Группа карточек'], ['添加', 'Добавить']]) {
    assert.equal(d.dict[zh], ru, zh + ' → ' + ru)
  }
  // 不准把扫描中间产物（CSS / HTML 片段）塞进词典
  assert.ok(!Object.keys(d.dict).some((k) => k.startsWith('.dpm,') || k.startsWith('<div')), '词典里混进了 CSS / HTML 片段')
})

test('v185：保护清单（PR #3 的 61 条 + 本项目红线）不进任何词典', () => {
  const protect = JSON.parse(read('scripts/i18n-protect.json'))
  assert.ok(Array.isArray(protect.list) && protect.list.length >= 61, '保护清单条数偏少：' + protect.list.length)
  for (const lang of ['en', 'ru']) {
    const d = JSON.parse(readFileSync(new URL('../lib/i18n/' + lang + '.json', import.meta.url), 'utf8'))
    for (const k of protect.list) assert.equal(d.dict[k], undefined, lang + ' 词典里出现了不该翻的字符串：' + k.slice(0, 40))
  }
  assert.ok(protect.list.includes('## 📁 文件索引'), 'STATE 标题必须在保护清单里')
})

test('v185：俄语模板规则（含三形复数）与整句覆盖都由数据生成，条数一致', () => {
  const data = JSON.parse(read('scripts/i18n-rules.ru.json'))
  const src = SRC('i18n.rules.ru.ts')
  const n = (src.match(/^  (R|Rp)\(/gm) ?? []).length
  assert.equal(n, data.length, 'RULES_RU 条数与数据源不一致：' + n + ' vs ' + data.length)
  assert.ok(src.includes('Rp('), '复数模板没编译成 Rp()')
  assert.ok(src.includes('PLF('), '生成物里缺复数算法')
  assert.ok(data.some((r) => String(r[2]).includes('~1{')), '数据源里没有 ~N{a|b|c} 复数模板')
  const sents = JSON.parse(read('scripts/i18n-sentences.ru.json'))
  assert.ok(Object.keys(sents.sentences).length >= 3, '整句覆盖数据缺失')
  assert.ok(SRC('i18n.sentences.ru.ts').includes('SENTENCES_RU'), '没生成 i18n.sentences.ru.ts')
})

test('v185：相对时间（英文/俄文的老欠账）两条规则集都覆盖「刚刚 / N分钟 / N 分钟前」', () => {
  const en = JSON.parse(read('scripts/i18n-rules.json')).map((x) => x[0])
  const ru = JSON.parse(read('scripts/i18n-rules.ru.json')).map((x) => x[0])
  for (const p of ['^刚刚$', '^(\\d+)分钟$', '^(\\d+) 分钟前$', '^(\\d+)小时$']) {
    assert.ok(en.includes(p), '英文规则缺 ' + p)
    assert.ok(ru.includes(p), '俄语规则缺 ' + p)
  }
  const enSrc = SRC('i18n.rules.ts')
  assert.ok(enSrc.includes('just now'), '英文规则表里没有 just now')
  assert.ok(SRC('i18n.rules.ru.ts').includes('только что'), '俄语规则表里没有 только что')
})

test('v185：俄语引擎特性都在（复数表 / 跨节点取数 / 词间空格 / 整句覆盖 / 按语言缓存）', () => {
  const src = SRC('i18n.ts')
  assert.ok(src.includes('export function pl('), '缺 pl()')
  assert.ok(src.includes('function countFixRu('), '缺计数碎片跨节点取数')
  assert.ok(src.includes('function spacingRu('), '缺词间空格补齐')
  assert.ok(src.includes('SENTENCES_RU'), '缺整句覆盖')
  assert.ok(src.includes('dpm.lang.dict.v1.'), '词典缓存没按语言分键')
  assert.ok(/return \/\^ru\/i\.test\(l\) \? 'ru'/.test(src), 'readDsh 不认 ru')
  assert.ok(src.includes('[]'), '占位断言（防误删本测试）')
})

test('v185：设置页四档 + 译文状态块（含覆盖率与改进入口）', () => {
  const set = SRC('settings.ts')
  assert.ok(set.includes("{ id: 'ru' }"), '设置页没有 Русский 选项')
  assert.equal((set.match(/\{ id: '(auto|zh|en|ru)' \}/g) ?? []).length, 4, '设置页选项不是四档')
  assert.ok(set.includes('dpm-set-cov'), '缺译文状态块')
  assert.ok(set.includes('dictTotalSize'), '覆盖率要读词典总数')
  assert.ok(set.includes('github.com/hoyyang/dsh-project-manager#translations'), '缺「如何改进译文」入口')
  assert.ok(SRC('style.css').includes('.dpm-set-cov'), '译文状态块没有样式')
  assert.ok(SRC('style.css').includes('[data-dpm-lang="ru"]'), '俄语排版兜底样式缺失')
})

test('v185：俄语复数模板（~N{a|b|c}）编译与取形正确（1 / 2–4 / 5+ / 11–14 / 21）', () => {
  /** 与 scripts/gen-i18n-rules.mjs 里 PLF + Rp 同一套算法（生成物不 import 业务模块，所以这里按契约复核一遍） */
  const plf = (n, forms) => {
    const f = forms.split('|')
    const a = Math.abs(n) % 100
    const l = a % 10
    if (a > 10 && a < 20) return f[2] ?? f[0]
    if (l > 1 && l < 5) return f[1] ?? f[0]
    if (l === 1) return f[0]
    return f[2] ?? f[0]
  }
  const rules = JSON.parse(read('scripts/i18n-rules.ru.json'))
  const r = rules.find((x) => x[0] === '^(\\d+) 张卡片$')
  assert.ok(r, '缺「N 张卡片」复数模板')
  assert.ok(String(r[2]).includes('~1{'), '模板里没有复数占位：' + r[2])
  const render = (n) => String(r[2]).replace(/\$(\d)/g, (_, d) => String(n)).replace(/~(\d)\{([^}]+)\}/g, (_, _gi, forms) => plf(n, forms))
  assert.equal(render(1), '1 карточка')
  assert.equal(render(3), '3 карточки')
  assert.equal(render(5), '5 карточек')
  assert.equal(render(11), '11 карточек')
  assert.equal(render(21), '21 карточка')
  assert.equal(render(102), '102 карточки')
})
