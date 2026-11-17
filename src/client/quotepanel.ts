/**
 * v165「引用伴手弹窗」= 唯一一份组件（原型 dsh-web-v165.html 一比一落地）。
 *
 * 四处编辑器（DSH 对话框 / 卡片任务说明 / 卡片相关说明 / 知识卡正文）只调 openQuotePanel：
 * 传「在哪、给哪几类、加不加新增并引用、插到哪」，面板自己负责外壳 / 八类渲染 / 任务树 / 开合 /
 * 贴顶 / 快速定位 / 过滤 / 键盘 / 镶金 / 插入回调。
 *
 * v166 三改（原型 dsh-web-v166.html 一比一落地）：
 *  ① 开合 + 滚动位置按「项目卡片」记住（localStorage；四个入口共享、换卡隔离、刷新保持）；
 *  ② 定位锚点 = 触发物（会话信息卡按钮 / 信息卡 / 说明框），不是输入框；打开即冻结位置；
 *  ③ 滚动跟手：渲染时量一次几何（offsetTop，避开入场动画 scale 的污染），滚动只读 scrollTop；
 *     快速定位去掉 900ms 锁，改成 aim 描边（意图）+ on 实心（真实位置）两态。
 *
 * 原型踩过的两个坑（这里必须保持）：
 *  1) 类头 / 任务行是两层 sticky：任务行要包在 .qpn-taskwrap 里，否则多个任务会叠在同一位置；
 *  2) 吸顶前沿线用 .qpn-g.stuck::after 画「方角直线」，不能用 inset box-shadow —— inset 会跟着
 *     11px 圆角在两端弯下去，弯头压在卡片竖边框上，就是用户看到的「边框线多出来一段」。
 */
import { esc } from './icons.js'
import type { QpSec } from '../sections.js'

export type QpWhere = 'composer' | 'task' | 'note' | 'kb'
/** v171：这块面板的两种身份（同一份代码 / 同一套 UI，永不双开）。 */
export type QpKind = 'quote' | 'kb'

export interface QpSub { id: string; title: string; chip?: string; text: string
  /** v179：带标题分割线拆出来的段（有才在行上出「N 段」） */
  secs?: QpSec[] }
/** 一行的数据（叶子 / 任务）。text = 插入的引用原文（任务 = 说明全文）。 */
export interface QpItem {
  kind?: 'task' | 'leaf'
  id: string
  title: string
  /** 右侧小胶囊：类型 / 不注入 / 卡片组 */
  chip?: string
  /** 右侧次要信息：摘要 / 主机名 / 路径 / 会话当前标 */
  meta?: string
  gold?: boolean
  gone?: boolean
  /** 图标名（task / note / kb / link / file / repo / cards / chat） */
  icon?: string
  text: string
  subs?: QpSub[]
  subDone?: number
  subTotal?: number
  /** v171：知识卡的标签（面板据此做「标签」筛选；facet 计数也在面板里算，与知识库页同口径） */
  tags?: string[]
  /** v171：匹配字段（标题 + 摘要 + 标签 + 类型名 + 状态 + id）；不给就退回 title / meta / chip */
  hay?: string
  /** v171：右侧状态胶囊的额外 class（st-draft 虚线 / st-stale 琥珀） */
  chipCls?: string
  /** v171：底栏「将插入 …」后面那句（引用原文（画成胶囊）/ 提示词正文（原文插入）） */
  ins?: string
  /** v179：带标题分割线拆出来的段（有才在行上出「N 段」、悬停展开分段列表） */
  secs?: QpSec[]
}
export interface QpGroup { key: string; name: string; icon?: string; /** v171：类型图标（复用知识库页 GLΓPH 的六条 path） */ iconSvg?: string; hint?: string; empty?: string; items: QpItem[] }
export interface QpHit { len: number; q: string; ch?: string }

export type QpAddKind = 'note' | 'link' | 'file' | 'repo'
export type QpCloseHow = 'esc' | 'pick' | 'outside' | 'api'

export interface QpOpenOpts {
  where: QpWhere
  /** v171：身份（缺省 quote）；kind 参与「同一块面板」判定 —— 切换身份整块重建 */
  kind?: QpKind
  /** 顶部上下文标签 + 底栏「同一个组件 · X」*/
  label: string
  /** 顶部副标题里的卡片名 */
  card?: string
  /** 定位基准（编辑器 / 输入框外层）：也是「点在它里面不关面板」的那块 */
  anchor: HTMLElement
  /** v166：真正被点的按钮（会话信息卡「> 引用卡片内容」）；给了就按它定位 */
  trigger?: HTMLElement
  /** v166：定位兜底（信息卡整块 / 说明框）；不给就用 anchor */
  place?: HTMLElement
  /** v166：卡片 id —— 给了才启用「开合 + 滚动位置」记忆（键 = 'qp:' + cardId） */
  cardId?: string
  /** 面板挂哪：任务弹窗必须挂 dialog（top layer），否则被盖住 */
  host?: HTMLElement
  hit: QpHit
  build: () => QpGroup[]
  /** 给了就显示「新增并引用」一行（只在项目卡上下文）；hit 给的是点下去那一刻的「>」信息 */
  add?: (kind: QpAddKind, hit: QpHit) => void
  insert: (text: string, hit: QpHit, item: QpItem) => void
  toast?: (msg: string, kind?: 'ok' | 'err') => void
  /** 面板自己关掉时通知（esc = 用户主动收起，调用方要「别立刻重开」）*/
  onClose?: (how: QpCloseHow) => void
}

/* ── 图标（与原型同一套 path） ─────────────────────────────── */
const PATH: Record<string, string> = {
  task: '<rect x="4" y="4" width="16" height="16" rx="4.4"/><path d="m8 12 2.5 2.5L15.8 9"/>',
  note: '<path d="M6 3.8h8.6L18.5 8v12.2H6z"/><path d="M14.4 3.8V8h4.1"/><path d="M9 11.6h6.6M9 15.2h5"/>',
  kb: '<path d="M12 6.6C9.9 5.3 7.4 5 4.6 5.6v12.6c2.8-.6 5.3-.3 7.4 1 2.1-1.3 4.6-1.6 7.4-1V5.6C16.6 5 14.1 5.3 12 6.6Z"/><path d="M12 6.6v12.6"/>',
  link: '<path d="M10.2 13.8a3.4 3.4 0 0 0 4.8 0l3-3a3.4 3.4 0 0 0-4.8-4.8l-1 1"/><path d="M13.8 10.2a3.4 3.4 0 0 0-4.8 0l-3 3a3.4 3.4 0 0 0 4.8 4.8l1-1"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  repo: '<path d="M3.6 6.6h6l2 2.4h8.8v9.4H3.6z"/><path d="M3.6 9h16.8"/>',
  cards: '<rect x="4" y="6.2" width="12" height="14" rx="2.4"/><path d="M8.2 3.4h8.4A3.2 3.2 0 0 1 19.8 6.6v8.8"/>',
  chat: '<path d="M4 6.6h16v9.2H9.2L4 19.6z"/>',
  chev: '<path d="m6.5 9.2 5.5 5.4 5.5-5.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  star: '<path d="M12 2.6l2.9 5.9 6.5 1-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-1z"/>',
  quote: '<path d="M8.2 6.6H5.4v5.2h2.8L6 16.4h2.2l2.4-4.6V6.6zm8 0h-2.8v5.2h2.8L14 16.4h2.2l2.4-4.6V6.6z"/>',
  filter: '<circle cx="10.8" cy="10.8" r="5.6"/><path d="m15 15 4.4 4.4"/>',
  layers: '<path d="m12 4 8 4.2-8 4.2-8-4.2z"/><path d="m4 12.4 8 4.2 8-4.2M4 16.2l8 4.2 8-4.2"/>',
  bookmark: '<path d="M6.6 4.4h10.8v15.2L12 15.4l-5.4 4.2z"/>',
  div: '<path d="M3.8 9.4h6.2M14 9.4h6.2"/><path d="M12 13.4v5.2"/><circle cx="12" cy="9.4" r="1.15"/>',
}
const sv = (n: string, cls?: string): string => '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true">' + (PATH[n] ?? '') + '</svg>'
const starChip = (): string => '<span class="qpn-star">' + sv('star') + '星标</span>'

interface MemScroll { sec: string; off: number; pos: number }
interface GeoTask { el: HTMLElement; id: string; top: number; wrapH: number; stuck: boolean | null }
interface GeoSec { key: string; el: HTMLElement; head: HTMLElement; top: number; h: number; tasks: GeoTask[]; stuck: boolean | null; cut: boolean | null }

type Row =
  | { type: 'g'; key: string; sec: QpGroup; title: string; n: number; first?: boolean }
  | { type: 'task'; item: QpItem; open: boolean; can: boolean; title: string; subs?: QpSub[] }
  | { type: 'sub'; item: QpSub; title: string; parent: string }
  | { type: 'leaf'; item: QpItem; title: string }

interface Stat {
  open: boolean
  el: HTMLElement | null
  where: QpWhere | ''
  /** v171：这块面板现在是哪种身份（quote / kb） */
  kind: QpKind
  /** v171：当前选中的标签（kb 身份；'清除' / 再点同一个 = 回到空） */
  tag: string
  /** v171：上一次画的时候选中的标签 —— 换了就把列表拉回顶部 */
  lastTag: string
  label: string
  card: string
  cardId: string
  /** 'qp:<cardId>'；空 = 不记忆（知识卡正文） */
  memKey: string
  anchor: HTMLElement | null
  host: HTMLElement | null
  hit: QpHit
  ctx: QpOpenOpts | null
  rows: Row[]
  hi: number
  hiEl: HTMLElement | null
  secClosed: Set<string>
  taskOpen: Set<string>
  lastQ: string
  curKey: string
  locSig: string
  locBtns: Record<string, HTMLElement> | null
  locOn: string
  aimKey: string
  /** v171.1：平滑滚动期间钉住的「当前位置」（点了快速定位，别被顶边算法覆盖回去） */
  locPin: { key: string; until: number } | null
  aimT: number
  aimArm: (() => void) | null
  raf: number
  geo: GeoSec[]
  memScroll: MemScroll | null
  scrollT: number
  restored: boolean
  cancelled: ((e: Event) => void) | null
  /* v179：分段列表（挂在面板外侧的浮层，一行一个） */
  secEl: HTMLElement | null
  secKey: string
  secRow: HTMLElement | null
  secT: number
  secH: number
  secPin: boolean
  /** 指针是否还停在面板 / 分段列表里（面板被重画时据此决定要不要把分段列表接回来） */
  secHot: boolean
}

const P: Stat = {
  open: false, el: null, where: '', kind: 'quote', tag: '', lastTag: '', label: '', card: '', cardId: '', memKey: '', anchor: null, host: null,
  hit: { len: 0, q: '', ch: '>' }, ctx: null, rows: [], hi: -1, hiEl: null,
  secClosed: new Set(), taskOpen: new Set(), lastQ: '', curKey: '', locSig: '', locBtns: null, locOn: '',
  aimKey: '', locPin: null, aimT: 0, aimArm: null, raf: 0, geo: [], memScroll: null, scrollT: 0, restored: false, cancelled: null,
  secEl: null, secKey: '', secRow: null, secT: 0, secH: 0, secPin: false, secHot: false,
}

const q = (s: string, r?: ParentNode | null): HTMLElement | null => (r ?? document).querySelector(s) as HTMLElement | null
const qa = (s: string, r?: ParentNode | null): HTMLElement[] => [...(r ?? document).querySelectorAll(s)] as HTMLElement[]

/* ── 面板 DOM（一次创建；重画只换列表） ─────────────────────── */
function build(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'qpn'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '引用卡片内容')
  el.innerHTML = '<div class="qpn-h">'
    + '<span class="qpn-hi">' + sv('quote') + '</span>'
    + '<span class="qpn-ht"><b>引用卡片内容</b><span class="qpn-sub"></span></span>'
    + '<span class="qpn-hq" hidden>' + sv('filter') + '<span></span></span>'
    + '<span class="qpn-grow"></span>'
    + '<button class="qpn-mem" type="button" hidden title="这张卡片的开合 + 滚动位置已记住：跨会话 / 跨入口 / 刷新页面都保持；点一下恢复默认（全部展开 + 回到顶部）"><svg viewBox="0 0 24 24" aria-hidden="true">' + (PATH.bookmark ?? '') + '</svg><span></span></button>'
    + '<span class="qpn-ctx">' + sv('layers') + '<span></span></span>'
    + '<button class="qpn-x" type="button" aria-label="关闭引用弹窗（Esc）" title="关闭（Esc）">' + sv('close') + '</button>'
    + '</div>'
    + '<div class="qpn-loc" role="toolbar" aria-label="快速定位分区"><span class="l">快速定位</span><span class="qpn-lbs"></span></div>'
    /* v171：知识卡身份才有的一条筛选（固定「标签」+ 可横向滚动的胶囊区 + 钉在右端的「清除」） */
    + '<div class="qpn-tags" hidden><span class="l">标签</span><span class="qpn-tgbs" role="group" aria-label="按标签筛选知识卡"></span>'
    + '<button class="qpn-tagx" type="button" hidden data-tagx title="清除标签筛选（回到全部知识卡）">清除</button></div>'
    + '<div class="qpn-list" role="list"></div>'
    + '<div class="qpn-add" hidden><span class="l">新增并引用</span>'
    + '<button type="button" class="qadd" data-qadd="note" title="新增并引用：相关说明">' + sv('plus') + '<span>+说明</span></button>'
    + '<button type="button" class="qadd" data-qadd="link" title="新增并引用：相关链接">' + sv('plus') + '<span>+链接</span></button>'
    + '<button type="button" class="qadd" data-qadd="file" title="新增并引用：相关文件">' + sv('plus') + '<span>+文件</span></button>'
    + '<button type="button" class="qadd" data-qadd="repo" title="新增并引用：仓库">' + sv('plus') + '<span>+仓库</span></button>'
    + '<span class="h">插入光标处 · 链接 / 文件自动关联这个任务</span></div>'
    + '<div class="qpn-foot"><span class="qpn-pv"></span>'
    + '<span class="qpn-keys"><kbd>↑</kbd><kbd>↓</kbd><span class="qpn-kx">选择</span><kbd>↵</kbd><span class="qpn-kx">插入</span><kbd>←</kbd><kbd>→</kbd><span class="qpn-kx">开合</span><kbd>esc</kbd><span class="qpn-kx">关闭</span><span class="qpn-share"></span></span></div>'
  el.addEventListener('mousedown', (e) => { e.preventDefault() })
  el.addEventListener('click', onClick)
  el.addEventListener('mouseover', onHover)
  /* v179：鼠标离开面板（走进分段列表 / 走到外面）→ 220ms 后收起；进列表时列表自己取消 */
  el.addEventListener('mouseenter', () => { P.secHot = true })
  el.addEventListener('mouseleave', () => { P.secHot = false; secSoon() })
  q('.qpn-x', el)?.addEventListener('click', () => close())
  q('.qpn-list', el)?.addEventListener('scroll', onScroll, { passive: true })
  q('.qpn-tgbs', el)?.addEventListener('scroll', fadeTags, { passive: true })
  return el
}

/* ── 打开 / 同步 ─────────────────────────────────────────────── */
export function openQuotePanel(o: QpOpenOpts): void {
  const kind: QpKind = o.kind === 'kb' ? 'kb' : 'quote'
  /* kind 参与「同一块面板」判定：同一个锚点换来换去两种身份时整块重建，永不双开 */
  const same = P.open && !!P.el && P.where === o.where && P.kind === kind && P.anchor === o.anchor && document.contains(P.el)
  if (!same) {
    close()
    P.open = true
    P.where = o.where
    P.kind = kind
    P.tag = ''; P.lastTag = ''
    P.label = o.label || ''
    P.anchor = o.anchor
    P.host = o.host ?? null
    P.hit = { len: o.hit.len || 0, q: o.hit.q || '', ch: o.hit.ch || '>' }
    P.ctx = o
    P.card = o.card ?? ''
    P.rows = []; P.hi = -1; P.hiEl = null; P.lastQ = ''; P.curKey = ''; P.locSig = ''; P.locOn = ''
    P.locBtns = null; P.geo = []; P.aimKey = ''
    P.cardId = o.cardId ?? ''
    /* v171：两种身份各记各的（qp:<cardId> / kbq:<cardId>），互不覆盖 */
    P.memKey = P.cardId ? (kind === 'kb' ? 'kbq:' : 'qp:') + P.cardId : ''
    const mem = memRead(P.memKey)
    P.secClosed = new Set(mem.sec)
    P.taskOpen = new Set(mem.task)
    P.memScroll = mem.scroll
    P.restored = false; P.scrollT = 0
    P.el = build()
    const ctxEl = q('.qpn-ctx span', P.el)
    if (ctxEl) ctxEl.textContent = P.label
    const share = q('.qpn-share', P.el)
    if (share) share.textContent = '同一个组件 · ' + P.label
    /* v171：身份三处 —— 图标 = 绿色开卷书、标题「引用知识卡」、aria-label 同步 */
    const kb = kind === 'kb'
    P.el.classList.toggle('kb', kb)
    const hi = q('.qpn-hi', P.el)
    if (hi) hi.innerHTML = sv(kb ? 'kb' : 'quote')
    const title = q('.qpn-ht b', P.el)
    if (title) title.textContent = kb ? '引用知识卡' : '引用卡片内容'
    P.el.setAttribute('aria-label', kb ? '引用知识卡' : '引用卡片内容')
    const xb = q('.qpn-x', P.el)
    if (xb) xb.setAttribute('aria-label', (kb ? '关闭知识卡引用弹窗（Esc）' : '关闭引用弹窗（Esc）'))
    const lb = q('.qpn-loc', P.el)
    if (lb) lb.setAttribute('aria-label', kb ? '快速定位类型' : '快速定位分区')
    /* 「新增并引用」是项目卡专属：知识卡身份永远不出现这一行 */
    if (o.add && !kb) { const a = q('.qpn-add', P.el); if (a) a.hidden = false }
    ;(o.host ?? document.body).append(P.el)
    if (o.host) {
      P.cancelled = (e: Event): void => { if (P.open) e.preventDefault() }
      o.host.addEventListener('cancel', P.cancelled)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', relayout)
    paint()
    pos()
    restoreScroll()
    return
  }
  P.hit = { len: o.hit.len || 0, q: o.hit.q || '', ch: o.hit.ch || '>' }
  P.ctx = o
  if (P.el) {
    const a = q('.qpn-add', P.el)
    if (a) a.hidden = !o.add || P.kind === 'kb'
  }
  paint()
  /* v166：这里故意不再 pos() —— 面板打开后位置冻结，打字 / 输入框变高 / 光标移动都不跟着跑 */
}

/** 关：only 给了就只关对应上下文（对话框 blur 不会把任务说明的弹窗关掉）。 */
export function closeQuotePanel(only?: QpWhere, how: QpCloseHow = 'api'): void {
  if (!P.open) return
  if (only && only !== P.where) return
  if (P.memKey) memWrite()
  if (P.scrollT) { clearTimeout(P.scrollT); P.scrollT = 0 }
  const onClose = P.ctx?.onClose
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDown, true)
  window.removeEventListener('resize', relayout)
  if (P.host && P.cancelled) P.host.removeEventListener('cancel', P.cancelled)
  secDrop()
  P.el?.remove()
  if (P.aimT) { clearTimeout(P.aimT); P.aimT = 0 }
  P.aimKey = ''; P.aimArm = null
  if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0 }
  P.open = false; P.el = null; P.anchor = null; P.host = null; P.rows = []; P.hi = -1; P.hiEl = null; P.ctx = null; P.cancelled = null
  P.geo = []; P.memKey = ''; P.cardId = ''; P.memScroll = null; P.locBtns = null; P.locOn = ''; P.restored = false
  if (onClose) { try { onClose(how) } catch (e) { console.error('[dsh-project-manager] onClose', e) } }
}
export const isQuotePanelOpen = (): boolean => P.open
/** v171：现在开着的是哪种身份（宿主刷新面板时要按 identity 重开，不能一律换成「引用卡片内容」） */
export const quotePanelKind = (): QpKind => (P.open ? P.kind : 'quote')
export const quotePanelWhere = (): QpWhere | '' => (P.open ? P.where : '')
export const quotePanelHit = (): QpHit => P.hit
export const quotePanelEl = (): HTMLElement | null => P.el

/* ── 数据 → 行 ──────────────────────────────────────────────── */
const matchAll = (it: QpItem, ql: string): boolean => !ql || (it.hay ?? ((it.title || '') + ' ' + (it.meta ?? '') + ' ' + (it.chip ?? ''))).toLowerCase().includes(ql)
const hitSub = (s: QpSub, ql: string): boolean => !ql || ((s.title || '') + ' ' + (s.chip ?? '')).toLowerCase().includes(ql)
function hl(text: string | null | undefined, ql: string): string {
  const s = String(text ?? '')
  if (!ql) return esc(s)
  const i = s.toLowerCase().indexOf(ql)
  if (i < 0) return esc(s)
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + ql.length)) + '</mark>' + esc(s.slice(i + ql.length))
}

function paint(): void {
  /* v179：重画会换掉行节点。指针还停在面板 / 分段列表里（或已钉住）时，重画完把列表按 data-i 接回同一行；
     否则收起 —— 不接回的话任务弹窗的周期刷新会在 1s 左右把用户正在看的分段列表整个抽走。 */
  const keepSec = P.secEl && !P.secEl.hidden ? P.secKey : ''
  const keepPin = P.secPin
  const keepHot = P.secHot
  if (P.secEl) secHide()
  if (!P.el) return
  const qq = String(P.hit.q || '').trim()
  const ql = qq.toLowerCase()
  const list = q('.qpn-list', P.el)
  if (!list) return
  const prev = list.scrollTop
  const groups = P.ctx?.build() ?? []
  /* v171：标签筛选只在知识卡身份生效；facet 计数按「输入词」算、不含标签自己（与知识库页 v168 同口径） */
  const tagOn = P.kind === 'kb' ? P.tag : ''
  const facets: Record<string, number> = {}
  if (P.kind === 'kb') for (const g of groups) for (const it of g.items) for (const t of it.tags ?? []) facets[t] = (facets[t] ?? 0) + 1
  let html = ''
  let total = 0
  const rows: Row[] = []
  const secs: Array<{ g: QpGroup; cnt: number; openSec: boolean }> = []
  for (const g of groups) {
    const vis: Array<{ it: QpItem; selfHit: boolean; subs: QpSub[] }> = []
    for (const it of g.items) {
      /* 标签筛掉的卡整张不出现 → 没有剩余卡的类型整组消失（定位条同步收） */
      if (tagOn && !(it.tags ?? []).includes(tagOn)) continue
      const selfHit = matchAll(it, ql)
      const subs = (it.subs ?? []).filter((s) => hitSub(s, ql))
      if (qq && !selfHit && !subs.length) continue
      vis.push({ it, selfHit, subs })
    }
    const openSec = !P.secClosed.has(g.key)
    const cnt = vis.length
    if (!cnt && qq) continue
    if (!cnt && !g.empty && g.key !== 'task') continue
    total += cnt
    secs.push({ g, cnt, openSec })
    html += '<section class="qpn-sec ' + (openSec ? 'open' : 'closed') + '" data-g="' + esc(g.key) + '">'
    html += '<div class="qpn-g" role="button" tabindex="0" aria-expanded="' + openSec + '" data-i="' + rows.length + '" data-g="' + esc(g.key) + '">'
      + '<span class="qpn-cv">' + sv('chev') + '</span>'
      + '<span class="qpn-ic">' + (g.iconSvg ?? sv(g.icon ?? 'note')) + '</span>'
      + '<span class="qpn-nm">' + esc(g.name) + '</span>'
      + '<span class="qpn-cnt">' + cnt + '</span>'
      + (g.hint ? '<span class="qpn-gh">' + esc(g.hint) + '</span>' : '')
      + '</div>'
    rows.push({ type: 'g', key: g.key, sec: g, title: g.name, n: cnt })
    html += '<div class="qpn-body">'
    if (!cnt) {
      html += '<div class="qpn-empty">' + (g.empty ?? '这一类还没有内容') + '</div>'
      const gr = rows[rows.length - 1]
      if (gr && gr.type === 'g') gr.first = true
      html += '</div></section>'
      continue
    }
    for (const v of vis) {
      const it = v.it
      if (it.kind === 'task') {
        const subsAll = it.subs ?? []
        const shownSubs = qq ? (v.selfHit ? subsAll : v.subs) : subsAll
        const can = subsAll.length > 0
        const openTask = can && (P.taskOpen.has(it.id) || (!!qq && v.subs.length > 0))
        const subDone = it.subDone ?? 0
        const subTotal = it.subTotal ?? subsAll.length
        const rid = rows.length
        rows.push({ type: 'task', item: it, open: openTask, can, title: it.title, subs: v.subs })
        html += '<div class="qpn-taskwrap">'
        html += '<div class="qpn-r task' + (openTask ? '' : ' closed') + (it.gold ? ' gold' : '') + '" role="option" tabindex="-1" aria-selected="false" data-i="' + rid + '" data-k="task:' + esc(it.id) + '">'
          + '<span class="qpn-cv' + (can ? '' : ' blank') + '">' + sv('chev') + '</span>'
          + '<span class="qpn-ic">' + sv('task') + '</span>'
          + '<span class="qpn-tt">' + hl(it.title, ql) + '</span>'
          + (it.chip ? '<span class="qpn-chip">' + esc(it.chip) + '</span>' : '')
          + (subTotal ? '<span class="qpn-mm">子任务 ' + (subTotal - subDone) + ' 未完成' + (subDone ? ' · ' + subDone + ' 已完成' : '') + '</span>' : '')
          + secBadge(rid, it.secs, 'task')
          + '<button type="button" class="qpn-ins" data-ins="' + rid + '" title="引用这个任务：插入它的任务说明全文">' + sv('quote') + '引用</button>'
          + '</div>'
        if (openTask) {
          if (!shownSubs.length) html += '<div class="qpn-empty" style="padding-left:52px">没有和「' + esc(qq) + '」匹配的子任务</div>'
          else for (const s of shownSubs) {
            const sid = rows.length
            rows.push({ type: 'sub', item: s, title: s.title, parent: it.id })
            html += '<div class="qpn-r sub" role="option" tabindex="-1" aria-selected="false" data-i="' + sid + '" data-k="sub:' + esc(s.id) + '">'
              + '<span class="qpn-cv blank">' + sv('chev') + '</span>'
              + '<span class="qpn-ic">' + sv('task') + '</span>'
              + '<span class="qpn-tt">' + hl(s.title, ql) + '</span>'
              + (s.chip ? '<span class="qpn-chip sub">' + esc(s.chip) + '</span>' : '')
              + secBadge(sid, s.secs, 'sub')
              + '</div>'
          }
        }
        html += '</div>'
        continue
      }
      const rid = rows.length
      rows.push({ type: 'leaf', item: it, title: it.title })
      html += '<div class="qpn-r' + (it.gold ? ' gold' : '') + (it.gone ? ' gone' : '') + '" role="option" tabindex="-1" aria-selected="false" data-i="' + rid + '" data-k="' + esc((it.kind ?? 'leaf') + ':' + (it.id || it.title)) + '">'
        + '<span class="qpn-cv blank">' + sv('chev') + '</span>'
        + '<span class="qpn-ic">' + sv(it.icon ?? 'note') + '</span>'
        + '<span class="qpn-tt">' + hl(it.title, ql) + '</span>'
        + (it.chip ? '<span class="qpn-chip' + (it.chipCls ? ' ' + it.chipCls : '') + '">' + esc(it.chip) + '</span>' : '')
        + secBadge(rid, it.secs, it.icon === 'kb' ? 'kb' : 'task')
        + (it.meta ? '<span class="qpn-mm">' + hl(it.meta, ql) + '</span>' : '')
        + (it.gold ? starChip() : '')
        + '</div>'
    }
    html += '</div></section>'
  }
  if (!secs.length) html = '<div class="qpn-empty" style="padding:34px 20px;text-align:center">'
    + (qq ? '没有和「' + esc(qq) + '」匹配的内容' : P.kind === 'kb' ? '知识库还没有可以引用的知识卡 · 去侧栏「知识库」新建一张' : '这张卡片还没有可以引用的内容') + '</div>'
  list.innerHTML = html
  /* 换了筛选词 / 换了标签 → 列表回顶部（v171.1：标签是筛选视图，不能停在上一次的滚动位置） */
  const tagChanged = tagOn !== P.lastTag
  list.scrollTop = (qq && qq !== P.lastQ) || tagChanged ? 0 : prev
  P.lastQ = qq
  P.lastTag = tagOn
  P.rows = rows
  P.hiEl = null
  if (P.hi >= rows.length) P.hi = rows.length - 1
  if (P.hi < 0 && rows.length) P.hi = 0
  /* v166：重画不再把高亮行 scrollIntoView —— 真机的任务弹窗会周期性重画，一重画就把用户滚到的位置拽回去 */
  applyHi(false)
  fillLoc(secs)
  fillTags(facets)
  measure()
  paintHead(total)
  paintMem()
  syncScroll()
  if (keepSec) {
    const i = Number(keepSec.slice(1))
    const secs = secsOf(i)
    const row = q('.qpn-r[data-i="' + i + '"]', P.el)
    if (secs && row && (keepHot || keepPin)) { secShow(i, secs, row); P.secPin = keepPin }
  }
}

function paintHead(total: number): void {
  if (!P.el) return
  const qq = String(P.hit.q || '').trim()
  const sub = q('.qpn-sub', P.el)
  const tg = P.kind === 'kb' ? P.tag : ''
  if (sub) sub.textContent = (P.card ? '卡片「' + P.card + '」 · ' : '') + (qq ? '筛选「' + qq + '」 · ' : '') + (tg ? '标签 #' + tg + ' · ' : '') + total + (P.kind === 'kb' ? ' 张' : ' 项')
  const chip = q('.qpn-hq', P.el)
  if (!chip) return
  chip.hidden = !qq
  const s = q('span', chip)
  if (s) s.textContent = '筛选「' + qq + '」'
}

function applyHi(scroll: boolean): void {
  if (!P.el) return
  /* v166：只改「上一个 / 新的」两个节点（原来每次都遍历全部行，滚动帧里没必要） */
  if (P.hiEl) {
    P.hiEl.classList.remove('on')
    if (P.hiEl.classList.contains('qpn-r')) P.hiEl.setAttribute('aria-selected', 'false')
  }
  const r = P.rows[P.hi]
  const cur = r ? q('[data-i="' + P.hi + '"]', P.el) : null
  P.hiEl = cur
  if (!cur) { paintPv(null); return }
  cur.classList.add('on')
  if (cur.classList.contains('qpn-r')) cur.setAttribute('aria-selected', 'true')
  paintPv(r)
  if (scroll) { try { cur.scrollIntoView({ block: 'nearest' }) } catch { /* ignore */ } }
}

function paintPv(r: Row | null): void {
  const pv = P.el ? q('.qpn-pv', P.el) : null
  if (!pv) return
  if (!r) { pv.innerHTML = ''; return }
  if (r.type === 'g') { pv.innerHTML = '<span class="qpn-pvk">' + esc(r.title) + ' · 这一类 ' + r.n + ' 项 · 点整行开合</span>'; return }
  const kind = r.type === 'task' ? '任务说明全文' : r.type === 'sub' ? '子任务说明全文' : (r.type === 'leaf' ? (r.item.ins ?? '引用原文') : '引用原文')
  pv.innerHTML = '将插入 <b>' + esc(r.title) + '</b><span class="qpn-pvk"> · ' + esc(kind) + '</span>'
}

/* ── v166 · 开合 + 滚动位置记忆（按卡片） ───────────────────── */
const MEM_KEY = 'dpm.qp.mem.v1'
interface MemRec { sec: string[]; task: string[]; scroll: MemScroll | null; at: number }

function memAll(): Record<string, MemRec> {
  try {
    const j = JSON.parse(localStorage.getItem(MEM_KEY) ?? '{}') as Record<string, MemRec> | null
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
function memRead(k: string): { sec: string[]; task: string[]; scroll: MemScroll | null } {
  if (!k) return { sec: [], task: [], scroll: null }
  const a = (memAll()[k] ?? {}) as Partial<MemRec>
  return {
    sec: Array.isArray(a.sec) ? a.sec : [],
    task: Array.isArray(a.task) ? a.task : [],
    scroll: a.scroll && typeof a.scroll.pos === 'number' ? a.scroll : null,
  }
}
/** 当前滚动位置：记「最上面那个分区 + 分区内偏移」（内容增减后还能落回同一段），另存原始 px 兜底。筛选是临时视图 → 不记。 */
function memScrollPos(): MemScroll | null {
  if (!P.el) return null
  const list = q('.qpn-list', P.el)
  if (!list) return null
  if (String(P.hit.q || '').trim()) return null
  const sc = Math.round(list.scrollTop)
  let sec = '', top = 0
  for (const g of P.geo) if (g.top - 1 <= sc) { sec = g.key; top = g.top }
  return { sec, off: Math.max(0, sc - top), pos: sc }
}
function memWrite(): void {
  if (!P.memKey) return
  const all = memAll()
  const prev = all[P.memKey]
  const s = memScrollPos()
  const rec: MemRec = { sec: [...P.secClosed], task: [...P.taskOpen], scroll: s ?? prev?.scroll ?? null, at: Date.now() }
  /* 什么都没记 = 不占一条（否则每次开关都留一条空记录） */
  if (!rec.sec.length && !rec.task.length && !(rec.scroll && rec.scroll.pos > 8)) delete all[P.memKey]
  else all[P.memKey] = rec
  const ks = Object.keys(all)
  if (ks.length > 40) ks.sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0)).slice(0, ks.length - 40).forEach((x) => { delete all[x] })
  try { localStorage.setItem(MEM_KEY, JSON.stringify(all)) } catch { /* 存不下就只这次生效 */ }
  paintMem()
}
function memDrop(): void {
  if (!P.memKey) return
  const all = memAll()
  delete all[P.memKey]
  try { localStorage.setItem(MEM_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}
/** 滚动位置防抖落盘（260ms）+ 关面板时兜底再写一次 */
function saveScrollSoon(): void {
  if (!P.memKey) return
  if (P.scrollT) clearTimeout(P.scrollT)
  P.scrollT = window.setTimeout(() => { if (P.open) memWrite() }, 260)
}
/** 打开时还原上次位置：优先按「分区 + 偏移」落点（内容变了也落在同一段），再钳进可滚范围。 */
function restoreScroll(): void {
  P.restored = true
  const list = P.el ? q('.qpn-list', P.el) : null
  if (!list || !P.memScroll) return
  const s = P.memScroll
  let target = Number(s.pos) || 0
  const g = P.geo.find((x) => x.key === s.sec)
  if (g) target = g.top + Math.min(Number(s.off) || 0, Math.max(0, g.h - 1))
  target = Math.max(0, Math.min(Math.round(target), list.scrollHeight - list.clientHeight))
  if (target > 0) { list.scrollTop = target; syncScroll() }
}
function paintMem(): void {
  if (!P.el) return
  const b = q('.qpn-mem', P.el)
  if (!b) return
  const n = P.secClosed.size + P.taskOpen.size
  const pos = !!(P.memScroll && Number(P.memScroll.pos) > 8)
  b.hidden = !P.memKey || (!n && !pos)
  if (!b.hidden) {
    const s = q('span', b)
    if (s) s.textContent = n ? '开合已记住 ' + n + ' 项' : '已记住上次位置'
  }
}
function resetMem(): void {
  if (!P.memKey) return
  P.secClosed.clear(); P.taskOpen.clear(); P.memScroll = null
  memDrop()
  paint()
  const list = P.el ? q('.qpn-list', P.el) : null
  if (list) list.scrollTop = 0
  syncScroll()
  P.ctx?.toast?.('已恢复默认：' + (P.kind === 'kb' ? '六类' : '八类') + '全展开、子任务收起、回到顶部；这张卡片的记忆已清')
}

/* ── v171 · 标签筛选条（只在 kb 身份）：facet 计数 / 单选 / 再点取消 / 清除 / 两端渐隐 ── */
function fadeTags(): void {
  const box = P.el ? q('.qpn-tgbs', P.el) : null
  if (!box) return
  const l = box.scrollLeft > 4
  const r = box.scrollLeft + box.clientWidth < box.scrollWidth - 4
  box.classList.toggle('l', l)
  box.classList.toggle('r', r)
}
function fillTags(facets: Record<string, number>): void {
  if (!P.el) return
  const row = q('.qpn-tags', P.el)
  if (!row) return
  if (P.kind !== 'kb') { row.hidden = true; return }
  const keys = Object.keys(facets).sort((a, b) => (facets[b] - facets[a]) || (a < b ? -1 : 1))
  row.hidden = keys.length === 0    /* 空库 / 一张卡都没打标签 = 整条隐藏，不留空行 */
  if (!keys.length) return
  const box = q('.qpn-tgbs', row)
  if (box) {
    box.innerHTML = keys.map((t) => '<button type="button" class="qpn-tag' + (P.tag === t ? ' on' : '') + '" data-tag="' + esc(t) + '" aria-pressed="' + (P.tag === t) + '" title="' + (P.tag === t ? '取消标签筛选（再点一次）' : '只看 #' + esc(t) + '（' + facets[t] + ' 张）') + '">'
      + '<span class="h">#</span><span class="t">' + esc(t) + '</span><b>' + facets[t] + '</b></button>').join('')
  }
  const x = q('.qpn-tagx', row)
  if (x) x.hidden = !P.tag
  fadeTags()
}
/** 再点同一个标签 = 取消（真值切换）；点另一个 = 直接换（不叠加）；清除传空串走同一条路。 */
function setTag(v: string): void {
  const next = v && P.tag !== v ? v : ''
  if (next === P.tag) return
  P.tag = next
  paint()
  if (P.el) { const l = q('.qpn-list', P.el); if (l) l.scrollTop = 0 }
  syncScroll()
}

/* ── v166 · 快速定位 + 滚动跟手（渲染后量一次几何；滚动中只读 scrollTop） ── */
function fillLoc(secs: Array<{ g: QpGroup; cnt: number; openSec: boolean }>): void {
  if (!P.el) return
  const row = q('.qpn-lbs', P.el)
  if (!row) return
  const sig = secs.map((s) => s.g.key).join(',')
  if (sig !== P.locSig) {
    P.locSig = sig
    row.innerHTML = secs.map((s) => '<button type="button" class="qpn-lb' + (s.g.key === P.curKey ? ' on' : '') + '" data-lb="' + esc(s.g.key) + '"' + (s.g.key === P.curKey ? ' aria-current="true"' : '') + ' title="定位到「' + esc(s.g.name) + '」">' + (s.g.iconSvg ?? sv(s.g.icon ?? 'note')) + '<span>' + esc(s.g.name) + '</span></button>').join('')
    P.locBtns = {}
    for (const b of qa('.qpn-lb', row)) P.locBtns[b.dataset.lb ?? ''] = b
    P.locOn = ''
  }
  setLocActive(P.curKey)
}
function setLocActive(key: string): void {
  if (!P.el || !key || key === P.locOn) return
  const map = P.locBtns ?? (P.locBtns = {})
  const prev = map[P.locOn]
  if (prev) { prev.classList.remove('on'); prev.removeAttribute('aria-current') }
  const cur = map[key]
  if (cur) { cur.classList.add('on'); cur.setAttribute('aria-current', 'true') }
  P.locOn = key
  /* 横向跟随：直接算 scrollLeft —— scrollIntoView 会在滚动帧里强制布局，是之前卡顿的来源之一 */
  const row = q('.qpn-loc', P.el)
  if (row && cur && row.scrollWidth > row.clientWidth + 2) {
    const want = cur.offsetLeft - Math.round((row.clientWidth - cur.offsetWidth) / 2)
    const to = Math.max(0, Math.min(want, row.scrollWidth - row.clientWidth))
    if (Math.abs(row.scrollLeft - to) > 2) row.scrollLeft = to
  }
}
/** 渲染后一次性量几何：section / 任务行的内容坐标（相对列表内容顶）。
 *  用 offsetTop / offsetHeight 而不是 getBoundingClientRect：面板出现动画带 scale，
 *  rect 在动画前 170ms 内量出来会整体缩 1.4%（v166 原型实测：分区顶 / 高度偏 3–6px、定位落点差 20px）。 */
function measure(): void {
  if (!P.el) return
  const list = q('.qpn-list', P.el)
  if (!list) return
  const lo = list.offsetTop
  const geo: GeoSec[] = []
  for (const s of qa('.qpn-sec', P.el)) {
    const head = q('.qpn-g', s)
    if (!head) continue
    const top = s.offsetTop - lo
    const g: GeoSec = { key: s.dataset.g ?? '', el: s, head, top, h: s.offsetHeight, tasks: [], stuck: null, cut: null }
    for (const w of qa('.qpn-taskwrap', s)) {
      const t = q('.qpn-r.task', w)
      if (!t) continue
      g.tasks.push({ el: t, id: (t.dataset.k ?? '').slice(5), top: top + w.offsetTop + 1, wrapH: w.offsetHeight, stuck: null })
    }
    geo.push(g)
  }
  P.geo = geo
}
function onScroll(): void {
  /* v179：面板列表一滚就收起分段列表（被悬停那一行的锚点已经滚走） */
  secDrop()
  if (!P.el || P.raf) return
  P.raf = requestAnimationFrame(() => { P.raf = 0; syncScroll() })
}
/** 一帧只读一个 scrollTop：贴顶 / cut / 当前分区全用缓存几何算，只有变化才写 class。 */
function syncScroll(): void {
  if (!P.el) return
  const list = q('.qpn-list', P.el)
  if (!list) return
  if (!P.geo.length) measure()
  const sc = list.scrollTop
  let cur = P.geo.length ? P.geo[0].key : ''
  for (const g of P.geo) {
    if (g.top - sc <= 12) cur = g.key
    const stuck = sc > 0.5 && g.top - sc <= 8.5 && g.top + g.h - 44 > sc + 8.5
    if (g.stuck !== stuck) { g.stuck = stuck; g.head.classList.toggle('stuck', stuck) }
    const cut = g.top < sc - 0.5
    if (g.cut !== cut) { g.cut = cut; g.el.classList.toggle('cut', cut) }
    for (const t of g.tasks) {
      const ts = sc > 0.5 && t.top - sc <= 44.5 && t.top + t.wrapH - 40 > sc + 44.5
      if (t.stuck !== ts) { t.stuck = ts; t.el.classList.toggle('stuck', ts) }
    }
  }
  /* v171.1：① 平滑滚动的这几帧里钉住被点的那组（900ms 或到底即交还几何）；
     ② 到底 → 认最后一组（最后一组滚不到顶，顶边算法永远落不到它身上）；
     ③ 列表装得下（不可滚）→ 认点过的那组，默认第一组。 */
  const maxSc = Math.max(0, list.scrollHeight - list.clientHeight)
  const pin = P.locPin
  if (pin) {
    if (pin.until < Date.now() || sc >= maxSc - 2) P.locPin = null
    else cur = pin.key
  }
  if (!P.locPin) {
    if (maxSc > 2 && sc >= maxSc - 2) { const last = P.geo[P.geo.length - 1]; if (last) cur = last.key }
    else if (maxSc <= 2) cur = P.aimKey || (P.geo[0]?.key ?? '')
  }
  if (cur && cur !== P.curKey) { P.curKey = cur; setLocActive(cur) }
  if (P.aimArm) P.aimArm()
  if (P.memKey) saveScrollSoon()
}
function aimClear(): void {
  const b = P.locBtns?.[P.aimKey]
  if (b) b.classList.remove('aim')
  P.aimKey = ''
}
function jumpTo(key: string): void {
  if (!P.el) return
  const list = q('.qpn-list', P.el)
  if (!list) return
  if (P.secClosed.has(key)) { P.secClosed.delete(key); memWrite(); paint() }
  const g = P.geo.find((x) => x.key === key)
  if (!g) return
  const target = Math.max(0, Math.round(g.top - 1))
  /* 点下去立刻写「当前位置」——不等滚动事件、不等平滑滚动走完（否则看起来「点了没反应」） */
  P.curKey = key
  setLocActive(key)
  P.locPin = { key, until: Date.now() + 900 }
  /* 点击的「意图」= 描边；「当前位置」= 实心 —— 两者都实时更新，不再用 900ms 锁冻结状态 */
  if (P.aimT) clearTimeout(P.aimT)
  aimClear()
  P.aimKey = key
  const b = P.locBtns?.[key]
  if (b) b.classList.add('aim')
  P.aimArm = () => { if (P.aimT) clearTimeout(P.aimT); P.aimT = window.setTimeout(aimClear, 140) }
  P.aimArm()
  const hi = P.rows.findIndex((r) => r.type === 'g' && r.key === key)
  if (hi >= 0) { P.hi = hi; applyHi(false) }
  try { list.scrollTo({ top: target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) } catch { list.scrollTop = target }
  g.el.classList.remove('hit'); void g.el.offsetWidth; g.el.classList.add('hit')
  window.setTimeout(() => g.el.classList.remove('hit'), 1000)
}
function relayout(): void { pos(); measure(); syncScroll(); if (P.secEl && P.secRow) secPos(P.secRow) }

/* ── 交互 ───────────────────────────────────────────────────── */
/** 被点的那一行钉在原处：先记它的视口 y，重画后按差值补 scrollTop（比算内容坐标更稳，贴顶时也对）。 */
function pinned(sel: string, act: () => void): void {
  const list = P.el ? q('.qpn-list', P.el) : null
  const old = P.el ? q(sel, P.el) : null
  const y0 = old ? old.getBoundingClientRect().top : null
  act()
  if (!list || y0 == null || !P.el) return
  const now = q(sel, P.el)
  if (!now) return
  const dy = Math.round(now.getBoundingClientRect().top - y0)
  if (dy) list.scrollTop = Math.max(0, list.scrollTop + dy)
}
function toggleSec(key: string): void {
  const idx = P.rows.findIndex((r) => r.type === 'g' && r.key === key)
  pinned('.qpn-g[data-g="' + key + '"]', () => {
    if (P.secClosed.has(key)) P.secClosed.delete(key); else P.secClosed.add(key)
    memWrite()
    paint()
  })
  if (idx >= 0) { P.hi = Math.min(idx, P.rows.length - 1); applyHi(false) }
  syncScroll()
}
function toggleTask(row: Extract<Row, { type: 'task' }>): void {
  if (!row.can) return
  pinned('.qpn-r.task[data-k="task:' + row.item.id + '"]', () => {
    if (P.taskOpen.has(row.item.id)) P.taskOpen.delete(row.item.id); else P.taskOpen.add(row.item.id)
    memWrite()
    paint()
  })
  const i = P.rows.findIndex((r) => r.type === 'task' && r.item.id === row.item.id)
  if (i >= 0) { P.hi = i; applyHi(false) }
  syncScroll()
}
function pick(i: number): void {
  const r = P.rows[i]
  const ctx = P.ctx
  if (!r || r.type === 'g' || !ctx?.insert) return
  const it = r.item
  const hitNow: QpHit = { len: P.hit.len, q: P.hit.q, ch: P.hit.ch }
  close('pick')
  try { ctx.insert(it.text, hitNow, it as QpItem) } catch (e) {
    console.error('[dsh-project-manager] 插入引用失败：', e)
    ctx.toast?.('插入引用失败：' + (e instanceof Error ? e.message : String(e)), 'err')
  }
}
function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement
  /* v179：「N 段」胶囊 = 钉住 / 收起分段列表（离开这一行也不收） */
  const sb = t.closest('[data-secb]') as HTMLElement | null
  if (sb) { e.preventDefault(); e.stopPropagation(); secPin(Number(sb.dataset.secb)); return }
  const tg = t.closest('[data-tag]') as HTMLElement | null
  if (tg) { e.preventDefault(); e.stopPropagation(); setTag(tg.dataset.tag ?? ''); return }
  if (t.closest('[data-tagx]')) { e.preventDefault(); e.stopPropagation(); setTag(''); return }
  const mem = t.closest('.qpn-mem') as HTMLElement | null
  if (mem) { e.preventDefault(); resetMem(); return }
  const lb = t.closest('[data-lb]') as HTMLElement | null
  if (lb) { e.preventDefault(); jumpTo(lb.dataset.lb ?? ''); return }
  const ins = t.closest('[data-ins]') as HTMLElement | null
  if (ins) { e.preventDefault(); e.stopPropagation(); pick(Number(ins.dataset.ins)); return }
  const add = t.closest('[data-qadd]') as HTMLElement | null
  if (add) {
    e.preventDefault()
    const kind = add.dataset.qadd as 'note' | 'link' | 'file' | 'repo'
    const cb = P.ctx?.add
    if (cb) { cb(kind, { ...P.hit }); close() }
    return
  }
  const g = t.closest('.qpn-g') as HTMLElement | null
  if (g) { e.preventDefault(); toggleSec(g.dataset.g ?? ''); return }
  const r = t.closest('.qpn-r') as HTMLElement | null
  if (!r) return
  const i = Number(r.dataset.i)
  const row = P.rows[i]
  if (!row) return
  if (row.type === 'task' && row.can) { toggleTask(row); return }
  pick(i)
}
function onHover(e: MouseEvent): void {
  const t = e.target as HTMLElement
  secOver(t)
  const el = t.closest('[data-i]') as HTMLElement | null
  if (!el) return
  const i = Number(el.dataset.i)
  if (i === P.hi) return
  P.hi = i
  applyHi(false)
}
function move(d: number): void {
  const n = P.rows.length
  if (!n) return
  P.hi = (P.hi + d + n) % n
  applyHi(true)
}
function onKey(e: KeyboardEvent): void {
  if (!P.open || e.isComposing || e.keyCode === 229) return
  const r = P.rows[P.hi]
  const k = e.key
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return }
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(k === 'ArrowDown' ? 1 : -1); return }
  if (k === 'Enter') {
    if (!r) return
    e.preventDefault(); e.stopPropagation()
    if (r.type === 'g') toggleSec(r.key); else pick(P.hi)
    return
  }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (!r) return
    const collapsible = r.type === 'g' || (r.type === 'task' && r.can)
    if (!collapsible) return
    const openNow = r.type === 'g' ? !P.secClosed.has(r.key) : (r.type === 'task' && (P.taskOpen.has(r.item.id) || (!!String(P.hit.q || '').trim() && (r.subs?.length ?? 0) > 0)))
    const want = k === 'ArrowRight'
    if (openNow === want) return
    e.preventDefault(); e.stopPropagation()
    if (r.type === 'g') toggleSec(r.key)
    else if (r.type === 'task') toggleTask(r)
  }
  /* 空格不劫持：编辑器里继续打字 */
}
function onDown(e: PointerEvent): void {
  if (!P.open) return
  const t = e.target as Node
  if (P.el && P.el.contains(t)) return
  /* v179：分段列表挂在面板外侧 —— 点它不能算「点面板外面」（否则点一段先关面板，click 落不到卡上） */
  if (P.secEl && P.secEl.contains(t)) return
  if (P.anchor && (P.anchor === t || P.anchor.contains(t))) return
  close('outside')
}
/**
 * v166 定位：锚点 = 触发物（会话信息卡按钮 / 信息卡 / 说明框），不是输入框、不是光标。
 * 只算一次（打开 + 窗口 resize）；打字、输入框变高、光标移动都不重算 —— 这就是「弹窗总跟着光标跑」的根因。
 * 规则：优先在锚点上方展开、右边缘对齐；上方放不下再放到下方；都不行才居中。面板永远给锚点留 10px。
 */
function pos(): void {
  if (!P.el || !P.anchor) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const ctx = P.ctx
  const r = (ctx?.trigger ?? ctx?.place ?? P.anchor).getBoundingClientRect()
  const pad = 12, gap = 10
  const wd = Math.round(Math.min(760, vw - pad * 2))
  const cap = Math.round(Math.min(640, vh - pad * 2))
  const up = Math.round(r.top - gap - pad)
  const down = Math.round(vh - r.bottom - gap - pad)
  let ht = cap, top: number
  if (P.where === 'composer') {
    /* 对话框里那块「伴手」= 贴在会话信息卡上：高度按上方空间自适应，保证不盖住输入区 */
    if (up >= Math.min(cap, 320)) { ht = Math.min(cap, up); top = Math.round(r.top - gap - ht) }
    else if (down >= Math.min(cap, 320)) { ht = Math.min(cap, down); top = Math.round(r.bottom + gap) }
    else { ht = Math.max(260, Math.min(cap, Math.max(up, down))); top = Math.round(Math.max(pad, (vh - ht) / 2)) }
  } else {
    /* 任务说明 / 相关说明 / 知识卡：保持 760×640 的设计尺寸，优先放锚点上方，不行再下方 / 居中 */
    if (up >= cap) top = Math.round(r.top - gap - cap)
    else if (down >= cap) top = Math.round(r.bottom + gap)
    else top = Math.round(Math.max(pad, (vh - cap) / 2))
  }
  const left = Math.round(Math.max(pad, Math.min(r.right - wd, vw - wd - pad)))
  P.el.style.width = wd + 'px'
  P.el.style.height = ht + 'px'
  P.el.style.left = left + 'px'
  P.el.style.top = top + 'px'
}
/* ═══ v179 · 分段列表（设计卡 §三） ══════════════════════════════════════
   面板里悬停「带标题分割线」的那一行 → 70ms 后在**面板左边或右边**展开每一段（一行一个、与面板 0 重叠），
   点一段只注入这一段；点整行 / 「引用」仍是全文。列表 position: fixed、挂在面板同一父节点
   （dialog 里就挂 dialog，保证在 top layer 之上）；外层只画框 / 阴影 / 小三角（overflow: visible），
   滚动交给内层 .qpn-sgsin —— 小三角画在盒子外面，外层 overflow:auto 会把它算进 scrollWidth 冒横向条。 */
const SEC_W = 320, SEC_MIN = 180, SEC_GAP = 10, SEC_PAD = 12

function secBadge(i: number, secs: QpSec[] | undefined, kind: 'task' | 'sub' | 'kb'): string {
  if (!secs || !secs.length) return ''
  const what = kind === 'kb' ? '这份正文' : kind === 'sub' ? '这条子任务说明' : '这个任务说明'
  return '<button type="button" class="qpn-sgb" data-secb="' + i + '" aria-haspopup="dialog" aria-expanded="false"'
    + ' title="' + esc(what) + '里有 ' + secs.length + ' 段带标题的分割线：鼠标停在这一行就展开，点一段只引用这一段">'
    + sv('div') + '<span>' + secs.length + ' 段</span></button>'
}
function secsOf(i: number): QpSec[] | null {
  const r = P.rows[i]
  if (!r || r.type === 'g') return null
  const s = (r.item as QpItem).secs
  return s && s.length ? s : null
}
function secMount(): HTMLElement {
  if (P.secEl && document.contains(P.secEl)) return P.secEl
  const d = document.createElement('div')
  d.className = 'qpn-sgs'
  d.setAttribute('role', 'dialog')
  d.setAttribute('aria-label', '分段：点一段只引用这一段')
  d.innerHTML = '<div class="qpn-sgsin"></div>'
  /* 按下不抢焦点（编辑器光标留在原处）；点它不算「点面板外面」（onDown 里也放行 .qpn-sgs） */
  d.addEventListener('mousedown', (e) => { e.preventDefault() })
  d.addEventListener('mouseenter', () => { P.secHot = true; if (P.secH) { clearTimeout(P.secH); P.secH = 0 } })
  d.addEventListener('mouseleave', () => { P.secHot = false; secSoon() })
  d.addEventListener('click', onSecClick)
  ;(P.el?.parentElement ?? document.body).append(d)
  P.secEl = d
  return d
}
/** 悬停：这一行有分段 → 70ms 后展开；没有 → 220ms 后收起（进列表时列表自己取消）。 */
function secOver(t: HTMLElement): void {
  P.secHot = true
  if (P.secPin || (P.secEl && P.secEl.contains(t))) return
  const btn = t.closest('[data-secb]') as HTMLElement | null
  const row = t.closest('.qpn-r') as HTMLElement | null
  const i = btn ? Number(btn.dataset.secb) : row ? Number(row.dataset.i) : -1
  const secs = i >= 0 ? secsOf(i) : null
  if (!secs || !row) {
    if (P.secT) { clearTimeout(P.secT); P.secT = 0 }
    secSoon()
    return
  }
  if (P.secH) { clearTimeout(P.secH); P.secH = 0 }
  if (P.secEl && !P.secEl.hidden && P.secKey === 'r' + i) { P.secRow = row; secPos(row); return }
  if (P.secT) clearTimeout(P.secT)
  P.secT = window.setTimeout(() => { P.secT = 0; secShow(i, secs, row) }, 70)
}
function secSoon(): void {
  if (P.secPin || !P.secEl || P.secEl.hidden) return
  if (P.secH) clearTimeout(P.secH)
  P.secH = window.setTimeout(() => { P.secH = 0; secHide() }, 220)
}
function secShow(i: number, secs: QpSec[], row: HTMLElement): void {
  if (!P.el || !document.contains(row)) return
  P.secPin = false
  const el = secMount()
  el.hidden = false
  const qq = String(P.hit.q || '').trim()
  const ql = qq.toLowerCase()
  /* 筛选时只列命中的段；一段都不命中就列全部（别让人以为没内容） */
  let list = secs
  if (ql) {
    const hit = secs.filter((s) => ((s.t || '默认') + ' ' + s.body).toLowerCase().includes(ql))
    if (hit.length) list = hit
  }
  const inner = q('.qpn-sgsin', el)
  if (inner) {
    inner.innerHTML = '<div class="qpn-sgh"><span class="qpn-sgt">' + sv('div') + '<span>分段 ' + list.length + ' 段</span></span>'
      + '<span class="qpn-sgw">' + (ql ? '只列含「' + esc(qq) + '」的段' : '点一段只引用这一段') + '</span>'
      + '<button type="button" class="qpn-sgx" data-secx aria-label="收起分段列表" title="收起分段列表">' + sv('close') + '</button></div>'
      + '<div class="qpn-sgg">' + list.map((s) => '<button type="button" class="qpn-sgc' + (s.t ? '' : ' def') + (s.n ? '' : ' empty') + '" data-sec="' + s.i + '"'
        + ' title="' + esc(s.t ? '只引用「' + s.t + '」这一段（' + s.n + ' 字）' : '只引用「默认」这一段（' + s.n + ' 字）') + '">'
        + '<span class="qpn-sgd"><i></i><b>' + esc(s.t || '默认') + '</b><i></i></span>'
        + '<span class="qpn-sgn">' + (s.n ? s.n + ' 字' : '空段') + '</span>'
        + '<span class="qpn-sgp">' + esc(s.n ? s.prev : '这一段还没有内容') + '</span>'
        + '</button>').join('') + '</div>'
  }
  P.secKey = 'r' + i
  P.secRow = row
  if (P.el) {
    for (const b of qa('.qpn-sgb', P.el)) {
      const on = b === q('[data-secb="' + i + '"]', P.el)
      b.classList.toggle('on', on && !P.secPin)
      b.setAttribute('aria-expanded', String(on))
    }
  }
  secPos(row)
}
/** 定位：右边放得下就右边（与面板留 10px）→ 左边 → 收到 ≥180 仍不压面板 → 兜底「220 贴视口右缘 + 落到行下方」。 */
function secPos(row: HTMLElement): void {
  const el = P.secEl
  if (!el || !P.el || el.hidden) return
  const pr = P.el.getBoundingClientRect()
  const rr = row.getBoundingClientRect()
  const vw = window.innerWidth, vh = window.innerHeight
  const rightRoom = Math.round(vw - pr.right - SEC_GAP - SEC_PAD)
  const leftRoom = Math.round(pr.left - SEC_GAP - SEC_PAD)
  let w = SEC_W, left = 0, below = false, side: 'r' | 'l' = 'r'
  if (rightRoom >= SEC_W) { left = Math.round(pr.right + SEC_GAP) }
  else if (leftRoom >= SEC_W) { left = Math.round(pr.left - SEC_GAP - SEC_W); side = 'l' }
  else if (Math.max(rightRoom, leftRoom) >= SEC_MIN) {
    const useRight = rightRoom >= leftRoom
    w = Math.min(SEC_W, Math.max(SEC_MIN, useRight ? rightRoom : leftRoom))
    left = useRight ? Math.round(pr.right + SEC_GAP) : Math.round(pr.left - SEC_GAP - w)
    side = useRight ? 'r' : 'l'
  } else {
    /* 两侧都放不下（窄窗）：宁可挡别的行，也不挡正在引用的这张卡 —— 落到这一行下方 */
    w = 220; below = true; left = Math.round(vw - SEC_PAD - w)
  }
  el.classList.toggle('left', !below && side === 'l')
  el.classList.toggle('below', below)
  el.style.width = w + 'px'
  el.style.left = left + 'px'
  const h = el.offsetHeight
  let top = below ? Math.round(rr.bottom + 8) : Math.round(rr.top - 10)
  top = Math.max(SEC_PAD, Math.min(top, vh - SEC_PAD - h))
  el.style.top = top + 'px'
  el.style.setProperty('--ay', Math.round(rr.top + rr.height / 2 - top) + 'px')
}
function secHide(): void {
  if (P.secT) { clearTimeout(P.secT); P.secT = 0 }
  if (P.secH) { clearTimeout(P.secH); P.secH = 0 }
  if (P.secEl) P.secEl.hidden = true
  P.secKey = ''; P.secRow = null; P.secPin = false
  if (P.el) for (const b of qa('.qpn-sgb', P.el)) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false') }
}
/** 整块丢掉（关面板 / 重画 / 列表滚动）—— 锚点已经换了，留着只会指错行。 */
function secDrop(): void {
  if (P.secT) { clearTimeout(P.secT); P.secT = 0 }
  if (P.secH) { clearTimeout(P.secH); P.secH = 0 }
  P.secEl?.remove()
  P.secEl = null; P.secKey = ''; P.secRow = null; P.secPin = false
}
/** 点「N 段」= 钉住（离开也不收）；再点一次收起。 */
function secPin(i: number): void {
  const secs = secsOf(i)
  if (!secs || !P.el) return
  if (P.secPin && P.secKey === 'r' + i) { secHide(); return }
  const row = q('.qpn-r[data-i="' + i + '"]', P.el)
  if (!row) return
  if (P.secT) { clearTimeout(P.secT); P.secT = 0 }
  secShow(i, secs, row)
  P.secPin = true
  const b = q('[data-secb="' + i + '"]', P.el)
  if (b) { b.classList.add('on'); b.setAttribute('aria-expanded', 'true') }
}
function onSecClick(e: MouseEvent): void {
  const t = e.target as HTMLElement
  if (t.closest('[data-secx]')) { e.preventDefault(); e.stopPropagation(); secHide(); return }
  const c = t.closest('[data-sec]') as HTMLElement | null
  if (!c) return
  e.preventDefault(); e.stopPropagation()
  const i = P.secKey ? Number(P.secKey.slice(1)) : -1
  const r = i >= 0 ? P.rows[i] : null
  if (!r || r.type === 'g') return
  const secs = ((r.item as QpItem).secs ?? [])
  const sec = secs[Number(c.dataset.sec)]
  if (!sec) return
  if (!sec.n) { P.ctx?.toast?.('这一段还没有内容', 'ok'); return }
  const ctx = P.ctx
  const it = r.item as QpItem
  const hitNow: QpHit = { len: P.hit.len, q: P.hit.q, ch: P.hit.ch }
  close('pick')
  try { ctx?.insert(sec.ins, hitNow, it) } catch (err) {
    console.error('[dsh-project-manager] 插入分段失败：', err)
    ctx?.toast?.('插入分段失败：' + (err instanceof Error ? err.message : String(err)), 'err')
  }
}

function close(how: QpCloseHow = 'api'): void { closeQuotePanel(undefined, how) }

/** v179：知识卡的正文二段式预取到齐后，原地补上「N 段」（不动滚动位置 / 开合 / 焦点）。 */
export function repaintQuotePanel(): void {
  if (P.open) paint()
}
