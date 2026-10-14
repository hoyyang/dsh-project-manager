/**
 * 项目看板（主区面板）：vanilla DOM 渲染，直接移植原型 v8 的结构/样式/交互；数据全部来自 host 快照。
 * 阶段（statuses）只用来给卡片分组；每个阶段底部常驻「添加卡片」，就地输入、回车连续添加。
 * 所有变更 → POST → 用返回的新快照重绘（服务端是唯一事实来源，失败时点名提示并回到服务端状态）。
 */
import { ApiError, Card, getState, Group, post, Snapshot, StateInfo, Status, WebLink } from './api.js'
import { CHECK_SVG, COPY_SVG, esc, ic } from './icons.js'

export interface BoardHost {
  /** 以卡片新建项目会话（index.ts 实现：准备工作区 → 新建会话 → 绑定 → 打开）。 */
  newSession(cardId: string): Promise<void>
  openSession(sessionId: string): void
  isDark(): boolean
  setDark(dark: boolean): void
  toast(msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }): void
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
}

/** 宿主拒绝归档时带回的「仍在进行的工作」，一类一条。 */
export interface ArchiveActivity { kind: string; items?: Array<{ id: string; label?: string }> }

/** 与 dsh 官方「停止并归档」确认框同一套文案。 */
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
type WlRow = { text: string; type: string; url: string; err: string }
/** 卡片有没有会注入会话的「卡片资料」（说明 / 链接 / 文件）。 */
export const hasMaterials = (c: Card): boolean => !!(c.notes ?? '').trim() || !!(c.webLinks ?? []).length || !!(c.files ?? []).length || !!(c.repos ?? []).length || !!c.tasks.length
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

export class BoardView {
  snap: Snapshot | null = null
  sel: string | null = null
  q = ''
  err = ''
  editG: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
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
  private dragId: string | null = null
  private dropAt: { g: string; col: string; before: string | null; tray?: boolean } | null = null
  private link: { kind: 'group' | 'card'; id: string; sel: Set<string>; locked: Set<string>; q: string } | null = null
  private disposers: Array<() => void> = []
  private disposed = false
  /** 正在就地添加卡片的阶段；addDraft 跨重绘保留输入。 */
  private adding: { g: string; col: string } | null = null
  private addDraft = ''
  private addBusy = false
  private rendering = false
  private composing = false
  /** 「添加挂载仓库」弹窗的草稿：候选搜索词、已选项、是否降级为手输路径。 */
  /** 添加仓库弹窗：mode=group → 卡片组的「卡片共用仓库」；mode=card → 这张卡片自己的仓库（id = 组 id / 卡片 id）。 */
  private ar: { mode: 'group' | 'card'; id: string; q: string; sel: Array<{ path: string; name: string; role: string }>; manual: boolean; busy: boolean } | null = null
  /** 「关联已有会话」弹窗草稿；cf = 待确认解除关联的会话。 */
  private ls: { card: string; q: string; sel: string[]; busy: boolean } | null = null
  private cf: string | null = null
  private restoring = new Set<string>()
  /** 相关说明编辑态（card = 正在编辑的卡片，draft = 草稿）；没保存过的卡片始终是输入框。 */
  private noteEdit: { card: string; draft: string } | null = null
  /** 相关文件：系统选文件框打开中 / 降级为手输路径。 */
  private filePicking = false
  /** 0.15 粘贴路径：card = 打开在哪张卡片；text = 输入框内容；res = 服务端逐行检测结果（与 text 同步）。 */
  private fp: { card: string; text: string; res: PathCheck[]; seq: number } | null = null
  private fpTimer = 0
  private chipSig = ''
  /** 展开了「已归档卡片」列表的卡片组（默认全部收起，只在本次打开期间记住）。 */
  private tray = new Set<string>()
  /** 等待「停止并归档」确认的会话。 */
  private sa: { id: string; title: string } | null = null
  /** 0.10：展开了完整「相关说明」的卡片（本次打开期间记住）。 */
  private noteOpen = new Set<string>()
  /** 0.11：「关联的落盘项目」是否展开详情（全部卡片共用一个开关，本次打开期间记住，默认只显示标题）。 */
  private memOpen = false
  /** 0.12：当前卡片的两个列表是否「展示更多」（切换卡片回到默认 3 项）。 */
  private more = { card: '', sess: false, mem: false }
  private moreOf(c: Card): { sess: boolean; mem: boolean } { if (this.more.card !== c.id) this.more = { card: c.id, sess: false, mem: false }; return this.more }
  /** 0.10：「添加 / 编辑相关链接」弹窗草稿。 */
  private wl: { card: string; mode: 'add' | 'edit'; idx: number; rows: WlRow[] } | null = null
  /** 0.10：相关链接拖动排序（pointer：按住手柄拖动，松开落位，Esc 取消）。 */
  private wd: { i: number; y0: number; on: boolean; to: number | undefined } | null = null

  constructor(readonly root: HTMLElement, readonly host: BoardHost) {
    root.classList.add('dpm')
    root.innerHTML = '<div class="pm-top"></div><div class="pm-body"><div class="board-wrap"></div></div>' + DIALOGS.replace('%FOLDER%', ic('fplus')).replaceAll('%PLUS%', ic('plus'))
    this.bind()
    // 0.15：有上次的快照就立刻画（看板不再等第一次请求），否则画骨架；后台同步完成后静默更新
    const seed = host.seed?.() ?? null
    if (seed) { this.snap = seed; this.render() } else this.render()
    queueMicrotask(() => { if (this.wantCard && this.snap) void this.focusCard(this.wantCard) })
    this.syncing = true
    this.syncBadge()
    void this.refresh().finally(() => { this.syncing = false; this.syncBadge() })
    this.timer = setInterval(() => { if (!document.hidden) void this.refresh(true) }, 4000)
  }

  /** 0.19 从会话信息卡直达：选中卡片、打开详情、滚到它、闪一下蓝框（快照还没到就等下一次渲染）。 */
  private wantCard: string | null = null
  async focusCard(id: string): Promise<void> {
    if (!this.card(id)) { this.wantCard = id; return }
    this.wantCard = null
    const c = this.card(id) as Card
    if (c.archivedAt) this.tray.add(c.g)
    if (this.sel !== id) { this.noteEdit = null; this.fp = null }
    this.sel = id
    // 卡片组收起着 → 展开并存下来（只改本地快照的话，下一次同步又会收回去）
    if (this.grp(c.g)?.collapsed) await this.act('group/update', { id: c.g, collapsed: false })
    else this.render()
    const wrap = this.root.querySelector('.board-wrap') as HTMLElement | null
    const el = wrap?.querySelector('[data-card="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (!wrap || !el) return
    // 只滚看板自己的滚动区（纵向）和这一组的阶段条（横向）。不用 scrollIntoView：它会连宿主外层的
    // overflow:hidden 容器一起滚，整个看板被顶上去（0.19 主实例实测）。
    const wr = wrap.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    wrap.scrollTo({ top: Math.max(0, wrap.scrollTop + er.top - wr.top - Math.max(16, (wrap.clientHeight - er.height) / 2)), behavior: 'smooth' })
    const lane = el.closest('.lane-in') as HTMLElement | null
    if (lane) { const lr = lane.getBoundingClientRect(); if (er.left < lr.left || er.right > lr.right) lane.scrollTo({ left: Math.max(0, lane.scrollLeft + er.left - lr.left - 16), behavior: 'smooth' }) }
    el.classList.remove('dpm-flash'); void el.offsetWidth; el.classList.add('dpm-flash'); setTimeout(() => el.classList.remove('dpm-flash'), 1400)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    clearTimeout(this.syncTimer)
    clearTimeout(this.fpTimer)
    for (const d of this.disposers) d()
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
  cardDesc(c: Card): string {
    const m = this.memOf(c)
    const own = m.find((x) => x.from !== 'group') ?? m[0]
    const s = own ? this.stateOf(own.k) : undefined
    return s ? (s.status || '暂无状态说明') : (m.length ? '关联的落盘项目未找到' : '未关联落盘项目')
  }
  cell(g: string, col: string): Card[] { return this.cards.filter((c) => c.g === g && c.col === col && !c.archivedAt).sort((a, b) => a.order - b.order) }
  sessionsOf(cardId: string): Array<{ id: string; title: string; at: string }> { return (this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId).map((s) => ({ id: s.sessionId, title: s.title ?? '会话 ' + s.sessionId.slice(0, 8), at: s.createdAt.slice(5, 16).replace('T', ' ') })) }

  async refresh(quiet = false): Promise<void> {
    try {
      if (quiet && (this.composing || this.gd)) return
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
      return true
    } catch (e) {
      this.host.toast(e instanceof ApiError ? e.message : String(e), 'err')
      await this.refresh()
      return false
    }
  }

  // ── 渲染 ──
  render(): void {
    if (this.disposed) return
    const dark = this.host.isDark()
    const top = this.root.querySelector('.pm-top') as HTMLElement
    if (!top.firstChild) top.innerHTML = '<div class="ttl"><h1>项目看板<span class="pm-sync" role="status"><span class="dot" aria-hidden="true"></span>正在同步…</span></h1><p>一张卡片对应一个落盘项目，卡片组就是父项目。每个卡片组有自己的一套阶段。</p></div>'
      + '<label class="search">' + ic('search') + '<span class="sr-only">搜索卡片</span><input id="dpmQ" type="search" placeholder="搜索卡片或仓库" value="' + esc(this.q) + '"></label>'
      + '<button type="button" class="btn" data-import>' + ic('import') + '导入落盘项目</button>'
      + '<button type="button" class="btn primary" data-new-group>' + ic('plus') + '新建卡片组</button>'
      + '<button type="button" class="ib" data-theme-toggle></button>'
    const tb = top.querySelector('[data-theme-toggle]') as HTMLElement
    const want = dark ? 'sun' : 'moon'
    if (tb.dataset.icon !== want) { tb.dataset.icon = want; tb.innerHTML = ic(want); tb.setAttribute('aria-label', '切换到' + (dark ? '浅色' : '深色') + '主题') }
    const body = this.root.querySelector('.pm-body') as HTMLElement
    const wrap = body.querySelector('.board-wrap') as HTMLElement
    const scroll = wrap.scrollTop
    const addFocus = document.activeElement?.id === 'dpmAddIn'
    this.rendering = true
    const laneX = new Map<string, number>()
    wrap.querySelectorAll<HTMLElement>('.lane-in[data-g]').forEach((el) => laneX.set(el.dataset.g as string, el.scrollLeft))
    this.idxCache = this.sessIndex()
    try { wrap.innerHTML = (this.err ? '<div class="dpm-err" role="alert">' + esc(this.err) + '</div>' : '') + this.lfNoteHtml() + this.boardHtml() } finally { this.idxCache = null }
    this.chipSig = this.chipSignature()
    wrap.scrollTop = scroll
    wrap.querySelectorAll<HTMLElement>('.lane-in[data-g]').forEach((el) => { const x = laneX.get(el.dataset.g as string); if (x) el.scrollLeft = x })
    const addIn = wrap.querySelector('#dpmAddIn') as HTMLInputElement | null
    if (!addIn) this.adding = null
    else if (addFocus) { addIn.focus(); addIn.setSelectionRange(addIn.value.length, addIn.value.length) }
    this.renderDetail()
    this.rendering = false
  }

  /**
   * 详情栏：换卡片 = 新插入（播放滑入）；同一张卡片 = 内容没变不动，变了就原地替换内容
   * （不重新插入节点、不重放动画，保留滚动、子任务草稿与焦点）——会话推送很频繁，整块重建会「闪」。
   */
  private lastDetail = ''
  renderDetail(): void {
    const body = this.root.querySelector('.pm-body') as HTMLElement
    const old = body.querySelector('.detail') as HTMLElement | null
    if (!this.sel || !this.card(this.sel)) { this.sel = null; old?.remove(); this.lastDetail = ''; return }
    const html = this.detailHtml()
    if (old && old.getAttribute('data-card') === this.sel) {
      if (html === this.lastDetail) return
      // 正在输入相关说明时不原地替换（会丢光标）；失焦后的下一次推送再更新
      if ((document.activeElement?.id === 'dpmNoteIn' || document.activeElement?.id === 'dpmFpIn') && old.contains(document.activeElement)) return
      const tpl = document.createElement('template')
      tpl.innerHTML = html
      const nd = tpl.content.firstElementChild as HTMLElement
      const scroll = (old.querySelector('.d-b') as HTMLElement | null)?.scrollTop ?? 0
      const task = (old.querySelector('#dpmNewTask') as HTMLInputElement | null)?.value ?? ''
      const focusId = old.contains(document.activeElement) ? keyOf(document.activeElement as HTMLElement) : null
      old.classList.add('stay')
      old.replaceChildren(...Array.from(nd.childNodes))
      const db = old.querySelector('.d-b') as HTMLElement | null
      if (db) db.scrollTop = scroll
      const inp = old.querySelector('#dpmNewTask') as HTMLInputElement | null
      if (inp && task) inp.value = task
      if (focusId) (old.querySelector(focusId) as HTMLElement | null)?.focus({ preventScroll: true })
    } else {
      old?.remove()
      body.insertAdjacentHTML('beforeend', html)
    }
    this.lastDetail = html
    this.fixNotes()
  }
  /** 相关说明超过高度阈值 → 折叠（底部渐隐）+ 「展开全部 / 收起」；是否超长在渲染后量。 */
  private fixNotes(): void {
    this.root.querySelectorAll<HTMLElement>('.detail [data-nwrap]').forEach((w) => {
      const v = w.querySelector('.note-view') as HTMLElement
      const b = w.querySelector('.note-more') as HTMLButtonElement
      const long = v.scrollHeight > NOTE_CLAMP + 12
      w.classList.toggle('clamp', long && !this.noteOpen.has(w.dataset.nwrap as string))
      b.hidden = !long
    })
  }

  private boardHtml(): string {
    // 0.15：第一次打开还没数据 → 骨架（不再整块空白）
    if (!this.snap) return '<div class="skel-board" aria-busy="true" aria-label="正在加载看板">' + [0, 1].map(() => '<div class="lane skel-lane"><div class="skel-h"></div><div class="skel-row">' + [0, 1, 2].map(() => '<div class="skel"></div>').join('') + '</div></div>').join('') + '</div>'
    if (!this.groups.length) return '<div class="empty-board"><b>还没有卡片组</b><span>新建一个卡片组，或从落盘项目导入。</span><button type="button" class="btn primary" data-new-group>' + ic('plus') + '新建卡片组</button></div>'
    const q = this.q
    const vis = this.cards.filter((c) => !c.archivedAt).filter((c) => !q || (c.t + ' ' + c.links.join(' ') + ' ' + this.cardDesc(c) + ' ' + (this.grp(c.g)?.repos.map((r) => r.name).join(' ') ?? '')).toLowerCase().includes(q))
    return this.groups.map((g) => {
      const cs = vis.filter((c) => c.g === g.id)
      // 最近归档的在上
      const ar = this.cards.filter((c) => c.g === g.id && c.archivedAt).sort((a, b) => (b.archivedAt as string).localeCompare(a.archivedAt as string))
      const open = this.tray.has(g.id)
      const n = g.statuses.length
      const head = '<div class="shead" style="--cols:' + n + '">' + g.statuses.map((st) => '<div class="colh"><span class="nm">' + esc(st.name) + '</span><span class="n">' + cs.filter((x) => x.col === st.id).length + '</span></div>').join('') + '</div>'
      const bodyHtml = g.statuses.map((st) => {
        const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order)
        return '<div class="cell' + (inCol.length ? '' : ' empty') + '" data-col="' + esc(st.id) + '" data-g="' + esc(g.id) + '">' + inCol.map((c) => this.cardHtml(c)).join('') + this.addHtml(g, st) + '</div>'
      }).join('')
      // 头部左侧整块（箭头、组名、统计、空白）点击展开/收起；里面的「组记忆」按钮保持自己的作用
      return '<section class="lane' + (g.collapsed ? ' collapsed' : '') + '" data-lane="' + esc(g.id) + '"><div class="lane-h">'
        + '<div class="lane-hit" data-toggle-area="' + esc(g.id) + '"><h2><button type="button" class="tg" data-toggle="' + esc(g.id) + '" aria-expanded="' + !g.collapsed + '"><span class="chev-b"><svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span><span class="nm">' + esc(g.name) + '</span></button></h2>'
        + this.statHtml(g, cs)
        + (g.links.length ? '<button type="button" class="chip mem as-btn" data-edit-group="' + esc(g.id) + '" data-focus-links>' + ic('mem') + '<span class="lb">组记忆 </span>' + g.links.length + '</button>' : '')
        + '</div>'
        + '<button type="button" class="btn ghost" data-edit-group="' + esc(g.id) + '">' + ic('sliders') + '卡片组设置</button>'
        + '<button type="button" class="btn ghost" data-new-in="' + esc(g.id) + '">' + ic('plus') + '新会话</button>'
        + '<button type="button" class="btn ghost" data-tray="' + esc(g.id) + '" aria-expanded="' + open + '" aria-controls="dpmTray-' + esc(g.id) + '">' + ic('archive') + '已归档卡片<span class="cnt">' + ar.length + '</span></button>'
        + '<button type="button" class="ib grip tipbtn" data-gdrag="' + esc(g.id) + '" aria-label="调整「' + esc(g.name) + '」的顺序：按住拖动，或 Alt+上下方向键">' + ic('grip') + '<span class="tip" aria-hidden="true">按住拖动排序</span></button></div>'
        + (open ? this.trayHtml(g, ar) : '')
        + '<div class="lane-in" data-g="' + esc(g.id) + '">' + head + '<div class="lane-b" style="--cols:' + n + '">' + bodyHtml + '</div></div></section>'
    }).join('')
  }

  /** 阶段底部的「添加卡片」：按钮，或正在输入时的就地表单。 */
  private addHtml(g: Group, st: Status): string {
    const a = this.adding
    if (a && a.g === g.id && a.col === st.id) return '<form class="addc-f" data-addcard><label class="sr-only" for="dpmAddIn">在「' + esc(st.name) + '」添加卡片</label><input id="dpmAddIn" placeholder="卡片标题，回车添加" autocomplete="off" maxlength="120" value="' + esc(this.addDraft) + '"><span class="hint">回车添加，可连续输入 · Esc 收起</span></form>'
    return '<button type="button" class="addc" data-add-card="' + esc(g.id) + '" data-col="' + esc(st.id) + '" aria-label="在「' + esc(st.name) + '」添加卡片">' + ic('plus') + '添加卡片</button>'
  }

  private cardHtml(c: Card): string {
    // v0.7：卡片只留两个小标志——会话（有活跃=绿、全归档=灰、没有=不显示）+ 落盘项目（有才显示）；子任务只在详情里
    const n = this.memOf(c).length
    const mem = n ? '<span class="chip mem" title="会话会自动读取 ' + n + ' 个落盘项目的记忆">' + ic('mem') + n + '<span class="sr-only"> 个落盘项目</span></span>' : ''
    const sb = this.badgeOf(c.id)
    const tip = sb ? (sb.live ? sb.live + ' 个活跃会话' + (sb.n > sb.live ? '，' + (sb.n - sb.live) + ' 个已归档' : '') : sb.n + ' 个会话，都已归档') : ''
    const sess = sb ? '<span class="chip sess ' + (sb.live ? 'on' : 'off') + '" title="' + tip + '"><span class="bub">' + ic('chat') + '<i></i></span>' + sb.n + '<span class="sr-only">，' + tip + '</span></span>' : ''
    const arc = '<button type="button" class="ib carc tipbtn" data-archive-card="' + esc(c.id) + '" aria-label="归档卡片「' + esc(c.t) + '」">' + ic('archive') + '<span class="tip" aria-hidden="true">归档卡片</span></button>'
    return '<div class="card" role="button" tabindex="0" draggable="true" data-card="' + esc(c.id) + '" aria-pressed="' + (this.sel === c.id) + '" aria-label="' + esc(c.t) + '，打开详情；Alt+上下方向键调整顺序">'
      + arc + '<h3>' + esc(c.t) + '</h3><p>' + esc(this.cardDesc(c)) + '</p><div class="foot">' + sess + mem + '</div></div>'
  }

  private detailHtml(): string {
    const c = this.card(this.sel as string) as Card
    const g = this.grp(c.g) as Group
    const sts = g.statuses
    const i = sts.findIndex((x) => x.id === c.col)
    const nx = sts[i + 1]
    const ro = !!c.archivedAt
    const steps = sts.map((s, k) => '<button type="button" class="step' + (k < i ? ' past' : k === i ? ' cur' : '') + '"' + (ro ? ' disabled' : ' data-step="' + esc(s.id) + '"') + (k === i ? ' aria-current="step"' : '') + ' aria-label="移到 ' + esc(s.name) + '"><span class="nd">' + (k < i ? ic('check') : '') + '</span>' + esc(s.name) + '</button>').join('')
    const mem = this.memOf(c)
    const mo = this.moreOf(c)
    const memRows = limitList(mem, mo.mem).map((m) => {
      const s = this.stateOf(m.k)
      const tag = m.from === 'group' ? '<span class="chip plain">来自卡片组</span>' : m.from === 'both' ? '<span class="chip plain">卡片组 + 卡片</span>' : '<span class="chip brand">卡片</span>'
      const rm = !ro && m.from !== 'group' ? '<button type="button" class="ib" data-unlink-card="' + esc(m.k) + '" aria-label="取消关联 ' + esc(m.k) + '">' + ic('x') + '</button>' : ''
      if (!s) return '<div class="mrow"><div class="txt"><div class="nm" title="' + esc(m.k) + '">' + esc(m.k) + '</div><div class="more"><p class="l">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div></div><div class="mside">' + tag + rm + '</div></div>'
      return '<div class="mrow"><div class="txt"><div class="nm mq" title="' + esc(s.slug) + '">' + esc(s.slug) + '</div><div class="more"><span class="mono">' + esc(s.project) + ' · 更新于 ' + esc(s.updated) + '</span><p class="l">' + esc(s.status || '暂无状态说明') + '</p><p class="nx"><b>next_action</b>' + esc(s.next || '暂无下一步') + '</p></div></div><div class="mside">' + tag + rm + '</div></div>'
    }).join('')
    const memBody = memRows ? '<div class="mlist' + (this.memOpen ? ' open' : '') + '" id="dpmMemList">' + memRows + '</div>' + moreBtn('mem', mo.mem, mem.length, 'dpmMemList') : '<p class="meta">还没有关联落盘项目。会话不会自动读取任何记忆。</p>'
    const memTg = memRows ? '<button type="button" class="btn ghost sm mem-tg" data-mem-toggle aria-expanded="' + this.memOpen + '" aria-controls="dpmMemList">' + (this.memOpen ? '收起详情' : '展开详情') + ic('chev') + '</button>' : ''
    // 0.14：卡片自己的仓库清单；「本组共用」= 也在卡片组的卡片共用仓库里（只是提示）
    const shared = new Set(g.repos.map((r) => normPath(r.path)))
    const crs = c.repos ?? []
    const repos = crs.map((r, i) => '<div class="repo">' + ic('repo') + '<div class="txt"><div class="nm mq">' + esc(r.name) + '</div><span class="mono mq" title="' + esc(r.path) + '">' + esc(r.path) + '</span></div>'
      + (shared.has(normPath(r.path)) ? '<span class="from" title="也在卡片组「' + esc(g.name) + '」的卡片共用仓库里">本组共用</span>' : '')
      + '<span class="chip ' + (r.role === '主仓' ? 'brand' : 'plain') + '">' + esc(r.role) + '</span>'
      + (ro ? '' : '<button type="button" class="ib sm" data-card-repo-del="' + i + '" aria-label="从这张卡片移除 ' + esc(r.name) + '">' + ic('x') + '</button>') + '</div>').join('')
    const repoBody = repos ? repos + (ro ? '' : '<p class="meta">移除只影响这张卡片，卡片组的共用仓库和其他卡片不变。</p>') : '<p class="ar-empty">' + (ro ? '没有仓库。' : '这张卡片还没有仓库。点「新增仓库」，可以一键带上卡片组的共用仓库。') + '</p>'
    const tasks = c.tasks.map((t, k) => '<div class="task' + (t.done ? ' done' : '') + '"><label><input type="checkbox"' + (ro ? ' disabled' : ' data-task="' + k + '"') + (t.done ? ' checked' : '') + '><span>' + esc(t.text) + '</span></label>' + (ro ? '' : '<button type="button" class="ib sm" data-task-del="' + k + '" aria-label="删除子任务 ' + esc(t.text) + '">' + ic('x') + '</button>') + '</div>').join('')
    const sess = this.linkedHtml(c, ro)
    return '<aside class="detail' + (ro ? ' ro' : '') + '" data-card="' + esc(c.id) + '" aria-labelledby="dpmDT"><div class="d-h"><div class="grow" style="white-space:normal"><h2 id="dpmDT">' + esc(c.t) + '</h2><div class="sub">' + esc(g.name) + ' · ' + esc(sts[i]?.name ?? '') + '</div></div>'
      + (ro ? '' : '<button type="button" class="ib" data-rename-card aria-label="重命名卡片">' + ic('pencil') + '</button><button type="button" class="ib tipbtn" data-archive-card="' + esc(c.id) + '" aria-label="归档这张卡片">' + ic('archive') + '<span class="tip" aria-hidden="true">归档卡片</span></button>')
      + '<button type="button" class="ib" data-close aria-label="关闭详情">' + ic('x') + '</button></div>'
      + (ro ? '<div class="arch-bar"><span class="txt"><b>已归档</b> · ' + esc(daysAgo(c.archivedAt)) + '，只能查看</span><button type="button" class="btn sm" data-unarchive-card="' + esc(c.id) + '">' + ic('unarchive') + '恢复活跃</button></div>' : '')
      + '<div class="d-b">'
      + '<section class="sec"><h3>' + ic('play') + '本卡片的会话 · ' + this.sessionsOf(c.id).length + '<span class="grow"></span>' + (ro ? '' : '<button type="button" class="btn ghost sm" data-link-sess>' + ic('link') + '关联已有会话</button>') + '</h3>' + sess + '</section>'
      + '<section class="sec"><h3>' + ic('mem') + '关联的落盘项目 · ' + mem.length + '<span class="grow"></span>' + memTg + (ro ? '' : '<button type="button" class="btn ghost sm" data-link-card>' + ic('plus') + '关联</button>') + '</h3>' + (ro ? '' : '<p class="meta mb">会话会自动读取下面这些落盘项目的记忆。来自卡片组的在「卡片组设置」里改。</p>') + memBody + (ro ? '' : this.memActHtml(c, mem.length)) + '</section>'
      + this.notesHtml(c, ro) + this.webLinksHtml(c, ro) + this.filesHtml(c, ro)
      + '<section class="sec"><h3>阶段</h3><div class="steps">' + steps + '</div>' + (ro ? '' : nx ? '<button type="button" class="btn primary lg" data-next>推进到 ' + esc(nx.name) + ic('arrow') + '</button>' : '<p class="meta">已在最后一个阶段</p>') + '</section>'
      + '<section class="sec"><h3>子任务 ' + c.tasks.filter((t) => t.done).length + '/' + c.tasks.length + '</h3>' + tasks
      + (ro ? (c.tasks.length ? '' : '<p class="meta">没有子任务。</p>') : '<form class="addtask" data-addtask><label class="sr-only" for="dpmNewTask">新子任务</label><input id="dpmNewTask" placeholder="添加子任务，回车确认" autocomplete="off"><button class="btn" type="submit">添加</button></form>') + '</section>'
      + '<section class="sec"><h3>' + ic('repo') + '仓库 · ' + crs.length + '<span class="grow"></span>' + (ro ? '' : '<button type="button" class="btn ghost sm" data-card-repo-add>' + ic('plus') + '新增仓库</button>') + '</h3>' + repoBody + '</section>'
      + (ro ? '</div></aside>' : '<section class="sec"><button type="button" class="btn ghost danger" data-remove-card>' + ic('trash') + '删除这张卡片</button></section></div>'
      + '<div class="d-f"><div class="note"><span class="chip warn">' + ic('shield') + '完全权限</span><span class="chip mem">' + ic('mem') + '自动读取 ' + mem.length + ' 个落盘项目' + (hasMaterials(c) ? ' + 卡片资料' : '') + '</span></div>'
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
      const nm = this.memOf(c).length
      const sub = [this.st(g, c.col)?.name ?? '', daysAgo(c.archivedAt) + '归档', ns ? ns + ' 个会话' : '', nm ? nm + ' 个落盘项目' : ''].filter(Boolean).join(' · ')
      return '<div class="arow" role="button" tabindex="0" data-card="' + esc(c.id) + '" aria-current="' + (this.sel === c.id) + '" aria-label="查看「' + esc(c.t) + '」（已归档，只读）">'
        + '<span class="txt"><span class="nm">' + esc(c.t) + '</span><span class="sub">' + esc(sub) + '</span></span>'
        + '<button type="button" class="ib rst tipbtn" data-unarchive-card="' + esc(c.id) + '" aria-label="恢复活跃「' + esc(c.t) + '」">' + ic('unarchive') + '<span class="tip" aria-hidden="true">恢复活跃</span></button></div>'
    }).join('') || '<p class="atray-empty">还没有已归档的卡片。点卡片右上角的归档按钮，或把卡片拖到这里。</p>'
    return '<div class="atray" id="dpmTray-' + esc(g.id) + '" data-tray-g="' + esc(g.id) + '" role="region" aria-label="「' + esc(g.name) + '」的已归档卡片"><div class="atray-h">已归档 ' + ar.length + '<span class="grow"></span><button type="button" class="ib sm" data-tray="' + esc(g.id) + '" aria-label="收起已归档卡片">' + ic('x') + '</button></div>'
      + '<div class="atray-l"><div class="atray-drop" aria-hidden="true">松开即归档</div>' + rows + '</div></div>'
  }

  /** 归档卡片：卡片淡出后再提交；提示里可撤销。会话不动。 */
  private async archiveCard(id: string): Promise<void> {
    const c = this.card(id)
    if (!c || c.archivedAt) return
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
    try { return this.cards.map((c) => { const b = this.badgeOf(c.id); return b ? b.n + ':' + b.live : '-' }).join(',') } finally { this.idxCache = null }
  }
  /** 0.20 卡片组标题旁统计：卡片数（蓝底，0 张变灰）+ 活跃会话数（本组卡片关联、没归档的会话，实时）+ 仓库 / 阶段（灰色小字）。 */
  private liveLast = new Map<string, number>()
  private statHtml(g: Group, cs: Card[]): string {
    const idx = this.sessIndex()
    let live = 0
    for (const c of this.cards.filter((x) => x.g === g.id && !x.archivedAt)) live += this.badgeOfIdx(c.id, idx)?.live ?? 0
    const prev = this.liveLast.get(g.id)
    this.liveLast.set(g.id, live)
    const bump = prev !== undefined && prev !== live
    const n = cs.length
    return '<span class="gstat"><span class="cnt cards' + (n ? '' : ' zero') + '" title="' + (n ? n + ' 张卡片（不含已归档）' : '还没有卡片') + '"><b>' + n + '</b>张卡片</span>'
      + '<span class="cnt live' + (live ? '' : ' zero') + (bump ? ' bump' : '') + '" title="' + (live ? '本组卡片关联的会话里，没归档的有 ' + live + ' 个（实时）' : '本组卡片没有活跃会话') + '"><i aria-hidden="true"></i><b>' + live + '</b><span class="lb">活跃会话</span></span>'
      + '<span class="quiet">' + g.repos.length + ' 个仓库 · ' + g.statuses.length + ' 个阶段</span></span>'
  }
  private badgeOfIdx(cardId: string, idx: ReadonlyMap<string, SessionView>): { n: number; live: number } | null { return sessBadge((this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId), idx) }
  /** 0.20「以此卡片新建会话」：点了立刻进入忙态（锁按钮），建好或失败后恢复。 */
  creating: string | null = null
  setCreating(cardId: string | null): void { this.creating = cardId; this.renderDetail() }

  /** 相关说明：没保存过 = 输入框；保存过 = 只读展示（网址可点）+ 编辑按钮。 */
  private notesHtml(c: Card, ro = false): string {
    const saved = c.notes ?? ''
    if (ro) return '<section class="sec"><h3>' + ic('note') + '相关说明</h3>' + (saved ? this.noteView(c, saved) : '<p class="meta">没有填写说明。</p>') + '</section>'
    const ed = this.noteEdit && this.noteEdit.card === c.id ? this.noteEdit : null
    const editing = !saved || !!ed
    const head = '<h3>' + ic('note') + '相关说明<span class="grow"></span>' + (editing ? '' : '<button type="button" class="btn ghost sm" data-note-edit>' + ic('pencil') + '编辑</button>') + '</h3>'
    if (!editing) return '<section class="sec">' + head + this.noteView(c, saved) + '</section>'
    const draft = ed ? ed.draft : saved
    const dirty = draft !== saved
    return '<section class="sec">' + head + '<label class="sr-only" for="dpmNoteIn">相关说明</label>'
      + '<textarea class="note-in" id="dpmNoteIn" placeholder="写下和这个项目相关的任何说明：背景、约定、网址链接……不限字数">' + esc(draft) + '</textarea>'
      + '<div class="note-bar"><span class="meta" id="dpmNoteN">' + draft.length + ' 字' + (saved ? ' · 编辑中' : '') + '</span><span class="grow"></span>'
      + '<button type="button" class="btn sm" data-note-clear' + (draft ? '' : ' hidden') + ' title="清空输入框（还没保存；按 ⌘Z 可以撤回）">清空</button>'
      + '<button type="button" class="btn primary sm" data-note-save' + (dirty ? '' : ' disabled') + '>保存</button></div></section>'
  }
  private noteView(c: Card, saved: string): string {
    const open = this.noteOpen.has(c.id)
    return '<div class="note-wrap" data-nwrap="' + esc(c.id) + '"><div class="note-view">' + linkify(saved) + '</div>'
      + '<button type="button" class="btn ghost sm note-more" data-note-more="' + esc(c.id) + '" aria-expanded="' + open + '" hidden>' + (open ? '收起' : '展开全部') + ic('chev') + '</button></div>'
  }

  /** 0.10 相关链接：完整列表（不折叠）；一行 = 拖动手柄 + 显示文字（点开 = 默认浏览器）+ 类型 + 编辑 / 删除。 */
  private webLinksHtml(c: Card, ro = false): string {
    const ls = c.webLinks ?? []
    const rows = ls.map((l, k) => '<div class="wl" data-wl="' + k + '">'
      + (ro ? '' : '<button type="button" class="wgrip" data-wdrag="' + k + '" aria-label="拖动调整「' + esc(l.text) + '」的位置（键盘 Alt+上下方向键）">' + ic('grip') + '</button>')
      + '<a class="wl-a' + (ro ? ' ro' : '') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(l.url) + '">' + ic('ext') + '<span class="t mq">' + esc(l.text) + '</span></a>'
      + '<span class="chip plain">' + esc(l.type) + '</span>'
      + '<button type="button" class="ib sm cp tipbtn" data-copy-url="' + esc(l.url) + '" aria-label="复制链接 ' + esc(l.text) + '">' + COPY_SVG + CHECK_SVG + '<span class="tip" aria-hidden="true">复制链接</span></button>'
      + (ro ? '' : '<span class="acts"><button type="button" class="ib sm tipbtn" data-wl-edit="' + k + '" aria-label="编辑 ' + esc(l.text) + '">' + ic('pencil') + '<span class="tip" aria-hidden="true">编辑</span></button>'
        + '<button type="button" class="ib sm del tipbtn" data-wl-del="' + k + '" aria-label="删除 ' + esc(l.text) + '">' + ic('trash') + '<span class="tip" aria-hidden="true">删除</span></button></span>')
      + '</div>').join('')
    const body = ls.length ? '<div class="wl-list">' + rows + '</div>' : '<p class="meta">' + (ro ? '没有相关链接。' : '还没有相关链接。点「添加链接」可以一次加多条。') + '</p>'
    return '<section class="sec"><h3>' + ic('link') + '相关链接 · ' + ls.length + '<span class="grow"></span>' + (ro ? '' : '<span class="h3-acts"><button type="button" class="btn ghost sm" data-types>' + ic('sliders') + '管理类型</button><button type="button" class="btn ghost sm" data-wl-add>' + ic('plus') + '添加链接</button></span>') + '</h3>' + body + '</section>'
  }
  private get linkTypes(): string[] { return this.snap?.board.linkTypes ?? ['文档', '代码'] }
  private blankRow(type?: string): WlRow { return { text: '', type: type ?? this.linkTypes[0], url: '', err: '' } }
  private wlOpen(c: Card, mode: 'add' | 'edit', idx = -1): void {
    const l = mode === 'edit' ? (c.webLinks ?? [])[idx] : undefined
    if (mode === 'edit' && !l) return
    this.wl = { card: c.id, mode, idx, rows: [l ? { ...l, err: '' } : this.blankRow()] }
    this.$('#dpmWlT').textContent = mode === 'edit' ? '编辑链接' : '添加相关链接'
    this.$('#dpmWlP').textContent = mode === 'edit' ? '改完点保存。' : '可以一次加多条；在「完整链接」里粘贴多行网址会自动拆成多条。'
    this.$('#dpmWlMore').hidden = mode === 'edit'
    this.wlRender()
    const d = this.$<HTMLDialogElement>('#dpmDlgWl')
    d.returnValue = ''
    if (!d.open) d.showModal()
    ;(this.root.querySelector('#dpmWlRows [data-wurl]') as HTMLElement | null)?.focus()
  }
  /** 类型下拉：只能选已有类型（0.13 起新增 / 改名统一走「管理类型」）。 */
  private wlTypeCtl(r: WlRow, i: number): string {
    const ts = this.linkTypes.includes(r.type) ? this.linkTypes : [...this.linkTypes, r.type]
    return '<select class="fld" id="dpmWt' + i + '" data-wtype="' + i + '">' + ts.map((t) => '<option' + (t === r.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>'
  }
  private wlRender(): void {
    const w = this.wl
    if (!w) return
    const rows = w.rows
    this.$('#dpmWlRows').innerHTML = rows.map((r, i) => '<div class="wl-row">'
      + (rows.length > 1 ? '<div class="wl-row-h">第 ' + (i + 1) + ' 条<span class="grow"></span><button type="button" class="ib sm" data-wl-rm="' + i + '" aria-label="移除第 ' + (i + 1) + ' 条">' + ic('x') + '</button></div>' : '')
      + '<div class="wl-grid"><div><label class="lbl" for="dpmWx' + i + '">显示文字</label><input class="fld" id="dpmWx' + i + '" data-wtext="' + i + '" value="' + esc(r.text) + '" placeholder="不填就用网址" maxlength="120" autocomplete="off"></div>'
      + '<div><label class="lbl" for="dpmWt' + i + '">类型</label>' + this.wlTypeCtl(r, i) + '</div>'
      + '<div class="full"><label class="lbl" for="dpmWu' + i + '">完整链接</label><input class="fld' + (r.err ? ' bad' : '') + '" id="dpmWu' + i + '" data-wurl="' + i + '" value="' + esc(r.url) + '" placeholder="https://…" autocomplete="off" inputmode="url"' + (r.err ? ' aria-invalid="true" aria-describedby="dpmWe' + i + '"' : '') + '>'
      + (r.err ? '<p class="wl-err" id="dpmWe' + i + '">' + esc(r.err) + '</p>' : '') + '<div class="wl-dup-slot" id="dpmWd' + i + '" aria-live="polite"></div></div></div></div>').join('')
    this.$('#dpmWlCount').textContent = w.mode === 'add' && rows.length > 1 ? '共 ' + rows.length + ' 条，空行不保存' : ''
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
        ? '<div class="wl-dup" role="alert"><p class="h">这张卡片已经添加过这个链接了，不能重复保存</p><dl><dt>显示文字</dt><dd>' + esc(l.text) + '</dd><dt>类型</dt><dd>' + esc(l.type) + '</dd><dt>完整链接</dt><dd>' + esc(l.url) + '</dd></dl>'
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
  /** 0.13「管理类型」：列出全局类型（附在用条数），新增 / 改名；保存即全局生效（改名连带所有卡片的链接）。 */
  private ty: { edit: number; err: string; addErr: string } | null = null
  private typeUse(t: string): number { let n = 0; for (const c of this.cards) for (const l of c.webLinks ?? []) if (l.type === t) n++; return n }
  private typesOpen(): void {
    this.ty = { edit: -1, err: '', addErr: '' }
    this.typesRender()
    const d = this.$<HTMLDialogElement>('#dpmDlgTy')
    d.returnValue = ''
    d.showModal()
    ;(this.root.querySelector('#dpmTyNew') as HTMLElement | null)?.focus()
  }
  private typesRender(focus?: string): void {
    const y = this.ty
    if (!y) return
    const keep = (this.root.querySelector('#dpmTyNew') as HTMLInputElement | null)?.value ?? ''
    this.$('#dpmTyList').innerHTML = this.linkTypes.map((t, i) => {
      if (y.edit === i) return '<li class="ty-row editing"><label class="sr-only" for="dpmTyEd">类型名称</label><input class="fld' + (y.err ? ' bad' : '') + '" id="dpmTyEd" value="' + esc(t) + '" maxlength="20" autocomplete="off"' + (y.err ? ' aria-invalid="true" aria-describedby="dpmTyEdE"' : '') + '>'
        + '<button type="button" class="btn sm" data-ty-cancel>取消</button><button type="button" class="btn sm primary" data-ty-save="' + i + '">保存</button></li>' + (y.err ? '<li class="wl-err" id="dpmTyEdE">' + esc(y.err) + '</li>' : '')
      const n = this.typeUse(t)
      return '<li class="ty-row" data-ty="' + i + '"><button type="button" class="ib sm ty-grip" data-tygrip="' + i + '" aria-label="调整「' + esc(t) + '」的顺序：按住拖动，或 Alt+上下方向键">' + ic('grip') + '</button><span class="nm">' + esc(t) + '</span><span class="use">' + (n ? n + ' 条链接在用' : '没有链接在用') + '</span><button type="button" class="ib sm" data-ty-edit="' + i + '" aria-label="改名 ' + esc(t) + '">' + ic('pencil') + '</button></li>'
    }).join('') + '<li class="drop-line" id="dpmTyDrop" aria-hidden="true" hidden></li>'
    const inp = this.$<HTMLInputElement>('#dpmTyNew')
    inp.value = keep
    inp.classList.toggle('bad', !!y.addErr)
    if (y.addErr) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', 'dpmTyNewE') } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby') }
    const e = this.$('#dpmTyNewE')
    e.textContent = y.addErr
    e.hidden = !y.addErr
    if (focus) { const f = this.root.querySelector(focus) as HTMLInputElement | null; f?.focus(); if (f && focus === '#dpmTyEd') f.select() }
  }
  /** 前端先查一遍（空 / 超长 / 重名），服务端同样校验。 */
  private typeErr(v: string, skip: number): string {
    if (!v) return '类型名不能为空'
    if (v.length > 20) return '类型名不能超过 20 字'
    if (this.linkTypes.some((t, i) => t === v && i !== skip)) return '已经有「' + v + '」了'
    return ''
  }
  private async typeAdd(): Promise<void> {
    const y = this.ty
    if (!y) return
    const inp = this.$<HTMLInputElement>('#dpmTyNew')
    const v = inp.value.replace(/\s+/g, ' ').trim()
    y.addErr = this.typeErr(v, -1)
    if (y.addErr) { this.typesRender('#dpmTyNew'); return }
    try {
      const r = await post<Snapshot & { result: string }>('linktype/add', { name: v })
      if (this.disposed) return
      this.snap = r
      inp.value = ''
      this.render()
      this.typesRender('#dpmTyNew')
      this.host.toast('已新增类型「' + r.result + '」，所有卡片都能选')
    } catch (e) { y.addErr = e instanceof ApiError ? e.message : String(e); this.typesRender('#dpmTyNew') }
  }
  private async typeSave(i: number): Promise<void> {
    const y = this.ty
    const from = this.linkTypes[i]
    if (!y || from === undefined) return
    const v = (this.$<HTMLInputElement>('#dpmTyEd')?.value ?? '').replace(/\s+/g, ' ').trim()
    if (v === from) { y.edit = -1; y.err = ''; this.typesRender(); return }
    y.err = this.typeErr(v, i)
    if (y.err) { this.typesRender('#dpmTyEd'); return }
    try {
      const r = await post<Snapshot & { result: { name: string; links: number } }>('linktype/rename', { from, to: v })
      if (this.disposed) return
      this.snap = r
      y.edit = -1
      y.err = ''
      this.render()
      this.typesRender()
      ;(this.root.querySelector('[data-ty-edit="' + i + '"]') as HTMLElement | null)?.focus()
      this.host.toast('「' + from + '」已改名为「' + r.result.name + '」' + (r.result.links ? '，' + r.result.links + ' 条链接一起更新' : ''))
    } catch (e) { y.err = e instanceof ApiError ? e.message : String(e); this.typesRender('#dpmTyEd') }
  }
  /** 0.14 类型排序：拖把手（指针）或 Alt+↑↓；落点 = 两项之间空隙里的独立指示线。 */
  private td: { i: number; y0: number; on: boolean; to: number } | null = null
  private tdDown(e: PointerEvent): boolean {
    const h = (e.target as HTMLElement).closest?.('[data-tygrip]') as HTMLElement | null
    if (!h || e.button !== 0 || !this.ty || this.ty.edit >= 0) return false
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    this.td = { i: Number(h.dataset.tygrip), y0: e.clientY, on: false, to: -1 }
    return true
  }
  private tdMove(e: PointerEvent): void {
    const td = this.td
    if (!td) return
    const rows = Array.from(this.root.querySelectorAll<HTMLElement>('#dpmTyList [data-ty]'))
    if (!td.on) {
      if (Math.abs(e.clientY - td.y0) < 4) return
      td.on = true
      this.root.classList.add('wdragging')
      rows[td.i]?.classList.add('lifting')
    }
    let at = rows.length
    for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { at = k; break } }
    const line = this.root.querySelector('#dpmTyDrop') as HTMLElement | null
    // 拖回原位（原位置前后）不显示指示线
    if (at === td.i || at === td.i + 1 || !rows.length || !line) { td.to = -1; if (line) line.hidden = true; return }
    td.to = at
    const gap = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop - rows[0].offsetHeight : 6
    const y = at < rows.length ? rows[at].offsetTop - gap / 2 : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight + gap / 2
    line.style.top = y + 'px'
    line.hidden = false
  }
  private tdStop(commit: boolean): boolean {
    const td = this.td
    if (!td) return false
    this.td = null
    this.root.classList.remove('wdragging')
    this.root.querySelectorAll('#dpmTyList .lifting').forEach((n) => n.classList.remove('lifting'))
    const line = this.root.querySelector('#dpmTyDrop') as HTMLElement | null
    if (line) line.hidden = true
    if (commit && td.on && td.to >= 0) void this.typeMove(td.i, td.to > td.i ? td.to - 1 : td.to)
    return true
  }
  private async typeMove(i: number, to: number): Promise<void> {
    const name = this.linkTypes[i]
    if (name === undefined || to < 0 || to >= this.linkTypes.length || to === i) return
    try {
      const r = await post<Snapshot>('linktype/move', { name, to })
      if (this.disposed) return
      this.snap = r
      this.render()
      this.typesRender()
      const row = this.root.querySelector('#dpmTyList [data-ty="' + to + '"]') as HTMLElement | null
      if (row) { row.classList.add('landed'); setTimeout(() => row.classList.remove('landed'), 450) }
      ;(this.root.querySelector('[data-tygrip="' + to + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
      this.host.toast('「' + name + '」移到第 ' + (to + 1) + ' 位')
    } catch (e) { this.host.toast('调整顺序失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
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
    const items: WebLink[] = rows.map((r) => ({ text: r.text.trim(), type: r.type, url: r.url }))
    const cur = (c.webLinks ?? []).slice()
    if (w.mode === 'edit') cur[w.idx] = items[0]
    else cur.push(...items)
    if (!(await this.act('card/weblinks', { id: c.id, links: cur }, w.mode === 'edit' ? '已保存链接' : '已添加 ' + items.length + ' 条相关链接'))) return
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
    const rows = Array.from(this.root.querySelectorAll<HTMLElement>('.detail [data-wl]'))
    let to = rows.length
    for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { to = k; break } }
    this.root.querySelectorAll('.wins-before, .wins-after').forEach((n) => n.classList.remove('wins-before', 'wins-after'))
    wd.to = to === wd.i || to === wd.i + 1 ? undefined : to
    if (wd.to !== undefined) (to < rows.length ? rows[to] : rows[rows.length - 1]).classList.add(to < rows.length ? 'wins-before' : 'wins-after')
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

  private syncNoteBar(c: Card, v: string): void {
    const dirty = v !== (c.notes ?? '')
    const s = this.root.querySelector('[data-note-save]') as HTMLButtonElement | null
    const n = this.root.querySelector('#dpmNoteN')
    if (s) s.disabled = !dirty
    const x = this.root.querySelector('[data-note-clear]') as HTMLButtonElement | null
    if (x) x.hidden = v === ''
    if (n) n.textContent = v.length + ' 字' + (c.notes ? ' · 编辑中' : '')
  }

  /** 相关文件：完整路径 + 存在/已删除 + 解除关联图标（只移出列表，不删文件）。 */
  private filesHtml(c: Card, ro = false): string {
    const fs = c.files ?? []
    const st = this.snap?.files ?? {}
    const rows = fs.map((p) => {
      const ok = st[p] !== false
      return '<div class="frow-f' + (ok ? '' : ' gone') + '">' + ic(ok ? 'file' : 'filex') + '<div class="txt"><div class="nm mq">' + esc(folderName(p)) + '</div><span class="mono mq">' + esc(p) + '</span>'
        + (ok ? '<span class="chip ok">存在</span>' : '<span class="chip warn">已删除</span>') + '</div>'
        + (ro ? '' : '<button type="button" class="ib sm unl tipbtn" data-file-unlink="' + esc(p) + '" aria-label="解除关联 ' + esc(p) + '">' + ic('unlink') + '<span class="tip" aria-hidden="true">解除关联</span></button>') + '</div>'
    }).join('') || '<p class="meta">' + (ro ? '没有相关文件。' : '还没有相关文件。点「选择文件」从系统里选（可多选），或「粘贴路径」。') + '</p>'
    if (ro) return '<section class="sec"><h3>' + ic('file') + '相关文件 · ' + fs.length + '</h3>' + rows + '</section>'
    const fp = this.fp && this.fp.card === c.id ? this.fp : null
    const paste = fp ? '<div class="fp" id="dpmFp"><label for="dpmFpIn">文件的绝对路径（可一次粘贴多行）</label>'
      + '<textarea id="dpmFpIn" spellcheck="false" autocomplete="off" aria-describedby="dpmFpChk" placeholder="~/Desktop/方案.md&#10;/srv/demo/日志.zip">' + esc(fp.text) + '</textarea>'
      + '<ul class="fp-chk" id="dpmFpChk" aria-live="polite">' + this.fpChkHtml(fp) + '</ul>'
      + '<div class="fp-bar"><span class="meta" id="dpmFpSum">' + this.fpSum(fp) + '</span><span class="grow"></span><button type="button" class="btn sm" data-fp-cancel>取消</button><button type="button" class="btn primary sm" data-fp-ok' + (fp.res.some((r) => r.status === 'ok') ? '' : ' disabled') + '>' + this.fpOkText(fp) + '</button></div></div>' : ''
    return '<section class="sec"><h3>' + ic('file') + '相关文件 · ' + fs.length + '<span class="grow"></span><span class="fseg" role="group" aria-label="添加文件的方式">'
      + '<button type="button" class="btn ghost sm" data-file-add' + (this.filePicking ? ' disabled' : '') + '>' + ic('plus') + (this.filePicking ? '选择中…' : '选择文件') + '</button>'
      + '<button type="button" class="btn ghost sm" data-fp-open aria-expanded="' + !!fp + '" aria-controls="dpmFp">' + ic('clip') + '粘贴路径</button></span></h3>' + rows + paste + '</section>'
  }
  // ── 0.15 粘贴路径：逐行规整 + 存在性检测（宿主 stat），只添加通过的；有问题的行留在输入框 ──
  private fpChkHtml(fp: NonNullable<BoardView['fp']>): string {
    return fp.res.map((r) => '<li class="' + fpKind(r.status) + '">' + ic(FP_ICON[r.status]) + '<span class="p">' + esc(r.status === 'bad' ? r.raw : r.path) + '</span><span class="why">' + FP_WHY[r.status] + '</span></li>').join('')
  }
  private fpSum(fp: NonNullable<BoardView['fp']>): string {
    if (!fp.res.length) return fp.text.trim() ? '检测中…' : ''
    const n = fp.res.filter((r) => r.status === 'ok').length
    const bad = fp.res.filter((r) => fpKind(r.status) === 'bad').length
    return n + ' 个可添加' + (bad ? '，' + bad + ' 个有问题' : '')
  }
  private fpOkText(fp: NonNullable<BoardView['fp']>): string { const n = fp.res.filter((r) => r.status === 'ok').length; return n ? '添加 ' + n + ' 个' : '添加' }
  /** 只更新检测结果区（不重绘详情，输入框光标不动）。 */
  private fpPaint(): void {
    const fp = this.fp
    const box = this.root.querySelector('#dpmFp')
    if (!fp || !box) return
    this.$('#dpmFpChk').innerHTML = this.fpChkHtml(fp)
    this.$('#dpmFpSum').textContent = this.fpSum(fp)
    const ok = this.$<HTMLButtonElement>('[data-fp-ok]')
    ok.disabled = !fp.res.some((r) => r.status === 'ok')
    ok.textContent = this.fpOkText(fp)
    this.lastDetail = ''
  }
  private async fpCheck(): Promise<void> {
    const fp = this.fp
    if (!fp) return
    const lines = fp.text.split(/\r?\n/).filter((l) => l.trim())
    const seq = ++fp.seq
    if (!lines.length) { fp.res = []; this.fpPaint(); return }
    try {
      const r = await post<{ results: PathCheck[] }>('card/files-check', { id: fp.card, paths: lines })
      if (this.fp !== fp || fp.seq !== seq) return
      fp.res = r.results
    } catch (e) {
      if (this.fp !== fp || fp.seq !== seq) return
      fp.res = []
      this.host.toast('检测路径失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
    }
    this.fpPaint()
  }
  private fpOpen(c: Card, on: boolean): void {
    this.fp = on ? { card: c.id, text: '', res: [], seq: 0 } : null
    // 输入框聚焦时 renderDetail 不原地替换（防丢光标）→ 主动结构变化前先失焦
    if (document.activeElement?.id === 'dpmFpIn') (document.activeElement as HTMLElement).blur()
    this.lastDetail = ''
    this.renderDetail()
    if (on) (this.root.querySelector('#dpmFpIn') as HTMLElement | null)?.focus()
    else (this.root.querySelector('[data-fp-open]') as HTMLElement | null)?.focus()
  }
  private async fpAdd(c: Card): Promise<void> {
    const fp = this.fp
    if (!fp) return
    const add = fp.res.filter((r) => r.status === 'ok').map((r) => r.path)
    if (!add.length) return
    const left = fp.res.filter((r) => fpKind(r.status) === 'bad').map((r) => r.raw)
    const ok = await this.act('card/files-add', { id: c.id, paths: add }, '已添加 ' + add.length + ' 个相关文件' + (left.length ? '，有问题的 ' + left.length + ' 行留在输入框里' : ''))
    if (!ok || this.fp !== fp) return
    if (!left.length) return this.fpOpen(c, false)
    fp.text = left.join('\n')
    fp.res = []
    if (document.activeElement?.id === 'dpmFpIn') (document.activeElement as HTMLElement).blur()
    this.lastDetail = ''
    this.renderDetail()
    const i = this.root.querySelector('#dpmFpIn') as HTMLTextAreaElement | null
    i?.focus()
    void this.fpCheck()
  }

  private async pickFiles(c: Card): Promise<void> {
    if (this.filePicking) return
    this.filePicking = true
    this.renderDetail()
    try {
      const r = await post<Snapshot & { result: { cancelled: boolean; added: number; skipped: number } }>('card/files-pick', { id: c.id })
      if (this.disposed) return
      this.snap = r
      this.filePicking = false
      this.render()
      if (!r.result.cancelled) this.host.toast(r.result.added ? '已添加 ' + r.result.added + ' 个相关文件' + (r.result.skipped ? '，' + r.result.skipped + ' 个已关联过' : '') : '选的文件都已关联过')
    } catch (e) {
      this.filePicking = false
      // 打不开系统对话框（非 macOS / osascript 失败）→ 打开「粘贴路径」，原因点名
      this.render()
      console.warn('[dsh-project-manager] card/files-pick 失败，改为粘贴路径：', e)
      this.host.toast((e instanceof ApiError ? e.message : String(e)) + '。可以直接粘贴文件的绝对路径', 'err')
      this.fpOpen(c, true)
    }
  }

  // ── 事件 ──
  private on<K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void): void {
    el.addEventListener(type, fn as EventListener)
    this.disposers.push(() => el.removeEventListener(type, fn as EventListener))
  }
  private $<T extends HTMLElement = HTMLElement>(sel: string): T { return this.root.querySelector(sel) as T }

  private bind(): void {
    const r = this.root
    this.on(r, 'click', (e) => void this.onClick(e))
    this.on(r, 'input', (e) => this.onInput(e))
    this.on(r, 'compositionstart', () => { this.composing = true })
    this.on(r, 'compositionend', (e) => { this.composing = false; this.onInput(e) })
    this.on(r, 'focusout', (e) => this.onFocusOut(e))
    this.on(r, 'change', (e) => void this.onChange(e))
    this.on(r, 'submit', (e) => void this.onSubmit(e))
    this.on(r, 'keydown', (e) => void this.onKey(e))
    this.on(r, 'dragstart', (e) => this.onDragStart(e))
    this.on(r, 'dragover', (e) => this.onDragOver(e))
    this.on(r, 'dragend', () => this.clearDrag())
    this.on(r, 'drop', (e) => void this.onDrop(e))
    this.on(r, 'pointerdown', (e) => { if (!this.tdDown(e) && !this.wdDown(e)) this.gdDown(e) })
    this.on(r, 'pointermove', (e) => { if (this.td) this.tdMove(e); else if (this.wd) this.wdMove(e); else this.gdMove(e) })
    this.on(r, 'pointerup', () => { if (!this.tdStop(true) && !this.wdStop(true)) this.gdStop(true) })
    this.on(r, 'pointercancel', () => { if (!this.tdStop(false) && !this.wdStop(false)) this.gdStop(false) })
    this.on(r, 'lostpointercapture', () => { if (!this.tdStop(false) && !this.wdStop(false)) this.gdStop(false) })
    this.on(r, 'paste', (e) => this.onPaste(e))
    // 0.15 候选仓库：吸顶标题 + 分组切换高亮（scroll 不冒泡，挂在列表上）
    this.on(this.$('#dpmArList'), 'scroll', () => { if (!this.arStickRaf) this.arStickRaf = requestAnimationFrame(() => { this.arStickRaf = 0; this.arStick() }) })
    for (const id of ['dpmDlgSt', 'dpmDlgName', 'dpmDlgLink', 'dpmDlgImp', 'dpmDlgRepo', 'dpmDlgSess', 'dpmDlgCfm', 'dpmDlgSArc', 'dpmDlgWl', 'dpmDlgTy']) {
      const d = this.$<HTMLDialogElement>('#' + id)
      this.on(d, 'close', () => void this.onDialogClose(id, d))
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const t = (e.target as HTMLElement).closest('button, [role="button"]') as HTMLElement | null
    const area = (e.target as HTMLElement).closest('[data-toggle-area]') as HTMLElement | null
    if (area && (!t || !area.contains(t))) return this.toggleGroup(area.dataset.toggleArea as string)
    if (!t || !this.root.contains(t)) return
    const d = t.dataset
    const c = this.sel ? this.card(this.sel) : undefined
    if (d.dlgCancel !== undefined) { (t.closest('dialog') as HTMLDialogElement | null)?.close('cancel'); return }
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
    if (d.memToggle !== undefined) {
      this.memOpen = !this.memOpen
      this.renderDetail()
      ;(this.root.querySelector('[data-mem-toggle]') as HTMLElement | null)?.focus({ preventScroll: true })
      return
    }
    if (d.wlAdd !== undefined && c) return this.wlOpen(c, 'add')
    if (d.types !== undefined) return this.typesOpen()
    if (d.tyEdit !== undefined && this.ty) { this.ty.edit = Number(d.tyEdit); this.ty.err = ''; this.typesRender('#dpmTyEd'); return }
    if (d.tyCancel !== undefined && this.ty) { const i = this.ty.edit; this.ty.edit = -1; this.ty.err = ''; this.typesRender(); (this.root.querySelector('[data-ty-edit="' + i + '"]') as HTMLElement | null)?.focus(); return }
    if (d.tySave !== undefined) return this.typeSave(Number(d.tySave))
    if (d.tyAdd !== undefined) return this.typeAdd()
    if (d.delSess) { const v = this.sessIndex().get(d.delSess); if (v) await this.host.deleteSession(v.id, v.title); return }
    if (d.wlEdit !== undefined && c) return this.wlOpen(c, 'edit', Number(d.wlEdit))
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
      this.host.toast('已复制链接：' + url)
      return
    }
    if (d.card) { if (this.sel !== d.card) { this.noteEdit = null; this.fp = null } this.sel = d.card; this.render(); (this.root.querySelector('[data-card="' + d.card + '"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return }
    if (d.close !== undefined) { this.sel = null; this.noteEdit = null; this.fp = null; return this.render() }
    if (d.themeToggle !== undefined) { this.host.setDark(!this.host.isDark()); return }
    if (d.toggle) return this.toggleGroup(d.toggle)
    if (d.gdrag) return
    if (d.newIn) return this.host.pickCard(t, d.newIn)
    if (d.openCard !== undefined && c) { if (this.creating) return; return this.host.newSession(c.id) }
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
    if (d.noteEdit !== undefined && c) { this.noteEdit = { card: c.id, draft: c.notes ?? '' }; this.renderDetail(); const i = this.root.querySelector('#dpmNoteIn') as HTMLTextAreaElement | null; if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length) } return }
    // 输入不触发重绘 → lastDetail 仍是输入前的 HTML，重置后可能「看起来没变」而被跳过，先作废缓存
    if (d.noteClear !== undefined && c) {
      const i = this.root.querySelector('#dpmNoteIn') as HTMLTextAreaElement | null
      if (!i) return
      // 用编辑命令清空：浏览器的撤销栈里有这一步，⌘Z 可以撤回
      i.focus(); i.select()
      if (!document.execCommand('delete')) i.value = ''
      this.noteEdit = { card: c.id, draft: '' }
      this.syncNoteBar(c, '')
      i.focus()
      return
    }
    if (d.noteSave !== undefined && c) {
      const v = this.noteEdit && this.noteEdit.card === c.id ? this.noteEdit.draft : (this.root.querySelector('#dpmNoteIn') as HTMLTextAreaElement | null)?.value ?? ''
      const prev = this.noteEdit
      this.noteEdit = null
      if (!(await this.act('card/notes', { id: c.id, notes: v }, v.trim() ? '相关说明已保存' : '已清空相关说明'))) { this.noteEdit = prev ?? { card: c.id, draft: v }; this.renderDetail() }
      return
    }
    if (d.fileAdd !== undefined && c) return this.pickFiles(c)
    if (d.fpOpen !== undefined && c) return this.fpOpen(c, !(this.fp && this.fp.card === c.id))
    if (d.fpCancel !== undefined && c) return this.fpOpen(c, false)
    if (d.fpOk !== undefined && c) return this.fpAdd(c)
    if (d.fileUnlink && c) { await this.act('card/files-remove', { id: c.id, path: d.fileUnlink }, '已解除关联「' + folderName(d.fileUnlink) + '」，文件本身没动'); return }
    if (d.unbind) return this.askUnbind(d.unbind)
    if (d.restore) return this.restoreSession(d.restore)
    if (d.step && c) { await this.move(c, c.g, d.step, null); return }
    if (d.next !== undefined && c) { const sts = this.grp(c.g)!.statuses; const nx = sts[sts.findIndex((x) => x.id === c.col) + 1]; if (nx) await this.move(c, c.g, nx.id, null); return }
    if (d.newGroup !== undefined) return this.askName('新建卡片组', '卡片组就是父项目，默认带 5 个阶段，创建后可在「卡片组设置」里改。', '', 'group')
    if (d.addCard) { this.adding = { g: d.addCard, col: d.col ?? '' }; this.addDraft = ''; this.render(); (this.root.querySelector('#dpmAddIn') as HTMLInputElement | null)?.focus(); return }
    if (d.renameCard !== undefined && c) return this.askName('重命名卡片', '', c.t, 'rename:' + c.id)
    if (d.removeCard !== undefined && c) {
      if (!window.confirm('删除卡片「' + c.t + '」？它的会话会保留，但不再读取项目记忆。')) return
      this.sel = null
      await this.act('card/remove', { id: c.id }, '已删除卡片')
      return
    }
    if (d.editGroup) { this.editG = d.editGroup; this.openGroupSettings(d.focusLinks !== undefined); return }
    if (d.linkCard !== undefined && c) return this.openLink('card', c.id)
    if (d.linkGroup) return this.openLink('group', d.linkGroup)
    if (d.unlinkCard && c) { await this.act('card/update', { id: c.id, links: c.links.filter((k) => k !== d.unlinkCard) }, '已取消关联'); return }
    if (d.unlinkGroup && this.editG) { const g = this.grp(this.editG)!; await this.act('group/update', { id: g.id, links: g.links.filter((k) => k !== d.unlinkGroup) }, '已取消关联'); this.renderGroupSettings(); return }
    if (d.taskDel !== undefined && c) { const tasks = c.tasks.filter((_, k) => k !== Number(d.taskDel)); await this.act('card/tasks', { id: c.id, tasks }); return }
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
    if (t.id === 'dpmArManualAdd') return this.addManualPath()
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
    if (t.id === 'dpmAddIn') { this.addDraft = t.value; return }
    if (t.id === 'dpmFpIn' && this.fp) { this.fp.text = t.value; clearTimeout(this.fpTimer); this.fpTimer = window.setTimeout(() => void this.fpCheck(), 250); return }
    if (t.id === 'dpmNoteIn') { const c = this.sel ? this.card(this.sel) : undefined; if (!c) return; this.noteEdit = { card: c.id, draft: t.value }; this.syncNoteBar(c, t.value); return }
    if (t.id === 'dpmTyNew' && this.ty?.addErr) { this.ty.addErr = ''; t.classList.remove('bad'); t.removeAttribute('aria-invalid'); this.$('#dpmTyNewE').hidden = true; return }
    if (this.wl && t.closest('#dpmDlgWl')) {
      const w = this.wl
      const d = t.dataset
      if (d.wtext !== undefined) w.rows[Number(d.wtext)].text = t.value
      if (d.wurl !== undefined) {
        const r = w.rows[Number(d.wurl)]
        r.url = t.value
        if (r.err) { r.err = ''; t.classList.remove('bad'); t.removeAttribute('aria-invalid'); t.parentElement?.querySelector(':scope > .wl-err')?.remove() }
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
      r.type = t.value
      return
    }
    if (t.dataset.task !== undefined && c) { const tasks = c.tasks.map((x, k) => (k === Number(t.dataset.task) ? { ...x, done: t.checked } : x)); await this.act('card/tasks', { id: c.id, tasks }); return }
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
    const v = inp.value.trim()
    if (!c || !v) return
    inp.value = ''
    await this.act('card/tasks', { id: c.id, tasks: c.tasks.concat([{ text: v, done: false }]) })
    const n = this.$<HTMLInputElement>('#dpmNewTask'); if (n) n.focus()
  }

  private async onKey(e: KeyboardEvent): Promise<void> {
    const t = e.target as HTMLElement
    if (this.gd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.gdStop(false); return }
    if (this.wd && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.wdStop(false); return }
    const wh = t.closest('[data-wdrag]') as HTMLElement | null
    if (wh && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const c = this.sel ? this.card(this.sel) : undefined
      const i = Number(wh.dataset.wdrag)
      if (c) await this.wlMove(c, i, e.key === 'ArrowUp' ? i - 1 : i + 1)
      return
    }
    if (t.id === 'dpmFpIn' && !e.isComposing) {
      const c = this.sel ? this.card(this.sel) : undefined
      if (c && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.fpOpen(c, false); return }
      // ⌘/Ctrl+Enter 添加（先等最新一次检测）
      if (c && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); clearTimeout(this.fpTimer); await this.fpCheck(); await this.fpAdd(c); return }
    }
    if (this.td && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.tdStop(false); return }
    if (this.ty && t.dataset?.tygrip !== undefined && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const i = Number(t.dataset.tygrip); await this.typeMove(i, i + (e.key === 'ArrowUp' ? -1 : 1)); return }
    if (this.ty && t.closest('#dpmDlgTy')) {
      if (e.isComposing) return
      if (t.id === 'dpmTyNew' && e.key === 'Enter') { e.preventDefault(); await this.typeAdd(); return }
      if (t.id === 'dpmTyEd' && e.key === 'Enter') { e.preventDefault(); await this.typeSave(this.ty.edit); return }
      if (t.id === 'dpmTyEd' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const i = this.ty.edit; this.ty.edit = -1; this.ty.err = ''; this.typesRender(); (this.root.querySelector('[data-ty-edit="' + i + '"]') as HTMLElement | null)?.focus(); return }
      return
    }
    if (this.wl && t.closest('#dpmDlgWl')) {
      if (e.key === 'Enter' && t.tagName === 'INPUT' && !e.isComposing) { e.preventDefault(); await this.wlSave() }
      return
    }
    const gh = t.closest('[data-gdrag]') as HTMLElement | null
    if (gh && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const gs = this.groups
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
    if (e.key === 'Enter' && (t.id === 'dpmLkQ' || t.id === 'dpmPopQ' || t.id === 'dpmArQ' || t.id === 'dpmLsQ')) { e.preventDefault(); return }
    if (e.key === 'Enter' && t.id === 'dpmArPath') { e.preventDefault(); this.addManualPath(); return }
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
    if (e.key === 'Escape' && this.sel && !this.root.querySelector('dialog[open]')) { this.sel = null; this.render() }
  }

  // ── 卡片组：展开/收起、手柄拖动排序（pointer 事件：按住拖动，松开落位，Esc 取消） ──
  private async toggleGroup(id: string): Promise<void> {
    const g = this.grp(id)
    if (!g) return
    if (await this.act('group/update', { id, collapsed: !g.collapsed })) (this.root.querySelector('[data-toggle="' + CSS.escape(id) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  private gd: { id: string; y0: number; on: boolean; before: string | null | undefined } | null = null
  private gdMarks(): void { this.root.querySelectorAll('.gins-before, .gins-after').forEach((n) => n.classList.remove('gins-before', 'gins-after')) }
  private gdDown(e: PointerEvent): void {
    const h = (e.target as HTMLElement).closest?.('[data-gdrag]') as HTMLElement | null
    if (!h || e.button !== 0) return
    e.preventDefault()
    h.setPointerCapture(e.pointerId)
    this.gd = { id: h.dataset.gdrag as string, y0: e.clientY, on: false, before: undefined }
  }
  private gdMove(e: PointerEvent): void {
    const gd = this.gd
    if (!gd) return
    if (!gd.on) {
      if (Math.abs(e.clientY - gd.y0) < 4) return
      gd.on = true
      this.root.classList.add('gdragging')
      this.root.querySelector('[data-lane="' + CSS.escape(gd.id) + '"]')?.classList.add('lifting')
    }
    const w = this.root.querySelector('.board-wrap') as HTMLElement
    const wr = w.getBoundingClientRect()
    if (e.clientY < wr.top + 48) w.scrollTop -= 14
    else if (e.clientY > wr.bottom - 48) w.scrollTop += 14
    const lanes = Array.from(this.root.querySelectorAll<HTMLElement>('[data-lane]')).filter((l) => l.dataset.lane !== gd.id)
    let before: HTMLElement | null = null
    for (const l of lanes) { const r = l.getBoundingClientRect(); if (e.clientY < r.top + Math.min(r.height / 2, 40)) { before = l; break } }
    this.gdMarks()
    if (before) before.classList.add('gins-before')
    else lanes[lanes.length - 1]?.classList.add('gins-after')
    gd.before = before ? (before.dataset.lane as string) : null
  }
  private gdStop(commit: boolean): void {
    const gd = this.gd
    if (!gd) return
    this.gd = null
    this.gdMarks()
    this.root.classList.remove('gdragging')
    this.root.querySelectorAll('.lane.lifting').forEach((n) => n.classList.remove('lifting'))
    if (commit && gd.on && gd.before !== undefined) void this.moveGroup(gd.id, gd.before)
  }
  /** 调整卡片组顺序：顺序没变不发请求；成功后其余组平滑让位，落位的组闪一下描边，焦点回到它的手柄。 */
  private async moveGroup(id: string, beforeId: string | null): Promise<void> {
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
    const el = this.root.querySelector('[data-lane="' + CSS.escape(id) + '"]') as HTMLElement | null
    if (el) { el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 720) }
    ;(this.root.querySelector('[data-gdrag="' + CSS.escape(id) + '"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  // ── 拖拽：阶段内排序 + 跨阶段移动 ──
  private onDragStart(e: DragEvent): void {
    const c = (e.target as HTMLElement).closest?.('[data-card]') as HTMLElement | null
    if (!c) return
    this.dragId = c.dataset.card as string
    this.root.classList.add('carddrag')
    setTimeout(() => c.classList.add('dragging'), 0)
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', this.dragId) }
  }
  private clearMarks(): void { this.root.querySelectorAll('.cell.over, .atray.over, .ins-before, .ins-after').forEach((n) => n.classList.remove('over', 'ins-before', 'ins-after')) }
  private clearDrag(): void { this.root.classList.remove('carddrag'); this.clearMarks(); this.root.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging')); this.dragId = null; this.dropAt = null }
  private onDragOver(e: DragEvent): void {
    // 拖进本卡片组展开的「已归档卡片」列表 = 归档；别的卡片组的列表不接收
    const tr = this.dragId ? (e.target as HTMLElement).closest?.('.atray') as HTMLElement | null : null
    if (tr) {
      if (tr.dataset.trayG !== this.card(this.dragId as string)?.g) return
      e.preventDefault()
      this.clearMarks()
      tr.classList.add('over')
      this.dropAt = { g: tr.dataset.trayG as string, col: '', before: null, tray: true }
      return
    }
    const cell = this.dragId ? (e.target as HTMLElement).closest?.('.cell') as HTMLElement | null : null
    if (!cell) return
    e.preventDefault()
    this.clearMarks()
    cell.classList.add('over')
    const cards = Array.from(cell.querySelectorAll<HTMLElement>('.card')).filter((x) => x.dataset.card !== this.dragId)
    let before: HTMLElement | null = null
    for (const x of cards) { const r = x.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = x; break } }
    if (before) before.classList.add('ins-before')
    else if (cards.length) cards[cards.length - 1].classList.add('ins-after')
    this.dropAt = { g: cell.dataset.g as string, col: cell.dataset.col as string, before: before ? (before.dataset.card as string) : null }
  }
  private async onDrop(e: DragEvent): Promise<void> {
    if (!this.dragId || !this.dropAt) return
    e.preventDefault()
    const c = this.card(this.dragId)
    const at = this.dropAt
    this.clearDrag()
    if (!c) return
    if (at.tray) { await this.archiveCard(c.id); return }
    const tops = new Map<string, number>()
    this.root.querySelectorAll<HTMLElement>('.card').forEach((el) => tops.set(el.dataset.card as string, el.getBoundingClientRect().top))
    const ok = await this.move(c, at.g, at.col, at.before)
    if (!ok) return
    this.root.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      const t0 = tops.get(el.dataset.card as string)
      if (t0 === undefined) return
      const dy = t0 - el.getBoundingClientRect().top
      if (Math.abs(dy) > 2) { el.style.setProperty('--dy', dy + 'px'); el.classList.add('moved'); setTimeout(() => el.classList.remove('moved'), 380) }
    })
    const el = this.root.querySelector('[data-card="' + c.id + '"]') as HTMLElement | null
    if (el) { el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 450) }
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
    this.addBusy = true
    inp.value = ''
    this.addDraft = ''
    const before = new Set(this.cards.map((x) => x.id))
    let ok = false
    try { ok = await this.act('card/create', { group: a.g, col: a.col, title: v }, '已添加卡片') } finally { this.addBusy = false }
    if (!ok) { this.addDraft = v + this.addDraft; this.render() }
    const added = ok ? this.cards.find((x) => !before.has(x.id) && x.g === a.g && x.col === a.col) : undefined
    const el = added ? this.root.querySelector('[data-card="' + added.id + '"]') as HTMLElement | null : null
    if (el) { el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 450) }
    ;(this.root.querySelector('#dpmAddIn') as HTMLInputElement | null)?.focus()
  }
  /** 输入框空着失焦 → 只把表单换回按钮（不整体重绘，避免吞掉用户正在点的卡片/按钮）。 */
  private onFocusOut(e: FocusEvent): void {
    const t = e.target as HTMLElement
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
    if (id === 'dpmDlgRepo') { const a = this.ar; this.ar = null; if (ok && a && a.sel.length) await this.saveAddRepo(a); return }
    if (id === 'dpmDlgSt') this.editG = null
    if (id === 'dpmDlgWl') this.wl = null
    if (id === 'dpmDlgTy') { this.ty = null; (this.root.querySelector('.detail [data-types]') as HTMLElement | null)?.focus({ preventScroll: true }) }
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
  onSessionsChanged(): void {
    if (this.disposed) return
    // 卡片上的会话标志（数量 / 有无活跃）变了才重绘看板，否则只更新详情
    const sig = this.chipSignature()
    if (sig !== this.chipSig && !this.gd && !this.composing) this.render()
    else if (this.sel && !this.$<HTMLDialogElement>('#dpmDlgSess').open) this.renderDetail()
    if (this.ls) this.renderLinkSess()
  }

  // ── 本卡片的会话：关联已有会话 / 恢复活跃 / 解除关联 ──
  private sessIndex(): Map<string, SessionView> { const m = new Map<string, SessionView>(); for (const s of this.host.allSessions()) m.set(s.id, s); return m }
  private linkedHtml(c: Card, ro = false): string {
    const refs = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id)
    const all = this.moreOf(c).sess
    if (!refs.length) return '<p class="meta">' + (ro ? '没有会话。' : '还没有会话。可以「以此卡片新建会话」，或关联已有会话。') + '</p>'
    const idx = this.sessIndex()
    const canRestore = this.snap?.caps?.unarchive !== false
    return '<div id="dpmSessList">' + limitList(sortLinked(refs, idx), all).map((r) => {
      const v = idx.get(r.sessionId)
      const title = v?.title ?? r.title ?? '会话 ' + r.sessionId.slice(0, 8)
      const unl = ro ? '' : '<button type="button" class="ib sm unl tipbtn" data-unbind="' + esc(r.sessionId) + '" aria-label="解除关联 ' + esc(title) + '">' + ic('unlink') + '<span class="tip" aria-hidden="true">解除关联</span></button>'
      if (!v) return '<div class="lsess gone"><div class="l1"><span class="lname">会话已删除</span>' + unl + '</div><div class="l2"><span class="sub2">原名「' + esc(title) + '」</span></div></div>'
      const name = v.archived
        ? '<span class="lname" title="已归档的会话不能打开，先「恢复活跃」">' + esc(title) + '</span>'
        : '<button type="button" class="lname" data-open-sess="' + esc(v.id) + '" title="打开会话：' + esc(title) + '">' + esc(title) + '</button>'
      const sdel = !ro && !v.archived && v.blank && this.host.canDeleteSession() ? '<button type="button" class="ib sm sdel tipbtn" data-del-sess="' + esc(v.id) + '" aria-label="删除 ' + esc(title) + '">' + ic('trash') + '<span class="tip" aria-hidden="true">删除（还没有对话）</span></button>' : ''
      const sarc = ro || v.archived ? '' : '<button type="button" class="ib sm sarc tipbtn" data-archive-sess="' + esc(v.id) + '" aria-label="归档会话 ' + esc(title) + '">' + ic('archive') + '<span class="tip" aria-hidden="true">归档会话</span></button>'
      const restore = v.archived && !ro
        ? '<button type="button" class="btn ghost xs" data-restore="' + esc(v.id) + '"' + (canRestore && !this.restoring.has(v.id) ? '' : ' disabled') + ' title="' + (canRestore ? '恢复到工作区原来的位置' : '当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）') + '">' + ic('restore') + (this.restoring.has(v.id) ? '恢复中…' : '恢复活跃') + '</button>'
        : ''
      return '<div class="lsess' + (v.archived ? ' archived' : '') + '"><div class="l1">' + name + '<span class="acts">' + sdel + sarc + unl + '</span></div><div class="l2">'
        + (v.archived ? '<span class="chip arch">已归档</span>' : v.blank ? '<span class="chip">未开始</span>' : '<span class="chip live">活跃</span>') + '<span class="sub2">' + (v.forkOf ? '分叉自「' + esc(v.forkOf) + '」 · ' : '') + esc(v.ws) + ' · ' + esc(ago(v.updatedAt)) + '</span>' + restore + '</div></div>'
    }).join('') + '</div>' + moreBtn('sess', all, refs.length, 'dpmSessList')
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
    // 侧栏归档集合通过 dsh 的工作区推送更新；稍等一拍再重绘，让状态标签跟上
    setTimeout(() => { if (!this.disposed) { this.render(); (this.root.querySelector('.detail [data-open-sess="' + sessionId + '"]') as HTMLElement | null)?.focus() } }, 300)
  }

  // ── 添加挂载仓库 ──
  private openAddRepo(mode: 'group' | 'card' = 'group'): void {
    if (mode === 'group') {
      const g = this.grp(this.editG ?? '')
      if (!g) return
      this.ar = { mode, id: g.id, q: '', sel: [], manual: false, busy: false }
      this.$('#dpmArT').textContent = '添加卡片共用仓库'
      this.$('#dpmArP').textContent = '之后在「' + g.name + '」里新建的卡片会自动带上这些仓库，已有的卡片不变。可以多选。'
    } else {
      const c = this.sel ? this.card(this.sel) : undefined
      if (!c || c.archivedAt) return
      this.ar = { mode, id: c.id, q: '', sel: [], manual: false, busy: false }
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
    return '<label class="pk' + (m ? ' lock' : '') + '"><input type="checkbox" data-ar="' + esc(r.path) + '"' + (on ? ' checked' : '') + (m ? ' disabled' : '') + '><span class="txt"><span class="nm">' + esc(r.name) + '</span><span class="mono" title="' + esc(r.path) + '">' + esc(r.path) + '</span></span>' + tail + '</label>'
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
    this.$('#dpmArManual').hidden = !a.manual
    this.$<HTMLButtonElement>('#dpmArPick').hidden = a.manual
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
      if (this.ar === a) { a.manual = true; this.renderAddRepo(); this.$<HTMLInputElement>('#dpmArPath').focus() }
      // 细节进控制台（点名失败对象），界面只给可操作的一句话
      console.warn('[dsh-project-manager] uiWorkspace.pickDirectory 失败，改为手输路径：', e)
      this.host.toast('当前 dsh 打不开系统选文件夹对话框，请直接输入文件夹的绝对路径', 'err')
    } finally { a.busy = false }
    if (this.ar !== a) return
    if (path && this.arAdd(path)) { this.renderSel([path]); this.focusLastSel() } else this.arCheck()
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
  private async saveAddRepo(a: NonNullable<BoardView['ar']>): Promise<void> {
    const repos = a.sel.map((x) => ({ name: x.name.replace(/\s+/g, ' ').trim(), role: x.role.trim() || '仓库', path: x.path }))
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
      return
    }
    if (a.mode === 'group') {
      if (this.$<HTMLDialogElement>('#dpmDlgSt').open) this.renderGroupSettings()
      ;(this.root.querySelector('#dpmRepoAdd') as HTMLElement | null)?.focus()
    } else (this.root.querySelector('.detail [data-card-repo-add]') as HTMLElement | null)?.focus()
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
  <div class="dlg-b"><label class="lbl" for="dpmNameInput">名称</label><input class="fld" id="dpmNameInput" autocomplete="off"></div>
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
    <div class="ar-top"><label class="sr-only" for="dpmArQ">搜索候选仓库</label><input class="fld" id="dpmArQ" placeholder="搜索候选仓库（名称或路径）" autocomplete="off"><button type="button" class="btn" id="dpmArPick">%FOLDER%选择文件夹…</button></div>
    <div class="ar-manual" id="dpmArManual" hidden><label class="sr-only" for="dpmArPath">仓库文件夹的绝对路径</label><input class="fld" id="dpmArPath" placeholder="输入文件夹绝对路径，例如 ~/code/repo 展开后的完整路径" autocomplete="off"><button type="button" class="btn" id="dpmArManualAdd">添加</button></div>
  </div>
  <section class="ar-cand" aria-labelledby="dpmArCandH">
    <div class="ar-h"><span id="dpmArCandH">候选仓库</span><span class="meta" id="dpmArCandN"></span><span class="grow"></span><nav class="ar-spy" id="dpmArSpy" aria-label="跳到分组"></nav></div>
    <div class="ar-scroll" id="dpmArList"></div>
  </section>
  <section class="ar-picked" aria-labelledby="dpmArSelH">
    <div class="ar-h"><span id="dpmArSelH">已选 · <span id="dpmArSelN">0</span></span><span class="grow"></span><span class="meta">默认名称是文件夹名，可以改</span></div>
    <div class="ar-scroll" id="dpmArSel"></div>
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
  <div class="dlg-b"><div class="wl-rows" id="dpmWlRows"></div><button type="button" class="btn ghost sm wl-add" id="dpmWlMore" data-wl-more>%PLUS%再加一条</button></div>
  <div class="dlg-f"><span class="meta" id="dpmWlCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="button" id="dpmWlOk">保存</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgTy" aria-labelledby="dpmTyT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmTyT">管理类型</h2><p>所有卡片的「相关链接」共用这些类型。拖动左侧把手调整顺序，添加 / 编辑链接时的类型下拉按这个顺序显示；改名后，用这个类型的链接会一起改过来。</p></div>
  <div class="dlg-b"><ul class="ty-list" id="dpmTyList" aria-label="已有类型"></ul>
    <div class="ty-add"><label class="sr-only" for="dpmTyNew">新类型名称</label><input class="fld" id="dpmTyNew" placeholder="新类型名称，比如「设计稿」" maxlength="20" autocomplete="off"><button type="button" class="btn" data-ty-add>%PLUS%新增</button></div>
    <p class="wl-err" id="dpmTyNewE" hidden></p></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="submit" value="">完成</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgImp" aria-labelledby="dpmImT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmImT">导入落盘项目</h2><p>每个选中的落盘项目生成一张卡片并自动关联。只读扫描 ~/.ai，不会修改 STATE。</p></div>
  <div class="dlg-b"><div id="dpmImList"></div><label class="lbl" for="dpmImGroup">放进卡片组</label><select class="fld" id="dpmImGroup"></select></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">导入所选</button></div>
</form></dialog>
`

