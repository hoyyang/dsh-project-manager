/**
 * v165 源码锁：引用伴手弹窗（quotepanel.ts 是唯一一份，四处编辑器只传上下文开关）。
 * 只锁结构与口径，不跑 DOM（DOM / 交互 / 贴顶走 staging 真机验收）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src', 'client')
const read = (f) => readFileSync(join(SRC, f), 'utf8')
const panel = read('quotepanel.ts')
const qmenu = read('qmenu.ts')
const goal = read('goaltask.ts')
const rich = read('richnote.ts')
const kb = read('kb.ts')
const css = read('style.css')

const order = (...keys) => {
  const at = keys.map((k) => panel.indexOf(k))
  return at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1]))
}

test('v165 · 八类顺序固定：任务 → 相关说明 → 知识卡 → 相关链接 → 相关文件 → 仓库 → 关联卡片 → 活跃会话', () => {
  const src = qmenu.slice(qmenu.indexOf('export function buildQuoteRows'), qmenu.indexOf('export class QuoteMenu'))
  const keys = ["key: 'task'", "key: 'note'", "key: 'kb'", "key: 'link'", "key: 'file'", "key: 'repo'", "key: 'related'", "key: 'sess'"]
  const at = keys.map((k) => src.indexOf(k))
  assert.ok(at.every((v) => v >= 0), '八类都要有：' + JSON.stringify(at))
  assert.ok(at.every((v, i) => i === 0 || v > at[i - 1]), '顺序不能变：' + JSON.stringify(at))
  assert.match(src, /.filter\(\(g\) => g\.items\.length \|\| g\.key === 'task'\)/, '任务类永远保留（空态）')
})

test('v165/v166 · 面板 760×640，窄屏收进视口（v166：锚点上方 10px + 高度按可用空间自适应）', () => {
  assert.ok(panel.includes('Math.min(760, vw - pad * 2)'), '宽 min(760, 100vw-24)')
  assert.ok(panel.includes('Math.min(640, vh - pad * 2)'), '高最多 min(640, 100vh-24)')
  assert.ok(panel.includes('const pad = 12, gap = 10'), '安全边 12 / 与触发物留 10')
  assert.ok(panel.includes("if (up >= Math.min(cap, 320)) { ht = Math.min(cap, up); top = Math.round(r.top - gap - ht) }"), '优先贴锚点上方，按上方空间自适应')
  assert.ok(panel.includes('Math.max(260, Math.min(cap, Math.max(up, down)))'), '实在放不下：260 保底 + 居中')
  assert.ok(css.includes('width: 760px; height: 640px'), 'CSS 里也是 760×640')
})

test('v165/v166 · 快速定位条 46px + 八个同名按钮 + 平滑滚动（v166：去锁 + 落点用缓存几何）', () => {
  assert.ok(css.includes('.qpn-loc { flex: none; display: flex; align-items: center; gap: 5px; height: 46px'), '定位条 46px')
  assert.ok(panel.includes("data-lb="), '按钮带 data-lb')
  assert.ok(panel.includes("role=\"toolbar\" aria-label=\"快速定位分区\""), '定位条是一个 toolbar')
  assert.ok(panel.includes("behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'"), '平滑滚动（reduced-motion 降级跳）')
  assert.ok(!panel.includes('P.locLock'), 'v166：900ms 定位锁已删除（状态必须实时跟手）')
  assert.ok(panel.includes('const target = Math.max(0, Math.round(g.top - 1))'), '落点按缓存的分区顶算')
  assert.ok(panel.includes('if (P.secClosed.has(key)) { P.secClosed.delete(key); memWrite(); paint() }'), '收起的先展开再滚')
})

test('v165/v166 · 滚动跟随：当前分区按钮自动点亮（v166 用缓存几何，滚动帧不读 rect）', () => {
  assert.ok(panel.includes('function syncScroll(): void'), 'syncScroll')
  assert.ok(panel.includes('for (const g of P.geo) {'), '按缓存几何遍历分区')
  assert.ok(panel.includes('if (g.top - sc <= 12) cur = g.key'), '类头贴住的那个分区 = 当前分区')
  assert.ok(panel.includes('function setLocActive(key: string): void'), 'setLocActive')
  assert.ok(panel.includes('function measure(): void'), 'measure 在渲染后量一次')
  assert.ok(panel.includes('const top = s.offsetTop - lo'), '几何用 offsetTop（避开入场动画 scale）')
})

test('v165 · 深蓝卡片边框：浅色 #2d4f96 / 深色自动提亮 #7b9bdd', () => {
  assert.ok(css.includes('--qpn-line: #2d4f96'), '浅色深蓝')
  assert.ok(css.includes('body[data-ds-dark-theme] .qpn { --qpn-line: #7b9bdd; }'), '深色提亮')
  assert.ok(css.includes('.qpn-sec { position: relative; flex: none; border: 1px solid var(--qpn-line)'), '八张分区卡都用这一条边框')
})

test('v165 · 吸顶：类头 44 / 任务行 40 两层 sticky；卡顶滚出才补「方角直线」前沿（不用 inset）', () => {
  assert.ok(css.includes('.qpn-g { position: sticky; top: -8px'), '类头 sticky')
  assert.ok(css.includes('height: 44px; margin: 0'), '类头 44px')
  /* 列表 padding 8：top:36 实际贴在 44（类头 44 高），视觉上正好压在类头下沿 */
  assert.ok(css.includes('.qpn-r.task { position: sticky; top: 36px; z-index: 5; min-height: 40px'), '任务行 sticky：贴在类头下 44px、高 40px')
  assert.ok(panel.includes("const cut = g.top < sc - 0.5"), 'cut = 卡顶被滚出视口（缓存几何）')
  assert.ok(css.includes('.qpn-g.stuck::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: transparent'), '前沿线 = 方角直线')
  assert.ok(css.includes('.qpn-sec.cut > .qpn-g.stuck::after { background: var(--qpn-line); }'), '只在 cut 时上色')
  const qpnStart = css.indexOf('/* ═══ v165 · 引用伴手弹窗')
  const qpnEnd = css.indexOf('v168 · 三处整改', qpnStart)
  const qpnCss = css.slice(qpnStart, qpnEnd > 0 ? qpnEnd : undefined)
  assert.ok(!/inset 0 1px 0/.test(qpnCss), '不能再拿 inset 阴影画前沿线（圆角会弯出弯头）')
  assert.ok(panel.includes('.qpn-taskwrap'), '任务行要包在自己的 wrapper 里')
})

test('v165 · 只列未完成 + 子任务默认收起 + 已完成计数写进类头', () => {
  const src = qmenu.slice(qmenu.indexOf('export function buildQuoteRows'))
  assert.ok(src.includes('filter(({ t }) => !t.done)'), '任务只列未完成')
  assert.ok(src.includes('filter(({ x }) => !x.done)'), '子任务只列未完成')
  assert.ok(src.includes('subDone: subsAll.filter((x) => x.done).length'), '已完成条数照写')
  assert.ok(src.includes("已完成 ' + doneN + ' 项不显示"), '类头写「已完成 N 项不显示」')
  assert.ok(panel.includes('P.taskOpen.has(it.id)'), '子任务默认收起（只有显式展开过才开）')
  assert.ok(src.includes("empty: '<b>任务都完成了</b> · 本版只列未勾选的"), '全完成时给空态')
})

test('v165 · 镶金：金块渐变 + 「★ 星标」金胶囊 + 悬停流光（深浅两套）', () => {
  assert.ok(css.includes('linear-gradient(142deg, #fbe6a6, #e3b74f 58%, #cc9426)'), '金块渐变')
  assert.ok(css.includes('@keyframes qpnSweep'), '流光动效')
  assert.ok(css.includes('animation: qpnSweep 760ms var(--ease)'), '悬停播流光')
  assert.ok(css.includes('.qpn-star {'), '星标金胶囊')
  assert.ok(css.includes('body[data-ds-dark-theme] .qpn-star'), '深色一套')
  assert.ok(panel.includes("const starChip = (): string => '<span class=\"qpn-star\">'"), '面板里画星标胶囊')
})

test('v165 · 一处定义：四处编辑器都调 openQuotePanel，只有一份外壳', () => {
  for (const [name, src] of [['qmenu.ts', qmenu], ['goaltask.ts', goal], ['richnote.ts', rich]]) {
    assert.ok(/openQuotePanel\(/.test(src), name + ' 要调 openQuotePanel')
    assert.ok(!/class=\"qpn/.test(src), name + ' 不能自己拼面板 DOM')
    assert.ok(!/qpn-sec|qpn-g\b/.test(src), name + ' 不能自己拼面板结构')
  }
  assert.ok(kb.includes('quote: kbQuoteRows'), '知识卡把数据交给同一块面板')
  assert.ok(!/className = 'dpm-qm'/.test(qmenu), '对话框那一套浮层外壳已删')
  assert.ok(!/menuShell|className = 'dpm-qm'/.test(rich), '知识卡那套小菜单外壳已删')
  assert.ok(!/qAddRow|gt-qadd/.test(goal), '任务说明里的旧「新增并引用」一行已删（挪进面板）')
  assert.ok(goal.includes('function showQuotePanel'), '任务说明 / 相关说明走同一入口')
  assert.ok(rich.includes("where: 'kb'"), '知识卡上下文')
  assert.ok(qmenu.includes("where: 'composer'"), '对话框上下文')
  assert.ok(goal.includes("where: noteMode ? 'note' : 'task'"), '任务说明 / 相关说明靠上下文开关区分')
})

test('v165 · 新增并引用只在项目卡上下文出现（任务说明 / 相关说明），四按钮不变', () => {
  assert.ok(goal.includes('add: (kind, h) => { void startQuoteAdd(kind, h) }'), '任务说明传 add')
  assert.ok(!/\badd: /.test(qmenu), '对话框不传 add')
  assert.ok(!/\badd: /.test(rich), '知识卡不传 add')
  for (const t of ['+说明', '+链接', '+文件', '+仓库']) assert.ok(panel.includes(t), '面板里的添加按钮：' + t)
  assert.ok(goal.includes('qaddCaret = note().selectionStart'), '点添加前先记光标（插回光标处）')
})

test('v165 · 知识卡正文只给 2 类（知识卡排除自己 + 关联卡片）', () => {
  const src = kb.slice(kb.indexOf('const kbQuoteRows'), kb.indexOf('const kbChipCatalog'))
  assert.ok(src.includes("key: 'kb'") && src.includes("key: 'cards'"), '两组：kb + cards')
  assert.ok(!/key: '(link|file|repo|sess|related)'/.test(src), '不能再有链接 / 文件 / 仓库 / 会话维')
  assert.ok(src.includes('k.id !== self'), '排除自己')
})

test('v165 · 键盘：↑↓ 选择 / ↵ 插入 / ←→ 开合 / esc 关；空格不劫持、输入法不处理', () => {
  assert.ok(panel.includes("if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return }"), 'Esc 只关面板')
  assert.ok(panel.includes("if (k === 'ArrowDown' || k === 'ArrowUp')"), '↑↓ 选择')
  assert.ok(panel.includes("if (k === 'Enter')"), '↵ 插入 / 开合')
  assert.ok(panel.includes("(k === 'ArrowLeft' || k === 'ArrowRight')"), '←→ 开合')
  assert.ok(panel.includes('e.isComposing || e.keyCode === 229'), '输入法不处理')
  assert.ok(panel.includes('/* 空格不劫持：编辑器里继续打字 */'), '空格不劫持')
  /* v171：esc / outside 都算用户主动收起，记「位置 + 左段原文 + 长度」 */
  assert.ok(goal.includes("if ((how === 'esc' || how === 'outside') && cur) rememberMute()"), '任务说明 Esc 后别立刻重开')
  assert.ok(rich.includes("if (how !== 'esc' && how !== 'outside') return"), '知识卡 Esc 后别立刻重开')
})

test('v165 · 插入：吃掉「>筛选词」，插入点在各自光标处', () => {
  assert.ok(panel.includes('const hitNow: QpHit = { len: P.hit.len, q: P.hit.q, ch: P.hit.ch }'), '插入前把 hit 抄一份')
  assert.ok(panel.includes("close('pick')"), '插入时关面板')
  assert.ok(goal.includes("const start = Math.max(0, caret - hitLen)") && goal.includes('n.value = n.value.slice(0, start) + text + n.value.slice(caret)'), '任务说明按光标偏移替换')
  assert.ok(rich.includes('const start = Math.max(0, at - hitLen)'), '知识卡按 at 算删除起点')
  assert.ok(qmenu.includes('start: st?.launch ?? cur.start - (hit.len || 0)'), '对话框用宿主 insertion span')
  assert.ok(qmenu.includes('cx?.insertAt(this.host.sid, text, span)'), '对话框优先插成胶囊（insertAt）')
})

test('v165 · 面板挂在 dialog 里（top layer）才算数，面板单实例', () => {
  assert.ok(goal.includes('host: dlg ?? undefined'), '任务说明挂在任务 dialog 里')
  assert.ok(panel.includes('(o.host ?? document.body).append(P.el)'), '没给 host 就挂 body')
  /* v171：kind 也参与「同一块面板」判定（同锚点换身份 = 整块重建，永不双开） */
  assert.ok(panel.includes('const same = P.open && !!P.el && P.where === o.where && P.kind === kind && P.anchor === o.anchor'), '同一上下文复用同一块面板')
  assert.ok(panel.includes("P.cancelled = (e: Event): void => { if (P.open) e.preventDefault() }"), '面板开着时 dialog 的 cancel 不外传（Esc 只关面板）')
})

test('v165 · 任务说明 / 相关说明里也能插知识卡胶囊（绿色书 + 点开气泡）', () => {
  assert.ok(goal.includes("kind: 'note' | 'link' | 'file' | 'repo' | 'kb'"), '胶囊种类加 kb')
  assert.ok(goal.includes('for (const a of c.card.kb ?? [])'), '按卡片挂载的知识卡补胶囊')
  assert.ok(goal.includes('quoteKbText(k.title, k.path)'), '原文格式走共享 kbText')
  assert.ok(goal.includes("if (kind === 'note' || kind === 'kb') {"), '点胶囊走详情气泡（说明 / 知识卡同一入口）')
  /* v177：知识卡气泡从任务弹窗自己的小窗换成统一的 DetailBubble（一处定义） */
  assert.ok(goal.includes('openChipDetail(bubbleCtx(), chip, card)'), '知识卡 / 说明走同一个详情气泡')
  assert.ok(goal.includes("from './detailbubble.js'"), '气泡组件只此一份')
})

test('v165 · prefers-reduced-motion：入场 / 流光 / 箭头 / 定位脉冲全关', () => {
  /* v172：文件末尾会继续追加新版的 reduced-motion 块 → 按「内容」找这一段，不按位置锁 */
  const seg = css.split('@media (prefers-reduced-motion: reduce)').find((s) => s.includes('.qpn { animation: none; }')) ?? ''
  assert.ok(seg.includes('.qpn { animation: none; }'), '面板入场关')
  assert.ok(seg.includes('.qpn-r.gold:hover::after { animation: none; }'), '流光关')
  assert.ok(seg.includes('.qpn-sec.hit { animation: none; }'), '定位脉冲关')
  assert.ok(panel.includes("matchMedia('(prefers-reduced-motion: reduce)')"), '定位滚动降级为直接跳')
})

test('v165 · hidden 真的隐藏（筛选胶囊 / 新增并引用条）', () => {
  assert.ok(css.includes('.qpn [hidden] { display: none !important; }'), 'author display 不能盖掉 hidden')
})

test('v165 · CHANGELOG 有 0.63.0 这一版（版本号已随 v166 走到 0.64.0，见 v166.test）', () => {
  const ch = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8')
  assert.match(ch, /^## 0\.63\.0/m, 'CHANGELOG 有 0.63.0')
})
