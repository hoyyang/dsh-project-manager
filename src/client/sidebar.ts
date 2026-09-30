/**
 * 工作区列表里「项目区」行的增强（DOM 层，官方未开放行内插槽）：
 *  - 标题右侧插入看板按钮（append 到行内、CSS order 定位，不改动 React 管理的子节点顺序）；
 *  - 捕获阶段拦截该行「+」：先选卡片再建会话（不影响其他工作区的「+」）。
 * 依据：dsh-client-ui-workspace 0.1.5 行结构 [role=treeitem][aria-expanded]、标题 [class*=projectText] [class*=title]、
 *       操作区 [class*=rowActions]、「+」aria-label「在“X”中新建会话」；先例 dsh-manage-sessions/src/client/workspace-copy.ts。
 * 降级：找不到结构时 ready()=false，由 index.ts 改用官方 panellist 入口，功能不丢。
 */
import { BOARD_GLYPH } from './icons.js'

const ROW = '[role="treeitem"][aria-expanded]'
const MARK = 'data-dpm-kb'

export interface SidebarHooks {
  hubTitle(): string
  boardOpen(): boolean
  openBoard(): void
  pickCard(anchor: HTMLElement): void
}

export class SidebarBridge {
  private obs: MutationObserver | null = null
  private scheduled = false
  private seen = false
  private readonly onCapture = (e: Event): void => {
    const b = (e.target as HTMLElement | null)?.closest?.('button') as HTMLButtonElement | null
    if (!b || b.hasAttribute(MARK)) return
    const row = b.closest(ROW) as HTMLElement | null
    if (!row || !this.isHubRow(row)) return
    const label = b.getAttribute('aria-label') ?? ''
    if (!/新建会话|New session/i.test(label)) return
    e.stopPropagation()
    e.preventDefault()
    this.hooks.pickCard(b)
  }

  constructor(private readonly hooks: SidebarHooks) {}

  start(): void {
    document.addEventListener('click', this.onCapture, true)
    this.obs = new MutationObserver(() => this.schedule())
    this.obs.observe(document.body, { childList: true, subtree: true })
    this.schedule()
  }

  stop(): void {
    document.removeEventListener('click', this.onCapture, true)
    this.obs?.disconnect()
    this.obs = null
    document.querySelectorAll('[' + MARK + ']').forEach((n) => n.remove())
  }

  /** 当前侧栏里是否有「项目区」行（index.ts 据此决定是否启用 panellist 降级入口）。 */
  ready(): boolean { return this.seen }

  refresh(): void { this.schedule() }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => { this.scheduled = false; this.augment() })
  }

  private titleOf(row: HTMLElement): string {
    const t = row.querySelector('[class*="projectText"] [class*="title"]') ?? row.querySelector('[class*="title"]')
    return (t?.textContent ?? '').trim()
  }

  private isHubRow(row: HTMLElement): boolean { return this.titleOf(row) === this.hooks.hubTitle() }

  private augment(): void {
    const open = this.hooks.boardOpen()
    let found = false
    for (const row of Array.from(document.querySelectorAll<HTMLElement>(ROW))) {
      const existing = row.querySelector<HTMLButtonElement>('[' + MARK + ']')
      if (!this.isHubRow(row)) { existing?.remove(); continue }
      found = true
      const titleBox = (row.querySelector('[class*="projectText"]') ?? row.querySelector('[class*="title"]')?.parentElement) as HTMLElement | null
      if (!titleBox) continue
      let btn = existing
      if (!btn) {
        btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'dpm-kb'
        btn.setAttribute(MARK, '')
        btn.setAttribute('aria-label', '打开项目看板')
        btn.innerHTML = BOARD_GLYPH + '<span class="tip" aria-hidden="true">项目看板</span>'
        btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.hooks.openBoard() })
        btn.addEventListener('pointerdown', (e) => e.stopPropagation())
        titleBox.appendChild(btn)
      }
      btn.setAttribute('aria-pressed', String(open))
    }
    this.seen = found
  }
}
