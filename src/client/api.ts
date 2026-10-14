/** 与 host 路由通信（同源 fetch；错误抛出带 code 的 ApiError，由界面点名展示）。 */
export const API = '/_dsh/dsh-project-manager/api'

export class ApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ApiError' }
}

/** 阶段（看板上的列）：只有名称，用来给卡片分组。键名沿用 statuses / col。 */
export interface Status { id: string; name: string }
export interface Repo { name: string; role: string; path: string }
export interface Group { id: string; name: string; collapsed: boolean; repos: Repo[]; links: string[]; statuses: Status[]; lfProject?: string }
export interface WebLink { text: string; type: string; url: string }
export interface Card { id: string; g: string; col: string; order: number; t: string; links: string[]; tasks: { text: string; done: boolean }[]; repos?: Repo[]; notes?: string; webLinks?: WebLink[]; files?: string[]; archivedAt?: string }
export interface SessionRef { sessionId: string; cardId: string; createdAt: string; title?: string; readKeys?: string[] }
export interface StateInfo { key: string; project: string; slug: string; status: string; next: string; updated: string; path: string; error?: string }
export interface RepoSeen extends Repo { at: string }
export interface Snapshot { rev: number; board: { groups: Group[]; cards: Card[]; sessions: SessionRef[]; linkTypes?: string[]; repoHistory?: RepoSeen[] }; states: StateInfo[]; hub: { workspaceId: string | null; path: string; title: string; groups?: Record<string, string> }; caps?: { unarchive: boolean }; files?: Record<string, boolean>; landfill?: LandfillStatus }
/** 0.16 落盘项目环境：skill = ~/.agents 下 landfill-project 链接状态（file = 本机单独一份，可接管）。 */
/** 0.18 toolOutdated = ~/.ai/tools/ai-memory 比插件自带的旧（看板提示「升级」）。 */
export interface LandfillStatus { enabled: boolean; ok: boolean; reason: string; skill: 'linked' | 'missing' | 'file' | 'foreign' | 'stale'; skillPath: string; toolVersion?: number; bundledVersion?: number; toolOutdated?: boolean }
export interface SessionInfo {
  card: { id: string; title: string; group: string } | null; suggest?: { key: string; slug: string } | null; materials?: { notes: number; links: number; files: number; repos?: number; tasks?: number }; memory?: { key: string; from: 'group' | 'card' | 'both'; slug: string; next: string; found: boolean; read?: boolean }[]
  /** 0.19 会话信息卡 */
  cardInfo?: { id: string; stage: string; archived: boolean; repos: Repo[]; tasks: { text: string; done: boolean }[]; notes: string; links: WebLink[]; files: Array<{ path: string; exists: boolean }> }
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

export const getState = (since?: number): Promise<Snapshot & { same?: boolean }> => call('/state' + (since !== undefined ? '?since=' + since : ''))
export const getSession = (id: string): Promise<SessionInfo> => call('/session?id=' + encodeURIComponent(id))
export const getRaw = (id: string): Promise<RawInfo> => call('/session/raw?id=' + encodeURIComponent(id))
export const getMergePreview = (session: string, keys: string[], name: string): Promise<MergePreview> => call('/merge/preview?session=' + encodeURIComponent(session) + '&keys=' + encodeURIComponent(keys.join(',')) + '&name=' + encodeURIComponent(name))
export const getMatch = (session: string, q: string): Promise<MatchResult> => call('/landfill/match?session=' + encodeURIComponent(session) + '&q=' + encodeURIComponent(q))
export const post = <T = Snapshot>(action: string, body: Record<string, unknown>): Promise<T> =>
  call(action.startsWith('/') ? action : '/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
