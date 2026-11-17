/**
 * v164：一套富文本编辑框 —— 插件自己那几处编辑器（卡片任务说明 / 卡片相关说明 / 知识卡正文）共用的同一层。
 *
 * 为什么要有这个文件：v101 的块编辑器（notedoc.ts）只解决「行 / 分割线 / 胶囊 / 撤销」，
 * 而「工具行 + > 引用菜单 + 胶囊装饰与气泡 + 复制展开 + 路径识别 + ⌘Enter / Esc 分层」原本只长在
 * goaltask.ts 里，知识库那处只能裸调 mountNoteDoc → 两处体验差一大截（v164 要修的就是这个）。
 *
 * 分层（ctx 决定开哪几层）：
 *   L1 块编辑器        mountNoteDoc（文本行 / 分割线块 / 撤销栈 / 光标换算）
 *   L2 工具行          字数 · 分割线按钮 · ⌘Z / ⇧⌘Z              → ctx.countEl / ctx.dividerBtn
 *   L3 引用            > / 》 菜单 + 胶囊 + 气泡 + 复制展开        → ctx.quote / ctx.catalog / ctx.onChip
 *   L4 识别层          路径 / 链接虚线 + 气泡 + ⌘ 点击打开         → ctx.marks
 *   L5「添加为…」      需要卡片上下文（goaltask 自己有 NoteAssist）  → 本文件不管
 *   L6 历史消息        需要会话上下文（goaltask 自己有）             → 本文件不管
 *   L7 提交            ⌘Enter / Esc 逐层收                        → ctx.submit
 *
 * 落点：kb.ts（知识卡正文）现在就用它；goaltask.ts 的说明框在后续切片改为用它 + 追加 L5/L6。
 * 说明：DSH 对话框的编辑器是宿主 Lexical，插件只能共用「胶囊 + 识别 + 引用来源」那层（qmenu.ts / composer.ts）。
 */
import { mountNoteDoc, type NoteDoc } from './notedoc.js'
import { chipIconSvg } from './chipicon.js'
import { esc, ic } from './icons.js'
import { detectKbQuote, detectQuote, leftOf, mutedBy } from '../quote.js'
import { closeQuotePanel, isQuotePanelOpen, openQuotePanel, quotePanelWhere, type QpGroup } from './quotepanel.js'

export type ChipKind = 'note' | 'link' | 'file' | 'repo' | 'card' | 'sess' | 'kb' | 'prod'

/** 引用原文 → 胶囊（catalog 由调用方给：知识卡是 kb 卡 + 项目卡，任务说明是卡片的五类资料）。 */
export interface ChipItem {
  kind: ChipKind
  id: string
  title: string
  canon: string
  /** 同一引用项的其它等价原文（v154 搬家后的旧路径等） */
  alts?: string[]
  tip?: string
  /** 气泡里的正文（摘要 / 内容） */
  body?: string
  /** 气泡右上角的次要标签 */
  sub?: string
  /** 追加到胶囊上的 class（如 kbi） */
  cls?: string
}

export interface RichCtx {
  /** 用于区分落点（写进 DOM 上的 data-rich，验收脚本按它取样） */
  where: string
  toast: (m: string, k?: 'ok' | 'err') => void
  /** L3：引用面板的分组（不给 = 不弹面板） */
  quote?: () => QpGroup[] | null
  /** v171：打「）」时的知识卡面板分组（不给 = 这处编辑器不接知识卡那条触发） */
  kb?: () => QpGroup[] | null
  /** L3：引用原文 → 胶囊的目录（不给 = 不装饰胶囊） */
  catalog?: () => ChipItem[]
  /** L3：胶囊被点（返回 true = 外部处理，内置气泡不弹） */
  onChip?: (chip: HTMLElement, meta: { cmd: boolean }) => boolean
  /** L3：文档重建后回调（外部可以接着做「引用即关联」等副作用） */
  onBuilt?: () => void
  /** L4：识别层（true = 开；marksOpen 决定 ⌘ 点击做什么） */
  marks?: boolean
  /** 识别层气泡末尾的一句说明（各宿主自己写：为什么这里只识别、不给「添加为…」）。 */
  marksNote?: string
  marksOpen?: (tok: string) => void
  /** L2 */
  countEl?: HTMLElement | null
  dividerBtn?: HTMLElement | null
  /** L7 */
  submit?: () => void
  /** 插入引用：默认按 nd.set 重写整段（与 v101 一致）；外部可覆盖以保留自己的插入路径 */
  insert?: (text: string, hitLen: number) => void
  /** 菜单位置参照元素（默认 root） */
  anchor?: HTMLElement | null
}

export interface RichNote {
  root: HTMLElement
  nd: NoteDoc
  /** 重新装饰胶囊 / 识别层 */
  refresh: () => void
  text: () => string
  set: (v: string) => void
  menuOpen: () => boolean
  closeMenu: () => void
  destroy: () => void
}

const ZW = '\u200b'
const PATH_RX = /https?:\/\/[^\s，。、；：）】」』"'<>]+|(?:~|\/(?:Users|home|opt|tmp|var|usr|etc))\/[^\s，。、；：）】」』"'<>]+/g

export function mountRichNote(root: HTMLElement, ctx: RichCtx): RichNote {
  const toast = ctx.toast
  /* v168：浮层（胶囊气泡 / 识别提示 / 引用面板）要落在同一个顶层容器里 ——
     在 <dialog> 里挂的编辑器，body 上的浮层会被 dialog 的顶层盖住 */
  const layer = (): HTMLElement => (root.closest('dialog') as HTMLElement | null) ?? document.body
  root.dataset.rich = ctx.where
  const nd = mountNoteDoc(root, {
    toast,
    onBuilt: () => { decorate(); paintMarks(); runBuilt() },
  })

  /* ── L2 工具行 ─────────────────────────────────────────────────────────── */
  const paintCount = (): void => { const el = ctx.countEl; if (el) el.textContent = nd.text().trim().length + ' 字' }
  const dv = ctx.dividerBtn
  if (dv) {
    dv.addEventListener('pointerdown', (e) => e.preventDefault())
    dv.addEventListener('click', () => { nd.insertDivider(); root.focus(); paintCount() })
  }
  paintCount()

  /* ── L3 胶囊：引用原文 → .nref（几何全站一套） ──────────────────────────── */
  function mkChip(it: ChipItem): HTMLElement {
    const s = document.createElement('span')
    s.className = 'nref' + (it.cls ? ' ' + it.cls : '') + (it.kind === 'kb' ? ' kbk' : '')
    s.setAttribute('contenteditable', 'false')
    s.setAttribute('tabindex', '0')
    s.setAttribute('role', 'button')
    s.dataset.rk = it.kind
    s.dataset.rid = String(it.id)
    s.dataset.canon = it.canon
    s.title = (it.tip ?? it.title) + '（' + it.canon + '）'
    s.innerHTML = '<span class="ri">' + chipIconSvg(it.kind, it.body ?? '') + '</span><span class="rt">' + esc(it.title) + '</span>'
    return s
  }
  function decorate(): number {
    const cat = ctx.catalog?.() ?? []
    if (!cat.length) return 0
    const focused = root.contains(document.activeElement)
    let caret = -1
    try { caret = focused ? (root as unknown as HTMLTextAreaElement).selectionStart : -1 } catch { caret = -1 }
    let n = 0
    for (const blk of Array.from(root.children) as HTMLElement[]) {
      if (blk.dataset.b !== 't') continue
      for (let guard = 0; guard < 60; guard++) {
        let hit: { node: Text; i: number; len: number; it: ChipItem } | null = null
        for (const node of Array.from(blk.childNodes)) {
          if (node.nodeType !== 3) continue
          const txt = node.textContent ?? ''
          for (const it of cat) {
            for (const v of [it.canon, ...(it.alts ?? [])]) {
              const i = txt.indexOf(v)
              if (i < 0) continue
              if (!hit || i < hit.i || (i === hit.i && v.length > hit.len)) hit = { node: node as Text, i, len: v.length, it }
            }
          }
        }
        if (!hit) break
        const txt = hit.node.textContent ?? ''
        const frag = document.createDocumentFragment()
        frag.appendChild(document.createTextNode(txt.slice(0, hit.i) || ZW))
        frag.appendChild(mkChip(hit.it))
        frag.appendChild(document.createTextNode(txt.slice(hit.i + hit.len) || ZW))
        blk.replaceChild(frag, hit.node)
        n++
      }
      for (const c of Array.from(blk.querySelectorAll(':scope > .nref'))) {
        if (!c.previousSibling || c.previousSibling.nodeType !== 3) c.before(document.createTextNode(ZW))
        if (!c.nextSibling || c.nextSibling.nodeType !== 3) c.after(document.createTextNode(ZW))
      }
    }
    if (n && caret >= 0) { try { (root as unknown as HTMLTextAreaElement).setSelectionRange(caret, caret) } catch { /* ignore */ } }
    return n
  }
  function runBuilt(): void {
    paintCount()
    if (ctx.onBuilt) { try { ctx.onBuilt() } catch { /* ignore */ } }
  }

  /* ── L3 胶囊气泡（读态预览；任务说明那边由 goaltask 自己的 onChip 处理） ── */
  let pop: HTMLElement | null = null
  function hidePop(): void {
    if (!pop) return
    root.querySelector('.nref.on')?.classList.remove('on')
    pop.remove(); pop = null
  }
  function showPop(chip: HTMLElement): void {
    hidePop()
    const it = (ctx.catalog?.() ?? []).find((x) => x.canon === chip.dataset.canon)
    if (!it) { toast('这条引用项已经不在了', 'err'); return }
    const el = document.createElement('div')
    el.className = 'nref-pop rich-pop'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', it.title)
    el.innerHTML = '<div class="nph"><span class="npi">' + chipIconSvg(it.kind, it.body ?? '') + '</span><b>' + esc(it.title) + '</b>'
      + (it.sub ? '<span class="npt">' + esc(it.sub) + '</span>' : '') + '</div>'
      + (it.body ? '<p class="npb">' + esc(it.body) + '</p>' : '')
      + '<div class="npf"><kbd>⌘ 点击</kbd> 打开 · <kbd>Esc</kbd> 关闭 · 复制这个胶囊 = 引用原文</div>'
    layer().append(el)
    el.style.position = 'fixed'
    const r = chip.getBoundingClientRect()
    el.style.left = Math.round(Math.max(10, Math.min(r.left, innerWidth - el.offsetWidth - 10))) + 'px'
    let top = r.bottom + 8
    if (top + el.offsetHeight + 12 > innerHeight) top = Math.max(10, r.top - el.offsetHeight - 8)
    el.style.top = Math.round(top) + 'px'
    chip.classList.add('on')
    pop = el
  }

  /* ── L3 选中文字（含胶囊）→ 纯文本；胶囊按引用原文展开 ────────────────── */
  function selText(): string | null {
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null
    const r = sel.getRangeAt(0)
    if (!root.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== root) return null
    const chips = Array.from(root.querySelectorAll('.nref'))
    if (!chips.some((c) => r.intersectsNode(c))) return null
    const textOf = (node: Node): string => {
      if (node.nodeType === 3) return (node.textContent ?? '').split(ZW).join('')
      const el = node as HTMLElement
      if (el.classList?.contains('nref')) return el.dataset.canon ?? el.textContent ?? ''
      if (el.tagName === 'BR') return '\n'
      let out = ''
      for (const ch of Array.from(node.childNodes)) out += textOf(ch)
      if (el.classList?.contains('nline') || el.classList?.contains('nblk')) out += '\n'
      return out
    }
    let out = ''
    for (const ch of Array.from(r.cloneContents().childNodes)) out += textOf(ch)
    return out.replace(/\u00a0/g, ' ').replace(/\n+$/, '')
  }

  /* ── L4 识别层：路径 / 链接虚线（CSS Custom Highlight，不改 DOM） ────────── */
  const HL = 'dpm-rich-mark'
  function lineOf(el: Element): string { let s = ''; for (const n of Array.from(el.childNodes)) s += n.nodeType === 3 ? (n.textContent ?? '').split(ZW).join('') : (n as HTMLElement).dataset?.canon ?? (n.textContent ?? ''); return s }
  function paintMarks(): void {
    if (!ctx.marks) return
    const C = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    if (!C?.highlights || !H) return
    const ranges: Range[] = []
    for (const blk of Array.from(root.children) as HTMLElement[]) {
      if (blk.dataset.b !== 't') continue
      const line = lineOf(blk)
      if (!/[\/h]/.test(line)) continue
      let start = 0
      for (const node of Array.from(blk.childNodes)) {
        const len = node.nodeType === 3 ? (node.textContent ?? '').split(ZW).join('').length : 1
        if (node.nodeType === 3) {
          const raw = node.textContent ?? ''
          PATH_RX.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = PATH_RX.exec(line))) {
            const a = m.index - start, b = a + m[0].length
            if (b <= 0 || a >= raw.length) continue
            const sa = Math.max(0, a), sb = Math.min(raw.length, b)
            if (sb <= sa) continue
            const r = document.createRange()
            r.setStart(node, sa); r.setEnd(node, sb)
            ranges.push(r)
          }
        }
        start += len
      }
    }
    try {
      if (!ranges.length) C.highlights.delete(HL)
      else C.highlights.set(HL, new H(...ranges))
    } catch { /* ignore */ }
  }
  let mTip: HTMLElement | null = null
  function hideMTip(): void { if (mTip) { mTip.remove(); mTip = null } }
  function markAt(x: number, y: number): string | null {
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const cr = doc.caretRangeFromPoint?.(x, y)
    if (!cr || !root.contains(cr.startContainer)) return null
    let blk = cr.startContainer as Node | null
    while (blk && blk.parentNode !== root) blk = blk.parentNode
    if (!blk || (blk as HTMLElement).dataset?.b !== 't') return null
    let off = 0
    for (const sib of Array.from(blk.childNodes)) {
      if (sib === cr.startContainer) { off += cr.startOffset; break }
      off += sib.nodeType === 3 ? (sib.textContent ?? '').split(ZW).join('').length : 1
    }
    const line = lineOf(blk as Element)
    PATH_RX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PATH_RX.exec(line))) if (off >= m.index && off <= m.index + m[0].length) return m[0]
    return null
  }
  function showMTip(tok: string, x: number, y: number): void {
    hideMTip()
    const isUrl = /^https?:/i.test(tok)
    const el = document.createElement('div')
    el.className = 'nref-pop rich-mtip'
    el.setAttribute('role', 'dialog')
    el.innerHTML = '<div class="nph"><span class="npi">' + chipIconSvg(isUrl ? 'link' : 'file') + '</span><b>' + (isUrl ? '链接' : '路径') + '</b><span class="npt">正文里识别到</span></div>'
      + '<p class="npb">' + esc(tok) + '</p>'
      + (ctx.marksNote ? '<p class="npn">' + esc(ctx.marksNote) + '</p>' : '')
      + '<div class="npf"><kbd>⌘ 点击</kbd> ' + (isUrl ? '用浏览器打开' : '用默认应用打开') + '</div>'
    layer().append(el)
    el.style.position = 'fixed'
    el.style.left = Math.round(Math.max(10, Math.min(x, innerWidth - el.offsetWidth - 10))) + 'px'
    el.style.top = Math.round(Math.min(y + 16, innerHeight - el.offsetHeight - 10)) + 'px'
    mTip = el
  }

  /* ── L3 引用面板（> / 》）＝ v165 唯一组件（knowledge 正文只有知识卡 + 关联卡片两组） ── */
  /** 用户主动关掉面板（Esc / 点外面）后，触发字符左边那段原文没变之前不再立刻重开 —— 否则 Esc 看上去「没反应」。
   *  v171：记的是「左边那段原文」而不是整段值 —— 在筛选词后面继续打字不会把它复活（原型 J 组口径）。 */
  let muted: { left: string; at: number; len: number } | null = null
  function menuOpen(): boolean { return isQuotePanelOpen() && quotePanelWhere() === 'kb' }
  function closeMenu(): void { closeQuotePanel('kb') }
  /** 光标前那一行（块编辑器的纯文本常以空行收尾，落在空行时退到上一个非空位）。 */
  function paraBefore(caret: number): { v: string; at: number; para: string } {
    const v = String((root as unknown as HTMLTextAreaElement).value ?? '')
    let at = caret
    while (at > 0 && /\s/.test(v[at - 1] ?? '')) at--
    return { v, at, para: v.slice(v.lastIndexOf('\n', at - 1) + 1, at) }
  }
  /** 触发识别 = 共享的 detectQuote / detectKbQuote（任务说明 / 对话框 / 知识卡同一条规则，不各写一份）。 */
  function hitOf(): { len: number; q: string; ch: string; kind: 'quote' | 'kb'; para: string } | null {
    let caret = 0
    try { caret = (root as unknown as HTMLTextAreaElement).selectionStart } catch { return null }
    const { v, at, para } = paraBefore(caret)
    const q = detectQuote(para)
    if (q) return { len: q.len, q: q.query, ch: v[at - q.len] === '》' ? '》' : '>', kind: 'quote', para }
    /* v171：「）」/「)」= 知识卡身份（同一块面板；编辑器里两种触发互不影响） */
    const k = detectKbQuote(para)
    if (k) return { len: k.len, q: k.query, ch: '）', kind: 'kb', para }
    return null
  }
  function checkMenu(): void {
    if (!ctx.quote && !ctx.kb) return
    if (document.activeElement !== root) { closeMenu(); return }
    /* 输入变短 / 被清空 = 上一次的「别重开」作废（清空后再在行首打触发字符要能重新弹） */
    if (muted) {
      let total = 0
      try { total = String((root as unknown as HTMLTextAreaElement).value ?? '').length } catch { total = 0 }
      if (total < muted.len) muted = null
    }
    const hit = hitOf()
    /* 触发词已经不在了（被删掉 / 清空）→ 「别重开」作废 */
    if (!hit) { muted = null; closeMenu(); return }
    /* 主动关掉过、且还停在同一处触发位置、且左边那段原文没被改写 → 保持关闭
       （继续打字不复活；清掉 / 改写左边、或换个位置重新打触发字符才解除） */
    if (muted) {
      let caret = 0
      let total = 0
      try { caret = (root as unknown as HTMLTextAreaElement).selectionStart; total = String((root as unknown as HTMLTextAreaElement).value ?? '').length } catch { caret = 0 }
      /* 变短 / 被清空也算「改写」：清空输入框后再在同一个位置打触发字符，要能重新弹 */
      if (total >= muted.len && muted.at === caret - hit.len && mutedBy(muted.left, hit.para)) { closeMenu(); return }
      muted = null
    }
    const kb = hit.kind === 'kb'
    const G = (kb ? ctx.kb?.() : ctx.quote?.()) ?? []
    if (!G.length) { closeMenu(); return }
    openQuotePanel({
      kind: kb ? 'kb' : 'quote',
      where: 'kb',
      label: '知识卡正文',
      anchor: (ctx.anchor ?? root) as HTMLElement,
      host: layer(),
      hit,
      build: () => (hit.kind === 'kb' ? ctx.kb?.() : ctx.quote?.()) ?? [],
      insert: (text, h) => insertQuote(text, h.len || 0),
      toast,
      onClose: (how) => {
        /* 只对用户主动收起（esc / 点外面）记；pick / api 是程序化关闭，不记 */
        if (how !== 'esc' && how !== 'outside') return
        const h = hitOf()
        let caret = 0
        let total = 0
        try { caret = (root as unknown as HTMLTextAreaElement).selectionStart; total = String((root as unknown as HTMLTextAreaElement).value ?? '').length } catch { caret = 0 }
        if (h) muted = { left: leftOf(h.para, h.len), at: caret - h.len, len: total }
      },
    })
  }
  /** 面板插入：删掉「触发符 + 查询词」再插引用原文（光标可能被块编辑器的补位空行推一格，按 paraBefore 的 at 算）。 */
  function insertQuote(text: string, hitLen: number): void {
    muted = null
    let caret = 0
    try { caret = (root as unknown as HTMLTextAreaElement).selectionStart } catch { caret = 0 }
    if (ctx.insert) { ctx.insert(text, Math.max(0, caret - hitLen)); root.focus(); paintCount(); return }
    const { v, at } = paraBefore(caret)
    const start = Math.max(0, at - hitLen)
    nd.set(v.slice(0, start) + text + v.slice(at))
    try { (root as unknown as HTMLTextAreaElement).setSelectionRange(start + text.length, start + text.length) } catch { /* ignore */ }
    nd.syncPh()
    decorate()
    root.focus()
    paintCount()
  }

  /* ── 事件接线 ─────────────────────────────────────────────────────────── */
  const onKeyUp = (): void => { checkMenu() }
  const onMouseUp = (): void => { checkMenu() }
  const onSel = (): void => { if (document.activeElement === root) checkMenu() }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229) return
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ctx.submit) { e.preventDefault(); closeMenu(); ctx.submit(); return }
    const chip = (document.activeElement as HTMLElement | null)
    if (chip && chip.classList?.contains('nref') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      if (!(ctx.onChip?.(chip, { cmd: e.metaKey || e.ctrlKey }) ?? false)) { if (e.metaKey || e.ctrlKey) void openTok(chip.dataset.canon ?? ''); else showPop(chip) }
      return
    }
  }
  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement
    const chip = t.closest?.('.nref') as HTMLElement | null
    if (chip) {
      e.preventDefault(); e.stopPropagation()
      const cmd = e.metaKey || e.ctrlKey
      if (ctx.onChip?.(chip, { cmd })) return
      if (cmd) { hidePop(); void openTok(chip.dataset.canon ?? ''); return }
      showPop(chip)
      return
    }
    if (ctx.marks && (e.metaKey || e.ctrlKey)) {
      const tok = markAt(e.clientX, e.clientY)
      if (tok) { e.preventDefault(); void openTok(tok) }
    }
  }
  const onCopyCut = (e: ClipboardEvent): void => {
    const txt = selText()
    if (txt == null) return
    e.preventDefault()
    try { e.clipboardData?.setData('text/plain', txt) } catch { /* ignore */ }
    if (e.type === 'cut') { try { document.execCommand('delete') } catch { /* ignore */ } }
    toast((e.type === 'cut' ? '已剪切 ' : '已复制 ') + txt.length + ' 字 · 胶囊位置已展开成引用原文')
  }
  /* 90ms 节流，但**总是用最后落点的坐标**：早先的写法在节流窗口里直接 return，
     结果「鼠标停下那一刻」的那次移动被丢掉 → 气泡要点两下 / 抖一下才出来。 */
  let pt = 0
  let mx = 0, my = 0, mt = false
  const onMove = (e: PointerEvent): void => {
    if (!ctx.marks) return
    mx = e.clientX; my = e.clientY
    mt = !!((e.target as HTMLElement).closest?.('.nref'))
    if (pt) return
    pt = window.setTimeout(() => {
      pt = 0
      if (mt) { hideMTip(); return }
      const tok = markAt(mx, my)
      if (tok) showMTip(tok, mx, my); else hideMTip()
    }, 90)
  }
  const onLeave = (): void => { hideMTip() }
  const onDownDoc = (e: MouseEvent): void => {
    const t = e.target as HTMLElement
    if (pop && !pop.contains(t) && !t.closest?.('.nref')) hidePop()
    if (mTip && !mTip.contains(t)) hideMTip()
  }
  const onKeyDoc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    if (pop) { e.preventDefault(); hidePop(); return }
    if (mTip) { e.preventDefault(); hideMTip() }
  }

  root.addEventListener('keyup', onKeyUp)
  root.addEventListener('mouseup', onMouseUp)
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('click', onClick)
  root.addEventListener('copy', onCopyCut as EventListener)
  root.addEventListener('cut', onCopyCut as EventListener)
  if (ctx.marks) {
    root.addEventListener('pointermove', onMove as EventListener)
    root.addEventListener('pointerleave', onLeave)
  }
  document.addEventListener('selectionchange', onSel)
  document.addEventListener('mousedown', onDownDoc, true)
  document.addEventListener('keydown', onKeyDoc, true)

  async function openTok(canonOrTok: string): Promise<void> {
    /* 注意：不要在这里把「」剥掉 —— 上层（知识卡 / 引用原文）是按带括号的 canon 匹配的，
       剥掉就对不上，会一路掉到 fs/reveal 去。路径 / 链接本来就不带括号，原样传即可。 */
    const tok = canonOrTok
    if (ctx.marksOpen) { ctx.marksOpen(tok); return }
    toast('这条引用项还打不开：' + tok, 'err')
  }
  void ic

  paintCount()
  decorate()
  paintMarks()
  return {
    root, nd,
    refresh: () => { decorate(); paintMarks(); paintCount() },
    text: () => nd.text(),
    set: (v: string) => { nd.set(v); decorate(); paintMarks(); paintCount() },
    menuOpen, closeMenu,
    destroy: () => {
      closeMenu(); hidePop(); hideMTip()
      root.removeEventListener('keyup', onKeyUp)
      root.removeEventListener('mouseup', onMouseUp)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('click', onClick)
      root.removeEventListener('copy', onCopyCut as EventListener)
      root.removeEventListener('cut', onCopyCut as EventListener)
      root.removeEventListener('pointermove', onMove as EventListener)
      root.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('selectionchange', onSel)
      document.removeEventListener('mousedown', onDownDoc, true)
      document.removeEventListener('keydown', onKeyDoc, true)
    },
  }
}