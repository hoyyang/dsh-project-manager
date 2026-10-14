/**
 * 侧栏「项目区」与卡片组子工作区行的 DOM 增强（官方未开放行内插槽）：
 *  - 「+」接管：捕获阶段拦截，先选卡片再建会话（「项目区」行列全部卡片，卡片组行只列本组卡片）；
 *  - 0.11 活跃会话数 + 层级：按行 id 生成一张样式表（数字用 ::after 画，层级用缩进 + 引导线），不改宿主节点；
 *  - 0.11 reveal：从看板进入会话时，会话所在的卡片组（及「项目区」）收起着就替用户点开；
 *  - 0.12 空会话：宿主只显示「当前打开的那个」还没对话的会话（sessionVisible），其余隐藏；
 *    在「项目区」及其卡片组展开时，把这些会话补画成插件自己的行（排在最前，标「未开始」，点击打开）；
 *  - 0.13 补画行悬停出现删除按钮（数据层面删除，能力来自 dsh-manage-sessions，没有就不出现）。
 * 依据：dsh-client-ui-workspace 行 [data-row-key="workspace:<工作区 id>"]（role=treeitem，aria-expanded），
 * 整组包在 [class*="groupSection"]（行内 style 带 --dsh-workspace-indent），会话行 [data-row-key="session:<id>"]。
 * 失效时（DSH 改版找不到行）：「+」照常新建会话、数字与层级不出现、不自动展开——功能不丢。
 */
const ROW = '[data-row-key^="workspace:"]'
const SEC = '[class*="groupSection"]'
const wsRow = (id: string): string => '[data-row-key="workspace:' + CSS.escape(id) + '"]'
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SidebarHooks {
  /** 项目区工作区 id 与 卡片组子工作区 id → 卡片组 id。 */
  rows(): { hub: string | null; groups: Record<string, string> }
  pickCard(anchor: HTMLElement, groupId?: string): void
  /** 0.12：打开补画出来的空会话。 */
  open(sessionId: string): void
  /** 0.13：能不能删除会话（装了 dsh-manage-sessions 且宿主支持）。 */
  canDelete(): boolean
  /** 0.13：确认后删除还没对话的会话。 */
  del(sessionId: string, title: string): void
}

/** 0.12：补画行的数据（工作区 id → 该工作区里宿主隐藏掉的空会话）。0.20：current = 当前打开的那个（宿主那行只会写「新会话」，由插件画、宿主那行藏起来）；pending = 正在新建的占位行。 */
export type BlankRow = { id: string; title: string; current?: boolean; pending?: boolean }

/**
 * 0.12：wids 里每个工作区还没对话的会话：blank、没归档、不是子代理。宿主只画当前打开的那个、而且只写「新会话」，
 * 0.20 起当前那个也由插件画（标 current），标题用会话标题，没有就用看板上记的标题（titles，绑定卡片时就有）。
 * 纯函数（单测直接取源码跑），工作区内顺序保持宿主 sessionIds 的顺序。
 */
export function blankRows(items: Array<{ workspaceId: string; sessionIds?: string[] }>, byId: Record<string, { title?: string; displayTitle?: string; blank?: boolean; parentId?: string; origin?: string; retainedBy?: Record<string, number> } | undefined>, archived: ReadonlySet<string>, wids: string[], titles: Record<string, string | undefined> = {}): Record<string, BlankRow[]> {
  const out: Record<string, BlankRow[]> = {}
  for (const wid of wids) {
    const w = items.find((x) => x.workspaceId === wid)
    const rows = []
    for (const id of (w && w.sessionIds) || []) {
      const s = byId[id]
      // 0.15：分叉会话也带 parentId，只按 origin 排子代理
      if (!s || !s.blank || archived.has(id) || s.origin === 'subagent') continue
      const cur = ((s.retainedBy && s.retainedBy.mainView) || 0) > 0
      // displayTitle 在没有标题时是工作目录名（如 gmunhccece），不能用；都没有才显示「新会话」
      rows.push(cur ? { id, title: s.title || titles[id] || '新会话', current: true } : { id, title: s.title || titles[id] || '新会话' })
    }
    if (rows.length) out[wid] = rows
  }
  return out
}

/**
 * 卡片组行的数字 + 层级样式。counts：卡片组子工作区 id → 活跃会话数；bump：本次数字变了的（轻跳一下）。
 * 数字放在标题和悬停按钮之间；会话行整行缩进到引导线右侧（边框、填充、选中底色一起缩进）。
 */
export function rowCss(hub: string | null, counts: Record<string, number>, bump: Set<string>): string {
  const ids = Object.keys(counts)
  if (!ids.length) return ''
  const rows = ids.map(wsRow)
  const sec = rows.map((r) => SEC + ':has(> * > ' + r + ')')
  const any = (list: string[], tail: string): string => list.map((x) => x + tail).join(',\n')
  let css = any(rows, '::after') + ' { order: 1; flex: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--dpm-cnt-bg); color: var(--dpm-cnt-ink); font-size: 12px; font-weight: 700; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }\n'
    + any(rows, ' > [class*="rowActions"]') + ' { order: 2; }\n'
    + any(rows, '[aria-expanded="true"] [class*="_title"]') + ' { font-weight: 600; }\n'
    // 会话行：整行右移到引导线右侧；引导线画在每行外层（连续成一条），x = 卡片组文件夹图标中线
    + any(sec, ' > * > :is([data-row-key^="session:"], [data-dpm-blank])') + ' { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); padding-inline-start: 8px; }\n'
    + any(sec, ' > *:has(> :is([data-row-key^="session:"], [data-dpm-blank]))') + ' { background: linear-gradient(var(--dpm-guide), var(--dpm-guide)) no-repeat calc(15.5px + var(--dsh-workspace-indent, 0px)) 0 / 1px 100%; }\n'
    + any(sec, ' > [class*="sessionOverflow"]') + ' { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); width: calc(100% - 24px - var(--dsh-workspace-indent, 0px)); padding-inline-start: 30px; }\n'
  for (const id of ids) {
    const n = counts[id]
    css += wsRow(id) + '::after { content: "' + n + '" / "' + (n ? n + ' 个活跃会话' : '没有活跃会话') + '";' + (n ? '' : ' background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; opacity: .7;') + (bump.has(id) ? ' animation: dpm-cnt-bump 420ms cubic-bezier(.2, .8, .2, 1);' : '') + ' }\n'
  }
  // 「项目区」自己的会话（不属于任何卡片组）：只在按工作区树嵌套时缩进到卡片组同一级
  if (hub) css += SEC + ':has(> * > ' + wsRow(hub) + '):has(> [role="group"]) > * > :is([data-row-key^="session:"], [data-dpm-blank]) { margin-inline-start: 12px; padding-inline-start: 8px; }\n'
  return css
}

export class SidebarBridge {
  private readonly onCapture = (e: Event): void => {
    const del = (e.target as HTMLElement | null)?.closest?.('[data-dpm-del]') as HTMLElement | null
    if (del) { e.stopPropagation(); e.preventDefault(); this.hooks.del(del.dataset.dpmDel as string, del.dataset.title as string); return }
    const blank = (e.target as HTMLElement | null)?.closest?.('[data-dpm-blank]') as HTMLElement | null
    if (blank) { e.stopPropagation(); e.preventDefault(); this.hooks.open(blank.dataset.dpmBlank as string); return }
    const b = (e.target as HTMLElement | null)?.closest?.('button') as HTMLButtonElement | null
    if (!b || !/新建会话|New session/i.test(b.getAttribute('aria-label') ?? '')) return
    const key = (b.closest(ROW) as HTMLElement | null)?.dataset.rowKey?.slice('workspace:'.length)
    if (!key) return
    const r = this.hooks.rows()
    const groupId = r.groups[key]
    if (key !== r.hub && !groupId) return
    e.stopPropagation()
    e.preventDefault()
    this.hooks.pickCard(b, groupId)
  }

  private style: HTMLStyleElement | null = null
  private last: Record<string, number> = {}
  private bumpTimer = 0
  private blanks: Record<string, BlankRow[]> = {}
  /** 0.20 正在新建的会话：工作区 id + 卡片标题（会话建好前侧栏先出现一行占位）。 */
  private pending: { ws: string; title: string } | null = null
  private hide: HTMLStyleElement | null = null
  private obs: MutationObserver | null = null
  private raf = 0

  constructor(private readonly hooks: SidebarHooks) {}

  start(): void {
    document.addEventListener('click', this.onCapture, true)
    // ponytail: 观察整个 body（侧栏容器类名是哈希、会重挂），rAF 合并 + 签名比对，没变化时零 DOM 写入
    this.obs = new MutationObserver(() => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.syncBlanks() }) })
    this.obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    this.style = document.createElement('style')
    this.style.dataset.plugin = 'dsh-project-manager:rows'
    document.head.append(this.style)
    this.hide = document.createElement('style')
    this.hide.dataset.plugin = 'dsh-project-manager:blank-current'
    document.head.append(this.hide)
  }

  stop(): void {
    document.removeEventListener('click', this.onCapture, true)
    this.obs?.disconnect(); this.obs = null
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0
    document.querySelectorAll('[data-dpm-blank-ws]').forEach((n) => n.remove())
    clearTimeout(this.bumpTimer)
    this.style?.remove()
    this.style = null
    this.hide?.remove()
    this.hide = null
  }
  /** 0.20 新建会话期间的占位行（null = 去掉）。 */
  setPending(p: { ws: string; title: string } | null): void { this.pending = p; this.syncBlanks() }

  /** 重画数字与层级。counts：卡片组子工作区 id → 活跃会话数。 */
  paint(hub: string | null, counts: Record<string, number>): void {
    if (!this.style) return
    const bump = new Set(Object.keys(counts).filter((k) => this.last[k] !== undefined && this.last[k] !== counts[k]))
    this.last = { ...counts }
    this.style.textContent = rowCss(hub, counts, bump)
    if (bump.size) { clearTimeout(this.bumpTimer); this.bumpTimer = window.setTimeout(() => { if (this.style) this.style.textContent = rowCss(hub, this.last, new Set()) }, 480) }
  }

  /** 0.12：更新补画数据并立即同步。 */
  setBlanks(map: Record<string, BlankRow[]>): void { this.blanks = map; this.syncBlanks() }

  /**
   * 每个目标工作区：行展开着 → 在它的标题行后面放补画行（与期望一致且位置没被挤走就不动）；收起 / 不再需要 → 移除。
   * 只碰带 data-dpm-blank-ws 的自有节点，不改宿主节点。
   */
  private syncBlanks(): void {
    if (!this.obs) return
    const want: Record<string, BlankRow[]> = { ...this.blanks }
    if (this.pending) want[this.pending.ws] = [{ id: '__pending', title: this.pending.title, pending: true }, ...(want[this.pending.ws] ?? [])]
    const hidden: string[] = []
    document.querySelectorAll<HTMLElement>('[data-dpm-blank-ws]').forEach((n) => { if (!want[n.dataset.dpmBlankWs as string]) n.remove() })
    for (const [ws, rows] of Object.entries(want)) {
      const head = document.querySelector<HTMLElement>(wsRow(ws))
      const sec = head?.closest(SEC) as HTMLElement | null
      const holder = head && sec ? Array.from(sec.children).find((c) => c.contains(head)) as HTMLElement | undefined : undefined
      const mine = Array.from(document.querySelectorAll<HTMLElement>('[data-dpm-blank-ws="' + CSS.escape(ws) + '"]'))
      if (!head || !sec || !holder || head.getAttribute('aria-expanded') !== 'true') { mine.forEach((n) => n.remove()); continue }
      for (const r of rows) if (r.current) hidden.push(r.id)
      const canDel = this.hooks.canDelete()
      const sigOf = (r: BlankRow): string => r.id + '\u0000' + r.title + '\u0000' + canDel + '\u0000' + (r.current ? 1 : 0) + (r.pending ? 1 : 0)
      const sig = rows.map(sigOf).join('\u0001')
      let at: Element | null = holder
      const inPlace = mine.length === rows.length && mine.every((n) => { const ok = n.previousElementSibling === at; at = n; return ok }) && mine.map((n) => n.dataset.sig).join('\u0001') === sig
      if (inPlace) continue
      mine.forEach((n) => n.remove())
      let prev: Element = holder
      for (const r of rows) {
        const w = document.createElement('span')
        w.className = 'dpm-blank-w'
        w.dataset.dpmBlankWs = ws
        w.dataset.sig = sigOf(r)
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'dpm-blank' + (r.current ? ' cur' : '') + (r.pending ? ' pend' : '')
        if (r.pending) { b.disabled = true; b.setAttribute('aria-busy', 'true') } else b.dataset.dpmBlank = r.id
        if (r.current) b.setAttribute('aria-current', 'page')
        b.title = r.pending ? '正在新建「' + r.title + '」' : '打开「' + r.title + '」（还没有对话）'
        b.innerHTML = '<span class="dpm-blank-s" aria-hidden="true"></span><span class="dpm-blank-t"></span><span class="dpm-blank-tag">' + (r.pending ? '正在新建' : '未开始') + '</span>'
        ;(b.querySelector('.dpm-blank-t') as HTMLElement).textContent = r.title
        w.append(b)
        if (canDel && !r.pending) {
          // 与打开按钮并排（按钮里不能嵌按钮）；悬停 / 键盘聚焦时出现，「未开始」标签让位
          const x = document.createElement('button')
          x.type = 'button'
          x.className = 'dpm-blank-del'
          x.dataset.dpmDel = r.id
          x.dataset.title = r.title
          x.title = '删除（还没有对话）'
          x.setAttribute('aria-label', '删除「' + r.title + '」')
          x.innerHTML = TRASH
          w.classList.add('can-del')
          w.append(x)
        }
        prev.after(w)
        prev = w
      }
    }
    // 宿主自己那行（只写「新会话」）在插件这行出现时藏起来
    const css = hidden.map((id) => '[data-row-key="session:' + CSS.escape(id) + '"]').join(',\n')
    const text = css ? css + ' { display: none !important; }' : ''
    if (this.hide && this.hide.textContent !== text) this.hide.textContent = text
  }

  /**
   * 让 wsId 工作区里的 sessionId 在侧栏露出来：卡片组行收起着就点开；卡片组行不在（嵌套在收起的「项目区」下）就先点开「项目区」。
   * 只点 aria-expanded="false" 的行（点之前同步复查，不会把宿主刚自动展开的行又点回去）；侧栏收成图标栏时找不到行，安静结束。
   */
  async reveal(sessionId: string, wsId: string, hub: string | null): Promise<void> {
    const open = (k: string): boolean => {
      const r = document.querySelector<HTMLElement>(wsRow(k))
      if (!r) return false
      if (r.getAttribute('aria-expanded') === 'false') r.click()
      return true
    }
    for (let i = 0; i < 20; i++) {
      if (open(wsId)) break
      if (hub && hub !== wsId) open(hub)
      await wait(100)
    }
    for (let i = 0; i < 20; i++) {
      const s = document.querySelector<HTMLElement>('[data-row-key="session:' + CSS.escape(sessionId) + '"]')
      if (s) { s.scrollIntoView({ block: 'nearest' }); return }
      await wait(100)
    }
  }
}
