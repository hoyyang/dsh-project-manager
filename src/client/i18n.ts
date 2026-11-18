/**
 * v182 起：界面语言引擎（client 侧唯一出处）；v185 起支持俄语（四档：auto / zh / en / ru）。
 *
 * 模型（与原型 prototype/dsh-web-v185.html 逐项一致）：
 *   mode = auto | zh | en | ru（auto = 跟随 DSH）；生效语言 eff = mode === 'auto' ? DSH 语言 : mode。
 *   DSH 语言读 <html lang>（官方 locale 服务负责同步它），ru 前缀 → ru，en 前缀 → en，其余 zh。
 *
 * 翻译方式 = **只改文本节点与 placeholder / title / aria-label**，不重建 DOM（重建会丢焦点 / 滚动 / 展开态）：
 *   词典（host 路由 GET /i18n?lang= 投递，按语言分别缓存）命中整句；
 *   日期 / 周几 / 天数这类算不出来的走 dated()（en）与 datedRu()（ru）；
 *   拼出来的句子走 RULES（en）/ RULES_RU（ru，模板可为函数，吃复数 pl()）；
 *   都不命中就保留中文（如实回退，不静默改写）。
 *
 * 俄语特有（v185）：
 *   pl() 三形复数；计数碎片（"3 张卡片" 里数字在独立节点）靠 countFix() 跨节点取数；
 *   两个字母数字相邻时补一个空格（spacingRu）；拼接型整句走 SENTENCES_RU（元素级整句覆盖）。
 *
 * 作用域 = 只碰「我们的 DOM」：标了 data-dpm-i18n 的子树，或 class/id 属于本插件命名空间（dpm- / pstar- / qpn- / kbm-）。
 *   宿主外壳与其它插件的 DOM 一律不碰；<html> / <body> 永不标记、永不翻译。
 *
 * 用户内容永不翻译：词典里只有我们自己写的界面文案；卡片标题 / 任务正文 / 文件名 / 知识卡正文没有词条；
 *   仓库角色（主仓）是数据，不翻。
 */
import { createElement as h } from 'react'
import { ApiError, getI18n, post, type LangMode, type Prefs, type Snapshot } from './api.js'
import { RULES } from './i18n.rules.js'
import { RULES_RU } from './i18n.rules.ru.js'
import { SENTENCES_RU } from './i18n.sentences.ru.js'

export type { LangMode }
/** zh / en / ru：真正用于渲染的语言。 */
export type Lang = 'zh' | 'en' | 'ru'
/** 词典状态：ready = 可用；dead = 宿主没有这条路由 / 没有这门语言的词典（旧宿主，重启后可用）；error = 读到了但失败。 */
export type DictState = 'idle' | 'ready' | 'dead' | 'error'

/** 我们的 DOM 根的标记属性：引擎只翻译这些子树。 */
export const ROOT_ATTR = 'data-dpm-i18n'
/** 本插件自己的 class / id 命名空间（注入到宿主容器里的小部件靠这个认出自己）。 */
/** 本插件自己的 class / id 命名空间（kbm = 知识卡编辑器弹窗，历史遗留的短类名）。 */
const OWN = /(^|[\s_-])(dpm|pstar|qpn|kbm)([-_]|$)/
const LS_MODE = 'dpm.lang.mode.v1'
const LS_DICT_PREFIX = 'dpm.lang.dict.v1.'
const ATTRS = ['placeholder', 'title', 'aria-label'] as const

interface DictPayload { v: string; dict: Record<string, string>; total?: number }

let mode: LangMode = 'auto'
let dsh: Lang = 'zh'
let eff: Lang = 'zh'
let dict: Record<string, string> | null = null
let dictV = ''
let dictTotal = 0
let dictState: DictState = 'idle'
let dictErr = ''
let dictBusy = false
let installed = false
const dicts = new Map<Lang, DictPayload>()

/** 文本节点 → 中文原文（切回中文时按它还原；React 重画写出中文后也按它重新翻）。 */
const orig = new WeakMap<Text, string>()
/** 元素 → { 属性名: 中文原文 }。 */
const attrOrig = new WeakMap<Element, Record<string, string>>()
/** 元素 → 被整句覆盖前的中文（SENTENCES_RU 用；切回中文还原）。 */
const sentOrig = new WeakMap<Element, string>()

const subs = new Set<() => void>()
const langSubs = new Set<() => void>()

// ── 状态读取 ─────────────────────────────────────────────
export const getMode = (): LangMode => mode
export const getLang = (): Lang => eff
export const getDictState = (): DictState => dictState
export const getDictErr = (): string => dictErr
export const getDictVersion = (): string => dictV
export const dictSize = (): number => (dict ? Object.keys(dict).length : 0)
/** v185：该语言词典的键空间总数（覆盖率分母；老词典没有 total 时退回「已译条数」）。 */
export const dictTotalSize = (): number => (dictTotal || dictSize())

// ── 复数（俄语三形，一处定义）─────────────────────────────
/** 1 карточка / 2 карточки / 5 карточек */
export function pl(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const l = a % 10
  if (a > 10 && a < 20) return many
  if (l > 1 && l < 5) return few
  if (l === 1) return one
  return many
}

/** 计数单位 → 各语言词形（组件拼 "3 карточки" 用；引擎的计数碎片也走这张表）。 */
export type CountUnit = 'card' | 'session' | 'project' | 'group' | 'file' | 'stage' | 'repo' | 'task' | 'item' | 'record' | 'link'

const UNIT_RU: Record<CountUnit, readonly [string, string, string]> = {
  card: ['карточка', 'карточки', 'карточек'],
  session: ['сессия', 'сессии', 'сессий'],
  project: ['проект', 'проекта', 'проектов'],
  group: ['группа', 'группы', 'групп'],
  file: ['файл', 'файла', 'файлов'],
  stage: ['этап', 'этапа', 'этапов'],
  repo: ['репозиторий', 'репозитория', 'репозиториев'],
  task: ['задача', 'задачи', 'задач'],
  item: ['пункт', 'пункта', 'пунктов'],
  record: ['запись', 'записи', 'записей'],
  link: ['ссылка', 'ссылки', 'ссылок'],
}
const UNIT_EN: Record<CountUnit, readonly [string, string]> = {
  card: ['card', 'cards'], session: ['session', 'sessions'], project: ['project', 'projects'], group: ['group', 'groups'],
  file: ['file', 'files'], stage: ['stage', 'stages'], repo: ['repo', 'repos'], task: ['task', 'tasks'],
  item: ['item', 'items'], record: ['record', 'records'], link: ['link', 'links'],
}
const UNIT_ZH: Record<CountUnit, string> = {
  card: '张卡片', session: '个会话', project: '个项目', group: '个组', file: '个文件',
  stage: '个阶段', repo: '个仓库', task: '个任务', item: '项', record: '条内容', link: '条链接',
}
/** 中文里跟在数字后面的量词碎片 → 单位（数字常在独立的 <b> 里，所以要在取数处跨节点补）。 */
const SUFFIX_UNIT: Record<string, CountUnit> = {
  张卡片: 'card', 个会话: 'session', 个活跃会话: 'session', 个项目: 'project', 个项目组: 'group',
  个文件: 'file', 个阶段: 'stage', 个仓库: 'repo', 个任务绑定: 'task', 项: 'item', 条内容: 'record',
  条链接: 'link', 项目: 'project', 个任务: 'task', 张卡片组: 'group',
}

/** N + 单位的词形（zh = 「N 张卡片」，en = 复形，ru = 三形）。 */
export function plural(n: number, unit: CountUnit, lang: Lang = eff): string {
  if (lang === 'ru') return n + ' ' + pl(n, ...UNIT_RU[unit])
  if (lang === 'en') return n + ' ' + (n === 1 ? UNIT_EN[unit][0] : UNIT_EN[unit][1])
  return n + ' ' + UNIT_ZH[unit]
}

export function subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } }
/** 只在「生效语言真的变了」时回调（侧栏入口文案要跟着重新注册，不能每次状态变化都重挂）。 */
export function onLangChange(fn: () => void): () => void { langSubs.add(fn); return () => { langSubs.delete(fn) } }
const notify = (): void => { for (const fn of Array.from(subs)) try { fn() } catch { /* 订阅方自己报错不该拖垮界面 */ } }
const notifyLang = (): void => { for (const fn of Array.from(langSubs)) try { fn() } catch { /* 同上 */ } }

// ── 文本翻译 ─────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WEEKDAYS: Record<string, string> = { 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat', 日: 'Sun', 天: 'Sun' }
const WEEKDAYS_RU: Record<string, string> = { 一: 'Пн', 二: 'Вт', 三: 'Ср', 四: 'Чт', 五: 'Пт', 六: 'Сб', 日: 'Вс', 天: 'Вс' }

/** 日期 / 天数这类没法用「模板 $1」表达的：月份名、星期名、单复数在这里算（英文）。 */
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

/** 同上，俄语（月份缩写 / 周几 / 天数复数）。 */
function datedRu(t: string): string | null {
  let m = t.match(/^(\d{4}) 年 (\d{1,2}) 月$/)
  if (m) return MONTHS_RU[Number(m[2]) - 1] + ' ' + m[1]
  m = t.match(/^(\d{1,2}) 月$/)
  if (m) return MONTHS_RU[Number(m[1]) - 1]
  m = t.match(/^周([一二三四五六日天])((?:\s*·\s*\d{4})?)$/)
  if (m) return (WEEKDAYS_RU[m[1]] ?? m[1]) + m[2]
  m = t.match(/^(\d+) ?天$/)
  if (m) return m[1] + ' дн.'
  m = t.match(/^(\d+) 个文件( ·)?$/)
  if (m) return m[1] + ' ' + pl(Number(m[1]), 'файл', 'файла', 'файлов') + (m[2] ? ' ·' : '')
  m = t.match(/^(\d+) 个无用$/)
  if (m) return m[1] + ' без дела'
  return null
}

/** 一条文本 → 目标语言；不命中返回 null（调用方决定回退）。 */
export function pick(raw: string): string | null {
  if (eff === 'zh') return null
  const t = raw.trim()
  if (!t) return null
  if (dict && Object.prototype.hasOwnProperty.call(dict, t)) { const v = dict[t]; return raw.replace(t, () => v) }
  const d = eff === 'ru' ? datedRu(t) : dated(t)
  if (d != null) return raw.replace(t, () => d)
  const rules = eff === 'ru' ? RULES_RU : RULES
  for (const [re, out] of rules) {
    const m = t.match(re)
    if (!m) continue
    const rep = typeof out === 'function' ? out(m) : out.replace(/\$(\d)/g, (_: string, d2: string) => m[Number(d2)] ?? '')
    return raw.replace(t, () => rep)
  }
  return null
}

/** 直接翻译一条字符串（React 渲染的文案 / 宿主渲染的 slot label 用；DOM 里的文本由引擎自己处理）。 */
export const tr = (s: string): string => pick(s) ?? s

/** 俄语：翻译完两个字母数字还会粘在一起时补一个空格（中文没有词间空格，俄语必须有）。 */
function spacingRu(n: Text, out: string): string {
  const prev = n.previousSibling
  if (!prev) return out
  const pv = prev.nodeType === 3 ? (prev.nodeValue ?? '') : ((prev.textContent ?? '') as string)
  const a = pv.trim().slice(-1)
  const b = String(out).trim().charAt(0)
  if (!a || !b) return out
  if (/[A-Za-zА-Яа-яЁё0-9]/.test(a) && /[A-Za-zА-Яа-яЁё0-9]/.test(b)) return ' ' + String(out).replace(/^\s+/, '')
  // 数字在下一个元素里（<span class="cnt">10</span>）：空格要补在这一段末尾
  const nx = n.nextSibling
  if (nx) {
    const nv = nx.nodeType === 3 ? (nx.nodeValue ?? '') : (nx.textContent ?? '')
    const nx0 = String(nv).trim().charAt(0)
    const last = String(out).trim().slice(-1)
    /* 下一段可能还没被翻译（中文首字）—— 它迟早会变成西里尔字母，所以中文也算「词」 */
    const wordy = (ch: string): boolean => /[A-Za-zА-Яа-яЁё0-9]/.test(ch) || /[\u4e00-\u9fa5]/.test(ch)
    if (nx0 && wordy(last) && wordy(nx0) && !/\s$/.test(String(out))) return String(out) + ' '
  }
  return out
}

/** 俄语：数字在独立节点里时，跨节点取数决定量词词形（"3 个活跃会话" → "3 активные сессии"）。 */
function countFixRu(n: Text, base: string): string | null {
  const key = String(base ?? '').trim()
  const unit = SUFFIX_UNIT[key]
  if (!unit) return null
  let p: Node | null = n.previousSibling
  let up = 0
  let cursor: Node = n
  while (!p && up++ < 4) {
    const par = cursor.parentElement
    if (!par) return null
    p = par.previousSibling
    if (!p) cursor = par
  }
  let guard = 0
  let num: number | null = null
  while (p && guard++ < 4) {
    const txt = p.nodeType === 3 ? (p.nodeValue ?? '') : (p.textContent ?? '')
    const m = /(\d+)\s*$/.exec(String(txt))
    if (m) { num = Number(m[1]); break }
    p = p.previousSibling
  }
  if (num == null) return /^\s/.test(base) ? ' ' + pl(0, ...UNIT_RU[unit]) : pl(0, ...UNIT_RU[unit])
  const word = pl(num, ...UNIT_RU[unit])
  return (/^\s/.test(base) ? ' ' : '') + word
}

function doText(n: Text): void {
  const cur = n.nodeValue
  if (cur == null) return
  if (eff === 'zh') {
    const o = orig.get(n)
    if (o != null && cur !== o) n.nodeValue = o
    return
  }
  const base = orig.get(n) ?? cur
  if (eff === 'ru') {
    const fx = countFixRu(n, base)
    if (fx != null) { if (!orig.has(n)) orig.set(n, base); if (cur !== fx) n.nodeValue = fx; return }
  }
  const r0 = pick(base)
  if (r0 == null) return
  const r = eff === 'ru' ? spacingRu(n, r0) : r0
  if (!orig.has(n)) orig.set(n, base)
  if (cur !== r) n.nodeValue = r
}

function doEl(el: Element): void {
  // v185：拼接型整句（俄语语序 / 格变化不允许逐段替换）—— 元素级整句覆盖，切回中文还原
  if (eff === 'zh') {
    const o = sentOrig.get(el)
    if (o != null && (el.textContent ?? '') !== o) el.textContent = o
  } else if (eff === 'ru') {
    /* 拼接型整句：DOM 里这句可能被拆成几个节点 + 内联标签，所以按「父元素 textContent」匹配（限小段落，别把大区块吞了） */
    const t = (el.textContent ?? '').trim()
    if (t.length <= 160 && el.children.length <= 4 && SENTENCES_RU[t]) {
      const hit = SENTENCES_RU[t]
      if (!sentOrig.has(el)) sentOrig.set(el, el.textContent ?? '')
      if ((el.textContent ?? '') !== hit) el.textContent = hit
      return
    }
  }
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

/** 整棵子树走一遍（两种方向都走：目标语言 = 翻译，zh = 还原）。 */
function walk(root: Node | null): void {
  if (!root) return
  if (root.nodeType === 1) {
    const el = root as Element
    if (el.hasAttribute(ROOT_ATTR)) {
      if (eff === 'zh') el.removeAttribute('data-dpm-lang')
      else el.setAttribute('data-dpm-lang', eff)
    }
    doEl(el)
  }
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

/** v185：把生效语言写到我们的根上，CSS 才能按语言调排版（俄语更长：看板标题栏阈值 820 → 1080）。 */
function stampLang(): void {
  for (const el of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) {
    if (eff === 'zh') el.removeAttribute('data-dpm-lang')
    else el.setAttribute('data-dpm-lang', eff)
  }
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
    stampLang()
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
  stampLang()
}

// ── 词典 ────────────────────────────────────────────────
const lsKey = (lang: Lang): string => LS_DICT_PREFIX + lang

function readCache(lang: Lang): void {
  if (dicts.has(lang)) return
  try {
    const raw = JSON.parse(localStorage.getItem(lsKey(lang)) ?? 'null') as DictPayload | null
    if (raw?.v && raw.dict) dicts.set(lang, raw)
  } catch { /* 缓存坏了就走网络 */ }
}

/** 切到某门语言时把它的词典装进「当前词典」槽位（没加载过就返回 false）。 */
function useDict(lang: Lang): boolean {
  const d = dicts.get(lang)
  if (!d) { dict = null; return false }
  dict = d.dict
  dictV = d.v
  dictTotal = d.total ?? Object.keys(d.dict).length
  dictState = 'ready'
  dictErr = ''
  return true
}

/** 拉词典（缺省拉当前生效语言；同一个 v 直接用缓存；旧宿主 404 → dead，界面回退中文并在设置页点名）。 */
export async function loadDict(force = false): Promise<void> {
  if (dictBusy) return
  if (eff === 'zh') return
  const lang = eff
  dictBusy = true
  if (force) { dictState = 'idle'; dictErr = '' }
  try {
    const r = await getI18n(lang)
    const fresh = !dicts.has(lang) || dicts.get(lang)!.v !== r.v
    dicts.set(lang, r)
    try { localStorage.setItem(lsKey(lang), JSON.stringify({ v: r.v, dict: r.dict, total: r.total })) } catch { /* 配额满就当没缓存 */ }
    if (lang === eff) {
      useDict(lang)
      /* 首屏 eff 已是目标语言、但词典还没到时，宿主渲染的 slot label 已按中文注册 —— 词典第一次到手要让它们重挂一次 */
      sweep()
      if (fresh) notifyLang()
    }
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
  if (eff !== 'zh') { readCache(eff); useDict(eff); void loadDict() } else { dict = null; dictV = ''; dictTotal = 0 }
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
    if (m === 'zh' || m === 'en' || m === 'ru' || m === 'auto') return m
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
  if (lang !== 'auto' && lang !== 'zh' && lang !== 'en' && lang !== 'ru') return
  if (lang === mode) return
  mode = lang
  try { localStorage.setItem(LS_MODE, lang) } catch { /* 同上 */ }
  applyLang()
}

// ── 安装 ────────────────────────────────────────────────
export function installI18n(ctx: { effect(fn: () => (() => void) | void, label?: string): void }): void {
  if (installed) return
  installed = true

  const readDsh = (): Lang => { const l = document.documentElement.lang || ''; return /^ru/i.test(l) ? 'ru' : /^en/i.test(l) ? 'en' : 'zh' }
  dsh = readDsh()
  mode = readMode()
  if (eff !== 'zh') readCache(eff)
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
      if (eff === 'zh') return
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
    // observer 只看到「别人的容器」就跳过了 —— 非中文态每 1.2s 把标记根重走一遍（幂等；切回中文就停）。
    const timer = window.setInterval(() => { if (eff !== 'zh') for (const el of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) walk(el) }, 1200)
    return () => { mo.disconnect(); window.clearInterval(timer); if (raf) cancelAnimationFrame(raf) }
  }, 'dsh-project-manager: i18n follow DOM')

  // 3) 词典还没到就先拉
  void loadDict()
}
