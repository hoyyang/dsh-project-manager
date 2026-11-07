/**
 * dsh-project-manager client：主区看板面板 + 全局面板「项目看板」主按钮 + 「项目区」/卡片组行「+」接管 + 会话记忆提示 + 选卡片浮层。
 * 生命周期：所有 DOM/监听都挂在 ctx.effect 上，卸载即净（样式、按钮、浮层、toast 全部移除）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ApiError, getState, openedHow, openFileSmart, poll, post, setRightbarOpener, Snapshot } from './api.js'
import { ago, ArchiveActivity, BoardView, SessionView, closeGlobalDetail, colAway, colFront, globalDetailCard, globalDetailView, isGlobalDetailOpen, openGlobalDetail, rlDispose, rlKick, rlState } from './board.js'
import type { BoardHost } from './board.js'
import { esc, ic } from './icons.js'
import { blankRows, SidebarBridge } from './sidebar.js'
import { CSS as STYLE } from './style.gen.js'
import { BoardEntry, doingCount, SchedEntry } from './entry.js'
import { marquee, SessionCard } from './dock.js'
import { mountGoalTask } from './goaltask.js'
import { panelToday, runForSession, runKeysFor, scheduleKeys } from './gtextra.js'
import type { ActiveGroup, InputActions } from './qmenu.js'
import { ComposerAssist, SOURCE } from './composer.js'
import { installSess, repaintChips, ringRow } from './sess.js'
import type { SessSt } from './sess.js'
import { noteText as quoteNoteText } from '../quote.js'

const PANEL = 'dsh-project-manager:board'
/** 0.31 第二页：同一个面板，不同页（右侧卡片详情共用）。 */
const SCHED = 'dsh-project-manager:sched'
let HUB_TITLE = '项目区'

type Theme = { getTheme(): { active: { colorScheme: string } }; setTheme(id: string): void }
type Ctx = {
  slots: { inject(name: string, fn: () => unknown): () => void; register(opts: Record<string, unknown>, comp: unknown): () => void }
  layout: { selectPanel(id: string | null): void; panelInfo?: { getSnapshot(): { activePanelId: string | null }; subscribe(fn: () => void): () => void } }
  uiWorkspace: { openSession(id: string): void; pickDirectory?: () => Promise<string | null> }
  workspaces: { archiveSession?: (id: string, opts?: { stopActivity?: boolean }) => Promise<void>; unarchiveSession?: (id: string) => Promise<void>; list: { subscribe(fn: () => void): () => void; getSnapshot(): { items: Array<{ workspaceId: string; path: string; title: string; sessionIds?: string[] }>; archivedSessionIds?: string[] } } }
  sessions: { create(opts: { workspaceId: string }): Promise<string>; using?<T>(id: string, o: { source: string }, fn: (r: { binding: { session: { prompt(c: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<{ ok: boolean; error?: { code?: string; message?: string } }> } } }) => Promise<T>): Promise<T>; list: { subscribe(fn: () => void): () => void; getSnapshot(): { ids: string[]; byId: Record<string, { id: string; title?: string; displayTitle: string; cwd?: string; updatedAt: number; parentId?: string; origin?: string; blank?: boolean; retainedBy?: Record<string, number> }> } } }
  theme: Theme
  /** v93：读宿主服务（inputTriggers = / 菜单的命令 + 技能数据源）；没有就返回 undefined。 */
  get?(name: string): unknown
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
  const toast = (msg: string, kind: 'ok' | 'err' = 'ok', action?: { label: string; run: () => void } | Array<{ label: string; run: () => void }>): void => {
    if (!toastBox || !toastBox.isConnected) { toastBox = document.createElement('div'); toastBox.className = 'dpm-toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite') }
    /* v113（5.1）：原生 <dialog> 在顶层 —— 有弹窗开着时把 toast 容器挂进弹窗，否则会被弹窗压在下面（原来「保存了但看不见提示」） */
    {
      const dlgOpen = document.querySelector('dialog[open]') as HTMLElement | null
      const parent = dlgOpen ?? document.body
      if (toastBox.parentElement !== parent) parent.append(toastBox)
    }
    for (const n of Array.from(toastBox.children)) if (n.textContent === msg) n.remove()
    const el = document.createElement('div')
    el.className = 'toast' + (kind === 'err' ? ' err' : '')
    el.innerHTML = ic(kind === 'err' ? 'x' : 'check') + '<span>' + esc(msg) + '</span>'
    // 0.26 可以带多个动作（复制卡片的「打开」「撤销」）
    for (const a of action ? (Array.isArray(action) ? action : [action]) : []) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ta'
      b.textContent = a.label
      b.addEventListener('click', () => { el.remove(); a.run() })
      el.append(b)
    }
    toastBox.append(el)
    while (toastBox.children.length > 2) toastBox.firstElementChild?.remove()
    // 带「撤销」的提示多留一会儿（与 dsh 侧栏归档提示同样是长提示）
    setTimeout(() => el.remove(), kind === 'err' ? 5000 : action ? 6000 : 2400)
  }
  ctx.effect(() => () => { toastBox?.remove(); toastBox = null }, 'dsh-project-manager: toast')

  /* v132（3）：代替 X:has(:focus-visible) —— 键盘焦点所在元素的祖先（到插件根为止）打 .dpm-fv；
     详情分区里有输入焦点 / 键盘焦点 → 该分区 .sec.cl 打 .dpm-fx。焦点一变只改这几个节点，宿主页面其他 DOM 改动不再触发整页重新匹配。 */
  ctx.effect(() => {
    const ROOTS = '.dpm, .dpm-dialog'
    let marked: Element[] = []
    const clear = (): void => { for (const n of marked) n.classList.remove('dpm-fv', 'dpm-fx'); marked = [] }
    const mark = (t: Element | null): void => {
      clear()
      if (!t || !t.closest(ROOTS)) return
      const fv = t.matches(':focus-visible')
      const sec = t.closest('.sec.cl')
      if (sec && (t.matches('input, textarea') || (fv && t.closest('.sbc')))) { sec.classList.add('dpm-fx'); marked.push(sec) }
      if (!fv) return
      for (let n = t.parentElement; n && n !== document.body; n = n.parentElement) {
        n.classList.add('dpm-fv'); marked.push(n)
        if (n.matches(ROOTS) && !n.parentElement?.closest(ROOTS)) break
      }
    }
    const fin = (e: FocusEvent): void => { mark(e.target as Element) }
    const fout = (): void => { clear() }
    // 鼠标点过的元素再按键盘 → 浏览器把它改判成 :focus-visible（keyup 时已改好）
    const kup = (): void => { const a = document.activeElement; if (a && a !== document.body && a.matches(':focus-visible') && !a.parentElement?.classList.contains('dpm-fv')) mark(a) }
    document.addEventListener('focusin', fin, true)
    document.addEventListener('focusout', fout, true)
    document.addEventListener('keyup', kup, true)
    return () => { document.removeEventListener('focusin', fin, true); document.removeEventListener('focusout', fout, true); document.removeEventListener('keyup', kup, true); clear() }
  }, 'dsh-project-manager: focus marks')


  /** v86：把服务抓成可复用引用（在 active context 里抓一次；之后即使 context 变 inactive 也能照常读数据）。 */
  let wsApi: typeof ctx.workspaces | null = null
  let sessApi: typeof ctx.sessions | null = null
  let uiApi: typeof ctx.uiWorkspace | null = null
  const grab = (): void => {
    try { if (!wsApi) wsApi = ctx.workspaces } catch { /* context 已 inactive，用已有缓存 */ }
    try { if (!sessApi) sessApi = ctx.sessions } catch { /* 同上 */ }
    try { if (!uiApi) uiApi = ctx.uiWorkspace } catch { /* 同上 */ }
  }
  const wsRef = (): typeof ctx.workspaces => wsApi ?? (grab(), ctx.workspaces)
  const sessRef = (): typeof ctx.sessions => sessApi ?? (grab(), ctx.sessions)
  /** v91：uiWorkspace 也走缓存引用（打开会话 / 选目录）；上下文失效时 getter 会抛，缓存引用不会。 */
  const uiRef = (): typeof ctx.uiWorkspace => { grab(); if (!uiApi) throw new Error('插件上下文还没就绪'); return uiApi }
  grab()

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
      /* v145（1.2）：详情底部「以此卡片新建会话」/ 项目卡 = 会话名就是卡片标题 */
      const r = await post<{ title: string | null; permission: boolean }>('session/bind', { sessionId, cardId, tree: treeMode(), ...(card ? { title: card.t } : {}) })
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
    const ws = wsRef().list.getSnapshot()
    const arch = new Set(ws.archivedSessionIds ?? [])
    const owner = new Map<string, string>()
    for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, w.title)
    const st = sessRef().list.getSnapshot()
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
    const row = (s: (typeof list)[number]): string => '<label class="ns-row' + (s.archived ? ' dis' : '') + (s.id === ns!.fresh ? ' fresh' : '') + (ns!.sel === s.id ? ' on' : '') + '"' + (s.archived ? ' title="已归档的会话不能直接打开，先「恢复活跃」"' : '') + '>'
      + '<input type="radio" name="dpmNs" value="' + esc(s.id) + '"' + (s.archived ? ' disabled' : '') + (ns!.sel === s.id ? ' checked' : '') + '>'
      + '<span class="txt"><span class="nm">' + esc(s.title) + '</span><span class="sub">' + (s.archived ? '<span class="chip arch">已归档</span>' : '<span class="chip live">活跃</span>') + '<span>' + esc(s.ws) + ' · ' + esc(ago(s.updatedAt)) + '</span></span></span>'
      + (s.archived ? '<button type="button" class="btn ghost xs" data-ns-restore="' + esc(s.id) + '"' + (canRestore && !ns!.busy.has(s.id) ? '' : ' disabled') + ' title="' + (canRestore ? '恢复到工作区原来的位置' : '当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）') + '">' + ic('restore') + (ns!.busy.has(s.id) ? '恢复中…' : '恢复活跃') + '</button>' : '') + '</label>'
    ;(ns.dlg.querySelector('#dpmNsP') as HTMLElement).innerHTML = esc(g.name) + ' · <b>' + esc(c.t) + '</b>'
    ;(ns.dlg.querySelector('#dpmNsList') as HTMLElement).innerHTML = (sug ? '<div class="ns-sug">' + ic('info') + '<span class="grow">这张卡片还没关联落盘项目。发现同名落盘项目 <b>' + esc(sug.slug) + '</b></span><button type="button" class="btn xs" data-ns-link="' + esc(sug.key) + '">' + ic('link') + '关联到卡片</button></div>' : '')
      + '<label class="ns-row new' + (ns.sel === '__new' ? ' on' : '') + '"><input type="radio" name="dpmNs" value="__new"' + (ns.sel === '__new' ? ' checked' : '') + '><span class="ni">' + ic('plus') + '</span><span class="txt"><span class="nm">新建一个会话</span><span class="sub"><span>在「' + esc(HUB_TITLE + ' / ' + g.name) + '」新建，名称「' + esc(treeMode() ? c.t : g.name + ' · ' + c.t) + '」，自动关联这张卡片 · ' + (mem ? '读取 ' + mem + ' 个落盘项目的记忆' : '不读取记忆（未关联落盘项目）') + ' · 完全权限</span></span></span></label>'
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
    dlg.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (ns && t.name === 'dpmNs') { ns.sel = t.value; dlg.querySelectorAll('.ns-row').forEach((r) => r.classList.toggle('on', !!r.querySelector('input:checked'))) } })
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
    return poll(5000, () => { void live.refresh() })
  }, 'dsh-project-manager: snapshot poll')

  // ── 侧栏「项目区」/卡片组行「+」接管 ──
  const bridge = new SidebarBridge({
    rows: () => { const h = live.snap?.hub; const groups: Record<string, string> = {}; for (const [g, w] of Object.entries(h?.groups ?? {})) groups[w] = g; return { hub: h?.workspaceId ?? null, groups } },
    pickCard: (a, g) => void pickCard(a, g),
    open: (id) => openSess(id),
    canDelete: () => canDelete,
    del: (id, title) => void deleteSession(id, title),
  })
/* v133（1）：按下的同一帧就有反馈（只描边、不动布局）—— 面板入口 / 今天 / 执行卡 / 计划清单行 / 甘特目录 / 详情任务 / 插件按钮；
     后面的重活哪怕慢一点，用户也知道「点到了」。 */
  ctx.effect(() => {
    const PRESS = 'button[data-dpm-eb], .dpm-today, .dpm .sched .exi, .dpm .sched .plr, .dpm .sched .ind-cell, :is(.dpm, .dpm-global-detail) .detail .task > .tkhead, :is(.dpm, .dpm-global-detail, .dpm-dialog) button'
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.(PRESS) as HTMLElement | null
      if (!el) return
      // 用 data 属性不用 class：页面里别的插件有按 class 子串匹配的 :has() 规则，任何 class 变化都让整页重算样式
      el.setAttribute('data-dpm-press', '')
      const off = (): void => { window.removeEventListener('pointerup', off, true); window.removeEventListener('pointercancel', off, true); setTimeout(() => el.removeAttribute('data-dpm-press'), 90) }
      window.addEventListener('pointerup', off, true)
      window.addEventListener('pointercancel', off, true)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, 'dsh-project-manager: press feedback')
  ctx.effect(() => { bridge.start(); return () => bridge.stop() }, 'dsh-project-manager: sidebar')

  /** 0.11：会话所在的工作区 id（没归到任何工作区 = null）。 */
  const ownerOf = (sessionId: string): string | null => {
    for (const w of wsRef().list.getSnapshot().items) if (w.sessionIds?.includes(sessionId)) return w.workspaceId
    return null
  }
  /** v91：打开会话（走缓存引用；上下文失效时点名提示一次，不抛未捕获异常）。 */
  const openSess = (id: string): void => {
    try { uiRef().openSession(id) } catch (e) { toast('插件上下文还没就绪，再点一次（' + String(e).slice(0, 40) + '）', 'err') }
  }
  /** 0.11：从看板进入会话（打开已有 / 新建）——打开后，会话所在的卡片组或「项目区」在侧栏收起着就展开。其他工作区的会话不动。 */
  const openAndReveal = (sessionId: string, wsId?: string): void => {
    openSess(sessionId)
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
    const s = sessRef().list.getSnapshot().byId[id]
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
      const byId = sessRef().list.getSnapshot().byId
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
    grab()
    let raf = 0
    const paint = (): void => {
      raf = 0
      const h = live.snap?.hub
      if (!h) { bridge.setBlanks({}); return bridge.paint(null, {}) }
      let ws: ReturnType<typeof ctx.workspaces.list.getSnapshot>
      try { ws = wsRef().list.getSnapshot() } catch { return }
      const arch = new Set(ws.archivedSessionIds ?? [])
      const byId = sessRef().list.getSnapshot().byId
      const counts: Record<string, number> = {}
      // 0.12：只针对「项目区」及其卡片组子工作区
      const titles: Record<string, string | undefined> = {}
      for (const r of live.snap?.board.sessions ?? []) titles[r.sessionId] = r.title
      for (const wid of Object.values(h.groups ?? {})) {
        const w = ws.items.find((x) => x.workspaceId === wid)
        // 0.15：分叉会话也带 parentId（源会话 id），只有 origin = subagent 才是子代理
        // v86 修：会话元数据可能还没进 sessions 快照（重启后大量会话尚未加载）→ 这时整列都变 0。
        // 未加载的会话只要绑了卡片（titles 里有）就照旧计入；确实不再存在的（不绑卡又未加载）不计数。
        const ids = (w?.sessionIds ?? []).filter((id) => {
          if (arch.has(id)) return false
          const s = byId[id] as { origin?: string } | undefined
          return s === undefined ? titles[id] !== undefined : s.origin !== 'subagent'
        })
        // 0.26：只数侧栏实际显示的——DSH 自动建的空会话（没对话、没绑卡片、也不是正在看的）宿主不显示，不计入
        counts[wid] = ids.filter((id) => {
          const s = byId[id] as { blank?: boolean; retainedBy?: Record<string, number> } | undefined
          if (!s) return true // 元数据还没加载（v86 兜底计入的）：不参与空白过滤，否则会抛错
          return !(s.blank && !(id in titles) && !((s.retainedBy?.mainView ?? 0) > 0))
        }).length
      }
      bridge.paint(h.workspaceId ?? null, counts)
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
  let kept: { el: HTMLDivElement; view: BoardView; scroll: Array<[HTMLElement, number, number]> } | null = null
  ctx.effect(() => () => { kept?.view.dispose(); kept?.el.remove(); kept = null }, 'dsh-project-manager: kept board')
  let pendingCard: string | null = null
  /** v143（1.1）：每日任务面板是独立一列 —— 看板面板没挂载（在会话页）也要有 BoardView 来开面板：先建好、不挂到主区，下次挂载原样接回 */
  const ensureBoard = (): BoardView => {
    if (boardView) return boardView
    if (!kept) {
      const box = document.createElement('div')
      box.style.cssText = 'height:100%;min-height:0'
      let vref: BoardView | null = null
      const v = new BoardView(box, makeBoardHost(() => vref), { startMode: 'board' })
      vref = v
      kept = { el: box, view: v, scroll: [] }
    }
    return kept.view
  }
  const openBoardAt = (cardId: string): void => {
    pendingCard = cardId
    ctx.layout.selectPanel(PANEL)
    if (boardView) { void boardView.focusCard(cardId); pendingCard = null }
  }

  /* v136：会话输入框「添加为…」要用详情里同一套弹窗；看板 / 详情都没挂时建一个只装弹窗的隐藏实例（卸载即净） */
  let dlgView: BoardView | null = null
  const ensureDialogView = (): BoardView => {
    if (dlgView && dlgView.root.isConnected) return dlgView
    const el = document.createElement('div'); el.className = 'dpm-dlg-host'; el.style.cssText = 'position:fixed;width:0;height:0;overflow:visible;left:0;top:0'
    document.body.append(el)
    let vref: BoardView | null = null
    dlgView = new BoardView(el, makeBoardHost(() => vref), { detailOnly: true, dialogsOnly: true })
    vref = dlgView
    return dlgView
  }
  ctx.effect(() => () => { if (dlgView) { dlgView.dispose(); dlgView.root.remove(); dlgView = null } }, 'dsh-project-manager: composer dialog host')
  /** 会话信息卡上的卡片跳转：只打开全局卡片详情，不切面板、不打开看板。 */
  const openDetailOnly = (cardId: string): void => { openGlobalDetail(detailHost, cardId); if (colAway('cd')) colFront('cd') }

  /** v94：详情页任务的添加 / 编辑走会话里那个「添加卡片任务」弹窗（mountGoalTask 挂载后把 open 交出来）。 */
  let goalTaskOpen: ((o: import('./goaltask.js').GoalTaskOpen) => void) | null = null

  /** 全局详情用的 host：不依赖看板面板是否挂载，重启后先点会话信息卡也能开详情。 */
  const makeBoardHost = (getView: () => BoardView | null): BoardHost => ({
    /** v86 修：服务引用在这里（context 还是 active）抓一次，回调里不再走 ctx.workspaces 的 getter。 */
    /** v86：详情与看板是两个实例，互相通知重画（只通知「不是自己」的那个）。 */
    syncOthers: () => { const me = getView(); for (const v of [boardView, globalDetailView()]) if (v && v !== me) void v.refresh() },

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
          const arch = new Set(wsRef().list.getSnapshot().archivedSessionIds ?? [])
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
          // v86 修：回调可能在 inactive context 之后被调用，直接读 ctx.workspaces 会抛
          // 「cannot get required service "workspaces" in inactive context」→ 侧栏会话数与信息卡全空。
          // 在 effect 建立时就把服务引用抓下来，出错时退回空结果（不冒泡到界面）。
          let ws: ReturnType<typeof ctx.workspaces.list.getSnapshot>
          try { ws = wsRef().list.getSnapshot() } catch { return [] }
          const arch = new Set(ws.archivedSessionIds ?? [])
          const owner = new Map<string, { title: string; id: string }>()
          // 构造函数里就会首绘（0.15 用 seed 快照）→ 此时 view 还没赋值，只能读 live 快照
          const hubPath = (getView() ?? live).snap?.hub.path
          for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, { title: w.path === hubPath ? HUB_TITLE : w.title, id: w.workspaceId })
          let st: ReturnType<typeof ctx.sessions.list.getSnapshot>
          try { st = sessRef().list.getSnapshot() } catch { return [] }
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
          const ui = uiRef()
          if (typeof ui.pickDirectory !== 'function') throw new Error('当前 dsh 版本没有 pickDirectory')
          return ui.pickDirectory()
        },
        // v94：详情页任务 → 同一个弹窗（编辑 = 「编辑卡片任务」；加子任务 = 底栏点名父任务）
        taskDialog: (o) => { goalTaskOpen?.(o) },
        taskDialogOpen: () => !!document.querySelector('dialog.dpm-goaltask[open]'),
        /* v127：详情里的状态胶囊 = 打开今天的任务面板并定位那张卡 */
        /* v143（1.1）：面板是独立一列 —— 定位不跳页，就在当前页打开面板 */
        seek: (keys) => { if (colAway('tp')) colFront('tp'); ensureBoard().seekToday(keys) },
      
  })
  const detailHost = makeBoardHost(() => globalDetailView())

  // ── v88：全局卡片详情订阅 DSH 会话 + 工作区推送（rAF 合并到一帧）——会话归档 / 恢复 / 删除、
  //    卡片归档 / pending 之后详情同一帧更新，不再等 4s 轮询。看板面板自己的订阅在 Board 组件里。──
  ctx.effect(() => {
    let raf = 0
    const on = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; globalDetailView()?.onSessionsChanged() }) }
    const a = ctx.sessions.list.subscribe(on)
    const b = ctx.workspaces.list.subscribe(on)
    /* 验收探针：模拟一次会话推送（force = 当作这张卡的会话行变了）；不影响正常使用 */
    const probe = (e: Event): void => { globalDetailView()?.testPush(!!(e as CustomEvent<{ force?: boolean }>).detail?.force) }
    window.addEventListener('dpm:test-push', probe)
    on()
    return () => { a(); b(); window.removeEventListener('dpm:test-push', probe); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: global detail live')
  /* ══ v140–v142：任务关联会话 —— 状态 = 宿主 uiSession.sessionStatus（running / pendingInteraction）+ 工作区归档；
     状态一变，所有状态标签原地换（详情 / 执行安排 / 计划清单 / 气泡）。会话被删 = 胶囊不画（console 点名一次）。 ══ */
  type StatusSrc = { getSnapshot(): Map<string, { running?: boolean; pendingInteraction?: { kind?: string }; completionUnread?: boolean }>; subscribe(fn: () => void): () => void }
  const statusSrc = (): StatusSrc | null => { try { const u = ctx.get?.('uiSession') as { sessionStatus?: StatusSrc } | undefined; return u?.sessionStatus ?? null } catch { return null } }
  const sessSt = (id: string): SessSt | null => {
    let v: { running?: boolean; blank?: boolean; title?: string } | undefined
    try { v = sessRef().list.getSnapshot().byId[id] as typeof v } catch { return null }
    if (!v) return null
    try { if ((wsRef().list.getSnapshot().archivedSessionIds ?? []).includes(id)) return 'arch' } catch { /* 当作没归档 */ }
    const st = statusSrc()?.getSnapshot().get(id)
    if (st?.pendingInteraction?.kind) return 'wait'
    if (st?.running ?? v.running) return 'run'
    /* v143（2.3）：Agent 输出完、你还没看（工作区那一行亮绿点 = 宿主 completionUnread）= 会话完成输出；打开看过 = 宿主清掉 → 回到空闲 */
    return st?.completionUnread === true ? 'done' : 'idle'
  }
  /** 侧栏里定位 + 彩色高光这些会话行（侧栏收着先展开；卡片组收着先展开）。 */
  const revealRows = async (ids: string[]): Promise<string[]> => {
    if (!ids.length) return []
    try { const L = ctx.layout as unknown as { layoutInfo?: { getSnapshot(): { sidebar?: number } }; toggleSidebar?: () => void }; if (L.layoutInfo?.getSnapshot().sidebar === 0) L.toggleSidebar?.() } catch { /* 拿不到布局信息：不展开 */ }
    const h = live.snap?.hub
    for (const id of ids) { const ws = ownerOf(id); if (h && ws && (ws === h.workspaceId || Object.values(h.groups ?? {}).includes(ws))) await bridge.reveal(id, ws, h.workspaceId ?? null) }
    const lit: string[] = []
    let first = true
    for (const id of ids) {
      const row = document.querySelector<HTMLElement>('[data-row-key="session:' + CSS.escape(id) + '"], [data-dpm-blank="' + CSS.escape(id) + '"]')
      if (!row) continue
      if (first) { try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch { /* */ } first = false }
      ringRow(row); lit.push(id)
    }
    return lit
  }
  ctx.effect(() => installSess({
    st: sessSt,
    title: (id) => { const x = sessLite(id); return x?.title || (live.snap?.board.sessions.find((r) => r.sessionId === id)?.title ?? id) },
    card: (id) => (globalDetailView()?.cards.find((c) => c.id === id) ?? boardView?.cards.find((c) => c.id === id) ?? live.snap?.board.cards.find((c) => c.id === id) ?? null),
    cardSessions: (cid) => {
      const snap = live.snap
      if (!snap) return []
      const byId = (() => { try { return sessRef().list.getSnapshot().byId } catch { return {} as Record<string, { updatedAt?: number }> } })()
      return snap.board.sessions.filter((r) => r.cardId === cid && byId[r.sessionId]).map((r) => ({ id: r.sessionId, title: sessLite(r.sessionId)?.title || r.title || r.sessionId, updatedAt: (byId[r.sessionId] as { updatedAt?: number }).updatedAt ?? 0, archived: sessSt(r.sessionId) === 'arch' }))
    },
    open: (id) => { if (sessSt(id) === 'arch') { toast('这个会话已归档，先在卡片详情里恢复活跃', 'err'); return } openSess(id); void revealRows([id]) },
    shownSession: () => { const pi = ctx.layout.panelInfo; if (pi && pi.getSnapshot().activePanelId !== null) return null; try { const st = sessRef().list.getSnapshot(); for (const id of st.ids) if (((st.byId[id]?.retainedBy?.mainView) ?? 0) > 0) return id } catch { /* */ } return null },
    switchTo: (id) => { openSess(id); void revealRows([id]) },
    link: async (cid, tid, sid) => {
      try {
        await post('card/task-sess', { id: cid, task: tid, sess: sid })
        await live.refresh()
        for (const v of [boardView, globalDetailView()]) if (v) await v.refresh(true)
        const st = sid ? sessSt(sid) : null
        toast(sid ? '已关联会话「' + (sessLite(sid)?.title ?? sid) + '」' + (st === 'arch' ? ' · 已归档会话不在工作区里，不定位' : ' · 已在左侧工作区定位并高光') : '已取消关联的会话（会话本身不受影响）')
        if (sid && st !== 'arch') void revealRows([sid])
      } catch (e) { toast('关联会话没保存上：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
    },
    newFor: async (cid, tid) => {
      if (creating) { toast('正在新建会话，稍等一下'); return }
      creating = true
      try {
        const { workspaceId } = await post<{ workspaceId: string; workspaceTitle: string }>('session/prepare', { cardId: cid })
        const sessionId = await ctx.sessions.create({ workspaceId })
        /* v145（1.2）：任务 / 子任务入口 = 会话名就是任务 / 子任务标题；卡片入口 = 卡片标题 */
        const cc = live.snap?.board.cards.find((x) => x.id === cid)
        const tt = tid && cc ? (cc.tasks.flatMap((t) => [t, ...(t.subs ?? [])]).find((t) => t.id === tid)?.text ?? '') : ''
        await post('session/bind', { sessionId, cardId: cid, tree: treeMode(), ...(tt ? { title: tt } : cc ? { title: cc.t } : {}) })
        if (tid) await post('card/task-sess', { id: cid, task: tid, sess: sessionId })
        await live.refresh()
        for (const v of [boardView, globalDetailView()]) if (v) await v.refresh(true)
        openSess(sessionId)
        ;(window as unknown as Record<string, unknown>).__dpmCreated = { id: sessionId, cid, tid, at: Date.now() }
        setTimeout(() => void revealRows([sessionId]), 120)
        toast('已新建会话：自动关联' + (tid ? '这张卡片和这个任务' : '这张卡片') + ' · 完全权限')
      } catch (e) { toast('新建会话失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') } finally { creating = false }
    },
    reveal: revealRows,
    toast,
    listReady: () => { try { return Object.keys(sessRef().list.getSnapshot().byId ?? {}).length > 0 } catch { return false } },
  }), 'dsh-project-manager: task sessions')
  ctx.effect(() => {
    let raf = 0
    const on = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; repaintChips() }) }
    const a = ctx.sessions.list.subscribe(on), b = ctx.workspaces.list.subscribe(on)
    const src = statusSrc()
    const c = src ? src.subscribe(on) : (console.warn('[dsh-project-manager] 拿不到宿主的会话状态（uiSession.sessionStatus）：会话状态只按「是否在跑」显示，等待中显示不出来'), () => undefined)
    return () => { a(); b(); c(); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: session status live')
  ;(window as unknown as Record<string, unknown>).__dpmSessSt = sessSt
  /* 验收探针：会话窗口正在展示的会话（看板 / 日程页 = null）；__dpmOpenSess = 和插件里「打开会话」同一个调用 */
  ;(window as unknown as Record<string, unknown>).__dpmOpenSess = (id: string): void => openSess(id)
  ;(window as unknown as Record<string, unknown>).__dpmShown = (): string | null => { const pi = ctx.layout.panelInfo; if (pi && pi.getSnapshot().activePanelId !== null) return null; try { const st = sessRef().list.getSnapshot(); for (const id of st.ids) if (((st.byId[id]?.retainedBy?.mainView) ?? 0) > 0) return id } catch { /* */ } return null }
  /* v145（1.1）/ v146：关联了任务 / 子任务 / 项目的会话一开始工作（状态从别的变成「执行中」那一刻）→ 今天一起进「执行中」，
     各处（执行安排 / 计划清单 / 甘特 / 看板 / 详情）就地到位；不打开、不切换任何面板。多窗口：每个会话 1.5s 内只写一次 + 写前读最新 */
  ctx.effect(() => {
    /* v151（7）根因：只在会话「从别的状态变成执行中」那一刻触发 —— 会话先跑起来、之后才创建项目 / 任务 / 子任务或设置关联、
       新建会话后再关联，这些时候没有「变成」这一下，卡片就一直不动。改成「对账」：每一轮（会话状态推送 / 看板变化 / 3 秒兜底）
       把「正在执行中的会话 × 它关联的项目 / 任务 / 子任务」和今天的执行安排比一遍，没到「执行中」的立刻挪过去。
       每一项在会话的同一段执行里只挪一次（你手动挪出执行中，这段执行内不抢回来）；会话停下再开始 = 新一段，再挪一次。 */
    const last = new Map<string, string>()
    const seg = new Map<string, number>()
    const moved = new Set<string>()
    const busyAt = new Map<string, number>()
    let raf = 0
    const tick = (): void => {
      raf = 0
      const snap = live.snap
      let ids: string[] = []
      try { ids = Object.keys(sessRef().list.getSnapshot().byId ?? {}) } catch { return }
      const hits: string[] = []
      for (const id of ids) { const s = sessSt(id) ?? ''; if (s === 'run' && last.get(id) !== 'run') seg.set(id, (seg.get(id) ?? 0) + 1); last.set(id, s); if (s === 'run') hits.push(id) }
      if (!snap || !hits.length) return
      for (const sid of hits) {
        if (Date.now() - (busyAt.get(sid) ?? 0) < 1500) continue
        if (!snap.board.sessions.some((r) => r.sessionId === sid)) continue
        const sg = seg.get(sid) ?? 0
        const want = runKeysFor(snap.board.cards, sid, (cid) => snap.board.sessions.filter((r) => r.cardId === cid).map((r) => r.sessionId)).filter((h) => !moved.has(sid + '|' + sg + '|' + h.key))
        if (!want.length) continue
        busyAt.set(sid, Date.now())
        for (const h of want) moved.add(sid + '|' + sg + '|' + h.key)
        void runForSession(sid, () => want)
          .then((hs) => {
            ;(window as unknown as Record<string, unknown>).__dpmRun = { sid, keys: hs.map((h) => h.key), was: hs.map((h) => h.was), at: Date.now() }
            if (!hs.length) return
            for (const v of [boardView, globalDetailView()]) if (v) void v.refresh(true)
            boardView?.reloadSched()
            toast('会话执行中 → ' + hs.map((h) => '「' + (h.via ? h.title + '（' + h.via + '）' : h.title) + '」').join('') + ' 已到「执行中」：执行安排 / 计划清单 / 甘特图 / 项目看板 / 卡片详情都已更新（没打开任何面板）')
          }).catch((e) => console.warn('[dsh-project-manager] 会话开始工作 → 执行中 没写上：', e))
      }
    }
    const soon = (): void => { if (!raf) raf = requestAnimationFrame(tick) }
    const src = statusSrc()
    const a = ctx.sessions.list.subscribe(soon), c = src ? src.subscribe(soon) : () => undefined
    /* 看板变化（创建项目 / 任务 / 子任务、设置关联会话、新建会话）后快照才有新关联：快照一更新就再对一次账 */
    const onB = (): void => { void live.refresh().then(soon) }
    document.addEventListener('dpm:board-changed', onB)
    live.subs.add(soon)
    const iv = window.setInterval(soon, 3000)
    soon()
    return () => { a(); c(); live.subs.delete(soon); document.removeEventListener('dpm:board-changed', onB); clearInterval(iv); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: session run → today running')
  /* v146：「执行中」标记 —— 计划清单任务行 / 项目行、甘特行名、项目看板卡片 = 绿底 + 呼吸点小标签（看板卡片再加绿框）；
     读今天面板缓存（pst = run），各自重画后 MutationObserver 下一帧补画（不靠渲染函数里写死），标记节点 data-dpm-run */
  ctx.effect(() => {
    const Z = '<span class="dpm-runz" data-dpm-run aria-label="执行中"><i aria-hidden="true"></i>执行中</span>'
    let raf = 0, marking = false
    const runKeys = (): Set<string> => { const u = panelToday(); return new Set(Object.entries(u?.pst ?? {}).filter(([, v]) => v === 'run').map(([k]) => k)) }
    const cardRun = (cid: string, rk: Set<string>): boolean => [...rk].some((k) => k.split('|')[1] === cid)
    const paint = (): void => {
      raf = 0; marking = true
      try {
        const rk = runKeys()
        for (const r of Array.from(document.querySelectorAll<HTMLElement>('.dpm .sched #tpList .plr[data-k]'))) {
          const k = r.dataset.k ?? ''
          const want = k.startsWith('p|') ? cardRun(k.slice(2), rk) : rk.has(k)
          const has = r.querySelector(':scope > [data-dpm-run]')
          if (want && !has) { const sel = r.querySelector(':scope > .plsel, :scope > .plrec'); if (sel) sel.insertAdjacentHTML('beforebegin', Z); else r.insertAdjacentHTML('beforeend', Z) } else if (!want && has) has.remove()
        }
        /* v151（3.1）：甘特图目录格 —— 项目自己 / 任务 / 子任务今天是「执行中」= 整格绿色（文字反白）；
           项目或它的任务 / 子任务关联的会话里有一个在「会话执行中」= 亮光循环扫过（会话一停就停）。只写在格子自己身上（不靠 :has） */
        const u0 = panelToday(), dn = new Set(u0?.done ?? [])
        const snapB = live.snap?.board
        const sessRun = (cid: string): boolean => {
          const c0 = snapB?.cards.find((x) => x.id === cid); if (!c0) return false
          const sids = new Set<string>(snapB?.sessions.filter((r) => r.cardId === cid).map((r) => r.sessionId) ?? [])
          for (const t of c0.tasks ?? []) { if (t.sess) sids.add(t.sess); for (const x of t.subs ?? []) if (x.sess) sids.add(x.sess) }
          return [...sids].some((sid) => sessSt(sid) === 'run')
        }
        const dir: Record<string, { run: boolean; sweep: boolean }> = {}
        for (const c of Array.from(document.querySelectorAll<HTMLElement>('.dpm .sched #rows .ind-cell[data-open-card-cell]'))) {
          const cid = c.dataset.openCardCell ?? ''
          const want = cardRun(cid, rk), tags = c.querySelector('.sub'), has = c.querySelector('[data-dpm-run]')
          if (want && !has && tags) tags.insertAdjacentHTML('beforeend', Z); else if (!want && has) has.remove()
          const run = [...rk].some((k) => k.split('|')[1] === cid && !dn.has(k)), sweep = sessRun(cid)
          if (c.classList.contains('dpm-dirrun') !== run) c.classList.toggle('dpm-dirrun', run)
          if (c.classList.contains('dpm-dirsweep') !== sweep) c.classList.toggle('dpm-dirsweep', sweep)
          dir[cid] = { run, sweep }
        }
        ;(window as unknown as Record<string, unknown>).__dpmDir = dir
        for (const c of Array.from(document.querySelectorAll<HTMLElement>('.dpm .card[data-card]'))) {
          const want = cardRun(c.dataset.card ?? '', rk), has = c.querySelector(':scope > [data-dpm-run]')
          c.classList.toggle('dpm-runcard', want)
          if (want && !has) c.insertAdjacentHTML('beforeend', Z); else if (!want && has) has.remove()
        }
      } finally { marking = false }
    }
    const soon = (): void => { if (!marking && !raf) raf = requestAnimationFrame(paint) }
    const mo = new MutationObserver((ms) => { if (marking) return; for (const m of ms) { const t = m.target as HTMLElement; if (t.closest?.('.dpm')) { soon(); return } } })
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('dpm-panel', soon)
    const srcS = statusSrc(), offS = srcS ? srcS.subscribe(soon) : () => undefined
    live.subs.add(soon)
    soon()
    return () => { offS(); live.subs.delete(soon); mo.disconnect(); window.removeEventListener('dpm-panel', soon); if (raf) cancelAnimationFrame(raf); for (const n of Array.from(document.querySelectorAll('[data-dpm-run]'))) n.remove(); for (const c of Array.from(document.querySelectorAll('.dpm-runcard'))) c.classList.remove('dpm-runcard'); for (const c of Array.from(document.querySelectorAll('.dpm-dirrun, .dpm-dirsweep'))) c.classList.remove('dpm-dirrun', 'dpm-dirsweep') }
  }, 'dsh-project-manager: run marks')
  /* v144（3）：插件里所有「打开文件」→ 非图片 / 视频走 DSH 右侧栏文件查看（宿主 ui-reference 同款地址：dsh-resource://file/session/<会话>/<路径逐段编码>）。
     会话：当前打开的会话；在看板 / 日程页 = 最近一个主视图保留过的会话，再退到任意一个会话。 */
  ctx.effect(() => {
    const enc = (s: string): string => encodeURIComponent(s).replace(/%3A/gi, ':')
    const addr = (sid: string, cwd: string | undefined, path: string): string => {
      const p = path.replace(/\\/g, '/'), root = (cwd ?? '').replace(/\/+$/, '')
      const rel = root && p === root ? '' : root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
      return 'dsh-resource://file/session/' + enc(sid) + '/' + rel.split('/').map(enc).join('/')
    }
    const pickSid = (): string | null => {
      try {
        const st = sessRef().list.getSnapshot()
        const main = st.ids.find((id) => ((st.byId[id]?.retainedBy?.mainView) ?? 0) > 0)
        return main ?? st.ids[0] ?? null
      } catch { return null }
    }
    setRightbarOpener((path) => {
      let sb: { openResource?: (a: string) => void } | undefined
      try { sb = ctx.get?.('sidebarRight') as typeof sb } catch { sb = undefined }
      const sid = pickSid()
      if (!sb?.openResource || !sid) return false
      try {
        const cwd = (sessRef().list.getSnapshot().byId[sid] as { cwd?: string } | undefined)?.cwd
        const a = addr(sid, cwd, path)
        sb.openResource(a)
        ;(window as unknown as Record<string, unknown>).__dpmRbOpened = { path, addr: a, at: Date.now() }
        return true
      } catch (e) { console.warn('[dsh-project-manager] DSH 右侧栏打开失败：', e); return false }
    })
    return () => setRightbarOpener(null)
  }, 'dsh-project-manager: open files in rightbar')
  /* v134：详情 × DSH 右侧栏布局 —— 卸载即净（宿主节点上的属性 / 变量 / 中列 padding 全撤，切换胶囊移除）；__dpmRl 是只读验收探针 */
  ctx.effect(() => {
    ;(window as unknown as { __dpmRl?: unknown }).__dpmRl = rlState
    rlKick()
    /* v143（1.1）：每日任务面板开 / 关状态记在本机，刷新后照旧 */
    let restore = 0
    try { if (localStorage.getItem('dpm-tp-on') === '1') restore = window.setTimeout(() => { try { ensureBoard().openToday() } catch (e) { console.warn('[dsh-project-manager] 恢复每日任务面板失败', e) } }, 600) } catch { /* 读不了 = 不恢复 */ }
    return () => { clearTimeout(restore); rlDispose(); delete (window as unknown as { __dpmRl?: unknown }).__dpmRl }
  }, 'dsh-project-manager: rightbar layout')

  // ── v90：卡片详情跟随「宿主当前会话」——只有真的换了会话才动作。──
  //   旧问题：详情只认打开它的那一刻；会话视图被宿主缓存时，信息卡的那两处「跟一下」不会触发，
  //   于是出现「会话是 A 卡、右侧详情还是 B 卡」。这里认宿主自己的当前会话（retainedBy.mainView > 0）
  //   与面板状态：详情开着 → 换成这个会话的卡片；这个会话没有卡片 → 关掉详情。
  //   在看板 / 日程页点开别的卡片详情、或在详情里点「关联卡片」跳看另一张卡，都不切会话 → 不打断浏览。
  ctx.effect(() => {
    let lastSess: string | null | undefined = undefined
    const current = (): string | null => {
      const pi = ctx.layout.panelInfo
      // 面板（看板 / 日程）正开着 = 主区不是会话视图，没有「当前会话」
      if (pi && pi.getSnapshot().activePanelId !== null) return null
      try {
        const st = ctx.sessions.list.getSnapshot()
        for (const id of st.ids) if (((st.byId[id]?.retainedBy?.mainView) ?? 0) > 0) return id
      } catch { /* 服务还没就绪：当作没有当前会话 */ }
      return null
    }
    /* v151（6.1）根因：快照里找不到这个会话（刚「以此任务创建会话」/ 刚关联，5 秒轮询还没到）就当成「没有卡片」→ 详情收起或停在上一张。
       改：找不到先拉一次最新再判断；快照之后变了（会话被关联 / 换了卡片）也再跟一次。 */
    let followCard: string | null = null
    const shut = (): void => {
      /* v145（4）：切到没关联卡片的会话 = 收起详情，但不再一声不响 —— 提示条带「保持打开」 */
      const was = globalDetailCard()
      closeGlobalDetail()
      if (was) toast('这个会话没有关联卡片 → 卡片详情已收起', 'ok', { label: '保持打开', run: () => openDetailOnly(was) })
    }
    const follow = (): void => {
      const sid = current()
      const now = sid && live.snap ? live.snap.board.sessions.find((x) => x.sessionId === sid)?.cardId ?? null : null
      if (sid === lastSess && now === followCard) return
      const first = lastSess === undefined
      const same = sid === lastSess
      lastSess = sid
      followCard = now
      if (first || !sid) return
      if (!isGlobalDetailOpen()) return
      if (!live.snap) return
      if (now) { if (now !== globalDetailCard()) openDetailOnly(now); return }
      if (same) return
      void live.refresh().then(() => {
        if (current() !== sid || !isGlobalDetailOpen()) return
        const r2 = live.snap?.board.sessions.find((x) => x.sessionId === sid)
        if (r2) { followCard = r2.cardId; openDetailOnly(r2.cardId) } else shut()
      })
    }
    let raf = 0
    const on = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; follow() }) }
    const a = ctx.sessions.list.subscribe(on)
    const b = ctx.workspaces.list.subscribe(on)
    const pi = ctx.layout.panelInfo
    const c = pi && typeof pi.subscribe === 'function' ? pi.subscribe(on) : () => undefined
    live.subs.add(on)
    follow()
    return () => { a(); b(); c(); live.subs.delete(on); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: detail follows session')

  // ── v92：会话里「以 /goal 开头的已发送消息」→ 蓝色胶囊「添加任务」→ 居中大弹窗「添加卡片任务」 ──
  //   按钮由插件注入到这条消息的操作条（宿主没有用户消息操作条插槽），消息重画后由 MutationObserver 补回。
  //   会话没关联卡片 → 不显示按钮（按钮只出现在真能添加的地方）。
  ctx.effect(() => {
    const currentSession = (): string | null => {
      const pi = ctx.layout.panelInfo
      if (pi && pi.getSnapshot().activePanelId !== null) return null
      try {
        const st = sessRef().list.getSnapshot()
        for (const id of st.ids) if (((st.byId[id]?.retainedBy?.mainView) ?? 0) > 0) return id
      } catch { /* 服务还没就绪：当作没有当前会话 */ }
      return null
    }
    /** v127：切到任务日程看板（BoardView 挂载后才回调，最多等 ~1.5s）。 */
    /* v143（1.1）：每日任务面板是独立一列，在当前页就能开，不再切到日程看板 */
    const withSched = (fn: (v: BoardView) => void): void => { if (colAway('tp')) colFront('tp'); fn(ensureBoard()) }
    const gt = mountGoalTask({
      sessionId: currentSession,
      cardFor: (sid) => live.snap?.board.sessions.find((x) => x.sessionId === sid)?.cardId ?? null,
      snapshot: () => live.snap,
      refresh: () => { void live.refresh() },
      toast,
      sess: (id) => sessLite(id),
      active: () => activeSessions(),
      // v93③：说明框里的 / 菜单与会话输入框同源（dsh-client-ui-input-trigger 注册的命令 + 技能两个数据源）
      slashSources: () => {
        const svc = ctx.get?.('inputTriggers') as { live?: { sources?: Array<Record<string, unknown>> } } | undefined
        const all = svc?.live?.sources ?? []
        return all.filter((s) => s.trigger === '/') as never[]
      },
      // v96：任务弹窗里的「新增」= 卡片详情页同一个弹窗；保存后回传新条目，弹窗自动绑定
      addLink: (cardId) => {
        const v = globalDetailView() ?? boardView
        return v ? v.addLinksForTask(cardId) : Promise.resolve([])
      },
      addFile: (cardId) => {
        const v = globalDetailView() ?? boardView
        return v ? v.addFilesForTask(cardId) : Promise.resolve([])
      },
      addFrom: (cardId, kind, prefill) => ensureDialogView().addFromComposer(cardId, kind, prefill),
      /* v144（1）：相关说明模式保存 —— 拉最新卡片，按行号改 / 追加，写 card/noteitems */
      saveNote: async (cardId, k, it, auto) => {
        try {
          const fresh = await getState()
          const c = fresh.board.cards.find((x) => x.id === cardId)
          if (!c) return '这张卡片已经不存在了'
          const items = (c.noteItems ?? []).map((x) => ({ ...x }))
          if (k >= 0 && !items[k]) return '这条说明已经不存在了'
          if (items.some((x, i) => x.t === it.t && i !== k)) return '已经有一条叫「' + it.t + '」的说明了，换个标题'
          const v = { t: it.t, v: it.v, ...(it.off ? { off: true as const } : {}) }
          if (k >= 0) { const o: Record<string, unknown> = { ...items[k], ...v }; if (!it.off) delete o.off; items[k] = o as typeof items[number] } else items.push(v)
          await post('card/noteitems', { id: cardId, items })
          await live.refresh()
          for (const vw of [boardView, globalDetailView()]) if (vw) void vw.refresh(true)
          if (!auto) toast((k >= 0 ? '已保存相关说明「' : '已添加相关说明「') + it.t + '」· ' + (it.off ? '不注入 Agent 会话' : '自动注入 Agent 会话'))
          return ''
        } catch (e) { return '说明没保存上：' + (e instanceof ApiError ? e.message : String(e)) }
      },
      seek: (_cardId, keys) => withSched((v) => v.seekToday(keys)),
      scheduleToday: (cardId, keys) => {
        void scheduleKeys(cardId, keys).then((r) => { toast('已排今天：进了今天的「未安排」和本日计划清单' + (r.planAdded ? ' · 甘特图今天补上了计划条' : '')); boardView?.reloadSched(); void globalDetailView()?.refresh() })
          .catch((e: unknown) => toast('没排进今天：' + (e instanceof Error ? e.message : String(e)), 'err'))
      },
      added: (cardId, taskId, parentId) => {
        // 详情 / 看板都换成服务端最新快照，再打开详情并定位到这条新任务（v94：子任务先展开父任务）。
        // 详情本来就开着同一张卡时 openGlobalDetail 会直接 return（v89 拖动保护）→ 必须显式 refresh，
        // 否则屏幕上还是添加前那 12 条任务。
        void live.refresh()
        void boardView?.refresh()
        openDetailOnly(cardId)
        const v = globalDetailView()
        if (v) void v.refresh().then(() => v.revealTask(taskId, 90, parentId)).catch(() => v.revealTask(taskId, 90, parentId))
      },
      // v94：编辑保存后刷新详情并定位到这条任务（不新增，所以只做 refresh + reveal）
      saved: (cardId, taskId) => {
        void live.refresh()
        void boardView?.refresh()
        openDetailOnly(cardId)
        const v = globalDetailView()
        if (v) void v.refresh().then(() => v.revealTask(taskId)).catch(() => v.revealTask(taskId))
      },
    })
    goalTaskOpen = gt.open
    return () => { goalTaskOpen = null; gt.dispose() }
  }, 'dsh-project-manager: goal task')

  // ── 主区看板面板 ──
  const Board = (props: { usePanelInfo?: <T>(sel: (i: { activePanelId: string | null }) => T) => T }): unknown => {
    const ref = useRef<HTMLDivElement | null>(null)
    const [, bump] = useState(0)
    useEffect(() => {
      const el = ref.current
      if (!el) return
      /* v127（7）根因：宿主切面板会卸掉 main 插槽，旧代码每次都 new BoardView = 整个看板 / 甘特 DOM 重建（~140ms + 长任务）。
         现在只建一次：卸载时把根节点摘下来（记住滚动位置），下次挂载原样接回去；数据签名（rev）没变就不重画。 */
      if (!kept) {
        const box = document.createElement('div')
        box.style.cssText = 'height:100%;min-height:0'
        let vref: BoardView | null = null
        const pi0 = ctx.layout.panelInfo
        const v = new BoardView(box, makeBoardHost(() => vref), { startMode: pi0 && pi0.getSnapshot().activePanelId === SCHED ? 'sched' : 'board' })
        vref = v
        kept = { el: box, view: v, scroll: [] }
        el.append(box)
      } else {
        el.append(kept.el)
        /* v151（2.1）：马上要定位到详情里那张卡（看板页）= 不先写回上次离开时的看板滚动位置（否则先闪旧位置再跳） */
        const willSeek = !!(pendingCard || globalDetailCard()) && !(ctx.layout.panelInfo && ctx.layout.panelInfo.getSnapshot().activePanelId === SCHED)
        for (const [n, t, l] of kept.scroll) { if (willSeek && n.classList.contains('board-wrap')) continue; n.scrollTop = t; n.scrollLeft = l }
        kept.scroll = []
        void kept.view.refresh(true)
        kept.view.onSessionsChanged()
      }
      const view: BoardView = kept.view
      boardView = view
      if (pendingCard) { void view.focusCard(pendingCard); pendingCard = null }
      // 0.31 两个页共用一个面板：菜单里点的是哪一个就走哪一页
      const pi = ctx.layout.panelInfo
      let lastMode: 'board' | 'sched' | null = null
      const syncMode = (): void => {
        const m = pi && pi.getSnapshot().activePanelId === SCHED ? 'sched' : 'board'
        // v89：面板快照会因为「尺寸变化」反复推送（拖卡片详情宽度就会）；旧代码每次都当切页处理，
        // 于是 focusCard → openGlobalDetail 重跑，把正在拖的宽度用服务端值写回去（拖不动 / 回弹）。
        // 这里只在真的换了面板时动作；拖动宽度期间一律不碰详情。
        if (m === lastMode) return
        lastMode = m
        view.setMode(m)
        // 3(3)：详情开着时切到看板 / 日程，自动展开对应卡片组并滚到这张卡片
        const open = globalDetailCard()
        if (open && !document.body.classList.contains('cd-resizing')) void view.focusCard(open)
      }
      syncMode()
      const offPi = pi && typeof pi.subscribe === 'function' ? pi.subscribe(syncMode) : () => undefined
      const off = ctx.on('theme/change', () => { view.render(); bump((n) => n + 1) })
      // 会话改名 / 归档 / 恢复后，详情里的会话名与状态跟着变（只在详情打开时重绘，合并到一帧）
      let raf = 0
      const onStore = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; view.onSessionsChanged() }) }
      const offS = ctx.sessions.list.subscribe(onStore)
      const offW = ctx.workspaces.list.subscribe(onStore)
      return () => {
        off(); offS(); offW(); offPi(); if (raf) cancelAnimationFrame(raf); if (boardView === view) boardView = null
        if (kept && kept.view === view) {
          /* 摘下来之前记住所有滚动位置（DOM 摘掉后浏览器会清零） */
          kept.scroll = []
          for (const n of Array.from(kept.el.querySelectorAll<HTMLElement>('*'))) if (n.scrollTop || n.scrollLeft) kept.scroll.push([n, n.scrollTop, n.scrollLeft])
          kept.el.remove()
        } else view.dispose()
        void live.refresh()
      }
    }, [])
    return h('div', { ref, style: { height: '100%', minHeight: 0 } })
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Board)), 'dsh-project-manager: panel')

  // ── 全局面板「项目看板」主按钮：与「插件」同一组（官方 sidebar.panellist），行由宿主画，插件给图标块 + 整行光效层 + 徽标 ──
  const liveSess = (id: string): boolean => { const s = sessRef().list.getSnapshot().byId[id]; return !!s && s.origin !== 'subagent' && !(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(id) }
  const doing = (): number => (live.snap ? doingCount(live.snap.board, liveSess) : 0)
  const Entry = (p: { size?: number; active?: boolean }): unknown => {
    const [n, setN] = useState(doing)
    // 会话归档 / 恢复（workspaces 推送）、会话增删（sessions 推送）、看板变化都会立刻重算
    useEffect(() => { const f = (): void => setN(doing()); live.subs.add(f); const a = ctx.sessions.list.subscribe(f); const b = ctx.workspaces.list.subscribe(f); f(); return () => { live.subs.delete(f); a(); b() } }, [])
    return h(BoardEntry, { active: !!p.active, compact: (p.size ?? 16) > 16, count: n })
  }
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: '项目看板' }, Entry)), 'dsh-project-manager: board entry')

  // ── 0.32 「任务日程看板」：项目看板下面一行；紫色 + 日历图标，其余结构 / 动效与项目看板一致 ──
  /** v90：「N 项目」= 日程页页头「共 N 组 · M 项」里的 M —— 同一个数、同一个口径：
   *  日程列表里实际列出的项目行（pending 不列、归档默认不列、没有对应项目组的卡片不列）。
   *  没打开过日程页时用这个同口径的本地快照兜底；打开后徽标直接吃页头的广播（随搜索 / 显示已归档变）。 */
  const schedProjects = (): number => {
    const b = live.snap?.board
    if (!b) return 0
    const ok = new Set(b.groups.map((g) => g.id))
    return b.cards.filter((c) => ok.has(c.g) && !c.pending && !c.archivedAt).length
  }
  const SchedRow = (p: { size?: number; active?: boolean }): unknown => {
    const [n, setN] = useState(schedProjects)
    useEffect(() => {
      const f = (): void => setN(schedProjects()); live.subs.add(f)
      // v89：日程页页头每次重算都会广播同一个数，徽标直接用它 —— 两处永远同一帧、同一个值
      const onCnt = (e: Event): void => {
        const d = (e as CustomEvent<{ items?: number }>).detail
        if (d && typeof d.items === 'number') setN(d.items)
      }
      window.addEventListener('dpm:sched-count', onCnt)
      f()
      return () => { live.subs.delete(f); window.removeEventListener('dpm:sched-count', onCnt) }
    }, [])
    return h(SchedEntry, { active: !!p.active, compact: (p.size ?? 16) > 16, count: n })
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SCHED }, Board)), 'dsh-project-manager: sched panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: SCHED, order: 6, label: '任务日程看板' }, SchedRow)), 'dsh-project-manager: sched entry')

  /* ── v121（3）/ v122（2）：侧栏「今天」按钮 ──
     宿主的 sidebar.panellist 一行只能放一个入口；「任务日程看板」整块大小不变：原按钮宽度缩成 3/4（CSS），
     右侧让出的 1/4 放「今天」—— 插件自己的按钮，按宿主行的几何贴上去（fixed 定位 + ResizeObserver / rAF 跟随），
     侧栏收成图标栏 / 行不可见时隐藏。按下态 = 正在看今天的任务面板（SchedView 每次重画广播 dpm:today）。 */
  ctx.effect(() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'dpm-today'
    btn.hidden = true
    btn.setAttribute('aria-pressed', 'false')
    btn.setAttribute('aria-label', '今天：打开任务日程看板并打开今天的任务面板')
    btn.title = '今天：打开任务日程看板 + 今天任务面板'
    /* v143（6）：「今天」和两个看板按钮同一套特效层（流光描边 / 跟手光晕 / 扫光 / 点击波纹 / 进入脉冲），只换红色 */
    btn.innerHTML = '<span class="hfx" aria-hidden="true"><span class="rim"></span><span class="spot"></span><span class="sheen"></span><span class="ripple"></span></span><span class="lbl">今天</span>'
    btn.addEventListener('pointermove', (e) => { const r = btn.getBoundingClientRect(); btn.style.setProperty('--dpm-mx', (e.clientX - r.left) + 'px'); btn.style.setProperty('--dpm-my', (e.clientY - r.top) + 'px') })
    btn.addEventListener('pointerdown', (e) => { const r = btn.getBoundingClientRect(); btn.style.setProperty('--dpm-rx', (e.clientX - r.left) + 'px'); btn.style.setProperty('--dpm-ry', (e.clientY - r.top) + 'px'); btn.classList.remove('tap'); void btn.offsetWidth; btn.classList.add('tap'); setTimeout(() => btn.classList.remove('tap'), 700) })
    document.body.append(btn)
    let on = false
    let row: HTMLElement | null = null
    const ro = new ResizeObserver(() => { place(); follow() })
    /* v135 修：宿主行打上 / 去掉 data-dpm-rail（侧栏开合）在同一帧里重算，不等 ResizeObserver 下一帧 */
    const mo = new MutationObserver(() => { place(); follow() })
    const findRow = (): HTMLElement | null => {
      const e = document.querySelector('.dpm-entry.sched')
      return (e?.closest('button') as HTMLElement | null) ?? null
    }
    /* v135：左侧栏收起成图标栏（宿主行带 data-dpm-rail）→ 「今天」= 行正下方 4px 的 36×20 胶囊；气泡代替原生 title */
    let rail = false
    const tip = document.createElement('div')
    tip.className = 'dpm-rtip'
    tip.id = 'dpmTodayTip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.append(tip)
    let tipOn = false
    const tipText = (): string => on ? '正在看今天的任务面板（再点一次 = 关闭）' : '今天的任务面板'
    const tipShow = (): void => {
      if (!rail || btn.hidden) return
      tipOn = true
      tip.textContent = tipText()
      tip.hidden = false
      const r = btn.getBoundingClientRect()
      tip.style.left = Math.round(r.right + 10) + 'px'
      tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + 'px'
      btn.setAttribute('aria-describedby', 'dpmTodayTip')
    }
    const tipHide = (): void => { tipOn = false; tip.hidden = true; btn.removeAttribute('aria-describedby') }
    btn.addEventListener('pointerenter', tipShow)
    btn.addEventListener('pointerleave', tipHide)
    btn.addEventListener('focus', tipShow)
    btn.addEventListener('blur', tipHide)
    /* v135 修：宿主侧栏开合时是「列宽收窄 + 列 overflow 裁掉内容」，行本身先不动；「今天」挂在 body 上不受裁剪，
       会单独浮在内容上方 ~200ms（用户录屏里滞后的那一截）。→ 每次定位都按侧栏列的可见区域裁剪，完全在外就藏起来。 */
    let colEl: HTMLElement | null = null
    const clipTo = (x: number, y: number, w: number, h: number): void => {
      const c = colEl?.getBoundingClientRect()
      const l = c ? Math.max(0, Math.round(c.left - x)) : 0, t = c ? Math.max(0, Math.round(c.top - y)) : 0
      const rr = c ? Math.max(0, Math.round(x + w - c.right)) : 0, b = c ? Math.max(0, Math.round(y + h - c.bottom)) : 0
      const v = l + rr >= w || t + b >= h ? 'hidden' : ''
      const cp = l || t || rr || b ? 'inset(' + t + 'px ' + rr + 'px ' + b + 'px ' + l + 'px)' : ''
      if (btn.style.clipPath !== cp) btn.style.clipPath = cp
      if (btn.style.visibility !== v) btn.style.visibility = v
    }
    const place = (): void => {
      const r0 = findRow()
      if (r0 !== row) { ro.disconnect(); mo.disconnect(); row = r0; colEl = (row?.closest('[class*="_sidebarCol"]') as HTMLElement | null) ?? null; if (row) { ro.observe(row); mo.observe(row, { attributes: true, attributeFilter: ['data-dpm-rail'] }); const side = row.closest('nav, aside, [class*="panelList"]'); if (side) ro.observe(side as Element); if (colEl) ro.observe(colEl) } }
      if (!row || !row.isConnected) { btn.hidden = true; tipHide(); return }
      const r = row.getBoundingClientRect()
      const isRail = row.hasAttribute('data-dpm-rail')
      if (isRail !== rail) { rail = isRail; btn.classList.toggle('rail', rail); lastGeo = ''; tipHide(); paint() }
      if (rail) {
        if (r.width < 20 || r.height < 20) { btn.hidden = true; tipHide(); return }
        const geo = Math.round(r.left) + ',' + Math.round(r.bottom + 4) + ',' + Math.round(r.width) + ',20'
        btn.hidden = false
        clipTo(Math.round(r.left), Math.round(r.bottom + 4), Math.round(r.width), 20)
        if (geo === lastGeo) return
        lastGeo = geo
        follow()
        const [x, y, w, h] = geo.split(',')
        btn.style.left = x + 'px'; btn.style.top = y + 'px'; btn.style.width = w + 'px'; btn.style.height = h + 'px'
        btn.style.removeProperty('border-radius')
        if (tipOn) tipShow()
        return
      }
      if (r.width < 40 || r.height < 20) { btn.hidden = true; return }
      /* 整块宽 = 上一行「项目看板」的宽；间距 = 两行按钮之间的实际距离（宿主实测，写进 --dpm-pairgap 给 CSS 算 3/4 宽） */
      const br = (document.querySelector('.dpm-entry:not(.sched):not(.rail)')?.closest('button') as HTMLElement | null)?.getBoundingClientRect()
      const gap = br && br.bottom < r.top ? Math.max(4, Math.min(16, Math.round(r.top - br.bottom))) : 6
      const full = br ? br.width : r.width / 0.75 + gap
      if (document.body.style.getPropertyValue('--dpm-pairgap') !== gap + 'px') document.body.style.setProperty('--dpm-pairgap', gap + 'px')
      const geo = Math.round(r.left + r.width + gap) + ',' + Math.round(r.top) + ',' + Math.max(30, Math.round((br ? br.left : r.left) + full - (r.left + r.width + gap))) + ',' + Math.round(r.height)
      btn.hidden = false
      { const [gx, gy, gw, gh] = geo.split(',').map(Number); clipTo(gx, gy, gw, gh) }
      if (geo === lastGeo) return
      lastGeo = geo
      follow()
      const [x, y, w, h] = geo.split(',')
      btn.style.left = x + 'px'; btn.style.top = y + 'px'; btn.style.width = w + 'px'; btn.style.height = h + 'px'
      btn.style.borderRadius = getComputedStyle(row).borderRadius
    }
    let lastGeo = ''
    /* v135 修（用户录屏「左侧栏收起时今天按钮移动滞后」）：侧栏开合时宿主列宽有过渡动画，行一路平移但尺寸不变，
       ResizeObserver 不报、transitionend 也不保证落到这里 → 胶囊停在半路，等 2s 兜底才跳过去。
       改法：位置一变就逐帧跟着行走，行连续 8 帧不动才停（只在移动期间每帧量一次，静止时 0 开销）。 */
    let fol = 0
    let still = 0
    let lastRowGeo = ''
    const follow = (): void => {
      if (fol) return
      still = 0
      const tick = (): void => {
        place()
        /* 行和侧栏列都算：收起时行先不动、列在收窄 */
        const r = row?.getBoundingClientRect(), c = colEl?.getBoundingClientRect()
        const k = (r ? Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height) : '') + '|' + (c ? Math.round(c.left) + ',' + Math.round(c.width) : '')
        still = k === lastRowGeo ? still + 1 : 0
        lastRowGeo = k
        fol = still < 8 ? requestAnimationFrame(tick) : 0
      }
      fol = requestAnimationFrame(tick)
    }
    const paint = (): void => {
      btn.setAttribute('aria-pressed', String(on))
      if (rail) {
        btn.removeAttribute('title')
        btn.setAttribute('aria-label', on ? '正在看今天的任务面板，再点一次关闭' : '今天：打开任务日程看板并打开今天的任务面板')
        if (tipOn) tipShow()
        return
      }
      btn.setAttribute('aria-label', '今天：打开任务日程看板并打开今天的任务面板')
      btn.title = on ? '正在看今天的任务面板（再点一次 = 关闭面板）' : '今天：打开任务日程看板 + 今天任务面板'
    }
    const onToday = (e: Event): void => { const was = on; on = !!(e as CustomEvent<{ on?: boolean }>).detail?.on; if (on && !was) { btn.classList.remove('fx'); void btn.offsetWidth; btn.classList.add('fx'); setTimeout(() => btn.classList.remove('fx'), 700) } paint() }
    window.addEventListener('dpm:today', onToday)
    /* v143（1.1）：「今天」= 在当前页开 / 关每日任务面板列（不跳页）；面板叠在右边时点 = 换到前面 + 闪一下 */
    btn.addEventListener('click', () => {
      if (colAway('tp')) { colFront('tp'); toast('每日任务面板一直开着，只是叠在右边 → 已换到前面'); return }
      const v = ensureBoard()
      if (on) { v.closeToday(); return }
      v.openToday()
    })
    /* 行会因侧栏滚动 / 拖宽 / 收成图标栏 / 面板列表变化而挪位：这些事件都重算一次；再加一个 2s 的兜底。
       v133 R2：兜底原来 400ms —— 每次 getBoundingClientRect 都强制一次样式计算，执行中呼吸动画在跑时空闲 6s 多出 ~30 次样式重算（staging 52 → 23 次）。
       ponytail: 只有「尺寸不变、也没滚动 / resize 的挪位」才靠兜底，最多慢 2s 跟上；真遇到再加 MutationObserver。 */
    let raf = 0
    const soon = (): void => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place() }) }
    window.addEventListener('resize', soon)
    document.addEventListener('scroll', soon, true)
    /* v135：侧栏开合时宿主 frame 的列宽有过渡动画，行在动画中途就变成 36px（尺寸不再变、ResizeObserver 不再报），
       胶囊会停在动画中途的位置 → 动画结束再量一次 */
    const onTe = (e: TransitionEvent): void => { if (e.propertyName === 'grid-template-columns') { soon(); follow() } }
    document.addEventListener('transitionend', onTe, true)
    /* 过渡一开始就跟（宿主 frame 的 grid-template-columns 动画） */
    const onTs = (e: TransitionEvent): void => { if (e.propertyName === 'grid-template-columns' && row && (e.target as Node).contains?.(row)) follow() }
    /* 快捷键 / 收起按钮：宿主先改 frame 属性再起动画 —— frame 属性一变就开始跟 */
    /* 同一帧就量（宿主改 frame 的列宽在 rAF 之后提交，只排下一帧会让「今天」在列外多露一帧） */
    const fmo = new MutationObserver(() => { place(); follow() })
    const fr = document.querySelector('[data-rightbar-col]')?.parentElement
    if (fr) fmo.observe(fr, { attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-animating', 'style'] })
    document.addEventListener('transitionrun', onTs, true)
    const iv = window.setInterval(place, 2000)
    soon()
    return () => { if (raf) cancelAnimationFrame(raf); clearInterval(iv); window.removeEventListener('resize', soon); document.removeEventListener('scroll', soon, true); document.removeEventListener('transitionend', onTe, true); document.removeEventListener('transitionrun', onTs, true); if (fol) cancelAnimationFrame(fol); fmo.disconnect(); mo.disconnect(); ro.disconnect(); window.removeEventListener('dpm:today', onToday); btn.remove(); tip.remove() }
  }, 'dsh-project-manager: today button')

  // ── 0.19 会话信息卡（会话输入框上方）──
  const sendTo = async (id: string, text: string): Promise<void> => {
    const s = ctx.sessions
    if (typeof s.using !== 'function') throw new Error('当前 dsh 版本不能从界面给会话发消息（sessions.using 不存在）')
    const r = await s.using(id, { source: 'dsh-project-manager' }, (ref) => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))
    if (!r.ok) throw new Error((r.error?.message ?? '发送失败') + (r.error?.code ? '（' + r.error.code + '）' : ''))
  }
  const sessLite = (id: string): { title: string; archived: boolean; cwd: string } | null => {
    const v = ctx.sessions.list.getSnapshot().byId[id]
    if (!v) return null
    // 与侧栏同一规则：还没对话的空会话叫「新会话」（displayTitle 此时是文件夹名）
    return { title: v.title || (v.blank ? '新会话' : v.displayTitle) || '', archived: (ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(id), cwd: v.cwd ?? '' }
  }
  /** 0.27.2 引用列表「活跃会话」：项目区各卡片组子工作区里侧栏显示的会话（口径同组数字：没归档、非子代理、不是隐藏的空会话），
   * 按看板卡片组顺序分组；组内最近用过的在前；每项带绑定的卡片名（没绑 = null）。 */
  const activeSessions = (): ActiveGroup[] => {
    const snap = live.snap
    if (!snap) return []
    const ws = wsRef().list.getSnapshot()
    const arch = new Set(ws.archivedSessionIds ?? [])
    const byId = sessRef().list.getSnapshot().byId
    const bound: Record<string, string> = {}
    for (const r of snap.board.sessions) bound[r.sessionId] = r.cardId
    const out: ActiveGroup[] = []
    for (const g of snap.board.groups) {
      if (g.archivedAt) continue
      const wid = snap.hub.groups?.[g.id]
      const w = wid ? ws.items.find((x) => x.workspaceId === wid) : undefined
      const items = (w?.sessionIds ?? []).filter((id) => {
        const s = byId[id]
        if (!s || arch.has(id) || s.origin === 'subagent') return false
        return !(s.blank && !(id in bound) && !((s.retainedBy?.mainView ?? 0) > 0))
      }).map((id) => {
        const s = byId[id], c = bound[id] ? snap.board.cards.find((x) => x.id === bound[id]) : undefined
        return { id, title: s.title || (s.blank ? '新会话' : s.displayTitle) || '会话', card: c ? c.t : null, at: s.updatedAt ?? 0 }
      }).sort((a, b) => b.at - a.at)
      if (items.length) out.push({ id: g.id, name: g.name, items })
    }
    return out
  }
  /** 0.19 会话信息卡：挂在宿主输入区插槽（conversation.input.dock）。sessionId 走插槽属性，取不到再用 useSession 钩子。 */
  /* v136–v139：会话输入框里的引用胶囊来源（宿主 ReferenceChipNode 的 source = dsh-project-manager）。
     ref = 引用原文 → 复制 / 发送都是原文（codec.serialize 原样返回）；点胶囊 = 按种类打开 / 跳转。trigger 用一个打不出来的字符，不会弹菜单。 */
  /* 宿主账号 home（~/ 展开用）：ctx.remote 没在 inject 里，直接读会抛 —— 走 ctx.get，拿不到就从卡片路径猜 */
  const homeDir = (): string => {
    try { const r = ctx.get?.('remote') as { $host?: { home?: string } } | undefined; if (r?.$host?.home) return r.$host.home } catch { /* 没有 remote 服务 */ }
    const p = live.snap?.board.cards.flatMap((c) => [...(c.files ?? []).map((f) => f.path), ...(c.repos ?? []).map((r) => r.path)]).find((x) => /^\/(Users|home)\/[^/]+\//.test(x))
    const m = p ? /^\/(?:Users|home)\/[^/]+/.exec(p) : null
    return m ? m[0] : ''
  }
  const assists = new Map<string, ComposerAssist>()
  ctx.effect(() => {
    const it = ctx.get?.('inputTriggers') as { registerSource?: (s: Record<string, unknown>) => () => void } | undefined
    if (!it?.registerSource) { console.warn('[dsh-project-manager] 拿不到宿主的 inputTriggers，会话输入框里的引用不显示成胶囊（保持文字，复制 / 发送不受影响）'); return }
    return it.registerSource({
      trigger: '\u0001', name: SOURCE, showGroupTitle: false,
      candidates: async () => [], onPick: () => undefined,
      openReference: (session: { sessionId?: string }, r: { ref: string }) => { openRefChip(session?.sessionId ?? '', r.ref); return true },
      codec: { clipboardText: (ref: string) => ref, serialize: (ref: string) => Promise.resolve(ref) },
    })
  }, 'dsh-project-manager: composer chip source')
  const openRefChip = (sid: string, ref: string): void => {
    const info = assists.get(sid)?.infoNow() ?? null
    const ci = info?.cardInfo
    const hit = ComposerAssist.kindOfRef(ref, (ci?.notes ?? []).map((n) => ({ t: n.t, canon: quoteNoteText(n.t, n.v) })))
    if (!hit) { toast('引用内容：' + ref.slice(0, 80)); return }
    if (hit.kind === 'note') { const n = ci?.notes.find((x) => quoteNoteText(x.t, x.v) === ref); toast('相关说明「' + hit.title + '」：' + (n?.v ?? '').slice(0, 160)); return }
    if (hit.kind === 'link') { window.open(hit.body ?? '', '_blank', 'noopener'); return }
    if (hit.kind === 'file') {
      /* v142（4.2）：三种状态分开处理 —— 已在卡片 = 用默认应用打开；本机有未加入 = 添加为相关文件（路径预填）；原位置已不在 = 同名文件的新位置 */
      const a = assists.get(sid), st = a?.fileState(hit.body ?? '')
      const cid = info?.card?.id ?? ''
      if (st === 'ext' && cid) { void ensureDialogView().addFromComposer(cid, 'file', hit.body ?? '').then(() => a?.refresh()); return }
      if (st === 'gone') { void gonePop(sid, ref, hit.title, hit.body ?? ''); return }
      void openFileSmart({ card: cid, file: '', path: hit.body ?? '', name: hit.title }).then((r) => { if (r.how === 'rightbar') toast(openedHow(r) + '「' + hit.title + '」') }).catch((e) => toast('打不开这个文件：' + (e instanceof Error ? e.message : String(e)), 'err'))
      return
    }
    if (hit.kind === 'repo') { void post('fs/open-local', { path: hit.body ?? '' }).catch((e) => toast('打不开这个文件夹：' + (e instanceof Error ? e.message : String(e)), 'err')); return }
    if (hit.kind === 'card') { const c = live.snap?.board.cards.find((x) => x.t === hit.title); if (c) openDetailOnly(c.id); else toast('找不到这张卡片：' + hit.title, 'err'); return }
    const sx = activeSessions().flatMap((g) => g.items).find((x) => x.title === hit.title)
    if (sx) openAndReveal(sx.id); else toast('找不到这个会话：' + hit.title, 'err')
  }
  /* v142（4.2）：「已不在」的文件 → 小卡片列出本机同名文件（host paths/same-name），「改用这个位置」= 胶囊 + 发出去的原文都换成新路径 */
  let gp: HTMLElement | null = null
  const gpClose = (): void => { gp?.remove(); gp = null }
  ctx.effect(() => {
    const down = (e: PointerEvent): void => { if (gp && !gp.contains(e.target as Node)) gpClose() }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && gp) { e.stopPropagation(); gpClose() } }
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); gpClose() }
  }, 'dsh-project-manager: gone-file popover')
  const gonePop = async (sid: string, ref: string, title: string, path: string): Promise<void> => {
    gpClose()
    let cands: string[] = []
    try { cands = (await post<{ ok: boolean; candidates: string[] }>('paths/same-name', { path })).candidates ?? [] } catch (e) { toast('找同名文件失败：' + (e instanceof ApiError ? e.message : String(e)), 'err') }
    const chip = Array.from(document.querySelectorAll<HTMLElement>('[data-composer-chip="' + SOURCE + '"][data-dpm-path="' + CSS.escape(path) + '"]')).find((x) => x.offsetParent)
    const el = document.createElement('div')
    el.className = 'dpm-gp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '文件「' + title + '」已不在原位置')
    el.innerHTML = '<h4>' + esc(title) + '<small>已不在原位置</small></h4><p class="pth">' + esc(path) + '</p>'
      + (cands.length ? '<div class="cand">' + cands.map((k) => '<div><span><b>本机找到同名文件</b>' + esc(k) + '</span><button type="button" class="dpm-gpb pri" data-dpm-use="' + esc(k) + '">改用这个位置</button></div>').join('') + '</div>'
        : '<p class="none">本机没找到同名文件，它可能已被删除。胶囊照原样发给 Agent（引用原文不变）。</p>')
      + '<div class="ft"><button type="button" class="dpm-gpb" data-dpm-gpx>保持原样</button></div>'
    document.body.append(el); gp = el
    const r = (chip ?? document.body).getBoundingClientRect(), H = el.offsetHeight, W = el.offsetWidth
    let y = r.top - H - 6; if (y < 8) y = Math.min(innerHeight - H - 8, r.bottom + 6)
    el.style.left = Math.round(Math.max(8, Math.min(innerWidth - W - 8, r.left))) + 'px'; el.style.top = Math.round(y) + 'px'
    ;(window as unknown as Record<string, unknown>).__dpmGone = { path, cands }
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-dpm-gpx]')) { gpClose(); return }
      const u = t.closest('[data-dpm-use]') as HTMLElement | null; if (!u) return
      const np = u.dataset.dpmUse as string
      const ok = assists.get(sid)?.repath(ref, title, np) ?? false
      gpClose()
      toast(ok ? '已改用新位置：' + np + ' · 发给 Agent 的引用原文同步改成新路径' : '没换成：输入框里找不到这个胶囊了', ok ? 'ok' : 'err')
    })
    ;(el.querySelector('button') as HTMLElement | null)?.focus()
  }
  ;(window as unknown as Record<string, unknown>).__dpmComposer = { insert: (canon: string): boolean => { for (const a of assists.values()) if (a.visible()) return a.insertRef(canon); return false }, insertAt: (sid: string, canon: string, span: { start: number; end: number; draftRev: number }): boolean => assists.get(sid)?.insertRef(canon, span) ?? false, probe: (sid: string) => assists.get(sid)?.probe() ?? null }
  ctx.effect(() => () => { delete (window as unknown as Record<string, unknown>).__dpmComposer; for (const a of assists.values()) a.dispose(); assists.clear() }, 'dsh-project-manager: composer assists')
  const Dock = (props: { sessionId?: string; inputActions?: InputActions; useSession?: <T>(sel: (s: { id?: string; sessionId?: string } | undefined) => T) => T; useInput?: <T>(sel: (s: unknown) => T) => T }): unknown => {
    const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : undefined
    const sessionId = props.sessionId ?? viaHook
    const ref = useRef<HTMLDivElement | null>(null)
    const ia = useRef<InputActions | undefined>(props.inputActions)
    ia.current = props.inputActions
    /* v136：订阅宿主输入状态（draft + draftRev + 胶囊），每次变化交给 ComposerAssist 识别 / 转胶囊 */
    const inp = props.useInput ? props.useInput((x) => x) as { draft: string; draftRev: number; occurrences: Array<{ source: string; ref: string; offset: number; length: number; label: string }>; phase: string } | undefined : undefined
    const asRef = useRef<ComposerAssist | null>(null)
    useEffect(() => { const a = asRef.current; if (!a || !inp) return; a.setOccurrences(inp.occurrences ?? []); a.tick(inp) }, [inp])
    /* 重挂载（详情 / 右侧栏改布局时宿主会重建输入区）：新实例拿不到上一次的输入状态 → 胶囊原文表为空、三态不打标；建好后立刻用当前状态补一次 */
    const inpRef = useRef(inp); inpRef.current = inp
    useEffect(() => {
      const el = ref.current
      if (!el || !sessionId) return
      const asst = new ComposerAssist({
        sid: sessionId,
        info: () => card.infoNow(),
        actions: () => ia.current,
        scope: () => (ctx.sessions as unknown as { scope?: (id: string) => { bail?: (...a: unknown[]) => unknown } | undefined }).scope?.(sessionId),
        toast: (m, k) => toast(m, k),
        home: homeDir(),
        editor: () => { for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) { const ed = n.querySelector('[data-composer-card] [contenteditable="true"]') as HTMLElement | null; if (ed) return ed } return null },
        add: (kind, prefill) => {
          const cid = card.infoNow()?.card?.id
          if (!cid) return Promise.resolve(null)
          /* 一律用只装弹窗的隐藏实例：不打开 / 不切换详情、不把看板跳到这张卡 */
          const v = ensureDialogView()
          return v.addFromComposer(cid, kind, prefill).then((r) => { void card.load(true).then(() => asst.refresh()); return r })
        },
        openChip: () => undefined,
      })
      asRef.current = asst
      assists.set(sessionId, asst)
      /* v140（6）：信息卡大长条 + 右边独立「卡片详情」小按钮（同一行） */
      el.className = 'dpm-sicrow'; el.hidden = true
      const cardEl = document.createElement('div'), side = document.createElement('button')
      el.replaceChildren(cardEl, side)
      const card = new SessionCard(cardEl, sessionId, { toast, send: sendTo, openBoard: (cardId) => openBoardAt(cardId), openDetail: (cardId) => openDetailOnly(cardId), detailOpen: () => isGlobalDetailOpen(), closeDetail: () => closeGlobalDetail(), actions: () => ia.current, sess: sessLite, active: activeSessions }, { row: el, side })
      let io: IntersectionObserver | null = null
      if (typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) card.syncDetail() }, { threshold: 0.05 })
        io.observe(el)
      }
      const offInfo = card.onInfo(() => asst.refresh())
      /* v144（4.1）：信息卡 + 卡片详情按钮那一行背后透明 —— 宿主 composerSeat 自带 0→36px 的渐变底；给 seat 写一个不继承的变量，
         把实底起点挪到信息卡下沿 +18px（只写在 seat 自己身上；行隐藏 / 卸载 = 删属性还原） */
      let seat: HTMLElement | null = null, seatRaf = 0
      const seatLay = (): void => {
        seatRaf = 0
        const s = el.closest('[class*="composerSeat"]') as HTMLElement | null
        if (seat && seat !== s) { seat.removeAttribute('data-dpm-seat'); seat.style.removeProperty('--dpm-seat-top') }
        seat = s
        if (!s) return
        if (el.hidden || !el.offsetHeight) { s.removeAttribute('data-dpm-seat'); s.style.removeProperty('--dpm-seat-top'); return }
        const top = Math.round(el.getBoundingClientRect().bottom - s.getBoundingClientRect().top)
        s.setAttribute('data-dpm-seat', ''); s.style.setProperty('--dpm-seat-top', top + 'px')
      }
      const seatSoon = (): void => { if (!seatRaf) seatRaf = requestAnimationFrame(seatLay) }
      const seatRO = typeof ResizeObserver === 'function' ? new ResizeObserver(seatSoon) : null
      seatRO?.observe(el)
      const seatMO = new MutationObserver(seatSoon); seatMO.observe(el, { attributes: true, attributeFilter: ['hidden'] })
      seatSoon()
      /* card 声明之后再补（info() 要读 card）；用当前输入状态补一次，免得重挂载后胶囊原文表为空 */
      { const cur0 = inpRef.current; if (cur0) { asst.setOccurrences(cur0.occurrences ?? []); asst.tick(cur0) } }
      return () => { io?.disconnect(); offInfo(); seatRO?.disconnect(); seatMO.disconnect(); if (seatRaf) cancelAnimationFrame(seatRaf); if (seat) { seat.removeAttribute('data-dpm-seat'); seat.style.removeProperty('--dpm-seat-top') } card.dispose(); asst.dispose(); if (assists.get(sessionId) === asst) assists.delete(sessionId); asRef.current = null }
    }, [sessionId])
    return h('div', { ref, hidden: true })
  }
  // v91：排在宿主「待发送（排队）」条（order 20）之前。宿主的排队条带 margin-bottom: -(栈间距 6 + 3) = -9px 贴住输入框，
  // 排在它后面的 dock 会被这条负边距拉上去 3px（信息卡压住排队条 3px 的根因）。order 15 = 「目标条 10」之后、排队条 20 之前。
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-project-manager:memory', order: 15 }, Dock)), 'dsh-project-manager: memory dock')
  ctx.effect(() => marquee('.dpm-sic .mq, .dpm .detail .mq'), 'dsh-project-manager: marquee')
}
