/**
 * 0.20 落盘项目规范（纯函数，单测直接覆盖）。
 * - CHECKS：一张带版本号的检查清单。新版本只往后追加检查项和它的修法；每次落盘把全部检查跑一遍（检查本身幂等），
 *   所以不管一份 STATE 停在哪个版本，下一次落盘都会被拉到最新版——不靠文件里写的版本号。
 * - by=plugin 的项由插件自己修（位置 = 迁到卡片组的落盘文件夹）；by=ai 的项交给落盘的 AI 改，插件在 persist 时逐条复查，没改好就拒绝写入。
 * - matchStates：会话信息卡「新建落盘项目」输入框的同名检测。
 * - suggestFolder：卡片组落盘文件夹的默认英文名。
 */
import { indexSection } from './landfill.js'

export const SPEC_VERSION = 2

export interface SpecCtx {
  /** 这份 STATE 现在所在的项目（~/.ai/projects/<project>）。 */
  project: string
  slug: string
  /** 关联它的卡片组的落盘文件夹（项目 id）。 */
  homes: string[]
  /** 不在 homes 里时要迁去的项目（第一个关联它的卡片组的落盘文件夹）。 */
  home?: string
  /** 关联它的卡片名（别名行要包含能当名字用的那些）。 */
  cards: string[]
  /** 用户撤销过迁移：留在原处，不再提示迁移。 */
  stay?: boolean
}
export interface SpecIssue { id: string; since: number; by: 'plugin' | 'ai'; text: string; fix: string }

/** 能当别名的名字（与 states.ts 解析 aliases 行的规则一致）。 */
export const ALIAS_OK = /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9._\u4e00-\u9fff-]{1,63}$/
export function aliasLine(text: string): string[] | null {
  const m = /^\s*(?:[-*]\s+)?[*_\x60]{0,2}(?:aliases|别名)[*_\x60]{0,2}\s*[:：]\s*(.*)$/im.exec(text)
  return m ? m[1].replace(/[（(].*$/, '').split(/[\s,，、]+/).map((x) => x.replace(/\x60/g, '')).filter(Boolean) : null
}
const escRe = (s: string): string => s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')

interface Check { id: string; since: number; by: 'plugin' | 'ai'; test(text: string, c: SpecCtx): string | null; fix(c: SpecCtx): string }
/** 只追加，不改已有项的含义（改了等于让旧 STATE 的检查结果悄悄变化）。 */
const CHECKS: Check[] = [
  { id: 'sections', since: 1, by: 'ai', test: (t) => (/重启读取清单/.test(t) && /next_action/.test(t) ? null : '缺「## 🔄 重启读取清单」或 next_action'), fix: () => '按 landfill-project skill 的 Required STATE Content 补齐' },
  { id: 'title', since: 2, by: 'ai', test: (t, c) => (new RegExp('^# 落盘项目 STATE: ' + escRe(c.slug) + '\\s*$', 'm').test(t) ? null : '首行不是「# 落盘项目 STATE: ' + c.slug + '」'), fix: (c) => '首行写成「# 落盘项目 STATE: ' + c.slug + '」' },
  { id: 'index', since: 2, by: 'ai', test: (t) => (/^## .*文件索引/m.test(t) && indexSection(t).trim() ? null : '没有「## 📁 文件索引」节'), fix: () => '加「## 📁 文件索引」节：每个子文档一行「- [必读|参考] 路径 · 用途」，没有子文档就写「- 暂无子文档」' },
  {
    id: 'aliases', since: 2, by: 'ai',
    test: (t, c) => { const miss = missingAliases(t, c); return miss.length ? '别名行没写卡片名：' + miss.join('、') : null },
    fix: (c) => '在标题下加（或补全）一行「- aliases: ' + c.cards.filter((x) => ALIAS_OK.test(x) && x.toLowerCase() !== c.slug.toLowerCase()).join(', ') + '」，说卡片名也能回忆 / 落盘它',
  },
  {
    id: 'location', since: 2, by: 'plugin',
    test: (_t, c) => (c.stay || !c.home || c.homes.includes(c.project) ? null : '在 ' + c.project + '/，应在卡片组的落盘文件夹 ' + c.home + '/'),
    fix: (c) => '落盘时插件把整个文件夹迁到 ~/.ai/projects/' + (c.home ?? '') + '/memory/designs/' + c.slug + '/（可撤销）',
  },
]
export function missingAliases(text: string, c: Pick<SpecCtx, 'cards' | 'slug'>): string[] {
  const want = [...new Set(c.cards.filter((x) => ALIAS_OK.test(x) && x.toLowerCase() !== c.slug.toLowerCase()))]
  if (!want.length) return []
  const have = (aliasLine(text) ?? []).map((x) => x.toLowerCase())
  return want.filter((x) => !have.includes(x.toLowerCase()))
}

/** 这份 STATE 不合现行规范的地方。 */
export function specIssues(text: string, c: SpecCtx): SpecIssue[] {
  const out: SpecIssue[] = []
  for (const k of CHECKS) {
    const why = k.test(text, c)
    if (why) out.push({ id: k.id, since: k.since, by: k.by, text: why, fix: k.fix(c) })
  }
  return out
}
/** 给 AI 的一段话（落盘提示里附带；persist 被 SPEC_ISSUES 拒时也返回它）。 */
export function specHint(key: string, issues: SpecIssue[]): string {
  if (!issues.length) return ''
  const ai = issues.filter((x) => x.by === 'ai')
  const pl = issues.filter((x) => x.by === 'plugin')
  return key + ' 不合落盘项目规范 v' + SPEC_VERSION + ' 的地方：' + [...ai.map((x) => '（你改）' + x.text + ' → ' + x.fix), ...pl.map((x) => '（插件自动）' + x.text + ' → ' + x.fix)].join('；')
}

/** 卡片组落盘文件夹的默认名：组名里的英文 / 数字（小写、- 连接）；没有就用组 id；和已有项目重名加后缀。用户确认时可改。 */
export function suggestFolder(groupName: string, groupId: string, taken: readonly string[]): string {
  const base = (groupName.match(/[A-Za-z0-9]+/g) ?? []).join('-').toLowerCase().slice(0, 40)
  const has = (x: string): boolean => taken.some((t) => t.toLowerCase() === x)
  const first = base ? (has(base) ? base + '-group' : base) : 'group-' + groupId.replace(/^g/, '').slice(-6)
  let v = first
  for (let i = 2; has(v); i++) v = first + '-' + i
  return v
}

export const normName = (s: string): string => s.trim().toLowerCase().replace(/[\s_]+/g, '-')
export function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

export type MatchMode = 'hint' | 'exact' | 'near' | 'none'
export interface MatchHit { key: string; why: string }
/**
 * 同名检测。q = 输入框原文（空格分隔：第一个不含中文的是文件名，其余是别名）。
 * - 空：按卡片名找「可能就是这个」（slug 或别名等于卡片名）
 * - exact：任一名字等于某个 slug 或别名（同名不能再新建）
 * - near：文件名 ≥3 字符且被某个 slug 包含，或（≥5 字符时）与 slug 相差 ≤2 个字符；最多 3 个
 */
export function matchStates(q: string, states: ReadonlyArray<{ key: string; slug: string; aliases?: readonly string[] }>, cardTitle: string): { mode: MatchMode; hits: MatchHit[] } {
  const names = q.split(/\s+/).map((x) => x.trim()).filter(Boolean)
  if (!names.length) {
    const t = normName(cardTitle)
    if (!t) return { mode: 'none', hits: [] }
    const hits = states.filter((s) => s.slug.toLowerCase() === t || (s.aliases ?? []).some((a) => normName(a) === t)).map((s) => ({ key: s.key, why: s.slug.toLowerCase() === t ? '文件名就是这张卡片的名字' : '它的别名就是这张卡片的名字「' + cardTitle + '」' }))
    return hits.length ? { mode: 'hint', hits: hits.slice(0, 3) } : { mode: 'none', hits: [] }
  }
  const exact: MatchHit[] = []
  for (const s of states) {
    const sl = s.slug.toLowerCase()
    const al = (s.aliases ?? []).map(normName)
    const hit = names.find((n) => normName(n) === sl || al.includes(normName(n)))
    if (hit) exact.push({ key: s.key, why: normName(hit) === sl ? '文件名相同' : '和它的别名「' + hit + '」相同' })
  }
  if (exact.length) return { mode: 'exact', hits: exact.slice(0, 5) }
  const file = names.find((n) => !/[\u4e00-\u9fff]/.test(n))
  const n0 = file ? normName(file) : ''
  const near: MatchHit[] = []
  if (n0.length >= 3) for (const s of states) {
    const sl = s.slug.toLowerCase()
    if (sl.includes(n0)) near.push({ key: s.key, why: '名字里含「' + file + '」' })
    else if (n0.length >= 5 && lev(n0, sl) <= 2) near.push({ key: s.key, why: '只差 ' + lev(n0, sl) + ' 个字符' })
  }
  return near.length ? { mode: 'near', hits: near.slice(0, 3) } : { mode: 'none', hits: [] }
}
