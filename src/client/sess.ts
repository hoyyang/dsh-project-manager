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
  /** v175：写一组关联（顺序 = 代表会话在前；空数组 = 取消全部）。一个任务只能有一个活跃会话由宿主再校验一次。 */
  assoc?(cardId: string, taskId: string, ids: string[]): Promise<void>
  /** v175：归档 / 恢复这个会话（宿主会话级；返回是否真的做了）。 */
  archive?(sid: string): Promise<boolean>
  restore?(sid: string): Promise<boolean>
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
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  up: '<svg class="up" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 14.5 5.5-5.5 5.5 5.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
}
const ago = (ms: number): string => { if (!ms) return '较早'; const s = (Date.now() - ms) / 1000; return s < 60 ? '刚刚' : s < 3600 ? Math.round(s / 60) + ' 分钟前' : s < 86400 ? Math.round(s / 3600) + ' 小时前' : Math.round(s / 86400) + ' 天前' }
const warned = new Set<string>()

/** 会话状态标签（v141 方角 + 左侧色块 + 「会话…中」；v142 悬停不长箭头）。会话不存在 = ''。 */
export function chipHtml(sid: string, o: { name?: boolean; extra?: string } = {}): string {
  if (!D || !sid) return ''
  const st = D.st(sid)
  /* 会话列表还没加载到 / 会话已删：先放一个空占位（同一个 data-dpm-schip），宿主列表一到 repaintChips 就原地补上；真不在了就一直空着 */
  if (!st) { if (!warned.has(sid) && D.listReady?.()) { warned.add(sid); console.warn('[dsh-project-manager] 任务关联的会话已经不在了：' + sid + '（胶囊不画）') } return '<span class="dpm-sst0" data-dpm-schip="' + esc(sid) + '" data-st="none"' + (o.name ? ' data-nm="1"' : '') + ' hidden></span>' }
  const name = D.title(sid)
  const nm = o.name ? '<span class="nm">' + esc(name) + '</span>' : ''
  /* v175（§4.1）：多关联时 tooltip 写全「显示的是哪个会话 + 一共几个关联 + 活跃的是哪个 / 全归档时是最新对话那个」 */
  const tip = '会话「' + name + '」' + LB[st] + '：' + DESC[st] + (st === 'arch' ? '（已归档的会话不能直接打开）' : ' · 点一下立即打开这个会话') + (o.extra ? ' · ' + o.extra : '')
  /* extra 跟着节点走：状态变了 repaintChips 原地重画时还能把这段话带回去 */
  const xtra = o.extra ? ' data-dpm-x="' + esc(o.extra) + '"' : ''
  if (st === 'arch') return '<span class="dpm-sst s-arch" data-dpm-schip="' + esc(sid) + '" data-st="arch"' + (o.name ? ' data-nm="1"' : '') + xtra + ' title="' + esc(tip) + '"><span class="ic">' + IC.arch + '</span><span class="lb">' + LB.arch + '</span>' + nm + '</span>'
  /* v143（2.1）：转圈 / 光带对齐同一个时钟 —— 每次重画都是新节点，动画用负延迟接上全局相位，不再从 0 开始（Agent 输出时一秒推好几次状态 = 看起来停住） */
  const ph = st === 'run' || st === 'done' ? ' style="--dpm-ph:-' + (performance.now() % 2400).toFixed(0) + 'ms"' : ''
  return '<button type="button" class="dpm-sst s-' + st + '" data-dpm-sopen="' + esc(sid) + '" data-dpm-schip="' + esc(sid) + '" data-st="' + st + '"' + (o.name ? ' data-nm="1"' : '') + xtra + ph + ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '"><span class="ic">' + IC[st] + '</span><span class="lb">' + LB[st] + '</span>' + nm + '</button>'
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

/* ═══ v175：任务 / 子任务 ↔ 多个会话（活跃唯一） ═══
   口径 = docs/design-card-task-sessions-v175.md §二（R1–R10）+ §4.1–§4.3：
   - 关联是一组会话 id（Task.sess = 代表会话，Task.sessArch = 其余）；活跃（未归档）最多 1 个；
   - 代表会话算出来：活跃那个 / 全归档时最近对话最新的那个；
   - 行上 = 代表会话的胶囊 +（>1 个时）数量徽标 + 管理按钮；已归档卡片只显示胶囊。 */
export interface Assoc { ids: string[]; live: string[]; rep: string; total: number; rows: Map<string, SessRow> }
export function assocOf(c: Card | null, t: Task): Assoc {
  const ids: string[] = []
  for (const s of [t.sess, ...(t.sessArch ?? [])]) if (typeof s === 'string' && s && !ids.includes(s)) ids.push(s)
  const rows = new Map<string, SessRow>((c && D ? D.cardSessions(c.id) : []).map((r) => [r.id, r]))
  const ready = D?.listReady?.() !== false
  /* 会话已删（列表里没有）→ 不画；列表还没加载完 → 先当它在（免得胶囊先消失再出来） */
  const keep = ready ? ids.filter((sid) => rows.has(sid) || !!D?.st(sid)) : ids
  const st = (sid: string): SessSt | null => (D ? D.st(sid) : null)
  const live = keep.filter((sid) => st(sid) !== 'arch')
  const arc = keep.filter((sid) => st(sid) === 'arch')
  const ms = (sid: string): number => rows.get(sid)?.updatedAt ?? 0
  const rep = live[0] ?? arc.slice().sort((a, b) => ms(b) - ms(a))[0] ?? ''
  return { ids: keep, live, rep, total: keep.length, rows }
}
/** 关联的会话标题（拿不到就退回 id 前 8 位）。 */
const sessName = (sid: string): string => D?.title(sid) || sid.slice(0, 8)
/** 详情任务 / 子任务卡第二行右侧：代表会话胶囊（+ 数量徽标）+ 管理按钮 + 新建会话（黑底）。 */
export function tcHtml(cid: string, t: Task, sub: boolean, ro: boolean): string {
  const what = sub ? '子任务' : '任务'
  const key = esc(cid + '|' + (t.id ?? ''))
  const a = assocOf(D?.card(cid) ?? null, t)
  const nb = ro || a.live.length ? '' : '<button type="button" class="dpm-sib dpm-snew" data-dpm-snew="' + key + '" title="以此' + what + '创建会话：新建一个会话，自动关联这张卡片和这个' + what + '" aria-label="以「' + esc(t.text) + '」创建会话">' + IC.newc + '</button>'
  if (!a.total) {
    const lk = ro ? '' : '<button type="button" class="dpm-slk" data-dpm-slink="' + key + '" title="关联会话：这个' + what + '可以关联多个会话（同一时间只能有一个活跃会话）" aria-haspopup="dialog" aria-expanded="false">' + IC.link + '关联会话</button>'
    return lk || nb ? '<span class="dpm-stc">' + lk + nb + '</span>' : ''
  }
  /* v175（§4.1）：胶囊 tooltip 写全 —— 哪个会话 / 一共几个 / 活跃的是哪个（全归档 = 最近对话最新的那个） */
  const extra = a.total > 1
    ? (a.live.length
      ? '这个' + what + '一共关联 ' + a.total + ' 个会话，活跃的是「' + sessName(a.live[0]) + '」，其余 ' + (a.total - a.live.length) + ' 个已归档'
      : '这个' + what + '一共关联 ' + a.total + ' 个会话，全是归档会话：显示的是「最近对话最新」的那个')
    : ''
  const chip = chipHtml(a.rep, { name: false, extra })
  const cnt = a.total > 1 ? '<b class="dpm-scnt s-' + (D?.st(a.rep) ?? 'idle') + '" title="这个' + what + '一共关联了 ' + a.total + ' 个会话">' + a.total + '</b>' : ''
  const tip = '管理这个' + what + '关联的会话（' + a.total + ' 个：活跃 ' + a.live.length + ' · 归档 ' + (a.total - a.live.length) + '）'
  const mg = ro ? '' : '<button type="button" class="dpm-sib" data-dpm-slink="' + key + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '" aria-haspopup="dialog" aria-expanded="false">' + IC.swap + '</button>'
  return '<span class="dpm-stc">' + chip + cnt + mg + nb + '</span>'
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

/* ═══ v175 · 「关联会话」弹窗（详情任务 / 子任务行唯一入口） ═══
   500 宽 / 最高 620；两段 + 底栏；停在任务列表左边、尖尖（13×26）指着这一张卡；窄窗按可用宽收窄。 */
interface SP { el: HTMLElement; btn: HTMLElement | null; root: ParentNode; cid: string; tid: string }
let SP: SP | null = null
export const sessPanelOpen = (): boolean => !!SP
export function sessPanelClose(refocus = false): void {
  if (!SP) return
  const btn = SP.btn
  SP.el.remove()
  if (btn?.setAttribute) btn.setAttribute('aria-expanded', 'false')
  SP = null
  if (refocus && btn && document.contains(btn)) { try { btn.focus({ preventScroll: true }) } catch { /* */ } }
}
const spTask = (): { t: Task; parent: Task | null } | null => (SP && D ? taskOf(D.card(SP.cid), SP.tid) : null)
const spAnchor = (): HTMLElement | null => {
  if (!SP) return null
  if (SP.btn && document.contains(SP.btn)) return SP.btn
  const b = SP.root.querySelector('.task[data-tid="' + CSS.escape(SP.tid) + '"] [data-dpm-slink]') as HTMLElement | null
  if (b) SP.btn = b
  return b
}
const spTile = (): HTMLElement | null => (SP ? (SP.root.querySelector('.task[data-tid="' + CSS.escape(SP.tid) + '"]') as HTMLElement | null) : null)
/** 一个会话被这张卡片里几个任务 / 子任务关联（「另有 N 个」）。 */
const linkedCount = (c: Card, sid: string): number => flat(c).filter((x) => { const ids = [x.t.sess, ...(x.t.sessArch ?? [])]; return ids.includes(sid) }).length
/** 恢复这个会话会不会让某个任务出现两个活跃会话（v175 R5：会被挡，点名先归档哪个）。 */
function restoreBlock(c: Card, tid: string, sid: string): { text: string; other: string; sub: boolean; self: boolean } | null {
  for (const f of flat(c)) {
    const a = assocOf(c, f.t)
    if (!a.ids.includes(sid)) continue
    const other = a.live.find((x) => x !== sid)
    if (!other) continue
    return { text: f.t.text, other, sub: !!f.parent, self: f.t.id === tid }
  }
  return null
}
/** 被挡住时的那句话（点名先归档哪个会话；同一个任务就说「现在那个」）。 */
function restoreWhy(g: { text: string; other: string; sub: boolean; self: boolean }): string {
  return (g.self ? '先归档这个' + (g.sub ? '子任务' : '任务') + '现在那个活跃会话「' + sessName(g.other) + '」'
    : '先归档' + (g.sub ? '子任务' : '任务') + '「' + g.text + '」现在那个活跃会话「' + sessName(g.other) + '」') + '，才能把它恢复为活跃'
}
function spRow(c: Card, what: string, sid: string, o: { archived: boolean; mode: 'assoc' | 'avail'; off: boolean; offWhy?: string; block?: string | null }): string {
  const st: SessSt = o.archived ? 'arch' : (D?.st(sid) ?? 'idle')
  const row = D?.cardSessions(c.id).find((r) => r.id === sid)
  const ms = row?.updatedAt ?? 0
  const n = Math.max(0, linkedCount(c, sid) - 1)
  const meta = LB[st] + ' · ' + ago(ms) + (n ? ' · 另有 ' + n + ' 个任务也关联了它' : '')
  const name = esc(sessName(sid))
  if (o.mode === 'avail') {
    const off = o.off
    return '<button type="button" class="dpm-spn-r av' + (off ? ' off' : '') + '" data-spn-pick="' + esc(sid) + '"' + (off ? ' aria-disabled="true" title="这个' + what + '已经有活跃会话了：先归档它或取消关联，再来关联新的"' : ' title="关联这个会话到这个' + what + '"') + '>'
      + '<span class="dpm-spn-si s-' + st + '">' + IC[st] + '</span>'
      + '<span class="dpm-spn-t"><b>' + name + '</b><small>' + esc(meta) + '</small></span>'
      + (off ? '<span class="dpm-spn-k">' + IC.lock + '不可选</span>' : '<span class="dpm-spn-k">关联</span>') + '</button>'
  }
  const acts = o.archived
    ? '<button type="button" data-spn-restore="' + esc(sid) + '"' + (o.block ? ' aria-disabled="true" title="' + esc(o.block) + '" data-spn-why="' + esc(o.block) + '"' : ' title="恢复活跃：它还是这个' + what + '的关联会话，恢复后就是这里的活跃会话"') + '>恢复活跃</button>'
      + '<button type="button" class="u" data-spn-unlink="' + esc(sid) + '" title="取消关联（会话本身不受影响）">取消关联</button>'
    : '<button type="button" data-spn-open="' + esc(sid) + '" title="打开这个会话">打开</button>'
      + '<button type="button" data-spn-arch="' + esc(sid) + '" title="归档会话：它会从活跃会话变成归档会话（这个' + what + '的关联保留）">归档会话</button>'
      + '<button type="button" class="u" data-spn-unlink="' + esc(sid) + '" title="取消关联（会话本身不受影响）">取消关联</button>'
  return '<div class="dpm-spn-r' + (o.archived ? ' arch' : '') + '" data-row="' + esc(sid) + '">'
    + '<span class="dpm-spn-si s-' + st + '">' + IC[st] + '</span>'
    + '<span class="dpm-spn-t"><b>' + name + (o.archived ? '' : '<i class="dpm-spn-live">活跃</i>') + '</b><small>' + esc(meta) + '</small></span>'
    + '<span class="dpm-spn-a">' + acts + '</span></div>'
}
function spPaint(): void {
  if (!SP || !D) return
  const c = D.card(SP.cid); const f = spTask()
  if (!c || !f) { sessPanelClose(); return }
  const what = f.parent ? '子任务' : '任务'
  const a = assocOf(c, f.t)
  const liveAll = D.cardSessions(c.id).filter((s) => !s.archived && D?.st(s.id) !== 'arch').sort((x, y) => y.updatedAt - x.updatedAt)
  const avail = liveAll.filter((s) => !a.ids.includes(s.id))
  const hasLive = a.live.length > 0
  const sc = (SP.el.querySelector('.dpm-spn-b') as HTMLElement | null)?.scrollTop ?? 0
  const head = '<div class="dpm-spn-h"><span class="dpm-spn-hi">' + IC.link + '</span>'
    + '<div class="dpm-spn-ht"><b>关联会话</b><small>' + esc(what + '「' + f.t.text + '」· ' + a.total + ' 个关联（活跃 ' + a.live.length + ' · 归档 ' + (a.total - a.live.length) + '）') + '</small></div>'
    + '<button type="button" class="dpm-spn-x" data-spn-x aria-label="关闭关联会话窗口" title="关闭（Esc）">' + IC.x + '</button></div>'
  const aRows = a.ids.length
    ? [...a.live, ...a.ids.filter((sid) => !a.live.includes(sid)).sort((x, y) => (a.rows.get(y)?.updatedAt ?? 0) - (a.rows.get(x)?.updatedAt ?? 0))]
      .map((sid) => {
        const g = D?.st(sid) === 'arch' ? restoreBlock(c, SP?.tid ?? '', sid) : null
        return spRow(c, what, sid, { archived: D?.st(sid) === 'arch', mode: 'assoc', off: false, block: g ? restoreWhy(g) : null })
      }).join('')
    : '<div class="dpm-spn-empty">这个' + what + '还没有关联会话 —— 从下面挑一个活跃会话，或者点底部「以此' + what + '新建会话」。</div>'
  const hint = hasLive
    ? '<p class="dpm-spn-note">这个' + what + '已经有活跃会话「' + esc(sessName(a.live[0])) + '」—— <b>一个任务只能有一个活跃会话</b>：先把上面那个「归档会话」或「取消关联」，才能再关联新的。</p>'
    : ''
  const avRows = avail.map((s) => spRow(c, what, s.id, { archived: false, mode: 'avail', off: hasLive })).join('')
  const avEmpty = avail.length ? '' : '<div class="dpm-spn-empty">' + (liveAll.length ? '这张卡片的活跃会话都已经关联给它了。' : '这张卡片现在没有活跃会话可以关联。') + '</div>'
  const body = SP.el.querySelector('.dpm-spn-b') as HTMLElement | null
  SP.el.innerHTML = '<div class="dpm-spn-in">' + head
    + '<div class="dpm-spn-b">'
    + '<section class="dpm-spn-sec"><div class="dpm-spn-sh"><b>已关联</b><i>' + a.total + '</i><small>' + (a.total ? '活跃 ' + a.live.length + ' · 归档 ' + (a.total - a.live.length) : '还没有关联') + '</small></div>' + aRows + '</section>'
    + '<section class="dpm-spn-sec"><div class="dpm-spn-sh"><b>可关联的活跃会话</b><i>' + avail.length + '</i><small>这张卡片的活跃会话</small></div>' + hint + avEmpty + avRows + '</section>'
    + '</div>'
    + '<div class="dpm-spn-f"><button type="button" class="dpm-spn-new" data-spn-new' + (hasLive ? ' aria-disabled="true" title="这个' + what + '已经有活跃会话了：先归档或取消关联现在那个，再新建会话（一个任务只能有一个活跃会话）"' : '') + '>' + IC.newc + '以此' + what + '新建会话</button>'
    + '<span class="dpm-spn-sum">一个任务只关联一个活跃会话</span>'
    + '<button type="button" class="dpm-spn-done" data-spn-x>完成</button></div></div>'
    + '<i class="dpm-spn-tail r" aria-hidden="true"></i>'
  const b2 = SP.el.querySelector('.dpm-spn-b') as HTMLElement | null
  if (b2) b2.scrollTop = sc
  else if (body) body.scrollTop = sc
}
function spPlace(): void {
  if (!SP) return
  const el = SP.el
  const tile = spTile()
  const btn = spAnchor() ?? tile
  if (!tile || !btn) return
  /* 详情被切走 / 收起（任务行不在屏幕上）→ 弹窗跟着收起，不悬空指着空气 */
  if (!tile.getClientRects().length) { sessPanelClose(); return }
  const inner = el.querySelector('.dpm-spn-in') as HTMLElement | null
  const tail = el.querySelector('.dpm-spn-tail') as HTMLElement | null
  /* 先清掉上一次的收窄宽度：否则窗口变宽回来弹窗会一直停在窄版（量到的 W 只会越来越小） */
  el.style.width = ''
  let W = el.offsetWidth || 500
  let H = (inner ? inner.offsetHeight : 0) || el.offsetHeight || 400
  const clampY = (y: number): number => Math.max(8, Math.min(innerHeight - H - 8, y))
  const head = (tile.querySelector(':scope > .tkhead') as HTMLElement | null) ?? tile
  const hr = head.getBoundingClientRect()
  const cy = Math.min(Math.max(hr.top + hr.height / 2, 26), innerHeight - 26)
  const dir = (d: string, x: number, y: number): void => {
    if (!tail) return
    tail.className = 'dpm-spn-tail ' + d
    el.style.setProperty('--spn-y', Math.round(y) + 'px')
    el.style.setProperty('--spn-x', Math.round(x) + 'px')
  }
  /* 贴在任务列表的统一左缘（子任务卡片往里缩，用它自己的左缘会把弹窗压到父卡片上） */
  const outer = (tile.closest('.task[data-lv="0"]') as HTMLElement | null) ?? tile
  const listLeft = Math.round(outer.getBoundingClientRect().left)
  const room = Math.round(listLeft - 8 - 15)
  if (room >= 360) {
    if (room < W) { W = room; el.style.width = W + 'px'; H = (inner ? inner.offsetHeight : 0) || H }
    const left = Math.round(listLeft - W - 15)
    const top = clampY(Math.round(cy - H / 2))
    el.style.left = left + 'px'; el.style.top = top + 'px'
    dir('r', 0, Math.max(20, Math.min(H - 22, Math.round(cy - top - 13))))
    return
  }
  /* 左边放不下（窄窗）：贴视口最近的一侧，尖尖方向按按钮在弹窗哪一侧现算 */
  const r = btn.getBoundingClientRect()
  const bCx = r.left + r.width / 2, bCy = r.top + r.height / 2
  const cl = (v: number, a2: number, b3: number): number => Math.max(a2, Math.min(b3, v))
  const left = Math.round(cl(bCx - W / 2, 8, Math.max(8, innerWidth - W - 8)))
  const top = Math.round(r.bottom + 9 + H <= innerHeight - 8 ? r.bottom + 9 : r.top - 9 - H >= 8 ? r.top - 9 - H : clampY(bCy - H / 2))
  el.style.left = left + 'px'; el.style.top = top + 'px'
  const tl = (v: number, len: number): number => Math.round(cl(v, 20, len - 42))
  if (bCy <= top + 2) dir('u', tl(bCx - left - 13, W), 0)
  else if (bCy >= top + H - 2) dir('d', tl(bCx - left - 13, W), 0)
  else if (bCx <= left + 2) dir('r', 0, tl(bCy - top - 13, H))
  else dir('l', 0, tl(bCy - top - 13, H))
}
async function spAct(fn: () => Promise<void> | void): Promise<void> {
  try { await fn() } finally { if (SP) { spPaint(); spPlace() } }
}
export function openSessPanel(btn: HTMLElement, cid: string, tid: string): void {
  if (SP && SP.btn === btn) { sessPanelClose(true); return }
  sessPanelClose()
  if (!D) return
  const c = D.card(cid); if (!c) return
  const el = document.createElement('div')
  el.className = 'dpm-spn'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '关联会话')
  el.tabIndex = -1
  document.body.append(el)
  SP = { el, btn, root: (btn.closest('.detail') as ParentNode | null) ?? document, cid, tid }
  spPaint(); spPlace()
  btn.setAttribute('aria-expanded', 'true')
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (!SP) return
    if (t.closest('[data-spn-x]')) { e.preventDefault(); sessPanelClose(true); return }
    const nw = t.closest('[data-spn-new]') as HTMLElement | null
    if (nw) {
      e.preventDefault()
      /* v175 R2：已经有活跃关联 → 不允许再新建（否则新会话关联会被宿主拒绝，白建一个孤儿会话） */
      if (nw.getAttribute('aria-disabled') === 'true') return
      const { cid: c2, tid: t2 } = SP; sessPanelClose(); void D?.newFor(c2, t2); return
    }
    const pick = t.closest('[data-spn-pick]') as HTMLElement | null
    if (pick) { e.preventDefault(); if (pick.getAttribute('aria-disabled') === 'true') return; const sid = pick.dataset.spnPick as string; void spAct(() => D?.assoc?.(SP?.cid ?? '', SP?.tid ?? '', [sid, ...assocOf(D?.card(SP?.cid ?? '') ?? null, spTask()?.t ?? { text: '', done: true }).ids.filter((x) => x !== sid)]) ?? Promise.resolve()); return }
    const un = t.closest('[data-spn-unlink]') as HTMLElement | null
    if (un) { e.preventDefault(); const sid = un.dataset.spnUnlink as string; const s = SP; void spAct(() => D?.assoc?.(s.cid, s.tid, assocOf(D?.card(s.cid) ?? null, spTask()?.t ?? { text: '', done: true }).ids.filter((x) => x !== sid)) ?? Promise.resolve()); return }
    const ar = t.closest('[data-spn-arch]') as HTMLElement | null
    if (ar) { e.preventDefault(); const sid = ar.dataset.spnArch as string; void spAct(() => D?.archive?.(sid).then(() => undefined) ?? Promise.resolve()); return }
    const rs = t.closest('[data-spn-restore]') as HTMLElement | null
    if (rs) {
      e.preventDefault()
      /* v175（§4.4）：被挡的恢复 —— 点了不写数据，但要把「先归档哪个」说出来（只靠 title 在键盘 / 触屏上等于没提示） */
      if (rs.getAttribute('aria-disabled') === 'true') {
        const why = rs.dataset.spnWhy || ''
        D?.toast('不能恢复「' + sessName(rs.dataset.spnRestore as string) + '」：' + why, 'err')
        return
      }
      const sid = rs.dataset.spnRestore as string
      void spAct(() => D?.restore?.(sid).then(() => undefined) ?? Promise.resolve())
      return
    }
    const op2 = t.closest('[data-spn-open]') as HTMLElement | null
    if (op2) { e.preventDefault(); D?.open(op2.dataset.spnOpen as string); sessPanelClose(); return }
  })
  setTimeout(() => { try { el.focus({ preventScroll: true }) } catch { /* */ } }, 20)
}
/* 跟随：滚详情 / 改窗口 / 列宽重算 / 锚点被重建（详情整块重画）都要重算位置 */
let spT = 0
const spAgain = (): void => {
  if (!SP) return
  spAnchor(); spPaint(); spPlace()
  requestAnimationFrame(() => { if (SP) spPlace() })
  clearTimeout(spT); spT = window.setTimeout(() => { if (SP) { spAnchor(); spPlace() } }, 120)
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
    const html = chipHtml(sid, { name: el.dataset.nm === '1', extra: el.dataset.dpmX || undefined })
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
      /* v175：任务 / 子任务行 → 大的管理弹窗（多关联 + 归档 / 恢复 / 取消都在里面）；任务弹窗里的选择器仍用旧的 openPicker */
      openSessPanel(ln, cid, tid)
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
    if (SP && t && !SP.el.contains(t) && !(SP.btn && SP.btn.contains(t))) sessPanelClose()
    if (t?.closest?.('[data-dpm-snew], [data-dpm-sopen], [data-dpm-slink]')) e.stopPropagation()
  }
  const key = (e: KeyboardEvent): void => {
    if (SP && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sessPanelClose(true); return }
    if (!pk) return
    const rows = Array.from(pk.el.querySelectorAll<HTMLElement>('.dpm-spr'))
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = pk.btn; pickClose(); try { b.focus() } catch { /* */ } return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const i = rows.indexOf(document.activeElement as HTMLElement); rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus() }
  }
  /* v175：弹窗跟随（滚动 / 改窗口 / 列宽重算）；详情整块重画后也要重找锚点 */
  const follow = (): void => { if (SP) spAgain() }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => follow()) : null
  const watched = new WeakSet<Element>()
  const watchRoot = (): void => {
    if (!ro || !SP) return
    const r = SP.root instanceof Element ? SP.root : document.body
    if (watched.has(r)) return
    watched.add(r); ro.observe(r)
  }
  const followScroll = (): void => { if (!SP) return; watchRoot(); spPlace() }
  document.addEventListener('click', click, true)
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('keydown', key, true)
  document.addEventListener('scroll', followScroll, true)
  window.addEventListener('resize', follow)
  return () => {
    document.removeEventListener('click', click, true); document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true)
    document.removeEventListener('scroll', followScroll, true); window.removeEventListener('resize', follow)
    ro?.disconnect(); clearTimeout(spT)
    sessPanelClose(); pickClose(); D = null
  }
}
