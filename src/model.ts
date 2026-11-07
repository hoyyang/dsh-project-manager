/**
 * 看板领域模型（纯函数，无 IO、无 DSH 依赖）——store 与路由都只经这里改数据，便于单测。
 * 规则来源：设计卡 v2 + 原型 v8（阶段随卡片组、只用来分组；组内排序；组/卡多对多关联落盘项目）。
 * 数据键名沿用 statuses / col（board.json 兼容），界面与文档统一叫「阶段」。
 */
import { syncFileRefs } from './refsync.js'

export interface Status { id: string; name: string }
/** v136：off = 不自动注入 Agent 会话（卡片档案 / STATE 卡片档案块不出现）；缺省 = 注入（老数据不迁移）。 */
export interface Repo { name: string; role: string; path: string; off?: boolean }
/** lfProject（0.20）= 这个卡片组的落盘文件夹（~/.ai/projects/<lfProject>/）：新建 / 迁移的落盘项目都放这里；缺省 = 还没设。 */
/** updatedAt（0.26）= 最后更新时间（ISO，服务端在每次改动时盖；null = 旧数据查不到）；archivedAt（0.26）= 卡片组归档时间（组里没有活跃卡片才能归档）。 */
export interface Group { id: string; name: string; collapsed: boolean; repos: Repo[]; links: string[]; statuses: Status[]; lfProject?: string; updatedAt?: string | null; archivedAt?: string }
/**
 * 子任务（0.24）：id 稳定标识；note = 任务说明（长文本，里面的 [n] 引用本任务 links 的第 n 条）；type = 子任务类型（空 = 无类型）；
 * links = 绑定的本卡片相关链接 id；subs = 子任务（只一层）；created / updated = 添加 / 最后修改时间（ISO，由服务端盖）。
 * 有子任务时 done 由子任务决定（全部完成 = 完成）。旧数据只有 text / done，读入时补 id。
 */
export interface Task { id?: string; text: string; done: boolean; note?: string; type?: string; links?: string[]; files?: string[]; subs?: Task[]; created?: string; updated?: string; /** v127：截止日期 YYYY-MM-DD（可空）。 */ due?: string; /** v140：关联的会话 id（一个任务一个会话；一个会话可被多个任务关联）。 */ sess?: string }
/** 相关文件（0.26）：id 稳定标识（子任务按 id 绑定）；path = 绝对路径；title = 可选标题（空 = 显示文件名）。 */
export interface FileRef { id: string; path: string; title?: string; /** v136 */ off?: boolean; /** v151（1.2）：以前用过的路径（放到落盘项目 / 迁移 / 改用新位置时记下，最多 8 条）——会话里旧路径的引用照样认得出是这个文件 */ prev?: string[] }
/** 相关说明的一条（0.24）：t = 小标题，v = 内容；pin = 固定在最前（「卡片项目说明」）。 */
export interface NoteItem { t: string; v: string; pin?: boolean; off?: boolean }
/**
 * notes = 相关说明（自由文本）；webLinks = 相关链接（显示文字 + 类型 + 网址，数组顺序 = 展示顺序）；files = 相关文件的绝对路径（只登记，不复制/不删除文件）。
 * 三者都会作为「卡片资料」注入关联会话（0.10）。
 * archivedAt = 归档时间（ISO）；有值 = 已归档：不在看板列里、内容只读，g/col 保留以便恢复回原阶段。三者都可缺省（旧数据兼容）。
 */
export interface WebLink { id?: string; text: string; type: string; url: string; /** v136 */ off?: boolean; /** v140：星标（类型分组内置顶 + 金色卡 / 金色引用胶囊）。 */ star?: boolean; /** v141：类型标签（显示「类型名-标签」，标签全局按类型登记在 Board.linkTypeTags）。 */ tag?: string }
/** repos（0.14）= 这张卡片自己的仓库清单：新建时复制所在组的「卡片共用仓库」，之后与组互不影响。 */
/** noteItems（0.24）= 相关说明（小标题 + 内容，按顺序）；旧版 notes 字符串读入时转成一条「卡片项目说明」。related（0.24）= 关联卡片 id（单向，顺序 = 展示顺序）。 */
export interface Card { id: string; g: string; col: string; order: number; t: string; links: string[]; tasks: Task[]; repos: Repo[]; notes?: string; noteItems?: NoteItem[]; webLinks?: WebLink[]; files?: FileRef[]; archivedAt?: string; pending?: boolean; related?: string[]; updatedAt?: string | null; /** v136：关联卡片里「不注入」的 id（related 仍是纯 id 数组，兼容旧数据；新关联默认不注入）。 */ relOff?: string[] }
/** readKeys = 关联时该会话已读过的落盘项目（不再注入）；只在关联时计算一次，保证注入文本稳定。 */
export interface SessionRef { sessionId: string; cardId: string; createdAt: string; title?: string; readKeys?: string[] }
export interface BoardEvent { at: string; actor: string; kind: string; card?: string; group?: string; from?: string; to?: string }
/** 候选仓库（0.14）：任意卡片组 / 卡片添加过的仓库，移除后也保留；at = 最近一次添加的时间。 */
export interface RepoSeen extends Repo { at: string }
/**
 * linkTypes = 相关链接的「类型」选项（全局共用，数组顺序 = 展示顺序）；缺省 = 默认两项。
 * linkTypeGroups（0.21）= 类型组（顺序 = 展示顺序，types = 组内类型及顺序）；不在任何组里的类型 =「未归类」，排在 linkTypes 末尾。
 * 链接的 type 为空字符串 =「无类型」（不显示标签）。
 */
export interface TypeGroup { id: string; name: string; types: string[] }
/** taskTypes（0.24）= 子任务类型（全局共用，顺序 = 展示顺序；不分组）；缺省 = DEFAULT_TASK_TYPES。 */
/** prefs（0.26）= 全局开关（所有卡片共用）：lf = 添加文件时放到落盘项目；delAdd / delTolf = 添加文件 / 一键放到落盘项目时删除原文件。缺省都开。 */
export interface Prefs { lf: boolean; delAdd: boolean; delTolf: boolean }
/** v140/v141：linkTypeDomains = 类型 → 网址（只留 origin，带结尾 /；同一网址只能属于一个类型）；linkTypeTags = 类型 → 类型标签（全局，≤20 字，同类型不重名）。 */
export interface Board { version: 1; groups: Group[]; cards: Card[]; sessions: SessionRef[]; linkTypes?: string[]; linkTypeGroups?: TypeGroup[]; repoHistory?: RepoSeen[]; taskTypes?: string[]; prefs?: Partial<Prefs>; linkTypeDomains?: Record<string, string[]>; linkTypeTags?: Record<string, string[]> }

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
  // 0.32：未完成任务不能归档（客户端禁用 + host 兜底；0 个任务算完成）
  const left = c.tasks.filter((t) => !t.done).length
  if (left) throw new BoardError('CARD_HAS_TASKS', '卡片「' + c.t + '」还有 ' + left + ' 个任务未完成，完成后才能归档')
  delete c.pending
  c.archivedAt = at
  renumber(cellCards(b, c.g, c.col))
  return c
}

/** v86：pending = 不活跃也不归档；只改展示区，阶段（col）保持不变。 */
export function setPending(b: Board, id: string, on: boolean, col?: string): Card {
  const c = card(b, id)
  if (c.archivedAt) throw new BoardError('CARD_ARCHIVED', '卡片「' + c.t + '」已归档，先恢复活跃再设 pending')
  const g = b.groups.find((x) => x.id === c.g)
  if (col) {
    if (!g || !g.statuses.some((s) => s.id === col)) throw new BoardError('BAD_COL', '阶段不属于这张卡片所在的卡片组')
    c.col = col
  }
  if (on) c.pending = true
  else delete c.pending
  if (g) renumber(cellCards(b, c.g, c.col))
  return c
}

/** 恢复活跃：回到原阶段末尾。原阶段已被删除时放到第一个阶段。 */
export function unarchiveCard(b: Board, id: string): Card {
  const c = card(b, id)
  if (!c.archivedAt) return c
  const g = liveGroup(b, c.g)
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
    out.push({ name, role: typeof r.role === 'string' && r.role.trim() ? r.role.trim() : '仓库', path, ...(r.off === true ? { off: true } : {}) })
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
  const g = liveGroup(b, gId)
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
  // 0.24 其他卡片关联了它的，一并去掉
  for (const x of b.cards) if (x.related?.includes(id)) { x.related = x.related.filter((r) => r !== id); if (!x.related.length) delete x.related; if (x.relOff) { x.relOff = x.relOff.filter((r) => r !== id); if (!x.relOff.length) delete x.relOff } }
}

/**
 * 移动卡片（跨阶段/跨组/组内排序）。beforeId = 插到这张卡之前；缺省 = 放到末尾。
 * 返回事件（供审计写 events.jsonl）。
 */
export function moveCard(b: Board, id: string, to: { g?: string; col: string; beforeId?: string | null }, actor: string): BoardEvent {
  const c = liveCard(b, id)
  const gId = to.g ?? c.g
  const g = liveGroup(b, gId)
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

/** 长文本：统一换行、去 NUL 与行尾空白。 */
const longText = (v: unknown, field: string, max = 20000): string => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new BoardError('BAD_ARG', field + '必须是字符串')
  const s = v.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/\s+$/, '')
  if (s.length > max) throw new BoardError('BAD_ARG', field + '超过 ' + max + ' 字')
  return s
}
const sameTask = (a: Task, x: Task): boolean => a.text === x.text && a.done === x.done && (a.note ?? '') === (x.note ?? '') && (a.type ?? '') === (x.type ?? '') && (a.links ?? []).join() === (x.links ?? []).join() && (a.files ?? []).join() === (x.files ?? []).join() && (a.due ?? '') === (x.due ?? '') && (a.sess ?? '') === (x.sess ?? '')
export const flatTasks = (l: Task[]): Task[] => l.flatMap((t) => [t, ...(t.subs ?? [])])
/** 有子任务的父任务：done = 子任务全部完成。 */
export function rollupDone(list: Task[]): Task[] { for (const t of list) if (t.subs?.length) t.done = t.subs.every((s) => s.done); return list }

/**
 * 子任务整表替换（0.24）：两级树（subs 只允许一层）；按 id 对比旧任务盖时间——新任务 created = updated = at，
 * 内容（标题 / 说明 / 类型 / 链接 / 完成）变了才刷新 updated，只调顺序不算修改。links 只能是本卡片相关链接的 id；type 只能是已有的子任务类型（或空）。
 */
export function setTasks(b: Board, id: string, tasks: unknown, at = new Date().toISOString()): Task[] {
  const c = liveCard(b, id)
  if (!Array.isArray(tasks)) throw new BoardError('BAD_ARG', 'tasks 必须是数组')
  const old = new Map(flatTasks(c.tasks).filter((t) => t.id).map((t) => [t.id as string, t]))
  const linkIds = new Set((c.webLinks ?? []).map((l) => l.id))
  const fileIds = new Set((c.files ?? []).map((f) => f.id))
  const types = taskTypes(b)
  const seen = new Set<string>()
  const one = (raw: unknown, lv: number, where: string): Task => {
    const o = (raw ?? {}) as Record<string, unknown>
    const t: Task = { id: typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) && !seen.has(o.id) ? o.id : newId('t'), text: nonEmpty(o.text, where + '标题'), done: o.done === true }
    seen.add(t.id as string)
    /* v123（2）：任务说明不限字数 —— 不走上限校验，只统一换行 / 去 NUL（请求体上限 32MB 是唯一的物理边界） */
    const note = longText(o.note, where + '说明', Number.POSITIVE_INFINITY)
    if (note) t.note = note
    if (typeof o.type === 'string' && o.type.trim()) {
      const ty = o.type.trim()
      if (!types.includes(ty)) throw new BoardError('BAD_TYPE', where + '类型「' + ty + '」不存在；先在「任务类型管理」里添加')
      t.type = ty
    }
    /* v127：截止日期（空 = 不设；只认 YYYY-MM-DD） */
    if (o.due !== undefined && o.due !== null && o.due !== '') {
      if (typeof o.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.due) || Number.isNaN(Date.parse(o.due))) throw new BoardError('BAD_ARG', where + '截止日期必须是 YYYY-MM-DD')
      t.due = o.due
    }
    /* v140：关联会话（只收合法会话 id；空 = 不关联） */
    if (o.sess !== undefined && o.sess !== null && o.sess !== '') t.sess = sessId(o.sess, where)
    if (o.links !== undefined) {
      if (!Array.isArray(o.links)) throw new BoardError('BAD_ARG', where + 'links 必须是数组')
      const ls = [...new Set(o.links.map(String))]
      for (const l of ls) if (!linkIds.has(l)) throw new BoardError('BAD_LINK', where + '绑定的链接 ' + l + ' 不在这张卡片的相关链接里')
      if (ls.length) t.links = ls
    }
    if (o.files !== undefined) {
      if (!Array.isArray(o.files)) throw new BoardError('BAD_ARG', where + 'files 必须是数组')
      const fs = [...new Set(o.files.map(String))]
      for (const f of fs) if (!fileIds.has(f)) throw new BoardError('BAD_FILE', where + '绑定的文件 ' + f + ' 不在这张卡片的相关文件里')
      if (fs.length) t.files = fs
    }
    if (o.subs !== undefined) {
      if (!Array.isArray(o.subs)) throw new BoardError('BAD_ARG', where + 'subs 必须是数组')
      if (o.subs.length && lv) throw new BoardError('TOO_DEEP', where + '子任务最多一层，不能再有子任务')
      const subs = o.subs.map((s, j) => one(s, 1, where.replace(/：$/, '') + '.' + (j + 1) + ' 子任务：'))
      if (subs.length) t.subs = subs
    }
    const prev = old.get(t.id as string)
    t.created = prev?.created ?? (prev ? undefined : at)
    t.updated = prev ? (sameTask(prev, t) ? prev.updated : at) : at
    if (!t.created) delete t.created
    if (!t.updated) delete t.updated
    return t
  }
  const next = rollupDone(tasks.map((x, i) => one(x, 0, '第 ' + (i + 1) + ' 个任务：')))
  // 父任务因联动改了完成状态，也算修改
  for (const t of next) { const p = old.get(t.id as string); if (p && p.done !== t.done) t.updated = at }
  c.tasks = next
  return c.tasks
}

/**
 * v122（1.4）：任务执行安排 / 本日计划清单里的「勾选」= 卡片任务真的完成（和卡片详情同一份数据）。
 * 只改 done（不整表替换，说明 / 链接 / 文件原样留着）：勾任务 = 连它的子任务；勾子任务 = 子任务全完成时父任务自动完成。
 */
export function setTaskDone(b: Board, id: string, taskId: unknown, on: unknown, at = new Date().toISOString()): Task[] {
  const c = liveCard(b, id)
  if (typeof taskId !== 'string' || !taskId) throw new BoardError('BAD_ARG', '缺少任务 id')
  const v = on === true
  for (const t of c.tasks) {
    if (t.id === taskId) {
      if (t.done !== v) { t.done = v; t.updated = at }
      for (const s of t.subs ?? []) if (s.done !== v) { s.done = v; s.updated = at }
      return c.tasks
    }
    for (const s of t.subs ?? []) {
      if (s.id !== taskId) continue
      if (s.done !== v) { s.done = v; s.updated = at }
      const all = (t.subs ?? []).every((x) => x.done)
      if (t.done !== all) { t.done = all; t.updated = at }
      return c.tasks
    }
  }
  throw new BoardError('NOT_FOUND', '卡片「' + c.t + '」里没有这个任务：' + taskId)
}

/** 深拷贝子任务树（工具改动前用）。 */
export const taskList = (l: Task[]): Task[] => l.map((t) => ({ ...t, ...(t.links ? { links: t.links.slice() } : {}), ...(t.files ? { files: t.files.slice() } : {}), ...(t.subs ? { subs: taskList(t.subs) } : {}) }))
/** 按编号（"2" / "2.1"，1 起）找子任务；越界点名。 */
export function taskAt(list: Task[], num: string): { task: Task; list: Task[]; i: number; sub: boolean } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(num).trim())
  if (!m) throw new BoardError('BAD_INDEX', '任务编号要写成 2 或 2.1：' + num)
  const i = +m[1] - 1
  if (!list[i]) throw new BoardError('BAD_INDEX', '没有第 ' + m[1] + ' 个任务（共 ' + list.length + ' 个）')
  if (!m[2]) return { task: list[i], list, i, sub: false }
  const subs = list[i].subs ?? []
  const j = +m[2] - 1
  if (!subs[j]) throw new BoardError('BAD_INDEX', '第 ' + m[1] + ' 个任务下没有 ' + num + '（共 ' + subs.length + ' 个子任务）')
  return { task: subs[j], list: subs, i: j, sub: true }
}

/** 0.24 相关说明（小标题 + 内容）整表替换：每条小标题、内容都不能空；pin 只认第一条。空数组 = 清空。 */
export function setNoteItems(b: Board, id: string, items: unknown): Card {
  const c = liveCard(b, id)
  if (!Array.isArray(items)) throw new BoardError('BAD_ARG', 'items 必须是数组')
  const clean = items.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    const t = typeof o.t === 'string' ? o.t.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
    if (!t) throw new BoardError('BAD_ARG', '第 ' + (i + 1) + ' 条说明：请写小标题')
    if (t.length > 60) throw new BoardError('BAD_ARG', '第 ' + (i + 1) + ' 条说明：小标题超过 60 字')
    if (typeof o.v !== 'string') throw new BoardError('BAD_ARG', '第 ' + (i + 1) + ' 条说明的内容必须是字符串')
    // 内容原样保存（只统一换行、去 NUL），不限字数（受 HTTP 体上限约束）
    const v = o.v.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
    if (!v.trim()) throw new BoardError('BAD_ARG', '第 ' + (i + 1) + ' 条说明「' + t + '」：请写内容')
    return { t, v, ...(i === 0 && o.pin === true ? { pin: true } : {}), ...(o.off === true ? { off: true } : {}) }
  })
  delete c.notes
  if (clean.length) c.noteItems = clean
  else delete c.noteItems
  return c
}
/** 旧接口兼容：一整段文字 = 一条「卡片项目说明」。 */
export function setNotes(b: Board, id: string, text: unknown): Card {
  if (typeof text !== 'string') throw new BoardError('BAD_ARG', 'notes 必须是字符串')
  return setNoteItems(b, id, text.trim() ? [{ t: NOTE_PIN_TITLE, v: text, pin: true }] : [])
}
export const NOTE_PIN_TITLE = '卡片项目说明'

/** 0.24 关联卡片整表替换：只能是其他存在的卡片（活跃 / 已归档都行），去重保序。 */
export function setRelated(b: Board, id: string, ids: unknown): Card {
  const c = liveCard(b, id)
  if (!Array.isArray(ids)) throw new BoardError('BAD_ARG', 'cards 必须是数组')
  const out: string[] = []
  const off = new Set<string>()
  const was = new Set(c.related ?? []), wasOff = new Set(c.relOff ?? [])
  for (const raw of ids) {
    // v136：每项可以是 id，或 {id, off}；只给 id 时：老关联保持原开关，新关联默认不注入
    const o = raw && typeof raw === 'object' ? raw as { id?: unknown; off?: unknown } : null
    const x = o ? o.id : raw
    if (typeof x !== 'string' || x === id) throw new BoardError('BAD_ARG', '不能关联自己或无效的卡片：' + String(x))
    if (!b.cards.some((y) => y.id === x)) throw new BoardError('NO_CARD', '找不到卡片 ' + x)
    if (out.includes(x)) continue
    out.push(x)
    if (o && typeof o.off === 'boolean' ? o.off : was.has(x) ? wasOff.has(x) : true) off.add(x)
  }
  if (out.length) c.related = out
  else delete c.related
  if (off.size) c.relOff = out.filter((x) => off.has(x)); else delete c.relOff
  return c
}

/** 子任务说明里引用 [n] 的链接解除后：[k] → 「链接名」，后面的编号前移。 */
export function dropRef(note: string, links: string[], linkId: string, text: string): { note: string; links: string[] } {
  const k = links.indexOf(linkId) + 1
  if (!k) return { note, links }
  return { links: links.filter((x) => x !== linkId), note: note.replace(/\[(\d{1,2})\]/g, (m, n) => (+n === k ? '「' + text + '」' : +n > k ? '[' + (n - 1) + ']' : m)) }
}

// ── 0.24 子任务类型（全局，不分组） ──
export const DEFAULT_TASK_TYPES = ['开发', '验证', '文档', '沟通']
export const taskTypes = (b: Board): string[] => b.taskTypes ?? DEFAULT_TASK_TYPES.slice()
const allTasksOf = (b: Board): Task[] => b.cards.flatMap((c) => flatTasks(c.tasks))
export const taskTypeUse = (b: Board, name: string): number => allTasksOf(b).filter((t) => t.type === name).length
export function addTaskType(b: Board, name: unknown): string {
  const v = typeName(name)
  if (v === NO_TYPE) throw new BoardError('BAD_ARG', '「' + NO_TYPE + '」是保留名，不能用作类型名')
  const ts = taskTypes(b)
  if (ts.includes(v)) throw new BoardError('BAD_ARG', '已经有「' + v + '」了')
  b.taskTypes = [...ts, v]
  return v
}
export function renameTaskType(b: Board, from: unknown, to: unknown): { name: string; tasks: number } {
  const ts = taskTypes(b)
  const i = typeof from === 'string' ? ts.indexOf(from) : -1
  if (i < 0) throw new BoardError('NOT_FOUND', '没有这个任务类型：' + String(from))
  const v = typeName(to)
  if (v === from) return { name: v, tasks: 0 }
  if (v === NO_TYPE) throw new BoardError('BAD_ARG', '「' + NO_TYPE + '」是保留名，不能用作类型名')
  if (ts.includes(v)) throw new BoardError('BAD_ARG', '已经有「' + v + '」了')
  let n = 0
  for (const t of allTasksOf(b)) if (t.type === from) { t.type = v; n++ }
  b.taskTypes = ts.map((x) => (x === from ? v : x))
  return { name: v, tasks: n }
}
export function deleteTaskType(b: Board, name: unknown): { tasks: number } {
  if (typeof name !== 'string' || !taskTypes(b).includes(name)) throw new BoardError('NOT_FOUND', '没有这个任务类型：' + String(name))
  let n = 0
  for (const t of allTasksOf(b)) if (t.type === name) { delete t.type; n++ }
  b.taskTypes = taskTypes(b).filter((x) => x !== name)
  return { tasks: n }
}
export function placeTaskType(b: Board, name: unknown, at: unknown): void {
  const ts = taskTypes(b)
  if (typeof name !== 'string' || !ts.includes(name)) throw new BoardError('NOT_FOUND', '没有这个任务类型：' + String(name))
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) throw new BoardError('BAD_ARG', '位置不对：' + String(at))
  const rest = ts.filter((x) => x !== name)
  rest.splice(Math.min(at, rest.length), 0, name)
  b.taskTypes = rest
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

/** 相关文件标题：去控制字符、折叠空白、限 120 字；等于文件名 = 不存（显示文件名）。 */
const fileTitle = (v: unknown, path: string): string => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new BoardError('BAD_ARG', '文件标题必须是字符串')
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > 120) throw new BoardError('BAD_ARG', '文件标题超过 120 字')
  return s === baseName(path) ? '' : s
}
export const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
export const filePaths = (c: Card): string[] => (c.files ?? []).map((f) => f.path)

/**
 * 追加相关文件（0.26：每项可带标题）：逐个校验，任一非法整批不写；已关联的跳过。
 * items = 路径字符串或 {path, title}。返回新增数、跳过数与新增文件的 id。
 */
export function addFiles(b: Board, id: string, items: unknown): { added: number; skipped: number; ids: string[] } {
  const c = liveCard(b, id)
  if (!Array.isArray(items) || items.length === 0) throw new BoardError('BAD_ARG', '没有要添加的文件')
  const clean = items.map((x) => { const o = (typeof x === 'string' ? { path: x } : (x ?? {})) as { path?: unknown; title?: unknown; off?: unknown }; const path = filePath(o.path); return { path, title: fileTitle(o.title, path), off: o.off === true } })
  const cur = c.files ?? []
  const ids: string[] = []
  for (const x of clean) {
    if (cur.some((f) => f.path === x.path)) continue
    const f: FileRef = { id: newId('f'), path: x.path, ...(x.title ? { title: x.title } : {}), ...(x.off ? { off: true } : {}) }
    cur.push(f); ids.push(f.id)
  }
  c.files = cur
  return { added: ids.length, skipped: clean.length - ids.length, ids }
}
function fileOf(c: Card, fileId: unknown): FileRef {
  const f = (c.files ?? []).find((x) => x.id === fileId || x.path === fileId)
  if (!f) throw new BoardError('NOT_LINKED', '卡片「' + c.t + '」没有关联这个文件：' + String(fileId))
  return f
}
/** 0.26 改标题（空 = 显示文件名）。 */
export function setFileTitle(b: Board, id: string, fileId: unknown, title: unknown): FileRef {
  const f = fileOf(liveCard(b, id), fileId)
  const t = fileTitle(title, f.path)
  if (t) f.title = t; else delete f.title
  return f
}
/** v136 改「自动注入 Agent 会话」开关（on = 注入）。 */
export function setFileOff(b: Board, id: string, fileId: unknown, on: unknown): FileRef {
  const f = fileOf(liveCard(b, id), fileId)
  if (typeof on !== 'boolean') throw new BoardError('BAD_ARG', 'on 必须是 true / false')
  if (on) delete f.off; else f.off = true
  return f
}
/**
 * 0.26 放到落盘项目后改指向（撤销时改回）。
 * v154（1.1）：改路径的同一个事务里，把任务说明 / 相关说明里指向旧路径的引用原文一起改到新路径
 * （撤销 = 反向调用，同一段代码改回）—— 否则会话胶囊只能靠 prev / 同名兜底猜，就会出现
 * 「卡片里明明有、对话框却显示已不在」。
 */
export function setFilePath(b: Board, id: string, fileId: unknown, path: unknown): FileRef {
  const c = liveCard(b, id)
  const f = fileOf(c, fileId)
  const p = filePath(path)
  if ((c.files ?? []).some((x) => x !== f && x.path === p)) throw new BoardError('FILE_LINKED', '卡片「' + c.t + '」已经关联了 ' + p)
  const old = f.path
  notePrev(f, p)
  f.path = p
  syncFileRefs(b, f, old)
  return f
}
/** v151（1.2）：改路径前把旧路径记进 prev（去重、新的在前、最多 8 条；改回原路径时从 prev 里拿掉）。 */
export function notePrev(f: FileRef, next: string): void {
  if (!f.path || f.path === next) return
  const p = [f.path, ...(f.prev ?? [])].filter((x, i, a) => x !== next && a.indexOf(x) === i).slice(0, 8)
  if (p.length) f.prev = p; else delete f.prev
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

/** 解除关联：只从列表移除，不碰文件本身；绑定它的子任务一并解绑。返回撤销所需的信息。 */
export function removeFile(b: Board, id: string, fileId: unknown): { file: FileRef; index: number; tasks: string[] } {
  const c = liveCard(b, id)
  const f = fileOf(c, fileId)
  const index = (c.files as FileRef[]).indexOf(f)
  c.files = (c.files as FileRef[]).filter((x) => x !== f)
  if (!c.files.length) delete c.files
  const tasks: string[] = []
  for (const t of flatTasks(c.tasks)) if (t.files?.includes(f.id)) { t.files = t.files.filter((x) => x !== f.id); if (!t.files.length) delete t.files; tasks.push(t.id as string) }
  return { file: f, index, tasks }
}
/** 撤销解除关联：放回原位置，重新绑到原来的子任务（子任务已删的跳过）。 */
export function restoreFile(b: Board, id: string, raw: unknown, index: unknown, tasks: unknown): FileRef {
  const c = liveCard(b, id)
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id)) throw new BoardError('BAD_ARG', '文件 id 无效')
  const path = filePath(o.path)
  const cur = c.files ?? []
  if (cur.some((x) => x.id === o.id || x.path === path)) throw new BoardError('FILE_LINKED', '这个文件已经在卡片「' + c.t + '」里了')
  const f: FileRef = { id: o.id, path, ...(fileTitle(o.title, path) ? { title: fileTitle(o.title, path) } : {}), ...(o.off === true ? { off: true } : {}) }
  cur.splice(typeof index === 'number' && index >= 0 ? Math.min(index, cur.length) : cur.length, 0, f)
  c.files = cur
  const ids = new Set(Array.isArray(tasks) ? tasks.map(String) : [])
  for (const t of flatTasks(c.tasks)) if (ids.has(t.id as string)) t.files = [...(t.files ?? []), f.id]
  return f
}

// ── 0.26 复制卡片 / 卡片组归档 / 批量展开折叠 / 全局开关 / 最后更新时间 ──
const DUP_RE = /（(\d+)）$/
/** 复制后的名字：「xxx」→「xxx（1）」；复制「xxx（1）」接着编号（同组里已有的最大号 + 1）。 */
export function dupName(b: Board, c: Card): string {
  const root = c.t.replace(DUP_RE, '').trim() || c.t
  let n = 0
  for (const x of b.cards) if (x.g === c.g && x.t.startsWith(root + '（')) { const m = /^（(\d+)）$/.exec(x.t.slice(root.length)); if (m) n = Math.max(n, +m[1]) }
  return root + '（' + (n + 1) + '）'
}
/**
 * 复制卡片：同组同阶段，排在「原卡片 + 已有副本」最后一张后面（原卡片已归档 → 放到阶段末尾，阶段没了放第一个）。
 * 复制：子任务（含子集；新 id、全部未勾选、时间重盖）、相关说明 / 链接 / 文件、仓库、关联卡片。不复制：会话、关联的落盘项目、归档状态。
 */
export function copyCard(b: Board, id: string, at = new Date().toISOString()): Card {
  const c = card(b, id)
  const g = liveGroup(b, c.g)
  const root = c.t.replace(DUP_RE, '').trim() || c.t
  const col = g.statuses.some((s) => s.id === c.col) ? c.col : g.statuses[0].id
  const cell = cellCards(b, c.g, col)
  const fam = cell.filter((y) => y.t === root || (y.t.startsWith(root + '（') && /^（\d+）$/.test(y.t.slice(root.length))))
  const after = c.archivedAt ? null : fam.reduce((m, y) => (y.order > m.order ? y : m), c)
  const cp = (t: Task): Task => {
    const x: Task = { id: newId('t'), text: t.text, done: false, created: at, updated: at }
    if (t.note) x.note = t.note
    if (t.type) x.type = t.type
    if (t.due) x.due = t.due
    if (t.links?.length) x.links = t.links.slice()
    if (t.files?.length) x.files = t.files.slice()
    if (t.subs?.length) x.subs = t.subs.map(cp)
    return x
  }
  const x: Card = { id: newId('c'), g: c.g, col, order: 0, t: dupName(b, c).slice(0, 120), links: [], tasks: c.tasks.map(cp), repos: (c.repos ?? []).map((r) => ({ ...r })) }
  if (c.noteItems?.length) x.noteItems = c.noteItems.map((n) => ({ ...n }))
  if (c.webLinks?.length) x.webLinks = c.webLinks.map((l) => ({ ...l }))
  if (c.files?.length) x.files = c.files.map((f) => ({ ...f }))
  if (c.related?.length) x.related = c.related.slice()
  if (c.relOff?.length) x.relOff = c.relOff.slice()
  const list = cell.slice()
  list.splice(after ? list.indexOf(after) + 1 : list.length, 0, x)
  b.cards.push(x)
  renumber(list)
  return x
}
/** 要往里加卡片 / 移卡片的卡片组：已归档的先恢复。 */
export function liveGroup(b: Board, id: string): Group {
  const g = group(b, id)
  if (g.archivedAt) throw new BoardError('GROUP_ARCHIVED', '卡片组「' + g.name + '」已归档；先在「已归档卡片组」里恢复活跃')
  return g
}
/** 归档卡片组：组里还有活跃卡片就拒绝（点名张数）；阶段、会话、仓库都不动。 */
export function archiveGroup(b: Board, id: string, at = new Date().toISOString()): Group {
  const g = group(b, id)
  if (g.archivedAt) return g
  const left = b.cards.filter((c) => c.g === id && !c.archivedAt)
  const pend = left.filter((c) => c.pending).length
  const n = left.length
  // v86：pending 卡片不属于活跃卡片，但组里还有 pending 也不能归档整组（消息点名 pending，别把 pending 叫活跃）
  if (n) throw new BoardError('GROUP_HAS_CARDS', '卡片组「' + g.name + '」还有 ' + n + ' 张卡片没归档' + (pend ? '（含 ' + pend + ' 张 pending）' : '') + '，全部归档后才能归档卡片组')
  g.archivedAt = at
  return g
}
/** 恢复活跃：回到归档前的位置（归档时没挪动，顺序不变）；里面的卡片仍是已归档。 */
export function unarchiveGroup(b: Board, id: string): Group { const g = group(b, id); delete g.archivedAt; return g }
/** 卡片组管理栏：open = 展开有活跃卡片的组；only = 有活跃卡片的展开、没有的收起；fold = 全部折叠。只动活跃组。 */
export function bulkCollapse(b: Board, mode: unknown, liveGroups?: string[]): { opened: number; folded: number } {
  if (mode !== 'open' && mode !== 'only' && mode !== 'fold') throw new BoardError('BAD_ARG', 'mode 只能是 open / only / fold：' + String(mode))
  let opened = 0, folded = 0
  for (const g of b.groups) {
    if (g.archivedAt) continue
    const has = b.cards.some((c) => c.g === g.id && !c.archivedAt && !c.pending)
    // v86：「只展开活跃卡片组」= 有活跃会话的组（client 传 liveGroups）；没有传就退回「有未归档且非 pending 的卡片」
    const live = liveGroups ? liveGroups.includes(g.id) : has
    const want = mode === 'fold' ? true : mode === 'open' ? (has ? false : g.collapsed) : !live
    if (g.collapsed !== want) { g.collapsed = want; if (want) folded++; else opened++ }
  }
  return { opened, folded }
}
export const prefsOf = (b: Board): Prefs => ({ lf: b.prefs?.lf !== false, delAdd: b.prefs?.delAdd !== false, delTolf: b.prefs?.delTolf !== false })
export function setPrefs(b: Board, patch: unknown): Prefs {
  const o = (patch ?? {}) as Record<string, unknown>
  const next = prefsOf(b)
  for (const k of ['lf', 'delAdd', 'delTolf'] as const) if (o[k] !== undefined) { if (typeof o[k] !== 'boolean') throw new BoardError('BAD_ARG', k + ' 必须是 true / false'); next[k] = o[k] as boolean }
  b.prefs = next
  return next
}
/** 比较用的签名：去掉不算「修改」的字段（顺序、折叠、时间、归档）。 */
const sigOf = (o: object, skip: readonly string[]): string => JSON.stringify(o, (k, v) => (skip.includes(k) ? undefined : v))
const CARD_SKIP = ['order', 'updatedAt', 'archivedAt']
const GROUP_SKIP = ['collapsed', 'updatedAt', 'archivedAt']
/** 每次写盘前盖「最后更新时间」：内容变了的卡片 + 它所在（及原来所在）的卡片组；删了卡片也算组被改。 */
export function stampTimes(prev: Board, next: Board, at: string): void {
  const pc = new Map(prev.cards.map((c) => [c.id, c]))
  const touched = new Set<string>()
  for (const c of next.cards) {
    const p = pc.get(c.id)
    if (p && sigOf(p, CARD_SKIP) === sigOf(c, CARD_SKIP)) continue
    c.updatedAt = at; touched.add(c.g); if (p) touched.add(p.g)
  }
  const ids = new Set(next.cards.map((c) => c.id))
  for (const c of prev.cards) if (!ids.has(c.id)) touched.add(c.g)
  const pg = new Map(prev.groups.map((g) => [g.id, sigOf(g, GROUP_SKIP)]))
  for (const g of next.groups) if (touched.has(g.id) || pg.get(g.id) !== sigOf(g, GROUP_SKIP)) g.updatedAt = at
}
/** 0.26 升级：旧数据没有最后更新时间 → 从审计日志里这张卡片最后一次改动补（归档 / 恢复不算）；卡片组取它卡片里最新的；查不到 = null（显示「—」）。 */
export function backfillTimes(b: Board, events: ReadonlyArray<{ at?: string; card?: string; group?: string; kind?: string }>): number {
  const last = new Map<string, string>()
  for (const e of events) if (e.card && e.at && e.kind !== 'card/archive' && e.kind !== 'card/unarchive' && (last.get(e.card) ?? '') < e.at) last.set(e.card, e.at)
  let n = 0
  for (const c of b.cards) if (c.updatedAt === undefined) { c.updatedAt = last.get(c.id) ?? null; n++ }
  for (const g of b.groups) if (g.updatedAt === undefined) {
    const ts = b.cards.filter((c) => c.g === g.id && c.updatedAt).map((c) => c.updatedAt as string)
    g.updatedAt = ts.length ? ts.reduce((m, x) => (x > m ? x : m)) : null; n++
  }
  return n
}

export const DEFAULT_LINK_TYPES = ['文档', '代码']
export const NO_TYPE = '无类型'
export const LOOSE_GROUP = '未归类'
export const linkTypes = (b: Board): string[] => b.linkTypes ?? DEFAULT_LINK_TYPES.slice()
export const typeGroups = (b: Board): TypeGroup[] => b.linkTypeGroups ?? []
/** 「未归类」的类型（按 linkTypes 里的顺序）。 */
export const looseTypes = (b: Board): string[] => { const g = new Set(typeGroups(b).flatMap((x) => x.types)); return linkTypes(b).filter((t) => !g.has(t)) }
/** 写回：linkTypes = 各组类型依次 + 未归类；组里只留真实存在、不重复的类型。 */
function setTypes(b: Board, groups: TypeGroup[], loose: string[]): void {
  b.linkTypeGroups = groups
  b.linkTypes = [...groups.flatMap((g) => g.types), ...loose]
  if (!groups.length) delete b.linkTypeGroups
}
const typeName = (v: unknown, field = '类型'): string => {
  const s = nonEmpty(v, field)
  if (s.length > 20) throw new BoardError('BAD_ARG', field + '超过 20 字')
  return s
}
function typeGroup(b: Board, id: unknown): TypeGroup {
  const g = typeGroups(b).find((x) => x.id === id)
  if (!g) throw new BoardError('NOT_FOUND', '没有这个类型组：' + String(id))
  return g
}

/** 新增全局「类型」选项（已有则不变）；group = 放进哪个类型组（缺省 = 未归类）。类型名限 20 字，不能叫「无类型」。 */
export function addLinkType(b: Board, name: unknown, group?: unknown): string {
  const v = typeName(name)
  if (v === NO_TYPE) throw new BoardError('BAD_ARG', '「' + NO_TYPE + '」是保留名，不能用作类型名')
  const g = group === undefined || group === null ? undefined : typeGroup(b, group)
  const ts = linkTypes(b)
  if (ts.includes(v)) return v
  const groups = typeGroups(b).map((x) => ({ ...x, types: x === g ? [...x.types, v] : x.types }))
  setTypes(b, groups, g ? looseTypes(b) : [...looseTypes(b), v])
  return v
}

/** 0.13 改名全局「类型」：类型表、所在类型组与所有卡片（含已归档）里用旧名的链接一起改，任一校验失败什么都不写。返回新名与改到的链接数。 */
export function renameLinkType(b: Board, from: unknown, to: unknown): { name: string; links: number } {
  const ts = linkTypes(b)
  const i = typeof from === 'string' ? ts.indexOf(from) : -1
  if (i < 0) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(from))
  const v = typeName(to)
  if (v === from) return { name: v, links: 0 }
  if (v === NO_TYPE) throw new BoardError('BAD_ARG', '「' + NO_TYPE + '」是保留名，不能用作类型名')
  if (ts.includes(v)) throw new BoardError('BAD_ARG', '已经有「' + v + '」了')
  let n = 0
  for (const c of b.cards) for (const l of c.webLinks ?? []) if (l.type === from) { l.type = v; n++ }
  /* v140/v141：网址 / 标签跟着类型改名 */
  for (const k of ['linkTypeDomains', 'linkTypeTags'] as const) { const m = b[k], f = from as string; if (m && f in m) { m[v] = m[f]; delete m[f] } }
  const ren = (t: string): string => (t === from ? v : t)
  setTypes(b, typeGroups(b).map((g) => ({ ...g, types: g.types.map(ren) })), looseTypes(b).map(ren))
  return { name: v, links: n }
}

/** 0.21 删除类型：从类型表和类型组里去掉；用它的链接（含已归档卡片）改成「无类型」。返回改到的链接数。 */
export function deleteLinkType(b: Board, name: unknown): { links: number } {
  if (typeof name !== 'string' || !linkTypes(b).includes(name)) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(name))
  let n = 0
  for (const c of b.cards) for (const l of c.webLinks ?? []) if (l.type === name) { l.type = ''; delete l.tag; n++ }
  /* v140/v141：网址 / 标签随类型一起删 */
  for (const k of ['linkTypeDomains', 'linkTypeTags'] as const) { const m = b[k]; if (m) { delete m[name]; if (!Object.keys(m).length) delete b[k] } }
  setTypes(b, typeGroups(b).map((g) => ({ ...g, types: g.types.filter((t) => t !== name) })), looseTypes(b).filter((t) => t !== name))
  return { links: n }
}

/** 0.21 把类型放到某个类型组（null = 未归类）的第 at 位（at 按去掉它之后的列表算，越界夹到末尾）。 */
export function placeLinkType(b: Board, name: unknown, group: unknown, at: unknown): void {
  if (typeof name !== 'string' || !linkTypes(b).includes(name)) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(name))
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) throw new BoardError('BAD_ARG', '位置不对：' + String(at))
  const g = group === null || group === undefined ? null : typeGroup(b, group)
  const groups = typeGroups(b).map((x) => ({ ...x, types: x.types.filter((t) => t !== name) }))
  const loose = looseTypes(b).filter((t) => t !== name)
  const list = g ? (groups.find((x) => x.id === g.id) as TypeGroup).types : loose
  list.splice(Math.min(at, list.length), 0, name)
  setTypes(b, groups, loose)
}

/** 0.21 新增类型组（排在最后、还没有类型）。组名限 20 字、不能重名、不能叫「未归类」。 */
export function addTypeGroup(b: Board, name: unknown): TypeGroup {
  const v = typeName(name, '类型组名')
  if (v === LOOSE_GROUP || typeGroups(b).some((g) => g.name === v)) throw new BoardError('BAD_ARG', '已经有类型组「' + v + '」了')
  const g: TypeGroup = { id: newId('tg'), name: v, types: [] }
  setTypes(b, [...typeGroups(b), g], looseTypes(b))
  return g
}
export function renameTypeGroup(b: Board, id: unknown, to: unknown): TypeGroup {
  const g = typeGroup(b, id)
  const v = typeName(to, '类型组名')
  if (v !== g.name && (v === LOOSE_GROUP || typeGroups(b).some((x) => x.name === v))) throw new BoardError('BAD_ARG', '已经有类型组「' + v + '」了')
  g.name = v
  return g
}
export function moveTypeGroup(b: Board, id: unknown, to: unknown): void {
  const gs = typeGroups(b).slice()
  const i = gs.indexOf(typeGroup(b, id))
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= gs.length) throw new BoardError('BAD_ARG', '位置越界：' + String(to) + '（共 ' + gs.length + ' 个类型组）')
  const [g] = gs.splice(i, 1)
  gs.splice(to, 0, g)
  setTypes(b, gs, looseTypes(b))
}
/** 0.21 删除类型组：组里的类型移到「未归类」最前面，链接不受影响。返回移过去的类型数。 */
export function deleteTypeGroup(b: Board, id: unknown): { types: number } {
  const g = typeGroup(b, id)
  setTypes(b, typeGroups(b).filter((x) => x !== g), [...g.types, ...looseTypes(b)])
  return { types: g.types.length }
}


/* ══ v140 / v141：链接类型网址（多个）+ 类型标签 + 星标 ══ */
/** 网址只留 origin（带结尾 /）：没写协议补 https://；有空格 / 无「.」的域名 / 非 http(s) 报错。空串 = 合法空。 */
export function normDomain(v: unknown): string {
  if (typeof v !== 'string') throw new BoardError('BAD_URL', '网址必须是字符串')
  let s = v.trim()
  if (!s) return ''
  if (/\s/.test(s)) throw new BoardError('BAD_URL', '网址里不能有空格：' + s)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  let u: URL
  try { u = new URL(s) } catch { throw new BoardError('BAD_URL', '不是网址：' + v + '（例：https://www.baidu.com）') }
  if (!/^https?:$/.test(u.protocol)) throw new BoardError('BAD_URL', '只支持 http:// 或 https://：' + v)
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && u.hostname !== 'localhost') throw new BoardError('BAD_URL', '域名要带「.」：' + u.hostname + '（例：github.com）')
  return u.origin.toLowerCase() + '/'
}
const hostOfDomain = (d: string): string => { try { return new URL(d).hostname.toLowerCase() } catch { return '' } }
/** 这个网址（按域名）已经属于哪个类型（没有 = ''）。 */
export function domainOwner(b: Board, d: string): string {
  const h = hostOfDomain(d)
  for (const [t, ds] of Object.entries(b.linkTypeDomains ?? {})) if (ds.some((x) => hostOfDomain(x) === h)) return t
  return ''
}
export function addTypeDomain(b: Board, type: unknown, raw: unknown): string {
  if (typeof type !== 'string' || !linkTypes(b).includes(type)) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(type))
  const d = normDomain(raw)
  if (!d) throw new BoardError('BAD_URL', '先填网址')
  const own = domainOwner(b, d)
  if (own === type) throw new BoardError('DUP_DOMAIN', '「' + type + '」已经有 ' + d + ' 了')
  if (own) throw new BoardError('DUP_DOMAIN', d + ' 已经属于「' + own + '」：一个网址只能配置到一个类型上（先去「' + own + '」里删掉）')
  const m = b.linkTypeDomains ?? (b.linkTypeDomains = {})
  ;(m[type] ?? (m[type] = [])).push(d)
  return d
}
export function removeTypeDomain(b: Board, type: unknown, d: unknown): void {
  const m = b.linkTypeDomains
  if (typeof type !== 'string' || !m?.[type]?.includes(String(d))) throw new BoardError('NOT_FOUND', '「' + String(type) + '」没有网址 ' + String(d))
  m[type] = m[type].filter((x) => x !== d)
  if (!m[type].length) delete m[type]
  if (!Object.keys(m).length) delete b.linkTypeDomains
}
/** 完整链接按域名（含子域名，取最长匹配）自动选的类型；没有 = null。 */
export function typeForUrl(b: Board, url: string): { type: string; domain: string } | null {
  let h: string
  try { h = new URL(url).hostname.toLowerCase() } catch { return null }
  let best: { type: string; domain: string; n: number } | null = null
  for (const [t, ds] of Object.entries(b.linkTypeDomains ?? {})) for (const d of ds) { const dh = hostOfDomain(d); if ((h === dh || h.endsWith('.' + dh)) && (!best || dh.length > best.n)) best = { type: t, domain: d, n: dh.length } }
  return best ? { type: best.type, domain: best.domain } : null
}
export function addTypeTag(b: Board, type: unknown, raw: unknown): string {
  if (typeof type !== 'string' || !linkTypes(b).includes(type)) throw new BoardError('NOT_FOUND', '没有这个类型：' + String(type))
  const v = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (!v) throw new BoardError('BAD_ARG', '先填标签名')
  if (v.length > 20) throw new BoardError('BAD_ARG', '标签最多 20 个字')
  const m = b.linkTypeTags ?? (b.linkTypeTags = {})
  const list = m[type] ?? (m[type] = [])
  if (list.includes(v)) throw new BoardError('DUP_TAG', '「' + type + '」已经有这个标签了')
  list.push(v)
  return v
}
/** 删标签：用到它的链接回到只显示类型名。返回改到的链接数。 */
export function removeTypeTag(b: Board, type: unknown, tag: unknown): { links: number } {
  const m = b.linkTypeTags
  if (typeof type !== 'string' || !m?.[type]?.includes(String(tag))) throw new BoardError('NOT_FOUND', '「' + String(type) + '」没有标签 ' + String(tag))
  m[type] = m[type].filter((x) => x !== tag)
  if (!m[type].length) delete m[type]
  if (!Object.keys(m).length) delete b.linkTypeTags
  let n = 0
  for (const c of b.cards) for (const l of c.webLinks ?? []) if (l.type === type && l.tag === tag) { delete l.tag; n++ }
  return { links: n }
}
/** 星标：加星 = 挪到本类型组里已有星标链接的最下面；去星 = 排到星标后面（本类型的第一个非星标前）。 */
export function setLinkStar(b: Board, id: string, linkId: unknown, on: unknown): WebLink {
  const c = liveCard(b, id)
  const ls = c.webLinks ?? []
  const i = ls.findIndex((l) => l.id === linkId)
  if (i < 0) throw new BoardError('NOT_FOUND', '这张卡片没有链接 ' + String(linkId))
  const l = ls[i]
  if (on === true) l.star = true; else delete l.star
  ls.splice(i, 1)
  const same = (x: WebLink): boolean => (x.type || '') === (l.type || '')
  let at = -1
  if (on === true) { for (let k = 0; k < ls.length; k++) if (same(ls[k]) && ls[k].star) at = k; at = at >= 0 ? at + 1 : ls.findIndex(same) }
  else { at = ls.findIndex((x) => same(x) && !x.star); if (at < 0) { for (let k = 0; k < ls.length; k++) if (same(ls[k])) at = k + 1 } }
  ls.splice(at < 0 ? ls.length : at, 0, l)
  return l
}

/* ══ v140：任务关联会话 ══ */
const sessId = (v: unknown, where = ''): string => {
  if (typeof v !== 'string' || !/^[\w.:-]{1,128}$/.test(v)) throw new BoardError('BAD_ARG', where + '会话 id 不对：' + String(v))
  return v
}
/** 设 / 清一个任务或子任务关联的会话（只改 sess，不整表替换）。sess 空 = 取消关联。 */
export function setTaskSession(b: Board, id: string, taskId: unknown, sess: unknown, at = new Date().toISOString()): Task {
  const c = liveCard(b, id)
  const t = flatTasks(c.tasks).find((x) => x.id === taskId)
  if (!t) throw new BoardError('NOT_FOUND', '这张卡片没有任务 ' + String(taskId))
  if (sess === undefined || sess === null || sess === '') delete t.sess
  else {
    const sid = sessId(sess)
    t.sess = sid
    /* v151（2.2）：一个会话一次只属于一张卡片 —— 任务 / 子任务关联它 = 它关联到这个任务所在的卡片（原来在别的卡片 = 挪过来），
       别的卡片里关联它的任务 / 子任务一并解除（会话不能跨卡片关联任务）。 */
    const ref = sessionRef(b, sid)
    if (!ref || ref.cardId !== c.id) bindSession(b, sid, c.id, ref?.title)
  }
  t.updated = at
  return t
}
/** v151（2.2）：会话换了卡片 → 其它卡片里关联它的任务 / 子任务解除关联（返回解除了几个）。 */
export function dropForeignTaskSess(b: Board, sid: string, keepCard: string): number {
  let n = 0
  for (const c of b.cards) if (c.id !== keepCard) for (const t of flatTasks(c.tasks)) if (t.sess === sid) { delete t.sess; n++ }
  return n
}
/** 一个会话被这张卡片里几个任务 / 子任务关联。 */
export const sessionTaskCount = (c: Card, sid: string): number => flatTasks(c.tasks).filter((t) => t.sess === sid).length

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

/** 相关链接整表替换（新增 / 编辑 / 删除 / 排序都走这里）：逐条校验，任一非法整批不写；没见过的类型自动加入全局选项（未归类）；type 空 = 无类型。 */
export function setWebLinks(b: Board, id: string, list: unknown): Card {
  const c = liveCard(b, id)
  if (!Array.isArray(list)) throw new BoardError('BAD_ARG', 'links 必须是数组')
  const clean = list.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    try {
      const url = normUrl(o.url)
      const text = typeof o.text === 'string' && o.text.trim() ? nonEmpty(o.text, '显示文字') : url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 60)
      const type = typeof o.type === 'string' && o.type.trim() && o.type.trim() !== NO_TYPE ? nonEmpty(o.type, '类型') : ''
      const tag = type && typeof o.tag === 'string' && o.tag.trim() ? nonEmpty(o.tag, '类型标签') : ''
      if (tag && !(b.linkTypeTags?.[type] ?? []).includes(tag)) throw new BoardError('BAD_TAG', '类型「' + type + '」没有标签「' + tag + '」；先在「管理类型」里添加')
      return { id: typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : '', text, type, url, ...(o.off === true ? { off: true } : {}), ...(o.star === true ? { star: true } : {}), ...(tag ? { tag } : {}) }
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
  for (const l of clean) if (l.type) addLinkType(b, l.type)
  // 0.24 链接 id：保留传入的；没有就按网址找回旧 id，再没有才新建（子任务靠 id 绑定链接）
  const prev = c.webLinks ?? []
  const used = new Set<string>()
  for (const l of clean) {
    if (!l.id || used.has(l.id)) l.id = prev.find((p) => p.id && !used.has(p.id) && urlKey(p.url) === urlKey(l.url))?.id ?? newId('l')
    used.add(l.id)
  }
  // 被删掉的链接：从子任务的绑定里去掉，说明里的 [n] 改成链接名文字、后面的编号前移
  const gone = prev.filter((p) => p.id && !used.has(p.id))
  if (gone.length) for (const t of flatTasks(c.tasks)) for (const g of gone) {
    if (!t.links?.includes(g.id as string)) continue
    const r = dropRef(t.note ?? '', t.links, g.id as string, g.text)
    t.links = r.links; if (!t.links.length) delete t.links
    if (r.note) t.note = r.note; else delete t.note
  }
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
  const old = b.sessions.find((s) => s.sessionId === sessionId)
  b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId)
  b.sessions.unshift({ sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}), ...(old && old.cardId === cardId && old.readKeys?.length ? { readKeys: old.readKeys.slice() } : {}) })
  dropForeignTaskSess(b, sessionId, cardId)
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
  /* v151（2.2）：会话不再属于任何卡片 = 任务 / 子任务也不能再关联它 */
  dropForeignTaskSess(b, sessionId, '')
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

/** 32 位 FNV-1a（迁移时生成确定性 id）。 */
function fnv(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(36) }

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
  // 0.24 升级：链接补 id（按网址确定性生成，没写盘前每次读都一样）；子任务补 id；整段说明 → 一条「卡片项目说明」
  for (const c of b.cards) {
    for (const l of c.webLinks ?? []) if (!l.id) l.id = 'l' + fnv(urlKey(l.url))
    const tids = new Set<string>()
    const fix = (list: Task[], path: string): void => list.forEach((t, i) => { if (!t.id || tids.has(t.id)) t.id = 't' + fnv(c.id + '/' + path + i + '/' + t.text); tids.add(t.id); if (t.subs) fix(t.subs, path + i + '.') })
    fix(c.tasks ?? [], '')
    if (typeof c.notes === 'string') { if (!c.noteItems && c.notes.trim()) c.noteItems = [{ t: NOTE_PIN_TITLE, v: c.notes, pin: true }]; delete c.notes }
    // 0.26 升级：相关文件从路径字符串变成 {id, path, title?}（id 按路径确定性生成）
    if (Array.isArray(c.files)) c.files = (c.files as unknown[]).map((f) => (typeof f === 'string' ? { id: 'f' + fnv(c.id + '/' + f), path: f } : f as FileRef))
  }
  // v141 升级：linkTypeDomains 旧的单个值 → 数组
  if (b.linkTypeDomains) for (const [t, v] of Object.entries(b.linkTypeDomains as Record<string, unknown>)) (b.linkTypeDomains as Record<string, string[]>)[t] = Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []
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