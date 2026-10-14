/**
 * 看板领域模型（纯函数，无 IO、无 DSH 依赖）——store 与路由都只经这里改数据，便于单测。
 * 规则来源：设计卡 v2 + 原型 v8（阶段随卡片组、只用来分组；组内排序；组/卡多对多关联落盘项目）。
 * 数据键名沿用 statuses / col（board.json 兼容），界面与文档统一叫「阶段」。
 */
export interface Status { id: string; name: string }
export interface Repo { name: string; role: string; path: string }
/** lfProject（0.20）= 这个卡片组的落盘文件夹（~/.ai/projects/<lfProject>/）：新建 / 迁移的落盘项目都放这里；缺省 = 还没设。 */
export interface Group { id: string; name: string; collapsed: boolean; repos: Repo[]; links: string[]; statuses: Status[]; lfProject?: string }
export interface Task { text: string; done: boolean }
/**
 * notes = 相关说明（自由文本）；webLinks = 相关链接（显示文字 + 类型 + 网址，数组顺序 = 展示顺序）；files = 相关文件的绝对路径（只登记，不复制/不删除文件）。
 * 三者都会作为「卡片资料」注入关联会话（0.10）。
 * archivedAt = 归档时间（ISO）；有值 = 已归档：不在看板列里、内容只读，g/col 保留以便恢复回原阶段。三者都可缺省（旧数据兼容）。
 */
export interface WebLink { text: string; type: string; url: string }
/** repos（0.14）= 这张卡片自己的仓库清单：新建时复制所在组的「卡片共用仓库」，之后与组互不影响。 */
export interface Card { id: string; g: string; col: string; order: number; t: string; links: string[]; tasks: Task[]; repos: Repo[]; notes?: string; webLinks?: WebLink[]; files?: string[]; archivedAt?: string }
/** readKeys = 关联时该会话已读过的落盘项目（不再注入）；只在关联时计算一次，保证注入文本稳定。 */
export interface SessionRef { sessionId: string; cardId: string; createdAt: string; title?: string; readKeys?: string[] }
export interface BoardEvent { at: string; actor: string; kind: string; card?: string; group?: string; from?: string; to?: string }
/** 候选仓库（0.14）：任意卡片组 / 卡片添加过的仓库，移除后也保留；at = 最近一次添加的时间。 */
export interface RepoSeen extends Repo { at: string }
/** linkTypes = 相关链接的「类型」选项（全局共用，数组顺序 = 展示顺序）；缺省 = 默认两项。 */
export interface Board { version: 1; groups: Group[]; cards: Card[]; sessions: SessionRef[]; linkTypes?: string[]; repoHistory?: RepoSeen[] }

export class BoardError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BoardError' }
}

export const emptyBoard = (): Board => ({ version: 1, groups: [], cards: [], sessions: [] })

export const defaultStatuses = (): Status[] => [
  { id: 'research', name: '调研' },
  { id: 'plan', name: '制定方案' },
  { id: 'build', name: '实施' },
  { id: 'verify', name: '测试验收' },
  { id: 'done', name: '完成' },
]

let seq = 0
export const newId = (prefix: string): string => prefix + Date.now().toString(36) + (seq++).toString(36)

/** 名称类字段：去控制字符、折叠空白（防止换行把内容注入 AGENTS.md / 会话记忆）、限长 120。 */
const nonEmpty = (v: unknown, field: string): string => {
  if (typeof v !== 'string') throw new BoardError('BAD_ARG', field + ' 不能为空')
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (s === '') throw new BoardError('BAD_ARG', field + ' 不能为空')
  if (s.length > 120) throw new BoardError('BAD_ARG', field + ' 超过 120 字')
  return s
}

export function group(b: Board, id: string): Group {
  const g = b.groups.find((x) => x.id === id)
  if (!g) throw new BoardError('NO_GROUP', '找不到卡片组 ' + id)
  return g
}
export function card(b: Board, id: string): Card {
  const c = b.cards.find((x) => x.id === id)
  if (!c) throw new BoardError('NO_CARD', '找不到卡片 ' + id)
  return c
}
/** 要改动内容的卡片：已归档的只读，先恢复活跃。 */
export function liveCard(b: Board, id: string): Card {
  const c = card(b, id)
  if (c.archivedAt) throw new BoardError('CARD_ARCHIVED', '卡片「' + c.t + '」已归档，只能查看；先恢复活跃再修改')
  return c
}
export function status(g: Group, id: string): Status {
  const s = g.statuses.find((x) => x.id === id)
  if (!s) throw new BoardError('NO_STATUS', '卡片组「' + g.name + '」没有阶段 ' + id)
  return s
}

/** 同组同阶段内按 order 排序后的活跃卡片（已归档的不占位置）。 */
export function cellCards(b: Board, gId: string, col: string): Card[] {
  return b.cards.filter((c) => c.g === gId && c.col === col && !c.archivedAt).sort((a, c) => a.order - c.order)
}

/** 归档卡片：移出看板列（其余卡片补位），内容转只读；卡片的会话不动。已归档再归档 = 无操作。 */
export function archiveCard(b: Board, id: string, at = new Date().toISOString()): Card {
  const c = card(b, id)
  if (c.archivedAt) return c
  c.archivedAt = at
  renumber(cellCards(b, c.g, c.col))
  return c
}

/** 恢复活跃：回到原阶段末尾。原阶段已被删除时放到第一个阶段。 */
export function unarchiveCard(b: Board, id: string): Card {
  const c = card(b, id)
  if (!c.archivedAt) return c
  const g = group(b, c.g)
  if (!g.statuses.some((s) => s.id === c.col)) c.col = g.statuses[0].id
  c.order = cellCards(b, c.g, c.col).length
  delete c.archivedAt
  return c
}

function renumber(list: Card[]): void { list.forEach((c, i) => { c.order = i }) }

export function addGroup(b: Board, name: string): Group {
  const g: Group = { id: newId('g'), name: nonEmpty(name, '组名'), collapsed: false, repos: [], links: [], statuses: defaultStatuses() }
  b.groups.push(g)
  return g
}

/** 调整卡片组顺序：把 id 插到 beforeId 之前；beforeId 缺省/null = 放到最后。顺序即 groups 数组顺序。 */
export function moveGroup(b: Board, id: string, beforeId?: string | null): void {
  const g = group(b, id)
  if (beforeId === id) return
  if (beforeId) group(b, beforeId)
  const rest = b.groups.filter((x) => x.id !== id)
  const i = beforeId ? rest.findIndex((x) => x.id === beforeId) : rest.length
  rest.splice(i, 0, g)
  b.groups = rest
}

export function renameGroup(b: Board, id: string, name: string): void { group(b, id).name = nonEmpty(name, '组名') }

/** 0.20 卡片组的落盘文件夹：字母数字开头、只用 a-z 0-9 . _ -；两个组不能共用。空 = 清除。 */
export function setGroupFolder(b: Board, id: string, v: unknown): void {
  const g = group(b, id)
  if (v === '' || v === null) { delete g.lfProject; return }
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)) throw new BoardError('BAD_FOLDER', '落盘文件夹名只能用小写字母、数字和 . _ -，以字母或数字开头（收到 ' + JSON.stringify(v) + '）')
  const other = b.groups.find((x) => x.id !== id && x.lfProject === v)
  if (other) throw new BoardError('FOLDER_TAKEN', '落盘文件夹 ' + v + ' 已经是卡片组「' + other.name + '」的，换一个')
  g.lfProject = v
}

export function removeGroup(b: Board, id: string): void {
  group(b, id)
  if (b.cards.some((c) => c.g === id)) throw new BoardError('GROUP_NOT_EMPTY', '卡片组里还有卡片，先移走或删除卡片')
  b.groups = b.groups.filter((g) => g.id !== id)
}

/** 校验并替换整组阶段：至少一个，id 唯一，名称非空，仍有卡片的阶段不能被删。 */
export function setStatuses(b: Board, gId: string, next: Status[]): void {
  const g = group(b, gId)
  if (!Array.isArray(next) || next.length === 0) throw new BoardError('BAD_STATUSES', '至少保留一个阶段')
  const ids = new Set<string>()
  const clean: Status[] = next.map((s) => {
    const id = typeof s?.id === 'string' && s.id !== '' ? s.id : newId('s')
    if (ids.has(id)) throw new BoardError('BAD_STATUSES', '阶段 id 重复 ' + id)
    ids.add(id)
    return { id, name: nonEmpty(s?.name, '阶段名') }
  })
  // 已归档的卡片不挡删阶段：它们不在列里、也不能移动；恢复时原阶段不在了就回第一个阶段
  for (const c of b.cards) if (c.g === gId && !c.archivedAt && !ids.has(c.col)) {
    const lost = g.statuses.find((s) => s.id === c.col)
    throw new BoardError('STATUS_IN_USE', '「' + (lost ? lost.name : c.col) + '」下还有卡片「' + c.t + '」，先移走再删除')
  }
  g.statuses = clean
}

/** 绝对路径：POSIX「/…」或 Windows「C:\…」「C:/…」「\\server\share…」（issue #1：Windows 原生路径曾被当成相对路径拒掉）。 */
export const isAbsPath = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p)

export function cleanRepos(v: unknown): Repo[] {
  if (!Array.isArray(v)) throw new BoardError('BAD_ARG', 'repos 必须是数组')
  const out: Repo[] = []
  for (const r of v as Repo[]) {
    const name = nonEmpty(r?.name, '仓库名')
    const path = nonEmpty(r?.path, '仓库路径')
    if (!isAbsPath(path)) throw new BoardError('BAD_ARG', '仓库路径必须是绝对路径：' + path)
    if (out.some((x) => x.name === name)) throw new BoardError('BAD_ARG', '仓库名重复：' + name)
    out.push({ name, role: typeof r.role === 'string' && r.role.trim() ? r.role.trim() : '仓库', path })
  }
  return out
}

/**
 * 追加挂载仓库（「添加挂载仓库」弹窗的保存）：逐个校验后一次性追加，任一冲突整批不写。
 * 同一路径不能挂两次；名称不能与本组已有或本批其他项重名（repos/<组>/<名> 软链路径由名称决定）。
 */
export function addRepos(b: Board, gId: string, v: unknown, canon: (p: string) => string = (p) => p): Repo[] {
  const g = group(b, gId)
  g.repos = appendRepos(b, g.repos, '「' + g.name + '」的卡片共用仓库', v, canon)
  return g.repos
}

/** 0.14 给卡片追加仓库（只影响这张卡片）。 */
export function addCardRepos(b: Board, id: string, v: unknown, canon: (p: string) => string = (p) => p): Repo[] {
  const c = liveCard(b, id)
  c.repos = appendRepos(b, c.repos, '卡片「' + c.t + '」', v, canon)
  return c.repos
}

/** 0.14 整表替换卡片仓库（移除 / 改名 / 改角色）：只影响这张卡片。 */
export function setCardRepos(b: Board, id: string, v: unknown): Repo[] {
  const c = liveCard(b, id)
  c.repos = cleanRepos(v)
  return c.repos
}

const normPath = (p: string): string => p.replace(/\/+$/, '') || '/'

/** 追加到一个仓库清单：逐个校验后一次性追加，任一冲突整批不写；成功的同时记进候选仓库。 */
function appendRepos(b: Board, cur: Repo[], who: string, v: unknown, canon: (p: string) => string): Repo[] {
  // canon = 真实路径（软链 / macOS 的 /tmp→/private/tmp）：重复判断才准
  const add = cleanRepos(v).map((r) => ({ ...r, path: canon(r.path) }))
  if (add.length === 0) throw new BoardError('BAD_ARG', '没有要添加的仓库')
  for (const r of add) {
    const clashName = cur.find((x) => x.name === r.name)
    if (clashName) throw new BoardError('REPO_NAME_TAKEN', who + '已有同名仓库「' + r.name + '」（' + clashName.path + '），换个名字')
    const clashPath = cur.find((x) => normPath(x.path) === normPath(r.path))
    if (clashPath) throw new BoardError('REPO_MOUNTED', r.path + ' 已在' + who + '里（名称「' + clashPath.name + '」）')
  }
  if (new Set(add.map((r) => normPath(r.path))).size !== add.length) throw new BoardError('BAD_ARG', '同一路径选了两次')
  noteRepos(b, add)
  return cur.concat(add)
}

/** 记进候选仓库：同一路径只留一条，时间刷新为最新、名称 / 角色以最近一次为准。 */
export function noteRepos(b: Board, rs: Repo[], at = new Date().toISOString()): void {
  const h = (b.repoHistory ?? []).filter((x) => !rs.some((r) => normPath(r.path) === normPath(x.path)))
  b.repoHistory = rs.map((r) => ({ name: r.name, role: r.role, path: r.path, at })).concat(h)
}

/** 候选仓库：最近添加的在前。 */
export function repoCandidates(b: Board): RepoSeen[] {
  return (b.repoHistory ?? []).slice().sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
}

/**
 * 卡片组目录 repos/ 下的软链接（0.14）：组共用仓库 + 本组每张卡片的仓库（含已归档卡片，便于恢复）。
 * 名称 = 软链接目录名；同名不同路径时后来者自动改成「名-2」「名-3」…；同一路径只挂一次。
 * 返回 path → 软链接名（卡片注入时据此写 repos/<名>/）。
 */
export function groupMounts(b: Board, gId: string): Map<string, string> {
  const g = group(b, gId)
  const out = new Map<string, string>()
  const used = new Set<string>()
  const safe = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 64) || 'x'
  const all = g.repos.concat(...b.cards.filter((c) => c.g === gId).map((c) => c.repos ?? []))
  for (const r of all) {
    const p = normPath(r.path)
    if (out.has(p)) continue
    const base = safe(r.name)
    let n = base
    for (let i = 2; used.has(n); i++) n = base + '-' + i
    used.add(n)
    out.set(p, n)
  }
  return out
}

export function setGroupLinks(b: Board, gId: string, links: string[]): void {
  group(b, gId).links = dedupe(links)
}

export function addCard(b: Board, gId: string, title: string, links: string[] = [], col?: string): Card {
  const g = group(b, gId)
  const target = (col ? status(g, col) : g.statuses[0]).id
  // 0.14：新卡片复制一份组的「卡片共用仓库」，之后各自独立
  const c: Card = { id: newId('c'), g: gId, col: target, order: cellCards(b, gId, target).length, t: nonEmpty(title, '卡片标题'), links: dedupe(links), tasks: [], repos: g.repos.map((r) => ({ ...r })) }
  b.cards.push(c)
  return c
}

export function updateCard(b: Board, id: string, patch: { t?: string; links?: string[] }): Card {
  const c = liveCard(b, id)
  if (patch.t !== undefined) c.t = nonEmpty(patch.t, '卡片标题')
  if (patch.links !== undefined) c.links = dedupe(patch.links).filter((k) => !group(b, c.g).links.includes(k))
  return c
}

export function removeCard(b: Board, id: string): void {
  const c = card(b, id)
  b.cards = b.cards.filter((x) => x.id !== id)
  renumber(cellCards(b, c.g, c.col))
  b.sessions = b.sessions.filter((s) => s.cardId !== id)
}

/**
 * 移动卡片（跨阶段/跨组/组内排序）。beforeId = 插到这张卡之前；缺省 = 放到末尾。
 * 返回事件（供审计写 events.jsonl）。
 */
export function moveCard(b: Board, id: string, to: { g?: string; col: string; beforeId?: string | null }, actor: string): BoardEvent {
  const c = liveCard(b, id)
  const gId = to.g ?? c.g
  const g = group(b, gId)
  const dest = status(g, to.col)
  const fromG = group(b, c.g)
  const crossing = c.col !== dest.id || c.g !== gId
  const fromName = status(fromG, c.col).name
  const oldCell = cellCards(b, c.g, c.col).filter((x) => x.id !== id)
  c.g = gId
  c.col = dest.id
  const peers = cellCards(b, gId, dest.id).filter((x) => x.id !== id)
  let idx = to.beforeId ? peers.findIndex((x) => x.id === to.beforeId) : -1
  if (idx < 0) idx = peers.length
  peers.splice(idx, 0, c)
  renumber(peers)
  if (crossing) renumber(oldCell)
  return { at: new Date().toISOString(), actor, kind: crossing ? 'move' : 'reorder', card: id, group: gId, from: fromName, to: dest.name }
}

export function setTasks(b: Board, id: string, tasks: Task[]): void {
  liveCard(b, id).tasks = tasks.map((t) => ({ text: nonEmpty(t.text, '子任务'), done: t.done === true }))
}

/** 相关说明：原样保存（只统一换行、去掉 NUL）；全是空白 = 清空。不限字数，受 HTTP 体上限约束。 */
export function setNotes(b: Board, id: string, text: unknown): Card {
  if (typeof text !== 'string') throw new BoardError('BAD_ARG', 'notes 必须是字符串')
  const c = liveCard(b, id)
  const v = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  if (v.trim() === '') delete c.notes
  else c.notes = v
  return c
}

/** 相关文件路径：必须是绝对路径、不含控制字符；去掉末尾分隔符。 */
const filePath = (v: unknown): string => {
  if (typeof v !== 'string' || v.trim() === '') throw new BoardError('BAD_ARG', '文件路径不能为空')
  const p = v.trim().replace(/[\\/]+$/, '')
  if (!isAbsPath(p)) throw new BoardError('BAD_ARG', '文件路径必须是绝对路径：' + v)
  if (/[\u0000-\u001f\u007f]/.test(p)) throw new BoardError('BAD_ARG', '文件路径含控制字符：' + JSON.stringify(v))
  if (p.length > 4096) throw new BoardError('BAD_ARG', '文件路径过长')
  return p
}

/** 追加相关文件：逐个校验，任一非法整批不写；已关联的跳过。返回实际新增数与跳过数。 */
export function addFiles(b: Board, id: string, paths: unknown): { added: number; skipped: number } {
  const c = liveCard(b, id)
  if (!Array.isArray(paths) || paths.length === 0) throw new BoardError('BAD_ARG', '没有要添加的文件')
  const clean = paths.map(filePath)
  const cur = c.files ?? []
  let added = 0
  for (const p of clean) if (!cur.includes(p)) { cur.push(p); added++ }
  c.files = cur
  return { added, skipped: clean.length - added }
}

/**
 * 0.15 粘贴的一行路径 → 规整后的绝对路径（不判断存在）。去首尾空白与成对引号、file:// 解码、~ 展开、
 * 终端转义空格（\ ）还原、去末尾分隔符。非绝对路径原样返回（由调用方判非法）。
 */
export function normPastedPath(raw: string, home: string): string {
  let s = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  if (/^file:\/\//i.test(s)) { try { s = decodeURIComponent(new URL(s).pathname) } catch { /* 保留原值 */ } }
  s = s.replace(/^~(?=\/|$)/, home).replace(/\\ /g, ' ')
  return s.length > 1 && !/^[A-Za-z]:[\\/]$/.test(s) ? s.replace(/[\\/]+$/, '') : s
}

/** 0.15 分叉补关联：0.14 之前分出的会话（源会话关联了卡片、它自己没关联）批量补上。返回补上的 [子会话, 卡片] 对。 */
export function backfillForks(b: Board, pairs: Array<{ child: string; parent: string }>): Array<{ child: string; card: string }> {
  const out: Array<{ child: string; card: string }> = []
  for (const p of pairs) { const c = bindFork(b, p.child, p.parent); if (c) out.push({ child: p.child, card: c.id }) }
  return out
}

/** 解除关联：只从列表移除，不碰文件本身。 */
export function removeFile(b: Board, id: string, path: unknown): void {
  const c = liveCard(b, id)
  if (typeof path !== 'string' || !(c.files ?? []).includes(path)) throw new BoardError('NOT_LINKED', '卡片「' + c.t + '」没有关联这个文件：' + String(path))
  c.files = (c.files as string[]).filter((p) => p !== path)
  if (!c.files.length) delete c.files
}

export const DEFAULT_LINK_TYPES = ['文档', '代码']
export const linkTypes = (b: Board): string[] => b.linkTypes ?? DEFAULT_LINK_TYPES.slice()

/** 新增全局「类型」选项（已有则不变）；类型名同名称类字段规则，限 20 字。 */
export function addLinkType(b: Board, name: unknown): string {
  const v = nonEmpty(name, '类型')
  if (v.length > 20) throw new BoardError('BAD_ARG', '类型超过 20 字')
  const ts = linkTypes(b)
  if (!ts.includes(v)) ts.push(v)
  b.linkTypes = ts
  return v
}

/** 0.13 改名全局「类型」：类型表与所有卡片（含已归档）里用旧名的链接一起改，任一校验失败什么都不写。返回新名与改到的链接数。 */
export function renameLinkType(b: Board, from: unknown, to: unknown): { name: string; links: number } {
  const ts = linkTypes(b)
  const i = typeof from === 'string' ? ts.indexOf(from) : -1
  if (i < 0) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(from))
  const v = nonEmpty(to, '类型')
  if (v.length > 20) throw new BoardError('BAD_ARG', '类型超过 20 字')
  if (v === from) return { name: v, links: 0 }
  if (ts.includes(v)) throw new BoardError('BAD_ARG', '已经有「' + v + '」了')
  let n = 0
  for (const c of b.cards) for (const l of c.webLinks ?? []) if (l.type === from) { l.type = v; n++ }
  ts[i] = v
  b.linkTypes = ts
  return { name: v, links: n }
}

/** 0.14 调整类型顺序：from 位置的类型挪到 to 位置（数组顺序 = 下拉展示顺序）。 */
export function moveLinkType(b: Board, name: unknown, to: unknown): string[] {
  const ts = linkTypes(b)
  const i = typeof name === 'string' ? ts.indexOf(name) : -1
  if (i < 0) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(name))
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= ts.length) throw new BoardError('BAD_ARG', '位置越界：' + String(to) + '（共 ' + ts.length + ' 个类型）')
  const [t] = ts.splice(i, 1)
  ts.splice(to, 0, t)
  b.linkTypes = ts
  return ts
}

/** 判断两条链接是否同一个：协议 + 域名（小写）+ 路径（去掉末尾 /）+ 查询 + 锚点。 */
export function urlKey(url: string): string {
  try { const u = new URL(url); return u.protocol + '//' + u.host.toLowerCase() + (u.pathname.replace(/\/+$/, '') || '') + u.search + u.hash } catch { return url.trim() }
}

/** 网址简单校验：只收 http(s)；没写协议但像域名 → 补 https://；不能有空白/控制字符。返回规范化后的网址。 */
export function normUrl(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new BoardError('BAD_URL', '请填写完整链接')
  let s = v.trim()
  if (/[\s\u0000-\u001f\u007f]/.test(s)) throw new BoardError('BAD_URL', '链接里不能有空格或换行：' + s)
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d/.test(s)) throw new BoardError('BAD_URL', '只支持 http:// 或 https:// 开头的链接：' + s)
    s = 'https://' + s
  }
  let u: URL
  try { u = new URL(s) } catch { throw new BoardError('BAD_URL', '链接格式不对：' + v) }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !u.hostname.startsWith('[')) throw new BoardError('BAD_URL', '域名不完整：' + u.hostname)
  if (u.href.length > 4096) throw new BoardError('BAD_URL', '链接过长')
  return u.href
}

/** 相关链接整表替换（新增 / 编辑 / 删除 / 排序都走这里）：逐条校验，任一非法整批不写；没见过的类型自动加入全局选项。 */
export function setWebLinks(b: Board, id: string, list: unknown): Card {
  const c = liveCard(b, id)
  if (!Array.isArray(list)) throw new BoardError('BAD_ARG', 'links 必须是数组')
  const clean = list.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    try {
      const url = normUrl(o.url)
      const text = typeof o.text === 'string' && o.text.trim() ? nonEmpty(o.text, '显示文字') : url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 60)
      return { text, type: nonEmpty(o.type ?? DEFAULT_LINK_TYPES[0], '类型'), url }
    } catch (e) { throw e instanceof BoardError ? new BoardError(e.code, '第 ' + (i + 1) + ' 条：' + e.message) : e }
  })
  // 0.14 同一张卡片不能有重复链接（点名第几条与已有的那条）
  const seen = new Map<string, number>()
  clean.forEach((l, i) => {
    const k = urlKey(l.url)
    const j = seen.get(k)
    if (j !== undefined) throw new BoardError('DUP_URL', '第 ' + (i + 1) + ' 条和第 ' + (j + 1) + ' 条是同一个链接：' + l.url + '（已添加为「' + clean[j].text + '」）')
    seen.set(k, i)
  })
  for (const l of clean) addLinkType(b, l.type)
  if (clean.length) c.webLinks = clean
  else delete c.webLinks
  return c
}

/** osascript「choose file」的输出：每行一个 POSIX 路径。 */
export function parsePicked(out: string): string[] {
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => p.replace(/\/+$/, ''))
}

/** 会话实际读取的记忆：卡片组关联 ∪ 卡片关联，去重保序，标注来源。 */
export function memoryOf(b: Board, c: Card): Array<{ key: string; from: 'group' | 'card' | 'both' }> {
  const g = group(b, c.g)
  const out: Array<{ key: string; from: 'group' | 'card' | 'both' }> = []
  for (const k of g.links) out.push({ key: k, from: 'group' })
  for (const k of c.links) {
    const hit = out.find((x) => x.key === k)
    if (hit) hit.from = 'both'
    else out.push({ key: k, from: 'card' })
  }
  return out
}

/** 0.18 关联了这个落盘项目的卡片（卡片级，含已归档）与卡片组（组级）。 */
export function linksOfKey(b: Board, key: string): { cards: Card[]; groups: Group[] } {
  return { cards: b.cards.filter((c) => c.links.includes(key)), groups: b.groups.filter((g) => g.links.includes(key)) }
}

/** 一个会话只属于一张卡片：重复绑定以最新一次为准。 */
export function bindSession(b: Board, sessionId: string, cardId: string, title?: string): void {
  liveCard(b, cardId)
  b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId)
  b.sessions.unshift({ sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}) })
}

/** 0.14 分叉：源会话关联了卡片 → 新会话关联同一张卡片（带上源会话已读过的落盘项目）。源会话没关联 / 卡片已归档 → null。 */
export function bindFork(b: Board, childId: string, parentId: string, title?: string): Card | null {
  const p = sessionRef(b, parentId)
  if (!p || sessionRef(b, childId)) return null
  const c = b.cards.find((x) => x.id === p.cardId)
  if (!c || c.archivedAt) return null
  b.sessions.unshift({ sessionId: childId, cardId: c.id, createdAt: new Date().toISOString(), ...(title ? { title } : {}), ...(p.readKeys?.length ? { readKeys: p.readKeys.slice() } : {}) })
  return c
}

/**
 * 手动关联已有会话（批量）：每个会话只属于一张卡片，已在别的卡片上的移过来；
 * readKeys 由调用方按会话记录算好（读过的 STATE 不再注入）。返回从别的卡片移过来的数量。
 */
/**
 * 卡片没有任何记忆（卡片组 ∪ 卡片都没关联）时，找标题里包含其 slug 的落盘项目作为「同名」建议；
 * slug 至少 6 个字符防误配，多个命中取最长的。只做建议，不自动关联。
 */
export function sameNameState<T extends { key: string; slug: string }>(b: Board, c: Card, states: readonly T[]): T | null {
  if (memoryOf(b, c).length) return null
  const t = c.t.toLowerCase()
  let hit: T | null = null
  for (const s of states) if (s.slug.length >= 6 && t.includes(s.slug.toLowerCase()) && (!hit || s.slug.length > hit.slug.length)) hit = s
  return hit
}

export function bindMany(b: Board, cardId: string, items: Array<{ sessionId: string; title?: string; readKeys?: string[] }>): { linked: number; moved: number } {
  liveCard(b, cardId)
  if (!Array.isArray(items) || items.length === 0) throw new BoardError('BAD_ARG', '没有要关联的会话')
  const ids = new Set<string>()
  let moved = 0
  for (const it of items) {
    if (typeof it?.sessionId !== 'string' || !/^[\w.:-]{1,128}$/.test(it.sessionId)) throw new BoardError('BAD_ARG', '无效的会话 id：' + String(it?.sessionId))
    if (ids.has(it.sessionId)) throw new BoardError('BAD_ARG', '同一会话选了两次：' + it.sessionId)
    ids.add(it.sessionId)
  }
  for (const it of items) {
    const prev = b.sessions.find((s) => s.sessionId === it.sessionId)
    if (prev && prev.cardId !== cardId) moved++
    b.sessions = b.sessions.filter((s) => s.sessionId !== it.sessionId)
    const title = typeof it.title === 'string' && it.title.trim() ? it.title.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, 200) : prev?.title
    const readKeys = Array.isArray(it.readKeys) ? it.readKeys.filter((k) => typeof k === 'string') : []
    b.sessions.unshift({ sessionId: it.sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}), ...(readKeys.length ? { readKeys } : {}) })
  }
  return { linked: items.length, moved }
}

/** 解除关联：会话本身不动，只删绑定。 */
export function unbindSession(b: Board, sessionId: string): SessionRef {
  const ref = b.sessions.find((s) => s.sessionId === sessionId)
  if (!ref) throw new BoardError('NOT_LINKED', '会话没有关联任何卡片：' + sessionId)
  b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId)
  return ref
}

/**
 * 会话记录里 read 过哪些 STATE.md（直接调用 read 与 run_code 内调用 read 两种事件都算）。
 * paths: key → STATE 绝对路径；返回读过的 key。
 */
export function readKeysFromEvents(events: ReadonlyArray<{ type: string; data?: unknown }>, paths: ReadonlyMap<string, string>): string[] {
  const want = new Map<string, string>()
  for (const [k, p] of paths) want.set(p, k)
  const hit = new Set<string>()
  for (const ev of events) {
    let name: unknown
    let args: unknown
    if (ev.type === 'tool/call') { const d = ev.data as { name?: unknown; arguments?: unknown }; name = d?.name; try { args = typeof d?.arguments === 'string' ? JSON.parse(d.arguments) : d?.arguments } catch { continue } }
    else if (ev.type === 'tool/ptc-dispatch' || ev.type === 'tool/ptc-dispatch-start') { const d = ev.data as { name?: unknown; arguments?: unknown }; name = d?.name; args = d?.arguments }
    else continue
    if (name !== 'read') continue
    const fp = (args as { file_path?: unknown } | null)?.file_path
    if (typeof fp !== 'string') continue
    const k = want.get(fp)
    if (k) hit.add(k)
  }
  return [...paths.keys()].filter((k) => hit.has(k))
}

export function cardOfSession(b: Board, sessionId: string): Card | undefined {
  const ref = b.sessions.find((s) => s.sessionId === sessionId)
  return ref ? b.cards.find((c) => c.id === ref.cardId) : undefined
}

export function sessionRef(b: Board, sessionId: string): SessionRef | undefined { return b.sessions.find((s) => s.sessionId === sessionId) }

function dedupe(list: unknown): string[] {
  if (!Array.isArray(list)) throw new BoardError('BAD_ARG', 'links 必须是数组')
  const out: string[] = []
  for (const k of list) {
    const seg = typeof k === 'string' ? k.split('/') : []
    const okSeg = (x: string): boolean => x !== '' && !x.startsWith('.') && !/[\u0000-\u001f\u007f\\]/.test(x) && x.length <= 200
    if (seg.length !== 2 || !seg.every(okSeg)) throw new BoardError('BAD_LINK', '无效的落盘项目 ' + String(k) + '（格式 <project>/<slug>）')
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/**
 * 读盘后的结构校验：坏文件 fail loud，不静默丢数据。
 * 0.1.x 升级：阶段上的 cat（类别）/ gate（证据门）与卡片上的 ev（证据）不再使用，读入时丢掉；
 * 阶段 id、名称、顺序与卡片位置原样保留，下次写盘即为新格式。events.jsonl 里的历史证据不动。
 */
export function parseBoard(raw: unknown): Board {
  const b = raw as Board
  if (!b || b.version !== 1 || !Array.isArray(b.groups) || !Array.isArray(b.cards)) throw new BoardError('BAD_BOARD', 'board.json 结构无效')
  if (!Array.isArray(b.sessions)) b.sessions = []
  for (const g of b.groups) {
    if (!Array.isArray(g.statuses)) throw new BoardError('BAD_BOARD', 'board.json 结构无效：卡片组「' + String(g.name) + '」缺少阶段')
    g.statuses = g.statuses.map((s) => ({ id: s.id, name: s.name }))
  }
  for (const c of b.cards) delete (c as Card & { ev?: unknown }).ev
  // 0.14 升级：卡片还没有自己的仓库清单 → 复制所在组当前的仓库（表现与升级前一致）；候选仓库从各组 / 卡片现有仓库起步
  const stamp = new Date().toISOString()
  for (const c of b.cards) if (!Array.isArray(c.repos)) c.repos = (b.groups.find((g) => g.id === c.g)?.repos ?? []).map((r) => ({ ...r }))
  if (!Array.isArray(b.repoHistory)) {
    b.repoHistory = []
    const all = b.groups.flatMap((g) => g.repos).concat(b.cards.flatMap((c) => c.repos))
    for (const r of all) if (!b.repoHistory.some((x) => normPath(x.path) === normPath(r.path))) b.repoHistory.push({ name: r.name, role: r.role, path: r.path, at: stamp })
  }
  return b
}
