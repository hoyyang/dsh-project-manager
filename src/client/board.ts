/**
 * 项目看板（主区面板）：vanilla DOM 渲染，直接移植原型 v8 的结构/样式/交互；数据全部来自 host 快照。
 * 阶段（statuses）只用来给卡片分组；每个阶段底部常驻「添加卡片」，就地输入、回车连续添加。
 * 所有变更 → POST → 用返回的新快照重绘（服务端是唯一事实来源，失败时点名提示并回到服务端状态）。
 */
import { ApiError, Card, getState, Group, post, Snapshot, StateInfo, Status } from './api.js'
import { esc, ic } from './icons.js'

export interface BoardHost {
  /** 以卡片新建项目会话（index.ts 实现：准备工作区 → 新建会话 → 绑定 → 打开）。 */
  newSession(cardId: string): Promise<void>
  openSession(sessionId: string): void
  isDark(): boolean
  setDark(dark: boolean): void
  toast(msg: string, kind?: 'ok' | 'err'): void
  pickCard(anchor: HTMLElement, groupId?: string): void
  /** dsh 侧栏里已添加的工作区（不含「项目区」），作为挂载仓库候选。 */
  workspaces(): Array<{ title: string; path: string }>
  /** 打开 dsh 的选文件夹对话框（与添加工作区同一个）；取消返回 null；不支持（网页文件浏览器模式）时抛错。 */
  pickDirectory(): Promise<string | null>
  /** dsh 的全部会话（活跃 + 已归档，不含子代理），带所在工作区与更新时间；来自 ctx.sessions + ctx.workspaces。 */
  allSessions(): SessionView[]
}

export interface SessionView { id: string; title: string; ws: string; wsId: string | null; updatedAt: number; archived: boolean }

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

/** 与 dsh 添加工作区的默认标题同一规则：去掉末尾分隔符，取最后一段。 */
export const folderName = (p: string): string => { const t = p.replace(/[/\\]+$/, ''); return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1) }
const normPath = (p: string): string => p.replace(/[/\\]+$/, '') || '/'

export class BoardView {
  snap: Snapshot | null = null
  sel: string | null = null
  q = ''
  err = ''
  editG: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private dragId: string | null = null
  private dropAt: { g: string; col: string; before: string | null } | null = null
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
  private ar: { g: string; q: string; sel: Array<{ path: string; name: string; role: string }>; manual: boolean; busy: boolean } | null = null
  /** 「关联已有会话」弹窗草稿；cf = 待确认解除关联的会话。 */
  private ls: { card: string; q: string; sel: string[]; busy: boolean } | null = null
  private cf: string | null = null
  private restoring = new Set<string>()

  constructor(readonly root: HTMLElement, readonly host: BoardHost) {
    root.classList.add('dpm')
    root.innerHTML = '<div class="pm-top"></div><div class="pm-body"><div class="board-wrap"></div></div>' + DIALOGS.replace('%FOLDER%', ic('fplus'))
    this.bind()
    void this.refresh()
    this.timer = setInterval(() => { if (!document.hidden) void this.refresh(true) }, 4000)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
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
  cell(g: string, col: string): Card[] { return this.cards.filter((c) => c.g === g && c.col === col).sort((a, b) => a.order - b.order) }
  sessionsOf(cardId: string): Array<{ id: string; title: string; at: string }> { return (this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId).map((s) => ({ id: s.sessionId, title: s.title ?? '会话 ' + s.sessionId.slice(0, 8), at: s.createdAt.slice(5, 16).replace('T', ' ') })) }

  async refresh(quiet = false): Promise<void> {
    try {
      if (quiet && this.composing) return
      const r = await getState(quiet && this.snap ? this.snap.rev : undefined)
      if (this.disposed || r.same) return
      this.snap = r
      this.err = ''
      this.render()
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
    if (!top.firstChild) top.innerHTML = '<div class="ttl"><h1>项目看板</h1><p>一张卡片对应一个落盘项目，卡片组就是父项目。每个卡片组有自己的一套阶段。</p></div>'
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
    wrap.innerHTML = (this.err ? '<div class="dpm-err" role="alert">' + esc(this.err) + '</div>' : '') + this.boardHtml()
    wrap.scrollTop = scroll
    wrap.querySelectorAll<HTMLElement>('.lane-in[data-g]').forEach((el) => { const x = laneX.get(el.dataset.g as string); if (x) el.scrollLeft = x })
    const addIn = wrap.querySelector('#dpmAddIn') as HTMLInputElement | null
    if (!addIn) this.adding = null
    else if (addFocus) { addIn.focus(); addIn.setSelectionRange(addIn.value.length, addIn.value.length) }
    const old = body.querySelector('.detail')
    const keep = old ? { scroll: (old.querySelector('.d-b') as HTMLElement | null)?.scrollTop ?? 0, task: (old.querySelector('#dpmNewTask') as HTMLInputElement | null)?.value ?? '', focus: document.activeElement?.id === 'dpmNewTask', same: old.getAttribute('data-card') === this.sel } : null
    old?.remove()
    if (this.sel && this.card(this.sel)) {
      body.insertAdjacentHTML('beforeend', this.detailHtml())
      if (keep?.same) {
        const nd = body.querySelector('.detail') as HTMLElement
        const db = nd.querySelector('.d-b') as HTMLElement | null
        if (db) db.scrollTop = keep.scroll
        const inp = nd.querySelector('#dpmNewTask') as HTMLInputElement | null
        if (inp && keep.task) inp.value = keep.task
        if (inp && keep.focus) inp.focus()
      }
    } else this.sel = null
    this.rendering = false
  }

  private boardHtml(): string {
    if (!this.snap) return '<div class="empty-board"><span>加载中…</span></div>'
    if (!this.groups.length) return '<div class="empty-board"><b>还没有卡片组</b><span>新建一个卡片组，或从落盘项目导入。</span><button type="button" class="btn primary" data-new-group>' + ic('plus') + '新建卡片组</button></div>'
    const q = this.q
    const vis = this.cards.filter((c) => !q || (c.t + ' ' + c.links.join(' ') + ' ' + this.cardDesc(c) + ' ' + (this.grp(c.g)?.repos.map((r) => r.name).join(' ') ?? '')).toLowerCase().includes(q))
    return this.groups.map((g) => {
      const cs = vis.filter((c) => c.g === g.id)
      const n = g.statuses.length
      const head = '<div class="shead" style="--cols:' + n + '">' + g.statuses.map((st) => '<div class="colh"><span class="nm">' + esc(st.name) + '</span><span class="n">' + cs.filter((x) => x.col === st.id).length + '</span></div>').join('') + '</div>'
      const bodyHtml = g.statuses.map((st) => {
        const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order)
        return '<div class="cell' + (inCol.length ? '' : ' empty') + '" data-col="' + esc(st.id) + '" data-g="' + esc(g.id) + '">' + inCol.map((c) => this.cardHtml(c)).join('') + this.addHtml(g, st) + '</div>'
      }).join('')
      return '<section class="lane' + (g.collapsed ? ' collapsed' : '') + '"><div class="lane-h">'
        + '<button type="button" class="ib" data-toggle="' + esc(g.id) + '" aria-expanded="' + !g.collapsed + '" aria-label="' + (g.collapsed ? '展开 ' : '折叠 ') + esc(g.name) + '"><svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>'
        + '<h2>' + esc(g.name) + '</h2><span class="meta">' + g.repos.length + ' 个仓库 · ' + cs.length + ' 张卡片 · ' + n + ' 个阶段</span>'
        + (g.links.length ? '<button type="button" class="chip mem as-btn" data-edit-group="' + esc(g.id) + '" data-focus-links>' + ic('mem') + '组记忆 ' + g.links.length + '</button>' : '')
        + '<span class="sp"></span>'
        + '<button type="button" class="btn ghost" data-edit-group="' + esc(g.id) + '">' + ic('sliders') + '卡片组设置</button>'
        + '<button type="button" class="btn ghost" data-new-in="' + esc(g.id) + '">' + ic('plus') + '新会话</button></div>'
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
    const done = c.tasks.filter((t) => t.done).length
    const pct = c.tasks.length ? Math.round(done / c.tasks.length * 100) : 0
    const prog = c.tasks.length ? '<span class="prog"><span class="bar"><i style="width:' + pct + '%"></i></span>' + done + '/' + c.tasks.length + '</span>' : '<span class="meta">无子任务</span>'
    const n = this.memOf(c).length
    const mem = n ? '<span class="chip mem" title="会话会自动读取 ' + n + ' 个落盘项目的记忆">' + ic('mem') + n + '</span>' : '<span class="chip warn" title="没有关联落盘项目，会话不会读取任何记忆">' + ic('mem') + '0</span>'
    return '<div class="card" role="button" tabindex="0" draggable="true" data-card="' + esc(c.id) + '" aria-pressed="' + (this.sel === c.id) + '" aria-label="' + esc(c.t) + '，打开详情；Alt+上下方向键调整顺序">'
      + '<h3>' + esc(c.t) + '</h3><p>' + esc(this.cardDesc(c)) + '</p><div class="foot">' + prog + mem + '</div></div>'
  }

  private detailHtml(): string {
    const c = this.card(this.sel as string) as Card
    const g = this.grp(c.g) as Group
    const sts = g.statuses
    const i = sts.findIndex((x) => x.id === c.col)
    const nx = sts[i + 1]
    const steps = sts.map((s, k) => '<button type="button" class="step' + (k < i ? ' past' : k === i ? ' cur' : '') + '" data-step="' + esc(s.id) + '"' + (k === i ? ' aria-current="step"' : '') + ' aria-label="移到 ' + esc(s.name) + '"><span class="nd">' + (k < i ? ic('check') : '') + '</span>' + esc(s.name) + '</button>').join('')
    const mem = this.memOf(c)
    const memRows = mem.map((m) => {
      const s = this.stateOf(m.k)
      const tag = m.from === 'group' ? '<span class="chip plain">来自卡片组</span>' : m.from === 'both' ? '<span class="chip plain">卡片组 + 卡片</span>' : '<span class="chip brand">卡片</span>'
      const rm = m.from !== 'group' ? '<button type="button" class="ib" data-unlink-card="' + esc(m.k) + '" aria-label="取消关联 ' + esc(m.k) + '">' + ic('x') + '</button>' : ''
      if (!s) return '<div class="mrow"><div class="txt"><div class="nm">' + esc(m.k) + '</div><p class="l">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div><div class="mside">' + tag + rm + '</div></div>'
      return '<div class="mrow"><div class="txt"><div class="nm">' + esc(s.slug) + '</div><span class="mono">' + esc(s.project) + ' · 更新于 ' + esc(s.updated) + '</span><p class="l">' + esc(s.status || '暂无状态说明') + '</p><p class="nx"><b>next_action</b>' + esc(s.next || '暂无下一步') + '</p></div><div class="mside">' + tag + rm + '</div></div>'
    }).join('') || '<p class="meta">还没有关联落盘项目。会话不会自动读取任何记忆。</p>'
    const repos = g.repos.map((r) => '<div class="repo">' + ic('repo') + '<div class="txt"><div class="nm">' + esc(r.name) + '</div><span class="mono">' + esc(r.path) + '</span></div><span class="chip ' + (r.role === '主仓' ? 'brand' : 'plain') + '">' + esc(r.role) + '</span></div>').join('') || '<p class="meta">未挂载仓库，在「卡片组设置」里添加。</p>'
    const tasks = c.tasks.map((t, k) => '<div class="task' + (t.done ? ' done' : '') + '"><label><input type="checkbox" data-task="' + k + '"' + (t.done ? ' checked' : '') + '><span>' + esc(t.text) + '</span></label><button type="button" class="ib sm" data-task-del="' + k + '" aria-label="删除子任务 ' + esc(t.text) + '">' + ic('x') + '</button></div>').join('')
    const sess = this.linkedHtml(c)
    return '<aside class="detail" data-card="' + esc(c.id) + '" aria-labelledby="dpmDT"><div class="d-h"><div class="grow" style="white-space:normal"><h2 id="dpmDT">' + esc(c.t) + '</h2><div class="sub">' + esc(g.name) + ' · ' + esc(sts[i]?.name ?? '') + '</div></div>'
      + '<button type="button" class="ib" data-rename-card aria-label="重命名卡片">' + ic('pencil') + '</button><button type="button" class="ib" data-close aria-label="关闭详情">' + ic('x') + '</button></div><div class="d-b">'
      + '<section class="sec"><h3>' + ic('mem') + '关联的落盘项目 · ' + mem.length + '<span class="grow"></span><button type="button" class="btn ghost sm" data-link-card>' + ic('plus') + '关联</button></h3><p class="meta mb">会话会自动读取下面这些落盘项目的记忆。来自卡片组的在「卡片组设置」里改。</p>' + memRows + '</section>'
      + '<section class="sec"><h3>阶段</h3><div class="steps">' + steps + '</div>' + (nx ? '<button type="button" class="btn primary lg" data-next>推进到 ' + esc(nx.name) + ic('arrow') + '</button>' : '<p class="meta">已在最后一个阶段</p>') + '</section>'
      + '<section class="sec"><h3>' + ic('play') + '本卡片的会话 · ' + this.sessionsOf(c.id).length + '<span class="grow"></span><button type="button" class="btn ghost sm" data-link-sess>' + ic('link') + '关联已有会话</button></h3>' + sess + '</section>'
      + '<section class="sec"><h3>子任务 ' + c.tasks.filter((t) => t.done).length + '/' + c.tasks.length + '</h3>' + tasks
      + '<form class="addtask" data-addtask><label class="sr-only" for="dpmNewTask">新子任务</label><input id="dpmNewTask" placeholder="添加子任务，回车确认" autocomplete="off"><button class="btn" type="submit">添加</button></form></section>'
      + '<section class="sec"><h3>' + ic('repo') + '仓库（继承自卡片组）</h3>' + repos + '</section>'
      + '<section class="sec"><button type="button" class="btn ghost danger" data-remove-card>' + ic('trash') + '删除这张卡片</button></section></div>'
      + '<div class="d-f"><div class="note"><span class="chip warn">' + ic('shield') + '完全权限</span><span class="chip mem">' + ic('mem') + '自动读取 ' + mem.length + ' 个落盘项目</span></div>'
      + '<button type="button" class="btn primary lg" data-open-card>' + ic('play') + '以此卡片新建会话</button></div></aside>'
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
    for (const id of ['dpmDlgSt', 'dpmDlgName', 'dpmDlgLink', 'dpmDlgImp', 'dpmDlgRepo', 'dpmDlgSess', 'dpmDlgCfm']) {
      const d = this.$<HTMLDialogElement>('#' + id)
      this.on(d, 'close', () => void this.onDialogClose(id, d))
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const t = (e.target as HTMLElement).closest('button, [role="button"]') as HTMLElement | null
    if (!t || !this.root.contains(t)) return
    const d = t.dataset
    const c = this.sel ? this.card(this.sel) : undefined
    if (d.dlgCancel !== undefined) { (t.closest('dialog') as HTMLDialogElement | null)?.close('cancel'); return }
    if (d.card) { this.sel = d.card; this.render(); (this.root.querySelector('[data-card="' + d.card + '"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return }
    if (d.close !== undefined) { this.sel = null; return this.render() }
    if (d.themeToggle !== undefined) { this.host.setDark(!this.host.isDark()); return }
    if (d.toggle) { const g = this.grp(d.toggle); if (g) await this.act('group/update', { id: g.id, collapsed: !g.collapsed }); return }
    if (d.newIn) return this.host.pickCard(t, d.newIn)
    if (d.openCard !== undefined && c) return this.host.newSession(c.id)
    if (d.openSess) return this.host.openSession(d.openSess)
    if (d.linkSess !== undefined && c) return this.openLinkSess(c)
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
      if (await this.act('group/update', { id: g.id, repos: g.repos.filter((_, k) => k !== Number(d.repodel)) }, '已移除「' + r.name + '」，项目区软链接已更新')) this.renderGroupSettings()
      return
    }
    if (t.id === 'dpmArPick') return this.pickFolder()
    if (t.id === 'dpmArManualAdd') return this.addManualPath()
    if (d.ardel !== undefined && this.ar) { this.ar.sel.splice(Number(d.ardel), 1); this.renderAddRepo(); return }
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
    if (t.id === 'dpmNameInput') { this.$<HTMLButtonElement>('#dpmNameOk').disabled = t.value.trim() === ''; return }
    if (t.id === 'dpmLkQ' && this.link) { this.link.q = t.value.trim().toLowerCase(); this.renderLink(); return }
    if (t.id === 'dpmLsQ' && this.ls) { if ((e as InputEvent).isComposing) return; this.ls.q = t.value; this.renderLinkSess(); return }
    if (t.id === 'dpmArQ' && this.ar) { if ((e as InputEvent).isComposing) return; this.ar.q = t.value.trim().toLowerCase(); this.$('#dpmArList').innerHTML = this.arListHtml(); return }
    if (t.dataset.arname !== undefined && this.ar) { this.ar.sel[Number(t.dataset.arname)].name = t.value; this.arCheck(); return }
    if (t.dataset.arrole !== undefined && this.ar) { this.ar.sel[Number(t.dataset.arrole)].role = t.value; return }
  }

  private async onChange(e: Event): Promise<void> {
    const t = e.target as HTMLInputElement
    const c = this.sel ? this.card(this.sel) : undefined
    if (t.dataset.task !== undefined && c) { const tasks = c.tasks.map((x, k) => (k === Number(t.dataset.task) ? { ...x, done: t.checked } : x)); await this.act('card/tasks', { id: c.id, tasks }); return }
    if (t.dataset.lk !== undefined && this.link) { if (t.checked) this.link.sel.add(t.dataset.lk); else this.link.sel.delete(t.dataset.lk); this.renderLinkCount(); return }
    if (t.dataset.stname !== undefined) return this.stEdit(() => undefined)
    if (t.dataset.ls !== undefined && this.ls) { const arch = !!t.closest('#dpmLsArch'); this.ls.sel.push(t.dataset.ls); this.renderLinkSess(); ((this.root.querySelector((arch ? '#dpmLsArch' : '#dpmLsActive') + ' [data-ls]') ?? this.root.querySelector('#dpmLsQ')) as HTMLElement | null)?.focus(); return }
    if (t.dataset.lsel !== undefined && this.ls) { this.ls.sel = this.ls.sel.filter((x) => x !== t.dataset.lsel); this.renderLinkSess(); ((this.root.querySelector('#dpmLsSel [data-lsel]') ?? this.root.querySelector('#dpmLsQ')) as HTMLElement | null)?.focus(); return }
    if (t.dataset.ar !== undefined && this.ar) { if (t.checked) this.arAdd(t.dataset.ar); else this.ar.sel = this.ar.sel.filter((x) => x.path !== t.dataset.ar); this.renderAddRepo(); return }
    if ((t.dataset.rpname !== undefined || t.dataset.rprole !== undefined) && this.editG) return this.saveRepoField(t)
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
    const el = t.closest('[data-card]') as HTMLElement | null
    if (el && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const c = this.card(el.dataset.card as string)
      if (!c) return
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

  // ── 拖拽：阶段内排序 + 跨阶段移动 ──
  private onDragStart(e: DragEvent): void {
    const c = (e.target as HTMLElement).closest?.('[data-card]') as HTMLElement | null
    if (!c) return
    this.dragId = c.dataset.card as string
    setTimeout(() => c.classList.add('dragging'), 0)
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', this.dragId) }
  }
  private clearMarks(): void { this.root.querySelectorAll('.cell.over, .ins-before, .ins-after').forEach((n) => n.classList.remove('over', 'ins-before', 'ins-after')) }
  private clearDrag(): void { this.clearMarks(); this.root.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging')); this.dragId = null; this.dropAt = null }
  private onDragOver(e: DragEvent): void {
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
    if (id === 'dpmDlgCfm') { const sid = this.cf; this.cf = null; if (ok && sid) await this.doUnbind(sid); return }
    if (id === 'dpmDlgRepo') { const a = this.ar; this.ar = null; if (ok && a && a.sel.length) await this.saveAddRepo(a); return }
    if (id === 'dpmDlgSt') this.editG = null
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
      + '<div class="lbl row" id="dpmStLinks">关联的落盘项目 · ' + g.links.length + '<span class="grow"></span><button type="button" class="btn ghost sm" data-link-group="' + esc(g.id) + '">' + ic('plus') + '关联</button></div>' + gl
      + '<div class="lbl row">仓库 · ' + g.repos.length + '<span class="grow"></span><button type="button" class="btn ghost sm" id="dpmRepoAdd">' + ic('plus') + '添加</button></div>' + (repos ? repos + '<p class="meta">名称、角色改完离开输入框即保存；要换路径就移除后重新添加。</p>' : '<p class="meta">还没有挂载仓库。点「添加」从 dsh 已添加的工作区里选，或选一个文件夹；仓库会以软链接出现在项目区目录的 repos/' + esc(g.name) + '/ 下。</p>')
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
    if (this.sel && !this.$<HTMLDialogElement>('#dpmDlgSess').open) this.render()
    if (this.ls) this.renderLinkSess()
  }

  // ── 本卡片的会话：关联已有会话 / 恢复活跃 / 解除关联 ──
  private sessIndex(): Map<string, SessionView> { const m = new Map<string, SessionView>(); for (const s of this.host.allSessions()) m.set(s.id, s); return m }
  private linkedHtml(c: Card): string {
    const refs = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id)
    if (!refs.length) return '<p class="meta">还没有会话。可以「以此卡片新建会话」，或关联已有会话。</p>'
    const idx = this.sessIndex()
    const canRestore = this.snap?.caps?.unarchive !== false
    return refs.map((r) => {
      const v = idx.get(r.sessionId)
      const title = v?.title ?? r.title ?? '会话 ' + r.sessionId.slice(0, 8)
      const unl = '<button type="button" class="ib sm unl tipbtn" data-unbind="' + esc(r.sessionId) + '" aria-label="解除关联 ' + esc(title) + '">' + ic('unlink') + '<span class="tip" aria-hidden="true">解除关联</span></button>'
      if (!v) return '<div class="lsess gone"><div class="l1"><span class="lname">会话已删除</span>' + unl + '</div><div class="l2"><span class="sub2">原名「' + esc(title) + '」</span></div></div>'
      const name = v.archived
        ? '<span class="lname" title="已归档的会话不能打开，先「恢复活跃」">' + esc(title) + '</span>'
        : '<button type="button" class="lname" data-open-sess="' + esc(v.id) + '" title="打开会话：' + esc(title) + '">' + esc(title) + '</button>'
      const restore = v.archived
        ? '<button type="button" class="btn ghost xs" data-restore="' + esc(v.id) + '"' + (canRestore && !this.restoring.has(v.id) ? '' : ' disabled') + ' title="' + (canRestore ? '恢复到工作区原来的位置' : '当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）') + '">' + ic('restore') + (this.restoring.has(v.id) ? '恢复中…' : '恢复活跃') + '</button>'
        : ''
      return '<div class="lsess' + (v.archived ? ' archived' : '') + '"><div class="l1">' + name + unl + '</div><div class="l2">'
        + (v.archived ? '<span class="chip arch">已归档</span>' : '<span class="chip live">活跃</span>') + '<span class="sub2">' + esc(v.ws) + ' · ' + esc(ago(v.updatedAt)) + '</span>' + restore + '</div></div>'
    }).join('')
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
  private openAddRepo(): void {
    const g = this.grp(this.editG ?? '')
    if (!g) return
    this.ar = { g: g.id, q: '', sel: [], manual: false, busy: false }
    this.$<HTMLInputElement>('#dpmArQ').value = ''
    this.$('#dpmArP').textContent = '仓库会以软链接挂到「' + g.name + '」下，这个组里每张卡片的会话都能读写。可以多选。'
    this.renderAddRepo()
    const d = this.$<HTMLDialogElement>('#dpmDlgRepo')
    d.returnValue = ''
    d.showModal()
    this.$<HTMLInputElement>('#dpmArQ').focus()
  }
  private arMounted(path: string): boolean { const g = this.ar ? this.grp(this.ar.g) : undefined; return !!g && g.repos.some((r) => normPath(r.path) === normPath(path)) }
  private arAdd(path: string): boolean {
    const a = this.ar
    if (!a) return false
    if (this.arMounted(path)) { this.host.toast('「' + folderName(path) + '」已挂载在本组', 'err'); return false }
    if (a.sel.some((x) => normPath(x.path) === normPath(path))) { this.host.toast('「' + folderName(path) + '」已在「已选」里', 'err'); return false }
    a.sel.push({ path, name: folderName(path), role: '仓库' })
    return true
  }
  private arErrs(): string[] {
    const a = this.ar
    const g = a ? this.grp(a.g) : undefined
    if (!a || !g) return []
    return a.sel.map((x, i) => {
      const n = x.name.replace(/\s+/g, ' ').trim()
      if (!n) return '名称不能为空'
      if (n.length > 120) return '名称超过 120 字'
      if (g.repos.some((r) => r.name === n)) return '本组已有同名仓库「' + n + '」'
      if (a.sel.slice(0, i).some((o) => o.name.replace(/\s+/g, ' ').trim() === n)) return '和上面的仓库重名，改一个名字'
      return ''
    })
  }
  private arListHtml(): string {
    const a = this.ar
    if (!a) return ''
    const all = this.host.workspaces()
    const list = all.filter((w) => !a.q || (w.title + ' ' + w.path).toLowerCase().includes(a.q))
    if (!all.length) return '<p class="ar-empty">dsh 里还没有添加过工作区。点「选择文件夹…」直接选一个。</p>'
    return list.map((w) => {
      const m = this.arMounted(w.path)
      const on = m || a.sel.some((x) => normPath(x.path) === normPath(w.path))
      return '<label class="pk' + (m ? ' lock' : '') + '"><input type="checkbox" data-ar="' + esc(w.path) + '"' + (on ? ' checked' : '') + (m ? ' disabled' : '') + '><span class="txt"><span class="nm">' + esc(w.title) + '</span><span class="mono">' + esc(w.path) + '</span></span>' + (m ? '<span class="chip plain">已挂载</span>' : '') + '</label>'
    }).join('') || '<p class="meta">没有匹配的工作区</p>'
  }
  private arSelHtml(): string {
    const a = this.ar
    if (!a) return ''
    return a.sel.map((x, i) => '<div class="rp-row"><input class="fld" data-arname="' + i + '" aria-label="仓库名 ' + (i + 1) + '" aria-describedby="dpmArE' + i + '" maxlength="120" value="' + esc(x.name) + '"><input class="fld" data-arrole="' + i + '" aria-label="仓库角色 ' + (i + 1) + '" maxlength="40" value="' + esc(x.role) + '"><span class="mono" title="' + esc(x.path) + '">' + esc(x.path) + '</span><button type="button" class="ib" data-ardel="' + i + '" aria-label="从已选移除 ' + esc(x.name || x.path) + '">' + ic('x') + '</button><p class="rp-err" id="dpmArE' + i + '" hidden></p></div>').join('')
      || '<p class="ar-empty">还没有选择仓库。勾选上面的工作区，或点「选择文件夹…」。</p>'
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
    this.$('#dpmArCount').textContent = a.sel.length ? '将挂载 ' + a.sel.length + ' 个仓库' : ''
    this.$<HTMLButtonElement>('#dpmArOk').disabled = a.busy || !a.sel.length || errs.some(Boolean)
  }
  private renderAddRepo(): void {
    const a = this.ar
    if (!a) return
    this.$('#dpmArList').innerHTML = this.arListHtml()
    this.$('#dpmArSel').innerHTML = this.arSelHtml()
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
    if (path && this.arAdd(path)) { this.renderAddRepo(); this.focusLastSel() } else this.arCheck()
  }
  private addManualPath(): void {
    const inp = this.root.querySelector('#dpmArPath') as HTMLInputElement | null
    const v = inp?.value.trim() ?? ''
    if (!inp || !v) return
    if (!v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v)) { this.host.toast('请输入绝对路径：' + v, 'err'); return }
    if (this.arAdd(v)) { inp.value = ''; this.renderAddRepo(); this.focusLastSel() }
  }
  private async saveAddRepo(a: NonNullable<BoardView['ar']>): Promise<void> {
    const repos = a.sel.map((x) => ({ name: x.name.replace(/\s+/g, ' ').trim(), role: x.role.trim() || '仓库', path: x.path }))
    const ok = await this.act('group/repos-add', { id: a.g, repos }, '已挂载 ' + repos.length + ' 个仓库，项目区软链接已更新')
    if (!ok) {
      // 服务端拒绝（例如别处刚挂了同名仓库）：重开弹窗保留已选，让用户改名后再存
      this.ar = { ...a, busy: false }
      const d = this.$<HTMLDialogElement>('#dpmDlgRepo')
      d.returnValue = ''
      this.renderAddRepo()
      d.showModal()
      return
    }
    if (this.$<HTMLDialogElement>('#dpmDlgSt').open) this.renderGroupSettings()
    ;(this.root.querySelector('#dpmRepoAdd') as HTMLElement | null)?.focus()
  }

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
<dialog class="dpm-dialog wide" id="dpmDlgRepo" aria-labelledby="dpmArT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmArT">添加挂载仓库</h2><p id="dpmArP"></p></div>
  <div class="dlg-b">
    <div class="ar-top"><label class="sr-only" for="dpmArQ">搜索 dsh 已添加的工作区</label><input class="fld" id="dpmArQ" placeholder="搜索 dsh 已添加的工作区" autocomplete="off"><button type="button" class="btn" id="dpmArPick">%FOLDER%选择文件夹…</button></div>
    <div class="ar-manual" id="dpmArManual" hidden><label class="sr-only" for="dpmArPath">仓库文件夹的绝对路径</label><input class="fld" id="dpmArPath" placeholder="输入文件夹绝对路径，例如 ~/code/repo 展开后的完整路径" autocomplete="off"><button type="button" class="btn" id="dpmArManualAdd">添加</button></div>
    <div class="ar-sec">dsh 已添加的工作区</div>
    <div class="pk-list ar-list" id="dpmArList"></div>
    <div class="ar-sec"><span>已选 · <span id="dpmArSelN">0</span></span><span class="grow"></span><span class="meta">默认名称是文件夹名，可以改</span></div>
    <div id="dpmArSel"></div>
  </div>
  <div class="dlg-f"><span class="meta" id="dpmArCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmArOk" type="submit" value="ok" disabled>保存</button></div>
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
<dialog class="dpm-dialog" id="dpmDlgLink" aria-labelledby="dpmLkT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLkT">关联落盘项目</h2><p id="dpmLkP"></p></div>
  <div class="dlg-b"><label class="sr-only" for="dpmLkQ">搜索落盘项目</label><input class="fld" id="dpmLkQ" placeholder="搜索 slug 或状态" autocomplete="off"><div class="pk-list" id="dpmLkList"></div></div>
  <div class="dlg-f"><span class="meta" id="dpmLkCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgImp" aria-labelledby="dpmImT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmImT">导入落盘项目</h2><p>每个选中的落盘项目生成一张卡片并自动关联。只读扫描 ~/.ai，不会修改 STATE。</p></div>
  <div class="dlg-b"><div id="dpmImList"></div><label class="lbl" for="dpmImGroup">放进卡片组</label><select class="fld" id="dpmImGroup"></select></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">导入所选</button></div>
</form></dialog>
`

