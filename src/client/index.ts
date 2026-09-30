/**
 * dsh-project-manager client：主区看板面板 + 「项目区」行看板按钮/「+」接管 + 会话记忆提示 + 选卡片浮层。
 * 生命周期：所有 DOM/监听都挂在 ctx.effect 上，卸载即净（样式、按钮、浮层、toast 全部移除）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ApiError, getSession, getState, post, SessionInfo, Snapshot } from './api.js'
import { BoardView, SessionView } from './board.js'
import { esc, ic } from './icons.js'
import { SidebarBridge } from './sidebar.js'
import { CSS } from './style.gen.js'

const PANEL = 'dsh-project-manager:board'
let HUB_TITLE = '项目区'

type Theme = { getTheme(): { active: { colorScheme: string } }; setTheme(id: string): void }
type Ctx = {
  slots: { inject(name: string, fn: () => unknown): () => void; register(opts: Record<string, unknown>, comp: unknown): () => void }
  layout: { selectPanel(id: string | null): void }
  uiWorkspace: { openSession(id: string): void; pickDirectory?: () => Promise<string | null> }
  workspaces: { list: { subscribe(fn: () => void): () => void; getSnapshot(): { items: Array<{ workspaceId: string; path: string; title: string; sessionIds?: string[] }>; archivedSessionIds?: string[] } } }
  sessions: { create(opts: { workspaceId: string }): Promise<string>; list: { subscribe(fn: () => void): () => void; getSnapshot(): { ids: string[]; byId: Record<string, { id: string; title?: string; displayTitle: string; cwd?: string; updatedAt: number; parentId?: string; origin?: string; blank?: boolean }> } } }
  theme: Theme
  effect(fn: () => (() => void) | void, label?: string): void
  on(name: string, fn: (...a: unknown[]) => void): () => void
}

export const inject = ['slots', 'layout', 'uiWorkspace', 'sessions', 'theme', 'workspaces']

let boardOpen = false

export function apply(ctx: Ctx): void {
  ctx.effect(() => {
    const s = document.createElement('style')
    s.dataset.plugin = 'dsh-project-manager'
    s.textContent = CSS
    document.head.append(s)
    return () => s.remove()
  }, 'dsh-project-manager: css')

  // ── toast ──
  let toastBox: HTMLElement | null = null
  const toast = (msg: string, kind: 'ok' | 'err' = 'ok'): void => {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'dpm-toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox) }
    for (const n of Array.from(toastBox.children)) if (n.textContent === msg) n.remove()
    const el = document.createElement('div')
    el.className = 'toast' + (kind === 'err' ? ' err' : '')
    el.innerHTML = ic(kind === 'err' ? 'x' : 'check') + '<span>' + esc(msg) + '</span>'
    toastBox.append(el)
    while (toastBox.children.length > 2) toastBox.firstElementChild?.remove()
    setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2400)
  }
  ctx.effect(() => () => { toastBox?.remove(); toastBox = null }, 'dsh-project-manager: toast')

  const isDark = (): boolean => { try { return ctx.theme.getTheme().active.colorScheme === 'dark' } catch { return document.body.hasAttribute('data-ds-dark-theme') } }
  const setDark = (dark: boolean): void => { try { ctx.theme.setTheme(dark ? 'dark' : 'light') } catch (e) { toast('切换主题失败：' + String(e), 'err') } }

  // ── 新建项目会话：准备「项目区」工作区 → 新建会话 → 绑定卡片（权限+标题）→ 打开 ──
  let creating = false
  const newSession = async (cardId: string): Promise<void> => {
    if (creating) return
    creating = true
    try {
      const { workspaceId } = await post<{ workspaceId: string }>('session/prepare', { cardId })
      const sessionId = await ctx.sessions.create({ workspaceId })
      const r = await post<{ title: string | null; permission: boolean }>('session/bind', { sessionId, cardId })
      ctx.uiWorkspace.openSession(sessionId)
      bridge.refresh()
      toast('已在「' + HUB_TITLE + '」新建会话' + (r.permission ? ' · 完全权限' : ''))
    } catch (e) {
      toast('新建项目会话失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
    } finally { creating = false }
  }

  // ── 选卡片浮层 ──
  let pop: { el: HTMLElement; q: string; i: number; g?: string; snap: Snapshot; anchor: HTMLElement } | null = null
  const closePop = (): void => { pop?.el.remove(); pop = null }
  const popItems = (): Array<{ id: string; t: string; g: string; gname: string; st: string }> => {
    if (!pop) return []
    const b = pop.snap.board
    const out: Array<{ id: string; t: string; g: string; gname: string; st: string }> = []
    for (const g of b.groups) {
      if (pop.g && g.id !== pop.g) continue
      const cs = b.cards.filter((c) => c.g === g.id).sort((a, c) => g.statuses.findIndex((s) => s.id === a.col) - g.statuses.findIndex((s) => s.id === c.col) || a.order - c.order)
      for (const c of cs) {
        if (pop.q && !(c.t + ' ' + g.name).toLowerCase().includes(pop.q)) continue
        out.push({ id: c.id, t: c.t, g: g.id, gname: g.name, st: g.statuses.find((s) => s.id === c.col)?.name ?? '' })
      }
    }
    return out
  }
  const renderPop = (): void => {
    if (!pop) return
    const items = popItems()
    pop.i = Math.max(0, Math.min(pop.i, items.length - 1))
    let html = ''
    let last = ''
    items.forEach((c, k) => {
      if (c.g !== last) { html += '<li class="grp" role="presentation">' + esc(c.gname) + '</li>'; last = c.g }
      html += '<li class="opt" role="option" id="dpm-opt-' + esc(c.id) + '" data-pick="' + esc(c.id) + '" aria-selected="' + (k === pop!.i) + '"><span class="grow">' + esc(c.t) + '</span><span class="t">' + esc(c.st) + '</span></li>'
    })
    const list = pop.el.querySelector('ul') as HTMLElement
    list.innerHTML = html || '<li class="grp" role="presentation">' + (pop.snap.board.cards.length ? '没有匹配的卡片' : '还没有卡片，先去项目看板添加') + '</li>'
    const q = pop.el.querySelector('input') as HTMLInputElement
    q.setAttribute('aria-activedescendant', items[pop.i] ? 'dpm-opt-' + items[pop.i].id : '')
    pop.el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }
  let opening = false
  const pickCard = async (anchor: HTMLElement, groupId?: string): Promise<void> => {
    if (pop) { const same = pop.anchor === anchor; closePop(); if (same) return }
    if (opening) return
    opening = true
    let snap: Snapshot
    try { snap = await getState() } catch (e) { toast('读取看板失败：' + String(e), 'err'); opening = false; return }
    opening = false
    if (snap.hub?.title) HUB_TITLE = snap.hub.title
    const el = document.createElement('div')
    el.className = 'dpm-pop'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', '选择卡片')
    el.innerHTML = '<h3>新会话属于哪张卡片？</h3><label class="sr-only" for="dpmPopQ">搜索卡片</label><input id="dpmPopQ" role="combobox" aria-expanded="true" aria-controls="dpmPopList" autocomplete="off" placeholder="搜索卡片"><ul id="dpmPopList" role="listbox"></ul><p class="hint">↑↓ 选择 · 回车新建 · Esc 关闭</p>'
    document.body.append(el)
    const r = anchor.getBoundingClientRect()
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - 316)) + 'px'
    el.style.top = Math.min(r.bottom + 6, innerHeight - 360) + 'px'
    pop = { el, q: '', i: 0, g: groupId, snap, anchor }
    renderPop()
    const q = el.querySelector('input') as HTMLInputElement
    q.addEventListener('input', () => { if (!pop) return; pop.q = q.value.trim().toLowerCase(); pop.i = 0; renderPop() })
    q.addEventListener('keydown', (e) => {
      if (!pop) return
      const items = popItems()
      if (e.key === 'ArrowDown') { e.preventDefault(); pop.i = Math.min(items.length - 1, pop.i + 1); renderPop() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pop.i = Math.max(0, pop.i - 1); renderPop() }
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[pop.i]; if (it) { closePop(); void newSession(it.id) } }
      else if (e.key === 'Escape') { e.preventDefault(); const a = pop.anchor; closePop(); a.focus() }
    })
    el.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('[data-pick]') as HTMLElement | null
      if (li) { closePop(); void newSession(li.dataset.pick as string) }
    })
    setTimeout(() => q.focus(), 0)
  }
  ctx.effect(() => {
    const outside = (e: MouseEvent): void => { if (pop && !pop.el.contains(e.target as Node) && !pop.anchor.contains(e.target as Node)) closePop() }
    const onResize = (): void => closePop()
    document.addEventListener('mousedown', outside, true)
    addEventListener('resize', onResize)
    return () => { document.removeEventListener('mousedown', outside, true); removeEventListener('resize', onResize); closePop() }
  }, 'dsh-project-manager: picker')

  // ── 侧栏「项目区」行增强 ──
  const bridge = new SidebarBridge({ hubTitle: () => HUB_TITLE, boardOpen: () => boardOpen, openBoard: () => ctx.layout.selectPanel(PANEL), pickCard: (a) => void pickCard(a) })
  ctx.effect(() => { bridge.start(); return () => bridge.stop() }, 'dsh-project-manager: sidebar')
  // 标题跟随 host 配置（hubTitle）与工作区当前标题（用户在侧栏改名后仍能识别）
  void getState().then((s) => { if (s.hub?.title) { HUB_TITLE = s.hub.title; bridge.refresh() } }).catch(() => undefined)

  // ── 主区看板面板 ──
  const Board = (props: { usePanelInfo?: <T>(sel: (i: { activePanelId: string | null }) => T) => T }): unknown => {
    const ref = useRef<HTMLDivElement | null>(null)
    const active = props.usePanelInfo ? props.usePanelInfo((i) => i.activePanelId === PANEL) : true
    const [, bump] = useState(0)
    useEffect(() => { boardOpen = active; bridge.refresh() }, [active])
    useEffect(() => {
      const el = ref.current
      if (!el) return
      const view: BoardView = new BoardView(el, {
        newSession, openSession: (id) => ctx.uiWorkspace.openSession(id), isDark, setDark, toast, pickCard: (a, g) => void pickCard(a, g),
        // 挂载仓库候选 = dsh 侧栏里已添加的工作区（排除插件自己的「项目区」）
        workspaces: (): Array<{ title: string; path: string }> => {
          const items = ctx.workspaces.list.getSnapshot().items
          const hubPath: string | undefined = view.snap?.hub.path
          return items.filter((w) => w.path !== hubPath).map((w) => ({ title: w.title, path: w.path }))
        },
        // 全部会话 = ctx.sessions 列表（含冷会话与已归档），工作区归属与归档状态来自 ctx.workspaces；不列子代理会话
        allSessions: (): SessionView[] => {
          const ws = ctx.workspaces.list.getSnapshot()
          const arch = new Set(ws.archivedSessionIds ?? [])
          const owner = new Map<string, { title: string; id: string }>()
          for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, { title: w.path === view.snap?.hub.path ? HUB_TITLE : w.title, id: w.workspaceId })
          const st = ctx.sessions.list.getSnapshot()
          const out: SessionView[] = []
          for (const id of st.ids) {
            const s = st.byId[id]
            if (!s || s.parentId || s.origin === 'subagent') continue
            const o = owner.get(id)
            out.push({ id, title: s.title || s.displayTitle || id, ws: o?.title ?? (s.cwd ? s.cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || s.cwd : '未分组'), wsId: o?.id ?? null, updatedAt: s.updatedAt, archived: arch.has(id) })
          }
          return out
        },
        pickDirectory: async () => {
          if (typeof ctx.uiWorkspace.pickDirectory !== 'function') throw new Error('当前 dsh 版本没有 pickDirectory')
          return ctx.uiWorkspace.pickDirectory()
        },
      })
      const off = ctx.on('theme/change', () => { view.render(); bump((n) => n + 1) })
      // 会话改名 / 归档 / 恢复后，详情里的会话名与状态跟着变（只在详情打开时重绘，合并到一帧）
      let raf = 0
      const onStore = (): void => { if (raf || !view.sel) return; raf = requestAnimationFrame(() => { raf = 0; view.onSessionsChanged() }) }
      const offS = ctx.sessions.list.subscribe(onStore)
      const offW = ctx.workspaces.list.subscribe(onStore)
      return () => { off(); offS(); offW(); if (raf) cancelAnimationFrame(raf); view.dispose(); boardOpen = false; bridge.refresh() }
    }, [])
    return h('div', { ref, style: { height: '100%', minHeight: 0 } })
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Board)), 'dsh-project-manager: panel')

  // ── 降级入口：侧栏里找不到「项目区」行（尚未创建或结构改变）时，挂官方全局面板入口 ──
  const Glyph = (p: { size?: number }): unknown => h('svg', { viewBox: '0 0 24 24', width: p.size ?? 16, height: p.size ?? 16, 'aria-hidden': 'true', fill: 'currentColor', dangerouslySetInnerHTML: { __html: '<rect x="3.5" y="4" width="4.5" height="15" rx="2.25"/><rect x="9.75" y="4" width="4.5" height="9.5" rx="2.25"/><rect x="16" y="4" width="4.5" height="12.5" rx="2.25"/>' } })
  ctx.effect(() => {
    let off: (() => void) | null = null
    let misses = 0
    const tick = (): void => {
      // 连续两次（约 3 秒）都找不到「项目区」行才挂降级入口，避免侧栏重渲染瞬间闪烁
      misses = bridge.ready() ? 0 : misses + 1
      const want = misses >= 2
      if (want && !off) off = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: '项目看板' }, Glyph))
      if (!want && off) { off(); off = null }
    }
    const t = setInterval(tick, 1500)
    return () => { clearInterval(t); off?.() }
  }, 'dsh-project-manager: fallback entry')

  // ── 会话界面：已自动读取的记忆 ──
  const Dock = (props: { sessionId?: string; useSession?: <T>(sel: (s: { id?: string; sessionId?: string }) => T) => T }): unknown => {
    const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : undefined
    const sessionId = props.sessionId ?? viaHook
    const [info, setInfo] = useState<SessionInfo | null>(null)
    const [open, setOpen] = useState(true)
    useEffect(() => {
      let dead = false
      const id = sessionId
      if (!id) return
      const load = (): void => { getSession(id).then((r) => { if (!dead) setInfo(r) }).catch(() => { if (!dead) setInfo(null) }) }
      load()
      const t = setInterval(load, 8000)
      return () => { dead = true; clearInterval(t) }
    }, [sessionId])
    if (!info?.card) return null
    const mem = info.memory ?? []
    const readN = mem.filter((m) => m.read).length
    const fresh = mem.length - readN
    const head = !mem.length ? '这张卡片没有关联落盘项目，会话不读取记忆' : (fresh ? '已自动读取 ' + fresh + ' 个落盘项目的记忆' : '关联的落盘项目本会话都读过了') + (readN ? '，' + readN + ' 个已读过不重复读取' : '')
    return h('div', { className: 'dpm-dock' + (open ? ' open' : '') },
      h('button', { type: 'button', className: 'dock-h', 'aria-expanded': open, onClick: () => setOpen(!open) },
        h('span', { className: 'grow', title: info.card.group + ' / ' + info.card.title, dangerouslySetInnerHTML: { __html: ic('mem') + esc(head) } }),
        mem.length ? h('span', { className: 'chev', dangerouslySetInnerHTML: { __html: ic('chev') } }) : null),
      open && mem.length ? h('ul', null, mem.map((m) => h('li', { key: m.key }, h('b', null, m.slug), h('span', null, m.read ? '本会话已读过，不重复读取' : m.found ? (m.next || '暂无下一步') : '未找到 STATE')))) : null)
  }
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-project-manager:memory', order: 30 }, Dock)), 'dsh-project-manager: memory dock')
}
