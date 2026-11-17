/**
 * 0.63.0（v165）：会话输入框「>」引用卡片内容 = 引用伴手弹窗（quotepanel.ts 的唯一组件）。
 *
 * 这里只留两件事：
 *  1) buildQuoteRows = 八类数据的唯一口径（面板只渲染，不再各处自己拼条目）；
 *  2) QuoteMenu = 对话框这一侧的触发与插入（读光标 / 认「>」/ 把引用原文插回去，宿主 inputActions）。
 * 旧的外壳（.dpm-qm 浮层 / 列表 / 键盘）已删，面板统一画。
 */
import { cardText, detectKbQuote, detectQuote, fileText, kbText, leftOf, linkText, mutedBy, noteText, repoText, sessionText, taskText } from '../quote.js'
import { secHay, splitSections } from '../sections.js'
import { searchKb, type KbRef, type SessionInfo } from './api.js'
import { ftype } from './board.js'
import { KB_STATUS_LABEL, KB_TYPE_LABEL } from './kb.js'
import { closeQuotePanel, isQuotePanelOpen, openQuotePanel, repaintQuotePanel, type QpGroup, type QpItem } from './quotepanel.js'
import { ensureKbCards, kbBodyNow, kbCardsNow, kbQuoteGroups, warmKbBodies, warmKbSecs } from './kbdlg.js'

type Span = { start: number; end: number; draftRev: number }
export interface InputActions { captureInsertion(): Span; insertText(text: string, span: Span): boolean }
export interface QuoteHost {
  info(): SessionInfo | null
  actions(): InputActions | undefined
  sess(id: string): { title: string; archived: boolean } | null
  active(): ActiveGroup[]
  sid: string
  toast(msg: string, kind?: 'ok' | 'err'): void
}
export type ActiveGroup = { id: string; name: string; items: Array<{ id: string; title: string; card: string | null; at: number }> }
/** 引用菜单的数据来源（会话作用域）：弹窗说明框用同一份构造，条目与会话输入框完全一致。 */
export interface QuoteSource { info(): SessionInfo | null; active(): ActiveGroup[]; sid: string }

const home = (p: string): string => p.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/')
const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p
const host = (u: string): string => String(u || '').replace(/^https?:\/\//i, '').split('/')[0]
const oneLine = (s: string): string => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 64)

/** v163 S10：一张知识卡 → 面板条目。prompt 类插正文（它就是可复用指令），其余插引用原文。 */
const kbRow = (k: KbRef, pre = false): QpItem => {
  /* v179：正文按需二段式预取 —— 到齐后自动补「N 段」，先出的列表不等它 */
  const prompt = k.type === 'prompt'
  const body = kbBodyNow(k.id) ?? (prompt ? (k.body ?? '') : '')
  const secs = body ? splitSections(body, prompt ? { kind: 'task' } : { kind: 'kb', title: k.title, path: k.path }) : []
  return {
    kind: 'leaf',
    icon: 'kb',
    id: k.id,
    title: k.title,
    chip: (KB_TYPE_LABEL[k.type] ?? k.type) + (k.status === 'verified' ? '' : ' · ' + (KB_STATUS_LABEL[k.status] ?? '')),
    meta: oneLine(k.summary ?? ''),
    text: prompt ? body : kbText(k.title, k.path),
    secs,
    hay: ((k.title ?? '') + ' ' + (k.summary ?? '') + ' ' + (secs.length ? secHay(secs) : '')).toLowerCase(),
    ...(pre ? { pre: true } : {}),
  } as QpItem & { pre?: boolean }
}

/**
 * 八类 = 面板的行数据（顺序固定：任务 → 相关说明 → 知识卡 → 相关链接 → 相关文件 → 仓库 → 关联卡片 → 活跃会话）。
 * 任务只列未完成的；子任务也只在未完成时出现（已完成条数写进 subDone / subTotal）。
 */
export function buildQuoteRows(src: QuoteSource): QpGroup[] {
  const i = src.info()
  const ci = i?.cardInfo
  if (!ci) return []
  const G: QpGroup[] = []
  const qc = { tasks: ci.tasks.map((t) => ({ ...t, done: !!t.done })), links: ci.links.map((l) => ({ ...l, url: l.url })), files: ci.files.map((f) => ({ id: f.id, path: f.path, title: f.title, exists: f.exists })) }
  const undone = ci.tasks.map((t, a) => ({ t, a })).filter(({ t }) => !t.done)
  const doneN = ci.tasks.length - undone.length
  G.push({
    key: 'task', name: '任务', icon: 'task',
    hint: '未完成 · 说明全文' + (doneN ? ' · 已完成 ' + doneN + ' 项不显示' : ''),
    empty: '<b>任务都完成了</b> · 本版只列未勾选的' + (doneN ? '（已完成 ' + doneN + ' 项不显示）' : ''),
    items: undone.map(({ t, a }) => {
      const subsAll = t.subs ?? []
      const subs = subsAll.map((x, k) => ({ x, k })).filter(({ x }) => !x.done)
      const txt = taskText(qc, a)
      const secs = splitSections(txt, { kind: 'task' })
      return {
        kind: 'task',
        id: t.id ?? 't' + a,
        title: t.text,
        chip: t.type ?? '',
        text: txt,
        secs,
        hay: ((t.text ?? '') + ' ' + txt + (secs.length ? ' ' + secHay(secs) : '')).toLowerCase(),
        subDone: subsAll.filter((x) => x.done).length,
        subTotal: subsAll.length,
        subs: subs.map(({ x, k }) => {
          const st = taskText(qc, a, k)
          return { id: x.id ?? 's' + a + '_' + k, title: x.text, chip: x.type ?? '', text: st, secs: splitSections(st, { kind: 'task' }) }
        }),
      } as QpItem
    }),
  })
  // v88：开关只影响 AI 自动注入 —— 关闭的说明照样出现在引用面板里，右侧标「不注入」
  G.push({
    key: 'note', name: '相关说明', icon: 'note', hint: '标题：内容',
    items: ci.notes.map((n) => ({ kind: 'leaf', icon: 'note', id: n.t, title: n.t, chip: n.off ? '不注入' : '', meta: oneLine(n.v.split('\n')[0]), text: noteText(n.t, n.v) })),
  })
  const kbIds = (ci.kb ?? []).map((k) => ({ id: k.id, title: k.title, path: k.path, type: k.type }))
  G.push({
    key: 'kb', name: '知识卡', icon: 'kb', hint: 'prompt 插正文 · 其余引用原文',
    items: kbIds.map((k) => kbRow(k as KbRef)),
  })
  warmKbSecs(kbIds, repaintQuotePanel)
  G.push({
    key: 'link', name: '相关链接', icon: 'link', hint: '标题（URL）· 星标镶金',
    items: ci.links.map((l) => ({ kind: 'leaf', icon: 'link', id: l.id ?? l.url, title: l.text, chip: l.type || '无类型', meta: host(l.url), gold: !!l.star, text: linkText(l) })),
  })
  const dirs = ci.lfDirs ?? []
  G.push({
    key: 'file', name: '相关文件', icon: 'file', hint: '标题（路径）',
    items: ci.files.map((f) => {
      const ty = ftype(f.path)
      return {
        kind: 'leaf', icon: 'file', id: f.id ?? f.path, title: f.title || base(f.path),
        chip: ty ? ty.label : '文件', meta: f.path, gone: !f.exists,
        text: fileText({ path: f.path, title: f.title, exists: f.exists }),
        ...(dirs.some((d) => f.path.startsWith(d + '/')) ? { lf: true } : {}),
      } as QpItem
    }),
  })
  G.push({
    key: 'repo', name: '仓库', icon: 'repo', hint: '名字（路径）',
    items: ci.repos.map((r) => ({ kind: 'leaf', icon: 'repo', id: r.path, title: r.name, chip: '仓库', meta: home(r.path), text: repoText(r.name, r.path) })),
  })
  G.push({
    key: 'related', name: '关联卡片', icon: 'cards', hint: '名字（卡片组）',
    items: (ci.related ?? []).map((x) => ({ kind: 'leaf', icon: 'cards', id: x.id, title: x.title, chip: x.group, meta: x.archived ? '已归档' : (x.stage ?? ''), text: cardText(x.title, x.group) })),
  })
  const AG = src.active().map((g) => ({ ...g, items: g.items.slice().sort((a, b) => (b.id === src.sid ? 1 : 0) - (a.id === src.sid ? 1 : 0)) }))
  AG.sort((a, b) => (b.items.some((x) => x.id === src.sid) ? 1 : 0) - (a.items.some((x) => x.id === src.sid) ? 1 : 0))
  G.push({
    key: 'sess', name: '活跃会话', icon: 'chat', hint: '名字（卡片 · 会话）',
    items: AG.flatMap((g) => g.items.map((x) => ({ kind: 'leaf', icon: 'chat', id: x.id, title: x.title, chip: x.card ?? '还没有卡片', meta: x.id === src.sid ? '当前会话' : g.name, text: sessionText(x.title, g.name, x.card ?? undefined, x.id) }))),
  })
  return G.filter((g) => g.items.length || g.key === 'task')
}

export class QuoteMenu {
  private st: { len: number; q: string; ch: string; launch: number | null } | null = null
  /** v171：用户主动收起后「别重开」= 触发位置 + 触发字符左边那段原文（继续打字不复活） */
  private dis: { left: string; at: number; len: number } | null = null
  /** v167：这次按下是否已经「收起过」面板（时间戳；不设成布尔，免得一次没配上 click 就把下次点击也吞掉）。 */
  private skippedAt = 0

  private raf = 0
  private dead = false
  private kbHits: QpItem[] = []
  private kbQ = ''
  private kbT = 0
  /** v166：信息卡按钮（真正被点的那颗）—— 面板按它定位，不再按输入框 / 光标 */
  private trigger: HTMLElement | null = null
  /** v171：这一次弹的是哪种身份（「>」= quote /「）」= kb，同一块面板） */
  private kind: 'quote' | 'kb' = 'quote'
  private kbLoading = false
  constructor(private readonly root: HTMLElement, private readonly host: QuoteHost) {
    document.addEventListener('input', this.onEdit, true)
    document.addEventListener('selectionchange', this.onEdit)
    // v167：用 pointerdown（与面板自己的外部点击同相位，且本监听先注册）——
    // 否则面板会先在 pointerdown 里关掉，这里就记不到「再点同一个按钮 = 收起」的 skip
    document.addEventListener('pointerdown', this.onDown, true)
    window.addEventListener('resize', this.onResize)
  }
  dispose(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    document.removeEventListener('input', this.onEdit, true)
    document.removeEventListener('selectionchange', this.onEdit)
    document.removeEventListener('pointerdown', this.onDown, true)
    window.removeEventListener('resize', this.onResize)
    closeQuotePanel('composer')
  }
  /** 本会话的输入框：和信息卡在同一个输入区里的 [data-composer-card] 下的 contenteditable。 */
  private editor(): HTMLElement | null {
    for (let n: HTMLElement | null = this.root.parentElement; n; n = n.parentElement) {
      const ed = n.querySelector('[data-composer-card] [contenteditable="true"]') as HTMLElement | null
      if (ed) return ed
    }
    return null
  }
  private card(): HTMLElement | null { return this.editor()?.closest('[data-composer-card]') as HTMLElement | null }
  /** 光标前同一段的纯文字；中间夹着引用块（chip）或有选区 → null。 */
  private prefix(): { text: string; first: boolean } | null {
    const ed = this.editor(), sel = document.getSelection()
    if (!ed || !sel || sel.rangeCount === 0 || !sel.isCollapsed || !ed.contains(sel.anchorNode)) return null
    let para: Node | null = sel.anchorNode
    while (para && para.parentNode !== ed) para = para.parentNode
    if (!para) return null
    const rr = sel.getRangeAt(0)
    const r = document.createRange()
    r.setStart(para, 0)
    // 引用块（chip）是 contenteditable=false 的整体：只取光标前最后一个 chip 之后的文字
    let chip = false
    if (para.nodeType === 1) for (const x of Array.from((para as Element).querySelectorAll('[contenteditable="false"]'))) {
      if (x.compareDocumentPosition(rr.endContainer) & Node.DOCUMENT_POSITION_FOLLOWING || x.contains(rr.endContainer)) { r.setStartAfter(x); chip = true }
    }
    r.setEnd(rr.endContainer, rr.endOffset)
    return { text: r.toString().replace(/\u200b/g, ''), first: !chip && ed.firstChild === para }
  }
  private onEdit = (): void => {
    if (this.dead || this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.track() })
  }
  private onResize = (): void => { /* 面板自己监听 resize 重定位 */ }
  private track(): void {
    const ed = this.editor()
    // 0.27.2 与「/」菜单一致：焦点离开输入框（点了输入区里的工具栏等）不关，只有按在输入区外（onDown）/ Esc / 光标挪出「>」词才关
    if (!ed) return closeQuotePanel('composer')
    if (document.activeElement !== ed) return
    const ci = this.host.info()?.cardInfo
    if (!ci || !this.host.actions()) return closeQuotePanel('composer')
    const p = this.prefix()
    if (!p) return closeQuotePanel('composer')
    // 信息卡按钮打开的：光标前从打开处起的文字当筛选词；遇到空白 / 光标退到打开处之前就关
    if (this.st?.launch !== null && this.st?.launch !== undefined) {
      /* v167：这块面板没有「触发词」可依赖，唯一存活条件 = 面板还开着。关掉之后光标动一下、
         退格回空、再打普通文字，都不许把它复活（用户报的「怎么也关不掉」的根因）。
         丢掉 launch 态后继续往下走：这一次输入可能正是新打的「>」，别把它吞掉。 */
      if (!isQuotePanelOpen()) {
        this.st = null; this.trigger = null
      } else {
        const now = this.host.actions()!.captureInsertion().start
        const n = now - this.st.launch
        const q = n > 0 ? p.text.slice(-n) : ''
        if (n < 0 || /\s/.test(q) || q.length !== n) return closeQuotePanel('composer')
        if (n === 0) { // 没在打字：保持现状；删回空词时才把筛选刷回全量
          if (this.st.len !== 0 || this.st.q !== '') { this.st.len = 0; this.st.q = ''; this.paint() }
          return
        }
        this.st.len = n; this.st.q = q; this.paint(); return
      }
    }
    const hit = detectQuote(p.text, p.first)
    const khit = hit ? null : detectKbQuote(p.text)
    /* 输入变短 / 被清空 = 上一次的「别重开」作废（清空后再在行首打触发字符要能重新弹） */
    if (this.dis && p.text.length < this.dis.len) this.dis = null
    /* v171：主动收起过、还停在同一处触发位置、左边那段原文也没被改写 → 继续压着（继续打字不复活） */
    if (this.dis) {
      const h = hit ?? khit
      const caret = this.host.actions()?.captureInsertion().start ?? 0
      /* 变短 / 被清空也算「改写」：清空输入框后再在同一个位置打触发字符，要能重新弹 */
      if (h && p.text.length >= this.dis.len && this.dis.at === caret - h.len && mutedBy(this.dis.left, p.text)) return closeQuotePanel('composer')
      this.dis = null
    }
    /* v171：「）」/「)」（行首或空格后）= 知识卡引用；两种触发互不影响（同一个「别重开」记忆） */
    if (!hit) {
      if (!khit) { this.dis = null; return closeQuotePanel('composer') }
      this.kind = 'kb'
      this.st = { len: khit.len, q: khit.query, ch: '）', launch: null }
      this.kbLoad()
      this.paint()
      return
    }
    this.kind = 'quote'
    this.st = { len: hit.len, q: hit.query, ch: this.chOf(hit.len), launch: null }
    this.kbQueue()
    this.paint()
  }
  private chOf(len: number): string {
    const p = this.prefix()
    const t = p ? p.text : ''
    return t[t.length - len] === '》' ? '》' : '>'
  }
  /** 信息卡「> 引用卡片内容」：在当前光标处打开（不插入「>」）。trigger = 被点的那颗按钮（v166 锚点）。 */
  launch(trigger?: HTMLElement): void {
    // 0.27.1 再点一次「> 引用卡片内容」= 收起（按下时 onDown 已关掉并记下）
    if (this.skippedAt && Date.now() - this.skippedAt < 500) { this.skippedAt = 0; return }
    const ed = this.editor(), ia = this.host.actions()
    if (!ed || !ia) { this.host.toast('没找到这个会话的输入框，没法插入引用', 'err'); return }
    // 按钮在 mousedown 时已阻止抢焦点：输入框焦点与光标都还在，直接从当前光标处打开
    if (document.activeElement !== ed) ed.focus()
    this.trigger = trigger ?? null
    this.kind = 'quote'
    this.st = { len: 0, q: '', ch: '>', launch: ia.captureInsertion().start }
    this.paint()
  }
  /** 组数据 = 八类 + 输入词搜到的知识卡（前 8 条，按 id 去掉已挂的）。 */
  private groups(): QpGroup[] {
    const G = buildQuoteRows(this.host)
    if (!this.kbHits.length) return G
    const g = G.find((x) => x.key === 'kb')
    if (!g) return G
    const have = new Set(g.items.map((x) => x.id))
    const add = this.kbHits.filter((x) => !have.has(x.id)).slice(0, 8)
    if (add.length) g.items = g.items.concat(add)
    return G
  }
  /* ── v171：知识卡身份的数据（全量六类分组；提示词正文按需预取，到齐后重画一次） ── */
  private kbLoad(): void {
    const again = (): void => { if (!this.dead && isQuotePanelOpen()) this.paint() }
    const had = kbCardsNow()
    if (had) { warmKbBodies(had, again); return }
    if (this.kbLoading) return
    this.kbLoading = true
    void ensureKbCards().then((cards) => { this.kbLoading = false; warmKbBodies(cards, again); again() }).catch(() => { this.kbLoading = false })
  }
  /* ── v163 S10：输入词 → host /kb/search（160ms 防抖），结果并进「知识卡」组 ── */
  private kbQueue(): void {
    const q = (this.st?.q ?? '').trim()
    if (q === this.kbQ) return
    this.kbQ = q
    clearTimeout(this.kbT)
    if (this.kbHits.length) { this.kbHits = []; this.paint() }
    if (!q) return
    this.kbT = window.setTimeout(() => {
      void searchKb(q, { limit: 12 }).then((r) => {
        if (this.dead || (this.st?.q ?? '').trim() !== q) return
        this.kbHits = (r.cards ?? []).map((c) => kbRow({ id: c.id, title: c.title, type: c.type, status: c.status, summary: c.summary, path: c.path }, true))
        this.paint()
      }).catch(() => undefined)
    }, 160)
  }
  private paint(): void {
    const st = this.st
    const i = this.host.info()
    if (!st || !i?.card) return closeQuotePanel('composer')
    const ed = this.editor()
    const anchor = (this.card() ?? ed) as HTMLElement | null
    if (!anchor) return closeQuotePanel('composer')
    /* v166：定位锚点 = 按钮 / 信息卡（含按钮的那一整行），不是输入框；anchor 仍留输入区（点输入框不关面板）。
       按钮路径才有 trigger；打字「>」路径没有 trigger，靠 place 落到信息卡上方。 */
    const place = (this.trigger?.closest('.dpm-sic') as HTMLElement | null)
      ?? (document.querySelector('.dpm-dock.dpm-sic') as HTMLElement | null)
      ?? (this.card() as HTMLElement | null)
    openQuotePanel({
      kind: this.kind,
      where: 'composer',
      label: 'DSH 对话框',
      card: i.card.title,
      cardId: i.card.id,
      anchor,
      trigger: this.trigger ?? undefined,
      place: place ?? undefined,
      host: document.body,
      hit: { len: st.len, q: st.q, ch: st.ch },
      build: () => (this.kind === 'kb' ? kbQuoteGroups(kbCardsNow() ?? []) : this.groups()),
      insert: (text, hit) => this.insert(text, hit),
      toast: (m, k) => this.host.toast(m, k),
      /* v171：Esc / 点外面收起也记「别重开」（与 richnote / 任务说明同一条规则） */
      onClose: (how) => { if (how === 'esc' || how === 'outside') this.remember() },
    })
  }
  /** 插入：引用原文直接在「空格 + >筛选词」处插成胶囊（宿主 insert-reference）；接不住才退回插文字。 */
  private insert(text: string, hit: { len: number; q: string; ch?: string }): void {
    const ia = this.host.actions()
    const st = this.st
    if (!ia) return
    const cur = ia.captureInsertion()
    const span = { start: st?.launch ?? cur.start - (hit.len || 0), end: cur.start, draftRev: cur.draftRev }
    const cx = (window as unknown as { __dpmComposer?: { insertAt(sid: string, c: string, sp: Span): boolean } }).__dpmComposer
    if (cx?.insertAt(this.host.sid, text, span)) { this.editor()?.focus(); return }
    if (!ia.insertText(text, span)) this.host.toast('插入引用失败：输入框内容刚刚变了，再选一次', 'err')
    this.editor()?.focus()
  }
  private onDown = (e: PointerEvent): void => {
    const t = e.target as HTMLElement
    /* v179：分段列表挂在面板外面 —— 点它不算「点外面」（否则 pointerdown 先关面板，分段卡的 click 就落空） */
    if (t.closest?.('.qpn-sgs')) return
    if (isQuotePanelOpen() && t.closest?.('.qpn')) return
    if (!isQuotePanelOpen()) return
    // 0.27.2 与宿主「/」菜单一致（dsh-client-ui-input-trigger：pointerdown 在 [data-composer-card] 里不关）：
    // 输入区里按下不关，光标还在「>」词里就留着，挪出去由 track 关、挪回来再弹；输入区外按下 = 收起并记住同一个「>」
    if (t.closest?.('[data-qopen]')) { this.skippedAt = Date.now(); this.dismiss(); return }
    if (this.card()?.contains(t)) return
    this.dismiss()
  }
  /** 收起并记住当前触发位置：track 看到同一处触发词不再弹。 */
  private remember(): void {
    const st = this.st
    const p = this.prefix()
    /* 信息卡按钮那条路径没有触发词：不记 */
    if (!st || !p || st.launch !== null) { this.dis = null; return }
    const caret = this.host.actions()?.captureInsertion().start ?? 0
    this.dis = { left: leftOf(p.text, st.len), at: caret - st.len, len: p.text.length }
  }
  private dismiss(): void {
    this.remember()
    closeQuotePanel('composer')
  }
}
