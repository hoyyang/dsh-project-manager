/** 与 host 路由通信（同源 fetch；错误抛出带 code 的 ApiError，由界面点名展示）。 */
export const API = '/_dsh/dsh-project-manager/api'

export class ApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ApiError' }
}

/** 阶段（看板上的列）：只有名称，用来给卡片分组。键名沿用 statuses / col。 */
export interface Status { id: string; name: string }
export interface Repo { name: string; role: string; path: string }
export interface Group { id: string; name: string; collapsed: boolean; repos: Repo[]; links: string[]; statuses: Status[] }
export interface Card { id: string; g: string; col: string; order: number; t: string; links: string[]; tasks: { text: string; done: boolean }[] }
export interface SessionRef { sessionId: string; cardId: string; createdAt: string; title?: string; readKeys?: string[] }
export interface StateInfo { key: string; project: string; slug: string; status: string; next: string; updated: string; path: string; error?: string }
export interface Snapshot { rev: number; board: { groups: Group[]; cards: Card[]; sessions: SessionRef[] }; states: StateInfo[]; hub: { workspaceId: string | null; path: string; title: string }; caps?: { unarchive: boolean } }
export interface SessionInfo { card: { id: string; title: string; group: string } | null; memory?: { key: string; from: 'group' | 'card' | 'both'; slug: string; next: string; found: boolean; read?: boolean }[] }

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
export const post = <T = Snapshot>(action: string, body: Record<string, unknown>): Promise<T> =>
  call(action.startsWith('/') ? action : '/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
