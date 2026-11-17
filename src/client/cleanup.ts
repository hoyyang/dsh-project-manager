/**
 * v180（0.75.0）清理关联文件 —— 项目看板标题区按钮 + 1160×780 大弹窗。
 *
 * 判定与体积全部来自 host（POST card/files-cleanup，判定唯一出处 src/cleanup.ts），
 * 界面只负责「按卡片分组 + 点选 / 三态全选 / 一键全选无用文件 / 删除并解除关联 / 仅解除关联 / 撤销」。
 *
 * 交互口径（设计卡 §四）：全选 = 三态复选框 + 「已选 N / M」（与「新增 / 编辑卡片任务 → 相关文件 → 多选」同一套），
 * 点勾上 = 全选当前列表；点取消 = 全不选（清空全部，含被筛掉的）；⌘A 同效。
 */
import { post, ApiError } from './api.js'
import { esc, ic } from './icons.js'

export type ClReason = 'arch' | 'active' | 'shared' | 'undone' | 'done'
export interface ClBind { id: string; text: string; done: boolean; sub: boolean }
export interface ClRow {
  key: string
  cardId: string
  cardTitle: string
  groupId: string
  groupName: string
  archived: boolean
  archivedAt: string
  fileId: string
  name: string
  path: string
  size: number
  exists: boolean
  binds: ClBind[]
  useless: boolean
  reason: ClReason
  pathActive: number
  pathUndone: number
  pathDone: number
  pathCards: number
}
export interface ClOutside { cardId: string; cardTitle: string; name: string; path: string; why: string }
export interface ClCounts { all: number; useless: number; done: number; arch: number; busy: number; missing: number }
export interface ClScan { rows: ClRow[]; outside: ClOutside[]; counts: ClCounts; uselessSize: number; totalSize: number }
export interface ClItem { key: string; cardId: string; file: { id: string; path: string }; index: number; tasks: string[]; trashed: string }
export interface ClHost { toast(msg: string, kind?: 'ok' | 'err'): void; refresh?(): void | Promise<void> }

type Filter = 'all' | 'useless' | 'done' | 'arch' | 'busy' | 'missing'
const FILTERS: Array<{ k: Filter; t: string }> = [
  { k: 'all', t: '全部' }, { k: 'useless', t: '无用文件' }, { k: 'done', t: '任务都完成' }, { k: 'arch', t: '已归档卡片' }, { k: 'busy', t: '还在用' }, { k: 'missing', t: '已丢失' },
]

const state: {
  open: boolean
  scan: ClScan | null
  err: string
  /* 老宿主（改 host 后没重启 DSH）→ 空态标题也别写「扫描失败」，改成「重启后可用」 */
  errRestart: boolean
  busy: boolean
  filter: Filter
  q: string
  sort: 'card' | 'size' | 'name'
  sel: Set<string>
  oos: boolean
  rules: boolean
  rulesAt: 'filter' | 'hint'
  confirm: '' | 'trash' | 'unlink'
  result: string
  undo: ClItem[] | null
  host: ClHost | null
  dlg: HTMLDialogElement | null
} = { open: false, scan: null, err: '', errRestart: false, busy: false, filter: 'all', q: '', sort: 'card', sel: new Set(), oos: false, rules: false, rulesAt: 'filter', confirm: '', result: '', undo: null, host: null, dlg: null }

let badgeCache: { at: number; n: number } | null = null

const fmt = (n: number): string => {
  let v = Number(n) || 0
  if (v <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return (i === 0 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i]
}
const baseName = (p: string): string => { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p }
const extOf = (name: string): string => { const m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : '' }

/* ── 入口按钮（项目看板标题区右侧，搜索框与「导入落盘项目」之间） ───────────────── */
export function cleanupBtnHtml(): string {
  return '<button type="button" class="btn dpm-cl-btn" data-cleanup aria-haspopup="dialog" title="批量清理卡片里的关联文件：点选 / 三态全选 / 只选无用文件；删除 = 移到废纸篓，可撤销">'
    + ic('broom') + '<span class="dpm-cl-btntxt">清理关联文件</span><b class="dpm-cl-bdg" data-cleanup-n aria-hidden="true">0</b></button>'
}

/** 徽标 = 无用文件数（30 秒缓存；打开弹窗 / 清理完会刷新）。 */
export async function refreshCleanupBadge(root: ParentNode = document, force = false): Promise<void> {
  if (!force && badgeCache && Date.now() - badgeCache.at < 30_000) { paintBadge(root); return }
  try {
    const r = await post<{ ok: boolean; scan: ClScan }>('card/files-cleanup', {})
    if (!r?.scan) return
    badgeCache = { at: Date.now(), n: r.scan.counts.useless }
    /* 弹窗开着时不重画列表：看板每 5 秒一轮快照，重画会把用户正在点的行换掉（选中 / 滚动 / 焦点都受影响）。
       弹窗自己的数据由 openCleanup / apply / undo 三条路径刷新。 */
    paintBadge(root)
  } catch { /* 老 host 没这条路由：徽标保持 0，点开才报错 */ }
}
function paintBadge(root: ParentNode): void {
  const n = badgeCache?.n ?? 0
  root.querySelectorAll<HTMLElement>('[data-cleanup-n]').forEach((el) => { el.textContent = String(n); el.classList.toggle('zero', n === 0) })
}

/* ── 扫描 / 过滤 / 选择 ─────────────────────────────────────────────────────── */
function rows(): ClRow[] { return state.scan?.rows ?? [] }
function counts(): ClCounts { return state.scan?.counts ?? { all: 0, useless: 0, done: 0, arch: 0, busy: 0, missing: 0 } }
function pass(r: ClRow): boolean {
  if (state.filter === 'useless' && !r.useless) return false
  if (state.filter === 'done' && r.reason !== 'done') return false
  if (state.filter === 'arch' && !r.archived) return false
  if (state.filter === 'busy' && r.useless) return false
  if (state.filter === 'missing' && r.exists) return false
  const q = state.q.trim().toLowerCase()
  if (!q) return true
  const hay = [r.name, r.path, r.cardTitle, r.groupName, ...r.binds.map((x) => x.text)].join(' ').toLowerCase()
  return hay.includes(q)
}
/* 排序只动「组内的行」：组头永远按卡片顺序（设计卡 A10）。
   全局 sort 会把组头也带着重排（实测：按体积 / 文件名时「已丢失卡 E」被推到最后、F 跳到第二），
   → 先按卡片分桶（rows() 本身就是卡片顺序），再桶内排序。 */
function order(list: ClRow[]): ClRow[] {
  const byCard = new Map<string, ClRow[]>()
  for (const r of list) { const a = byCard.get(r.cardId); if (a) a.push(r); else byCard.set(r.cardId, [r]) }
  const out: ClRow[] = []
  for (const arr of byCard.values()) {
    if (state.sort === 'size') arr.sort((a, b) => (b.size || 0) - (a.size || 0))
    else if (state.sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    out.push(...arr)
  }
  return out
}
function visible(): ClRow[] { return order(rows().filter(pass)) }
function pruneSel(): void {
  const keys = new Set(rows().map((r) => r.key))
  for (const k of [...state.sel]) if (!keys.has(k)) state.sel.delete(k)
}
function selRows(): ClRow[] { return rows().filter((r) => state.sel.has(r.key)) }
const canTrash = (r: ClRow): boolean => r.exists && r.pathCards <= 1
const selSize = (list: ClRow[]): number => list.reduce((n, r) => n + (r.exists ? (r.size || 0) : 0), 0)
const onlyUnlink = (list: ClRow[]): number => list.filter((r) => !canTrash(r)).length

/* ── 弹窗骨架 ───────────────────────────────────────────────────────────────── */
const RULES = '<h4>什么算「无用文件」</h4><ol>'
  + '<li><b>范围前提</b>：只统计<b>卡片关联的落盘项目文件夹里</b>的文件；桌面 / 仓库里的（不在落盘项目里）不在这个弹窗里处理。</li>'
  + '<li><b>没有任何未完成任务 / 子任务</b>关联它 —— 只要还有 1 个没完成的任务或子任务在用，就不算（卡片归档了也一样）。</li>'
  + '<li><b>没有任何未归档卡片</b>关联它 —— 只要还有一张活跃卡片挂着这个路径，就不算；判定按<b>路径</b>算，同一路径在几张卡片上算同一个文件。</li>'
  + '<li>两条都满足才算，所以实际只剩「<b>已归档卡片、且没人再用了</b>」的文件。</li>'
  + '</ol>'
  + '<h4 class="dpm-cl-rsplit">筛选「任务都完成」怎么算</h4><ol>'
  + '<li><b>行所在的卡片还没归档</b> —— 已归档的文件走「无用文件」那一栏。</li>'
  + '<li><b>这一行自己关联了至少 1 个已完成的任务 / 子任务</b>（只关联一个已完成的子任务也算）。</li>'
  + '<li><b>同一路径没有任何未完成任务 / 子任务</b> —— 按路径汇总，别的卡片上还有没做完的，这一整条路径都不进这个筛选。</li>'
  + '</ol><p class="dpm-cl-rsafe"><b>手动勾选不受上面限制</b>：任何一行都能自己勾。删除时会再挡一层 —— 已丢失 / 别处也在用且会打断的文件只解除关联、不删文件。这个筛选<b>不会</b>把文件算进「无用文件」，也不改入口徽标。</p>'
  + '<div class="dpm-cl-rfoot"><button type="button" class="btn sm" data-cl-rulesx>知道了</button></div>'

function build(): HTMLDialogElement {
  if (state.dlg) return state.dlg
  const d = document.createElement('dialog')
  d.className = 'dpm-dialog dpm-cl'
  d.setAttribute('aria-labelledby', 'dpmClT')
  d.innerHTML = '<div class="dpm-cl-shell">'
    + '<header class="dpm-cl-h">'
    + '<span class="dpm-cl-hic" aria-hidden="true">' + ic('broom') + '</span>'
    + '<div class="dpm-cl-hl"><h2 id="dpmClT">清理关联文件</h2><p>无用文件 = 已归档卡片上、没有任何未完成任务 / 活跃卡片在用的文件。删除 = 移到废纸篓并解除关联；只解除关联 = 文件不动。</p></div>'
    + '<div class="dpm-cl-hs">'
    + '<span class="dpm-cl-st"><b data-cl-hu>0</b><span>无用文件</span></span>'
    + '<span class="dpm-cl-st"><b data-cl-hc>0</b><span>张卡片</span></span>'
    + '<span class="dpm-cl-st"><b data-cl-hz>0 B</b><span>可释放</span></span>'
    + '</div>'
    + '<button type="button" class="dpm-cl-x" data-cl-x aria-label="关闭（Esc）" title="关闭（Esc）">' + ic('x') + '</button>'
    + '</header>'
    + '<div class="dpm-cl-tb">'
    + '<label class="dpm-cl-all" data-cl-alllab title="全选当前列表里的文件；再点一次 = 全不选（⌘A / Ctrl+A 同效）"><input type="checkbox" data-cl-allck aria-label="全选当前列表里的文件"><span>全选</span></label>'
    + '<span class="dpm-cl-seln" data-cl-seln>已选 <b>0</b> / 0</span>'
    + '<span class="dpm-cl-vs" aria-hidden="true"></span>'
    + '<button type="button" class="dpm-cl-smart" data-cl-smart aria-pressed="false">' + ic('check') + '<span data-cl-smartTxt>全选无用文件</span><b data-cl-smartN>0</b></button>'
    + '<span class="dpm-cl-grow"></span>'
    + '<div class="dpm-cl-q" data-cl-qwrap>' + ic('search')
    + '<input type="search" data-cl-q placeholder="搜文件名 / 路径 / 卡片 / 任务…" aria-label="搜索要清理的文件" autocomplete="off" spellcheck="false">'
    + '<kbd>⌘F</kbd><button type="button" class="dpm-cl-qc" data-cl-qc aria-label="清空搜索">' + ic('x') + '</button>'
    + '</div>'
    + '</div>'
    + '<div class="dpm-cl-fb">'
    + '<div class="dpm-cl-fs" role="group" aria-label="按条件筛选">'
    + FILTERS.map((f) => '<button type="button" class="dpm-cl-f" data-cl-f="' + f.k + '">' + f.t + '<b data-cl-fc-' + f.k + '>0</b></button>').join('')
    + '</div>'
    + '<span class="dpm-cl-grow"></span>'
    + '<label class="dpm-cl-sortl"><span>排序</span><select data-cl-sort>'
    + '<option value="card">按卡片</option><option value="size">体积从大到小</option><option value="name">文件名 A→Z</option>'
    + '</select></label>'
    + '<button type="button" class="dpm-cl-rulebtn" data-cl-rules aria-expanded="false" aria-haspopup="dialog">判定规则</button>'
    + '</div>'
    + '<div class="dpm-cl-fhint" data-cl-fhint hidden>' + ic('check') + '<span><b>任务都完成</b> = 卡片未归档 + 有已完成的任务 / 子任务 + 同一路径没有未完成任务 / 子任务；不改「无用文件」判定，筛出来由你手动清理。</span><button type="button" class="dpm-cl-fhintx" data-cl-fhintx>判定规则</button></div>'
    + '<div class="dpm-cl-wrap"><div class="dpm-cl-colh" aria-hidden="true"><span></span><span></span><span>文件</span><span>绑定的任务 / 子任务</span><span>判定</span><span>体积</span><span></span></div>'
    + '<div class="dpm-cl-list" data-cl-list role="listbox" aria-multiselectable="true" aria-label="在落盘项目里的卡片关联文件"></div></div>'
    + '<div class="dpm-cl-res" data-cl-res hidden></div>'
    + '<footer class="dpm-cl-fbar">'
    + '<span class="dpm-cl-sel" data-cl-sel>已选 <b>0</b> 个 · 约 0 B</span>'
    + '<span class="dpm-cl-hint">删除移到系统废纸篓，可撤销 / 只解除关联不动文件</span>'
    + '<span class="dpm-cl-grow"></span>'
    + '<button type="button" class="btn" data-cl-unlink disabled>' + ic('unlink') + ' 仅解除关联</button>'
    + '<button type="button" class="btn danger" data-cl-trash disabled>' + ic('trash') + ' 删除并解除关联</button>'
    + '</footer>'
    + '<div class="dpm-cl-cf" data-cl-cf hidden></div>'
    + '<div class="dpm-cl-rules" data-cl-rulesp hidden></div>'
    + '</div>'
  d.addEventListener('click', (e) => void onClick(e))
  d.addEventListener('change', (e) => onChange(e))
  d.addEventListener('input', (e) => { const t = e.target as HTMLElement; if (t.matches('[data-cl-q]')) { state.q = (t as HTMLInputElement).value; paintList(); paintChrome() } })

  d.addEventListener('cancel', (e) => {
    if (state.confirm || state.rules) { e.preventDefault(); if (state.confirm) closeConfirm(); else toggleRules(false) }
  })
  d.addEventListener('close', () => { state.open = false; document.removeEventListener('keydown', onKey, true); state.confirm = ''; state.rules = false; const p = $('[data-cl-cf]'); if (p) p.hidden = true; const r = $('[data-cl-rulesp]'); if (r) r.hidden = true })
  document.body.appendChild(d)
  state.dlg = d
  return d
}
const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null => state.dlg ? state.dlg.querySelector<T>(s) : null
const $$ = <T extends HTMLElement = HTMLElement>(s: string): T[] => state.dlg ? [...state.dlg.querySelectorAll<T>(s)] : []

export async function openCleanup(host: ClHost): Promise<void> {
  state.host = host
  state.open = true
  const d = build()
  /* 每次打开都从「没选任何文件」开始：选择集是危险状态（一点删除就落到文件上），
     关掉再打开时保留上次的勾选很容易误删。筛选 / 搜索 / 排序保留（那是阅读位置）。 */
  state.sel.clear()
  state.confirm = ''
  const cf0 = d.querySelector('[data-cl-cf]') as HTMLElement | null
  if (cf0) { cf0.hidden = true; cf0.innerHTML = '' }
  if (!d.open) d.showModal()
  document.addEventListener('keydown', onKey, true)
  if (!state.scan) { state.busy = true; paintList() }
  paintChrome()
  await load(true)
  setTimeout(() => { const q = $('[data-cl-q]') as HTMLInputElement | null; if (q && !state.q) q.focus({ preventScroll: true }) }, 60)
}

async function load(force: boolean): Promise<void> {
  state.busy = true
  state.err = ''
  state.errRestart = false
  const d = state.dlg
  try {
    const r = await post<{ ok: boolean; scan: ClScan }>('card/files-cleanup', {})
    if (!r?.scan) throw new Error('扫描没有返回数据')
    state.scan = r.scan
    badgeCache = { at: Date.now(), n: r.scan.counts.useless }
    pruneSel()
  } catch (e) {
    /* 老宿主没有这条路由（改 host 后必须重启 DSH 才生效）：别把「未知动作 card/files-cleanup」糊到用户脸上 */
    state.errRestart = e instanceof ApiError && e.code === 'NOT_FOUND'
    state.err = state.errRestart
      ? '这个功能要重启 DSH 才生效：宿主还在跑旧代码，没加载「清理关联文件」这条接口。重启后再点一次这个按钮即可。'
      : e instanceof ApiError ? e.message : String(e)
  } finally { state.busy = false }
  if (d) { paintList(); paintChrome(); paintResult() }
  if (force) paintBadge(document)
}

/* ── 渲染 ─────────────────────────────────────────────────────────────────── */
function reasonOf(r: ClRow): { cls: string; ico: string; t: string; tip: string } {
  if (r.reason === 'arch') return { cls: 'green', ico: ic('check'), t: '无用文件', tip: '引用它的卡片全都已归档，也没有任何未完成任务 / 子任务在用 → 可以清理' }
  if (r.reason === 'done') {
    const n = r.binds.length
    const noun = r.binds.every((x) => x.sub) ? '子任务' : (r.binds.every((x) => !x.sub) ? '任务' : '任务 / 子任务')
    const extra = r.pathDone > n ? '（同一路径共 ' + r.pathDone + ' 个已完成）' : ''
    return { cls: 'tdone', ico: ic('check'), t: '任务都完成', tip: '卡片还没归档，但关联它的 ' + n + ' 个' + noun + (n > 1 ? '都' : '') + '已完成，同一路径也没有任何未完成任务 / 子任务在用 → 可以手动清理' + extra + '（不会自动算无用）' }
  }
  if (r.reason === 'active') return { cls: 'gray', ico: ic('minus'), t: '卡片未归档', tip: '这张卡片还没归档，它挂着的文件不自动算无用（想清理可以手动勾）' }
  if (r.reason === 'shared') return { cls: 'warn', ico: ic('alert'), t: '活跃卡片也在用', tip: '同一路径还被 ' + r.pathActive + ' 张未归档卡片挂着，删了会连带打断它们 → 不自动算无用' }
  const list = r.binds.filter((x) => !x.done)
  const names = list.slice(0, 3).map((x) => (x.sub ? '子任务' : '任务') + '「' + x.text + '」').join('、')
  return { cls: 'blue', ico: ic('minus'), t: '还有未完成任务', tip: list.length ? '还有 ' + list.length + ' 个未完成任务 / 子任务在用它：' + names : '这个路径还有未完成任务在用' }
}
function bindChip(b: ClBind): string {
  const tip = (b.sub ? '子任务' : '任务') + '：' + b.text + (b.done ? '（已完成）' : '（未完成）')
  const label = (b.sub ? '子·' : '') + b.text
  return '<span class="dpm-cl-bc' + (b.done ? '' : ' wait') + (b.sub ? ' sub' : '') + '" title="' + esc(tip) + '"><i></i>' + esc(label.length > 20 ? label.slice(0, 19) + '…' : label) + '</span>'
}
function rowHtml(r: ClRow): string {
  const on = state.sel.has(r.key)
  const rs = reasonOf(r)
  const ext = extOf(r.name)
  const stt = (!r.exists ? '<em class="dpm-cl-stt" title="文件已经不在磁盘上：只能解除关联">已丢失</em>' : '')
    + (r.pathCards > 1 ? '<em class="dpm-cl-stt" title="别的卡片也在用同一路径：删除会连带打断它，所以只解除关联">别处也在用</em>' : '')
  const binds = r.binds.slice(0, 2).map(bindChip).join('') + (r.binds.length > 2 ? '<span class="dpm-cl-bc more">+' + (r.binds.length - 2) + '</span>' : '')
  const tip = r.binds.length ? r.binds.map((x) => (x.sub ? '子任务' : '任务') + '：' + x.text + (x.done ? '（已完成）' : '（未完成）')).join('\n') : '没有绑定任何任务（只关联卡片）'
  return '<div class="dpm-cl-r' + (on ? ' on' : '') + (r.binds.length ? '' : ' nob') + '" data-cl-row="' + esc(r.key) + '" role="option" aria-selected="' + on + '">'
    + '<input class="dpm-cl-ck" type="checkbox" data-cl-ck="' + esc(r.key) + '"' + (on ? ' checked' : '') + ' aria-label="选择「' + esc(r.name) + '」（' + esc(r.cardTitle) + '）">'
    + '<span class="dpm-cl-ft ' + esc(ext) + '" aria-hidden="true">' + esc((ext || '?').slice(0, 4).toUpperCase()) + '</span>'
    + '<span class="dpm-cl-fn"><span class="dpm-cl-nm"><span title="' + esc(r.name) + '">' + esc(r.name) + '</span>' + stt + '</span><span class="dpm-cl-pth" title="' + esc(r.path) + '">' + esc(r.path) + '</span></span>'
    + '<span class="dpm-cl-bd" title="' + esc(tip) + '">' + (binds || '<span class="dpm-cl-bc" style="border:0;background:transparent;padding:0">—</span>') + '</span>'
    + '<span class="dpm-cl-rsx"><span class="dpm-cl-rsn ' + rs.cls + '" title="' + esc(rs.tip) + '">' + rs.ico + esc(rs.t) + '</span></span>'
    + '<span class="dpm-cl-sz">' + (r.exists ? fmt(r.size) : '—') + '</span>'
    + '<button type="button" class="dpm-cl-rowact" data-cl-reveal="' + esc(r.key) + '" title="在访达中显示" aria-label="在访达中显示「' + esc(r.name) + '」">' + ic('folder') + '</button>'
    + '</div>'
}
function listHtml(): string {
  if (state.err) return '<div class="dpm-cl-empty"><span class="dpm-cl-eic">' + ic(state.errRestart ? 'broom' : 'alert') + '</span><b>' + (state.errRestart ? '重启后可用' : '扫描失败') + '</b><p>' + esc(state.err) + '</p></div>'
  if (state.busy && !state.scan) return '<div class="dpm-cl-empty"><span class="dpm-cl-eic">' + ic('broom') + '</span><b>正在扫描关联文件…</b><p>只读扫描落盘项目文件夹，不会改动任何文件。</p></div>'
  if (!rows().length) return '<div class="dpm-cl-empty"><span class="dpm-cl-eic">' + ic('file') + '</span><b>还没有卡片关联文件</b><p>在卡片详情里「添加相关文件」之后，这里就会出现可清理的清单。</p></div>'
  const list = visible()
  if (!list.length) {
    if (state.filter === 'done' && counts().done === 0) {
      const u = counts().useless
      return '<div class="dpm-cl-empty"><span class="dpm-cl-eic">' + ic('check') + '</span><b>没有「任务都完成」的文件</b><p>筛选条件 = 卡片还没归档 + 关联过已完成的任务 / 子任务 + 同一路径没有未完成任务 / 子任务在用。把任务都勾完之后，关联的文件会出现在这里。</p>'
        + (u ? '<button type="button" class="btn sm" data-cl-tou>去看 ' + u + ' 个无用文件</button>' : '<button type="button" class="btn sm" data-cl-clear>清掉筛选和搜索</button>') + '</div>'
    }
    if (state.filter === 'useless' && counts().useless === 0) return '<div class="dpm-cl-empty ok"><span class="dpm-cl-eic">' + ic('check') + '</span><b>没有可清理的无用文件</b><p>「只在已归档卡片上、没有未完成任务、也没有活跃卡片在用」的文件都清空了。活跃卡片的文件不会自动算无用。</p></div>'
    return '<div class="dpm-cl-empty"><span class="dpm-cl-eic">' + ic('search') + '</span><b>没有匹配的文件</b><p>换个关键词，或清掉筛选条件。</p><button type="button" class="btn sm" data-cl-clear>清掉筛选和搜索</button></div>'
  }
  const groups: Array<{ id: string; title: string; group: string; arch: boolean; at: string; rows: ClRow[] }> = []
  const map = new Map<string, ClRow[]>()
  for (const r of list) { const a = map.get(r.cardId); if (a) a.push(r); else { map.set(r.cardId, [r]); groups.push({ id: r.cardId, title: r.cardTitle, group: r.groupName, arch: r.archived, at: r.archivedAt, rows: map.get(r.cardId) as ClRow[] }) } }
  let html = groups.map((g) => {
    const nU = g.rows.filter((r) => r.useless).length
    const all = g.rows.every((r) => state.sel.has(r.key))
    return '<section class="dpm-cl-g" data-cl-g="' + esc(g.id) + '">'
      + '<header class="dpm-cl-gh">'
      + '<input class="dpm-cl-gcb" type="checkbox" data-cl-gall="' + esc(g.id) + '" aria-label="全选卡片「' + esc(g.title) + '」里当前列出的文件"' + (all ? ' checked' : '') + '>'
      + '<span class="dpm-cl-gt" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
      + '<span class="dpm-cl-gc">' + esc(g.group) + '</span>'
      + (g.arch ? '<span class="dpm-cl-gtag">' + ic('archive') + '已归档' + (g.at ? ' ' + esc(g.at.slice(0, 10)) : '') + '</span>' : '')
      + '<span class="dpm-cl-gn">' + g.rows.length + ' 个文件' + (nU ? ' · <b>' + nU + ' 个无用</b>' : '') + '</span>'
      + '<span class="dpm-cl-grow"></span>'
      + '<button type="button" class="dpm-cl-gsel" data-cl-gsel="' + esc(g.id) + '">' + (all ? '取消此卡' : '全选此卡') + '</button>'
      + '</header>' + g.rows.map(rowHtml).join('')
      + '</section>'
  }).join('')
  const out = state.scan?.outside ?? []
  if (out.length) {
    html += '<button type="button" class="dpm-cl-oos" data-cl-oos aria-expanded="' + (state.oos ? 'true' : 'false') + '">' + ic('chev') + '另有 <b>' + out.length + '</b> 个关联文件不在落盘项目里（这个功能不动它们）<span class="dpm-cl-grow"></span></button>'
    if (state.oos) html += '<div class="dpm-cl-oosl">' + out.slice(0, 100).map((x) => '<div class="dpm-cl-oosr"><b>' + esc(x.name) + '</b><span title="' + esc(x.path) + '">' + esc(x.path) + '</span><em>' + esc(x.why) + '</em></div>').join('') + '</div>'
  }
  return html
}
function paintList(): void {
  const list = $('[data-cl-list]')
  if (!list) return
  const sc = list.scrollTop
  list.innerHTML = listHtml()
  list.scrollTop = sc
  // 组复选框三态
  const vis = visible()
  $$('[data-cl-gall]').forEach((cb) => {
    const id = (cb as HTMLInputElement).getAttribute('data-cl-gall') as string
    const rr = vis.filter((r) => r.cardId === id)
    const on = rr.filter((r) => state.sel.has(r.key)).length
    ;(cb as HTMLInputElement).indeterminate = on > 0 && on < rr.length
  })
  if (state.rules) placeRules()
}
function paintChrome(): void {
  if (!state.dlg) return
  const c = counts()
  const set = (s: string, v: string): void => { const el = $(s); if (el) el.textContent = v }
  set('[data-cl-hu]', String(c.useless))
  set('[data-cl-hc]', String(new Set(rows().map((r) => r.cardId)).size))
  set('[data-cl-hz]', fmt(state.scan?.uselessSize ?? 0))
  for (const f of FILTERS) {
    set('[data-cl-fc-' + f.k + ']', String(c[f.k]))
    const chip = $('[data-cl-f="' + f.k + '"]')
    if (chip) { chip.classList.toggle('on', state.filter === f.k); chip.setAttribute('aria-pressed', String(state.filter === f.k)) }
  }
  const fh = $('[data-cl-fhint]')
  if (fh) fh.hidden = state.filter !== 'done'
  if (state.rules && state.rulesAt === 'hint' && fh?.hidden) toggleRules(false)
  const vis = visible()
  const on = vis.filter((r) => state.sel.has(r.key)).length
  const ck = $('[data-cl-allck]') as HTMLInputElement | null
  if (ck) { ck.disabled = vis.length === 0; ck.checked = vis.length > 0 && on === vis.length; ck.indeterminate = on > 0 && on < vis.length }
  const lab = $('[data-cl-alllab]')
  if (lab) lab.title = !vis.length ? '当前列表是空的' : (on === vis.length ? '取消勾选 = 全不选（清空全部选择，含被筛选掉的）' : '勾上 = 全选当前列表里的 ' + vis.length + ' 个文件（⌘A / Ctrl+A 同效）')
  set('[data-cl-seln]', '已选 ' + on + ' / ' + vis.length)
  const seln = $('[data-cl-seln]')
  if (seln) seln.innerHTML = '已选 <b>' + on + '</b> / ' + vis.length
  const us = rows().filter((r) => r.useless)
  const allU = us.length > 0 && us.every((r) => state.sel.has(r.key))
  const smart = $('[data-cl-smart]') as HTMLButtonElement | null
  if (smart) {
    smart.disabled = us.length === 0
    smart.setAttribute('aria-pressed', String(allU))
    smart.title = c.useless === 0 ? '当前没有符合「无用文件」规则的文件' : allU ? '再点一次 = 取消这些无用文件的选择' : '按判定规则把 ' + c.useless + ' 个无用文件一次选中（不受筛选影响）'
  }
  set('[data-cl-smartTxt]', c.useless === 0 ? '没有无用文件' : allU ? '取消全选无用文件' : '全选无用文件')
  set('[data-cl-smartN]', String(c.useless))
  const qw = $('[data-cl-qwrap]')
  if (qw) qw.classList.toggle('has', !!state.q)
  const q = $('[data-cl-q]') as HTMLInputElement | null
  if (q && q.value !== state.q) q.value = state.q
  const s = $('[data-cl-sort]') as HTMLSelectElement | null
  if (s && s.value !== state.sort) s.value = state.sort
  const list = selRows()
  const hidden = list.filter((r) => !vis.some((x) => x.key === r.key)).length
  const un = onlyUnlink(list)
  const sel = $('[data-cl-sel]')
  if (sel) sel.innerHTML = '已选 <b>' + list.length + '</b> 个 · 约 ' + fmt(selSize(list)) + ' · 覆盖 ' + new Set(list.map((r) => r.cardId)).size + ' 张卡片'
    + (list.length ? ' · 其中 <span class="dpm-cl-extra">' + un + ' 个只能解除关联</span>' : '')
    + (hidden ? ' <span class="dpm-cl-dim">（' + hidden + ' 个不在当前列表）</span>' : '')
  const n = state.sel.size
  for (const s2 of ['[data-cl-unlink]', '[data-cl-trash]'] as const) { const b = $(s2) as HTMLButtonElement | null; if (b) b.disabled = n === 0 }
  const tr = $('[data-cl-trash]')
  if (tr) tr.title = n === 0 ? '先勾选要清理的文件' : '把可删的移到废纸篓并解除关联；已丢失 / 别处也在用的只解除关联'
}
/* 只刷新「选中态」：不重建列表 —— 每次点勾选都重建 130 行会很重，而且会把用户刚点的节点换掉
   （快速连点两个复选框时第二下会落在被替换的节点上）。 */
function paintSelOnly(): void {
  const d = state.dlg
  if (!d) return
  const vis = visible()
  d.querySelectorAll<HTMLElement>('[data-cl-row]').forEach((el) => {
    const k = el.getAttribute('data-cl-row') as string
    const on = state.sel.has(k)
    el.classList.toggle('on', on)
    el.setAttribute('aria-selected', String(on))
    const cb = el.querySelector<HTMLInputElement>('[data-cl-ck]')
    if (cb) cb.checked = on
  })
  d.querySelectorAll<HTMLInputElement>('[data-cl-gall]').forEach((cb) => {
    const id = cb.getAttribute('data-cl-gall') as string
    const rr = vis.filter((r) => r.cardId === id)
    const on = rr.filter((r) => state.sel.has(r.key)).length
    cb.checked = rr.length > 0 && on === rr.length
    cb.indeterminate = on > 0 && on < rr.length
  })
  d.querySelectorAll<HTMLElement>('[data-cl-gsel]').forEach((b) => {
    const id = b.getAttribute('data-cl-gsel') as string
    const rr = vis.filter((r) => r.cardId === id)
    b.textContent = rr.length > 0 && rr.every((r) => state.sel.has(r.key)) ? '取消此卡' : '全选此卡'
  })
  paintChrome()
}
function paintAll(): void { paintList(); paintChrome(); paintResult() }
function paintResult(): void {
  const el = $('[data-cl-res]')
  if (!el) return
  if (!state.result) { el.hidden = true; el.innerHTML = ''; return }
  el.hidden = false
  el.innerHTML = ic('check') + '<span>' + esc(state.result) + '</span><button type="button" class="dpm-cl-undo" data-cl-undo>' + ic('undo') + ' 撤销</button>'
}

/* ── 动作 ─────────────────────────────────────────────────────────────────── */
function toast(msg: string, kind?: 'ok' | 'err'): void { state.host?.toast(msg, kind) }
function selectVisible(): void {
  const vis = visible()
  const all = vis.length > 0 && vis.every((r) => state.sel.has(r.key))
  if (all) state.sel.clear(); else for (const r of vis) state.sel.add(r.key)
  paintSelOnly()
  toast(all ? '已取消当前列表 ' + vis.length + ' 个的选择' : '已选中当前列表里的 ' + vis.length + ' 个文件', 'ok')
}
function selectGroup(id: string, on: boolean): void {
  for (const r of visible().filter((x) => x.cardId === id)) { if (on) state.sel.add(r.key); else state.sel.delete(r.key) }
}
function smartToggle(): void {
  const us = rows().filter((r) => r.useless)
  if (!us.length) { toast('当前没有符合「无用文件」规则的文件', 'ok'); return }
  const all = us.every((r) => state.sel.has(r.key))
  if (all) { for (const r of us) state.sel.delete(r.key); toast('已取消 ' + us.length + ' 个无用文件的选择', 'ok') }
  else { for (const r of us) state.sel.add(r.key); toast('已一键选中 ' + us.length + ' 个无用文件（' + new Set(us.map((r) => r.cardId)).size + ' 张卡片，约 ' + fmt(selSize(us)) + '）', 'ok') }
  paintSelOnly()
}
function openConfirm(mode: 'trash' | 'unlink'): void {
  if (!state.sel.size) { toast('先勾选要清理的文件', 'err'); return }
  state.confirm = mode
  const cf = $('[data-cl-cf]')
  if (!cf) return
  cf.hidden = false
  cf.innerHTML = confirmHtml(mode)
  setTimeout(() => { const b = cf.querySelector('[data-cl-cok]') as HTMLButtonElement | null; if (b) b.focus({ preventScroll: true }) }, 30)
}
function closeConfirm(): void { state.confirm = ''; const cf = $('[data-cl-cf]'); if (cf) { cf.hidden = true; cf.innerHTML = '' } }
function confirmHtml(mode: 'trash' | 'unlink'): string {
  const list = selRows()
  const trashRows = mode === 'trash' ? list.filter(canTrash) : []
  const unRows = mode === 'trash' ? list.filter((r) => !canTrash(r)) : list
  const trashSize = trashRows.reduce((n, r) => n + (r.size || 0), 0)
  const taskN = new Set(list.flatMap((r) => r.binds.map((b) => r.cardId + '|' + b.id))).size
  const archCards = new Set(list.filter((r) => r.archived).map((r) => r.cardId)).size
  const cards = new Set(list.map((r) => r.cardId)).size
  const title = mode === 'trash' ? (trashRows.length ? '删除 ' + trashRows.length + ' 个文件并解除关联？' : '解除 ' + list.length + ' 个文件的关联？') : '仅解除 ' + list.length + ' 个文件的关联？'
  const lead = mode === 'trash'
    ? '删除 = 把这些文件从落盘项目里移到系统废纸篓；解除关联 = 从 ' + cards + ' 张卡片' + (taskN ? '和 ' + taskN + ' 个任务' : '') + '里移除登记。'
    : '只移除卡片 / 任务上的文件登记，文件本身留在落盘项目里不动。'
  const lines: string[] = []
  if (mode === 'trash') {
    lines.push('<div class="dpm-cl-cfli"><i class="dpm-cl-dot"></i><b>' + trashRows.length + '</b> 个移到废纸篓 · <b>' + fmt(trashSize) + '</b></div>')
    if (unRows.length) lines.push('<div class="dpm-cl-cfli warn"><i class="dpm-cl-dot"></i><b>' + unRows.length + '</b> 个只解除关联（' + [unRows.some((r) => !r.exists) ? '已丢失' : '', unRows.some((r) => r.pathCards > 1) ? '别的卡片也在用' : ''].filter(Boolean).join(' / ') + '）</div>')
  } else lines.push('<div class="dpm-cl-cfli"><i class="dpm-cl-dot"></i><b>' + list.length + '</b> 个解除关联 · 文件不动</div>')
  if (taskN) lines.push('<div class="dpm-cl-cfli mute"><i class="dpm-cl-dot"></i>同时解除 <b>' + taskN + '</b> 个任务 / 子任务的绑定</div>')
  if (archCards) lines.push('<div class="dpm-cl-cfli mute"><i class="dpm-cl-dot"></i>其中 <b>' + archCards + '</b> 张是已归档卡片（只动文件登记，卡片内容只读不变）</div>')
  const names = list.slice(0, 8).map((r) => '<div class="dpm-cl-cfn"><span title="' + esc(r.path) + '">' + esc(r.name) + '</span><em>' + esc(r.cardTitle) + '</em></div>').join('')
  const more = list.length > 8 ? '<div class="dpm-cl-cfn"><span>…还有 ' + (list.length - 8) + ' 个</span><em></em></div>' : ''
  return '<div class="dpm-cl-cfw" role="alertdialog" aria-labelledby="dpmClCfT">'
    + '<div class="dpm-cl-cfh"><h3 id="dpmClCfT">' + esc(title) + '</h3><p>' + esc(lead) + '</p></div>'
    + '<div class="dpm-cl-cfb">' + lines.join('')
    + (mode === 'trash' ? '<p class="dpm-cl-cfnote">删除后可以在提示条上点 <b>撤销</b> 把文件从废纸篓放回原处、关联一并恢复；任务说明里对这些文件的引用会显示成「已不在」。</p>'
      : '<p class="dpm-cl-cfnote">随时可以在提示条上点 <b>撤销</b> 恢复这些关联（文件本身没动）；任务说明里对这些文件的引用会显示成「已不在」。</p>')
    + '<div class="dpm-cl-cfnames">' + names + more + '</div></div>'
    + '<div class="dpm-cl-cff"><span class="dpm-cl-grow"></span><button type="button" class="btn" data-cl-ccancel>取消</button>'
    + '<button type="button" class="btn danger" data-cl-cok>' + (mode === 'trash' ? '确认删除并解除关联' : '确认仅解除关联') + '</button></div></div>'
}
async function apply(): Promise<void> {
  const mode = state.confirm
  if (!mode || state.busy) return
  const keys = [...state.sel]
  if (!keys.length) { closeConfirm(); return }
  state.busy = true
  try {
    const r = await post<{ ok: boolean; result: { mode: string; items: ClItem[]; trashed: number; unlinked: number } }>('card/files-cleanup-apply', { mode, keys })
    const res = r?.result
    if (!res) throw new Error('没有返回结果')
    state.undo = res.items
    state.result = mode === 'trash'
      ? '已删除 ' + res.trashed + ' 个文件（移到废纸篓）并解除关联' + (res.unlinked ? '，另有 ' + res.unlinked + ' 个只解除关联' : '') + ' · 释放 ' + fmt(res.items.filter((x) => x.trashed).reduce((n, x) => n + (rows().find((r2) => r2.key === x.key)?.size ?? 0), 0))
      : '已解除 ' + res.items.length + ' 个文件关联（文件本身没动）'
    state.sel.clear()
    closeConfirm()
    await load(false)
    paintResult()
    toast(state.result + ' · 可撤销', 'ok')
    await state.host?.refresh?.()
    await refreshCleanupBadge(document, true)
  } catch (e) {
    toast(e instanceof ApiError ? e.message : String(e), 'err')
    state.busy = false
  } finally { state.busy = false }
}
async function undo(): Promise<void> {
  if (!state.undo?.length) return
  state.busy = true
  try {
    await post('card/files-cleanup-undo', { items: state.undo })
    state.undo = null
    state.result = ''
    await load(false)
    paintResult()
    toast('已撤销：文件从废纸篓放回原处，关联与任务绑定一起恢复', 'ok')
    await state.host?.refresh?.()
    await refreshCleanupBadge(document, true)
  } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'err') } finally { state.busy = false }
}
function toggleRules(on?: boolean, at?: 'filter' | 'hint'): void {
  const p = $('[data-cl-rulesp]')
  const b = $('[data-cl-rules]')
  if (!p || !b) return
  const want = on === undefined ? p.hidden : on
  state.rules = want
  if (want) state.rulesAt = at || 'filter'
  p.hidden = !want
  b.setAttribute('aria-expanded', String(want))
  if (want) { p.innerHTML = RULES; placeRules() }
}
function placeRules(): void {
  const btn = $(state.rulesAt === 'hint' ? '[data-cl-fhintx]' : '[data-cl-rules]')
  const p = $('[data-cl-rulesp]')
  if (!btn || !p || p.hidden || !state.dlg) return
  const d = state.dlg.getBoundingClientRect()
  const r = btn.getBoundingClientRect()
  /* 浮层不越出弹窗底边：1440 下内容 559 高不滚；窄窗按可用高度收并内部滚 */
  const avail = d.height - (r.bottom - d.top) - 12
  p.style.maxHeight = Math.min(560, Math.max(200, avail)) + 'px'
  const pw = p.offsetWidth || 380
  let left = r.right - d.left - pw
  left = Math.max(12, Math.min(left, d.width - pw - 12))
  p.style.left = left + 'px'
  p.style.top = (r.bottom - d.top + 6) + 'px'
}

/* ── 事件 ─────────────────────────────────────────────────────────────────── */
async function onClick(e: MouseEvent): Promise<void> {
  const t = e.target as HTMLElement
  if (!t || !state.dlg) return
  if (t === state.dlg) { state.dlg.close(); return }      // 点遮罩
  if (t.closest('[data-cl-x]')) { state.dlg.close(); return }
  if (t.closest('[data-cl-smart]')) { smartToggle(); return }
  if (t.closest('[data-cl-qc]')) { state.q = ''; paintList(); paintChrome(); ($('[data-cl-q]') as HTMLInputElement | null)?.focus(); return }
  if (t.closest('[data-cl-oos]')) { state.oos = !state.oos; paintList(); return }
  if (t.closest('[data-cl-clear]')) { state.filter = 'all'; state.q = ''; paintList(); paintChrome(); return }
  if (t.closest('[data-cl-fhintx]')) { toggleRules(true, 'hint'); return }
  if (t.closest('[data-cl-tou]')) { state.filter = 'useless'; paintList(); paintChrome(); return }
  if (t.closest('[data-cl-rules]')) { toggleRules(); return }
  if (t.closest('[data-cl-rulesx]')) { toggleRules(false); return }
  const f = t.closest('[data-cl-f]') as HTMLElement | null
  if (f) { state.filter = f.getAttribute('data-cl-f') as Filter; paintList(); paintChrome(); return }
  const gs = t.closest('[data-cl-gsel]') as HTMLElement | null
  if (gs) { const id = gs.getAttribute('data-cl-gsel') as string; const rr = visible().filter((r) => r.cardId === id); const all = rr.every((r) => state.sel.has(r.key)); selectGroup(id, !all); paintSelOnly(); return }
  const rv = t.closest('[data-cl-reveal]') as HTMLElement | null
  if (rv) {
    e.stopPropagation()
    const row = rows().find((r) => r.key === rv.getAttribute('data-cl-reveal'))
    if (row) { try { await post('fs/reveal', { path: row.path }); toast('在访达中显示：' + row.name, 'ok') } catch (err) { toast(err instanceof ApiError ? err.message : String(err), 'err') } }
    return
  }
  if (t.closest('[data-cl-unlink]')) { openConfirm('unlink'); return }
  if (t.closest('[data-cl-trash]')) { openConfirm('trash'); return }
  if (t.closest('[data-cl-undo]')) { await undo(); return }
  if (t.closest('[data-cl-ccancel]')) { closeConfirm(); return }
  if (t.closest('[data-cl-cok]')) { await apply(); return }
  const r = t.closest('[data-cl-row]') as HTMLElement | null
  if (r && !t.closest('button, input, a, select')) {
    const k = r.getAttribute('data-cl-row') as string
    if (state.sel.has(k)) state.sel.delete(k); else state.sel.add(k)
    paintSelOnly(); return
  }
  // 点规则浮层外面收起
  if (state.rules && !t.closest('[data-cl-rulesp]') && !t.closest('[data-cl-fhintx]')) toggleRules(false)
}
function onChange(e: Event): void {
  const t = e.target as HTMLElement
  if (!t) return
  if (t.matches('[data-cl-allck]')) {
    const vis = visible()
    const all = vis.length > 0 && vis.every((r) => state.sel.has(r.key))
    const box = t as HTMLInputElement
    if (!box.checked || all) { state.sel.clear(); toast('已全不选（清空全部选择）', 'ok') }
    else { for (const r of vis) state.sel.add(r.key); toast('已选中当前列表里的 ' + vis.length + ' 个文件', 'ok') }
    paintSelOnly(); return
  }
  if (t.matches('[data-cl-ck]')) { const k = (t as HTMLInputElement).getAttribute('data-cl-ck') as string; if ((t as HTMLInputElement).checked) state.sel.add(k); else state.sel.delete(k); paintSelOnly(); return }
  if (t.matches('[data-cl-gall]')) { const id = (t as HTMLInputElement).getAttribute('data-cl-gall') as string; selectGroup(id, (t as HTMLInputElement).checked); paintSelOnly(); return }
  if (t.matches('[data-cl-sort]')) { state.sort = (t as HTMLSelectElement).value as 'card' | 'size' | 'name'; paintList(); paintChrome(); return }
}
function onKey(e: KeyboardEvent): void {
  if (!state.open || !state.dlg || !state.dlg.open) return
  if (e.key === 'Escape') {
    if (state.confirm) { e.preventDefault(); e.stopPropagation(); closeConfirm(); return }
    if (state.rules) { e.preventDefault(); e.stopPropagation(); toggleRules(false); return }
    return
  }
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return
  const t = e.target as HTMLElement | null
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  if ((e.key === 'a' || e.key === 'A') && !typing) { e.preventDefault(); e.stopPropagation(); selectVisible(); return }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); ($('[data-cl-q]') as HTMLInputElement | null)?.focus(); return }
}
