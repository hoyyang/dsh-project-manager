/**
 * v136–v139：DSH 会话输入框（宿主 Lexical 编辑器）里的引用胶囊 + 链接 / 路径识别 + 小气泡。
 * 原型 prototype/dsh-web-v139.html「3 DSH 对话框」一比一：
 *  - 引用原文（「引」/ 引用菜单 / 粘贴 / 手打）按结构识别成胶囊：插件注册一个引用来源（source = dsh-project-manager），
 *    胶囊 = 宿主 ReferenceChipNode（ref = 引用原文、clipboardText = 引用原文）→ 复制 / 发送都是原文；点胶囊 = 打开 / 跳转。
 *    插入一律走宿主 slash/input-insert-reference（span + draftRev 校验），不碰 setDraft 全量重写（v138 2(1) 连续插入不塌）。
 *  - 会话关联了卡片时：链接 / 存在的文件 / 文件夹画深蓝虚线（CSS Custom Highlight，不改 DOM），悬停出气泡「添加为…」或「使用引用内容」，
 *    ⌘ 点击直接打开；框选出「添加为相关说明」；添加成功后那段原文原位换成引用胶囊（v139 1(1)）。
 *  - 路径识别 = 引号整段 + 「最长存在前缀」（v139 1(2)），存在与否 / 文件还是文件夹以 host 批量 stat 为准。
 * 只用公开扩展点：dock 插槽给的 inputActions / useInput、会话作用域事件、inputTriggers.registerSource；读不到就不识别并 console 点名。
 */
import { cardText, fileText, linkText, noteText, refNameKey, repoText } from '../quote.js'
import { openedHow, openFileSmart, post, type SessionInfo } from './api.js'
import { esc, iconMask } from './icons.js'
import { chipIconId } from './chipicon.js'

/* ── v153：胶囊类型 + 类型图标（和说明框 / 气泡窗同一套；对话框里只能用 mask 画） ───────── */
const RX_CARD = /^「“[^”「」]+”（卡片组：“[^”「」]+”）卡片」$|^「[^「」“”（）]+（卡片组：[^「」（）]+）卡片」$/
const RX_SESS = /^「“[^”「」]+”会话(?:（[^「」]*）)?」$/
const RX_REPO = /^「“[^”「」]+”（路径：(?:\/|~\/)[^）「」]+）」$|^「[^「」“”（）]+（路径：(?:\/|~\/)[^）「」]+）」$/
const RX_LINK = /^「“[^”「」]+”（https?:\/\/[^）「」]+）」$|^「[^「」“”（）]+（https?:\/\/[^）「」]+）」$/
const RX_FILE = /^「“[^”「」]+”（(?:已删除：)?(?:\/|~\/)[^）「」]+）」$|^「[^「」“”（）]+（(?:已删除：)?(?:\/|~\/)[^）「」]+）」$/
/** 引用原文 → 胶囊类型（结构识别；认不出 = 说明）。 */
export function refKind(ref: string): 'note' | 'link' | 'file' | 'repo' | 'card' | 'sess' {
  if (RX_CARD.test(ref)) return 'card'
  if (RX_SESS.test(ref)) return 'sess'
  if (RX_REPO.test(ref)) return 'repo'
  if (RX_LINK.test(ref)) return 'link'
  if (RX_FILE.test(ref)) return 'file'
  return 'note'
}
/** 文件引用里的路径（给 ftype 按扩展名选图标）。 */
const refFilePath = (ref: string): string => { const m = /（(?:已删除：)?((?:\/|~\/)[^）「」]+)）」$/.exec(ref); return m ? m[1] : '' }
const CHIP_IC_IDS = ['note', 'link', 'file', 'img', 'video', 'audio', 'code', 'data', 'doc', 'sheet', 'slides', 'archive2', 'log', 'pkg', 'font', 'design', 'folder', 'cards', 'chat']
let chipCssEl: HTMLStyleElement | null = null
let chipCssRefs = 0
/** v153：把图标 id → CSS mask 变量注入一次（图标 path 来自 icons.ts，和插件自己画的图标同源）。 */
function ensureChipCss(): void {
  if (!chipCssEl) {
    chipCssEl = document.createElement('style')
    chipCssEl.id = 'dpm-chip-ic'
    chipCssEl.textContent = CHIP_IC_IDS.map((id) => '[data-composer-chip="' + SOURCE + '"][data-dpm-ic="' + id + '"] > span { --dpm-ic: ' + iconMask(id) + '; }').join('\n')
    document.head.append(chipCssEl)
  }
  chipCssRefs++
}
function releaseChipCss(): void { chipCssRefs--; if (chipCssRefs <= 0 && chipCssEl) { chipCssEl.remove(); chipCssEl = null; chipCssRefs = 0 } }

export type Span = { start: number; end: number; draftRev: number }
export interface ComposerIA { captureInsertion(): Span; insertText(text: string, span: Span): boolean }
type Occ = { source: string; ref: string; offset: number; length: number; label: string; appearance?: string }
type InputState = { draft: string; draftRev: number; occurrences: Occ[]; phase: string }
export const SOURCE = 'dsh-project-manager'

/* ── 引用原文 → 胶囊（结构识别；v137 3(1)）──────────────────────────────── */
export interface RefHit { i: number; len: number; kind: 'note' | 'link' | 'file' | 'repo' | 'card' | 'sess'; title: string; body?: string; canon: string }
const RX: Array<{ kind: RefHit['kind']; rx: RegExp }> = [
  { kind: 'card', rx: /「“([^”「」]+)”（卡片组：“([^”「」]+)”）卡片」/g },
  { kind: 'sess', rx: /「“([^”「」]+)”会话(?:（[^「」]*）)?」/g },
  { kind: 'repo', rx: /「“([^”「」]+)”（路径：((?:\/|~\/)[^）「」]+)）」/g },
  { kind: 'link', rx: /「“([^”「」]+)”（(https?:\/\/[^）「」]+)）」/g },
  { kind: 'file', rx: /「“([^”「」]+)”（(?:已删除：)?((?:\/|~\/)[^）「」]+)）」/g },
]
/** 文字里第一个引用原文（说明按卡片里现有的原文匹配；其余按结构）。notes = 卡片说明的引用原文。 */
export function firstRef(txt: string, notes: Array<{ t: string; canon: string }>): RefHit | null {
  let best: RefHit | null = null
  for (const n of notes) { const i = txt.indexOf(n.canon); if (i >= 0 && (!best || i < best.i)) best = { i, len: n.canon.length, kind: 'note', title: n.t, canon: n.canon } }
  for (const { kind, rx } of RX) {
    rx.lastIndex = 0
    const m = rx.exec(txt)
    if (!m || (best && m.index >= best.i)) continue
    best = { i: m.index, len: m[0].length, kind, title: m[1], body: kind === 'card' ? m[2] : m[2], canon: m[0] }
  }
  return best
}

/** v142（4.1）：文字里全部引用原文（不重叠，按位置排）。 */
export function allRefs(txt: string, notes: Array<{ t: string; canon: string }>): RefHit[] {
  const out: RefHit[] = []
  let at = 0
  for (let g = 0; g < 200 && at < txt.length; g++) {
    const h = firstRef(txt.slice(at), notes)
    if (!h) break
    out.push({ ...h, i: h.i + at })
    at += h.i + h.len
  }
  return out
}

/* ── 链接 / 路径识别（v137 3(2) + v138 2(3) + v139 1(2)）─────────────────── */
export interface Mark { s: number; e: number; text: string; kind: 'link' | 'file' | 'dir'; quoted?: boolean }
const PAIRS: Array<[string, string]> = [["'", "'"], ['"', '"'], ['“', '”'], ['‘', '’'], ['\u0060', '\u0060']]
const HARD = /[\n\r\t"“”‘’\u0060「」<>]/
const segs = (p: string): number => p.replace(/\/+$/, '').split('/').filter(Boolean).length
/** 不带引号的路径：从起点取一整段，从长到短找存在的最长前缀，结尾必须落在词边界（原型 resolveAt 同一套）。 */
export function resolveAt(rest: string, kindOf: (p: string) => 'file' | 'dir' | null): { len: number; text: string; kind: 'file' | 'dir' } | null {
  let n = 0; while (n < rest.length && n < 400 && !HARD.test(rest[n])) n++
  const run = rest.slice(0, n)
  for (let j = n; j > 1; j--) {
    const c = run[j], last = run[j - 1]
    if (j < n) {
      if (c === '/' || /[A-Za-z0-9_\-]/.test(c)) continue
      if (c === '.' && j + 1 < n && /[A-Za-z0-9_\-]/.test(run[j + 1])) continue
      if (c === '\\') continue
    }
    if (/\s/.test(last) || last === '\\') continue
    if (last === '/' && j < n && !/[\s，。；、！？,.;:!?)）\]」』'"”’]/.test(c)) continue
    const p = run.slice(0, j).replace(/\\ /g, ' ')
    if (segs(p) < 2) return null
    const kd = kindOf(p); if (!kd) continue
    if (last === '/' && kd !== 'dir') continue
    return { len: j, text: p, kind: kd }
  }
  return null
}
/** 一段文字里所有候选（给 host 批量 stat 用）：引号整段 + 每个起点从长到短的前缀（最多 64 个）。 */
export function candidates(s0: string): string[] {
  const out = new Set<string>()
  for (const [o, c] of PAIRS) { let i = 0; while ((i = s0.indexOf(o, i)) >= 0) { const j = s0.indexOf(c, i + 1); if (j < 0) break; const inner = s0.slice(i + 1, j); if (/^(?:\/|~\/)/.test(inner) && !/\n/.test(inner) && segs(inner) >= 2) out.add(inner); i = j + 1 } }
  for (let i = 0; i < s0.length; i++) {
    const ch = s0[i]; if (ch !== '/' && !(ch === '~' && s0[i + 1] === '/')) continue
    if (/[A-Za-z0-9_.\-/~:]/.test(s0[i - 1] || ' ')) continue
    const rest = s0.slice(i); let n = 0; while (n < rest.length && n < 400 && !HARD.test(rest[n])) n++
    let k = 0
    for (let j = n; j > 1 && k < 64; j--) {
      const c = rest[j], last = rest[j - 1]
      if (j < n && (c === '/' || /[A-Za-z0-9_\-]/.test(c) || (c === '.' && j + 1 < n && /[A-Za-z0-9_\-]/.test(rest[j + 1])) || c === '\\')) continue
      if (/\s/.test(last) || last === '\\') continue
      const p = rest.slice(0, j).replace(/\\ /g, ' ')
      if (segs(p) < 2) break
      out.add(p); k++
    }
  }
  return [...out]
}
export function findMarks(s0: string, kindOf: (p: string) => 'file' | 'dir' | null): Mark[] {
  const out: Mark[] = []
  const taken = (a: number, b: number): boolean => out.some((x) => a < x.e && b > x.s)
  const URLX = /https?:\/\/[^\s<>"'“”‘’「」（）()，。；、\uFFFC]+/g
  let m: RegExpExecArray | null
  while ((m = URLX.exec(s0))) { const t = m[0].replace(/[.,!?;:。，！？；：]+$/, ''); out.push({ s: m.index, e: m.index + t.length, text: t, kind: 'link' }) }
  for (const [o, c] of PAIRS) {
    let i = 0
    while ((i = s0.indexOf(o, i)) >= 0) {
      const j = s0.indexOf(c, i + 1); if (j < 0) break
      const inner = s0.slice(i + 1, j)
      if (/^(?:\/|~\/)/.test(inner) && !/\n/.test(inner) && segs(inner) >= 2 && !taken(i + 1, j)) { const kd = kindOf(inner); if (kd) out.push({ s: i + 1, e: j, text: inner, kind: kd, quoted: true }) }
      i = j + 1
    }
  }
  for (let i = 0; i < s0.length; i++) {
    const ch = s0[i]; if (ch !== '/' && !(ch === '~' && s0[i + 1] === '/')) continue
    if (taken(i, i + 1)) continue
    if (/[A-Za-z0-9_.\-/~:]/.test(s0[i - 1] || ' ')) continue
    const hit = resolveAt(s0.slice(i), kindOf)
    if (!hit) continue
    out.push({ s: i, e: i + hit.len, text: hit.text, kind: hit.kind })
    i += hit.len - 1
  }
  return out.sort((x, y) => x.s - y.s)
}

/* ── 宿主编辑器 DOM ↔ detect 坐标（宿主：段落间 \n、<br> = \n、胶囊 = 1 个 U+FFFC）────────── */
interface Seg { node: Text | null; el: Element | null; start: number; len: number }
function layout(ed: HTMLElement): { text: string; segs: Seg[] } {
  let text = ''
  const out: Seg[] = []
  Array.from(ed.children).forEach((p, pi) => {
    if (pi) { text += '\n' }
    const walk = (n: Node): void => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 3) { out.push({ node: c as Text, el: null, start: text.length, len: (c.textContent ?? '').length }); text += c.textContent ?? '' }
        else if (c.nodeType === 1) {
          const el = c as HTMLElement
          if (el.hasAttribute('data-lexical-decorator')) { out.push({ node: null, el, start: text.length, len: 1 }); text += '\uFFFC' }
          else if (el.tagName === 'BR') { if (!(el.nextSibling === null && el.previousSibling === null) && !(el.nextSibling === null && pi === ed.children.length - 1 && false)) { if (el.nextSibling !== null || el.previousSibling !== null) text += '\n' } }
          else walk(el)
        }
      }
    }
    walk(p)
  })
  return { text, segs: out }
}
function rangeFor(ed: HTMLElement, a: number, b: number): Range | null {
  const { segs: S } = layout(ed)
  const r = document.createRange()
  let sa = false, sb = false
  for (const s of S) {
    if (!sa && a >= s.start && a <= s.start + s.len) { if (s.node) r.setStart(s.node, a - s.start); else if (s.el) { if (a === s.start) r.setStartBefore(s.el); else r.setStartAfter(s.el) } sa = true }
    if (sa && !sb && b >= s.start && b <= s.start + s.len) { if (s.node) r.setEnd(s.node, b - s.start); else if (s.el) { if (b === s.start) r.setEndBefore(s.el); else r.setEndAfter(s.el) } sb = true; break }
  }
  return sa && sb ? r : null
}
function offsetOf(ed: HTMLElement, node: Node, off: number): number {
  const { segs: S } = layout(ed)
  for (const s of S) {
    if (s.node && s.node === node) return s.start + off
    if (s.el && (s.el === node || s.el.contains(node))) return s.start + (off > 0 ? 1 : 0)
  }
  // 落在元素节点上：取它第 off 个孩子之前的第一个文字段
  if (node.nodeType === 1) {
    const kid = (node as Element).childNodes[off] ?? null
    if (kid) { for (const s of S) { const n = s.node ?? s.el; if (n && (n === kid || kid.contains(n))) return s.start } }
    let last = -1
    for (const s of S) { const n = s.node ?? s.el; if (n && node.contains(n)) last = s.start + s.len }
    if (last >= 0) return last
  }
  return -1
}

/* ── 卡片条目 ───────────────────────────────────────────────────────────── */
type CI = NonNullable<SessionInfo['cardInfo']>
const normP = (p: string, home: string): string => p.replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, '$1')
const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p

export interface ComposerHost {
  sid: string
  info(): SessionInfo | null
  actions(): ComposerIA | undefined
  useInput?: <T>(sel: (s: InputState | undefined) => T) => T
  scope(): { bail?: (...a: unknown[]) => unknown } | undefined
  toast(m: string, k?: 'ok' | 'err'): void
  home: string
  /** 添加到卡片（弹窗预填）；保存成功 resolve 新条目，取消 resolve null。 */
  add(kind: 'link' | 'file' | 'repo' | 'note', prefill: string): Promise<{ text?: string; url?: string; name?: string; path?: string; t?: string; v?: string } | null>
  openChip(kind: string, ref: string, title: string, body: string): void
  editor(): HTMLElement | null
}

const IC: Record<string, string> = {
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5L12.5 16.5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>',
  dir: '<svg viewBox="0 0 24 24"><path d="M5 5.5h6v13H5zM13 5.5h6v13h-6z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 4.5h14v15H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>',
  use: '<svg viewBox="0 0 24 24"><path d="M9.6 6.2C7 7.6 5.6 9.7 5.6 12.6c0 2.2 1.3 3.7 3.2 3.7 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.9.2-1.1 1.1-2.1 2.5-2.9zM18.4 6.2c-2.6 1.4-4 3.5-4 6.4 0 2.2 1.3 3.7 3.2 3.7 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.9.2-1.1 1.1-2.1 2.5-2.9z" fill="currentColor" stroke="none"/></svg>',
}
const LAB: Record<string, string> = { link: '添加为相关链接', file: '添加为相关文件', dir: '添加为仓库', note: '添加为相关说明' }
const HAVE: Record<string, string> = { link: '已是相关链接', file: '已是相关文件', dir: '已是仓库' }
const OPEN_HINT: Record<string, string> = { link: '⌘ 点击 = 浏览器打开', file: '⌘ 点击 = 默认应用打开', dir: '⌘ 点击 = 访达打开' }
const APPEAR: Record<string, string> = { note: 'dpm-note', link: 'dpm-link', file: 'file', repo: 'folder', card: 'dpm-card', sess: 'session' }

/** 每个会话一份（挂在 dock 上，卸载即净）。 */
export class ComposerAssist {
  private dead = false
  private marks: Array<Mark & { r: Range }> = []
  private hov: (Mark & { r: Range }) | null = null
  private bub: HTMLButtonElement | null = null
  private bubFor: (Mark & { r: Range }) | 'sel' | null = null
  private anchor: { left: number; right: number; top: number; bottom: number } | null = null
  private hideT = 0
  private down = false
  private selTxt = ''
  private stat = new Map<string, { k: 'file' | 'dir' | null; at: number }>()
  private statT = 0
  private raf = 0
  /** 选区检查单独一个 rAF：和 scan 共用一个时，打字时 selectionchange 先占位，最后一次 scan 被吞，虚线停在半截 */
  private selRaf = 0
  private chipBusy = false
  private lastDraft = ''
  private off: Array<() => void> = []
  private hlName = 'dpm-u-' + Math.random().toString(36).slice(2, 8)
  private hlHot = this.hlName + '-h'
  private styleEl: HTMLStyleElement | null = null
  constructor(private readonly h: ComposerHost) {
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, o?: AddEventListenerOptions | boolean): void => { document.addEventListener(t, f as EventListener, o); this.off.push(() => document.removeEventListener(t, f as EventListener, o)) }
    on('pointermove', (e) => this.onMove(e), { passive: true })
    on('selectionchange', () => { if (this.selRaf) return; this.selRaf = requestAnimationFrame(() => { this.selRaf = 0; this.selCheck() }) })
    on('pointerdown', (e) => { const ed = this.h.editor(); if (ed && ed.contains(e.target as Node) && e.button === 0) { this.down = true; if (this.bubFor) this.bubHide() } }, true)
    on('pointerup', () => { if (!this.down) return; this.down = false; setTimeout(() => this.selCheck(), 0) }, true)
    on('mousedown', (e) => { if (!e.metaKey) return; const hit = this.markAt(e.clientX, e.clientY); if (hit) { e.preventDefault(); e.stopPropagation() } }, true)
    on('click', (e) => { if (!e.metaKey) return; const hit = this.markAt(e.clientX, e.clientY); if (!hit) return; e.preventDefault(); e.stopPropagation(); this.bubHide(); void this.openMark(hit.m) }, true)
    on('keydown', (e) => { if (e.key === 'Meta' && this.hov) this.h.editor()?.classList.add('dpm-cmd') })
    on('keyup', (e) => { if (e.key === 'Meta') this.h.editor()?.classList.remove('dpm-cmd'); if (this.bubFor === 'sel') this.selCheck() })
    on('input', () => { if (this.bubFor === 'sel') requestAnimationFrame(() => this.selCheck()) }, true)
    on('cut', () => { if (this.bubFor === 'sel') setTimeout(() => this.selCheck(), 0) }, true)
    on('scroll', () => this.bubHide(), true)
    const onR = (): void => this.bubHide(); window.addEventListener('resize', onR); this.off.push(() => window.removeEventListener('resize', onR))
    /* v142（4.2）：宿主胶囊的内层（带 title 的标签）是 Lexical 装饰器异步画的 —— 状态回调那一刻常常还是空壳，打不上三态；
       编辑器子树一变就下一帧重新打标（自己打的属性不触发：只听 childList / characterData） */
    let moRaf = 0, moEd: HTMLElement | null = null
    const mo = new MutationObserver(() => { if (!moRaf) moRaf = requestAnimationFrame(() => { moRaf = 0; this.classify() }) })
    const watch = (): void => { const ed = this.h.editor(); if (ed && ed !== moEd) { mo.disconnect(); moEd = ed; mo.observe(ed, { childList: true, subtree: true, characterData: true }) } }
    const wt = window.setInterval(watch, 1000); watch()
    this.off.push(() => { clearInterval(wt); mo.disconnect(); if (moRaf) cancelAnimationFrame(moRaf) })
    this.styleEl = document.createElement('style')
    this.styleEl.textContent = '::highlight(' + this.hlName + ') { text-decoration-line: underline; text-decoration-style: dashed; text-decoration-color: #1e40af; text-decoration-thickness: 1.5px; text-underline-offset: 4px; }'
      + '::highlight(' + this.hlHot + ') { background-color: rgba(30, 64, 175, .1); text-decoration-line: underline; text-decoration-style: dashed; text-decoration-color: #1e3a8a; text-decoration-thickness: 2px; text-underline-offset: 4px; }'
      + 'body[data-ds-dark-theme] ::highlight(' + this.hlName + '), html[data-theme="dark"] ::highlight(' + this.hlName + ') { text-decoration-color: #7ea6ff; } body[data-ds-dark-theme] ::highlight(' + this.hlHot + '), html[data-theme="dark"] ::highlight(' + this.hlHot + ') { background-color: rgba(126, 166, 255, .16); text-decoration-color: #a9c2ff; }'
    document.head.append(this.styleEl)
    ensureChipCss()
    if (!(window.CSS && 'highlights' in CSS)) console.warn('[dsh-project-manager] 这个浏览器没有 CSS Custom Highlight，会话输入框里的链接 / 路径不画虚线（气泡照常）')
  }
  dispose(): void {
    this.dead = true
    for (const f of this.off) f()
    this.off = []
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.selRaf); clearTimeout(this.statT); clearTimeout(this.hideT)
    this.bub?.remove(); this.bub = null
    try { (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(this.hlName); (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(this.hlHot) } catch { /* ignore */ }
    this.styleEl?.remove()
    releaseChipCss()
  }
  private ci(): CI | null { return this.h.info()?.cardInfo ?? null }
  infoNow(): SessionInfo | null { return this.h.info() }
  /** 这个会话的输入框正显示着（「引」插到可见的那个）。 */
  visible(): boolean { const ed = this.h.editor(); if (!ed || !ed.isConnected) return false; const r = ed.getBoundingClientRect(); return r.width > 40 && r.height > 8 }
  private hasCard(): boolean { return !!this.h.info()?.card && !!this.ci() }

  /* ── 输入变化：先把引用原文转成胶囊，再识别链接 / 路径 ── */
  tick(st: InputState | undefined): void {
    if (this.dead || !st) return
    if (st.draft === this.lastDraft && !this.dirty) return
    this.lastDraft = st.draft; this.dirty = false
    if (!this.chipBusy) this.chipify(st)
    this.scanSoon()
    /* v145（3）：⌘A 全选后删除时宿主 Lexical 不派发 selectionchange → 气泡留着；宿主 draft 一变就重查选区 */
    if (this.bubFor === 'sel') requestAnimationFrame(() => this.selCheck())
  }
  private dirty = false
  /** 卡片资料变了（新加了链接 / 文件 / 仓库 / 说明）：重新判断「已是 / 使用引用内容」与说明原文。 */
  refresh(): void { this.dirty = true; this.scanSoon(); requestAnimationFrame(() => this.classify()) }
  private noteCanons(): Array<{ t: string; canon: string }> { return (this.ci()?.notes ?? []).map((n) => ({ t: n.t, canon: noteText(n.t, n.v) })) }
  /**
   * 引用原文（v137 3(1) 结构识别）→ 宿主胶囊。v142（4.1）根因：以前一次只换一个 —— 宿主在替换的同一调用里同步发出新状态，
   * 那一刻正忙、这次变化被跳过且 lastDraft 已更新 → 剩下的引用要等再按一个键才换；宿主还把光标放到刚插的胶囊后面，接着打的字落进中间。
   * 改：一次把全部引用换成胶囊（从后往前换，前面的坐标不受影响；每换一个重新取 draftRev），换完把光标放回原来的位置（离末尾的距离不变）。
   */
  private chipify(_st: InputState): void {
    const ed = this.h.editor(), ia = this.h.actions(), actx = this.h.scope()
    if (!ed || !ia || !actx?.bail) return
    const { text } = layout(ed)
    let hits = allRefs(text, this.noteCanons())
    if (!hits.length) return
    const cs = ia.captureInsertion()
    /* 手打到引用原文最后一个字、光标就在它后面：最后一个先不换（宿主换胶囊时尾巴没空格会自动补一个，打字时就会多出一个空格、原文变了） */
    const last = hits[hits.length - 1]
    if (last.i + last.len === text.length && cs.start === cs.end && cs.start === text.length) hits = hits.slice(0, -1)
    if (!hits.length) return
    const tail = text.length - cs.end
    this.chipBusy = true
    let n = 0
    try {
      for (let k = hits.length - 1; k >= 0; k--) {
        const h = hits[k]
        const rev = ia.captureInsertion().draftRev
        const ok = actx.bail(actx, 'slash/input-insert-reference', { reference: this.refOf(h), span: { start: h.i, end: h.i + h.len, draftRev: rev } }) === true
        if (!ok) { if (!this.warned) { this.warned = true; console.warn('[dsh-project-manager] 会话输入框没接受引用胶囊（宿主 slash/input-insert-reference 返回 false），这段保持文字') } break }
        n++
      }
      if (n) {
        const t2 = layout(ed).text, at = Math.max(0, t2.length - tail), c2 = ia.captureInsertion()
        ia.insertText('', { start: at, end: at, draftRev: c2.draftRev })
      }
    } finally { this.chipBusy = false }
    this.lastDraft = layout(ed).text
    ;(window as unknown as Record<string, unknown>).__dpmChipified = { n, at: Date.now() }
    if (n) requestAnimationFrame(() => this.classify())
  }
  /**
   * v142（4.2）：文件引用胶囊三种状态 —— 已在卡片（原样）/ 本机有但还没加入卡片（青绿 +「未加入」，点 = 添加为相关文件）/
   * 原位置已不在（灰虚线 + 划线 +「已不在」，点 = 本机同名文件的新位置）。只给宿主胶囊节点打属性，Lexical 重画后 MutationObserver 补。
   */
  private fileSt = new Map<string, 'card' | 'ext' | 'gone'>()
  classify(): void {
    const ed = this.h.editor(); if (!ed || this.dead) return
    const ci = this.ci()
    const need: string[] = []
    for (const el of Array.from(ed.querySelectorAll<HTMLElement>('[data-composer-chip="' + SOURCE + '"]'))) {
      const ref = this.chipRaw(el)
      /* v153：这颗胶囊的引用类型 + 类型图标（和任务说明 / 详情气泡同一套字形；对话框里用 mask 画） */
      const k = refKind(ref)
      if (el.getAttribute('data-dpm-kind') !== k) el.setAttribute('data-dpm-kind', k)
      const icId = chipIconId(k, refFilePath(ref))
      if (el.getAttribute('data-dpm-ic') !== icId) el.setAttribute('data-dpm-ic', icId)
      /* v141（5）：星标链接的引用胶囊 = 金色 */
      const lk = /^「“([^”「」]+)”（(https?:\/\/[^）「」]+)）」$/.exec(ref)
      const gold = !!(lk && ci && ci.links.some((l) => l.star && l.url === lk[2]))
      if (gold !== el.hasAttribute('data-dpm-gold')) { if (gold) el.setAttribute('data-dpm-gold', ''); else el.removeAttribute('data-dpm-gold') }
      const m = /^「“([^”「」]+)”（(?:已删除：)?((?:\/|~\/)[^）「」]+)）」$/.exec(ref)
      if (!m) { el.removeAttribute('data-dpm-fst'); continue }
      el.setAttribute('data-dpm-k', 'file')
      const p = m[2], n = normP(p, this.h.home)
      let st: 'card' | 'ext' | 'gone' | undefined
      /* v151（1.2）根因：卡片文件被「放到落盘项目」/ 迁移 / 改用新位置挪走后，卡片里记的是新路径，会话里写的还是旧路径 →
         只按路径比对就对不上、再去查旧路径 → 「已不在」。改：当前路径 → 以前的路径（prev）→ 卡片里唯一同名文件 → 才查磁盘；
         命中后两种 = 按「已在卡片」显示 + 小标「已挪」，并把胶囊（= 发给 Agent 的引用原文）换成现在的路径。 */
      const hit = ci ? this.fileOf(ci.files, n) : null
      if (hit && hit.f.exists !== false) {
        st = 'card'
        if (hit.via && !this.moving.has(ref)) {
          this.moving.add(ref)
          const title = m[1], np = hit.f.path
          requestAnimationFrame(() => {
            const ok = this.repath(ref, title, np)
            this.moving.delete(ref)
            if (!ok) return
            this.movedTo.set(np, p)
            ;(window as unknown as Record<string, unknown>).__dpmMoved = { from: p, to: np, at: Date.now() }
            /* v154（1.5）：「已挪」只是「认出来了、正在换路径」的短暂提示 —— 2.5 秒后胶囊就是普通的新路径胶囊
               （长期挂着会被读成「还没修好」）。悬停说明保留到本页会话结束。 */
            setTimeout(() => { if (this.movedTo.get(np) === p) { this.movedTo.delete(np); this.classify() } }, 2500)
          })
        }
      }
      else { const c = this.stat.get(p); if (c && Date.now() - c.at <= 30_000) st = c.k === 'file' ? 'ext' : 'gone'; else { need.push(p); continue } }
      this.fileSt.set(p, st)
      if (el.getAttribute('data-dpm-fst') !== st) el.setAttribute('data-dpm-fst', st)
      el.setAttribute('data-dpm-path', p)
      const was = this.movedTo.get(p)
      if (was) { if (!el.hasAttribute('data-dpm-moved')) el.setAttribute('data-dpm-moved', was) } else el.removeAttribute('data-dpm-moved')
      if (was && st === 'card') { el.setAttribute('title', '相关文件 · 已从 ' + was + ' 挪到 ' + p + '（发给 Agent 的引用原文已换成现在的路径）· 点一下用默认应用打开'); continue }
      el.setAttribute('title', st === 'ext' ? '本机有这个文件，还没加入卡片 · 点一下添加为相关文件（' + p + '）' : st === 'gone' ? '这个路径上已经没有这个文件（被移走 / 删除）· 点一下看本机同名文件的新位置（' + p + '）' : '相关文件 · 点一下用默认应用打开（' + p + '）')
    }
    if (need.length) void post<{ ok: boolean; kinds: Record<string, 'file' | 'dir'> }>('paths/stat', { paths: need.slice(0, 400) }).then((r) => { const t = Date.now(); for (const p of need) this.stat.set(p, { k: r.kinds[p] ?? null, at: t }); this.classify() }).catch((e) => console.warn('[dsh-project-manager] 文件胶囊状态查询失败（paths/stat）：', e))
  }
  fileState(path: string): 'card' | 'ext' | 'gone' | undefined { return this.fileSt.get(path) }
  /** 正在把旧路径胶囊换成新路径（防重入）；换过的：新路径 → 旧路径（画「已挪」+ 悬停说明）。 */
  private moving = new Set<string>()
  private movedTo = new Map<string, string>()
  /** v151（1.2）：卡片里对应的文件：当前路径 → 以前的路径 → 唯一同名 → 归一同名。via = '' 当前 / 'prev' / 'name'。 */
  private fileOf(files: Array<{ path: string; exists: boolean; prev?: string[] }>, n: string): { f: { path: string; exists: boolean }; via: '' | 'prev' | 'name' } | null {
    const H = this.h.home
    const a = files.find((f) => normP(f.path, H) === n); if (a) return { f: a, via: '' }
    const b = files.find((f) => (f.prev ?? []).some((q) => normP(q, H) === n)); if (b) return { f: b, via: 'prev' }
    const nm = base(n), same = files.filter((f) => base(f.path) === nm)
    if (same.length === 1) return { f: same[0], via: 'name' }
    /* v154（1.4）：名字只差空格 / 连字符（搬家把空格净化成 -）也算同一个文件；精确同名不唯一时才走这条 */
    const key = refNameKey(n), near = files.filter((f) => refNameKey(f.path) === key)
    return near.length === 1 ? { f: near[0], via: 'name' } : null
  }
  /** 「已不在」改用新位置：胶囊换成新路径的引用原文（发出去的原文跟着变）。 */
  repath(oldCanon: string, title: string, np: string): boolean {
    const ed = this.h.editor(), ia = this.h.actions(), actx = this.h.scope()
    if (!ed || !ia || !actx?.bail) return false
    /* 宿主胶囊在编辑器坐标里只占 1 个字（U+FFFC）：按 DOM 找到这个胶囊的位置，替换这 1 个字 */
    const { segs } = layout(ed)
    const seg = segs.find((x) => x.el && x.el.matches('[data-composer-chip="' + SOURCE + '"]') && this.chipRaw(x.el) === oldCanon)
    if (!seg) return false
    const canon = '「“' + title + '”（' + np + '）」'
    return actx.bail(actx, 'slash/input-insert-reference', { reference: this.refOf({ kind: 'file', title, canon }), span: { start: seg.start, end: seg.start + 1, draftRev: ia.captureInsertion().draftRev } }) === true
  }
  private occ: Array<{ source: string; ref: string; offset: number; length: number; label: string }> = []
  private warned = false
  private refOf(hit: { kind: RefHit['kind']; title: string; canon: string }): Record<string, string> {
    return { source: SOURCE, ref: hit.canon, label: hit.kind === 'sess' ? hit.title : hit.title, appearance: APPEAR[hit.kind], clipboardText: hit.canon }
  }
  /** 「引」/ 引用菜单插入：直接在光标处（或给定 span）插胶囊（不先插文字）；不是引用原文 = 当文字插。 */
  insertRef(canon: string, at?: Span): boolean {
    const ia = this.h.actions(), actx = this.h.scope()
    if (!ia || !actx?.bail) return false
    const hit = firstRef(canon, this.noteCanons())
    const sp = at ?? ia.captureInsertion()
    if (!hit || hit.i !== 0 || hit.len !== canon.length) return ia.insertText(canon, sp)
    return actx.bail(actx, 'slash/input-insert-reference', { reference: this.refOf(hit), span: sp }) === true
  }

  /* ── 链接 / 路径识别（::highlight 画虚线，不改 DOM）── */
  private scanSoon(): void { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.scan() }) }
  private kindOf = (p: string): 'file' | 'dir' | null => {
    const n = normP(p, this.h.home)
    const ci = this.ci()
    if (ci) { if (ci.files.some((f) => normP(f.path, this.h.home) === n && f.exists !== false)) return 'file'; if (ci.repos.some((r) => normP(r.path, this.h.home) === n)) return 'dir' }
    const c = this.stat.get(p)
    return c ? c.k : null
  }
  private scan(): void {
    const ed = this.h.editor()
    if (!ed || this.dead) return
    if (!this.hasCard()) { this.marks = []; this.paint(); return }
    const { text } = layout(ed)
    /* host 批量 stat：没查过 / 过期（30 秒）的候选去抖 200ms 一次发 */
    const now = Date.now()
    const need = candidates(text).filter((p) => { const c = this.stat.get(p); return !c || now - c.at > 30_000 })
    if (need.length) {
      clearTimeout(this.statT)
      this.statT = window.setTimeout(() => {
        void post<{ ok: boolean; kinds: Record<string, 'file' | 'dir'> }>('paths/stat', { paths: need.slice(0, 400) }).then((r) => {
          const t = Date.now()
          for (const p of need) this.stat.set(p, { k: r.kinds[p] ?? null, at: t })
          if (this.stat.size > 4000) for (const k of [...this.stat.keys()].slice(0, 1000)) this.stat.delete(k)
          this.scan()
        }).catch((e) => console.warn('[dsh-project-manager] 路径识别查询失败（paths/stat）：', e))
      }, 200)
    }
    const ms = findMarks(text, this.kindOf)
    this.marks = ms.map((m) => { const r = rangeFor(ed, m.s, m.e); return r ? { ...m, r } : null }).filter((x): x is Mark & { r: Range } => !!x)
    if (this.hov) this.hov = this.marks.find((x) => x.text === this.hov!.text && x.s === this.hov!.s) ?? null
    if (this.bubFor && this.bubFor !== 'sel' && !this.marks.some((x) => x.text === (this.bubFor as Mark).text)) this.bubHide()
    this.paint()
  }
  private paint(): void {
    const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!HL || !reg) return
    reg.set(this.hlName, new HL(...this.marks.filter((x) => x !== this.hov).map((x) => x.r)))
    reg.set(this.hlHot, new HL(...(this.hov && this.marks.includes(this.hov) ? [this.hov.r] : [])))
  }
  /** 测试 / 验收探针：当前识别结果。 */
  probe(): { marks: Array<{ text: string; kind: string; known: boolean }>; bub: { text: string; kind: string; use: boolean; rect: DOMRect } | null; draft: string } {
    return { draft: this.lastDraft, marks: this.marks.map((m) => ({ text: m.text, kind: m.kind, known: this.known(m) })), bub: this.bub && !this.bub.hidden ? { text: this.bub.textContent ?? '', kind: this.bub.dataset.kind ?? '', use: this.bub.dataset.use === '1', rect: this.bub.getBoundingClientRect() } : null }
  }
  private known(m: Mark): boolean {
    const ci = this.ci(); if (!ci) return false
    if (m.kind === 'link') return ci.links.some((l) => l.url === m.text)
    const n = normP(m.text, this.h.home)
    if (m.kind === 'file') return ci.files.some((f) => normP(f.path, this.h.home) === n)
    return ci.repos.some((r) => normP(r.path, this.h.home) === n)
  }
  /** 已在卡片里的 → 对应条目的引用原文（v138 2(7)「使用引用内容」）。 */
  private quoteFor(m: Mark): string {
    const ci = this.ci(); if (!ci) return ''
    if (m.kind === 'link') { const l = ci.links.find((x) => x.url === m.text); return l ? linkText(l) : '' }
    const n = normP(m.text, this.h.home)
    if (m.kind === 'file') { const f = ci.files.find((x) => normP(x.path, this.h.home) === n); return f ? fileText({ path: f.path, title: f.title || base(f.path), exists: f.exists !== false }) : '' }
    const r = ci.repos.find((x) => normP(x.path, this.h.home) === n); return r ? repoText(r.name, r.path) : ''
  }

  /* ── 气泡（v137 安全区 + v138 不挡选区 / ⌘ 提示 / 使用引用内容 + v139 添加后变胶囊）── */
  private ensureBub(): HTMLButtonElement {
    if (this.bub) return this.bub
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'dpm-cbub'; b.hidden = true
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('click', () => { void this.bubClick() })
    document.body.append(b)
    this.bub = b
    return b
  }
  private bubShow(kind: string, rect: { left: number; width: number; top: number; bottom: number; preferUp?: boolean }, target: (Mark & { r: Range }) | 'sel', done: boolean): void {
    const b = this.ensureBub()
    clearTimeout(this.hideT); this.hideT = 0
    const use = done && kind !== 'note'
    b.classList.toggle('use', use)
    const lab = use ? '使用引用内容' : LAB[kind]
    b.innerHTML = (use ? IC.use : IC[kind]) + '<span>' + lab + '</span>' + (kind === 'note' ? '<small>' + Math.min(999, this.selTxt.length) + ' 字</small>' : '<small class="cmdh">' + OPEN_HINT[kind] + '</small>')
    b.dataset.kind = kind; b.dataset.use = use ? '1' : ''
    b.setAttribute('aria-label', lab + (use ? '（' + HAVE[kind] + '）' : '') + (target !== 'sel' ? '：' + target.text : ''))
    this.bubFor = target
    b.hidden = false
    const bw = b.offsetWidth, bh = b.offsetHeight, cx = rect.left + rect.width / 2
    const x = Math.max(8, Math.min(innerWidth - bw - 8, cx - bw / 2))
    const up = rect.bottom + 6 + bh > innerHeight - 6 || !!rect.preferUp
    const y = up ? rect.top - 6 - bh : rect.bottom + 6
    b.style.left = Math.round(x) + 'px'; b.style.top = Math.round(y) + 'px'
    b.style.setProperty('--ax', Math.round(cx - x - 4) + 'px'); b.classList.toggle('up', up)
    this.anchor = { left: rect.left, right: rect.left + rect.width, top: rect.top, bottom: rect.bottom }
  }
  private bubHide(): void { clearTimeout(this.hideT); this.hideT = 0; if (this.bub) this.bub.hidden = true; this.bubFor = null; this.anchor = null; if (this.hov) { this.hov = null; this.paint() } }
  private inZone(x: number, y: number): boolean {
    const b = this.bub, a = this.anchor
    if (!b || b.hidden || !a) return false
    const br = b.getBoundingClientRect()
    const pad = (r: { left: number; right: number; top: number; bottom: number }, p: number) => ({ left: r.left - p, right: r.right + p, top: r.top - p, bottom: r.bottom + p })
    const inR = (r: { left: number; right: number; top: number; bottom: number }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    if (inR(pad(a, 4)) || inR(pad(br, 10))) return true
    const up = b.classList.contains('up')
    return inR({ left: Math.min(a.left, br.left) - 10, right: Math.max(a.right, br.right) + 10, top: up ? br.bottom - 2 : a.top, bottom: up ? a.bottom : br.top + 2 })
  }
  private markAt(x: number, y: number): { m: Mark & { r: Range }; r: DOMRect } | null {
    for (const m of this.marks) for (const r of Array.from(m.r.getClientRects())) if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return { m, r }
    return null
  }
  private selRange(): Range | null {
    const ed = this.h.editor(), g = getSelection()
    if (!ed || !g || !g.rangeCount || g.isCollapsed) return null
    const r = g.getRangeAt(0)
    return ed.contains(r.commonAncestorContainer) ? r : null
  }
  private onMove(e: PointerEvent): void {
    if (this.dead || this.bubFor === 'sel' || this.selRange()) return
    if (e.buttons) { if (this.bubFor) this.bubHide(); return }
    if (this.bubFor && this.bub && !this.bub.hidden && this.inZone(e.clientX, e.clientY)) { clearTimeout(this.hideT); this.hideT = 0; return }
    const hit = this.markAt(e.clientX, e.clientY)
    this.h.editor()?.classList.toggle('dpm-cmd', !!(hit && e.metaKey))
    if (hit) {
      clearTimeout(this.hideT); this.hideT = 0
      if (this.bubFor && this.bubFor.text === hit.m.text && this.bub && !this.bub.hidden) return
      this.hov = hit.m; this.paint()
      this.bubShow(hit.m.kind, { left: hit.r.left, width: hit.r.width, top: hit.r.top, bottom: hit.r.bottom }, hit.m, this.known(hit.m))
      return
    }
    if (this.bubFor) { if (this.inZone(e.clientX, e.clientY)) { clearTimeout(this.hideT); this.hideT = 0; return } if (!this.hideT) this.hideT = window.setTimeout(() => this.bubHide(), 350) }
  }
  /** 选区原文（胶囊 = 引用原文）。 */
  private selRaw(r: Range): string {
    const ed = this.h.editor() as HTMLElement
    const a = offsetOf(ed, r.startContainer, r.startOffset), b = offsetOf(ed, r.endContainer, r.endOffset)
    return this.rawBetween(a, b)
  }
  private rawBetween(a: number, b: number): string {
    const ed = this.h.editor(); if (!ed || a < 0 || b <= a) return ''
    const { segs: S, text } = layout(ed)
    let out = '', k = a
    const st = this.h.useInput ? null : null; void st
    const chips = S.filter((s) => s.el).map((s) => ({ at: s.start, raw: this.chipRaw(s.el as Element) }))
    while (k < b) { const c = text[k]; if (c === '\uFFFC') { out += chips.find((x) => x.at === k)?.raw ?? ''; } else out += c; k++ }
    return out
  }
  private chipRaw(el: Element): string { const t = el.querySelector('[title]')?.getAttribute('title') ?? ''; return this.chipCanon.get(t) ?? el.textContent ?? '' }
  /** 胶囊 DOM 上只有标签；原文从宿主 occurrences 取（label → ref）。 */
  private chipCanon = new Map<string, string>()
  setOccurrences(occ: Occ[]): void { this.chipCanon.clear(); for (const o of occ) this.chipCanon.set(o.label, o.ref); this.occ = occ.filter((o) => o.source === SOURCE); requestAnimationFrame(() => this.classify()) }
  private selCheck(): void {
    if (this.dead) return
    const r = this.selRange()
    if (!r) { if (this.bubFor === 'sel') this.bubHide(); return }
    if (!this.hasCard() || this.down) return
    const t = this.selRaw(r).trim()
    if (!t) { if (this.bubFor === 'sel') this.bubHide(); return }
    this.selTxt = t
    /* v138（2.6）：框选内容就是卡片某条说明的内容或引用原文 → 不出气泡 */
    const sq = t.replace(/\s+/g, ' ')
    if ((this.ci()?.notes ?? []).some((n) => { const v = String(n.v || '').trim().replace(/\s+/g, ' '); return !!v && (v === sq || noteText(n.t, n.v).replace(/\s+/g, ' ') === sq) })) { if (this.bubFor) this.bubHide(); return }
    const ed = this.h.editor() as HTMLElement, sr = ed.getBoundingClientRect()
    const vis = Array.from(r.getClientRects()).filter((x) => x.width > 0 && x.bottom > sr.top && x.top < sr.bottom)
    if (!vis.length) return
    const top = Math.max(sr.top, Math.min(...vis.map((x) => x.top))), bot = Math.min(sr.bottom, Math.max(...vis.map((x) => x.bottom)))
    const lastRow = vis.filter((x) => x.bottom >= bot - 2)
    const lft = Math.max(sr.left, Math.min(...lastRow.map((x) => x.left))), rgt = Math.min(sr.right, Math.max(...lastRow.map((x) => x.right)))
    this.hov = null; this.paint()
    /* v138（2.5）：按整段选区外框放 —— 下面放得下放最下一行下面，否则放最上一行上面 */
    this.bubShow('note', { left: lft, width: rgt - lft, top, bottom: bot }, 'sel', false)
  }
  private async openMark(m: Mark): Promise<void> {
    if (m.kind === 'link') { window.open(m.text, '_blank', 'noopener'); this.h.toast('已用默认浏览器打开：' + m.text); return }
    try { const r = await openFileSmart({ local: m.text }); this.h.toast(openedHow(r) + '「' + base(m.text) + '」') }
    catch (e) { this.h.toast('打不开：' + (e instanceof Error ? e.message : String(e)), 'err') }
  }
  private async bubClick(): Promise<void> {
    const b = this.bub; if (!b) return
    const k = b.dataset.kind as string, f = this.bubFor, use = b.dataset.use === '1'
    /* v139（1.1）：点气泡那一刻记下这段的 detect 区间和原文；保存回来核对还在才原位替换 */
    const ed = this.h.editor(), ia = this.h.actions()
    let a = -1, z = -1, raw = ''
    if (ed && f === 'sel') { const r = this.selRange(); if (r) { a = offsetOf(ed, r.startContainer, r.startOffset); z = offsetOf(ed, r.endContainer, r.endOffset); raw = this.selTxt } }
    else if (ed && f && f !== 'sel') { a = f.s; z = f.e; raw = f.text }
    const fromText = ed ? layout(ed).text.slice(a, z) : ''
    this.bubHide()
    if (!f || !ia) return
    if (use && typeof f !== 'string') { const q = this.quoteFor(f); if (q) this.replaceWith(a, z, fromText, q, '已换成引用内容（输入框里显示成胶囊，发送时是原文）'); return }
    const kind = k === 'dir' ? 'repo' : (k as 'link' | 'file' | 'note')
    const got = await this.h.add(kind, typeof f === 'string' ? raw : f.text)
    if (!got || this.dead) return
    const q = kind === 'link' ? linkText({ text: got.text ?? '', url: got.url ?? '' }) : kind === 'file' ? fileText({ path: got.path ?? '', title: got.name, exists: true }) : kind === 'repo' ? repoText(got.name ?? '', got.path ?? '') : noteText(got.t ?? '', got.v ?? '')
    const title = kind === 'link' ? got.text ?? '' : kind === 'note' ? got.t ?? '' : got.name ?? ''
    this.replaceWith(a, z, fromText, q, '已添加，并把输入框里那段换成了引用胶囊（发送时是这段原文）', { kind, title })
  }
  /** 把 detect 区间 [a, z)（当时的文字 = was）换成引用胶囊；文字已经改过 = 不替换，提示一句。 */
  private replaceWith(a: number, z: number, was: string, canon: string, okMsg: string, known?: { kind: RefHit['kind']; title: string }): void {
    const ed = this.h.editor(), ia = this.h.actions(), actx = this.h.scope()
    if (!ed || !ia || !actx?.bail || a < 0 || z <= a) return
    if (layout(ed).text.slice(a, z) !== was) { this.h.toast('已添加到卡片；输入框里那段已经改过了，没有替换成胶囊'); return }
    const rev = ia.captureInsertion().draftRev
    /* 刚加的条目卡片资料可能还没刷新：种类 / 名字以添加结果为准 */
    const hit = known ? { i: 0, len: canon.length, kind: known.kind, title: known.title, canon } : (firstRef(canon, this.noteCanons()) ?? { i: 0, len: canon.length, kind: 'note' as const, title: canon.slice(1, 21), canon })
    const ok = actx.bail(actx, 'slash/input-insert-reference', { reference: this.refOf(hit), span: { start: a, end: z, draftRev: rev } }) === true
    if (ok) this.h.toast(okMsg)
    else { this.h.toast('已添加到卡片；输入框没接受替换（内容刚刚变了），这段保持文字', 'err'); console.warn('[dsh-project-manager] 添加后替换成胶囊失败：slash/input-insert-reference 返回 false') }
    this.scanSoon()
  }
  /** 宿主胶囊被点：按种类打开 / 跳转。 */
  static kindOfRef(ref: string, notes: Array<{ t: string; canon: string }>): RefHit | null { const h = firstRef(ref, notes); return h && h.i === 0 && h.len === ref.length ? h : null }
}
export { esc, cardText }
