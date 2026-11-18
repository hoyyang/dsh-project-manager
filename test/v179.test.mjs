/* v179：分割线分段引用（解析 / 注入格式 / 面板行为 / 数据层接线 / 版本） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as S from '../lib/sections.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const C = (f) => readFileSync(new URL('../src/client/' + f, import.meta.url), 'utf8')
const T = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')

const TASK = { kind: 'task' }
const KB = { kind: 'kb', title: '分割线分段引用', path: '/tmp/u/.dsh/dsh-project-manager/kb/k1.md' }

test('解析：默认段 + 两段带标题', () => {
  const s = S.splitSections('开头\n──── A ────\na\n──── B ────\nb', TASK)
  assert.deepEqual(s.map((x) => x.t), ['', 'A', 'B'])
  assert.deepEqual(s.map((x) => x.n), [2, 1, 1])
  assert.equal(s[0].body, '开头')
  assert.equal(s[2].body, 'b')
})

test('解析：开头就是分割线 → 没有默认段', () => {
  const s = S.splitSections('──── A ────\na\n──── B ────\nb', TASK)
  assert.deepEqual(s.map((x) => x.t), ['A', 'B'])
})

test('解析：没有带标题分割线 → 不分段', () => {
  assert.deepEqual(S.splitSections('只有正文\n第二行', TASK), [])
  assert.deepEqual(S.splitSections('──── ────\n正文', TASK), [])
  assert.deepEqual(S.splitSections('', TASK), [])
  assert.deepEqual(S.splitSections(null, TASK), [])
})

test('解析：无标题分割线不切段、留在当前段正文里', () => {
  const s = S.splitSections('前\n────\n中\n──── A ────\na\n────\n──── B ────\n', TASK)
  assert.deepEqual(s.map((x) => x.t), ['', 'A', 'B'])
  assert.ok(s[0].body.includes('────'))
  assert.equal(s[0].n, 6) // 前 / ──── / 中 / ──── = 6 个字符
  assert.equal(s[2].n, 0) // 空段
  assert.equal(s[2].prev, '')
})

test('解析：CRLF 正常拆段；长破折号也认', () => {
  const s = S.splitSections('默认\r\n———— A ————\r\n正文', TASK)
  assert.deepEqual(s.map((x) => x.t), ['', 'A'])
  assert.equal(s[1].body, '正文')
})

test('解析：空标题的分割线 = 无标题（不切段）', () => {
  const s = S.splitSections('──── ────\nx\n──── A ────\ny', TASK)
  assert.deepEqual(s.map((x) => x.t), ['', 'A'])
})

test('注入：任务 / 子任务带段头，默认段不带；知识卡一律带出处行', () => {
  const s = S.splitSections('默认正文\n──── 验收口径 ────\n只看这一段', TASK)
  assert.equal(s[0].ins, '默认正文')
  assert.equal(s[1].ins, '──── 验收口径 ────\n只看这一段')
  const k = S.splitSections('默认正文\n──── 验收口径 ────\n只看这一段', KB)
  assert.match(k[1].ins, /^「“分割线分段引用”知识卡 · 分割线『验收口径』（\/tmp\/u\/\.dsh\/dsh-project-manager\/kb\/k1\.md）」\n只看这一段$/)
  assert.match(k[0].ins, /^「“分割线分段引用”知识卡 · 默认段（.*k1\.md）」\n默认正文$/)
})

test('注入：段标题里的 「」 折成 『』（不截断外层引用边界）', () => {
  const s = S.splitSections('──── 他说「好」 ────\n正文', KB)
  assert.ok(s[0].ins.includes('分割线『他说『好』』'))
  assert.ok(!s[0].ins.includes('「好」'))
})

test('筛选用 hay：段标题 + 段正文都进去', () => {
  const s = S.splitSections('默认\n──── 验收口径 ────\n四处入口逐项量', TASK)
  const hay = S.secHay(s)
  assert.ok(hay.includes('验收口径') && hay.includes('四处入口逐项量'))
})

test('面板：分段列表是面板外侧的浮层，外层只画框/三角，滚动交给内层', () => {
  const src = C('quotepanel.ts')
  assert.match(src, /d\.className = 'qpn-sgs'/)
  assert.match(src, /<div class="qpn-sgsin"><\/div>/)
  // 外层不能 auto（否则小三角会冒横向条）
  const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.qpn-sgs \{[^}]*overflow: visible/)
  assert.match(css, /\.qpn-sgsin \{[^}]*overflow-y: auto; overflow-x: hidden/)
  assert.match(css, /\.qpn-sgs\.below::before \{ display: none; \}/)
})

test('面板：点分段列表不算「点面板外面」（否则点一段先关面板 = 点了没填）', () => {
  const src = C('quotepanel.ts')
  assert.match(src, /if \(P\.secEl && P\.secEl\.contains\(t\)\) return/)
})

test('面板：70ms 展开 / 220ms 收起 / 钉住后不收起', () => {
  const src = C('quotepanel.ts')
  assert.match(src, /setTimeout\(\(\) => \{ P\.secT = 0; secShow\(i, secs, row\) \}, 70\)/)
  assert.match(src, /setTimeout\(\(\) => \{ P\.secH = 0; secHide\(\) \}, 220\)/)
  assert.match(src, /if \(P\.secPin && P\.secKey === 'r' \+ i\) \{ secHide\(\); return \}/)
})

test('面板：行上的「N 段」胶囊只有真的有分段才出（新组件一律 qpn-sg* 前缀）', () => {
  const src = C('quotepanel.ts')
  assert.match(src, /function secBadge\(i: number, secs: QpSec\[\] \| undefined, kind: 'task' \| 'sub' \| 'kb'\): string \{\n  if \(!secs \|\| !secs\.length\) return ''/)
  assert.match(src, /class="qpn-sgb"/)
  // 不许再用 .qpn-sec 当段卡（八类分区卡占用了这个类名）
  assert.ok(!/qpn-sec[^"']*(?:seg|sec-card)/.test(src))
  assert.ok(!/class="[^"]*qpn-sec[^"]*qpn-sg/.test(src))
})

test('数据层：任务 / 子任务 / 知识卡三处都接 splitSections', () => {
  assert.match(C('qmenu.ts'), /splitSections\(txt, \{ kind: 'task' \}\)/)
  assert.match(C('qmenu.ts'), /splitSections\(st, \{ kind: 'task' \}\)/)
  assert.match(C('qmenu.ts'), /splitSections\(body, prompt \? \{ kind: 'task' \} : \{ kind: 'kb'/)
  assert.match(C('kbdlg.ts'), /export function kbQuoteGroups/)
  assert.match(C('kbdlg.ts'), /const kbSecsOf = /)
  assert.match(C('kbdlg.ts'), /warmKbSecs\(cards, repaintQuotePanel\)/)
  assert.match(C('kb.ts'), /splitSections\(body, k\.type === 'prompt'/)
})

test('数据层：知识卡正文二段式预取到齐后补「N 段」（不阻塞列表）', () => {
  const src = C('kbdlg.ts')
  assert.match(src, /export function warmKbSecs/)
  assert.match(src, /export const kbBodyNow = \(id: string\): string \| null => bodies\.get\(id\) \?\? null/)
  assert.match(src, /setTimeout\(\(\) => \{ secAgainT = 0; try \{ again\(\) \}/)
})

test('设计卡 §四：点整行仍是全文（pick 一路没改），点一段才换成这一段', () => {
  const src = C('quotepanel.ts')
  assert.match(src, /function pick\(i: number\): void \{/)
  assert.match(src, /ctx\.insert\(it\.text, hitNow, it as QpItem\)/)
  assert.match(src, /ctx\?\.insert\(sec\.ins, hitNow, it\)/)
})

test('版本 0.74.0', () => {
  assert.equal(pkg.version, '0.80.0')
})