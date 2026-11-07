/**
 * v140（1）/ v141（3）：卡片详情的「详细信息气泡窗」。卡片上只留标题行，点任务 / 子任务标题或整条相关说明 → 详情左边弹出。
 * 原型 = prototype/dsh-web-v142.html v140js「1」段 + v141css 3(2)：宽 = 详情左边可用空间（460–800），高度随内容、最高 = 详情去掉标题栏和底部按钮区；
 * 箭头指向被点的那一项（蓝框）；换项原地换内容；同项再点 / × / Esc / 点外面关；跟着详情滚动。引用原文 = 胶囊（与对话框同一套识别）。
 */
import type { Card, Snapshot, Task } from './api.js'
import { openedHow, openFileSmart, post } from './api.js'
import { allRefs, type RefHit } from './composer.js'
import { esc, ic } from './icons.js'
import { chipIconSvg } from './chipicon.js'
import { fileText, findRefFile, linkText, noteText, refTitle } from '../quote.js'
import { tcHtml } from './sess.js'

export interface DpDeps {
  root: HTMLElement
  card(): Card | undefined
  snap(): Snapshot | null
  quote(text: string): void
  edit(cardId: string, taskId: string): void
  toast(m: string, k?: 'ok' | 'err'): void
  openCard(id: string): void
  openSession(id: string): void
  sessions(): Array<{ id: string; title: string }>
  ftIcon(path: string): string
}
type Cur = { kind: 'task' | 'note'; id: string }

const RXD = /^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/
const linkify = (h: string): string => h.replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?，。；：！？）)\]]/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>')
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
/** v151（3.2）：气泡窗里的选区 → 纯文本；胶囊 = 引用原文（data-ref），块级（.nline / .ndiv / li / section 标题）之间换行。选区不在气泡里 = null（交给浏览器）。 */
export function selText(root: HTMLElement): string | null {
  const sel = document.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null
  const rg = sel.getRangeAt(0)
  if (!root.contains(rg.commonAncestorContainer)) return null
  const frag = rg.cloneContents()
  /* 选区起点 / 终点落在胶囊里面时，cloneContents 带出的是胶囊的浅拷贝（属性都在）→ 同样按 data-ref 输出整条原文 */
  const chipOf = (n: Node): HTMLElement | null => (n.nodeType === 1 ? n as HTMLElement : n.parentElement)?.closest('.nref') ?? null
  const sc = chipOf(rg.startContainer), ec = chipOf(rg.endContainer)
  let out = ''
  const BLOCK = /^(DIV|P|LI|SECTION|UL|OL|H2|H3|HEADER)$/
  const walk = (n: Node): void => {
    if (n.nodeType === 3) { out += n.textContent ?? ''; return }
    if (n.nodeType !== 1 && n.nodeType !== 11) return
    const h = n as HTMLElement
    if (n.nodeType === 1 && h.classList.contains('nref')) { out += h.dataset.ref || h.textContent || ''; return }
    if (n.nodeType === 1 && h.tagName === 'BR') { out += '\n'; return }
    const blk = n.nodeType === 1 && BLOCK.test(h.tagName)
    if (blk && out && !out.endsWith('\n')) out += '\n'
    for (const ch of Array.from(n.childNodes)) walk(ch)
    if (blk && out && !out.endsWith('\n')) out += '\n'
  }
  if (sc && sc === ec) return sc.dataset.ref || sc.textContent || ''
  walk(frag)
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

export class DetailPop {
  private el: HTMLElement | null = null
  private cur: Cur | null = null
  private html = ''
  private raf = 0
  private offs: Array<() => void> = []
  constructor(private d: DpDeps) {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, cap = true): void => { document.addEventListener(t, f, cap); this.offs.push(() => document.removeEventListener(t, f, cap)) }
    on('scroll', (e) => { if (this.cur && e.target instanceof Node && d.root.contains(e.target)) this.soon() })
    on('pointerdown', (e) => {
      if (!this.cur || !this.el) return
      const t = e.target as HTMLElement | null
      if (!t?.closest || this.el.contains(t)) return
      if (t.closest('.detail .task .tkt, .detail .nk:not(.editing), .dpm-spk, dialog, .dpm-toasts, .dpm-gp')) return
      this.close()
    })
    on('keydown', (e) => {
      if (e.key !== 'Escape' || !this.cur || e.defaultPrevented || document.querySelector('dialog[open]')) return
      const np = this.el?.querySelector('.nref-pop')
      if (np) { e.preventDefault(); e.stopPropagation(); np.remove(); return }
      e.preventDefault(); e.stopPropagation()
      const s = this.src()
      this.close()
      ;(s?.querySelector('.tkt, .nk-t') as HTMLElement | null)?.focus({ preventScroll: true })
    })
    const rs = (): void => this.soon()
    window.addEventListener('resize', rs); this.offs.push(() => window.removeEventListener('resize', rs))
    const ro = new ResizeObserver(rs); ro.observe(d.root); this.offs.push(() => ro.disconnect())
  }
  dispose(): void { this.close(); for (const f of this.offs) f(); this.offs = []; if (this.raf) cancelAnimationFrame(this.raf) }
  isOpen(kind?: string, id?: string): boolean { return !!this.cur && (!kind || (this.cur.kind === kind && this.cur.id === id)) }
  /** 同一项再点 = 关闭；另一项 = 原地换内容。 */
  open(kind: Cur['kind'], id: string): void {
    if (this.isOpen(kind, id)) { this.close(); return }
    const sw = !!this.cur
    this.cur = { kind, id }
    if (!this.el) {
      const el = document.createElement('section')
      el.className = 'dpm-dp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false')
      el.addEventListener('click', (e) => this.onClick(e))
      /* v151（3.2，用户截图「引用内容没有被复制」）根因：胶囊里只有标题，浏览器复制选区时胶囊要么只剩标题、要么整个丢了（user-select / 不可编辑节点）。
         改：复制时自己把选区序列化 —— 普通文字照原样、每个胶囊换成它的引用原文（data-ref），行与行之间换行，写进剪贴板的 text/plain。 */
      el.addEventListener('copy', (e) => { const t = selText(el); if (t == null) return; e.preventDefault(); e.clipboardData?.setData('text/plain', t); (window as unknown as Record<string, unknown>).__dpmDpCopy = { t, at: Date.now() } })
      el.addEventListener('keydown', (e) => { const c = (e.target as HTMLElement).closest?.('.nref') as HTMLElement | null; if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.chip(c) } })
      document.body.append(el)
      this.el = el
    }
    this.html = ''
    this.sync(sw)
    if (!sw) setTimeout(() => (this.el?.querySelector('[data-dpx]') as HTMLElement | null)?.focus({ preventScroll: true }), 30)
    ;(window as unknown as Record<string, unknown>).__dpmDp = (): unknown => this.probe()
  }
  close(): void {
    if (!this.el) return
    this.el.remove(); this.el = null; this.cur = null; this.html = ''
    for (const x of Array.from(this.d.root.querySelectorAll('.dpm-dpsrc'))) x.classList.remove('dpm-dpsrc')
  }
  /** 详情重画 / 数据变了：内容有变就换（保留滚动），然后重新定位。 */
  sync(sw = false): void {
    if (!this.cur || !this.el) return
    const c = this.d.card()
    const h = c ? this.bodyHtml(c, this.cur) : null
    if (h == null || !this.d.root.querySelector('.detail') || this.d.root.hidden) { this.close(); return }
    if (h !== this.html) {
      const sc = this.el.querySelector('.dp-b')?.scrollTop ?? 0
      this.el.innerHTML = h; this.html = h
      this.el.setAttribute('aria-labelledby', 'dpmDpT')
      const b = this.el.querySelector('.dp-b'); if (b) b.scrollTop = sc
      if (sw) { this.el.classList.remove('sw'); void this.el.offsetWidth; this.el.classList.add('sw') }
    }
    this.place()
  }
  private soon(): void { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.place() }) }
  private src(): HTMLElement | null {
    const c = this.cur; if (!c) return null
    if (c.kind === 'task') return this.d.root.querySelector('.detail .task[data-tid="' + CSS.escape(c.id) + '"]')
    return (Array.from(this.d.root.querySelectorAll<HTMLElement>('.detail .nk[data-nk]')).find((n) => n.querySelector('.nk-t')?.textContent === c.id)) ?? null
  }
  private place(): void {
    const el = this.el; if (!el || !this.cur) return
    const det = this.d.root.querySelector('.detail') as HTMLElement | null
    if (!det || this.d.root.hidden) { this.close(); return }
    const cr = det.getBoundingClientRect()
    const s = this.src(), anchor = s ? (this.cur.kind === 'task' ? s.querySelector(':scope > .tkhead') as HTMLElement : s) : null
    const W = clamp(cr.left - 26, 460, 800)
    el.style.setProperty('--w', W + 'px')
    /* v141（3.2）：最高 = 详情去掉顶部标题栏和底部按钮区（= 中间滚动区 .d-b）；内容少按内容高 */
    const db = det.querySelector('.d-b') as HTMLElement | null, br = db ? db.getBoundingClientRect() : cr
    const top0 = Math.round(br.top), bot0 = Math.round(br.bottom)
    el.style.maxHeight = Math.max(180, bot0 - top0) + 'px'
    const H = el.offsetHeight
    const ar = anchor ? anchor.getBoundingClientRect() : { top: top0 + 40, height: 30 }
    const cy = ar.top + ar.height / 2
    const top = clamp(cy - 110, top0, Math.max(top0, bot0 - H))
    el.style.left = Math.round(Math.max(8, cr.left - 14 - W)) + 'px'
    el.style.top = Math.round(top) + 'px'
    el.style.setProperty('--ty', Math.round(clamp(cy - top, 16, H - 16)) + 'px')
    for (const x of Array.from(this.d.root.querySelectorAll('.dpm-dpsrc'))) if (x !== anchor) x.classList.remove('dpm-dpsrc')
    if (anchor && !anchor.classList.contains('dpm-dpsrc')) anchor.classList.add('dpm-dpsrc')
  }

  /* ── 内容 ── */
  private refNotes(c: Card): Array<{ t: string; canon: string }> { return (c.noteItems ?? []).map((n) => ({ t: n.t, canon: noteText(n.t, n.v) })) }
  private chipHtml(kind: RefHit['kind'], title: string, body: string, canon: string, c: Card, moved?: string, gone?: boolean): string {
    /* v153：气泡窗胶囊的图标和任务说明 / DSH 对话框同一套（chipicon.ts 一处定义） */
    const icon = chipIconSvg(kind, body)
    const gold = kind === 'link' && (c.webLinks ?? []).some((l) => l.star && l.url === body)
    const tip = (moved ? '这个文件已经挪到 ' + body + '（说明里写的还是旧的） · ' : '') + (kind === 'note' ? '相关说明 · 点一下看全文' : kind === 'link' ? '相关链接 · 点一下用浏览器打开' : kind === 'file' ? '相关文件 · 点一下用默认应用打开' : kind === 'repo' ? '仓库 · 点一下在访达里打开' : kind === 'card' ? '关联卡片 · 点一下打开它的详情' : '会话 · 点一下切过去')
    return '<span class="nref' + (gold ? ' gold' : '') + (moved ? ' moved' : '') + (gone ? ' gone' : '') + '" role="button" tabindex="0" data-rk="' + kind + '"' + (moved ? ' data-from="' + esc(moved) + '"' : '') + ' data-rt="' + esc(title) + '" data-rb="' + esc(body) + '" data-ref="' + esc(canon) + '" title="' + esc(tip) + '"><span class="ri">' + icon + '</span><span class="rt">' + esc(title) + '</span></span>'
  }
  /** 说明全文：分割线照常；引用原文（可跨行）画成胶囊。 */
  private readHtml(v: string, c: Card): string {
    const txt = String(v ?? '')
    const refs = allRefs(txt, this.refNotes(c))
    const lines: Array<{ h: string; p: string | null }> = [{ h: '', p: '' }]
    const addText = (s: string): void => {
      s.split('\n').forEach((part, i) => {
        if (i) lines.push({ h: '', p: '' })
        const L = lines[lines.length - 1]
        L.h += linkify(esc(part)); if (L.p !== null) L.p += part
      })
    }
    let at = 0
    for (const r of refs) {
      addText(txt.slice(at, r.i))
      const L = lines[lines.length - 1]
      /* v154（1.4）：文件引用按「路径 → prev → 同名 → 归一」找到卡内文件后，显示现在的名字、打开现在的路径
         （只改显示，不动说明里的原文；原文的同步由搬家 / 启动修复负责）。 */
      const f = r.kind === 'file' ? findRefFile(c.files ?? [], r.body ?? '') : null
      const mv = f && f.path !== (r.body ?? '') ? (r.body ?? '') : undefined
      /* 同任务说明：只标「卡片里有、磁盘上没了」的（快照里有存在状态）；没加进卡片的不冒充已不在 */
      const gone = r.kind === 'file' && !!f && this.d.snap()?.files?.[f.path] === false
      L.h += this.chipHtml(r.kind, f ? refTitle(f) : r.title, f ? f.path : (r.body ?? ''), r.canon, c, mv, !!gone); L.p = null
      at = r.i + r.len
    }
    addText(txt.slice(at))
    return lines.map((L) => {
      const m = L.p !== null ? L.p.match(RXD) : null
      if (m) return '<div class="ndiv"><i></i>' + (m[1] ? '<b>' + esc(m[1]) + '</b><i></i>' : '') + '</div>'
      return '<div class="nline">' + (L.h || '<br>') + '</div>'
    }).join('')
  }
  private find(c: Card, id: string): { t: Task; parent: Task | null } | null {
    for (const t of c.tasks) { if (t.id === id) return { t, parent: null }; for (const s of t.subs ?? []) if (s.id === id) return { t: s, parent: t } }
    return null
  }
  private bodyHtml(c: Card, o: Cur): string | null {
    const ro = !!c.archivedAt
    const X = '<button type="button" class="ib2" data-dpx title="关闭（Esc）" aria-label="关闭详细信息">' + ic('x') + '</button>'
    const qb = (q: string, what: string): string => '<button type="button" class="ib2" data-dpq="' + esc(q) + '" title="生成引用文字（复制；会话可见时同时插入输入框）" aria-label="引用这个' + what + '">' + ic('quote') + '</button>'
    if (o.kind === 'note') {
      const n = (c.noteItems ?? []).find((x) => x.t === o.id); if (!n) return null
      return '<header class="dp-h"><div class="dp-k"><span class="kb note">相关说明</span><span class="pp">' + esc(c.t) + '</span></div>'
        + '<div class="dp-a">' + qb(noteText(n.t, n.v), '说明') + X + '</div>'
        + '<h2 class="dp-t" id="dpmDpT">' + esc(n.t) + '</h2>'
        + '<div class="dp-m"><span class="mc ' + (n.off ? 'off' : 'ok') + '">' + (n.off ? '不注入 Agent 会话' : '自动注入 Agent 会话') + '</span><span class="mc">' + String(n.v ?? '').length + ' 字</span></div></header>'
        + '<div class="dp-b"><div class="dp-s"><div class="dn">' + this.readHtml(n.v, c) + '</div></div></div>'
    }
    const f = this.find(c, o.id); if (!f) return null
    const t = f.t, what = f.parent ? '子任务' : '任务', subs = f.parent ? [] : (t.subs ?? [])
    const links = (t.links ?? []).map((id) => (c.webLinks ?? []).find((l) => l.id === id)).filter(Boolean) as NonNullable<Card['webLinks']>
    const files = (t.files ?? []).map((id) => (c.files ?? []).find((x) => x.id === id)).filter(Boolean) as NonNullable<Card['files']>
    const st = this.d.snap()?.files ?? {}
    const sec = (h: string, n: string | number, inner: string): string => '<section class="dp-s"><div class="dp-sh">' + h + '<i>' + n + '</i></div>' + inner + '</section>'
    let body = ''
    if ((t.note ?? '').trim()) body += sec('说明', String(t.note).length + ' 字', '<div class="dn">' + this.readHtml(t.note ?? '', c) + '</div>')
    if (subs.length) body += sec('子任务', subs.filter((x) => x.done).length + '/' + subs.length, '<ul class="dp-ks">' + subs.map((x) => '<li class="' + (x.done ? 'done' : '') + '"><button type="button" class="k" data-dpgo="' + esc(x.id ?? '') + '"><span class="dot"></span><span class="tx">' + esc(x.text) + '</span></button>' + (x.sess ? tcHtml(c.id, x, true, true) : '') + '</li>').join('') + '</ul>')
    if (links.length) body += sec('相关链接', links.length, '<div class="dc">' + links.map((l) => this.chipHtml('link', l.text, l.url, linkText({ id: l.id, text: l.text, type: l.type, url: l.url }), c)).join('') + '</div>')
    if (files.length) body += sec('相关文件', files.length, '<div class="dc">' + files.map((x) => this.chipHtml('file', x.title || x.path.replace(/\/+$/, '').split('/').pop() || x.path, x.path, fileText({ id: x.id, path: x.path, title: x.title, exists: st[x.path] !== false }), c)).join('') + '</div>')
    if (!body) body = '<div class="dp-e">还没有说明、链接或文件' + (ro ? '' : '<button type="button" class="btn sm" data-dpedit>补充详情</button>') + '</div>'
    const tm = (s?: string): string => { const d = new Date(s ?? ''); return Number.isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
    return '<header class="dp-h"><div class="dp-k"><span class="kb">' + what + '</span><span class="pp">' + esc(c.t + (f.parent ? ' › ' + f.parent.text : '')) + '</span></div>'
      + '<div class="dp-a">' + qb((t.note ?? '').trim() || t.text, what) + (ro ? '' : '<button type="button" class="ib2" data-dpedit title="编辑（弹窗）" aria-label="编辑这个' + what + '">' + ic('pencil') + '</button>') + X + '</div>'
      + '<h2 class="dp-t" id="dpmDpT">' + esc(t.text) + '</h2>'
      + '<div class="dp-m"><span class="mc' + (t.done ? ' ok' : '') + '">' + (t.done ? '已完成' : '未完成') + '</span>' + (t.type ? '<span class="mc">' + esc(t.type) + '</span>' : '') + (t.due ? '<span class="mc">截止 ' + esc(t.due.slice(5)) + '</span>' : '') + (t.created ? '<span class="mc">添加 ' + esc(tm(t.created)) + ' · 修改 ' + esc(tm(t.updated ?? t.created)) + '</span>' : '') + tcHtml(c.id, t, !!f.parent, ro) + '</div></header>'
      + '<div class="dp-b">' + body + '</div>'
  }

  /* ── 交互 ── */
  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement
    const c = this.d.card(); if (!c || !this.cur) return
    if (t.closest('[data-dpx]')) { this.close(); return }
    const q = t.closest('[data-dpq]') as HTMLElement | null; if (q) { this.d.quote(q.dataset.dpq ?? ''); return }
    if (t.closest('[data-dpedit]')) { const id = this.cur.id; this.close(); this.d.edit(c.id, id); return }
    const go = t.closest('[data-dpgo]') as HTMLElement | null; if (go) { this.open('task', go.dataset.dpgo ?? ''); return }
    const ch = t.closest('.nref') as HTMLElement | null; if (ch) { e.preventDefault(); this.chip(ch); return }
    if (!t.closest('.nref-pop')) this.el?.querySelector('.nref-pop')?.remove()
  }
  /** 点胶囊 = 按种类打开：说明 = 小窗全文、链接 = 浏览器、文件 = 默认应用、仓库 = 访达、关联卡片 = 它的详情、会话 = 切过去。 */
  private chip(ch: HTMLElement): void {
    const k = ch.dataset.rk, title = ch.dataset.rt ?? '', body = ch.dataset.rb ?? ''
    const c = this.d.card(); if (!c) return
    ;(window as unknown as Record<string, unknown>).__dpmDpChip = { k, title, body, at: Date.now() }
    if (k === 'note') { this.notePop(ch, c, title); return }
    if (k === 'link') { window.open(body, '_blank', 'noopener'); return }
    if (k === 'file') { const f = (c.files ?? []).find((x) => x.path === body); void openFileSmart({ card: c.id, file: f?.id ?? '', path: body, name: title }).then((r) => { if (r.how === 'rightbar') this.d.toast(openedHow(r) + '「' + title + '」') }).catch((er) => this.d.toast('打不开这个文件：' + (er instanceof Error ? er.message : String(er)), 'err')); return }
    if (k === 'repo') { void post('fs/open-local', { path: body }).catch((er) => this.d.toast('打不开这个文件夹：' + (er instanceof Error ? er.message : String(er)), 'err')); return }
    if (k === 'card') { const x = this.d.snap()?.board.cards.find((y) => y.t === title); if (x) { this.close(); this.d.openCard(x.id) } else this.d.toast('找不到这张卡片：' + title, 'err'); return }
    const s = this.d.sessions().find((x) => x.title === title)
    if (s) this.d.openSession(s.id); else this.d.toast('找不到这个会话：' + title, 'err')
  }
  private notePop(ch: HTMLElement, c: Card, title: string): void {
    const el = this.el; if (!el) return
    el.querySelector('.nref-pop')?.remove()
    const n = (c.noteItems ?? []).find((x) => x.t === title)
    if (!n) { this.d.toast('这条相关说明已经不在了', 'err'); return }
    const p = document.createElement('div')
    p.className = 'nref-pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '相关说明：' + n.t)
    p.innerHTML = '<div class="nph"><span class="npi">' + ic('note') + '</span><b>' + esc(n.t) + '</b><span class="npt">相关说明</span></div><p class="npb">' + esc(n.v) + '</p><div class="npf"><kbd>Esc</kbd> 关闭</div>'
    el.append(p)
    const hr = el.getBoundingClientRect(), r = ch.getBoundingClientRect()
    const left = Math.round(clamp(r.left - hr.left, 8, hr.width - p.offsetWidth - 8))
    p.style.left = left + 'px'
    p.style.setProperty('--ax', Math.round(clamp(r.left + r.width / 2 - hr.left - left, 10, p.offsetWidth - 20)) + 'px')
    let top = r.bottom - hr.top + 8
    const up = top + p.offsetHeight + 12 > hr.height
    if (up) top = Math.max(8, r.top - hr.top - p.offsetHeight - 8)
    p.style.top = Math.round(top) + 'px'; p.classList.toggle('up', up)
  }
  private probe(): unknown {
    if (!this.cur || !this.el) return null
    return { kind: this.cur.kind, id: this.cur.id, rect: this.el.getBoundingClientRect().toJSON(), body: this.el.querySelector('.dp-b')?.getBoundingClientRect().toJSON(), chips: Array.from(this.el.querySelectorAll<HTMLElement>('.nref')).map((x) => ({ k: x.dataset.rk, t: x.textContent, gold: x.classList.contains('gold') })), ty: this.el.style.getPropertyValue('--ty') }
  }
}
