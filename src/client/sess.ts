/**
 * v140–v142 任务关联会话：会话状态（宿主 uiSession.sessionStatus + 归档）→ 状态标签 / 关联下拉 / 新建会话 / 工作区定位高光。
 * 原型 = prototype/dsh-web-v142.html 的 v140js「2」段 + v141css 2(1) + v142css 1(1)(3)(4) + v142js wsPlan。
 * 只靠 index.ts 注入的 deps 读写数据；所有监听挂在 install() 返回的 dispose 上（卸载即净）。
 */
import { esc } from './icons.js'
import type { Card, Task } from './api.js'
import { ringEl } from './gtextra.js'

export type SessSt = 'run' | 'wait' | 'done' | 'idle' | 'arch'
export interface SessRow { id: string; title: string; updatedAt: number; archived: boolean }
export interface SessDeps {
  /** 会话当前状态（不存在 = null：胶囊不画，console 点名一次）。 */
  st(id: string): SessSt | null
  title(id: string): string
  /** 这张卡片关联的全部会话（活跃 + 已归档）。 */
  cardSessions(cardId: string): SessRow[]
  card(cardId: string): Card | null
  /** 打开会话 + 工作区定位高光（src = 'ws' 时不高光）。 */
  open(id: string): void
  /** 写 task.sess（'' = 取消关联）。 */
  link(cardId: string, taskId: string, sid: string): Promise<void>
  /** 以此卡片 / 任务新建会话（taskId 空 = 只关联卡片）。 */
  newFor(cardId: string, taskId: string): Promise<void>
  /** 工作区里定位 + 彩色高光这些会话行（返回真正亮了的会话 id）。 */
  reveal(ids: string[]): Promise<string[]>
  toast(m: string, k?: 'ok' | 'err'): void
  /** 宿主会话列表已经有数据了（没加载完时找不到会话不算「已删」）。 */
  listReady?(): boolean
  /** v151（4）：会话窗口正在展示时的当前会话 id（看板 / 日程页 = null）。 */
  shownSession?(): string | null
  /** v151（4）：切到这个会话（只换会话窗口，不打开别的面板）。 */
  switchTo?(id: string): void
}
let D: SessDeps | null = null
export const sessDeps = (): SessDeps | null => D

export const LB: Record<SessSt, string> = { run: '会话执行中', wait: '会话等待中', done: '会话完成输出', idle: '会话空闲中', arch: '会话已归档' }
const DESC: Record<SessSt, string> = { run: 'Agent 正在干活', wait: '需要你处理选项', done: 'Agent 已输出完，你还没看', idle: '你已经看过 / 还没开始对话', arch: '会话已归档' }
export const IC = {
  run: '<svg viewBox="0 0 24 24" class="spin" aria-hidden="true"><circle class="bg" cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 8 8"/></svg>',
  wait: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5h15v10.5h-8.5L6.2 19.4v-3.9H4.5z"/><path d="M10 9.1a2 2 0 1 1 2.9 1.8c-.6.3-.9.7-.9 1.3"/><path d="M12 14.3h.01"/></svg>',
  idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.6A7.3 7.3 0 1 1 9.4 5a5.9 5.9 0 0 0 9.6 9.6z"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5h15v10.5h-8.5L6.2 19.4v-3.9H4.5z"/><path d="m8.8 10.4 2.1 2.1 4.3-4.3"/></svg>',
  arch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="4" rx="1.5"/><path d="M6 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h10v7.5h-5.5L5.5 16v-3h-1z"/><path d="M15.5 10.5h4v7h-1v2.5l-3-2.5h-4.5v-2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5h11l-3-3M17 16.5H6l3 3"/></svg>',
  newc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5h12v9H9.5L5.5 17.8V14h-1z"/><path d="M18.5 13.5v6M15.5 16.5h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  up: '<svg class="up" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 14.5 5.5-5.5 5.5 5.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
}
const ago = (ms: number): string => { if (!ms) return '较早'; const s = (Date.now() - ms) / 1000; return s < 60 ? '刚刚' : s < 3600 ? Math.round(s / 60) + ' 分钟前' : s < 86400 ? Math.round(s / 3600) + ' 小时前' : Math.round(s / 86400) + ' 天前' }
const warned = new Set<string>()

/** 会话状态标签（v141 方角 + 左侧色块 + 「会话…中」；v142 悬停不长箭头）。会话不存在 = ''。 */
export function chipHtml(sid: string, o: { name?: boolean } = {}): string {
  if (!D || !sid) return ''
  const st = D.st(sid)
  /* 会话列表还没加载到 / 会话已删：先放一个空占位（同一个 data-dpm-schip），宿主列表一到 repaintChips 就原地补上；真不在了就一直空着 */
  if (!st) { if (!warned.has(sid) && D.listReady?.()) { warned.add(sid); console.warn('[dsh-project-manager] 任务关联的会话已经不在了：' + sid + '（胶囊不画）') } return '<span class="dpm-sst0" data-dpm-schip="' + esc(sid) + '" data-st="none"' + (o.name ? ' data-nm="1"' : '') + ' hidden></span>' }
  const name = D.title(sid)
  const nm = o.name ? '<span class="nm">' + esc(name) + '</span>' : ''
  const tip = '会话「' + name + '」' + LB[st] + '：' + DESC[st] + (st === 'arch' ? '（已归档的会话不能直接打开）' : ' · 点一下立即打开这个会话')
  if (st === 'arch') return '<span class="dpm-sst s-arch" data-dpm-schip="' + esc(sid) + '" data-st="arch"' + (o.name ? ' data-nm="1"' : '') + ' title="' + esc(tip) + '"><span class="ic">' + IC.arch + '</span><span class="lb">' + LB.arch + '</span>' + nm + '</span>'
  /* v143（2.1）：转圈 / 光带对齐同一个时钟 —— 每次重画都是新节点，动画用负延迟接上全局相位，不再从 0 开始（Agent 输出时一秒推好几次状态 = 看起来停住） */
  const ph = st === 'run' || st === 'done' ? ' style="--dpm-ph:-' + (performance.now() % 2400).toFixed(0) + 'ms"' : ''
  return '<button type="button" class="dpm-sst s-' + st + '" data-dpm-sopen="' + esc(sid) + '" data-dpm-schip="' + esc(sid) + '" data-st="' + st + '"' + (o.name ? ' data-nm="1"' : '') + ph + ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '"><span class="ic">' + IC[st] + '</span><span class="lb">' + LB[st] + '</span>' + nm + '</button>'
}
/* ═══ v155 · 项目卡（卡片级）的会话状态 ═══
   前提（和实施端同一条数据规则）：执行安排 / 计划清单只放最小层级 —— 项目有任务就只放任务卡，
   没拆任务的项目才放这张项目卡（gantt.ts pBuild，v122 1.5）。所以项目卡上的标签 = 这张卡片自己的会话：
   1 个会话 → 和任务卡完全一样（没有数字、点一下直接打开）；多个才汇总；
   一个都没有 → 虚线「无会话」（不冒充空闲、也不冒充已归档）。 */
export type AggSt = SessSt | 'none'
export interface Agg { st: AggSt; n: number; dist: Partial<Record<SessSt, number>>; total: number; live: number; also: number }
/** 优先级 = 谁最需要你：等待中 > 执行中 > 完成输出 > 空闲中 > 已归档（在跑的会自己跑，等待中的不会）。 */
const AGG_ORDER: SessSt[] = ['wait', 'run', 'done', 'idle', 'arch']
const AGG_ACTIVE: SessSt[] = ['wait', 'run', 'done']
const EMPTY_AGG: Agg = { st: 'none', n: 0, dist: {}, total: 0, live: 0, also: 0 }
export function aggOf(cid: string): Agg {
  if (!D || !cid) return EMPTY_AGG
  const rows = D.cardSessions(cid)
  const dist: Partial<Record<SessSt, number>> = {}
  let total = 0
  for (const r of rows) {
    const st = D.st(r.id)
    if (!st) continue
    total++
    dist[st] = (dist[st] ?? 0) + 1
  }
  const st: AggSt = AGG_ORDER.find((x) => (dist[x] ?? 0) > 0) ?? 'none'
  const also = AGG_ACTIVE.reduce((n, x) => n + (x === st ? 0 : (dist[x] ?? 0)), 0)
  return { st, n: dist[st as SessSt] ?? 0, dist, total, live: total - (dist.arch ?? 0), also }
}
function aggTip(name: string, a: Agg): string {
  if (!a.total) return '项目「' + name + '」还没有会话 · 在卡片详情里「以此卡片新建会话」'
  const lines = ['项目「' + name + '」' + (a.total === 1 ? '有 1 个会话' : '有 ' + a.total + ' 个会话')]
  if (a.total > 1) lines.push(AGG_ORDER.filter((x) => (a.dist[x] ?? 0) > 0).map((x) => LB[x] + ' ' + a.dist[x]).join(' · '))
  if (a.also) lines.push('其中 ' + a.also + ' 个在别的状态（标签只显示最需要你的那一个）')
  lines.push(!a.live ? '全部会话都已归档：先在卡片详情「已归档会话」里恢复活跃'
    : a.total === 1 ? '点一下立即打开这个会话'
      : '点一下 = 打开这个项目的会话列表（活跃在上，点一个直接打开）')
  return lines.join('\n')
}
/** 项目卡（卡片级）的会话状态标签：和任务卡同一套 .dpm-sst，多会话时多一个数字 / +N。 */
export function pchipHtml(cid: string): string {
  if (!D || !cid) return ''
  const a = aggOf(cid)
  const ready = D.listReady?.() !== false
  /* 会话列表还没加载到：先放空占位，repaintChips 原地补（和单会话胶囊同一套） */
  if (!a.total && !ready && D.cardSessions(cid).length) return '<span class="dpm-sst0" data-dpm-sagg="' + esc(cid) + '" data-st="none" hidden></span>'
  const name = D.card(cid)?.t ?? cid
  const tip = aggTip(name, a)
  if (!a.total) return '<span class="dpm-sst agg s-none" data-dpm-sagg="' + esc(cid) + '" data-st="none" title="' + esc(tip) + '"><span class="lb">无会话</span></span>'
  const cnt = a.n > 1 ? '<b class="cnt">' + a.n + '</b>' : ''
  const also = a.also ? '<b class="also">+' + a.also + '</b>' : ''
  if (a.st === 'arch') return '<span class="dpm-sst agg s-arch" data-dpm-sagg="' + esc(cid) + '" data-st="arch" title="' + esc(tip) + '"><span class="ic">' + IC.arch + '</span><span class="lb">' + LB.arch + '</span>' + cnt + '</span>'
  return '<button type="button" class="dpm-sst agg s-' + a.st + '" data-dpm-sagg="' + esc(cid) + '" data-st="' + a.st + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"><span class="ic">' + IC[a.st as SessSt] + '</span><span class="lb">' + LB[a.st as SessSt] + '</span>' + cnt + also + '</button>'
}
/** 点项目卡的状态标签：1 个会话 = 直接打开；多个 = 打开这个项目的会话列表（不替你盲选）。 */
function openProjSess(btn: HTMLElement, cid: string): void {
  if (!D) return
  const c = D.card(cid); if (!c) return
  const a = aggOf(cid)
  if (!a.total) { D.toast('项目「' + c.t + '」还没有会话：在卡片详情里「以此卡片新建会话」'); return }
  if (!a.live) { D.toast('项目「' + c.t + '」的会话都已归档：先在卡片详情「已归档会话」里恢复活跃'); return }
  if (a.total === 1) { const only = D.cardSessions(cid).find((r) => !r.archived); if (only && D.st(only.id)) { D.open(only.id); return } }
  openPicker(btn, { cid, browse: true, cur: '', self: false, what: '卡片', onPick: (sid) => { if (sid) D?.open(sid) }, onNew: () => { void D?.newFor(cid, '') } })
}

/** 详情任务 / 子任务卡第二行右侧：关联会话 / 状态标签 + 更换 + 新建会话（黑底）。v143（4B）：任务 / 子任务都不显示会话名（名字在悬停提示和气泡窗里），标签可缩、两颗按钮不缩。 */
export function tcHtml(cid: string, t: Task, sub: boolean, ro: boolean): string {
  const has = !!(t.sess && (D?.st(t.sess) || !D?.listReady?.()))
  const what = sub ? '子任务' : '任务'
  const key = esc(cid + '|' + (t.id ?? ''))
  const a = has
    ? chipHtml(t.sess as string, { name: false }) + (ro ? '' : '<button type="button" class="dpm-sib" data-dpm-slink="' + key + '" title="更换关联的会话" aria-label="更换「' + esc(t.text) + '」关联的会话" aria-haspopup="listbox">' + IC.swap + '</button>')
    : (ro ? '' : '<button type="button" class="dpm-slk" data-dpm-slink="' + key + '" title="关联卡片会话：从这张卡片的会话里选一个关联到这个' + what + '" aria-haspopup="listbox">' + IC.link + '关联会话</button>')
  /* v151（2.1）：已关联一个没归档的会话 = 不显示「以此新建会话」（黑色）；没关联 / 关联的已归档 = 显示 */
  const liveSess = has && D?.st(t.sess as string) !== 'arch'
  const nb = ro || liveSess ? '' : '<button type="button" class="dpm-sib dpm-snew" data-dpm-snew="' + key + '" title="以此' + what + '创建会话：新建一个会话，自动关联这张卡片和这个' + what + '" aria-label="以「' + esc(t.text) + '」创建会话">' + IC.newc + '</button>'
  return a || nb ? '<span class="dpm-stc">' + a + nb + '</span>' : ''
}
/** v151（2.1）：这个会话还在（列表里有、没归档）。列表没加载完时当作「在」（避免按钮闪出来又消失）。 */
export const sessLive = (sid?: string): boolean => !!sid && !!D && (D.st(sid) ? D.st(sid) !== 'arch' : !D.listReady?.())
/** v151（2.1）：卡片（项目）本身有没归档的会话。 */
export const cardLive = (cid: string): boolean => !!D && D.cardSessions(cid).some((s) => !s.archived && D?.st(s.id) !== 'arch')
/** 黑底「新建会话」小按钮（执行安排悬停按钮组 / 子任务小卡）。 */
export const newBtnHtml = (cid: string, tid: string, what: string, cls: string): string => '<button type="button" class="' + cls + ' dpm-snew" data-dpm-snew="' + esc(cid + '|' + tid) + '" title="' + esc('以此' + what + '创建会话：新建一个会话，自动关联这张卡片' + (tid ? '和这个' + what : '')) + '" aria-label="' + esc('以此' + what + '创建会话') + '">' + IC.newc + '</button>'

const flat = (c: Card): Array<{ t: Task; parent: Task | null }> => c.tasks.flatMap((t) => [{ t, parent: null as Task | null }, ...(t.subs ?? []).map((x) => ({ t: x, parent: t }))])
export const taskOf = (c: Card | null, tid: string): { t: Task; parent: Task | null } | null => (c ? flat(c).find((x) => x.t.id === tid) ?? null : null)

/* ── 关联下拉（详情 = 下拉，任务弹窗 = 上拉；放不下自动翻）── */
interface PickOpts { cid: string; cur: string; self: boolean; what: string; up?: boolean; noNew?: boolean; browse?: boolean; onPick(sid: string): void; onNew?(): void }
let pk: { el: HTMLElement; btn: HTMLElement } | null = null
export function pickClose(): void { if (!pk) return; pk.btn.setAttribute('aria-expanded', 'false'); pk.el.remove(); pk = null }
export const pickOpen = (): boolean => !!pk
export function openPicker(btn: HTMLElement, o: PickOpts): void {
  if (pk && pk.btn === btn) { pickClose(); return }
  pickClose()
  if (!D) return
  const c = D.card(o.cid); if (!c) return
  const by = (a: SessRow, b: SessRow): number => b.updatedAt - a.updatedAt
  const all = D.cardSessions(o.cid), live = all.filter((s) => !s.archived).sort(by), arc = all.filter((s) => s.archived).sort(by)
  const n0 = (sid: string): number => flat(c).filter((x) => x.t.sess === sid).length
  const row = (s: SessRow): string => {
    const st: SessSt = s.archived ? 'arch' : (D?.st(s.id) ?? 'idle'), on = o.cur === s.id
    const n = n0(s.id) - (on && o.self ? 1 : 0)
    return '<button type="button" class="dpm-spr' + (s.archived ? ' arch' : '') + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-dpm-spick="' + esc(s.id) + '"><span class="dpm-spi s-' + st + '">' + IC[st] + '</span><span class="tx"><b>' + esc(s.title) + '</b><small>' + LB[st] + ' · ' + ago(s.updatedAt) + (n > 0 ? ' · 另有 ' + n + ' 个任务关联' : '') + '</small></span>' + (on ? '<span class="ck">' + IC.check + '</span>' : '') + '</button>'
  }
  const el = document.createElement('div')
  el.className = 'dpm-spk'; el.setAttribute('role', 'listbox'); el.setAttribute('aria-label', '关联卡片会话')
  el.innerHTML = '<div class="dpm-spk-h"><b>' + (o.browse ? '项目会话' : '关联卡片会话') + '</b><small>' + (o.browse
    ? '「' + esc(c.t) + '」没拆任务 —— 所以它是面板里的项目卡；这些就是它自己的 ' + (live.length + arc.length) + ' 个会话 · 活跃在上、点一个直接打开'
    : '「' + esc(c.t) + '」的全部会话 · 活跃在上、最近更新的在上 · 一个会话只属于一张卡片：只能被这张卡片里的任务 / 子任务关联（可以多个），不能跨卡片') + '</small></div>'
    + '<div class="dpm-spk-b">' + (live.length ? '<div class="dpm-spk-g">活跃会话<i>' + live.length + '</i></div>' + live.map(row).join('') : '') + (arc.length ? '<div class="dpm-spk-g">已归档会话<i>' + arc.length + '</i></div>' + arc.map(row).join('') : '') + (live.length + arc.length ? '' : '<p class="dpm-spk-e">这张卡片还没有会话</p>') + '</div>'
    + '<div class="dpm-spk-f">' + (o.noNew ? '' : '<button type="button" class="dpm-spk-new" data-dpm-spknew>' + IC.newc + '以此' + esc(o.what) + '新建会话</button>') + (o.cur ? '<button type="button" class="dpm-spk-un" data-dpm-spkun>取消关联</button>' : '') + '</div>'
  ;(btn.closest('dialog[open]') ?? document.body).append(el)
  const r = btn.getBoundingClientRect(), W = el.offsetWidth, H = el.offsetHeight
  let up = !!o.up
  if (!up && r.bottom + 6 + H > innerHeight - 8 && r.top - 6 - H > 8) up = true
  if (up && r.top - 6 - H < 8) up = false
  el.classList.toggle('up', up)
  el.style.left = Math.round(Math.max(8, Math.min(innerWidth - W - 8, r.left))) + 'px'
  el.style.top = Math.round(up ? r.top - 6 - H : r.bottom + 6) + 'px'
  btn.setAttribute('aria-expanded', 'true')
  pk = { el, btn }
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const p = t.closest('[data-dpm-spick]') as HTMLElement | null
    if (p) { e.preventDefault(); e.stopPropagation(); const sid = p.dataset.dpmSpick as string; pickClose(); o.onPick(sid); return }
    if (t.closest('[data-dpm-spknew]')) { e.preventDefault(); e.stopPropagation(); pickClose(); o.onNew?.(); return }
    if (t.closest('[data-dpm-spkun]')) { e.preventDefault(); e.stopPropagation(); pickClose(); o.onPick('') }
  })
  setTimeout(() => { const f = (el.querySelector('.dpm-spr.on') ?? el.querySelector('.dpm-spr')) as HTMLElement | null; f?.focus({ preventScroll: true }) }, 20)
}

/* ── v151（4）点执行安排 / 计划清单的项目 / 任务 / 子任务 → 会话窗口切到对应会话（只在会话窗口正在展示时）──
   子任务（未完成）= 它的会话；任务（未完成）= 自己的会话 → 最上面的未完成子任务的会话；
   项目（未归档）= 项目自己的会话（卡片会话里没被任何任务 / 子任务关联的，列表最上面的）→ 最上面的未完成任务的会话 → 最上面的未完成子任务的会话。 */
export function pickSession(c: Card, kind: 'p' | 't' | 's', tid?: string): { sid?: string; src?: string; why?: string } {
  if (!D) return { why: '会话模块没就绪' }
  const live = (x?: string): string => (x && D?.st(x) && D.st(x) !== 'arch' ? x : '')
  if (kind === 's') { const f = taskOf(c, tid ?? ''); if (!f) return { why: '找不到这个子任务' }; if (f.t.done) return { why: '这个子任务已完成，会话窗口不切' }; return live(f.t.sess) ? { sid: f.t.sess, src: '子任务自己的会话' } : { why: '这个子任务没有关联会话' } }
  if (kind === 't') {
    const f = taskOf(c, tid ?? ''); if (!f) return { why: '找不到这个任务' }
    if (f.t.done) return { why: '这个任务已完成，会话窗口不切' }
    if (live(f.t.sess)) return { sid: f.t.sess, src: '任务自己的会话' }
    const x = (f.t.subs ?? []).find((y) => !y.done && live(y.sess))
    return x ? { sid: x.sess, src: '任务没关联会话 → 最上面的未完成子任务「' + x.text + '」的会话' } : { why: '这个任务和它的未完成子任务都没有关联会话' }
  }
  if (c.archivedAt) return { why: '这个项目已归档，会话窗口不切' }
  const linked = new Set(flat(c).map((x) => x.t.sess).filter(Boolean) as string[])
  const own = D.cardSessions(c.id).filter((r) => !r.archived && live(r.id) && !linked.has(r.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (own) return { sid: own.id, src: '项目自己的会话（列表最上面）' }
  const t1 = c.tasks.find((t) => !t.done && live(t.sess)); if (t1) return { sid: t1.sess, src: '项目没有自己的会话 → 最上面的未完成任务「' + t1.text + '」的会话' }
  for (const t of c.tasks) { if (t.done) continue; const x = (t.subs ?? []).find((y) => !y.done && live(y.sess)); if (x) return { sid: x.sess, src: '项目和任务都没关联会话 → 最上面的未完成子任务「' + x.text + '」的会话' } }
  return { why: '这个项目、它的未完成任务和子任务都没有关联会话' }
}
export function followSession(cid: string, kind: 'p' | 't' | 's', tid?: string): void {
  if (!D?.shownSession || !D.switchTo) return
  const cur = D.shownSession(); if (!cur) return
  const c = D.card(cid); if (!c) return
  const r = pickSession(c, kind, tid)
  ;(window as unknown as Record<string, unknown>).__dpmFollow = { cid, kind, tid: tid ?? '', ...r, at: Date.now() }
  if (!r.sid) { D.toast('会话窗口不切：' + r.why); return }
  if (r.sid === cur) return
  D.switchTo(r.sid)
  D.toast('会话窗口已切到「' + D.title(r.sid) + '」（' + r.src + '）')
}

/* ── v142（1.2）工作区高光规则：子任务 → 任务 → 卡片逐级回退；任务 = 任务 + 子任务；项目 = 卡片 + 全部任务 + 子任务 ── */
export type WsSrc = 'sub' | 'sub>task' | 'sub>card' | 'task' | 'task>card' | 'project'
export function wsPlan(c: Card, live: (sid: string) => boolean, cardLive: string[], kind: 'p' | 't' | 's', tid?: string): { src: WsSrc; sids: string[] } {
  const ok = (s?: string): string => (s && live(s) ? s : '')
  const uniq = (a: string[]): string[] => [...new Set(a.filter(Boolean))]
  if (kind === 's') {
    const f = taskOf(c, tid ?? '')
    if (f && ok(f.t.sess)) return { src: 'sub', sids: [f.t.sess as string] }
    if (f?.parent && ok(f.parent.sess)) return { src: 'sub>task', sids: [f.parent.sess as string] }
    return { src: 'sub>card', sids: uniq(cardLive) }
  }
  if (kind === 't') {
    const f = taskOf(c, tid ?? '')
    if (f && ok(f.t.sess)) return { src: 'task', sids: uniq([f.t.sess as string, ...(f.t.subs ?? []).map((x) => ok(x.sess))]) }
    return { src: 'task>card', sids: uniq(cardLive) }
  }
  return { src: 'project', sids: uniq([...cardLive, ...flat(c).map((x) => ok(x.t.sess))]) }
}
export const WS_SRC: Record<WsSrc, string> = { sub: '子任务自己的会话', 'sub>task': '子任务没关联会话 → 它所在任务的会话', 'sub>card': '子任务和任务都没关联会话 → 卡片的会话', task: '任务的会话', 'task>card': '任务没关联会话 → 卡片的会话', project: '项目 + 它的任务 + 子任务的会话' }
/** 点执行安排里的子任务 / 任务 / 项目 → 按规则在工作区高光（不打开会话）。 */
export async function wsHighlight(cid: string, kind: 'p' | 't' | 's', tid?: string): Promise<void> {
  if (!D) return
  const c = D.card(cid); if (!c) return
  const all = D.cardSessions(cid)
  const live = (sid: string): boolean => { const s = D?.st(sid); return !!s && s !== 'arch' }
  const plan = wsPlan(c, live, all.filter((s) => !s.archived).map((s) => s.id), kind, tid)
  const lit = plan.sids.length ? await D.reveal(plan.sids) : []
  ;(window as unknown as Record<string, unknown>).__dpmWs = { src: plan.src, sids: plan.sids, lit, at: Date.now() }
}
/** 侧栏会话行彩色高光（行要能定位，打上属性给 CSS）。 */
export function ringRow(row: HTMLElement): void {
  row.setAttribute('data-dpm-ring', '')
  ringEl(row, 0, true)
  setTimeout(() => row.removeAttribute('data-dpm-ring'), 1950)
}

/** 状态变了：所有画着状态标签的地方原地换（不重画外层）。 */
export function repaintChips(root: ParentNode = document): void {
  if (!D) return
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-dpm-schip], [data-dpm-sagg]'))) {
    /* v155：项目卡的聚合标签 —— 内容（状态 / 数字 / +N / 文案）真的变了才换，避免每帧重画 */
    const aggId = el.dataset.dpmSagg
    if (aggId) {
      const html = pchipHtml(aggId)
      const tmp = document.createElement('span'); tmp.innerHTML = html
      const n = tmp.firstElementChild as HTMLElement | null
      if (!n) { el.remove(); continue }
      if (n.dataset.st === el.dataset.st && (n.textContent ?? '') === (el.textContent ?? '')) continue
      el.replaceWith(n)
      continue
    }
    const sid = el.dataset.dpmSchip as string
    const st = D.st(sid)
    if (st === el.dataset.st) continue
    if ((st ?? 'none') === el.dataset.st) continue
    const html = chipHtml(sid, { name: el.dataset.nm === '1' })
    if (!html) { el.remove(); continue }
    const tmp = document.createElement('span'); tmp.innerHTML = html
    const n = tmp.firstElementChild as HTMLElement
    el.replaceWith(n)
  }
}

export function installSess(deps: SessDeps): () => void {
  D = deps
  const click = (e: MouseEvent): void => {
    const t = e.target as HTMLElement | null
    if (!t?.closest || !D) return
    /* v155：项目卡的状态标签（聚合）→ 1 个会话直接打开 / 多个打开项目会话列表 */
    const ag = t.closest('[data-dpm-sagg]') as HTMLElement | null
    if (ag) { e.preventDefault(); e.stopPropagation(); openProjSess(ag, ag.dataset.dpmSagg as string); return }
    const op = t.closest('[data-dpm-sopen]') as HTMLElement | null
    if (op) { e.preventDefault(); e.stopPropagation(); D.open(op.dataset.dpmSopen as string); return }
    const ln = t.closest('[data-dpm-slink]') as HTMLElement | null
    if (ln) {
      e.preventDefault(); e.stopPropagation()
      const [cid, tid] = (ln.dataset.dpmSlink as string).split('|')
      const f = taskOf(D.card(cid), tid); if (!f) return
      openPicker(ln, { cid, cur: f.t.sess ?? '', self: true, what: f.parent ? '子任务' : '任务', onPick: (sid) => void D?.link(cid, tid, sid), onNew: () => void D?.newFor(cid, tid) })
      return
    }
    const nw = t.closest('[data-dpm-snew]') as HTMLButtonElement | null
    if (nw) {
      e.preventDefault(); e.stopPropagation()
      if (nw.classList.contains('busy')) return
      const [cid, tid] = (nw.dataset.dpmSnew as string).split('|')
      nw.classList.add('busy'); nw.setAttribute('aria-busy', 'true')
      void D.newFor(cid, tid ?? '').finally(() => { nw.classList.remove('busy'); nw.removeAttribute('aria-busy') })
      return
    }
    if (t.closest('.dpm-sst.s-arch')) { e.preventDefault(); e.stopPropagation(); D.toast('已归档的会话不能直接打开：先在卡片详情「已归档会话」里恢复活跃') }
  }
  /* 按下悬停按钮组里的按钮时，别让「按下 = 收起悬停态 / 开始拖动」把按钮挪走 */
  const down = (e: PointerEvent): void => {
    const t = e.target as HTMLElement | null
    if (pk && t && !pk.el.contains(t) && !pk.btn.contains(t)) pickClose()
    if (t?.closest?.('[data-dpm-snew], [data-dpm-sopen], [data-dpm-slink]')) e.stopPropagation()
  }
  const key = (e: KeyboardEvent): void => {
    if (!pk) return
    const rows = Array.from(pk.el.querySelectorAll<HTMLElement>('.dpm-spr'))
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = pk.btn; pickClose(); try { b.focus() } catch { /* */ } return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const i = rows.indexOf(document.activeElement as HTMLElement); rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus() }
  }
  document.addEventListener('click', click, true)
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('keydown', key, true)
  return () => { document.removeEventListener('click', click, true); document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); pickClose(); D = null }
}
