/**
 * v166 源码锁：引用伴手弹窗三改
 *  ① 开合 + 滚动位置按「项目卡片」记住（四个入口共享 / 换卡隔离 / 刷新保持）
 *  ② 定位锚点 = 触发物（按钮 / 信息卡 / 说明框），打开即冻结
 *  ③ 滚动跟手：渲染时量一次几何（offsetTop）+ 一帧只读 scrollTop + 定位两态
 * 只锁结构与口径，不跑 DOM（真机交互走 staging 验收：58 项）。
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
const dock = read('dock.ts')
const css = read('style.css')

const between = (src, a, b) => {
  const i = src.indexOf(a)
  const j = src.indexOf(b, i + 1)
  return i >= 0 && j > i ? src.slice(i, j) : ''
}

test('v166 · 记忆结构：键 = qp:<cardId>，记录 sec / task / scroll，读的时候三个字段都要读全', () => {
  assert.ok(panel.includes("const MEM_KEY = 'dpm.qp.mem.v1'"), 'localStorage key')
  /* v171：两种身份各记各的（qp:<cardId> / kbq:<cardId>） —— 键仍是「cardId 驱动、没 cardId 就不记忆」 */
  assert.ok(panel.includes("P.memKey = P.cardId ? (kind === 'kb' ? 'kbq:' : 'qp:') + P.cardId : ''"), '键 = qp:<cardId> / kbq:<cardId>；没 cardId 就不记忆')
  assert.ok(panel.includes('interface MemRec { sec: string[]; task: string[]; scroll: MemScroll | null; at: number }'), '记录结构')
  assert.ok(panel.includes('return { sec: [], task: [], scroll: null }'), '没 key 时也返回三字段')
  assert.ok(panel.includes('scroll: a.scroll && typeof a.scroll.pos === \'number\' ? a.scroll : null'), '读回 scroll（漏读 = 位置永远不还原）')
  assert.ok(panel.includes('const mem = memRead(P.memKey)'), 'open 时读')
  assert.ok(panel.includes('P.secClosed = new Set(mem.sec)') && panel.includes('P.taskOpen = new Set(mem.task)') && panel.includes('P.memScroll = mem.scroll'), '三个字段全部落地')
})

test('v166 · 写入口：开合即写 / 滚动 260ms 防抖 / 关面板兜底 / 空记录不落盘 / 40 张 LRU', () => {
  assert.ok(panel.includes('function memWrite(): void'), 'memWrite')
  assert.ok(panel.includes('function saveScrollSoon(): void'), '滚动防抖')
  assert.ok(panel.includes('P.scrollT = window.setTimeout(() => { if (P.open) memWrite() }, 260)'), '260ms')
  assert.ok(panel.includes('if (P.memKey) memWrite()'), '关面板兜底写（closeQuotePanel 里）')
  assert.ok(panel.includes('if (!rec.sec.length && !rec.task.length && !(rec.scroll && rec.scroll.pos > 8)) delete all[P.memKey]'), '空记录不占一条')
  assert.ok(panel.includes('if (ks.length > 40) ks.sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0))'), '40 张 LRU')
  assert.ok(panel.includes('if (String(P.hit.q || \'\').trim()) return null'), '带筛选不记位置（不覆盖原位置）')
  assert.ok(panel.includes('const s = memScrollPos()'), 'memWrite 取当前位置')
})

test('v166 · 位置还原：按「分区 + 偏移」落点（不是死记 px），再钳进可滚范围', () => {
  assert.ok(panel.includes('function restoreScroll(): void'), 'restoreScroll')
  assert.ok(panel.includes('const g = P.geo.find((x) => x.key === s.sec)'), '先找上次那个分区')
  assert.ok(panel.includes('if (g) target = g.top + Math.min(Number(s.off) || 0, Math.max(0, g.h - 1))'), '分区顶 + 分区内偏移')
  assert.ok(panel.includes('target = Math.max(0, Math.min(Math.round(target), list.scrollHeight - list.clientHeight))'), '钳进可滚范围')
  assert.ok(panel.includes('list.scrollTop = target; syncScroll()'), '还原后定位条同步')
  assert.ok(panel.includes('paint()\n    pos()\n    restoreScroll()'), 'open：先 paint（应用开合）→ pos → 还原位置')
})

test('v166 · 记忆胶囊：有记忆才出现（开合 / 位置两种文案），点一下恢复默认', () => {
  assert.ok(panel.includes('class="qpn-mem"'), '面板头部胶囊')
  assert.ok(panel.includes("s.textContent = n ? '开合已记住 ' + n + ' 项' : '已记住上次位置'"), '两种文案')
  assert.ok(panel.includes('b.hidden = !P.memKey || (!n && !pos)'), '没记忆就隐藏')
  assert.ok(panel.includes('function resetMem(): void'), 'resetMem')
  assert.ok(panel.includes('P.secClosed.clear(); P.taskOpen.clear(); P.memScroll = null'), '清开合 + 位置')
  assert.ok(panel.includes('memDrop()'), '清存储')
  assert.ok(panel.includes('if (list) list.scrollTop = 0'), '回顶部')
  assert.ok(panel.includes("if (mem) { e.preventDefault(); resetMem(); return }"), '点胶囊恢复默认')
  assert.ok(css.includes('.qpn-mem { flex: none; display: inline-flex;'), '胶囊样式')
  assert.ok(css.includes('.qpn-mem[hidden] { display: none !important; }'), 'hidden 真隐藏')
})

test('v166 · 锚定：opts 有 trigger / place / cardId，定位用触发物（不是输入框）', () => {
  assert.ok(panel.includes('trigger?: HTMLElement'), 'trigger 选项')
  assert.ok(panel.includes('place?: HTMLElement'), 'place 选项')
  assert.ok(panel.includes('cardId?: string'), 'cardId 选项')
  assert.ok(panel.includes('const r = (ctx?.trigger ?? ctx?.place ?? P.anchor).getBoundingClientRect()'), '定位基准 = 按钮 / 信息卡 / 说明框')
  assert.ok(panel.includes("if (up >= Math.min(cap, 320)) { ht = Math.min(cap, up); top = Math.round(r.top - gap - ht) }"), '上方 10px + 高度自适应')
  assert.ok(panel.includes('if (up >= cap) top = Math.round(r.top - gap - cap)'), '对话框 / 知识卡保持 640')
  assert.ok(panel.includes('const left = Math.round(Math.max(pad, Math.min(r.right - wd, vw - wd - pad)))'), '右缘对齐 + 视口钳制')
})

test('v166 · 位置冻结：same 分支不再 pos()，只有 resize 才重排', () => {
  assert.ok(panel.includes('/* v166：这里故意不再 pos() —— 面板打开后位置冻结'), 'same 分支注释 + 不重排')
  assert.ok(panel.includes('window.addEventListener(\'resize\', relayout)'), '只有 resize 重排')
  assert.ok(panel.includes('function relayout(): void { pos(); measure(); syncScroll(); if (P.secEl && P.secRow) secPos(P.secRow) }'), 'resize 后几何也要重量（v179：分段列表跟着重定位）')
  assert.ok(panel.includes('paint()\n  /* v166：这里故意不再 pos()'), '同步分支末尾只有 paint（没有 pos）')
})

test('v166 · 滚动跟手：measure 用 offsetTop（避开入场动画 scale），滚动帧不读 rect', () => {
  assert.ok(panel.includes('function measure(): void'), 'measure')
  assert.ok(panel.includes('const lo = list.offsetTop'), 'offsetTop 量几何')
  assert.ok(panel.includes('const top = s.offsetTop - lo'), '分区内容坐标')
  assert.ok(panel.includes('g.tasks.push({ el: t, id: (t.dataset.k ?? \'\').slice(5), top: top + w.offsetTop + 1, wrapH: w.offsetHeight, stuck: null })'), '任务行 wrapper 顶 + 高')
  const sync = between(panel, 'function syncScroll(): void', 'function aimClear')
  assert.ok(sync.length > 100, '拿到 syncScroll 本体')
  assert.ok(!sync.includes('getBoundingClientRect'), '滚动帧里 0 次 getBoundingClientRect')
  const meas = between(panel, 'function measure(): void', 'function onScroll')
  assert.ok(!meas.includes('getBoundingClientRect'), 'measure 也不用 rect（动画 scale 会污染）')
  assert.ok(panel.includes('function onScroll(): void'), 'scroll 走 rAF 合并')
  assert.ok(panel.includes('if (g.stuck !== stuck) { g.stuck = stuck; g.head.classList.toggle(\'stuck\', stuck) }'), '只有值变化才写 class')
  assert.ok(!panel.includes('getBoundingClientRect().top - lr.top'), '不再逐行读 rect 算贴顶')
})

test('v166 · 快速定位两态：aim 描边（意图）+ on 实心（位置），无 900ms 锁', () => {
  assert.ok(!panel.includes('locLock'), '900ms 定位锁已删')
  assert.ok(panel.includes('P.aimKey = key') && panel.includes("b.classList.add('aim')"), '点击立刻描边')
  assert.ok(panel.includes('P.aimArm = () => { if (P.aimT) clearTimeout(P.aimT); P.aimT = window.setTimeout(aimClear, 140) }'), '滚停 140ms 收描边')
  assert.ok(panel.includes('if (P.aimArm) P.aimArm()'), '滚动中不断续期 aim')
  assert.ok(panel.includes('const target = Math.max(0, Math.round(g.top - 1))'), '落点 = 缓存分区顶 - 1')
  assert.ok(panel.includes('const want = cur.offsetLeft - Math.round((row.clientWidth - cur.offsetWidth) / 2)'), '定位条横向跟随用 offsetLeft（不 scrollIntoView）')
  assert.ok(css.includes('.qpn-lb.aim { border-color: var(--pm-brand-line); color: var(--pm-brand); }'), 'aim 样式')
})

test('v166 · 开合钉住：被点那行先记视口 y，重画后按差值补 scrollTop', () => {
  assert.ok(panel.includes('function pinned(sel: string, act: () => void): void'), 'pinned')
  assert.ok(panel.includes('const dy = Math.round(now.getBoundingClientRect().top - y0)'), '按差值补')
  assert.ok(panel.includes("pinned('.qpn-g[data-g=\"' + key + '\"]', () => {"), '类头开合走 pinned')
  assert.ok(panel.includes("pinned('.qpn-r.task[data-k=\"task:' + row.item.id + '\"]', () => {"), '任务行开合走 pinned')
  assert.ok(panel.includes('memWrite()\n    paint()'), '开合同时落盘记忆')
})

test('v166 · 调用点：qmenu 传卡片 id + 按钮锚点；dock 把被点的按钮交给 launch；任务说明传 cardId', () => {
  assert.ok(qmenu.includes('launch(trigger?: HTMLElement): void'), 'launch 接收按钮')
  assert.ok(qmenu.includes('this.trigger = trigger ?? null'), '记住按钮')
  assert.ok(qmenu.includes("this.trigger?.closest('.dpm-sic')"), '信息卡当 place')
  assert.ok(qmenu.includes('cardId: i.card.id'), '传 cardId')
  assert.ok(qmenu.includes('trigger: this.trigger ?? undefined') && qmenu.includes('place: place ?? undefined'), '传 trigger / place')
  assert.ok(dock.includes('this.quote.launch(t);'), 'dock 把被点的按钮传进去')
  assert.ok(goal.includes('cardId: c.card.id'), '任务说明 / 相关说明传 cardId')
  assert.ok(!/cardId/.test(rich), '知识卡正文（richnote 里的 kb 面板）不传 cardId → 不参与卡片记忆')
})

test('v166 · 原有口径没动：八类顺序 / 760×640 / 深蓝边框 / 镶金 / 键盘 / 两态贴顶', () => {
  assert.ok(qmenu.includes("key: 'task'") && qmenu.includes("key: 'sess'"), '八类还在')
  assert.ok(css.includes('width: 760px; height: 640px'), '760×640')
  assert.ok(css.includes('--qpn-line: #2d4f96'), '深蓝边框')
  assert.ok(css.includes('body[data-ds-dark-theme] .qpn { --qpn-line: #7b9bdd; }'), '深色提亮')
  assert.ok(css.includes('.qpn-r.gold .qpn-ic'), '镶金')
  assert.ok(panel.includes("if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return }"), 'Esc 只关面板')
  assert.ok(panel.includes("if (k === 'ArrowDown' || k === 'ArrowUp')"), '↑↓ 选择')
  assert.ok(css.includes('.qpn-g { position: sticky; top: -8px'), '类头贴顶')
  assert.ok(css.includes('.qpn-r.task { position: sticky; top: 36px'), '任务行贴顶')
})

test('v166 · prefers-reduced-motion 也管记忆胶囊的入场', () => {
  /* v172：文件末尾会继续追加新版的 reduced-motion 块 → 按「内容」找这一段，不按位置锁 */
  const seg = css.split('@media (prefers-reduced-motion: reduce)').find((s) => s.includes('.qpn-mem:not([hidden]) { animation: none; }')) ?? ''
  assert.ok(seg.includes('.qpn-mem:not([hidden]) { animation: none; }'), '胶囊入场关')
  assert.ok(seg.includes('.qpn { animation: none; }'), '面板入场关')
})

test('v166 · 版本号 0.64.0（历史条目）', () => {
  /* v169：当前版本已推进到 0.66.0（见 v169 用例），这条只锁「0.64.0 那次改动在 CHANGELOG 里」 */
  const ch = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8')
  assert.match(ch, /## 0\.64\.0/)
})
