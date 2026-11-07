/**
 * v140（5.2）：新增 / 编辑任务弹窗的「任务说明」= 和 DSH 对话框同一套识别器（composer.ts 的 candidates / findMarks：最长存在前缀 + 只认真实存在）。
 * 链接 / 文件 / 文件夹画深蓝虚线（CSS Custom Highlight，不改 DOM）；悬停出气泡「添加为相关链接 / 相关文件 / 仓库」（安全区不闪、⌘ 点击提示），
 * 已在卡片里的 =「使用引用内容」；添加成功 / 使用引用内容后原文原位换成引用原文 → 块编辑器画成胶囊（链接 / 文件同时关联任务，由 goaltask 的 bindFromChips 负责）；
 * 框选（可跨行、含胶囊）→「添加为相关说明」；已是卡片说明的内容不弹；按住 ⌘ 点击 = 直接打开。
 */
import { openedHow, openFileSmart, post } from './api.js'
import { candidates, findMarks, type Mark } from './composer.js'
import { fileText, linkText, noteText, repoText } from '../quote.js'

export interface NaCard { links: Array<{ id?: string; text: string; type?: string; url: string }>; files: Array<{ id: string; path: string; title?: string; exists: boolean }>; repos: Array<{ name: string; path: string }>; notes: Array<{ t: string; v: string }> }
export interface NaDeps {
  root(): HTMLElement | null
  card(): NaCard | null
  home: string
  add(kind: 'link' | 'file' | 'repo' | 'note', prefill: string): Promise<{ text?: string; url?: string; name?: string; path?: string; t?: string; v?: string } | null>
  toast(m: string, k?: 'ok' | 'err'): void
}
const IC: Record<string, string> = {
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5L12.5 16.5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>',
  dir: '<svg viewBox="0 0 24 24"><path d="M5 5.5h6v13H5zM13 5.5h6v13h-6z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 4.5h14v15H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>',
  use: '<svg viewBox="0 0 24 24"><path d="M9.6 6.2C7 7.6 5.6 9.7 5.6 12.6c0 2.2 1.3 3.7 3.2 3.7 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.9.2-1.1 1.1-2.1 2.5-2.9zM18.4 6.2c-2.6 1.4-4 3.5-4 6.4 0 2.2 1.3 3.7 3.2 3.7 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.9.2-1.1 1.1-2.1 2.5-2.9z" fill="currentColor" stroke="none"/></svg>',
}
const LAB: Record<string, string> = { link: '添加为相关链接', file: '添加为相关文件', dir: '添加为仓库', note: '添加为相关说明' }
const OPEN_HINT: Record<string, string> = { link: '⌘ 点击 = 浏览器打开', file: '⌘ 点击 = 默认应用打开', dir: '⌘ 点击 = 访达打开' }
const normP = (p: string, home: string): string => p.replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, '$1')
const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p
type Seg = { node: Text | null; el: Element | null; start: number; len: number }
type R = { left: number; right: number; top: number; bottom: number }

/** 块编辑器 DOM ↔ 识别坐标：行之间 \n、胶囊 = 1 个 U+FFFC、零宽占位按 1 个空格算（一一对应，换算不丢位）。 */
function layout(root: HTMLElement): { text: string; segs: Seg[] } {
  let text = ''
  const segs: Seg[] = []
  Array.from(root.children).forEach((blk, i) => {
    if (i) text += '\n'
    if ((blk as HTMLElement).dataset.b !== 't') return
    for (const n of Array.from(blk.childNodes)) {
      if (n.nodeType === 3) { const t = (n.textContent ?? '').replace(/\u200b/g, ' '); segs.push({ node: n as Text, el: null, start: text.length, len: t.length }); text += t }
      else if ((n as HTMLElement).classList?.contains('nref')) { segs.push({ node: null, el: n as Element, start: text.length, len: 1 }); text += '\uFFFC' }
      else if ((n as HTMLElement).tagName !== 'BR') { const t = (n.textContent ?? '').replace(/\u200b/g, ' '); segs.push({ node: null, el: n as Element, start: text.length, len: t.length }); text += t }
    }
  })
  return { text, segs }
}
function rangeFor(root: HTMLElement, a: number, b: number): Range | null {
  const { segs } = layout(root)
  const r = document.createRange()
  let sa = false
  for (const s of segs) {
    if (!sa && a >= s.start && a <= s.start + s.len && s.node) { r.setStart(s.node, a - s.start); sa = true }
    if (sa && b >= s.start && b <= s.start + s.len && s.node) { r.setEnd(s.node, b - s.start); return r }
  }
  return null
}

export class NoteAssist {
  private marks: Array<Mark & { r: Range }> = []
  private stat = new Map<string, { k: 'file' | 'dir' | null; at: number }>()
  private statT = 0
  private raf = 0
  private bub: HTMLButtonElement | null = null
  private bubFor: (Mark & { r: Range }) | 'sel' | null = null
  private anchor: R | null = null
  private hideT = 0
  private hov: (Mark & { r: Range }) | null = null
  private selTxt = ''
  private selR: Range | null = null
  private down = false
  private off: Array<() => void> = []
  private hl = 'dpm-nu-' + Math.random().toString(36).slice(2, 8)
  private style: HTMLStyleElement
  constructor(private d: NaDeps) {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, o?: boolean | AddEventListenerOptions): void => { document.addEventListener(t, f as EventListener, o); this.off.push(() => document.removeEventListener(t, f as EventListener, o)) }
    on('pointermove', (e) => this.onMove(e), { passive: true })
    on('pointerdown', (e) => { const r = this.d.root(); if (r && r.contains(e.target as Node) && e.button === 0) { this.down = true; if (this.bubFor) this.hide() } }, true)
    on('pointerup', () => { if (!this.down) return; this.down = false; setTimeout(() => this.selCheck(), 0) }, true)
    on('keyup', (e) => { if (e.shiftKey || e.key.startsWith('Arrow') || ((e.metaKey || e.ctrlKey) && e.key === 'a')) this.selCheck(); else if (this.bubFor === 'sel') this.selCheck() })
    /* v145（3）：框选后删掉 / 剪掉 / 改掉选中内容、或选区被清掉 → 气泡立刻收起（内容变化 / 选区变化都重查） */
    on('input', (e) => { const r = this.d.root(); if (this.bubFor === 'sel' && r && e.target instanceof Node && r.contains(e.target)) this.selCheck() }, true)
    on('cut', () => { if (this.bubFor === 'sel') setTimeout(() => this.selCheck(), 0) }, true)
    on('selectionchange', () => { if (this.bubFor === 'sel' && !this.down) this.selCheck() })
    on('mousedown', (e) => { if (e.metaKey && this.markAt(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation() } }, true)
    on('click', (e) => { if (!e.metaKey) return; const h = this.markAt(e.clientX, e.clientY); if (!h) return; e.preventDefault(); e.stopPropagation(); this.hide(); void this.openMark(h.m) }, true)
    on('scroll', (e) => { const r = this.d.root(); if (r && e.target instanceof Node && (e.target === r || e.target.contains(r))) { this.hide(); this.soon() } }, true)
    this.style = document.createElement('style')
    this.style.textContent = '::highlight(' + this.hl + ') { text-decoration-line: underline; text-decoration-style: dashed; text-decoration-color: #1e40af; text-decoration-thickness: 1.5px; text-underline-offset: 4px; }'
      + '::highlight(' + this.hl + '-h) { background-color: rgba(30, 64, 175, .1); text-decoration-line: underline; text-decoration-style: dashed; text-decoration-color: #1e3a8a; text-decoration-thickness: 2px; text-underline-offset: 4px; }'
      + 'body[data-ds-dark-theme] ::highlight(' + this.hl + ') { text-decoration-color: #7ea6ff; }'
    document.head.append(this.style)
  }
  dispose(): void { for (const f of this.off) f(); this.off = []; clearTimeout(this.statT); clearTimeout(this.hideT); cancelAnimationFrame(this.raf); this.bub?.remove(); this.bub = null; this.clearHl(); this.style.remove() }
  /** 说明变了（输入 / 粘贴 / 重建）→ 下一帧重新识别。 */
  soon(): void { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.scan() }) }
  reset(): void { this.hide(); this.marks = []; this.clearHl() }
  private clearHl(): void { const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights; reg?.delete(this.hl); reg?.delete(this.hl + '-h') }
  private kindOf = (p: string): 'file' | 'dir' | null => {
    const c = this.d.card(), n = normP(p, this.d.home)
    if (c) { if (c.files.some((f) => normP(f.path, this.d.home) === n && f.exists)) return 'file'; if (c.repos.some((r) => normP(r.path, this.d.home) === n)) return 'dir' }
    return this.stat.get(p)?.k ?? null
  }
  private scan(): void {
    const root = this.d.root(); if (!root || !root.isConnected || !this.d.card()) { this.marks = []; this.paint(); return }
    const { text } = layout(root)
    const now = Date.now()
    const need = candidates(text).filter((p) => { const c = this.stat.get(p); return !c || now - c.at > 30_000 })
    if (need.length) {
      clearTimeout(this.statT)
      this.statT = window.setTimeout(() => { void post<{ ok: boolean; kinds: Record<string, 'file' | 'dir'> }>('paths/stat', { paths: need.slice(0, 400) }).then((r) => { const t = Date.now(); for (const p of need) this.stat.set(p, { k: r.kinds[p] ?? null, at: t }); this.scan() }).catch((e) => console.warn('[dsh-project-manager] 任务说明路径识别查询失败（paths/stat）：', e)) }, 200)
    }
    this.marks = findMarks(text, this.kindOf).map((m) => { const r = rangeFor(root, m.s, m.e); return r ? { ...m, r } : null }).filter((x): x is Mark & { r: Range } => !!x)
    if (this.hov) this.hov = this.marks.find((x) => x.text === this.hov!.text && x.s === this.hov!.s) ?? null
    this.paint()
    ;(window as unknown as Record<string, unknown>).__dpmNa = { marks: this.marks.map((m) => ({ text: m.text, kind: m.kind, known: this.known(m) })), at: now }
  }
  private paint(): void {
    const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!HL || !reg) return
    reg.set(this.hl, new HL(...this.marks.filter((x) => x !== this.hov).map((x) => x.r)))
    reg.set(this.hl + '-h', new HL(...(this.hov ? [this.hov.r] : [])))
  }
  private known(m: Mark): boolean {
    const c = this.d.card(); if (!c) return false
    if (m.kind === 'link') return c.links.some((l) => l.url === m.text)
    const n = normP(m.text, this.d.home)
    return m.kind === 'file' ? c.files.some((f) => normP(f.path, this.d.home) === n) : c.repos.some((r) => normP(r.path, this.d.home) === n)
  }
  private quoteFor(m: Mark): string {
    const c = this.d.card(); if (!c) return ''
    if (m.kind === 'link') { const l = c.links.find((x) => x.url === m.text); return l ? linkText(l) : '' }
    const n = normP(m.text, this.d.home)
    if (m.kind === 'file') { const f = c.files.find((x) => normP(x.path, this.d.home) === n); return f ? fileText({ id: f.id, path: f.path, title: f.title, exists: f.exists }) : '' }
    const r = c.repos.find((x) => normP(x.path, this.d.home) === n); return r ? repoText(r.name, r.path) : ''
  }
  private markAt(x: number, y: number): { m: Mark & { r: Range }; r: DOMRect } | null {
    for (const m of this.marks) for (const r of Array.from(m.r.getClientRects())) if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return { m, r }
    return null
  }
  /* ── 气泡（同对话框：安全区不闪、⌘ 提示、使用引用内容）── */
  private ensure(): HTMLButtonElement {
    if (this.bub) return this.bub
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'dpm-cbub dpm-nbub'; b.hidden = true
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => { e.stopPropagation(); void this.bubClick() })
    ;(this.d.root()?.closest('dialog') ?? document.body).append(b)
    this.bub = b
    return b
  }
  private show(kind: string, rect: R, target: (Mark & { r: Range }) | 'sel', use: boolean): void {
    const b = this.ensure()
    const host = this.d.root()?.closest('dialog'); if (host && b.parentElement !== host) host.append(b)
    clearTimeout(this.hideT); this.hideT = 0
    b.classList.toggle('use', use)
    const lab = use ? '使用引用内容' : LAB[kind]
    b.innerHTML = (use ? IC.use : IC[kind]) + '<span>' + lab + '</span>' + (kind === 'note' ? '<small>' + Math.min(999, this.selTxt.length) + ' 字</small>' : '<small class="cmdh">' + OPEN_HINT[kind] + '</small>')
    b.dataset.kind = kind; b.dataset.use = use ? '1' : ''
    b.setAttribute('aria-label', lab + (target !== 'sel' ? '：' + target.text : ''))
    this.bubFor = target
    b.hidden = false
    const bw = b.offsetWidth, bh = b.offsetHeight, cx = rect.left + (rect.right - rect.left) / 2
    const x = Math.max(8, Math.min(innerWidth - bw - 8, cx - bw / 2))
    const up = rect.bottom + 6 + bh > innerHeight - 6
    b.style.left = Math.round(x) + 'px'; b.style.top = Math.round(up ? rect.top - 6 - bh : rect.bottom + 6) + 'px'
    b.style.setProperty('--ax', Math.round(cx - x - 4) + 'px'); b.classList.toggle('up', up)
    this.anchor = rect
  }
  private hide(): void { clearTimeout(this.hideT); this.hideT = 0; if (this.bub) this.bub.hidden = true; this.bubFor = null; this.anchor = null; if (this.hov) { this.hov = null; this.paint() } }
  private inZone(x: number, y: number): boolean {
    const b = this.bub, a = this.anchor
    if (!b || b.hidden || !a) return false
    const br = b.getBoundingClientRect()
    const inR = (r: R, p: number): boolean => x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p
    if (inR(a, 4) || inR(br, 10)) return true
    const up = b.classList.contains('up')
    return inR({ left: Math.min(a.left, br.left), right: Math.max(a.right, br.right), top: up ? br.bottom : a.top, bottom: up ? a.bottom : br.top }, 10)
  }
  private onMove(e: PointerEvent): void {
    if (this.bubFor === 'sel' || !this.d.root()?.isConnected) return
    if (e.buttons) { if (this.bubFor) this.hide(); return }
    if (this.bubFor && this.inZone(e.clientX, e.clientY)) { clearTimeout(this.hideT); this.hideT = 0; return }
    const hit = this.markAt(e.clientX, e.clientY)
    this.d.root()?.classList.toggle('dpm-cmd', !!(hit && e.metaKey))
    if (hit) {
      const bf = this.bubFor
      if (bf && typeof bf !== 'string' && bf.text === hit.m.text && this.bub && !this.bub.hidden) return
      this.hov = hit.m; this.paint()
      this.show(hit.m.kind, { left: hit.r.left, right: hit.r.right, top: hit.r.top, bottom: hit.r.bottom }, hit.m, this.known(hit.m))
      return
    }
    if (this.bubFor && !this.hideT) this.hideT = window.setTimeout(() => this.hide(), 350)
  }
  /** 选区原文：胶囊按引用原文（data-canon）展开，零宽占位去掉，行之间 \n。 */
  private selRaw(r: Range): string {
    const frag = r.cloneContents()
    const walk = (n: Node): string => {
      if (n.nodeType === 3) return (n.textContent ?? '').replace(/\u200b/g, '')
      const el = n as HTMLElement
      if (el.classList?.contains('nref')) return el.dataset.canon ?? el.textContent ?? ''
      let s = ''
      for (const c of Array.from(n.childNodes)) s += walk(c)
      if (el.dataset?.b === 't') s += '\n'
      return s
    }
    let out = ''
    for (const c of Array.from(frag.childNodes)) out += walk(c)
    return out.replace(/\n$/, '')
  }
  private selCheck(): void {
    const root = this.d.root(), g = getSelection()
    if (!root || !g || !g.rangeCount || g.isCollapsed || !root.contains(g.getRangeAt(0).commonAncestorContainer) || !this.d.card()) { if (this.bubFor === 'sel') this.hide(); return }
    const r = g.getRangeAt(0)
    const t = this.selRaw(r).trim()
    if (!t) { if (this.bubFor === 'sel') this.hide(); return }
    const sq = t.replace(/\s+/g, ' ')
    if ((this.d.card()?.notes ?? []).some((n) => { const v = String(n.v || '').trim().replace(/\s+/g, ' '); return !!v && (v === sq || noteText(n.t, n.v).replace(/\s+/g, ' ') === sq) })) { if (this.bubFor) this.hide(); return }
    this.selTxt = t; this.selR = r.cloneRange()
    const sr = root.getBoundingClientRect()
    const vis = Array.from(r.getClientRects()).filter((x) => x.width > 0 && x.bottom > sr.top && x.top < sr.bottom)
    if (!vis.length) return
    const top = Math.min(...vis.map((x) => x.top)), bot = Math.max(...vis.map((x) => x.bottom))
    const last = vis.filter((x) => x.bottom >= bot - 2)
    this.hov = null; this.paint()
    this.show('note', { left: Math.min(...last.map((x) => x.left)), right: Math.max(...last.map((x) => x.right)), top, bottom: bot }, 'sel', false)
  }
  private async openMark(m: Mark): Promise<void> {
    if (m.kind === 'link') { window.open(m.text, '_blank', 'noopener'); this.d.toast('已用默认浏览器打开：' + m.text); return }
    try { const r = await openFileSmart({ local: m.text }); this.d.toast(openedHow(r) + '「' + base(m.text) + '」') } catch (e) { this.d.toast('打不开：' + (e instanceof Error ? e.message : String(e)), 'err') }
  }
  private async bubClick(): Promise<void> {
    const b = this.bub, f = this.bubFor; if (!b || !f) return
    const kind0 = b.dataset.kind as string, use = b.dataset.use === '1'
    const range = f === 'sel' ? this.selR : f.r.cloneRange()
    const was = f === 'sel' ? this.selTxt : f.text
    const prefill = f === 'sel' ? this.selTxt : f.text
    this.hide()
    if (!range) return
    if (use && f !== 'sel') { const q = this.quoteFor(f); if (q) this.replace(range, f.text, q, '已换成引用内容（显示成胶囊，保存的是原文）'); return }
    const kind = kind0 === 'dir' ? 'repo' : (kind0 as 'link' | 'file' | 'note')
    const got = await this.d.add(kind, prefill)
    if (!got) return
    const q = kind === 'link' ? linkText({ text: got.text ?? '', url: got.url ?? '' }) : kind === 'file' ? fileText({ path: got.path ?? '', title: got.name, exists: true }) : kind === 'repo' ? repoText(got.name ?? '', got.path ?? '') : noteText(got.t ?? '', got.v ?? '')
    void was
    this.replace(range, f === 'sel' ? null : f.text, q, '已添加，并把这段换成了引用胶囊' + (kind === 'link' || kind === 'file' ? '（已关联这个任务）' : ''))
  }
  /** 把记下的区间换成引用原文（块编辑器把它画成胶囊）；文字已经改过 = 不替换。 */
  private replace(r: Range, expect: string | null, canon: string, ok: string): void {
    const root = this.d.root(); if (!root || !root.contains(r.startContainer)) { this.d.toast('已添加到卡片；说明里那段已经改过了，没有替换成胶囊'); return }
    if (expect !== null && r.toString().replace(/\u200b/g, '') !== expect) { this.d.toast('已添加到卡片；说明里那段已经改过了，没有替换成胶囊'); return }
    const tn = document.createTextNode(canon)
    /* v143（3.2）：只合并这次替换自己跨过的行（选区起止之间的行），其余空行原样保留 —— 以前把所有没内容的行都当残行删了 */
    const blkOf = (n: Node): Element | null => { let x: Node | null = n; while (x && x.parentNode !== root) x = x.parentNode; return x as Element | null }
    const kids = Array.from(root.children), a = blkOf(r.startContainer), z = blkOf(r.endContainer)
    const ia = a ? kids.indexOf(a) : -1, iz = z ? kids.indexOf(z) : -1
    const crossed = ia >= 0 && iz > ia ? kids.slice(ia + 1, iz + 1) : []
    r.deleteContents(); r.insertNode(tn)
    /* 选区跨行时把被清空的行并起来，再交给块编辑器的 input 流程（重建胶囊 / 自动保存 / 关联任务） */
    const sel = getSelection(); if (sel) { const c = document.createRange(); c.setStartAfter(tn); c.collapse(true); sel.removeAllRanges(); sel.addRange(c) }
    for (const blk of crossed) if (blk.isConnected && (blk as HTMLElement).dataset.b === 't' && !blk.childNodes.length && root.children.length > 1 && blk !== tn.parentElement) blk.remove()
    root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    this.d.toast(ok)
    this.soon()
  }
}
