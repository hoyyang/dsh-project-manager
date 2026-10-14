/**
 * dsh-project-manager client：主区看板面板 + 全局面板「项目看板」主按钮 + 「项目区」/卡片组行「+」接管 + 会话记忆提示 + 选卡片浮层。
 * 生命周期：所有 DOM/监听都挂在 ctx.effect 上，卸载即净（样式、按钮、浮层、toast 全部移除）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ApiError, getState, post, Snapshot } from './api.js'
import { ago, ArchiveActivity, BoardView, SessionView } from './board.js'
import { esc, ic } from './icons.js'
import { blankRows, SidebarBridge } from './sidebar.js'
import { CSS as STYLE } from './style.gen.js'
import { BoardEntry, doingCount } from './entry.js'
import { marquee, SessionCard } from './dock.js'

const PANEL = 'dsh-project-manager:board'
let HUB_TITLE = '项目区'

type Theme = { getTheme(): { active: { colorScheme: string } }; setTheme(id: string): void }
type Ctx = {
  slots: { inject(name: string, fn: () => unknown): () => void; register(opts: Record<string, unknown>, comp: unknown): () => void }
  layout: { selectPanel(id: string | null): void; panelInfo?: { getSnapshot(): { activePanelId: string | null }; subscribe(fn: () => void): () => void } }
  uiWorkspace: { openSession(id: string): void; pickDirectory?: () => Promise<string | null> }
  workspaces: { archiveSession?: (id: string, opts?: { stopActivity?: boolean }) => Promise<void>; unarchiveSession?: (id: string) => Promise<void>; list: { subscribe(fn: () => void): () => void; getSnapshot(): { items: Array<{ workspaceId: string; path: string; title: string; sessionIds?: string[] }>; archivedSessionIds?: string[] } } }
  sessions: { create(opts: { workspaceId: string }): Promise<string>; using?<T>(id: string, o: { source: string }, fn: (r: { binding: { session: { prompt(c: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<{ ok: boolean; error?: { code?: string; message?: string } }> } } }) => Promise<T>): Promise<T>; list: { subscribe(fn: () => void): () => void; getSnapshot(): { ids: string[]; byId: Record<string, { id: string; title?: string; displayTitle: string; cwd?: string; updatedAt: number; parentId?: string; origin?: string; blank?: boolean; retainedBy?: Record<string, number> }> } } }
  theme: Theme
  effect(fn: () => (() => void) | void, label?: string): void
  on(name: string, fn: (...a: unknown[]) => void): () => void
}

export const inject = ['slots', 'layout', 'uiWorkspace', 'sessions', 'theme', 'workspaces']

/** 用户当前的侧栏分组方式是不是「按工作区树」（读 dsh 工作区浏览器存在本地的视图设置；非公开 → 读不到按否处理）。 */
export function treeMode(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem('dsh.workspace.view.v5') ?? 'null') as { groupBy?: string; state?: { groupBy?: string } } | null
    return (v?.groupBy ?? v?.state?.groupBy) === 'workspace-tree'
  } catch { return false }
}

export function apply(ctx: Ctx): void {
  ctx.effect(() => {
    const s = document.createElement('style')
    s.dataset.plugin = 'dsh-project-manager'
    s.textContent = STYLE
    document.head.append(s)
    return () => s.remove()
  }, 'dsh-project-manager: css')

  // ── toast ──
  let toastBox: HTMLElement | null = null
  const toast = (msg: string, kind: 'ok' | 'err' = 'ok', action?: { label: string; run: () => void }): void => {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'dpm-toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox) }
    for (const n of Array.from(toastBox.children)) if (n.textContent === msg) n.remove()
    const el = document.createElement('div')
    el.className = 'toast' + (kind === 'err' ? ' err' : '')
    el.innerHTML = ic(kind === 'err' ? 'x' : 'check') + '<span>' + esc(msg) + '</span>'
    if (action) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ta'
      b.textContent = action.label
      b.addEventListener('click', () => { el.remove(); action.run() })
      el.append(b)
    }
    toastBox.append(el)
    while (toastBox.children.length > 2) toastBox.firstElementChild?.remove()
    // 带「撤销」的提示多留一会儿（与 dsh 侧栏归档提示同样是长提示）
    setTimeout(() => el.remove(), kind === 'err' ? 5000 : action ? 6000 : 2400)
  }
  ctx.effect(() => () => { toastBox?.remove(); toastBox = null }, 'dsh-project-manager: toast')

  const isDark = (): boolean => { try { return ctx.theme.getTheme().active.colorScheme === 'dark' } catch { return document.body.hasAttribute('data-ds-dark-theme') } }
  const setDark = (dark: boolean): void => { try { ctx.theme.setTheme(dark ? 'dark' : 'light') } catch (e) { toast('切换主题失败：' + String(e), 'err') } }

  // ── 新建项目会话：准备「项目区」工作区 → 新建会话 → 绑定卡片（权限+标题）→ 打开 ──
  let creating = false
  // 0.20：点了立刻反馈（看板按钮进入「正在新建」并锁住、侧栏先出现占位行）；建好后先刷新看板快照再打开，
  // 侧栏补画行第一次出现就带卡片标题（宿主那行只会写「新会话」）
  const newSession = async (cardId: string): Promise<void> => {
    if (creating) { toast('正在新建会话，稍等一下'); return }
    creating = true
    closeNs()
    boardView?.setCreating(cardId)
    const card = live.snap?.board.cards.find((c) => c.id === cardId)
    const gws = card ? live.snap?.hub.groups?.[card.g] : undefined
    if (gws && card) bridge.setPending({ ws: gws, title: card.t })
    try {
      const { workspaceId, workspaceTitle } = await post<{ workspaceId: string; workspaceTitle: string }>('session/prepare', { cardId })
      if (!gws && card) bridge.setPending({ ws: workspaceId, title: card.t })
      const sessionId = await ctx.sessions.create({ workspaceId })
      const r = await post<{ title: string | null; permission: boolean }>('session/bind', { sessionId, cardId, tree: treeMode() })
      await live.refresh().catch(() => undefined)
      bridge.setPending(null)
      openAndReveal(sessionId, workspaceId)
      toast('已在「' + workspaceTitle + '」新建' + (r.title ? '「' + r.title + '」' : '会话') + (r.permission ? ' · 完全权限' : ''))
    } catch (e) {
      bridge.setPending(null)
      toast('新建项目会话失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
    } finally { creating = false; boardView?.setCreating(null) }
  }

  // ── 选卡片浮层 ──
  let pop: { el: HTMLElement; q: string; i: number; g?: string; snap: Snapshot; anchor: HTMLElement } | null = null
  const closePop = (): void => { pop?.el.remove(); pop = null }
  type PopItem = { id: string; t: string; g: string; gname: string; st: string; mem: number; sess: number }
  const popItems = (): PopItem[] => {
    if (!pop) return []
    const b = pop.snap.board
    const out: PopItem[] = []
    for (const g of b.groups) {
      if (pop.g && g.id !== pop.g) continue
      const cs = b.cards.filter((c) => c.g === g.id && !c.archivedAt).sort((a, c) => g.statuses.findIndex((s) => s.id === a.col) - g.statuses.findIndex((s) => s.id === c.col) || a.order - c.order)
      for (const c of cs) {
        if (pop.q && !(c.t + ' ' + g.name).toLowerCase().includes(pop.q)) continue
        const mem = new Set([...g.links, ...c.links]).size
        out.push({ id: c.id, t: c.t, g: g.id, gname: g.name, st: g.statuses.find((s) => s.id === c.col)?.name ?? '', mem, sess: b.sessions.filter((s) => s.cardId === c.id).length })
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
    // 每行两层：卡片名（搜索词高亮）+ 阶段 / 记忆数 / 会话数；悬停与上下键共用 aria-selected 高亮
    const hl = (t: string): string => { const q = pop!.q; const i = q ? t.toLowerCase().indexOf(q) : -1; return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)) }
    items.forEach((c, k) => {
      if (c.g !== last) { html += '<li class="grp" role="presentation">' + esc(c.gname) + '<span class="n">' + items.filter((x) => x.g === c.g).length + '</span></li>'; last = c.g }
      html += '<li class="opt" role="option" id="dpm-opt-' + esc(c.id) + '" data-pick="' + esc(c.id) + '" data-k="' + k + '" aria-selected="' + (k === pop!.i) + '"><span class="nm">' + hl(c.t) + '</span>'
        + '<span class="mt"><span class="stg">' + esc(c.st) + '</span>' + (c.mem ? '<span class="mm">' + ic('mem') + c.mem + ' 个记忆</span>' : '<span class="mm no">' + ic('mem') + '未关联记忆</span>')
        + '<span>' + (c.sess ? c.sess + ' 个会话' : '无会话') + '</span></span><span class="go" aria-hidden="true">' + ic('arrow') + '</span></li>'
    })
    const list = pop.el.querySelector('ul') as HTMLElement
    list.innerHTML = html || '<li class="empty" role="presentation">' + (pop.q ? '没有匹配「' + esc(pop.q) + '」的卡片' : pop.snap.board.cards.length ? '没有匹配的卡片' : '还没有卡片，先去项目看板添加') + '</li>'
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
    el.innerHTML = '<div class="ph"><h3>新会话属于哪张卡片？</h3><p>选好卡片后，再选新建会话或打开它已关联的会话</p></div>'
      + '<div class="qw">' + ic('search') + '<label class="sr-only" for="dpmPopQ">搜索卡片</label><input id="dpmPopQ" role="combobox" aria-expanded="true" aria-controls="dpmPopList" autocomplete="off" placeholder="搜索卡片或卡片组"></div>'
      + '<ul id="dpmPopList" role="listbox" aria-label="卡片"></ul><p class="hint"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>下一步</span><span><kbd>Esc</kbd>关闭</span></p>'
    document.body.append(el)
    const r = anchor.getBoundingClientRect()
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - 356)) + 'px'
    el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 470)) + 'px'
    pop = { el, q: '', i: 0, g: groupId, snap, anchor }
    renderPop()
    const q = el.querySelector('input') as HTMLInputElement
    q.addEventListener('input', () => { if (!pop) return; pop.q = q.value.trim().toLowerCase(); pop.i = 0; renderPop() })
    q.addEventListener('keydown', (e) => {
      if (!pop) return
      const items = popItems()
      if (e.key === 'ArrowDown') { e.preventDefault(); pop.i = Math.min(items.length - 1, pop.i + 1); renderPop() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pop.i = Math.max(0, pop.i - 1); renderPop() }
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[pop.i]; if (it) { const s = pop.snap; closePop(); openNs(it.id, s) } }
      else if (e.key === 'Escape') { e.preventDefault(); const a = pop.anchor; closePop(); a.focus() }
    })
    el.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('[data-pick]') as HTMLElement | null
      if (li && pop) { const s = pop.snap; closePop(); openNs(li.dataset.pick as string, s) }
    })
    // 鼠标移动只切换高亮（不重绘列表、不抢滚动）
    el.addEventListener('mousemove', (e) => {
      const li = (e.target as HTMLElement).closest('.opt') as HTMLElement | null
      if (!li || !pop) return
      const k = Number(li.dataset.k)
      if (k === pop.i) return
      pop.i = k
      el.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-selected', String(o === li)))
      q.setAttribute('aria-activedescendant', li.id)
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

  // ── 「新建会话」弹窗：单选 新建一个会话 / 已关联会话（活跃在前，已归档不能选、可就地恢复）──
  let ns: { dlg: HTMLDialogElement; card: string; sel: string; snap: Snapshot; busy: Set<string>; fresh?: string } | null = null
  const closeNs = (): void => { const d = ns?.dlg; ns = null; if (d?.open) d.close(''); d?.remove() }
  const nsSessions = (cardId: string): Array<{ id: string; title: string; ws: string; updatedAt: number; archived: boolean }> => {
    const ws = ctx.workspaces.list.getSnapshot()
    const arch = new Set(ws.archivedSessionIds ?? [])
    const owner = new Map<string, string>()
    for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, w.title)
    const st = ctx.sessions.list.getSnapshot()
    const refs = (ns?.snap.board.sessions ?? []).filter((s) => s.cardId === cardId)
    const out = refs.flatMap((r) => { const s = st.byId[r.sessionId]; return s ? [{ id: r.sessionId, title: s.title || s.displayTitle || r.title || r.sessionId, ws: owner.get(r.sessionId) ?? '未分组', updatedAt: s.updatedAt, archived: arch.has(r.sessionId) }] : [] })
    return out.sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt - a.updatedAt)
  }
  const renderNs = (): void => {
    if (!ns) return
    const b = ns.snap.board
    const c = b.cards.find((x) => x.id === ns!.card)
    const g = c && b.groups.find((x) => x.id === c.g)
    if (!c || !g) { closeNs(); toast('卡片已不存在', 'err'); return }
    const mem = new Set([...g.links, ...c.links]).size
    const list = nsSessions(c.id)
    if (ns.sel !== '__new' && !list.some((s) => s.id === ns!.sel && !s.archived)) ns.sel = '__new'
    const st = (ns.snap.states ?? [])
    const sug = mem ? null : st.filter((x) => x.slug.length >= 6 && c.t.toLowerCase().includes(x.slug.toLowerCase())).sort((a, z) => z.slug.length - a.slug.length)[0]
    const canRestore = ns.snap.caps?.unarchive !== false
    const row = (s: (typeof list)[number]): string => '<label class="ns-row' + (s.archived ? ' dis' : '') + (s.id === ns!.fresh ? ' fresh' : '') + '"' + (s.archived ? ' title="已归档的会话不能直接打开，先「恢复活跃」"' : '') + '>'
      + '<input type="radio" name="dpmNs" value="' + esc(s.id) + '"' + (s.archived ? ' disabled' : '') + (ns!.sel === s.id ? ' checked' : '') + '>'
      + '<span class="txt"><span class="nm">' + esc(s.title) + '</span><span class="sub">' + (s.archived ? '<span class="chip arch">已归档</span>' : '<span class="chip live">活跃</span>') + '<span>' + esc(s.ws) + ' · ' + esc(ago(s.updatedAt)) + '</span></span></span>'
      + (s.archived ? '<button type="button" class="btn ghost xs" data-ns-restore="' + esc(s.id) + '"' + (canRestore && !ns!.busy.has(s.id) ? '' : ' disabled') + ' title="' + (canRestore ? '恢复到工作区原来的位置' : '当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）') + '">' + ic('restore') + (ns!.busy.has(s.id) ? '恢复中…' : '恢复活跃') + '</button>' : '') + '</label>'
    ;(ns.dlg.querySelector('#dpmNsP') as HTMLElement).innerHTML = esc(g.name) + ' · <b>' + esc(c.t) + '</b>'
    ;(ns.dlg.querySelector('#dpmNsList') as HTMLElement).innerHTML = (sug ? '<div class="ns-sug">' + ic('info') + '<span class="grow">这张卡片还没关联落盘项目。发现同名落盘项目 <b>' + esc(sug.slug) + '</b></span><button type="button" class="btn xs" data-ns-link="' + esc(sug.key) + '">' + ic('link') + '关联到卡片</button></div>' : '')
      + '<label class="ns-row new"><input type="radio" name="dpmNs" value="__new"' + (ns.sel === '__new' ? ' checked' : '') + '><span class="ni">' + ic('plus') + '</span><span class="txt"><span class="nm">新建一个会话</span><span class="sub"><span>在「' + esc(HUB_TITLE + ' / ' + g.name) + '」新建，名称「' + esc(treeMode() ? c.t : g.name + ' · ' + c.t) + '」，自动关联这张卡片 · ' + (mem ? '读取 ' + mem + ' 个落盘项目的记忆' : '不读取记忆（未关联落盘项目）') + ' · 完全权限</span></span></span></label>'
      + '<div class="ns-sec">已关联的会话 · ' + list.length + '</div>'
      + (list.length ? list.map(row).join('') : '<div class="ns-empty">这张卡片还没有关联会话</div>')
    ns.fresh = undefined
  }
  const openNs = (cardId: string, snap: Snapshot): void => {
    closeNs()
    const dlg = document.createElement('dialog')
    dlg.className = 'dpm-dialog wide'
    dlg.setAttribute('aria-labelledby', 'dpmNsT')
    dlg.innerHTML = '<form method="dialog"><div class="dlg-h"><h2 id="dpmNsT">新建会话</h2><p id="dpmNsP"></p></div>'
      + '<div class="dlg-b"><div id="dpmNsList" role="radiogroup" aria-labelledby="dpmNsT"></div></div>'
      + '<div class="dlg-f"><span class="meta">双击一项可直接打开</span><span class="sp"></span><button class="btn" type="button" data-ns-cancel>取消</button><button class="btn primary" type="submit" value="ok">' + ic('play') + '打开会话</button></div></form>'
    document.body.append(dlg)
    ns = { dlg, card: cardId, sel: '__new', snap, busy: new Set() }
    renderNs()
    dlg.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (ns && t.name === 'dpmNs') ns.sel = t.value })
    dlg.addEventListener('dblclick', (e) => { const r = (e.target as HTMLElement).closest('.ns-row:not(.dis)'); if (r && ns) { ns.sel = (r.querySelector('input') as HTMLInputElement).value; dlg.close('ok') } })
    dlg.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
      if (!t || !ns) return
      if (t.dataset.nsCancel !== undefined) { dlg.close(''); return }
      if (t.dataset.nsRestore) { e.preventDefault(); void restoreNs(t.dataset.nsRestore); return }
      if (t.dataset.nsLink) { e.preventDefault(); void linkNs(t.dataset.nsLink) }
    })
    dlg.addEventListener('close', () => {
      const cur = ns
      if (!cur || cur.dlg !== dlg) return
      const ok = dlg.returnValue === 'ok'
      ns = null
      dlg.remove()
      if (!ok) return
      if (cur.sel === '__new') void newSession(cur.card)
      else openAndReveal(cur.sel)
    })
    dlg.showModal()
    ;(dlg.querySelector('input:checked') as HTMLElement | null)?.focus()
  }
  const restoreNs = async (sessionId: string): Promise<void> => {
    if (!ns || ns.busy.has(sessionId)) return
    ns.busy.add(sessionId); renderNs()
    try {
      const r = await post<Snapshot & { result: { restored: boolean } }>('session/unarchive', { sessionId })
      if (!ns) return
      ns.snap = r
      ns.fresh = sessionId
      toast(r.result.restored ? '已恢复，现在可以选择打开' : '这个会话已经是活跃状态')
    } catch (e) { toast('恢复失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
    finally {
      if (ns) { ns.busy.delete(sessionId); renderNs(); (ns.dlg.querySelector('input[value="' + CSS.escape(sessionId) + '"]') as HTMLElement | null)?.focus() }
    }
  }
  const linkNs = async (key: string): Promise<void> => {
    if (!ns) return
    const c = ns.snap.board.cards.find((x) => x.id === ns!.card)
    if (!c) return
    try { ns.snap = await post<Snapshot>('card/update', { id: c.id, links: [...c.links, key] }); renderNs(); toast('已关联落盘项目，新会话会自动读取记忆') }
    catch (e) { toast('关联失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
  }
  // 会话 / 工作区推送（归档、恢复、改名）时刷新弹窗
  ctx.effect(() => {
    let raf = 0
    const on = (): void => { if (!ns || raf) return; raf = requestAnimationFrame(() => { raf = 0; renderNs() }) }
    const a = ctx.sessions.list.subscribe(on)
    const b = ctx.workspaces.list.subscribe(on)
    return () => { a(); b(); if (raf) cancelAnimationFrame(raf); closeNs() }
  }, 'dsh-project-manager: new-session dialog')

  // ── 看板快照（主按钮徽标 + 侧栏组行映射）：轻量轮询，没变化时服务端只回 same ──
  const live = { snap: null as Snapshot | null, subs: new Set<() => void>(), refresh: async (): Promise<void> => {} }
  live.refresh = async (): Promise<void> => {
    try {
      const r = await getState(live.snap ? live.snap.rev : undefined)
      if (r.same) return
      live.snap = r
      if (r.hub?.title) HUB_TITLE = r.hub.title
      for (const f of live.subs) f()
    } catch { /* 下一轮再试；看板里会点名报错 */ }
  }
  ctx.effect(() => {
    void live.refresh()
    const t = setInterval(() => { if (!document.hidden) void live.refresh() }, 5000)
    return () => clearInterval(t)
  }, 'dsh-project-manager: snapshot poll')

  // ── 侧栏「项目区」/卡片组行「+」接管 ──
  const bridge = new SidebarBridge({
    rows: () => { const h = live.snap?.hub; const groups: Record<string, string> = {}; for (const [g, w] of Object.entries(h?.groups ?? {})) groups[w] = g; return { hub: h?.workspaceId ?? null, groups } },
    pickCard: (a, g) => void pickCard(a, g),
    open: (id) => ctx.uiWorkspace.openSession(id),
    canDelete: () => canDelete,
    del: (id, title) => void deleteSession(id, title),
  })
  ctx.effect(() => { bridge.start(); return () => bridge.stop() }, 'dsh-project-manager: sidebar')

  /** 0.11：会话所在的工作区 id（没归到任何工作区 = null）。 */
  const ownerOf = (sessionId: string): string | null => {
    for (const w of ctx.workspaces.list.getSnapshot().items) if (w.sessionIds?.includes(sessionId)) return w.workspaceId
    return null
  }
  /** 0.11：从看板进入会话（打开已有 / 新建）——打开后，会话所在的卡片组或「项目区」在侧栏收起着就展开。其他工作区的会话不动。 */
  const openAndReveal = (sessionId: string, wsId?: string): void => {
    ctx.uiWorkspace.openSession(sessionId)
    const h = live.snap?.hub
    const ws = wsId ?? ownerOf(sessionId)
    if (!h || !ws || (ws !== h.workspaceId && !Object.values(h.groups ?? {}).includes(ws))) return
    void bridge.reveal(sessionId, ws, h.workspaceId ?? null)
  }

  // ── 0.13：删除还没对话的会话（数据层面）——借用 dsh-manage-sessions 的事务删除（停空闲会话 → 写锁 → 移走会话目录 → 官方 forgetSession 清登记）。
  //    没装它 / 它报告不能删时不显示删除按钮。只对 blank（还没对话）的会话开放。
  const DSM = '/dsh-manage-sessions'
  let canDelete = false
  ctx.effect(() => {
    let dead = false
    fetch(DSM + '/capabilities', { cache: 'no-store' }).then((r) => r.json()).then((b: { ok?: boolean; capabilities?: { delete?: boolean } }) => {
      if (dead || !(b?.ok && b.capabilities?.delete)) return
      canDelete = true
      for (const f of live.subs) f()
    }).catch(() => { /* 没装 dsh-manage-sessions：不提供删除 */ })
    return () => { dead = true; canDelete = false }
  }, 'dsh-project-manager: delete capability')
  const DEL_HINT: Record<string, string> = { blocked: '会话正在运行或被别的窗口占用，先停止再删', 'capability-missing': '当前 DSH 不支持删除会话（dsh-manage-sessions 缺少宿主能力）', 'unknown-session': '会话已经不存在了' }
  let delDlg: HTMLDialogElement | null = null
  const closeDel = (): void => { if (delDlg?.open) delDlg.close(''); delDlg?.remove(); delDlg = null }
  ctx.effect(() => closeDel, 'dsh-project-manager: delete dialog')
  const doDelete = async (id: string, title: string): Promise<boolean> => {
    const s = ctx.sessions.list.getSnapshot().byId[id]
    if (!s) { toast('会话「' + title + '」已经不存在了', 'err'); return false }
    if (!s.blank) { toast('「' + title + '」已经有对话了，不能删除，可以归档', 'err'); return false }
    let r: { ok?: boolean; error?: { code?: string; message?: string } }
    try {
      r = await (await fetch(DSM + '/delete', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })).json()
    } catch (e) { toast('删除「' + title + '」失败：连不上 dsh-manage-sessions（' + String(e) + '）', 'err'); return false }
    if (!r?.ok) { const c = r?.error?.code ?? ''; toast('删除「' + title + '」失败：' + (DEL_HINT[c] ?? r?.error?.message ?? '未知错误') + (c ? '（' + c + '）' : ''), 'err'); return false }
    // 会话已删；卡片上的关联一并去掉（不然详情里会剩一行「会话已删除」）
    if (live.snap?.board.sessions.some((x) => x.sessionId === id)) { try { await post('session/unlink', { sessionId: id }) } catch (e) { toast('会话已删除，但解除卡片关联失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') } }
    void live.refresh()
    toast('已删除「' + title + '」')
    return true
  }
  /** 确认后删除；返回是否真的删了（取消 / 失败 = false）。 */
  const deleteSession = (id: string, title: string): Promise<boolean> => new Promise((done) => {
    closeDel()
    const dlg = document.createElement('dialog')
    dlg.className = 'dpm-dialog'
    dlg.setAttribute('aria-labelledby', 'dpmDelT')
    dlg.innerHTML = '<form method="dialog"><div class="dlg-h"><h2 id="dpmDelT">删除「' + esc(title) + '」？</h2><p>这个会话还没有对话。删除后会从 DSH 里彻底移除（会话文件一起删掉），不能恢复。</p></div>'
      + '<div class="dlg-f"><span class="sp"></span><button class="btn" type="submit" value="">取消</button><button class="btn primary danger-fill" type="submit" value="ok" data-del-ok>' + ic('trash') + '删除</button></div></form>'
    document.body.append(dlg)
    delDlg = dlg
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok'
      if (delDlg === dlg) { delDlg = null; dlg.remove() }
      if (!ok) { done(false); return }
      void doDelete(id, title).then(done)
    })
    dlg.showModal()
    ;(dlg.querySelector('button[value=""]') as HTMLElement | null)?.focus()
  })

  // ── 0.15：0.14 之前分出的分叉会话补关联到源会话的卡片（宿主 fork 后子会话带 parentId；服务端写盘前备份） ──
  ctx.effect(() => {
    const tried = new Set<string>()
    let busy = false
    const run = (): void => {
      const snap = live.snap
      if (busy || !snap) return
      const refs = new Set(snap.board.sessions.map((s) => s.sessionId))
      const byId = ctx.sessions.list.getSnapshot().byId
      const pairs: Array<{ child: string; parent: string }> = []
      for (const [id, s] of Object.entries(byId)) {
        if (!s || s.origin === 'subagent' || !s.parentId || s.parentId === id || tried.has(id) || refs.has(id) || !refs.has(s.parentId)) continue
        pairs.push({ child: id, parent: s.parentId })
      }
      if (!pairs.length) return
      for (const p of pairs) tried.add(p.child)
      busy = true
      post<Snapshot & { result: { bound: Array<{ child: string; card: string }> } }>('session/fork-backfill', { pairs })
        .then((r) => { if (r.result.bound.length) { live.snap = r; for (const f of live.subs) f() } })
        .catch((e) => console.warn('[dsh-project-manager] 分叉会话补关联失败：', pairs, e))
        .finally(() => { busy = false })
    }
    const a = ctx.sessions.list.subscribe(run)
    live.subs.add(run)
    run()
    return () => { a(); live.subs.delete(run) }
  }, 'dsh-project-manager: fork backfill')

  // ── 0.11：卡片组行的活跃会话数（= 该子工作区里没归档的会话，不含子代理），会话 / 工作区 / 看板一变就重画 ──
  ctx.effect(() => {
    let raf = 0
    const paint = (): void => {
      raf = 0
      const h = live.snap?.hub
      if (!h) { bridge.setBlanks({}); return bridge.paint(null, {}) }
      const ws = ctx.workspaces.list.getSnapshot()
      const arch = new Set(ws.archivedSessionIds ?? [])
      const byId = ctx.sessions.list.getSnapshot().byId
      const counts: Record<string, number> = {}
      for (const wid of Object.values(h.groups ?? {})) {
        const w = ws.items.find((x) => x.workspaceId === wid)
        // 0.15：分叉会话也带 parentId（源会话 id），只有 origin = subagent 才是子代理
        counts[wid] = (w?.sessionIds ?? []).filter((id) => !arch.has(id) && byId[id] !== undefined && byId[id].origin !== 'subagent').length
      }
      bridge.paint(h.workspaceId ?? null, counts)
      // 0.12：只针对「项目区」及其卡片组子工作区
      const titles: Record<string, string | undefined> = {}
      for (const r of live.snap?.board.sessions ?? []) titles[r.sessionId] = r.title
      bridge.setBlanks(blankRows(ws.items, byId, arch, [...(h.workspaceId ? [h.workspaceId] : []), ...Object.values(h.groups ?? {})], titles))
    }
    const on = (): void => { if (!raf) raf = requestAnimationFrame(paint) }
    const a = ctx.sessions.list.subscribe(on)
    const b = ctx.workspaces.list.subscribe(on)
    live.subs.add(on)
    on()
    return () => { a(); b(); live.subs.delete(on); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: group counts')

  /**
   * 0.10：在看板里归档会话后留在看板。dsh 的导航策略在「主视图当前会话被归档」时 clearMain → selectPanel(null)，
   * 把看板面板关掉、落到新建会话页；归档期间若看板是当前面板，它被关掉的第一次立刻重新选回（只拦一次，返回释放函数）。
   */
  const keepBoard = (): (() => void) => {
    const pi = ctx.layout.panelInfo
    if (!pi || typeof pi.subscribe !== 'function' || pi.getSnapshot().activePanelId !== PANEL) return () => undefined
    let off: (() => void) | null = null
    off = pi.subscribe(() => {
      if (pi.getSnapshot().activePanelId !== null) return
      off?.(); off = null
      ctx.layout.selectPanel(PANEL)
    })
    return () => { off?.(); off = null }
  }

  // ── 0.19 从会话信息卡直达看板：打开面板、选中卡片、闪一下 ──
  let boardView: BoardView | null = null
  let pendingCard: string | null = null
  const openBoardAt = (cardId: string): void => {
    pendingCard = cardId
    ctx.layout.selectPanel(PANEL)
    if (boardView) { void boardView.focusCard(cardId); pendingCard = null }
  }

  // ── 主区看板面板 ──
  const Board = (props: { usePanelInfo?: <T>(sel: (i: { activePanelId: string | null }) => T) => T }): unknown => {
    const ref = useRef<HTMLDivElement | null>(null)
    const [, bump] = useState(0)
    useEffect(() => {
      const el = ref.current
      if (!el) return
      let vref: BoardView | null = null
      const view: BoardView = new BoardView(el, {
        newSession, openSession: (id) => openAndReveal(id), isDark, setDark, toast, pickCard: (a, g) => void pickCard(a, g),
        canDeleteSession: () => canDelete,
        // 0.15：先用侧栏轮询已有的快照立刻画出（不等第一次请求），之后看板自己同步
        seed: () => live.snap,
        deleteSession,
        // 0.16：回忆 / 落盘 按钮 → 发到卡片最近的活跃会话（没有就新建一个）并打开
        sendToCard: async (cardId, text) => {
          const s = ctx.sessions
          if (typeof s.using !== 'function') throw new Error('当前 dsh 版本不能从看板给会话发消息（sessions.using 不存在）')
          const snap = live.snap ?? await getState()
          const arch = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? [])
          const byId = s.list.getSnapshot().byId
          let id = snap.board.sessions.filter((r) => r.cardId === cardId && byId[r.sessionId] && !arch.has(r.sessionId)).map((r) => r.sessionId).sort((a, b) => (byId[b]?.updatedAt ?? 0) - (byId[a]?.updatedAt ?? 0))[0]
          let ws: string | undefined
          if (!id) {
            const p = await post<{ workspaceId: string }>('session/prepare', { cardId })
            id = await s.create({ workspaceId: p.workspaceId })
            await post('session/bind', { sessionId: id, cardId, tree: treeMode() })
            ws = p.workspaceId
          }
          const r = await s.using(id, { source: 'dsh-project-manager' }, (ref) => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))
          if (!r.ok) throw new Error((r.error?.message ?? '发送失败') + (r.error?.code ? '（' + r.error.code + '）' : ''))
          openAndReveal(id, ws)
          void live.refresh()
          const v = s.list.getSnapshot().byId[id]
          return v?.title || v?.displayTitle || '新会话'
        },
        // 全部会话 = ctx.sessions 列表（含冷会话与已归档），工作区归属与归档状态来自 ctx.workspaces；不列子代理会话
        allSessions: (): SessionView[] => {
          const ws = ctx.workspaces.list.getSnapshot()
          const arch = new Set(ws.archivedSessionIds ?? [])
          const owner = new Map<string, { title: string; id: string }>()
          // 构造函数里就会首绘（0.15 用 seed 快照）→ 此时 view 还没赋值，只能读 live 快照
          const hubPath = (vref ?? live).snap?.hub.path
          for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, { title: w.path === hubPath ? HUB_TITLE : w.title, id: w.workspaceId })
          const st = ctx.sessions.list.getSnapshot()
          const out: SessionView[] = []
          for (const id of st.ids) {
            const s = st.byId[id]
            if (!s || s.origin === 'subagent') continue
            const o = owner.get(id)
            const fork = s.parentId && s.parentId !== id ? st.byId[s.parentId] : undefined
            out.push({ id, ...(s.parentId && s.parentId !== id ? { forkOf: fork ? (fork.title || fork.displayTitle || s.parentId) : '已删除的会话' } : {}), blank: !!s.blank, title: s.title || (s.blank ? '新会话' : s.displayTitle) || id, ws: o?.title ?? (s.cwd ? s.cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || s.cwd : '未分组'), wsId: o?.id ?? null, updatedAt: s.updatedAt, archived: arch.has(id) })
          }
          return out
        },
        // 归档会话 = dsh 侧栏「归档会话」同一个调用（ctx.workspaces.archiveSession）；有进行中的工作时宿主拒绝并带回 activity
        archiveSession: async (id, stop) => {
          const w = ctx.workspaces
          if (typeof w.archiveSession !== 'function') throw new Error('当前 dsh 版本没有 workspaces.archiveSession')
          const release = keepBoard()
          try { await w.archiveSession(id, stop ? { stopActivity: true } : {}); return { ok: true } }
          catch (e) {
            const re = (e as { name?: string; rpcError?: { code?: string; details?: { activity?: unknown } } })
            if (!stop && re?.name === 'WorkspaceArchiveError' && re.rpcError?.code === 'workspace/session-active') return { ok: false, activity: (re.rpcError.details?.activity ?? []) as ArchiveActivity[] }
            throw e
          } finally { setTimeout(release, 800) }
        },
        unarchiveSession: async (id) => {
          const w = ctx.workspaces
          if (typeof w.unarchiveSession !== 'function') throw new Error('当前 dsh 版本没有 workspaces.unarchiveSession')
          await w.unarchiveSession(id)
        },
        pickDirectory: async () => {
          if (typeof ctx.uiWorkspace.pickDirectory !== 'function') throw new Error('当前 dsh 版本没有 pickDirectory')
          return ctx.uiWorkspace.pickDirectory()
        },
      })
      vref = view
      boardView = view
      if (pendingCard) { void view.focusCard(pendingCard); pendingCard = null }
      const off = ctx.on('theme/change', () => { view.render(); bump((n) => n + 1) })
      // 会话改名 / 归档 / 恢复后，详情里的会话名与状态跟着变（只在详情打开时重绘，合并到一帧）
      let raf = 0
      const onStore = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; view.onSessionsChanged() }) }
      const offS = ctx.sessions.list.subscribe(onStore)
      const offW = ctx.workspaces.list.subscribe(onStore)
      return () => { off(); offS(); offW(); if (raf) cancelAnimationFrame(raf); if (boardView === view) boardView = null; view.dispose(); void live.refresh() }
    }, [])
    return h('div', { ref, style: { height: '100%', minHeight: 0 } })
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Board)), 'dsh-project-manager: panel')

  // ── 全局面板「项目看板」主按钮：与「插件」同一组（官方 sidebar.panellist），行由宿主画，插件给图标块 + 整行光效层 + 徽标 ──
  const liveSess = (id: string): boolean => { const s = ctx.sessions.list.getSnapshot().byId[id]; return !!s && s.origin !== 'subagent' && !(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(id) }
  const doing = (): number => (live.snap ? doingCount(live.snap.board, liveSess) : 0)
  const Entry = (p: { size?: number; active?: boolean }): unknown => {
    const [n, setN] = useState(doing)
    // 会话归档 / 恢复（workspaces 推送）、会话增删（sessions 推送）、看板变化都会立刻重算
    useEffect(() => { const f = (): void => setN(doing()); live.subs.add(f); const a = ctx.sessions.list.subscribe(f); const b = ctx.workspaces.list.subscribe(f); f(); return () => { live.subs.delete(f); a(); b() } }, [])
    return h(BoardEntry, { active: !!p.active, compact: (p.size ?? 16) > 16, count: n })
  }
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: '项目看板' }, Entry)), 'dsh-project-manager: board entry')

  // ── 0.19 会话信息卡（会话输入框上方）──
  const sendTo = async (id: string, text: string): Promise<void> => {
    const s = ctx.sessions
    if (typeof s.using !== 'function') throw new Error('当前 dsh 版本不能从界面给会话发消息（sessions.using 不存在）')
    const r = await s.using(id, { source: 'dsh-project-manager' }, (ref) => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))
    if (!r.ok) throw new Error((r.error?.message ?? '发送失败') + (r.error?.code ? '（' + r.error.code + '）' : ''))
  }
  const Dock = (props: { sessionId?: string; useSession?: <T>(sel: (s: { id?: string; sessionId?: string }) => T) => T }): unknown => {
    const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : undefined
    const sessionId = props.sessionId ?? viaHook
    const ref = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      const el = ref.current
      if (!el || !sessionId) return
      const card = new SessionCard(el, sessionId, { toast, send: sendTo, openBoard: (cardId) => openBoardAt(cardId) })
      return () => card.dispose()
    }, [sessionId])
    return h('div', { ref, hidden: true })
  }
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-project-manager:memory', order: 30 }, Dock)), 'dsh-project-manager: memory dock')
  // 截断文字悬停走马灯（会话信息卡 + 看板详情）
  ctx.effect(() => marquee('.dpm-sic .mq, .dpm .detail .mq'), 'dsh-project-manager: marquee')
}
