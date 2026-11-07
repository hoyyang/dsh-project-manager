/**
 * 0.27 会话输入框「>」引用卡片内容（原型 v52 / v53 定稿）。
 * 宿主的触发服务只认「@」「/」（dsh-client-ui-input-trigger 写死），所以由插件自己读输入框的文字和光标、
 * 自己画上拉列表（外形照宿主「/」菜单），选中后用宿主给会话插槽的 inputActions.insertText 替换「空格 + >筛选词」。
 * 读不到输入框 / 没有 inputActions → 不弹（照常输入，不报错打扰）。全部监听挂在 document 上，dispose 即净。
 */
import { cardText, detectQuote, fileText, linkText, noteText, repoText, sessionText, taskText } from '../quote.js'
import type { SessionInfo } from './api.js'
import { ftype } from './board.js'
import { esc, ic } from './icons.js'

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
export type Item = { icon: string; name: string; kw?: string; alias?: string; desc?: string; cls?: string; lv?: number; sec?: string | null; text: string; parent?: number }
export type Group = { t: string; items: Item[] }
/** 引用菜单的数据来源（会话作用域）：弹窗说明框用同一份构造，条目与会话输入框完全一致。 */
export interface QuoteSource { info(): SessionInfo | null; active(): ActiveGroup[]; sid: string }

const qi = (k: string): string => '<span class="qi">' + ic(k) + '</span>'
const cb = (on: boolean, mix = false): string => '<span class="qi cb' + (on ? ' on' : mix ? ' mix' : '') + '">' + (on ? ic('check') : '') + '</span>'
const home = (p: string): string => p.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/')
const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p

export function buildQuoteGroups(src: QuoteSource): Group[] {
    const i = src.info(), ci = i?.cardInfo
    if (!ci) return []
    const G: Group[] = []
    const ti: Item[] = []
    const qc = { tasks: ci.tasks.map((t) => ({ ...t, done: !!t.done })), links: ci.links.map((l) => ({ ...l, url: l.url })), files: ci.files.map((f) => ({ id: f.id, path: f.path, title: f.title, exists: f.exists })) }
    ci.tasks.forEach((t, a) => {
      const subs = t.subs ?? [], sd = subs.filter((x) => x.done).length, mix = !!subs.length && sd > 0 && !t.done
      ti.push({ icon: cb(!!t.done, mix), name: (a + 1) + '　' + t.text, cls: t.done ? 'done' : '', desc: (subs.length ? '<span class="qx">子任务 ' + sd + '/' + subs.length + '</span>' : '') + (t.type ? '<span class="qt">' + esc(t.type) + '</span>' : ''), text: taskText(qc, a) })
      const pi = ti.length - 1
      subs.forEach((x, k) => ti.push({ lv: 1, icon: cb(!!x.done), name: (a + 1) + '.' + (k + 1) + '　' + x.text, cls: x.done ? 'done' : '', desc: x.type ? '<span class="qt">' + esc(x.type) + '</span>' : '', text: taskText(qc, a, k), parent: pi }))
    })
    G.push({ t: '任务', items: ti })
    // v88：开关只影响 AI 自动注入——关闭的说明照样出现在引用菜单里，右侧标「不注入」
    G.push({ t: '相关说明', items: ci.notes.map((n) => ({ icon: qi('note'), name: n.t, desc: '<span class="qx">' + esc(n.v.split('\n')[0]) + '</span>' + (n.off ? '<span class="qt">不注入</span>' : ''), text: noteText(n.t, n.v) })) })
    const types = [...new Set(ci.links.map((l) => l.type || '无类型'))]
    G.push({ t: '相关链接', items: types.flatMap((ty) => ci.links.filter((l) => (l.type || '无类型') === ty).map((l, k) => ({ sec: k === 0 ? ty : null, icon: qi('link'), name: l.text, alias: l.url.replace(/^[a-z]+:\/\//i, '').split('/')[0], desc: '<span class="qt">' + esc(l.type || '无类型') + '</span>', text: linkText(l) }))) })
    const dirs = ci.lfDirs ?? []
    G.push({ t: '相关文件', items: ci.files.map((f) => { const ty = ftype(f.path); const inLf = dirs.some((d) => f.path.startsWith(d + '/')); return { icon: qi(f.exists ? ty?.icon ?? 'file' : 'filex'), name: f.title || base(f.path), cls: f.exists ? '' : 'gone', desc: (ty ? '<span class="qt">' + ic(ty.icon) + esc(ty.label) + '</span>' : '') + (f.exists ? '<span class="qt ok">存在</span>' : '<span class="qt gone">已删除</span>') + (inLf ? '<span class="qt lf">在落盘项目里</span>' : ''), text: fileText({ path: f.path, title: f.title, exists: f.exists }) } }) })
    G.push({ t: '仓库', items: ci.repos.map((r) => ({ icon: qi('repo'), name: r.name, alias: home(r.path), text: repoText(r.name, r.path) })) })
    G.push({ t: '关联卡片', items: (ci.related ?? []).map((x) => ({ icon: qi('cards'), name: x.title, desc: '<span class="qx">' + esc(x.group + (x.stage ? ' · ' + x.stage : '')) + '</span>' + (x.archived ? '<span class="qt r">已归档</span>' : ''), text: cardText(x.title, x.group) })) })
    // 0.27.2「本卡片的会话」→「活跃会话」（原型 v56）：按卡片组分小节；当前会话所在的组排最前、当前会话置顶；
    // 每项 = 会话名 + 灰字卡片名（没卡片 =「还没有卡片」）+「当前会话」标签；筛选也认卡片名 / 卡片组名
    const AG = src.active().map((g) => ({ ...g, items: g.items.slice().sort((a, b) => (b.id === src.sid ? 1 : 0) - (a.id === src.sid ? 1 : 0)) }))
    AG.sort((a, b) => (b.items.some((x) => x.id === src.sid) ? 1 : 0) - (a.items.some((x) => x.id === src.sid) ? 1 : 0))
    G.push({ t: '活跃会话', items: AG.flatMap((g) => g.items.map((x, k) => ({ sec: k === 0 ? g.name : null, icon: qi('chat'), name: x.title, kw: g.name + ' ' + (x.card ?? ''), desc: '<span class="qx">' + (x.card ? esc(x.card) : '还没有卡片') + '</span>' + (x.id === src.sid ? '<span class="qt cur">当前会话</span>' : ''), text: sessionText(x.title, g.name, x.card ?? undefined, x.id) }))) })
    return G
  }

 export class QuoteMenu {
  private box: HTMLElement | null = null
  private st: { len: number; query: string; hi: number; launch: number | null } | null = null
  private dis: string | null = null
  private skip = false
  /** 最近一次弹出的「>」身份（光标前文字长度 + 筛选词 + 整段文字）。 */
  private lastKey: string | null = null
  private raf = 0
  private dead = false
  constructor(private readonly root: HTMLElement, private readonly host: QuoteHost) {
    document.addEventListener('keydown', this.onKey, true)
    document.addEventListener('input', this.onEdit, true)
    document.addEventListener('selectionchange', this.onEdit)
    document.addEventListener('mousedown', this.onDown, true)
    window.addEventListener('resize', this.onResize)
  }
  dispose(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    document.removeEventListener('keydown', this.onKey, true)
    document.removeEventListener('input', this.onEdit, true)
    document.removeEventListener('selectionchange', this.onEdit)
    document.removeEventListener('mousedown', this.onDown, true)
    window.removeEventListener('resize', this.onResize)
    this.close()
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
  private onResize = (): void => { if (this.box) this.place() }
  private track(): void {
    const ed = this.editor()
    // 0.27.2 与「/」菜单一致：焦点离开输入框（点了输入区里的工具栏等）不关，只有按在输入区外（onDown）/ Esc / 光标挪出「>」词才关
    if (!ed) return this.close()
    if (document.activeElement !== ed) return
    const ci = this.host.info()?.cardInfo
    if (!ci || !this.host.actions()) return this.close()
    const p = this.prefix()
    if (!p) return this.close()
    // 信息卡按钮打开的：光标前从打开处起的文字当筛选词；遇到空白 / 光标退到打开处之前就关
    if (this.st?.launch !== null && this.st?.launch !== undefined) {
      const now = this.host.actions()!.captureInsertion().start
      const n = now - this.st.launch
      const q = n > 0 ? p.text.slice(-n) : ''
      if (n < 0 || /\s/.test(q) || q.length !== n) return this.close()
      this.st.len = n; this.st.query = q; return this.paint()
    }
    const hit = detectQuote(p.text, p.first)
    // 0.27.2 同「/」：收起后光标挪开再挪回同一个「>」也不弹；文字变了（打字 / 删除）才清掉记忆
    if (!hit) { if (this.dis && this.dis.split('|')[1] !== ed.textContent) this.dis = null; return this.close() }
    const key = p.text.length + ':' + hit.query + '|' + ed.textContent
    if (this.dis === key) return
    this.lastKey = key
    this.dis = null
    const same = this.st && this.st.query === hit.query
    this.st = { len: hit.len, query: hit.query, hi: same ? this.st!.hi : 0, launch: null }
    this.paint()
  }
  /** 信息卡「> 引用卡片内容」：在当前光标处打开（不插入「>」）。 */
  launch(): void {
    // 0.27.1 再点一次「> 引用卡片内容」= 收起（按下时 onDown 已关掉并记下）
    if (this.skip) { this.skip = false; return }
    const ed = this.editor(), ia = this.host.actions()
    if (!ed || !ia) { this.host.toast('没找到这个会话的输入框，没法插入引用', 'err'); return }
    // 按钮在 mousedown 时已阻止抢焦点：输入框焦点与光标都还在，直接从当前光标处打开
    if (document.activeElement !== ed) ed.focus()
    this.st = { len: 0, query: '', hi: 0, launch: ia.captureInsertion().start }
    this.paint()
  }
  private groups(): Group[] { return buildQuoteGroups(this.host) }

  /** 筛选：标题 / 别名包含输入的字；子任务命中时带出它的父任务；链接分类小标题跟着第一条走。 */
  private list(): Group[] {
    const k = (this.st?.query ?? '').trim().toLowerCase()
    return this.groups().map((g) => {
      const secOf = new Map<Item, string>(); let cur = ''
      for (const x of g.items) { if (x.sec) cur = x.sec; if (cur) secOf.set(x, cur) }
      const keep = new Set<number>()
      g.items.forEach((x, i) => { if (!k || (x.name + ' ' + (x.alias ?? '') + ' ' + (x.kw ?? '')).toLowerCase().includes(k)) { keep.add(i); if (x.parent !== undefined) keep.add(x.parent) } })
      let last = ''
      const items = g.items.filter((_, i) => keep.has(i)).map((x) => { const sc = secOf.get(x) ?? ''; const o = { ...x, sec: sc && sc !== last ? sc : null }; last = sc; return o })
      return { t: g.t, items }
    }).filter((g) => g.items.length)
  }
  private place(): void {
    const box = this.box, c = this.card()
    if (!box || !c) return
    const r = c.getBoundingClientRect()
    box.style.left = r.left + 'px'
    box.style.width = r.width + 'px'
    box.style.bottom = (innerHeight - r.top + 8) + 'px'
    box.style.maxHeight = Math.max(160, Math.min(400, r.top - 84)) + 'px'
  }
  private paint(): void {
    const st = this.st, i = this.host.info()
    if (!st || !i?.card) return this.close()
    const G = this.list(), flat = G.flatMap((g) => g.items)
    if (st.hi >= flat.length) st.hi = Math.max(0, flat.length - 1)
    let n = 0
    const body = G.map((g) => '<div class="qm-g" role="presentation">' + esc(g.t) + '</div>' + g.items.map((x) => {
      const id = n++
      return (x.sec ? '<div class="qm-s" role="presentation">' + esc(x.sec) + '</div>' : '') + '<button type="button" tabindex="-1" role="option" id="dpmQo' + id + '" class="qm-i' + (x.lv ? ' lv1' : '') + (x.cls ? ' ' + x.cls : '') + (id === st.hi ? ' on' : '') + '" aria-selected="' + (id === st.hi) + '" data-qi="' + id + '">' + x.icon + '<span class="qn">' + esc(x.name) + '</span>' + (x.alias ? '<span class="qa">' + esc(x.alias) + '</span>' : '') + (x.desc ? '<span class="qd">' + x.desc + '</span>' : '') + '</button>'
    }).join('')).join('')
    const cur = flat[st.hi]
    const q = st.query
    const fresh = !this.box
    if (!this.box) { this.box = document.createElement('div'); this.box.className = 'dpm-qm'; document.body.append(this.box); this.box.addEventListener('mousemove', this.onMove) }
    // 0.27.1 入场动画只在第一次出现时播；之后光标移动 / 筛选只换内容（原来每次重画都重播 = 闪）
    const inner = '<div class="qm-h">' + ic('cards') + '引用卡片<b>「' + esc(i.card.title) + '」</b>' + (q ? '<span>筛选</span><span class="q">' + esc(q) + '</span>' : '') + '</div>'
      + '<div class="qm-v" role="listbox" aria-label="卡片内容"' + (cur ? ' aria-activedescendant="dpmQo' + st.hi + '"' : '') + '>' + (body || '<div class="qm-e">' + (q ? '没有和「' + esc(q) + '」匹配的内容' : '这张卡片还没有可以引用的内容') + '</div>') + '</div>'
      + (cur ? '<div class="qm-f"><span class="pv"><b>将插入</b>　' + esc(this.pv(cur.text)) + '</span><span class="keys"><kbd>↑</kbd><kbd>↓</kbd>选择　<kbd>↵</kbd>插入　<kbd>esc</kbd>关闭</span></div>' : '')
    // 0.27.2 .qm 外框只在第一次建（带入场动画），之后只换里面内容：同一帧里 input / selectionchange / 点输入框连着重画，也不会重播动画
    const frame = this.box.firstElementChild as HTMLElement | null
    if (fresh || !frame) this.box.innerHTML = '<div class="qm in" role="dialog" aria-label="引用卡片内容">' + inner + '</div>'
    else frame.innerHTML = inner
    this.place()
    const o = this.box.querySelector('#dpmQo' + st.hi) as HTMLElement | null, v = this.box.querySelector('.qm-v') as HTMLElement | null
    if (o && v) { const a = o.offsetTop, b = a + o.offsetHeight; if (a < v.scrollTop) v.scrollTop = a - 30; else if (b > v.scrollTop + v.clientHeight) v.scrollTop = b - v.clientHeight + 4 }
  }
  private pv(t: string): string { return t.slice(1, -1).split('\n').slice(0, 3).join(' ⏎ ') }
  private onMove = (e: MouseEvent): void => {
    const it = (e.target as HTMLElement).closest?.('[data-qi]') as HTMLElement | null
    if (!it || !this.st || +(it.dataset.qi as string) === this.st.hi) return
    this.st.hi = +(it.dataset.qi as string)
    this.box?.querySelectorAll('.qm-i.on').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false') })
    it.classList.add('on'); it.setAttribute('aria-selected', 'true')
    const cur = this.list().flatMap((g) => g.items)[this.st.hi], pv = this.box?.querySelector('.qm-f .pv')
    if (cur && pv) pv.innerHTML = '<b>将插入</b>　' + esc(this.pv(cur.text))
  }
  private close(): void { this.st = null; this.box?.removeEventListener('mousemove', this.onMove); this.box?.remove(); this.box = null }
  private pick(i: number): void {
    const st = this.st, ia = this.host.actions()
    const x = this.list().flatMap((g) => g.items)[i]
    if (!st || !x || !ia) return
    const cur = ia.captureInsertion()
    const span = { start: st.launch ?? cur.start - st.len, end: cur.start, draftRev: cur.draftRev }
    this.close()
    /* v138（2.1）：引用原文直接在「空格 + >筛选词」处插成胶囊（宿主 insert-reference）；接不住才退回插文字 */
    const cx = (window as unknown as { __dpmComposer?: { insertAt(sid: string, c: string, sp: Span): boolean } }).__dpmComposer
    if (cx?.insertAt(this.host.sid, x.text, span)) { this.editor()?.focus(); return }
    if (!ia.insertText(x.text, span)) this.host.toast('插入引用失败：输入框内容刚刚变了，再选一次', 'err')
    this.editor()?.focus()
  }
  private onDown = (e: MouseEvent): void => {
    if (!this.box) return
    const t = e.target as HTMLElement
    if (this.box.contains(t)) { e.preventDefault(); const it = t.closest('[data-qi]') as HTMLElement | null; if (it) this.pick(+(it.dataset.qi as string)); return }
    // 0.27.2 与宿主「/」菜单一致（dsh-client-ui-input-trigger：pointerdown 在 [data-composer-card] 里不关）：
    // 输入区里按下不关，光标还在「>」词里就留着，挪出去由 track 关、挪回来再弹；输入区外按下 = 收起并记住同一个「>」
    if (t.closest?.('[data-qopen]')) { this.skip = true; this.dismiss(); return }
    if (this.card()?.contains(t)) return
    this.dismiss()
  }
  /** 收起并记住当前「>」：track 看到同一个触发词不再弹。 */
  private dismiss(): void {
    // 按在输入区外时浏览器先把选区挪走了，prefix() 已读不到 → 用最后一次 track 记下的同一个「>」
    if (this.st && this.st.launch === null) this.dis = this.lastKey
    this.close()
  }
  private onKey = (e: KeyboardEvent): void => {
    if (!this.st || !this.box || e.isComposing || e.keyCode === 229) return
    const ed = this.editor()
    if (!ed || document.activeElement !== ed) return
    const n = this.list().flatMap((g) => g.items).length
    const stop = (): void => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { stop(); if (n) { this.st.hi = (this.st.hi + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; this.paint() } return }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && n) { stop(); this.pick(this.st.hi); return }
    if (e.key === 'Escape') { stop(); this.dismiss() }
  }
}