/**
 * v167 源码锁：引用伴手弹窗「关不掉」（空输入框 + 光标聚焦时，Esc / 空格 / 点外面关掉后又会自己回来）
 *  根因：按钮打开的那块弹窗没有「触发词」可依赖，track() 只要 n === 0（没打字）就 paint()，
 *        于是任何一次 input / selectionchange（光标动一下、退格回空、点回输入框）都会把它复活。
 *  修法：① launch 态唯一存活条件 = 面板还开着；关掉即丢 launch 态，并且把这次输入继续交给
 *          正常的「>」判定（别把新打的「>」吞掉）。
 *        ② 外部按下改用 pointerdown（与面板同相位、先注册），否则「再点同一个按钮 = 收起」记不到 skip。
 *        ③ skip 从布尔改成 500ms 时间窗，避免一次没配上 click 就把下一次点击也吞掉。
 * 真机验收走 staging：20 项（/tmp/v167/repro6.cjs）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src', 'client')
const qmenu = readFileSync(join(SRC, 'qmenu.ts'), 'utf8')

test('v167 · launch 态的唯一存活条件 = 面板还开着（关掉就丢，不许被光标复活）', () => {
  assert.ok(qmenu.includes('if (!isQuotePanelOpen()) {\n        this.st = null; this.trigger = null\n      } else {'), '面板已关 → 丢 launch 态')
  assert.ok(qmenu.includes('退格回空、再打普通文字，都不许把它复活'), '说明根因')
  // 关掉之后必须继续往下走（新打的「>」不能被吞掉）
  const i = qmenu.indexOf('this.st = null; this.trigger = null')
  const hit = qmenu.indexOf('const hit = detectQuote(', i)
  assert.ok(i > 0 && hit > i, '丢 launch 态后落到 detectQuote')
})

test('v167 · 没在打字（n === 0）就保持现状，不再无脑重画', () => {
  assert.ok(qmenu.includes("const q = n > 0 ? p.text.slice(-n) : ''"), '筛选词 = 打开处之后的文字')
  assert.ok(qmenu.includes("if (this.st.len !== 0 || this.st.q !== '') { this.st.len = 0; this.st.q = ''; this.paint() }"), '只有删回空词才刷回全量')
  assert.ok(qmenu.includes('if (n < 0 || /\\s/.test(q) || q.length !== n) return closeQuotePanel(\'composer\')'), '退到打开处之前 / 遇空白 / 词长不符 → 关')
})

test('v167 · 外部按下用 pointerdown，且「再点同一个按钮 = 收起」能被记到', () => {
  assert.ok(qmenu.includes("document.addEventListener('pointerdown', this.onDown, true)"), 'pointerdown 注册')
  assert.ok(qmenu.includes("document.removeEventListener('pointerdown', this.onDown, true)"), 'pointerdown 注销')
  assert.ok(!qmenu.includes("addEventListener('mousedown', this.onDown"), '不再用 mousedown（会晚于面板自己的 pointerdown，skip 记不到）')
  assert.ok(qmenu.includes("if (t.closest?.('[data-qopen]')) { this.skippedAt = Date.now(); this.dismiss(); return }"), '收起 + 记时间')
})

test('v167 · skip 是 500ms 时间窗，不是布尔（避免吞掉下一次点击）', () => {
  assert.ok(qmenu.includes('private skippedAt = 0'), '时间戳')
  assert.ok(qmenu.includes('if (this.skippedAt && Date.now() - this.skippedAt < 500) { this.skippedAt = 0; return }'), '窗口内才吞')
  assert.ok(!qmenu.includes('private skip = false'), '旧布尔已删')
})

test('v167 · 原有「>」路径没被改坏', () => {
  assert.ok(qmenu.includes('const hit = detectQuote(p.text, p.first)'), '「>」识别')
  assert.ok(qmenu.includes("this.st = { len: hit.len, q: hit.query, ch: this.chOf(hit.len), launch: null }"), '「>」路径 launch = null')
  /* v171：记忆从「整段文字 + 筛选词」换成「触发位置 + 左段原文 + 长度」—— 仍是「同一处触发词不再弹」 */
  assert.ok(qmenu.includes("if (h && p.text.length >= this.dis.len && this.dis.at === caret - h.len && mutedBy(this.dis.left, p.text)) return closeQuotePanel('composer')"), '收起后同一处「>」不重弹（按位置 + 左段原文 + 长度判定）')
})
