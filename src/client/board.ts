/**
 * 项目看板（主区面板）：vanilla DOM 渲染，直接移植原型 v8 的结构/样式/交互；数据全部来自 host 快照。
 * 阶段（statuses）只用来给卡片分组；每个阶段底部常驻「添加卡片」，就地输入、回车连续添加。
 * 所有变更 → POST → 用返回的新快照重绘（服务端是唯一事实来源，失败时点名提示并回到服务端状态）。
 */
import { ApiError, Card, FileRef, getGantt, getGanttMeta, getState, Group, NoteItem, openedHow, openFileSmart, poll, post, postGantt, Prefs, Snapshot, StateInfo, Status, Task, TypeGroup, WebLink } from './api.js'
import { FT_CATS, FT_EXTS } from './ftype.gen.js'
import { mqStart, mqStop } from './dock.js'
import { cardText, fileText, linkText, noteText, repoText, sessionText, taskText, type QCard, type QTask } from '../quote.js'
import { tFindIn, tMove } from '../tasks.js'
import { colsPlan, COL_MIN, type ColIn, type ColKey } from '../rlayout.js'
import { CHECK_SVG, COPY_SVG, esc, ic } from './icons.js'
import { tcHtml } from './sess.js'
import { DetailPop } from './detailpop.js'
import { SchedView } from './gantt.js'
import { cardKeys, dueChip, getXS, panelCached, panelDirty, recordDone, ringEl, scheduleKeys, setPanelCache, stHtml, swHtml, swOn, swToggle, taskKeys, ZT, zoneOfKeys } from './gtextra.js'

export interface BoardHost {
  /** 以卡片新建项目会话（index.ts 实现：准备工作区 → 新建会话 → 绑定 → 打开）。 */
  newSession(cardId: string): Promise<void>
  openSession(sessionId: string): void
  isDark(): boolean
  setDark(dark: boolean): void
  toast(msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void } | Array<{ label: string; run: () => void }>): void
  /** v86：详情 / 看板是两个 BoardView 实例，一边改了要通知另一边重画（否则 pending 托盘残留）。 */
  syncOthers?(): void
  pickCard(anchor: HTMLElement, groupId?: string): void
  /** 打开 dsh 的选文件夹对话框（与添加工作区同一个）；取消返回 null；不支持（网页文件浏览器模式）时抛错。 */
  pickDirectory(): Promise<string | null>
  /** dsh 的全部会话（活跃 + 已归档，不含子代理），带所在工作区与更新时间；来自 ctx.sessions + ctx.workspaces。 */
  allSessions(): SessionView[]
  /** 与 dsh 侧栏「归档会话」同一调用；会话有进行中的工作且未要求停止时返回 activity（由界面弹「停止并归档」确认）。 */
  archiveSession(id: string, stop: boolean): Promise<{ ok: true } | { ok: false; activity: ArchiveActivity[] }>
  /** 取消归档（撤销用），同 dsh 侧栏。 */
  unarchiveSession(id: string): Promise<void>
  /** 0.13：能否删除会话（dsh-manage-sessions 提供）。 */
  canDeleteSession(): boolean
  /** 0.13：确认后删除还没对话的会话；返回是否删了。 */
  deleteSession(id: string, title: string): Promise<boolean>
  /** 0.15：侧栏轮询已拿到的快照（有就先用它画，不等请求）。 */
  seed?(): Snapshot | null
  /** 0.16：把一句话（「回忆 X」/「落盘项目 X」）发到这张卡片最近的活跃会话并打开；没有就先新建。返回会话名。 */
  sendToCard(cardId: string, text: string): Promise<string>
  /**
   * v94：详情页任务的添加 / 编辑 / 加子任务都走「添加卡片任务」弹窗（与 /goal 消息旁那个同一个）。
   * 没实现（旧 host）时回退成老的原地编辑，不会把入口点死。
   */
  taskDialog?(o: { cardId: string; mode?: 'add' | 'edit'; taskId?: string; parentId?: string; title?: string; note?: { k: number; t?: string; v?: string; off?: boolean; done?: (r: { t: string; v: string } | null) => void } }): void
  /** v144（1）：任务弹窗正开着（在任务说明里框选「添加为相关说明」时只能用小窗口）。 */
  taskDialogOpen?(): boolean
  /** v127：状态胶囊 → 打开今天的任务面板并定位（全局详情不在日程页里，要由宿主切页）。 */
  seek?(keys: string[]): void
}

/** 宿主拒绝归档时带回的「仍在进行的工作」，一类一条。 */
export interface ArchiveActivity { kind: string; items?: Array<{ id: string; label?: string }> }

/** 与 dsh 官方「停止并归档」确认框同一套文案。 */
/** v136：每一项最左边的「自动注入 Agent 会话」开关（和相关说明同款 28×16）；关 = 名字变灰 + 虚线「不注入」。 */
export const iswHtml = (kind: 'link' | 'file' | 'repo' | 'rel', id: string, label: string, off: boolean, ro: boolean): string => ro ? ''
  : '<button type="button" class="dpm-isw" role="switch" aria-checked="' + (!off) + '" data-dpm-isw="' + kind + ':' + esc(id) + '" aria-label="「' + esc(label) + '」自动注入 Agent 会话" title="开：关联这张卡片的会话会在系统提示「卡片档案」里看到这一项；关：只停止自动注入，引用 / 打开 / 编辑照常"></button>'
export const ioffTag = (off: boolean): string => off ? '<span class="dpm-ioff">不注入</span>' : ''
/** v136：新增 / 编辑弹窗底部的开关卡（默认值由调用方给：说明 / 链接 / 仓库开，文件 / 关联卡片关）。 */
export const injCard = (id: string, on: boolean): string => '<div class="dpm-inj" role="group" aria-labelledby="' + id + 'L"><button type="button" class="dpm-isw" role="switch" id="' + id + '" aria-checked="' + on + '" data-dpm-inj aria-labelledby="' + id + 'L"></button><span class="dpm-inj-t"><b id="' + id + 'L">自动注入 Agent 会话</b><small>开：关联这张卡片的会话在系统提示「卡片档案」里看得到这一项；关：只留在看板，引用 / 打开照常</small></span></div>'
/** v86：详情里每个引用单项右侧的「引」按钮——点它复制与引用列表完全相同的文字（会话可见时同时插到光标处）。 */
function qbtn(text: string, label: string): string {
  // v88：说明开关只影响 AI 自动注入，每行「引」永远可点
  return '<button type="button" class="ib sm qb" data-qt="' + esc(text) + '" aria-label="生成引用文字：' + esc(label) + '" title="生成引用文字（复制' + (label ? '，会话可见时插到光标处' : '') + '）">' + ic('quote') + '</button>'
}
export function activityLine(a: ArchiveActivity): string {
  const items = a.items ?? []
  const n = items.length
  const names = items.map((x) => x.label ?? x.id).join('、')
  switch (a.kind) {
    case 'turn': return '进行中的回合'
    case 'subagent': return n + ' 个运行中的子智能体：' + names
    case 'job': return n + ' 个后台任务：' + names
    case 'schedule': return n + ' 条定时提醒：' + names
    default: return n + ' 项其他工作（' + a.kind + '）'
  }
}

/** 归档时长：今天 / N 天前。 */
export const daysAgo = (iso: string | undefined, now = Date.now()): string => { const d = Math.floor((now - (Date.parse(iso ?? '') || now)) / 86400000); return d < 1 ? '今天' : d + ' 天前' }

/** 0.15 粘贴路径的逐行检测结果（与 host routes.checkPaths 一致）。 */
export type PathCheck = { raw: string; path: string; status: 'ok' | 'dir' | 'missing' | 'linked' | 'dup' | 'bad' }
const FP_WHY: Record<PathCheck['status'], string> = { ok: '存在', dir: '是文件夹（文件夹请加到「仓库」）', missing: '文件不存在', linked: '已关联', dup: '重复，已忽略', bad: '不是绝对路径' }
const FP_ICON: Record<PathCheck['status'], string> = { ok: 'check', dir: 'alert', missing: 'alert', linked: 'minus', dup: 'minus', bad: 'alert' }
const fpKind = (s: PathCheck['status']): string => (s === 'ok' ? 'ok' : s === 'linked' || s === 'dup' ? 'skip' : 'bad')

export interface SessionView { id: string; blank?: boolean; forkOf?: string; title: string; ws: string; wsId: string | null; updatedAt: number; archived: boolean }

/** 相对时间：刚刚 / N分钟 / N小时 / N天（与侧栏一致的粒度）。 */
export const ago = (t: number, now = Date.now()): string => { const m = Math.max(0, Math.floor((now - t) / 60000)); return m < 1 ? '刚刚' : m < 60 ? m + '分钟' : m < 1440 ? Math.floor(m / 60) + '小时' : Math.floor(m / 1440) + '天' }

/**
 * 候选会话按仓库分组：组内新→旧；组按组内最新会话排序（最新的组在前）。
 * 过滤掉本卡片已关联的和已选的；q 匹配会话名或仓库名。
 */
export function groupSessions(list: SessionView[], opts: { archived: boolean; exclude: ReadonlySet<string>; q: string }): Array<[string, SessionView[]]> {
  const q = opts.q.trim().toLowerCase()
  const pool = list.filter((s) => s.archived === opts.archived && !opts.exclude.has(s.id) && (!q || (s.title + ' ' + s.ws).toLowerCase().includes(q)))
  pool.sort((a, b) => b.updatedAt - a.updatedAt)
  const by = new Map<string, SessionView[]>()
  for (const s of pool) { const k = s.ws; if (!by.has(k)) by.set(k, []); (by.get(k) as SessionView[]).push(s) }
  return [...by.entries()]
}

/** 卡片已关联会话的展示顺序：活跃 → 已归档 → 已删除（找不到）；同类按更新时间新 → 旧（已删除保持关联时间新 → 旧）。 */
export function sortLinked<T extends { sessionId: string; createdAt?: string }>(refs: T[], idx: ReadonlyMap<string, SessionView>): T[] {
  const rank = (r: T): number => { const v = idx.get(r.sessionId); return !v ? 2 : v.archived ? 1 : 0 }
  const at = (r: T): number => idx.get(r.sessionId)?.updatedAt ?? (Date.parse(r.createdAt ?? '') || 0)
  return refs.slice().sort((a, b) => rank(a) - rank(b) || at(b) - at(a))
}

/** 0.12：详情里「本卡片的会话」「关联的落盘项目」默认显示的项数。 */
export const LIST_LIMIT = 3
/** 0.12：列表折叠时只取前 limit 项；超出时给出「展示更多 / 折叠」按钮（k = sess | mem）。 */
export function limitList<T>(list: T[], all: boolean, limit = LIST_LIMIT): T[] { return all || list.length <= limit ? list : list.slice(0, limit) }
export const moreBtn = (k: string, all: boolean, n: number, ctl: string, limit = LIST_LIMIT): string => n > limit
  ? '<button type="button" class="more-tg" data-more="' + k + '" aria-expanded="' + all + '" aria-controls="' + ctl + '">' + (all ? '折叠' : '展示更多（还有 ' + (n - limit) + ' 项）') + ic('chev') + '</button>'
  : ''

/** 详情原地更新后找回焦点：优先 id，其次第一个 data-* 属性。 */
const keyOf = (el: HTMLElement): string | null => {
  if (el.id) return '#' + CSS.escape(el.id)
  for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) return '[' + a.name + '="' + CSS.escape(a.value) + '"]'
  return null
}

/** 与 dsh 添加工作区的默认标题同一规则：去掉末尾分隔符，取最后一段。 */
export const folderName = (p: string): string => { const t = p.replace(/[/\\]+$/, ''); return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1) }
const normPath = (p: string): string => p.replace(/[/\\]+$/, '') || '/'

/** 相关说明里的网址变成可点链接（先转义再匹配，链接文本与 href 都是转义后的同一串）；末尾标点不算进网址。 */
/** 相关说明折叠阈值（px）：超过就折叠，给「展开全部 / 收起」。 */
const NOTE_CLAMP = 172
const NOTE_PIN = '卡片项目说明'
type WlRow = { id?: string; text: string; type: string; url: string; err: string; tag?: string; star?: boolean; off?: boolean; auto?: string; manual?: boolean }
const STAR_SVG = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>'

/** 0.21「管理类型」里正在编辑 / 确认删除的对象：类型（key = 类型名）或类型组（key = 组 id）。 */
type TyKey = { kind: 't' | 'g'; key: string }
/** 「未归类」虚拟组的 id（不进数据）。 */
const LOOSE = '__loose'
/** 卡片有没有会注入会话的「卡片资料」（说明 / 链接 / 文件 / 仓库 / 子任务 / 关联卡片）。 */
export const hasMaterials = (c: Card): boolean => !!(c.noteItems ?? []).length || !!(c.webLinks ?? []).length || !!(c.files ?? []).length || !!(c.repos ?? []).length || !!c.tasks.length || !!(c.related ?? []).length

// ── 0.24 子任务树（两级）的纯函数 ──
export const tFlat = (l: Task[]): Task[] => l.flatMap((t) => [t, ...(t.subs ?? [])])
export const tLeaves = (l: Task[]): Task[] => l.flatMap((t) => (t.subs?.length ? t.subs : [t]))
interface TkDragState {
  id: string; x0: number; y0: number; on: boolean; done: boolean; sub: boolean
  hasKids: boolean; kidsN: number; stx: string
  /** v145（2.2）：拖动中停在收着的折叠条上的那颗按钮 + 开始停的时刻（0.4s 自动展开）。 */
  foldEl?: HTMLElement | null; foldAt?: number
  ghost: HTMLElement | null; hint: HTMLElement | null; line: HTMLElement | null
  slot: HTMLElement | null; slotFor: string; hkey: string
  mode: '' | 'order' | 'outdent' | 'nest' | 'nestAt' | 'wall' | 'inside' | 'blocked' | 'none'
  tid: string; ttl: string; before: boolean; scrollAt: number
  /** v130（2）nestAt 落点：插到目标子任务列表里这条子任务前 / 后（'' = 最后） */
  sid: string
  /** v129（1）按标题 / 空白起拖：按下时不抢指针（不拖 = 照常点开详情），过了 4px 才捕获 */
  soft: boolean; pid: number; cap: HTMLElement | null
}

export const tClone = (l: Task[]): Task[] => JSON.parse(JSON.stringify(l)) as Task[]
export function tFind(l: Task[], id: string): { t: Task; list: Task[]; i: number; p: Task | null } | null {
  return tFindIn(l, id) as { t: Task; list: Task[]; i: number; p: Task | null } | null
}
/** 有子任务的父任务：完成 = 子任务全部完成（与服务端 rollupDone 一致）。 */
export function tRollup(l: Task[]): Task[] { for (const t of l) { if (t.subs && !t.subs.length) delete t.subs; if (t.subs?.length) t.done = t.subs.every((s) => s.done) } return l }
/** 本地先盖时间（服务端回包后以服务端为准）：新任务盖添加 + 修改，内容变了才盖修改；只调顺序不算。 */
export function tStamp(prev: Task[], next: Task[], at = new Date().toISOString()): Task[] {
  const old = new Map(tFlat(prev).map((t) => [t.id, t]))
  const same = (a: Task, x: Task): boolean => a.text === x.text && a.done === x.done && (a.note ?? '') === (x.note ?? '') && (a.type ?? '') === (x.type ?? '') && (a.links ?? []).join() === (x.links ?? []).join() && (a.files ?? []).join() === (x.files ?? []).join()
  for (const t of tFlat(next)) { const p = old.get(t.id); if (!p) { t.created = at; t.updated = at } else if (!same(p, t)) t.updated = at }
  return next
}
/** 0.26 文件类型：按扩展名（构建期生成的表，13 类）；认不出 = null。 */
const FT = new Map<string, number>()
FT_EXTS.forEach((l, i) => { for (const x of l.split(' ')) if (x) FT.set(x, i) })
export function ftype(p: string): { label: string; icon: string; ext: string } | null {
  const m = /\.([^./\\]+)$/.exec(p.replace(/[/\\]+$/, ''))
  const ext = m ? m[1].toLowerCase() : ''
  const i = ext ? FT.get(ext) : undefined
  return i === undefined ? null : { label: FT_CATS[i][0], icon: FT_CATS[i][1], ext }
}
export const fileName = (f: { path: string; title?: string }): string => f.title || folderName(f.path)
/** 0.26 两行时间（最后更新 / 归档）。 */
export function timesHtml(u: string | null | undefined, a: string | undefined, ua = '最后更新', aa = '归档'): string {
  const t = (x: string | null | undefined): string => (x ? dayTime(x) || '—' : '—')
  return '<span class="times" aria-label="' + ua + ' ' + t(u) + '，' + aa + ' ' + t(a) + '"><span class="k">' + ua + '</span><time' + (u ? ' datetime="' + esc(u) + '"' : '') + '>' + t(u) + '</time><span class="k">' + aa + '</span><time' + (a ? ' datetime="' + esc(a) + '"' : '') + '>' + t(a) + '</time></span>'
}
export const newTaskId = (): string => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
export const REF_RE = /\[(\d{1,2})\]/g
/** 解除绑定：说明里引用它的 [k] → 「链接名」，后面的编号前移（与服务端 dropRef 一致）。 */
export function dropRef(note: string, links: string[], id: string, text: string): { note: string; links: string[] } {
  const k = links.indexOf(id) + 1
  if (!k) return { note, links }
  return { links: links.filter((x) => x !== id), note: note.replace(REF_RE, (m, n: string) => (+n === k ? '「' + text + '」' : +n > k ? '[' + (+n - 1) + ']' : m)) }
}
const p2 = (n: number): string => String(n).padStart(2, '0')
/** 子任务时间：当天 =「今天 07:30」，其他 =「2026-10-12 10:30」。 */
export function dayTime(iso: string | undefined, now = new Date()): string {
  const d = new Date(iso ?? '')
  if (Number.isNaN(d.getTime())) return ''
  return (d.toDateString() === now.toDateString() ? '今天' : d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
}
/** v141（4.4）/ v142（2.2）：详情相关链接按类型分组，顺序 = 类型管理里的顺序（类型组里的类型 → 未归类 → 无类型）。 */
export function linkTypeBuckets(ls: WebLink[], groups: TypeGroup[], types: string[]): Array<{ name: string; type: string; items: Array<{ l: WebLink; i: number }> }> {
  const inG = new Set(groups.flatMap((g) => g.types))
  const order = [...groups.flatMap((g) => g.types), ...types.filter((t) => !inG.has(t))]
  const rank = (t: string): number => (!t ? 1e6 : (order.indexOf(t) + 1 || 1e5))
  const by = new Map<string, Array<{ l: WebLink; i: number }>>()
  ls.forEach((l, i) => { const k = l.type || ''; if (!by.has(k)) by.set(k, []); (by.get(k) as Array<{ l: WebLink; i: number }>).push({ l, i }) })
  return [...by.keys()].sort((a, b) => rank(a) - rank(b)).map((t) => ({ name: t || '无类型', type: t, items: by.get(t) as Array<{ l: WebLink; i: number }> }))
}
/** 相关链接分组：类型组顺序，其后「其他类型」（未归类）、「无类型」；只返回有链接的组。 */
export function linkBuckets(ls: WebLink[], groups: TypeGroup[]): Array<{ name: string; items: Array<{ l: WebLink; i: number }> }> {
  const gOf = (ty: string): string => (!ty ? '无类型' : groups.find((g) => g.types.includes(ty))?.name ?? '其他类型')
  const order = [...groups.map((g) => g.name), '其他类型', '无类型']
  const by = new Map<string, Array<{ l: WebLink; i: number }>>(order.map((n) => [n, []]))
  ls.forEach((l, i) => (by.get(gOf(l.type)) as Array<{ l: WebLink; i: number }>).push({ l, i }))
  return order.filter((n) => (by.get(n) as unknown[]).length).map((n) => ({ name: n, items: by.get(n) as Array<{ l: WebLink; i: number }> }))
}
/** 0.14 与服务端 urlKey 同口径：协议 + 域名（小写）+ 路径（去掉末尾 /）+ 查询 + 锚点。 */
export function urlKey(url: string): string { try { const u = new URL(url); return u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search + u.hash } catch { return url.trim() } }
/** 「N 天前添加过」 */
export function addedAgo(at: string, now = Date.now()): string { const d = Math.floor((now - Date.parse(at)) / 864e5); return !Number.isFinite(d) ? '' : d <= 0 ? '今天添加过' : d === 1 ? '昨天添加过' : d + ' 天前添加过' }
/** 前端即时校验（与服务端 normUrl 同口径）：只收 http(s)；没写协议但像域名 → 补 https://。 */
export function checkUrl(v: string): { url?: string; err?: string } {
  let s = v.trim()
  if (!s) return { err: '请填写完整链接' }
  if (/\s/.test(s)) return { err: '链接里不能有空格或换行' }
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d/.test(s)) return { err: '只支持 http:// 或 https:// 开头的链接' }
    if (!/^[^/]+\.[^/]+/.test(s) && !/^localhost(:|\/|$)/i.test(s)) return { err: '不像网址，请填 https:// 开头的完整链接' }
    s = 'https://' + s
  }
  try {
    const u = new URL(s)
    if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !u.hostname.startsWith('[')) return { err: '域名不完整：' + u.hostname }
    return { url: u.href }
  } catch { return { err: '链接格式不对' } }
}
export const linkify = (t: string): string => esc(t).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?，。；：！？）)\]]/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>')

/** 卡片上的会话标志：已删除（dsh 里找不到）的不算；返回总数与活跃数，没有会话 = null。 */
export function sessBadge(refs: ReadonlyArray<{ sessionId: string }>, idx: ReadonlyMap<string, { archived: boolean }>): { n: number; live: number } | null {
  let n = 0, live = 0
  for (const r of refs) { const v = idx.get(r.sessionId); if (!v) continue; n++; if (!v.archived) live++ }
  return n ? { n, live } : null
}

/** 0.32 全局卡片详情：只有一个详情实例，挂在 body 最右侧；所有看板 / 会话窗口都复用它。 */
export const detailState: { sel: string | null; open: boolean; subs: Set<(id: string | null) => void> } = { sel: null, open: false, subs: new Set() }
function notifyDetail(): void { for (const f of [...detailState.subs]) { try { f(detailState.sel) } catch { /* 单个订户失败不影响别的看板 */ } } window.dispatchEvent(new Event('dpm-detail')) }

export class BoardView {
  snap: Snapshot | null = null
  sel: string | null = null
  q = ''
  err = ''
  editG: string | null = null
  private timer: (() => void) | null = null
  private syncing = false
  /** 0.15：右上角「正在同步…」，只在首次同步超过 300ms 时出现（快的时候不闪）。 */
  private syncTimer = 0
  private syncBadge(): void {
    const b = this.root.querySelector('.pm-sync') as HTMLElement | null
    if (!b) return
    clearTimeout(this.syncTimer)
    if (!this.syncing) { b.classList.remove('on'); return }
    this.syncTimer = window.setTimeout(() => { if (this.syncing) b.classList.add('on') }, 300)
  }
  /** v86：这个视图的实例 id（跨实例同步时区分是谁改的，别自己刷自己）。 */
  private vid = 'v' + Math.random().toString(36).slice(2, 9)
  private offChanged: (() => void) | null = null
  private link: { kind: 'group' | 'card'; id: string; sel: Set<string>; locked: Set<string>; q: string } | null = null
  private disposers: Array<() => void> = []
  /** 最近一次输入是否来自键盘：鼠标点编辑 / 保存等按钮后不把焦点环还给按钮（去蓝框）；键盘操作保留焦点。 */
  private kbd = false
  private disposed = false
  /** 正在就地添加卡片的阶段；addDraft 跨重绘保留输入。 */
  private adding: { g: string; col: string } | null = null
  private addDraft = ''
  private addBusy = false
  private rendering = false
  private composing = false
  /** 「添加挂载仓库」弹窗的草稿：候选搜索词、已选项、是否降级为手输路径。 */
  /** 添加仓库弹窗：mode=group → 卡片组的「卡片共用仓库」；mode=card → 这张卡片自己的仓库（id = 组 id / 卡片 id）。 */
  private ar: { mode: 'group' | 'card'; id: string; q: string; sel: Array<{ path: string; name: string; role: string }>; manual: boolean; busy: boolean; fp?: { open: boolean; text: string; res: PathCheck[]; seq: number }; /** v137：仓库新增默认注入 */ on?: boolean } | null = null
  private arFpTimer = 0
  /** 「关联已有会话」弹窗草稿；cf = 待确认解除关联的会话。 */
  private ls: { card: string; q: string; sel: string[]; busy: boolean } | null = null
  private cf: string | null = null
  private restoring = new Set<string>()
  /** 相关说明编辑态（card = 正在编辑的卡片，draft = 草稿）；没保存过的卡片始终是输入框。 */
  /** 0.24 相关说明编辑态：k = 第几条（-1 = 新增）；err = 't' 小标题空 / 'v' 内容空。 */
  private noteEdit: { card: string; k: number; t: string; v: string; err: string; pinNew?: boolean; /** v137：注入开关（新增默认开） */ on?: boolean } | null = null
  private chipSig = ''
  /** 展开了「已归档卡片」列表的卡片组（默认全部收起，只在本次打开期间记住）。 */
  private tray = new Set<string>()
  /** 等待「停止并归档」确认的会话。 */
  private sa: { id: string; title: string } | null = null
  /** 0.10：展开了完整「相关说明」的卡片（本次打开期间记住）。 */
  private noteOpen = new Set<string>()
  /** 0.12：当前卡片的两个列表是否「展示更多」（切换卡片回到默认 3 项）。 */
  private more = { card: '', sess: false, mem: false }
  private moreOf(c: Card): { sess: boolean; mem: boolean } { if (this.more.card !== c.id) this.more = { card: c.id, sess: false, mem: false }; return this.more }
  /** 0.10：「添加 / 编辑相关链接」弹窗草稿。 */
  private wl: { card: string; mode: 'add' | 'edit'; idx: number; rows: WlRow[]; /** v136 */ off?: boolean } | null = null
  /** v96：任务弹窗点「新增」→ 打开同一个添加链接弹窗，保存后把新链接交回去自动绑定。 */
  private wlAddCb: ((items: WebLink[]) => void) | null = null
  /** v96：任务弹窗点「新增文件」→ 打开同一个添加文件弹窗，保存后把新文件 id 交回去自动绑定。 */
  private faAddCb: ((ids: string[]) => void) | null = null
  /** 0.10：相关链接拖动排序（pointer：按住手柄拖动，松开落位，Esc 取消）。 */
  private wd: { i: number; y0: number; on: boolean; to: number | undefined } | null = null

  /** 0.31 页面模式：board = 项目看板；sched = 任务日程看板（同一个面板，同一个右侧卡片详情）。 */
  mode: 'board' | 'sched' = 'board'
  private schedView: SchedView | null = null
  /** 任务日程看板下卡片详情的宽度（null = 默认 clamp(360,28vw,440)；360–min(760, 主区−560)）。 */
  private dw: number | null = null
  /** 全局卡片详情的宽度（null = 420；全局详情独立于看板页，宽度存 ui.gantt.dw）。 */
  private gdw = 420

  private detailOff: (() => void) | null = null
  constructor(readonly root: HTMLElement, readonly host: BoardHost, readonly opts: { detailOnly?: boolean; startMode?: 'board' | 'sched'; /** v136：只装弹窗（会话输入框「添加为…」用），永远不画详情、不碰全局详情状态 */ dialogsOnly?: boolean } = {}) {
    root.classList.add('dpm')
    if (opts.detailOnly) root.classList.add('dpm-detail-only')
    root.innerHTML = '<div class="pm-top"></div><div class="pm-mgr" role="toolbar" aria-label="卡片组管理"></div><div class="pm-body"><div class="board-wrap"></div><div class="sched-wrap" hidden></div></div>' + DIALOGS.replace('%FOLDER%', ic('fplus')).replaceAll('%PLUS%', ic('plus')).replaceAll('%X%', ic('x')).replace('%FILE%', ic('file'))
    this.bind()
    /* v140（1）：详细信息气泡窗（只在全局详情里） */
    if (opts.detailOnly && !opts.dialogsOnly) this.dp = new DetailPop({
      root, card: () => (this.sel ? this.card(this.sel) : undefined), snap: () => this.snap, quote: (t) => void this.copyQuote(t),
      edit: (cid, tid) => { if (this.host.taskDialog) this.host.taskDialog({ cardId: cid, mode: 'edit', taskId: tid }) },
      toast: (m, k) => this.host.toast(m, k), openCard: (id) => openGlobalDetail(this.host, id), openSession: (id) => this.host.openSession(id),
      sessions: () => this.host.allSessions().map((x) => ({ id: x.id, title: x.title })), ftIcon: (p) => ftype(p)?.icon ?? 'file',
    })
    /* v107 ②：查重候选行标题被截断时悬停跑马灯（双份轨道、28px 间距、约 45px/s） */
    const mqStop = (nm: HTMLElement | null): void => {
      if (!nm || !nm.dataset.mqOn) return
      delete nm.dataset.mqOn
      nm.style.textOverflow = ''
      nm.textContent = nm.dataset.mqTxt ?? nm.title
    }
    const mqStart = (nm: HTMLElement | null): void => {
      if (!nm || nm.dataset.mqOn) return
      if (nm.scrollWidth <= nm.clientWidth + 1) return
      const txt = nm.textContent ?? ''
      nm.dataset.mqOn = '1'; nm.dataset.mqTxt = txt
      nm.style.textOverflow = 'clip'
      nm.innerHTML = '<span class="nm-tr"><span class="nm-t"></span><span class="nm-t" aria-hidden="true"></span></span>'
      const ts = nm.querySelectorAll('.nm-t')
      ;(ts[0] as HTMLElement).textContent = txt; (ts[1] as HTMLElement).textContent = txt
      const tr = nm.querySelector('.nm-tr') as HTMLElement
      const w = ts[0].getBoundingClientRect().width
      tr.style.setProperty('--mqx', '-' + (w + 28) + 'px')
      tr.style.setProperty('--mqd', Math.max(3, (w + 28) / 45) + 's')
      requestAnimationFrame(() => tr.classList.add('mq'))
    }
    const onOver = (e: Event): void => { const r = (e.target as HTMLElement)?.closest?.('.ddup-r'); if (r) mqStart(r.querySelector('.ddtx .nm')) }
    const onOut = (e: Event): void => {
      const r = (e.target as HTMLElement)?.closest?.('.ddup-r') as HTMLElement | null
      if (!r) return
      if (r.contains((e as PointerEvent).relatedTarget as Node | null)) return
      mqStop(r.querySelector('.ddtx .nm'))
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    this.disposers.push(() => { document.removeEventListener('pointerover', onOver); document.removeEventListener('pointerout', onOut) })
    const onChanged = (e: Event): void => { if (this.disposed) return; if ((e as CustomEvent).detail === this.vid) return; void this.refresh() }
    document.addEventListener('dpm:board-changed', onChanged)
    this.offChanged = () => document.removeEventListener('dpm:board-changed', onChanged)
    if (!opts.detailOnly) {
      const sync = (id: string | null): void => {
        if (this.disposed || this.sel === id) return
        this.sel = id
        if (!id) { this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null; this.back = null; this.tkDetail = null }
        this.render()
      }
      detailState.subs.add(sync)
      this.detailOff = () => detailState.subs.delete(sync)
    }
    // 0.15：有上次的快照就立刻画（看板不再等第一次请求），否则画骨架；后台同步完成后静默更新
    const seed = host.seed?.() ?? null
    if (seed) this.snap = seed
    if (opts.startMode === 'sched') this.boardDirty = true; else this.render()
    queueMicrotask(() => { if (this.wantCard && this.snap) void this.focusCard(this.wantCard) })
    this.syncing = true
    this.syncBadge()
    void this.refresh().finally(() => { this.syncing = false; this.syncBadge() })
    this.timer = poll(4000, () => { if (this.root.isConnected) void this.refresh(true) })
  }

  /** 0.19 从会话信息卡直达：选中卡片、打开详情、滚到它、闪一下蓝框（快照还没到就等下一次渲染）。 */
  private wantCard: string | null = null
  async focusCard(id: string): Promise<void> {
    if (!this.card(id)) { this.wantCard = id; return }
    this.wantCard = null
    if (this.mode === 'sched') { openGlobalDetail(this.host, id); this.schedView?.reveal(id); return }
    const c = this.card(id) as Card
    if (c.archivedAt) this.tray.add(c.g)
    const selChanged = this.sel !== id
    if (selChanged) { this.noteEdit = null; this.fEdit = null; this.tolf = null }
    this.sel = id
    /* v121（6）根因：切回项目看板时每次都「展开组（写盘 + 整板重画）→ 平滑滚 → 闪框」，而且看板还在 display:none（尺寸 0）就量位置。
       现在：只在组收着时展开、选中变了才重画；等看板真的可见那一帧再量；只在卡片不在视野里时滚；同一张卡 1.5s 内只闪一次。 */
    if (this.grp(c.g)?.collapsed) await this.act('group/update', { id: c.g, collapsed: false })
    else if (selChanged || this.boardDirty || !this.root.querySelector('.board-wrap [data-card]')) this.render()
    if (!this.opts.detailOnly) openGlobalDetail(this.host, id)
    /* v151（2.1）根因：一次进入看板有三处各调一次 focusCard（挂载 pendingCard / syncMode 切页 / 新快照 wantCard），
       每次都先等一帧再 smooth 滚；同时面板挂回时先写回上次的滚动位置，smooth 途中轮询重画又打断 → 先出现旧位置、滑过去、闪回、再滑。
       改：定位令牌（后到的同卡请求合并、换卡取消前一个）；看板可见那一帧、画出来之前直接设好 scrollTop（不 smooth）；
       卡片已在视野里不动；定位后 1.5 秒内的重画保持 scrollTop（render 里用 holdTop）。 */
    const tok = ++this.revealTok
    const go = (n: number): void => {
      if (tok !== this.revealTok) return
      const wrap = this.root.querySelector('.board-wrap') as HTMLElement | null
      const el = wrap?.querySelector('[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
      if (!wrap || !el) return
      if (!wrap.clientHeight) { if (n > 0) requestAnimationFrame(() => go(n - 1)); return }
      // 只滚看板自己的滚动区（纵向）和这一组的阶段条（横向）。不用 scrollIntoView：它会连宿主外层的
      // overflow:hidden 容器一起滚，整个看板被顶上去（0.19 主实例实测）。
      const wr = wrap.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const inView = er.top >= wr.top + 8 && er.bottom <= wr.bottom - 8
      if (!inView) wrap.scrollTop = Math.max(0, wrap.scrollTop + er.top - wr.top - Math.max(16, (wrap.clientHeight - er.height) / 2))
      const lane = el.closest('.lane-in') as HTMLElement | null
      if (lane) { const lr = lane.getBoundingClientRect(); if (er.left < lr.left || er.right > lr.right) lane.scrollLeft = Math.max(0, lane.scrollLeft + er.left - lr.left - 16) }
      this.holdTop = { top: wrap.scrollTop, until: Date.now() + 1500 }
      if (this.lastReveal.id !== id || Date.now() - this.lastReveal.at > 1500) { el.classList.remove('dpm-flash'); void el.offsetWidth; el.classList.add('dpm-flash'); setTimeout(() => el.classList.remove('dpm-flash'), 1400) }
      this.lastReveal = { id, at: Date.now() }
      this.revealN++
      this.root.dataset.reveal = String(this.revealN) + ':' + (inView ? 'stay' : 'scroll')
    }
    /* 看板已经可见 = 同一帧直接定（浏览器画之前）；还在 display:none = 等它变可见那一帧 */
    const w0 = this.root.querySelector('.board-wrap') as HTMLElement | null
    if (w0 && w0.clientHeight) go(8); else requestAnimationFrame(() => go(8))
  }
  private revealTok = 0
  /** v151：定位后 1.5 秒内的重画保持这个滚动位置（不被轮询重画打回去）。 */
  holdTop: { top: number; until: number } | null = null
  private lastReveal: { id: string | null; at: number } = { id: null, at: 0 }
  private revealN = 0

  dispose(): void {
    this.disposed = true
    this.dp?.dispose(); this.dp = null
    this.offChanged?.()
    this.offChanged = null
    this.detailOff?.()
    this.detailOff = null
    document.documentElement.classList.remove('nosel')
    this.timer?.()
    clearTimeout(this.syncTimer)
    clearTimeout(this.faTimer)
    for (const d of this.disposers) d()
    this.fitRO?.disconnect(); this.fitRO = null; if (this.fitRaf) cancelAnimationFrame(this.fitRaf)
    this.schedView?.dispose()
    this.schedView = null
    this.root.innerHTML = ''
  }

  // ── 数据 ──
  get groups(): Group[] { return this.snap?.board.groups ?? [] }
  get cards(): Card[] { return this.snap?.board.cards ?? [] }
  grp(id: string): Group | undefined { return this.groups.find((g) => g.id === id) }
  card(id: string): Card | undefined { return this.cards.find((c) => c.id === id) }
  st(g: Group, id: string): Status | undefined { return g.statuses.find((s) => s.id === id) }
  stateOf(k: string): StateInfo | undefined { return this.snap?.states.find((s) => s.key === k) }
  memOf(c: Card): Array<{ k: string; from: 'group' | 'card' | 'both' }> {
    const g = this.grp(c.g)
    const out: Array<{ k: string; from: 'group' | 'card' | 'both' }> = (g?.links ?? []).map((k) => ({ k, from: 'group' as const }))
    for (const k of c.links) { const hit = out.find((x) => x.k === k); if (hit) hit.from = 'both'; else out.push({ k, from: 'card' }) }
    return out
  }
  /** 0.30：卡片自己的落盘项目（卡片组共用不算；updateCard 已保证 c.links 不含组里的 key）。 */
  ownMem(c: Card): Array<{ k: string; from: 'group' | 'card' | 'both' }> {
    return this.memOf(c).filter((m) => m.from !== 'group')
  }
  /** 卡片组共用、这张卡片自己没有的落盘项目。 */
  groupMem(c: Card): Array<{ k: string; from: 'group' | 'card' | 'both' }> {
    return this.memOf(c).filter((m) => m.from === 'group')
  }
  cardDesc(c: Card): string {
    const own = this.ownMem(c)[0]
    const s = own ? this.stateOf(own.k) : undefined
    return s ? (s.status || '暂无状态说明') : (own ? '关联的落盘项目未找到' : '未关联落盘项目')
  }
  cell(g: string, col: string): Card[] { return this.cards.filter((c) => c.g === g && c.col === col && !c.archivedAt).sort((a, b) => a.order - b.order) }
  sessionsOf(cardId: string): Array<{ id: string; title: string; at: string }> { return (this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId).map((s) => ({ id: s.sessionId, title: s.title ?? '会话 ' + s.sessionId.slice(0, 8), at: s.createdAt.slice(5, 16).replace('T', ' ') })) }

  async refresh(quiet = false): Promise<void> {
    try {
      // 0.23：子任务还有没存完的改动时不拿服务器快照覆盖（否则刚加 / 刚拖的会闪回旧样子）
      // 拖动中也不拿后台快照重画（行会在指针下面跳走，落点算错）；下一轮轮询 rev 仍不同，会补上
      if (quiet && (this.composing || this.gd || this.tkPend || this.dragging())) return
      const r = await getState(quiet && this.snap ? this.snap.rev : undefined)
      if (this.disposed || r.same) return
      this.snap = r
      this.err = ''
      this.render()
      if (this.wantCard) void this.focusCard(this.wantCard)
    } catch (e) {
      this.err = e instanceof Error ? e.message : String(e)
      this.render()
    }
  }

  async act(action: string, body: Record<string, unknown>, okMsg?: string): Promise<boolean> {
    try {
      const r = await post<Snapshot>(action, body)
      if (this.disposed) return true
      this.snap = r
      this.render()
      if (okMsg) this.host.toast(okMsg)
      this.host.syncOthers?.()
      document.dispatchEvent(new CustomEvent('dpm:board-changed', { detail: this.vid }))
      return true
    } catch (e) {
      this.host.toast(e instanceof ApiError ? e.message : String(e), 'err')
      await this.refresh()
      return false
    }
  }

  // ── 渲染 ──
  /* v133 R4：日程页开着时项目看板是 display:none —— 不重画，切回看板那一下再画（冷启动直进日程页省一整遍看板，4x CPU 约 50ms） */
  private boardDirty = false
  render(): void {
    if (this.disposed) return
    if (this.opts.detailOnly) { this.renderDetail(); return }
    if (this.mode === 'sched') { this.boardDirty = true; return }
    this.boardDirty = false
    const dark = this.host.isDark()
    const top = this.root.querySelector('.pm-top') as HTMLElement
    if (!top.firstChild) top.innerHTML = '<div class="ttl"><h1>项目看板<span class="pm-sync" role="status"><span class="dot" aria-hidden="true"></span>正在同步…</span></h1><p>一张卡片对应一个落盘项目，卡片组就是父项目。每个卡片组有自己的一套阶段。</p></div>'
      + '<label class="search">' + ic('search') + '<span class="sr-only">搜索卡片</span><input id="dpmQ" type="search" placeholder="搜索卡片 / 卡片组（含已归档）" value="' + esc(this.q) + '"></label>'
      + '<button type="button" class="btn" data-import>' + ic('import') + '导入落盘项目</button>'
      + '<button type="button" class="btn primary" data-new-group>' + ic('plus') + '新建卡片组</button>'
      + '<button type="button" class="ib" data-theme-toggle></button>'
    const tb = top.querySelector('[data-theme-toggle]') as HTMLElement
    const want = dark ? 'sun' : 'moon'
    if (tb.dataset.icon !== want) { tb.dataset.icon = want; tb.innerHTML = ic(want); tb.setAttribute('aria-label', '切换到' + (dark ? '浅色' : '深色') + '主题') }
    const body = this.root.querySelector('.pm-body') as HTMLElement
    const wrap = body.querySelector('.board-wrap') as HTMLElement
    const scroll = this.holdTop && Date.now() < this.holdTop.until ? this.holdTop.top : wrap.scrollTop
    const addFocus = document.activeElement?.id === 'dpmAddIn'
    this.rendering = true
    const laneX = new Map<string, number>()
    wrap.querySelectorAll<HTMLElement>('.lane-in[data-g]').forEach((el) => laneX.set(el.dataset.g as string, el.scrollLeft))
    this.idxCache = this.sessIndex()
    ;(this.root.querySelector('.pm-mgr') as HTMLElement).innerHTML = this.snap && this.groups.length ? this.mgrHtml() : ''
    ;(this.root.querySelector('.pm-mgr') as HTMLElement).hidden = !(this.snap && this.groups.length)
    try { wrap.innerHTML = (this.err ? '<div class="dpm-err" role="alert">' + esc(this.err) + '</div>' : '') + this.lfNoteHtml() + (this.garOpen && this.snap ? this.garHtml() : '') + this.boardHtml() + '<div class="edge top" aria-hidden="true"><span>' + ic('up') + '贴近上边，继续往上滚</span></div><div class="edge bot" aria-hidden="true"><span>' + ic('down') + '贴近下边，继续往下滚</span></div>' } finally { this.idxCache = null }
    this.chipSig = this.chipSignature()
    wrap.scrollTop = scroll
    wrap.querySelectorAll<HTMLElement>('.lane-in[data-g]').forEach((el) => { const x = laneX.get(el.dataset.g as string); if (x) el.scrollLeft = x })
    const addIn = wrap.querySelector('#dpmAddIn') as HTMLInputElement | null
    if (!addIn) this.adding = null
    else if (addFocus) { addIn.focus(); addIn.setSelectionRange(addIn.value.length, addIn.value.length) }
    this.rendering = false
    this.watchLanes()
  }

  /* ── v99：阶段列整列铺满 + 翻列箭头 ──
     列宽 = (可用宽 − 间隙) / 能放下的整列数（阶段少时就按阶段数平分），这样静息状态永远是整列、
     不会切半张卡；阶段更多时右边缘渐隐 + ‹ › 箭头（点一下滚一整列），到最左 / 最右自动隐藏对应那颗。 */
  private laneRo: ResizeObserver | null = null
  private laneT = 0
  private syncLaneNav(): void {
    /* v133 R4：项目看板不可见（在日程页）时不量阶段列 —— 切回看板那一帧再量 */
    if (this.mode === 'sched') return
    const wrap = this.root.querySelector('.board-wrap') as HTMLElement | null
    if (!wrap) return
    for (const lane of wrap.querySelectorAll<HTMLElement>('.lane[data-lane]')) {
      const box = lane.querySelector('.lane-in') as HTMLElement | null
      if (!box) continue
      const stages = lane.querySelectorAll('.lane-b > .cell').length
      const pad = 20, gap = 8, minW = 176
      const avail = Math.max(140, box.clientWidth - pad)
      const fit = Math.max(1, Math.floor((avail + gap) / (minW + gap)))
      const n = stages ? Math.min(stages, fit) : fit
      const colw = Math.max(120, Math.floor((avail - gap * (n - 1)) / n))
      lane.style.setProperty('--colw', colw + 'px')
      const max = box.scrollWidth - box.clientWidth
      const atEnd = box.scrollLeft >= max - 2
      lane.classList.toggle('scrollable', max > 2)
      lane.classList.toggle('at-end', atEnd)
      const l = lane.querySelector('[data-lanescroll="-1"]') as HTMLButtonElement | null
      const r = lane.querySelector('[data-lanescroll="1"]') as HTMLButtonElement | null
      if (l) l.disabled = box.scrollLeft <= 2
      if (r) r.disabled = atEnd
    }
  }
  private watchLanes(): void {
    const wrap = this.root.querySelector('.board-wrap') as HTMLElement | null
    if (!wrap) return
    this.syncLaneNav()
    if (typeof ResizeObserver !== 'function') return
    if (!this.laneRo) this.laneRo = new ResizeObserver(() => { if (!this.disposed) this.syncLaneNav() })
    this.laneRo.disconnect()
    this.laneRo.observe(wrap)
    for (const box of wrap.querySelectorAll('.lane-in')) this.laneRo.observe(box)
    if (!this.laneScrollBound) {
      this.laneScrollBound = true
      this.on(wrap, 'scroll', (e) => {
        const box = e.target as HTMLElement
        if (box?.classList?.contains('lane-in')) this.syncLaneNav()
      }, true)
      window.addEventListener('resize', () => { clearTimeout(this.laneT); this.laneT = window.setTimeout(() => this.syncLaneNav(), 160) })
    }
  }
  private laneScrollBound = false
  private laneScroll(btn: HTMLElement, dir: number): void {
    const lane = btn.closest('.lane') as HTMLElement | null
    const box = lane?.querySelector('.lane-in') as HTMLElement | null
    if (!lane || !box) return
    const col = lane.querySelector('.lane-b > .cell') as HTMLElement | null
    const step = (col ? col.getBoundingClientRect().width : 200) + 8
    box.scrollBy({ left: step * dir, behavior: 'smooth' })
    setTimeout(() => this.syncLaneNav(), 420)
  }

  /**
   * 详情栏：换卡片 = 新插入（播放滑入）；同一张卡片 = 内容没变不动，变了就原地替换内容
   * （不重新插入节点、不重放动画，保留滚动、子任务草稿与焦点）——会话推送很频繁，整块重建会「闪」。
   */
  private lastDetail = ''
  private fixRaf = 0
  private dp: DetailPop | null = null
  renderDetail(): void {
    if (this.opts.dialogsOnly) return
    if (!this.opts.detailOnly) { this.root.querySelector('.detail')?.remove(); return }
    const body = this.root.querySelector('.pm-body') as HTMLElement
    const old = body.querySelector('.detail') as HTMLElement | null
    if (!this.sel) {
      old?.remove(); this.lastDetail = ''; this.applyDw()
      if (this.opts.detailOnly && detailState.open) { this.root.hidden = true; this.showGlobal(false); detailState.open = false; detailState.sel = null; notifyDetail() }
      return
    }
    // 全局详情：快照还没跟上时先保留选中的卡片，等下一次同步再画（不能把 sel 清掉直接关掉详情）
    if (!this.card(this.sel)) { if (this.opts.detailOnly) return; this.sel = null; old?.remove(); this.lastDetail = ''; this.applyDw(); return }
    const html = this.detailHtml()
    const fresh = !(old && old.getAttribute('data-card') === this.sel)
    if (!fresh && old) {
      if (html === this.lastDetail) return
      // 正在输入相关说明时不原地替换（会丢光标）；失焦后的下一次推送再更新
      // 0.26.1：文件标题框不在此列——草稿存在 fEdit 里，重画不丢；保存 / 取消后焦点还留在旧输入框，跳过会让界面一直停在编辑态
      if ((document.activeElement?.id === 'dpmNkV' || document.activeElement?.id === 'dpmNkT') && old.contains(document.activeElement) && !this.noteEdit) return
      /* v121（5）：任何输入框正在选字时绝不替换详情 DOM（选字框会当场消失）—— compositionend 会补一次 */
      if (this.composing && old.contains(document.activeElement)) { this.pushPend = true; return }
      const tpl = document.createElement('template')
      tpl.innerHTML = html
      const nd = tpl.content.firstElementChild as HTMLElement
      const scroll = (old.querySelector('.d-b') as HTMLElement | null)?.scrollTop ?? 0
      // 0.25 弹出列表（绑定链接 / 关联卡片）自己的滚动位置也保留
      const inner = Array.from(old.querySelectorAll<HTMLElement>('.lp-l, .rp-l')).map((n) => [n.closest('[id]')?.id ?? '', n.scrollTop] as const)
      const task = (old.querySelector('#dpmNewTask') as HTMLInputElement | null)?.value ?? ''
      const focusId = old.contains(document.activeElement) ? keyOf(document.activeElement as HTMLElement) : null
      const quiet = (document.activeElement as HTMLElement | null)?.getAttribute('tabindex') === '-1' && !!(document.activeElement as HTMLElement).matches('.frow-f, .task')
      // 0.23：输入框（子任务编辑等）原地重画后光标 / 选区留在原处
      const ae = document.activeElement as HTMLInputElement | null
      const selr = focusId && ae && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd ?? ae.selectionStart] as const : null
      // v90 验收发现：原地换内容只替换子节点，根节点的 ro（只读）不跟着变 —— 在详情里点归档后，
      // 内容已经是只读、根节点却还当可编辑（cursor / 只读样式不同步）。这里只同步这一个记号。
      old.classList.toggle('ro', nd.classList.contains('ro'))
      old.classList.add('stay')
      old.replaceChildren(...Array.from(nd.childNodes))
      this.decorateDetail()
      // 先定折叠（相关说明可能变矮），再恢复滚动——否则勾选子任务后整页被往上拽（0.22 修）
      this.fixNotes()
      const db = old.querySelector('.d-b') as HTMLElement | null
      if (db) db.scrollTop = scroll
      for (const [id, y] of inner) { const n = id ? old.querySelector('#' + CSS.escape(id) + ' :is(.lp-l, .rp-l)') as HTMLElement | null : null; if (n) n.scrollTop = y }
      const inp = old.querySelector('#dpmNewTask') as HTMLInputElement | null
      if (inp && task) inp.value = task
      if (focusId) {
        const n = old.querySelector(focusId) as HTMLInputElement | null
        // 0.27 保存后落在这一行本身的焦点（tabindex=-1）重画后照样留在这一行
        if (n && quiet) { n.tabIndex = -1; n.addEventListener('blur', () => n.removeAttribute('tabindex'), { once: true }) }
        n?.focus({ preventScroll: true })
        if (n && selr && typeof n.setSelectionRange === 'function') try { n.setSelectionRange(selr[0], selr[1]) } catch { /* 非文本输入框 */ }
      }
    } else {
      /* v133：换卡时焦点还在旧详情里 → 当场删节点会同步失焦，页面里大量 :focus-within / :has() 规则让整页 5000+ 节点在点击处理里重算（1x 30ms / 4x 130–200ms）。
         这种情况先藏起来、改掉 .detail 类名（别处查询不到它），空闲时再删：失焦挪到点击之后的空闲任务里。 */
      if (old && old.contains(document.activeElement)) {
        old.style.setProperty('display', 'none', 'important'); old.classList.replace('detail', 'detail-gone')
        old.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))   // 不和新详情撞 id
        requestIdleCallback(() => old.remove(), { timeout: 800 })
      } else old?.remove()
      body.insertAdjacentHTML('beforeend', html)
      this.decorateDetail()
    }
    this.lastDetail = html
    /* v133 R4：新插入的详情没有滚动要恢复 —— 说明折叠放到下一帧量（点击里不强制整页布局，主实例 1x 曾占 109ms） */
    if (fresh) { if (!this.fixRaf) this.fixRaf = requestAnimationFrame(() => { this.fixRaf = 0; if (!this.disposed) this.fixNotes() }) } else this.fixNotes()
    this.ensureCdHandle()
    this.applyDw()
    if (this.ring) this.paintRing()
    this.dp?.sync()
  }

  /**
   * v92：从 /goal 消息添加任务后，把详情滚到这条任务并高亮。
   * 详情可能正在渲染（打开 / 刷新是异步的）→ 轮询到出现为止（最多 ~2s，不阻塞）。
   */
  revealTask(taskId: string, tries = 90, parentId?: string | null): void {
    // v94：定位子任务时先把父任务的子任务列表展开（否则这条行根本不在 DOM 里）
    if (parentId) {
      const added = this.tkClosed.has(parentId)
      this.tkClosed.delete(parentId)
      this.tkViewOpen.add(parentId)
      if (added) { this.lastDetail = ''; this.renderDetail() }
    }
    const tick = (n: number): void => {
      if (this.disposed) return
      // 任务分区默认是收起的：不展开的话行虽然在 DOM 里，用户看不到（高度 0）
      const sec = this.root.querySelector('.detail #dpmTaskSec') as HTMLElement | null
      if (sec && !sec.classList.contains('x')) this.secOpen(sec)
      const sel = '.detail .tile[data-tile="' + CSS.escape(taskId) + '"], .detail .task[data-tid="' + CSS.escape(taskId) + '"]'
      const el = this.root.querySelector(sel) as HTMLElement | null
      if (el && el.getBoundingClientRect().height > 0) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('gt-new')
        setTimeout(() => el.classList.remove('gt-new'), 1600)
        // v93 验收抓到：分区刚展开 / 详情刚重画时，第一次 scrollIntoView 会被随后的重排抹掉（scrollTop 回到 0）
        // → 之后几帧复检一次，没在视野里就再滚（auto，不带平滑，保证落位）
        const ensure = (left: number): void => {
          const r = el.getBoundingClientRect()
          if (left <= 0 || (r.top >= 0 && r.bottom <= innerHeight)) return
          el.scrollIntoView({ block: 'center' })
          setTimeout(() => ensure(left - 1), 120)
        }
        setTimeout(() => ensure(6), 120)
        return
      }
      if (n <= 0) return
      requestAnimationFrame(() => tick(n - 1))
    }
    tick(tries)
  }

  /* ── 0.31 任务日程看板：同一个面板的第二页（右侧卡片详情共用；详情宽度可拖 360–672 并记住）── */
  /** 切页：board = 项目看板；sched = 任务日程看板（点侧栏第二个按钮进）。 */
  setMode(m: 'board' | 'sched'): void {
    /* v127（7）：看板根节点复用后，重新挂载会以同一模式再调一次；宽度变化由甘特的 ResizeObserver 负责，这里不再白画一遍 */
    if (this.mode === m) return
    this.mode = m
    this.root.classList.toggle('sched-mode', m === 'sched')
    const sw = this.root.querySelector('.sched-wrap') as HTMLElement | null
    if (sw) sw.hidden = m !== 'sched'
    // v90：只有日程页开着才轮询 / 起后台会话统计 —— 切回项目看板后宿主立刻轻下来（不再解压会话日志）。
    this.schedView?.setActive(m === 'sched')
    if (m === 'sched') {
      if (!this.schedView) this.ensureSched()
      /* v133 R4：切到日程页只拉一次 /gantt —— 新建时构造函数自己拉，已建好的由上面 setActive(true) 拉 */
    }
    /* v133 R4：先切显隐（这一帧就看到看板），日程页期间攒下的重画 / 量阶段列放到下一帧 */
    else requestAnimationFrame(() => {
      if (this.disposed || this.mode !== 'board') return
      if (!this.boardDirty) { this.syncLaneNav(); return }
      /* 看板画过：先上屏旧画面，重画放到这一帧之后；从没画过（冷启动直进日程页）就在上屏前画，免得闪一帧空白 */
      if (!this.root.querySelector('.board-wrap')?.firstChild) this.render()
      else setTimeout(() => { if (!this.disposed && this.mode === 'board' && this.boardDirty) this.render() }, 0)
    })
    this.ensureCdHandle()
    this.applyDw()
  }
  /** v143（1.1）：每日任务面板独立成列 —— 不在日程页也要有 SchedView（面板在 body 上的列里，甘特根节点留在看板的 sched-wrap 里不显示） */
  ensureSched(): SchedView | null {
    if (this.schedView) return this.schedView
    const sw = this.root.querySelector('.sched-wrap') as HTMLElement | null
    if (!sw) return null
    {
      {
        this.schedView = new SchedView(sw, {
          toast: (msg, kind) => this.host.toast(msg, kind),
          openCard: (id) => this.showDetail(id),
          openCardTasks: (id, tid) => this.showDetailTasks(id, tid),
          // v86：日程页「只展开活跃卡片组」和看板同一口径（有活跃会话的组）
          liveGroups: () => this.liveGroupIds(),
          // v122：面板里勾了任务完成 → 详情 / 看板换成最新快照（同一份任务数据）
          tasksChanged: () => { void this.refresh(); this.host.syncOthers?.() },
          todayChanged: (on) => { window.dispatchEvent(new CustomEvent('dpm:today', { detail: { on } })) },
          uiChanged: (ui) => {
            if (this.root.classList.contains('cd-resizing')) return
            this.dw = typeof ui.dw === 'number' ? ui.dw : null
            if (this.mode === 'sched') this.applyDw()
          },
        })
        this.dw = this.schedView.detailWidth()
        this.schedView.setActive(this.mode === 'sched')
      }
    }
    return this.schedView
  }

  /** v121（3）：侧栏「今天」—— 已在日程页就直接打开今天面板；SchedView 还没建好就等它建好再开。 */
  /** v143（1.1）：「今天」= 在当前页打开每日任务面板列（不再跳到日程看板） */
  openToday(): void { this.ensureSched()?.openToday() }
  todayOn(): boolean { return !!this.schedView?.root.classList.contains('tp-on') }
  closeToday(): void { this.schedView?.closeToday() }
  /** v127：状态按钮 → 今天面板定位；排今天开关 → 排进今天（SchedView 没建好就先切到日程页）。 */
  seekToday(keys: string[]): void { this.ensureSched()?.seek(keys) }
  reloadSched(): void { this.schedView?.reload() }

  /** 从任务日程看板点项目名：在右侧打开这张卡片的详情（不切页）。 */
  showDetail(id: string): void {
    if (!this.card(id)) { this.wantCard = id; return }
    this.wantCard = null
    this.sel = id
    if (this.opts.detailOnly) this.renderDetail()
    else openGlobalDetail(this.host, id, this.dw)
    this.schedView?.layout()
    // v88：选中变化只同步 aria-pressed（品牌蓝描边 + 浅蓝光圈），不整块重画、不跳滚动
    this.paintPressed()
  }

  /** v105：面板里点任务项卡片 → 打开这张卡片的详情并直接落在「任务」区域。 */
  showDetailTasks(id: string, tid?: string | null): void {
    if (!this.card(id)) { this.wantCard = id; return }
    this.wantCard = null
    this.sel = id
    if (this.opts.detailOnly) this.renderDetail()
    else { openGlobalDetail(this.host, id, this.dw, (g) => g.ringPrep(id, tid ?? null)); const g = globalDetailView(); if (tid) g?.openTasksSec(); else g?.focusTasksSection(); g?.ringTask(id, tid ?? null) }
    this.schedView?.layout()
    this.paintPressed()
  }

  /** v129（3）：只展开「任务」分区（定位到某张任务卡时用，不滚到顶、不闪整个分区）。 */
  openTasksSec(): void {
    const sec = this.root.querySelector('.detail #dpmTaskSec') as HTMLElement | null
    if (sec && !sec.classList.contains('x')) this.secOpen(sec)
  }
  /* v129（3）/ v131（1）：点执行安排 / 计划清单里的项目 / 任务 / 子任务 → 详情里那张卡（项目 = 整个详情）彩虹高光。
     先展开需要的分组（已完成 / 子任务列表 / 已完成子任务），滚动时让出吸顶标题（任务 56px、子任务 112px）；
     详情中途重画会换掉节点 → renderDetail 末尾按已过去的时间接着同一拍重挂。 */
  private ring: { cid: string; tid: string | null; at: number } | null = null
  /** v133 R4：先把要展开的分组记好（在详情第一次画之前调）—— 之后 ringTask 就不用为了展开再整块重画一遍。 */
  ringPrep(cid: string, tid: string | null): boolean {
    const c = this.card(cid)
    const loc = tid && c ? tFind(c.tasks ?? [], tid) : null
    let need = false
    if (loc?.p) {
      const pid = loc.p.id as string
      if (this.tkClosed.delete(pid)) need = true
      if (loc.t.done && !loc.p.done && !this.tkSubDone.has(pid)) { this.tkSubDone.add(pid); need = true }
      if (loc.p.done && !this.tkDoneOpen) { this.tkDoneOpen = true; need = true }
    } else if (loc?.t.done && !this.tkDoneOpen) { this.tkDoneOpen = true; need = true }
    return need
  }
  ringTask(cid: string, tid: string | null): void {
    /* v133 R3：不再等 380ms —— 详情已经同步画好（openGlobalDetail → render），同一帧就开始高光 */
    {
      if (this.disposed || this.sel !== cid) return
      const c = this.card(cid)
      const loc = tid && c ? tFind(c.tasks ?? [], tid) : null
      if (this.ringPrep(cid, tid)) { this.lastDetail = ''; this.renderDetail() }
      this.openTasksSec()
      /* v133 R3：高光节点同步挂上（和详情同一次上屏，首次点击不再晚一帧）；滚到视野要读布局，放下一帧 */
      this.ring = { cid, tid: loc ? tid : null, at: performance.now() }
      this.paintRing()
      if (loc) requestAnimationFrame(() => { const el = this.ringTarget(); if (el && el !== this.root.querySelector('.detail')) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) })
      setTimeout(() => { if (this.ring && performance.now() - this.ring.at >= 1850) this.ring = null }, 1900)
    }
  }
  private ringTarget(): HTMLElement | null {
    const r = this.ring
    const det = this.root.querySelector('.detail') as HTMLElement | null
    if (!r || !det || this.sel !== r.cid) return null
    if (!r.tid) return det
    const q = CSS.escape(r.tid)
    return (det.querySelector('.tile[data-tile="' + q + '"]') ?? det.querySelector('.task.child[data-tid="' + q + '"]') ?? det) as HTMLElement
  }
  private paintRing(): HTMLElement | null {
    const r = this.ring
    if (!r) return null
    const el = performance.now() - r.at
    if (el >= 1850) { this.ring = null; return null }
    const t = this.ringTarget()
    if (t && !t.querySelector(':scope > .v9ring')) ringEl(t, Math.round(el), t !== this.root.querySelector('.detail'))
    return t
  }

  /** v105：把详情的「任务」分区展开、滚到顶、轻微高亮一下（面板点任务项用）。 */
  focusTasksSection(): void {
    /* 详情打开后还可能跟着数据回包再整块重画一次（换掉节点）：只在节点被换掉时补打一次闪光。
       v133 R4：原来每 120ms 重播一遍（remove → offsetWidth → add，共 10 次强制布局，4x CPU 占 177ms） */
    const t0 = Date.now()
    let n = 0
    let last: HTMLElement | null = null
    const tick = (): void => {
      const first = n++ === 0
      const det = this.root.querySelector('.detail') as HTMLElement | null
      if (!det) return
      const sec = det.querySelector('#dpmTaskSec') as HTMLElement | null
      if (!sec) return
      if (!sec.classList.contains('x')) this.secOpen(sec)
      /* v133 R4：滚到顶 + 聚焦标题都会强制布局刚画好的详情（4x CPU 曾在点击里占 175ms）→ 放到下一帧开头做，和这一帧的布局合成一次 */
      if (first) requestAnimationFrame(() => {
        const box = det.querySelector('.d-b') as HTMLElement | null
        if (box && box.scrollTop) box.scrollTop = 0
        const h = sec.querySelector(':scope > h3') as HTMLElement | null
        try { h?.focus({ preventScroll: true }) } catch { /* ignore */ }
      })
      if (sec !== last) {
        if (sec.classList.contains('flash')) { sec.classList.remove('flash'); requestAnimationFrame(() => sec.classList.add('flash')) } else sec.classList.add('flash')
        last = sec
      }
      if (Date.now() - t0 < 1150) setTimeout(tick, 120)
    }
    tick()
    setTimeout(() => {
      const det = this.root.querySelector('.detail') as HTMLElement | null
      det?.querySelector('#dpmTaskSec')?.classList.remove('flash')
    }, 1320)
  }

  /** v88：点卡片 / 复制后切换选中，蓝框立刻落到新卡片（不再等 4s 轮询重画）。 */
  private paintPressed(): void {
    this.root.querySelectorAll<HTMLElement>('.card[data-card]').forEach((el) => el.setAttribute('aria-pressed', String(!!this.sel && el.dataset.card === this.sel)))
  }

  /** 3(3)-②：切到任务日程看板时，展开项目组并把行置为直接点击的选中态。 */
  revealSched(id: string): void {
    if (!this.card(id)) { this.wantCard = id; return }
    this.wantCard = null
    this.schedView?.reveal(id)
  }

  private cdDef(): number { return Math.round(Math.min(440, Math.max(360, window.innerWidth * 0.28))) }
  private cdMax(): number {
    const body = this.root.querySelector('.pm-body') as HTMLElement | null
    const w = body?.clientWidth || window.innerWidth
    return Math.max(this.cdDef(), Math.min(760, w - 560))
  }
  private cdW(): number { return Math.min(this.cdMax(), Math.max(360, this.dw ?? this.cdDef())) }
  private applyDw(): void {
    if (this.opts.detailOnly) return
    if (this.mode !== 'sched') { this.root.style.removeProperty('--dpm-dw'); return }
    const det = this.root.querySelector('.detail') as HTMLElement | null
    /* v133 R4：主面板没有内嵌详情（详情是全局一列）—— 不量宽度，切到日程页时不在点击里强制布局（4x CPU 下 67ms） */
    if (!det) return
    const w = this.cdW()
    this.root.style.setProperty('--dpm-dw', w + 'px')
    const hint = det?.querySelector('.cd-hint') as HTMLElement | null
    if (hint) hint.textContent = '卡片详情 · 独立区域 · ' + w + 'px'
    const h = this.root.querySelector('.cd-resize') as HTMLElement | null
    if (h) {
      h.setAttribute('aria-valuenow', String(w))
      h.setAttribute('aria-valuemin', '360')
      h.setAttribute('aria-valuemax', String(this.cdMax()))
      h.title = '拖动调整卡片详情宽度（360 – ' + this.cdMax() + 'px，默认 ' + this.cdDef() + '，双击复位）'
    }
  }
  private saveDw(): void { this.schedView?.saveDetailWidth(this.dw) }
  /** 全局卡片详情宽度：360 – min(760, 主区宽-560)；1500 窗口 = 360–672，默认 420。 */
  /* v132（1）：详情 = 和侧栏 / 看板 / 会话窗口平级的一列，不浮起来盖住看板。上限按中列（看板 + 详情）实宽算：
     看板至少留 560px，不够就先把详情收窄到 360px；侧栏开合 / 窗口变化都按用户想要的宽度重新夹一次。 */
  /* v133 R2：中间列宽度缓存，尺寸变了（colRo）才重量 —— 打开详情时不再在点击里强制布局 */
  private ccW = 0
  private globalMax(): number {
    /* v134：DSH 右侧栏开着时按「窗口 − 左栏」算：三列并排 = 会话 400 + 右侧栏 300 之外，其余 = 详情 560 之外 */
    if (this.opts.detailOnly && RL.A) return Math.max(360, Math.min(760, Math.floor(RL.A - 400)))
    /* v133 R4：没量过就先按窗口宽估（只影响 >680px 的夹紧），中列的 ResizeObserver 在同一帧上屏前给真宽度并重夹一次 */
    return Math.max(360, Math.min(760, Math.floor((this.ccW || window.innerWidth) - 560)))
  }
  private gdWant = 420
  private colRo: ResizeObserver | null = null
  private colEl: Element | null = null
  private watchCol(): void {
    const cc = document.querySelector('[class*="_centerCol"]')
    if (!this.colRo) {
      this.colRo = new ResizeObserver((es) => { const e = es.find((x) => x.target === this.colEl); if (e) this.ccW = e.borderBoxSize?.[0]?.inlineSize ?? e.target.getBoundingClientRect().width; else if (!this.colEl) this.ccW = window.innerWidth; if (!this.cdDragging && !this.root.hidden) this.paintGlobalWidth(this.gdWant, true) })
      this.colRo.observe(document.body)
      this.disposers.push(() => this.colRo?.disconnect())
    }
    if (cc && cc !== this.colEl) { if (this.colEl) { this.colRo.unobserve(this.colEl); this.ccW = 0 } this.colEl = cc; this.colRo.observe(cc); if (this.cdOn) padCenter(this.gdw) }
  }
  /* v133 R3：详情列开关。宽度只写在详情自己身上、让位只写在中列自己身上 —— 旧代码在 body 上改 class + 继承变量，
     整页 4000 个节点重算样式（4x CPU：class 52ms + 变量 85ms），第一次点执行卡上屏 104ms。 */
  private cdOn = false
  showGlobal(on: boolean): void { this.cdOn = on; padCenter(on ? this.gdw : null) }
  private globalWidth(): number {
    return Math.max(360, Math.min(this.globalMax(), this.gdw))
  }
  /** v89：拖动中的写保护 —— 外部（服务端回包 / 重画）的宽度写入先记 pending，不碰 DOM。 */
  private cdDragging = false
  private cdPendW: number | null = null
  setGlobalWidth(w: number | null): void { this.applyGlobalWidth(w ?? 420) }
  /** 立即落宽度：只给「拖动 / 键盘 / 复位」这些用户动作调用。 */
  private paintGlobalWidth(w: number, keep = false): void {
    if (!keep) this.gdWant = w
    const max = this.globalMax()
    const v = Math.round(Math.max(360, Math.min(max, w)))
    if (keep && v === this.gdw && this.root.style.getPropertyValue('--dpm-dw') === v + 'px') return
    this.fitGlobal(v)
    if (this.cdOn) padCenter(v)
  }
  /** v134：用户想要的详情宽度（右侧栏布局引擎读）。 */
  rlWant(): number { return this.gdWant }
  /** v134：只落详情自己的宽度，不回调 padCenter（右侧栏布局引擎在同一次排版里用）。 */
  fitGlobal(v: number): void {
    if (v === this.gdw && this.root.style.getPropertyValue('--dpm-dw') === v + 'px') return
    const max = this.globalMax()
    this.gdw = v
    if (this === gdv) RL.w = v
    this.root.style.setProperty('--dpm-dw', v + 'px')
    const hint = this.root.querySelector('.detail .cd-hint') as HTMLElement | null
    if (hint) hint.textContent = '卡片详情 · 独立区域 · ' + v + 'px'
    const h = this.root.querySelector('.detail .cd-resize') as HTMLElement | null
    if (h) { h.setAttribute('aria-valuenow', String(v)); h.setAttribute('aria-valuemax', String(max)); h.title = '拖动调整卡片详情宽度（360 – ' + max + 'px，默认 420，双击复位）' }
  }
  /** 外部写入（打开详情时读服务端值、重画时同步）：拖动中一律忽略。 */
  private applyGlobalWidth(w: number, keep = false): void {
    if (this.cdDragging) { if (!keep) this.cdPendW = w; return }
    this.paintGlobalWidth(w, keep)
  }
  private ensureGlobalResize(det: HTMLElement): void {
    this.watchCol()
    const f = det.querySelector('.d-f')
    if (f && !f.querySelector('.cd-hint')) { const sp = document.createElement('span'); sp.className = 'cd-hint'; f.append(sp) }
    if (det.querySelector('.cd-resize')) { this.applyGlobalWidth(this.gdWant, true); return }
    const h = document.createElement('i')
    h.className = 'cd-resize'
    h.setAttribute('role', 'separator')
    h.setAttribute('aria-orientation', 'vertical')
    h.setAttribute('aria-valuemin', '360')
    h.setAttribute('aria-valuemax', String(this.globalMax()))
    h.tabIndex = 0
    h.setAttribute('aria-label', '拖动调整卡片详情宽度')
    h.title = '拖动调整卡片详情宽度（360 – ' + this.globalMax() + 'px，默认 420，双击复位）'
    h.addEventListener('dblclick', () => {
      this.cdPendW = null
      this.paintGlobalWidth(420)
      void postGantt('ui', { dw: null }).catch(() => undefined)
    })
    h.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const w = this.globalWidth() + (e.key === 'ArrowLeft' ? 16 : -16)
      this.paintGlobalWidth(w)
      void postGantt('ui', { dw: this.gdw }).catch((err) => this.host.toast('卡片详情宽度保存失败：' + (err instanceof ApiError ? err.message : String(err)), 'err'))
    })
    /* v89：拖动 = 唯一决定宽度的人。
       1) 拖动期间 this.cdDragging = true → 服务端回包 / 重画走 applyGlobalWidth 时被忽略；
       2) 宽度用 rAF 合并到一帧（一次拖动只重排一次，60fps 不抖）；
       3) 气泡跟手并按边界写文案；4) 松手才落盘，写的就是手停下的位置。 */
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const x0 = e.clientX
      const w0 = Math.round(this.root.getBoundingClientRect().width) || this.globalWidth()
      let moved = false
      let raf = 0
      let last = w0
      let lastEv: PointerEvent = e
      let tip: HTMLElement | null = null
      this.cdDragging = true
      this.cdPendW = null
      this.root.classList.add('cd-resizing')
      document.body.classList.add('cd-resizing')
      const paintTip = (w: number): void => {
        if (!tip) { tip = document.createElement('div'); tip.className = 'cd-tip'; document.body.append(tip) }
        const max = this.globalMax()
        tip.textContent = '卡片详情 ' + w + 'px' + (w <= 360 ? ' · 已经最窄' : w >= max ? ' · 已经最宽' : Math.abs(w - 420) < 1 ? ' · 默认宽度' : '')
        tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, lastEv.clientX + 18)) + 'px'
        tip.style.top = Math.max(8, lastEv.clientY - 34) + 'px'
      }
      paintTip(w0)
      const move = (ev: PointerEvent): void => {
        lastEv = ev
        if (Math.abs(ev.clientX - x0) < 2) return
        moved = true
        last = Math.max(360, Math.min(this.globalMax(), Math.round(w0 - (ev.clientX - x0))))
        if (raf) return
        raf = requestAnimationFrame(() => { raf = 0; this.paintGlobalWidth(last); paintTip(this.gdw) })
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (raf) { cancelAnimationFrame(raf); raf = 0 }
        if (moved) { this.paintGlobalWidth(last); paintTip(this.gdw) }
        tip?.remove()
        this.cdDragging = false
        this.cdPendW = null
        this.root.classList.remove('cd-resizing')
        document.body.classList.remove('cd-resizing')
        if (moved) void postGantt('ui', { dw: this.gdw }).catch((err) => this.host.toast('卡片详情宽度保存失败：' + (err instanceof ApiError ? err.message : String(err)), 'err'))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
    det.append(h)
    this.applyGlobalWidth(this.gdWant, true)
  }
  /** 详情底栏小字 + 左边缘拖宽热区（只在任务日程看板这一页有；项目看板沿用 0.29.1 的固定宽度）。 */
  private ensureCdHandle(): void {
    const det = this.root.querySelector('.detail') as HTMLElement | null
    if (!det) return
    if (this.opts.detailOnly) { this.ensureGlobalResize(det); return }
    const has = det.querySelector('.cd-resize') as HTMLElement | null
    if (this.mode !== 'sched') { has?.remove(); det.querySelector('.cd-hint')?.remove(); return }
    if (!det.querySelector('.cd-hint')) {
      const f = det.querySelector('.d-f')
      if (f) { const sp = document.createElement('span'); sp.className = 'cd-hint'; f.append(sp) }
    }
    if (has) return
    const h = document.createElement('i')
    h.className = 'cd-resize'
    h.setAttribute('role', 'separator')
    h.setAttribute('aria-orientation', 'vertical')
    h.tabIndex = 0
    h.setAttribute('aria-label', '拖动调整卡片详情宽度')
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const startX = e.clientX
      const w0 = (det as HTMLElement).getBoundingClientRect().width
      let moved = false
      let last = w0
      this.root.classList.add('cd-resizing')
      const tip = document.createElement('div')
      tip.className = 'cd-tip'
      document.body.append(tip)
      const show = (w: number, x: number, y: number): void => {
        const min = 360, max = this.cdMax()
        tip.textContent = '卡片详情 ' + Math.round(w) + 'px' + (w === min ? ' · 已经最窄' : w === max ? ' · 已经最宽' : Math.abs(w - this.cdDef()) < 1 ? ' · 默认宽度' : '')
        tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, x + 18) + 'px'
        tip.style.top = Math.max(8, y - 34) + 'px'
      }
      const move = (ev: PointerEvent): void => {
        if (Math.abs(ev.clientX - startX) >= 2) moved = true
        const w = Math.min(this.cdMax(), Math.max(360, Math.round(w0 + (startX - ev.clientX))))
        last = w
        this.dw = w
        this.applyDw()
        this.schedView?.layout()
        show(w, ev.clientX, ev.clientY)
      }
      const up = (): void => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        this.root.classList.remove('cd-resizing')
        tip.remove()
        if (!moved) return
        this.dw = last
        this.saveDw()
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
    h.addEventListener('dblclick', () => {
      this.dw = null
      this.applyDw()
      this.schedView?.layout()
      this.saveDw()
      this.host.toast('卡片详情宽度已复位')
    })
    h.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      this.dw = Math.min(this.cdMax(), Math.max(360, this.cdW() + (e.key === 'ArrowLeft' ? 16 : -16)))
      this.applyDw()
      this.schedView?.layout()
      this.saveDw()
    })
    det.append(h)
  }

  // ── 0.28（v58）分区默认只显示标题栏；0.30.1（v65）改成点标题栏展开 / 收起（悬停不再展开，动效不变）；展开后标题栏吸顶 ──
  private secOpenSet = new Set<string>()
  private ptr: [number, number] = [-1, -1]
  /** 分区内容包进 .sb（grid 0fr→1fr 过渡）；重画后之前展开、指针还在里面的分区直接按展开画（不重播动画）。 */
  private decorateDetail(): void {
    const det = this.root.querySelector('.detail') as HTMLElement | null
    if (!det) return
    const at = (): Element | null => (this.ptr[0] >= 0 ? document.elementFromPoint(this.ptr[0], this.ptr[1]) : null)
    const still = (n: Element): void => { n.classList.add('now'); requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove('now'))) }
    const db = det.querySelector('.d-b') as HTMLElement | null
    if (db) {
      Array.from(db.children).forEach((sec, k) => {
        if (!sec.matches('section.sec:not(.plain)') || sec.classList.contains('cl')) return
        const h = sec.querySelector(':scope > h3')
        if (!h) return
        sec.classList.add('cl')
        ;(sec as HTMLElement).dataset.sk = sec.id || 's' + k
        h.setAttribute('role', 'button')
        ;(h as HTMLElement).tabIndex = 0
        h.setAttribute('aria-expanded', 'false')
        const sb = document.createElement('div')
        sb.className = 'sb'
        sb.innerHTML = '<div class="sbi"><div class="sbc"></div></div>'
        const sbc = sb.querySelector('.sbc') as HTMLElement
        while (h.nextSibling) sbc.appendChild(h.nextSibling)
        sec.appendChild(sb)
      })
      /* v132（3）：分区里有编辑中的行 → .dpm-ed（代替 has(.editing)） */
      db.querySelectorAll('.sec.cl').forEach((sec) => sec.classList.toggle('dpm-ed', !!sec.querySelector('.editing')))
      /* v97：任务分区 = 外层卡片 + 浅灰托盘 + 内层任务卡（见 style.css .tk-tray） */
      db.querySelector<HTMLElement>("#dpmTaskSec > .sb > .sbi")?.classList.add("tk-tray")
      /* v97：可同时展开多片 —— 重画后把之前展开的每一片都按展开画（不重播动画） */
      for (const key of [...this.secOpenSet]) {
        const sec = db.querySelector('.sec.cl[data-sk="' + CSS.escape(key) + '"]')
        if (!sec) { this.secOpenSet.delete(key); continue }
        if (!sec.classList.contains('x')) this.secOpen(sec)
        still(sec)
      }
      /* v133 R2：吸顶判定要量几何 —— 放到下一帧，别在点击处理里强制整页布局（首次打开详情曾占 63ms@4x） */
      if (!this.stuckRaf) this.stuckRaf = requestAnimationFrame(() => { this.stuckRaf = 0; const d = this.root.querySelector('.detail .d-b') as HTMLElement | null; if (d && !this.disposed) this.stuck(d) })
    }
    this.fitTcSoon()
    const pin = det.querySelector('#dpmPin')
    if (pin && this.sessOpen) { pin.classList.add('open'); const el = at(); if (el && pin.contains(el)) still(pin); else this.pinSet(false) }
  }
  /* v141（2.2）：会话按钮组一行放得下 = 和状态标签同一行最右；放不下 = 独占一行、放在状态标签行下面最左边（随详情宽度实时判断） */
  private fitRaf = 0
  private fitRO: ResizeObserver | null = null
  fitTcSoon(): void { if (!this.fitRaf) this.fitRaf = requestAnimationFrame(() => { this.fitRaf = 0; this.fitTc() }) }
  private fitTc(): void {
    const det = this.root.querySelector('.detail') as HTMLElement | null
    if (!det) return
    if (!this.fitRO) { this.fitRO = new ResizeObserver(() => this.fitTcSoon()); this.fitRO.observe(det) }
    const rows = Array.from(det.querySelectorAll<HTMLElement>('.tkst')).filter((r) => r.querySelector(':scope > .dpm-stc'))
    const want: Array<[HTMLElement, boolean]> = []
    for (const row of rows) {
      const tc = row.querySelector(':scope > .dpm-stc') as HTMLElement
      const kids = Array.from(row.children).filter((x) => x !== tc) as HTMLElement[]
      const used = kids.reduce((n, x) => n + x.offsetWidth, 0) + kids.length * 5
      const cs = getComputedStyle(row), avail = row.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      want.push([row, used + tc.scrollWidth + 8 > avail])
    }
    for (const [row, w] of want) row.classList.toggle('dpm-stwrap', w)
  }
  /** v97：分区各自开合 —— 展开一片不会收起别的（完全手动，可以同时开多片）。 */
  private secOpen(sec: Element): void {
    sec.classList.add('x')
    sec.querySelector(':scope > h3')?.setAttribute('aria-expanded', 'true')
    const key = (sec as HTMLElement).dataset.sk
    if (key) this.secOpenSet.add(key)
  }
  /** 0.30.1：分区只在点标题栏 / 键盘切换时收起；离开文档只收会话通栏。 */
  private hoverOut(): void { if (document.querySelector('dialog[open]')) return; if (this.sessOpen) this.pinSet(false) }
  private secClose(sec: Element): void {
    sec.classList.remove('x', 'now')
    /* v97：收起时把里面任务标题行的冻结态一起清掉（否则下次展开会先闪一下吸顶阴影） */
    sec.querySelectorAll('.tkhead.stuck').forEach((h) => h.classList.remove('stuck'))
    sec.querySelector(':scope > h3')?.setAttribute('aria-expanded', 'false')
    const key = (sec as HTMLElement).dataset.sk
    if (key) this.secOpenSet.delete(key)
  }
  /** 会话通栏展开 / 收起；收起时归档列表回到收起。 */
  private pinSet(v: boolean): void {
    this.sessOpen = v
    const pin = this.root.querySelector('.detail #dpmPin')
    pin?.classList.toggle('open', v)
    if (!v) pin?.classList.remove('now')
    if (!v && this.sessArc) { this.sessArc = false; this.root.querySelector('#dpmArcL')?.classList.remove('open'); this.root.querySelector('[data-sess-arc]')?.setAttribute('aria-expanded', 'false'); this.lastDetail = '' }
  }
  /** 滚动时：会话通栏下沿阴影；吸住的分区标题加 .stuck（直角 + 阴影）；v97 任务项标题行紧贴分区标题下沿冻结。 */
  private stuckRaf = 0
  private stuck(db: HTMLElement): void {
    const top = db.getBoundingClientRect().top
    this.root.querySelector('.detail #dpmPinW')?.classList.toggle('sh', db.scrollTop > 0)
    db.querySelectorAll<HTMLElement>('.sec.cl > h3').forEach((h) => { const r = (h.parentElement as HTMLElement).getBoundingClientRect(); h.classList.toggle('stuck', r.top < top - 0.5 && r.bottom > top + h.offsetHeight) })
    /* v97：任务项标题行吸顶 —— 参考线 = 分区标题下沿；同时只有一条贴住，被下一项顶上去的那条不加（它会从分区标题底下滑走） */
    const tkSec = db.querySelector<HTMLElement>('#dpmTaskSec')
    if (tkSec) {
      const h3 = tkSec.querySelector<HTMLElement>(':scope > h3')
      const hh = h3?.offsetHeight ?? 44
      tkSec.style.setProperty('--tkh', hh + 'px')
      if (tkSec.classList.contains('x')) {
        const base = top + hh
        tkSec.querySelectorAll<HTMLElement>('.tile > .task > .tkhead').forEach((h) => {
          h.classList.toggle('stuck', Math.abs(h.getBoundingClientRect().top - base) <= 1.5)
        })
      }
    }
  }
  /** 详情标题一行，放不下时悬停整个标题栏左循环走马灯（按按钮全展开后标题能用的宽度判断）。 */
  private titleMq(on: boolean): void {
    const h2 = this.root.querySelector('.detail #dpmDT') as HTMLElement | null
    if (!h2) return
    if (!on) { mqStop(h2); return }
    if (h2.dataset.mq !== undefined || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const avail = h2.clientWidth
    const rg = document.createRange(); rg.selectNodeContents(h2)
    const tw = rg.getBoundingClientRect().width
    if (tw <= avail + 1) return
    const txt = h2.textContent ?? ''
    h2.dataset.mq = txt
    h2.classList.add('mq-on')
    h2.style.setProperty('--mq-dur', ((tw + 40) / 40).toFixed(1) + 's')
    h2.innerHTML = '<span class="mq-track"><span>' + esc(txt) + '</span><span aria-hidden="true">' + esc(txt) + '</span></span>'
  }
  /** 相关说明超过高度阈值 → 折叠（底部渐隐）+ 「展开全部 / 收起」；是否超长在渲染后量。 */
  private fixNotes(): void {
    // v88 说明收起固定 3 行（超过才渐隐 +「展开全部」）；子任务说明超过 2 行出「展开」（打开的不折）
    this.root.querySelectorAll<HTMLElement>('.detail .nk-b').forEach((n) => { const b = n.nextElementSibling as HTMLElement | null; if (!b) return; const open = n.classList.contains('open'); const over = open || n.scrollHeight > n.clientHeight + 1; n.classList.toggle('clip', over && !open); b.hidden = !over })
    this.root.querySelectorAll<HTMLTextAreaElement>('.detail textarea.nk-v, .detail textarea.tarea').forEach((t) => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, parseFloat(getComputedStyle(t).maxHeight) || 9999) + 'px' })
    this.root.querySelectorAll<HTMLInputElement>('.detail input[data-mixed]').forEach((i) => { i.indeterminate = true })
  }

  private boardHtml(): string {
    // 0.15：第一次打开还没数据 → 骨架（不再整块空白）
    if (!this.snap) return '<div class="skel-board" aria-busy="true" aria-label="正在加载看板">' + [0, 1].map(() => '<div class="lane skel-lane"><div class="skel-h"></div><div class="skel-row">' + [0, 1, 2].map(() => '<div class="skel"></div>').join('') + '</div></div>').join('') + '</div>'
    if (!this.groups.length) return '<div class="empty-board"><b>还没有卡片组</b><span>新建一个卡片组，或从落盘项目导入。</span><button type="button" class="btn primary" data-new-group>' + ic('plus') + '新建卡片组</button></div>'
    const q = this.q
    if (q) { const hit = this.hitsHtml(q); if (hit) return hit }
    const vis = this.cards.filter((c) => !c.archivedAt).filter((c) => !q || (c.t + ' ' + c.links.join(' ') + ' ' + this.cardDesc(c) + ' ' + (this.grp(c.g)?.repos.map((r) => r.name).join(' ') ?? '')).toLowerCase().includes(q))
    return this.groups.filter((g) => !g.archivedAt).map((g) => {
      const all = vis.filter((c) => c.g === g.id)
      const cs = all.filter((c) => !c.pending)
      const pend = all.filter((c) => c.pending)
      const liveN = this.cards.filter((c) => c.g === g.id && !c.archivedAt && !c.pending).length
      /** 组里还没归档的卡片数（含 pending）——归档整组的守卫用它，消息里 separate 出 pending 张数。 */
      const leftN = this.cards.filter((c) => c.g === g.id && !c.archivedAt).length
      const pendN = leftN - liveN
      // 最近归档的在上
      const ar = this.cards.filter((c) => c.g === g.id && c.archivedAt).sort((a, b) => (b.archivedAt as string).localeCompare(a.archivedAt as string))
      const gl = this.groupLive(g)
      const open = this.tray.has(g.id)
      const n = g.statuses.length
      const head = '<div class="shead" style="--cols:' + n + '">' + g.statuses.map((st) => '<div class="colh"><span class="nm">' + esc(st.name) + '</span><span class="n">' + cs.filter((x) => x.col === st.id).length + '</span></div>').join('') + '</div>'
      const bodyHtml = g.statuses.map((st) => {
        const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order)
        return '<div class="cell' + (inCol.length ? '' : ' empty') + '" data-col="' + esc(st.id) + '" data-g="' + esc(g.id) + '">' + inCol.map((c) => this.cardHtml(c)).join('') + this.addHtml(g, st) + '</div>'
      }).join('')
      // 头部左侧整块（箭头、组名、统计、空白）点击展开/收起；里面的「组记忆」按钮保持自己的作用
      return '<section class="lane' + (g.collapsed ? ' collapsed' : '') + (gl ? ' live' : '') + '" data-lane="' + esc(g.id) + '"><div class="lane-h">'
        + '<div class="lane-hit" data-toggle-area="' + esc(g.id) + '"><h2><button type="button" class="tg" data-toggle="' + esc(g.id) + '" aria-expanded="' + !g.collapsed + '"><span class="chev-b"><svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span><span class="nm" title="' + esc(g.name) + '">' + esc(g.name) + '</span></button></h2>'
        + this.statHtml(g, cs, gl)
        + (g.links.length ? '<button type="button" class="chip mem as-btn" data-edit-group="' + esc(g.id) + '" data-focus-links>' + ic('mem') + '<span class="lb">组记忆 </span>' + g.links.length + '</button>' : '')
        + '</div>'
        // 0.27.1「卡片组设置」「新会话」「归档卡片组」默认收起（.lane-fold），鼠标进卡片组 / Tab 进标题栏时展开（原型 v54）
        + '<span class="lane-fold"><span class="fi"><button type="button" class="btn ghost" data-edit-group="' + esc(g.id) + '">' + ic('sliders') + '卡片组设置</button><button type="button" class="btn ghost" data-new-in="' + esc(g.id) + '">' + ic('plus') + '新会话</button></span></span>'
        + '<button type="button" class="btn ghost" data-tray="' + esc(g.id) + '" aria-expanded="' + open + '" aria-controls="dpmTray-' + esc(g.id) + '">' + ic('archive') + '已归档卡片<span class="cnt">' + ar.length + '</span></button>'
        // 0.26 归档卡片组（手柄左边）：还有活跃卡片 → 置灰不可点，悬停说明原因
        + '<span class="lane-fold arch tipbtn"><span class="fi">' + (leftN
          ? '<button type="button" class="ib" aria-disabled="true" aria-label="归档卡片组「' + esc(g.name) + '」：还有 ' + leftN + ' 张卡片没归档' + (pendN ? '（含 ' + pendN + ' 张 pending）' : '') + '，全部归档后才能归档">' + ic('archive') + '</button></span><span class="tip" aria-hidden="true">还有 ' + leftN + ' 张卡片没归档' + (pendN ? '（含 ' + pendN + ' 张 pending）' : '') + '，全部归档后才能归档卡片组</span></span>'
          : '<button type="button" class="ib" data-g-arch="' + esc(g.id) + '" aria-label="归档卡片组「' + esc(g.name) + '」">' + ic('archive') + '</button></span><span class="tip" aria-hidden="true">归档卡片组</span></span>')
        + '<button type="button" class="ib grip tipbtn" data-gdrag="' + esc(g.id) + '" aria-label="调整「' + esc(g.name) + '」的顺序：按住拖动，或 Alt+上下方向键">' + ic('grip') + '<span class="tip" aria-hidden="true">按住拖动排序</span></button></div>'
        + (open ? this.trayHtml(g, ar) : '')
        // v99：阶段列比可视宽度宽时 —— 右边缘渐隐 + 左右翻列箭头（点一下滚一整列）
        + '<div class="lane-nav"><button type="button" class="lnav l" data-lanescroll="-1" data-g="' + esc(g.id) + '" aria-label="向左看一个阶段" title="向左看一个阶段">' + ic('chev') + '</button><button type="button" class="lnav r" data-lanescroll="1" data-g="' + esc(g.id) + '" aria-label="向右看一个阶段" title="向右看一个阶段">' + ic('chev') + '</button></div>'
        + '<div class="lane-in" data-g="' + esc(g.id) + '">' + head + '<div class="lane-b" style="--cols:' + n + '">' + bodyHtml + '</div>' + this.pendHtml(g, pend) + '</div></section>'
    }).join('')
  }

  /** 阶段底部的「添加卡片」：按钮，或正在输入时的就地表单。 */
  private addHtml(g: Group, st: Status): string {
    const a = this.adding
    if (a && a.g === g.id && a.col === st.id) {
      const dd = this.dedupe(this.addDraft)
      return '<form class="addc-f" data-addcard><label class="sr-only" for="dpmAddIn">在「' + esc(st.name) + '」添加卡片</label><input id="dpmAddIn" placeholder="卡片标题，回车添加" autocomplete="off" maxlength="120" value="' + esc(this.addDraft) + '">'
        + '<div class="ddup" id="dpmDupBox">' + this.dedupeRowsHtml(this.addDraft, dd) + '</div>'
        + (dd.exact ? '<span class="hint warn">回车不会直接建：先选「仍要新建」或点清单里的那一条</span>' : '<span class="hint">回车添加，可连续输入 · Esc 收起</span>') + '</form>'
    }
    return '<button type="button" class="addc" data-add-card="' + esc(g.id) + '" data-col="' + esc(st.id) + '" aria-label="在「' + esc(st.name) + '」添加卡片">' + ic('plus') + '添加卡片</button>'
  }

  private taskDone(c: Card): number { return c.tasks.filter((t) => t.done).length }

  /* ── v101：添加卡片 / 新建卡片组查重（含已归档）+ 看板搜索命中归档 ───────── */
  private addForce = false
  private nameForce = false
  /** 名字归一化：忽略空格 / 大小写 / 全半角标点（添加与新建组同一套）。 */
  private normName(v: string): string {
    return (v || '').toLowerCase().replace(/[\s\u3000·・]+/g, '').replace(/[()（）\[\]【】「」『』"'“”‘’:：,，.。!！?？/\\|_\-—～~]+/g, '')
  }
  /** 查重命中：完全同名优先，其次包含关系；卡片和卡片组都查，归档的也在。 */
  private dedupe(q: string): { hits: Array<{ kind: 'card' | 'group'; id: string; name: string; meta: string; arc: boolean }>; exact: { kind: 'card' | 'group'; id: string; name: string } | null } {
    const k = this.normName(q)
    if (!k) return { hits: [], exact: null }
    const pool: Array<{ kind: 'card' | 'group'; id: string; name: string; meta: string; arc: boolean; k: string }> = []
    for (const c of this.cards) {
      const g = this.grp(c.g)
      const st = g?.statuses.find((x) => x.id === c.col)
      pool.push({ kind: 'card', id: c.id, name: c.t, meta: (g?.name ?? '') + (st ? ' · ' + st.name : '') + (c.archivedAt ? ' · 已归档' : ''), arc: !!c.archivedAt, k: this.normName(c.t) })
    }
    for (const g of this.groups) {
      const arc = !!g.archivedAt
      pool.push({ kind: 'group', id: g.id, name: g.name, meta: this.cards.filter((c) => c.g === g.id).length + ' 张卡片' + (g.archivedAt ? ' · 已归档' : ''), arc, k: this.normName(g.name) })
    }
    const exact = pool.filter((x) => x.k === k)
    const near = pool.filter((x) => x.k !== k && x.k.length > 1 && (x.k.includes(k) || k.includes(x.k)))
    const hits = exact.concat(near).slice(0, 6).map((x) => ({ kind: x.kind, id: x.id, name: x.name, meta: x.meta, arc: x.arc }))
    const e0 = exact[0]
    return { hits, exact: e0 ? { kind: e0.kind, id: e0.id, name: e0.name } : null }
  }
  private dedupeRowsHtml(q: string, dd = this.dedupe(q)): string {
    if (!q.trim()) return ''
    /* v102：候选行固定 38px 两行（标题 / 组·阶段各自 ellipsis）+ 归档右标签 —— 窄列里不再被 meta 挤成一团 */
    /* v106 ⑥：标题独占第一行（永远看得见）；「组 · 阶段」/ 已归档收到第二行；行高 40，宽度不超出父卡片。
       v107 ②：标题显示不下时悬停循环跑马灯（与甘特图目录同一套双轨动画）。 */
    const rows = dd.hits.map((h) => '<button type="button" class="ddup-r' + (h.arc ? ' is-arc' : '') + '" data-arc="' + (h.arc ? '1' : '0') + '" data-dup-open="' + h.kind + ':' + esc(h.id) + '"><span class="dt' + (h.kind === 'card' ? ' ac' : '') + '">' + (h.kind === 'card' ? '卡' : '组') + '</span><span class="ddtx"><span class="nm" title="' + esc(h.name) + '">' + esc(h.name) + '</span><span class="mt"><span class="mtx">' + esc(h.meta.replace(/ · 已归档$/, '')) + '</span>' + (h.arc ? '<span class="arc-inline">· 已归档</span>' : '') + '</span></span></button>').join('')
    const conf = dd.exact
      ? '<div class="dconf"><svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 3.5 20h17z"/><path d="M12 10v4.4M12 17.2h.01"/></svg><b>已存在同名' + (dd.exact.kind === 'group' ? '卡片组' : '卡片') + '「' + esc(dd.exact.name) + '」</b><span class="grow"></span><button type="button" class="btn sm" data-dup-open="' + dd.exact.kind + ':' + esc(dd.exact.id) + '">打开已有</button><button type="button" class="btn sm primary" data-dup-force>仍要新建</button></div>'
      : ''
    return (dd.hits.length ? '<div class="ddup-h">已有相近的卡片 / 卡片组（含已归档）· 点一项直接打开</div>' + rows : '<div class="ddup-h">没有同名或相近的卡片</div>') + conf
  }
  private paintDedupe(): void { const box = this.root.querySelector('#dpmDupBox'); if (box) box.innerHTML = this.dedupeRowsHtml(this.addDraft) }
  private paintNameDup(): void {
    const box = this.root.querySelector('#dpmNameDup') as HTMLElement | null
    if (!box) return
    const v = (this.$<HTMLInputElement>('#dpmNameInput').value || '').trim()
    box.innerHTML = v ? this.dedupeRowsHtml(v) : ''
    box.hidden = !v
  }
  private flashDup(sel: string): void {
    const el = this.root.querySelector(sel + ' .dconf') as HTMLElement | null
    if (!el) return
    el.classList.remove('hi'); void el.offsetWidth; el.classList.add('hi')
  }
  private openDupTarget(kind: string, id: string): void {
    if (kind === 'group') { void this.openGroupFromSearch(id); return }
    this.adding = null
    this.addDraft = ''
    this.q = ''
    this.sel = id
    this.render()
    this.showDetail(id)
  }
  private async openGroupFromSearch(id: string): Promise<void> {
    const g = this.grp(id)
    this.q = ''
    if (g?.collapsed) await this.act('group/update', { id, collapsed: false })
    this.render()
    requestAnimationFrame(() => { const el = this.root.querySelector('[data-lane="' + CSS.escape(id) + '"]'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
  }
  /** v101 ②：搜索同时命中卡片与卡片组，归档的也在结果里（结果面板替代看板，点一条直接打开）。 */
  private hitsHtml(q: string): string {
    const k = this.normName(q)
    if (!k) return ''
    const cards = this.cards.filter((c) => this.normName(c.t).includes(k) || this.normName(this.grp(c.g)?.name ?? '').includes(k))
    const groups = this.groups.filter((g) => this.normName(g.name).includes(k))
    const arcN = cards.filter((c) => c.archivedAt).length + groups.filter((g) => g.archivedAt).length
    if (!cards.length && !groups.length) return '<div class="bq"><div class="bq-h"><b>没有命中</b></div><div class="bq-e">换一个关键词。卡片和卡片组都会搜，归档的也在结果里。</div></div>'
    const row = (kind: 'card' | 'group', id: string, name: string, meta: string, arc: boolean): string => '<button type="button" class="bq-r' + (arc ? ' is-arc' : '') + '" data-' + (kind === 'card' ? 'bqcard' : 'bqgroup') + '="' + esc(id) + '"><span class="k">' + (kind === 'card' ? '卡片' : '组') + '</span><span class="tt"><b>' + esc(name) + '</b><span>' + esc(meta) + '</span></span>' + (arc ? '<span class="arc">已归档</span>' : '<span></span>') + '</button>'
    const rows = cards.map((c) => { const g = this.grp(c.g); const st = g?.statuses.find((x) => x.id === c.col); return row('card', c.id, c.t, (g?.name ?? '') + (st ? ' · ' + st.name : '') + ' · 任务 ' + this.taskDone(c) + '/' + c.tasks.length + (c.pending ? ' · pending' : ''), !!c.archivedAt) }).join('')
      + groups.map((g) => row('group', g.id, g.name, this.cards.filter((c) => c.g === g.id).length + ' 张卡片 · ' + this.cards.filter((c) => c.g === g.id && !c.archivedAt).length + ' 张活跃', !!g.archivedAt)).join('')
    return '<div class="bq"><div class="bq-h"><b>命中 ' + cards.length + ' 张卡片 · ' + groups.length + ' 个卡片组</b><span>含已归档 ' + arcN + ' 项</span><span class="grow"></span><span>点一条直接打开</span></div><div class="bq-l">' + rows + '</div></div>'
  }

  private taskTotal(c: Card): number { return c.tasks.length }
  private taskLeft(c: Card): number { return c.tasks.filter((t) => !t.done).length }
  private canArchiveCard(c: Card): boolean { return this.taskLeft(c) === 0 }
  private cardHtml(c: Card): string {
    // 0.32：卡片只改两处——有活跃会话时深绿填充；脚上「落盘项目数」换成任务数（已完成/全部）。
    // 卡片其余内容 / 悬停工具条 / 会话 chip 全部保持原样。
    const sb = this.badgeOf(c.id)
    const live = !!sb && sb.live > 0
    const pendBtn = '<button type="button" class="ib tipbtn" data-pend="' + esc(c.id) + '" data-pend-on="' + (c.pending ? '0' : '1') + '" aria-disabled="' + String(live) + '" aria-label="' + (live ? '有活跃会话，不能设为 pending' : (c.pending ? '恢复活跃' : '设为 pending（不活跃、不归档）')) + '">' + ic('pend') + '<span class="tip" aria-hidden="true">' + (live ? '有活跃会话，不能设为 pending' : (c.pending ? '恢复活跃' : '设为 pending')) + '</span></button>'
    const done = this.taskDone(c), total = this.taskTotal(c), left = total - done
    const can = left === 0
    // v86：任务数量 = 进度胶囊（勾 + 等宽数字 + 22px 进度条；四态：full/part/none/zero）
    const pct = total ? Math.round((done / total) * 100) : 0
    const tst = total === 0 ? 'zero' : done >= total ? 'full' : done === 0 ? 'none' : 'part'
    const task = '<span class="chip task ' + tst + '" title="任务 ' + done + '/' + total + '（已完成 / 全部）">' + ic('check') + '<b>' + done + '/' + total + '</b>' + (total ? '<i class="tbar" aria-hidden="true"><u style="width:' + pct + '%"></u></i>' : '') + '<span class="sr-only"> 个任务已完成，共 ' + total + ' 个</span></span>'
    const tip = sb ? (sb.live ? sb.live + ' 个活跃会话' + (sb.n > sb.live ? '，' + (sb.n - sb.live) + ' 个已归档' : '') : sb.n + ' 个会话，都已归档') : ''
    const sess = sb ? '<span class="chip sess ' + (sb.live ? 'on' : 'off') + '" title="' + tip + '"><span class="bub">' + ic('chat') + '<i></i></span>' + sb.n + '<span class="sr-only">，' + tip + '</span></span>' : ''
    const why = can ? '归档卡片' : '还有 ' + left + ' 个任务未完成，完成后才能归档'
    // 0.26 右上角悬停小工具条：复制 + 归档；未完成任务时归档保持原图标、只禁用并说明原因
    const arc = '<span class="cacts">' + pendBtn + '<button type="button" class="ib tipbtn" data-dup="' + esc(c.id) + '" aria-label="复制卡片「' + esc(c.t) + '」">' + ic('dup') + '<span class="tip" aria-hidden="true">复制卡片</span></button><button type="button" class="ib tipbtn" data-archive-card="' + esc(c.id) + '" aria-disabled="' + String(!can) + '" aria-label="' + (can ? '归档卡片「' + esc(c.t) + '」' : why) + '">' + ic('archive') + '<span class="tip" aria-hidden="true">' + why + '</span></button></span>'
    return '<div class="card' + (live ? ' live' : '') + '" role="button" tabindex="0" data-card="' + esc(c.id) + '" aria-pressed="' + (this.sel === c.id) + '" aria-label="' + esc(c.t) + '，打开详情；Alt+上下方向键调整顺序">'
      + arc + '<h3>' + esc(c.t) + '</h3><p>' + esc(this.cardDesc(c)) + '</p><div class="foot">' + sess + task + '</div></div>'
  }

  /** v86 · pending 托盘：按阶段分列，卡片只显示标题（虚线），点开是正常详情。 */
  private pendHtml(g: Group, pend: Card[]): string {
    if (!pend.length) return ''
    const n = g.statuses.length
    const cells = g.statuses.map((st) => {
      const arr = pend.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order)
      return '<div class="pcell" data-col="' + esc(st.id) + '" data-g="' + esc(g.id) + '" data-pend-cell="' + esc(g.id) + '">' + arr.map((c) => '<button type="button" class="pcard" data-card="' + esc(c.id) + '" title="' + esc(c.t) + '（Pending · ' + esc(st.name) + '）">' + esc(c.t) + '</button>').join('') + '</div>'
    }).join('')
    return '<div class="ptray" data-pend-g="' + esc(g.id) + '" aria-label="Pending 卡片（按阶段归位）"><div class="ph">' + ic('pend') + 'Pending<span class="n">' + pend.length + '</span><em>按阶段归位 · 点开是正常详情</em></div><div class="pcols" style="--cols:' + n + '">' + cells + '</div></div>'
  }
  /** v86 · 设为 / 恢复 pending（有活跃会话时拒绝，交给 host 兜底）。 */
  private async pendCard(id: string, on: boolean, col?: string): Promise<void> {
    const c = this.card(id)
    if (!c) return
    if (on && this.badgeOf(c.id)?.live) { this.host.toast('这张卡片有活跃会话，不能设为 pending', 'err'); return }
    await this.act('card/pending', { id, on, ...(col ? { col } : {}) }, on ? '已设为 pending：不活跃、不归档' : '已恢复活跃')
  }
  /** v86 · 详情顶部 Pending 条。 */
  private pendBar(c: Card): string {
    if (!c.pending) return ''
    const st = this.st(this.grp(c.g) as Group, c.col)
    return '<div class="cd-pendbar"><span class="pdot" aria-hidden="true"></span><b>Pending</b><span>不活跃、不归档；只显示标题，详情照常可编辑 · 阶段「' + esc(st?.name ?? '—') + '」</span><span class="grow"></span><button type="button" class="btn ghost xs" data-pend="' + esc(c.id) + '" data-pend-on="0">恢复活跃</button></div>'
  }
  /** v86：生成引用文字——复制；有可见会话输入框时同时插到光标处。 */
  private async copyQuote(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text) } catch (er) { this.host.toast('复制失败：' + (er instanceof Error ? er.message : String(er)) + '（可手动选中复制）', 'err'); return }
    /* v138（2.1）：会话输入框可见 → 在光标处直接插成引用胶囊（走宿主 insert-reference，不重写整个输入框；连续插也不会塌成文字） */
    const cx = (window as unknown as { __dpmComposer?: { insert(c: string): boolean } }).__dpmComposer
    if (cx && cx.insert(text)) { this.host.toast('引用文字已复制，并在会话光标处插入引用胶囊（发送时是这段原文）', 'ok'); return }
    const live = this.composerEl()
    if (!live) { this.host.toast('引用文字已复制', 'ok'); return }
    const before = live.textContent ?? ''
    this.pasteInto(live, text)
    // Lexical 是异步更新，立刻读 textContent 读不到 → 120ms 后再确认，别谎报「已插入」
    setTimeout(() => {
      const ok = (live.textContent ?? '') !== before
      this.host.toast(ok ? '引用文字已复制，并插入到会话光标处' : '引用文字已复制（输入框没接收，可手动粘贴）', ok ? 'ok' : 'err')
    }, 140)
  }
  /** 当前可见的会话输入框（宿主是 Lexical contenteditable）；没有就返回 null。 */
  private composerEl(): HTMLElement | null {
    // v86：宿主输入框不是 ProseMirror（实测是一个 contenteditable 的 DIV，类名带哈希）。
    // 找「可见的 contenteditable」：优先输入区（data-composer-card / placeholder 像聊天输入），否则取最后一个可见的。
    const all = [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')].filter((el) => {
      if (!el.isConnected) return false
      const r = el.getBoundingClientRect()
      return r.width > 40 && r.height > 8
    })
    if (!all.length) return null
    const score = (el: HTMLElement): number => {
      let s = 0
      if (el.closest('[data-composer-card]')) s += 4
      const ph = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || ''
      if (/command|commands|@ files|sessions|Describe/i.test(ph)) s += 3
      if (/input|composer|editor/i.test(el.className || '')) s += 2
      return s
    }
    all.sort((a, b) => score(b) - score(a))
    return all[0]
  }
  /** 往输入框里塞文字：宿主输入框是 Lexical，paste 事件是实测能进去的路径（execCommand 会双插/无效）。 */
  private pasteInto(live: HTMLElement, text: string): void {
    live.focus()
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      live.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    } catch (e) {
      this.host.toast('插入失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    }
  }
  private detailHtml(): string {
    const c = this.card(this.sel as string) as Card
    const g = this.grp(c.g) as Group
    const sts = g.statuses
    const arcOk = this.canArchiveCard(c)
    const arcLeft = this.taskLeft(c)
    const i = sts.findIndex((x) => x.id === c.col)
    const ro = !!c.archivedAt
    const mem = this.memOf(c)
    const ownMem = this.ownMem(c)
    const groupMem = this.groupMem(c)
    const mo = this.moreOf(c)
    /* v102：分区头不再有展开 / 收起箭头（点标题栏就能开合）→ 一次列全，不再限行数 */
    const memRows = ownMem.map((m) => {
      const s = this.stateOf(m.k)
      const tag = m.from === 'group' ? '<span class="chip plain">来自卡片组</span>' : m.from === 'both' ? '<span class="chip plain">卡片组 + 卡片</span>' : '<span class="chip brand">卡片</span>'
      const rm = !ro && m.from !== 'group' ? '<button type="button" class="ib" data-unlink-card="' + esc(m.k) + '" aria-label="取消关联 ' + esc(m.k) + '">' + ic('x') + '</button>' : ''
      if (!s) return '<div class="mrow"><div class="txt"><div class="nm" title="' + esc(m.k) + '">' + esc(m.k) + '</div><div class="more"><p class="l">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div></div><div class="mside">' + tag + rm + '</div></div>'
      return '<div class="mrow"><div class="txt"><div class="nm mq" title="' + esc(s.slug) + '">' + esc(s.slug) + '</div><div class="more"><span class="mono">' + esc(s.project) + ' · 更新于 ' + esc(s.updated) + '</span><p class="l">' + esc(s.status || '暂无状态说明') + '</p><p class="nx"><b>next_action</b>' + esc(s.next || '暂无下一步') + '</p></div></div><div class="mside">' + tag + rm + '</div></div>'
    }).join('')
    // 0.30：卡片组共用单列一块（虚线分隔、浅色标签、这里不能取消）；会话读取仍是「卡片组 ∪ 卡片」
    const groupRows = groupMem.map((m) => {
      const s = this.stateOf(m.k)
      const nm = s ? esc(s.slug) : esc(m.k)
      return '<div class="mrow"><div class="txt"><div class="nm mq" title="' + esc(m.k) + '">' + nm + '</div>' + (s ? '<div class="more"><span class="mono">' + esc(s.project) + ' · 更新于 ' + esc(s.updated) + '</span><p class="l">' + esc(s.status || '暂无状态说明') + '</p></div>' : '<div class="more"><p class="l">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div>') + '</div><div class="mside"><span class="chip plain">来自卡片组</span></div></div>'
    }).join('')
    const groupBlk = groupRows ? '<div class="gmem"><div class="gmem-h">' + ic('mem') + '卡片组共用 · ' + groupMem.length + '</div>' + groupRows + '<p class="meta">整组卡片的会话都会读取；在「卡片组设置」里改，不占这张卡片自己的关联。</p></div>' : ''
    const memBody = (memRows ? '<div class="mlist open" id="dpmMemList">' + memRows + '</div>' : '<p class="meta">这张卡片还没有关联落盘项目。' + (this.copied.has(c.id) ? '复制卡片不带落盘项目，避免两张卡片写同一份记忆。' : '') + '</p>') + groupBlk
    const memTg = ''
    // 0.14：卡片自己的仓库清单；「本组共用」= 也在卡片组的卡片共用仓库里（只是提示）
    const shared = new Set(g.repos.map((r) => normPath(r.path)))
    const crs = c.repos ?? []
    // 0.27（v53）：名字 + 角色 + 本组共用一行、路径一行（省略中间目录，保留最后一级）；操作悬停浮出，不挤压文字
    const rok = this.snap?.repoOk ?? {}
    const repos = crs.map((r, i) => {
      const gone = rok[r.path] === false
      const tp = this.tilde(r.path).replace(/(.)\/+$/, '$1'), k = tp.lastIndexOf('/')
      /* v106 ⑤：仓库名 = 可点标题（在访达里打开这个文件夹）；悬停多一颗 Terminal 按钮（打开并 cd 到仓库） */
      if (!ro && this.rEdit && this.rEdit.card === c.id && this.rEdit.i === i) return '<div class="repo crepo editing" data-ri="' + i + '">' + ic('repo') + '<div class="txt"><div class="ftitle"><label class="sr-only" for="dpmRN">仓库名字</label><input id="dpmRN" class="fld" value="' + esc(this.rEdit.v) + '" maxlength="120" autocomplete="off" placeholder="仓库名字">'
        + '<button type="button" class="ib sm ok" data-r-save aria-label="保存">' + ic('check') + '</button><button type="button" class="ib sm" data-r-cancel aria-label="取消">' + ic('x') + '</button></div><span class="mono rpath">' + esc(this.tilde(r.path)) + '</span>' + injCard('dpmRInj', this.rEdit.on) + '<div class="fhint">只改名字和是否注入；路径不变。回车保存 · Esc 取消</div></div></div>'
      return '<div class="repo crepo' + (gone ? ' gone' : '') + (r.off ? ' ioff' : '') + '">' + iswHtml('repo', String(i), r.name, !!r.off, ro) + ic(gone ? 'filex' : 'repo') + '<div class="txt"><div class="r1">'
        + (gone ? '<span class="nm" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' : '<button type="button" class="nm repo-open" data-repo-open="' + esc(r.path) + '" title="在访达中打开「' + esc(r.path) + '」"><span class="nm2">' + esc(r.name) + '</span></button>')
        + '<span class="chip ' + (r.role === '主仓' ? 'brand' : 'plain') + '">' + esc(r.role) + '</span>'
        + (gone ? '<span class="fs gone" title="这个路径上已经没有文件夹"><i aria-hidden="true"></i>路径不存在</span>' : '')
        + ioffTag(!!r.off) + (shared.has(normPath(r.path)) ? '<span class="from" title="也在卡片组「' + esc(g.name) + '」的卡片共用仓库里">本组共用</span>' : '') + '</div>'
        + '<span class="mono rpath" title="' + esc(r.path) + '"><span class="pd">' + esc(tp.slice(0, k)) + '</span><span class="pb">' + esc(tp.slice(k)) + '</span></span></div>'
        + '<span class="racts">' + qbtn(repoText(r.name, r.path), r.name) + (gone ? '' : '<button type="button" class="ib sm tipbtn" data-repo-term="' + esc(r.path) + '" aria-label="在 Terminal 打开 ' + esc(r.name) + '">' + ic('term') + '<span class="tip" aria-hidden="true">在 Terminal 打开</span></button>' + '<button type="button" class="ib sm tipbtn" data-reveal-dir="' + esc(r.path) + '" aria-label="在访达中打开 ' + esc(r.name) + '">' + ic('finder') + '<span class="tip" aria-hidden="true">在访达中打开</span></button>')
        + '<button type="button" class="ib sm tipbtn cp" data-copy-path="' + esc(r.path) + '" aria-label="复制路径 ' + esc(r.path) + '">' + COPY_SVG + CHECK_SVG + '<span class="tip" aria-hidden="true">复制路径</span></button>'
        + (ro ? '' : '<button type="button" class="ib sm tipbtn" data-r-edit="' + i + '" aria-label="编辑仓库 ' + esc(r.name) + '（名字 / 是否注入 Agent 会话）">' + ic('pencil') + '<span class="tip" aria-hidden="true">编辑</span></button>')
        + (ro ? '' : '<button type="button" class="ib sm unl tipbtn" data-card-repo-del="' + i + '" aria-label="从这张卡片移除 ' + esc(r.name) + '">' + ic('x') + '<span class="tip" aria-hidden="true">移除</span></button>') + '</span></div>'
    }).join('')
    const repoBody = repos ? repos + (ro ? '' : '<p class="meta">移除只影响这张卡片，卡片组的共用仓库和其他卡片不变。</p>') : '<p class="ar-empty">' + (ro ? '没有仓库。' : '这张卡片还没有仓库。点「新增仓库」，可以一键带上卡片组的共用仓库。') + '</p>'
    const sess = this.linkedHtml(c, ro)
    return '<aside class="detail' + (ro ? ' ro' : '') + '" data-card="' + esc(c.id) + '" aria-labelledby="dpmDT" tabindex="-1"><div class="d-h dh3" id="dpmDH">' + (this.back && this.back.to === c.id && this.card(this.back.from) ? '<button type="button" class="d-back" data-back aria-label="返回「' + esc((this.card(this.back.from) as Card).t) + '」（Esc）">' + ic('chev') + '<span>返回「' + esc((this.card(this.back.from) as Card).t) + '」</span></button>' : '')
      // 0.28（v58）：卡片组 · 阶段在上，标题一行在下（放不下悬停整个标题栏走马灯）；默认只显示 ✕，悬停标题栏时复制 / 重命名 / 归档从右向左展开
      + '<div class="dh1"><div class="sub">' + esc(g.name) + ' · ' + esc(sts[i]?.name ?? '') + '</div>'
      + '<span class="hfold"><span class="fi">' + this.dPendBtn(c, ro) + '<button type="button" class="ib tipbtn" data-dup="' + esc(c.id) + '" aria-label="复制这张卡片">' + ic('dup') + '<span class="tip" aria-hidden="true">复制卡片</span></button>'
      + (ro ? '' : '<button type="button" class="ib tipbtn" data-rename-card aria-label="重命名卡片">' + ic('pencil') + '<span class="tip" aria-hidden="true">重命名</span></button><button type="button" class="ib tipbtn" data-archive-card="' + esc(c.id) + '" aria-disabled="' + String(!arcOk) + '" aria-label="' + (arcOk ? '归档这张卡片' : '还有 ' + arcLeft + ' 个任务未完成，完成后才能归档') + '">' + ic('archive') + '<span class="tip" aria-hidden="true">' + (arcOk ? '归档卡片' : '还有 ' + arcLeft + ' 个任务未完成，完成后才能归档') + '</span></button>')
      + '</span></span><button type="button" class="ib" data-close aria-label="关闭详情">' + ic('x') + '</button></div>'
      /* v129（5）：第 2 行 = 标题独占一行；第 3 行 = 状态胶囊（没拆任务的卡片才有） */
      + '<h2 id="dpmDT">' + esc(c.t) + '</h2>' + (c.tasks.length ? '' : '<div class="dhst">' + stHtml(zoneOfKeys(['p|' + c.id]), 'data-dpm-st="p|' + esc(c.id) + '"') + '</div>') + '</div>'
      // v86：Pending 说明条放在页头下面、内容上面（放页头里会把页头撑高、标题被挤）
      + this.pendBar(c)
      + (ro ? '<div class="arch-bar"><span class="txt"><b>已归档</b> · ' + esc(daysAgo(c.archivedAt)) + '，只能查看</span><button type="button" class="btn sm" data-unarchive-card="' + esc(c.id) + '">' + ic('unarchive') + '恢复活跃</button></div>' : '')
      + sess + '<div class="d-b">'
      + this.tasksSecHtml(c, ro)
      + this.notesHtml(c, ro) + this.webLinksHtml(c, ro) + this.filesHtml(c, ro)
      + '<section class="sec"><h3>' + ic('repo') + '仓库 · ' + crs.length + '<span class="grow"></span>' + (ro ? '' : this.hbtn('plus', '新增仓库', 'data-card-repo-add')) + '</h3>' + repoBody + '</section>'
      + '<section class="sec"><h3>' + ic('mem') + '关联的落盘项目' + (ownMem.length ? ' · ' + ownMem.length : '') + '<span class="grow"></span>' + memTg + (ro ? '' : '<button type="button" class="btn ghost sm" data-link-card>' + ic('plus') + '关联</button>') + '</h3>' + (ro ? '' : '<p class="meta mb">会话会自动读取「这张卡片 + 卡片组共用」的落盘项目记忆。</p>') + memBody + (ro ? '' : this.memActHtml(c, mem.length)) + '</section>'
      + this.relatedHtml(c, ro)
      + (ro ? '' : this.injSumHtml(c))
      // 0.24 已归档卡片也能删除
      + '<section class="sec plain"><button type="button" class="btn ghost danger" style="width:100%" data-remove-card>' + ic('trash') + '删除这张卡片</button></section></div>'
      + (ro ? '</aside>' : ''
      + '<div class="d-f"><div class="note"><span class="chip warn">' + ic('shield') + '完全权限</span><span class="chip mem">' + ic('mem') + '自动读取 ' + mem.length + ' 个落盘项目' + (hasMaterials(c) ? ' + 卡片资料' : '') + ((c.related ?? []).length ? ' + ' + (c.related ?? []).length + ' 张关联卡片的路径' : '') + '</span></div>'
      /* v151 用户反馈（截图「卡片详情页最下面创建会话的黑色按钮不见了」）：详情底部「以此卡片新建会话」是这张卡片的通用入口，一直显示；
         2.1 的「已关联活跃会话就不显示」只管执行安排卡片和详情里的任务 / 子任务卡 */
      + (this.creating === c.id ? '<button type="button" class="btn primary lg" disabled aria-busy="true"><span class="spin" aria-hidden="true"></span>正在新建会话…</button>' : '<button type="button" class="btn primary lg" data-open-card>' + ic('play') + '以此卡片新建会话</button>') + '</div></aside>')
  }

  // ── 0.16 落盘项目入口 ──
  /** 看板顶部一行提示：只在需要时出现（本机 skill 是单独一份 → 接管；功能没开 → 原因）。 */
  private lfNoteHtml(): string {
    const lf = this.snap?.landfill
    if (!lf || !lf.enabled) return ''
    if (!lf.ok) return '<div class="lf-note" role="status">' + ic('info') + '<span class="txt">落盘项目功能没开启：<b>' + esc(lf.reason) + '</b>。看板其他功能照常。</span></div>'
    const up = lf.toolOutdated ? '<div class="lf-note" role="status">' + ic('info') + '<span class="txt">本机的 <code>~/.ai/tools/ai-memory</code> 是旧版（v' + lf.toolVersion + '），不支持把截图等文件导入项目文件夹。升级 = 先备份，再换成插件自带的 v' + lf.bundledVersion + '（只新增命令，Codex 等其他工具照常用）。</span><button type="button" class="btn sm" data-lf-upgrade' + (this.upgrading ? ' disabled' : '') + '>' + (this.upgrading ? '升级中…' : '升级 ai-memory') + '</button></div>' : ''
    if (lf.skill !== 'file') return up
    return up + '<div class="lf-note" role="status">' + ic('info') + '<span class="txt">本机的 <code>' + esc(lf.skillPath.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')) + '</code> 是单独一份，Codex 等其他工具读的不是插件里这份。接管 = 先备份，再换成指向插件的链接。</span><button type="button" class="btn sm" data-lf-adopt' + (this.adopting ? ' disabled' : '') + '>' + (this.adopting ? '接管中…' : '接管') + '</button></div>'
  }
  private adopting = false
  private upgrading = false
  private lfBusy = false
  /** 卡片详情：回忆 / 落盘 两个按钮（发到这张卡片最近的会话）。 */
  private memActHtml(c: Card, memN: number): string {
    const lf = this.snap?.landfill
    if (!lf || !lf.enabled) return ''
    const off = !lf.ok
    const last = this.lastLive(c.id)
    const hint = off ? '落盘项目功能没开启，见看板顶部说明。' : last ? '发到这张卡片最近的会话「' + esc(last.title) + '」' : '这张卡片还没有会话，会先新建一个'
    return '<div class="mem-act"><button type="button" class="btn sm" data-lf-recall' + (off || !memN || this.lfBusy ? ' disabled' : '') + (memN ? '' : ' title="还没有关联落盘项目"') + '>' + ic('restore') + '回忆</button>'
      + '<button type="button" class="btn sm" data-lf-persist' + (off || this.lfBusy ? ' disabled' : '') + '>' + ic('save') + '落盘</button><p class="hint">' + hint + '</p></div>'
  }
  /** 这张卡片最近更新的活跃会话（没有归档、宿主里还在）。 */
  private lastLive(cardId: string): { id: string; title: string } | null {
    const all = new Map(this.host.allSessions().map((s) => [s.id, s]))
    let best: SessionView | null = null
    for (const r of this.snap?.board.sessions ?? []) {
      if (r.cardId !== cardId) continue
      const s = all.get(r.sessionId)
      if (s && !s.archived && (!best || s.updatedAt > best.updatedAt)) best = s
    }
    return best ? { id: best.id, title: best.title } : null
  }
  private async lfSend(c: Card, verb: '回忆' | '落盘项目'): Promise<void> {
    const keys = this.memOf(c).map((m) => this.stateOf(m.k)?.slug ?? m.k.split('/')[1])
    const text = verb + ' ' + (keys.join('、') || '').trim()
    this.lfBusy = true
    this.renderDetail()
    try { const t = await this.host.sendToCard(c.id, text.trim()); this.host.toast('已发到「' + t + '」：' + text.trim()) }
    catch (e) { this.host.toast((verb === '回忆' ? '回忆' : '落盘') + '失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
    finally { this.lfBusy = false; if (!this.disposed) this.renderDetail() }
  }

  /** 「已归档卡片」列表：就地展开在卡片组头部下方；一行 = 名称 + 灰字信息，点行看只读详情，行尾图标恢复活跃。 */
  private trayHtml(g: Group, ar: Card[]): string {
    const idx = this.idxCache ?? this.sessIndex()
    const rows = ar.map((c) => {
      const ns = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id && idx.has(s.sessionId)).length
      const nm = this.ownMem(c).length
      const sub = [this.st(g, c.col)?.name ?? '', ns ? ns + ' 个会话' : '', nm ? nm + ' 个落盘项目' : ''].filter(Boolean).join(' · ')
      return '<div class="arow" role="button" tabindex="0" data-card="' + esc(c.id) + '" aria-current="' + (this.sel === c.id) + '" aria-label="查看「' + esc(c.t) + '」（已归档，只读）">'
        + '<span class="txt"><span class="nm">' + esc(c.t) + '</span><span class="sub">' + esc(sub) + '</span></span>' + timesHtml(c.updatedAt, c.archivedAt)
        + '<button type="button" class="ib rst tipbtn" data-unarchive-card="' + esc(c.id) + '" aria-label="恢复活跃「' + esc(c.t) + '」">' + ic('unarchive') + '<span class="tip" aria-hidden="true">恢复活跃</span></button></div>'
    }).join('') || '<p class="atray-empty">还没有已归档的卡片。点卡片右上角的归档按钮，或把卡片拖到这里。</p>'
    return '<div class="atray" id="dpmTray-' + esc(g.id) + '" data-tray-g="' + esc(g.id) + '" role="region" aria-label="「' + esc(g.name) + '」的已归档卡片"><div class="atray-h">已归档 ' + ar.length + '<span class="grow"></span><button type="button" class="ib sm" data-tray="' + esc(g.id) + '" aria-label="收起已归档卡片">' + ic('x') + '</button></div>'
      + '<div class="atray-l"><div class="atray-drop" aria-hidden="true">松开即归档</div>' + rows + '</div></div>'
  }

  // ── 0.26 卡片组管理栏 / 已归档卡片组 / 复制卡片 / 归档卡片组 ──
  private garOpen = false
  private garPeek = new Set<string>()
  /** 本次打开期间复制出来的卡片（详情里「关联的落盘项目」空态说明为什么没有）。 */
  private copied = new Set<string>()
  private liveGroups(): Group[] { return this.groups.filter((g) => !g.archivedAt) }
  private liveN(gId: string): number { return this.cards.filter((c) => c.g === gId && !c.archivedAt).length }
  private mgrHtml(): string {
    const L = this.liveGroups(), ar = this.groups.filter((g) => g.archivedAt)
    const canOpen = L.some((g) => g.collapsed && this.liveN(g.id))
    const canFold = L.some((g) => !g.collapsed)
    const canOnly = L.some((g) => g.collapsed === !!this.liveN(g.id))
    return '<span class="lbl">' + ic('sliders') + '卡片组管理</span><span class="stat"><b>' + L.length + '</b> 个活跃' + (ar.length ? ' · <b>' + ar.length + '</b> 个已归档' : '') + '</span><span class="sep" aria-hidden="true"></span>'
      + '<button type="button" class="btn ghost sm tipbtn" data-all-open' + (canOpen ? '' : ' disabled') + ' title="' + (canOpen ? '' : '有卡片的卡片组都已展开') + '">' + ic('unfold') + '一键展开<span class="tip" aria-hidden="true">展开所有有活跃卡片的卡片组</span></button>'
      + '<button type="button" class="btn ghost sm tipbtn" data-only-live' + (canOnly ? '' : ' disabled') + '>' + ic('focus') + '只展开活跃卡片组<span class="tip" aria-hidden="true">有活跃卡片的展开，没有的收起</span></button>'
      + '<button type="button" class="btn ghost sm" data-all-fold' + (canFold ? '' : ' disabled') + ' title="' + (canFold ? '折叠所有活跃卡片组' : '已全部折叠') + '">' + ic('fold') + '一键折叠</button>'
      + '<span class="grow"></span>'
      + '<button type="button" class="btn ghost sm" data-gar aria-expanded="' + this.garOpen + '" aria-controls="dpmGar">' + ic('archive') + '已归档卡片组<span class="cnt">' + ar.length + '</span></button>'
  }
  private garHtml(): string {
    const ar = this.groups.filter((g) => g.archivedAt).sort((a, b) => (b.archivedAt as string).localeCompare(a.archivedAt as string))
    const rows = ar.map((g) => {
      const cs = this.cards.filter((c) => c.g === g.id)
      const open = this.garPeek.has(g.id)
      const sub = cs.length + ' 张已归档卡片 · ' + g.statuses.length + ' 个阶段 · ' + g.repos.length + ' 个仓库'
      return '<div class="grow-r' + (open ? ' open' : '') + '" data-gr="' + esc(g.id) + '"><div class="gr-row" data-gr-peek="' + esc(g.id) + '" role="button" tabindex="0" aria-expanded="' + open + '" aria-label="查看「' + esc(g.name) + '」（已归档，只读）">'
        + '<span class="chev-b">' + ic('chev') + '</span><span class="txt"><span class="nm">' + esc(g.name) + '</span><span class="sub">' + esc(sub) + '</span></span>' + timesHtml(g.updatedAt, g.archivedAt)
        + '<button type="button" class="btn sm rst" data-g-unarch="' + esc(g.id) + '">' + ic('unarchive') + '恢复活跃</button></div>'
        + (open ? '<div class="gr-prev"><p class="note-ro">只读预览。恢复活跃后卡片组回到归档前的位置；里面的卡片仍是已归档，可在组的「已归档卡片」里逐张恢复。</p>' + this.previewHtml(g) + '</div>' : '') + '</div>'
    }).join('') || '<p class="gar-empty">还没有已归档的卡片组。点卡片组标题栏右侧的归档按钮即可归档。</p>'
    return '<section class="gar" id="dpmGar" aria-label="已归档卡片组"><div class="gar-h">已归档卡片组 · ' + ar.length + '<span class="hint">· 最近归档的在上</span><span class="grow"></span><button type="button" class="ib sm" data-gar aria-label="收起已归档卡片组">' + ic('x') + '</button></div><div class="gar-l">' + rows + '</div></section>'
  }
  /** 已归档卡片组的只读预览：阶段 + 卡片（不能点开、没有操作）。 */
  private previewHtml(g: Group): string {
    const cs = this.cards.filter((c) => c.g === g.id)
    const n = g.statuses.length
    const head = '<div class="shead" style="--cols:' + n + '">' + g.statuses.map((st) => '<div class="colh"><span class="nm">' + esc(st.name) + '</span><span class="n">' + cs.filter((x) => x.col === st.id).length + '</span></div>').join('') + '</div>'
    const cells = g.statuses.map((st) => { const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order); return '<div class="cell' + (inCol.length ? '' : ' empty') + '">' + inCol.map((c) => '<div class="card ro"><h3>' + esc(c.t) + '</h3><p>' + esc(this.cardDesc(c)) + '</p></div>').join('') + '</div>' }).join('')
    return '<div class="lane-in">' + head + '<div class="lane-b" style="--cols:' + n + '">' + cells + '</div></div>'
  }
  private async bulkCollapse(mode: 'open' | 'only' | 'fold'): Promise<void> {
    try {
      const live = this.groups.filter((g) => this.groupLive(g)).map((g) => g.id)
      const r = await post<Snapshot & { result: { opened: number; folded: number } }>('groups/collapse', { mode, live })
      this.snap = r; this.render()
      const { opened, folded } = r.result
      this.host.toast(mode === 'open' ? '已展开 ' + opened + ' 个卡片组（没有活跃卡片的保持折叠）' : mode === 'fold' ? '已折叠 ' + folded + ' 个卡片组' : '已展开 ' + opened + ' 个、收起 ' + folded + ' 个卡片组')
    } catch (e) { this.host.toast(e instanceof ApiError ? e.message : String(e), 'err'); await this.refresh() }
  }
  /** 在看板自己的滚动区里把元素滚到可见（不用 scrollIntoView：它会连宿主外层一起滚）。 */
  private reveal(el: HTMLElement, center = false): void {
    const wrap = this.root.querySelector('.board-wrap') as HTMLElement
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect()
    if (r.top >= w.top && r.bottom <= w.bottom) return
    const top = center ? wrap.scrollTop + r.top - w.top - w.height / 3 : r.top < w.top ? wrap.scrollTop + r.top - w.top - 12 : wrap.scrollTop + Math.min(r.bottom - w.bottom + 12, r.top - w.top - 12)
    wrap.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  private async dupCard(id: string): Promise<void> {
    const c = this.card(id)
    if (!c) return
    let r: Snapshot & { result: Card }
    try { r = await post<Snapshot & { result: Card }>('card/copy', { id }) } catch (e) { this.host.toast('复制失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); return }
    if (this.disposed) return
    const x = r.result
    this.copied.add(x.id)
    this.snap = r
    const g = this.grp(x.g)
    if (g?.collapsed) { await this.act('group/update', { id: x.g, collapsed: false }) } else this.render()
    const el = this.root.querySelector('.board-wrap .card[data-card="' + CSS.escape(x.id) + '"]') as HTMLElement | null
    if (el) { this.reveal(el, true); el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 900) }
    this.host.toast('已复制为「' + x.t + '」，放在原卡片下面', 'ok', [
      { label: '打开', run: () => { this.sel = x.id; this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null; this.back = null; this.render() } },
      { label: '撤销', run: () => { if (this.sel === x.id) this.sel = c.id; void this.act('card/remove', { id: x.id }, '已撤销复制') } },
    ])
  }
  private async leaving(sel: string): Promise<void> { const el = this.root.querySelector(sel) as HTMLElement | null; if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('leaving'); await new Promise((r) => setTimeout(r, 220)) } }
  private landLane(id: string): void { const el = this.root.querySelector('.lane[data-lane="' + CSS.escape(id) + '"]') as HTMLElement | null; if (el) { this.reveal(el); el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 800) } }
  private async archiveGroup(id: string): Promise<void> {
    const g = this.grp(id)
    if (!g || this.liveN(id)) return
    await this.leaving('.lane[data-lane="' + CSS.escape(id) + '"]')
    if (this.sel && this.card(this.sel)?.g === id) this.sel = null
    if (!(await this.act('group/archive', { id }))) return
    this.host.toast('已归档卡片组「' + g.name + '」，可在「已归档卡片组」里查看和恢复', 'ok', { label: '撤销', run: () => { void this.act('group/unarchive', { id }).then((ok) => { if (ok) this.landLane(id) }) } })
  }
  private async unarchiveGroup(id: string): Promise<void> {
    const g = this.grp(id)
    if (!g) return
    await this.leaving('.grow-r[data-gr="' + CSS.escape(id) + '"]')
    this.garPeek.delete(id)
    if (!(await this.act('group/unarchive', { id }))) return
    this.landLane(id)
    this.host.toast('已恢复「' + g.name + '」，回到归档前的位置')
  }

  /** 归档卡片：卡片淡出后再提交；提示里可撤销。会话不动。 */
  private async archiveCard(id: string): Promise<void> {
    const c = this.card(id)
    if (!c || c.archivedAt) return
    const left = this.taskLeft(c)
    if (left) { this.host.toast('「' + c.t + '」还有 ' + left + ' 个任务未完成，完成后才能归档', 'err'); return }
    const el = this.root.querySelector('.card[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('leaving'); await new Promise((r) => setTimeout(r, 200)) }
    if (!(await this.act('card/archive', { id }))) return
    this.host.toast('已归档「' + c.t + '」', 'ok', { label: '撤销', run: () => void this.act('card/unarchive', { id }, '已撤销归档') })
    const row = this.root.querySelector('.arow[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (row) { row.classList.add('landed'); setTimeout(() => row.classList.remove('landed'), 700) }
  }
  /** 恢复活跃：行滑出后提交，卡片回到原阶段末尾并闪一下。 */
  private async unarchiveCard(id: string): Promise<void> {
    const c = this.card(id)
    if (!c || !c.archivedAt) return
    const row = this.root.querySelector('.arow[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (row && !matchMedia('(prefers-reduced-motion: reduce)').matches) { row.classList.add('leaving'); await new Promise((r) => setTimeout(r, 200)) }
    if (!(await this.act('card/unarchive', { id }))) return
    const now = this.card(id)
    const g = now ? this.grp(now.g) : undefined
    this.host.toast('已恢复「' + c.t + '」到「' + (g && now ? this.st(g, now.col)?.name ?? '' : '') + '」')
    const el = this.root.querySelector('.card[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (el) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 450) }
  }
  private async toggleTray(gId: string): Promise<void> {
    const g = this.grp(gId)
    if (!g) return
    if (this.tray.has(gId)) this.tray.delete(gId)
    else { this.tray.add(gId); if (g.collapsed && !(await this.act('group/update', { id: gId, collapsed: false }))) return }
    this.render()
    ;(this.root.querySelector('.lane-h [data-tray="' + CSS.escape(gId) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  /** 归档会话：与 dsh 侧栏同一动作——空闲直接归档（可撤销）；有进行中的工作 → 「停止并归档此会话？」确认。 */
  private async archiveSession(id: string): Promise<void> {
    const v = this.sessIndex().get(id)
    const title = v?.title ?? '会话'
    try {
      const r = await this.host.archiveSession(id, false)
      if (r.ok) { this.archivedToast(id, title, false); return }
      this.sa = { id, title }
      this.$('#dpmSaP').textContent = '“' + title + '”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。'
      this.$('#dpmSaL').innerHTML = r.activity.map((a) => '<li>' + esc(activityLine(a)) + '</li>').join('')
      const d = this.$<HTMLDialogElement>('#dpmDlgSArc')
      d.returnValue = ''
      d.showModal()
      ;(this.root.querySelector('#dpmDlgSArc [data-dlg-cancel]') as HTMLElement | null)?.focus()
    } catch (e) { this.host.toast('归档会话失败：' + (e instanceof Error ? e.message : String(e)), 'err') }
  }
  private async stopAndArchive(id: string, title: string): Promise<void> {
    try { await this.host.archiveSession(id, true); this.archivedToast(id, title, true) }
    catch (e) { this.host.toast('停止并归档失败：' + (e instanceof Error ? e.message : String(e)), 'err') }
  }
  private archivedToast(id: string, title: string, stopped: boolean): void {
    // v88：本地动作 await 完立即重绘（详情行的状态、卡片深绿、组浅绿同一帧到位）
    this.onSessionsChanged()
    this.host.toast((stopped ? '已停止并归档「' : '已归档「') + title + '」', 'ok', { label: '撤销', run: () => { this.host.unarchiveSession(id).catch((e) => this.host.toast('撤销失败：' + (e instanceof Error ? e.message : String(e)), 'err')) } })
  }

  /** 每张卡片的会话标志（一次渲染内复用会话索引）。 */
  private idxCache: Map<string, SessionView> | null = null
  private badgeOf(cardId: string): { n: number; live: number } | null {
    const idx = this.idxCache ?? this.sessIndex()
    return sessBadge((this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId), idx)
  }
  private chipSignature(): string {
    this.idxCache = this.sessIndex()
    try { return this.cards.map((c) => { const b = this.badgeOf(c.id); return b ? b.n + ':' + b.live : '-' }).join(',') + '|' + this.groups.map((g) => g.id + ':' + this.groupLive(g)).join(',') } finally { this.idxCache = null }
  }
  /** 0.32 卡片组活跃会话：按组的工作区统计全部未归档会话（含还没绑卡片的），不再只数卡片关联的。 */
  /** v86：有活跃会话的卡片组 id（日程页「只展开活跃卡片组」用同一口径）。 */
  liveGroupIds(): string[] { const all = this.host.allSessions(); return this.groups.filter((g) => !g.archivedAt && this.groupLive(g, all) > 0).map((g) => g.id) }
  /* v133 R2：all 由调用方传进来 —— 逐组各取一次全部会话曾让日程页每次重画多花 15–28ms@4x */
  private groupLive(g: Group, all0?: SessionView[]): number {
    // 组里没归档的会话 = 卡片自己的活跃会话 ∪ 组工作区里的会话（去重）。
    // 卡片会话不一定在组工作区里（例如从别处挂进组的会话），只按组工作区数会漏。
    const ids = new Set<string>()
    const all = all0 ?? this.host.allSessions()
    const byId = new Map(all.map((s) => [s.id, s]))
    const cardIds = new Set(this.cards.filter((c) => c.g === g.id && !c.archivedAt).map((c) => c.id))
    for (const ref of this.snap?.board.sessions ?? []) {
      if (!cardIds.has(ref.cardId)) continue
      const s = byId.get(ref.sessionId)
      if (s && !s.archived) ids.add(s.id)
    }
    const wid = this.snap?.hub.groups?.[g.id]
    if (wid) for (const s of all) if (s.wsId === wid && !s.archived) ids.add(s.id)
    if (ids.size) return ids.size
    // 旧快照没有 board.sessions / hub.groups 时退回卡片关联
    const idx = this.idxCache ?? this.sessIndex()
    let n = 0
    for (const c of this.cards) if (c.g === g.id && !c.archivedAt) n += this.badgeOfIdx(c.id, idx)?.live ?? 0
    return n
  }
  /** 0.20 卡片组标题旁统计：卡片数（蓝底，0 张变灰）+ 活跃会话数（组工作区里没归档的，实时）+ 仓库 / 阶段（灰色小字）。 */
  private liveLast = new Map<string, number>()
  private statHtml(g: Group, cs: Card[], live: number): string {
    const prev = this.liveLast.get(g.id)
    this.liveLast.set(g.id, live)
    const bump = prev !== undefined && prev !== live
    const n = cs.length
    return '<span class="gstat"><span class="cnt cards' + (n ? '' : ' zero') + '" title="' + (n ? n + ' 张卡片（不含已归档）' : '还没有卡片') + '"><b>' + n + '</b>张卡片</span>'
      + '<span class="cnt live' + (live ? '' : ' zero') + (bump ? ' bump' : '') + '" title="' + (live ? '本组里没归档的会话有 ' + live + ' 个（实时）' : '本组没有活跃会话') + '"><i aria-hidden="true"></i><b>' + live + '</b><span class="lb">活跃会话</span></span>'
      + '<span class="quiet">' + g.repos.length + ' 个仓库 · ' + g.statuses.length + ' 个阶段</span></span>'
  }
  private badgeOfIdx(cardId: string, idx: ReadonlyMap<string, SessionView>): { n: number; live: number } | null { return sessBadge((this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId), idx) }
  /** 0.20「以此卡片新建会话」：点了立刻进入忙态（锁按钮），建好或失败后恢复。 */
  creating: string | null = null
  setCreating(cardId: string | null): void { this.creating = cardId; this.renderDetail() }

  /**
   * 0.24 子任务区（原型 v43 / v44）：每个顶层子任务一张卡片（.tile）；父任务的子任务列在下面，父复选框正下方一条竖线贯穿，
   * 子任务与父任务标题左对齐。每项：标题 + 说明（[n] 显示成链接名）+ 绑定链接标签 + 类型 / 添加 / 修改（两行时间）。
   * 编辑 / 新增 = 整张卡片变成编辑卡（标题 → 类型 · 相关链接 → 说明 → 取消 / 保存）。
   */
  private taskEdit: { card: string; id: string; t: string; n: string; ty: string; links: string[]; files: string[]; err: string } | null = null
  /** 0.26 编辑卡里「绑定相关文件」浮层是否打开。 */
  private tkFp = false
  /** 0.26 子任务「展开详情」打开的卡片（切换卡片 = 回到默认收起）。 */
  private tkDetail: string | null = null
  /** 刚离开一张：等它收起（160ms）再看指针下面是哪张，期间不起新的悬停（否则快速移动会落回正在收起的那张） */
  /** 编辑卡里「绑定链接」浮层 / 说明里「[[」引用菜单（from = 「[[」所在位置，-1 = 按钮打开）。 */
  private tkLp: { q: string; fresh?: boolean } | null = null
  private tkRm: { q: string; from: number; i: number } | null = null
  private tkCaret: [number, number] = [0, 0]
  /** v106 ⑦：有子任务的任务，列表默认展开 —— 这里记的是「被收起」的（点开合按钮切换）。 */
  private tkClosed = new Set<string>()
  /** v113：已完成任务组默认收起；已完成子任务组按父任务各自默认收起。 */
  private tkDoneOpen = false
  private tkSubDone = new Set<string>()
  /**
   * v151（3.1，用户纠正）：已完成任务 / 已完成子任务按钮仍在「已完成列表」和「未完成列表」之间；点它时按钮在屏幕上不动 ——
   * 已完成列表在它上面，展开 / 收起的高度变化全部用详情滚动区的 scrollTop 抵掉（= 列表向上展开 / 向上收起）。
   * 逐帧跟到 grid 行过渡结束（240ms）+ 两帧不动为止；顶到 scrollTop 0 时（上面没空间）只能让按钮往下走，这是唯一例外。
   */
  private pinFold(btn: HTMLElement): void {
    const box = btn.closest('.d-b') as HTMLElement | null
    if (!box) return
    const y0 = btn.getBoundingClientRect().top
    const t0 = performance.now()
    let still = 0
    const tick = (): void => {
      if (!btn.isConnected) return
      const dy = btn.getBoundingClientRect().top - y0
      if (Math.abs(dy) >= 0.5) { box.scrollTop += dy; still = 0 } else still++
      ;(window as unknown as Record<string, unknown>).__dpmPinFold = { y0, y: btn.getBoundingClientRect().top, st: box.scrollTop, at: Date.now() }
      if (performance.now() - t0 < 600 && still < 3) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  /** v94：任务项的「查看详情」单项状态（收起视图 = 点开过谁；展开详情视图 = 谁被点了收起）。 */
  private tkViewOpen = new Set<string>()
  private tkViewClosed = new Set<string>()
  private tkFresh = ''
  /** 0.25 父任务卡片里的「添加子任务」行：pid = 父任务，v = 草稿 */
  private tkAdd: { card: string; pid: string; v: string } | null = null
  /** v99：任务分区底部内联加任务那一行（只填标题就能存；回车连续加）。 */
  private tkNew: { card: string; v: string; fresh?: boolean } | null = null
  private taskTypes(): string[] { return this.snap?.board.taskTypes ?? ['开发', '验证', '文档', '沟通'] }
  private linkOf(c: Card, id: string): WebLink | undefined { return (c.webLinks ?? []).find((l) => l.id === id) }
  private noteHtmlT(c: Card, t: Task): string {
    // v101：说明里的分割线也画成真横线（与块编辑器同一套标记）
    const one = (ln: string): string => linkify(ln).replace(REF_RE, (m, n: string) => { const l = this.linkOf(c, (t.links ?? [])[+n - 1] ?? ''); return l ? '<a class="ref" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="[' + n + '] ' + esc(l.text) + ' · ' + esc(l.url) + '"><b>' + n + '</b>' + esc(l.text) + '</a>' : m })
    return String(t.note ?? '').split('\n').map((ln) => {
      const m = ln.match(/^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/)
      if (m) { const tt = (m[1] ?? '').trim(); return '<div class="ndiv' + (tt ? '' : ' no-t') + '"><i class="ndiv-l"></i>' + (tt ? '<b>' + esc(tt) + '</b>' : '') + '<i class="ndiv-r"></i></div>' }
      const html = one(ln)
      return '<div class="nline">' + (html || '<br>') + '</div>'
    }).join('')
  }
  /** v86：把卡片转成引用文本要的 QCard（和对话框引用列表同一套数据形状）。 */
  private qcard(c: Card): QCard {
    const st = this.snap?.files ?? {}
    return {
      tasks: c.tasks as unknown as QTask[],
      links: (c.webLinks ?? []).map((l) => ({ id: l.id, text: l.text, type: l.type, url: l.url })),
      files: (c.files ?? []).map((f) => ({ id: f.id, path: f.path, title: fileName(f), exists: st[f.path] !== false })),
    }
  }
  /** v86：任务在卡片里的位置（父序号 / 子序号），引用文本要用。 */
  private qpos(c: Card, t: Task): { ti: number; si?: number } {
    const ti = c.tasks.findIndex((x) => x === t || x.id === t.id)
    if (ti >= 0) return { ti }
    for (let i = 0; i < c.tasks.length; i++) {
      const j = (c.tasks[i].subs ?? []).findIndex((x) => x === t || x.id === t.id)
      if (j >= 0) return { ti: i, si: j }
    }
    return { ti: 0 }
  }
  /** v94：这一项在详情里展开着吗（brief 视图 = 点了「查看详情」的那几项；展开详情视图 = 没被点「收起」的那几项）。 */
  private taskOpen(c: Card, id: string): boolean {
    return this.tkDetail !== c.id ? this.tkViewOpen.has(id) : !this.tkViewClosed.has(id)
  }
  /** v97：任务项 = 吸顶标题行（拖拽 / 勾选 / 标题按钮 / 操作）+ 可开合详情（说明全文 / 链接 / 文件 / 类型时间）。
      只有勾选框能改完成状态；标题与右侧箭头都能开合整块详情；说明不再截断、也没有单独的展开按钮。 */
  private taskRowHtml(c: Card, t: Task, lv: number, ro: boolean, extra = ''): string {
    if (!ro && this.taskEdit && this.taskEdit.card === c.id && this.taskEdit.id === t.id) return this.taskEditorHtml(c, t, lv)
    const k = t.id as string
    const subs = t.subs ?? []
    const sd = subs.filter((x) => x.done).length
    const viewOpen = this.taskOpen(c, k)
    /* v107 ④：任务详情不再平铺 —— 说明 / 链接 / 文件各是一个独立子卡片（标题小字 + 计数），类型与时间做底部一行 meta */
    const note = t.note ? '<section class="pdx-sec pdx-note"><div class="pdx-h">说明</div><div class="tn" id="dpmTn-' + esc(k) + '">' + this.noteHtmlT(c, t) + '</div></section>' : ''
    const links = (t.links ?? []).map((id, i) => { const l = this.linkOf(c, id); if (!l) return ''; return '<span class="lk"><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(l.text) + ' · ' + esc(l.url) + '">' + ic('link') + '<b>' + (i + 1) + '</b><span class="lt">' + esc(l.text) + '</span></a>' + (ro ? '' : '<button type="button" class="lx" data-tk-unlink="' + esc(k) + '" data-lid="' + esc(id) + '" aria-label="解除「' + esc(l.text) + '」与这个任务的绑定" title="解除绑定">' + ic('x') + '</button>') + '</span>' }).join('')
    const st = this.snap?.files ?? {}
    const fls = (t.files ?? []).map((id) => { const f = (c.files ?? []).find((x) => x.id === id); if (!f) return ''; const gone = st[f.path] === false; return '<span class="lk fk' + (gone ? ' gone' : '') + '" title="' + esc(f.path) + (gone ? '（文件已删除）' : '') + '">' + ic(gone ? 'filex' : ftype(f.path)?.icon ?? 'file') + '<span class="lt">' + esc(fileName(f)) + '</span></span>' }).join('')
    const meta = (t.type || t.created) ? '<div class="tmeta">' + (t.type ? '<span class="tty">' + esc(t.type) + '</span>' : '') + (t.created ? '<span class="tts"><span class="k">添加</span><time datetime="' + esc(t.created) + '">' + dayTime(t.created) + '</time><span class="k">修改</span><time datetime="' + esc(t.updated ?? t.created) + '">' + dayTime(t.updated ?? t.created) + '</time></span>' : '') + '</div>' : ''
    const mixed = subs.length && sd && !t.done
    /* 勾选：只有这块 22×22 能改完成状态（点标题 / 说明 / 行内空白都不改） */
    const pcb = '<span class="pcb"><input type="checkbox" data-tk-done="' + esc(k) + '"' + (t.done ? ' checked' : '') + (mixed ? ' data-mixed' : '') + (ro ? ' disabled' : '') + ' aria-label="完成「' + esc(t.text) + '」" title="勾选 = 完成 / 取消完成（只有这个框能改）"></span>'
    /* 标题本身就是开合按钮（另一个入口是右侧箭头）；两处状态由同一次重画同步 */
    const title = '<button type="button" class="tkt" data-tk-view="' + esc(k) + '" aria-haspopup="dialog" title="在详情左边弹出这个' + (lv ? '子任务' : '任务') + '的详细信息（说明 / 子任务 / 链接 / 文件）"><span class="tx">' + esc(t.text) + '</span></button>'
    const qbT = qbtn(taskText(this.qcard(c), this.qpos(c, t).ti, this.qpos(c, t).si), t.text)
    /* v127（6）：没有说明 / 链接 / 文件 → 一行提示 + 「补充详情」，不再是一大块空白 */
    const nodx = (!t.note && !(t.links ?? []).length && !(t.files ?? []).length) ? '<div class="v7nodx"><span>还没有说明、链接或文件</span>' + (ro ? '' : '<button type="button" class="v7nodx-b" data-tk-edit="' + esc(k) + '">补充详情</button>') + '</div>' : ''
    const dxIn = nodx + note
      + (links ? '<section class="pdx-sec"><div class="pdx-h">链接<span class="n">' + (t.links ?? []).length + '</span></div><div class="tlinks">' + links + '</div></section>' : '')
      + (fls ? '<section class="pdx-sec"><div class="pdx-h">文件<span class="n">' + (t.files ?? []).length + '</span></div><div class="tlinks tfiles" aria-label="相关文件">' + fls + '</div></section>' : '')
      + (meta ? '<div class="pdx-meta">' + meta + '</div>' : '')
    /* v113（2.6）：拖动只在本列表的同组内换位（不再靠左右拖改层级）；键盘 Alt+↑↓ 同样只在本组内换 */
    /* v113（2.6）：任务和子任务都要能拖动排序（子任务只在「未完成子任务 / 已完成子任务」各自列表内换位） */
    const grip = '<button type="button" class="tgrip' + (lv ? ' sub' : '') + '" data-tk-grip="' + esc(k) + '" aria-label="拖动「' + esc(t.text) + '」：拖到另一个任务上 = 变成它的子任务；拖到任务之间 = 调整顺序" title="拖动：拖到另一个任务上 = 变成它的子任务；拖到任务之间 = 调整顺序；子任务拖到任务之间 = 恢复为独立任务（已完成 / 未完成两个区不能互拖）；键盘 Alt+↑↓ 排序、Alt+→ 变成上一项的子任务、Alt+← 移回顶层">' + ic('grip') + '</button>'
    /* v107 ③ / v108 ①：子任务开合按钮 = 无箭头的胶囊（展开 = 蓝色实心、收起 = 灰色虚线），放在任务标题下面、
       和标题一起在吸顶块里 —— 卡片详情往上滚时按钮不会被白色标题盖住。 */
    const kidsOpen = !this.tkClosed.has(k)
    /* v113（2.1/2.3）：子任务进度 = 标题下面一行：可点的「子任务 x/y」徽标（开合子任务列表）+ 进度条 + 加号图标（永远只有图标） */
    const krow = (!lv && subs.length)
      ? '<div class="tkrow2">'
        + '<button type="button" class="tkbadge" data-tk-fold="' + esc(k) + '" aria-expanded="' + kidsOpen + '" aria-controls="dpmKids-' + esc(k) + '" title="' + (kidsOpen ? '收起' : '展开') + '子任务列表（' + sd + '/' + subs.length + '）">'
        + '<svg class="kchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.4 5 5.2 5-5.2"/></svg>'
        + '<span>子任务 <b>' + sd + '</b>/' + subs.length + '</span></button>'
        + '<span class="kbar" aria-hidden="true"><i style="width:' + (subs.length ? Math.round(sd / subs.length * 100) : 0) + '%"></i></span>'
        + (ro ? '' : '<button type="button" class="kadd-ico" data-tk-kadd="' + esc(k) + '" title="添加子任务" aria-label="添加子任务">' + ic('plus') + '</button>')
        + '</div>'
      : ''
    /* v144（2.1）：没有子任务、没完成的任务 → 悬停按钮组多一颗「+」（添加子任务）；有了子任务改用进度行里那颗 */
    const addSub = !ro && !lv && !subs.length && !t.done ? '<button type="button" class="ib v44sub" data-tk-kadd="' + esc(k) + '" title="添加子任务" aria-label="给「' + esc(t.text) + '」添加子任务">' + ic('plus') + '</button>' : ''
    const head = '<div class="tkhead"><div class="tkrow">' + grip + pcb + title + '<span class="tacts">' + qbT + addSub + (ro ? '' : '<button type="button" class="ib" data-tk-edit="' + esc(k) + '" aria-label="编辑任务 ' + esc(t.text) + '">' + ic('pencil') + '</button>'
      + '<button type="button" class="ib del" data-tk-del="' + esc(k) + '" aria-label="删除任务 ' + esc(t.text) + (subs.length ? '（连同 ' + subs.length + ' 个子任务）' : '') + '">' + ic('x') + '</button>') + '</span></div>' + this.tkStRow(c, t, lv) + krow + '</div>'
    const cls = 'task' + (t.done ? ' done' : '') + (lv ? ' child' : ' top') + (lv ? (viewOpen ? ' open' : ' closed') : '')
    const tag = lv ? 'li' : 'div'
    return '<' + tag + ' class="' + cls + '" data-tid="' + esc(k) + '" data-lv="' + lv + '">' + head + '<div class="tmain"><div class="dx" id="dpmDx-' + esc(k) + '"><div class="dxi">' + dxIn + '</div></div></div>' + extra + '</' + tag + '>'
  }

  /** v129（1）：任务 / 子任务标题栏第 2 行 = 状态胶囊 + 截止标签（左边和标题对齐，在「子任务 n/n」之前）。 */
  private tkStRow(c: Card, t: Task, lv: number): string {
    /* v141：子任务的状态 = 自己记过执行就是「本日已执行」，否则跟它的任务走（任务键在前，自己的键用来看执行记录） */
    const par = lv === 1 ? c.tasks.find((x) => (x.subs ?? []).some((y) => y.id === t.id)) : null
    const keys = lv === 1 && par ? ['s|' + c.id + '|' + t.id, 't|' + c.id + '|' + par.id] : taskKeys(c.id, t, false)
    /* v140（2）/ v141（2.2）：第二行右侧 = 会话状态 / 关联会话 + 更换 + 以此任务创建会话；放不下 = 独占下一行最左（fitTc 实时判断） */
    return '<div class="tkst">' + stHtml(zoneOfKeys(keys), 'data-dpm-st="' + esc(keys.join(',')) + '"') + dueChip(t.due, t.done) + tcHtml(c.id, t, lv === 1, !!c.archivedAt) + '</div>'
  }
  /** 今天面板缓存变了 → 原地改状态胶囊（变了闪一下），不重画详情。 */
  private paintSt(): void {
    for (const b of Array.from(this.root.querySelectorAll('[data-dpm-st]')) as HTMLElement[]) {
      const z = zoneOfKeys((b.dataset.dpmSt ?? '').split(','))
      if (b.dataset.z === (z || 'none')) continue
      b.dataset.z = z || 'none'
      const s = b.querySelector('span'); if (s) s.textContent = ZT[z]
      b.classList.remove('v7chg'); void b.offsetWidth; b.classList.add('v7chg')
    }
  }
  /** v127（1）：排今天开关开着时，新建的任务保存后直接排进今天（等任务先落盘，否则服务端不认这个 key）。 */
  private schedNew(cid: string, keys: string[]): void {
    if (!swOn()) return
    void this.tkChain.then(() => scheduleKeys(cid, keys)).then((r) => { this.host.toast('已排今天：进了今天的「未安排」和本日计划清单' + (r.planAdded ? ' · 甘特图今天补上了计划条' : '')); panelDirty() })
      .catch((e: unknown) => this.host.toast('没排进今天：' + (e instanceof Error ? e.message : String(e)), 'err'))
  }
  /** v127（3）：详情里勾完成 = 自动记录执行（今天面板里有、还没记过的）。 */
  private recDone(cid: string, keys: string[], name: string): void {
    void this.tkChain.then(() => recordDone(keys)).then((n) => { if (n) { this.host.toast('勾选完成 = 自动记录执行：「' + name + '」挪到今天的「本日已执行」'); panelDirty() } }).catch(() => undefined)
  }
  /** v129（5）：详情标题栏的「设为 pending」= 看板卡片上同一个按钮（有活跃会话 / 已归档置灰并写原因；已是 pending 高亮）。 */
  private dPendBtn(c: Card, ro: boolean): string {
    const sb = this.badgeOf(c.id)
    const live = !!sb && sb.live > 0
    const lab = ro ? '已归档，不能设为 pending' : live ? '有活跃会话，不能设为 pending' : c.pending ? '恢复活跃' : '设为 pending'
    return '<button type="button" class="ib tipbtn' + (c.pending ? ' pon' : '') + '" data-pend="' + esc(c.id) + '" data-pend-on="' + (c.pending ? '0' : '1') + '" aria-disabled="' + String(ro || live) + '" aria-label="' + lab + '">' + ic('pend') + '<span class="tip" aria-hidden="true">' + lab + '</span></button>'
  }
  private taskTileHtml(c: Card, t: Task, ro: boolean): string {
    const subs = t.subs ?? []
    const sd = subs.filter((x) => x.done).length
    const k = t.id as string
    /* v106 ⑦ / v107 ③：子任务列表默认展开，与任务自己的详情互不影响；
       按钮在标题下面的吸顶块里（v108 ①），列表只保留外层一条浅竖线、不再深缩进。 */
    const kidsOpen = !this.tkClosed.has(k)
    const editing = !ro && this.taskEdit?.card === c.id && this.taskEdit.id === k
    const kadd = !ro && this.tkAdd && this.tkAdd.card === c.id && this.tkAdd.pid === k ? this.kaddHtml(c, t, ro) : ''
    /* v113（2.5）：已完成子任务列表在上 → 「已完成子任务 N」胶囊在它下面（未完成子任务上面）；
       外层 wrap 走 grid 行过渡（开合有动效、不重画）。 */
    const dn = subs.filter((x) => x.done)
    const un = subs.filter((x) => !x.done)
    const subDoneOpen = this.tkSubDone.has(k)
    const kids = subs.length ? '<div class="ptkids-wrap' + (kidsOpen ? ' open' : '') + '" id="dpmKidsWrap-' + esc(k) + '">'
      + '<div class="ptkw-in"><ul class="kids open' + (this.tkFresh === k ? ' fresh' : '') + '" id="dpmKids-' + esc(k) + '">'
      /* v122（3）：父任务本身已完成 → 子任务全是已完成，直接列出来（以前只剩一粒「已完成子任务 N」胶囊，点徽标「展开」看起来什么都没出来） */
      + (dn.length && !t.done ? '<li class="tilebody kidbody' + (subDoneOpen ? ' open' : '') + '" data-tk-subbody="' + esc(k) + '"><ul class="tilebody-in">' + dn.map((x) => this.taskRowHtml(c, x, 1, ro)).join('') + '</ul></li>' : '')
      + (dn.length && !t.done ? this.doneFoldHtml('sub', k, dn.length, subDoneOpen) : '')
      + (t.done ? dn.map((x) => this.taskRowHtml(c, x, 1, ro)).join('') : '')
      + un.map((x) => this.taskRowHtml(c, x, 1, ro)).join('')
      + (kidsOpen ? kadd : '')
      + '</ul></div></div>'
      /* v144（2.1）：还没有子任务的任务点了悬停「+」→ 在它下面展开同一套「添加子任务」输入行 */
      : (kadd ? '<div class="ptkids-wrap open v44kadd"><div class="ptkw-in"><ul class="kids open">' + kadd + '</ul></div></div>' : '')
    // 编辑中的卡（含编辑它的子集）始终展开
    const ed = editing || (!ro && !!this.taskEdit && this.taskEdit.card === c.id && subs.some((x) => x.id === this.taskEdit?.id))
    // 0.26.1：只有标题（没有说明 / 链接 / 文件 / 类型 / 子集，添加修改时间不算详情）的卡收起视图没有展开内容
    const bare = !subs.length && !t.note && !(t.links ?? []).length && !(t.files ?? []).length && !t.type
    // v94：收起视图 = 只展开点过「查看详情」的；展开详情视图 = 除了点过「收起」的，全部展开。鼠标悬停不再改变任何东西。
    const viewOpen = this.taskOpen(c, k)
    const brief = this.tkDetail !== c.id
    /* v108 ①：子任务列表放进任务自己的容器里 —— 吸顶标题的「containing block」要够高（含子任务列表），
       否则详情收起时标题块只有 70px 高，粘不住、会从分区标题下面滑走（按钮又被盖住）。 */
    return '<li class="tile' + (t.done ? ' done' : '') + (subs.length ? ' parent' : '') + (bare ? ' bare' : '') + (ed ? ' editing-tile' : '') + (this.tkFresh === k ? ' fresh' : '')
      + (brief ? (viewOpen ? ' open' : '') : (viewOpen ? '' : ' closed')) + '" data-tile="' + esc(k) + '">' + this.taskRowHtml(c, t, 0, ro, kids) + '</li>'
  }
  /** v113（2.4）：已完成任务 / 已完成子任务 = 一粒紧凑胶囊（箭头居中：展开向下、收起向右），放在各自列表最上面。 */
  private doneFoldHtml(kind: 'task' | 'sub', key: string, n: number, open: boolean): string {
    const attr = kind === 'task' ? 'data-tk-donebtn="1"' : 'data-tk-subbtn="' + esc(key) + '"'
    const what = kind === 'task' ? '任务' : '子任务'
    /* v113（2.4）：按钮文案就是「展开已完成任务 / 收起已完成任务」（子任务同理），点击后文案要跟着换 */
    const label = (open ? '收起' : '展开') + '已完成' + what
    return '<li class="tilefold' + (kind === 'sub' ? ' kid' : '') + '"><button type="button" class="tilefold-b" ' + attr + ' aria-expanded="' + open + '" title="' + label + '（' + n + ' 项）">'
      + '<svg class="pfchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>'
      + '<span>' + label + '</span><b>' + n + '</b></button></li>'
  }
  /** 折叠胶囊的文案随开合切换（展开已完成任务 / 收起已完成任务）。 */
  private paintFoldLabel(btn: HTMLElement, open: boolean, what: '任务' | '子任务'): void {
    const n = btn.querySelector('b')?.textContent ?? ''
    const label = (open ? '收起' : '展开') + '已完成' + what
    btn.title = label + '（' + n + ' 项）'
    const sp = btn.querySelector('span')
    if (sp) sp.textContent = label
  }
  /** v107 ③：添加子任务和添加任务同一套 —— 一行输入框 + 编辑详情（完整弹窗）+ 保存 + 收起；保存后输入行保留并继续聚焦。 */
  private kaddHtml(c: Card, t: Task, ro: boolean): string {
    if (ro) return ''
    const k = t.id as string
    const a = this.tkAdd && this.tkAdd.card === c.id && this.tkAdd.pid === k ? this.tkAdd : null
    if (!a) return '<li class="kadd"><button type="button" class="kadd-b" data-tk-kadd="' + esc(k) + '">' + ic('plus') + '添加子任务</button></li>'
    return '<li class="ptnew subnew" id="dpmKAddRow">'
      + '<label class="sr-only" for="dpmKAdd">在「' + esc(t.text) + '」里添加子任务</label>'
      + '<input id="dpmKAdd" class="pin" placeholder="子任务标题，回车保存" maxlength="120" autocomplete="off" spellcheck="false" value="' + esc(a.v) + '">'
      + '<button type="button" class="pib detail" data-tk-subdlg="' + esc(k) + '" title="编辑详情：打开「添加卡片任务」窗口" aria-label="编辑详情，打开完整的添加卡片任务窗口">' + ic('listpen') + '</button>'
      + swHtml() + '<span class="psep" aria-hidden="true"></span>'
      + '<button type="button" class="pib main" data-tk-kaddok title="保存这个子任务（回车）" aria-label="保存这个子任务"' + (a.v.trim() ? '' : ' disabled') + '>' + ic('check') + '</button>'
      + '<button type="button" class="pib" data-tk-kaddclose title="收起输入行（Esc）" aria-label="收起输入行">' + ic('x') + '</button>'
      + '</li>'
  }
  private kaddOpen(c: Card, pid: string): void {
    if (this.taskEdit && !this.taskEditSave(true)) return
    if (this.tkClosed.has(pid)) { this.tkClosed.delete(pid); this.tkFresh = pid }
    this.tkAdd = { card: c.id, pid, v: '' }
    this.lastDetail = ''; this.renderDetail(); this.tkFresh = ''
    ;(this.root.querySelector('#dpmKAdd') as HTMLInputElement | null)?.focus({ preventScroll: true })
  }
  private kaddClose(focusBack = false): void {
    const a = this.tkAdd; if (!a) return
    this.tkAdd = null; this.lastDetail = ''; this.renderDetail()
    if (focusBack && this.kbd) this.focusTask('[data-tk-kadd="' + CSS.escape(a.pid) + '"]')
  }
  private kaddSave(c: Card): void {
    const a = this.tkAdd; if (!a) return
    const inp = this.root.querySelector('#dpmKAdd') as HTMLInputElement | null
    const v = (inp?.value ?? a.v).replace(/\s+/g, ' ').trim()
    if (!v) { inp?.focus(); return }
    const next = tClone(c.tasks)
    const P = tFind(next, a.pid)?.t; if (!P) { this.tkAdd = null; return }
    const was = P.done
    const x: Task = { id: newTaskId(), text: v, done: false }
    P.subs = [...(P.subs ?? []), x]
    a.v = ''
    this.tasksCommit(c, next, undefined, x.id)
    this.schedNew(c.id, taskKeys(c.id, P, false))
    ;(this.root.querySelector('#dpmKAdd') as HTMLInputElement | null)?.focus({ preventScroll: true })
    if (was) this.host.toast('「' + P.text + '」有了未完成的子任务，已改回未完成')
  }
  private taskTypeOpts(cur: string): string {
    const ts = this.taskTypes()
    return '<option value=""' + (cur ? '' : ' selected') + '>无类型</option>' + ts.map((x) => '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + (cur && !ts.includes(cur) ? '<option selected>' + esc(cur) + '</option>' : '') + '<option value="__manage">管理类型…</option>'
  }
  private taskEditorHtml(c: Card, t: Task | null, lv: number): string {
    const e = this.taskEdit as NonNullable<BoardView['taskEdit']>
    const chips = this.tkChips(c, e.links)
    const tag = lv ? 'li' : 'div'
    return '<' + tag + ' class="task editing ' + (lv ? 'child' : 'top') + '"' + (t ? ' data-tid="' + esc(t.id as string) + '" data-lv="' + lv + '"' : '') + '><div class="ed3">'
      + '<div class="erow"><input type="checkbox" class="cbx" tabindex="-1" aria-hidden="true"' + (t?.done ? ' checked' : '') + '><label class="sr-only" for="dpmTaskEd">任务标题</label>'
      + '<input class="fld" id="dpmTaskEd" value="' + esc(e.t) + '" maxlength="120" autocomplete="off" placeholder="任务标题"' + (e.err ? ' aria-invalid="true" aria-describedby="dpmTaskEdE"' : '') + '></div>'
      + (e.err ? '<p class="task-err" id="dpmTaskEdE">' + esc(e.err) + '</p>' : '')
      + '<div class="eprops"><label class="ep"><span class="epl">类型</span><select id="dpmTaskTy" aria-label="任务类型">' + this.taskTypeOpts(e.ty) + '</select></label>'
      + '<div class="ep grow2"><span class="epl" id="dpmTaskLkL">相关链接</span><div class="eplinks" role="group" aria-labelledby="dpmTaskLkL">' + chips + '<button type="button" class="addlk" data-tk-lpick aria-expanded="' + !!this.tkLp + '" aria-controls="dpmTkLp">' + ic('plus') + (e.links.length ? '' : '绑定本卡片的链接') + '</button></div></div>'
      + (this.tkLp ? this.tkLinkPickHtml(c) : '')
      + '<div class="ep grow2"><span class="epl" id="dpmTaskFkL">相关文件</span><div class="eplinks" role="group" aria-labelledby="dpmTaskFkL">' + this.tkFChips(c, e.files) + '<button type="button" class="addlk" data-tk-fpick aria-expanded="' + this.tkFp + '" aria-controls="dpmTkFp">' + ic('plus') + (e.files.length ? '' : '绑定本卡片的文件（可选）') + '</button></div></div>'
      + (this.tkFp ? this.tkFilePickHtml(c) : '') + '</div>'
      + '<div class="enote"><label class="sr-only" for="dpmTaskNote">任务说明</label><textarea class="tarea" id="dpmTaskNote" rows="2" placeholder="任务说明（可选）。输入 [[ 引用上面绑定的链接">' + esc(e.n) + '</textarea>'
      + (this.tkRm ? this.tkRefMenuHtml(c) : '')
      + '<div class="ntool"><button type="button" class="btn ghost sm" data-tk-ref aria-haspopup="listbox">' + ic('link') + '引用链接</button><span class="meta">或在说明里输入 <kbd>[[</kbd>；保存后 [1] 显示成链接名</span></div></div>'
      + '<div class="efoot"><span class="meta">标题里 Enter 保存 · 说明里 ⌘Enter 保存 · Esc 放弃</span><span class="grow"></span><button type="button" class="btn sm" data-tk-cancel>取消</button><button type="button" class="btn primary sm" data-tk-save>' + (t ? '保存' : '添加') + '</button></div>'
      + '</div></' + tag + '>'
  }
  private tkChips(c: Card, links: string[]): string {
    return links.map((id, i) => { const l = this.linkOf(c, id); return l ? '<span class="lk on"><span class="lka"><b>' + (i + 1) + '</b><span class="lt">' + esc(l.text) + '</span></span><button type="button" class="lx" data-tk-eunlink="' + esc(id) + '" aria-label="解除「' + esc(l.text) + '」的绑定" title="解除绑定">' + ic('x') + '</button></span>' : '' }).join('')
  }
  private tkFChips(c: Card, ids: string[]): string {
    const st = this.snap?.files ?? {}
    return ids.map((id) => { const f = (c.files ?? []).find((x) => x.id === id); if (!f) return ''; const gone = st[f.path] === false; return '<span class="lk on fk' + (gone ? ' gone' : '') + '" title="' + esc(f.path) + (gone ? '（文件已删除）' : '') + '">' + ic(gone ? 'filex' : ftype(f.path)?.icon ?? 'file') + '<span class="lt">' + esc(fileName(f)) + '</span><button type="button" class="lx" data-tk-efunlink="' + esc(id) + '" aria-label="解除「' + esc(fileName(f)) + '」的绑定" title="解除绑定">' + ic('x') + '</button></span>' }).join('')
  }
  /** 0.26 只列本卡片还存在的文件；已删除的不列（数量写在底部）。 */
  private tkFilePickHtml(c: Card): string {
    const e = this.taskEdit as NonNullable<BoardView['taskEdit']>
    const st = this.snap?.files ?? {}
    const all = c.files ?? []
    const pool = all.filter((f) => st[f.path] !== false)
    const gone = all.length - pool.length
    const used = (id: string): number => tFlat(c.tasks).filter((x) => x.id !== e.id && (x.files ?? []).includes(id)).length
    const rows = pool.map((f) => { const n = used(f.id), ty = ftype(f.path); return '<label class="lp-i"><input type="checkbox" data-tk-fpk="' + esc(f.id) + '"' + (e.files.includes(f.id) ? ' checked' : '') + '><span class="pi">' + ic(ty?.icon ?? 'file') + '</span><span class="txt"><span class="nm">' + esc(fileName(f)) + '</span><span class="sub">' + esc((ty ? ty.label + ' · ' : '') + f.path) + (n ? ' · 另有 ' + n + ' 个任务绑定' : '') + '</span></span></label>' }).join('')
      || '<p class="lp-empty">这张卡片还没有还存在的相关文件，先在「相关文件」里添加</p>'
    return '<div class="lpop" id="dpmTkFp" role="dialog" aria-label="选择要绑定的相关文件"><div class="lp-l">' + rows + '</div><div class="lp-f"><span class="meta">只列本卡片还存在的文件' + (gone ? '（' + gone + ' 个已删除的不列）' : '') + '，可以不选</span><span class="grow"></span><button type="button" class="btn primary sm" data-tk-fpdone>完成</button></div></div>'
  }
  private tkLinkPickHtml(c: Card): string {
    const e = this.taskEdit as NonNullable<BoardView['taskEdit']>
    const q = (this.tkLp as { q: string }).q.toLowerCase()
    const ls = c.webLinks ?? []
    const used = (id: string): number => tFlat(c.tasks).filter((x) => x.id !== e.id && (x.links ?? []).includes(id)).length
    const body = linkBuckets(ls.filter((l) => !q || (l.text + ' ' + l.type).toLowerCase().includes(q)), this.typeGroups).map((g) => '<div class="lp-g">' + esc(g.name) + '</div>' + g.items.map(({ l }) => { const n = used(l.id as string); return '<label class="lp-i"><input type="checkbox" data-tk-lpk="' + esc(l.id as string) + '"' + (e.links.includes(l.id as string) ? ' checked' : '') + '><span class="txt"><span class="nm">' + esc(l.text) + '</span><span class="sub">' + (l.type ? esc(l.type) : '无类型') + (n ? ' · 另有 ' + n + ' 个任务绑定' : '') + '</span></span></label>' }).join('')).join('')
      || '<p class="lp-empty">' + (ls.length ? '没有匹配的链接' : '这张卡片还没有相关链接，先在「相关链接」里添加') + '</p>'
    const fresh = !!this.tkLp?.fresh; if (this.tkLp) this.tkLp.fresh = false
    return '<div class="lpop' + (fresh ? ' fresh' : '') + '" id="dpmTkLp" role="dialog" aria-label="选择要绑定的相关链接">' + (ls.length > 5 ? '<div class="lp-h"><label class="sr-only" for="dpmTkLpQ">搜索链接</label><input class="fld" id="dpmTkLpQ" placeholder="搜索本卡片的相关链接" autocomplete="off" value="' + esc(q) + '"></div>' : '') + '<div class="lp-l">' + body + '</div><div class="lp-f"><span class="meta">只能选这张卡片已添加的链接；同一条链接可以绑到多个任务</span><span class="grow"></span><button type="button" class="btn primary sm" data-tk-lpdone>完成</button></div></div>'
  }
  private tkRefItems(c: Card): Array<{ l: WebLink; n: number }> {
    const e = this.taskEdit as NonNullable<BoardView['taskEdit']>
    const q = (this.tkRm as { q: string }).q.toLowerCase()
    const m = (l: WebLink): boolean => !q || l.text.toLowerCase().includes(q)
    const bound = e.links.map((id, i) => ({ l: this.linkOf(c, id) as WebLink, n: i + 1 })).filter((x) => x.l && m(x.l))
    return bound.concat((c.webLinks ?? []).filter((l) => !e.links.includes(l.id as string) && m(l)).map((l) => ({ l, n: 0 })))
  }
  private tkRefMenuHtml(c: Card): string {
    const rm = this.tkRm as { q: string; from: number; i: number }
    const it = this.tkRefItems(c)
    rm.i = Math.min(rm.i, Math.max(0, it.length - 1))
    const nb = it.filter((x) => x.n).length
    return '<div class="refm" id="dpmTkRm" role="listbox" aria-label="引用链接">' + (it.length ? it.map((x, k) => (k === 0 && x.n ? '<div class="rm-g">已绑定到这个任务</div>' : '') + (k === nb && !x.n ? '<div class="rm-g">本卡片的其他链接 · 选中后自动绑定</div>' : '')
      + '<div class="rm-i' + (k === rm.i ? ' on' : '') + '" role="option" aria-selected="' + (k === rm.i) + '" data-tk-pref="' + esc(x.l.id as string) + '"><b>' + (x.n || '+') + '</b><span class="nm">' + esc(x.l.text) + '</span><span class="ty">' + esc(x.l.type || '无类型') + '</span></div>').join('') : '<p class="lp-empty">没有匹配的链接</p>')
      + '<div class="rm-f"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 插入 · <kbd>Esc</kbd> 关闭</div></div>'
  }
  /** v99：分区头图标按钮（26×26；文字只在 aria-label / title 里）。 */
  private hbtn(icon: string, title: string, attrs = ''): string {
    return '<button type="button" class="hbtn" title="' + esc(title) + '" aria-label="' + esc(title) + '"' + (attrs ? ' ' + attrs : '') + '>' + ic(icon) + '</button>'
  }

  /** v99：任务列表最下面那一行内联输入（只填标题就能存；右侧「编辑详情」开完整弹窗；回车连续加）。 */
  private tkNewRowHtml(): string {
    const v = this.tkNew?.v ?? ''
    return '<li class="ptnew' + (this.tkNew?.fresh ? ' in' : '') + '" id="dpmTkNewRow">'
      + '<label class="sr-only" for="dpmTkNewIn">新任务标题</label>'
      + '<input class="pin" id="dpmTkNewIn" placeholder="任务标题，回车保存" autocomplete="off" spellcheck="false" maxlength="120" value="' + esc(v) + '">'
      + '<button type="button" class="pib detail" data-tk-newdlg title="编辑详情：打开「添加卡片任务」窗口" aria-label="编辑详情，打开完整的添加卡片任务窗口">' + ic('listpen') + '</button>'
      + swHtml() + '<span class="psep" aria-hidden="true"></span>'
      + '<button type="button" class="pib main" data-tk-newsave title="保存这个任务（回车）" aria-label="保存这个任务"' + (v.trim() ? '' : ' disabled') + '>' + ic('check') + '</button>'
      + '<button type="button" class="pib" data-tk-newclose title="收起输入行（Esc）" aria-label="收起输入行">' + ic('x') + '</button>'
      + '</li>'
  }
  private tkNewOpen(c: Card): void {
    if (this.tkNew && this.tkNew.card === c.id) { (this.root.querySelector('#dpmTkNewIn') as HTMLInputElement | null)?.focus(); return }
    this.tkNew = { card: c.id, v: '', fresh: true }
    this.lastDetail = ''; this.renderDetail(); this.tkNew && (this.tkNew.fresh = false)
    const i = this.root.querySelector('#dpmTkNewIn') as HTMLInputElement | null
    i?.focus({ preventScroll: true })
  }
  private tkNewClose(focusBack = false): void {
    const a = this.tkNew; if (!a) return
    this.tkNew = null; this.lastDetail = ''; this.renderDetail()
    if (focusBack && this.kbd) (this.root.querySelector('.detail [data-tk-new]') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private tkNewSave(c: Card): void {
    const a = this.tkNew; if (!a) return
    const inp = this.root.querySelector('#dpmTkNewIn') as HTMLInputElement | null
    const v = (inp?.value ?? a.v).replace(/\s+/g, ' ').trim()
    if (!v) { inp?.focus(); return }
    const next = tClone(c.tasks)
    const x: Task = { id: newTaskId(), text: v, done: false }
    next.push(x)
    a.v = ''
    if (inp) inp.value = ''
    this.tasksCommit(c, next, undefined, x.id)
    this.schedNew(c.id, taskKeys(c.id, x, false))
    const i2 = this.root.querySelector('#dpmTkNewIn') as HTMLInputElement | null
    i2?.focus({ preventScroll: true })
    const b = this.root.querySelector('[data-tk-newsave]') as HTMLButtonElement | null
    if (b) b.disabled = true
  }

  private tasksSecHtml(c: Card, ro = false): string {
    const lf = tLeaves(c.tasks)
    const done = lf.filter((t) => t.done).length
    const total = lf.length
    const left = total - done
    const prog = total ? '<span class="prog" title="按最底层任务计" aria-label="完成 ' + done + ' / ' + total + '（按最底层任务计）"><span class="pbar"><i style="width:' + (done / total * 100) + '%"></i></span>' + done + '/' + total + '</span>' : ''
    const sync = ro ? '' : '<span class="tsync' + (this.tkSlow ? ' on' : '') + '" id="dpmTSync" role="status">' + (this.tkSlow ? '<i aria-hidden="true"></i>保存中' : '') + '</span>'
    const adding = !ro && this.taskEdit?.card === c.id && this.taskEdit.id === ''
    const newRow = !ro && this.tkNew && this.tkNew.card === c.id ? this.tkNewRowHtml() : ''
    /* v113（2.5）：已完成列表在上 → 「已完成任务 N」胶囊在它下面（未完成上面） */
    const dn = c.tasks.filter((t) => t.done)
    const un = c.tasks.filter((t) => !t.done)
    const tiles = (dn.length ? '<li class="tilebody' + (this.tkDoneOpen ? ' open' : '') + '" data-tk-donebody="1"><ul class="tilebody-in">' + dn.map((t) => this.taskTileHtml(c, t, ro)).join('') + '</ul></li>' : '')
      + (dn.length ? this.doneFoldHtml('task', '', dn.length, this.tkDoneOpen) : '')
      + un.map((t) => this.taskTileHtml(c, t, ro)).join('')
      + (adding ? '<li class="tile editing-tile">' + this.taskEditorHtml(c, null, 0) + '</li>' : '') + newRow
    const brief = this.tkDetail !== c.id
    const dhint = total ? '<p class="tk-dhint">' + ic('grip') + '<span>拖动排序</span><span class="sep">·</span><span>把<b>任务</b>拖到另一个任务上 = 变成它的<b>子任务</b></span><span class="sep">·</span><span><b>子任务</b>拖到任务之间的插入线 = 恢复为<b>独立任务</b></span><span class="sep">·</span><span>已完成 / 未完成两个区不能互拖</span></p>' : ''
    const ul = tiles ? dhint + '<ul class="tasks' + (brief ? ' brief' : '') + '" id="dpmTasks">' + tiles + '</ul>' : ''
    // v99：分区头按钮只留图标（展开详情 / 管理类型 / 添加任务）；添加任务挪进标题栏，点了在列表最下面开一行内联输入
    const types = ro ? '' : this.hbtn('sliders', '管理类型：任务的类型与分组', 'data-types="task"')
    const newBtn = ro ? '' : this.hbtn('plus', '添加任务（在任务列表最下面开一行，只填标题就能存）', 'data-tk-new="' + esc(c.id) + '" aria-controls="dpmTkNewRow"')
    const tail = ro && !c.tasks.length ? '<p class="meta">没有任务。</p>'
      : '<p class="tk-hint">已完成 ' + done + ' / 全部 ' + total + (left ? '；还有 ' + left + ' 个未完成，所以这张卡片现在不能归档。' : '；任务都完成了，可以归档。') + ' 勾选框只改完成状态；' + (this.dp ? '点任务 / 子任务标题 = 在详情左边弹出详细信息气泡窗（卡片上不再展开详情）；第二行右侧 = 关联会话 / 会话状态 / 以此任务创建会话；' : '点标题开合这条任务自己的详情（说明 / 链接 / 文件）；') + '标题下面一行「子任务 x/y」按钮 = 开合子任务列表；已完成的任务 / 子任务默认收起，可用胶囊展开；拖动调整顺序（只在同组内），键盘 Alt+↑↓ 排序、Alt+→ 变成上一项的子任务、Alt+← 移回顶层。拖动抓手 = 排序；把任务拖到另一个任务上 = 变成它的子任务；子任务拖到任务之间的插入线 = 恢复为独立任务。</p>'
    return '<section class="sec" id="dpmTaskSec"><h3><span class="ttl">' + ic('check') + '任务</span>' + sync + prog + '<span class="hb">' + types + newBtn + '</span></h3>' + ul + tail + '</section>'
  }
  /**
   * 0.24 相关说明（原型 v41 / v42）：一条 = 小标题 + 内容。还没有说明时直接是一张编辑卡，小标题默认「卡片项目说明」（固定在最上面，图钉）；
   * 之后「添加说明」新增的小标题为空、必须自己填。其余条目悬停出现把手可拖动排序（落点不越过第一条），编辑 / 删除（可撤销）。
   */
  private noteEditorHtml(k: number, it: { t: string; v: string; err: string; on?: boolean }, canCancel: boolean): string {
    return '<div class="nk editing" data-nk="' + k + '"' + (k >= 0 ? ' data-di' : '') + '><label class="sr-only" for="dpmNkT">小标题</label><input class="fld nk-k" id="dpmNkT" value="' + esc(it.t) + '" maxlength="60" placeholder="小标题" autocomplete="off"' + (it.err === 't' ? ' aria-invalid="true" aria-describedby="dpmNkE"' : '') + '>'
      + '<label class="sr-only" for="dpmNkV">内容</label><textarea class="fld nk-v" id="dpmNkV" placeholder="写下和这个项目相关的说明：背景、约定、网址链接……不限字数"' + (it.err === 'v' ? ' aria-invalid="true" aria-describedby="dpmNkE"' : '') + '>' + esc(it.v) + '</textarea>'
      + (it.err ? '<p class="nk-err" id="dpmNkE">' + (it.err === 't' ? '请写小标题' : '请写内容') + '</p>' : '')
      + injCard('dpmNkInj', it.on !== false)
      + '<div class="nk-bar">' + (k >= 0 ? '<button type="button" class="btn ghost sm danger" data-nk-del="' + k + '" aria-label="删除这条说明">' + ic('trash') + '删除这条</button>' : '') + '<span class="grow"></span><span class="meta" title="⌘Enter 保存 · Esc 放弃">⌘Enter 保存</span>' + (canCancel ? '<button type="button" class="btn sm" data-nk-cancel>取消</button>' : '') + '<button type="button" class="btn primary sm" data-nk-save>保存</button></div></div>'
  }
  private notesHtml(c: Card, ro = false): string {
    const items = c.noteItems ?? []
    const ed = !ro && this.noteEdit && this.noteEdit.card === c.id ? this.noteEdit : null
    const rows = items.map((x, k) => {
      if (ed && ed.k === k) return this.noteEditorHtml(k, ed, true)
      const open = this.noteOpen.has(c.id + ':' + k)
      const lead = ro ? '' : x.pin ? '<span class="npin" title="固定在最上面" aria-hidden="true">' + ic('pin') + '</span>' : '<button type="button" class="ngrip" data-nk-grip aria-label="拖动调整「' + esc(x.t) + '」的位置（键盘 Alt+上下方向键）">' + ic('grip') + '</button>'
      // v87：每条说明一个注入开关（默认开）。关 = 系统提示 / STATE / 引用菜单 / 行内「引」四条路径全排除，看板仍可见可编辑
      const off = !!x.off
      const sw = ro ? '' : '<button type="button" class="nksw" role="switch" aria-checked="' + (!off) + '" data-nk-sw="' + k + '" aria-label="「' + esc(x.t) + '」注入到 AI 会话" title="打开：这条说明会注入 AI 会话（系统提示 / 落盘项目的卡片档案）；关闭：只停止自动注入，引用 / 看板 / 编辑照常"></button>'
      const tag = '<span class="tag off nkoff' + (off ? '' : ' hide') + '">不注入</span>'
      // v90：「引」和编辑 / 删除一起，整行悬停（或键盘焦点进入）才淡入 —— 与只读卡片（只有「引」）同一套规则，触屏常显
      const acts = '<span class="nk-acts">' + qbtn(noteText(x.t, x.v), x.t)
        + (ro ? '' : '<button type="button" class="ib sm" data-nk-edit="' + k + '" aria-label="编辑说明「' + esc(x.t) + '」">' + ic('pencil') + '</button><button type="button" class="ib sm del" data-nk-del="' + k + '" aria-label="删除说明「' + esc(x.t) + '」">' + ic('trash') + '</button>') + '</span>'
      return '<div class="nk' + (off ? ' off' : '') + '" data-nk="' + k + '" data-di><div class="nk-h">' + lead + sw + '<span class="nk-t"' + (this.dp ? ' role="button" tabindex="0" data-nk-open="' + k + '" title="在详情左边弹出这条说明的全文"' : '') + '>' + esc(x.t) + '</span>' + tag + acts + '</div>'
        + '<div class="nk-b' + (open ? ' open' : '') + '" id="dpmNkb-' + k + '">' + linkify(x.v) + '</div><button type="button" class="btn ghost sm nk-more" data-nk-more="' + k + '" aria-expanded="' + open + '" aria-controls="dpmNkb-' + k + '" hidden>' + (open ? '收起' : '展开全部') + ic('chev') + '</button></div>'
    }).join('')
    let body = items.length ? '<div class="nk-list" data-dlist="notes" data-min="' + (items[0]?.pin ? 1 : 0) + '">' + rows + '</div>' : ''
    // 0.25 说明可以删光：空时显示占位，不再自动弹编辑卡；固定条被删后，新加的一条默认「卡片项目说明」并排最前
    if (ed && ed.k === -1) body = ed.pinNew ? this.noteEditorHtml(-1, ed, true) + body : body + this.noteEditorHtml(-1, ed, true)
    else if (!ro && !items.length) body = '<p class="nk-none">还没有说明。点右上角「添加说明」，第一条默认叫「' + NOTE_PIN + '」，固定在最上面；新加的说明默认自动注入 Agent 会话，不想注入就关掉条目前的开关。</p>'
    if (ro && !items.length) body = '<p class="meta">没有填写说明。</p>'
    // v89：新加的说明默认不注入 —— 分区底部把口径写清楚（只影响自动注入，引用 / 看板 / 编辑照常）
    if (!ro) body += '<p class="nk-hint">开关只影响 <b>自动注入 Agent 会话</b>（系统提示 / 落盘项目的卡片档案）；新加的说明默认开。引用「引」、引用菜单、看板和编辑都不受影响。</p>'
    const add = !ro && !(ed && ed.k === -1) ? '<button type="button" class="hbtn nk-add" data-nk-add aria-label="添加说明" title="添加说明（默认自动注入 Agent 会话）">' + ic('plus') + '</button>' : ''
    return '<section class="sec" id="dpmNoteSec"><h3>' + ic('note') + '相关说明' + (items.length ? ' · ' + items.length : '') + '<span class="grow"></span>' + add + '</h3>' + body + '</section>'
  }
  /** 保存编辑中的说明；quiet = 切到别处时顺手保存（不完整就不保存、不提示）。返回是否离开了编辑态。 */
  private nkSaving = false
  private async noteSave(quiet = false): Promise<boolean> {
    if (this.nkSaving) return false
    this.nkSaving = true
    try { return await this.noteSaveRun(quiet) } finally { this.nkSaving = false }
  }
  private async noteSaveRun(quiet: boolean): Promise<boolean> {
    const e = this.noteEdit; const c = e ? this.card(e.card) : undefined
    if (!e || !c) { this.noteEdit = null; return true }
    const t = e.t.replace(/\s+/g, ' ').trim(), v = e.v.replace(/\s+$/, '')
    if (!t || !v.trim()) { if (quiet) return false; e.err = !t ? 't' : 'v'; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector(!t ? '#dpmNkT' : '#dpmNkV') as HTMLElement | null)?.focus(); return false }
    const items = (c.noteItems ?? []).map((x) => ({ ...x }))
    // v137：新加的说明默认自动注入（推翻 v89 的默认关）；编辑卡里的开关决定最终状态；已存在的说明不迁移
    const on = e.on !== false
    const offP = on ? {} : { off: true as const }
    if (e.k < 0 && e.pinNew) items.unshift({ t, v, pin: true, ...offP })
    else if (e.k < 0) items.push({ t, v, ...offP })
    else { const o = { ...items[e.k], t, v }; if (on) delete o.off; else o.off = true; items[e.k] = o }
    const k = e.k < 0 ? (e.pinNew ? 0 : items.length - 1) : e.k
    const okMsg = '说明已保存 · ' + (on ? '自动注入 Agent 会话' : '不注入 Agent 会话')
    this.noteEdit = null
    // 焦点还在编辑框时 renderDetail 会跳过重画（保护空状态编辑卡），保存前先移开
    const ae = document.activeElement as HTMLElement | null; if (ae && (ae.id === 'dpmNkT' || ae.id === 'dpmNkV')) ae.blur()
    if (!(await this.act('card/noteitems', { id: c.id, items }, quiet ? undefined : okMsg))) { this.noteEdit = e; this.lastDetail = ''; this.renderDetail(); return false }
    this.landEl('.detail .nk[data-nk="' + k + '"]')
    return true
  }
  private noteCancel(): void {
    const e = this.noteEdit; const c = e ? this.card(e.card) : undefined
    this.noteEdit = null; this.lastDetail = ''; this.renderDetail()
    if (!e || !c) return
    const o = e.k >= 0 ? (c.noteItems ?? [])[e.k] : { t: '', v: '' }
    if (this.kbd && e.k >= 0) (this.root.querySelector('.detail [data-nk-edit="' + e.k + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
    if (o && (e.t !== o.t || e.v !== o.v)) this.host.toast('已放弃修改', 'ok', { label: '撤销', run: () => { this.noteEdit = { ...e, err: '' }; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('#dpmNkV') as HTMLElement | null)?.focus() } })
  }
  private async noteDelete(c: Card, k: number): Promise<void> {
    const items = (c.noteItems ?? []).slice()
    const [x] = items.splice(k, 1)
    if (!x) return
    if (this.noteEdit && this.noteEdit.card === c.id && this.noteEdit.k === k) this.noteEdit = null
    this.noteOpen.clear()
    if (!(await this.act('card/noteitems', { id: c.id, items }))) return
    this.host.toast('已删除说明「' + x.t + '」', 'ok', { label: '撤销', run: () => { const cc = this.card(c.id); if (!cc) return; const now = (cc.noteItems ?? []).map((y) => ({ ...y })); if (x.pin && now[0]) delete now[0].pin; now.splice(Math.min(k, now.length), 0, x); void this.act('card/noteitems', { id: c.id, items: now }, '已恢复「' + x.t + '」') } })
  }
  // ── 0.24 关联卡片（单向；选择面板就地展开；点卡片 = 打开它的详情，标题上方「‹ 返回」） ──
  private rp: { card: string; q: string; sel: Set<string>; off?: boolean } | null = null
  /** v136：仓库行内编辑（名字 + 注入开关）。 */
  private rEdit: { card: string; i: number; v: string; on: boolean } | null = null
  private rmCard: string | null = null
  private back: { from: string; to: string; scroll: number } | null = null
  private relatedHtml(c: Card, ro: boolean): string {
    const rel = (c.related ?? []).map((id) => this.card(id)).filter((x): x is Card => !!x)
    const sub = (x: Card): string => { const g = this.grp(x.g); const n = this.ownMem(x).length; return (g?.name ?? '') + ' · ' + (g ? this.st(g, x.col)?.name ?? '' : '') + (x.archivedAt ? ' · 已归档' : '') + ' · ' + (n ? n + ' 个落盘项目' : '没有落盘项目') }
    const relOff = new Set(c.relOff ?? [])
    const rows = rel.map((x) => '<div class="rc' + (x.archivedAt ? ' arch' : '') + (relOff.has(x.id) ? ' ioff' : '') + '" data-rc="' + esc(x.id) + '" data-di>' + (ro ? '' : '<button type="button" class="rgrip" data-rc-grip aria-label="拖动调整「' + esc(x.t) + '」的位置（键盘 Alt+上下方向键）">' + ic('grip') + '</button>')
      + iswHtml('rel', x.id, x.t, relOff.has(x.id), ro)
      + '<button type="button" class="rc-a" data-rc-open="' + esc(x.id) + '" title="打开「' + esc(x.t) + '」的详情"><span class="ci">' + ic('note') + '</span><span class="txt"><span class="nm">' + esc(x.t) + ioffTag(relOff.has(x.id)) + '</span><span class="sub">' + esc(sub(x)) + '</span></span></button>'
      + qbtn(cardText(x.t, this.grp(x.g)?.name ?? ''), x.t)
      + (ro ? '' : '<button type="button" class="ib sm" data-rc-del="' + esc(x.id) + '" aria-label="取消关联「' + esc(x.t) + '」">' + ic('x') + '</button>') + '</div>').join('')
    let picker = ''
    const rp = !ro && this.rp && this.rp.card === c.id ? this.rp : null
    if (rp) {
      const q = rp.q.toLowerCase()
      const pool = this.cards.filter((x) => x.id !== c.id && !(c.related ?? []).includes(x.id) && (!q || (x.t + ' ' + (this.grp(x.g)?.name ?? '')).toLowerCase().includes(q)))
      const list = this.groups.map((g) => {
        const cs = pool.filter((x) => x.g === g.id).sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt))
        if (!cs.length) return ''
        return '<div role="group" aria-label="' + esc(g.name) + '"><div class="rp-g">' + esc(g.name) + '<span class="tag">· ' + cs.length + '</span></div>' + cs.map((x) => { const n = this.ownMem(x).length; return '<label class="rk' + (x.archivedAt ? ' arch' : '') + '"><input type="checkbox" data-rk="' + esc(x.id) + '"' + (rp.sel.has(x.id) ? ' checked' : '') + '><span class="txt"><span class="nm">' + esc(x.t) + '</span><span class="sub">' + esc(this.st(g, x.col)?.name ?? '') + (n ? ' · ' + n + ' 个落盘项目' : '') + '</span></span>' + (x.archivedAt ? '<span class="chip plain">已归档</span>' : '') + '</label>' }).join('') + '</div>'
      }).join('') || '<p class="rp-empty">' + (q ? '没有匹配的卡片' : '没有可以关联的卡片了') + '</p>'
      picker = '<div class="rp" id="dpmRp" role="region" aria-label="选择要关联的卡片"><div class="rp-h"><label class="sr-only" for="dpmRpQ">搜索卡片</label><input class="fld" id="dpmRpQ" placeholder="搜索卡片名或卡片组" autocomplete="off" value="' + esc(rp.q) + '"></div><div class="rp-l">' + list + '</div>'
        + injCard('dpmRpInj', rp.off === false)
        + '<div class="rp-f"><span class="meta">活跃和已归档的卡片都可以选 · 新关联的默认不注入</span><span class="grow"></span><button type="button" class="btn sm" data-rp-cancel>取消</button><button type="button" class="btn primary sm" data-rp-ok' + (rp.sel.size ? '' : ' disabled') + '>' + (rp.sel.size ? '关联 ' + rp.sel.size + ' 张' : '关联') + '</button></div></div>'
    }
    const empty = !rel.length && !rp ? '<p class="meta">' + (ro ? '没有关联卡片。' : '还没有关联卡片。关联后，会话会知道这些卡片和本卡片有关，并拿到它们的记忆文件夹路径（不读内容，需要时 Agent 自己读）。') + '</p>' : ''
    return '<section class="sec" id="dpmRelSec"><h3>' + ic('cards') + '关联卡片 · ' + rel.length + '<span class="grow"></span>' + (ro || rp ? '' : '<button type="button" class="btn ghost sm" data-rc-add aria-controls="dpmRp">' + ic('plus') + '关联</button>') + '</h3>'
      + (rel.length && !ro ? '<p class="meta mb">点卡片打开它的详情。会话只拿到它们的记忆文件夹路径，需要时自己读；关联只对本卡片生效。</p>' : '') + (rel.length ? '<div class="rc-list" data-dlist="rel">' + rows + '</div>' : '') + empty + picker + '</section>'
  }
  /** v136：行内开关 —— 链接 / 仓库 = 整表保存（带 off），文件 = card/files-off，关联卡片 = card/related 带 off。 */
  private async injToggle(c: Card, v: string): Promise<void> {
    const i = v.indexOf(':'), kind = v.slice(0, i), id = v.slice(i + 1)
    let ok = false, name = '', on = false
    if (kind === 'link') {
      const ls = (c.webLinks ?? []).map((l) => ({ ...l })); const l = ls[Number(id)]; if (!l) return
      on = !!l.off; if (on) delete l.off; else l.off = true; name = l.text
      ok = await this.act('card/weblinks', { id: c.id, links: ls })
    } else if (kind === 'file') {
      const f = (c.files ?? []).find((x) => x.id === id); if (!f) return
      on = !!f.off; name = fileName(f)
      ok = await this.act('card/files-off', { id: c.id, file: f.id, on })
    } else if (kind === 'repo') {
      const rs = (c.repos ?? []).map((r) => ({ ...r })); const r = rs[Number(id)]; if (!r) return
      on = !!r.off; if (on) delete r.off; else r.off = true; name = r.name
      ok = await this.act('card/repos', { id: c.id, repos: rs })
    } else if (kind === 'rel') {
      const po = new Set(c.relOff ?? []); on = po.has(id); if (on) po.delete(id); else po.add(id); name = this.card(id)?.t ?? id
      ok = await this.act('card/related', { id: c.id, cards: (c.related ?? []).map((x) => ({ id: x, off: po.has(x) })) })
    } else return
    if (!ok) return
    const K: Record<string, string> = { link: '链接', file: '文件', repo: '仓库', rel: '关联卡片' }
    this.host.toast(K[kind] + '「' + name + '」' + (on ? '已打开自动注入：会话的卡片档案里会出现这一项' : '已关闭自动注入：会话的卡片档案里不再出现；引用 / 打开 / 编辑照常'))
    ;(this.root.querySelector('.detail [data-dpm-isw="' + CSS.escape(v) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private async rSave(): Promise<void> {
    const e = this.rEdit; const c = e ? this.card(e.card) : undefined
    this.rEdit = null
    if (!e || !c) { this.lastDetail = ''; this.renderDetail(); return }
    const rs = (c.repos ?? []).map((r) => ({ ...r })); const r = rs[e.i]
    const v = e.v.replace(/\s+/g, ' ').trim()
    if (!r || !v) { this.lastDetail = ''; this.renderDetail(); if (!v) this.host.toast('仓库名字不能为空', 'err'); return }
    r.name = v; if (e.on) delete r.off; else r.off = true
    if (!(await this.act('card/repos', { id: c.id, repos: rs }, '已保存仓库「' + v + '」· ' + (e.on ? '自动注入 Agent 会话' : '不注入 Agent 会话')))) { this.lastDetail = ''; this.renderDetail() }
  }
  /** v136：分区最底部一行「注入 Agent 会话：说明 a/b · 链接 · 文件 · 仓库 · 关联卡片」；有关掉的那一格变灰。 */
  private injSumHtml(c: Card): string {
    const ro = new Set(c.relOff ?? [])
    const rel = (c.related ?? []).filter((id) => !!this.card(id))
    const seg = (n: string, on: number, all: number): string => '<span class="dpm-isum-i' + (on < all ? ' part' : '') + '"><b>' + n + '</b>' + on + '/' + all + '</span>'
    const cnt = <T extends { off?: boolean }>(l: T[]): number => l.filter((x) => !x.off).length
    return '<div class="dpm-isum" aria-label="会话里自动注入的卡片资料"><span class="dpm-isum-k">注入 Agent 会话</span>'
      + seg('说明', cnt(c.noteItems ?? []), (c.noteItems ?? []).length) + seg('链接', cnt(c.webLinks ?? []), (c.webLinks ?? []).length)
      + seg('文件', cnt(c.files ?? []), (c.files ?? []).length) + seg('仓库', cnt(c.repos ?? []), (c.repos ?? []).length)
      + seg('关联卡片', rel.filter((id) => !ro.has(id)).length, rel.length) + '</div>'
  }
  private openRelated(id: string): void {
    const from = this.sel; const x = this.card(id)
    if (!from || !x) return
    if (this.taskEdit) this.taskEditSave(true)
    this.back = { from, to: id, scroll: (this.root.querySelector('.detail .d-b') as HTMLElement | null)?.scrollTop ?? 0 }
    if (x.archivedAt) this.tray.add(x.g)
    this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null
    this.sel = id
    this.render()
    const el = this.root.querySelector('.board-wrap [data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (el) { el.classList.remove('dpm-flash'); void el.offsetWidth; el.classList.add('dpm-flash'); setTimeout(() => el.classList.remove('dpm-flash'), 1400) }
    // 鼠标点开时重画会把焦点丢到 body（面板收不到 Esc），把焦点放到详情本身（无焦点框）
    ;(this.root.querySelector(this.kbd ? '.detail [data-back]' : '.detail') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private goBack(): void {
    const b = this.back; if (!b) return
    this.back = null
    this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null
    this.sel = b.from
    this.render()
    const db = this.root.querySelector('.detail .d-b') as HTMLElement | null
    if (db) db.scrollTop = b.scroll
    this.landEl('.detail .rc[data-rc="' + CSS.escape(b.to) + '"]')
    ;(this.root.querySelector(this.kbd ? '.detail [data-rc-open="' + CSS.escape(b.to) + '"]' : '.detail') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  /** 0.24 通用列表排序（相关说明 / 关联卡片）：from = 原位置，to = 插到第 to 项之前（按原列表算）。 */
  private async listMove(kind: string, from: number, to: number): Promise<void> {
    const c = this.sel ? this.card(this.sel) : undefined
    if (!c || to === from || to === from + 1) return
    const j = to > from ? to - 1 : to
    if (kind === 'notes') {
      const items = (c.noteItems ?? []).map((x) => ({ ...x }))
      const [x] = items.splice(from, 1); items.splice(j, 0, x)
      if (await this.act('card/noteitems', { id: c.id, items })) this.landEl('.detail .nk[data-nk="' + j + '"]')
    } else {
      const ids = (c.related ?? []).slice()
      const [x] = ids.splice(from, 1); ids.splice(j, 0, x)
      if (await this.act('card/related', { id: c.id, cards: ids })) this.landEl('.detail .rc[data-rc="' + CSS.escape(x) + '"]')
    }
  }
  private nd: { box: HTMLElement; k: number; y0: number; on: boolean; to: number; ghost: HTMLElement | null; line: HTMLElement | null } | null = null
  private ndDown(e: PointerEvent): boolean {
    const h = (e.target as HTMLElement).closest?.('[data-nk-grip], [data-rc-grip]') as HTMLElement | null
    if (!h || e.button !== 0 || this.noteEdit) return false
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    const box = h.closest('[data-dlist]') as HTMLElement
    const items = Array.from(box.children).filter((n) => (n as HTMLElement).dataset.di !== undefined)
    this.nd = { box, k: items.indexOf(h.closest('[data-di]') as Element), y0: e.clientY, on: false, to: -1, ghost: null, line: null }
    return true
  }
  private ndMove(e: PointerEvent): void {
    const d = this.nd; if (!d) return
    const items = Array.from(d.box.children).filter((n) => (n as HTMLElement).dataset.di !== undefined) as HTMLElement[]
    if (!d.on) {
      if (Math.abs(e.clientY - d.y0) < 4) return
      d.on = true
      this.root.classList.add('wdragging')
      items[d.k]?.classList.add('lifting')
      d.ghost = document.createElement('div'); d.ghost.className = 'tk-ghost'; d.ghost.textContent = items[d.k]?.querySelector('.nk-t, .nm')?.textContent ?? ''; this.root.appendChild(d.ghost)
      d.line = document.createElement('div'); d.line.className = 'tdrop'; d.line.hidden = true; d.box.appendChild(d.line)
    }
    ;(d.ghost as HTMLElement).style.left = (e.clientX + 14) + 'px'; (d.ghost as HTMLElement).style.top = (e.clientY - 14) + 'px'
    let at = items.length
    for (let i = 0; i < items.length; i++) { const r = items[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { at = i; break } }
    at = Math.max(at, Number(d.box.dataset.min || 0))
    const line = d.line as HTMLElement
    if (at === d.k || at === d.k + 1) { d.to = -1; line.hidden = true; return }
    d.to = at
    const br = d.box.getBoundingClientRect()
    const y = at < items.length ? items[at].getBoundingClientRect().top - 3 : items[items.length - 1].getBoundingClientRect().bottom + 3
    line.style.top = (y - br.top) + 'px'; line.hidden = false
  }
  private ndStop(commit: boolean): boolean {
    const d = this.nd; if (!d) return false
    this.nd = null
    this.root.classList.remove('wdragging')
    d.ghost?.remove(); d.line?.remove()
    d.box.querySelectorAll('.lifting').forEach((n) => n.classList.remove('lifting'))
    if (commit && d.on && d.to >= 0) void this.listMove(d.box.dataset.dlist as string, d.k, d.to)
    return true
  }
  private landEl(sel: string): void { const n = this.root.querySelector(sel) as HTMLElement | null; if (n) { n.classList.add('landed'); setTimeout(() => n.classList.remove('landed'), 450) } }

  /** 0.10 相关链接：完整列表（不折叠）；一行 = 拖动手柄 + 显示文字（点开 = 默认浏览器）+ 类型（无类型不显示）+ 悬停展开的复制 / 编辑 / 删除（0.21）。 */
  private webLinksHtml(c: Card, ro = false): string {
    const ls = c.webLinks ?? []
    // 0.24 按类型组分组（管理类型里的组顺序；不在组里的 =「其他类型」，没选类型的 =「无类型」，排最后）；拖动只在组内
    const row = (l: WebLink, k: number, gn: string): string => '<div class="wl' + (l.off ? ' ioff' : '') + (l.star ? ' dpm-gold' : '') + '" data-wl="' + k + '" data-wlid="' + esc(l.id ?? '') + '">'
      + (ro ? '' : '<button type="button" class="wgrip" data-wdrag="' + k + '" aria-label="在「' + esc(gn) + '」组内拖动「' + esc(l.text) + '」（键盘 Alt+上下方向键）">' + ic('grip') + '</button>')
      + iswHtml('link', String(k), l.text, !!l.off, ro)
      + (ro ? (l.star ? '<span class="dpm-sb on" aria-label="星标链接">' + STAR_SVG + '</span>' : '') : '<button type="button" class="dpm-sb" data-wl-star="' + k + '" aria-pressed="' + !!l.star + '" aria-label="' + (l.star ? '去掉星标「' : '加星标「') + esc(l.text) + '」" title="' + (l.star ? '去掉星标（排到本组星标后面）' : '加星标：金色 + 在本组置顶') + '">' + STAR_SVG + '</button>')
      + '<a class="wl-a' + (ro ? ' ro' : '') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(l.text) + ' · ' + esc(l.url) + '"><span class="t">' + esc(l.text) + '</span></a>'
      + ioffTag(!!l.off)
      + (l.type ? '<span class="tywrap"><span class="chip plain' + (l.tag ? ' dpm-ttag' : '') + '" title="' + esc(l.type + (l.tag ? '-' + l.tag : '')) + '">' + esc(l.type + (l.tag ? '-' + l.tag : '')) + '</span></span>' : '')
      + '<span class="acts' + (ro ? ' two' : '') + '">' + qbtn(linkText(l), l.text) + /* v139（2）：「复制」= 只复制完整链接；引用文字由同一行的「引」负责 */ '<button type="button" class="ib sm cp tipbtn" data-copy-url="' + esc(l.url) + '" aria-label="复制完整链接 ' + esc(l.url) + '">' + COPY_SVG + CHECK_SVG + '<span class="tip" aria-hidden="true">复制完整链接</span></button>'
      + (ro ? '' : '<button type="button" class="ib sm tipbtn" data-wl-edit="' + k + '" aria-label="编辑 ' + esc(l.text) + '">' + ic('pencil') + '<span class="tip" aria-hidden="true">编辑</span></button>'
        + '<button type="button" class="ib sm del tipbtn" data-wl-del="' + k + '" aria-label="删除 ' + esc(l.text) + '">' + ic('trash') + '<span class="tip" aria-hidden="true">删除</span></button>')
      + '</span></div>'
    const body = ls.length ? linkTypeBuckets(ls, this.typeGroups, this.linkTypes).map((g) => { const ns = g.items.filter((x) => x.l.star).length; return '<div class="wl-grp" role="group" aria-label="' + esc(g.name) + '" data-wlg="' + esc(g.type) + '"><div class="wl-gh">' + esc(g.name) + '<span class="c">' + g.items.length + '</span>' + (ns ? '<b class="dpm-gs" title="' + ns + ' 条星标链接">' + STAR_SVG + ns + '</b>' : '') + '</div><div class="wl-list">' + g.items.map(({ l, i }) => row(l, i, g.name)).join('') + '</div></div>' }).join('')
      : '<p class="meta">' + (ro ? '没有相关链接。' : '还没有相关链接。点「添加链接」可以一次加多条。') + '</p>'
    const nStar = ls.filter((l) => l.star).length
    return '<section class="sec"><h3>' + ic('link') + '相关链接 · ' + ls.length + (nStar ? '<span class="dpm-hs" title="' + nStar + ' 条星标链接">' + STAR_SVG + nStar + '</span>' : '') + '<span class="grow"></span>' + (ro ? '' : '<span class="h3-acts">' + this.hbtn('sliders', '管理类型：链接的类型与分组', 'data-types="link"') + this.hbtn('plus', '新增链接', 'data-wl-add') + '</span>') + '</h3>' + body + '</section>'
  }
  private get linkTypes(): string[] { return this.snap?.board.linkTypes ?? ['文档', '代码'] }
  private get typeGroups(): TypeGroup[] { return this.snap?.board.linkTypeGroups ?? [] }
  /** 「未归类」的类型（不在任何类型组里，按 linkTypes 顺序）。 */
  private get looseTypes(): string[] { const g = new Set(this.typeGroups.flatMap((x) => x.types)); return this.linkTypes.filter((t) => !g.has(t)) }
  /* v145（2.1）：空白行默认 = 无类型（以前是类型列表第一个，从会话输入框添加 / 拆分多行 / 预填网址这几条路径不走 input 事件，类型就停在第一个） */
  private blankRow(type?: string): WlRow { return { text: '', type: type ?? '', url: '', err: '' } }
  private get typeTags(): Record<string, string[]> { return this.snap?.board.linkTypeTags ?? {} }
  private get typeDomains(): Record<string, string[]> { return this.snap?.board.linkTypeDomains ?? {} }
  /** v140（3）：完整链接按域名（含子域名，最长）匹配类型网址。 */
  private typeForUrl(url: string): { type: string; domain: string } | null { let h = ''; try { h = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim()).hostname.toLowerCase() } catch { return null } let best: { type: string; domain: string; n: number } | null = null; for (const [t, ds] of Object.entries(this.typeDomains)) for (const d of ds) { let dh = ''; try { dh = new URL(d).hostname.toLowerCase() } catch { continue } if ((h === dh || h.endsWith('.' + dh)) && (!best || dh.length > best.n)) best = { type: t, domain: d, n: dh.length } } return best ? { type: best.type, domain: best.domain } : null }
  private wlTagCtl(r: WlRow, i: number): string { const list = r.type ? this.typeTags[r.type] ?? [] : []; const cur = r.tag && list.includes(r.tag) ? r.tag : ''; return '<select class="fld" id="dpmWg' + i + '" data-wtag="' + i + '"' + (list.length ? '' : ' disabled') + '><option value="">' + (r.type ? (list.length ? '无标签' : '这个类型还没有标签') : '先选类型') + '</option>' + list.map((x) => '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' }
  /** 自动选类型：手动改过不覆盖；返回提示文案 html。 */
  private wlAuto(r: WlRow): string { const m = this.typeForUrl(r.url); if (!m) { r.auto = ''; return '' } if (r.manual && r.type !== m.type) return ic('info') + '这个网址属于「' + esc(m.type) + '」（' + esc(m.domain) + '），你手动选了别的类型，保留你的选择'; if (r.type !== m.type) { r.type = m.type; r.tag = ''; r.auto = 'flash' } return ic('info') + '已按网址自动选择类型「' + esc(m.type) + '」（匹配 ' + esc(m.domain) + '）' }
  private wlOpen(c: Card, mode: 'add' | 'edit', idx = -1): void {
    const l = mode === 'edit' ? (c.webLinks ?? [])[idx] : undefined
    if (mode === 'edit' && !l) return
    this.wl = { card: c.id, mode, idx, rows: [l ? { ...l, err: '', manual: true } : this.blankRow()], off: mode === 'edit' ? !!l?.off : false }
    this.$('#dpmWlT').textContent = mode === 'edit' ? '编辑链接' : '添加相关链接'
    this.$('#dpmWlP').textContent = mode === 'edit' ? '改完点保存。' : '可以一次加多条；在「完整链接」里粘贴多行网址会自动拆成多条。'
    this.$('#dpmWlMore').hidden = mode === 'edit'
    this.wlRender()
    const d = this.$<HTMLDialogElement>('#dpmDlgWl')
    d.returnValue = ''
    if (!d.open) d.showModal()
    ;(this.root.querySelector('#dpmWlRows [data-wurl]') as HTMLElement | null)?.focus()
  }
  /** 类型下拉：只能选已有类型（新增 / 改名统一走「管理类型」）；0.21 按类型组分段，第一项「无类型」。 */
  private wlTypeCtl(r: WlRow, i: number): string {
    const o = (t: string): string => '<option value="' + esc(t) + '"' + (t === r.type ? ' selected' : '') + '>' + esc(t) + '</option>'
    const seg = (label: string, ts: string[]): string => ts.length ? '<optgroup label="' + esc(label) + '">' + ts.map(o).join('') + '</optgroup>' : ''
    const gone = r.type && !this.linkTypes.includes(r.type) ? o(r.type) : ''
    return '<select class="fld" id="dpmWt' + i + '" data-wtype="' + i + '"><option value=""' + (r.type ? '' : ' selected') + '>无类型（不显示标签）</option>' + gone
      + this.typeGroups.map((g) => seg(g.name, g.types)).join('') + seg('未归类', this.looseTypes) + '</select>'
  }
  private wlRender(): void {
    const w = this.wl
    if (!w) return
    const rows = w.rows
    /* v145（2.1）：任何写入网址的路径（输入 / 粘贴 / 预填 / 拆分多行 / 编辑打开）都先跑一次自动选类型，再画 —— 提示文案和下拉框读同一个值 */
    const autoH = rows.map((r) => this.wlAuto(r))
    this.$('#dpmWlRows').innerHTML = rows.map((r, i) => '<div class="wl-row">'
      + (rows.length > 1 ? '<div class="wl-row-h">第 ' + (i + 1) + ' 条<span class="grow"></span><button type="button" class="ib sm" data-wl-rm="' + i + '" aria-label="移除第 ' + (i + 1) + ' 条">' + ic('x') + '</button></div>' : '')
      + '<div class="wl-grid"><div><label class="lbl" for="dpmWx' + i + '">显示文字</label><input class="fld" id="dpmWx' + i + '" data-wtext="' + i + '" value="' + esc(r.text) + '" placeholder="不填就用网址" maxlength="120" autocomplete="off"></div>'
      + '<div class="dpm-wty"><div><label class="lbl" for="dpmWt' + i + '">类型</label>' + this.wlTypeCtl(r, i) + '</div><div><label class="lbl" for="dpmWg' + i + '">类型标签</label>' + this.wlTagCtl(r, i) + '</div></div>'
      + '<div class="full"><label class="lbl" for="dpmWu' + i + '">完整链接</label><input class="fld' + (r.err ? ' bad' : '') + '" id="dpmWu' + i + '" data-wurl="' + i + '" value="' + esc(r.url) + '" placeholder="https://…" autocomplete="off" inputmode="url"' + (r.err ? ' aria-invalid="true" aria-describedby="dpmWe' + i + '"' : '') + '>'
      + (r.err ? '<p class="wl-err" id="dpmWe' + i + '">' + esc(r.err) + '</p>' : '') + '<p class="dpm-wah" id="dpmWa' + i + '" aria-live="polite"' + (autoH[i] ? '' : ' hidden') + '>' + autoH[i] + '</p><div class="wl-dup-slot" id="dpmWd' + i + '" aria-live="polite"></div></div>'
      + '<div class="full"><button type="button" class="dpm-ds" data-wstar="' + i + '" aria-pressed="' + !!r.star + '" title="星标 = 这张卡片的重要链接（详情里显示成金色并在类型分组里置顶）">' + STAR_SVG + '<span>' + (r.star ? '已加星标' : '加星标') + '</span><small>重要链接</small></button></div></div></div>').join('')
    this.$('#dpmWlCount').textContent = w.mode === 'add' && rows.length > 1 ? '共 ' + rows.length + ' 条，空行不保存' : ''
    this.$('#dpmWlInjSlot').innerHTML = injCard('dpmWlInj', !w.off)
    this.wlDupAll()
    this.wlOkText()
  }
  /**
   * 0.14 重复链接：和这张卡片已有的链接（编辑时不跟自己比）或本次前面的行是同一个 → 不能保存。
   * 返回 { at: 已有链接序号 | -1, row: 本次的第几行 | -1 }；不重复 → null。
   */
  private wlDupOf(i: number): { at: number; row: number } | null {
    const w = this.wl
    const c = w ? this.card(w.card) : undefined
    const r = w?.rows[i]
    if (!w || !c || !r) return null
    const v = checkUrl(r.url)
    if (!v.url) return null
    const k = urlKey(v.url)
    const at = (c.webLinks ?? []).findIndex((l, j) => !(w.mode === 'edit' && j === w.idx) && urlKey(l.url) === k)
    if (at >= 0) return { at, row: -1 }
    const row = w.rows.slice(0, i).findIndex((o) => { const x = checkUrl(o.url); return !!x.url && urlKey(x.url) === k })
    return row >= 0 ? { at: -1, row } : null
  }
  private wlDupAll(): void {
    const w = this.wl
    const c = w ? this.card(w.card) : undefined
    if (!w || !c) return
    w.rows.forEach((_, i) => {
      const slot = this.root.querySelector('#dpmWd' + i) as HTMLElement | null
      const inp = this.root.querySelector('#dpmWu' + i) as HTMLInputElement | null
      if (!slot || !inp) return
      const d = this.wlDupOf(i)
      const l = d && d.at >= 0 ? (c.webLinks ?? [])[d.at] : undefined
      slot.innerHTML = !d ? '' : l
        ? '<div class="wl-dup" role="alert"><p class="h">这张卡片已经添加过这个链接了，不能重复保存</p><dl><dt>显示文字</dt><dd>' + esc(l.text) + '</dd><dt>类型</dt><dd>' + esc(l.type || '无类型') + '</dd><dt>完整链接</dt><dd>' + esc(l.url) + '</dd></dl>'
          + '<div class="a"><button type="button" class="btn sm" data-wl-dup-edit="' + d.at + '">' + ic('pencil') + '直接编辑这条已添加的链接</button><button type="button" class="btn ghost sm" data-wl-dup-back="' + i + '">改成别的链接</button></div></div>'
        : '<p class="wl-err" role="alert">和第 ' + (d.row + 1) + ' 条是同一个链接，删掉一条再保存</p>'
      const bad = !!d || !!w.rows[i].err
      inp.classList.toggle('bad', bad)
      if (bad) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid')
    })
    const dup = w.rows.some((_, i) => !!this.wlDupOf(i))
    this.$<HTMLButtonElement>('#dpmWlOk').disabled = dup
  }
  private wlOkText(): void { const w = this.wl; if (!w) return; const n = w.rows.filter((r) => r.url.trim()).length; this.$('#dpmWlOk').textContent = w.mode === 'add' && n > 1 ? '保存 ' + n + ' 条' : '保存' }
  /**
   * 「管理类型」（0.13 起；0.21 类型组）：顶部固定「无类型」，中间类型组，最后固定「未归类」。
   * 类型 / 组都能改名、删除、拖动（类型可拖进任意组的任意位置）；有链接 / 类型受影响时行内二次确认。保存即全局生效。
   */
  private wlMq = new WeakMap<HTMLElement, number>()
  /** kind（0.24）= 'link' 相关链接类型（带类型组）/ 'task' 子任务类型（不分组，同一套交互）。 */
  private ty: { kind: 'link' | 'task'; edit: TyKey | null; confirm: TyKey | null; adding: string | null; err: string; gErr: string; sub?: { t: string; k: 'd' | 't' } | null; opener?: HTMLElement | null } | null = null
  private get tyTask(): boolean { return this.ty?.kind === 'task' }
  private typeUse(t: string): number { let n = 0; if (this.tyTask) { for (const c of this.cards) for (const x of tFlat(c.tasks)) if ((x.type ?? '') === t) n++ } else for (const c of this.cards) for (const l of c.webLinks ?? []) if (l.type === t) n++; return n }
  private get tyUnit(): string { return this.tyTask ? '个任务' : '条链接' }
  private tyTypes(gid: string): string[] { if (this.tyTask) return this.taskTypes(); return gid === LOOSE ? this.looseTypes : this.typeGroups.find((g) => g.id === gid)?.types ?? [] }
  private tyGroupOf(t: string): string { return this.tyTask ? LOOSE : this.typeGroups.find((g) => g.types.includes(t))?.id ?? LOOSE }
  private tyGroupName(gid: string): string { return gid === LOOSE ? '未归类' : this.typeGroups.find((g) => g.id === gid)?.name ?? '' }
  private typesOpen(kind: 'link' | 'task' = 'link'): void {
    this.ty = { kind, edit: null, confirm: null, adding: kind === 'task' ? null : null, err: '', gErr: '', sub: null, opener: document.activeElement as HTMLElement | null }
    // 0.24 两个窗口标题写清楚管的是谁
    this.$('#dpmTyT').textContent = kind === 'task' ? '任务类型管理' : '相关链接类型管理'
    this.$('#dpmTyP').textContent = kind === 'task'
      ? '所有卡片的「任务」共用这些类型，和相关链接的类型分开管理。按住左侧把手拖动调整顺序，添加 / 编辑任务时的类型下拉按这个顺序显示。改名后，用这个类型的任务会一起改过来。'
      : '类型可以放进类型组（详情「相关链接」按这里的顺序分组显示）；每个类型可以配多个网址（新增链接时完整链接在这些网址下 = 自动选这个类型；同一个网址只能属于一个类型）和标签（链接显示成「类型名-标签」）。按住抓手拖动 = 调整顺序 / 换组。'
    this.$('#dpmTyAddG').hidden = kind === 'task'
    this.typesRender()
    const d = this.$<HTMLDialogElement>('#dpmDlgTy')
    d.returnValue = ''
    d.showModal()
    ;(this.root.querySelector(kind === 'task' ? '[data-tg-plus]' : '#dpmTgNew') as HTMLElement | null)?.focus()
  }
  private tyRow(t: string, gid: string): string {
    const y = this.ty as NonNullable<BoardView['ty']>
    const n = this.typeUse(t)
    const unit = this.tyUnit
    const same = (k: TyKey | null): boolean => !!k && k.kind === 't' && k.key === t
    if (same(y.edit)) return '<li class="ty-row editing"><span class="ty-sp"></span><label class="sr-only" for="dpmTyEd">类型名称</label><input class="fld' + (y.err ? ' bad' : '') + '" id="dpmTyEd" value="' + esc(t) + '" maxlength="20" autocomplete="off"' + (y.err ? ' aria-invalid="true" aria-describedby="dpmTyEdE"' : '') + '>'
      + '<button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm primary" data-ty-save>保存</button></li>' + (y.err ? '<li class="wl-err" id="dpmTyEdE">' + esc(y.err) + '</li>' : '')
    if (same(y.confirm)) return '<li class="ty-confirm" role="group" aria-label="确认删除类型"><span class="q">删除「<b>' + esc(t) + '</b>」？' + n + ' ' + unit + '会改成无类型</span><button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm danger" data-ty-confirm>删除</button></li>'
    return '<li class="ty-row" data-ty="' + esc(t) + '" data-tg="' + esc(gid) + '"><button type="button" class="ib sm ty-grip" data-tygrip aria-label="拖动「' + esc(t) + '」到任意类型组：按住拖动，或 Alt+上下方向键">' + ic('grip') + '</button>'
      + '<span class="nm">' + esc(t) + '</span><span class="use">' + (n ? n + ' ' + unit + '在用' : '没有' + (this.tyTask ? '任务' : '链接') + '在用') + '</span>'
      + '<button type="button" class="ib sm" data-ty-edit aria-label="改名 ' + esc(t) + '">' + ic('pencil') + '</button>'
      + '<button type="button" class="ib sm del" data-ty-del aria-label="删除 ' + esc(t) + '">' + ic('trash') + '</button>' + (this.tyTask ? '' : this.tyMeta(t)) + '</li>'
  }
  /** v141（4.1–4.3）/ v142（2.2）：每个链接类型一张卡下面「网址」「标签」两行胶囊 + 「+ 网址」「+ 标签」。 */
  private tyMeta(t: string): string {
    const y = this.ty as NonNullable<BoardView['ty']>
    const line = (k: 'd' | 't'): string => {
      const list = k === 'd' ? this.typeDomains[t] ?? [] : this.typeTags[t] ?? []
      const chips = list.map((v) => '<span class="dpm-tc ' + (k === 'd' ? 'dom' : 'tag') + '" title="' + esc(k === 'd' ? v + '（完整链接在这个网址下 = 自动选「' + t + '」）' : '链接显示成「' + t + '-' + v + '」') + '"><span>' + esc(k === 'd' ? v.replace(/^https?:\/\//, '').replace(/\/$/, '') : v) + '</span><button type="button" data-ty-rm="' + k + '" data-v="' + esc(v) + '" aria-label="删除' + (k === 'd' ? '网址 ' : '标签 ') + esc(v) + '">' + ic('x') + '</button></span>').join('')
      const ed = y.sub && y.sub.t === t && y.sub.k === k
      const add = ed ? '<span class="dpm-tsub"><input class="fld" id="dpmTySub" data-ty-sub="' + k + '" placeholder="' + (k === 'd' ? '例：https://code.example.com/login' : '例：dev 分支') + '" aria-label="' + (k === 'd' ? '新网址' : '新标签') + '" spellcheck="false" autocomplete="off" maxlength="' + (k === 'd' ? 200 : 20) + '"><button type="button" class="btn sm primary" data-ty-subok>添加</button><button type="button" class="btn sm" data-ty-subx>取消</button><em id="dpmTySubE" aria-live="polite"></em></span>'
        : '<button type="button" class="dpm-tadd" data-ty-subadd="' + k + '">+ ' + (k === 'd' ? '网址' : '标签') + '</button>'
      return '<span class="k">' + (k === 'd' ? ic('link') + '网址' : ic('pin') + '标签') + '</span><div class="dpm-tcs">' + chips + add + '</div>'
    }
    return '<div class="dpm-tmeta">' + line('d') + line('t') + '</div>'
  }
  /** 输入网址时实时提示：将保存为 / 已经属于 / 格式错误（同 host normDomain 口径）。 */
  private tyDomainHint(t: string, raw: string): { ok: boolean; html: string } {
    let v = raw.trim()
    if (!v) return { ok: false, html: '' }
    if (/\s/.test(v)) return { ok: false, html: '网址里不能有空格' }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'https://' + v
    let u: URL
    try { u = new URL(v) } catch { return { ok: false, html: '不是网址（例：https://www.baidu.com）' } }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, html: '只支持 http:// 或 https://' }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && u.hostname !== 'localhost') return { ok: false, html: '域名要带「.」（例：github.com）' }
    const d = u.origin.toLowerCase() + '/'
    const own = Object.entries(this.typeDomains).find(([, ds]) => ds.some((x) => { try { return new URL(x).hostname.toLowerCase() === u.hostname.toLowerCase() } catch { return false } }))?.[0] ?? ''
    if (own === t) return { ok: false, html: '「' + esc(t) + '」已经有 ' + esc(d) + ' 了' }
    if (own) return { ok: false, html: esc(d) + ' 已经属于「' + esc(own) + '」：一个网址只能配置到一个类型上' }
    return { ok: true, html: '将保存为 <b>' + esc(d) + '</b>' }
  }
  private async tySubCommit(): Promise<void> {
    const y = this.ty; const sub = y?.sub; if (!y || !sub) return
    const inp = this.root.querySelector('#dpmTySub') as HTMLInputElement | null; if (!inp) return
    const v = inp.value.trim()
    const em = this.root.querySelector('#dpmTySubE') as HTMLElement | null
    const fail = (m: string): void => { if (em) { em.className = 'err'; em.textContent = m } inp.setAttribute('aria-invalid', 'true'); inp.focus(); ;(window as unknown as Record<string, unknown>).__dpmTyErr = m }
    if (!v) return fail(sub.k === 'd' ? '先填网址' : '先填标签名')
    if (sub.k === 'd') { const h = this.tyDomainHint(sub.t, v); if (!h.ok) return fail(h.html.replace(/<[^>]+>/g, '')) }
    else { if (v.length > 20) return fail('标签最多 20 个字'); if ((this.typeTags[sub.t] ?? []).includes(v)) return fail('「' + sub.t + '」已经有这个标签了') }
    const r = await this.tyPost<string>(sub.k === 'd' ? 'linktype/domain-add' : 'linktype/tag-add', sub.k === 'd' ? { type: sub.t, domain: v } : { type: sub.t, tag: v })
    if (!r) return
    const t = sub.t, k = sub.k
    y.sub = null; this.typesRender()
    this.host.toast(k === 'd' ? '已给「' + t + '」添加网址 ' + r.v + '（只留域名）' : '已给「' + t + '」添加标签「' + r.v + '」：链接显示成「' + t + '-' + r.v + '」')
  }
  private tyBlock(gid: string): string {
    const y = this.ty as NonNullable<BoardView['ty']>
    const loose = gid === LOOSE
    // 0.24 子任务类型不分组：一个无标题的块，「+」在块底部
    if (this.tyTask) {
      const add = y.adding ? '<li class="ty-addrow"><label class="sr-only" for="dpmTyNew">新类型名称</label><input class="fld' + (y.err ? ' bad' : '') + '" id="dpmTyNew" placeholder="新类型名称，比如「测试」" maxlength="20" autocomplete="off"' + (y.err ? ' aria-invalid="true" aria-describedby="dpmTyNewE"' : '') + '><button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm primary" data-ty-add>添加</button></li>' + (y.err ? '<li class="wl-err" id="dpmTyNewE">' + esc(y.err) + '</li>' : '') : ''
      const ts = this.taskTypes()
      return '<li class="tg flat" data-tgid="' + LOOSE + '"><ul class="tg-b">' + (ts.map((t) => this.tyRow(t, LOOSE)).join('') || (y.adding ? '' : '<li class="tg-empty">还没有类型</li>')) + add + '</ul></li>' + (y.adding ? '' : '<li class="tg-addli" data-tgid="' + LOOSE + '"><button type="button" class="btn ghost sm tg-addb" data-tg-plus>' + ic('plus') + '添加类型</button></li>')
    }
    const nm = this.tyGroupName(gid)
    const ts = this.tyTypes(gid)
    const same = (k: TyKey | null): boolean => !!k && k.kind === 'g' && k.key === gid
    let h: string
    if (!loose && same(y.edit)) h = '<div class="tg-h"><span class="ty-sp"></span><label class="sr-only" for="dpmTyEd">类型组名称</label><input class="fld' + (y.err ? ' bad' : '') + '" id="dpmTyEd" value="' + esc(nm) + '" maxlength="20" autocomplete="off"' + (y.err ? ' aria-invalid="true" aria-describedby="dpmTyEdE"' : '') + '>'
      + '<button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm primary" data-ty-save>保存</button></div>' + (y.err ? '<p class="wl-err tg-err" id="dpmTyEdE">' + esc(y.err) + '</p>' : '')
    else if (!loose && same(y.confirm)) h = '<div class="tg-h"><div class="ty-confirm" role="group" aria-label="确认删除类型组"><span class="q">删除类型组「<b>' + esc(nm) + '</b>」？里面 ' + ts.length + ' 个类型移到「未归类」，链接不受影响</span><button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm danger" data-ty-confirm>删除</button></div></div>'
    else h = '<div class="tg-h">' + (loose ? '<span class="ty-sp"></span>' : '<button type="button" class="ib sm ty-grip" data-tggrip aria-label="拖动类型组「' + esc(nm) + '」调整顺序：按住拖动，或 Alt+上下方向键">' + ic('grip') + '</button>')
      + '<span class="nm">' + esc(nm) + '</span><span class="cnt">' + (loose ? '固定在最后 · ' : '') + ts.length + ' 个类型</span>'
      + '<button type="button" class="ib sm" data-tg-plus aria-label="在「' + esc(nm) + '」里添加类型">' + ic('plus') + '</button>'
      + (loose ? '<span class="ty-sp"></span><span class="ty-sp"></span>' : '<button type="button" class="ib sm" data-tg-edit aria-label="改名类型组 ' + esc(nm) + '">' + ic('pencil') + '</button><button type="button" class="ib sm del" data-tg-del aria-label="删除类型组 ' + esc(nm) + '">' + ic('trash') + '</button>')
      + '</div>'
    const add = y.adding === gid ? '<li class="ty-addrow"><label class="sr-only" for="dpmTyNew">新类型名称</label><input class="fld' + (y.err ? ' bad' : '') + '" id="dpmTyNew" placeholder="新类型名称，比如「设计稿」" maxlength="20" autocomplete="off"' + (y.err ? ' aria-invalid="true" aria-describedby="dpmTyNewE"' : '') + '><button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm primary" data-ty-add>添加</button></li>' + (y.err ? '<li class="wl-err" id="dpmTyNewE">' + esc(y.err) + '</li>' : '') : ''
    const body = ts.map((t) => this.tyRow(t, gid)).join('') + add
    return '<li class="tg' + (loose ? ' loose' : '') + '" data-tgid="' + esc(gid) + '">' + h + '<ul class="tg-b">' + (body || '<li class="tg-empty">' + (loose ? '没有未归类的类型' : '还没有类型 · 把类型拖到这里，或点「+」添加') + '</li>') + '</ul></li>'
  }
  private typesRender(focus?: string): void {
    const y = this.ty
    if (!y) return
    const keepNew = (this.root.querySelector('#dpmTyNew') as HTMLInputElement | null)?.value
    const keepEd = (this.root.querySelector('#dpmTyEd') as HTMLInputElement | null)?.value
    const none = this.typeUse('')
    const list = this.$('#dpmTyList')
    const box = list.closest('.dlg-b') as HTMLElement | null
    const top = box?.scrollTop ?? 0
    list.innerHTML = '<li class="ty-none"><span class="nm">无类型</span><span class="grow"></span><span>固定在最前 · ' + none + ' ' + this.tyUnit + '</span></li>'
      + (this.tyTask ? this.tyBlock(LOOSE) : this.typeGroups.map((g) => this.tyBlock(g.id)).join('') + this.tyBlock(LOOSE)) + '<li class="drop-line" id="dpmTyDrop" aria-hidden="true" hidden></li>'
    if (box) box.scrollTop = top
    this.$('#dpmTyN').textContent = '共 ' + (this.tyTask ? this.taskTypes().length : this.typeGroups.reduce((n, g) => n + this.tyTypes(g.id).length, 0) + this.tyTypes(LOOSE).length) + ' 个类型' + (this.tyTask ? '' : ' · ' + this.typeGroups.length + ' 个类型组') + ' · 改动立即生效'
    { const si = this.root.querySelector('#dpmTySub') as HTMLInputElement | null; if (si && document.activeElement !== si) setTimeout(() => si.focus(), 0) }
    // 校验失败重画时保留用户刚输入的内容；0.25 拖动 / 新增后重画也保留「添加类型」框里的草稿与焦点
    { const nw = this.root.querySelector('#dpmTyNew') as HTMLInputElement | null; if (nw && keepNew && !y.err) nw.value = keepNew }
    if (y.err) {
      const nw = this.root.querySelector('#dpmTyNew') as HTMLInputElement | null
      if (nw && keepNew !== undefined) nw.value = keepNew
      const ed = this.root.querySelector('#dpmTyEd') as HTMLInputElement | null
      if (ed && keepEd !== undefined) ed.value = keepEd
    }
    if (this.tyTask) { if (focus) { const f = this.root.querySelector(focus) as HTMLInputElement | null; f?.focus(); if (f && focus === '#dpmTyEd') f.select() } return }
    const gi = this.$<HTMLInputElement>('#dpmTgNew')
    gi.classList.toggle('bad', !!y.gErr)
    if (y.gErr) { gi.setAttribute('aria-invalid', 'true'); gi.setAttribute('aria-describedby', 'dpmTgNewE') } else { gi.removeAttribute('aria-invalid'); gi.removeAttribute('aria-describedby') }
    const e = this.$('#dpmTgNewE')
    e.textContent = y.gErr
    e.hidden = !y.gErr
    if (focus) { const f = this.root.querySelector(focus) as HTMLInputElement | null; f?.focus(); if (f && focus === '#dpmTyEd') f.select() }
  }
  /** 前端先查一遍（空 / 超长 / 重名 / 保留名），服务端同样校验。 */
  private typeErr(v: string, kind: 't' | 'g', skip?: string): string {
    const w = kind === 't' ? '类型' : '类型组'
    if (!v) return w + '名不能为空'
    if (v.length > 20) return w + '名不能超过 20 字'
    if (v === skip) return ''
    if (kind === 't') {
      if (v === '无类型') return '「无类型」是保留名'
      if (this.tyTask) return this.taskTypes().includes(v) ? '已经有类型「' + v + '」了' : ''
      if (this.linkTypes.includes(v)) return '已经有类型「' + v + '」了（在「' + this.tyGroupName(this.tyGroupOf(v)) + '」里）'
    } else if (v === '未归类' || this.typeGroups.some((g) => g.name === v)) return '已经有类型组「' + v + '」了'
    return ''
  }
  /** 类型弹窗里的写操作：成功后刷新看板；失败时编辑 / 新增中的放进行内错误，否则 toast 点名。 */
  /** 0.25 类型写操作串行（先显示后保存时，后一笔可能依赖前一笔，如新加的类型马上被拖动）。 */
  private tyChain: Promise<unknown> = Promise.resolve()
  private tyPend = 0
  private async tyPost<T>(action: string, body: Record<string, unknown>): Promise<{ v: T } | null> {
    try {
      const run = this.tyChain.then(() => post<Snapshot & { result: T }>(action, body))
      this.tyChain = run.catch(() => undefined)
      this.tyPend++
      const r = await run.finally(() => { this.tyPend-- })
      if (this.disposed) return null
      // 只用最后一笔的快照（中间的会把后面已先显示的改动刷回去）
      if (!this.tyPend) { this.snap = r; this.render() }
      return { v: r.result }
    } catch (e) {
      const m = e instanceof ApiError ? e.message : String(e)
      const y = this.ty
      if (y && (y.edit || y.adding)) { y.err = m; this.typesRender(y.edit ? '#dpmTyEd' : '#dpmTyNew') } else { this.host.toast(m, 'err'); await this.refresh(); if (this.ty) this.typesRender() }
      return null
    }
  }
  private tyLand(sel: string, focus?: string): void {
    const n = this.root.querySelector(sel) as HTMLElement | null
    if (n) { n.classList.add('landed'); setTimeout(() => n.classList.remove('landed'), 450) }
    if (focus) (this.root.querySelector(focus) as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private async typeAdd(): Promise<void> {
    const y = this.ty
    if (!y || !y.adding) return
    const gid = y.adding
    const v = (this.$<HTMLInputElement>('#dpmTyNew')?.value ?? '').replace(/\s+/g, ' ').trim()
    y.err = this.typeErr(v, 't')
    if (y.err) { this.typesRender('#dpmTyNew'); return }
    // 0.25 子任务类型先出现在列表末尾（马上能拖），保存在后台；失败由 tyPost 拉回服务器版本
    if (this.tyTask && this.snap) { this.$<HTMLInputElement>('#dpmTyNew').value = ''; this.snap.board.taskTypes = [...this.taskTypes(), v]; this.typesRender('#dpmTyNew'); this.tyLand('#dpmTyList [data-ty="' + CSS.escape(v) + '"]') }
    const r = await this.tyPost<string>(this.tyTask ? 'tasktype/add' : 'linktype/add', this.tyTask || gid === LOOSE ? { name: v } : { name: v, group: gid })
    if (!r) return
    y.err = ''
    if (!this.tyTask) { this.typesRender('#dpmTyNew'); this.tyLand('#dpmTyList [data-ty="' + CSS.escape(r.v) + '"]') }
    this.host.toast(this.tyTask ? '已新增任务类型「' + r.v + '」，所有卡片都能选' : '已在「' + this.tyGroupName(gid) + '」新增类型「' + r.v + '」，所有卡片都能选')
  }
  private async tySave(): Promise<void> {
    const y = this.ty
    const k = y?.edit
    if (!y || !k) return
    const v = (this.$<HTMLInputElement>('#dpmTyEd')?.value ?? '').replace(/\s+/g, ' ').trim()
    const from = k.kind === 't' ? k.key : this.tyGroupName(k.key)
    if (v === from) { y.edit = null; y.err = ''; this.typesRender(); return }
    y.err = this.typeErr(v, k.kind, from)
    if (y.err) { this.typesRender('#dpmTyEd'); return }
    if (k.kind === 't') {
      const r = await this.tyPost<{ name: string; links?: number; tasks?: number }>(this.tyTask ? 'tasktype/rename' : 'linktype/rename', { from, to: v })
      if (!r) return
      y.edit = null; y.err = ''
      if (this.taskEdit && this.taskEdit.ty === from) this.taskEdit.ty = r.v.name
      this.typesRender('#dpmTyList [data-ty="' + CSS.escape(r.v.name) + '"] [data-ty-edit]')
      const n = (r.v.links ?? r.v.tasks) ?? 0
      this.host.toast('「' + from + '」已改名为「' + r.v.name + '」' + (n ? '，' + n + ' ' + this.tyUnit + '一起更新' : ''))
    } else {
      const r = await this.tyPost<TypeGroup>('typegroup/rename', { id: k.key, to: v })
      if (!r) return
      y.edit = null; y.err = ''
      this.typesRender('[data-tgid="' + CSS.escape(k.key) + '"] [data-tg-edit]')
      this.host.toast('类型组「' + from + '」已改名为「' + r.v.name + '」')
    }
  }
  private async tyDelete(k: TyKey): Promise<void> {
    const y = this.ty
    if (!y) return
    y.confirm = null
    if (k.kind === 't') {
      const r = await this.tyPost<{ links?: number; tasks?: number }>(this.tyTask ? 'tasktype/delete' : 'linktype/delete', { name: k.key })
      if (!r) return
      if (this.taskEdit && this.taskEdit.ty === k.key) this.taskEdit.ty = ''
      this.typesRender()
      const n = (r.v.links ?? r.v.tasks) ?? 0
      this.host.toast('已删除类型「' + k.key + '」' + (n ? '，' + n + ' ' + this.tyUnit + '改成无类型' : ''))
    } else {
      const nm = this.tyGroupName(k.key)
      const r = await this.tyPost<{ types: number }>('typegroup/delete', { id: k.key })
      if (!r) return
      this.typesRender()
      this.host.toast('已删除类型组「' + nm + '」' + (r.v.types ? '，' + r.v.types + ' 个类型移到「未归类」' : ''))
    }
  }
  private async tgAdd(): Promise<void> {
    const y = this.ty
    if (!y) return
    const inp = this.$<HTMLInputElement>('#dpmTgNew')
    const v = inp.value.replace(/\s+/g, ' ').trim()
    y.gErr = this.typeErr(v, 'g')
    if (y.gErr) { this.typesRender('#dpmTgNew'); return }
    const r = await this.tyPost<TypeGroup>('typegroup/add', { name: v })
    if (!r) return
    inp.value = ''
    this.typesRender('#dpmTgNew')
    this.tyLand('[data-tgid="' + CSS.escape(r.v.id) + '"]')
    this.host.toast('已新增类型组「' + r.v.name + '」，把类型拖进去即可')
  }
  /** 类型放到 gid 组第 at 位（at 按去掉它之后算）。 */
  private async tyPlace(t: string, gid: string, at: number): Promise<void> {
    const from = this.tyGroupOf(t)
    if (this.tyTask && this.snap) { const ts = this.taskTypes().filter((x) => x !== t); ts.splice(Math.max(0, Math.min(at, ts.length)), 0, t); this.snap.board.taskTypes = ts; this.typesRender(); this.tyLand('#dpmTyList [data-ty="' + CSS.escape(t) + '"]') }
    if (!(await this.tyPost(this.tyTask ? 'tasktype/place' : 'linktype/place', this.tyTask ? { name: t, at } : { name: t, group: gid === LOOSE ? null : gid, at }))) return
    this.typesRender()
    this.tyLand('#dpmTyList [data-ty="' + CSS.escape(t) + '"]', '#dpmTyList [data-ty="' + CSS.escape(t) + '"] [data-tygrip]')
    if (from !== gid && !this.tyTask) this.host.toast('「' + t + '」已归到「' + this.tyGroupName(gid) + '」')
  }
  private async tgMove(id: string, to: number): Promise<void> {
    if (to < 0 || to >= this.typeGroups.length) return
    if (!(await this.tyPost('typegroup/move', { id, to }))) return
    this.typesRender()
    this.tyLand('[data-tgid="' + CSS.escape(id) + '"]', '[data-tgid="' + CSS.escape(id) + '"] [data-tggrip]')
  }
  /** Alt+↑↓：类型在组内挪一位，到组边界跨进相邻组（上组末尾 / 下组开头）；组之间挪一位。 */
  private async tyKeyMove(el: HTMLElement, up: boolean): Promise<void> {
    if (el.dataset.tygrip !== undefined) {
      const t = (el.closest('[data-ty]') as HTMLElement).dataset.ty as string
      const order = this.tyTask ? [LOOSE] : [...this.typeGroups.map((g) => g.id), LOOSE]
      const gid = this.tyGroupOf(t)
      const i = this.tyTypes(gid).indexOf(t)
      const n = this.tyTypes(gid).length
      if (up ? i > 0 : i < n - 1) return this.tyPlace(t, gid, i + (up ? -1 : 1))
      const g2 = order[order.indexOf(gid) + (up ? -1 : 1)]
      if (g2 === undefined) return
      return this.tyPlace(t, g2, up ? this.tyTypes(g2).length : 0)
    }
    const id = (el.closest('[data-tgid]') as HTMLElement).dataset.tgid as string
    return this.tgMove(id, this.typeGroups.findIndex((g) => g.id === id) + (up ? -1 : 1))
  }
  /** 拖动：类型 → 任意组任意位置（空组整块高亮）；类型组 → 组之间（「未归类」固定最后）。落点 = 独立指示线。 */
  private td: { kind: 't' | 'g'; key: string; y0: number; on: boolean; to: { gid: string; at: number } | null; ghost: HTMLElement | null; last: PointerEvent | null; raf: number } | null = null
  private tdDown(e: PointerEvent): boolean {
    const h = (e.target as HTMLElement).closest?.('[data-tygrip], [data-tggrip]') as HTMLElement | null
    // 0.25 「添加类型」输入框开着也能拖（之前开着就整列禁拖 → 新加的类型拖不动）；只有行内改名时不拖
    if (!h || e.button !== 0 || !this.ty || this.ty.edit) return false
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    const isT = h.dataset.tygrip !== undefined
    this.td = { kind: isT ? 't' : 'g', key: isT ? (h.closest('[data-ty]') as HTMLElement).dataset.ty as string : (h.closest('[data-tgid]') as HTMLElement).dataset.tgid as string, y0: e.clientY, on: false, to: null, ghost: null, last: null, raf: 0 }
    return true
  }
  private tdMove(e: PointerEvent): void {
    const td = this.td
    if (!td) return
    const list = this.$('#dpmTyList')
    if (!td.on) {
      if (Math.abs(e.clientY - td.y0) < 4) return
      td.on = true
      this.root.classList.add('wdragging')
      ;(td.kind === 't' ? list.querySelector('[data-ty="' + CSS.escape(td.key) + '"]') : list.querySelector('[data-tgid="' + CSS.escape(td.key) + '"]'))?.classList.add('lifting')
      td.ghost = document.createElement('div')
      td.ghost.className = 'ty-ghost'
      td.ghost.textContent = td.kind === 't' ? td.key : '类型组 · ' + this.tyGroupName(td.key)
      this.$('#dpmDlgTy').appendChild(td.ghost)
    }
    if (td.ghost) { td.ghost.style.left = (e.clientX + 14) + 'px'; td.ghost.style.top = (e.clientY - 14) + 'px' }
    // 指针停在列表上下边缘时持续滚动（按住不动也滚），滚动后按同一指针位置重算落点
    td.last = e
    const box = list.closest('.dlg-b') as HTMLElement | null
    if (box && !td.raf) {
      const br = box.getBoundingClientRect()
      const dy = e.clientY < br.top + 32 ? -10 : e.clientY > br.bottom - 32 ? 10 : 0
      if (dy) td.raf = requestAnimationFrame(() => { if (this.td !== td) return; td.raf = 0; const before = box.scrollTop; box.scrollTop += dy; if (box.scrollTop !== before && td.last) this.tdMove(td.last) })
    }
    const line = this.$('#dpmTyDrop')
    const lr = list.getBoundingClientRect()
    list.querySelectorAll('.tg.hot').forEach((n) => n.classList.remove('hot'))
    const at = (rows: HTMLElement[]): number => { for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) return k } return rows.length }
    const show = (y: number, inset: number): void => { line.style.top = (y - lr.top) + 'px'; line.style.left = inset + 'px'; line.style.right = inset + 'px'; line.hidden = false }
    if (td.kind === 't') {
      const blocks = Array.from(list.querySelectorAll<HTMLElement>('.tg'))
      if (!blocks.length) return
      const blk = blocks.find((b) => { const r = b.getBoundingClientRect(); return e.clientY >= r.top - 5 && e.clientY <= r.bottom + 5 }) ?? (e.clientY < blocks[0].getBoundingClientRect().top ? blocks[0] : blocks[blocks.length - 1])
      const gid = blk.dataset.tgid as string
      const rows = Array.from(blk.querySelectorAll<HTMLElement>('[data-ty]'))
      const k = at(rows)
      const from = this.tyGroupOf(td.key)
      const fi = this.tyTypes(from).indexOf(td.key)
      if (gid === from && (k === fi || k === fi + 1)) { td.to = null; line.hidden = true; return }
      td.to = { gid, at: gid === from && k > fi ? k - 1 : k }
      blk.classList.add('hot')
      if (!rows.length) { line.hidden = true; return }
      show(k < rows.length ? rows[k].getBoundingClientRect().top - 1 : rows[rows.length - 1].getBoundingClientRect().bottom + 1, 14)
    } else {
      const blocks = Array.from(list.querySelectorAll<HTMLElement>('.tg:not(.loose)'))
      const k = at(blocks)
      const fi = this.typeGroups.findIndex((g) => g.id === td.key)
      if (!blocks.length || k === fi || k === fi + 1) { td.to = null; line.hidden = true; return }
      td.to = { gid: '', at: k > fi ? k - 1 : k }
      show(k < blocks.length ? blocks[k].getBoundingClientRect().top - 5 : blocks[blocks.length - 1].getBoundingClientRect().bottom + 5, 4)
    }
  }
  private tdStop(commit: boolean): boolean {
    const td = this.td
    if (!td) return false
    this.td = null
    if (td.raf) cancelAnimationFrame(td.raf)
    this.root.classList.remove('wdragging')
    td.ghost?.remove()
    this.root.querySelectorAll('#dpmTyList .lifting, #dpmTyList .tg.hot').forEach((n) => n.classList.remove('lifting', 'hot'))
    const line = this.root.querySelector('#dpmTyDrop') as HTMLElement | null
    if (line) line.hidden = true
    if (commit && td.on && td.to) void (td.kind === 't' ? this.tyPlace(td.key, td.to.gid, td.to.at) : this.tgMove(td.key, td.to.at))
    return true
  }
  private async wlSave(): Promise<void> {
    const w = this.wl
    const c = w ? this.card(w.card) : undefined
    if (!w || !c) return
    const rows = w.rows.filter((r) => w.mode === 'edit' || r.text.trim() || r.url.trim())
    if (!rows.length) { this.$<HTMLDialogElement>('#dpmDlgWl').close(''); return }
    let bad = 0
    for (const r of rows) { const v = checkUrl(r.url); r.err = v.err ?? ''; if (v.err) bad++; else r.url = v.url as string }
    w.rows = rows
    if (bad) { this.wlRender(); (this.root.querySelector('#dpmWlRows .fld.bad') as HTMLElement | null)?.focus(); return }
    if (rows.some((_, i) => !!this.wlDupOf(i))) { this.wlRender(); (this.root.querySelector('#dpmWlRows .fld.bad') as HTMLElement | null)?.focus(); return }
    const items: WebLink[] = rows.map((r) => ({ id: r.id, text: r.text.trim(), type: r.type, url: r.url, ...(w.off ? { off: true } : {}), ...(r.tag && r.type && (this.typeTags[r.type] ?? []).includes(r.tag) ? { tag: r.tag } : {}) }))
    const starWant = rows.map((r) => !!r.star)
    const cur = (c.webLinks ?? []).slice()
    if (w.mode === 'edit') cur[w.idx] = items[0]
    else cur.push(...items)
    /* 星标先不写进整表（落位由 host 的 link-star 决定：本组星标最下面）；保存后逐条补 */
    const prevStar = w.mode === 'edit' ? !!(c.webLinks ?? [])[w.idx]?.star : false
    if (w.mode === 'edit' && prevStar) items[0] = { ...items[0], star: true }
    if (!(await this.act('card/weblinks', { id: c.id, links: cur }, w.mode === 'edit' ? '已保存链接' : '已添加 ' + items.length + ' 条相关链接'))) return
    { const now = this.card(c.id)?.webLinks ?? []; let n = 0; for (let i = 0; i < items.length; i++) { const want = starWant[i]; const was = w.mode === 'edit' ? prevStar : false; if (want === was) continue; const l = now.find((x) => urlKey(x.url) === urlKey(items[i].url)); if (l?.id) { await this.act('card/link-star', { id: c.id, link: l.id, on: want }); n++ } } if (n) this.host.toast('已保存 · ' + starWant.filter(Boolean).length + ' 条星标链接（金色、在类型分组里置顶）') }
    const cb = this.wlAddCb
    this.wlAddCb = null
    if (cb && w.mode === 'add') {
      const now = this.card(c.id)?.webLinks ?? []
      const oldKeys = new Set((c.webLinks ?? []).map((l) => urlKey(l.url)))
      cb(now.filter((l) => !oldKeys.has(urlKey(l.url))))
    }
    this.wl = null
    this.$<HTMLDialogElement>('#dpmDlgWl').close('ok')
  }
  private async wlMove(c: Card, i: number, j: number): Promise<void> {
    const ls = (c.webLinks ?? []).slice()
    if (j < 0 || j >= ls.length || i === j) return
    const [x] = ls.splice(i, 1)
    ls.splice(j, 0, x)
    if (!(await this.act('card/weblinks', { id: c.id, links: ls }, '已调整链接顺序'))) return
    const row = this.root.querySelector('.detail [data-wl="' + j + '"]') as HTMLElement | null
    if (row) { row.classList.add('landed'); setTimeout(() => row.classList.remove('landed'), 450) }
    ;(this.root.querySelector('.detail [data-wdrag="' + j + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private async wlDelete(c: Card, k: number): Promise<void> {
    const ls = (c.webLinks ?? []).slice()
    const [x] = ls.splice(k, 1)
    if (!x || !(await this.act('card/weblinks', { id: c.id, links: ls }))) return
    this.host.toast('已删除「' + x.text + '」', 'ok', { label: '撤销', run: () => { const now = (this.card(c.id)?.webLinks ?? []).slice(); now.splice(Math.min(k, now.length), 0, x); void this.act('card/weblinks', { id: c.id, links: now }, '已恢复「' + x.text + '」') } })
  }
  private wdDown(e: PointerEvent): boolean {
    const h = (e.target as HTMLElement).closest?.('[data-wdrag]') as HTMLElement | null
    if (!h || e.button !== 0) return false
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    this.wd = { i: Number(h.dataset.wdrag), y0: e.clientY, on: false, to: undefined }
    return true
  }
  private wdMove(e: PointerEvent): void {
    const wd = this.wd
    if (!wd) return
    if (!wd.on) {
      if (Math.abs(e.clientY - wd.y0) < 4) return
      wd.on = true
      this.root.classList.add('wdragging')
      this.root.querySelector('.detail [data-wl="' + wd.i + '"]')?.classList.add('lifting')
    }
    // 0.24 只在本类型组内排（落点线不跨组）；to = 全表下标
    const own = this.root.querySelector('.detail [data-wl="' + wd.i + '"]')?.closest('.wl-list') as HTMLElement | null
    const rows = Array.from((own ?? this.root).querySelectorAll<HTMLElement>('[data-wl]'))
    const idx = rows.map((r) => Number(r.dataset.wl))
    let k = rows.length
    for (let j = 0; j < rows.length; j++) { const r = rows[j].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { k = j; break } }
    this.root.querySelectorAll('.wins-before, .wins-after').forEach((n) => n.classList.remove('wins-before', 'wins-after'))
    const me = idx.indexOf(wd.i)
    const to = k < rows.length ? idx[k] : idx[idx.length - 1] + 1
    wd.to = k === me || k === me + 1 ? undefined : to
    if (wd.to !== undefined) (k < rows.length ? rows[k] : rows[rows.length - 1]).classList.add(k < rows.length ? 'wins-before' : 'wins-after')
  }
  private wdStop(commit: boolean): boolean {
    const wd = this.wd
    if (!wd) return false
    this.wd = null
    this.root.classList.remove('wdragging')
    this.root.querySelectorAll('.wl.lifting, .wins-before, .wins-after').forEach((n) => n.classList.remove('lifting', 'wins-before', 'wins-after'))
    const c = this.sel ? this.card(this.sel) : undefined
    if (commit && wd.on && wd.to !== undefined && c) void this.wlMove(c, wd.i, wd.to > wd.i ? wd.to - 1 : wd.to)
    return true
  }

  // ── 0.24 子任务：两级树 + 类型 + 绑定链接（都走 card/tasks 整表替换） ──
  /**
   * 0.23 子任务改动先在本地生效并重画（不等服务器），保存在后台串行排队；超过 0.6 秒没存好标题栏出「保存中」，
   * 失败就重新拉服务器版本（= 恢复原样）并提示「重试」。0.24：本地先算父任务联动、先盖时间，服务端回包为准。
   */
  private tkPend = 0
  private tkSlow = false
  private tkSlowT = 0
  private tkChain: Promise<unknown> = Promise.resolve()
  private tkFailed = false
  private tasksCommit(c: Card, next: Task[], okMsg?: string, land?: string): void {
    const live = this.card(c.id)
    if (!live) return
    const tasks = tStamp(live.tasks, tRollup(next))
    const before = this.taskTops()
    live.tasks = tasks
    this.render()
    this.taskFlip(before)
    if (land) this.taskLand(land)
    this.tkPend++
    if (!this.tkSlowT) this.tkSlowT = window.setTimeout(() => { this.tkSlow = true; this.syncTk() }, 600)
    const id = c.id
    this.tkChain = this.tkChain.then(() => post<Snapshot>('card/tasks', { id, tasks })).then((r) => {
      // 只有最后一笔回来才用服务器快照（中间的快照会把后面排队的本地改动刷掉）
      if (this.tkPend === 1 && !this.disposed) { this.snap = r; this.render() }
      if (okMsg) this.host.toast(okMsg)
    }, (e) => {
      this.host.toast('任务没保存上：' + (e instanceof ApiError ? e.message : String(e)) + '，已恢复原样', 'err', { label: '重试', run: () => { const cc = this.card(id); if (cc) this.tasksCommit(cc, tasks, okMsg, land) } })
      this.tkFailed = true
    }).finally(() => {
      if (--this.tkPend) return
      clearTimeout(this.tkSlowT); this.tkSlowT = 0
      if (this.tkSlow) { this.tkSlow = false; this.syncTk() }
      if (this.tkFailed) { this.tkFailed = false; void this.refresh() }
    })
  }
  private syncTk(): void {
    const el = this.root.querySelector('#dpmTSync') as HTMLElement | null
    if (!el) return
    el.classList.toggle('on', this.tkSlow)
    el.innerHTML = this.tkSlow ? '<i aria-hidden="true"></i>保存中' : ''
    this.lastDetail = ''
  }
  /** 拖动 / 换位后其他行滑到新位置（FLIP），按子任务 id 对应。 */
  private taskTops(): Map<string, number> {
    const m = new Map<string, number>()
    this.root.querySelectorAll<HTMLElement>('.detail #dpmTasks .task[data-tid]').forEach((r) => m.set(r.dataset.tid as string, (r.dataset.lv === '0' ? (r.closest('.tile') as HTMLElement) : r).getBoundingClientRect().top))
    return m
  }
  private taskFlip(before: Map<string, number>): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    this.root.querySelectorAll<HTMLElement>('.detail #dpmTasks .task[data-tid]').forEach((r) => {
      const el = r.dataset.lv === '0' ? (r.closest('.tile') as HTMLElement) : r
      const y = before.get(r.dataset.tid as string); if (y === undefined) return
      const dy = y - el.getBoundingClientRect().top; if (!dy || Math.abs(dy) > 600) return
      el.style.transform = 'translateY(' + dy + 'px)'
      requestAnimationFrame(() => { el.classList.add('flip'); el.style.transform = ''; setTimeout(() => el.classList.remove('flip'), 220) })
    })
  }
  private taskLand(id: string): void {
    const n = (this.root.querySelector('.detail [data-tile="' + CSS.escape(id) + '"]') ?? this.root.querySelector('.detail .task[data-tid="' + CSS.escape(id) + '"]')) as HTMLElement | null
    if (n) { n.classList.add('landed'); setTimeout(() => n.classList.remove('landed'), 450) }
  }
  /** 0.27（v53）：保存后焦点回到这一行本身（tabindex=-1、不画描边、操作按钮不因此浮出），行背景淡蓝闪一下；再按 Tab 从这一行继续。 */
  private quietFocus(sel: string, flash = true): void {
    const el = this.root.querySelector('.detail ' + sel) as HTMLElement | null
    if (!el) return
    el.tabIndex = -1
    if (flash) { el.classList.remove('saved'); void el.offsetWidth; el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 900) }
    el.focus({ preventScroll: true })
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true })
  }
  private focusTask(sel: string): void { (this.root.querySelector('.detail ' + sel) as HTMLElement | null)?.focus({ preventScroll: true }) }
  /** 打开编辑卡：id = 子任务 id；'' = 新增（title = 添加框里已输入的标题）。另一个编辑中的先保存。 */
  private taskEditOpen(c: Card, id: string, title = '', where: 'title' | 'note' = 'title'): void {
    if (this.taskEdit && !this.taskEditSave(true)) return
    this.tkAdd = null
    this.tkLp = null; this.tkRm = null; this.tkFp = false
    if (id) { const f = tFind(c.tasks, id); if (!f) return; this.taskEdit = { card: c.id, id, t: f.t.text, n: f.t.note ?? '', ty: f.t.type ?? '', links: (f.t.links ?? []).slice(), files: (f.t.files ?? []).slice(), err: '' } }
    else this.taskEdit = { card: c.id, id: '', t: title, n: '', ty: '', links: [], files: [], err: '' }
    this.lastDetail = ''
    this.renderDetail()
    const inp = this.root.querySelector(where === 'note' ? '#dpmTaskNote' : '#dpmTaskEd') as HTMLInputElement | null
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
  }
  private taskEditClose(focusBack = false): void {
    const e = this.taskEdit; this.taskEdit = null; this.tkLp = null; this.tkRm = null; this.tkFp = false
    this.lastDetail = ''
    this.renderDetail()
    if (!e) return
    if (!e.id) { const n = this.root.querySelector('#dpmNewTask') as HTMLInputElement | null; if (n) { n.value = e.t; n.focus({ preventScroll: true }) } return }
    if (focusBack && this.kbd) this.focusTask('[data-tk-edit="' + CSS.escape(e.id) + '"]')
  }
  /** 保存编辑卡；标题为空时留在编辑态并提示（quiet = 点别处触发：不弹「已保存」）。返回是否离开了编辑态。 */
  private taskEditSave(quiet = false): boolean {
    const e = this.taskEdit; const c = e ? this.card(e.card) : undefined
    if (!e || !c) { this.taskEdit = null; return true }
    const t = e.t.replace(/\s+/g, ' ').trim()
    const n = e.n.replace(/\s+$/, '')
    if (!t && !e.id && !n.trim() && !e.links.length && !e.files.length) { this.taskEditClose(); return true }
    if (!t) { e.err = '标题不能为空' + (e.id ? '；要删除请点右侧 ×' : ''); this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('#dpmTaskEd') as HTMLElement | null)?.focus(); return false }
    this.taskEdit = null; this.tkLp = null; this.tkRm = null; this.tkFp = false
    this.lastDetail = ''
    const next = tClone(c.tasks)
    if (!e.id) {
      const x: Task = { id: newTaskId(), text: t, done: false, ...(n ? { note: n } : {}), ...(e.ty ? { type: e.ty } : {}), ...(e.links.length ? { links: e.links } : {}), ...(e.files.length ? { files: e.files } : {}) }
      next.push(x)
      this.tasksCommit(c, next, undefined, x.id)
      ;(this.root.querySelector('#dpmNewTask') as HTMLElement | null)?.focus({ preventScroll: true })
      return true
    }
    const f = tFind(next, e.id)
    if (!f) { this.renderDetail(); return true }
    const o = f.t
    if (t === o.text && n === (o.note ?? '') && e.ty === (o.type ?? '') && e.links.join() === (o.links ?? []).join() && e.files.join() === (o.files ?? []).join()) { this.renderDetail(); if (!quiet) this.quietFocus('.task[data-tid="' + CSS.escape(e.id) + '"]', false); return true }
    o.text = t
    if (n) o.note = n; else delete o.note
    if (e.ty) o.type = e.ty; else delete o.type
    if (e.links.length) o.links = e.links; else delete o.links
    if (e.files.length) o.files = e.files; else delete o.files
    this.tasksCommit(c, next, quiet ? undefined : '任务已保存', e.id)
    if (!quiet) this.quietFocus('.task[data-tid="' + CSS.escape(e.id) + '"]')
    return true
  }
  /** 勾选：父任务 → 全部子任务一起；子任务 → 父任务按「全部完成」联动。 */
  private taskSetDone(c: Card, id: string, on: boolean): void {
    const next = tClone(c.tasks)
    const f = tFind(next, id); if (!f) return
    const flip = (f.t.subs ?? []).filter((s) => s.done !== on).length
    const prev = tClone(c.tasks)
    f.t.done = on
    for (const s of f.t.subs ?? []) s.done = on
    const was = f.p?.done
    /* v117（开工 2.3 / 反馈 1 4）：勾上 / 取消后，这一项必须落在「已完成」和「未完成」的分界线上 ——
       列表里已完成整组在未完成上面，所以「已完成组最后一条」就是分界线上沿、「未完成组第一条」就是下沿。
       做法：从原位置摘出来，插到「最后一条已完成的后面」（此时空出来的位置自然由后面的项前移补上）。
       之前只改了 done 标记、没动数组顺序，所以勾选一个夹在中间的项会停在已完成组中间（用户实测：A 勾上后跑到 D1 上面）。 */
    const sib = f.list
    const cur = sib.indexOf(f.t)
    if (cur >= 0) {
      sib.splice(cur, 1)
      /* 注意：数组里完成 / 未完成是混着的（完成由子任务滚出来的父任务会夹在中间），
         所以两个方向不能用同一个插入点：勾上 → 插到「最后一条已完成」后面（= 已完成组末位）；
         取消 → 插到「第一条未完成」前面（= 未完成组首位）。两边都贴着分界线。 */
      let idx = sib.length
      if (on) { let last = -1; for (let j = 0; j < sib.length; j++) if (sib[j].done) last = j; idx = last + 1 }
      else { for (let j = 0; j < sib.length; j++) if (!sib[j].done) { idx = j; break } }
      sib.splice(idx, 0, f.t)
    }
    tRollup(next)
    this.tasksCommit(c, next)
    if (on) this.recDone(c.id, f.p ? taskKeys(c.id, f.t, true) : [...taskKeys(c.id, f.t, false), ...(f.t.subs ?? []).map((x) => 's|' + c.id + '|' + x.id)], f.t.text)
    // 0.25 父任务一次改了多个子任务 → 提示可撤销（之前一点就全勾、撤不回）
    if (flip) this.host.toast((on ? '已勾上「' + f.t.text + '」剩下的 ' + flip + ' 个子任务' : '已取消勾选「' + f.t.text + '」的 ' + flip + ' 个子任务'), 'ok', { label: '撤销', run: () => { const cc = this.card(c.id); if (cc) this.tasksCommit(cc, prev) } })
    if (f.p && was !== f.p.done) { this.taskLand(f.p.id as string); this.host.toast(f.p.done ? '子任务都完成了，「' + f.p.text + '」已自动勾上' : '「' + f.p.text + '」改回未完成') }
  }
  private taskDelete(c: Card, id: string): void {
    const next = tClone(c.tasks)
    const f = tFind(next, id); if (!f) return
    const x = f.t, pid = f.p?.id, at = f.i
    f.list.splice(at, 1)
    this.tasksCommit(c, next)
    const label = x.text.length > 14 ? x.text.slice(0, 14) + '…' : x.text
    this.host.toast('已删除任务「' + label + '」' + (x.subs?.length ? '及 ' + x.subs.length + ' 个子任务' : ''), 'ok', { label: '撤销', run: () => {
      const cc = this.card(c.id); if (!cc) return
      const now = tClone(cc.tasks)
      const list = pid ? (tFind(now, pid)?.t.subs ?? (() => { const p = tFind(now, pid)?.t; if (p) { p.subs = []; return p.subs } return now })()) : now
      list.splice(Math.min(at, list.length), 0, x)
      this.tasksCommit(cc, now, '已恢复「' + label + '」', x.id)
    } })
  }
  /** 详情里直接解除一条链接的绑定（说明里的 [n] 引用改成文字），可撤销。 */
  private taskUnlink(c: Card, id: string, lid: string): void {
    const next = tClone(c.tasks)
    const f = tFind(next, id); const l = this.linkOf(c, lid); if (!f || !l) return
    const prev = { links: (f.t.links ?? []).slice(), note: f.t.note }
    const r = dropRef(f.t.note ?? '', f.t.links ?? [], lid, l.text)
    if (r.links.length) f.t.links = r.links; else delete f.t.links
    if (r.note) f.t.note = r.note; else delete f.t.note
    this.tasksCommit(c, next)
    this.host.toast('已解除「' + l.text + '」的绑定' + (r.note !== (prev.note ?? '') ? '，说明里的引用改成了文字' : ''), 'ok', { label: '撤销', run: () => { const cc = this.card(c.id); if (!cc) return; const now = tClone(cc.tasks); const g = tFind(now, id); if (!g) return; g.t.links = prev.links; if (prev.note) g.t.note = prev.note; else delete g.t.note; this.tasksCommit(cc, now) } })
  }
  /** 编辑卡里：勾掉 / × 一条链接 → 说明里的 [n] 跟着改。 */
  /** 0.25 勾选绑定链接：只换上方标签行，不重画列表（列表滚动位置、鼠标下那一项都不动）；标签行变高时补偿外层滚动。 */
  private tkLpPatch(c: Card): void {
    const e = this.taskEdit; const row = this.root.querySelector('.detail .task.editing .eplinks') as HTMLElement | null; const lp = this.root.querySelector('#dpmTkLp') as HTMLElement | null
    if (!e || !row || !lp) { this.lastDetail = ''; this.renderDetail(); return }
    const db = this.root.querySelector('.detail .d-b') as HTMLElement | null
    const y0 = lp.getBoundingClientRect().top
    row.innerHTML = this.tkChips(c, e.links) + '<button type="button" class="addlk" data-tk-lpick aria-expanded="true" aria-controls="dpmTkLp">' + ic('plus') + (e.links.length ? '' : '绑定本卡片的链接') + '</button>'
    if (db) db.scrollTop += lp.getBoundingClientRect().top - y0
    // 下次整块重画以编辑草稿为准，不跳过
    this.lastDetail = ''
  }
  private tkEditUnlink(c: Card, lid: string): void {
    const e = this.taskEdit; const l = this.linkOf(c, lid); if (!e || !l) return
    const r = dropRef(e.n, e.links, lid, l.text)
    if (r.note !== e.n) this.host.toast('说明里引用它的地方改成了链接名文字，后面的编号已顺延')
    e.n = r.note; e.links = r.links
  }
  /** 在说明的光标处（或「[[」处）插入 [n]；没绑定的链接先绑上。 */
  private tkPickRef(c: Card, lid: string): void {
    const e = this.taskEdit; if (!e) return
    if (!e.links.includes(lid)) e.links.push(lid)
    const n = e.links.indexOf(lid) + 1
    let [a, b] = this.tkCaret
    if (this.tkRm && this.tkRm.from >= 0) a = this.tkRm.from
    e.n = e.n.slice(0, a) + '[' + n + ']' + e.n.slice(b)
    const pos = a + String(n).length + 2
    this.tkRm = null
    this.tkCaret = [pos, pos]
    this.lastDetail = ''; this.renderDetail()
    const ta = this.root.querySelector('#dpmTaskNote') as HTMLTextAreaElement | null
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos) }
    void c
  }
  /** 说明输入时识别「[[关键词」打开 / 更新 / 关闭引用菜单。 */
  private tkRefTrack(ta: HTMLTextAreaElement): void {
    this.tkCaret = [ta.selectionStart, ta.selectionEnd]
    const m = /\[\[([^[\]\n]{0,20})$/.exec(ta.value.slice(0, ta.selectionStart))
    const want = m ? { q: m[1], from: ta.selectionStart - m[0].length } : null
    const cur = this.tkRm
    if (want && (!cur || cur.q !== want.q || cur.from !== want.from)) this.tkRm = { ...want, i: cur && cur.from === want.from ? cur.i : 0 }
    else if (!want && cur && cur.from >= 0) this.tkRm = null
    else return
    this.lastDetail = ''; this.renderDetail()
    const t2 = this.root.querySelector('#dpmTaskNote') as HTMLTextAreaElement | null
    if (t2) { t2.focus({ preventScroll: true }); t2.setSelectionRange(this.tkCaret[0], this.tkCaret[1]) }
  }
  /** v113（2.7）：Alt+↑↓ 只在本组内（已完成 / 未完成）上下换位；Alt+→ / Alt+← 改层级（任务 ↔ 子任务）——
      拖动只负责排序（同组内），改层级仍在详情页用键盘完成（执行安排要跟着「只改内容、不改位置」）。 */
  private taskKey(c: Card, id: string, key: string): void {
    if (key === 'ArrowRight' || key === 'ArrowLeft') { this.taskLevel(c, id, key === 'ArrowRight' ? 1 : -1); return }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return
    const next = tClone(c.tasks)
    const f = tFind(next, id); if (!f) return
    const done = !!f.t.done
    const group = f.list.filter((x) => !!x.done === done)
    const gi = group.findIndex((x) => x.id === id)
    const to = gi + (key === 'ArrowUp' ? -1 : 1)
    if (gi < 0 || to < 0 || to >= group.length) return
    const [x] = group.splice(gi, 1); group.splice(to, 0, x)
    let j = 0
    for (let i = 0; i < f.list.length; i++) if (!!f.list[i].done === done) f.list[i] = group[j++]
    this.tasksCommit(c, next, undefined, id)
    this.focusTask('[data-tk-grip="' + CSS.escape(id) + '"]')
  }
  /** Alt+→ 变成上一个任务的子任务；Alt+← 从子任务回到顶层（排在原父任务后面）。
      v119 起与拖放共用 tMove：同一套守卫（同区 / 一层 / 有子任务不可再被嵌套），提示文案也一致。 */
  private taskLevel(c: Card, id: string, dir: 1 | -1): void {
    const next = tClone(c.tasks)
    const f = tFind(next, id); if (!f) return
    if (dir === 1) {
      const prev = next.filter((x) => x.id !== f.t.id && !x.done === !f.t.done)[Math.max(0, this.sameGroupIndex(next, f) - 1)]
      if (!prev) { this.host.toast('上面没有同组的任务可以挂靠'); return }
      const res = tMove(next, { id, tid: prev.id as string, mode: 'nest', before: true })
      if (res.err) { this.host.toast(res.err, 'err'); return }
      this.tkClosed.delete(prev.id as string)
      if (prev.done) this.tkSubDone.add(prev.id as string)
      this.tasksCommit(c, next, res.msg, id)
    } else {
      if (!f.p) return
      const res = tMove(next, { id, tid: f.p.id as string, mode: 'outdent', before: false })
      if (res.err) { this.host.toast(res.err, 'err'); return }
      this.tasksCommit(c, next, res.msg, id)
    }
    this.focusTask('[data-tk-grip="' + CSS.escape(id) + '"]')
  }
  /** 同组（已完成 / 未完成）里的下标。 */
  private sameGroupIndex(list: Task[], f: { t: Task }): number {
    const done = !!f.t.done
    return list.filter((x) => !!x.done === done).findIndex((x) => x.id === f.t.id)
  }
  /** v119：拖动 = 同区（已完成 / 未完成）内改层级。
      拖到任务标题行的中段 = 变成它的子任务（追加到它的子任务列表最后）；上 / 下沿 = 插到它前面 / 后面；
      子任务拖到顶层任务的上 / 下沿 = 恢复为独立任务；同一父任务下的子任务之间 = 换顺序；
      已完成区 ⇄ 未完成区不能互拖（跨区会造出「已完成父任务带未完成子任务」这种矛盾）。 */
  /* ── v127（8）/ v128（7）/ v129（7）：详情 → 今天的任务执行安排拖动 ──
     整条标题栏 = 整个项目；任务 / 子任务的标题与抓手照常是详情内重排，一拖进今天面板就自动切成「排进执行安排」。 */
  private xd: { cid: string; keys: string[]; title: string; lv: 'p' | 't' | 's'; sub: string; src: HTMLElement; x0: number; y0: number; on: boolean; ghost: HTMLElement | null; zone: string; hit: { z: string; el: HTMLElement } | null; scrollAt: number; off: () => void } | null = null
  private xdDown(e: PointerEvent): boolean {
    if (e.button !== 0 || this.xd) return false
    const t = e.target as HTMLElement
    const h = t.closest?.('.detail .d-h') as HTMLElement | null
    if (!h || t.closest('button, a, input, textarea, [contenteditable], .v7st')) return false
    const x = getXS()
    if (!x || !x.open()) return false
    const c = this.sel ? this.card(this.sel) : undefined
    if (!c || this.root.querySelector('.detail.ro')) return false
    this.xdArm(e.clientX, e.clientY, c, null, false, h)
    return true
  }
  private xdArm(x0: number, y0: number, c: Card, t: Task | null, sub: boolean, src: HTMLElement): void {
    const move = (ev: PointerEvent): void => this.xdMove(ev)
    const up = (): void => this.xdEnd(true)
    const cancel = (): void => this.xdEnd(false)
    const key = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !this.xd) return
      ev.preventDefault(); ev.stopPropagation()
      const on = this.xd.on
      this.xdEnd(false)
      if (on) this.host.toast('已取消拖动 · 浮卡飞回原位')
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
    const off = (): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
    }
    const lv: 'p' | 't' | 's' = !t ? 'p' : sub ? 's' : 't'
    this.xd = {
      cid: c.id, keys: t ? taskKeys(c.id, t, sub) : cardKeys(c.id, c.tasks), title: t ? t.text : c.t, lv,
      sub: lv === 'p' ? this.grp(c.g)?.name ?? '' : c.t, src, x0, y0, on: false, ghost: null, zone: '', hit: null, scrollAt: 0, off,
    }
  }
  /** 真拖过 → 吞掉松手后那一下 click（不误触发开合详情 / 任务） */
  private xdEat(): void {
    const eat = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault() }
    window.addEventListener('click', eat, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', eat, true), 350)
  }
  private xdStart(e: PointerEvent): void {
    const d = this.xd, x = getXS()
    if (!d) return
    if (!x || !x.open()) { this.xdEnd(false); return }
    /* v141（1.2）：子任务不能单独拖进任务执行安排 —— 由它的任务整体安排（拖任务卡）：子任务卡抖一下、它的任务卡闪黄框 + 提示 */
    if (d.lv === 's') {
      this.xdEat()
      const tid = d.keys[0]?.split('|')[2] ?? ''
      const c = this.card(d.cid), f = c ? tFind(c.tasks, tid) : null, par = f?.p ?? null
      d.src.classList.remove('v7deny'); void d.src.offsetWidth; d.src.classList.add('v7deny'); setTimeout(() => d.src.classList.remove('v7deny'), 600)
      if (par) {
        const ph = this.root.querySelector<HTMLElement>('.detail .task.top[data-tid="' + CSS.escape(par.id as string) + '"] > .tkhead')
        if (ph) { ph.classList.remove('dpm-v41hint'); void ph.offsetWidth; ph.classList.add('dpm-v41hint'); setTimeout(() => ph.classList.remove('dpm-v41hint'), 1300) }
        this.host.toast('子任务跟着任务「' + par.text + '」整体安排：请拖任务卡（已帮你标出来）')
      }
      ;(window as unknown as Record<string, unknown>).__dpmDeny = { sub: tid, parent: par?.id ?? '', at: Date.now() }
      this.xdEnd(false)
      return
    }
    const have = x.has(d.keys), rest = d.keys.filter((k) => !have.includes(k))
    this.xdEat()
    if (!rest.length) {
      /* 已经在执行安排里：不起拖，原卡抖一下，执行安排里那张卡展开所在分区、滚过去并流光 */
      d.src.classList.remove('v7deny'); void d.src.offsetWidth; d.src.classList.add('v7deny')
      setTimeout(() => d.src.classList.remove('v7deny'), 600)
      x.seek(have)
      this.host.toast('「' + d.title + '」已经在执行安排的「' + ZT[x.zone(have)] + '」里了 —— 已帮你闪一下那张卡片')
      this.xdEnd(false)
      return
    }
    d.keys = rest
    d.on = true
    window.getSelection()?.removeAllRanges()
    const g = document.createElement('div')
    g.className = 'v7ghost'
    g.dataset.zone = ''
    g.innerHTML = '<span class="lvt ' + d.lv + '">' + (d.lv === 'p' ? '项目' : d.lv === 't' ? '任务' : '子任务') + '</span><span class="v7g-m"><b>' + esc(d.title) + '</b><small>' + esc(d.sub) + (rest.length > 1 ? ' · ' + rest.length + ' 个任务项' : '') + '</small></span><em class="v7g-z"></em>'
    document.body.append(g)
    d.ghost = g
    g.style.transform = 'translate(' + (e.clientX - 18) + 'px,' + (e.clientY - 18) + 'px)'
    d.src.classList.add('v7lift')
    document.body.classList.add('v7dragging')
  }
  private xdMove(e: PointerEvent): void {
    const d = this.xd
    if (!d) return
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return
      this.xdStart(e)
      if (!this.xd || !this.xd.on) return
    }
    e.preventDefault()
    const g = d.ghost as HTMLElement
    g.style.transform = 'translate(' + (e.clientX - 18) + 'px,' + (e.clientY - 18) + 'px)'
    const x = getXS()
    const h = x ? x.hit(e.clientX, e.clientY) : null
    const z = h ? h.z : ''
    if (z !== d.zone || (h && h.el !== d.hit?.el)) {
      document.querySelectorAll('.v7over').forEach((o) => o.classList.remove('v7over'))
      if (h) h.el.classList.add('v7over')
      d.zone = z; d.hit = h
      g.dataset.zone = z
      ;(g.querySelector('.v7g-z') as HTMLElement).textContent = z ? '放进「' + ZT[z] + '」' : ''
    }
    /* 被遮住的分区也能拖到：贴近执行安排上 / 下边缘自动滚（45ms 节流） */
    const body = h && x ? x.body() : null
    const now = performance.now()
    if (body && now - d.scrollAt > 45) {
      const br = body.getBoundingClientRect()
      if (e.clientY < br.top + 28 && body.scrollTop > 0) { body.scrollTop -= 14; d.scrollAt = now }
      else if (e.clientY > br.bottom - 28 && body.scrollTop < body.scrollHeight - body.clientHeight - 1) { body.scrollTop += 14; d.scrollAt = now }
    }
  }
  private xdEnd(commit: boolean): void {
    const d = this.xd
    this.xd = null
    if (!d) return
    d.off()
    if (!d.on) return
    document.body.classList.remove('v7dragging')
    d.src.classList.remove('v7lift')
    document.querySelectorAll('.v7over').forEach((o) => o.classList.remove('v7over'))
    const g = d.ghost as HTMLElement
    if (commit && d.zone && d.hit && getXS()?.open()) {
      const tgt = ((d.hit.el.querySelector('.exz-b') ?? d.hit.el) as HTMLElement).getBoundingClientRect()
      g.classList.add('v7fly')
      g.style.transform = 'translate(' + (tgt.left + 8) + 'px,' + Math.max(tgt.top, tgt.bottom - 46) + 'px) scale(.92)'
      setTimeout(() => { g.remove(); getXS()?.place(d.cid, d.keys, d.zone, d.title) }, 230)
    } else {
      const r = d.src.getBoundingClientRect()
      g.classList.add('v7fly', 'back')
      g.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px) scale(.96)'
      setTimeout(() => g.remove(), 230)
    }
  }
  private tkd: TkDragState | null = null
  private tkClean(): void {
    const d = this.tkd
    if (d) {
      d.ghost?.remove(); d.hint?.remove(); d.line?.remove(); d.slot?.remove()
      if (d.id) {
        const row = this.tkRowEl(d.id)
        row?.classList.remove('lifting')
        this.tkTileEl(row)?.classList.remove('lifting')
      }
      this.root.querySelectorAll('.tk-nest').forEach((n) => n.classList.remove('tk-nest'))
      this.root.querySelectorAll('.tk-walled').forEach((n) => n.classList.remove('tk-walled'))
    }
    this.root.classList.remove('wdragging')
    this.tkd = null
  }
  private tkRowEl(id: string): HTMLElement | null {
    return this.root.querySelector('.detail .task[data-tid="' + CSS.escape(id) + '"]') as HTMLElement | null
  }
  /** 顶层任务的外层卡片（子任务返回它自己）—— 命中和画插入线都用它。 */
  private tkTileEl(row: HTMLElement | null): HTMLElement | null {
    if (!row) return null
    return (row.dataset.lv === '0' ? (row.closest('.tile') as HTMLElement | null) : row) as HTMLElement | null
  }
  /** 虚线槽位只能画在「松手后真会加进去」的列表里：已完成目标的子任务在收起的「已完成子任务 N」段里，
      那一段没展开时就不画（画到未完成那段会骗人）—— 靠蓝框 + 提示条说明落点，松手后会自动展开。 */
  private tkKidsList(tile: HTMLElement): HTMLElement | null {
    const top = tile.querySelector('.task.top') as HTMLElement | null
    if (!top) return null
    const wrap = top.querySelector(':scope > .ptkids-wrap') as HTMLElement | null
    if (!wrap || !wrap.classList.contains('open')) return null
    const kids = wrap.querySelector(':scope > .ptkw-in > .kids') as HTMLElement | null
    if (!kids) return null
    const doneBody = kids.querySelector(':scope > .tilebody.kidbody') as HTMLElement | null
    if (top.classList.contains('done') && doneBody) {
      if (!doneBody.classList.contains('open')) return null
      return doneBody.querySelector(':scope > .tilebody-in') as HTMLElement | null
    }
    return kids
  }
  private tkDown(e: PointerEvent): boolean {
    const t0 = e.target as HTMLElement
    let h = t0.closest?.('[data-tk-grip]') as HTMLElement | null
    let soft = false
    /* v129（1）：按住任务 / 子任务标题或标题栏空白 = 和抓手同一套拖动（勾选 / 按钮 / 状态 / 截止 / 子任务徽标除外） */
    if (!h && e.button === 0) {
      const head = t0.closest?.('.detail .task > .tkhead') as HTMLElement | null
      if (head && !t0.closest('input, textarea, a, [contenteditable], .pcb, .tacts, .tkst, .tkrow2, button:not(.tkt)')) {
        h = head.querySelector(':scope > .tkrow > [data-tk-grip]') as HTMLElement | null
        soft = !!h
      }
    }
    if (!h || e.button !== 0 || this.taskEdit) return false
    const c = this.sel ? this.card(this.sel) : undefined
    if (!c) return false
    const id = h.dataset.tkGrip as string
    const f = tFind(c.tasks, id)
    if (!f) return false
    if (!soft) { e.preventDefault(); h.setPointerCapture(e.pointerId) }
    this.tkd = {
      id, x0: e.clientX, y0: e.clientY, on: false, done: !!f.t.done, sub: !!f.p,
      hasKids: !!(f.t.subs ?? []).length, kidsN: (f.t.subs ?? []).length, stx: f.t.text,
      ghost: null, hint: null, line: null, slot: null, slotFor: '', hkey: '',
      mode: '', tid: '', ttl: '', before: true, scrollAt: 0, sid: '', soft, pid: e.pointerId, cap: soft ? h : null
    }
    return true
  }
  private tkStartVisual(d: TkDragState): void {
    const row = this.tkRowEl(d.id)
    const tile = this.tkTileEl(row)
    tile?.classList.add('lifting')
    this.root.classList.add('wdragging')
    d.ghost = document.createElement('div')
    d.ghost.className = 'tk-drag-ghost'
    d.ghost.innerHTML = '<span class="g">' + ic('grip') + '</span><span class="t">' + esc(d.stx) + '</span>'
      + (d.hasKids ? '<span class="b">带 ' + d.kidsN + ' 个子任务</span>' : '')
    d.hint = document.createElement('div')
    d.hint.className = 'tk-drag-hint'
    d.line = document.createElement('div')
    d.line.className = 'tk-drop'
    d.line.setAttribute('aria-hidden', 'true')
    d.line.hidden = true
    d.line.innerHTML = '<b></b>'
    this.root.appendChild(d.ghost)
    this.root.appendChild(d.line)
    this.root.appendChild(d.hint)
    /* 另一个区整块压暗 —— 明确「已完成 / 未完成不能互拖」 */
    const ul = this.root.querySelector('.detail #dpmTasks') as HTMLElement | null
    if (ul) {
      Array.from(ul.children).forEach((el) => {
        const n = el as HTMLElement
        if (n.classList.contains('tile')) { if (n.classList.contains('done') !== d.done) n.classList.add('tk-walled') }
        else if (n.classList.contains('tilebody') || n.classList.contains('tilefold')) { if (!d.done) n.classList.add('tk-walled') }
        else if (n.classList.contains('ptnew') || n.classList.contains('editing-tile')) { if (d.done) n.classList.add('tk-walled') }
      })
    }
  }
  private tkHint(d: TkDragState, kind: 'ok' | 'muted' | 'warn', text: string): void {
    if (!d.hint) return
    const key = kind + '|' + text
    if (d.hkey === key) return
    d.hkey = key
    const arrow = d.mode === 'nest' || d.mode === 'nestAt'
      ? '<svg viewBox="0 0 24 24"><path d="M5 6v6a4 4 0 0 0 4 4h7"/><path d="m13 12 3.5 4L13 20"/></svg>'
      : d.mode === 'outdent'
        ? '<svg viewBox="0 0 24 24"><path d="M19 6v6a4 4 0 0 1-4 4H8"/><path d="m11 12-3.5 4L11 20"/></svg>'
        : d.mode === 'order' ? '<svg viewBox="0 0 24 24"><path d="M4 8h16M4 16h16"/></svg>'
          : '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>'
    d.hint.className = 'tk-drag-hint ' + kind
    d.hint.innerHTML = '<span class="i">' + arrow + '</span><span>' + esc(text) + '</span>'
  }
  private tkDropLine(d: TkDragState, box: { left: number; top: number; width: number }, label: string): void {
    if (!d.line) return
    d.line.hidden = false
    d.line.style.left = Math.round(box.left) + 'px'
    d.line.style.top = Math.round(box.top) + 'px'
    d.line.style.width = Math.round(box.width) + 'px'
    const b = d.line.querySelector('b')
    if (b) b.textContent = label
  }
  private tkNestReset(d: TkDragState): void {
    if (!d.slotFor) return
    this.root.querySelectorAll('.tk-nest').forEach((n) => n.classList.remove('tk-nest'))
    d.slot?.remove()
    d.slot = null
    d.slotFor = ''
  }
  private tkMove(e: PointerEvent): void {
    const d = this.tkd; if (!d) return
    if (!d.on) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 4) return
      d.on = true
      if (d.soft && d.cap) { try { d.cap.setPointerCapture(d.pid) } catch { /* 指针已松开 */ } window.getSelection()?.removeAllRanges() }
      this.tkStartVisual(d)
    }
    /* v128（7）/ v129（1）：抓手 / 标题拖动一进今天面板 = 自动切成「排进执行安排」 */
    const xs = getXS()
    if (xs && xs.open() && xs.near(e.clientX, e.clientY)) {
      const c = this.sel ? this.card(this.sel) : undefined
      const f = c ? tFind(c.tasks, d.id) : null
      const row = this.tkRowEl(d.id)
      const src = this.tkTileEl(row) ?? row
      if (c && f && src) {
        this.tkClean()
        this.xdArm(d.x0, d.y0, c, f.t, !!f.p, src)
        this.xdStart(e)
        if (this.xd?.on) { this.xdMove(e); this.host.toast('已切换成「排进今天的执行安排」：松手放进对应分区，Esc 取消') }
        return
      }
    }
    const gh = d.ghost, hint = d.hint, line = d.line
    if (!gh || !hint || !line) return
    /* 浮卡 + 提示条跟手（贴右边 / 贴底自动翻到另一侧） */
    const gw = gh.offsetWidth || 220, hw = hint.offsetWidth || 180
    let gx = e.clientX + 16, gy = e.clientY + 12
    if (gx + gw > window.innerWidth - 10) gx = Math.max(8, e.clientX - gw - 16)
    if (gy + 30 > window.innerHeight - 10) gy = Math.max(8, e.clientY - 40)
    gh.style.left = gx + 'px'
    gh.style.top = gy + 'px'
    hint.style.left = Math.max(8, Math.min(gx, window.innerWidth - hw - 10)) + 'px'
    hint.style.top = (gy + 32) + 'px'
    /* 拖到上下边缘自动滚（45ms 节流；长列表也能拖到看不见的地方） */
    const sc = this.root.querySelector('.detail .d-b') as HTMLElement | null
    const now = performance.now()
    if (sc && now - d.scrollAt > 45) {
      const sr = sc.getBoundingClientRect()
      const room = sc.scrollHeight - sc.clientHeight
      let dy = 0
      if (e.clientY < sr.top + 24 && sc.scrollTop > 0) dy = -14
      else if (e.clientY > sr.bottom - 24 && sc.scrollTop < room - 1) dy = 14
      if (dy) { sc.scrollTop += dy; d.scrollAt = now }
    }
    /* v130（2）命中判定（只认同区 = 已完成 / 未完成）：
       A 落在子任务行上 = 自己父任务里换位，或插进别的任务的子任务列表（这条前 / 后）
       B 自己的父任务：标题上沿 = 独立（插到父任务前），最后一个子任务下面 = 独立（插到父任务后）
       C 顶层任务：上沿 / 下沿 = 排序（子任务 = 独立），标题中段 = 变成它的子任务（最后），子任务列表里 = 插到指定位置
       D 两张卡之间的空隙 / 列表末尾 = 插到上面那张后面 */
    type Box = { left: number; top: number; bottom: number; width: number }
    type Hit = { mode: TkDragState['mode']; tid: string; sid?: string; before?: boolean; box?: Box; P?: HTMLElement }
    const y = e.clientY
    const src = this.tkRowEl(d.id)
    /* v145（2.2）：收着的组（顶部「已完成任务」/ 某任务的「已完成子任务」段）里的任务不当落点 —— 以前子任务已排除、顶层任务没排除，
       已完成子任务往上拖会命中看不见的已完成任务，松手后进了收着的组（看起来「子任务消失」） */
    const vis = (r: HTMLElement): boolean => !r.closest('.ptkids-wrap:not(.open), .tilebody.kidbody:not(.open), .tilebody[data-tk-donebody]:not(.open)') && r.getBoundingClientRect().height > 0
    const all = (Array.from(this.root.querySelectorAll('.detail .task[data-tid]')) as HTMLElement[])
      .filter((r) => r !== src && !r.closest('.tk-walled') && !r.classList.contains('editing'))
    const subs = all.filter((r) => r.dataset.lv === '1' && vis(r))
    const tops = all.filter((r) => r.dataset.lv === '0' && r.classList.contains('done') === d.done && vis(r))
    /* 拖动中停在收着的折叠条上 0.4 秒 = 自动展开，里面的任务再当落点 */
    {
      const fb = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('.detail .tilefold-b[aria-expanded="false"]') as HTMLElement | null
      if (fb !== d.foldEl) { d.foldEl = fb; d.foldAt = performance.now() }
      else if (fb && performance.now() - (d.foldAt ?? 0) > 400) { d.foldEl = null; fb.click(); (window as unknown as Record<string, unknown>).__dpmFoldAuto = { at: Date.now(), kind: fb.hasAttribute('data-tk-donebtn') ? 'task' : 'sub' } }
    }
    const tileOf = (r: HTMLElement): HTMLElement => (r.closest('.tile') as HTMLElement | null) ?? r
    const topOf = (r: HTMLElement): HTMLElement | null => tileOf(r).querySelector('.task.top') as HTMLElement | null
    const headOf = (r: HTMLElement): DOMRect => ((r.querySelector(':scope > .tkhead') as HTMLElement | null) ?? r).getBoundingClientRect()
    const kidsOf = (P: HTMLElement): HTMLElement[] => (Array.from(tileOf(P).querySelectorAll('.task.child[data-tid]')) as HTMLElement[]).filter(vis)
    const own = d.sub && src ? topOf(src) : null
    /* v145（2.2）：子任务拖到自己父任务的上 / 下沿 = 恢复为独立任务 —— 不论父任务完成没完成（已完成子任务 + 未完成父任务以前在这里被挡掉，落不下） */
    const ownOk = !!own
    let hit: Hit | null = null
    for (const s of subs) {
      const r = s.getBoundingClientRect()
      if (y < r.top - 2 || y > r.bottom + 2) continue
      if (s.classList.contains('done') !== d.done) continue
      const P = topOf(s)
      if (!P) continue
      const before = y < r.top + r.height / 2
      if (P === own) hit = { mode: 'order', tid: s.dataset.tid as string, before, box: r }
      else if (P.classList.contains('done') !== d.done) continue
      else if (d.hasKids) hit = { mode: 'blocked', tid: P.dataset.tid as string }
      else hit = { mode: 'nestAt', tid: P.dataset.tid as string, sid: s.dataset.tid as string, before, box: r, P }
      break
    }
    if (!hit && own && ownOk) {
      const R = tileOf(own).getBoundingClientRect(), H = headOf(own), oid = own.dataset.tid as string
      if (y >= H.top && y <= H.top + H.height * 0.3) hit = { mode: 'outdent', tid: oid, before: true, box: R }
      else if (y >= H.top && y <= H.bottom) hit = { mode: 'inside', tid: oid }
      else if (y > H.bottom && y <= R.bottom + 4) {
        const lastB = Math.max(H.bottom, ...kidsOf(own).map((k) => k.getBoundingClientRect().bottom))
        hit = y > lastB + 2 ? { mode: 'outdent', tid: oid, before: false, box: R } : { mode: 'inside', tid: oid }
      }
    }
    if (!hit) for (const el of tops) {
      if (el === own) continue
      const R = tileOf(el).getBoundingClientRect(), H = headOf(el), tid = el.dataset.tid as string
      if (y < H.top || y > R.bottom) continue
      const kids = kidsOf(el).filter((k) => k !== src), openKids = kids.length > 0 && R.bottom - H.bottom > 14
      const edge = (before: boolean): Hit => ({ mode: d.sub ? 'outdent' : 'order', tid, before, box: R })
      if (y <= H.top + H.height * 0.3) hit = edge(true)
      else if (y <= H.bottom - (openKids ? 0 : H.height * 0.3)) hit = { mode: d.hasKids ? 'blocked' : 'nest', tid }
      else if (!openKids) hit = edge(false)
      else if (y > R.bottom - 7) hit = edge(false)
      else if (d.hasKids) hit = { mode: 'blocked', tid }
      else {
        const rs = kids.map((k) => k.getBoundingClientRect())
        const k0 = rs[0], lastB = Math.max(...rs.map((r) => r.bottom)), firstT = Math.min(...rs.map((r) => r.top))
        if (y > lastB) hit = { mode: 'nestAt', tid, sid: '', before: false, box: { left: k0.left, width: k0.width, top: lastB, bottom: lastB }, P: el }
        else if (y < firstT) hit = { mode: 'nestAt', tid, sid: kids[0].dataset.tid as string, before: true, box: { left: k0.left, width: k0.width, top: firstT, bottom: firstT }, P: el }
        else {
          /* 落在子任务之间的折叠胶囊 / 空隙：就近那条的前 / 后 */
          let bi = 0, bd = 1e9
          rs.forEach((r, i) => { const dd = Math.abs(y - (r.top + r.height / 2)); if (dd < bd) { bd = dd; bi = i } })
          const r = rs[bi], before = y < r.top + r.height / 2
          hit = { mode: 'nestAt', tid, sid: kids[bi].dataset.tid as string, before, box: r, P: el }
        }
      }
      break
    }
    if (!hit) {
      const ul = this.root.querySelector('.detail #dpmTasks') as HTMLElement | null
      const walled = ul ? Array.from(ul.children).some((el) => {
        const n = el as HTMLElement
        if (!n.classList.contains('tk-walled')) return false
        const r = n.getBoundingClientRect()
        return y >= r.top && y <= r.bottom
      }) : false
      if (walled) {
        d.mode = 'wall'; d.tid = ''; line.hidden = true; this.tkNestReset(d)
        this.tkHint(d, 'warn', '已完成 / 未完成两个区不能互拖')
        return
      }
      let best: HTMLElement | null = null, bb = -1e9, first: HTMLElement | null = null, ft = 1e9, lowest = -1e9
      for (const el of tops) {
        const R = tileOf(el).getBoundingClientRect()
        if (R.bottom <= y && R.bottom > bb) { bb = R.bottom; best = el }
        if (R.top < ft) { ft = R.top; first = el }
        if (R.bottom > lowest) lowest = R.bottom
      }
      const maxGap = best && bb === lowest ? 140 : 40
      if (best && y - bb <= maxGap) hit = { mode: d.sub ? 'outdent' : 'order', tid: best.dataset.tid as string, before: false, box: tileOf(best).getBoundingClientRect() }
      else if (first && ft >= y && ft - y <= 30) hit = { mode: d.sub ? 'outdent' : 'order', tid: first.dataset.tid as string, before: true, box: tileOf(first).getBoundingClientRect() }
    }
    if (!hit) {
      d.mode = 'none'; d.tid = ''; line.hidden = true; this.tkNestReset(d)
      this.tkHint(d, 'muted', '拖到另一个任务上 = 变成它的子任务 · 拖到任务之间 = 排序 · 子任务拖出父任务 = 独立')
      return
    }
    d.mode = hit.mode
    d.tid = hit.tid
    d.before = hit.before !== false
    d.sid = hit.sid ?? ''
    const ttlOf = (id: string): string => (this.tkRowEl(id)?.querySelector(':scope > .tkhead > .tkrow > .tkt .tx') as HTMLElement | null)?.textContent ?? ''
    d.ttl = ttlOf(d.tid)
    const stl = d.sid ? ttlOf(d.sid) : ''
    const scR = sc?.getBoundingClientRect()
    const clampY = (v: number): number => scR ? Math.min(Math.max(v, scR.top + 3), scR.bottom - 3) : v
    if ((hit.mode === 'order' || hit.mode === 'outdent') && hit.box) {
      const b = hit.box
      this.tkDropLine(d, { left: b.left + 6, top: clampY(d.before ? b.top : b.bottom) - 1, width: Math.max(60, b.width - 12) },
        hit.mode === 'outdent' ? '独立任务' : (d.before ? '插到前面' : '插到后面'))
    } else if (hit.mode === 'nestAt' && hit.box) {
      const b = hit.box
      this.tkDropLine(d, { left: b.left + 4, top: clampY(d.before ? b.top - 1 : b.bottom + 1) - 1, width: Math.max(60, b.width - 8) }, '成为子任务')
    } else line.hidden = true
    if (hit.mode === 'nest') {
      if (d.slotFor !== d.tid) {
        this.tkNestReset(d)
        const trow = this.tkRowEl(d.tid)
        if (trow) {
          const tile = tileOf(trow)
          tile.classList.add('tk-nest')
          const ul = this.tkKidsList(tile)
          if (ul) {
            const li = document.createElement('li')
            li.className = 'tk-nest-slot'
            li.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6v6a4 4 0 0 0 4 4h7"/><path d="m13 12 3.5 4L13 20"/></svg><span>松手 = 加到这里</span>'
            ul.appendChild(li)
            d.slot = li
          }
        }
        d.slotFor = d.tid
      }
    } else if (hit.mode === 'nestAt') {
      if (d.slotFor !== 'at|' + d.tid) {
        this.tkNestReset(d)
        if (hit.P) tileOf(hit.P).classList.add('tk-nest')
        d.slotFor = 'at|' + d.tid
      }
    } else this.tkNestReset(d)
    const moveWord = d.sub ? '移到「' + d.ttl + '」的子任务里' : '成为「' + d.ttl + '」的子任务'
    if (hit.mode === 'nest') this.tkHint(d, 'ok', moveWord + ' · 排到它的子任务最后')
    else if (hit.mode === 'nestAt') this.tkHint(d, 'ok', moveWord + ' · ' + (d.sid ? '插到「' + stl + '」' + (d.before ? '前面' : '后面') : '排到它的子任务最后'))
    else if (hit.mode === 'outdent') this.tkHint(d, 'ok', '恢复为独立任务 · ' + (d.done && !this.tkDoneOpen ? '进入已完成任务（会自动展开）' : '插到「' + d.ttl + '」' + (d.before ? '前面' : '后面')))
    else if (hit.mode === 'order') this.tkHint(d, 'ok', '插到「' + d.ttl + '」' + (d.before ? '前面' : '后面'))
    else if (hit.mode === 'inside') this.tkHint(d, 'muted', '已经在「' + d.ttl + '」的子任务里 · 拖到父任务上沿或最后一个子任务下面 = 变成独立任务')
    else this.tkHint(d, 'warn', '「' + d.stx + '」还有 ' + d.kidsN + ' 个子任务，不能再成为别人的子任务')
  }
  private tkStop(commit: boolean): boolean {
    const d = this.tkd; if (!d) return false
    const id = d.id, tid = d.tid, mode = d.mode, before = d.before, on = d.on, sid = d.sid
    this.tkClean()
    /* 真拖过 → 吞掉松手后那一下 click（按标题起拖时，否则会顺手开合详情） */
    if (on) {
      const eat = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener('click', eat, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', eat, true), 350)
    }
    if (!on || !commit || !tid || (mode !== 'order' && mode !== 'outdent' && mode !== 'nest' && mode !== 'nestAt')) return true
    const c = this.sel ? this.card(this.sel) : undefined
    if (!c) return true
    const next = tClone(c.tasks)
    const tgt0 = tFind(next, tid)
    const res = mode === 'nestAt' ? tMove(next, { id, tid, mode: 'nest', before, sid }) : tMove(next, { id, tid, mode, before })
    if (res.err) { this.host.toast(res.err, 'err'); return true }
    if (!res.msg) return true
    /* 变成子任务：自动展开目标的子任务列表（已完成目标连「已完成子任务」段一起展开），别让用户拖完看不到 */
    if ((mode === 'nest' || mode === 'nestAt') && tgt0) {
      this.tkClosed.delete(tid)
      if (tgt0.t.done) this.tkSubDone.add(tid)
    }
    /* v145（2.2）：已完成的子任务恢复为独立任务 = 进顶部「已完成任务」组 —— 这一组收着就自动展开、滚过去并闪一下 */
    const landDone = mode === 'outdent' && !!tFind(next, id)?.t.done && !tFind(next, id)?.p
    if (landDone && !this.tkDoneOpen) this.tkDoneOpen = true
    this.tasksCommit(c, next, res.msg + (landDone ? ' · 已展开「已完成任务」' : ''), id)
    if (landDone) setTimeout(() => { const r = this.tkRowEl(id); r?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 120)
    return true
  }



  // ── 0.26 相关文件（原型 v46–v50）：标题 + 三类标签 + 添加文件弹窗 + 放到落盘项目（全局开关）+ 删除原文件（各自全局） ──
  private fEdit: { card: string; id: string; v: string; on?: boolean } | null = null
  private tolf: { card: string } | null = null
  private fBusy = new Set<string>()
  /** v111：相关文件多选（null = 关闭；按卡片记，切换卡片不串） */
  private filesSel: { card: string; ids: Set<string> } | null = null
  /** v111：删除并解绑的二次确认（待处理文件 id） */
  private fDelIds: string[] | null = null
  /** 添加文件弹窗草稿：items = 待添加（选择的 + 粘贴的）；bad = 粘贴里有问题的行。 */
  private fa: { card: string; text: string; items: Array<{ path: string; title: string; src: 'pick' | 'paste'; status: 'ok' | 'skip' }>; bad: PathCheck[]; to: string; seq: number; picking: boolean; /** v138：相关文件新增默认不注入 */ on?: boolean } | null = null
  private faTimer = 0
  private prefs(): Prefs { const p = this.snap?.board.prefs ?? {}; return { lf: p.lf !== false, delAdd: p.delAdd !== false, delTolf: p.delTolf !== false } }
  /** 卡片可放文件的落盘项目（卡片 ∪ 卡片组，找得到 STATE 的）。 */
  private lfKeys(c: Card): string[] { return this.memOf(c).map((m) => m.k).filter((k) => !!this.stateOf(k)) }
  private lfDir(k: string): string { const p = this.stateOf(k)?.path ?? ''; return p.replace(/\/STATE\.md$/, '') }
  private inLf(c: Card, p: string): boolean { return this.lfKeys(c).some((k) => { const d = this.lfDir(k); return !!d && p.startsWith(d + '/') }) }
  private exists(p: string): boolean { return (this.snap?.files ?? {})[p] !== false }
  private movable(c: Card): FileRef[] { return (c.files ?? []).filter((f) => this.exists(f.path) && !this.inLf(c, f.path) && !this.fBusy.has(f.id)) }
  /** 删除原文件的保护（与 host 一致）：在本卡片 / 卡片组仓库里的、还被别的卡片登记的，只复制不删。 */
  private keepWhy(c: Card, p: string): string {
    const g = this.grp(c.g)
    if ([...(c.repos ?? []), ...(g?.repos ?? [])].some((r) => p.startsWith(r.path.replace(/\/+$/, '') + '/'))) return '在仓库里'
    if (this.cards.some((x) => x.id !== c.id && (x.files ?? []).some((f) => f.path === p))) return '别的卡片也在用'
    return ''
  }
  private fUses(c: Card, id: string): number { return tFlat(c.tasks).filter((t) => (t.files ?? []).includes(id)).length }
  private fIcon(f: { path: string }, gone: boolean): string { return ic(gone ? 'filex' : ftype(f.path)?.icon ?? 'file') }
  private tilde(p: string): string { const h = (this.snap?.hub.path ?? '').match(/^(\/Users\/[^/]+|\/home\/[^/]+)/)?.[1]; return h && p.startsWith(h + '/') ? '~' + p.slice(h.length) : p }
  private fileRowHtml(c: Card, f: FileRef, ro: boolean): string {
    const gone = !this.exists(f.path)
    if (this.fEdit && this.fEdit.card === c.id && this.fEdit.id === f.id) return '<div class="frow-f editing" data-fid="' + esc(f.id) + '">' + this.fIcon(f, gone) + '<div class="txt"><div class="ftitle"><label class="sr-only" for="dpmFT">文件标题</label><input id="dpmFT" value="' + esc(this.fEdit.v) + '" placeholder="' + esc(folderName(f.path)) + '（默认用文件名）" maxlength="120" autocomplete="off">'
      + '<button type="button" class="ib sm ok" data-f-save aria-label="保存">' + ic('check') + '</button><button type="button" class="ib sm" data-f-cancel aria-label="取消">' + ic('x') + '</button></div><span class="mono">' + esc(this.tilde(f.path)) + '</span>' + injCard('dpmFInj', this.fEdit.on ?? !f.off) + '<div class="fhint">标题可以留空，留空就显示文件名。回车保存 · Esc 取消</div></div></div>'
    const ty = ftype(f.path), uses = this.fUses(c, f.id)
    // 类型 = 它是什么（方角、中性灰、靠图标区分）｜ 状态 + 位置 = 它在不在、在哪（圆角、颜色表达状态）
    const tyTag = ty ? '<span class="ft" title="文件类型：' + ty.label + '（按扩展名 .' + esc(ty.ext) + ' 判断）">' + ic(ty.icon) + ty.label + '</span><span class="fsep" aria-hidden="true"></span>' : ''
    const st = this.fBusy.has(f.id) ? '<span class="fs busy" title="文件状态"><span class="spin" aria-hidden="true"></span>复制中</span>' : gone ? '<span class="fs gone" title="文件状态：原路径上已经没有这个文件"><i aria-hidden="true"></i>已删除</span>' : '<span class="fs ok" title="文件状态：文件存在"><i aria-hidden="true"></i>存在</span>'
    const loc = this.inLf(c, f.path) ? '<span class="fl" title="文件位置：在这张卡片的落盘项目文件夹里">' + ic('mem') + '在落盘项目里</span>' : ''
    const use = uses ? '<span class="fuse">' + uses + ' 个任务在用</span>' : ''
    // v99：点标题本身 = 用系统默认应用打开这个文件（和访达里双击一样）；行里其他按钮不受影响
    const title = gone ? '<span>' + esc(fileName(f)) + '</span>'
      : '<button type="button" class="fopen" data-f-open="' + esc(f.id) + '" title="用默认应用打开「' + esc(fileName(f)) + '」"><span class="ft">' + esc(fileName(f)) + '</span></button>'
    return '<div class="frow-f' + (gone ? ' gone' : '') + (f.off ? ' ioff' : '') + '" data-fid="' + esc(f.id) + '">' + iswHtml('file', f.id, fileName(f), !!f.off, ro) + this.fIcon(f, gone) + '<div class="txt"><div class="nm">' + title + ioffTag(!!f.off) + '</div><span class="mono" title="' + esc(f.path) + '">' + esc(this.tilde(f.path)) + '</span><div class="ftags">' + tyTag + st + loc + use + '</div></div>'
      + '<span class="facts">' + qbtn(fileText({ path: f.path, title: fileName(f), exists: !gone }), fileName(f)) + (ro ? '' : '<button type="button" class="ib sm tipbtn" data-f-edit="' + esc(f.id) + '" aria-label="编辑 ' + esc(fileName(f)) + '（标题 / 是否注入 Agent 会话）">' + ic('pencil') + '<span class="tip" aria-hidden="true">编辑</span></button>')
      + (gone ? '' : '<button type="button" class="ib sm tipbtn" data-reveal-file="' + esc(f.path) + '" aria-label="在访达中显示 ' + esc(fileName(f)) + '">' + ic('finder') + '<span class="tip" aria-hidden="true">在访达中显示</span></button>')
      + '<button type="button" class="ib sm tipbtn cp" data-copy-path="' + esc(f.path) + '" aria-label="复制路径 ' + esc(f.path) + '">' + COPY_SVG + CHECK_SVG + '<span class="tip" aria-hidden="true">复制路径</span></button>'
      + (ro ? '' : '<button type="button" class="ib sm unl tipbtn" data-f-unl="' + esc(f.id) + '" aria-label="解除关联 ' + esc(fileName(f)) + '">' + ic('unlink') + '<span class="tip" aria-hidden="true">解除关联</span></button>')
      // 0.28 删除：文件移到废纸篓并解除关联（已删除的文件没有这个按钮）
      + (ro || gone ? '' : '<button type="button" class="ib sm unl tipbtn" data-f-del="' + esc(f.id) + '" aria-label="删除文件 ' + esc(fileName(f)) + '">' + ic('trash') + '<span class="tip" aria-hidden="true">删除（移到废纸篓）</span></button>') + '</span></div>'
  }
  /** 「删除原文件」子开关：挂在父开关 / 按钮下面，左侧一条细竖线表示从属。 */
  private delSubHtml(id: string, on: boolean, keep: number): string {
    return '<div class="dsub"><div class="txt"><label for="' + id + '"><b>删除原文件</b></label><span class="glob">所有卡片共用</span>'
      + '<span class="dnote">' + (on ? '复制并校验一致后，把原文件移到废纸篓（可撤销）。仓库里的、别的卡片也在用的不删。' : '关闭：原文件留在原处。') + (on && keep ? '<em>这次有 ' + keep + ' 个会保留。</em>' : '') + '</span></div>'
      + '<input type="checkbox" role="switch" class="sw sm" id="' + id + '"' + (on ? ' checked' : '') + '></div>'
  }
  private lfTargetHtml(c: Card, selId: string, cur: string): string {
    const ks = this.lfKeys(c)
    if (ks.length < 2) return '<span>' + esc(this.tilde(this.lfDir(ks[0] ?? ''))) + '/evidence/</span>'
    return '<label class="sr-only" for="' + selId + '">复制到哪个落盘项目</label><select id="' + selId + '">' + ks.map((k) => '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(this.stateOf(k)?.slug ?? k) + ' · ' + esc(this.tilde(this.lfDir(k))) + '/evidence/</option>').join('') + '</select>'
  }
  private filesHtml(c: Card, ro = false): string {
    const fs0 = c.files ?? []
    const msel = this.filesSel && this.filesSel.card === c.id ? this.filesSel : null
    const multi = !!msel && !ro
    const n = msel ? msel.ids.size : 0
    const selRow = (f: FileRef): string => {
      const on = !!msel && msel.ids.has(f.id)
      const ty = ftype(f.path)
      return '<label class="fs-row' + (on ? ' on' : '') + '"><input type="checkbox" data-fsel="' + esc(f.id) + '"' + (on ? ' checked' : '') + ' aria-label="选中文件 ' + esc(fileName(f)) + '">'
        + this.fIcon(f, !this.exists(f.path))
        + '<span class="fn" title="' + esc(f.path) + '">' + esc(fileName(f)) + '</span>'
        + '<span class="ftag">' + (ty ? esc(ty.label) : '文件') + '</span>'
        + '<span class="fdot' + (this.exists(f.path) ? '' : ' bad') + '" aria-hidden="true"></span></label>'
    }
    const multiBody = '<div class="fs-multi"><div class="fs-multi-h"><span class="fk">已选 <b>' + n + '</b> / ' + fs0.length + '</span>'
      + '<button type="button" class="flink" data-fsel-all>' + (n === fs0.length && n ? '取消全选' : '全选') + '</button>'
      + '<span class="grow"></span><button type="button" class="flink" data-fsel-done>完成</button></div>'
      + '<div class="fs-multi-l">' + (fs0.length ? fs0.map(selRow).join('') : '<p class="meta">这张卡片还没有相关文件</p>') + '</div>'
      + '<div class="fs-multi-f"><span class="fhint">' + (n ? '解绑只断开关联 · 删除会移到废纸篓' : '勾选要处理的文件') + '</span><span class="grow"></span>'
      + '<button type="button" class="btn sm" data-fsel-unbind' + (n ? '' : ' disabled') + '>解绑</button>'
      + '<button type="button" class="btn sm danger" data-fsel-del' + (n ? '' : ' disabled') + '>删除并解绑</button></div></div>'
    const rows = multi ? multiBody
      : (fs0.length ? fs0.map((f) => this.fileRowHtml(c, f, ro)).join('') : '<p class="meta">' + (ro ? '没有相关文件。' : '还没有相关文件。点「添加文件」，可以从系统里选，也可以粘贴路径。') + '</p>')
    if (ro) return '<section class="sec" id="dpmFSec"><h3><span class="ttl">' + ic('file') + '相关文件 · ' + fs0.length + '</span></h3>' + rows + '</section>'
    const mv = this.movable(c), nn = mv.length, hasLf = this.lfKeys(c).length > 0 && !!this.snap?.landfill?.ok
    const tl = this.tolf && this.tolf.card === c.id
    const pf = this.prefs()
    const keep = mv.filter((f) => this.keepWhy(c, f.path)).length
    const bar = hasLf && !tl && !multi ? '<div class="lfbar' + (nn ? '' : ' idle') + '"><div class="lfrow">' + ic('tolf') + '<span class="txt">' + (nn ? '<b>' + nn + '</b> 个文件还不在落盘项目里' : '还在的文件都已在落盘项目里') + '</span><button type="button" class="btn ghost sm" data-tolf' + (nn ? '' : ' disabled') + '>一键放到落盘项目</button></div>' + (nn ? this.delSubHtml('dpmSwDelT', pf.delTolf, keep) : '') + '</div>' : ''
    const pick = tl ? '<div class="fa" role="region" aria-label="选择落盘项目"><div class="fa-lf" style="margin:0"><div class="txt"><b>放到哪个落盘项目？</b>' + this.lfTargetHtml(c, 'dpmTolfTo', this.lfKeys(c)[0]) + '<span>' + nn + ' 个文件会复制到 evidence/ 下，相关文件改指向复制后的路径。</span></div></div>' + this.delSubHtml('dpmSwDelT', pf.delTolf, keep) + '<div class="fa-bar"><span class="grow"></span><button type="button" class="btn sm" data-tolf-cancel>取消</button><button type="button" class="btn primary sm" data-tolf-ok>复制 ' + nn + ' 个</button></div></div>' : ''
    const multiBtn = fs0.length ? '<button type="button" class="btn ghost sm fsmulti" data-fsel-toggle aria-pressed="' + (multi ? 'true' : 'false') + '" title="多选：批量解绑 / 删除并解绑">' + (multi ? '完成' : '多选') + '</button>' : ''
    return '<section class="sec" id="dpmFSec"><h3><span class="ttl">' + ic('file') + '相关文件 · ' + fs0.length + '</span><span class="hb">' + multiBtn + (multi ? '' : this.hbtn('plus', '新增文件', 'data-fa-open aria-haspopup="dialog"')) + '</span></h3>'
      + (multi ? rows : bar + pick + rows) + '</section>'
  }
  /* ── v111：相关文件多选 / 批量解绑 / 删除并解绑 ───────────────────────── */
  private fsToggle(c: Card): void {
    if (this.filesSel && this.filesSel.card === c.id) this.filesSel = null
    else this.filesSel = { card: c.id, ids: new Set() }
    this.lastDetail = ''
    this.renderDetail()
  }
  private fsAll(c: Card): void {
    if (!this.filesSel || this.filesSel.card !== c.id) return
    const fs0 = c.files ?? []
    if (this.filesSel.ids.size === fs0.length) this.filesSel.ids.clear()
    else for (const f of fs0) this.filesSel.ids.add(f.id)
    this.lastDetail = ''
    this.renderDetail()
  }
  private fsDone(): void { this.filesSel = null; this.lastDetail = ''; this.renderDetail() }
  private fsSelNow(c: Card): string[] {
    return this.filesSel && this.filesSel.card === c.id ? [...this.filesSel.ids] : []
  }
  /** 批量解绑 / 删除并解绑：逐个走既有单文件接口（服务端串行写盘；最后的快照一次性刷新界面）。 */
  private async fsBatch(c: Card, trash: boolean): Promise<void> {
    const ids = this.fsSelNow(c)
    if (!ids.length || this.fBusy.has('batch')) return
    this.fBusy.add('batch')
    const tasks = new Set<string>()
    let snap: Snapshot | null = null
    let okN = 0
    try {
      for (const id of ids) {
        try {
          const r = await post<Snapshot & { result: { tasks?: string[] } }>(trash ? 'card/files-trash' : 'card/files-remove', { id: c.id, file: id })
          snap = r
          okN++
          for (const t of r.result.tasks ?? []) tasks.add(t)
        } catch (e) {
          this.host.toast((trash ? '删除' : '解绑') + '失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
        }
      }
    } finally {
      this.fBusy.delete('batch')
    }
    if (snap) {
      this.snap = snap
      if (this.filesSel) this.filesSel.ids.clear()
      /* 用快照里的新对象判断：c 是批处理开始前的旧引用，文件删光时它的 files 还是旧的 */
      const nc = this.card(c.id)
      if (!(nc?.files ?? []).length) this.filesSel = null
    }
    this.lastDetail = ''
    this.render()
    this.renderDetail()
    if (!okN) return
    this.host.toast((trash ? '已删除并解绑 ' : '已解绑 ') + okN + ' 个文件' + (tasks.size ? '，并从 ' + tasks.size + ' 个任务里解绑' : '')
      + (trash ? '（文件已移到废纸篓，可以在系统废纸篓里恢复）' : '（文件本身没动）'))
  }
  /** 删除并解绑的二次确认（列出文件名 + 不可恢复）。 */
  private fsDelAsk(c: Card): void {
    const ids = this.fsSelNow(c)
    if (!ids.length) return
    const names = (c.files ?? []).filter((f) => ids.includes(f.id)).map((f) => fileName(f))
    let d = document.getElementById('dpmFDel') as HTMLDialogElement | null
    if (!d) {
      d = document.createElement('dialog')
      d.id = 'dpmFDel'
      d.className = 'dpm-dialog'
      d.setAttribute('aria-labelledby', 'dpmFDelT')
      d.innerHTML = '<form method="dialog"><div class="dlg-h"><h2 id="dpmFDelT">删除文件并解绑？</h2><p>文件会移到废纸篓并解除关联，无法在插件里恢复（可去系统废纸篓找回）；卡片里的关联和任务引用会一起移除。</p></div>'
        + '<div class="dlg-b"><div class="fs-del-list" id="dpmFDelL"></div></div>'
        + '<div class="dlg-f"><span class="meta" id="dpmFDelN"></span><span class="sp"></span><button class="btn" type="button" data-fdel-cancel>取消</button><button class="btn danger" type="button" data-fdel-ok>删除并解绑</button></div></form>'
      document.body.append(d)
      d.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        if (t.closest('[data-fdel-cancel]')) { d!.close(''); return }
        if (!t.closest('[data-fdel-ok]')) return
        d!.close('ok')
        const cc = this.sel ? this.card(this.sel) : undefined
        const list = this.fDelIds ?? []
        this.fDelIds = null
        if (!cc || !list.length) return
        if (this.filesSel && this.filesSel.card === cc.id) { this.filesSel.ids = new Set(list) }
        void this.fsBatch(cc, true)
      })
    }
    this.fDelIds = ids
    const list = d.querySelector('#dpmFDelL') as HTMLElement | null
    if (list) list.innerHTML = names.map((nm) => '<div class="fs-del-row">' + ic('file') + '<b>' + esc(nm) + '</b></div>').join('')
    const note = d.querySelector('#dpmFDelN')
    if (note) note.textContent = '共 ' + names.length + ' 个 · 删除后不可恢复'
    d.returnValue = ''
    d.showModal()
  }
  // ── 添加文件弹窗 ──
  /**
   * v136–v139：会话输入框的气泡「添加为相关链接 / 相关文件 / 仓库 / 相关说明」→ 详情里同一套弹窗，预填链接 / 路径 / 说明内容；
   * 保存成功 resolve 新条目（链接 text+url、文件 name+path、仓库 name+path、说明 t+v），取消 resolve null。默认注入：链接 / 仓库 / 说明开、文件关。
   */
  addFromComposer(cardId: string, kind: 'link' | 'file' | 'repo' | 'note', prefill: string): Promise<{ text?: string; url?: string; name?: string; path?: string; t?: string; v?: string } | null> {
    const c = this.card(cardId)
    if (!c || c.archivedAt) { this.host.toast('这张卡片已经归档或不存在，不能添加', 'err'); return Promise.resolve(null) }
    if (this.root.querySelector('dialog[open]')) { this.host.toast('先关掉已经打开的窗口', 'err'); return Promise.resolve(null) }
    if (kind === 'link') return new Promise((res) => {
      this.wlAddCb = (ls) => res(ls.length ? { text: ls[0].text, url: ls[0].url } : null)
      this.wlOpen(c, 'add')
      const w = this.wl; if (w) { w.rows[0].url = prefill; this.wlRender(); (this.root.querySelector('#dpmWx0') as HTMLElement | null)?.focus() }
    })
    if (kind === 'file') return new Promise((res) => {
      this.faAddCb = (ids) => { const f = (this.card(c.id)?.files ?? []).find((x) => ids.includes(x.id)); res(f ? { name: fileName(f), path: f.path } : null) }
      this.faOpen(c)
      const ta = this.$<HTMLTextAreaElement>('#dpmFaIn'); ta.value = prefill
      if (this.fa) { this.fa.text = prefill; void this.faCheck() }
    })
    if (kind === 'repo') return new Promise((res) => {
      this.arAddCb = (r) => res(r)
      this.openAddRepo('card', c.id)
      if (this.ar) { this.arAdd(prefill); this.renderSel([prefill]) }
    })
    /* v144（1）：说明 = 任务弹窗的说明模式；任务弹窗本身开着（在任务说明里框选加说明）→ 仍用小窗口 */
    if (this.host.taskDialog && !this.host.taskDialogOpen?.()) return new Promise((res) => { this.host.taskDialog?.({ cardId: c.id, note: { k: -1, v: prefill, done: (r) => { if (r) this.noteLanded(c.id, r.t); res(r) } } }) })
    return new Promise((res) => { this.noteAddCb = res; this.openNoteAdd(c, prefill) })
  }
  /** v144（1）：说明模式保存后，详情里那一条落位闪一下。 */
  noteLanded(cid: string, t: string): void {
    void this.refresh(true).then(() => { const c = this.card(cid); const k = (c?.noteItems ?? []).findIndex((x) => x.t === t); if (k >= 0) { this.landEl('.detail .nk[data-nk="' + k + '"]'); (this.root.querySelector('.detail .nk[data-nk="' + k + '"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' }) } }).catch(() => undefined)
  }
  private arAddCb: ((r: { name: string; path: string } | null) => void) | null = null
  private noteAddCb: ((r: { t: string; v: string } | null) => void) | null = null
  /** 会话框选「添加为相关说明」：独立小弹窗（标题留空 = 取内容前 20 字，内容 = 框选原文，开关默认开）。 */
  private openNoteAdd(c: Card, v: string): void {
    let d = document.getElementById('dpmNoteAddDlg') as HTMLDialogElement | null
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dpmNoteAddDlg'; d.className = 'dpm-dialog'; d.setAttribute('aria-labelledby', 'dpmNaT')
      d.innerHTML = '<form method="dialog"><div class="dlg-h"><h2 id="dpmNaT">添加相关说明</h2><p id="dpmNaP"></p></div><div class="dlg-b"><label class="ref-l"><span>说明标题（留空 = 取内容前 20 字）</span><input class="fld" id="dpmNaA" maxlength="60" autocomplete="off"></label><label class="ref-l"><span>说明内容</span><textarea class="fld" id="dpmNaB" rows="5"></textarea></label>' + injCard('dpmNaInj', true) + '</div><div class="dlg-f"><span class="meta">保存后加到卡片「相关说明」，输入框里框选的那段换成这条说明的引用胶囊</span><span class="sp"></span><button class="btn" type="button" data-na-x>取消</button><button class="btn primary" type="button" data-na-ok>保存到卡片</button></div></form>'
      document.body.append(d)
      d.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        const sw = t.closest('[data-dpm-inj]') as HTMLElement | null
        if (sw) { e.preventDefault(); sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return }
        if (t.closest('[data-na-x]')) { d!.close(''); return }
        if (t.closest('[data-na-ok]')) void this.noteAddSave(d!)
      })
      d.addEventListener('close', () => { const cb = this.noteAddCb; this.noteAddCb = null; if (d!.returnValue !== 'ok') cb?.(null) })
      this.disposers.push(() => d?.remove())
    }
    d.dataset.card = c.id
    ;(d.querySelector('#dpmNaP') as HTMLElement).textContent = '加到卡片「' + c.t + '」。'
    ;(d.querySelector('#dpmNaA') as HTMLInputElement).value = ''
    ;(d.querySelector('#dpmNaB') as HTMLTextAreaElement).value = v
    d.querySelector('#dpmNaInj')?.setAttribute('aria-checked', 'true')
    d.returnValue = ''
    d.showModal()
    setTimeout(() => (d?.querySelector('#dpmNaA') as HTMLElement | null)?.focus(), 40)
  }
  private async noteAddSave(d: HTMLDialogElement): Promise<void> {
    const c = this.card(d.dataset.card ?? ''); if (!c) { d.close(''); return }
    const v = (d.querySelector('#dpmNaB') as HTMLTextAreaElement).value.replace(/\s+$/, '')
    if (!v.trim()) { (d.querySelector('#dpmNaB') as HTMLElement).focus(); this.host.toast('说明内容不能为空', 'err'); return }
    /* 留空标题取前 20 字时，先把里面的引用原文换成它的名字（「“DSH”（路径：…）」→ DSH） */
    const t = ((d.querySelector('#dpmNaA') as HTMLInputElement).value.trim() || v.split('\n')[0].replace(/「“([^”「」]+)”[^「」]*」/g, '$1').replace(/「([^「」：]+)：[^「」]*」/g, '$1').trim().slice(0, 20)).replace(/\s+/g, ' ')
    if ((c.noteItems ?? []).some((x) => x.t === t)) { this.host.toast('已经有一条同名说明了：' + t, 'err'); return }
    const on = d.querySelector('#dpmNaInj')?.getAttribute('aria-checked') !== 'false'
    if (!(await this.act('card/noteitems', { id: c.id, items: [...(c.noteItems ?? []), { t, v, ...(on ? {} : { off: true }) }] }, '已添加相关说明「' + t + '」· ' + (on ? '自动注入 Agent 会话' : '不注入 Agent 会话')))) return
    const cb = this.noteAddCb; this.noteAddCb = null
    d.close('ok')
    cb?.({ t, v })
  }
  /** v96：任务弹窗 → 与卡片详情同一个「添加链接」弹窗；保存后返回新加进来的链接。 */
  addLinksForTask(cardId: string): Promise<WebLink[]> {
    const c = this.card(cardId)
    if (!c) return Promise.resolve([])
    const d = this.$<HTMLDialogElement>('#dpmDlgWl')
    if (d.open) { this.host.toast('先关掉已经打开的「添加相关链接」窗口', 'err'); return Promise.resolve([]) }
    return new Promise<WebLink[]>((res) => { this.wlAddCb = res; this.wlOpen(c, 'add') })
  }
  /** v96：任务弹窗 → 与卡片详情同一个「添加文件」弹窗；保存后返回新加文件的 id。 */
  addFilesForTask(cardId: string): Promise<FileRef[]> {
    const c = this.card(cardId)
    if (!c) return Promise.resolve([])
    const d = this.$<HTMLDialogElement>('#dpmDlgFa')
    if (d.open) { this.host.toast('先关掉已经打开的「添加文件」窗口', 'err'); return Promise.resolve([]) }
    return new Promise<FileRef[]>((res) => { this.faAddCb = (ids) => res(ids.map((id) => ({ id, path: '' }))); this.faOpen(c) })
  }
  private faOpen(c: Card): void {
    this.fEdit = null; this.tolf = null
    this.fa = { card: c.id, text: '', items: [], bad: [], to: this.lfKeys(c)[0] ?? '', seq: 0, picking: false, on: false }
    this.$('#dpmFaSub').textContent = '加到卡片「' + c.t + '」。选择的和粘贴的文件都进下面的「待添加」，可以先填标题。'
    this.$<HTMLTextAreaElement>('#dpmFaIn').value = ''
    this.lastDetail = ''; this.renderDetail()
    this.faPaint()
    const d = this.$<HTMLDialogElement>('#dpmDlgFa'); d.returnValue = ''; d.showModal()
    this.$<HTMLElement>('[data-fa-pick]').focus()
  }
  private faRowHtml(c: Card, r: NonNullable<BoardView['fa']>['items'][number], i: number, on: boolean): string {
    const ty = ftype(r.path), nm = folderName(r.path)
    const tag = '<span class="from">' + (r.src === 'pick' ? '选择' : '粘贴') + '</span>' + (ty ? '<span class="ft">' + ic(ty.icon) + ty.label + '</span>' : '')
    const rm = '<button type="button" class="ib sm" data-fa-rm="' + i + '" aria-label="不添加 ' + esc(nm) + '">' + ic('x') + '</button>'
    if (r.status === 'skip') return '<li class="fa-i skip">' + ic('check') + '<span><b class="sk">' + esc(nm) + '</b><span class="p">' + tag + esc(this.tilde(r.path)) + '</span><span class="why">已经是相关文件，会跳过</span></span>' + rm + '</li>'
    return '<li class="fa-i">' + ic(ty ? ty.icon : 'file') + '<span><label class="sr-only" for="dpmFaT' + i + '">「' + esc(nm) + '」的标题（可选）</label><input class="fin" id="dpmFaT' + i + '" data-fa-t="' + i + '" value="' + esc(r.title) + '" placeholder="标题（可选，默认「' + esc(nm) + '」）" maxlength="120" autocomplete="off"><span class="p">' + tag + esc(this.tilde(r.path)) + '</span>' + (on && this.inLf(c, r.path) ? '<span class="why muted">已在落盘项目里，不再复制</span>' : '') + '</span>' + rm + '</li>'
  }
  private faPaint(): void {
    const fa = this.fa; const c = fa ? this.card(fa.card) : undefined
    if (!fa || !c) return
    const pf = this.prefs()
    const hasLf = this.lfKeys(c).length > 0 && !!this.snap?.landfill?.ok, on = hasLf && pf.lf
    const okN = fa.items.filter((r) => r.status === 'ok').length, skN = fa.items.length - okN, badN = fa.bad.length
    this.$('#dpmFaBad').innerHTML = fa.bad.map((b) => '<li>' + ic('x') + '<span class="p">' + esc(b.raw) + '</span><span class="why">' + FP_WHY[b.status] + '</span></li>').join('')
    this.$('#dpmFaListH').innerHTML = '待添加 · ' + fa.items.length + '<span class="meta">标题可选，不填就用文件名</span>'
    this.$('#dpmFaList').innerHTML = fa.items.map((r, i) => this.faRowHtml(c, r, i, on)).join('') || '<li class="fa-none">还没有文件。点「选择文件…」，或在上面粘贴路径。</li>'
    const toMove = fa.items.filter((r) => r.status === 'ok' && !this.inLf(c, r.path))
    this.$('#dpmFaLf').innerHTML = '<div class="fa-lf' + (hasLf ? '' : ' off') + '"><div class="txt"><b>放到落盘项目<span class="glob">所有卡片共用</span></b>'
      + (hasLf ? (on ? this.lfTargetHtml(c, 'dpmFaTo', fa.to) + '<span>选择的和粘贴的文件都会复制一份到这里，相关文件改成指向复制后的路径' + (pf.delAdd ? '；原文件按下面的设置处理。' : '；原文件不动。') + '</span>' : '<span>关闭：只登记原路径，不复制。</span>') + '<span class="gnote">这是全局开关：改了对所有卡片生效，并一直记住。</span>'
        : '<span>' + (this.lfKeys(c).length ? '落盘项目功能没开启，本次只登记原路径。' : '这张卡片还没有关联落盘项目，本次只登记原路径。') + '全局开关仍是「' + (pf.lf ? '开' : '关') + '」，其他卡片照常。</span>') + '</div>'
      + '<label class="sr-only" for="dpmFaLfSw">放到落盘项目（全局，对所有卡片生效）</label><input type="checkbox" role="switch" class="sw" id="dpmFaLfSw"' + (on ? ' checked' : '') + (hasLf ? '' : ' disabled') + '></div>'
      + (on ? this.delSubHtml('dpmSwDelA', pf.delAdd, toMove.filter((r) => this.keepWhy(c, r.path)).length) : '')
    this.$('#dpmFaInjSlot').innerHTML = injCard('dpmFaInj', !!fa.on)
    this.$('#dpmFaFoot').innerHTML = '<span class="meta">' + [okN ? okN + ' 个待添加' : '', skN ? skN + ' 个已关联会跳过' : '', badN ? badN + ' 行路径有问题' : ''].filter(Boolean).join('，') + '</span><span class="sp"></span><button type="button" class="btn" data-dlg-cancel>取消</button><button type="button" class="btn primary" data-fa-ok' + (okN ? '' : ' disabled') + '>' + (okN ? (on ? (pf.delAdd ? '移动文件并添加 ' : '复制并添加 ') : '添加 ') + okN + ' 个' : '添加') + '</button>'
    const pb = this.$<HTMLButtonElement>('[data-fa-pick]'); pb.disabled = fa.picking; pb.lastChild!.textContent = fa.picking ? '选择中…' : '选择文件…'
  }
  private async faCheck(): Promise<void> {
    const fa = this.fa
    if (!fa) return
    const lines = fa.text.split(/\r?\n/).filter((l) => l.trim())
    const seq = ++fa.seq
    let res: PathCheck[] = []
    if (lines.length) {
      try { res = (await post<{ results: PathCheck[] }>('card/files-check', { id: fa.card, paths: lines })).results }
      catch (e) { if (this.fa !== fa || fa.seq !== seq) return; this.host.toast('检测路径失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
    }
    if (this.fa !== fa || fa.seq !== seq) return
    const seen = new Set(res.filter((r) => r.status === 'ok' || r.status === 'linked').map((r) => r.path))
    const keep = fa.items.filter((r) => r.src === 'pick' || seen.has(r.path))
    for (const r of res) if ((r.status === 'ok' || r.status === 'linked') && !keep.some((x) => x.path === r.path)) keep.push({ path: r.path, title: '', src: 'paste', status: r.status === 'ok' ? 'ok' : 'skip' })
    fa.items = keep
    fa.bad = res.filter((r) => r.status === 'bad' || r.status === 'missing' || r.status === 'dir')
    this.faPaint()
  }
  private async faPick(): Promise<void> {
    const fa = this.fa
    if (!fa || fa.picking) return
    fa.picking = true; this.faPaint()
    try {
      const r = await post<{ cancelled: boolean; results: PathCheck[] }>('card/files-pick', { id: fa.card })
      if (this.fa !== fa) return
      const n0 = fa.items.length
      for (const x of r.results) if ((x.status === 'ok' || x.status === 'linked') && !fa.items.some((y) => y.path === x.path)) fa.items.push({ path: x.path, title: '', src: 'pick', status: x.status === 'ok' ? 'ok' : 'skip' })
      fa.picking = false; this.faPaint()
      ;((this.root.querySelector('#dpmFaT' + n0) ?? this.root.querySelector('[data-fa-pick]')) as HTMLElement | null)?.focus()
    } catch (e) {
      if (this.fa !== fa) return
      fa.picking = false; this.faPaint()
      console.warn('[dsh-project-manager] card/files-pick 失败，改为粘贴路径：', e)
      this.host.toast((e instanceof ApiError ? e.message : String(e)) + '。可以直接粘贴文件的绝对路径', 'err')
      this.$<HTMLElement>('#dpmFaIn').focus()
    }
  }
  private faRm(i: number): void {
    const fa = this.fa
    if (!fa) return
    const [r] = fa.items.splice(i, 1)
    if (r && r.src === 'paste') { fa.text = fa.text.split(/\n/).filter((l) => l.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '') !== r.path && !l.includes(r.path)).join('\n'); this.$<HTMLTextAreaElement>('#dpmFaIn').value = fa.text }
    this.faPaint()
    ;((this.root.querySelector('[data-fa-rm="' + Math.min(i, fa.items.length - 1) + '"]') ?? this.root.querySelector('[data-fa-pick]')) as HTMLElement | null)?.focus()
  }
  private async faOk(): Promise<void> {
    const fa = this.fa; const c = fa ? this.card(fa.card) : undefined
    if (!fa || !c) return
    const cb = this.faAddCb
    this.faAddCb = null
    const add = fa.items.filter((r) => r.status === 'ok')
    if (!add.length) return
    const pf = this.prefs()
    const on = this.lfKeys(c).length > 0 && !!this.snap?.landfill?.ok && pf.lf
    const k = on ? (fa.to || this.lfKeys(c)[0]) : ''
    this.$<HTMLDialogElement>('#dpmDlgFa').close()
    let r: Snapshot & { result: { added: number; ids: string[] } }
    try { r = await post('card/files-add', { id: c.id, items: add.map((x) => ({ path: x.path, title: x.title, ...(fa.on ? {} : { off: true }) })) }) } catch (e) { this.host.toast('添加失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); return }
    this.snap = r; this.render()
    if (cb) cb(r.result.ids)
    if (!on) { this.host.toast('已添加 ' + r.result.added + ' 个相关文件'); return }
    const cc = this.card(c.id) as Card
    const ids = (cc.files ?? []).filter((f) => r.result.ids.includes(f.id) && !this.inLf(cc, f.path)).map((f) => f.id)
    const res = ids.length ? await this.copyIn(cc, ids, k, pf.delAdd) : null
    this.host.toast('已添加 ' + r.result.added + ' 个相关文件' + (res ? '，' + res.done.length + ' 个复制到落盘项目「' + (this.stateOf(k)?.slug ?? k) + '」的 evidence/' + this.delMsg(res) : ''), 'ok', res && res.done.length ? { label: '撤销复制', run: () => void this.undoCopy(cc.id, res) } : undefined)
  }
  // ── 复制进落盘项目 / 撤销 ──
  /** 0.32 50–500MB 确认态：等用户在对话框里选「仍然复制 / 只记路径」。 */
  private sizePend: { card: string; ids: string[]; key: string; del: boolean; need: Array<{ id: string; path: string; name: string; size: number; hard: boolean }> } | null = null
  private fmtSize(n: number): string { return n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1) + ' GB' : (n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + ' MB' }
  private openSize(c: Card, ids: string[], key: string, del: boolean, need: Array<{ id: string; path: string; name: string; size: number; hard: boolean }>): void {
    this.sizePend = { card: c.id, ids, key, del, need }
    const first = need[0], hard = need.some((x) => x.hard)
    this.$('#dpmSzT').textContent = need.length === 1 ? '「' + first.name + '」' + this.fmtSize(first.size) + '，超过落盘项目的默认上限' : need.length + ' 个文件超过落盘项目的默认上限'
    this.$('#dpmSzP').textContent = '落盘项目文件夹是文字记忆仓库：复制、sha256 回读校验、合并、备份都会整份读。大文件放进去会让记忆文件夹变重、变慢。'
    this.$('#dpmSzFile').innerHTML = '<span class="szic">' + ic('file') + '</span><div><b>' + esc(first.name) + '</b><span>' + esc(this.tilde(first.path)) + ' · ' + this.fmtSize(first.size) + '</span></div>' + (need.length > 1 ? '<span class="meta">等 ' + need.length + ' 个</span>' : '')
    const copy = this.$<HTMLInputElement>('#dpmSzCopy'), path = this.$<HTMLInputElement>('#dpmSzPath')
    copy.disabled = hard
    copy.closest('.szopt')?.classList.toggle('dis', hard)
    copy.checked = !hard
    path.checked = hard
    this.$('#dpmSzNote').textContent = hard ? '超过 500MB 的文件只能只记路径，不再复制' : '超过 50MB 的文件都会先问一次，不再直接失败'
    const d = this.$<HTMLDialogElement>('#dpmDlgSize')
    d.returnValue = ''
    d.onclose = () => { if (!this.sizePend || this.sizePend.card === c.id) this.sizePend = null }
    this.$('#dpmSzOk').onclick = () => { void this.sizeConfirm() }
    d.showModal()
  }
  private async sizeConfirm(): Promise<void> {
    const p = this.sizePend
    const mode = this.$<HTMLInputElement>('input[name="dpmSz"]:checked')?.value ?? 'path'
    const d = this.$<HTMLDialogElement>('#dpmDlgSize')
    d.close()
    this.sizePend = null
    if (!p) return
    const c = this.card(p.card)
    if (!c) return
    const r = await this.copyIn(c, p.ids, p.key, p.del, { allowLarge: mode === 'copy', pathOnly: mode === 'path' })
    if (r) this.host.toast(mode === 'copy' ? '已复制 ' + r.done.length + ' 个文件到落盘项目' : '已只记路径' + (r.skipped.length ? '（' + r.skipped.length + ' 个超过 50MB 的文件没有复制）' : ''), 'ok')
  }
  private async copyIn(c: Card, ids: string[], key: string, del: boolean, opts: { allowLarge?: boolean; pathOnly?: boolean } = {}): Promise<{ done: Array<{ id: string; from: string; to: string; trashed?: string; kept?: string }>; failed: Array<{ path: string; error: string }>; skipped: Array<{ id: string; path: string; name: string; size: number; reason: 'path' | 'hard' }> } | null> {
    ids.forEach((id) => this.fBusy.add(id)); this.lastDetail = ''; this.renderDetail()
    try {
      const r = await post<Snapshot & { result: { done: Array<{ id: string; from: string; to: string; trashed?: string; kept?: string }>; failed: Array<{ path: string; error: string }>; skipped?: Array<{ id: string; path: string; name: string; size: number; reason: 'path' | 'hard' }>; need?: Array<{ id: string; path: string; name: string; size: number; hard: boolean }> } }>('card/files-tolf', { id: c.id, files: ids, key, del, ...opts })
      ids.forEach((id) => this.fBusy.delete(id))
      this.snap = r; this.render()
      if (r.result.need?.length) { this.openSize(c, ids, key, del, r.result.need); return null }
      r.result.done.forEach((x) => this.landEl('.detail .frow-f[data-fid="' + CSS.escape(x.id) + '"]'))
      if (r.result.failed.length) this.host.toast(r.result.failed.length + ' 个文件没复制成功：' + r.result.failed.map((x) => folderName(x.path) + '（' + x.error + '）').join('；'), 'err')
      if (r.result.skipped?.length) this.host.toast(r.result.skipped.length + ' 个超过 50MB 的文件只记路径，没有复制', 'ok')
      return { done: r.result.done, failed: r.result.failed, skipped: r.result.skipped ?? [] }
    } catch (e) {
      ids.forEach((id) => this.fBusy.delete(id)); this.lastDetail = ''; this.renderDetail()
      this.host.toast('放到落盘项目失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
      return null
    }
  }
  private delMsg(r: { done: Array<{ trashed?: string; kept?: string }> }): string {
    const n = r.done.filter((x) => x.trashed).length
    const kept = r.done.filter((x) => x.kept).map((x) => x.kept as string)
    return (n ? '，' + n + ' 个原文件已移到废纸篓' : '') + (kept.length ? '，' + kept.length + ' 个原文件保留（' + [...new Set(kept)].join('、') + '）' : '')
  }
  private async undoCopy(cardId: string, r: { done: Array<{ id: string; from: string; trashed?: string }> }): Promise<void> {
    try {
      const x = await post<Snapshot & { result: { restored: number } }>('card/files-untolf', { id: cardId, items: r.done.map((d) => ({ id: d.id, from: d.from, ...(d.trashed ? { trashed: d.trashed } : {}) })) })
      this.snap = x; this.render()
      this.host.toast('已撤销：相关文件改回原路径' + (x.result.restored ? '，原文件已从废纸篓放回' : ''))
    } catch (e) { this.host.toast('撤销失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); await this.refresh() }
  }
  private async tolfRun(c: Card, key: string): Promise<void> {
    const ids = this.movable(c).map((f) => f.id)
    this.tolf = null
    const gone = (c.files ?? []).filter((f) => !this.exists(f.path)).length
    const r = await this.copyIn(c, ids, key, this.prefs().delTolf)
    if (r) this.host.toast('已把 ' + r.done.length + ' 个文件复制到「' + (this.stateOf(key)?.slug ?? key) + '」的 evidence/，相关文件改指向新路径' + this.delMsg(r) + (gone ? '；' + gone + ' 个已删除的没动' : ''), 'ok', r.done.length ? { label: '撤销', run: () => void this.undoCopy(c.id, r) } : undefined)
  }
  private async setPref(k: keyof Prefs, v: boolean): Promise<void> {
    if (this.snap) this.snap.board.prefs = { ...this.prefs(), [k]: v }
    try { const r = await post<Snapshot>('prefs/set', { [k]: v }); this.snap = r } catch (e) { this.host.toast('保存开关失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); await this.refresh() }
  }
  private fBlur(): void { const ae = document.activeElement as HTMLElement | null; if (ae?.id === 'dpmFT') ae.blur() }
  private async fSave(): Promise<void> {
    const e = this.fEdit; const c = e ? this.card(e.card) : undefined
    if (!e || !c) return
    const f = (c.files ?? []).find((x) => x.id === e.id)
    this.fEdit = null
    this.fBlur()
    if (!f) { this.lastDetail = ''; this.renderDetail(); return }
    const v = e.v.replace(/\s+/g, ' ').trim()
    // v136：编辑卡里的「自动注入 Agent 会话」开关
    if (e.on !== undefined && e.on === !!f.off) await this.act('card/files-off', { id: c.id, file: f.id, on: e.on }, e.on ? '已打开「' + fileName(f) + '」的自动注入 Agent 会话' : '已关闭「' + fileName(f) + '」的自动注入：会话的卡片档案里不再出现；引用 / 打开照常')
    if (v === (f.title ?? '') || (v === folderName(f.path) && !f.title)) { this.lastDetail = ''; this.renderDetail(); return }
    // 0.26.1：先按新标题画出普通行（不等回包，回包慢时界面不会停在编辑态）；失败时 act 会拉回服务器数据
    const old = f.title
    f.title = v && v !== folderName(f.path) ? v : undefined
    this.lastDetail = ''; this.renderDetail()
    f.title = old
    this.quietFocus('.frow-f[data-fid="' + CSS.escape(f.id) + '"]')
    if (await this.act('card/files-title', { id: c.id, file: f.id, title: v }, v && v !== folderName(f.path) ? '标题已改成「' + v + '」' : '已清空标题，显示文件名')) this.quietFocus('.frow-f[data-fid="' + CSS.escape(f.id) + '"]', false)
  }
  /** 0.28 删除文件：移到废纸篓 + 解除关联（任务一起解绑）；撤销 = 从废纸篓放回原处 + 重新关联。 */
  private async fTrash(c: Card, id: string): Promise<void> {
    try {
      const r = await post<Snapshot & { result: { file: FileRef; index: number; tasks: string[]; trashed: string } }>('card/files-trash', { id: c.id, file: id })
      this.snap = r; this.render()
      const x = r.result
      this.host.toast('已把「' + fileName(x.file) + '」移到废纸篓并解除关联' + (x.tasks.length ? '，' + x.tasks.length + ' 个任务同时解绑' : ''), 'ok', { label: '撤销', run: () => void this.act('card/files-untrash', { id: c.id, file: x.file, index: x.index, tasks: x.tasks, trashed: x.trashed }, '已从废纸篓放回「' + fileName(x.file) + '」') })
    } catch (e) { this.host.toast('删除失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); await this.refresh() }
  }
  private async fUnlink(c: Card, id: string): Promise<void> {
    try {
      const r = await post<Snapshot & { result: { file: FileRef; index: number; tasks: string[] } }>('card/files-remove', { id: c.id, file: id })
      this.snap = r; this.render()
      const x = r.result
      this.host.toast('已解除关联「' + fileName(x.file) + '」' + (x.tasks.length ? '，并从 ' + x.tasks.length + ' 个任务里解绑' : '') + '，文件本身没动', 'ok', { label: '撤销', run: () => void this.act('card/files-restore', { id: c.id, file: x.file, index: x.index, tasks: x.tasks }, '已恢复「' + fileName(x.file) + '」') })
    } catch (e) { this.host.toast(e instanceof ApiError ? e.message : String(e), 'err'); await this.refresh() }
  }

  // ── 事件 ──
  private on<K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, capture = false): void {
    el.addEventListener(type, fn as EventListener, capture)
    this.disposers.push(() => el.removeEventListener(type, fn as EventListener, capture))
  }
  private $<T extends HTMLElement = HTMLElement>(sel: string): T { return this.root.querySelector(sel) as T }

  private bind(): void {
    const r = this.root
    // 输入模态：capture 阶段先记来源，供 render 后决定要不要把焦点环还给按钮
    this.on(r, 'keydown', () => { this.kbd = true }, true)
    this.on(r, 'pointerdown', () => { this.kbd = false }, true)
    this.on(r, 'click', (e) => void this.onClick(e))
    /* v111：相关文件多选的复选框（勾选 / 取消都即时重画计数与动作按钮） */
    this.on(r, 'change', (e) => {
      const cb = (e.target as HTMLElement).closest?.('[data-fsel]') as HTMLInputElement | null
      if (!cb) return
      const c = this.sel ? this.card(this.sel) : undefined
      if (!c || !this.filesSel || this.filesSel.card !== c.id) return
      const id = cb.dataset.fsel as string
      if (cb.checked) this.filesSel.ids.add(id)
      else this.filesSel.ids.delete(id)
      this.lastDetail = ''
      this.renderDetail()
    })
    this.on(r, 'dblclick', (e) => {
      const el = e.target as HTMLElement
      const c = this.sel ? this.card(this.sel) : undefined
      if (!c || c.archivedAt) return
      const tx = el.closest?.('.detail .task .tx') as HTMLElement | null
      const tn = el.closest?.('.detail .task .tn') as HTMLElement | null
      const row = (tx ?? tn)?.closest('[data-tid]') as HTMLElement | null
      // v94：编辑统一走弹窗；只有旧 host 没有 taskDialog 时才回退到原地编辑
      if (row && !row.classList.contains('editing') && !this.host.taskDialog) { e.preventDefault(); this.taskEditOpen(c, row.dataset.tid as string, '', tn ? 'note' : 'title') }
    })
    // 0.24 点编辑卡外面 = 保存（在 click / change 之后执行，不吞掉这次点击）；按住「[[」菜单项不让说明框失焦
    let outDown: unknown = null
    this.on(r, 'pointerdown', (e) => { const el = e.target as HTMLElement; outDown = this.taskEdit && !el.closest?.('.task.editing, dialog, .dpm-toasts') ? this.taskEdit : null }, true)
    this.on(r, 'pointerdown', (e) => { const el = e.target as HTMLElement; if (this.tkAdd && !this.tkAdd.v.trim() && !el.closest?.('.kadd, [data-tk-kadd]')) setTimeout(() => this.kaddClose()) }, true)
    this.on(r, 'click', () => { const o = outDown; outDown = null; if (o) setTimeout(() => { if (this.taskEdit === o) this.taskEditSave(true) }) })
    this.on(r, 'mousedown', (e) => { const it = (e.target as HTMLElement).closest?.('[data-tk-pref]') as HTMLElement | null; const c = this.sel ? this.card(this.sel) : undefined; if (it && c) { e.preventDefault(); this.tkPickRef(c, it.dataset.tkPref as string) } else if ((e.target as HTMLElement).closest?.('[data-tk-ref]')) e.preventDefault() })
    for (const ev of ['keyup', 'mouseup', 'select'] as const) this.on(r, ev, (e) => { const t = e.target as HTMLTextAreaElement; if (t.id === 'dpmTaskNote') this.tkCaret = [t.selectionStart, t.selectionEnd] })
    this.on(r, 'input', (e) => this.onInput(e))
    this.on(r, 'compositionstart', () => { this.composing = true })
    this.on(r, 'compositionend', (e) => { this.composing = false; this.onInput(e); if (this.pushPend && !this.pushT) this.pushT = window.setTimeout(() => this.pushFlush(), 0) })
    /* v121（5）：焦点离开输入框后补一次被推迟的重画 */
    this.on(r, 'focusout', () => { if (this.pushPend && !this.pushT) this.pushT = window.setTimeout(() => this.pushFlush(), 0) })
    this.on(r, 'focusout', (e) => this.onFocusOut(e))
    this.on(r, 'change', (e) => void this.onChange(e))
    this.on(r, 'submit', (e) => void this.onSubmit(e))
    this.on(r, 'keydown', (e) => void this.onKey(e))
    // v98 ⑤：卡片拖动 = pointer 自绘（取代原生 HTML5 拖放：延迟、拖影偏移、列头/列底/添加按钮是死区）
    this.on(r, 'pointerdown', (e) => this.cdDown(e as PointerEvent))
    this.on(r, 'pointermove', (e) => { if (this.cd) this.cdMove(e as PointerEvent) })
    this.on(r, 'pointerup', () => { if (this.cd) void this.cdStop(true) })
    this.on(r, 'pointercancel', () => { if (this.cd) void this.cdStop(false) })
    // 拖动结束后浏览器补的那一次 click 要被吃掉（否则松手就误开详情）
    this.on(r, 'click', (e) => { if (!this.cdMute) return; this.cdMute = false; e.stopPropagation(); e.preventDefault() }, true)
    this.on(window, 'dpm-panel' as 'focus', () => this.paintSt())
    if (!panelCached()) void getGantt().then((g) => setPanelCache(g)).catch(() => undefined)
    this.on(r, 'pointerdown', (e) => { if (!this.tkDown(e) && !this.xdDown(e) && !this.ndDown(e) && !this.tdDown(e) && !this.wdDown(e)) this.gdDown(e) })
    this.on(r, 'pointermove', (e) => { if (this.tkd) this.tkMove(e); else if (this.nd) this.ndMove(e); else if (this.td) this.tdMove(e); else if (this.wd) this.wdMove(e); else this.gdMove(e) })
    this.on(r, 'pointerup', () => { if (!this.tkStop(true) && !this.ndStop(true) && !this.tdStop(true) && !this.wdStop(true)) this.gdStop(true) })
    this.on(r, 'pointercancel', () => { if (!this.tkStop(false) && !this.ndStop(false) && !this.tdStop(false) && !this.wdStop(false)) this.gdStop(false) })
    this.on(r, 'lostpointercapture', () => { if (!this.tkStop(false) && !this.ndStop(false) && !this.tdStop(false) && !this.wdStop(false)) this.gdStop(false) })
    this.on(r, 'paste', (e) => this.onPaste(e))
    // v94：任务项不再悬停展开（鼠标路过不闪开）——展开 / 收起只由「查看详情」和分区标题栏控制。
    this.on(document, 'mouseleave', () => { this.hoverOut() })
    // 0.28 会话通栏悬停展开：只认鼠标真的在动（滚动时内容从指针下滑过不触发）；开着弹窗、指针在浮层上时不收起。
    // 0.30.1：分区不再悬停展开（改成点标题栏），这里只剩会话通栏。
    this.on(document, 'pointermove', (e) => {
      this.ptr = [e.clientX, e.clientY]
      if (!e.movementX && !e.movementY) return
      const det = this.root.querySelector('.detail')
      if (!det) return
      const el = e.target as HTMLElement
      const keep = !!document.querySelector('dialog[open]') || !!el.closest?.('.dpm-pop, .dpm-toasts')
      const pin = det.querySelector('#dpmPin')
      if (pin) { if (pin.contains(el)) { if (!this.sessOpen) this.pinSet(true) } else if (this.sessOpen && !keep) this.pinSet(false) }
    })
    this.on(document, 'scroll', (e) => { const t = e.target; if (t instanceof HTMLElement && t.matches('.dpm .detail .d-b')) this.stuck(t) }, true)
    this.on(r, 'mouseover', (e) => { const dh = (e.target as HTMLElement).closest?.('.detail .d-h'); if (dh && !dh.contains(e.relatedTarget as Node | null)) this.titleMq(true) })
    this.on(r, 'mouseout', (e) => { const dh = (e.target as HTMLElement).closest?.('.detail .d-h'); if (dh && !dh.contains(e.relatedTarget as Node | null)) this.titleMq(false) })
    // 0.26 按住卡片组手柄拖动不选中文字（pointerdown 的 preventDefault 挡不住选区，要在 mousedown 挡）
    this.on(r, 'mousedown', (e) => { if ((e.target as HTMLElement).closest?.('[data-gdrag]')) e.preventDefault() })
    this.on(document, 'selectstart', (e) => { if (this.gd) e.preventDefault() })
    // 0.21 相关链接：悬停 / 聚焦整行 → 按钮展开完（330ms）后标题放不下就走马灯；离开复原
    const wlOn = (row: HTMLElement): void => { clearTimeout(this.wlMq.get(row)); this.wlMq.set(row, window.setTimeout(() => { const t = row.querySelector('.wl-a .t') as HTMLElement | null; if (t && row.isConnected) mqStart(t) }, 330)) }
    const wlOff = (row: HTMLElement): void => { if (row.matches(':hover') || row.querySelector(':focus-visible')) return; clearTimeout(this.wlMq.get(row)); const t = row.querySelector('.wl-a .t') as HTMLElement | null; if (t) mqStop(t) }
    const wlRow = (n: EventTarget | null): HTMLElement | null => (n instanceof Element ? n.closest('.detail .wl') as HTMLElement | null : null)
    this.on(r, 'mouseover', (e) => { const w = wlRow(e.target); if (w && !w.contains(e.relatedTarget as Node | null)) wlOn(w) })
    this.on(r, 'mouseout', (e) => { const w = wlRow(e.target); if (w && !w.contains(e.relatedTarget as Node | null)) setTimeout(() => wlOff(w)) })
    this.on(r, 'focusin', (e) => { const w = wlRow(e.target); if (w) wlOn(w) })
    this.on(r, 'focusout', (e) => { const w = wlRow(e.target); if (w && !w.contains(e.relatedTarget as Node | null)) setTimeout(() => wlOff(w)) })
    // 0.15 候选仓库：吸顶标题 + 分组切换高亮（scroll 不冒泡，挂在列表上）
    this.on(this.$('#dpmArList'), 'scroll', () => { if (!this.arStickRaf) this.arStickRaf = requestAnimationFrame(() => { this.arStickRaf = 0; this.arStick() }) })
    for (const id of ['dpmDlgRm', 'dpmDlgSt', 'dpmDlgName', 'dpmDlgLink', 'dpmDlgImp', 'dpmDlgRepo', 'dpmDlgSess', 'dpmDlgCfm', 'dpmDlgSArc', 'dpmDlgWl', 'dpmDlgTy', 'dpmDlgFa', 'dpmDlgSize']) {
      const d = this.$<HTMLDialogElement>('#' + id)
      this.on(d, 'close', () => void this.onDialogClose(id, d))
    }
    /* v142（2.2）：管理类型 = 居中模态；点遮罩关闭；Esc 先退编辑再关闭 */
    { const d = this.$<HTMLDialogElement>('#dpmDlgTy'); this.on(d, 'click', (e) => { if (e.target === d) d.close('') }); this.on(d, 'cancel', (e) => { const y = this.ty; if (y && (y.sub || y.edit || y.confirm || y.adding)) { e.preventDefault(); y.sub = null; y.edit = null; y.confirm = null; y.adding = null; y.err = ''; this.typesRender() } }) }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    // v86：日程模式下这块 DOM 归 SchedView 管，别再走看板的动作分发
    //（曾经因为甘特项目名按钮带 data-open-card，被这里当成「新建会话」，点个项目就冒会话）。
    if (this.mode === 'sched') return
    // 0.30.1（v65）：点分区标题栏展开 / 收起 —— 整条标题栏都算点按区；标题栏里的按钮 / 输入框仍只做自己的事
    const sh = (e.target as HTMLElement).closest('.detail .d-b .sec.cl > h3') as HTMLElement | null
    if (sh && !(e.target as HTMLElement).closest('button, a, input, select, textarea, .h3-acts')) {
      const sec = sh.parentElement as HTMLElement
      if (sec.classList.contains('x')) this.secClose(sec); else this.secOpen(sec)
      return
    }
    /* v141（3.1）：整条说明卡都能点开气泡窗（开关、抓手、悬停按钮除外） */
    const nkr = this.dp ? (e.target as HTMLElement).closest('.detail .nk[data-nk]:not(.editing)') as HTMLElement | null : null
    if (nkr && this.dp && !(e.target as HTMLElement).closest('.nksw, .nk-acts, .ngrip, .npin, a, input, textarea')) {
      const nm = nkr.querySelector('.nk-t')?.textContent ?? ''
      if (nm) { e.preventDefault(); this.dp.open('note', nm); return }
    }
    const t = (e.target as HTMLElement).closest('button, [role="button"]') as HTMLElement | null
    const area = (e.target as HTMLElement).closest('[data-toggle-area]') as HTMLElement | null
    if (area && (!t || !area.contains(t))) return this.toggleGroup(area.dataset.toggleArea as string)
    if (!t || !this.root.contains(t)) return
    const d = t.dataset
    if (d.dpmSt !== undefined) { e.preventDefault(); e.stopPropagation(); const ks = d.dpmSt.split(','); if (this.host.seek) this.host.seek(ks); else this.seekToday(ks); return }
    if (d.dpmInj !== undefined) {
      e.preventDefault()
      const on = t.getAttribute('aria-checked') !== 'true'
      t.setAttribute('aria-checked', String(on))
      if (t.id === 'dpmFInj' && this.fEdit) this.fEdit.on = on
      if (t.id === 'dpmNkInj' && this.noteEdit) this.noteEdit.on = on
      if (t.id === 'dpmRInj' && this.rEdit) this.rEdit.on = on
      if (t.id === 'dpmRpInj' && this.rp) this.rp.off = !on
      if (t.id === 'dpmWlInj' && this.wl) this.wl.off = !on
      if (t.id === 'dpmFaInj' && this.fa) this.fa.on = on
      if (t.id === 'dpmArInj' && this.ar) this.ar.on = on
      return
    }
    if (d.dpmSw !== undefined) { e.preventDefault(); const on = swToggle(); this.host.toast(on ? '排今天：开 —— 新建的任务保存后直接进今天的「未安排」和本日计划清单（记住）' : '排今天：关'); return }
    if (d.dupForce !== undefined) {
      const nd = this.$<HTMLDialogElement>('#dpmDlgName')
      if (nd?.open) { this.nameForce = true; this.$<HTMLButtonElement>('#dpmNameOk').click(); return }
      this.addForce = true
      void this.submitCard()
      return
    }
    if (d.dupOpen) { const parts = String(d.dupOpen).split(':'); this.openDupTarget(parts[0], parts.slice(1).join(':')); return }
    if (d.bqcard) { this.openDupTarget('card', d.bqcard); return }
    if (d.bqgroup) { void this.openGroupFromSearch(d.bqgroup); return }
    if (t.id === 'dpmNameOk' && this.nameTarget.startsWith('group') && !this.nameForce) {
      const nv = (this.$<HTMLInputElement>('#dpmNameInput').value || '').trim()
      if (nv) { const nx = this.dedupe(nv); if (nx.exact) { e.preventDefault(); this.flashDup('#dpmNameDup'); this.host.toast('已存在同名' + (nx.exact.kind === 'group' ? '卡片组' : '卡片') + '「' + nx.exact.name + '」：点「仍要新建」才会建', 'err'); return } }
    }
    const c = this.sel ? this.card(this.sel) : undefined
    // v136：详情各项「自动注入 Agent 会话」开关（行内）+ 弹窗 / 编辑卡里的开关卡
    if (d.dpmIsw !== undefined && c) { e.preventDefault(); e.stopPropagation(); await this.injToggle(c, d.dpmIsw); return }
    if (d.rEdit !== undefined && c) { const i = Number(d.rEdit); const r = (c.repos ?? [])[i]; if (!r) return; this.rEdit = { card: c.id, i, v: r.name, on: !r.off }; this.lastDetail = ''; this.renderDetail(); const x = this.root.querySelector('#dpmRN') as HTMLInputElement | null; if (x) { x.focus(); x.select() } return }
    if (d.rSave !== undefined) { await this.rSave(); return }
    if (d.rCancel !== undefined) { this.rEdit = null; this.lastDetail = ''; this.renderDetail(); return }
    if (d.dlgCancel !== undefined) { (t.closest('dialog') as HTMLDialogElement | null)?.close('cancel'); return }
    if (d.allOpen !== undefined) return this.bulkCollapse('open')
    if (d.allFold !== undefined) return this.bulkCollapse('fold')
    if (d.onlyLive !== undefined) return this.bulkCollapse('only')
    if (d.gar !== undefined) { this.garOpen = !this.garOpen; this.render(); if (this.garOpen) (this.root.querySelector('.board-wrap') as HTMLElement).scrollTop = 0; return }
    if (d.gUnarch) { e.stopPropagation(); return this.unarchiveGroup(d.gUnarch) }
    if (d.grPeek) { if (this.garPeek.has(d.grPeek)) this.garPeek.delete(d.grPeek); else this.garPeek.add(d.grPeek); this.render(); (this.root.querySelector('[data-gr-peek="' + CSS.escape(d.grPeek) + '"]') as HTMLElement | null)?.focus({ preventScroll: true }); return }
    if (d.gArch) return this.archiveGroup(d.gArch)
    if (t.getAttribute('aria-disabled') === 'true') return
    if (d.pend && t.getAttribute('aria-disabled') !== 'true') { e.stopPropagation(); e.preventDefault(); return this.pendCard(d.pend, d.pendOn !== '0') }
    if (d.card && (t.classList.contains('card') || t.classList.contains('pcard'))) { e.stopPropagation(); return this.showDetail(d.card) }
    if (d.dup) { e.stopPropagation(); return this.dupCard(d.dup) }
    if (d.archiveCard) return this.archiveCard(d.archiveCard)
    if (d.unarchiveCard) return this.unarchiveCard(d.unarchiveCard)
    if (d.tray) return this.toggleTray(d.tray)
    if (d.archiveSess) return this.archiveSession(d.archiveSess)
    if (d.noteMore) {
      const id = d.noteMore
      if (this.noteOpen.has(id)) this.noteOpen.delete(id); else this.noteOpen.add(id)
      this.lastDetail = ''
      this.renderDetail()
      const b = this.root.querySelector('[data-note-more="' + CSS.escape(id) + '"]') as HTMLElement | null
      if (b) { b.focus({ preventScroll: true }); if (!this.noteOpen.has(id)) b.closest('.sec')?.scrollIntoView({ block: 'nearest' }) }
      return
    }
    if (d.more === 'sess' || d.more === 'mem') {
      const k = d.more
      this.more[k] = !this.more[k]
      this.renderDetail()
      const b = this.root.querySelector('[data-more="' + k + '"]') as HTMLElement | null
      if (b) { b.focus({ preventScroll: true }); if (!this.more[k]) b.closest('.sec')?.scrollIntoView({ block: 'nearest' }) }
      return
    }
    if (d.wlAdd !== undefined && c) return this.wlOpen(c, 'add')
    if (d.types !== undefined) { if (this.taskEdit && d.types !== 'task') this.taskEditSave(true); return this.typesOpen(d.types === 'task' ? 'task' : 'link') }
    if (this.ty && t.closest('#dpmDlgTy')) {
      const y = this.ty
      const tyName = (t.closest('[data-ty]') as HTMLElement | null)?.dataset.ty
      const gid = (t.closest('[data-tgid]') as HTMLElement | null)?.dataset.tgid
      if (d.tyCancel !== undefined) { y.edit = null; y.confirm = null; y.adding = null; y.err = ''; this.typesRender(); return }
      if (d.tySave !== undefined) return this.tySave()
      if (d.tyAdd !== undefined) return this.typeAdd()
      if (d.tyConfirm !== undefined) { if (y.confirm) await this.tyDelete(y.confirm); return }
      if (t.id === 'dpmTgAdd') return this.tgAdd()
      if (d.tySubadd !== undefined && tyName) { y.sub = { t: tyName, k: d.tySubadd as 'd' | 't' }; y.edit = null; y.confirm = null; y.adding = null; this.typesRender(); return }
      if (d.tySubx !== undefined) { y.sub = null; this.typesRender(); return }
      if (d.tySubok !== undefined) return this.tySubCommit()
      if (d.tyRm !== undefined && tyName) { const k = d.tyRm, v = d.v ?? ''; const n = k === 't' ? this.cards.reduce((a, cc) => a + (cc.webLinks ?? []).filter((l) => l.type === tyName && l.tag === v).length, 0) : 0; const r = await this.tyPost(k === 'd' ? 'linktype/domain-remove' : 'linktype/tag-remove', k === 'd' ? { type: tyName, domain: v } : { type: tyName, tag: v }); if (!r) return; this.typesRender(); this.host.toast(k === 'd' ? '已删除「' + tyName + '」的网址 ' + v : '已删除标签「' + v + '」' + (n ? '（' + n + ' 条链接回到只显示「' + tyName + '」）' : '')); return }
      y.err = ''
      if (d.tyEdit !== undefined && tyName) { y.edit = { kind: 't', key: tyName }; y.confirm = null; y.adding = null; this.typesRender('#dpmTyEd'); return }
      if (d.tyDel !== undefined && tyName) { const k: TyKey = { kind: 't', key: tyName }; if (!this.typeUse(tyName)) return this.tyDelete(k); y.confirm = k; y.edit = null; y.adding = null; this.typesRender('[data-ty-confirm]'); return }
      if (d.tgEdit !== undefined && gid) { y.edit = { kind: 'g', key: gid }; y.confirm = null; y.adding = null; this.typesRender('#dpmTyEd'); return }
      if (d.tgDel !== undefined && gid) { const k: TyKey = { kind: 'g', key: gid }; if (!this.tyTypes(gid).length) return this.tyDelete(k); y.confirm = k; y.edit = null; y.adding = null; this.typesRender('[data-ty-confirm]'); return }
      if (d.tgPlus !== undefined && gid) { y.adding = gid; y.edit = null; y.confirm = null; this.typesRender('#dpmTyNew'); return }
    }
    if (d.delSess) { const v = this.sessIndex().get(d.delSess); if (v) await this.host.deleteSession(v.id, v.title); return }
    if (d.wlEdit !== undefined && c) return this.wlOpen(c, 'edit', Number(d.wlEdit))
    if (d.wstar !== undefined && this.wl) { const r = this.wl.rows[Number(d.wstar)]; if (r) { r.star = !r.star; t.setAttribute('aria-pressed', String(r.star)); (t.querySelector('span') as HTMLElement).textContent = r.star ? '已加星标' : '加星标' } return }
    if (d.wlStar !== undefined && c) { e.preventDefault(); e.stopPropagation(); const l = (c.webLinks ?? [])[Number(d.wlStar)]; if (!l?.id) return; const on = !l.star; if (!(await this.act('card/link-star', { id: c.id, link: l.id, on }))) return; this.host.toast(on ? '已给「' + l.text + '」加星标：金色，并置顶到「' + (l.type || '无类型') + '」组的星标最下面' : '已去掉「' + l.text + '」的星标（排到本组星标后面）'); requestAnimationFrame(() => { const row = this.root.querySelector('.detail [data-wlid="' + CSS.escape(l.id as string) + '"]') as HTMLElement | null; const b = row?.querySelector('.dpm-sb') as HTMLElement | null; if (b) { b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 560); b.focus({ preventScroll: true }) } if (row) { row.classList.add('dpm-land'); setTimeout(() => row.classList.remove('dpm-land'), 900) } }); window.dispatchEvent(new Event('dpm-gold')); return }
    if (d.wlDel !== undefined && c) return this.wlDelete(c, Number(d.wlDel))
    if (d.wlMore !== undefined && this.wl) { const last = this.wl.rows[this.wl.rows.length - 1]; this.wl.rows.push(this.blankRow(last?.type)); this.wlRender(); (this.root.querySelector('#dpmWx' + (this.wl.rows.length - 1)) as HTMLElement | null)?.focus(); return }
    if (d.wlRm !== undefined && this.wl) { this.wl.rows.splice(Number(d.wlRm), 1); this.wlRender(); return }
    if (t.id === 'dpmWlOk') return this.wlSave()
    if (d.wlDupEdit !== undefined && this.wl) {
      // 直接编辑已添加的那条（本次未保存的输入作废）
      const c = this.card(this.wl.card)
      if (!c) return
      this.wlOpen(c, 'edit', Number(d.wlDupEdit))
      this.$('#dpmWlP').textContent = '这是之前已添加的那条链接，改完点保存。'
      ;(this.root.querySelector('#dpmWx0') as HTMLElement | null)?.focus()
      return
    }
    if (d.wlDupBack !== undefined) { const i = this.root.querySelector('#dpmWu' + d.wlDupBack) as HTMLInputElement | null; i?.focus(); i?.select(); return }
    if (d.copyUrl !== undefined) {
      const url = d.copyUrl
      try { await navigator.clipboard.writeText(url) } catch (e) { this.host.toast('复制失败：' + (e instanceof Error ? e.message : String(e)), 'err'); return }
      t.classList.add('copied'); setTimeout(() => t.classList.remove('copied'), 1200)
      this.host.toast('已复制完整链接：' + url)
      return
    }
    if (d.card) { if (!this.opts.detailOnly) openGlobalDetail(this.host, d.card); if (this.sel !== d.card) { this.secOpenSet.clear(); this.sessArc = false; this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null; this.back = null; this.tkDetail = null; this.tkViewOpen.clear(); this.tkViewClosed.clear(); this.fEdit = null; this.tolf = null } this.sel = d.card; this.render(); (this.root.querySelector('[data-card="' + d.card + '"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return }
    if (d.close !== undefined) { this.sel = null; this.noteEdit = null; this.fEdit = null; this.tolf = null; this.rp = null; this.back = null; return this.render() }
    if (d.themeToggle !== undefined) { this.host.setDark(!this.host.isDark()); return }
    if (d.toggle) return this.toggleGroup(d.toggle)
    if (d.gdrag) return
    if (d.newIn) return this.host.pickCard(t, d.newIn)
    if (d.openCard !== undefined && c) { if (this.creating) return; await this.host.newSession(c.id); if (c.pending) await this.pendCard(c.id, false); return }
    if (d.lfRecall !== undefined && c) return this.lfSend(c, '回忆')
    if (d.lfPersist !== undefined && c) return this.lfSend(c, '落盘项目')
    if (d.lfUpgrade !== undefined) {
      if (this.upgrading || !window.confirm('升级 ~/.ai/tools/ai-memory？\n\n会先把现有的备份到插件数据目录，再换成插件自带的新版（只新增 import / version 命令）。')) return
      this.upgrading = true; this.render()
      try { await this.act('landfill/upgrade-tool', {}, '已升级 ai-memory（原文件已备份）') } finally { this.upgrading = false; this.render() }
      return
    }
    if (d.lfAdopt !== undefined) {
      if (this.adopting || !window.confirm('接管 landfill-project skill？\n\n会先把现有的 SKILL.md 备份到插件数据目录，再换成指向插件里那份的链接。之后 Codex 等工具读到的也是插件这份。')) return
      this.adopting = true; this.render()
      try { await this.act('landfill/adopt-skill', {}, '已接管 skill（原文件已备份）') } finally { this.adopting = false; this.render() }
      return
    }
    if (d.openSess) return this.host.openSession(d.openSess)
    if (d.linkSess !== undefined && c) return this.openLinkSess(c)
    // v87：相关说明注入开关（先于其它说明操作；点击后整表保存，保留 on/off）
    if (d.nkSw !== undefined && c) {
      const k = Number(d.nkSw)
      const items = (c.noteItems ?? []).map((y) => ({ ...y }))
      const x = items[k]
      if (!x) return
      if (x.off) delete x.off
      else x.off = true
      const on = items.filter((y) => !y.off).length
      if (await this.act('card/noteitems', { id: c.id, items }, x.off
        ? '已关闭「' + x.t + '」的 AI 自动注入：引用 / 看板 / 编辑照常'
        : '已打开「' + x.t + '」的 AI 自动注入（' + on + '/' + items.length + ' 条生效）')) {
        (this.root.querySelector('[data-nk-sw="' + k + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
      }
      return
    }
    /* v144（1）：相关说明新增 / 编辑 = 任务弹窗同一个窗口的说明模式（旧 host 没有 taskDialog 时退回行内编辑卡） */
    if (d.nkAdd !== undefined && c && this.host.taskDialog) { if (this.noteEdit && !(await this.noteSave(true))) return; this.host.taskDialog({ cardId: c.id, note: { k: -1, done: (r) => { if (r) this.noteLanded(c.id, r.t) } } }); return }
    if (d.nkEdit !== undefined && c && this.host.taskDialog) { if (this.noteEdit && !(await this.noteSave(true))) return; const k = Number(d.nkEdit); const x = (c.noteItems ?? [])[k]; if (!x) return; this.host.taskDialog({ cardId: c.id, note: { k, t: x.t, v: x.v, off: !!x.off, done: (r) => { if (r) this.noteLanded(c.id, r.t) } } }); return }
    if (d.nkAdd !== undefined && c) { if (this.noteEdit && !(await this.noteSave(true))) return; const pinNew = !(c.noteItems ?? [])[0]?.pin; this.noteEdit = { card: c.id, k: -1, t: pinNew ? NOTE_PIN : '', v: '', err: '', pinNew }; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector(pinNew ? '#dpmNkV' : '#dpmNkT') as HTMLElement | null)?.focus(); return }
    if (d.nkEdit !== undefined && c) { if (this.noteEdit && !(await this.noteSave(true))) return; const k = Number(d.nkEdit); const x = (c.noteItems ?? [])[k]; if (!x) return; this.noteEdit = { card: c.id, k, t: x.t, v: x.v, err: '', on: !x.off }; this.lastDetail = ''; this.renderDetail(); const i = this.root.querySelector('#dpmNkV') as HTMLTextAreaElement | null; if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length) } return }
    // 0.24 存说明：以编辑框所在详情的卡片为准（不按当前选中），保存中再点不重复提交
    if (d.nkSave !== undefined && c) { if (this.nkSaving) return; const own = (t.closest('.detail') as HTMLElement | null)?.dataset.card; if (own && own !== c.id) return; if (!this.noteEdit) { const tt = (this.root.querySelector('#dpmNkT') as HTMLInputElement | null)?.value ?? NOTE_PIN; this.noteEdit = { card: c.id, k: -1, t: tt, v: (this.root.querySelector('#dpmNkV') as HTMLTextAreaElement | null)?.value ?? '', err: '' } } await this.noteSave(); return }
    if (d.nkCancel !== undefined) { this.noteCancel(); return }
    if (d.nkDel !== undefined && c) return this.noteDelete(c, Number(d.nkDel))
    if (d.nkMore !== undefined && c) { const key = c.id + ':' + d.nkMore; if (this.noteOpen.has(key)) this.noteOpen.delete(key); else this.noteOpen.add(key); this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('[data-nk-more="' + d.nkMore + '"]') as HTMLElement | null)?.focus({ preventScroll: true }); return }
    if (d.faOpen !== undefined && c) return this.faOpen(c)
    if (d.faPick !== undefined) return this.faPick()
    if (d.faOk !== undefined) return this.faOk()
    if (d.faRm !== undefined) return this.faRm(Number(d.faRm))
    if (d.fEdit && c) { this.tolf = null; const f = (c.files ?? []).find((x) => x.id === d.fEdit); if (!f) return; this.fEdit = { card: c.id, id: f.id, v: f.title ?? '' }; this.lastDetail = ''; this.renderDetail(); const i = this.root.querySelector('#dpmFT') as HTMLInputElement | null; if (i) { i.focus(); i.select() } return }
    if (d.fSave !== undefined) return this.fSave()
    if (d.repoOpen !== undefined) {
      const pth = d.repoOpen as string
      try { await post('fs/reveal', { path: pth, folder: true }); this.host.toast('已在访达中打开「' + folderName(pth) + '」') } catch (er) { this.host.toast((er instanceof ApiError ? er.message : String(er)), 'err'); if (er instanceof ApiError && er.code === 'NOT_FOUND') void this.refresh() }
      return
    }
    if (d.repoTerm !== undefined) {
      const pth = d.repoTerm as string
      try { await post('fs/terminal', { path: pth }); this.host.toast('已在 Terminal 打开「' + folderName(pth) + '」') } catch (er) { this.host.toast((er instanceof ApiError ? er.message : String(er)), 'err'); if (er instanceof ApiError && er.code === 'NOT_FOUND') void this.refresh() }
      return
    }
    if (d.revealFile !== undefined || d.revealDir !== undefined) { const dir = d.revealDir !== undefined; const pth = (dir ? d.revealDir : d.revealFile) as string; try { await post('fs/reveal', { path: pth, folder: dir }); this.host.toast(dir ? '已在访达中打开「' + folderName(pth) + '」' : '已在访达中显示「' + folderName(pth) + '」') } catch (er) { this.host.toast((er instanceof ApiError ? er.message : String(er)), 'err'); if (er instanceof ApiError && er.code === 'NOT_FOUND') void this.refresh() } return }
    if (d.fCancel !== undefined) { this.fEdit = null; this.fBlur(); this.lastDetail = ''; this.renderDetail(); return }
    if (d.fUnl && c) return this.fUnlink(c, d.fUnl)
    if (d.fDel && c) return this.fTrash(c, d.fDel)
    if (d.fselToggle !== undefined && c) return this.fsToggle(c)
    if (d.fselAll !== undefined && c) return this.fsAll(c)
    if (d.fselDone !== undefined) return this.fsDone()
    if (d.fselUnbind !== undefined && c) { if (this.fsSelNow(c).length) void this.fsBatch(c, false); return }
    if (d.fselDel !== undefined && c) { if (this.fsSelNow(c).length) this.fsDelAsk(c); return }
    if (d.sessArc !== undefined) { this.sessArc = !this.sessArc; t.setAttribute('aria-expanded', String(this.sessArc)); this.root.querySelector('#dpmArcL')?.classList.toggle('open', this.sessArc); this.lastDetail = ''; return }
    if (d.tolf !== undefined && c) { this.fEdit = null; const ks = this.lfKeys(c); if (ks.length > 1) { this.tolf = { card: c.id }; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('#dpmTolfTo') as HTMLElement | null)?.focus(); return } return this.tolfRun(c, ks[0]) }
    if (d.tolfCancel !== undefined) { this.tolf = null; this.lastDetail = ''; this.renderDetail(); return }
    if (d.tolfOk !== undefined && c) return this.tolfRun(c, (this.root.querySelector('#dpmTolfTo') as HTMLSelectElement | null)?.value ?? this.lfKeys(c)[0])
    if (d.unbind) return this.askUnbind(d.unbind)
    if (d.restore) return this.restoreSession(d.restore)
    if (d.newGroup !== undefined) return this.askName('新建卡片组', '卡片组就是父项目，默认带 5 个阶段，创建后可在「卡片组设置」里改。', '', 'group')
    if (d.addCard) { this.adding = { g: d.addCard, col: d.col ?? '' }; this.addDraft = ''; this.render(); (this.root.querySelector('#dpmAddIn') as HTMLInputElement | null)?.focus(); return }
    if (d.renameCard !== undefined && c) return this.askName('重命名卡片', '', c.t, 'rename:' + c.id)
    if (d.removeCard !== undefined && c) {
      this.rmCard = c.id
      this.$('#dpmRmT').textContent = '删除卡片「' + c.t + '」？'
      this.$('#dpmRmP').textContent = (c.archivedAt ? '这张卡片已归档。' : '') + '删除后卡片的任务、说明、链接、文件登记都会移除，不能恢复。它的会话、关联的落盘项目、仓库里的文件都保留，只是会话不再读取这张卡片的记忆。'
      const dl = this.$<HTMLDialogElement>('#dpmDlgRm'); dl.returnValue = ''; dl.showModal()
      ;(dl.querySelector('[data-dlg-cancel]') as HTMLElement | null)?.focus()
      return
    }
    if (d.rcAdd !== undefined && c) { this.rp = { card: c.id, q: '', sel: new Set() }; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('#dpmRpQ') as HTMLElement | null)?.focus(); return }
    if (d.rpCancel !== undefined) { this.rp = null; this.lastDetail = ''; this.renderDetail(); if (this.kbd) (this.root.querySelector('[data-rc-add]') as HTMLElement | null)?.focus(); return }
    if (d.rpOk !== undefined && c && this.rp) {
      const ids = [...this.rp.sel]
      const rpOff = this.rp.off
      this.rp = null
      // v136：新关联的默认不注入（选择卡里的开关可以改）；老关联保持原开关
      const off = rpOff !== false
      if (await this.act('card/related', { id: c.id, cards: [...(c.related ?? []).map((id) => ({ id, off: (c.relOff ?? []).includes(id) })), ...ids.map((id) => ({ id, off }))] }, '已关联 ' + ids.length + ' 张卡片 · ' + (off ? '不注入 Agent 会话（默认）' : '自动注入 Agent 会话'))) ids.forEach((id) => this.landEl('.detail .rc[data-rc="' + CSS.escape(id) + '"]'))
      return
    }
    if (d.rcDel && c) {
      const prev = (c.related ?? []).slice()
      const x = this.card(d.rcDel)
      const po = new Set(c.relOff ?? []), withOff = (l: string[]): Array<{ id: string; off: boolean }> => l.map((id) => ({ id, off: po.has(id) }))
      if (await this.act('card/related', { id: c.id, cards: withOff(prev.filter((k) => k !== d.rcDel)) })) this.host.toast('已取消关联「' + (x?.t ?? d.rcDel) + '」', 'ok', { label: '撤销', run: () => void this.act('card/related', { id: c.id, cards: withOff(prev) }) })
      return
    }
    if (d.rcOpen) return this.openRelated(d.rcOpen)
    if (d.back !== undefined) return this.goBack()
    if (d.editGroup) { this.editG = d.editGroup; this.openGroupSettings(d.focusLinks !== undefined); return }
    if (d.linkCard !== undefined && c) return this.openLink('card', c.id)
    if (d.linkGroup) return this.openLink('group', d.linkGroup)
    if (d.unlinkCard && c) { await this.act('card/update', { id: c.id, links: c.links.filter((k) => k !== d.unlinkCard) }, '已取消关联'); return }
    if (d.unlinkGroup && this.editG) { const g = this.grp(this.editG)!; await this.act('group/update', { id: g.id, links: g.links.filter((k) => k !== d.unlinkGroup) }, '已取消关联'); this.renderGroupSettings(); return }
    /* v107 ③：点「+ 添加子任务」只开输入行（不再直接开完整弹窗）；「编辑详情」才开弹窗 */
    if (d.tkKadd && c) { e.preventDefault(); this.kaddOpen(c, d.tkKadd); return }
    if (d.tkKaddok !== undefined && c) { e.preventDefault(); this.kaddSave(c); return }
    if (d.tkKaddclose !== undefined) { e.preventDefault(); this.kaddClose(true); return }
    if (d.tkSubdlg !== undefined && c) {
      e.preventDefault()
      const v = (this.root.querySelector('#dpmKAdd') as HTMLInputElement | null)?.value.trim() ?? ''
      if (this.host.taskDialog) {
        this.tkAdd = null; this.lastDetail = ''; this.renderDetail()
        this.host.taskDialog({ cardId: c.id, mode: 'add', parentId: d.tkSubdlg, title: v })
        return
      }
      this.kaddSave(c)
      return
    }
    if (d.tkEdit && c) { if (this.host.taskDialog) { this.host.taskDialog({ cardId: c.id, mode: 'edit', taskId: d.tkEdit }); return } this.taskEditOpen(c, d.tkEdit); return }
    if (d.tkAdddlg !== undefined && c) { if (this.host.taskDialog) { this.host.taskDialog({ cardId: c.id, mode: 'add' }); return } this.taskEditOpen(c, '', '', 'note'); return }
    // v99：任务分区头「添加任务」→ 列表最下面开一行内联输入；行内「编辑详情」→ 完整弹窗（标题带上已输入的字）
    if (d.tkNew !== undefined && c) { e.preventDefault(); return this.tkNewOpen(c) }
    if (d.tkNewsave !== undefined && c) { e.preventDefault(); return this.tkNewSave(c) }
    if (d.tkNewclose !== undefined) { e.preventDefault(); return this.tkNewClose(true) }
    if (d.tkNewdlg !== undefined && c) {
      e.preventDefault()
      const v = (this.root.querySelector('#dpmTkNewIn') as HTMLInputElement | null)?.value.trim() ?? ''
      this.tkNew = null; this.lastDetail = ''; this.renderDetail()
      if (this.host.taskDialog) { this.host.taskDialog({ cardId: c.id, mode: 'add', title: v }); return }
      this.taskEditOpen(c, '', v, 'note'); return
    }
    if (d.fOpen !== undefined && c) {
      e.preventDefault()
      const id = d.fOpen
      try {
        const ff = (c.files ?? []).find((f) => f.id === id)
        const r = await openFileSmart({ card: c.id, file: id, path: ff?.path ?? '' })
        const row = this.root.querySelector('.detail .frow-f[data-fid="' + CSS.escape(id) + '"]') as HTMLElement | null
        if (row) { row.classList.add('opened'); setTimeout(() => row.classList.remove('opened'), 640) }
        this.host.toast(openedHow(r) + '「' + fileName(ff ?? { path: '', id }) + '」')
      } catch (er) {
        this.host.toast(er instanceof ApiError ? er.message : String(er), 'err')
      }
      return
    }
    if (d.lanescroll !== undefined) {
      e.preventDefault(); e.stopPropagation()
      this.laneScroll(t, Number(d.lanescroll))
      return
    }

    if (d.tkSave !== undefined) { this.taskEditSave(); return }
    if (d.tkCancel !== undefined) { this.taskEditClose(true); return }
    if (d.tkDel && c) { this.taskDelete(c, d.tkDel); return }
    if (d.tkUnlink && d.lid && c) { this.taskUnlink(c, d.tkUnlink, d.lid); return }
    if (d.tkEunlink && c) { this.tkEditUnlink(c, d.tkEunlink); this.lastDetail = ''; this.renderDetail(); if (this.kbd) this.focusTask('[data-tk-lpick]'); return }
    if (d.tkLpick !== undefined) { this.tkLp = this.tkLp ? null : { q: '', fresh: true }; this.lastDetail = ''; this.renderDetail(); this.focusTask(this.tkLp ? ((c?.webLinks ?? []).length > 5 ? '#dpmTkLpQ' : '[data-tk-lpk]') : '[data-tk-lpick]'); return }
    if (d.tkBrief !== undefined && c) {
      this.tkDetail = this.tkDetail === c.id ? null : c.id
      this.tkViewOpen.clear()
      this.tkViewClosed.clear()
      this.lastDetail = ''
      this.renderDetail()
      this.focusTask('[data-tk-brief]')
      return
    }
    if (d.tkView && c && this.dp) { e.preventDefault(); this.dp.open('task', d.tkView); return }
    if (d.tkView && c) {
      const k = d.tkView
      if (this.tkDetail !== c.id) { if (this.tkViewOpen.has(k)) this.tkViewOpen.delete(k); else this.tkViewOpen.add(k) }
      else { if (this.tkViewClosed.has(k)) this.tkViewClosed.delete(k); else this.tkViewClosed.add(k) }
      this.lastDetail = ''
      this.renderDetail()
      this.focusTask('[data-tk-view="' + CSS.escape(k) + '"]')
      return
    }
    if (d.tkFpick !== undefined) { this.tkFp = !this.tkFp; this.lastDetail = ''; this.renderDetail(); this.focusTask(this.tkFp ? '[data-tk-fpk]' : '[data-tk-fpick]'); return }
    if (d.tkFpdone !== undefined) { this.tkFp = false; this.lastDetail = ''; this.renderDetail(); this.focusTask('[data-tk-fpick]'); return }
    if (d.tkEfunlink && this.taskEdit) { this.taskEdit.files = this.taskEdit.files.filter((x) => x !== d.tkEfunlink); this.lastDetail = ''; this.renderDetail(); if (this.kbd) this.focusTask('[data-tk-fpick]'); return }
    if (d.tkLpdone !== undefined) { this.tkLp = null; this.lastDetail = ''; this.renderDetail(); this.focusTask('[data-tk-lpick]'); return }
    if (d.tkRef !== undefined) { this.tkRm = this.tkRm ? null : { q: '', from: -1, i: 0 }; this.lastDetail = ''; this.renderDetail(); const ta = this.root.querySelector('#dpmTaskNote') as HTMLTextAreaElement | null; if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(this.tkCaret[0], this.tkCaret[1]) } return }
    /* v113（2.3）：子任务列表开合 = 只切 wrap 的 .open（grid 行过渡 240ms），不整块重画 —— 重画没有动效、还会丢滚动位置 */
    if (d.tkFold) {
      const fk = d.tkFold
      const was = !this.tkClosed.has(fk)
      const next = !was
      if (next) { this.tkClosed.delete(fk); this.tkFresh = fk } else this.tkClosed.add(fk)
      if (!next && this.tkAdd?.pid === fk) { this.tkAdd = null; this.lastDetail = ''; this.renderDetail(); return }
      const wrap = this.root.querySelector('#dpmKidsWrap-' + CSS.escape(fk)) as HTMLElement | null
      if (wrap) wrap.classList.toggle('open', next)
      const btn = t as HTMLElement
      btn.setAttribute('aria-expanded', String(next))
      btn.title = (next ? '收起' : '展开') + '子任务列表'
      this.focusTask('[data-tk-fold="' + CSS.escape(fk) + '"]')
      return
    }
    /* v113（2.5）：已完成任务 / 已完成子任务的开合 —— 同样只切 .open（grid 行过渡），不重画 */
    if (d.tkDonebtn !== undefined) {
      this.tkDoneOpen = !this.tkDoneOpen
      const body = this.root.querySelector('[data-tk-donebody="1"]') as HTMLElement | null
      const btn = t as HTMLElement
      this.pinFold(btn)
      if (body) body.classList.toggle('open', this.tkDoneOpen)
      btn.setAttribute('aria-expanded', String(this.tkDoneOpen))
      this.paintFoldLabel(btn, this.tkDoneOpen, '任务')
      this.focusTask('[data-tk-donebtn="1"]')
      return
    }
    if (d.tkSubbtn) {
      const pk = d.tkSubbtn
      const on = !this.tkSubDone.has(pk)
      if (on) this.tkSubDone.add(pk); else this.tkSubDone.delete(pk)
      const body = this.root.querySelector('[data-tk-subbody="' + CSS.escape(pk) + '"]') as HTMLElement | null
      const btn = t as HTMLElement
      this.pinFold(btn)
      if (body) body.classList.toggle('open', on)
      btn.setAttribute('aria-expanded', String(on))
      this.paintFoldLabel(btn, on, '子任务')
      this.focusTask('[data-tk-subbtn="' + CSS.escape(pk) + '"]')
      return
    }
    if (d.import !== undefined) return this.openImport()
    if (d.stdel !== undefined) return this.stEdit((list) => { list.splice(Number(d.stdel), 1) })
    if (d.stup !== undefined) {
      const k = Number(d.stup)
      await this.stEdit((list) => { if (k > 0) [list[k - 1], list[k]] = [list[k], list[k - 1]] })
      const b = this.root.querySelector('[data-stup="' + (k - 1) + '"]') as HTMLButtonElement | null
      if (b && !b.disabled) b.focus()
      return
    }
    if (t.id === 'dpmStAdd') {
      await this.stEdit((list) => { list.push({ id: '', name: '新阶段' }) })
      const inp = this.root.querySelector('[data-stname="' + (this.stDraft.length - 1) + '"]') as HTMLInputElement | null
      if (inp) { inp.focus(); inp.select() }
      return
    }
    if (t.id === 'dpmRepoAdd') return this.openAddRepo()
    if (d.repodel !== undefined && this.editG) {
      const g = this.grp(this.editG)
      const r = g?.repos[Number(d.repodel)]
      if (!g || !r) return
      if (await this.act('group/update', { id: g.id, repos: g.repos.filter((_, k) => k !== Number(d.repodel)) }, '已从卡片共用仓库移除「' + r.name + '」。已有卡片里的这个仓库不受影响')) this.renderGroupSettings()
      return
    }
    if (t.id === 'dpmArPick') return this.pickFolder()
    if (t.id === 'dpmArPaste') return this.arFpOpen(!this.ar?.fp?.open)
    if (t.id === 'dpmArFpHide') { this.arFpOpen(false); this.$<HTMLElement>('#dpmArPaste').focus(); return }
    if (t.id === 'dpmArFpClear' && this.ar?.fp) { const fp = this.ar.fp; const prev = fp.text; fp.text = ''; fp.res = []; this.arFpPaint(true); this.$<HTMLElement>('#dpmArFpIn').focus(); this.host.toast('已清空', 'ok', { label: '撤销', run: () => { if (this.ar?.fp !== fp) return; fp.text = prev; this.arFpPaint(true); void this.arFpCheck() } }); return }
    if (t.id === 'dpmArFpOk') return this.arFpAdd()
    if (d.qt !== undefined) { e.preventDefault(); e.stopPropagation(); return this.copyQuote(d.qt) }
    if (d.copyPath !== undefined) { e.preventDefault(); e.stopPropagation(); const p = d.copyPath; try { await navigator.clipboard.writeText(p) } catch (er) { this.host.toast('复制失败：' + (er instanceof Error ? er.message : String(er)), 'err'); return } t.classList.add('copied'); setTimeout(() => t.classList.remove('copied'), 1200); this.host.toast('已复制路径：' + p); return }
    if (d.ardel !== undefined && this.ar) { this.ar.sel.splice(Number(d.ardel), 1); this.renderSel(); return }
    if (d.arAll !== undefined) return this.arAddAllShared()
    if (d.arJump) return this.arJump(d.arJump)
    if (d.cardRepoAdd !== undefined) return this.openAddRepo('card')
    if (d.cardRepoDel !== undefined) {
      const c = this.sel ? this.card(this.sel) : undefined
      const r = c?.repos?.[Number(d.cardRepoDel)]
      if (!c || !r) return
      const rest = (c.repos ?? []).filter((_, k) => k !== Number(d.cardRepoDel))
      await this.act('card/repos', { id: c.id, repos: rest }, '已从这张卡片移除「' + r.name + '」。卡片组的共用仓库和其他卡片不受影响')
      return
    }
    if (t.id === 'dpmGroupDel') {
      const g = this.grp(this.editG ?? '')
      if (!g || !window.confirm('删除卡片组「' + g.name + '」？组里必须已经没有卡片。')) return
      if (await this.act('group/remove', { id: g.id }, '已删除卡片组')) this.$<HTMLDialogElement>('#dpmDlgSt').close()
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement
    if (t.id === 'dpmQ') { if ((e as InputEvent).isComposing) return; this.q = t.value.trim().toLowerCase(); this.render(); return }
    if (t.id === 'dpmAddIn') { this.addDraft = t.value; this.addForce = false; this.paintDedupe(); return }
    if (t.id === 'dpmNameInput') {
      /* v101 ①：这里加了查重分支就 return 了，把「确定」的可用状态一起带上（否则新名字也点不了确定） */
      this.nameForce = false
      this.paintNameDup()
      const ok = this.$<HTMLButtonElement>('#dpmNameOk')
      if (ok) ok.disabled = t.value.trim() === ''
      return
    }
    // 0.23：编辑子任务时输入实时记进草稿——同步重画用草稿，不再冲回开始编辑时的原文
    if (t.id === 'dpmKAdd' && this.tkAdd) {
      this.tkAdd.v = t.value
      const b = this.root.querySelector('[data-tk-kaddok]') as HTMLButtonElement | null
      if (b) b.disabled = !t.value.trim()
      return
    }
    // v99：任务区内联加任务 —— 只填标题就能存；没内容时勾号禁用
    if (t.id === 'dpmTkNewIn' && this.tkNew) {
      this.tkNew.v = t.value
      const b = this.root.querySelector('[data-tk-newsave]') as HTMLButtonElement | null
      if (b) b.disabled = !t.value.trim()
      return
    }
    if (t.id === 'dpmTaskEd' && this.taskEdit) { this.taskEdit.t = t.value; if (this.taskEdit.err) { this.taskEdit.err = ''; t.removeAttribute('aria-invalid'); this.root.querySelector('#dpmTaskEdE')?.remove() } return }
    if (t.id === 'dpmTaskNote' && this.taskEdit) { this.taskEdit.n = t.value; this.tkRefTrack(t as unknown as HTMLTextAreaElement); return }
    if (t.id === 'dpmRpQ' && this.rp) { if ((e as InputEvent).isComposing) return; this.rp.q = t.value; this.lastDetail = ''; this.renderDetail(); return }
    if (t.id === 'dpmTkLpQ' && this.tkLp) { if ((e as InputEvent).isComposing) return; this.tkLp.q = t.value; this.lastDetail = ''; this.renderDetail(); return }
    if (t.id === 'dpmArFpIn' && this.ar?.fp) { this.ar.fp.text = t.value; this.arFpPaint(); clearTimeout(this.arFpTimer); this.arFpTimer = window.setTimeout(() => void this.arFpCheck(), 250); return }
    if (t.id === 'dpmFaIn' && this.fa) { this.fa.text = t.value; clearTimeout(this.faTimer); this.faTimer = window.setTimeout(() => void this.faCheck(), 250); return }
    if (t.dataset.faT !== undefined && this.fa) { const it = this.fa.items[Number(t.dataset.faT)]; if (it) it.title = t.value; return }
    if (t.id === 'dpmFT' && this.fEdit) { this.fEdit.v = t.value; return }
    if (t.id === 'dpmRN' && this.rEdit) { this.rEdit.v = t.value; return }
    if (t.id === 'dpmNkT' || t.id === 'dpmNkV') {
      const c = this.sel ? this.card(this.sel) : undefined; if (!c) return
      if (!this.noteEdit) this.noteEdit = { card: c.id, k: -1, t: (this.root.querySelector('#dpmNkT') as HTMLInputElement).value, v: (this.root.querySelector('#dpmNkV') as HTMLTextAreaElement).value, err: '' }
      if (t.id === 'dpmNkT') this.noteEdit.t = t.value; else { this.noteEdit.v = t.value; const ta = t as unknown as HTMLTextAreaElement; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 360) + 'px' }
      if (this.noteEdit.err) { this.noteEdit.err = ''; t.removeAttribute('aria-invalid'); this.root.querySelector('#dpmNkE')?.remove() }
      return
    }
    if (t.id === 'dpmTySub' && this.ty?.sub) { const em = this.root.querySelector('#dpmTySubE') as HTMLElement | null; t.removeAttribute('aria-invalid'); if (em) { if (this.ty.sub.k === 'd') { const h = this.tyDomainHint(this.ty.sub.t, t.value); em.className = h.ok || !h.html ? '' : 'err'; em.innerHTML = h.html; if (!h.ok && h.html) t.setAttribute('aria-invalid', 'true') } else { em.textContent = ''; em.className = '' } } return }
    if (t.id === 'dpmTgNew' && this.ty?.gErr) { this.ty.gErr = ''; t.classList.remove('bad'); t.removeAttribute('aria-invalid'); this.$('#dpmTgNewE').hidden = true; return }
    if (this.wl && t.closest('#dpmDlgWl')) {
      const w = this.wl
      const d = t.dataset
      if (d.wtext !== undefined) w.rows[Number(d.wtext)].text = t.value
      if (d.wurl !== undefined) {
        const r = w.rows[Number(d.wurl)]
        r.url = t.value
        if (r.err) { r.err = ''; t.classList.remove('bad'); t.removeAttribute('aria-invalid'); t.parentElement?.querySelector(':scope > .wl-err')?.remove() }
        { const i = Number(d.wurl); const before = r.type; const h = this.wlAuto(r); const ah = this.root.querySelector('#dpmWa' + i) as HTMLElement | null; if (ah) { ah.hidden = !h; ah.innerHTML = h } if (r.type !== before) { const sel = this.root.querySelector('#dpmWt' + i) as HTMLSelectElement | null; if (sel) { sel.outerHTML = this.wlTypeCtl(r, i); const ns = this.root.querySelector('#dpmWt' + i) as HTMLElement; ns.classList.add('dpm-glow') } const tg = this.root.querySelector('#dpmWg' + i) as HTMLElement | null; if (tg) tg.outerHTML = this.wlTagCtl(r, i); ;(window as unknown as Record<string, unknown>).__dpmAuto = { type: r.type, at: Date.now() } } }
        this.wlDupAll()
        this.wlOkText()
      }
      return
    }
    if (t.id === 'dpmNameInput') { this.$<HTMLButtonElement>('#dpmNameOk').disabled = t.value.trim() === ''; return }
    if (t.id === 'dpmLkQ' && this.link) { this.link.q = t.value.trim().toLowerCase(); this.renderLink(); return }
    if (t.id === 'dpmLsQ' && this.ls) { if ((e as InputEvent).isComposing) return; this.ls.q = t.value; this.renderLinkSess(); return }
    if (t.id === 'dpmArQ' && this.ar) { if ((e as InputEvent).isComposing) return; this.ar.q = t.value.trim().toLowerCase(); this.$('#dpmArList').scrollTop = 0; this.arPaintList(); return }
    if (t.dataset.arname !== undefined && this.ar) { this.ar.sel[Number(t.dataset.arname)].name = t.value; this.arCheck(); return }
    if (t.dataset.arrole !== undefined && this.ar) { this.ar.sel[Number(t.dataset.arrole)].role = t.value; return }
  }

  private async onChange(e: Event): Promise<void> {
    const t = e.target as HTMLInputElement
    const c = this.sel ? this.card(this.sel) : undefined
    if (t.dataset.wtype !== undefined && this.wl) {
      const i = Number(t.dataset.wtype)
      const r = this.wl.rows[i]
      r.type = t.value; r.manual = true; r.tag = ''
      const tg = this.root.querySelector('#dpmWg' + i) as HTMLElement | null; if (tg) tg.outerHTML = this.wlTagCtl(r, i)
      const ah = this.root.querySelector('#dpmWa' + i) as HTMLElement | null; if (ah) { const h = this.wlAuto(r); ah.hidden = !h; ah.innerHTML = h }
      return
    }
    if (t.dataset.wtag !== undefined && this.wl) { const r = this.wl.rows[Number(t.dataset.wtag)]; if (r) r.tag = t.value; return }
    if (t.dataset.rk && this.rp) { if (t.checked) this.rp.sel.add(t.dataset.rk); else this.rp.sel.delete(t.dataset.rk); const ok = this.root.querySelector('[data-rp-ok]') as HTMLButtonElement | null; if (ok) { ok.disabled = !this.rp.sel.size; ok.textContent = this.rp.sel.size ? '关联 ' + this.rp.sel.size + ' 张' : '关联' } this.lastDetail = ''; return }
    if (t.dataset.tkDone && c) { this.taskSetDone(c, t.dataset.tkDone, t.checked); return }
    if (t.id === 'dpmFaLfSw' && this.fa) { await this.setPref('lf', t.checked); this.faPaint(); this.$<HTMLElement>('#dpmFaLfSw').focus(); this.host.toast(t.checked ? '已打开「放到落盘项目」：所有卡片添加文件时都会复制到落盘项目' : '已关闭「放到落盘项目」：所有卡片添加文件时都只登记原路径'); return }
    if (t.id === 'dpmSwDelA') { await this.setPref('delAdd', t.checked); this.faPaint(); this.$<HTMLElement>('#dpmSwDelA').focus(); this.host.toast(t.checked ? '添加文件时「删除原文件」已打开：所有卡片复制到落盘项目后都会把原文件移到废纸篓' : '添加文件时「删除原文件」已关闭：所有卡片都保留原文件'); return }
    if (t.id === 'dpmSwDelT') { await this.setPref('delTolf', t.checked); this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('#dpmSwDelT') as HTMLElement | null)?.focus(); this.host.toast(t.checked ? '一键放到落盘项目时「删除原文件」已打开（所有卡片）' : '一键放到落盘项目时「删除原文件」已关闭（所有卡片）'); return }
    if (t.id === 'dpmFaTo' && this.fa) { this.fa.to = t.value; return }
    if (t.id === 'dpmTaskTy' && this.taskEdit) { if (t.value === '__manage') { t.value = this.taskEdit.ty; this.typesOpen('task'); return } this.taskEdit.ty = t.value; return }
    if (t.dataset.tkFpk && this.taskEdit) { const id = t.dataset.tkFpk; const arr = this.taskEdit.files; const i = arr.indexOf(id); if (t.checked && i < 0) arr.push(id); if (!t.checked && i >= 0) arr.splice(i, 1); const row = this.root.querySelector('#dpmTaskFkL + .eplinks') as HTMLElement | null; if (row && c) row.innerHTML = this.tkFChips(c, arr) + '<button type="button" class="addlk" data-tk-fpick aria-expanded="true" aria-controls="dpmTkFp">' + ic('plus') + (arr.length ? '' : '绑定本卡片的文件（可选）') + '</button>'; this.lastDetail = ''; return }
    if (t.dataset.tkLpk && this.taskEdit && c) { const id = t.dataset.tkLpk; if (t.checked) { if (!this.taskEdit.links.includes(id)) this.taskEdit.links.push(id) } else { this.tkEditUnlink(c, id); const ta = this.root.querySelector('#dpmTaskNote') as HTMLTextAreaElement | null; if (ta) ta.value = this.taskEdit.n } this.tkLpPatch(c); return }
    if (t.dataset.lk !== undefined && this.link) { if (t.checked) this.link.sel.add(t.dataset.lk); else this.link.sel.delete(t.dataset.lk); this.renderLinkCount(); return }
    if (t.dataset.stname !== undefined) return this.stEdit(() => undefined)
    if (t.dataset.ls !== undefined && this.ls) { const arch = !!t.closest('#dpmLsArch'); this.ls.sel.push(t.dataset.ls); this.renderLinkSess(); ((this.root.querySelector((arch ? '#dpmLsArch' : '#dpmLsActive') + ' [data-ls]') ?? this.root.querySelector('#dpmLsQ')) as HTMLElement | null)?.focus(); return }
    if (t.dataset.lsel !== undefined && this.ls) { this.ls.sel = this.ls.sel.filter((x) => x !== t.dataset.lsel); this.renderLinkSess(); ((this.root.querySelector('#dpmLsSel [data-lsel]') ?? this.root.querySelector('#dpmLsQ')) as HTMLElement | null)?.focus(); return }
    if (t.dataset.ar !== undefined && this.ar) {
      const p = t.dataset.ar
      if (t.checked) { if (!this.arAdd(p)) t.checked = false } else this.ar.sel = this.ar.sel.filter((x) => x.path !== p)
      this.renderSel(t.checked ? [p] : undefined)
      return
    }
    if ((t.dataset.rpname !== undefined || t.dataset.rprole !== undefined) && this.editG) return this.saveRepoField(t)
    if (t.id === 'dpmGroupLf' && this.editG) { const v = t.value.trim().toLowerCase(); const g = this.grp(this.editG); if (g && v !== (g.lfProject ?? '')) { if (await this.act('group/update', { id: this.editG, lfProject: v }, v ? '落盘文件夹：~/.ai/projects/' + v + '/（第一次落盘时登记到 ~/.ai）' : '已清除落盘文件夹')) this.renderGroupSettings(); else t.value = g.lfProject ?? '' } return }
    if (t.id === 'dpmGroupName' && this.editG) { const v = t.value.trim(); if (v) await this.act('group/update', { id: this.editG, name: v }); this.renderGroupSettings() }
  }

  private async onSubmit(e: Event): Promise<void> {
    const f = e.target as HTMLFormElement
    if (f.dataset.addcard !== undefined) { e.preventDefault(); return this.submitCard() }
    if (f.dataset.addtask === undefined) return
    e.preventDefault()
    const c = this.sel ? this.card(this.sel) : undefined
    const inp = this.$<HTMLInputElement>('#dpmNewTask')
    const v = inp.value.replace(/\s+/g, ' ').trim()
    if (!c || !v) return
    inp.value = ''
    const x: Task = { id: newTaskId(), text: v, done: false }
    this.tasksCommit(c, [...tClone(c.tasks), x], undefined, x.id)
    const n = this.$<HTMLInputElement>('#dpmNewTask'); if (n) n.focus({ preventScroll: true })
  }

  private async onKey(e: KeyboardEvent): Promise<void> {
    const t = e.target as HTMLElement
    if ((e.key === 'Enter' || e.key === ' ') && this.dp && t.dataset?.nkOpen !== undefined) { e.preventDefault(); this.dp.open('note', t.textContent ?? ''); return }
    // 0.30.1：分区标题栏可 Tab 聚焦，回车 / 空格切换展开
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('.detail .d-b .sec.cl > h3')) {
      e.preventDefault()
      const sec = t.parentElement as HTMLElement
      if (sec.classList.contains('x')) this.secClose(sec); else this.secOpen(sec)
      return
    }
    if (t.id === 'dpmKAdd' && !e.isComposing) {
      const c = this.sel ? this.card(this.sel) : undefined
      if (e.key === 'Enter' && c) { e.preventDefault(); this.kaddSave(c) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.kaddClose(true) }
      return
    }
    if (this.taskEdit && !e.isComposing && t.closest('.task.editing')) {
      const c = this.sel ? this.card(this.sel) : undefined
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape' && this.tkLp) { e.preventDefault(); e.stopPropagation(); this.tkLp = null; this.lastDetail = ''; this.renderDetail(); this.focusTask('[data-tk-lpick]'); return }
      if (e.key === 'Escape' && this.tkFp) { e.preventDefault(); e.stopPropagation(); this.tkFp = false; this.lastDetail = ''; this.renderDetail(); this.focusTask('[data-tk-fpick]'); return }
      if (t.id === 'dpmTaskNote' && this.tkRm && c) {
        const it = this.tkRefItems(c)
        const keep = (): void => { this.lastDetail = ''; this.renderDetail(); const ta = this.root.querySelector('#dpmTaskNote') as HTMLTextAreaElement | null; if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(this.tkCaret[0], this.tkCaret[1]) } }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && it.length) { e.preventDefault(); this.tkRm.i = (this.tkRm.i + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length; keep(); return }
        if ((e.key === 'Enter' || e.key === 'Tab') && !mod && it.length) { e.preventDefault(); this.tkPickRef(c, it[this.tkRm.i].l.id as string); return }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.tkRm = null; keep(); return }
      }
      if (e.key === 'Enter' && (t.id === 'dpmTaskEd' || mod)) { e.preventDefault(); this.taskEditSave(); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.taskEditClose(true); return }
      return
    }
    // v99：任务区内联输入 —— 回车 = 保存并留在原地继续加；Esc = 收起
    if (t.id === 'dpmTkNewIn' && !e.isComposing) {
      const c0 = this.sel ? this.card(this.sel) : undefined
      if (e.key === 'Enter' && c0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.tkNewSave(c0); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.tkNewClose(true); return }
      return
    }
    if ((t.id === 'dpmNkT' || t.id === 'dpmNkV') && !e.isComposing) {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Enter' && t.id === 'dpmNkT' && !mod) { e.preventDefault(); (this.root.querySelector('#dpmNkV') as HTMLElement | null)?.focus(); return }
      if (e.key === 'Enter' && mod) { e.preventDefault(); (this.root.querySelector('[data-nk-save]') as HTMLElement | null)?.click(); return }
      if (e.key === 'Escape' && this.root.querySelector('[data-nk-cancel]')) { e.preventDefault(); e.stopPropagation(); this.noteCancel(); return }
      return
    }
    if (this.nd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.ndStop(false); return }
    const ngh = t.closest('[data-nk-grip], [data-rc-grip]') as HTMLElement | null
    if (ngh && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const box = ngh.closest('[data-dlist]') as HTMLElement
      const it = Array.from(box.children).filter((n) => (n as HTMLElement).dataset.di !== undefined)
      const k = it.indexOf(ngh.closest('[data-di]') as Element)
      const to = e.key === 'ArrowUp' ? k - 1 : k + 2
      if (to < Number(box.dataset.min || 0) || to > it.length) return
      const lab = ngh.getAttribute('aria-label')
      await this.listMove(box.dataset.dlist as string, k, to)
      ;(Array.from(this.root.querySelectorAll('[data-nk-grip], [data-rc-grip]')).find((x) => x.getAttribute('aria-label') === lab) as HTMLElement | undefined)?.focus({ preventScroll: true })
      return
    }
    if (t.id === 'dpmNewTask' && e.key === 'Tab' && !e.shiftKey && (t as HTMLInputElement).value.trim()) { const c = this.sel ? this.card(this.sel) : undefined; if (c) { e.preventDefault(); this.taskEditOpen(c, '', (t as HTMLInputElement).value, 'note') } return }
    if (this.tkd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.tkStop(false); return }
    const tdh = t.closest('[data-tk-grip]') as HTMLElement | null
    if (tdh && e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault()
      const c = this.sel ? this.card(this.sel) : undefined
      if (c) this.taskKey(c, tdh.dataset.tkGrip as string, e.key)
      return
    }
    if (this.gd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.gdStop(false); return }
    if (this.wd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.wdStop(false); return }
    const wh = t.closest('[data-wdrag]') as HTMLElement | null
    if (wh && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const c = this.sel ? this.card(this.sel) : undefined
      const i = Number(wh.dataset.wdrag)
      // 0.24 组内移动：相邻的同组链接
      const peers = Array.from((wh.closest('.wl-list') as HTMLElement).querySelectorAll<HTMLElement>('[data-wl]')).map((r) => Number(r.dataset.wl))
      const j = peers[peers.indexOf(i) + (e.key === 'ArrowUp' ? -1 : 1)]
      if (c && j !== undefined) await this.wlMove(c, i, j)
      return
    }
    if (t.id === 'dpmRN' && !e.isComposing) { if (e.key === 'Enter') { e.preventDefault(); await this.rSave(); return } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.rEdit = null; this.lastDetail = ''; this.renderDetail(); return } }
    if (t.id === 'dpmFT' && !e.isComposing) { if (e.key === 'Enter') { e.preventDefault(); await this.fSave(); return } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.fEdit = null; this.fBlur(); this.lastDetail = ''; this.renderDetail(); return } }
    if (t.dataset?.faT !== undefined && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); await this.faOk(); return }
    if (t.id === 'dpmFaIn' && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); clearTimeout(this.faTimer); await this.faCheck(); await this.faOk(); return }
    if (e.key === 'Escape' && this.tolf && !this.root.querySelector('dialog[open]')) { e.preventDefault(); this.tolf = null; this.lastDetail = ''; this.renderDetail(); return }
    if (this.td && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.tdStop(false); return }
    if (this.ty && (t.dataset?.tygrip !== undefined || t.dataset?.tggrip !== undefined) && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); await this.tyKeyMove(t, e.key === 'ArrowUp'); return }
    if (this.ty && t.closest('#dpmDlgTy')) {
      if (e.isComposing) return
      if (t.id === 'dpmTySub' && e.key === 'Enter') { e.preventDefault(); await this.tySubCommit(); return }
      if (e.key === 'Escape' && (this.ty.sub || this.ty.edit || this.ty.confirm || this.ty.adding)) { e.preventDefault(); e.stopPropagation(); this.ty.sub = null; this.ty.edit = null; this.ty.confirm = null; this.ty.adding = null; this.ty.err = ''; this.typesRender(); return }
      if (t.id === 'dpmTgNew' && e.key === 'Enter') { e.preventDefault(); await this.tgAdd(); return }
      if (t.id === 'dpmTyNew' && e.key === 'Enter') { e.preventDefault(); await this.typeAdd(); return }
      if (t.id === 'dpmTyEd' && e.key === 'Enter') { e.preventDefault(); await this.tySave(); return }
      if ((t.id === 'dpmTyEd' || t.id === 'dpmTyNew') && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.ty.edit = null; this.ty.adding = null; this.ty.err = ''; this.typesRender(); return }
      return
    }
    if (this.wl && t.closest('#dpmDlgWl')) {
      if (e.key === 'Enter' && t.tagName === 'INPUT' && !e.isComposing) { e.preventDefault(); await this.wlSave() }
      return
    }
    const gh = t.closest('[data-gdrag]') as HTMLElement | null
    if (gh && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const gs = this.liveGroups()
      const i = gs.findIndex((g) => g.id === gh.dataset.gdrag)
      if (e.key === 'ArrowUp' && i > 0) await this.moveGroup(gs[i].id, gs[i - 1].id)
      else if (e.key === 'ArrowDown' && i >= 0 && i < gs.length - 1) await this.moveGroup(gs[i].id, gs[i + 2]?.id ?? null)
      return
    }
    const el = t.closest('[data-card]') as HTMLElement | null
    if (el && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const c = this.card(el.dataset.card as string)
      if (!c || c.archivedAt) return
      const peers = this.cell(c.g, c.col)
      const i = peers.findIndex((x) => x.id === c.id)
      const j = e.key === 'ArrowUp' ? i - 1 : i + 2
      if ((e.key === 'ArrowUp' && i <= 0) || (e.key === 'ArrowDown' && i >= peers.length - 1)) return
      const before = peers[j]?.id ?? null
      if (await this.act('card/move', { id: c.id, group: c.g, col: c.col, beforeId: before }, '已调整顺序')) (this.root.querySelector('[data-card="' + c.id + '"]') as HTMLElement | null)?.focus()
      return
    }
    if (el && (e.key === 'Enter' || e.key === ' ') && t === el) { e.preventDefault(); el.click(); return }
    if ((e.key === 'Enter' || e.key === ' ') && t.dataset?.grPeek) { e.preventDefault(); t.click(); return }
    if (e.key === 'Enter' && (t.id === 'dpmLkQ' || t.id === 'dpmPopQ' || t.id === 'dpmArQ' || t.id === 'dpmLsQ')) { e.preventDefault(); return }
    if (t.id === 'dpmArFpIn' && !e.isComposing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.arFpOpen(false); this.$<HTMLElement>('#dpmArPaste').focus(); return }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); clearTimeout(this.arFpTimer); await this.arFpCheck(); await this.arFpAdd(); return }
    }
    if (e.key === 'Enter' && t.id === 'dpmNameInput' && (this.$<HTMLButtonElement>('#dpmNameOk')).disabled) { e.preventDefault(); return }
    if (e.key === 'Escape' && t.id === 'dpmAddIn' && !e.isComposing) {
      e.preventDefault()
      const a = this.adding
      this.adding = null
      this.addDraft = ''
      this.render()
      if (a) (this.root.querySelector('[data-add-card="' + a.g + '"][data-col="' + a.col + '"]') as HTMLElement | null)?.focus()
      return
    }
    if (e.key === 'Escape' && t.id === 'dpmRpQ') { e.preventDefault(); this.rp = null; this.lastDetail = ''; this.renderDetail(); (this.root.querySelector('[data-rc-add]') as HTMLElement | null)?.focus(); return }
    if (e.key === 'Escape' && this.back && !this.root.querySelector('dialog[open]')) { e.preventDefault(); this.goBack(); return }
  }

  // ── 卡片组：展开/收起、手柄拖动排序（pointer 事件：按住拖动，松开落位，Esc 取消） ──
  private async toggleGroup(id: string): Promise<void> {
    const g = this.grp(id)
    if (!g) return
    if (await this.act('group/update', { id, collapsed: !g.collapsed })) (this.root.querySelector('[data-toggle="' + CSS.escape(id) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  /**
   * 0.26 拖动卡片组（原型 v46–v50）：按下手柄起整页禁选文字；移动 4px 后进入「全部收起」模式（所有组只留标题栏，被拖的组头留在鼠标下）；
   * 贴近看板上 / 下边 64px 内自动滚动（越近越快）并显示提示条；松手恢复各组原展开状态，放下的组回到鼠标高度，不加蓝框、不留焦点框。Esc 取消。
   */
  private gd: { id: string; y0: number; x0: number; y: number; on: boolean; before: string | null | undefined; off: number; raf: number; ghost: HTMLElement | null } | null = null
  private gdMarks(): void { this.root.querySelectorAll('.gins-before, .gins-after').forEach((n) => n.classList.remove('gins-before', 'gins-after')) }
  private gdWrap(): HTMLElement { return this.root.querySelector('.board-wrap') as HTMLElement }
  private gdDown(e: PointerEvent): void {
    const h = (e.target as HTMLElement).closest?.('[data-gdrag]') as HTMLElement | null
    if (!h || e.button !== 0) return
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    const lane = this.root.querySelector('.lane[data-lane="' + CSS.escape(h.dataset.gdrag as string) + '"]') as HTMLElement | null
    this.gd = { id: h.dataset.gdrag as string, y0: e.clientY, x0: e.clientX, y: e.clientY, on: false, before: undefined, off: lane ? e.clientY - lane.getBoundingClientRect().top : 0, raf: 0, ghost: null }
    document.documentElement.classList.add('nosel'); getSelection()?.removeAllRanges()
  }
  private gdOn(): void {
    const gd = this.gd as NonNullable<BoardView['gd']>
    const g = this.grp(gd.id)
    this.root.classList.add('gd-mode')
    const lane = this.root.querySelector('.lane[data-lane="' + CSS.escape(gd.id) + '"]') as HTMLElement | null
    lane?.classList.add('lifting')
    // 收起后让被拖的组头仍停在鼠标下面（页面不跳）
    if (lane) { const w = this.gdWrap(); w.scrollTop += lane.getBoundingClientRect().top - (gd.y - Math.min(gd.off, 22)) }
    gd.ghost = document.createElement('div'); gd.ghost.className = 'dpm-gghost'
    gd.ghost.innerHTML = ic('grip') + '<span>' + esc(g?.name ?? '') + '</span><span class="n">' + this.liveN(gd.id) + ' 张卡片</span>'
    this.root.appendChild(gd.ghost)
    gd.raf = requestAnimationFrame(() => this.gdTick())
  }
  private gdTick(): void {
    const gd = this.gd
    if (!gd) return
    const w = this.gdWrap(), r = w.getBoundingClientRect(), EDGE = 64, MAX = 22
    let v = 0
    if (gd.y < r.top + EDGE) v = -Math.ceil(MAX * Math.min(1, (r.top + EDGE - gd.y) / EDGE))
    else if (gd.y > r.bottom - EDGE) v = Math.ceil(MAX * Math.min(1, (gd.y - (r.bottom - EDGE)) / EDGE))
    if (v) { const before = w.scrollTop; w.scrollTop += v; if (w.scrollTop !== before) this.gdMark() }
    const atTop = w.scrollTop <= 0, atBot = w.scrollTop + w.clientHeight >= w.scrollHeight - 1
    const et = w.querySelector('.edge.top') as HTMLElement | null, eb = w.querySelector('.edge.bot') as HTMLElement | null
    if (et && eb) { et.classList.toggle('on', v < 0 && !atTop); eb.classList.toggle('on', v > 0 && !atBot); et.style.top = w.scrollTop + 'px'; eb.style.bottom = -w.scrollTop + 'px' }
    gd.raf = requestAnimationFrame(() => this.gdTick())
  }
  private gdMark(): void {
    const gd = this.gd
    if (!gd) return
    this.gdMarks()
    const lanes = Array.from(this.root.querySelectorAll<HTMLElement>('.board-wrap > .lane[data-lane]')).filter((l) => l.dataset.lane !== gd.id)
    let before: HTMLElement | null = null
    for (const l of lanes) { const r = l.getBoundingClientRect(); if (gd.y < r.top + r.height / 2) { before = l; break } }
    if (before) before.classList.add('gins-before')
    else lanes[lanes.length - 1]?.classList.add('gins-after')
    gd.before = before ? (before.dataset.lane as string) : null
  }
  private gdMove(e: PointerEvent): void {
    const gd = this.gd
    if (!gd) return
    gd.y = e.clientY
    if (!gd.on) {
      if (Math.abs(e.clientY - gd.y0) < 4 && Math.abs(e.clientX - gd.x0) < 4) return
      gd.on = true
      this.gdOn()
    }
    const gh = gd.ghost as HTMLElement
    gh.style.left = Math.max(8, Math.min(e.clientX - 18, innerWidth - gh.offsetWidth - 8)) + 'px'
    gh.style.top = (e.clientY - 22) + 'px'
    this.gdMark()
  }
  private gdStop(commit: boolean): void {
    const gd = this.gd
    if (!gd) return
    this.gd = null
    cancelAnimationFrame(gd.raf)
    gd.ghost?.remove()
    document.documentElement.classList.remove('nosel'); getSelection()?.removeAllRanges()
    if (!gd.on) return
    this.gdMarks()
    this.root.querySelectorAll('.board-wrap .edge').forEach((n) => n.classList.remove('on'))
    this.root.querySelectorAll('.lane.lifting').forEach((n) => n.classList.remove('lifting'))
    this.root.classList.remove('gd-mode')
    // 恢复展开后，把放下的组头放回鼠标所在高度
    const put = (): void => { const el = this.root.querySelector('.lane[data-lane="' + CSS.escape(gd.id) + '"]') as HTMLElement | null; if (el) { const w = this.gdWrap(); w.scrollTop += el.getBoundingClientRect().top - (gd.y - 22) } }
    put()
    if (commit && gd.before !== undefined) void this.moveGroup(gd.id, gd.before, true).then(put)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
  /** 调整卡片组顺序：顺序没变不发请求；成功后其余组平滑让位，落位的组闪一下描边，焦点回到它的手柄。 */
  private async moveGroup(id: string, beforeId: string | null, drag = false): Promise<void> {
    const ids = this.groups.map((g) => g.id)
    const rest = ids.filter((x) => x !== id)
    rest.splice(beforeId ? rest.indexOf(beforeId) : rest.length, 0, id)
    if (rest.join() === ids.join()) return
    const tops = new Map<string, number>()
    this.root.querySelectorAll<HTMLElement>('[data-lane]').forEach((el) => tops.set(el.dataset.lane as string, el.getBoundingClientRect().top))
    if (!(await this.act('group/move', { id, beforeId }, '已调整卡片组顺序'))) return
    this.root.querySelectorAll<HTMLElement>('[data-lane]').forEach((el) => {
      const t0 = tops.get(el.dataset.lane as string)
      if (t0 === undefined) return
      const dy = t0 - el.getBoundingClientRect().top
      if (Math.abs(dy) > 2) { el.style.setProperty('--dy', dy + 'px'); el.classList.add('moved'); setTimeout(() => el.classList.remove('moved'), 380) }
    })
    // 0.26 拖动松手：不加蓝框、不留焦点框（只有键盘 Alt+↑↓ 排序时保留焦点）
    if (drag) return
    ;(this.root.querySelector('[data-gdrag="' + CSS.escape(id) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  // ── v98 ⑤ 卡片拖动（自绘 pointer 拖动）──
  // 为什么换掉原生 HTML5 拖放：① 原生要等浏览器判定（约 150ms）才起步 → 「拖不动、延迟」；
  // ② 原生拖影是元素快照、带偏移、不跟手；③ 原生落点只认指针正下方的元素 —— 列头、列底空白、
  //    「添加卡片」按钮、悬停工具条 / 提示浮层下面都收不到 drop → 有些区域根本拖不动。
  // 现在：落点用几何算（整条车道 + 任意列都算），拖影是自绘的卡片克隆，卡片之间显示虚线插入槽。
  private cd: {
    id: string; src: HTMLElement
    x0: number; y0: number; x: number; y: number
    on: boolean; h: number; dx: number; dy: number
    zs: Array<{ lane: HTMLElement; r: DOMRect; cells: Array<{ el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string }> }>
    ghost: HTMLElement | null
    cell: { el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string } | null
    tray: HTMLElement | null
    gap: HTMLElement | null
    raf: number
    pid: number
    esc: (e: KeyboardEvent) => void
  } | null = null
  /** 拖动结束后浏览器补的那一次 click 要吃掉（否则松手就误开详情）。 */
  private cdMute = false
  private cdZones(): Array<{ lane: HTMLElement; r: DOMRect; cells: Array<{ el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string }> }> {
    const out: Array<{ lane: HTMLElement; r: DOMRect; cells: Array<{ el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string }> }> = []
    for (const lane of Array.from(this.root.querySelectorAll<HTMLElement>('.board-wrap > .lane[data-lane]'))) {
      if (lane.classList.contains('collapsed') || !lane.querySelector('.lane-in')) continue
      const cells = [
        ...Array.from(lane.querySelectorAll<HTMLElement>('.lane-b .cell')).map((el) => ({ el, r: el.getBoundingClientRect(), pend: false, col: el.dataset.col as string, g: el.dataset.g as string })),
        ...Array.from(lane.querySelectorAll<HTMLElement>('.ptray .pcell')).map((el) => ({ el, r: el.getBoundingClientRect(), pend: true, col: el.dataset.col as string, g: el.dataset.g as string })),
      ]
      if (cells.length) out.push({ lane, r: lane.getBoundingClientRect(), cells })
    }
    return out
  }
  private cdHit(x: number, y: number): { el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string } | null {
    const d = this.cd
    if (!d) return null
    let best: { cell: { el: HTMLElement; r: DOMRect; pend: boolean; col: string; g: string }; score: number } | null = null
    for (const z of d.zs) {
      if (y < z.r.top - 4 || y > z.r.bottom + 4) continue
      for (const c of z.cells) {
        if (x < c.r.left - 14 || x > c.r.right + 14) continue
        // 纵向优先：指针真的落在这一格里（列 + pending 分格 x 范围常常一样，只按 x 会抢错）
        const dy = y < c.r.top ? c.r.top - y : (y > c.r.bottom ? y - c.r.bottom : 0)
        const dx = Math.min(Math.abs(x - c.r.left), Math.abs(x - c.r.right))
        const score = dy * 1000 + dx
        if (!best || score < best.score) best = { cell: c, score }
      }
    }
    return best ? best.cell : null
  }
  private cdTrayAt(x: number, y: number): HTMLElement | null {
    const d = this.cd
    const c = d ? this.card(d.id) : undefined
    if (!c) return null
    const tray = this.root.querySelector('.atray[data-tray-g="' + CSS.escape(c.g) + '"]') as HTMLElement | null
    if (!tray || tray.offsetParent === null) return null
    const r = tray.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? tray : null
  }
  private cdGap(cell: { el: HTMLElement; pend: boolean }, y: number): HTMLElement {
    const d = this.cd
    const cards = Array.from(cell.el.querySelectorAll<HTMLElement>(cell.pend ? '.pcard' : '.card')).filter((n) => n !== d?.src)
    let before: HTMLElement | null = null
    for (const n of cards) { const r = n.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = n; break } }
    let gap = cell.el.querySelector(':scope > .dpm-gap') as HTMLElement | null
    if (!gap) { gap = document.createElement('div'); gap.className = 'dpm-gap' + (cell.pend ? ' p' : ''); gap.setAttribute('aria-hidden', 'true') }
    gap.style.height = (cell.pend ? 26 : Math.max(36, d?.h ?? 36)) + 'px'
    if (before) { if (gap.nextElementSibling !== before) cell.el.insertBefore(gap, before) }
    else {
      const addc = cell.el.querySelector('.addc')
      if (addc) { if (gap.nextElementSibling !== addc) cell.el.insertBefore(gap, addc) }
      else if (gap.parentElement !== cell.el || gap.nextElementSibling) cell.el.append(gap)
    }
    return gap
  }
  private cdWipe(): void {
    for (const d of Array.from(this.root.querySelectorAll<HTMLElement>('.dpm-gap'))) d.remove()
    for (const n of Array.from(this.root.querySelectorAll<HTMLElement>('.drop-ok'))) n.classList.remove('drop-ok')
    for (const n of Array.from(this.root.querySelectorAll<HTMLElement>('.atray.over'))) n.classList.remove('over')
  }
  private cdGhost(src: HTMLElement): HTMLElement {
    const r = src.getBoundingClientRect()
    const box = document.createElement('div')
    box.className = 'dpm-ghost'
    box.style.width = r.width + 'px'
    const wrap = document.createElement('div')
    wrap.className = 'dpm dpm-ghost-bd'
    wrap.style.width = r.width + 'px'
    if (src.classList.contains('pcard')) {
      const tray = document.createElement('div'); tray.className = 'ptray dpm-ghost-tray'
      const cols = document.createElement('div'); cols.className = 'pcols'; cols.style.setProperty('--cols', '1')
      const pc = document.createElement('div'); pc.className = 'pcell'
      pc.append(src.cloneNode(true)); cols.append(pc); tray.append(cols); wrap.append(tray)
    } else wrap.append(src.cloneNode(true))
    for (const n of Array.from(wrap.querySelectorAll<HTMLElement>('.cacts'))) n.remove()
    for (const n of Array.from(wrap.querySelectorAll<HTMLElement>('.card, .pcard'))) n.style.width = '100%'
    for (const n of Array.from(wrap.querySelectorAll<HTMLElement>('[data-card]'))) { n.removeAttribute('data-card'); n.removeAttribute('draggable'); n.removeAttribute('tabindex'); n.removeAttribute('role') }
    box.append(wrap)
    document.body.append(box)
    return box
  }
  private cdPut(x: number, y: number, force = false): void {
    const d = this.cd
    if (!d) return
    const moved = Math.hypot(x - d.x, y - d.y)
    d.x = x; d.y = y
    if (d.ghost) d.ghost.style.transform = 'translate3d(' + Math.round(x - d.dx) + 'px,' + Math.round(y - d.dy) + 'px,0) rotate(-1.2deg)'
    const tray = this.cdTrayAt(x, y)
    if (tray) {
      if (d.gap) { this.cdWipe(); d.gap = null; d.cell = null }
      d.tray = tray
      tray.classList.add('over')
      return
    }
    if (d.tray) { d.tray.classList.remove('over'); d.tray = null }
    const cell = this.cdHit(x, y)
    if (!cell) { if (d.gap) { this.cdWipe(); d.gap = null; d.cell = null } return }
    const same = !!d.cell && d.cell.el === cell.el
    if (!same) this.cdWipe()
    d.cell = cell
    cell.el.classList.add('drop-ok')
    // 同一格 + 指针没怎么动 → 保持插入槽（否则占位一插进去、布局一变，判定就翻到别处去，看着像抖）
    if (!force && same && d.gap && moved < 8) return
    d.gap = this.cdGap(cell, y)
  }
  private cdScroller(): HTMLElement | null { return this.root.querySelector('.board-wrap') as HTMLElement | null }
  /** 指针所在卡片组的横向滚动层（.lane-in，列挤不下时它左右滚）。 */
  private cdHScroll(): HTMLElement | null {
    const d = this.cd
    if (!d) return null
    const lanes = Array.from(this.root.querySelectorAll<HTMLElement>('.board-wrap .lane[data-lane]'))
    const lane = lanes.find((l) => { const r = l.getBoundingClientRect(); return d.y >= r.top && d.y <= r.bottom })
    const holder = lane ?? (d.src.closest('.lane') as HTMLElement | null)
    const box = holder ? (holder.querySelector('.lane-in') as HTMLElement | null) : null
    return box && box.scrollWidth > box.clientWidth + 2 ? box : null
  }
  private cdTick(): void {
    const d = this.cd
    if (!d || !d.on) return
    const sc = this.cdScroller()
    if (sc) {
      const EDGE = 64, r = sc.getBoundingClientRect()
      let v = 0
      if (d.y < r.top + EDGE) v = -(r.top + EDGE - d.y) / 5
      else if (d.y > r.bottom - EDGE) v = (d.y - (r.bottom - EDGE)) / 5
      if (v) { sc.scrollTop += Math.max(-30, Math.min(30, v)); d.zs = this.cdZones(); this.cdPut(d.x, d.y, true) }
      // 横向滚的是每个卡片组自己的 .lane-in（不是外层 .board-wrap）
      const hs = this.cdHScroll()
      if (hs) {
        const hr = hs.getBoundingClientRect()
        let h = 0
        if (d.x < hr.left + EDGE) h = -(hr.left + EDGE - d.x) / 5
        else if (d.x > hr.right - EDGE) h = (d.x - (hr.right - EDGE)) / 5
        if (h) { hs.scrollLeft += Math.max(-32, Math.min(32, h)); d.zs = this.cdZones(); this.cdPut(d.x, d.y, true) }
      }
    }
    d.raf = requestAnimationFrame(() => this.cdTick())
  }
  private cdStart(): void {
    const d = this.cd
    if (!d) return
    const r = d.src.getBoundingClientRect()
    d.on = true
    d.h = r.height
    d.ghost = this.cdGhost(d.src)
    d.src.classList.add('dragging')
    document.documentElement.classList.add('dpm-cdrag')
    try { getSelection()?.removeAllRanges() } catch { /* noop */ }
    d.zs = this.cdZones()
    this.cdPut(d.x, d.y, true)
    d.raf = requestAnimationFrame(() => this.cdTick())
  }
  private cdDown(e: PointerEvent): void {
    if (e.button !== 0 || this.cd || this.gd) return
    const t = e.target as HTMLElement
    if (t.closest?.('.cacts')) return
    const src = t.closest?.('.card[data-card], .pcard[data-card]') as HTMLElement | null
    if (!src || !this.root.contains(src) || !this.card(src.dataset.card as string)) return
    const r = src.getBoundingClientRect()
    this.cdMute = false // 新手势：清掉上一次拖动留下的吞 click 标记
    try { src.setPointerCapture(e.pointerId) } catch { /* noop */ }
    const esc = (ev: KeyboardEvent): void => { if (ev.key !== 'Escape' || !this.cd) return; ev.preventDefault(); ev.stopPropagation(); void this.cdStop(false) }
    document.addEventListener('keydown', esc, true)
    this.cd = { id: src.dataset.card as string, src, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, h: r.height, dx: e.clientX - r.left, dy: e.clientY - r.top, zs: [], ghost: null, cell: null, tray: null, gap: null, raf: 0, pid: e.pointerId, esc }
  }
  private cdMove(e: PointerEvent): void {
    const d = this.cd
    if (!d) return
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return
      d.x = e.clientX; d.y = e.clientY
      this.cdStart()
      return
    }
    this.cdPut(e.clientX, e.clientY)
  }
  private async cdStop(commit: boolean): Promise<void> {
    const d = this.cd
    if (!d) return
    this.cd = null
    cancelAnimationFrame(d.raf)
    document.removeEventListener('keydown', d.esc, true)
    document.documentElement.classList.remove('dpm-cdrag')
    d.ghost?.remove()
    d.src.classList.remove('dragging')
    try { d.src.releasePointerCapture(d.pid) } catch { /* noop */ }
    const gap = d.gap
    const cell = d.cell
    const tray = d.tray
    const c = this.card(d.id)
    this.cdWipe()
    if (!d.on) return
    this.cdMute = true
    if (!commit) { this.host.toast('已取消这次拖动', 'ok'); return }
    if (tray) { if (c) await this.archiveCard(c.id); return }
    if (!cell || !c) return
    const tops = new Map<string, number>()
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.card, .pcard'))) { if (el.dataset.card) tops.set(el.dataset.card as string, el.getBoundingClientRect().top) }
    if (cell.pend) {
      if (this.badgeOf(c.id)?.live) { this.host.toast('这张卡片有活跃会话，不能设为 pending', 'err'); return }
      await this.pendCard(c.id, true, cell.col)
    } else if (c.pending) {
      await this.pendCard(c.id, false, cell.col)
    } else {
      let bid = gap && gap.nextElementSibling instanceof HTMLElement ? (gap.nextElementSibling.dataset.card ?? null) : null
      if (bid === c.id) bid = (gap?.nextElementSibling?.nextElementSibling as HTMLElement | null)?.dataset?.card ?? null
      if (!(await this.move(c, cell.g, cell.col, bid))) return
    }
    // 松手：其余卡片平滑让位、落位卡片一下浅蓝闪光
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.card, .pcard'))) {
      const t0 = el.dataset.card ? tops.get(el.dataset.card as string) : undefined
      if (t0 === undefined) continue
      const dy = t0 - el.getBoundingClientRect().top
      if (Math.abs(dy) > 2) { el.style.setProperty('--dy', dy + 'px'); el.classList.add('moved'); setTimeout(() => el.classList.remove('moved'), 360) }
    }
    const hit = this.root.querySelector('[data-card="' + CSS.escape(c.id) + '"]') as HTMLElement | null
    if (hit) { hit.classList.add('landed'); setTimeout(() => hit.classList.remove('landed'), 700) }
  }

  /** 统一的移动入口（拖拽 / 步骤条 / 推进按钮）。 */
  private async move(c: Card, gId: string, col: string, before: string | null): Promise<boolean> {
    const g = this.grp(gId)
    const to = g ? this.st(g, col) : undefined
    if (!g || !to) return false
    const crossing = c.col !== col || c.g !== gId
    return this.act('card/move', { id: c.id, group: gId, col, beforeId: before }, crossing ? '已移到「' + to.name + '」' : '已调整顺序')
  }

  // ── 就地添加卡片 ──
  private async submitCard(): Promise<void> {
    const a = this.adding
    const inp = this.root.querySelector('#dpmAddIn') as HTMLInputElement | null
    const v = inp?.value.trim() ?? ''
    if (!a || !inp || v === '' || this.addBusy) return
    const dd0 = this.dedupe(v)
    if (dd0.exact && !this.addForce) {
      this.addForce = true
      this.paintDedupe()
      requestAnimationFrame(() => this.flashDup('#dpmDupBox'))
      this.host.toast('已存在同名' + (dd0.exact.kind === 'group' ? '卡片组' : '卡片') + '「' + dd0.exact.name + '」：点「仍要新建」才会建', 'err')
      return
    }
    this.addForce = false
    this.addBusy = true
    inp.value = ''
    this.addDraft = ''
    const before = new Set(this.cards.map((x) => x.id))
    let ok = false
    try { ok = await this.act('card/create', { group: a.g, col: a.col, title: v }, '已添加卡片') } finally { this.addBusy = false }
    if (!ok) { this.addDraft = v + this.addDraft; this.render() }
    if (!ok) this.addForce = false
    const added = ok ? this.cards.find((x) => !before.has(x.id) && x.g === a.g && x.col === a.col) : undefined
    const el = added ? this.root.querySelector('[data-card="' + added.id + '"]') as HTMLElement | null : null
    if (el) { el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 450) }
    ;(this.root.querySelector('#dpmAddIn') as HTMLInputElement | null)?.focus()
  }
  /** 输入框空着失焦 → 只把表单换回按钮（不整体重绘，避免吞掉用户正在点的卡片/按钮）。 */
  private onFocusOut(e: FocusEvent): void {
    const t = e.target as HTMLElement
    // 0.24 子任务编辑卡「点外面保存」改在 pointerdown + click 里处理（编辑卡内有多个输入框，不能按单个失焦判断）
    if (t.id !== 'dpmAddIn' || this.rendering || this.addBusy || this.addDraft.trim() !== '') return
    const a = this.adding
    this.adding = null
    const g = a ? this.grp(a.g) : undefined
    const st = g && a ? this.st(g, a.col) : undefined
    const f = t.closest('form')
    if (f && g && st && f.isConnected) f.outerHTML = this.addHtml(g, st)
  }

  // ── 对话框 ──

  private nameTarget = ''
  private askName(title: string, hint: string, value: string, target: string): void {
    const d = this.$<HTMLDialogElement>('#dpmDlgName')
    this.$('#dpmNameT').textContent = title
    this.$('#dpmNameP').textContent = hint
    const inp = this.$<HTMLInputElement>('#dpmNameInput')
    inp.value = value
    this.$<HTMLButtonElement>('#dpmNameOk').disabled = value.trim() === ''
    this.nameTarget = target
    this.nameForce = false
    this.paintNameDup()
    d.returnValue = ''
    d.showModal()
    inp.focus()
    inp.select()
  }

  private async onDialogClose(id: string, d: HTMLDialogElement): Promise<void> {
    const ok = d.returnValue === 'ok'
    if (id === 'dpmDlgName' && ok) {
      const v = this.$<HTMLInputElement>('#dpmNameInput').value.trim()
      const [kind, a] = this.nameTarget.split(':')
      if (kind === 'group') await this.act('group/create', { name: v }, '卡片组已创建，默认 5 个阶段')
      else if (kind === 'rename') await this.act('card/update', { id: a, title: v }, '已重命名')
      return
    }
    if (id === 'dpmDlgLink') { if (ok) await this.saveLink(); this.link = null; if (this.$<HTMLDialogElement>('#dpmDlgSt').open) this.renderGroupSettings(); return }
    if (id === 'dpmDlgImp' && ok) await this.doImport()
    if (id === 'dpmDlgSess') { const a = this.ls; this.ls = null; if (ok && a && a.sel.length) await this.saveLinkSess(a); return }
    if (id === 'dpmDlgSArc') { const a = this.sa; this.sa = null; if (ok && a) await this.stopAndArchive(a.id, a.title); return }
    if (id === 'dpmDlgCfm') { const sid = this.cf; this.cf = null; if (ok && sid) await this.doUnbind(sid); return }
    if (id === 'dpmDlgRepo') { const a = this.ar; this.ar = null; clearTimeout(this.arFpTimer); this.$('#dpmArFpSlot').innerHTML = ''; this.$('#dpmArPaste').textContent = '粘贴路径'; this.$('#dpmArPaste').setAttribute('aria-expanded', 'false'); const cb = this.arAddCb; this.arAddCb = null; if (ok && a && a.sel.length) { const done = await this.saveAddRepo(a); cb?.(done && a.mode === 'card' ? { name: a.sel[0].name.replace(/\s+/g, ' ').trim(), path: (this.card(a.id)?.repos ?? []).find((r) => normPath(r.path) === normPath(a.sel[0].path))?.path ?? a.sel[0].path } : null) } else cb?.(null); return }
    if (id === 'dpmDlgRm') { const cid = this.rmCard; this.rmCard = null; if (ok && cid) { if (this.sel === cid) this.sel = null; this.back = null; await this.act('card/remove', { id: cid }, '已删除卡片') } return }
    if (id === 'dpmDlgFa') { this.fa = null; clearTimeout(this.faTimer); const cb = this.faAddCb; this.faAddCb = null; cb?.([]); return }
    if (id === 'dpmDlgSt') this.editG = null
    if (id === 'dpmDlgWl') { this.wl = null; const cb = this.wlAddCb; this.wlAddCb = null; cb?.([]) }
    if (id === 'dpmDlgTy') { const k = this.ty?.kind ?? 'link'; const op = this.ty?.opener; this.tdStop(false); this.ty = null; if (op?.isConnected) { try { op.focus({ preventScroll: true }) } catch { /* */ } } this.lastDetail = ''; this.renderDetail(); if (this.taskEdit && k === 'task') (this.root.querySelector('#dpmTaskTy') as HTMLElement | null)?.focus({ preventScroll: true }); else (this.root.querySelector('.detail [data-types="' + k + '"]') as HTMLElement | null)?.focus({ preventScroll: true }) }
  }
  /** 批量添加：在「完整链接」里粘贴多行 → 自动拆成多条（沿用当前行的类型）。 */
  private onPaste(e: ClipboardEvent): void {
    const t = e.target as HTMLInputElement
    const w = this.wl
    if (!w || w.mode !== 'add' || t.dataset?.wurl === undefined) return
    const lines = (e.clipboardData?.getData('text') ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    if (lines.length < 2) return
    e.preventDefault()
    const i = Number(t.dataset.wurl)
    const type = w.rows[i].type
    w.rows[i].url = lines[0]
    w.rows.splice(i + 1, 0, ...lines.slice(1).map((u) => ({ ...this.blankRow(type), url: u })))
    this.wlRender()
    this.host.toast('已拆成 ' + lines.length + ' 条，显示文字不填就用网址')
  }

  // ── 卡片组设置（组名 / 关联落盘项目 / 仓库 / 阶段）──
  private stDraft: Status[] = []
  private openGroupSettings(focusLinks: boolean): void {
    const g = this.grp(this.editG ?? '')
    if (!g) return
    this.stDraft = g.statuses.map((s) => ({ ...s }))
    this.paintGroupSettings()
    const d = this.$<HTMLDialogElement>('#dpmDlgSt')
    if (!d.open) d.showModal()
    if (focusLinks) setTimeout(() => this.$('#dpmStLinks')?.scrollIntoView({ block: 'start' }), 0)
  }
  private renderGroupSettings(): void {
    const g = this.grp(this.editG ?? '')
    if (!g) return
    if (this.$('#dpmStList').querySelector('[data-stname]')) this.readDrafts()
    this.paintGroupSettings()
  }
  private paintGroupSettings(): void {
    const g = this.grp(this.editG ?? '')
    if (!g) return
    this.$('#dpmStP').textContent = '只影响「' + g.name + '」。阶段就是看板上的列，只用来给卡片分组；名称、数量、顺序都可以改。'
    const gl = g.links.map((k) => { const s = this.stateOf(k); return '<div class="gl-row">' + ic('mem') + '<span class="grow"><span class="nm">' + esc(s?.slug ?? k) + '</span> <span class="meta">' + esc(s?.project ?? '未找到') + '</span></span><button type="button" class="ib" data-unlink-group="' + esc(k) + '" aria-label="取消关联 ' + esc(k) + '">' + ic('x') + '</button></div>' }).join('') || '<p class="meta">还没有关联。关联后，这个组里所有卡片的会话都会自动读取。</p>'
    const repos = g.repos.map((r, i) => '<div class="rp-row"><input class="fld" aria-label="仓库名 ' + (i + 1) + '" data-rpname="' + i + '" value="' + esc(r.name) + '" maxlength="120"><input class="fld" aria-label="仓库角色 ' + (i + 1) + '" data-rprole="' + i + '" value="' + esc(r.role) + '" maxlength="40"><span class="mono" title="' + esc(r.path) + '">' + esc(r.path) + '</span><button type="button" class="ib" data-repodel="' + i + '" aria-label="移除仓库 ' + esc(r.name) + '">' + ic('x') + '</button></div>').join('')
    const sts = this.stDraft.map((st, i) => '<div class="st-row"><button type="button" class="ib sm grip" data-stup="' + i + '" aria-label="上移 ' + esc(st.name) + '"' + (i === 0 ? ' disabled' : '') + '>' + (i + 1) + '</button>'
      + '<input class="fld" aria-label="阶段名 ' + (i + 1) + '" data-stname="' + i + '" value="' + esc(st.name) + '">'
      + '<button type="button" class="ib" data-stdel="' + i + '" aria-label="删除阶段 ' + esc(st.name) + '">' + ic('x') + '</button></div>').join('')
    this.$('#dpmStList').innerHTML = '<label class="lbl" for="dpmGroupName">组名</label><input class="fld" id="dpmGroupName" value="' + esc(g.name) + '">'
      + '<label class="lbl" for="dpmGroupLf">落盘文件夹</label><div class="lf-fld"><span class="pre">~/.ai/projects/</span><input id="dpmGroupLf" value="' + esc(g.lfProject ?? '') + '" placeholder="还没设（第一次在这个组落盘时会请你确认）" spellcheck="false" autocomplete="off" maxlength="64"><span class="pre">/</span></div>'
      + '<p class="meta mb">这个组新建、合并、迁移的落盘项目都放进这里；旧的落盘项目在下次落盘时自动迁过来（可在会话信息卡撤销）。改名不会搬已有文件。失焦即保存。</p>'
      + '<div class="lbl row" id="dpmStLinks">关联的落盘项目 · ' + g.links.length + '<span class="grow"></span><button type="button" class="btn ghost sm" data-link-group="' + esc(g.id) + '">' + ic('plus') + '关联</button></div>' + gl
      + '<div class="lbl row">卡片共用仓库 · ' + g.repos.length + '<span class="grow"></span><button type="button" class="btn ghost sm" id="dpmRepoAdd">' + ic('plus') + '添加卡片共用仓库</button></div>'
      + '<p class="meta mb">在这个组里新建卡片时，会自动带上这些仓库。这里的改动只影响之后新建的卡片，组里已有的 ' + this.cardsOf(g.id) + ' 张卡片不变。</p>'
      + (repos ? repos + '<p class="meta">名称、角色改完离开输入框即保存；要换路径就移除后重新添加。</p>' : '<p class="ar-empty">还没有卡片共用仓库。新建的卡片不会自动带仓库，可以在卡片详情里单独新增。</p>')
      + '<div class="lbl">阶段（点序号上移）</div>' + sts + '<button type="button" class="btn ghost sm" id="dpmStAdd">' + ic('plus') + '添加阶段</button><p class="meta">阶段下还有卡片时不能删除，先把卡片移走。</p>'
  }
  private readDrafts(): void {
    this.stDraft = this.stDraft.map((st, i) => {
      const name = (this.root.querySelector('[data-stname="' + i + '"]') as HTMLInputElement | null)?.value ?? st.name
      return { id: st.id, name }
    })
  }
  /** 阶段编辑即时生效：改草稿 → 服务端校验（失败点名并回滚草稿）。 */
  private async stEdit(fn: (list: Status[]) => void): Promise<void> {
    this.readDrafts()
    const next = this.stDraft.map((s) => ({ ...s }))
    fn(next)
    const g = this.grp(this.editG ?? '')
    if (!g) return
    const ok = await this.act('group/update', { id: g.id, statuses: next })
    this.stDraft = ((ok ? this.grp(g.id) : g) as Group).statuses.map((s) => ({ ...s }))
    this.paintGroupSettings()
  }
  /** 已挂载仓库行内改名/角色：失焦（change）即保存；空名或重名当场拒绝并恢复原值。 */
  private async saveRepoField(t: HTMLInputElement): Promise<void> {
    const g = this.grp(this.editG ?? '')
    const i = Number(t.dataset.rpname ?? t.dataset.rprole)
    const r = g?.repos[i]
    if (!g || !r) return
    const v = t.value.replace(/\s+/g, ' ').trim()
    let next = r
    if (t.dataset.rpname !== undefined) {
      if (!v) { t.value = r.name; this.host.toast('仓库名不能为空', 'err'); return }
      if (g.repos.some((x, k) => k !== i && x.name === v)) { t.value = r.name; this.host.toast('「' + g.name + '」已有同名仓库「' + v + '」', 'err'); return }
      if (v === r.name) return
      next = { ...r, name: v }
    } else {
      const role = v || '仓库'
      t.value = role
      if (role === r.role) return
      next = { ...r, role }
    }
    if (await this.act('group/update', { id: g.id, repos: g.repos.map((x, k) => (k === i ? next : x)) }, '已保存，项目区软链接已更新')) this.renderGroupSettings()
    else t.value = t.dataset.rpname !== undefined ? r.name : r.role
  }

  /** dsh 会话 / 工作区推送变化：详情栏重绘；弹窗开着时刷新候选（保留搜索词与已选）。 */
  /* v121（5 / 6）根因：全局卡片详情订阅了会话推送，会话流式输出时一秒推几十次，每次都整块重算 + 替换详情 DOM ——
     ① 页面卡；② 正在用中文输入法打字的输入框被换掉，选字框当场消失（只有「相关说明」两个框被豁免）。
     修法：会话推送合并到 250ms 一次，且只在这张卡片的会话行（数量 / 名称 / 归档状态）变了才重画；
     任何输入框正在选字（composition）或聚焦编辑时，延后到选字结束 / 失焦。 */
  private pushT = 0
  private pushPend = false
  private sessSig = ''
  private detailSessSig(): string {
    if (!this.sel) return ''
    const idx = this.sessIndex()
    return (this.snap?.board.sessions ?? []).filter((r) => r.cardId === this.sel).map((r) => { const v = idx.get(r.sessionId); return r.sessionId + ':' + (v ? (v.archived ? 'a' : 'l') + ':' + v.title : 'x') }).join('|')
  }
  private dragging(): boolean { return !!(this.tkd?.on || this.xd?.on || this.nd?.on || this.td?.on || this.wd?.on) }
  private editingHere(): boolean {
    if (this.dragging()) return true
    const ae = document.activeElement as HTMLElement | null
    if (!ae || !this.root.contains(ae)) return false
    return this.composing || ae.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable="true"]')
  }
  private pushFlush(): void {
    this.pushT = 0
    if (this.disposed || !this.pushPend) return
    if (this.editingHere()) { this.pushT = window.setTimeout(() => this.pushFlush(), 250); return }
    this.pushPend = false
    const sig = this.detailSessSig()
    if (sig === this.sessSig) return
    this.sessSig = sig
    if (this.sel) { this.root.dataset.drenders = String((Number(this.root.dataset.drenders) || 0) + 1); this.renderDetail() }
  }
  /** 验收探针（dpm:test-push）：模拟会话推送；force = 当作会话行变了（要重画）。计数写在 root.dataset 上。 */
  testPush(force: boolean): void {
    if (force) this.sessSig = '#force'
    this.root.dataset.pushes = String((Number(this.root.dataset.pushes) || 0) + 1)
    this.onSessionsChanged()
  }
  onSessionsChanged(): void {
    if (this.disposed) return
    /* v133 R4：看板有攒着的重画（日程页期间 / 刚切回）就不在这里同步算签名、重画 —— 切回看板的下一帧统一画一次 */
    if (!this.opts.detailOnly && this.boardDirty) { if (this.ls) this.renderLinkSess(); return }
    const sig = this.chipSignature()
    // v88：全局详情（detail-only）不在看板面板里，会话 / 工作区推送要能更新详情 —— v121：合并到 250ms 一次、只在会话行变了才重画
    if (this.opts.detailOnly) {
      this.chipSig = sig
      this.pushPend = true
      if (!this.pushT) this.pushT = window.setTimeout(() => this.pushFlush(), 250)
      return
    }
    // 卡片上的会话标志（数量 / 有无活跃）变了才重绘看板，否则只更新详情
    if (sig !== this.chipSig && !this.gd && !this.composing) this.render()
    else if (this.sel && !this.$<HTMLDialogElement>('#dpmDlgSess').open) this.renderDetail()
    if (this.ls) this.renderLinkSess()
  }

  // ── 本卡片的会话：关联已有会话 / 恢复活跃 / 解除关联 ──
  private sessIndex(): Map<string, SessionView> { const m = new Map<string, SessionView>(); for (const s of this.host.allSessions()) m.set(s.id, s); return m }
  /**
   * 0.28（v58）本卡片的会话：固定在详情顶部（在滚动区外面）的浅蓝通栏，没有标题行。
   * 收起：有活跃会话 = 只显示最新那一行（+N = 还有几个活跃）；没有活跃 = 只显示底栏（已归档 N 个 · 关联已有会话）。
   * 悬停展开：全部活跃会话 + 底栏（归档列表仍收起，点了才展开），浮在下面内容之上，不推动分区。
   */
  private sessArc = false
  private sessOpen = false
  private linkedHtml(c: Card, ro = false): string {
    const refs = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id)
    const idx = this.sessIndex()
    const canRestore = this.snap?.caps?.unarchive !== false
    const sorted = sortLinked(refs, idx)
    // 活跃 = 没归档（含未开始）；归档区 = 已归档 + 已删除
    const live = sorted.filter((r) => { const v = idx.get(r.sessionId); return v && !v.archived })
    const arc = sorted.filter((r) => { const v = idx.get(r.sessionId); return !v || v.archived })
    const row = (r: (typeof refs)[number], more = 0): string => {
      const v = idx.get(r.sessionId)
      const title = v?.title ?? r.title ?? '会话 ' + r.sessionId.slice(0, 8)
      const tb = (k: string, icon: string, tip: string, cls = ''): string => '<button type="button" class="ib sm tipbtn' + cls + '" data-' + k + '="' + esc(r.sessionId) + '" aria-label="' + tip + ' ' + esc(title) + '">' + ic(icon) + '<span class="tip" aria-hidden="true">' + tip + '</span></button>'
      const unl = ro ? '' : tb('unbind', 'unlink', '解除关联', ' unl')
      if (!v) return '<div class="srow gone" title="原名「' + esc(title) + '」"><span class="chip sarch">已删除会话</span><span class="sn">' + esc(title) + '</span><span class="smeta">会话已删除</span>' + (unl ? '<span class="sacts">' + unl + '</span>' : '') + '</div>'
      const st = v.archived ? 'arch' : v.blank ? 'blank' : 'live'
      const chip = st === 'arch' ? '<span class="chip sarch">已归档会话</span>' : st === 'blank' ? '<span class="chip plain">未开始会话</span>' : '<span class="chip slive">活跃会话</span>'
      const nm = v.archived ? '<span class="sn" title="已归档的会话不能打开，先「恢复活跃」">' + esc(title) + '</span>' : '<button type="button" class="sn" data-open-sess="' + esc(v.id) + '" title="打开会话：' + esc(title) + '">' + esc(title) + '</button>'
      const meta = '<span class="smeta">' + (v.forkOf ? '分叉自「' + esc(v.forkOf) + '」 · ' : '') + esc(ago(v.updatedAt)) + '</span>'
      const restore = '<button type="button" class="btn ghost xs" data-restore="' + esc(v.id) + '"' + (canRestore && !this.restoring.has(v.id) ? '' : ' disabled') + ' title="' + (canRestore ? '恢复到工作区原来的位置' : '当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）') + '">' + ic('restore') + (this.restoring.has(v.id) ? '恢复中…' : '恢复活跃') + '</button>'
      const qbS = qbtn(sessionText(title, this.grp(c.g)?.name, c.t, v.id), title)
      const acts = (ro ? '' : '<span class="sacts">' + qbS + (v.archived ? restore : (v.blank && this.host.canDeleteSession() ? tb('del-sess', 'trash', '删除（还没有对话）', ' unl') : '') + tb('archive-sess', 'archive', '归档会话')) + unl + '</span>') || '<span class="sacts">' + qbS + '</span>'
      const mo = more ? '<span class="more" aria-label="还有 ' + more + ' 个活跃会话">+' + more + '</span>' : ''
      return '<div class="srow ' + st + '" title="' + esc(title) + '">' + chip + nm + meta + mo + acts + '</div>'
    }
    const left = arc.length ? '<button type="button" class="atg" data-sess-arc aria-expanded="' + this.sessArc + '" aria-controls="dpmArcL">已归档 ' + arc.length + ' 个' + ic('chev') + '</button>'
      : '<span class="pnone">' + (refs.length ? '没有已归档的会话' : '还没有会话') + '</span>'
    const bar = '<div class="pbar">' + left + '<span class="sp"></span>' + (ro ? '' : '<button type="button" class="btn ghost sm plink" data-link-sess>' + ic('link') + '关联已有会话</button>') + '</div>'
    const arcl = arc.length ? '<div class="arcl' + (this.sessArc ? ' open' : '') + '" id="dpmArcL"><div class="arci">' + arc.map((r) => row(r)).join('') + '</div></div>' : ''
    const body = live.length ? row(live[0], live.length - 1) + '<div class="pf"><div class="pfi"><div class="lst">' + live.slice(1).map((r) => row(r)).join('') + bar + arcl + '</div></div></div>' : bar + arcl
    return '<div class="pinw" id="dpmPinW"><section class="ss' + (this.sessOpen ? ' open now' : '') + '" id="dpmPin" aria-label="本卡片的会话 · ' + refs.length + ' 个，' + live.length + ' 个活跃">' + body + '</section></div>'
  }
  private openLinkSess(c: Card): void {
    this.ls = { card: c.id, q: '', sel: [], busy: false }
    this.$<HTMLInputElement>('#dpmLsQ').value = ''
    this.$('#dpmLsP').textContent = '勾选的会话会关联到「' + c.t + '」，之后每一轮自动读取这张卡片的落盘项目记忆（会话里已读过的不重复读取）。一个会话只属于一张卡片。'
    this.renderLinkSess()
    const d = this.$<HTMLDialogElement>('#dpmDlgSess')
    d.returnValue = ''
    d.showModal()
    this.$<HTMLInputElement>('#dpmLsQ').focus()
  }
  private lsRow(v: SessionView, picked: boolean): string {
    const ref = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === v.id)
    const other = ref && this.ls && ref.cardId !== this.ls.card ? this.card(ref.cardId) : undefined
    return '<label class="ls-row"><input type="checkbox" ' + (picked ? 'data-lsel' : 'data-ls') + '="' + esc(v.id) + '"' + (picked ? ' checked' : '') + '><span class="txt"><span class="nm" title="' + esc(v.title) + '">' + esc(v.title) + '</span>'
      + (other ? '<span class="oth" title="保存后从「' + esc(other.t) + '」移到本卡片">已关联在「' + esc(other.t) + '」</span>' : '') + '</span>'
      + (picked ? '<span class="chip ' + (v.archived ? 'arch">已归档' : 'live">活跃') + '</span>' : '')
      + '<span class="t">' + esc(picked ? v.ws + ' · ' + ago(v.updatedAt) : ago(v.updatedAt)) + '</span></label>'
  }
  private renderLinkSess(): void {
    const a = this.ls
    if (!a) return
    const all = this.host.allSessions()
    const mine = new Set((this.snap?.board.sessions ?? []).filter((s) => s.cardId === a.card).map((s) => s.sessionId))
    const exclude = new Set([...mine, ...a.sel])
    const col = (archived: boolean): { html: string; n: number } => {
      const gs = groupSessions(all, { archived, exclude, q: a.q })
      const n = gs.reduce((k, g) => k + g[1].length, 0)
      const html = gs.map(([ws, list]) => '<div class="ls-grp">' + ic('folder') + esc(ws) + '</div>' + list.map((v) => this.lsRow(v, false)).join('')).join('')
        || '<p class="ls-empty">' + (a.q.trim() ? '没有匹配的会话' : archived ? '没有已归档的会话' : '没有可关联的活跃会话') + '</p>'
      return { html, n }
    }
    const act = col(false)
    const arc = col(true)
    this.$('#dpmLsA').textContent = '活跃会话 · ' + act.n
    this.$('#dpmLsR').textContent = '已归档会话 · ' + arc.n
    this.$('#dpmLsActive').innerHTML = act.html
    this.$('#dpmLsArch').innerHTML = arc.html
    const idx = new Map(all.map((v) => [v.id, v]))
    const sel = a.sel.map((id) => idx.get(id)).filter((v): v is SessionView => !!v)
    this.$('#dpmLsSel').innerHTML = sel.map((v) => this.lsRow(v, true)).join('') || '<p class="ar-empty">还没有选择会话。在上面两列里勾选。</p>'
    this.$('#dpmLsN').textContent = String(sel.length)
    const moved = sel.filter((v) => { const r = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === v.id); return !!r && r.cardId !== a.card }).length
    this.$('#dpmLsCount').textContent = sel.length ? '将关联 ' + sel.length + ' 个会话' + (moved ? '（其中 ' + moved + ' 个从别的卡片移过来）' : '') : ''
    this.$<HTMLButtonElement>('#dpmLsOk').disabled = a.busy || !sel.length
  }
  private async saveLinkSess(a: NonNullable<BoardView['ls']>): Promise<void> {
    const idx = this.sessIndex()
    const sessions = a.sel.map((id) => ({ sessionId: id, title: idx.get(id)?.title }))
    try {
      const r = await post<Snapshot & { result: { linked: number; moved: number } }>('session/link', { cardId: a.card, sessions })
      if (this.disposed) return
      this.snap = r
      this.render()
      this.host.toast('已关联 ' + r.result.linked + ' 个会话' + (r.result.moved ? '，其中 ' + r.result.moved + ' 个从别的卡片移过来' : ''))
    } catch (e) {
      this.host.toast('关联失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
      // 保留已选，重开弹窗让用户重试
      this.ls = { ...a, busy: false }
      const d = this.$<HTMLDialogElement>('#dpmDlgSess')
      d.returnValue = ''
      this.renderLinkSess()
      d.showModal()
      return
    }
    ;(this.root.querySelector('[data-link-sess]') as HTMLElement | null)?.focus()
  }
  private askUnbind(sessionId: string): void {
    const ref = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === sessionId)
    if (!ref) return
    const v = this.sessIndex().get(sessionId)
    const c = this.card(ref.cardId)
    this.cf = sessionId
    this.$('#dpmCfP').textContent = '解除「' + (v?.title ?? ref.title ?? '已删除的会话') + '」和「' + (c?.t ?? '') + '」的关联？会话本身不会删除，之后也可以重新关联。'
    const d = this.$<HTMLDialogElement>('#dpmDlgCfm')
    d.returnValue = ''
    d.showModal()
    ;(this.root.querySelector('#dpmDlgCfm [data-dlg-cancel]') as HTMLElement | null)?.focus()
  }
  private async doUnbind(sessionId: string): Promise<void> {
    try {
      const r = await post<Snapshot>('session/unlink', { sessionId })
      if (this.disposed) return
      this.snap = r
      this.render()
      this.host.toast('已解除关联')
    } catch (e) { this.host.toast('解除关联失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); await this.refresh() }
    ;(this.root.querySelector('[data-link-sess]') as HTMLElement | null)?.focus()
  }
  /** 恢复活跃：不需要确认；会话回到工作区归档前的位置（归档从不改动工作区里的会话顺序）。 */
  private async restoreSession(sessionId: string): Promise<void> {
    if (this.restoring.has(sessionId)) return
    const v = this.sessIndex().get(sessionId)
    this.restoring.add(sessionId)
    this.render()
    try {
      const r = await post<Snapshot & { result: { restored: boolean } }>('session/unarchive', { sessionId })
      if (this.disposed) return
      this.snap = r
      this.host.toast(r.result.restored ? '已恢复「' + (v?.title ?? '会话') + '」，回到「' + (v?.ws ?? '工作区') + '」原来的位置' : '这个会话已经是活跃状态')
    } catch (e) {
      this.host.toast('恢复失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
    } finally { this.restoring.delete(sessionId) }
    // v88：不再等 300ms / 轮询——await 完立刻重绘，状态标签同一帧跟上
    this.onSessionsChanged()
    requestAnimationFrame(() => { if (!this.disposed) (this.root.querySelector('.detail [data-open-sess="' + sessionId + '"]') as HTMLElement | null)?.focus() })
  }

  // ── 添加挂载仓库 ──
  private openAddRepo(mode: 'group' | 'card' = 'group', cardId?: string): void {
    if (mode === 'group') {
      const g = this.grp(this.editG ?? '')
      if (!g) return
      this.ar = { mode, id: g.id, q: '', sel: [], manual: false, busy: false }
      this.$('#dpmArT').textContent = '添加卡片共用仓库'
      this.$('#dpmArP').textContent = '之后在「' + g.name + '」里新建的卡片会自动带上这些仓库，已有的卡片不变。可以多选。'
    } else {
      const cid = cardId ?? this.sel
      const c = cid ? this.card(cid) : undefined
      if (!c || c.archivedAt) return
      this.ar = { mode, id: c.id, q: '', sel: [], manual: false, busy: false, on: true }
      this.$('#dpmArT').textContent = '新增仓库'
      this.$('#dpmArP').textContent = '只加到卡片「' + c.t + '」，不影响卡片组和其他卡片。可以多选。'
    }
    this.$<HTMLInputElement>('#dpmArQ').value = ''
    const d = this.$<HTMLDialogElement>('#dpmDlgRepo')
    d.returnValue = ''
    d.showModal()
    this.$('#dpmArList').scrollTop = 0
    this.$('#dpmArSel').scrollTop = 0
    this.renderAddRepo()
    this.$<HTMLInputElement>('#dpmArQ').focus()
  }
  /** 弹窗目标当前的仓库清单。 */
  private arRepos(): Array<{ name: string; role: string; path: string }> {
    const a = this.ar
    if (!a) return []
    return a.mode === 'group' ? this.grp(a.id)?.repos ?? [] : this.card(a.id)?.repos ?? []
  }
  private arMounted(path: string): boolean { return this.arRepos().some((r) => normPath(r.path) === normPath(path)) }
  private arWho(): string { const a = this.ar; return a?.mode === 'card' ? '这张卡片' : '本组的卡片共用仓库' }
  private arAdd(path: string): boolean {
    const a = this.ar
    if (!a) return false
    if (this.arMounted(path)) { this.host.toast('「' + folderName(path) + '」已在' + this.arWho() + '里', 'err'); return false }
    if (a.sel.some((x) => normPath(x.path) === normPath(path))) { this.host.toast('「' + folderName(path) + '」已在「已选」里', 'err'); return false }
    // 候选里带着历史上的名称 / 角色；没有就用文件夹名
    const h = (this.snap?.board.repoHistory ?? []).find((x) => normPath(x.path) === normPath(path))
    a.sel.push({ path, name: h?.name ?? folderName(path), role: h?.role ?? '仓库' })
    return true
  }
  private arErrs(): string[] {
    const a = this.ar
    if (!a) return []
    const cur = this.arRepos()
    return a.sel.map((x, i) => {
      const n = x.name.replace(/\s+/g, ' ').trim()
      if (!n) return '名称不能为空'
      if (n.length > 120) return '名称超过 120 字'
      if (cur.some((r) => r.name === n)) return (a.mode === 'card' ? '这张卡片' : '卡片共用仓库里') + '已有同名仓库「' + n + '」'
      if (a.sel.slice(0, i).some((o) => o.name.replace(/\s+/g, ' ').trim() === n)) return '和上面的仓库重名，改一个名字'
      return ''
    })
  }
  private arPk(r: { name: string; path: string; at?: string }): string {
    const a = this.ar
    if (!a) return ''
    const m = this.arMounted(r.path)
    const on = m || a.sel.some((x) => normPath(x.path) === normPath(r.path))
    const tail = m ? '<span class="chip plain">已添加</span>' : r.at ? '<span class="when">' + esc(addedAgo(r.at)) + '</span>' : ''
    return '<label class="pk' + (m ? ' lock' : '') + '"><input type="checkbox" data-ar="' + esc(r.path) + '"' + (on ? ' checked' : '') + (m ? ' disabled' : '') + '><span class="txt"><span class="nm">' + esc(r.name) + '</span><span class="mono" title="' + esc(r.path) + '">' + esc(r.path) + '</span></span>' + tail + this.copyPathBtn(r.path) + '</label>'
  }
  /** 0.14 候选仓库 = 任意卡片组 / 卡片添加过的仓库（移除了也在），最近添加的在前；卡片模式把本组共用仓库单列一组。
   *  0.15：每组一个 .ar-grp，组标题 sticky 吸顶（下一组标题把上一组顶走）；候选标题行的分组切换跟随滚动高亮。 */
  private arListHtml(): string {
    const a = this.ar
    if (!a) return ''
    const hist = (this.snap?.board.repoHistory ?? []).slice().sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    const hit = (r: { name: string; path: string }): boolean => !a.q || (r.name + ' ' + r.path).toLowerCase().includes(a.q)
    const block = (all: Array<{ name: string; path: string; at?: string }>, none: string, miss: string): string => (all.length ? (all.filter(hit).length ? '<div class="pk-list ar-list">' + all.filter(hit).map((r) => this.arPk(r)).join('') + '</div>' : '<p class="ar-empty">' + miss + '</p>') : '<p class="ar-empty">' + none + '</p>')
    const head = (id: string, title: string, n: number, extra: string): string => '<div class="ar-sub" id="' + id + 'H"><button type="button" class="ar-jump" data-ar-jump="' + id + '" aria-label="回到「' + title + '」开头">' + title + ' · ' + n + '<svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' + extra + '</div>'
    if (a.mode === 'group') {
      this.arSpy = []
      this.arTotal = hist.length
      return '<section class="ar-grp" id="dpmArG0" aria-labelledby="dpmArG0H">' + head('dpmArG0', '任意卡片组、卡片添加过的仓库', hist.filter(hit).length, '<span class="grow"></span><span class="meta tail">最近添加的在前</span>') + block(hist, '还没有添加过任何仓库。点「选择文件夹…」选一个。', '没有匹配的候选仓库') + '</section>'
    }
    const c = this.card(a.id)
    const g = c ? this.grp(c.g) : undefined
    if (!c || !g) return ''
    const shared = g.repos.map((r) => ({ ...r, at: hist.find((h) => normPath(h.path) === normPath(r.path))?.at }))
    const others = hist.filter((h) => !g.repos.some((r) => normPath(r.path) === normPath(h.path)))
    const ns = shared.filter(hit).length
    const no = others.filter(hit).length
    this.arTotal = shared.length + others.length
    this.arSpy = [{ id: 'dpmArG1', label: '本组共用 · ' + ns, n: ns }, { id: 'dpmArG2', label: '其他 · ' + no, n: no }]
    return '<section class="ar-grp" id="dpmArG1" aria-labelledby="dpmArG1H">'
      + head('dpmArG1', '本组共用仓库', ns, '<span class="meta tail">卡片组「' + esc(g.name) + '」</span><span class="grow"></span>' + (shared.length ? '<button type="button" class="btn ghost sm" data-ar-all>' + ic('plus') + '<span data-ar-all-t></span></button>' : ''))
      + block(shared, '卡片组「' + esc(g.name) + '」还没有设置卡片共用仓库。', '没有匹配的本组共用仓库') + '</section>'
      + '<section class="ar-grp" id="dpmArG2" aria-labelledby="dpmArG2H">'
      + head('dpmArG2', '其他候选仓库', no, '<span class="grow"></span><span class="meta tail">最近添加的在前</span>')
      + block(others, '没有其他候选仓库。', '没有匹配的候选仓库') + '</section>'
  }
  /** 分组切换（只在卡片模式、有两组时出现）；arTotal = 候选总数（标题旁显示）。 */
  private arSpy: Array<{ id: string; label: string; n: number }> = []
  private arTotal = 0
  /** 候选列表整块重画（打开 / 搜索 / 保存后才调；勾选不调，滚动位置不动）。 */
  private arPaintList(): void {
    this.$('#dpmArList').innerHTML = this.arListHtml()
    this.$('#dpmArCandN').textContent = '· ' + this.arTotal
    const spy = this.$('#dpmArSpy')
    spy.innerHTML = this.arSpy.map((s) => '<button type="button" data-ar-jump="' + s.id + '"' + (s.n ? '' : ' disabled') + '>' + s.label + '</button>').join('')
    spy.hidden = !this.arSpy.length
    this.arSyncChecks()
    this.arStick()
  }
  /** 只同步勾选状态与「全部加入已选」按钮（不重画列表）。 */
  private arSyncChecks(): void {
    const a = this.ar
    if (!a) return
    this.root.querySelectorAll<HTMLInputElement>('#dpmArList input[data-ar]:not([disabled])').forEach((i) => { i.checked = a.sel.some((x) => normPath(x.path) === normPath(i.dataset.ar as string)) })
    const b = this.root.querySelector('[data-ar-all]') as HTMLButtonElement | null
    if (b) {
      const n = this.arAddable().length
      b.disabled = !n
      ;(b.querySelector('[data-ar-all-t]') as HTMLElement).textContent = n ? '全部加入已选（' + n + '）' : '都已选上'
    }
  }
  /** 本组共用仓库里还能加入「已选」的（没挂、没选）。 */
  private arAddable(): Array<{ name: string; role: string; path: string }> {
    const a = this.ar
    const g = a?.mode === 'card' ? this.grp(this.card(a.id)?.g ?? '') : undefined
    if (!a || !g) return []
    return g.repos.filter((r) => !this.arMounted(r.path) && !a.sel.some((x) => normPath(x.path) === normPath(r.path)))
  }
  /** 吸顶状态 + 分组切换高亮（滚动事件 rAF 合并后调）。 */
  private arStickRaf = 0
  private arStick(): void {
    const box = this.root.querySelector('#dpmArList') as HTMLElement | null
    if (!box) return
    const top = box.getBoundingClientRect().top
    const gs = Array.from(box.querySelectorAll<HTMLElement>('.ar-grp'))
    for (const g of gs) {
      const h = g.querySelector('.ar-sub') as HTMLElement
      const r = g.getBoundingClientRect(), hr = h.getBoundingClientRect()
      h.classList.toggle('stuck', box.scrollTop > 0 && Math.abs(hr.top - top) < 1 && r.bottom > hr.bottom + 1)
    }
    let on = gs[0]
    for (const g of gs) if (g.getBoundingClientRect().top <= top + 1) on = g
    if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) on = gs[gs.length - 1]
    this.root.querySelectorAll<HTMLElement>('#dpmArSpy [data-ar-jump]').forEach((b) => b.setAttribute('aria-current', String(!!on && b.dataset.arJump === on.id)))
  }
  /** 跳到分组开头（平滑；尊重减少动态效果），首行闪一下、焦点给首个可勾选项。 */
  private arJump(id: string): void {
    const box = this.$('#dpmArList')
    const g = this.root.querySelector('#' + id) as HTMLElement | null
    if (!g) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: g.offsetTop - (box.firstElementChild as HTMLElement).offsetTop, behavior: reduce ? 'auto' : 'smooth' })
    const first = (g.querySelector('.pk:not(.lock)') ?? g.querySelector('.pk')) as HTMLElement | null
    if (first) { first.classList.remove('flash'); void first.offsetWidth; first.classList.add('flash'); (first.querySelector('input:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true }) }
  }
  private arSelHtml(): string {
    const a = this.ar
    if (!a) return ''
    return a.sel.map((x, i) => '<div class="rp-row" data-path="' + esc(x.path) + '"><input class="fld" data-arname="' + i + '" aria-label="仓库名 ' + (i + 1) + '" aria-describedby="dpmArE' + i + '" maxlength="120" value="' + esc(x.name) + '"><input class="fld" data-arrole="' + i + '" aria-label="仓库角色 ' + (i + 1) + '" maxlength="40" value="' + esc(x.role) + '"><span class="mono" title="' + esc(x.path) + '">' + esc(x.path) + '</span><button type="button" class="ib" data-ardel="' + i + '" aria-label="从已选移除 ' + esc(x.name || x.path) + '">' + ic('x') + '</button><p class="rp-err" id="dpmArE' + i + '" hidden></p></div>').join('')
      || '<p class="ar-empty">还没有选择仓库。勾选上面的候选仓库，或点「选择文件夹…」。</p>'
  }
  private arCheck(): void {
    const a = this.ar
    if (!a) return
    const errs = this.arErrs()
    errs.forEach((m, i) => {
      const inp = this.root.querySelector('[data-arname="' + i + '"]') as HTMLInputElement | null
      const p = this.root.querySelector('#dpmArE' + i) as HTMLElement | null
      if (inp) { inp.classList.toggle('bad', !!m); if (m) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid') }
      if (p) { p.textContent = m; p.hidden = !m }
    })
    this.$('#dpmArSelN').textContent = String(a.sel.length)
    this.$('#dpmArCount').textContent = a.sel.length ? '将添加 ' + a.sel.length + ' 个仓库' : ''
    this.$<HTMLButtonElement>('#dpmArOk').disabled = a.busy || !a.sel.length || errs.some(Boolean)
  }
  /** 整个弹窗重画（打开 / 保存失败重开）；勾选与「已选」增删只走 renderSel。 */
  private renderAddRepo(): void {
    if (this.ar) this.$('#dpmArInjSlot').innerHTML = this.ar.mode === 'card' ? injCard('dpmArInj', this.ar.on !== false) : ''
    const a = this.ar
    if (!a) return
    this.arPaintList()
    this.renderSel()
  }
  /** 0.15：只重画「已选」+ 同步候选勾选（候选列表不重画 → 滚动位置不动）。fresh = 新加入的路径（滚到可见、闪一下）。 */
  private renderSel(fresh?: string[]): void {
    const a = this.ar
    if (!a) return
    this.$('#dpmArSel').innerHTML = this.arSelHtml()
    this.arSyncChecks()
    if (fresh?.length) {
      const rows = Array.from(this.root.querySelectorAll<HTMLElement>('#dpmArSel .rp-row')).filter((r) => fresh.some((p) => normPath(p) === normPath(r.dataset.path ?? '')))
      rows.forEach((r) => r.classList.add('fresh'))
      rows[rows.length - 1]?.scrollIntoView({ block: 'nearest' })
    }
    this.arCheck()
  }
  private focusLastSel(): void { const a = this.ar; const i = a ? this.root.querySelector('[data-arname="' + (a.sel.length - 1) + '"]') as HTMLInputElement | null : null; if (i) { i.focus(); i.select() } }
  /** 「选择文件夹…」：调 dsh 的选文件夹对话框；网页文件浏览器模式下（不支持）降级为手输绝对路径。 */
  private async pickFolder(): Promise<void> {
    const a = this.ar
    if (!a || a.busy) return
    a.busy = true
    this.arCheck()
    let path: string | null = null
    try { path = await this.host.pickDirectory() } catch (e) {
      if (this.ar === a) { this.arFpOpen(true) }
      // 细节进控制台（点名失败对象），界面只给可操作的一句话
      console.warn('[dsh-project-manager] uiWorkspace.pickDirectory 失败，改为手输路径：', e)
      this.host.toast('当前 dsh 打不开系统选文件夹对话框，请在「粘贴路径」里输入文件夹的绝对路径', 'err')
    } finally { a.busy = false }
    if (this.ar !== a) return
    if (path && this.arAdd(path)) { this.renderSel([path]); this.focusLastSel() } else this.arCheck()
  }
  /** 复制路径图标（图标 → 对勾 1.2 秒，与相关链接的复制一致）。 */
  private copyPathBtn(p: string): string { return '<button type="button" class="ib sm cp" data-copy-path="' + esc(p) + '" aria-label="复制路径 ' + esc(p) + '" title="复制路径">' + COPY_SVG + CHECK_SVG + '</button>' }
  // ── 0.24 新增仓库的「粘贴路径」：逐行检测（文件夹才能加），通过的加入「已选」，有问题的留在框里；「仅收起」保留内容，关窗才清 ──
  private arFpOpen(on: boolean): void {
    const a = this.ar; if (!a) return
    if (on) { a.fp = a.fp ?? { open: true, text: '', res: [], seq: 0 }; a.fp.open = true } else if (a.fp) a.fp.open = false
    this.arFpPaint(true)
    if (on) { const i = this.$<HTMLTextAreaElement>('#dpmArFpIn'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }
  }
  private arFpPaint(full = false): void {
    const a = this.ar; if (!a) return
    const fp = a.fp
    const btn = this.$<HTMLButtonElement>('#dpmArPaste')
    const lines = fp ? fp.text.split(/\r?\n/).filter((l) => l.trim()).length : 0
    btn.setAttribute('aria-expanded', String(!!fp?.open))
    btn.innerHTML = fp && !fp.open && lines ? '<span class="dot" aria-hidden="true"></span>粘贴路径 · ' + lines + ' 行' : '粘贴路径'
    btn.title = fp && !fp.open && lines ? '展开继续编辑（内容已保留）' : ''
    const slot = this.$('#dpmArFpSlot')
    if (!fp || !fp.open) { slot.innerHTML = ''; return }
    if (full || !slot.firstChild) {
      slot.innerHTML = '<div class="fp ar-fp" id="dpmArFp"><label for="dpmArFpIn">仓库文件夹的绝对路径（可一次粘贴多行）</label><textarea id="dpmArFpIn" spellcheck="false" autocomplete="off" aria-describedby="dpmArFpChk" placeholder="~/code/repo&#10;/srv/demo/another-repo"></textarea><ul class="fp-chk" id="dpmArFpChk" aria-live="polite"></ul>'
        + '<div class="fp-bar"><span class="meta" id="dpmArFpSum"></span><span class="grow"></span><button type="button" class="btn sm" id="dpmArFpClear" title="清空输入框（可撤销）">清空</button><button type="button" class="btn sm" id="dpmArFpHide" title="收起，内容保留到关闭窗口">仅收起</button><button type="button" class="btn primary sm" id="dpmArFpOk"></button></div></div>'
      this.$<HTMLTextAreaElement>('#dpmArFpIn').value = fp.text
    }
    const WHY: Record<PathCheck['status'], string> = { ok: '文件夹', dir: '是文件（文件请加到「相关文件」）', missing: '不存在', linked: '已添加', dup: '重复，已忽略', bad: '不是绝对路径' }
    const picked = (p: string): boolean => a.sel.some((x) => normPath(x.path) === normPath(p))
    this.$('#dpmArFpChk').innerHTML = fp.res.map((r) => { const st = r.status === 'ok' && picked(r.path) ? 'linked' : r.status; const why = r.status === 'ok' && picked(r.path) ? '已在已选里' : WHY[r.status]; return '<li class="' + fpKind(st) + '">' + ic(FP_ICON[st]) + '<span class="p">' + esc(st === 'bad' ? r.raw : r.path) + '</span><span class="why">' + why + '</span></li>' }).join('')
    const ok = fp.res.filter((r) => r.status === 'ok' && !picked(r.path)).length
    const bad = fp.res.filter((r) => fpKind(r.status) === 'bad').length
    this.$('#dpmArFpSum').textContent = fp.res.length ? ok + ' 个可加入' + (bad ? '，' + bad + ' 个有问题' : '') : fp.text.trim() ? '检测中…' : ''
    this.$<HTMLButtonElement>('#dpmArFpClear').hidden = !fp.text
    const okB = this.$<HTMLButtonElement>('#dpmArFpOk'); okB.disabled = !ok; okB.textContent = ok ? '加入已选 ' + ok + ' 个' : '加入已选'
  }
  private async arFpCheck(): Promise<void> {
    const a = this.ar; const fp = a?.fp; if (!a || !fp) return
    const lines = fp.text.split(/\r?\n/).filter((l) => l.trim())
    const seq = ++fp.seq
    if (!lines.length) { fp.res = []; this.arFpPaint(); return }
    try {
      const r = await post<{ results: PathCheck[] }>('repos/check', { mode: a.mode, id: a.id, paths: lines })
      if (this.ar !== a || fp.seq !== seq) return
      fp.res = r.results
    } catch (e) { if (this.ar === a) this.host.toast('检测路径失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); return }
    this.arFpPaint()
  }
  private async arFpAdd(): Promise<void> {
    const a = this.ar; const fp = a?.fp; if (!a || !fp) return
    const add = fp.res.filter((r) => r.status === 'ok' && !a.sel.some((x) => normPath(x.path) === normPath(r.path))).map((r) => r.path)
    if (!add.length) return
    for (const p of add) this.arAdd(p)
    const rest = fp.res.filter((r) => fpKind(r.status) === 'bad').map((r) => r.raw)
    fp.text = rest.join('\n')
    fp.res = fp.res.filter((r) => fpKind(r.status) === 'bad')
    this.arFpPaint(true)
    this.renderSel(add)
    this.host.toast('已加入已选 ' + add.length + ' 个' + (rest.length ? '，有问题的 ' + rest.length + ' 行留在框里' : ''))
    if (rest.length) this.$<HTMLElement>('#dpmArFpIn').focus()
  }
  private addManualPath(): void {
    const inp = this.root.querySelector('#dpmArPath') as HTMLInputElement | null
    const v = inp?.value.trim() ?? ''
    if (!inp || !v) return
    if (!v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v)) { this.host.toast('请输入绝对路径：' + v, 'err'); return }
    if (this.arAdd(v)) { inp.value = ''; this.renderSel([v]); this.focusLastSel() }
  }
  /** 0.15「全部加入已选」：只把本组共用仓库（没挂、没选的）放进「已选」，用户还能取消勾选 / 改名，点保存才写入。 */
  private arAddAllShared(): void {
    const a = this.ar
    if (!a || a.busy) return
    const add = this.arAddable()
    if (!add.length) return
    for (const r of add) { const h = (this.snap?.board.repoHistory ?? []).find((x) => normPath(x.path) === normPath(r.path)); a.sel.push({ path: r.path, name: r.name || h?.name || folderName(r.path), role: r.role || h?.role || '仓库' }) }
    this.renderSel(add.map((r) => r.path))
    this.host.toast('已把 ' + add.length + ' 个本组共用仓库放进「已选」，确认后点保存')
  }
  private async saveAddRepo(a: NonNullable<BoardView['ar']>): Promise<boolean> {
    const repos = a.sel.map((x) => ({ name: x.name.replace(/\s+/g, ' ').trim(), role: x.role.trim() || '仓库', path: x.path, ...(a.mode === 'card' && a.on === false ? { off: true } : {}) }))
    const n = a.mode === 'group' ? this.cardsOf(a.id) : 0
    const ok = a.mode === 'group'
      ? await this.act('group/repos-add', { id: a.id, repos }, '已添加 ' + repos.length + ' 个卡片共用仓库。组里已有的 ' + n + ' 张卡片不变，之后新建的卡片会自动带上')
      : await this.act('card/repos-add', { id: a.id, repos }, '已给这张卡片添加 ' + repos.length + ' 个仓库，卡片组和其他卡片不变')
    if (!ok) {
      // 服务端拒绝（例如别处刚挂了同名仓库）：重开弹窗保留已选，让用户改名后再存
      this.ar = { ...a, busy: false }
      const d = this.$<HTMLDialogElement>('#dpmDlgRepo')
      d.returnValue = ''
      this.renderAddRepo()
      d.showModal()
      return false
    }
    if (a.mode === 'group') {
      if (this.$<HTMLDialogElement>('#dpmDlgSt').open) this.renderGroupSettings()
      ;(this.root.querySelector('#dpmRepoAdd') as HTMLElement | null)?.focus()
    } else (this.root.querySelector('.detail [data-card-repo-add]') as HTMLElement | null)?.focus()
    return true
  }
  private cardsOf(gId: string): number { return this.cards.filter((c) => c.g === gId).length }

  // ── 关联落盘项目 ──
  private openLink(kind: 'group' | 'card', id: string): void {
    const c = kind === 'card' ? this.card(id) : undefined
    const g = kind === 'group' ? this.grp(id) : this.grp(c?.g ?? '')
    if (!g) return
    this.link = { kind, id, sel: new Set(kind === 'group' ? g.links : c?.links ?? []), locked: new Set(kind === 'card' ? g.links : []), q: '' }
    this.$('#dpmLkP').textContent = kind === 'group' ? '「' + g.name + '」里所有卡片新建的会话，都会自动读取这些落盘项目的记忆。' : '「' + (c?.t ?? '') + '」新建的会话会自动读取这些落盘项目的记忆；卡片组已关联的会一并读取，这里不能取消。'
    this.$<HTMLInputElement>('#dpmLkQ').value = ''
    this.renderLink()
    const d = this.$<HTMLDialogElement>('#dpmDlgLink')
    d.returnValue = ''
    d.showModal()
    this.$<HTMLInputElement>('#dpmLkQ').focus()
  }
  private renderLink(): void {
    const L = this.link
    if (!L) return
    const list = (this.snap?.states ?? []).filter((x) => !L.q || (x.slug + ' ' + x.project + ' ' + x.status).toLowerCase().includes(L.q))
    let html = ''
    let last = ''
    for (const x of list) {
      if (x.project !== last) { html += '<div class="pk-grp">' + esc(x.project) + '</div>'; last = x.project }
      const lock = L.locked.has(x.key)
      html += '<label class="pk' + (lock ? ' lock' : '') + '"><input type="checkbox" data-lk="' + esc(x.key) + '"' + (lock || L.sel.has(x.key) ? ' checked' : '') + (lock ? ' disabled' : '') + '><span><span class="nm">' + esc(x.slug) + '</span>' + (lock ? ' <span class="chip plain">卡片组已关联</span>' : '') + '<br><span class="meta">' + esc(x.status || '暂无状态说明') + '</span></span></label>'
    }
    this.$('#dpmLkList').innerHTML = html || '<p class="meta">没有匹配的落盘项目（扫描 ~/.ai/projects/&lt;project&gt;/memory/designs/）</p>'
    this.renderLinkCount()
  }
  private renderLinkCount(): void {
    const L = this.link
    if (!L) return
    const n = new Set([...L.sel, ...L.locked]).size
    this.$('#dpmLkCount').textContent = '已选 ' + n + ' 个'
  }
  private async saveLink(): Promise<void> {
    const L = this.link
    if (!L) return
    const keys = Array.from(L.sel).filter((k) => !L.locked.has(k))
    if (L.kind === 'group') await this.act('group/update', { id: L.id, links: keys }, '已保存关联 · ' + keys.length + ' 个落盘项目')
    else await this.act('card/update', { id: L.id, links: keys }, '已保存关联 · ' + keys.length + ' 个落盘项目')
  }

  // ── 导入落盘项目（一个 STATE → 一张卡片，自动关联）──
  private openImport(): void {
    if (!this.groups.length) { this.host.toast('先新建一个卡片组', 'err'); return }
    const used = new Set(this.cards.flatMap((c) => c.links))
    const list = (this.snap?.states ?? []).filter((s) => !used.has(s.key))
    this.$('#dpmImList').innerHTML = list.length ? list.map((s) => '<label class="imp"><input type="checkbox" data-imp="' + esc(s.key) + '"><span><b>' + esc(s.slug) + '</b><br><span class="mono">' + esc(s.key) + '</span><br><span class="meta">' + esc(s.status || '暂无状态说明') + '</span></span></label>').join('') : '<p class="meta">所有落盘项目都已经有对应卡片了</p>'
    this.$('#dpmImGroup').innerHTML = this.groups.map((g) => '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>').join('')
    const d = this.$<HTMLDialogElement>('#dpmDlgImp')
    d.returnValue = ''
    d.showModal()
  }
  private async doImport(): Promise<void> {
    const gid = this.$<HTMLSelectElement>('#dpmImGroup').value
    const keys = Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-imp]:checked')).map((n) => n.dataset.imp as string)
    let n = 0
    for (const k of keys) { const s = this.stateOf(k); if (await this.act('card/create', { group: gid, title: s?.slug ?? k, links: [k] })) n++ }
    if (n) this.host.toast('已导入 ' + n + ' 张卡片')
  }
}

const DIALOGS = String.raw`
<dialog class="dpm-dialog" id="dpmDlgName" aria-labelledby="dpmNameT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmNameT"></h2><p id="dpmNameP"></p></div>
  <div class="dlg-b"><label class="lbl" for="dpmNameInput">名称</label><input class="fld" id="dpmNameInput" autocomplete="off"><div class="ddup" id="dpmNameDup" hidden></div></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmNameOk" type="submit" value="ok" disabled>确定</button></div>
</form></dialog>
<dialog class="dpm-dialog wide" id="dpmDlgSt" aria-labelledby="dpmStT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmStT">卡片组设置</h2><p id="dpmStP"></p></div>
  <div class="dlg-b" id="dpmStList"></div>
  <div class="dlg-f"><button class="btn ghost danger" type="button" id="dpmGroupDel">删除卡片组</button><span class="sp"></span><button class="btn primary" type="submit" value="ok">完成</button></div>
</form></dialog>
<dialog class="dpm-dialog wide ar-dlg" id="dpmDlgRepo" aria-labelledby="dpmArT"><form method="dialog">
  <div class="ar-head">
    <h2 id="dpmArT">添加挂载仓库</h2><p id="dpmArP"></p>
    <div class="ar-top"><label class="sr-only" for="dpmArQ">搜索候选仓库</label><input class="fld" id="dpmArQ" placeholder="搜索候选仓库（名称或路径）" autocomplete="off"><button type="button" class="btn" id="dpmArPick">%FOLDER%选择文件夹…</button><button type="button" class="btn" id="dpmArPaste" aria-expanded="false" aria-controls="dpmArFp">粘贴路径</button></div>
    <div id="dpmArFpSlot"></div>
  </div>
  <section class="ar-cand" aria-labelledby="dpmArCandH">
    <div class="ar-h"><span id="dpmArCandH">候选仓库</span><span class="meta" id="dpmArCandN"></span><span class="grow"></span><nav class="ar-spy" id="dpmArSpy" aria-label="跳到分组"></nav></div>
    <div class="ar-scroll" id="dpmArList"></div>
  </section>
  <section class="ar-picked" aria-labelledby="dpmArSelH">
    <div class="ar-h"><span id="dpmArSelH">已选 · <span id="dpmArSelN">0</span></span><span class="grow"></span><span class="meta">默认名称是文件夹名，可以改</span></div>
    <div class="ar-scroll" id="dpmArSel"></div>
    <div id="dpmArInjSlot"></div>
    <div class="dlg-f"><span class="meta" id="dpmArCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmArOk" type="submit" value="ok" disabled>保存</button></div>
  </section>
</form></dialog>
<dialog class="dpm-dialog xwide" id="dpmDlgSess" aria-labelledby="dpmLsT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLsT">关联已有会话</h2><p id="dpmLsP"></p></div>
  <div class="dlg-b">
    <label class="sr-only" for="dpmLsQ">搜索会话</label><input class="fld" id="dpmLsQ" placeholder="搜索会话名或仓库" autocomplete="off">
    <div class="ls-cols"><section class="ls-col" aria-labelledby="dpmLsA"><h3 id="dpmLsA"></h3><div class="ls-list" id="dpmLsActive"></div></section><section class="ls-col" aria-labelledby="dpmLsR"><h3 id="dpmLsR"></h3><div class="ls-list" id="dpmLsArch"></div></section></div>
    <div class="ar-sec"><span>已选会话 · <span id="dpmLsN">0</span></span><span class="grow"></span><span class="meta">取消勾选即放回候选</span></div>
    <div id="dpmLsSel"></div>
  </div>
  <div class="dlg-f"><span class="meta" id="dpmLsCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmLsOk" type="submit" value="ok" disabled>保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgCfm" aria-labelledby="dpmCfT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmCfT">解除关联</h2><p id="dpmCfP"></p></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary danger-fill" id="dpmCfOk" type="submit" value="ok">解除关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgSArc" aria-labelledby="dpmSaT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmSaT">停止并归档此会话？</h2><p id="dpmSaP"></p><ul class="cf-list" id="dpmSaL" aria-label="将被停止的工作"></ul></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary danger-fill" type="submit" value="ok">停止并归档</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgLink" aria-labelledby="dpmLkT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLkT">关联落盘项目</h2><p id="dpmLkP"></p></div>
  <div class="dlg-b"><label class="sr-only" for="dpmLkQ">搜索落盘项目</label><input class="fld" id="dpmLkQ" placeholder="搜索 slug 或状态" autocomplete="off"><div class="pk-list" id="dpmLkList"></div></div>
  <div class="dlg-f"><span class="meta" id="dpmLkCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog wide" id="dpmDlgWl" aria-labelledby="dpmWlT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmWlT">添加相关链接</h2><p id="dpmWlP"></p></div>
  <div class="dlg-b"><div class="wl-rows" id="dpmWlRows"></div><button type="button" class="btn ghost sm wl-add" id="dpmWlMore" data-wl-more>%PLUS%再加一条</button><div id="dpmWlInjSlot"></div></div>
  <div class="dlg-f"><span class="meta" id="dpmWlCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="button" id="dpmWlOk">保存</button></div>
</form></dialog>
<dialog class="dpm-dialog dpm-tydlg" id="dpmDlgTy" aria-labelledby="dpmTyT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmTyT">相关链接类型管理</h2><p id="dpmTyP"></p><button type="button" class="ib dlg-x" data-dlg-cancel aria-label="关闭管理类型" title="关闭（Esc）">%X%</button></div>
  <div class="dlg-b"><ul class="ty-list" id="dpmTyList" aria-label="类型"></ul></div>
    <div class="ty-add" id="dpmTyAddG"><label class="sr-only" for="dpmTgNew">新类型组名称</label><input class="fld" id="dpmTgNew" placeholder="新类型组名称，比如「设计」" maxlength="20" autocomplete="off"><button type="button" class="btn" id="dpmTgAdd">%PLUS%新增类型组</button></div>
    <p class="wl-err" id="dpmTgNewE" hidden></p>
  <div class="dlg-f"><span class="meta" id="dpmTyN"></span><span class="sp"></span><button class="btn" type="submit" value="">完成</button></div>
</form></dialog>
<dialog class="dpm-dialog fa-dlg" id="dpmDlgFa" aria-labelledby="dpmFaTi" aria-describedby="dpmFaSub"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmFaTi">添加文件</h2><p id="dpmFaSub"></p><button type="button" class="ib dlg-x" data-dlg-cancel aria-label="关闭">%X%</button></div>
  <div class="dlg-b"><div class="fa-src"><div class="row"><button type="button" class="btn" data-fa-pick>%FILE%<span>选择文件…</span></button><span class="meta">打开系统对话框，可多选</span></div>
    <div class="fa-or">或粘贴路径</div><label class="sr-only" for="dpmFaIn">粘贴文件的绝对路径，每行一个</label><textarea id="dpmFaIn" spellcheck="false" autocomplete="off" placeholder="每行一个文件的绝对路径，比如 ~/Desktop/方案.md"></textarea><ul class="fa-bad" id="dpmFaBad" aria-live="polite"></ul></div>
    <div class="fa-ph" id="dpmFaListH"></div><ul class="fa-l" id="dpmFaList"></ul></div>
  <div class="fa-lfwrap" id="dpmFaLf"></div><div class="fa-injwrap" id="dpmFaInjSlot"></div><div class="dlg-f" id="dpmFaFoot"></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgRm" aria-labelledby="dpmRmT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmRmT"></h2><p id="dpmRmP"></p></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary danger-fill" type="submit" value="ok">删除卡片</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgImp" aria-labelledby="dpmImT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmImT">导入落盘项目</h2><p>每个选中的落盘项目生成一张卡片并自动关联。只读扫描 ~/.ai，不会修改 STATE。</p></div>
  <div class="dlg-b"><div id="dpmImList"></div><label class="lbl" for="dpmImGroup">放进卡片组</label><select class="fld" id="dpmImGroup"></select></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">导入所选</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgSize" aria-labelledby="dpmSzT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmSzT"></h2><p id="dpmSzP"></p></div>
  <div class="dlg-b">
    <div class="szfile" id="dpmSzFile"></div>
    <ul class="szwhy"><li>这是<b>一次性确认</b>：50–500MB 会先问一次；超过 500MB 仍然只能只记路径。</li><li>复制 = 原文件进 evidence/，并做 sha256 回读校验；选「只记路径」则不复制。</li></ul>
    <label class="szopt"><input type="radio" name="dpmSz" id="dpmSzCopy" value="copy" checked><span><b>仍然复制到落盘项目</b><em>会占用空间；合并 / 备份会变慢</em></span></label>
    <label class="szopt"><input type="radio" name="dpmSz" id="dpmSzPath" value="path"><span><b>只记路径（推荐）</b><em>STATE 里记一行路径，文件留在原地</em></span></label>
  </div>
  <div class="dlg-f"><span class="meta" id="dpmSzNote"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="button" id="dpmSzOk">继续</button></div>
</form></dialog>
`

let gdv: BoardView | null = null
/** v133 R3：详情列打开时给宿主中列让出右侧（只改中列自己的 inline 样式，不碰 body）。w = null 撤掉。
    v134：DSH 右侧栏（文件预览 / 浏览器 / 终端）开着时交给 rlLay：详情最右、右侧栏面板挪到详情左边、中列只补差额。 */
function padCenter(w: number | null): void {
  RL.on = w !== null
  if (w !== null) RL.w = w
  rlLay()
}
/* ═══ v134 · 卡片详情 × DSH 右侧栏 ═══
   宿主事实（@deepseek-ai/dsh-client-ui-layout AppFrame）：frame = grid「左栏 | 中列 minmax(400px,1fr) | 右侧栏轨道（[data-rightbar-col]）」，
   右侧栏面板（ui-sidebar-right，[data-sidebar-right-panel]）absolute 贴 frame 右边、宽度由宿主 inline 写；右侧栏把手 = frame 子节点 [data-side="rightbar"]，left = W − 面板宽。
   插件只动：中列 padding（inline）、面板 right / width（属性 + 不继承变量，压过宿主 inline）、把手 transform、详情自己的宽度。宽度分配见 src/rlayout.ts。 */
type RlNodes = { fr: HTMLElement; cc: HTMLElement; sb: HTMLElement | null; rbc: HTMLElement; panel: HTMLElement | null; hd: HTMLElement | null }
const RL = { dead: false, on: false, w: 420, A: 0, pair: false, ratio: null as number | null, last: 'detail' as 'detail' | 'rightbar', rbWas: false, detWas: false, drag: null as { x0: number; dx: number; rv0: number } | null, mode: 'off', warned: false }
let rlCc: HTMLElement | null = null, rlPanel: HTMLElement | null = null, rlHd: HTMLElement | null = null, rlDet: HTMLElement | null = null
let rlFr: Element | null = null, rlRbc: Element | null = null, rlPo: Element | null = null, rlSw: HTMLButtonElement | null = null, rlRaf = 0
let rlRo: ResizeObserver | null = null, rlMo: MutationObserver | null = null, rlOff: (() => void) | null = null
const rlAttr = (el: Element | null, k: string, v: string | null): void => { if (!el) return; if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k) } else if (el.getAttribute(k) !== v) el.setAttribute(k, v) }
const rlVar = (el: HTMLElement | null, k: string, v: string | null): void => { if (!el) return; if (v === null) el.style.removeProperty(k); else if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v) }
function rlNodes(): RlNodes | null {
  const rbc = document.querySelector('[data-rightbar-col]') as HTMLElement | null
  const fr = rbc?.parentElement ?? null
  if (!rbc || !fr) return null
  const kids = Array.from(fr.children) as HTMLElement[]
  const cc = kids.find((k) => String(k.className).includes('_centerCol'))
  if (!cc) return null
  const panel = (Array.from(rbc.querySelectorAll('[data-sidebar-right-panel]')) as HTMLElement[]).find((p) => !p.closest('[hidden]')) ?? null
  return { fr, cc, rbc, panel, sb: kids.find((k) => String(k.className).includes('_sidebarCol')) ?? null, hd: kids.find((k) => k.getAttribute('data-side') === 'rightbar') ?? null }
}
function rlSoon(): void { if (!rlRaf) rlRaf = requestAnimationFrame(() => { rlRaf = 0; rlLay() }) }
function rlWatch(n: RlNodes): void {
  if (!rlRo || !rlMo) {
    rlRo = new ResizeObserver(rlSoon)
    rlMo = new MutationObserver(rlSoon)
    /* 拖宿主右侧栏把手（三列并排时）：宿主照常改它的偏好宽度，插件按拖动距离换算面板宽度并记住比例 */
    const down = (e: PointerEvent): void => { const h = (e.target as Element | null)?.closest?.('[data-side="rightbar"]'); if (!h || RL.mode !== 'pair' || !rlPanel) return; RL.drag = { x0: e.clientX, dx: 0, rv0: rlPanel.getBoundingClientRect().width } }
    const move = (e: PointerEvent): void => { if (!RL.drag) return; RL.drag.dx = e.clientX - RL.drag.x0; rlSoon() }
    const up = (): void => { if (!RL.drag) return; rlLay(); RL.drag = null }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', up, true)
    rlOff = () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true) }
  }
  if (n.fr === rlFr && n.rbc === rlRbc && n.panel === rlPo) return
  rlRo.disconnect(); rlMo.disconnect()
  rlFr = n.fr; rlRbc = n.rbc; rlPo = n.panel
  rlRo.observe(n.fr); rlRo.observe(n.rbc)
  /* 面板自己的 style：宿主改它的宽度（拖把手 / 窗口变化）时重排；插件写同值不触发 */
  if (n.panel) rlMo.observe(n.panel, { attributes: true, attributeFilter: ['style'] })
  /* 只看 frame 自己的属性 + 右侧栏子树里的开合属性：中列（看板 / 会话）里的 DOM 变化不进来；插件自己写的 data-dpm-* / style 也不进来 */
  rlMo.observe(n.fr, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'] })
  rlMo.observe(n.rbc, { attributes: true, subtree: true, attributeFilter: ['data-sidebar-right-open', 'data-sidebar-right-panel', 'hidden'] })
}
function rlPad(cc: HTMLElement | null, px: number): void {
  if (rlCc && rlCc !== cc) { rlCc.style.removeProperty('padding-right'); rlCc.style.removeProperty('box-sizing') }
  rlCc = cc
  if (!cc) return
  if (px > 0) { if (cc.style.boxSizing !== 'border-box') cc.style.boxSizing = 'border-box'; if (cc.style.paddingRight !== px + 'px') cc.style.paddingRight = px + 'px' }
  else { cc.style.removeProperty('padding-right'); cc.style.removeProperty('box-sizing') }
}
function rlPanelSet(p: HTMLElement | null, mode: 'on' | 'away' | null, r?: string, w?: string): void {
  if (rlPanel && rlPanel !== p) rlPanelSet(rlPanel, null)
  rlPanel = mode ? p : (rlPanel === p ? null : rlPanel)
  rlAttr(p, 'data-dpm-rb', mode)
  rlVar(p, '--dpm-rb-r', mode === 'on' ? r! : null)
  rlVar(p, '--dpm-rb-w', mode === 'on' ? w! : null)
}
function rlHand(hd: HTMLElement | null, x: number | null): void {
  if (rlHd && rlHd !== hd) { rlAttr(rlHd, 'data-dpm-rbh', null); rlVar(rlHd, '--dpm-rbh-x', null) }
  rlHd = x === null ? null : hd
  rlAttr(hd, 'data-dpm-rbh', x === null ? null : '')
  rlVar(hd, '--dpm-rbh-x', x === null ? null : x + 'px')
}
function rlDetSet(det: HTMLElement | null, v: 'away' | number | null): void {
  if (rlDet && rlDet !== det) rlDetSet(rlDet, null)
  rlDet = v === null ? null : det
  rlAttr(det, 'data-dpm-gd', v === null ? null : v === 'away' ? 'away' : 'w')
  rlVar(det, '--dpm-gd-w', typeof v === 'number' ? v + 'px' : null)
}
const RL_SW_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>'
function rlSwap(front: 'detail' | 'rightbar' | null, right = 0): void {
  if (!front) { if (rlSw && !rlSw.hidden) rlSw.hidden = true; return }
  if (!rlSw) {
    rlSw = document.createElement('button')
    rlSw.type = 'button'
    rlSw.className = 'dpm-rlswap'
    rlSw.addEventListener('click', () => { RL.last = RL.last === 'detail' ? 'rightbar' : 'detail'; rlLay() })
    document.body.append(rlSw)
  }
  const t = front === 'detail' ? '右侧栏在详情后面 · 切过去' : '卡片详情在右侧栏后面 · 切过去'
  if (rlSw.dataset.front !== front) {
    rlSw.dataset.front = front
    rlSw.innerHTML = RL_SW_IC + '<span>' + t + '</span>'
  }
  if (rlSw.style.right !== right + 12 + 'px') rlSw.style.right = right + 12 + 'px'
  if (rlSw.hidden) rlSw.hidden = false
}
/* ═══ v143（1.1）/ v144（2.2）/ v145（4）：一个排版引擎管全部列 ═══
   中间区（会话 / 看板 / 日程）| 每日任务面板 | 卡片详情 | DSH 右侧栏 | Android 面板（从左到右；Android 永远最右）。
   宽度分配 = src/rlayout.ts colsPlan（放不下先按比例压到下限，还放不下 = 最早打开的那列收成右边 44px 竖条）；
   只有这里写各列的 right / width 和中列让位（布局只有一个主人）；Android 面板读 dpm:columns 事件贴自己的 right。 */
const COL_NAME: Record<ColKey, string> = { tp: '每日任务面板', cd: '卡片详情', rbx: 'DSH 右侧栏', ap: 'Android 面板' }
const COL_AT: Record<ColKey, number> = { tp: 0, cd: 0, rbx: 0, ap: 0 }
const COL_WAS: Partial<Record<ColKey, boolean>> = {}
let colTick = 0
let colTabs: HTMLElement | null = null
let lastAway: ColKey[] = []
let lastCols = ''
/** 把这一列换到前面（竖条点击 / 入口按钮在它叠着时再点） */
export function colFront(k: ColKey): boolean {
  if (!lastAway.includes(k)) return false
  COL_AT[k] = Date.now() + (++colTick) / 1000
  rlLay()
  const el = k === 'tp' ? document.querySelector('.dpm-tpcol') : k === 'cd' ? gdv?.root : k === 'rbx' ? rlPanel : document.querySelector('.dap-dock')
  if (el instanceof HTMLElement) { el.classList.remove('dpm-colflash'); void el.offsetWidth; el.classList.add('dpm-colflash'); setTimeout(() => el.classList.remove('dpm-colflash'), 1000) }
  return true
}
export const colAway = (k: ColKey): boolean => lastAway.includes(k)
function colTabsPaint(away: ColKey[]): void {
  if (!away.length) { if (colTabs) colTabs.hidden = true; return }
  if (!colTabs) {
    colTabs = document.createElement('div')
    colTabs.className = 'dpm-coltabs'
    colTabs.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-coltab]'); if (b) colFront(b.dataset.coltab as ColKey) })
    document.body.append(colTabs)
  }
  const sig = away.join(',')
  if (colTabs.dataset.sig !== sig) {
    colTabs.dataset.sig = sig
    colTabs.innerHTML = away.map((k) => '<button type="button" class="dpm-coltab" data-coltab="' + k + '" title="' + COL_NAME[k] + '叠在右边（没有被关掉）· 点一下换到前面" aria-label="' + COL_NAME[k] + '叠在右边，点一下换到前面"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 9 12l6 6"/></svg><span>' + COL_NAME[k] + '</span></button>').join('')
  }
  colTabs.hidden = false
}
function rlLay(): void {
  if (RL.dead) return
  const det = gdv && RL.on && !gdv.root.hidden ? gdv : null
  const tp = document.querySelector<HTMLElement>('.dpm-tpcol:not([hidden])')
  const ap = document.querySelector<HTMLElement>('.dap-pane.dap-dock')
  const n = rlNodes()
  if (!n) {
    /* 宿主改版找不到主框架节点：退回 v133 做法（只给中列让位），并点名 */
    if (det && !RL.warned) { RL.warned = true; console.warn('[dsh-project-manager] 找不到 DSH 主框架节点（[data-rightbar-col] 及其同级 _centerCol），卡片详情 / 每日任务面板退回只给中列让位；DSH 右侧栏和它们同时打开时可能互相遮挡') }
    RL.mode = det || tp ? 'fallback' : 'off'; RL.A = 0; RL.pair = false
    let r = 0
    if (det) { rlDetSet(det.root, null); r += RL.w }
    if (tp) { rlVar(tp, '--dpm-col-r', r + 'px'); rlVar(tp, '--dpm-col-w', (Number(tp.dataset.want) || 380) + 'px'); r += Number(tp.dataset.want) || 380 }
    rlPanelSet(null, null); rlHand(null, null); rlSwap(null); colTabsPaint([])
    rlPad(det || tp ? (document.querySelector('[class*="_centerCol"]') as HTMLElement | null) : null, r)
    return
  }
  rlWatch(n)
  const rbOpen = !!n.panel && n.panel.hasAttribute('data-sidebar-right-open')
  const full = rbOpen && n.panel!.getAttribute('data-sidebar-right-panel') === 'fullscreen'
  const W = n.fr.getBoundingClientRect().width
  const A = W - (n.sb ? n.sb.getBoundingClientRect().width : 0)
  const Rt = n.rbc.getBoundingClientRect().width
  const hostW = rbOpen ? (parseFloat(n.panel!.style.width) || Rt) : 0
  RL.A = A
  /* 打开顺序：新打开的记时间（最早打开的先叠放） */
  const on: Record<ColKey, boolean> = { tp: !!tp, cd: !!det, rbx: rbOpen && !full, ap: !!ap }
  for (const k of ['tp', 'cd', 'rbx', 'ap'] as ColKey[]) { if (on[k] && !COL_WAS[k]) COL_AT[k] = Date.now() + (++colTick) / 1000; COL_WAS[k] = on[k] }
  /* 拖宿主右侧栏把手：按拖动距离换算右侧栏想要的宽度 */
  if (RL.drag && rlPanel) RL.ratio = Math.max(COL_MIN.rbx, RL.drag.rv0 - RL.drag.dx)
  const want: Record<ColKey, number> = {
    tp: Number(tp?.dataset.want) || 380,
    cd: det ? Math.max(360, Math.min(760, det.rlWant())) : 0,
    rbx: Math.max(COL_MIN.rbx, RL.ratio ?? hostW),
    /* Android 面板默认宽 420（dsh-android-pane DOCK_W）；别读它当前宽度 —— 被压窄后会越读越窄 */
    ap: ap ? 420 : 0,
  }
  const open: ColIn[] = (['tp', 'cd', 'rbx', 'ap'] as ColKey[]).filter((k) => on[k]).map((k) => ({ k, want: want[k], at: COL_AT[k] }))
  /* 只有宿主自己的右侧栏（没有插件的列）= 宿主原样：不改面板 / 把手 / 中列 */
  if (!tp && !det && !ap) {
    lastAway = []
    rlPanelSet(n.panel, null); rlHand(n.hd, null); rlDetSet(null, null); rlSwap(null); colTabsPaint([]); rlPad(n.cc, 0)
    RL.mode = 'off'; RL.pair = false; RL.ratio = null
    if (lastCols !== 'off') { lastCols = 'off'; window.dispatchEvent(new CustomEvent('dpm:columns', { detail: { cols: [], away: [], ap: null } })) }
    return
  }
  const p = colsPlan(A, open)
  lastAway = p.away
  const col = (k: ColKey): { w: number; right: number } | undefined => p.cols.find((c) => c.k === k)
  /* 每日任务面板 */
  if (tp) { const c = col('tp'); rlAttr(tp, 'data-dpm-col', c ? 'on' : 'away'); if (c) { rlVar(tp, '--dpm-col-r', c.right + 'px'); rlVar(tp, '--dpm-col-w', c.w + 'px') } }
  /* 卡片详情 */
  if (det) { const c = col('cd'); if (c) { det.fitGlobal(c.w); rlDetSet(det.root, c.w); rlVar(det.root, '--dpm-gd-r', c.right + 'px') } else rlDetSet(det.root, 'away') }
  else rlDetSet(null, null)
  /* DSH 右侧栏：全屏 = 铺到其余列左边；叠放 = 藏起来；并排 = 写 right / width */
  if (full) rlPanelSet(n.panel, 'on', p.total + 'px', 'calc(100vw - ' + p.total + 'px)')
  else if (rbOpen) { const c = col('rbx'); if (c) rlPanelSet(n.panel, 'on', c.right + 'px', c.w + 'px'); else rlPanelSet(n.panel, 'away') }
  else rlPanelSet(n.panel, null)
  const rc = col('rbx')
  if (rbOpen && !full && rc && n.hd) rlHand(n.hd, Math.round(hostW - rc.right - rc.w))
  else rlHand(n.hd, null)
  /* 中列让位：所有列 + 竖条的总宽 − 宿主自己给右侧栏留的轨道 */
  rlPad(n.cc, Math.max(0, p.total - (rbOpen ? Rt : 0)))
  rlSwap(null)
  colTabsPaint(p.away)
  RL.mode = p.away.length ? 'stack' : open.length > 1 ? 'pair' : open.length ? 'center' : 'off'
  RL.pair = open.length > 1
  /* Android 面板（另一个插件）读这个事件贴自己的 right */
  const sig = JSON.stringify(p.cols) + '|' + p.away.join(',')
  if (sig !== lastCols) {
    lastCols = sig
    const apc = col('ap')
    window.dispatchEvent(new CustomEvent('dpm:columns', { detail: { cols: p.cols, away: p.away, ap: ap ? (apc ? { right: apc.right, width: apc.w } : { away: true }) : null } }))
  }
}
/** v134：卸载即净 —— 断开观察 / 监听，宿主节点上的属性、变量、中列 padding 全部撤掉，切换胶囊移除。 */
export function rlDispose(): void {
  /* 全局详情也随插件卸载（之前卸载后旧详情仍留在页面上、继续调旧代码） */
  if (gdv) { const v = gdv; gdv = null; v.dispose(); v.root.remove() }
  RL.dead = true
  if (rlRaf) { cancelAnimationFrame(rlRaf); rlRaf = 0 }
  rlRo?.disconnect(); rlMo?.disconnect(); rlOff?.()
  rlRo = null; rlMo = null; rlOff = null; rlFr = null; rlRbc = null; rlPo = null
  rlPanelSet(null, null); rlHand(null, null); rlDetSet(null, null); rlPad(null, 0)
  rlSw?.remove(); rlSw = null
  colTabs?.remove(); colTabs = null; lastAway = []; lastCols = ''
  kickOff?.(); kickOff = null
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.dpm-tpcol'))) { el.removeAttribute('data-dpm-col'); el.style.removeProperty('--dpm-col-r'); el.style.removeProperty('--dpm-col-w') }
  window.dispatchEvent(new CustomEvent('dpm:columns', { detail: null }))
  Object.assign(RL, { on: false, A: 0, pair: false, ratio: null, rbWas: false, detWas: false, drag: null, mode: 'off' })
}
/** 验收探针：只读当前布局状态。 */
export function rlState(): { mode: string; A: number; pair: boolean; ratio: number | null; last: string; away: ColKey[] } { return { mode: RL.mode, A: RL.A, pair: RL.pair, ratio: RL.ratio, last: RL.last, away: lastAway.slice() } }
/** v143：插件启动就接管全部列（没有详情时也要排每日任务面板 / Android）：
    面板列开关 / 想要的宽度变了（gantt 发 dpm:cols）、Android 面板（body 上）出现 / 消失、窗口缩放 → 重排；宿主框架还没画出来就每 300ms 再找一次 */
let kickOff: (() => void) | null = null
export function rlKick(): void {
  RL.dead = false
  if (!kickOff) {
    const onCols = (): void => rlSoon()
    window.addEventListener('dpm:cols', onCols)
    window.addEventListener('resize', onCols)
    const bodyMo = new MutationObserver((ms) => { if (ms.some((m) => [...m.addedNodes, ...m.removedNodes].some((x) => x instanceof HTMLElement && (x.classList.contains('dap-pane') || !!x.querySelector?.('.dap-pane'))))) rlSoon() })
    bodyMo.observe(document.body, { childList: true, subtree: true })
    let t = 0, n = 0
    const wait = (): void => { if (rlNodes()) { rlSoon(); return } if (++n < 100) t = window.setTimeout(wait, 300) }
    wait()
    kickOff = () => { window.removeEventListener('dpm:cols', onCols); window.removeEventListener('resize', onCols); bodyMo.disconnect(); clearTimeout(t) }
  }
  rlSoon()
}
/** 0.32 打开全局卡片详情：body 最右侧固定一列，独立于当前页面。 */
/** v86：详情视图实例（跨视图同步用）。 */
export function globalDetailView(): BoardView | null { return gdv }

export function openGlobalDetail(host: BoardHost, cardId: string, dw?: number | null, before?: (v: BoardView) => void): void {
  if (!gdv) {
    const el = document.createElement('div')
    el.className = 'dpm-global-detail'
    document.body.append(el)
    gdv = new BoardView(el, host, { detailOnly: true })
    el.addEventListener('click', () => {
      queueMicrotask(() => {
        if (!gdv) return
        if (!gdv.sel) { closeGlobalDetail(); return }
        if (gdv.sel !== detailState.sel) { detailState.sel = gdv.sel; detailState.open = true; notifyDetail() }
      })
    }, true)
  }
  // v89：同一张卡片的详情已经开着 → 什么都不做（不重画、不重拉 /gantt、不写宽度）。
  // 旧代码每次调用都从服务端值重设宽度；而拖动详情宽度会让宿主反复推面板快照，
  // syncMode → focusCard → 这里，于是拖动中的宽度每 ~100ms 被写回一次（拖不动 / 回弹 / 记不住）。
  if (detailState.open && detailState.sel === cardId && !gdv.root.hidden) {
    /* v134：放不下三列时详情藏在右侧栏后面 → 再点「打开详情」= 把详情切到前面（后打开的在前） */
    if (RL.mode === 'compact-rightbar') RL.last = 'detail'
    gdv.showGlobal(true)
    return
  }
  const seed = host.seed?.()
  if (seed) gdv.snap = seed
  gdv.sel = cardId
  before?.(gdv)
  /* v133 R2：首次打开先用已知宽度（日程页快照里的 ui.dw），别先按 420 画、等 meta 回来再改宽 —— 改宽会让甘特整页再重画一遍 */
  if (dw !== undefined) gdv.setGlobalWidth(dw)
  gdv.render()
  gdv.root.hidden = false
  gdv.showGlobal(true)
  detailState.sel = cardId
  detailState.open = true
  notifyDetail()
  // 宽度记住（ui.gantt.dw）：v90 起走 meta=1 只读宽度 —— 旧代码拉完整 /gantt，会在宿主里放一轮会话日志统计，
  // 打开详情、切会话都跟着变慢。拖动中不写（拖动只认手）。
  void getGanttMeta().then((g) => { if (gdv) gdv.setGlobalWidth(typeof g.ui.dw === 'number' ? g.ui.dw : null) }).catch(() => { if (gdv) gdv.setGlobalWidth(null) })
}
export function closeGlobalDetail(): void {
  if (!gdv) return
  gdv.sel = null
  gdv.render()
  gdv.root.hidden = true
  gdv.showGlobal(false)
  detailState.sel = null
  detailState.open = false
  notifyDetail()
}
export function isGlobalDetailOpen(): boolean { return detailState.open }
export function globalDetailCard(): string | null { return detailState.open ? detailState.sel : null }

