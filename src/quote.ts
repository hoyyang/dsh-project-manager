/**
 * 0.27 会话输入框「>」引用卡片内容：每一类条目插入的文本（原型 v53 定稿，host / client 共用，纯函数）。
 * 外层用「」；内容里本来就有的「」换成『』（中文引号嵌套），外层边界不会被内容截断。
 * 0.27.2（原型 v56）：名字（会话 / 卡片组 / 卡片 / 任务 / 说明标题 / 链接 / 文件 / 仓库）一律加中文双引号“”，名字里原有的“”换成‘’；内容、路径、URL 不加。
 */
export interface QLink { id?: string; text: string; type?: string; url: string }
export interface QFile { id?: string; path: string; title?: string; exists: boolean }
export interface QTask { id?: string; text: string; done: boolean; note?: string; type?: string; links?: string[]; files?: string[]; subs?: QTask[] }
export interface QCard { tasks: QTask[]; links: QLink[]; files: QFile[] }

export const nest = (x: string): string => String(x).replace(/「/g, '『').replace(/」/g, '』')
export const wrap = (x: string): string => '「' + x + '」'
/** 名字：“名字”。 */
export const nm = (x: string): string => '“' + nest(x).replace(/“/g, '‘').replace(/”/g, '’') + '”'
const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p
export const fileTitle = (f: { path: string; title?: string }): string => f.title || base(f.path)

/** 0.27.2 活跃会话：「“会话名”会话（“卡片组名”卡片组-“卡片名”卡片）」；还没卡片 = 去掉「-“卡片名”卡片」；不在卡片组里 = 只写「“会话名”会话」。 */
/** v151（1.1）：带会话 id（Agent 拿 id 精确定位会话，重名不再找错）：「“名”会话（“组”卡片组-“卡”卡片 · 会话 id：session-…）」；没卡片组 =「“名”会话（会话 id：…）」。 */
export const sessionText = (name: string, group?: string, card?: string, id?: string): string => {
  const g = group ? nm(group) + '卡片组' + (card ? '-' + nm(card) + '卡片' : '') : ''
  const i = id ? '会话 id：' + id : ''
  return wrap(nm(name) + '会话' + (g || i ? '（' + g + (g && i ? ' · ' : '') + i + '）' : ''))
}
export const noteText = (t: string, v: string): string => wrap(nm(t) + '：' + nest(v))
export const linkText = (l: QLink): string => wrap(nm(l.text) + '（' + l.url + '）')
/** 还在 =「标题（路径）」，已删除 =「标题（已删除：路径）」。 */
export const fileRef = (f: QFile): string => nm(fileTitle(f)) + '（' + (f.exists ? '' : '已删除：') + f.path + '）'
export const fileText = (f: QFile): string => wrap(fileRef(f))
export const repoText = (name: string, path: string): string => wrap(nm(name) + '（路径：' + path + '）')
export const cardText = (title: string, group: string): string => wrap(nm(title) + '（卡片组：' + nm(group) + '）卡片')

/**
 * v97：任务的引用文本 = 这条任务的「任务说明」全文（子任务同理）；没有说明才退回标题。
 * 不再拼「任务 N：标题 / 状态 / 类型 / 链接 / 文件 / 子任务」那一大段 —— 那些在详情里都看得到。
 */
export function taskText(c: QCard, ti: number, si?: number): string {
  const t = c.tasks[ti]
  if (!t) return ''
  if (si !== undefined) {
    const x = (t.subs ?? [])[si]
    if (!x) return ''
    return (x.note ?? '').trim() || x.text
  }
  return (t.note ?? '').trim() || t.text
}
/** 「>」/「》」引用触发：行首（本行的第一个字符）或空格后面。
 *  v117 修：原来行首只在「整段文字的第一行」才算（first 参数），所以任务说明是两行以上时，
 *  在第 2 行行首打「>」不会弹引用菜单 —— 用户看到的就是「>」留在正文里、胶囊没插进去（开工 5.2）。
 *  现在任意一行的行首都算；first 保留只为兼容调用方（单行输入框里它恒为 true）。 */
export function detectQuote(prefix: string, _first = true): { len: number; query: string } | null {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const ch = prefix[i]
    if (/\s/.test(ch)) return null
    if (ch !== '>' && ch !== '》') continue
    if (i === 0) return { len: prefix.length, query: prefix.slice(1) }
    const prev = prefix[i - 1]
    if (prev === ' ' || prev === '\u3000' || prev === '\u00a0') return { len: prefix.length - i + 1, query: prefix.slice(i + 1) }
    return null
  }
  return null
}

/* ── v154：文件引用原文的识别 / 改写 + 文件名归一（host 同步与修复、client 兜底共用一份） ── */

/** 文件引用原文：「“标题”（[已删除：]路径）」。 */
export const FILE_REF_RX = /「“([^”「」]*)”（(已删除：)?((?:\/|~\/)[^）「」]*)）」/g

/** 路径 / 文件名的最后一段（不依赖 model，避免循环依赖）。 */
export const refBase = (p: string): string => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/**
 * v154：文件名归一 key —— 只差空白（含全角空格）与连字符的名字视为同一个文件。
 * 「…严重 bug.mov」与「…严重-bug.mov」= 同一个 key（搬家净化名字的经典情形）；其它字符不折叠，防误配。
 */
export const refNameKey = (p: string): string =>
  refBase(p).normalize('NFC').toLowerCase().replace(/[\s\u3000]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')

/** v154：一条引用要换成的目标（title 缺省 = 文件名）。 */
export interface RefTarget { path: string; title?: string }

/**
 * v154（1.4）：卡内文件里按「当前路径 → 以前的路径（prev）→ 唯一同名 → 归一同名」找对应文件。
 * 任务说明 / 详情气泡 / 启动修复用同一口径；宿主已发出的消息、用户自己在 Finder 里挪的文件靠这一条兜住。
 */
export function findRefFile<T extends { path: string; prev?: string[] }>(files: readonly T[], path: string): T | null {
  const exact = files.find((f) => f.path === path)
  if (exact) return exact
  const prev = files.find((f) => (f.prev ?? []).includes(path))
  if (prev) return prev
  const b = refBase(path), same = files.filter((f) => refBase(f.path) === b)
  if (same.length === 1) return same[0]
  const key = refNameKey(path), near = files.filter((f) => refNameKey(f.path) === key)
  return near.length === 1 ? near[0] : null
}

/** v154：相关文件的显示名（自定义标题优先，否则文件名）。 */
export const refTitle = (f: { path: string; title?: string }): string => f.title || refBase(f.path)

/**
 * v154：按 pick 改写 text 里的文件引用原文；pick 返回 null 或同一路径 = 不动。
 * 保留原文的「已删除：」前缀 —— 它记录的是写这条引用时的状态。
 */
export function rewriteFileRefText(text: string, pick: (path: string, title: string) => RefTarget | null): { text: string; n: number } {
  let n = 0
  const out = text.replace(FILE_REF_RX, (m, title: string, del: string | undefined, path: string) => {
    const t = pick(path, title)
    if (!t || !t.path || t.path === path) return m
    n++
    return '「“' + (t.title || refBase(t.path)) + '”（' + (del ?? '') + t.path + '）」'
  })
  return { text: out, n }
}

