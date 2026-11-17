/**
 * v177：详情说明气泡（唯一一份）—— 任务 / 子任务 / 相关说明 / 项目产物 / 知识卡 共用同一个壳。
 *
 * 一个元素、一套外壳、一套定位、一套开关：
 *   · 卡片详情（入口 1–4）：气泡在详情左边，箭头（右）指向被点的那一项；换项原地换内容。
 *   · 引用胶囊（入口 5–7：任务弹窗 / 说明框 / 知识卡正文 / DSH 对话框）：贴在胶囊上方或下方（放不下翻转），箭头指胶囊。
 * 数据只有五种身份（D3），由各自的 builder 组装成 DetailModel 交给它渲染，不写第二套外壳 / 第二份 CSS。
 *
 * 入口（一处定义）：
 *   openTask / openNote / openKb / openChip —— 只有这四个 + 内部下钻；board / goaltask / kbdlg / index 都从这里进。
 * 原型：prototype/dsh-web-v177.html（#v40Dp.dpb）；设计卡：docs/design-card-detail-bubble-v177.md
 */
import type { Card, KbCardFull, KbCardInfo, KbItem, KbRef, Snapshot, Task } from './api.js'
import { getKb, getKbCard, openedHow, openFileSmart, post } from './api.js'
import { allRefs, type RefHit } from './composer.js'
import { esc, ic } from './icons.js'
import { chipIconSvg } from './chipicon.js'
import { fileText, findRefFile, linkText, noteText, refTitle } from '../quote.js'
import { tcHtml } from './sess.js'
import { KB_STATUS_LABEL, KB_TYPE_LABEL, kbMarkdown } from './kb.js'

export type DetailKind = 'task' | 'subtask' | 'note' | 'product' | 'kb'
export type BubbleIdentity = 'task' | 'sub' | 'note' | 'prod' | 'kb'
export interface DetailMeta { t?: string; cls?: string; html?: string }
export interface DetailSection { h: string; n?: string | number; html: string }
export interface DetailModel {
  kind: DetailKind
  /** 身份（决定徽标图标 + 主色，见 CSS .k-*） */
  bkind: BubbleIdentity
  /** card = 卡片里的数据（刷新跟着看板走）；chip = 只有原文；kb = 知识库 */
  source: 'card' | 'chip' | 'kb'
  id: string
  cardId?: string
  badge: string
  ctx: string
  title: string
  lead?: string
  meta: DetailMeta[]
  sections: DetailSection[]
  quote?: string
  actions: Array<'quote' | 'edit'>
  foot?: string
  path?: string
  /** 知识卡全文（getKbCard 回来后的缓存；重试 / 刷新不再打网络） */
  kb?: KbCardInfo
  /** 读取中：正文位置上的一句说明（知识卡先摘要态、后 refresh） */
  busy?: string
  /** 出错：正文里的错误节 + 重试按钮 */
  retry?: () => void
}

export interface BubbleCtx {
  toast: (m: string, k?: 'ok' | 'err') => void
  snap?: () => Snapshot | null
  quote?: (text: string) => void
  edit?: (cardId: string, taskId: string) => void
  openCard?: (id: string) => void
  openSession?: (id: string) => void
  sessions?: () => Array<{ id: string; title: string }>
  kbOpen?: (id: string) => void
  kbEditing?: () => boolean
}

interface Rect { left: number; top: number; width: number; height: number; right: number; bottom: number }
interface Entry { model: DetailModel; anchor: HTMLElement | null; at: Rect; mode: 'detail' | 'float'; ctx: BubbleCtx }

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const RXD = /^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/
const DP_IC: Record<string, string> = {
  task: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4"/><path d="m8 12 2.6 2.6L16.2 9"/></svg>',
  sub: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 6.5v8.6a3.4 3.4 0 0 0 3.4 3.4h9.6"/><path d="m15 12.3 3.8 3.1-3.8 3.1"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h8.6L18.5 8v12.2H6z"/><path d="M14.4 3.8V8h4.1"/><path d="M9 11.6h6.6M9 15.2h5"/></svg>',
  prod: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7.6 12 4l7.5 3.6v8.8L12 20l-7.5-3.6z"/><path d="M4.5 7.6 12 11.2l7.5-3.6M12 11.2V20"/></svg>',
  kb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.6C9.9 5.3 7.4 5 4.6 5.6v12.6c2.8-.6 5.3-.3 7.4 1 2.1-1.3 4.6-1.6 7.4-1V5.6C16.6 5 14.1 5.3 12 6.6Z"/><path d="M12 6.6v12.6"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="13" rx="2.5"/><path d="M4 10h16"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5H19v5.5M19 5l-8 8"/><path d="M17 13.5V19H5V7h5.5"/></svg>',
}

/* ── 单例：一个 DOM，无论从哪儿开 ═══════════════════════════════════════ */
let el: HTMLElement | null = null
let cur: Entry | null = null
let stack: Entry[] = []
let wired = false
let last = { key: '', at: 0 }
let host: HTMLElement = document.body
let kbIndex: KbItem[] | null = null
/** 知识库页跳转（index.ts 启动时注册一次：切到「知识库」面板并定位这张卡）。 */
let kbOpener: ((id: string) => void) | null = null
export function setKbOpener(f: (id: string) => void): void { kbOpener = f }
const kbMayOpen = (ctx: BubbleCtx): boolean => !!(ctx.kbOpen || kbOpener)
const kbEditingNow = (ctx: BubbleCtx): boolean => (ctx.kbEditing ? ctx.kbEditing() : !!document.getElementById('kbSave'))

const keyOf = (m: DetailModel): string => m.kind + ':' + m.id
const nowMs = (): number => Date.now()
const visible = (x: HTMLElement | null | undefined): x is HTMLElement => !!x && x.isConnected && x.getClientRects().length > 0

function root(): HTMLElement {
  if (el) return el
  const e = document.createElement('section')
  e.className = 'dpm-dpb'
  e.setAttribute('role', 'dialog')
  e.setAttribute('aria-modal', 'false')
  e.hidden = true
  e.addEventListener('click', onClick)
  e.addEventListener('copy', (ev) => {
    const t = selText(e)
    if (t == null) return
    ev.preventDefault()
    ev.clipboardData?.setData('text/plain', t)
    ;(window as unknown as Record<string, unknown>).__dpmDpCopy = { t, at: nowMs() }
  })
  e.addEventListener('keydown', (ev) => {
    const c = (ev.target as HTMLElement).closest?.('.nref') as HTMLElement | null
    if (c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); chipInBubble(c); }
  })
  document.body.append(e)
  el = e
  return e
}

function wire(): void {
  if (wired) return
  wired = true
  const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, cap = true): void => { document.addEventListener(t, f, cap) }
  on('scroll', () => { if (cur) soon() })
  on('pointerdown', (e) => {
    if (!cur || !el) return
    const t = e.target as HTMLElement | null
    if (!t?.closest) return
    if (el.contains(t)) return
    if (cur.anchor && (cur.anchor === t || cur.anchor.contains(t))) return
    /* 卡片详情里换一项 / 输入框里换一颗胶囊 → 交给 click 原地换内容，不先关（会闪） */
    if (t.closest('.detail .task .tkt, .detail .nk:not(.editing), .nref, .dpm-dpsrc')) return
    if (t.closest('.dpm-toasts, .dpm-qm, .dpm-spn, .dpm-gp, .qpn, .dpm-dialog, .dpm-dpb')) return
    closeBubble()
  })
  on('keydown', (e) => {
    if (e.key !== 'Escape' || !cur || e.defaultPrevented) return
    e.preventDefault(); e.stopPropagation()
    closeBubble()
  })
  on('close', (e) => { if (host && e.target === host) closeBubble() })
  window.addEventListener('resize', () => { if (cur) soon() })
  ro.observe(document.documentElement)
}

/* 详情 / 弹窗的内容是异步长出来的（重画、子任务展开、会话胶囊回来）→ 尺寸一变就重新量位置；
   入场后几个时间点再补量（大列表 / 详情整体重排要到几百 ms 才稳，v175 的老教训）。 */
const ro = new ResizeObserver(() => { if (cur) soon() })
function watch(anchor: HTMLElement | null): void {
  for (const x of watched) { try { ro.unobserve(x) } catch { /* ignore */ } }
  watched = []
  const add = (x: Element | null | undefined): void => { if (x) { try { ro.observe(x); watched.push(x) } catch { /* ignore */ } } }
  add(anchor?.closest('.detail'))
  add(anchor?.closest('dialog[open]'))
  add(anchor?.parentElement)
}
let watched: Element[] = []
function settle(): void {
  for (const t of [0, 80, 240, 600, 1200]) setTimeout(() => { if (cur && el && !el.hidden) place() }, t)
}

let raf = 0
function soon(): void { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place() }) }

/* ── 定位：detail 模式在详情左边；float 模式贴胶囊（放不下翻转）═════════ */
function place(): void {
  const e = el
  if (!e || !cur) return
  if (cur.mode === 'detail') {
    if (!reanchor()) return
    const det = (cur.anchor?.closest('.detail') ?? null) as HTMLElement | null
    if (!det || !det.isConnected || !det.getClientRects().length) { closeBubble(); return }
    const cr = det.getBoundingClientRect()
    const W = clamp(cr.left - 26, 320, 800)
    e.style.setProperty('--w', W + 'px')
    const db = det.querySelector('.d-b') as HTMLElement | null
    const br = db && db.getClientRects().length ? db.getBoundingClientRect() : cr
    const top0 = Math.round(br.top), bot0 = Math.round(br.bottom)
    e.style.maxHeight = Math.max(180, bot0 - top0) + 'px'
    const H = e.offsetHeight
    const r = cur.anchor ? cur.anchor.getBoundingClientRect() : cur.at
    const cy = r.top + (r.height || 30) / 2
    const top = clamp(cy - 140, top0, Math.max(top0, bot0 - H))
    e.style.left = Math.round(Math.max(8, cr.left - 14 - W)) + 'px'
    e.style.top = Math.round(top) + 'px'
    e.style.setProperty('--ty', Math.round(clamp(cy - top, 18, H - 18)) + 'px')
    e.classList.remove('arr-t', 'arr-b'); e.classList.add('arr-r')
    markSource(cur.anchor)
    return
  }
  if (cur.anchor && !cur.anchor.isConnected) { closeBubble(); return }
  const vw = innerWidth, vh = innerHeight
  const chipR = cur.anchor && cur.anchor.isConnected ? cur.anchor.getBoundingClientRect() : cur.at
  /* 贴的是「输入框 / 说明框」整块，不是胶囊自己：气泡永远落在输入区上方，不压输入框 */
  const placeEl = cur.anchor ? ((cur.anchor.closest('.ss-composer') as HTMLElement | null) ?? cur.anchor) : null
  const placeR = placeEl ? placeEl.getBoundingClientRect() : chipR
  /* 横向夹在「弹窗 / 面板」里：不盖住左边侧栏；窄窗按面板宽收窄，不顶出去 */
  const paneEl = (cur.anchor?.closest('dialog[open]') ?? null) as HTMLElement | null
  const paneR = paneEl ? paneEl.getBoundingClientRect() : null
  const W = clamp(paneR ? Math.min(640, paneR.width - 24) : 640, 320, Math.max(320, Math.min(640, vw - 24)))
  e.style.setProperty('--w', W + 'px')
  const bx = paneR ? { l: paneR.left + 12, r: paneR.right - 12 } : { l: 8, r: vw - 8 }
  const by = paneR ? { t: Math.max(8, paneR.top + 8), b: Math.min(vh - 8, paneR.bottom - 8) } : { t: 8, b: vh - 8 }
  const aboveRoom = placeR.top - by.t - 12, belowRoom = by.b - placeR.bottom - 12
  const above = aboveRoom >= belowRoom && aboveRoom >= 160
  e.style.maxHeight = Math.min(620, Math.max(200, above ? aboveRoom : belowRoom)) + 'px'
  const H = e.offsetHeight
  let top = above ? placeR.top - H - 12 : placeR.bottom + 12
  if (top < by.t) top = placeR.bottom + 12
  if (top + H > by.b) top = Math.max(by.t, by.b - H)
  const cx = chipR.left + (chipR.width || 0) / 2
  const left = clamp(cx - W / 2, bx.l, Math.max(bx.l, bx.r - W))
  e.style.left = Math.round(left) + 'px'
  e.style.top = Math.round(top) + 'px'
  e.style.setProperty('--ax', Math.round(clamp(cx - left, 22, W - 22)) + 'px')
  e.classList.remove('arr-r', 'arr-t', 'arr-b')
  e.classList.add(above ? 'arr-b' : 'arr-t')
  markSource(cur.anchor)
}

function clearMarks(): void {
  for (const x of Array.from(document.querySelectorAll('.dpm-dpsrc'))) x.classList.remove('dpm-dpsrc')
  for (const x of Array.from(document.querySelectorAll('.nref.dpb-src'))) x.classList.remove('dpb-src')
}
function markSource(src: HTMLElement | null): void {
  clearMarks()
  if (!src) return
  const row = src.matches('.task') ? (src.querySelector(':scope > .tkhead') ?? src) : src
  if (row.closest('.detail')) row.classList.add('dpm-dpsrc')
  else src.classList.add('dpb-src')
}

/* ── 渲染 ═══════════════════════════════════════════════════════════════ */
const metaHtml = (meta: DetailMeta[]): string => meta.map((x) => (x.html ? '<span class="dpb-mcx">' + x.html + '</span>' : '<span class="dpb-mc ' + (x.cls ?? '') + '">' + esc(x.t ?? '') + '</span>')).join('')
const secHtml = (s: DetailSection): string => '<section class="dpb-s"><h4 class="dpb-sh">' + esc(s.h) + (s.n != null && s.n !== '' ? '<i>' + esc(String(s.n)) + '</i>' : '') + '</h4>' + s.html + '</section>'

function actionsHtml(m: DetailModel): string {
  let out = ''
  if (stack.length) out += '<button type="button" class="dpb-i dpb-back" data-dpbback title="回到上一层（Esc 关闭）" aria-label="回到上一层">' + DP_IC.back + '</button>'
  if (m.quote) out += '<button type="button" class="dpb-i qb" data-dpbq="' + esc(m.quote) + '" title="引用原文（复制；会话可见时同时插入输入框）" aria-label="引用这一段">' + ic('quote') + '</button>'
  if (m.actions.includes('edit')) out += '<button type="button" class="dpb-i" data-dpbedit title="编辑（弹窗）" aria-label="编辑">' + ic('pencil') + '</button>'
  out += '<button type="button" class="dpb-i dpb-x" data-dpbx title="关闭（Esc）" aria-label="关闭详情">' + ic('x') + '</button>'
  return out
}

function footHtml(m: DetailModel): string {
  if (m.bkind === 'kb') {
    const btn = kbMayOpen(cur?.ctx ?? { toast: () => undefined }) ? '<button type="button" class="dpb-btn" data-dpbkb="' + esc(m.id) + '">在知识库中打开' + DP_IC.open + '</button>' : ''
    return '<span class="dpb-path" title="' + esc(m.path ?? '') + '">' + esc(m.path ?? '') + '</span><span class="grow"></span>' + btn
  }
  return '<span class="dpb-foot">' + esc(m.foot ?? '') + '</span><span class="grow"></span><span class="dpb-hint"><kbd>Esc</kbd> 关闭</span>'
}

function html(m: DetailModel): string {
  const lead = m.lead ? '<p class="dpb-lead">' + esc(m.lead) + '</p>' : ''
  const meta = m.meta.length ? '<div class="dpb-m">' + metaHtml(m.meta) + '</div>' : ''
  const busy = m.busy ? '<div class="dpb-e">' + esc(m.busy) + '</div>' : ''
  const fail = m.retry ? '<div class="dpb-e"><span>没读到知识卡正文</span><button type="button" class="btn sm" data-dpbretry>重试</button></div>' : ''
  return '<header class="dpb-h"><div class="dpb-top">'
    + '<span class="dpb-k"><span class="dpb-ic">' + (DP_IC[m.bkind] ?? DP_IC.task) + '</span><b>' + esc(m.badge) + '</b></span>'
    + '<span class="dpb-ctx" title="' + esc(m.ctx) + '">' + esc(m.ctx) + '</span>'
    + '<div class="dpb-a">' + actionsHtml(m) + '</div></div>'
    + '<h2 class="dpb-t" id="dpmDpbT">' + esc(m.title) + '</h2>' + lead + meta + '</header>'
    + '<div class="dpb-b">' + (m.sections.map(secHtml).join('') || '') + busy + fail + '</div>'
    + '<footer class="dpb-f">' + footHtml(m) + '</footer>'
}

function render(swap: boolean): void {
  const e = el
  if (!e || !cur) return
  const h = html(cur.model)
  const sc = swap ? 0 : (e.querySelector('.dpb-b')?.scrollTop ?? 0)
  e.innerHTML = h
  e.setAttribute('aria-labelledby', 'dpmDpbT')
  e.className = 'dpm-dpb k-' + cur.model.bkind + (stack.length ? ' has-back' : '')
  e.hidden = false
  const b = e.querySelector('.dpb-b'); if (b) b.scrollTop = sc
  place()
  if (swap) { e.classList.remove('sw'); void e.offsetWidth; e.classList.add('sw') }
}

/* ── 打开 / 换项 / 下钻 / 关闭 ══════════════════════════════════════════ */
function mount(a: HTMLElement | null): HTMLElement {
  const h = ((a?.closest('dialog[open]') as HTMLElement | null) ?? document.body)
  host = h
  const e = root()
  if (e.parentElement !== h) h.append(e)
  return e
}

export function openModel(ctx: BubbleCtx, model: DetailModel, anchor?: HTMLElement | null): void {
  wire()
  const now = nowMs()
  if (last.key === keyOf(model) && now - last.at < 60) return
  last = { key: keyOf(model), at: now }
  const a = anchor ?? null
  /* 气泡里的胶囊再点 → 下钻（压栈，返回逐层回） */
  if (cur && el && !el.hidden && a && el.contains(a)) {
    if (cur.model.kind === model.kind && cur.model.id === model.id) return
    stack.push({ ...cur })
    cur = { model, anchor: null, at: rectOf(a), mode: cur.mode, ctx }
    render(true)
    return
  }
  /* 同一个源再点 = 关 */
  if (cur && !el?.hidden && a && cur.anchor === a && keyOf(cur.model) === keyOf(model)) { closeBubble(); return }
  mount(a)
  cur = { model, anchor: a, at: a ? rectOf(a) : syntheticRect(), mode: a && a.closest('.detail') ? 'detail' : 'float', ctx }
  stack = []
  watch(a)
  render(false)
  settle()
  const e = root()
  setTimeout(() => (e.querySelector('[data-dpbx]') as HTMLElement | null)?.focus({ preventScroll: true }), 30)
  probeInstall()
}

function rectOf(x: HTMLElement): Rect {
  const r = x.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
}
function syntheticRect(): Rect {
  const l = innerWidth / 2 - 1, t = innerHeight / 2 - 1
  return { left: l, top: t, width: 2, height: 2, right: l + 2, bottom: t + 2 }
}

export function bubbleNav(model: DetailModel, anchor?: HTMLElement | null): void {
  if (!cur) return
  if (cur.model.kind === model.kind && cur.model.id === model.id) return
  stack.push({ ...cur })
  cur = { model, anchor: null, at: anchor ? rectOf(anchor) : cur.at, mode: cur.mode, ctx: cur.ctx }
  watch(null)
  render(true)
  settle()
}

function back(): void {
  const prev = stack.pop()
  if (!cur || !prev) return
  cur = prev
  watch(prev.anchor)
  render(true)
  settle()
}

export function closeBubble(): void {
  const e = el
  if (!e) return
  const src = cur?.anchor ?? null
  e.hidden = true
  e.innerHTML = ''
  e.classList.remove('arr-r', 'arr-b', 'arr-t', 'sw')
  if (e.parentElement !== document.body) document.body.append(e)
  cur = null; stack = []; host = document.body
  watch(null)
  clearMarks()
  if (visible(src)) { try { src.focus({ preventScroll: true }) } catch { /* ignore */ } }
}

export function bubbleIsOpen(kind?: string, id?: string): boolean {
  return !!cur && (!kind || (cur.model.kind === kind && cur.model.id === id))
}

/** 详情 / 看板重画后：卡片来源的模型重算内容（滚动位置保留）；锚点没了 / 详情关了 → 关。 */
export function bubbleSync(): void {
  if (!cur || !el) return
  const m = cur.model
  if (m.source !== 'card' || !m.cardId) return
  const c = cur.ctx.snap?.()?.board.cards.find((x) => x.id === m.cardId)
  if (!c) { closeBubble(); return }
  const next = rebuild(c, m, cur.ctx)
  if (!next) { closeBubble(); return }
  next.kb = m.kb
  cur.model = next
  render(false)
}

function rebuild(c: Card, m: DetailModel, ctx: BubbleCtx): DetailModel | null {
  if (m.kind === 'task' || m.kind === 'subtask') return taskModel(c, m.id, ctx)
  if (m.kind === 'note') return noteModel(c, m.id, ctx)
  return null
}

/* ── 内容：说明全文（引用胶囊 / 分割线 / 链接同一套识别）══════════════ */
function refNotes(c: Card): Array<{ t: string; canon: string }> { return (c.noteItems ?? []).map((n) => ({ t: n.t, canon: noteText(n.t, n.v) })) }
function chipHtml(kind: RefHit['kind'], title: string, body: string, canon: string, c: Card, moved?: string, gone?: boolean): string {
  const icon = chipIconSvg(kind, body)
  const gold = kind === 'link' && (c.webLinks ?? []).some((l) => l.star && l.url === body)
  const tip = (moved ? '这个文件已经挪到 ' + body + '（说明里写的还是旧的） · ' : '') + (kind === 'note' ? '相关说明 · 点一下看全文' : kind === 'link' ? '相关链接 · 点一下用浏览器打开' : kind === 'file' ? '相关文件 · 点一下用默认应用打开' : kind === 'repo' ? '仓库 · 点一下在访达里打开' : kind === 'card' ? '关联卡片 · 点一下打开它的详情' : kind === 'kb' ? '知识卡 · 点一下看全文' : '会话 · 点一下切过去')
  return '<span class="nref' + (gold ? ' gold' : '') + (moved ? ' moved' : '') + (gone ? ' gone' : '') + '" role="button" tabindex="0" data-rk="' + kind + '"' + (moved ? ' data-from="' + esc(moved) + '"' : '') + ' data-rt="' + esc(title) + '" data-rb="' + esc(body) + '" data-ref="' + esc(canon) + '" title="' + esc(tip) + '"><span class="ri">' + icon + '</span><span class="rt">' + esc(title) + '</span></span>'
}

function readHtml(v: string, c: Card, snap: Snapshot | null): string {
  const txt = String(v ?? '')
  const refs = allRefs(txt, refNotes(c))
  const lines: Array<{ h: string; p: string | null }> = [{ h: '', p: '' }]
  const addText = (s: string): void => {
    s.split('\n').forEach((part, i) => {
      if (i) lines.push({ h: '', p: '' })
      const L = lines[lines.length - 1]
      L.h += esc(part).replace(/https?:\/\/[^\s<>"'“”‘’「」（）()，。；、]+/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>')
      if (L.p !== null) L.p += part
    })
  }
  let at = 0
  for (const r of refs) {
    addText(txt.slice(at, r.i))
    const L = lines[lines.length - 1]
    /* v154（1.4）：文件引用按「路径 → prev → 同名 → 归一」找到卡内文件后，显示现在的名字、打开现在的路径 */
    const f = r.kind === 'file' ? findRefFile(c.files ?? [], r.body ?? '') : null
    const mv = f && f.path !== (r.body ?? '') ? (r.body ?? '') : undefined
    const gone = r.kind === 'file' && !!f && snap?.files?.[f.path] === false
    L.h += chipHtml(r.kind, f ? refTitle(f) : r.title, f ? f.path : (r.body ?? ''), r.canon, c, mv, !!gone); L.p = null
    at = r.i + r.len
  }
  addText(txt.slice(at))
  return lines.map((L) => {
    const m = L.p !== null ? L.p.match(RXD) : null
    if (m) return '<div class="ndiv"><i></i>' + (m[1] ? '<b>' + esc(m[1]) + '</b><i></i>' : '') + '</div>'
    return '<div class="nline">' + (L.h || '<br>') + '</div>'
  }).join('')
}

export function selText(rootEl: HTMLElement): string | null {
  const sel = document.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null
  const rg = sel.getRangeAt(0)
  if (!rootEl.contains(rg.commonAncestorContainer)) return null
  const frag = rg.cloneContents()
  const chipOf = (n: Node): HTMLElement | null => (n.nodeType === 1 ? n as HTMLElement : n.parentElement)?.closest('.nref') ?? null
  const sc = chipOf(rg.startContainer), ec = chipOf(rg.endContainer)
  let out = ''
  const BLOCK = /^(DIV|P|LI|SECTION|UL|OL|H2|H3|HEADER)$/
  const walk = (n: Node): void => {
    if (n.nodeType === 3) { out += n.textContent ?? ''; return }
    if (n.nodeType !== 1 && n.nodeType !== 11) return
    const h = n as HTMLElement
    if (n.nodeType === 1 && h.classList.contains('nref')) { out += h.dataset.ref || h.textContent || ''; return }
    if (n.nodeType === 1 && h.tagName === 'BR') { out += '\n'; return }
    const blk = n.nodeType === 1 && BLOCK.test(h.tagName)
    if (blk && out && !out.endsWith('\n')) out += '\n'
    for (const ch of Array.from(n.childNodes)) walk(ch)
    if (blk && out && !out.endsWith('\n')) out += '\n'
  }
  if (sc && sc === ec) return sc.dataset.ref || sc.textContent || ''
  walk(frag)
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

const when = (s?: string): string => {
  const d = new Date(s ?? '')
  return Number.isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/* ── 模型：任务 / 子任务 ════════════════════════════════════════════════ */
function findTask(c: Card, id: string): { t: Task; parent: Task | null } | null {
  for (const t of c.tasks) { if (t.id === id) return { t, parent: null }; for (const s of t.subs ?? []) if (s.id === id) return { t: s, parent: t } }
  return null
}

export function taskModel(c: Card, id: string, ctx: BubbleCtx): DetailModel | null {
  const f = findTask(c, id); if (!f) return null
  const t = f.t, sub = !!f.parent, what = sub ? '子任务' : '任务'
  const ro = !!c.archivedAt
  const snap = ctx.snap?.() ?? null
  const subs = sub ? [] : (t.subs ?? [])
  const links = (t.links ?? []).map((x) => (c.webLinks ?? []).find((l) => l.id === x)).filter(Boolean) as NonNullable<Card['webLinks']>
  const files = (t.files ?? []).map((x) => (c.files ?? []).find((l) => l.id === x)).filter(Boolean) as NonNullable<Card['files']>
  const sections: DetailSection[] = []
  if ((t.note ?? '').trim()) sections.push({ h: '说明', n: String(t.note).length + ' 字', html: '<div class="dpb-note">' + readHtml(t.note ?? '', c, snap) + '</div>' })
  if (subs.length) sections.push({
    h: '子任务', n: subs.filter((x) => x.done).length + '/' + subs.length,
    html: '<ul class="dpb-ks">' + subs.map((x) => '<li class="' + (x.done ? 'done' : '') + '"><button type="button" class="dpb-k" data-dpbgo="' + esc(x.id ?? '') + '"><span class="dpb-dot"></span><span class="dpb-tx">' + esc(x.text) + '</span></button>' + (x.sess ? tcHtml(c.id, x, true, ro) : '') + '</li>').join('') + '</ul>',
  })
  if (links.length) sections.push({ h: '相关链接', n: links.length, html: '<div class="dpb-chips">' + links.map((l) => chipHtml('link', l.text, l.url, linkText({ id: l.id, text: l.text, type: l.type, url: l.url }), c)).join('') + '</div>' })
  if (files.length) sections.push({ h: '相关文件', n: files.length, html: '<div class="dpb-chips">' + files.map((x) => chipHtml('file', x.title || x.path.replace(/\/+$/, '').split('/').pop() || x.path, x.path, fileText({ id: x.id, path: x.path, title: x.title, exists: snap?.files?.[x.path] !== false }), c)).join('') + '</div>' })
  const meta: DetailMeta[] = [{ t: t.done ? '已完成' : '未完成', cls: t.done ? 'ok' : '' }]
  if (t.type) meta.push({ t: t.type })
  if (t.due) meta.push({ t: '截止 ' + t.due.slice(5) })
  if (t.created) meta.push({ t: '添加 ' + when(t.created) + ' · 修改 ' + when(t.updated ?? t.created) })
  const tc = tcHtml(c.id, t, sub, ro)
  if (tc) meta.push({ html: tc })
  if (!sections.length) sections.push({ h: '详情', html: '<div class="dpb-e">还没有说明、链接或文件' + (ro ? '' : '<button type="button" class="btn sm" data-dpbedit>补充详情</button>') + '</div>' })
  return {
    kind: sub ? 'subtask' : 'task', bkind: sub ? 'sub' : 'task', source: 'card', id, cardId: c.id, badge: what,
    ctx: c.t + (f.parent ? ' › ' + f.parent.text : ''), title: t.text, meta,
    quote: (t.note ?? '').trim() || t.text, actions: ro ? ['quote'] : ['quote', 'edit'],
    foot: '任务详情 · 点右上角引号复制说明全文', sections,
  }
}

/* ── 模型：相关说明 ═════════════════════════════════════════════════════ */
export function noteModel(c: Card | null, title: string, ctx: BubbleCtx, fallback?: string, cardTitle?: string): DetailModel | null {
  const n = c ? (c.noteItems ?? []).find((x) => x.t === title) : null
  const body = n ? String(n.v ?? '') : String(fallback ?? '')
  if (!n && !fallback) return null
  const meta: DetailMeta[] = []
  if (n) meta.push({ t: n.off ? '不注入 Agent 会话' : '自动注入 Agent 会话', cls: n.off ? 'off' : 'ok' })
  meta.push({ t: body.length + ' 字' })
  return {
    kind: 'note', bkind: 'note', source: n ? 'card' : 'chip', id: title, cardId: c?.id, badge: '相关说明',
    ctx: c ? c.t : (cardTitle || '卡片'), title, meta, quote: '「' + title + '：' + body + '」', actions: ['quote'],
    foot: '相关说明 · 点右上角引号复制引用原文',
    sections: [{ h: '全文', html: '<div class="dpb-note">' + (c ? readHtml(body, c, ctx.snap?.() ?? null) : esc(body)) + '</div>' }],
  }
}

/* ── 模型：知识卡（先摘要态、getKbCard 回来 refresh）═════════════════════ */
function kbMeta(k: KbCardFull, att: number): DetailMeta[] {
  const meta: DetailMeta[] = [
    { t: KB_TYPE_LABEL[k.type] ?? k.type, cls: 'brand' },
    { t: KB_STATUS_LABEL[k.status] ?? k.status, cls: k.status === 'verified' ? 'ok' : k.status === 'stale' ? 'warn' : '' },
  ]
  if (k.tags.length) meta.push({ t: '#' + k.tags.join('  #') })
  if (k.updated) meta.push({ t: '更新 ' + when(k.updated) })
  meta.push({ t: String(k.body ?? '').length + ' 字' })
  if (att) meta.push({ t: '挂载 ' + att + ' 张项目卡' })
  return meta
}

function kbSections(k: KbCardFull, info: KbCardInfo): DetailSection[] {
  const sections: DetailSection[] = []
  if (String(k.body ?? '').trim()) sections.push({ h: '正文', html: '<div class="dpb-md">' + kbMarkdown(k.body) + '</div>' })
  if (k.contains.length) {
    const idx = kbIndex ?? []
    sections.push({
      h: '子卡', n: k.contains.length,
      html: '<div class="dpb-chips">' + k.contains.map((id) => {
        const x = idx.find((y) => y.id === id)
        return '<button type="button" class="dpb-kbgo" data-dpbkbnav="' + esc(id) + '"><span class="dpb-kbi">' + DP_IC.kb + '</span>' + esc(x?.title ?? id) + (x ? '<i>· ' + esc(KB_TYPE_LABEL[x.type] ?? x.type) + '</i>' : '') + '</button>'
      }).join('') + '</div>',
    })
  }
  if (info.attachedBy.length) sections.push({
    h: '挂在哪些项目卡', n: info.attachedBy.length,
    html: '<div class="dpb-chips">' + info.attachedBy.map((a) => '<button type="button" class="dpb-kbgo" data-dpbcard="' + esc(a.cardId) + '"><span class="dpb-kbi">' + DP_IC.card + '</span>' + esc(a.title) + '<i>· ' + esc(a.group) + '</i></button>').join('') + '</div>',
  })
  if (!sections.length) sections.push({ h: '正文', html: '<div class="dpb-e">这张知识卡还没有正文</div>' })
  return sections
}

function kbModel(k: KbCardFull, info: KbCardInfo): DetailModel {
  return {
    kind: 'kb', bkind: 'kb', source: 'kb', id: k.id, badge: '知识卡', ctx: '知识库', title: k.title,
    lead: (k.summary ?? '').trim() || undefined, meta: kbMeta(k, info.attachedBy.length),
    quote: '「“' + k.title + '”知识卡（' + k.path + '）」', actions: ['quote'], path: k.path, kb: info,
    sections: kbSections(k, info),
  }
}

function kbStub(ref: { id: string; title: string; type: string; status: string; summary: string; path: string }, ctx: BubbleCtx): DetailModel {
  /* 摘要态：先让气泡立刻出来（真机网络慢时不空等），全文回来再 refresh */
  return {
    kind: 'kb', bkind: 'kb', source: 'kb', id: ref.id, badge: '知识卡', ctx: '知识库', title: ref.title,
    lead: ref.summary || undefined,
    meta: [{ t: KB_TYPE_LABEL[ref.type] ?? ref.type, cls: 'brand' }, { t: (KB_STATUS_LABEL as Record<string, string>)[ref.status] ?? ref.status, cls: ref.status === 'verified' ? 'ok' : ref.status === 'stale' ? 'warn' : '' }],
    quote: '「“' + ref.title + '”知识卡（' + ref.path + '）」', actions: ['quote'], path: ref.path,
    sections: [], busy: '正在读取正文…',
  }
}

function ensureKbIndex(): void {
  if (kbIndex) return
  void getKb().then((r) => { kbIndex = r.cards })
    .catch(() => undefined)
}

export function openKb(ctx: BubbleCtx, ref: KbRef | { id: string; title?: string; type?: string; status?: string; summary?: string; path?: string }, anchor?: HTMLElement | null): void {
  wire()
  const id = ref.id
  if (!id) { ctx.toast('找不到这张知识卡', 'err'); return }
  ensureKbIndex()
  const stub = kbStub({ id, title: ref.title ?? id, type: ref.type ?? 'howto', status: ref.status ?? 'draft', summary: ref.summary ?? '', path: ref.path ?? '' }, ctx)
  openModel(ctx, stub, anchor)
  const load = (): void => {
    void getKbCard(id).then((info) => {
      if (!bubbleIsOpen('kb', id)) return
      const e = el
      if (!e) return
      /* 只换数据不换身份：位置 / 箭头 / 栈都不动 */
      const model = kbModel(info.card, info)
      if (model.lead == null && stub.lead) model.lead = stub.lead
      rewrite(model)
    }).catch((er) => {
      if (!bubbleIsOpen('kb', id)) return
      ctx.toast('读知识卡失败：' + (er instanceof Error ? er.message : String(er)), 'err')
      rewrite({ ...stub, busy: '', sections: [], retry: load })
    })
  }
  load()
}

/** 原地换当前模型（不压栈、不改身份）。 */
function rewrite(model: DetailModel): void {
  if (!cur) return
  cur.model = model
  render(false)
}

/* ── 入口：卡片详情（任务 / 子任务 / 说明）═══════════════════════════════ */
const anchorOf = (kind: DetailKind, id: string): HTMLElement | null => {
  const vis = (x: HTMLElement): boolean => x.getClientRects().length > 0
  if (kind === 'note') return Array.from(document.querySelectorAll<HTMLElement>('.detail .nk[data-nk]')).find((n) => vis(n) && n.querySelector('.nk-t')?.textContent === id) ?? null
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.detail .task[data-tid="' + CSS.escape(id) + '"]')).filter(vis)
  const row = rows[0]
  if (!row) return null
  return (row.querySelector(':scope > .tkhead') as HTMLElement | null) ?? row
}

/** 详情整块重画会把锚点换掉（点击任务标题本身就会重画一次）→ 按 id 重新找回来，别把气泡关掉。 */
function reanchor(): boolean {
  if (!cur) return false
  if (cur.anchor && cur.anchor.isConnected) return true
  const a = anchorOf(cur.model.kind, cur.model.id)
  if (!a) { closeBubble(); return false }
  cur.anchor = a
  watch(a)
  return true
}

export function openTask(ctx: BubbleCtx, card: Card, id: string, anchor?: HTMLElement | null): void {
  wire()
  const model = taskModel(card, id, ctx)
  if (!model) return
  const a = anchor ?? anchorOf(model.kind, id)
  if (cur && a && cur.anchor === a && keyOf(cur.model) === keyOf(model)) { closeBubble(); return }
  openModel(ctx, model, a)
}

export function openNote(ctx: BubbleCtx, card: Card | null, title: string, fallback?: string, anchor?: HTMLElement | null): void {
  wire()
  const model = noteModel(card, title, ctx, fallback)
  if (!model) { ctx.toast('这条相关说明已经不在了', 'err'); return }
  const a = anchor ?? (card ? anchorOf('note', title) : null)
  if (cur && a && cur.anchor === a && keyOf(cur.model) === keyOf(model)) { closeBubble(); return }
  openModel(ctx, model, a)
}

/* ── 入口：引用胶囊（任务弹窗 / 说明框 / 知识卡正文 / DSH 对话框）═════ */
export function openChip(ctx: BubbleCtx, chip: HTMLElement, card?: Card | null): boolean {
  const rk = chip.dataset.rk ?? ''
  if (rk === 'note') {
    const title = chip.dataset.rt ?? (chip.querySelector('.rt')?.textContent ?? '').trim()
    const body = chip.dataset.rb ?? ''
    /* 卡片里有的说明（详情气泡 / 任务弹窗）用卡片数据；编辑器里只有原文 → 原文当全文 */
    const c = card ?? ctx.snap?.()?.board.cards.find((x) => (x.noteItems ?? []).some((n) => n.t === title)) ?? null
    openNote(ctx, c, title, c ? undefined : body, chip)
    return true
  }
  if (rk === 'kb') return openKbChip(ctx, chip)
  return false
}

function openKbChip(ctx: BubbleCtx, chip: HTMLElement): boolean {
  const id = chip.dataset.kbid || chip.dataset.rid || (/\/kb\/([^/]+)\.md/.exec(chip.dataset.rb || chip.dataset.ref || chip.dataset.canon || '') ?? [])[1] || ''
  if (!id) { ctx.toast('这张知识卡已经不在了', 'err'); return true }
  const title = chip.dataset.rt ?? (chip.querySelector('.rt')?.textContent ?? '').trim()
  openKb(ctx, { id, title }, chip)
  return true
}

/** DSH 对话框 / 宿主胶囊：按引用原文找那颗胶囊当锚点（找不到退输入框左上）。 */
export function openRef(ctx: BubbleCtx, o: { kind: string; title: string; body?: string; cardId?: string; cardTitle?: string; kbRefs?: KbRef[]; notes?: Array<{ t: string; v: string }>; source?: string }): boolean {
  if (o.kind === 'note') {
    const n = (o.notes ?? []).find((x) => x.t === o.title)
    const a = findComposerChip(o.title) ?? composerBox()
    const model = noteModel(null, o.title, ctx, n?.v ?? '', o.cardTitle)
    if (!model) { ctx.toast('这条引用内容已经不在了', 'err'); return true }
    openModel(ctx, model, a)
    return true
  }
  if (o.kind === 'kb') {
    const id = (/\/kb\/([^/]+)\.md/.exec(o.body ?? '') ?? [])[1] ?? ''
    const ref = (o.kbRefs ?? []).find((x) => x.id === id) ?? { id, title: o.title, path: o.body ?? '' }
    openKb(ctx, ref, findComposerChip(o.title) ?? composerBox())
    return true
  }
  return false
}

function findComposerChip(title: string): HTMLElement | null {
  const list = Array.from(document.querySelectorAll<HTMLElement>('[data-composer-chip]')).filter(visible)
  return list.find((x) => (x.textContent ?? '').trim() === title) ?? list.find((x) => (x.textContent ?? '').includes(title)) ?? null
}
function composerBox(): HTMLElement | null {
  return document.querySelector('.ss-composer, [data-composer], .composer')
}

/* ── 气泡内交互 ═════════════════════════════════════════════════════════ */
function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement
  if (!cur) return
  if (t.closest('[data-dpbx]')) { e.preventDefault(); closeBubble(); return }
  if (t.closest('[data-dpbback]')) { e.preventDefault(); back(); return }
  const q = t.closest('[data-dpbq]') as HTMLElement | null
  if (q) { e.preventDefault(); cur.ctx.quote?.(q.dataset.dpbq ?? ''); return }
  const retry = t.closest('[data-dpbretry]')
  if (retry) { e.preventDefault(); cur.model.retry?.(); return }
  const edit = t.closest('[data-dpbedit]')
  if (edit) {
    e.preventDefault()
    const cid = cur.model.cardId
    const ctx = cur.ctx
    const id = cur.model.id
    closeBubble()
    if (cid) ctx.edit?.(cid, id)
    return
  }
  const kbo = t.closest('[data-dpbkb]') as HTMLElement | null
  if (kbo) {
    e.preventDefault()
    if (kbEditingNow(cur.ctx)) { cur.ctx.toast('正在编辑知识卡：先保存或取消，再打开知识库', 'err'); return }
    const id = kbo.dataset.dpbkb ?? ''
    const ctx = cur.ctx
    const go = ctx.kbOpen ?? kbOpener
    closeBubble()
    go?.(id)
    return
  }
  const go = t.closest('[data-dpbgo]') as HTMLElement | null
  if (go) {
    e.preventDefault()
    const cid = cur.model.cardId; const c = cid ? cur.ctx.snap?.()?.board.cards.find((x) => x.id === cid) : null
    if (!c) return
    const m = taskModel(c, go.dataset.dpbgo ?? '', cur.ctx)
    if (m) bubbleNav(m, go)
    return
  }
  const kbn = t.closest('[data-dpbkbnav]') as HTMLElement | null
  if (kbn) {
    e.preventDefault()
    const id = kbn.dataset.dpbkbnav ?? ''
    const x = (kbIndex ?? []).find((y) => y.id === id)
    openKb(cur.ctx, { id, title: x?.title, type: x?.type, status: x?.status, summary: x?.summary, path: x?.path }, kbn)
    return
  }
  const card = t.closest('[data-dpbcard]') as HTMLElement | null
  if (card) { e.preventDefault(); const id = card.dataset.dpbcard ?? ''; const ctx = cur.ctx; closeBubble(); ctx.openCard?.(id); return }
  const ch = t.closest('.nref') as HTMLElement | null
  if (ch) { e.preventDefault(); chipInBubble(ch); return }
}

/** 气泡里的胶囊：说明 / 知识卡 = 下钻；其余照原来的动作。 */
function chipInBubble(ch: HTMLElement): void {
  if (!cur) return
  const k = ch.dataset.rk, title = ch.dataset.rt ?? '', body = ch.dataset.rb ?? ''
  const ctx = cur.ctx
  ;(window as unknown as Record<string, unknown>).__dpmDpChip = { k, title, body, at: nowMs() }
  if (k === 'note') {
    const cid = cur.model.cardId
    const c = cid ? ctx.snap?.()?.board.cards.find((x) => x.id === cid) : null
    const m = noteModel(c ?? null, title, ctx, c ? undefined : body)
    if (m) bubbleNav(m, ch); else ctx.toast('这条相关说明已经不在了', 'err')
    return
  }
  if (k === 'kb') { openKbChip(ctx, ch); return }
  if (k === 'link') { window.open(body, '_blank', 'noopener'); return }
  if (k === 'file') {
    const cid = cur.model.cardId
    const c = cid ? ctx.snap?.()?.board.cards.find((x) => x.id === cid) : null
    const f = (c?.files ?? []).find((x) => x.path === body)
    void openFileSmart({ card: cid ?? '', file: f?.id ?? '', path: body, name: title }).then((r) => { if (r.how === 'rightbar') ctx.toast(openedHow(r) + '「' + title + '」') }).catch((er) => ctx.toast('打不开这个文件：' + (er instanceof Error ? er.message : String(er)), 'err'))
    return
  }
  if (k === 'repo') { void post('fs/open-local', { path: body }).catch((er) => ctx.toast('打不开这个文件夹：' + (er instanceof Error ? er.message : String(er)), 'err')); return }
  if (k === 'card') {
    const x = ctx.snap?.()?.board.cards.find((y) => y.t === title)
    if (x) { closeBubble(); ctx.openCard?.(x.id) } else ctx.toast('找不到这张卡片：' + title, 'err')
    return
  }
  const s = (ctx.sessions?.() ?? []).find((x) => x.title === title)
  if (s) ctx.openSession?.(s.id); else ctx.toast('找不到这个会话：' + title, 'err')
}

/* ── 探针（验收直读，不靠肉眼）═════════════════════════════════════════ */
function probeInstall(): void {
  const w = window as unknown as Record<string, unknown>
  w.__dpmDp = (): unknown => {
    if (!cur || !el) return null
    const b = el.querySelector('.dpb-b')
    return {
      kind: cur.model.kind, id: cur.model.id, title: cur.model.title, badge: cur.model.badge, source: cur.model.source,
      mode: cur.mode, stack: stack.map((x) => x.model.kind + ':' + x.model.id),
      rect: el.getBoundingClientRect().toJSON(), body: b ? b.getBoundingClientRect().toJSON() : null,
      dir: el.classList.contains('arr-r') ? 'r' : el.classList.contains('arr-b') ? 'b' : el.classList.contains('arr-t') ? 't' : '',
      meta: Array.from(el.querySelectorAll('.dpb-mc, .dpb-mcx')).map((x) => (x.textContent ?? '').trim()),
      sections: Array.from(el.querySelectorAll('.dpb-s')).map((s) => ((s.querySelector('.dpb-sh')?.textContent) ?? '').trim()),
      chips: Array.from(el.querySelectorAll('.nref')).map((c) => ({ k: (c as HTMLElement).dataset.rk, t: ((c.querySelector('.rt')?.textContent) ?? '').trim(), gold: c.classList.contains('gold') })),
      host: el.parentElement === document.body ? 'body' : ((el.parentElement?.id || el.parentElement?.tagName) ?? ''),
      src: cur.anchor ? cur.anchor.className : '',
      foot: (el.querySelector('.dpb-f')?.textContent ?? '').trim(),
    }
  }
}
