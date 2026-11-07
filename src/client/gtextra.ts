/**
 * v127–v132：新增 / 编辑任务弹窗的附件（截止日期选择器 / 生成标题模型下拉 / 白底说明框 / 状态胶囊 / 排今天开关），
 * 详情页也复用状态胶囊、截止标签和排今天开关（同一个本机状态）。原型 = prototype/dsh-web-v132.html 的 v7–v12 段。
 */
import { esc } from './icons.js'
import { getGantt, post, postGantt } from './api.js'
import type { GanttData, GanttPanelDay, Task } from './api.js'

/* ── 分区名（与执行安排同一份）── */
export const ZT: Record<string, string> = { run: '执行中', wait: '等外部进展', pause: '个人暂停', arr: '已安排', un: '未安排', done: '本日已执行', '': '未计划' }
export const ZORD = ['run', 'wait', 'pause', 'arr', 'un', 'done']
/** 父任务 / 项目 = 子项里最靠前的分区。 */
export const pickZone = (zs: string[]): string => ZORD.find((z) => zs.includes(z)) ?? ''
export function stHtml(z: string, attrs: string): string {
  const lab = z ? '今天在「' + ZT[z] + '」分区 · 点一下跳到今天的任务面板并定位这张任务项卡片' : '今天还没排进任务执行安排 · 点一下打开今天的任务面板'
  return '<button type="button" class="v7st" ' + attrs + ' data-z="' + (z || 'none') + '" aria-label="' + esc('执行状态：' + ZT[z] + '。' + lab) + '"><i aria-hidden="true"></i><span>' + ZT[z] + '</span></button>'
}

/* ── 今天面板的本机缓存（SchedView 每次拿到快照 / 排今天之后刷新）：弹窗与详情的状态胶囊同步读 ── */
let PC: { today: string; panel: GanttPanelDay | null } | null = null
const firePanel = (): void => { queueMicrotask(() => window.dispatchEvent(new Event('dpm-panel'))) }
export function setPanelCache(d: GanttData): void { PC = { today: d.today, panel: d.panels?.[d.today] ?? null }; firePanel() }
/** 今天面板本地改动（SchedView 每次写盘）同步进缓存，详情 / 弹窗的状态胶囊立刻跟着变。 */
export function setPanelToday(key: string, p: Record<string, unknown>): void { if (PC && PC.today === key) { PC.panel = p as GanttPanelDay; firePanel() } }
/** 通知今天面板从服务端重读（详情里改了执行记录 / 排今天之后）。 */
export const panelDirty = (force = false): void => { window.dispatchEvent(new CustomEvent('dpm-panel-dirty', { detail: { force } })) }
/** v127（3）：任何地方勾完成 = 自动记录执行 —— 只处理今天面板里有、还没记过的 key；返回记上的个数。 */
/** v143（1.2）：详情勾完成 → 记录执行在途时，执行安排的 4s 轮询拿到的旧快照不能把今天的 done 整份换回去（回包前 PDAY.clear） */
let recBusy = 0
export const recInFlight = (): boolean => recBusy > 0
export async function recordDone(keys: string[]): Promise<number> {
  recBusy++
  /* 写好后再护 1.5s：写之前已经发出、写之后才回来的那次轮询带的是旧 done。
     护着期间到的快照只换了 rev、没换面板状态 → 结束时必须整份重拉（带 rev 会被判「没变」跳过，执行安排停在旧分区） */
  try { return await recordDone0(keys) } finally { setTimeout(() => { recBusy = Math.max(0, recBusy - 1); if (!recBusy) panelDirty(true) }, 1500) }
}
async function recordDone0(keys: string[]): Promise<number> {
  const d = await getGantt()
  const day = d.today
  const u = (d.panels?.[day] ?? {}) as GanttPanelDay
  const sel = new Set(u.sel ?? []), done = new Set(u.done ?? [])
  /* v141：子任务键在面板里不单独选中 —— 它的任务排了今天就算（任务卡里那个子任务小卡记执行） */
  const tOf = (k: string): string => { if (!k.startsWith('s|')) return k; const p = k.split('|'); for (const c of d.cards) if (c.id === p[1]) for (const t of c.tasks ?? []) if (t.subs.some((x) => x.id === p[2])) return 't|' + p[1] + '|' + t.id; return k }
  const ks = keys.filter((k) => (sel.has(k) || sel.has(tOf(k))) && !done.has(k))
  if (!ks.length) { setPanelCache(d); return 0 }
  const pst: Record<string, string> = { ...(u.pst ?? {}) }, from: Record<string, string> = { ...(u.from ?? {}) }, doneAt: Record<string, number> = { ...(u.doneAt ?? {}) }
  for (const k of ks) { from[k] = pst[k] ?? ((u.lanes ?? []).some((l) => l.includes(k)) ? 'arr' : 'un'); done.add(k); delete pst[k]; doneAt[k] = Date.now() }
  const r = await postGantt('panel', { day, sel: [...sel], done: [...done], pst, from, doneAt })
  if (r.gantt) setPanelCache(r.gantt)
  /* 执行安排里那颗「记录执行」按下动画闪一下（重画后再找） */
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('dpm-rec-flash', { detail: { keys: ks } })))
  return ks.length
}
export const panelCached = (): boolean => !!PC
/** 今天面板缓存（只读）。 */
export const panelToday = (): GanttPanelDay | null => PC?.panel ?? null
/* ── v129（3）/ v131（1）：多彩高光（详情任务卡 / 整个详情 / 甘特目录格；金色留给执行安排）。delay = 已经过去的毫秒（重画后接着同一拍走） ── */
export function ringEl(el: HTMLElement, delay = 0, glow = true): void {
  for (const o of Array.from(el.querySelectorAll(':scope > .v9ring'))) o.remove()
  /* v133 R2：不再 getComputedStyle（点击里强制样式重算 37–48ms@4x）—— 三处调用的目标（甘特目录格 sticky、详情 / 任务卡 / 子任务 relative）都已定位 */
  const r = document.createElement('span'); r.className = 'v9ring'; r.setAttribute('aria-hidden', 'true'); r.innerHTML = '<i></i><s></s>'
  r.style.setProperty('--v9d', -delay + 'ms')
  el.appendChild(r)
  /* v133 R2：新画出来的节点没有 v9glow，直接加；只有重播时才需要强制重排一次 */
  if (glow) { el.style.setProperty('--v9d', -delay + 'ms'); if (el.classList.contains('v9glow')) { el.classList.remove('v9glow'); void el.offsetWidth } el.classList.add('v9glow') }
  setTimeout(() => { r.remove(); el.classList.remove('v9glow') }, Math.max(0, 1900 - delay))
}
/* ── v127（8）/ v128（7）：详情 → 今天的任务执行安排拖动。详情和日程页是两个 BoardView，日程页把落点能力登记在这里 ── */
export interface XSched {
  /** 今天面板开着（日程页可见 + 面板打开）才接受拖入 */
  open(): boolean
  /** 指针在今天面板上（抓手 / 标题拖动进来 = 自动切成「排进执行安排」） */
  near(x: number, y: number): boolean
  /** 指针下的分区（落在执行安排卡片空白处 = 未安排） */
  hit(x: number, y: number): { z: string; el: HTMLElement } | null
  /** keys 里已经排进这一天的 */
  has(keys: string[]): string[]
  zone(keys: string[]): string
  seek(keys: string[]): void
  body(): HTMLElement | null
  place(cardId: string, keys: string[], zone: string, title: string): void
}
let XSv: XSched | null = null
export const getXS = (): XSched | null => XSv
export function setXS(x: XSched | null, owner?: XSched): void { if (x || !owner || XSv === owner) XSv = x }
/** 一条任务在今天面板里的 key（只放最小层级：有子任务 = 子任务们）。 */
/* v141（1.1）：执行安排只认任务键（有子任务的任务 = 一张「任务 + 子任务」卡）；子任务只有「记录执行」用自己的键。
   sub = true 时返回子任务自己的键（记录执行 / 状态胶囊读执行记录用）。 */
export function taskKeys(cid: string, t: Task, sub: boolean): string[] {
  if (sub) return ['s|' + cid + '|' + t.id]
  return ['t|' + cid + '|' + t.id]
}
/** 子任务在今天面板里的位置跟着它的任务走。 */
export const subParentKey = (cid: string, parentId: string): string => 't|' + cid + '|' + parentId
export function cardKeys(cid: string, tasks: Task[]): string[] { const ks = tasks.flatMap((t) => taskKeys(cid, t, false)); return ks.length ? ks : ['p|' + cid] }
/** keys 今天所在的分区（多项取最靠前的；'' = 没排今天）。 */
export function zoneOfKeys(keys: string[]): string {
  const u = PC?.panel
  if (!u) return ''
  /* v141：[子任务键, 任务键] = 子任务自己记过执行 → 本日已执行；否则看它的任务 */
  if (keys.length === 2 && keys[0].startsWith('s|') && keys[1].startsWith('t|')) return u.done?.includes(keys[0]) ? 'done' : zoneOfKeys([keys[1]])
  const zs = keys.map((k) => u.done?.includes(k) ? 'done' : (u.pst?.[k] as string | undefined) ?? ((u.lanes ?? []).some((l) => l.includes(k)) ? 'arr' : (u.sel ?? []).includes(k) ? 'un' : '')).filter(Boolean)
  return pickZone(zs)
}

/** v127：排今天（不切页面）：今天没有计划条先补上，再把 keys 加进今天的选中集合（= 「未安排」+ 本日计划清单）。 */
export async function scheduleKeys(cardId: string, keys: string[]): Promise<{ planAdded: boolean }> {
  const d = await getGantt()
  const day = d.today
  let planAdded = false
  if (!(d.cards.find((c) => c.id === cardId)?.plan ?? []).includes(day)) { planAdded = true; await postGantt('plan', { card: cardId, day, on: true }) }
  const sel = new Set([...(d.panels?.[day]?.sel ?? []), ...keys])
  const r = await postGantt('panel', { day, sel: [...sel] })
  if (r.gantt) setPanelCache(r.gantt)
  return { planAdded }
}

/* ── v145（1.1）/ v146：会话开始工作 → 关联的任务 / 子任务（= 父任务卡）/ 没有任务的卡片（= 项目卡）今天一起进「执行中」──
   一次写完：今天没计划条先补上；排今天（sel）；从未安排 / 已安排 / 个人暂停 / 等外部挪进执行中（zl.run + pst=run）；本日已执行不动；
   甘特今天的实际条走已有的「会话自动记实际」。有任务的卡片、会话只挂在卡片上没挂任务 → 不动（不知道是哪个任务在做）。
   返回挪动了的 { key, cardId, title, was }；写完广播 dpm:sess-run（各面板按它把卡放到位、闪一下）。 */
export type RunHit = { key: string; cardId: string; title: string; via?: string; was: string }
export function runKeysFor(cards: Array<{ id: string; t: string; tasks?: Task[] }>, sid: string, cardSess: (cid: string) => string[]): Array<Omit<RunHit, 'was'>> {
  const out: Array<Omit<RunHit, 'was'>> = []
  const seen = new Set<string>()
  for (const c of cards) {
    const ts = c.tasks ?? []
    for (const t of ts) {
      const k = 't|' + c.id + '|' + t.id
      if (t.sess === sid && !seen.has(k)) { seen.add(k); out.push({ key: k, cardId: c.id, title: t.text }) }
      for (const s of t.subs ?? []) if (s.sess === sid && !seen.has(k)) { seen.add(k); out.push({ key: k, cardId: c.id, title: s.text, via: t.text }) }
    }
    if (!ts.length && cardSess(c.id).includes(sid)) { const k = 'p|' + c.id; if (!seen.has(k)) { seen.add(k); out.push({ key: k, cardId: c.id, title: c.t }) } }
  }
  return out
}
let runChain: Promise<unknown> = Promise.resolve()
export function runForSession(sid: string, find: (d: GanttData) => Array<Omit<RunHit, 'was'>>): Promise<RunHit[]> {
  const job = runChain.then(async () => {
    const d = await getGantt()
    const day = d.today
    const hits0 = find(d)
    if (!hits0.length) return []
    const u = (d.panels?.[day] ?? {}) as GanttPanelDay & { zl?: Record<string, string[][]> }
    const done = new Set(u.done ?? [])
    const pst: Record<string, string> = { ...(u.pst ?? {}) }
    const hits: RunHit[] = []
    for (const h of hits0) {
      if (done.has(h.key) || pst[h.key] === 'run') continue
      const was = pst[h.key] ?? ((u.lanes ?? []).some((l) => l.includes(h.key)) ? 'arr' : (u.sel ?? []).includes(h.key) ? 'un' : '')
      hits.push({ ...h, was })
    }
    if (!hits.length) return []
    for (const cid of [...new Set(hits.map((h) => h.cardId))]) if (!(d.cards.find((c) => c.id === cid)?.plan ?? []).includes(day)) await postGantt('plan', { card: cid, day, on: true })
    const ks = new Set(hits.map((h) => h.key))
    const sel = [...new Set([...(u.sel ?? []), ...ks])]
    const lanes = (u.lanes ?? []).map((l) => l.filter((k) => !ks.has(k))).filter((l) => l.length)
    const zl0 = u.zl ?? {}
    const zl: Record<string, string[][]> = {}
    for (const z of ['pause', 'wait', 'run', 'un']) zl[z] = (zl0[z] ?? []).map((l) => l.filter((k) => !ks.has(k))).filter((l) => l.length)
    const add = [...ks]
    if (zl.run.length) zl.run[zl.run.length - 1].push(...add); else zl.run.push(add)
    for (const k of ks) pst[k] = 'run'
    const r = await postGantt('panel', { day, sel, lanes, zl, pst })
    if (r.gantt) setPanelCache(r.gantt)
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('dpm:sess-run', { detail: { sid, hits } })))
    return hits
  })
  runChain = job.catch(() => undefined)
  return job
}

/* ── 排今天开关（弹窗 + 详情一行编辑框同一个状态，记在本机）── */
const SW_KEY = 'dpm-sched-today'
export const swOn = (): boolean => { try { return localStorage.getItem(SW_KEY) === '1' } catch { return false } }
export function swToggle(): boolean { const v = !swOn(); try { localStorage.setItem(SW_KEY, v ? '1' : '0') } catch { /* 本机存不了就只这次生效 */ } document.querySelectorAll('[data-dpm-sw]').forEach((b) => b.setAttribute('aria-checked', String(v))); return v }
export const swHtml = (): string => '<button type="button" class="v7sw" role="switch" data-dpm-sw aria-checked="' + swOn() + '" aria-label="排今天：开 = 保存后立刻出现在今天任务执行安排的「未安排」和本日计划清单里（甘特图今天没有计划条会补上）"><i aria-hidden="true"></i><span>排今天</span></button>'

/* ── 截止日期 ── */
const DP = (s: string): number => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]) }
const DF = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const DWK = '日一二三四五六'
const today = (): string => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const days = (v: string): number => Math.round((DP(v) - DP(today())) / 864e5)
/** 任务 / 子任务标题后的截止小标签：今天 / 明天 / MM-DD 截止，2 天内橙、过期红（已完成不着色）。 */
export function dueChip(due: string | undefined, done: boolean): string {
  if (!due) return ''
  const d = days(due)
  const cls = done ? '' : d < 0 ? ' over' : d <= 2 ? ' soon' : ''
  const txt = d === 0 ? '今天截止' : d === 1 ? '明天截止' : due.slice(5) + ' 截止'
  return '<span class="v7duec' + cls + '" aria-label="' + esc('截止日期 ' + due + (d < 0 && !done ? '（已过 ' + (-d) + ' 天）' : '')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>' + txt + '</span>'
}
export function dueLabel(v: string): string {
  if (!v) return '<span class="k">截止</span><span class="v none">未设</span>'
  const n = days(v)
  const rel = n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '后天' : n < 0 ? '已过 ' + (-n) + ' 天' : n + ' 天后'
  return '<span class="k">截止</span><span class="v' + (n < 0 ? ' late' : n <= 2 ? ' soon' : '') + '">' + v.slice(5).replace('-', '/') + ' 周' + DWK[new Date(DP(v)).getUTCDay()] + '<em>' + rel + '</em></span>'
}
/** 自绘截止选择器：快捷 + 月历 + 清除；Esc / 点外面关。 */
export function mountDue(wrap: HTMLElement, get: () => string, set: (v: string) => void): { paint(): void; close(): void } {
  const b = wrap.querySelector<HTMLButtonElement>('.v8due')!
  let month = 0
  const paint = (): void => { const v = get(); b.innerHTML = dueLabel(v) + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>'; b.classList.toggle('set', !!v) }
  const html = (): string => {
    const cur = get(), td = DP(today()), wd = new Date(td).getUTCDay()
    const fri = td + (((5 - wd + 7) % 7) || 7) * 864e5, mon = td + (((1 - wd + 7) % 7) || 7) * 864e5
    const qs: Array<[string, number]> = [['今天', td], ['明天', td + 864e5], ['本周五', wd === 5 ? td : fri], ['下周一', mon], ['一周后', td + 7 * 864e5]]
    const m0 = new Date(month), y = m0.getUTCFullYear(), mo = m0.getUTCMonth(), first = Date.UTC(y, mo, 1), start = first - new Date(first).getUTCDay() * 864e5
    let cells = ''
    for (let k = 0; k < 42; k++) { const ms = start + k * 864e5, s = DF(ms), dd = new Date(ms); cells += '<button type="button" data-d="' + s + '" class="' + (dd.getUTCMonth() !== mo ? 'out ' : '') + (ms === td ? 'td ' : '') + (s === cur ? 'on ' : '') + (ms < td ? 'past' : '') + '">' + dd.getUTCDate() + '</button>' }
    return '<div class="v8q">' + qs.map(([t, ms]) => '<button type="button" data-d="' + DF(ms) + '"' + (DF(ms) === cur ? ' class="on"' : '') + '><b>' + t + '</b><small>' + DF(ms).slice(5).replace('-', '/') + '</small></button>').join('') + '</div>'
      + '<div class="v8mh"><button type="button" data-m="-1" aria-label="上个月"><svg viewBox="0 0 16 16"><path d="M10 4L6 8l4 4"/></svg></button><b>' + y + ' 年 ' + (mo + 1) + ' 月</b><button type="button" data-m="1" aria-label="下个月"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg></button></div>'
      + '<div class="v8wk">' + [...DWK].map((x) => '<i>' + x + '</i>').join('') + '</div><div class="v8cal">' + cells + '</div>'
      + '<div class="v8ft"><button type="button" data-clr' + (cur ? '' : ' disabled') + '>清除截止</button><span>截止前 2 天标橙、过期标红</span></div>'
  }
  const pop = (): HTMLElement | null => wrap.querySelector('.v8dp')
  const close = (): void => { pop()?.remove(); b.setAttribute('aria-expanded', 'false') }
  const open = (): void => {
    month = DP((get() || today()).slice(0, 8) + '01')
    let p = pop()
    if (!p) { p = document.createElement('div'); p.className = 'v8dp'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '选择截止日期'); wrap.append(p) }
    p.innerHTML = html(); b.setAttribute('aria-expanded', 'true')
    place(p)
  }
  /* v136（2.5）根因：.gt-due 没有定位 → 弹层按整个弹窗定位、落在弹窗底边下面被 overflow 裁掉（只有箭头在翻）。
     改：wrap 自己定位（CSS position: relative），弹层贴着按钮放；右边 / 下面放不下就右对齐 / 往上翻，永远在弹窗里 */
  const place = (p: HTMLElement): void => {
    const dlg = wrap.closest('dialog') ?? document.body
    const dr = dlg.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), br = b.getBoundingClientRect()
    const w = p.offsetWidth, h = p.offsetHeight
    let left = br.left - wr.left
    if (br.left + w > dr.right - 10) left = br.right - wr.left - w
    const up = br.bottom + 6 + h > dr.bottom - 10 && br.top - 6 - h > dr.top + 10
    const top = up ? br.top - wr.top - 6 - h : br.bottom - wr.top + 6
    p.style.left = Math.round(left) + 'px'; p.style.top = Math.round(top) + 'px'; p.classList.toggle('up', up)
  }
  const pick = (v: string): void => { set(v); paint(); close() }
  wrap.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('.v8due')) { e.preventDefault(); if (pop()) close(); else open(); return }
    const p = t.closest('.v8dp') as HTMLElement | null
    if (!p) return
    e.preventDefault(); e.stopPropagation()
    const d = t.closest<HTMLElement>('[data-d]'); if (d) { pick(d.dataset.d as string); return }
    const m = t.closest<HTMLElement>('[data-m]'); if (m) { const x = new Date(month); month = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + Number(m.dataset.m), 1); p.innerHTML = html(); place(p); return }
    if (t.closest('[data-clr]')) pick('')
  })
  wrap.ownerDocument.addEventListener('pointerdown', (e) => { if (pop() && !(e.target as HTMLElement).closest?.('.gt-due')) close() }, true)
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop()) { e.preventDefault(); e.stopPropagation(); close(); b.focus() } })
  paint()
  return { paint, close }
}

/* ── 白底说明框（0 延迟；挂进打开着的弹窗，弹窗在 top layer）── */
let tipEl: HTMLElement | null = null
export function tipOff(): void { tipEl?.remove(); tipEl = null }
export function tipOn(anchor: HTMLElement, html: string): void {
  tipOff()
  const t = document.createElement('div'); t.className = 'v7tip'; t.innerHTML = html
  ;(anchor.closest('dialog[open]') ?? document.body).append(t); tipEl = t
  const r = anchor.getBoundingClientRect(); t.style.left = Math.max(8, Math.min(innerWidth - 300, r.right - 290)) + 'px'; t.style.top = (r.bottom + 7) + 'px'
}

/* ── 生成标题模型（dsh 已配置的 provider / 模型；档位 = 模型元数据 efforts）── */
export interface TitleModel { provider: string; id: string; label: string; effort: string; effortName: string }
type Ef = { id: string; name: string }
type Mm = { id: string; name: string; description?: string; efforts: Ef[]; def?: string }
type Gg = { provider: string; name: string; models: Mm[] }
const GM_KEY = 'dpm-title-model'
const GC_KEY = 'dpm-title-model-closed'
export function tmLoad(): TitleModel | null { try { const x = JSON.parse(localStorage.getItem(GM_KEY) ?? 'null') as TitleModel | null; return x && x.id && x.provider ? x : null } catch { return null } }
function tmSave(m: TitleModel): void { try { localStorage.setItem(GM_KEY, JSON.stringify(m)) } catch { /* 本机存不了 */ } }
export const tmTip = (): string => { const m = tmLoad(); return '<b>自动生成标题 · ' + (m ? esc(m.label) + (m.effortName ? ' · ' + esc(m.effortName) : '') : '未配置模型') + '</b><span>生成标题用的 AI 模型要手动指定为某个 dsh 已配置好的模型，不配置就用不了。' + (m ? '当前：' + esc(m.provider + ' / ' + m.id) + '；点一下随时换模型或推理等级。' : '点「配置生成标题模型」选模型和推理等级。') + '</span>' }
let catalog: { groups: Gg[]; hidden: string[] } | null = null
const PAL = ['#1677ff', '#7a5af8', '#0f9d58', '#e8590c', '#d6336c', '#0c8599', '#5c7cfa', '#a61e4d']
const colorOf = (p: string): string => PAL[[...p].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length]
const mark = (s: string, q: string): string => { if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length)) }
/** 配置按钮 + 下拉面板；onChange = 配置变了（重画生成标题按钮）。 */
export function mountModelCfg(h: HTMLElement, btn: HTMLButtonElement, toast: (m: string, k?: 'ok' | 'err') => void, onChange: () => void): { paint(): void; close(): void; isOpen(): boolean } {
  let q = '', act = -1
  const closed = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(GC_KEY) ?? '[]') as string[] } catch { return [] } })())
  const panel = (): HTMLElement | null => h.querySelector('.v9gm')
  const find = (id: string, p: string): { m: Mm; g: Gg } | null => { for (const g of catalog?.groups ?? []) if (g.provider === p) for (const m of g.models) if (m.id === id) return { m, g }; return null }
  const paint = (): void => {
    const m = tmLoad()
    h.querySelector('.gt-twrap')?.classList.toggle('v9no', !m)
    btn.setAttribute('aria-label', m ? '生成标题模型：' + m.label + (m.effortName ? ' · ' + m.effortName : '') + '（点一下修改）' : '配置生成标题模型')
    const t = btn.querySelector('.t') as HTMLElement
    t.innerHTML = m ? esc(m.label) + (m.effortName ? '<i>' + esc(m.effortName) + '</i>' : '') + '<svg class="v10cv" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>' : '配置生成标题模型'
    const gb = h.querySelector<HTMLElement>('[data-gt-gen]'); if (gb) { gb.tabIndex = m ? 0 : -1; gb.setAttribute('aria-hidden', String(!m)) }
  }
  const row = (m: Mm, g: Gg, cur: TitleModel | null, k: number): string => {
    const on = !!(cur && cur.id === m.id && cur.provider === g.provider)
    return '<button type="button" role="option" class="v10o" id="dpmGm-' + k + '" aria-selected="' + on + '" data-m="' + esc(m.id) + '" data-p="' + esc(g.provider) + '"><span class="v10o-n">' + mark(m.name, q) + (m.description && /推荐/.test(m.description) ? '<em>推荐</em>' : '') + '</span>'
      + '<span class="v10o-s">' + mark(m.id, q) + '</span>'
      + '<span class="v10o-e" aria-label="支持的推理等级">' + m.efforts.map((e) => '<i' + (on && cur?.effort === e.id ? ' class="on"' : '') + '>' + esc(e.name) + '</i>').join('') + '</span>'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></button>'
  }
  const html = (): string => {
    if (!catalog) return '<div class="v10top"><div class="v9gm-h"><b>生成标题模型</b><small>正在读取 dsh 已配置的模型…</small></div></div>'
    const cur = tmLoad(), ql = q.trim().toLowerCase()
    let list = '', k = 0, total = 0
    for (const g of catalog.groups) {
      total += g.models.length
      const ms = g.models.filter((m) => !ql || (m.name + ' ' + m.id + ' ' + g.name).toLowerCase().includes(ql)); if (!ms.length) continue
      const shut = !ql && closed.has(g.provider)
      list += '<div class="v10g' + (shut ? ' shut' : '') + '" role="group" aria-label="' + esc(g.name) + '" style="--c:' + colorOf(g.provider) + '"><button type="button" class="v10gh" data-g="' + esc(g.provider) + '" aria-expanded="' + !shut + '"><b>' + esc((g.name || g.provider).slice(0, 1).toUpperCase()) + '</b><span>' + mark(g.name, ql) + '</span><small>' + ms.length + '</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>'
      if (!shut) for (const m of ms) list += row(m, g, cur, k++)
      list += '</div>'
    }
    if (!list) list = catalog.groups.length ? '<div class="v10empty">没有匹配「' + esc(q) + '」的模型<button type="button" data-clr>清空搜索</button></div>' : '<div class="v10empty">dsh 里还没有可用的模型：先在 dsh 设置里配置一个 provider</div>'
    const f = cur ? find(cur.id, cur.provider) : null
    let ef = '<div class="v10efk">推理等级' + (f ? '<small>' + esc(f.m.name) + ' 支持 ' + f.m.efforts.length + ' 档</small>' : '<small>先选一个模型</small>') + '</div><div class="v10ef" role="radiogroup" aria-label="推理等级">'
    if (f) { if (f.m.efforts.length <= 1) ef += '<div class="v10ef1">' + (f.m.efforts.length ? '这个模型只有「' + esc(f.m.efforts[0].name) + '」一档，不用选' : '这个模型没有推理等级可选') + '</div>'; else for (const e of f.m.efforts) ef += '<button type="button" role="radio" aria-checked="' + (cur?.effort === e.id) + '" data-e="' + esc(e.id) + '"><b>' + esc(e.name) + (e.id === f.m.def ? '<em>默认</em>' : '') + '</b><small>' + esc(e.id) + '</small></button>' }
    else ef += '<div class="v10ef1 dim">选好模型后，这里只列它支持的档位</div>'
    ef += '</div>'
    const hid = catalog.hidden.join('、')
    return '<div class="v10top"><div class="v9gm-h"><b>生成标题模型</b><small>只给「生成标题」用，不改会话模型 · 共 ' + total + ' 个</small></div>'
      + '<label class="v10q"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input data-gm-q type="search" autocomplete="off" spellcheck="false" placeholder="搜索模型 / provider / id" value="' + esc(q) + '" role="combobox" aria-expanded="true" aria-controls="dpmGmList" aria-autocomplete="list"><kbd>↑↓ Enter</kbd></label></div>'
      + '<div class="v10list" id="dpmGmList" role="listbox" aria-label="模型">' + list + '</div>'
      + '<div class="v10bot">' + ef + '<div class="v10ft"><span>' + (cur ? '当前：<b>' + esc(cur.label) + (cur.effortName ? ' · ' + esc(cur.effortName) : '') + '</b> · 点选即生效' : '还没配置 · 点选即生效') + (hid ? ' · 已隐藏 ' + esc(hid) + '（不支持生成标题）' : '') + '</span></div></div>'
  }
  const opts = (): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('.v9gm .v10o')]
  const setAct = (i: number, scroll = true): void => {
    const o = opts(); if (!o.length) { act = -1; return }
    act = Math.max(0, Math.min(o.length - 1, i))
    o.forEach((x) => x.classList.remove('act')); o[act].classList.add('act')
    h.querySelector('[data-gm-q]')?.setAttribute('aria-activedescendant', o[act].id)
    if (scroll) o[act].scrollIntoView({ block: 'nearest' })
  }
  const render = (focus: boolean): void => {
    let p = panel()
    const sc = p?.querySelector('.v10list')?.scrollTop ?? 0
    const qf = document.activeElement?.hasAttribute('data-gm-q')
    if (!p) { p = document.createElement('div'); p.className = 'v9gm v10gm'; p.setAttribute('aria-label', '选择生成标题模型和推理等级'); h.append(p) }
    p.innerHTML = html()
    const br = btn.getBoundingClientRect(), hr = h.getBoundingClientRect()
    p.style.top = (br.bottom - hr.top + 6) + 'px'; p.style.right = Math.max(8, hr.right - br.right) + 'px'
    const l = p.querySelector('.v10list'); if (l) l.scrollTop = sc
    const inp = p.querySelector<HTMLInputElement>('[data-gm-q]')
    if (inp && (focus || qf)) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
    const o = opts(); setAct(act < 0 ? Math.max(0, o.findIndex((x) => x.getAttribute('aria-selected') === 'true')) : act, focus)
    btn.setAttribute('aria-expanded', 'true')
  }
  const open = (): void => {
    tipOff(); act = -1; render(true)
    if (!catalog) void post<{ groups: Gg[]; hidden: string[] }>('goal/models', {}).then((r) => { catalog = { groups: r.groups ?? [], hidden: r.hidden ?? [] }; if (panel()) render(true) }).catch((e: unknown) => { const p = panel(); if (p) p.innerHTML = '<div class="v10top"><div class="v9gm-h"><b>生成标题模型</b><small>读不到 dsh 的模型目录：' + esc(e instanceof Error ? e.message : String(e)) + '</small></div></div>' })
  }
  const close = (): void => { panel()?.remove(); q = ''; act = -1; btn.setAttribute('aria-expanded', 'false') }
  const set = (patch: { id?: string; p?: string; effort?: string }): void => {
    const was = tmLoad()
    let next: TitleModel | null = null
    let note = ''
    if (patch.id && patch.p) {
      const f = find(patch.id, patch.p); if (!f) return
      const keep = was && f.m.efforts.some((e) => e.id === was.effort)
      const eid = keep ? (was as TitleModel).effort : (f.m.def ?? f.m.efforts[0]?.id ?? '')
      if (was && was.effort && !keep && f.m.efforts.length) note = '（这个模型没有「' + was.effortName + '」，改用它的默认档）'
      next = { provider: f.g.provider, id: f.m.id, label: f.m.name, effort: eid, effortName: f.m.efforts.find((e) => e.id === eid)?.name ?? '' }
    } else if (patch.effort && was) {
      const f = find(was.id, was.provider)
      next = { ...was, effort: patch.effort, effortName: f?.m.efforts.find((e) => e.id === patch.effort)?.name ?? patch.effort }
    }
    if (!next) return
    tmSave(next); paint(); onChange(); act = -1; render(false)
    toast((was ? '已切换' : '已配置') + '生成标题模型：' + next.label + (next.effortName ? ' · ' + next.effortName : '') + note + ' —— 立即生效')
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); if (panel()) close(); else open() })
  btn.addEventListener('mouseenter', () => { if (!panel()) tipOn(btn, tmTip()) })
  btn.addEventListener('mouseleave', tipOff)
  h.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (!t.hasAttribute?.('data-gm-q')) return; q = t.value; act = 0; render(true); setAct(0) })
  h.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (!t.closest?.('.v9gm')) return
    e.preventDefault(); e.stopPropagation()
    const g = t.closest<HTMLElement>('[data-g]'); if (g) { const id = g.dataset.g as string; if (closed.has(id)) closed.delete(id); else closed.add(id); try { localStorage.setItem(GC_KEY, JSON.stringify([...closed])) } catch { /* */ } act = -1; render(false); return }
    const o = t.closest<HTMLElement>('[data-m]'); if (o) { set({ id: o.dataset.m, p: o.dataset.p }); return }
    const ef = t.closest<HTMLElement>('[data-e]'); if (ef) { set({ effort: ef.dataset.e }); return }
    if (t.closest('[data-clr]')) { q = ''; act = -1; render(true) }
  }, true)
  h.addEventListener('pointerover', (e) => { const o = (e.target as HTMLElement).closest?.('.v9gm .v10o') as HTMLElement | null; if (o) { const i = opts().indexOf(o); if (i !== act) setAct(i, false) } })
  h.addEventListener('keydown', (e) => {
    if (!panel() || !(e.target as HTMLElement).closest?.('.v9gm')) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAct((act < 0 ? -1 : act) + (e.key === 'ArrowDown' ? 1 : -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = opts()[act]; if (o) set({ id: o.dataset.m, p: o.dataset.p }) }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) { e.preventDefault(); const m = tmLoad(); const f = m && find(m.id, m.provider); if (m && f && f.m.efforts.length > 1) { const i = f.m.efforts.findIndex((x) => x.id === m.effort) + (e.key === 'ArrowRight' ? 1 : -1); if (i >= 0 && i < f.m.efforts.length) set({ effort: f.m.efforts[i].id }) } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus() }
  })
  h.ownerDocument.addEventListener('pointerdown', (e) => { if (panel() && !(e.target as HTMLElement).closest?.('.v9gm, .v9cfg')) close() }, true)
  paint()
  return { paint, close, isOpen: () => !!panel() }
}
