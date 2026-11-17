/**
 * v164 源码锁 + 逻辑单测：一套富文本编辑框（知识卡正文接进任务说明那套）。
 * 只锁「一处定义」这件事的结构，不在单测里跑 DOM（DOM 走真机验收）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src', 'client')
const read = (f) => readFileSync(join(SRC, f), 'utf8')

const rich = read('richnote.ts')
const kb = read('kb.ts')
const css = read('style.css')

test('v164 · 一套编辑器：richnote 导出 mountRichNote，且七层能力都有入口', () => {
  assert.match(rich, /export function mountRichNote\(root: HTMLElement, ctx: RichCtx\): RichNote/)
  assert.match(rich, /mountNoteDoc\(root, \{/, 'L1 块编辑器复用 mountNoteDoc')
  assert.match(rich, /ctx\.countEl/, 'L2 字数')
  assert.match(rich, /ctx\.dividerBtn/, 'L2 分割线按钮')
  assert.match(rich, /ctx\.quote/, 'L3 引用菜单')
  assert.match(rich, /ctx\.catalog/, 'L3 胶囊目录')
  assert.match(rich, /ctx\.marks/, 'L4 识别层')
  assert.match(rich, /ctx\.submit/, 'L7 ⌘Enter 提交')
  assert.match(rich, /dpm-rich-mark/, 'L4 用 CSS Custom Highlight（不改 DOM）')
})

test('v164 · 引用菜单的触发规则就是共享的 detectQuote（不各写一份）', () => {
  /* v171：同一个 import 也带上「）」的 detectKbQuote + 收起记忆的 mutedBy / leftOf —— 规则仍然只长在 quote.ts 里 */
  assert.match(rich, /import \{ detectKbQuote, detectQuote, leftOf, mutedBy \} from '\.\.\/quote\.js'/)
  assert.match(rich, /const q = detectQuote\(para\)/)
  assert.doesNotMatch(rich, /first \? \{ len: para\.length/, '不能再有「必须是文档第一行」的门')
  assert.doesNotMatch(rich, /for \(let i = para\.length - 1; i >= 0; i--\)/, '规则只留一份，别在 richnote 里手抄 detectQuote')
})

test('v164 · 插入时删掉触发符 + 查询词：hitLen 在关面板前抄走，且容忍块编辑器末尾的补位空行', () => {
  /* v165：面板把 hit 抄成 hitNow 再 close('pick')，插入回调拿到的是同一份 len */
  assert.ok(rich.includes('function insertQuote(text: string, hitLen: number): void'), '插入走 insertQuote(text, hitLen)')
  assert.match(rich, /openQuotePanel\(\{[\s\S]{0,700}?insert: \(text, h\) => insertQuote\(text, h\.len \|\| 0\)/)
  assert.ok(rich.includes('let at = caret'), 'paraBefore 要跳过末尾空白')
  assert.ok(rich.includes('v.slice(v.lastIndexOf(') && rich.includes(', at - 1) + 1, at)'), 'paraBefore 按光标前那一行算段落')
  assert.ok(rich.includes('const start = Math.max(0, at - hitLen)'), '删除起点按 at 算')
  assert.ok(rich.includes('nd.set(v.slice(0, start) + text + v.slice(at))'), '保留 at 之后的正文')
})

test('v164 · Esc / 点外面关掉菜单后不会被 keyup 立刻重开（muted）', () => {
  /* v171：记的是「触发位置 + 左边那段原文 + 当时的长度」，不只一个字符串标记 */
  assert.ok(rich.includes('let muted: { left: string; at: number; len: number } | null = null'), '要有 muted 状态')
  /* v165：Esc 由面板吃掉并回传 how；v171 起只对用户主动收起（esc / outside）记 */
  assert.ok(rich.includes("if (how !== 'esc' && how !== 'outside') return"), '只对用户主动收起记')
  assert.ok(rich.includes('muted = { left: leftOf(h.para, h.len), at: caret - h.len, len: total }'), '记「位置 + 左段原文 + 长度」')
  assert.match(rich, /if \(muted\) \{/)
  assert.match(rich, /mutedBy\(muted\.left, hit\.para\)\) \{ closeMenu\(\); return \}/)
})

test('v164 · 胶囊 ⌘ 点击：不剥「」也不落 fs/reveal；编辑态只提示先保存', () => {
  assert.ok(rich.includes('const tok = canonOrTok'), 'openTok 不能剥掉「」')
  assert.ok(!rich.includes("replace(/^「「?/, '')"), '不能再剥括号')
  assert.ok(kb.includes('先保存或取消，再跳到那张知识卡'), '编辑态 ⌘ 点击要拦住（否则重渲染把输入冲掉）')
  assert.ok(kb.includes('if (st.editing) { opts.toast('), '知识卡 / 项目卡都要拦')
})

test('v164 · 知识卡编辑框用的是 richnote，不再是裸 mountNoteDoc', () => {
  assert.match(kb, /import \{ mountRichNote, type RichNote, type ChipItem \} from '\.\/richnote\.js'/)
  assert.doesNotMatch(kb, /from '\.\/notedoc\.js'/, 'kb.ts 不该再直接引 notedoc')
  assert.match(kb, /nd = mountRichNote\(box, \{/)
  assert.match(kb, /where: 'kb'/)
})

test('v164 · 知识卡编辑器开 L2/L3/L4/L7，关 L5/L6', () => {
  const seg = kb.slice(kb.indexOf('nd = mountRichNote(box'), kb.indexOf('nd = mountRichNote(box') + 700)
  for (const k of ['countEl', 'dividerBtn', 'quote:', 'catalog:', 'marks: true', 'submit:']) assert.ok(seg.includes(k), '缺 ' + k)
  assert.ok(!seg.includes('history'), 'L6 历史消息不该出现（知识库页没有会话）')
  assert.ok(!seg.includes('assist'), 'L5 添加为不该出现（知识卡没有 links/files 维）')
})

test('v164 · 引用菜单两组：知识卡（排除自己）+ 关联卡片', () => {
  /* v165：同一块面板，知识卡上下文只给两组 */
  assert.match(kb, /key: 'kb', name: '知识卡'/)
  assert.match(kb, /key: 'cards', name: '关联卡片'/)
  assert.match(kb, /st\.cards\.filter\(\(k\) => k\.id !== self\)/, '不能引用正在编辑的这张')
  assert.match(kb, /k\.type === 'prompt' && body/, '提示词类插正文（v179：body 先取到局部变量，好同时算分段）')
})

test('v164 · 胶囊目录：知识卡 + 项目卡，格式走 quote.ts 同一套', () => {
  assert.match(kb, /const kbCanon = \(k: KbItem\): string => kbText\(k\.title, k\.path\)/)
  assert.match(kb, /canon: cardText\(c\.title, c\.group\)/)
  assert.match(kb, /kind: 'kb' as const/)
})

test('v164 · 识别气泡：节流用最后落点 + pointer-events:none（否则一动就 pointerleave 自关）', () => {
  assert.ok(rich.includes('mx = e.clientX; my = e.clientY'), '节流窗口里也要更新到最新坐标')
  assert.match(rich, /const tok = markAt\(mx, my\)/)
  assert.ok(css.includes('.nref-pop.rich-mtip { pointer-events: none; }'), '提示气泡不能抢鼠标')
  assert.ok(css.includes('.nref-pop.rich-pop, .nref-pop.rich-mtip {'), '挂在 body 上的气泡要有基线样式（原来只写在 .dpm-dialog 下）')
})

test('v164 · 识别层气泡写明「为什么只识别、不给添加为」（原型 §四.5）', () => {
  assert.ok(rich.includes('marksNote?: string'), 'richnote 要把这句话开放成 ctx 参数（别在共享组件里写死知识卡）')
  assert.match(rich, /ctx\.marksNote \? '<p class="npn">'/)
  assert.ok(kb.includes('知识卡没有「相关文件」这一维，所以这里只识别、不提供「添加为…」'))
  assert.ok(css.includes('.nref-pop.rich-mtip .npn'), '那行小字要有样式')
})

test('v164 · 读态认分割线（──── 标题 ──── → .kbdiv）', () => {
  assert.match(kb, /const dvLine = \/\^\[─—\]\{4,\}/)
  assert.match(kb, /class="kbdiv' \+ \(dvLine\[1\] \? '' : ' no-t'\)/)
  assert.match(css, /\.dpm\.kb-page \.kbd-b \.kbdiv \{/)
})

test('v164 · 知识卡编辑框 = .gt-* 那套（工具行 36 / 正文 13px / 内距 9 12 16 / 圆角 12）', () => {
  const seg = css.slice(css.indexOf('v164 · 一套富文本编辑框'))
  assert.ok(seg.length > 500, '缺少 v164 段')
  assert.match(seg, /\.dpm\.kb-page \.kbe \.gt-box-h \{[^}]*height: 36px/)
  assert.match(seg, /\.dpm\.kb-page \.kbe \.gt-note \{[^}]*font-size: 13px; line-height: 1\.72/)
  assert.match(seg, /\.dpm\.kb-page \.kbe \.gt-note \{[^}]*padding: 9px 12px 16px/)
  assert.match(seg, /\.dpm\.kb-page \.kbe \.gt-box \{[^}]*border-radius: 12px/)
  assert.match(kb, /class="gt-box gt-desc"/)
  assert.match(kb, /class="gt-box-h"/)
  assert.match(kb, /class="gt-op gt-dv"/)
})

test('v164 · 滚动 bug 修复：滚轮能带动外层 + 超高窗口不把按钮顶出屏幕', () => {
  const seg = css.slice(css.indexOf('v164 · 一套富文本编辑框'), css.indexOf('v165 · 引用伴手弹窗'))
  assert.match(seg, /max-height: min\(46vh, 420px\)/, '绝对上限（超高窗口不再失控）')
  assert.match(seg, /overscroll-behavior: auto/, '滚轮到头要能带动外层表单')
  assert.doesNotMatch(seg, /overscroll-behavior: contain/, '编辑器不能吞掉滚轮')
})

test('v164 · 胶囊图标：知识卡 = 绿色开卷书（几何仍沿用 .nref）', () => {
  assert.match(rich, /it\.kind === 'kb' \? ' kbk' : ''/)
  assert.match(css, /\.nref\.kbk \.ri \{ color: #1e8f5e; \}/)
})

test('v164 · CHANGELOG 有 0.62.0 这一版（版本号已随 v165 走到 0.63.0，见 v165.test）', () => {
  const log = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8')
  assert.match(log, /## 0\.62\.0/)
})
