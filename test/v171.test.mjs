/* v171：知识卡引用伴手弹窗 —— 「）」/「)」触发、与引用伴手弹窗同一块组件（kind = kb）+ 标签筛选条 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectKbQuote } from '../lib/quote.js'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const hostSrc = readFileSync(new URL('../src/quote.ts', import.meta.url), 'utf8')
const panel = src('quotepanel.ts')
const kbdlg = src('kbdlg.ts')
const qmenu = src('qmenu.ts')
const goaltask = src('goaltask.ts')
const richnote = src('richnote.ts')
const kb = src('kb.ts')
const css = src('style.css')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v171 detectKbQuote：行首 / 空格后 / 全角空格 / NBSP / 半角「)」触发，其余不触发', () => {
  assert.match(hostSrc, /export function detectKbQuote\(prefix: string\): \{ len: number; query: string \} \| null/)
  assert.deepEqual(detectKbQuote('）'), { len: 1, query: '' })
  assert.deepEqual(detectKbQuote('）发布'), { len: 3, query: '发布' })
  assert.deepEqual(detectKbQuote('看这句 ）发布'), { len: 4, query: '发布' })
  assert.deepEqual(detectKbQuote('\u3000）x'), { len: 3, query: 'x' })
  assert.deepEqual(detectKbQuote('\u00a0)y'), { len: 3, query: 'y' })
  /* 反例：前面是普通字 / 不是行首也不是空格后；纯「>」不归这条规则 */
  assert.equal(detectKbQuote('a）x'), null)
  assert.equal(detectKbQuote('》）x'), null)
  assert.equal(detectKbQuote('>'), null)
  assert.equal(detectKbQuote('没有触发符'), null)
})

test('v171 组件只有一处：kind 参与「同一块面板」判定 + 头部身份 + 标签行', () => {
  assert.match(panel, /export type QpKind = 'quote' \| 'kb'/)
  assert.match(panel, /const same = P\.open && !!P\.el && P\.where === o\.where && P\.kind === kind && P\.anchor === o\.anchor/)
  assert.match(panel, /title\.textContent = kb \? '引用知识卡' : '引用卡片内容'/)
  assert.match(panel, /P\.el\.setAttribute\('aria-label', kb \? '引用知识卡' : '引用卡片内容'\)/)
  assert.match(panel, /hi\.innerHTML = sv\(kb \? 'kb' : 'quote'\)/)
  /* 标签行：固定「标签」+ 可滚胶囊区 + 固定右端「清除」；知识卡身份不出现「新增并引用」 */
  assert.match(panel, /'<div class="qpn-tags" hidden><span class="l">标签<\/span><span class="qpn-tgbs"/)
  assert.match(panel, /\{ const a = q\('\.qpn-add', P\.el\); if \(a\) a\.hidden = false \}/)
  assert.match(panel, /if \(o\.add && !kb\)/)
  /* 记忆键按身份分开：qp:<cardId> / kbq:<cardId> */
  assert.match(panel, /P\.memKey = P\.cardId \? \(kind === 'kb' \? 'kbq:' : 'qp:'\) \+ P\.cardId : ''/)
  /* 面板 DOM 仍只有这一处创建（没有第二套外壳） */
  assert.match(panel, /el\.className = 'qpn'/)
  const others = [kbdlg, qmenu, goaltask, richnote, kb].filter((s) => /createElement\('div'\)[\s\S]{0,200}className = 'qpn'/.test(s))
  assert.equal(others.length, 0, '面板外壳只能有一份（quotepanel.ts）')
})

test('v171 行数据接线：hay 参与匹配 / chipCls 上屏 / ins 进底栏，kbdlg 一处产出', () => {
  assert.match(panel, /const matchAll = \(it: QpItem, ql: string\): boolean => !ql \|\| \(it\.hay \?\?/)
  assert.match(panel, /'<span class="qpn-chip' \+ \(it\.chipCls \? ' ' \+ it\.chipCls : ''\) \+ '">'/)
  assert.match(panel, /\(r\.type === 'leaf' \? \(r\.item\.ins \?\? '引用原文'\) : '引用原文'\)/)
  assert.match(kbdlg, /export function kbQuoteGroups\(cards: readonly KbPick\[\], exclude = ''\): QpGroup\[\]/)
  assert.match(kbdlg, /hay: \(k\.title \+ ' ' \+ k\.summary \+ ' ' \+ k\.tags\.join\(' '\)/)
  assert.match(kbdlg, /chipCls: k\.status === 'verified' \? '' : \(ST_CHIP\[k\.status\] \?\? ''\)/)
  assert.match(kbdlg, /ins: t\.k === 'prompt' \? '提示词正文（原文插入）' : '引用原文（画成胶囊）'/)
  assert.match(kbdlg, /text: t\.k === 'prompt' \? \(bodies\.get\(k\.id\) \?\? kbText\(k\.title, k\.path\)\) : kbText\(k\.title, k\.path\)/)
  /* 类型图标复用知识库页 GLΓPH；六类顺序 = 类型表顺序 */
  assert.match(kbdlg, /G\.push\(\{ key: t\.k, name: t\.label, icon: 'kb', iconSvg: GLYPH\[t\.k\], hint: '默认' \+ DEF_MODE\(t\.k\), items: rows \}\)/)
})

test('v171 标签筛选：facet / 再点取消 / 换标签 / 清除 / 回顶部 / 定位条同步收', () => {
  assert.match(panel, /const tagOn = P\.kind === 'kb' \? P\.tag : ''/)
  assert.match(panel, /if \(tagOn && !\(it\.tags \?\? \[\]\)\.includes\(tagOn\)\) continue/)
  assert.match(panel, /const keys = Object\.keys\(facets\)\.sort\(\(a, b\) => \(facets\[b\] - facets\[a\]\) \|\| \(a < b \? -1 : 1\)\)/)
  assert.match(panel, /function setTag\(v: string\): void \{\n  const next = v && P\.tag !== v \? v : ''/)
  assert.match(panel, /list\.scrollTop = \(qq && qq !== P\.lastQ\) \|\| tagChanged \? 0 : prev/)
  assert.match(panel, /const tg = P\.kind === 'kb' \? P\.tag : ''/)
  assert.match(panel, /'标签 #' \+ tg \+ ' · ' : ''\) \+ total \+ \(P\.kind === 'kb' \? ' 张' : ' 项'\)/)
  /* 空库 / 一张卡都没打标签 → 整条隐藏（不留空行） */
  assert.match(panel, /row\.hidden = keys\.length === 0/)
})

test('v171 四个入口都接的是同一块面板的 kb 身份（composer / task / note / 知识卡正文）', () => {
  assert.match(qmenu, /const khit = hit \? null : detectKbQuote\(p\.text\)/)
  assert.match(qmenu, /this\.kind = 'kb'/)
  assert.match(qmenu, /build: \(\) => \(this\.kind === 'kb' \? kbQuoteGroups\(kbCardsNow\(\) \?\? \[\]\) : this\.groups\(\)\)/)
  assert.match(goaltask, /const kh = detectKbQuote\(p\.para\)/)
  assert.match(goaltask, /kind: 'kb',\n      where: noteMode \? 'note' : 'task'/)
  assert.match(richnote, /const k = detectKbQuote\(para\)/)
  assert.match(richnote, /kind: kb \? 'kb' : 'quote'/)
  assert.match(kb, /kb: \(\) => kbQuoteGroups\(st\.cards, st\.editing === 'new' \? '' : st\.editing\)/)
  assert.match(kbdlg, /kb: \(\) => kbQuoteGroups\(data\.cards, data\.self\)/)
  /* 关面板的 how 仍透传给调用方（esc / outside 才记「别重开」） */
  assert.match(panel, /const onClose = P\.ctx\?\.onClose/)
  assert.match(panel, /if \(onClose\) \{ try \{ onClose\(how\) \}/)
})

test('v171 样式：kb 头部绿 / 标签条与胶囊 / 渐变 / 状态胶囊（浅深两套）', () => {
  assert.match(css, /\.qpn\.kb \.qpn-hi \{ background: rgba\(30, 143, 94, \.10\); color: #1e8f5e; \}/)
  assert.match(css, /body\[data-ds-dark-theme\] \.qpn\.kb \.qpn-hi \{ background: rgba\(52, 177, 122, \.14\); color: #34b17a; \}/)
  assert.match(css, /\.qpn\.kb \.qpn-loc \{ border-bottom: 0; \}/)
  assert.match(css, /\.qpn-tags \{ flex: none; display: flex; align-items: center; gap: 6px; height: 40px;/)
  assert.match(css, /\.qpn-tag \{ flex: none;[^}]*height: 24px;[^}]*border-radius: 999px;/)
  assert.match(css, /\.qpn-tag\.on \{ border-color: var\(--pm-brand-line\); background: var\(--pm-brand-soft\); color: var\(--pm-brand\); \}/)
  assert.match(css, /\.qpn-tags \.l \{ flex: none; font-size: 10px;/)
  assert.match(css, /\.qpn-tagx \{ flex: none;[^}]*border-left: 1px solid var\(--dsw-alias-border-l2\);/)
  assert.match(css, /\.qpn-tgbs\.l\.r \{ mask-image: linear-gradient\(90deg, transparent 0, #000 22px, #000 calc\(100% - 22px\), transparent 100%\); \}/)
  assert.match(css, /\.qpn-chip\.st-draft \{ border-style: dashed; \}/)
  assert.match(css, /\.qpn-chip\.st-stale \{ border-color: color-mix\(in srgb, #92601a 45%/)
  assert.match(css, /body\[data-ds-dark-theme\] \.qpn-chip\.st-stale \{ border-color: color-mix\(in srgb, #d7a860 45%/)
})

test('v171 版本：CHANGELOG 有 0.68.0 这一条（当前版本号由最新的版本用例锁）', () => {
  assert.match(log, /## 0\.68\.0/)
  assert.match(log, /知识卡引用伴手弹窗|引用知识卡/)
  assert.match(log, /标签筛选条/)
})
