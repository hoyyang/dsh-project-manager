/**
 * v159：搜索界面渲染（结果栏 / 分组结果 / 空态 / 最近搜索卡片）。
 * 纯逻辑在 src/search.ts；这里只管 HTML（样式见 style.css 的 v158 / v159 段，与原型同一份规则）。
 */
import type { Card, Group, StateInfo } from './api.js'
import { esc } from './icons.js'
import { contentTotals, DIM_NAME, DIM_ORDER, dimCounts, filtered, model, parseQuery, rowDims, rowList, shownHits, snip, suggest, type ContentHit, type Dim, type DimF, type Entry, type Hit, type MemLink, type Row, type Scope, type SearchModel, type TypeF } from '../search.js'

export type { Row, Scope, TypeF } from '../search.js'
export type { LfInfo, SearchInput } from '../search.js'
import type { SearchInput } from '../search.js'

export interface RecentItem { q: string; at: number }
export interface SearchOpts { q: string; scope: Scope; type: TypeF; sel: number; openLf: Set<string>; recent: RecentItem[]; /** v178：命中维度筛选 */ dim: DimF; /** v178：展开「全部命中」的行（卡片 id） */ exp: Set<string> }
export interface SearchViewResult { html: string; rows: Row[]; ms: number }

export const RECENT_KEY = 'dpm-v158-recent'

/* ---------- 最近搜索（localStorage，最多 6 条） ---------- */
export function loadRecent(): RecentItem[] {
  try {
    const a: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    if (!Array.isArray(a)) return []
    const out: RecentItem[] = []
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      if (typeof x === 'string') out.push({ q: x, at: Date.now() - i * 60000 })
      else if (x && typeof (x as RecentItem).q === 'string') out.push({ q: (x as RecentItem).q, at: Number((x as RecentItem).at) || Date.now() })
    }
    return out.filter((x) => !!x.q.trim()).slice(0, 6)
  } catch { return [] }
}
export function saveRecent(list: RecentItem[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* 隐私模式 / 配额满：不记也不报错 */ }
}
export function rememberRecent(list: RecentItem[], q: string): RecentItem[] {
  const v = String(q == null ? '' : q).trim()
  if (v.length < 2) return list
  const next = [{ q: v, at: Date.now() }].concat(list.filter((x) => x.q !== v)).slice(0, 6)
  saveRecent(next)
  return next
}
export function forgetRecent(list: RecentItem[], q: string): RecentItem[] {
  const next = list.filter((x) => x.q !== q)
  saveRecent(next)
  return next
}
export function dropRecent(): RecentItem[] {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* 见上 */ }
  return []
}

const IC = {
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="m3.5 12.5 8.5 4.2 8.5-4.2M3.5 17l8.5 4.2 8.5-4.2"/></svg>',
  lf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2.4h9v9.6h-17z"/><path d="M3.5 9.5h17"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="7.4" stroke-dasharray="2 3"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6M3 12h18"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 5.4v3.4h3.4"/><path d="M5.2 8.8a7.6 7.6 0 1 1-1.1 5.4"/><path d="M12 7.6V12l3 1.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 13.7 9l5.3 1.8-5.3 1.8L12 18l-1.7-5.4L5 10.8 10.3 9z"/><path d="M19 3.5v3M17.5 5h3"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 6 6 6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  /* v178：五类内容 */
  task: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5h3v3h-3zM4.5 14.5h3v3h-3z"/><path d="M10.5 8h9M10.5 16h9"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4.5h13v15h-13z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.4 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7L12.6 17"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13 3.5V8h4.5"/></svg>',
  kb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5c2.6-.9 5.5-.9 7.5 1 2-1.9 4.9-1.9 7.5-1v13c-2.6-.9-5.5-.9-7.5 1-2-1.9-4.9-1.9-7.5-1z"/><path d="M12 6.5v13"/></svg>'
}
const DIM_IC: Record<string, string> = { task: 'task', note: 'note', link: 'link', file: 'file', kb: 'kb', title: 'card', lf: 'lf' }
/** v178：一条命中 = 来源标签 + 命中片段（命中字高亮，过长两头省略）。 */
export function hitHtml(h: ContentHit, cardId: string, max = 130): string {
  const s = snip(h.text, h.ranges, 24, max)
  let body = ''
  let at = 0
  for (const r of s.ranges) { body += esc(s.text.slice(at, r[0])) + '<mark>' + esc(s.text.slice(r[0], r[1])) + '</mark>'; at = r[1] }
  body += esc(s.text.slice(at))
  return '<button type="button" class="v178hit" data-v178hit="' + esc(cardId + '|' + h.fid) + '" title="在详情里打开这一条">'
    + '<span class="v178hd">' + esc(h.label) + '</span>'
    + '<span class="v178ht">' + (s.head ? '…' : '') + body + (s.tail ? '…' : '') + '</span>'
    + '<span class="v178go" aria-hidden="true">' + IC.chev + '</span></button>'
}
/** v178：卡片行里的「内容命中」段（计数 + 维度胶囊 + 命中片段 + 展开/收起）。 */
export function hitsHtml(r: Row, dim: DimF, exp: Set<string>): string {
  const all = shownHits(r, dim)
  const cardId = r.entry.id
  if (!all.length) return ''
  const open = exp.has(cardId)
  const per = new Map<string, number>()
  for (const h of all) per.set(h.dim, (per.get(h.dim) ?? 0) + 1)
  const chips = DIM_ORDER.filter((d) => per.get(d)).map((d) => '<span class="v178dc">' + esc(DIM_NAME[d]) + '<i>' + per.get(d) + '</i></span>').join('')
  const shown = open ? all : all.slice(0, 2)
  return '<div class="v178hits">'
    + '<div class="v178hh"><span class="v178cnt">内容命中 <b>' + all.length + '</b> 处</span>' + chips + '</div>'
    + shown.map((h) => hitHtml(h, cardId)).join('')
    + (all.length > 2 ? '<button type="button" class="v178more" data-v178exp="' + esc(cardId) + '" aria-expanded="' + open + '">' + (open ? '收起命中' : '展开全部 ' + all.length + ' 处命中') + '</button>' : '')
    + '</div>'
}
/** v178：命中维度筛选条（有搜索词才出现；0 命中的维度灰但不锁）。 */
export function dimBarHtml(q: string, counts: Record<DimF, number>, dim: DimF, pre: string): string {
  if (!q) return ''
  const items: Array<[DimF, string]> = [['all', '全部'], ...DIM_ORDER.map((d) => [d, DIM_NAME[d]] as [DimF, string])]
  return '<div class="v178dims" role="group" aria-label="命中维度：' + items.map((x) => x[1]).join(' / ') + '">'
    + '<span class="v178dl">命中维度</span>'
    + items.map((x) => '<button type="button" class="v178dm' + (dim === x[0] ? ' on' : '') + (counts[x[0]] ? '' : ' zero') + '" aria-pressed="' + (dim === x[0]) + '" data-v178dim="' + x[0] + '" title="' + esc(x[1] + '：' + counts[x[0]] + ' 张卡片') + '">' + esc(x[1]) + '<i>' + (counts[x[0]] ?? 0) + '</i></button>').join('')
    + (pre ? '<button type="button" class="v178pre" data-v178pre title="去掉「' + esc(pre + '：') + '」前缀，改回全部维度">输入前缀「' + esc(pre + '：') + '」<span aria-hidden="true">×</span><span class="sr-only">去掉前缀</span></button>' : '')
    + '</div>'
}
function rangesHtml(text: string, hit?: Hit): string {
  if (!hit || !hit.ranges.length) return esc(text)
  const src = hit.src != null ? hit.src : text
  const rs = hit.ranges.slice().sort((a, b) => a[0] - b[0])
  let out = ''
  let at = 0
  for (const r of rs) {
    const a = Math.max(at, Math.max(0, r[0]))
    const b = Math.min(src.length, Math.max(a, r[1]))
    if (b <= a) continue
    out += esc(src.slice(at, a)) + '<mark>' + esc(src.slice(a, b)) + '</mark>'
    at = b
  }
  return out + esc(src.slice(at))
}
function slugOfCell(k: string): string { return k.split('/')[1] ?? k }
function reason(r: Row): string {
  if (!r.labels.length) return ''
  const out: string[] = []
  for (const l of r.labels) {
    const t = l.lfKey ? '落盘项目「' + slugOfCell(l.lfKey) + '」' : l.label
    if (out.indexOf(t) < 0) out.push(t)
  }
  let txt = out.slice(0, 2).join(' · ')
  if (r.fuzzy) txt += (txt ? ' · ' : '') + '模糊'
  return txt ? '<span class="v158why" title="' + esc(txt) + '">' + esc(txt) + '</span>' : ''
}
function cardChips(r: Row): string {
  const mem = r.entry.mem ?? []
  if (!mem.length) return ''
  const hot: MemLink[] = []
  for (const m of mem) {
    let hit = !!r.fields['lf:' + m.key] || !!r.fields['lfp:' + m.key]
    for (let ai = 0; !hit; ai++) {
      if (!r.fields['lfa:' + m.key + ':' + ai]) break
      hit = true
    }
    if (hit) hot.push(m)
  }
  const list = hot.concat(mem.filter((m) => hot.indexOf(m) < 0)).slice(0, 2)
  const chips = list.map((m) => {
    const slug = slugOfCell(m.key)
    const title = slug + (m.from === 'group' ? '（来自卡片组）' : '') + (m.arch ? ' · 已归档' : '')
    return '<span class="v158chip' + (m.arch ? ' arch' : '') + '" title="' + esc(title) + '">' + IC.lf + '<span>' + rangesHtml(slug, r.fields['lf:' + m.key]) + '</span></span>'
  }).join('')
  return '<span class="v158lfs">' + chips + (mem.length > 2 ? '<span class="v158more">+' + (mem.length - 2) + '</span>' : '') + '</span>'
}
function badge(e: Entry): string {
  if (e.kind === 'card' || e.kind === 'group') {
    return (e.arch ? '<span class="v158b arch">已归档</span>' : '') + (e.card && e.card.pending ? '<span class="v158b">Pending</span>' : '')
  }
  return e.arch ? '<span class="v158b arch">已归档</span>' : '<span class="v158b live">活跃</span>'
}
function stageName(e: Entry): string {
  const c = e.card, g = e.group
  if (!c || !g) return '—'
  return g.statuses.find((s) => s.id === c.col)?.name ?? '—'
}
export function rowHtml(r: Row, i: number, sel: number, dim: DimF = 'all', exp: Set<string> = new Set()): string {
  const on = i === sel ? ' on' : ''
  const aria = ' role="option" aria-selected="' + (i === sel) + '" data-v158i="' + i + '" tabindex="-1"'
  if (r.entry.kind === 'card') {
    const e = r.entry, c = e.card as Card, g = e.group as Group, h = r.fields
    const total = c.tasks.length, done = c.tasks.filter((t) => t.done).length
    const task = total ? '任务 ' + done + '/' + total : '没有任务'
    return '<div class="v158r v158r-card' + on + '"' + aria + ' data-v158card-row="' + esc(c.id) + '">'
      + '<span class="v158ic">' + IC.card + '</span>'
      + '<span class="v158m"><span class="v158t"><span class="v158tt">' + rangesHtml(c.t, h.title) + '</span>' + badge(e) + '</span>'
      + '<span class="v158sub">' + rangesHtml(g.name, h.group) + '<i>·</i>' + rangesHtml(stageName(e), h.stage) + '<i>·</i>' + task + cardChips(r) + '</span></span>'
      + '<span class="v158side">' + (r.content && r.content.length ? '' : reason(r)) + '<button type="button" class="v158loc" data-v158loc="' + esc(c.id) + '" title="在板上定位" aria-label="在板上定位「' + esc(c.t) + '」">' + IC.pin + '</button><span class="v158go" aria-hidden="true">' + IC.chev + '</span><span class="v158ent" aria-hidden="true">↵</span></span>'
      + hitsHtml(r, dim, exp) + '</div>'
  }
  if (r.entry.kind === 'group') {
    const e = r.entry, g = e.group as Group, h = r.fields
    return '<div class="v158r v158r-group' + on + '"' + aria + ' data-v158group-row="' + esc(g.id) + '">'
      + '<span class="v158ic">' + IC.group + '</span>'
      + '<span class="v158m"><span class="v158t"><span class="v158tt">' + rangesHtml(g.name, h.title) + '</span>' + badge(e) + '</span>'
      + '<span class="v158sub">' + (e.n ?? 0) + ' 张卡片 · ' + (e.liveN ?? 0) + ' 张活跃</span></span>'
      + '<span class="v158side">' + reason(r) + '<button type="button" class="v158loc" data-v158loc="' + esc(g.id) + '" data-v158loc-group="1" title="在板上定位" aria-label="在板上定位卡片组「' + esc(g.name) + '」">' + IC.pin + '</button><span class="v158go" aria-hidden="true">' + IC.chev + '</span><span class="v158ent" aria-hidden="true">↵</span></span></div>'
  }
  const e = r.entry, lf = e.lf!, h = r.fields
  const aliases = lf.aliases.map((a, j) => '<span class="v158al">' + rangesHtml(a, h['alias:' + j]) + '</span>').join('<i>·</i>')
  return '<div class="v158r v158r-lf' + on + '"' + aria + ' data-v158lf-row="' + esc(e.key || '') + '">'
    + '<span class="v158ic">' + IC.lf + '</span>'
    + '<span class="v158m"><span class="v158t"><span class="v158tt"><span class="v158pj">' + rangesHtml(lf.project, h.project) + '<b>/</b></span>' + rangesHtml(lf.slug, h.title) + '</span>' + badge(e) + '</span>'
    + '<span class="v158sub v158stat">' + rangesHtml(lf.status || '（STATE 没有一行状态）', h.status) + '</span>'
    + '<span class="v158sub v158lfm">' + (aliases ? '<span class="v158als">' + aliases + '</span><i>·</i>' : '') + '更新于 ' + esc(lf.updated || '—') + '</span></span>'
    + '<span class="v158side"><span class="v158cnt">' + (e.linked ?? []).length + ' 张卡片</span><span class="v158chev" aria-hidden="true">' + IC.down + '</span></span></div>'
}
export function lfChildrenHtml(e: Entry, open: boolean): string {
  if (e.kind !== 'lf' || !open) return ''
  const linked = e.linked ?? []
  const rows = linked.slice(0, 8).map((x) => {
    const c = x.card
    return '<button type="button" class="v158lc" data-v158card="' + esc(c.id) + '"><span class="v158lct">' + esc(c.t) + '</span><span class="v158lcs">' + esc(x.group.name) + ' · ' + esc(stageName({ kind: 'card', card: c, group: x.group } as Entry)) + (x.from === 'group' ? ' · 来自卡片组' : '') + '</span>' + (c.archivedAt ? '<span class="v158b arch">已归档</span>' : '') + '<span class="v158lcg">打开' + IC.chev + '</span></button>'
  }).join('')
  return '<div class="v158lfc">' + rows + (linked.length > 8 ? '<div class="v158lcm">另有 ' + (linked.length - 8) + ' 张，去卡片组里看</div>' : '') + '</div>'
}
export function sectionsHtml(list: Row[], sel: number, type: TypeF, openLf: Set<string>, dim: DimF = 'all', exp: Set<string> = new Set()): string {
  const secs: Array<[Entry['kind'], string, string]> = [['card', '卡片', '标题 / 卡片组 / 阶段 / 落盘项目'], ['group', '卡片组', ''], ['lf', '落盘项目', '点一条展开它对应的卡片']]
  const idx = new Map<Row, number>()
  let n = 0
  for (const r of list) idx.set(r, n++)
  let out = ''
  for (const s of secs) {
    if (type !== 'all' && type !== s[0]) continue
    const arr = list.filter((r) => r.entry.kind === s[0])
    if (!arr.length) continue
    out += '<section class="v158-sec"><h3 class="v158-sh">' + IC[s[0]] + '<span>' + s[1] + '</span><em>' + arr.length + '</em><i></i>' + (s[2] ? '<span class="v158shx">' + s[2] + '</span>' : '') + '</h3><div class="v158-rows" role="listbox" aria-label="' + s[1] + '">'
      + arr.map((r) => {
        const i = idx.get(r) ?? 0
        const row = rowHtml(r, i, sel, dim, exp)
        if (r.entry.kind !== 'lf') return row
        const open = openLf.has(r.entry.key || '')
        return '<div class="v158lfb' + (open ? ' open' : '') + '">' + row + lfChildrenHtml(r.entry, open) + '</div>'
      }).join('')
      + '</div></section>'
  }
  return out
}
export function recentAgo(at: number): string {
  if (!at) return '之前'
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}
export function recentHtml(input: SearchInput, recent: RecentItem[]): string {
  if (!recent.length) return '<div class="v159rec-empty">' + IC.history + '<span>搜索过的词会出现在这里；点卡片可以再次搜索。</span></div>'
  const counts = new Map<string, number>()
  for (const it of recent) { try { counts.set(it.q, model(input, it.q).base.length) } catch { counts.set(it.q, 0) } }
  const cards = recent.map((it) => {
    const q = it.q, n = counts.get(q) ?? 0
    return '<div class="v159rec" role="button" tabindex="0" data-v158recent="' + esc(q) + '" aria-label="再次搜索 ' + esc(q) + '" title="再次搜索：' + esc(q) + '">'
      + '<span class="v159ric" aria-hidden="true">' + IC.history + '</span>'
      + '<span class="v159rm"><b title="' + esc(q) + '">' + esc(q) + '</b><span>' + (n ? '命中 ' + n + ' 项' : '没有任何命中') + '<i>·</i>' + recentAgo(it.at) + '</span></span>'
      + '<span class="v159rgo" aria-hidden="true">' + IC.chev + '</span>'
      + '<button type="button" class="v159rx" data-v158drop="' + esc(q) + '" aria-label="删除最近搜索 ' + esc(q) + '" title="删除这条">' + IC.clear + '</button>'
      + '</div>'
  }).join('')
  return '<section class="v159recs" aria-label="最近搜索"><div class="v159rech"><span class="v159recl">' + IC.history + '最近搜索<i>' + recent.length + '</i></span><span class="v159rechint">点卡片再搜 · 右上 × 删除</span><button type="button" class="v159recc" data-v158clear-recent title="清除全部最近搜索" aria-label="清除全部最近搜索">清除全部</button></div>'
    + '<div class="v159recg">' + cards + '</div></section>'
}
export function emptyHtml(input: SearchInput, recent: RecentItem[]): string {
  const ex = ['解析', '验证码', '归档 解析', 'dsh-project-manager-build', 'passwrd', '迁移']
  const n = contentTotals(input)
  const kbN = (input.kb ?? []).length
  const what: Array<[string, string, number, string, string]> = [
    ['task', '任务 / 子任务', n.task, '回归', '任务标题、子任务标题，以及它们的说明'],
    ['note', '相关说明', n.note, '风险', '说明的小标题和正文'],
    ['link', '相关链接', n.link, 'github', '链接文字、类型、标签和网址'],
    ['file', '相关文件', n.file, '录屏', '文件名和完整路径'],
    ['kb', '知识卡', n.kb, '冷启动', kbN ? '卡片的标题、摘要、标签（不搜正文）' : '知识卡列表还没加载，先按标题搜']
  ]
  return '<div class="v158-empty">'
    + '<div class="v158-ei">' + IC.search + '</div>'
    + '<h2>搜索整个项目看板</h2>'
    + '<p>按卡片标题、卡片组、阶段、落盘项目找卡片；也能<b>搜进卡片里的内容</b> —— 任务、子任务、相关说明、相关链接、相关文件、挂载的知识卡。<b>活跃的、归档的都在结果里</b>。</p>'
    + '<div class="v178what" aria-label="能搜什么">'
    + what.map((w) => '<div class="v178wc"><span class="v178wci">' + IC[w[0] as keyof typeof IC] + '</span>'
      + '<span class="v178wcm"><b>' + w[1] + '</b><span>已索引 ' + w[2] + ' 条（含归档）</span><em>' + esc(w[4]) + '</em></span>'
      + '<button type="button" class="v178wx" data-v158preset="' + esc(w[3]) + '" title="搜「' + esc(w[3]) + '」试试">试试「' + esc(w[3]) + '」</button></div>').join('')
    + '</div>'
    + '<div class="v158-ex"><span>试试</span>' + ex.map((q) => '<button type="button" class="v158p" data-v158preset="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>'
    + recentHtml(input, recent)
    + '<div class="v158-fields"><div class="v158-fh">' + IC.spark + '智能在哪<span class="v159-local">纯本地规则 · 不调用模型</span></div><ul>'
    + '<li><b>空格分词</b>：<code>归档 解析</code> = 同时包含两个词；不区分大小写、全半角、空格和连字符。</li>'
    + '<li><b>自动模糊</b>：<code>解析超时</code> 能命中「解析正则超时」；<code>passwrd</code> 能命中 password-* 的落盘项目（少写一个字母也行）。</li>'
    + '<li><b>搜进卡片内容</b>：任务 / 子任务标题与说明、相关说明、相关链接、相关文件、挂载知识卡都在索引里；结果会告诉你「命中哪一类、命中几处」，点一条直接跳进详情里那一项。</li>'
    + '<li><b>前缀定维</b>：<code>任务:</code> <code>子任务:</code> <code>说明:</code> <code>链接:</code> <code>文件:</code> <code>知识卡:</code> <code>标题:</code> <code>落盘项目:</code> 只在那一类里搜（全角冒号也认）。</li>'
    + '<li><b>落盘项目也是入口</b>：输入 slug、别名或状态里的词，能找回它对应的卡片（关联卡片全部归档 = 落盘项目也标为已归档）。</li>'
    + '<li><b>键盘直达</b>：<kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>⌥Enter</kbd> 在板上定位 · <kbd>Esc</kbd> 清空 / 退出。</li>'
    + '</ul></div>'
    + '<div class="v158-tips">点上面的例子直接开搜，或按 <kbd>⌘K</kbd> 随时回到这里。</div></div>'
}
export function noneHtml(q: string, m: SearchModel, scope: Scope, type: TypeF, contentN = { task: 0, sub: 0, note: 0, link: 0, file: 0, kb: 0, card: 0 }): string {
  const baseN = m.base.length
  const zero = '标题 0 · 任务 0 · 说明 0 · 链接 0 · 文件 0 · 知识卡 0 · 落盘项目 0'
  const totalContent = contentN.task + contentN.note + contentN.link + contentN.file + contentN.kb
  const sug = suggest(q, m.all, 2)
  const isFiltered = scope !== 'all' || type !== 'all'
  return '<div class="v158-empty v158-none">'
    + '<div class="v158-ei">' + IC.search + '</div>'
    + '<h2>没有找到「' + esc(q) + '」</h2>'
    + '<p>已搜索 <b>' + m.totals.card + '</b> 张卡片 · <b>' + m.totals.group + '</b> 个卡片组 · <b>' + m.totals.lf + '</b> 个落盘项目 · <b>' + totalContent + '</b> 条卡片内容（含归档）。' + (isFiltered && baseN ? '当前筛选还剩 <b>' + baseN + '</b> 项没显示。' : '') + '</p>'
    + '<p class="v178zero">' + zero + '</p>'
    + (sug.length ? '<div class="v158-sug"><span>你是不是想找</span>' + sug.map((s) => '<button type="button" class="v158p" data-v158sug="' + esc(s.e.titleText) + '">' + esc(s.e.titleText) + '</button>').join('') + '</div>' : '')
    + '<div class="v158-note"><b>可以试试</b><ul><li>少打几个字，或只搜最有辨识度的一两个词</li><li>搜落盘项目的 slug / 别名，例如 <code>autofill-ai-parser</code>、<code>验证码填充</code></li><li>只搜某一类：<code>任务:回归</code>、<code>文件:录屏</code>、<code>知识卡:冷启动</code></li><li>点「全部」范围，去掉活跃 / 归档或类型的限制</li></ul></div>'
    + '<div class="v158-na"><button type="button" class="v158p" data-v158clear>清除关键词</button>' + (isFiltered ? '<button type="button" class="v158p" data-v158all>查看全部范围' + (baseN ? '（' + baseN + '）' : '') + '</button>' : '') + '<button type="button" class="v158p" data-v158back>返回看板</button></div>'
    + '</div>'
}
export function headHtml(m: SearchModel, q: string, ms: number, browse: boolean, shown: number, scope: Scope, type: TypeF, dim: DimF = 'all', counts: Record<DimF, number> = { all: 0, title: 0, task: 0, note: 0, link: 0, file: 0, kb: 0, lf: 0 }, pre = '', contentN = { task: 0, sub: 0, note: 0, link: 0, file: 0, kb: 0, card: 0 }): string {
  const c = m.counts, t = m.typeCounts
  const fuzzyN = m.base.filter((r) => r.fuzzy).length
  const scopeName = scope === 'arch' ? '已归档' : scope === 'live' ? '活跃' : '全部'
  const sum = q
    ? '<span class="v158q">“' + esc(q) + '”</span><span class="v158n">' + shown + ' 项</span>'
    : browse ? '<span class="v158q">' + scopeName + '</span><span class="v158n">' + shown + ' 项</span>' : '<span class="v158q v158qs">标题 / 卡片组 / 落盘项目</span>'
  const chips = '<div class="v158-scope" role="tablist" aria-label="范围：全部 / 活跃 / 归档">'
    + ([['all', '全部', c.all], ['live', '活跃', c.live], ['arch', '归档', c.arch]] as Array<[Scope, string, number]>).map((x) => '<button type="button" role="tab" class="v158sc' + (scope === x[0] ? ' on' : '') + '" aria-selected="' + (scope === x[0]) + '" data-v158scope="' + x[0] + '">' + x[1] + '<i>' + x[2] + '</i></button>').join('') + '</div>'
  const types = '<div class="v158-types" role="group" aria-label="类型：全部 / 卡片 / 卡片组 / 落盘项目">'
    + ([['all', '全部', t.all], ['card', '卡片', t.card], ['group', '卡片组', t.group], ['lf', '落盘项目', t.lf]] as Array<[TypeF, string, number]>).map((x) => '<button type="button" class="v158ty' + (type === x[0] ? ' on' : '') + '" aria-pressed="' + (type === x[0]) + '" data-v158type="' + x[0] + '">' + x[1] + '<i>' + x[2] + '</i></button>').join('') + '</div>'
  return '<div class="v158-top"><div class="v158-sum" data-v158focus title="点击回到搜索框"><span class="v158sl">' + IC.search + '</span><span class="v158lbl">' + (q ? '搜索结果' : browse ? '浏览' : '搜索') + '</span>' + sum + (q || browse ? '<span class="v158ms" title="最后一次计算耗时">' + (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + ' ms</span>' : '') + (q ? '<span class="v158f v178cn" title="索引规模：卡片 ' + contentN.card + ' · 任务 ' + (contentN.task - contentN.sub) + ' · 子任务 ' + contentN.sub + ' · 说明 ' + contentN.note + ' · 链接 ' + contentN.link + ' · 文件 ' + contentN.file + ' · 知识卡 ' + contentN.kb + '（含归档）">内容 ' + (contentN.task + contentN.note + contentN.link + contentN.file + contentN.kb) + '</span>' : '') + (fuzzyN ? '<span class="v158f" title="包含子序列 / 容错匹配">模糊 ' + fuzzyN + '</span>' : '') + '</div>'
    + '<div class="v158-filters">' + chips + '<span class="v158div" aria-hidden="true"></span>' + types + '<span class="grow"></span>'
    + ((scope !== 'all' || type !== 'all' || dim !== 'all') ? '<button type="button" class="v158reset" data-v158all>重置筛选</button>' : '')
    + '<span class="v158ktip">空格分词 · 自动模糊' + (q ? ' · 搜进卡片内容' : '') + '</span><button type="button" class="v158back" data-v158back>' + IC.back + '返回看板</button></div>'
    + dimBarHtml(q, counts, dim, pre)
    + '<span class="sr-only" id="v158Live" aria-live="polite"></span></div>'
}
export function footHtml(q: string): string {
  return '<div class="v158-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开并定位 · <kbd>⌥Enter</kbd> 在板上定位 · <kbd>Esc</kbd> ' + (q ? '清空' : '退出') + ' · <kbd>⌘K</kbd> 聚焦</span><span class="v158frange">搜索范围：标题 / 卡片组 / 阶段 / 落盘项目 + 任务 / 子任务 / 说明 / 链接 / 文件 / 知识卡 · 活跃 + 归档</span></div>'
}
export function searchView(input: SearchInput, o: SearchOpts): SearchViewResult {
  const raw = String(o.q == null ? '' : o.q).trim()
  const pq = parseQuery(raw)
  const qv = pq.text
  const dim: DimF = o.dim ?? 'all'
  const exp = o.exp ?? new Set<string>()
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  const m = model(input, qv)
  const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0
  const browse = !raw && (o.scope !== 'all' || o.type !== 'all')
  const showEmpty = !raw && !browse
  const scopeType = filtered(m, o.scope, o.type)
  const counts = dimCounts(scopeType)
  const list = dim === 'all' ? scopeType : scopeType.filter((r) => rowDims(r).indexOf(dim as Dim) >= 0)
  const rows = rowList(list)
  const sel = Math.max(0, Math.min(rows.length - 1, o.sel))
  const ct = contentTotals(input)
  const contentN = { task: ct.task, sub: ct.sub, note: ct.note, link: ct.link, file: ct.file, kb: ct.kb, card: m.totals.card }
  let body: string
  if (showEmpty) body = emptyHtml(input, o.recent)
  else if (!list.length) body = noneHtml(qv, m, o.scope, o.type, contentN)
  else body = '<div class="v158-list">' + sectionsHtml(list, sel, o.type, o.openLf, dim, exp) + '</div>'
  return {
    html: '<div class="v158" role="region" aria-label="项目看板搜索结果" data-v158root>' + headHtml(m, qv, ms, browse, list.length, o.scope, o.type, dim, counts, pq.pre, contentN) + body + footHtml(qv) + '</div>',
    rows,
    ms
  }
}
