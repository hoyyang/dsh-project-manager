/**
 * 侧栏「项目区」与卡片组子工作区行的 DOM 增强（官方未开放行内插槽）：
 *  - 「+」接管：捕获阶段拦截，先选卡片再建会话（「项目区」行列全部卡片，卡片组行只列本组卡片）；
 *  - 0.11 活跃会话数 + 层级：按行 id 生成一张样式表（数字用 ::after 画，层级用缩进 + 引导线），不改宿主节点；
 *  - 0.11 reveal：从看板进入会话时，会话所在的卡片组（及「项目区」）收起着就替用户点开。
 * 依据：dsh-client-ui-workspace 行 [data-row-key="workspace:<工作区 id>"]（role=treeitem，aria-expanded），
 * 整组包在 [class*="groupSection"]（行内 style 带 --dsh-workspace-indent），会话行 [data-row-key="session:<id>"]。
 * 失效时（DSH 改版找不到行）：「+」照常新建会话、数字与层级不出现、不自动展开——功能不丢。
 */
const ROW = '[data-row-key^="workspace:"]'
const SEC = '[class*="groupSection"]'
const wsRow = (id: string): string => '[data-row-key="workspace:' + CSS.escape(id) + '"]'
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SidebarHooks {
  /** 项目区工作区 id 与 卡片组子工作区 id → 卡片组 id。 */
  rows(): { hub: string | null; groups: Record<string, string> }
  pickCard(anchor: HTMLElement, groupId?: string): void
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
    + any(sec, ' > * > [data-row-key^="session:"]') + ' { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); padding-inline-start: 8px; }\n'
    + any(sec, ' > *:has(> [data-row-key^="session:"])') + ' { background: linear-gradient(var(--dpm-guide), var(--dpm-guide)) no-repeat calc(15.5px + var(--dsh-workspace-indent, 0px)) 0 / 1px 100%; }\n'
    + any(sec, ' > [class*="sessionOverflow"]') + ' { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); width: calc(100% - 24px - var(--dsh-workspace-indent, 0px)); padding-inline-start: 30px; }\n'
  for (const id of ids) {
    const n = counts[id]
    css += wsRow(id) + '::after { content: "' + n + '" / "' + (n ? n + ' 个活跃会话' : '没有活跃会话') + '";' + (n ? '' : ' background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; opacity: .7;') + (bump.has(id) ? ' animation: dpm-cnt-bump 420ms cubic-bezier(.2, .8, .2, 1);' : '') + ' }\n'
  }
  // 「项目区」自己的会话（不属于任何卡片组）：只在按工作区树嵌套时缩进到卡片组同一级
  if (hub) css += SEC + ':has(> * > ' + wsRow(hub) + '):has(> [role="group"]) > * > [data-row-key^="session:"] { margin-inline-start: 12px; padding-inline-start: 8px; }\n'
  return css
}

export class SidebarBridge {
  private readonly onCapture = (e: Event): void => {
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

  constructor(private readonly hooks: SidebarHooks) {}

  start(): void {
    document.addEventListener('click', this.onCapture, true)
    this.style = document.createElement('style')
    this.style.dataset.plugin = 'dsh-project-manager:rows'
    document.head.append(this.style)
  }

  stop(): void {
    document.removeEventListener('click', this.onCapture, true)
    clearTimeout(this.bumpTimer)
    this.style?.remove()
    this.style = null
  }

  /** 重画数字与层级。counts：卡片组子工作区 id → 活跃会话数。 */
  paint(hub: string | null, counts: Record<string, number>): void {
    if (!this.style) return
    const bump = new Set(Object.keys(counts).filter((k) => this.last[k] !== undefined && this.last[k] !== counts[k]))
    this.last = { ...counts }
    this.style.textContent = rowCss(hub, counts, bump)
    if (bump.size) { clearTimeout(this.bumpTimer); this.bumpTimer = window.setTimeout(() => { if (this.style) this.style.textContent = rowCss(hub, this.last, new Set()) }, 480) }
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
