/** 与 host 路由通信（同源 fetch；错误抛出带 code 的 ApiError，由界面点名展示）。 */
export const API = '/_dsh/dsh-project-manager/api'

/* v133 R2 / ⑤：插件的 4–5 秒轮询（看板 / dock / 快照 / 日程）合成一个调度器 ——
   每 500ms 看一次，一次最多跑一个到点的任务（自然错开，不再同一拍叠在一起）；
   页面不可见、或刚有按下 / 拖动 / 滚动 / 按键（300ms 内）就推迟，主线程先让给用户。 */
const POLLS = new Set<{ ms: number; next: number; fn: () => void }>()
let pollT = 0
let lastInput = -1e9
const mark = (): void => { lastInput = performance.now() }
/* v144（4.2）：只把滚轮 / 触摸 / 按键 / 按下算用户输入 —— 程序滚动（Agent 流式输出时宿主每帧自动滚到底）不算，
   以前把任何 scroll 都当输入 → 会话在输出时轮询被一直推迟（信息卡 / 卡片详情按钮一直不出）；每个任务最多推迟 2 倍间隔 */
const pollTick = (): void => {
  pollT = window.setTimeout(pollTick, 500)
  const now = performance.now()
  if (document.hidden) return
  const busy = now - lastInput < 300
  for (const s of POLLS) if (now >= s.next && (!busy || now >= s.next + s.ms)) { s.next = now + s.ms; s.fn(); return }
}
export const pollStats = (): { lastInput: number; n: number } => ({ lastInput, n: POLLS.size })
export function poll(ms: number, fn: () => void): () => void {
  if (!pollT) {
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove']) document.addEventListener(ev, mark, { capture: true, passive: true })
    document.addEventListener('pointermove', (e) => { if (e.buttons) mark() }, { capture: true, passive: true })
    pollTick()
  }
  const s = { ms, next: performance.now() + ms, fn }
  POLLS.add(s)
  return () => { POLLS.delete(s) }
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ApiError' }
}

/** 阶段（看板上的列）：只有名称，用来给卡片分组。键名沿用 statuses / col。 */
export interface Status { id: string; name: string }
/** v136：off = 不自动注入 Agent 会话（缺省 = 注入）。 */
export interface Repo { name: string; role: string; path: string; off?: boolean }
export interface Group { id: string; name: string; collapsed: boolean; repos: Repo[]; links: string[]; statuses: Status[]; lfProject?: string; updatedAt?: string | null; archivedAt?: string }
export interface WebLink { id?: string; text: string; type: string; url: string; off?: boolean; /** v140 */ star?: boolean; /** v141 */ tag?: string }
/** 0.24 子任务：两级；note 里的 [n] = links 第 n 条；created / updated 由服务端盖（ISO）。 */
export interface Task { id?: string; text: string; done: boolean; note?: string; type?: string; links?: string[]; files?: string[]; subs?: Task[]; created?: string; updated?: string; /** v127：截止日期 YYYY-MM-DD */ due?: string; /** v140：关联的会话 id */ sess?: string }
/** 0.26 相关文件：id 稳定（子任务按 id 绑定）；title 空 = 显示文件名。 */
export interface FileRef { id: string; path: string; title?: string; off?: boolean; prev?: string[] }
export interface Prefs { lf: boolean; delAdd: boolean; delTolf: boolean }
export interface NoteItem { t: string; v: string; pin?: boolean; off?: boolean }
export interface TypeGroup { id: string; name: string; types: string[] }
export interface Card { id: string; g: string; col: string; order: number; t: string; links: string[]; tasks: Task[]; repos?: Repo[]; noteItems?: NoteItem[]; webLinks?: WebLink[]; files?: FileRef[]; archivedAt?: string; pending?: boolean; related?: string[]; /** v136：关联卡片里不注入的 id */ relOff?: string[]; updatedAt?: string | null }
export interface SessionRef { sessionId: string; cardId: string; createdAt: string; title?: string; readKeys?: string[] }
export interface StateInfo { key: string; project: string; slug: string; status: string; next: string; updated: string; path: string; error?: string }
export interface RepoSeen extends Repo { at: string }
export interface Snapshot { rev: number; board: { groups: Group[]; cards: Card[]; sessions: SessionRef[]; linkTypes?: string[]; linkTypeGroups?: TypeGroup[]; repoHistory?: RepoSeen[]; taskTypes?: string[]; prefs?: Partial<Prefs>; linkTypeDomains?: Record<string, string[]>; linkTypeTags?: Record<string, string[]> }; states: StateInfo[]; hub: { workspaceId: string | null; path: string; title: string; groups?: Record<string, string> }; caps?: { unarchive: boolean }; repoOk?: Record<string, boolean>; files?: Record<string, boolean>; landfill?: LandfillStatus }
/** 0.16 落盘项目环境：skill = ~/.agents 下 landfill-project 链接状态（file = 本机单独一份，可接管）。 */
/** 0.18 toolOutdated = ~/.ai/tools/ai-memory 比插件自带的旧（看板提示「升级」）。 */
export interface LandfillStatus { enabled: boolean; ok: boolean; reason: string; skill: 'linked' | 'missing' | 'file' | 'foreign' | 'stale'; skillPath: string; toolVersion?: number; bundledVersion?: number; toolOutdated?: boolean }
export interface SessionInfo {
  card: { id: string; title: string; group: string } | null; suggest?: { key: string; slug: string } | null; materials?: { notes: number; links: number; files: number; repos?: number; tasks?: number }; memory?: { key: string; from: 'group' | 'card' | 'both'; slug: string; next: string; found: boolean; read?: boolean }[]
  /** 0.19 会话信息卡 */
  cardInfo?: { id: string; stage: string; archived: boolean; repos: Repo[]; tasks: Task[]; notes: NoteItem[]; links: WebLink[]; files: Array<{ id?: string; path: string; title?: string; exists: boolean; prev?: string[] }>; related?: Array<{ id: string; title: string; group: string; stage?: string; archived: boolean; dirs: string[] }>; sessions?: Array<{ id: string; title: string }>; lfDirs?: string[] }
  /** 0.27 没关联卡片、但在项目区某个卡片组子工作区里的会话 →「创建会话卡片」 */
  free?: { group: { id: string; name: string; statuses: Status[] } } | null
  memDetail?: MemDetail[]
  merging?: { id: string; key: string; srcs: string[]; read: number; noted: number; total: number; step: number } | null
  mergeTool?: { ok: boolean; version: number }
  /** 0.20 信息卡发起的落盘这一轮的结局 */
  lfRun?: LfRun | null
  /** 0.20 卡片组的落盘文件夹（value = null：还没设，suggest = 建议名） */
  folder?: { group: string; value: string | null; suggest: string | null; registered: boolean }
}
export interface LfRun { key: string; label: string; at: number; ago: number; state: 'busy' | 'done' | 'stopped' | 'error' | 'ask' | 'nowrite'; end?: number; error?: string }
export interface SpecItem { id: string; by: 'plugin' | 'ai'; text: string; fix: string }
export interface MigView { id: string; from: string; at: string; retired: string; exists: boolean; refs: number; files: number; undo: string | null }
export interface MatchHit { key: string; why: string; slug: string; project: string; aliases: string[]; chars: number; updated: string; cards: string[]; moveTo: string | null }
export interface MatchResult { mode: 'hint' | 'exact' | 'near' | 'none'; hits: MatchHit[] }
export interface MergeSrc { key: string; kind: 'body' | 'pointer'; chars: number; files: number; retired: string | null; exists: boolean; sub?: MergeView }
export interface MergeView { id: string; key: string; at: string; dir: string; purged: boolean; all: number; report: { chars: number; check: number; drop: number; files: number } | null; refs: string[]; refsFailed: Array<{ file: string; error: string }>; missing: string[]; copied: Array<{ path: string; rel: string }>; dropped: string[]; files: Array<{ rel: string; from: string[]; ext: boolean }>; notes: string[]; retiredDirs: string[]; undo: string | null; srcs: MergeSrc[] }
export interface MemDetail { key: string; from: 'group' | 'card' | 'both'; found: boolean; project: string; slug: string; next: string; status: string; aliases: string[]; pointer: boolean; chars: number; files: number; version: string; injected: boolean; merge: MergeView | null; spec?: SpecItem[]; moveTo?: string | null; migration?: MigView | null }
export interface MergePreview { key: string; aliases: string[]; clash: boolean; busy: string | null; srcs: Array<{ key: string; pointer: boolean; chars: number; files: number; merge: string | null }>; files: Array<{ rel: string; from: string[]; ext: string | null }>; notes: string[]; copied: Array<{ path: string; rel: string; from: string }>; missing: Array<{ path: string; from: string }>; dropped: Array<{ key: string; rel: string }>; dirs: number; retired: Array<{ project: string; path: string; names: string[] }>; refs: string[]; chars: number; toolOk: boolean }
export interface RawInfo { system: string; rules: string; files: Array<{ key: string; file: string; version: string; chars: number; inContext: boolean; text: string; truncated?: number }> }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try { res = await fetch(API + path, init) } catch (e) { throw new ApiError('NETWORK', '无法连接 dsh-project-manager 服务：' + String(e)) }
  let body: { ok?: boolean; error?: { code: string; message: string } } & Record<string, unknown>
  try { body = await res.json() } catch { throw new ApiError('BAD_RESPONSE', 'dsh-project-manager 返回了非 JSON（HTTP ' + res.status + '）') }
  if (!body.ok) throw new ApiError(body.error?.code ?? 'HTTP_' + res.status, body.error?.message ?? '请求失败')
  return body as unknown as T
}

export const getState = (since?: number): Promise<Snapshot & { same?: boolean }> => call<Snapshot & { same?: boolean }>('/state' + (since !== undefined ? '?since=' + since : '')).then((s) => (s.same ? s : normSnap(s)))
export const getSession = (id: string, cwd = ''): Promise<SessionInfo> => call<SessionInfo>('/session?id=' + encodeURIComponent(id) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')).then((s) => {
  const ci = s.cardInfo as (SessionInfo['cardInfo'] & { notes: unknown }) | undefined
  if (ci) { ci.notes = noteItemsOf(ci.notes); if (!Array.isArray(ci.tasks)) ci.tasks = []; if (!Array.isArray(ci.links)) ci.links = []; if (!Array.isArray(ci.files)) ci.files = []; if (!Array.isArray(ci.repos)) ci.repos = [] }
  return s
})
export const getRaw = (id: string): Promise<RawInfo> => call('/session/raw?id=' + encodeURIComponent(id))
/** v93/v94：某个会话里用户自己发过的消息（从新到旧；host 读 sessionQuery，不受界面虚拟列表影响）。 */
export interface HistoryMsg { seq: number; at: string; text: string }
/** v94：一页历史 + 总数 + 还有没有更早的（before = 下一页游标）。 */
export interface HistoryPage { messages: HistoryMsg[]; total: number; hasMore: boolean; before: number | null }
/** v96：用会话自己的模型（最低思考等级）把任务说明总结成标题。 */
export interface GoalTitle { title: string; provider?: string; model?: string; effort?: string; retried?: boolean }
/** v129：route = 「配置生成标题模型」选的 dsh provider / 模型 / 推理等级（不传 = host 报 NO_TITLE_MODEL）。 */
export const goalTitle = (session: string, text: string, route?: { provider: string; model: string; effort?: string }): Promise<GoalTitle> => post<GoalTitle>('goal/title', { session, text, route })

export const getSessionMessages = (id: string, o: { before?: number; limit?: number } = {}): Promise<HistoryPage> => {
  const qs = ['id=' + encodeURIComponent(id)]
  if (o.before) qs.push('before=' + o.before)
  if (o.limit) qs.push('limit=' + o.limit)
  return call<HistoryPage>('/session/messages?' + qs.join('&'))
}
export const getMergePreview = (session: string, keys: string[], name: string): Promise<MergePreview> => call('/merge/preview?session=' + encodeURIComponent(session) + '&keys=' + encodeURIComponent(keys.join(',')) + '&name=' + encodeURIComponent(name))
export const getMatch = (session: string, q: string): Promise<MatchResult> => call('/landfill/match?session=' + encodeURIComponent(session) + '&q=' + encodeURIComponent(q))
/** 0.31 任务日程看板：服务端派生快照（计划 / 实际 / 截止 / 三条边的宽度）。 */
/** v99：截止时间同一天可多个，分硬性（hard）/ 软性（soft）；id 稳定，增删改按 id。 */
export interface GanttDDL { id?: string; at: string; kind?: 'hard' | 'soft'; label?: string; /** v101：重复截止的系列 id + 规则（没 sid = 单条） */ sid?: string; rep?: { unit: 'day' | 'week' | 'month'; n: number; until?: string }; /** v137：任务截止派生条目 */ task?: string; done?: boolean }
export interface GanttCard {
  id: string; g: string; t: string; stage: string; done: number; total: number
  created: string; archivedAt?: string
  /** v86：与项目看板一致的展示顺序；pending 卡片不进日程 */
  seq: number
  pending?: boolean
  plan: string[]
  actual: Array<{ day: string; src: 'auto' | 'manual' }>
  ddl: GanttDDL[]
  /** 会话自动涂上的原始日子 */
  auto: string[]
  /** 手动动过、已关掉会话自动的日子 */
  autoOff?: string[]
  /** v105：卡片任务（任务面板计划清单用；子任务一层）。 */
  tasks?: Array<{ id: string; text: string; done: boolean; due?: string; sess?: string; subs: Array<{ id: string; text: string; done: boolean; due?: string; sess?: string }> }>
}
/** v105：每日任务面板按天状态（勾选 = 当天完成 / 选中 = 排今天 / 排布）。 */
export type GanttPst = 'run' | 'pause' | 'wait'
export type GanttZone = 'done' | 'wait' | 'pause' | 'run' | 'arr' | 'un'
export interface GanttPanelDay { done?: string[]; sel?: string[]; lanes?: string[][]; /** v110：执行中 / 已暂停（落盘的运行态）；v121 加 wait = 等外部进展 */ pst?: Record<string, GanttPst>; /** v111：这一天已经跑过自动续排 */ carry?: boolean; /** v122/v123：个人暂停 / 等外部 / 执行中 / 未安排的行 */ zl?: Partial<Record<'pause' | 'wait' | 'run' | 'un', string[][]>>; /** v122：记录执行的时间 */ doneAt?: Record<string, number>; /** v123：记录执行时的来源分区 */ from?: Record<string, GanttZone> }
export interface GanttGroup { id: string; name: string; upd: number; archivedAt?: string; stages: Status[]; collapsed?: boolean }
export interface GanttUI { lw?: number; tpw?: number; dw?: number; gtime?: boolean; /** v105：面板两块卡片高度比（上面那块百分比，20–80） */ tpr?: number; /** v110：甘特图是否显示 pending 项目（默认 true） */ pend?: boolean; /** v118：本日计划清单收起（默认收起） */ pfold?: boolean; /** v118：只显示可安排（默认开） */ plonly?: boolean; /** v121：只显示本日完成 */ pldone?: boolean; /** v121：计划清单收起的行 */ plclosed?: string[]; /** v124：已完成任务里点开过的 */ plopen?: string[]; /** v124：执行安排收起的分区 */ exz?: string[]; /** v130：两张卡开合 ex / pl / split */ tpm?: 'ex' | 'pl' | 'split' }
export interface GanttData { rev: string; today: string; groups: GanttGroup[]; cards: GanttCard[]; panels?: Record<string, GanttPanelDay>; ui: GanttUI; degraded: string[]; same?: boolean }

/** warm = 真的起一轮后台会话统计（只有日程页传 true）；打开卡片详情走 getGanttMeta。 */
export const getGantt = (since?: string, warm = false): Promise<GanttData> => {
  const qs: string[] = []
  if (since) qs.push('since=' + encodeURIComponent(since))
  if (warm) qs.push('warm=1')
  return call<GanttData>('/gantt' + (qs.length ? '?' + qs.join('&') : ''))
}
/** v90：只读 ui（卡片详情宽度）+ 统计实况 —— 不构建甘特数据、不起后台统计。 */
export interface GanttMeta { ui: GanttUI; stats: { at: number; read: number; cached: number; ms: number } | null }
export const getGanttMeta = (): Promise<GanttMeta> => call<GanttMeta>('/gantt?meta=1')
export const postGantt = (key: string, body: Record<string, unknown>): Promise<{ ok: boolean; gantt: GanttData }> =>
  call<{ ok: boolean; gantt: GanttData }>('/gantt/' + key, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/* ── v144（3）：全插件统一的「打开文件」——
   图片（png / jpg / gif / webp / heic / bmp / svg / tiff）和视频（mp4 / mov / m4v / webm / avi / mkv）= 文件自己的默认应用（和访达双击一样）；
   其他文件 = DSH 右侧栏的文件查看（宿主默认文件预览，看板 / 日程页也能开）；文件夹仍是访达。
   右侧栏开不了（拿不到 sidebarRight / 没有会话）= 退回默认应用并 console 点名。 ── */
export const MEDIA_RE = /\.(png|jpe?g|gif|webp|heic|bmp|svg|tiff?|mp4|mov|m4v|webm|avi|mkv)$/i
let rbOpen: ((path: string) => boolean) | null = null
/** index.ts 注入：在 DSH 右侧栏打开（成功 true）。 */
export function setRightbarOpener(f: ((path: string) => boolean) | null): void { rbOpen = f }
/** 统一入口：src = 卡片文件（files-open 解析 id / 路径 / 文件名）或本地路径（fs/open-local）。返回 'rightbar' | 'default' | 'dir' 和实际路径。 */
export async function openFileSmart(src: { card: string; file?: string; path?: string; name?: string } | { local: string }): Promise<{ how: 'rightbar' | 'default' | 'dir'; path: string; moved?: boolean }> {
  const isCard = 'card' in src
  const want = isCard ? (src.path ?? '') : src.local
  const media = MEDIA_RE.test(want || (isCard ? src.name ?? '' : ''))
  if (!media && rbOpen) {
    const r = isCard
      ? await post<{ ok: boolean; path?: string; moved?: boolean }>('card/files-open', { id: src.card, file: src.file ?? '', ...(src.path ? { path: src.path } : {}), ...(src.name ? { name: src.name } : {}), dry: true })
      : await post<{ ok: boolean; path?: string; kind?: string }>('fs/open-local', { path: src.local, dry: true })
    const p = r.path ?? want
    if ((r as { kind?: string }).kind === 'dir') { await post('fs/open-local', { path: p }); return { how: 'dir', path: p } }
    if (!MEDIA_RE.test(p) && rbOpen(p)) return { how: 'rightbar', path: p, moved: (r as { moved?: boolean }).moved }
    if (!MEDIA_RE.test(p)) console.warn('[dsh-project-manager] DSH 右侧栏打不开这个文件（没有当前会话 / 宿主没有 sidebarRight），改用默认应用：' + p)
  }
  const r = isCard
    ? await post<{ ok: boolean; path?: string; moved?: boolean }>('card/files-open', { id: src.card, file: src.file ?? '', ...(src.path ? { path: src.path } : {}), ...(src.name ? { name: src.name } : {}) })
    : await post<{ ok: boolean; path?: string; kind?: string }>('fs/open-local', { path: src.local })
  return { how: (r as { kind?: string }).kind === 'dir' ? 'dir' : 'default', path: r.path ?? want, moved: (r as { moved?: boolean }).moved }
}
export const openedHow = (r: { how: string }): string => (r.how === 'rightbar' ? '已在 DSH 右侧栏打开' : r.how === 'dir' ? '已在访达中打开' : '已用默认应用打开')
/** v99：点相关文件的标题 = 用系统默认应用打开（和访达里双击一样）。 */
export const openFile = (id: string, file: string, path = '', name = ''): Promise<{ ok: boolean; path?: string; id?: string; moved?: boolean }> => call('/card/files-open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, file, ...(path ? { path } : {}), ...(name ? { name } : {}) }) })

export const post = <T = Snapshot>(action: string, body: Record<string, unknown>): Promise<T> =>
  call<T>(action.startsWith('/') ? action : '/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { const s = r as unknown as Snapshot; if (s && s.board && Array.isArray(s.board.cards)) normSnap(s); return r })

/**
 * 0.24 兼容旧数据 / 旧 host（客户端 bundle 先于 host 重启生效时，host 还在发 0.23 的格式）：
 * 说明字符串 → 一条「卡片项目说明」；子任务缺 id 补临时 id；没有 related 当空。只整形，不改语义。
 */
export const noteItemsOf = (v: unknown): NoteItem[] => (Array.isArray(v) ? (v as NoteItem[]) : typeof v === 'string' && v.trim() ? [{ t: '卡片项目说明', v, pin: true }] : [])
export function normCard(c: Card & { notes?: unknown }): Card {
  if (!Array.isArray(c.noteItems) && c.notes !== undefined) { const it = noteItemsOf(c.notes); if (it.length) c.noteItems = it }
  delete c.notes
  if (!Array.isArray(c.tasks)) c.tasks = []
  // 0.26 旧 host 还在发路径字符串
  if (Array.isArray(c.files)) c.files = (c.files as unknown[]).map((f, i) => (typeof f === 'string' ? { id: 'xf' + c.id + '-' + i, path: f } : f as FileRef))
  c.tasks.forEach((t, i) => { if (!t.id) t.id = 'x' + c.id + '-' + i; (t.subs ?? []).forEach((s, j) => { if (!s.id) s.id = 'x' + c.id + '-' + i + '-' + j }) })
  return c
}
export function normSnap<T extends Snapshot>(s: T): T { for (const c of s.board?.cards ?? []) normCard(c as Card & { notes?: unknown }); return s }
