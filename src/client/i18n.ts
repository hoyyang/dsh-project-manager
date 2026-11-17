/**
 * v182：界面语言引擎（client 侧唯一出处）。
 *
 * 模型（与原型 prototype/dsh-web-v182.html 逐项一致）：
 *   mode = auto | zh | en（auto = 跟随 DSH）；生效语言 eff = mode === 'auto' ? DSH 语言 : mode。
 *   DSH 语言读 <html lang>（官方 locale 服务负责同步它），所以插件不依赖 locale 命名空间类型表，
 *   旧宿主 / 没有 locale 服务时也能工作。
 *
 * 翻译方式 = **只改文本节点与 placeholder / title / aria-label**，不重建 DOM（重建会丢焦点 / 滚动 / 展开态）：
 *   词典（host 路由 GET /i18n 投递，4,454 条，localStorage 按 v 缓存）命中整句；
 *   拼出来的句子走 RULES（86 条模板，变量抠出来再套英文）；都不命中就保留中文（如实回退，不静默改写）。
 *
 * 作用域 = 只碰「我们的 DOM」：标了 data-dpm-i18n 的子树，或 class/id 属于本插件命名空间（dpm- / pstar- / qpn-）。
 *   宿主外壳与其它插件的 DOM 一律不碰（插件固定英文 + DSH 中文时互不干扰）。
 *
 * 用户内容永不翻译：词典里只有我们自己写的界面文案；卡片标题 / 任务正文 / 文件名 / 知识卡正文没有词条。
 */
import { createElement as h } from 'react'
import { ApiError, getI18n, post, type LangMode, type Prefs, type Snapshot } from './api.js'
import { RULES } from './i18n.rules.js'

export type { LangMode }
/** zh / en：真正用于渲染的语言。 */
export type Lang = 'zh' | 'en'
/** 词典状态：ready = 可用；dead = 宿主没有这条路由（旧宿主，重启后可用）；error = 读到了但失败。 */
export type DictState = 'idle' | 'ready' | 'dead' | 'error'

/** 我们的 DOM 根的标记属性：引擎只翻译这些子树。 */
export const ROOT_ATTR = 'data-dpm-i18n'
/** 本插件自己的 class / id 命名空间（注入到宿主容器里的小部件靠这个认出自己）。 */
/** 本插件自己的 class / id 命名空间（kbm = 知识卡编辑器弹窗，历史遗留的短类名）。 */
const OWN = /(^|[\s_-])(dpm|pstar|qpn|kbm)([-_]|$)/
const LS_MODE = 'dpm.lang.mode.v1'
const LS_DICT = 'dpm.lang.dict.v1'
const ATTRS = ['placeholder', 'title', 'aria-label'] as const

let mode: LangMode = 'auto'
let dsh: Lang = 'zh'
let eff: Lang = 'zh'
let dict: Record<string, string> | null = null
let dictV = ''
let dictState: DictState = 'idle'
let dictErr = ''
let dictBusy = false
let installed = false

/** 文本节点 → 中文原文（切回中文时按它还原；React 重画写出中文后也按它重新翻）。 */
const orig = new WeakMap<Text, string>()
/** 元素 → { 属性名: 中文原文 }。 */
const attrOrig = new WeakMap<Element, Record<string, string>>()

const subs = new Set<() => void>()
const langSubs = new Set<() => void>()

// ── 状态读取 ─────────────────────────────────────────────
export const getMode = (): LangMode => mode
export const getLang = (): Lang => eff
export const getDictState = (): DictState => dictState
export const getDictErr = (): string => dictErr
export const getDictVersion = (): string => dictV
export const dictSize = (): number => (dict ? Object.keys(dict).length : 0)

export function subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } }
/** 只在「生效语言真的变了」时回调（侧栏入口文案要跟着重新注册，不能每次状态变化都重挂）。 */
export function onLangChange(fn: () => void): () => void { langSubs.add(fn); return () => { langSubs.delete(fn) } }
const notify = (): void => { for (const fn of Array.from(subs)) try { fn() } catch { /* 订阅方自己报错不该拖垮界面 */ } }
const notifyLang = (): void => { for (const fn of Array.from(langSubs)) try { fn() } catch { /* 同上 */ } }

// ── 文本翻译 ─────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS: Record<string, string> = { 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat', 日: 'Sun', 天: 'Sun' }

/** 日期 / 天数这类没法用「模板 $1」表达的：月份名、星期名、单复数在这里算。 */
function dated(t: string): string | null {
  let m = t.match(/^(\d{4}) 年 (\d{1,2}) 月$/)
  if (m) return MONTHS[Number(m[2]) - 1] + ' ' + m[1]
  m = t.match(/^(\d{1,2}) 月$/)
  if (m) return MONTHS[Number(m[1]) - 1]
  m = t.match(/^周([一二三四五六日天])((?:\s*·\s*\d{4})?)$/)
  if (m) return (WEEKDAYS[m[1]] ?? m[1]) + m[2].replace(/·/, '·')
  m = t.match(/^(\d+) ?天$/)
  if (m) return m[1] + (m[1] === '1' ? ' day' : ' days')
  m = t.match(/^(\d+) 个文件( ·)?$/)
  if (m) return m[1] + (m[1] === '1' ? ' file' : ' files') + (m[2] ? ' ·' : '')
  m = t.match(/^(\d+) 个无用$/)
  if (m) return m[1] + ' unused'
  return null
}

/** 一条文本 → 英文；不命中返回 null（调用方决定回退）。 */
export function pick(raw: string): string | null {
  if (eff === 'zh') return null
  const t = raw.trim()
  if (!t) return null
  if (dict && Object.prototype.hasOwnProperty.call(dict, t)) return raw.replace(t, dict[t])
  const d = dated(t)
  if (d != null) return raw.replace(t, d)
  for (const [re, out] of RULES) {
    const m = t.match(re)
    if (!m) continue
    return raw.replace(t, out.replace(/\$(\d)/g, (_: string, d: string) => m[Number(d)] ?? ''))
  }
  return null
}

/** 直接翻译一条字符串（React 渲染的文案 / 宿主渲染的 slot label 用；DOM 里的文本由引擎自己处理）。 */
export const tr = (s: string): string => pick(s) ?? s

function doText(n: Text): void {
  const cur = n.nodeValue
  if (cur == null) return
  if (eff === 'zh') {
    const o = orig.get(n)
    if (o != null && cur !== o) n.nodeValue = o
    return
  }
  const base = orig.get(n) ?? cur
  const r = pick(base)
  if (r == null) return
  if (!orig.has(n)) orig.set(n, base)
  if (cur !== r) n.nodeValue = r
}

function doEl(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v == null) continue
    const bag = attrOrig.get(el) ?? {}
    if (eff === 'zh') {
      if (bag[a] != null && v !== bag[a]) el.setAttribute(a, bag[a])
      continue
    }
    const base = bag[a] ?? v
    const r = pick(base)
    if (r == null) continue
    if (bag[a] == null) { bag[a] = base; attrOrig.set(el, bag) }
    if (v !== r) el.setAttribute(a, r)
  }
}

/** 整棵子树走一遍（两种方向都走：en = 翻译，zh = 还原）。 */
function walk(root: Node | null): void {
  if (!root) return
  if (root.nodeType === 1) doEl(root as Element)
  if (root.nodeType === 3) { doText(root as Text); return }
  const doc = root.ownerDocument ?? document
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)
  let n = w.nextNode()
  while (n) {
    if (n.nodeType === 3) doText(n as Text)
    else doEl(n as Element)
    n = w.nextNode()
  }
}

// ── 我们的 DOM ────────────────────────────────────────────
const clsOf = (el: Element): string => (typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '') + ' ' + (el.id || '')

/** <html> / <body> 永远不算我们的根：标了它们等于把整个宿主界面交给自己翻（实测会翻掉设置导航）。 */
const isDoc = (el: Element): boolean => el === document.documentElement || el === document.body

/** 这个元素是不是本插件的（自身带命名空间 class/id，或落在已标记的根里）。 */
function own(el: Element | null | undefined): boolean {
  if (!el || el.nodeType !== 1 || isDoc(el)) return false
  if (OWN.test(clsOf(el))) return true
  return el.closest('[' + ROOT_ATTR + ']') !== null
}

/** 给根打标记（标记只增不减：元素被摘掉时标记随 DOM 一起消失）。 */
export function markRoot(el: Element | null | undefined): void {
  if (el && el.nodeType === 1 && !isDoc(el) && !el.hasAttribute(ROOT_ATTR)) el.setAttribute(ROOT_ATTR, '')
}

/** 包装一个 slot 贡献：外面套一层 display:contents 的标记元素（不产生盒子，布局零影响）。 */
export function wrapRoot<P>(Comp: (p: P) => unknown): (p: P) => unknown {
  return function Wrapped(p: P): unknown {
    return h('div', { [ROOT_ATTR]: '', style: { display: 'contents' } } as never, h(Comp as never, p as never))
  }
}

/** 全量扫一遍：已有标记的根 + 带本插件命名空间的元素（小部件直接被塞进宿主容器的那种）。 */
function sweep(): void {
  if (eff === 'zh') {
    for (const el of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) walk(el)
    return
  }
  for (const el of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) { markRoot(el); walk(el) }
  for (const el of Array.from(document.querySelectorAll('[class*="dpm"],[class*="pstar"],[class*="qpn"]'))) {
    // html / body 可能带着过渡类（dpm-lg-fade）—— 那不是「我们的界面」，跳过
    if (isDoc(el) || !OWN.test(clsOf(el))) continue
    markRoot(el)
    walk(el)
  }
}

// ── 词典 ────────────────────────────────────────────────
function readCache(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DICT) ?? 'null') as { v?: string; dict?: Record<string, string> } | null
    if (raw?.v && raw.dict) { dict = raw.dict; dictV = raw.v; dictState = 'ready' }
  } catch { /* 缓存坏了就走网络 */ }
}

/** 拉词典（同一个 v 直接用缓存；旧宿主 404 → dead，界面回退中文并在设置页点名）。 */
export async function loadDict(force = false): Promise<void> {
  if (dictBusy) return
  dictBusy = true
  if (force) { dictState = 'idle'; dictErr = '' }
  try {
    const r = await getI18n()
    /* 首屏 eff 已是 en、但词典还没到时，宿主渲染的 slot label 已按中文注册 —— 词典第一次到手要让它们重挂一次 */
    const fresh = !dict || r.v !== dictV
    if (fresh) {
      dict = r.dict
      dictV = r.v
      try { localStorage.setItem(LS_DICT, JSON.stringify({ v: r.v, dict: r.dict })) } catch { /* 配额满就当没缓存 */ }
    }
    dictState = 'ready'; dictErr = ''
    if (eff === 'en') { sweep(); if (fresh) notifyLang() }
  } catch (e) {
    const err = e as ApiError
    dictState = err.code === 'NOT_FOUND' ? 'dead' : 'error'
    dictErr = err.message
  } finally {
    dictBusy = false
    notify()
  }
}

// ── 语言生效 ─────────────────────────────────────────────
function applyLang(): void {
  const next: Lang = mode === 'auto' ? dsh : mode
  const changed = next !== eff
  eff = next
  if (eff === 'en') { readCache(); if (!dict) void loadDict() }
  sweep()
  // 淡一下，只淡文字不动布局（与原型 lgFade 一致；prefers-reduced-motion 下不播）。
  // 类名用完就摘 —— 常驻的话宿主任何 :has()/:not() 规则都可能被它带跑。
  const el = document.documentElement
  el.classList.remove('dpm-lg-fade')
  void el.offsetWidth
  el.classList.add('dpm-lg-fade')
  window.setTimeout(() => el.classList.remove('dpm-lg-fade'), 260)
  if (changed) notifyLang()
  notify()
}

function readMode(): LangMode {
  try {
    const m = localStorage.getItem(LS_MODE)
    if (m === 'zh' || m === 'en' || m === 'auto') return m
  } catch { /* 隐私模式读不到 */ }
  return 'auto'
}

/** 切语言：立即生效（不等 host），再把偏好写到 host（失败抛错，由设置页点名 + 回滚）。 */
export async function setMode(m: LangMode): Promise<void> {
  const prev = mode
  mode = m
  try { localStorage.setItem(LS_MODE, m) } catch { /* 同上 */ }
  applyLang()
  try {
    // prefs/set 回的是整份快照（result = 新 prefs）；旧宿主会忽略未知键 → 回来没有 lang
    const r = await post<{ result?: Prefs } & Snapshot>('prefs/set', { lang: m })
    const got = r.result?.lang ?? r.board?.prefs?.lang
    if (got !== m) throw new ApiError('NOT_FOUND', '宿主还在跑旧代码，没能记住这个选择（重启 DSH 后可用）')
  } catch (e) {
    mode = prev
    try { localStorage.setItem(LS_MODE, prev) } catch { /* 同上 */ }
    applyLang()
    throw e
  }
}

/** 快照里的偏好（host 侧看板文档，多浏览器共享）到货 → 以它为准（localStorage 只是首屏镜像）。 */
export function adoptServerMode(lang: LangMode | undefined): void {
  if (lang !== 'auto' && lang !== 'zh' && lang !== 'en') return
  if (lang === mode) return
  mode = lang
  try { localStorage.setItem(LS_MODE, lang) } catch { /* 同上 */ }
  applyLang()
}

// ── 安装 ────────────────────────────────────────────────
export function installI18n(ctx: { effect(fn: () => (() => void) | void, label?: string): void }): void {
  if (installed) return
  installed = true

  const readDsh = (): Lang => (/^en/i.test(document.documentElement.lang || '') ? 'en' : 'zh')
  dsh = readDsh()
  mode = readMode()
  readCache()
  applyLang()

  // 1) DSH 语言变了（官方 locale 服务会同步 <html lang>）→ auto 模式下跟着变
  ctx.effect(() => {
    const mo = new MutationObserver(() => {
      const next = readDsh()
      if (next === dsh) return
      dsh = next
      if (mode === 'auto') applyLang()
      else notify()
    })
    mo.observe(document.documentElement, { attributeFilter: ['lang'], attributes: true })
    return () => mo.disconnect()
  }, 'dsh-project-manager: i18n follow DSH language')

  // 2) 重画很频繁（看板 / 甘特 / 轮询）：只处理新增子树与改动的文本，rAF 合并
  ctx.effect(() => {
    let queue: Node[] = []
    let raf = 0
    const flush = (): void => {
      raf = 0
      const list = queue; queue = []
      for (const n of list) if (n.isConnected) walk(n)
    }
    const push = (n: Node): void => {
      queue.push(n)
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const mo = new MutationObserver((recs) => {
      if (eff !== 'en') return
      for (const r of recs) {
        if (r.type === 'characterData') {
          const p = r.target.parentElement
          if (p && own(p)) push(r.target)
          continue
        }
        if (r.type === 'attributes') {
          const el = r.target as Element
          if (own(el)) push(el)
          continue
        }
        const tgt = r.target as Element
        // tgt 是我们的子树 → 新增的都在里面，整棵走；tgt 是 body / 宿主容器 → 只认领带本插件命名空间的节点
        const inside = tgt !== document.body && tgt !== document.documentElement && own(tgt)
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType === 1) {
            const el = n as Element
            const mine = OWN.test(clsOf(el))
            if (mine) markRoot(el)
            if (mine || inside) push(el)
          } else if (n.nodeType === 3 && inside) push(n)
        }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
    // 兜底：宿主把我们的行整块重建时（例如语言变了重新注册贡献），新增子树挂在宿主的容器里，
    // observer 只看到「别人的容器」就跳过了 —— 英文态每 1.2s 把标记根重走一遍（幂等；切回中文就停）。
    const timer = window.setInterval(() => { if (eff === 'en') for (const el of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) walk(el) }, 1200)
    return () => { mo.disconnect(); window.clearInterval(timer); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: i18n follow DOM')

  // 3) 词典还没到就先拉（en 态首屏靠 localStorage 缓存兜住）
  void loadDict()
}
