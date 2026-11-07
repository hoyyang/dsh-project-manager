/**
 * v101：任务说明的块编辑器。
 *
 * 为什么要换：上一版把「分割线」画在叠在 textarea 上的一层镜像里，镜像与输入框的行高 / 换行
 * 只要差一点，横线就压在字上（用户录屏「分割线灾难现场」）。这里改成真块编辑器：
 * 文档 = 一串块（文本行 / 分割线元素），分割线是 DOM 里的真元素，不存在两层错位。
 *
 * 落盘格式仍是纯文本：分割线 = 「──── 标题 ────」（无标题 = 「────」），
 * 所以详情页读态、引用、剪贴板、AI 注入都读得懂，不需要新字段。
 */
const DIV_RX = /^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/
const sDiv = (t: string): string => (t ? '──── ' + t + ' ────' : '────')
const XI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'

export interface NoteDoc {
  /** 序列化成纯文本（分割线变成 ──── 标题 ──── 一行）。 */
  text(): string
  /** 用纯文本重建文档。 */
  set(v: string): void
  /** 「分割线」按钮：光标行没内容 → 这一行变分割线；有内容 → 插到下一行。 */
  insertDivider(): boolean
  /** 空文档时显示占位文字。 */
  syncPh(): void
  /** 分割线标题输入框正开着（Esc 要优先取消它，而不是关弹窗）。 */
  readonly editingTitle: boolean
}

export function mountNoteDoc(root: HTMLElement, opts: { toast?: (m: string) => void; /** v111：文档重建后回调（宿主用来把引用项原文装饰成可点的胶囊）。 */ onBuilt?: () => void } = {}): NoteDoc {
  const toast = opts.toast ?? ((): void => {})
  const mkLine = (txt = ''): HTMLElement => { const d = document.createElement('div'); d.className = 'nline'; d.dataset.b = 't'; if (txt) d.textContent = txt; return d }
  const mkDiv = (title = ''): HTMLElement => {
    const d = document.createElement('div')
    d.className = 'nblk' + (title ? '' : ' no-t')
    d.dataset.b = 'd'
    d.setAttribute('contenteditable', 'false')
    d.innerHTML = '<i class="nd-l"></i><span class="nd-t"' + (title ? '' : ' hidden') + '>' + title.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)) + '</span><i class="nd-r"></i>'
      + '<button type="button" class="nd-x" tabindex="-1" aria-label="删除这条分割线" title="删除这条分割线">' + XI + '</button>'
    return d
  }
  /* v111：引用胶囊（.nref）参与序列化与光标换算 —— 胶囊显示标题，落盘 / 复制时按 data-canon 展开成引用项原文。 */
  /* v122（4.2）：胶囊两侧的零宽占位（\u200b）只是给光标落脚，不进正文、不算长度 */
  const ZW = '\u200b'
  const tlen = (t: string): number => t.split(ZW).join('').length
  const nodeLen = (n: Node): number => n.nodeType === 3 ? tlen(n.textContent ?? '')
    : ((n as HTMLElement).dataset?.canon ? ((n as HTMLElement).dataset.canon as string).length : (n.textContent ?? '').length)
  const lineText = (el: Element): string => {
    let out = ''
    for (const n of Array.from(el.childNodes)) out += n.nodeType === 3 ? (n.textContent ?? '').split(ZW).join('') : ((n as HTMLElement).dataset?.canon ?? (n.textContent ?? ''))
    return out
  }
  const divTitle = (el: Element): string => {
    const inp = el.querySelector('.nd-in') as HTMLInputElement | null
    if (inp) return inp.value.trim()
    const s = el.querySelector('.nd-t')
    return (s?.textContent ?? '').trim()
  }
  const blocks = (): Element[] => Array.from(root.children)
  function text(): string {
    return blocks().map((el) => ((el as HTMLElement).dataset.b === 'd' ? sDiv(divTitle(el)) : lineText(el))).join('\n')
  }
  function canonIn(el: HTMLElement, node: Node, off: number): number {
    let n = 0
    for (const ch of Array.from(el.childNodes)) {
      if (ch === node) {
        if (node.nodeType === 3) return n + tlen((node.textContent ?? '').slice(0, off))
        let m = n
        for (let i = 0; i < Math.min(off, node.childNodes.length); i++) m += nodeLen(node.childNodes[i])
        return m
      }
      n += nodeLen(ch)
    }
    return n
  }
  function syncPh(): void {
    const ph = root.parentElement?.querySelector('[data-gt-ph]') as HTMLElement | null
    if (!ph) return
    /* v151：按根节点全部文字判断（输入法落在根上的裸文本也算），不再出现「占位文字压在刚打的字上」 */
    const empty = !text().trim() && !(root.textContent ?? '').split(ZW).join('').trim() && !root.querySelector('.nref')
    ph.hidden = !empty
    root.classList.toggle('is-empty', empty)
  }
  /* v106 ⑧：撤销 / 重做走编辑器自己的快照栈（原生 contenteditable undo 会被手工 DOM 操作打乱） */
  let snaps: Array<{ t: string; c: number }> = []
  let si = 0
  let applying = false
  let snapTimer = 0
  function resetSnaps(): void { snaps = [{ t: text(), c: 0 }]; si = 0 }
  function snapNow(): void {
    if (applying) return
    const t = text(), c = caretOffset()
    if (!snaps.length) resetSnaps()
    if (t === snaps[si].t) return
    snaps = snaps.slice(0, si + 1)
    snaps.push({ t, c })
    si = snaps.length - 1
    if (snaps.length > 200) { snaps.shift(); si-- }
  }
  function queueSnap(): void {
    if (applying) return
    if (snapTimer) clearTimeout(snapTimer)
    snapTimer = window.setTimeout(() => { snapTimer = 0; snapNow() }, 260)
  }
  function applySnap(n: number): void {
    si = n
    applying = true
    set(snaps[n].t)
    setCaret(snaps[n].c)
    applying = false
    syncPh()
    dispatchInput()
    toast(n === 0 ? '已撤销到最初的状态' : '已撤销一步（光标回到原来的位置）')
  }
  function undo(): boolean {
    if (snapTimer) { clearTimeout(snapTimer); snapTimer = 0; snapNow() }
    if (si <= 0) return false
    applySnap(si - 1)
    return true
  }
  function redo(): boolean {
    if (si >= snaps.length - 1) return false
    si++
    applying = true
    set(snaps[si].t)
    setCaret(snaps[si].c)
    applying = false
    syncPh()
    dispatchInput()
    toast('已重做一步')
    return true
  }
  /** 跨行选区删除后归一成合法块（空文档至少保留一行，裸文本包回 .nline）。
   *  v151（用户录屏：占位文字和输入重叠 + 回车换不了行）根因：光标落在编辑器根上（清空后 / 点空白处）时，真实输入法把字
   *  直接写成根下的裸文本节点 → text() 只读 .nline 看不到它（占位文字不隐藏、自动保存存成空），回车时 curBlock 拿到的是
   *  文本节点、走不进拆行逻辑。改：裸文本 / 裸内联节点就地并进相邻文本行（同一个节点移进去，光标原位不丢），空的
   *  .nline 补回；输入法选字中不动 DOM，上屏后再归一。 */
  function normalize(): void {
    if (!root.children.length && !(root.textContent ?? '')) { root.appendChild(mkLine('')); syncPh(); return }
    const sel = document.getSelection()
    const keep = sel && sel.rangeCount && root.contains(sel.anchorNode) ? { n: sel.anchorNode as Node, o: sel.anchorOffset } : null
    let dirty = false
    let host: HTMLElement | null = null
    for (const n of Array.from(root.childNodes)) {
      if (n.nodeType === 1) {
        const h = n as HTMLElement
        if (h.dataset.b === 'd') { host = null; continue }
        if (h.tagName === 'BR') { h.remove(); host = null; dirty = true; continue }
        if (h.tagName === 'DIV' || h.tagName === 'P') {
          if (!h.classList.contains('nline')) { h.className = 'nline'; h.dataset.b = 't'; dirty = true }
          host = h; continue
        }
      } else if (n.nodeType !== 3) { n.remove(); continue }
      /* 裸文本 / 内联元素（胶囊、span）：并进前一个文本行；前面没有就新建一行放在这里 */
      if (!host) { host = mkLine(''); n.before(host); dirty = true }
      host.appendChild(n)
      dirty = true
    }
    if (!root.children.length) root.appendChild(mkLine(''))
    if (dirty && keep && keep.n.isConnected && keep.n !== root) {
      try { const r = document.createRange(); r.setStart(keep.n, Math.min(keep.o, keep.n.nodeType === 3 ? (keep.n.textContent ?? '').length : keep.n.childNodes.length)); r.collapse(true); sel?.removeAllRanges(); sel?.addRange(r) } catch { /* ignore */ }
    }
    if (dirty) syncPh()
  }
  /** v151：光标不许停在编辑器根上（否则输入法会写出裸文本）—— 挪进最近的文本行。 */
  function caretHome(): void {
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount || sel.anchorNode !== root || !sel.isCollapsed) return
    const kids = Array.from(root.children) as HTMLElement[]
    const at = Math.min(sel.anchorOffset, kids.length)
    let t: HTMLElement | null = null
    for (let i = at; i < kids.length && !t; i++) if (kids[i].dataset.b === 't') t = kids[i]
    for (let i = at - 1; i >= 0 && !t; i--) if (kids[i].dataset.b === 't') t = kids[i]
    if (!t) { t = mkLine(''); root.appendChild(t) }
    const before = kids.indexOf(t) < at
    placeCanon(t, before ? lineText(t).length : 0)
  }
  function set(v: string): void {
    root.textContent = ''
    for (const ln of String(v ?? '').replace(/\r\n?/g, '\n').split('\n')) {
      const m = ln.match(DIV_RX)
      root.appendChild(m ? mkDiv((m[1] ?? '').trim()) : mkLine(ln))
    }
    if (!root.children.length) root.appendChild(mkLine(''))
    const last = root.lastElementChild
    if (last && (last as HTMLElement).dataset.b === 'd') root.appendChild(mkLine(''))
    /* v111：重建文档后交给宿主装饰引用胶囊（只改 DOM，不改文本） */
    if (opts.onBuilt) { try { opts.onBuilt() } catch { /* ignore */ } }
    syncPh()
    if (!applying) resetSnaps()
  }
  function curBlock(): HTMLElement | null {
    if (Array.from(root.childNodes).some((n) => n.nodeType !== 1 || !(n as HTMLElement).dataset?.b)) normalize()
    caretHome()
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount) return null
    let n: Node | null = sel.anchorNode
    if (!n) return null
    if (n === root) n = root.childNodes[sel.anchorOffset] ?? null
    while (n && n.parentNode && n.parentNode !== root) n = n.parentNode
    return n && n.parentNode === root ? (n as HTMLElement) : null
  }
  function caretIn(el: HTMLElement): number {
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount) return 0
    const r = sel.getRangeAt(0)
    if (!el.contains(r.startContainer)) return 0
    const pre = r.cloneRange()
    pre.selectNodeContents(el)
    const lim = r.startContainer.nodeType === 3 ? Math.min(r.startOffset, (r.startContainer.textContent ?? '').length) : r.startOffset
    try { pre.setEnd(r.startContainer, lim) } catch { return 0 }
    return tlen(pre.toString())
  }
  function caretOffset(): number {
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount) return text().length
    const r = sel.getRangeAt(0)
    let n = 0
    for (const el of blocks()) {
      const h = el as HTMLElement
      if (h.dataset.b === 'd') { n += sDiv(divTitle(el)).length + 1; continue }
      if (el.contains(r.startContainer)) return n + canonIn(h, r.startContainer, r.startOffset)
      n += lineText(el).length + 1
    }
    return text().length
  }
  function place(el: HTMLElement, off: number): void {
    const r = document.createRange()
    const t = el.firstChild
    if (!t || t.nodeType !== 3) r.setStart(el, 0)
    else r.setStart(t, Math.max(0, Math.min(off, (t.textContent ?? '').length)))
    r.collapse(true)
    const sel = document.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(r)
  }
  function lastLine(): HTMLElement {
    for (let i = root.children.length - 1; i >= 0; i--) {
      const el = root.children[i] as HTMLElement
      if (el.dataset.b === 't') return el
    }
    const l = mkLine('')
    root.appendChild(l)
    return l
  }
  /** v111：把「纯文本偏移」落到 DOM（胶囊按 data-canon 计长；落进胶囊内部 = 光标放到它后面）。 */
  function placeCanon(el: HTMLElement, off: number): void {
    const sel = document.getSelection()
    if (!sel) return
    const r = document.createRange()
    let n = 0
    for (const ch of Array.from(el.childNodes)) {
      const L = nodeLen(ch)
      if (off <= n + L) {
        if (ch.nodeType === 3) {
          /* 文本偏移 → DOM 偏移：跳过零宽占位 */
          const tx = ch.textContent ?? ''
          let want = Math.max(0, off - n), i = 0
          while (i < tx.length && (want > 0 || tx[i] === ZW)) { if (tx[i] !== ZW) want--; i++ }
          r.setStart(ch, i)
        } else r.setStartAfter(ch)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
        return
      }
      n += L
    }
    r.selectNodeContents(el)
    r.collapse(false)
    sel.removeAllRanges()
    sel.addRange(r)
  }
  function setCaret(off: number): void {
    let n = 0
    for (const el of blocks()) {
      const h = el as HTMLElement
      const isDiv = h.dataset.b === 'd'
      const len = isDiv ? sDiv(divTitle(el)).length : lineText(el).length
      if (!isDiv && off <= n + len) { placeCanon(h, off - n); return }
      n += len + 1
    }
    place(lastLine(), 9999)
  }
  /** v110：光标 / 光标所在块滚进编辑区可视范围（回车到底不再把光标顶到看不见）。 */
  function caretIntoView(): void {
    const blk = curBlock()
    if (!blk || typeof blk.getBoundingClientRect !== 'function') return
    const r = root.getBoundingClientRect(), b = blk.getBoundingClientRect(), pad = 16
    if (b.bottom > r.bottom - pad) root.scrollTop += b.bottom - r.bottom + pad + 10
    else if (b.top < r.top + pad) root.scrollTop -= r.top - b.top + pad
  }
  function enter(): void {
    const blk = curBlock()
    if (!blk || blk.dataset.b === 'd') {
      const l = mkLine('')
      if (blk) blk.after(l); else root.appendChild(l)
      place(l, 0)
      syncPh()
      caretIntoView()
      return
    }
    /* v111：含引用胶囊的行按 Range 拆（直接改 textContent 会把胶囊丢掉） */
    if (blk.querySelector('.nref')) {
      const sel = document.getSelection()
      if (sel && sel.rangeCount && blk.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0)
        const tail = document.createRange()
        tail.setStart(r.startContainer, r.startOffset)
        tail.setEnd(blk, blk.childNodes.length)
        const frag = tail.extractContents()
        const l = mkLine('')
        l.appendChild(frag)
        if (!l.childNodes.length) l.appendChild(document.createTextNode(''))
        blk.after(l)
        placeCanon(l, 0)
        syncPh()
        caretIntoView()
        return
      }
    }
    const at = caretIn(blk)
    const all = blk.textContent ?? ''
    blk.textContent = all.slice(0, at)
    const l = mkLine(all.slice(at))
    blk.after(l)
    place(l, 0)
    syncPh()
    caretIntoView()
  }
  function backMerge(): boolean {
    const blk = curBlock()
    if (!blk || blk.dataset.b === 'd' || caretIn(blk) !== 0) return false
    const prev = blk.previousElementSibling as HTMLElement | null
    if (!prev) return false
    if (prev.dataset.b === 'd') { prev.remove(); syncPh(); return true }
    /* v111：把后一行的节点整体搬过去（胶囊不丢），光标落在交界处 */
    const off = lineText(prev).length
    while (blk.firstChild) prev.appendChild(blk.firstChild)
    blk.remove()
    placeCanon(prev, off)
    syncPh()
    return true
  }
  /** 分割线标题：行内输入框，回车保存 / Esc 取消 / 清空 = 无标题。 */
  let editing = false
  function editTitle(blk: HTMLElement): void {
    if (blk.querySelector('.nd-in')) return
    const span = blk.querySelector('.nd-t') as HTMLElement | null
    if (!span) return
    const cur = (span.textContent ?? '').trim()
    const inp = document.createElement('input')
    inp.className = 'nd-in'
    inp.type = 'text'
    inp.maxLength = 40
    inp.value = cur
    inp.placeholder = '分割线标题（可留空）'
    inp.setAttribute('aria-label', '分割线标题')
    span.hidden = true
    blk.classList.add('editing')
    blk.insertBefore(inp, blk.querySelector('.nd-r'))
    editing = true
    inp.focus()
    inp.select()
    let closed = false
    const done = (save: boolean): void => {
      if (closed) return
      closed = true
      editing = false
      const v = save ? inp.value.trim() : cur
      inp.remove()
      span.textContent = v
      span.hidden = !v
      blk.classList.toggle('no-t', !v)
      blk.classList.remove('editing')
      syncPh()
      dispatchInput()
      if (save) toast(v ? '分割线标题：' + v : '已清空分割线标题')
    }
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); escUntil = Date.now() + 300; done(false); root.focus() }
    })
    inp.addEventListener('blur', () => done(true))
    inp.addEventListener('pointerdown', (e) => e.stopPropagation())
  }
  let escUntil = 0
  function dispatchInput(): void { root.dispatchEvent(new Event('input', { bubbles: true })) }
  function insertDivider(): boolean {
    const blk = curBlock()
    const empty = !!blk && blk.dataset.b === 't' && !(blk.textContent ?? '').trim()
    const div = mkDiv('')
    if (empty && blk) { blk.before(div); blk.remove() }
    else if (blk) blk.after(div)
    else root.appendChild(div)
    let after = div.nextElementSibling as HTMLElement | null
    if (!after || after.dataset.b === 'd') { after = mkLine(''); div.after(after) }
    place(after, 0)
    syncPh()
    dispatchInput()
    toast(empty ? '已在这一行插入分割线（双击横线可加标题）' : '已在下一行插入分割线（双击横线可加标题）')
    return true
  }
  root.addEventListener('dblclick', (e) => {
    const blk = (e.target as HTMLElement).closest?.('.nblk') as HTMLElement | null
    if (!blk) return
    e.preventDefault()
    e.stopPropagation()
    editTitle(blk)
  })
  root.addEventListener('click', (e) => {
    const x = (e.target as HTMLElement).closest?.('.nd-x') as HTMLElement | null
    if (!x) return
    const blk = x.closest('.nblk') as HTMLElement | null
    e.preventDefault()
    e.stopPropagation()
    if (!blk) return
    const next = blk.nextElementSibling as HTMLElement | null
    blk.remove()
    if (!root.children.length) root.appendChild(mkLine(''))
    if (next && next.dataset.b === 't') place(next, 0)
    syncPh()
    dispatchInput()
    toast('已删除这条分割线')
  })
  let multiDel = false
  /* v151：点空白处 / 聚焦 / 输入法开始前，光标先挪进文本行 */
  root.addEventListener('focus', () => requestAnimationFrame(caretHome))
  root.addEventListener('mouseup', () => requestAnimationFrame(caretHome))
  root.addEventListener('compositionstart', caretHome)
  root.addEventListener('beforeinput', () => caretHome())
  root.addEventListener('compositionend', () => { setTimeout(() => { normalize(); syncPh(); root.dispatchEvent(new Event('input', { bubbles: true })) }, 0) })
  root.addEventListener('keydown', (e) => {
    if (!e.isComposing && e.keyCode !== 229) caretHome()
    if (e.isComposing || e.keyCode === 229) return
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return
    const ks = document.getSelection()
    const hasSel = !!ks && ks.rangeCount > 0 && !ks.isCollapsed
    /* v106 ⑧：⌘Z / ⇧⌘Z 走编辑器自己的快照栈（Windows 是 Ctrl+Z / Ctrl+Shift+Z），撤销后光标回原位 */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) { if (!redo()) toast('没有可重做的了') } else if (!undo()) toast('没有可撤销的了')
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); if (!redo()) toast('没有可重做的了'); return }
    /* 框选文字后按 Delete / Backspace：交给浏览器原生删除（不再被「合并上一行」抢走），删完归一成合法块 */
    if ((e.key === 'Backspace' || e.key === 'Delete') && hasSel) { multiDel = true; return }
    /* 空行里输入 --- 再按空格 → 立刻变成一条分割线（与按钮插入结果一致，可双击加标题） */
    if (e.key === ' ') {
      const blk = curBlock()
      if (blk && blk.dataset.b === 't' && !hasSel && (blk.textContent ?? '').trim() === '---') {
        e.preventDefault()
        blk.textContent = ''
        insertDivider()
        queueSnap()
        return
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); enter(); queueSnap(); return }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !hasSel && !e.metaKey && !e.altKey && !e.ctrlKey && chipDel(e.key === 'Backspace' ? -1 : 1)) { e.preventDefault(); root.dispatchEvent(new Event('input', { bubbles: true })); return }
    if (e.key === 'Backspace' && backMerge()) { e.preventDefault(); queueSnap(); return }
  })
  /* v147（3）：胶囊（contenteditable=false）两侧各有一个零宽占位给光标落脚；光标在零宽占位后按退格，浏览器只删了占位、
     随后又被补回 → 看起来一个字都删不掉（Delete 同理）。改：先跳过零宽占位找真正相邻的内容 —— 是胶囊就整个删掉（一次一个），
     是文字就删一个字；紧挨普通字符 / 行首行尾（合并行）仍走原逻辑。返回 true = 已处理。 */
  function chipDel(dir: -1 | 1): boolean {
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount || !sel.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return false
    const node = sel.anchorNode, off = sel.anchorOffset
    let line: Node | null = node
    while (line && line.parentNode !== root) line = line.parentNode
    if (!line || (line as HTMLElement).dataset?.b !== 't') return false
    const isZW = (n: Node | null): boolean => !!n && n.nodeType === 3 && (n.textContent ?? '').split(ZW).join('') === ''
    const isChip = (n: Node | null): n is HTMLElement => !!n && n.nodeType === 1 && (n as HTMLElement).classList.contains('nref')
    if (node.nodeType === 3) { const ch = (node.textContent ?? '')[dir < 0 ? off - 1 : off]; if (ch !== undefined && ch !== ZW) return false }
    const step = (n: Node): Node | null => { let x: Node | null = n; while (x && x !== line) { const s = dir < 0 ? x.previousSibling : x.nextSibling; if (s) return s; x = x.parentNode } return null }
    let hit: { chip: HTMLElement } | { text: Text; at: number } | null = null
    const walk = (start: Node | null): void => {
      let n = start
      while (n) {
        if (isChip(n)) { hit = { chip: n }; return }
        if (n.nodeType === 3 && !isZW(n)) { const t = n.textContent ?? ''; let i = dir < 0 ? t.length - 1 : 0; while (t[i] === ZW) i += dir; hit = { text: n as Text, at: i }; return }
        if (n.nodeType === 1 && n.firstChild) { n = dir < 0 ? n.lastChild : n.firstChild; continue }
        n = step(n)
      }
    }
    if (node.nodeType === 3) {
      const t = node.textContent ?? ''
      let i = dir < 0 ? off - 1 : off
      while (i >= 0 && i < t.length && t[i] === ZW) i += dir
      if (i >= 0 && i < t.length) hit = { text: node as Text, at: i }
      else walk(step(node))
    } else walk((dir < 0 ? node.childNodes[off - 1] : node.childNodes[off]) ?? null)
    if (!hit) return false
    snapNow()
    const put = (n: Node, o: number): void => { const r = document.createRange(); r.setStart(n, o); r.collapse(true); sel.removeAllRanges(); sel.addRange(r) }
    const h = hit as { chip?: HTMLElement; text?: Text; at?: number }
    if (h.chip) {
      const before = h.chip.previousSibling, after = h.chip.nextSibling
      h.chip.remove()
      if (isZW(before) && isZW(after)) (after as ChildNode).remove()
      if (before && before.nodeType === 3) put(before, (before.textContent ?? '').length)
      else if (after && after.isConnected && after.nodeType === 3) put(after, 0)
      else { const z = document.createTextNode(ZW); (line as HTMLElement).appendChild(z); put(z, 1) }
    } else if (h.text) {
      const s = h.text.textContent ?? ''
      h.text.textContent = s.slice(0, h.at as number) + s.slice((h.at as number) + 1)
      put(h.text, h.at as number)
    }
    return true
  }
  root.addEventListener('paste', (e) => {
    const cd = (e as ClipboardEvent).clipboardData
    const t = cd?.getData('text/plain') ?? ''
    if (!t) return
    e.preventDefault()
    const lines = String(t).replace(/\r\n?/g, '\n').split('\n')
    lines.forEach((ln, i) => { if (i) enter(); if (ln) document.execCommand('insertText', false, ln) })
    syncPh()
    caretIntoView()
  })
  root.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing && Array.from(root.childNodes).some((n) => n.nodeType !== 1 || !(n as HTMLElement).dataset?.b)) normalize()
    syncPh()
    queueSnap()
    if (multiDel) { multiDel = false; setTimeout(normalize, 0) }
    caretIntoView()
    /* v122（4.1）：每次输入、粘贴、撤销后都重新识别引用胶囊（以前只在整段载入时识别）；选字中不动，上屏后补 */
    if (!(e as InputEvent).isComposing && opts.onBuilt) { try { opts.onBuilt() } catch { /* ignore */ } }
  })
  root.addEventListener('compositionend', () => { if (opts.onBuilt) setTimeout(() => { try { opts.onBuilt?.() } catch { /* ignore */ } }, 0) })

  /* 让旧代码（读 .value / selectionStart 的那批）继续工作：在元素实例上补一组访问器 */
  Object.defineProperty(root, 'value', { configurable: true, get: () => text(), set: (v: string) => set(v) })
  Object.defineProperty(root, 'selectionStart', { configurable: true, get: () => caretOffset() })
  Object.defineProperty(root, 'selectionEnd', { configurable: true, get: () => caretOffset() })
  ;(root as unknown as { setSelectionRange: (a: number) => void }).setSelectionRange = (a: number) => setCaret(Number(a) || 0)
  if (!root.children.length) root.appendChild(mkLine(''))
  syncPh()
  return {
    text,
    set,
    insertDivider,
    syncPh,
    get editingTitle(): boolean { return editing || Date.now() < escUntil },
  }
}
