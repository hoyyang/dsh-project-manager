/**
 * HTTP 面：/_dsh/dsh-project-manager/ 前缀。仅 loopback；变更类 POST 需同源；JSON 体上限 64KB。
 * 错误统一 {ok:false,error:{code,message}}，点名失败对象（fail loud）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { realpathSync } from 'node:fs'
import * as M from './model.js'
import type { Board } from './model.js'
import type { BoardStore } from './store.js'
import type { StateCatalog } from './states.js'

export const ROUTE_PREFIX = '/_dsh/dsh-project-manager'
const MAX_BODY = 64 * 1024

export interface Services {
  store: BoardStore
  states: StateCatalog
  hub(): { workspaceId: string | null; path: string; title: string }
  prepareSession(cardId: string): Promise<{ workspaceId: string }>
  bindSession(sessionId: string, cardId: string): Promise<{ title: string | null; permission: boolean }>
  cleanup(): Promise<{ removedWorkspace: boolean }>
  linkSessions(cardId: string, items: Array<{ sessionId: string; title?: string }>): Promise<{ linked: number; moved: number }>
  unlinkSession(sessionId: string): Promise<{ cardId: string }>
  unarchiveSession(sessionId: string): Promise<{ restored: boolean }>
  canUnarchive(): boolean
}

type Json = Record<string, unknown>

function isLoopbackPeer(remote: string | undefined): boolean {
  if (!remote) return false
  if (remote === '::1') return true
  const m = /^::ffff:(\d+)\.\d+\.\d+\.\d+$/i.exec(remote)
  if (m) return Number(m[1]) === 127
  return isIP(remote) === 4 && remote.startsWith('127.')
}

/** DNS 重绑定防护：Host 必须是回环主机名（与 DSH /api 的 Host 围栏同口径）。 */
function loopbackHost(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let name = host.trim().toLowerCase()
  if (name.startsWith('[')) name = name.slice(0, name.indexOf(']') + 1)
  else name = name.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

/** 写操作：必须带 Origin 且与 Host 一致（浏览器同源请求一定带 Origin）。 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return false
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string' || host.trim() === '') return false
  try { return new URL(origin).host.toLowerCase() === host.trim().toLowerCase() } catch { return false }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
const fail = (res: ServerResponse, status: number, code: string, message: string): void => send(res, status, { ok: false, error: { code, message } })

function readBody(req: IncomingMessage): Promise<Json | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (d: Buffer) => { if (over) return; size += d.length; if (size > MAX_BODY) { over = true; resolve(null); return } chunks.push(d) })
    req.on('end', () => {
      if (over) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const v = text.trim() === '' ? {} : JSON.parse(text)
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
      } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v === '') throw new M.BoardError('BAD_ARG', '缺少参数 ' + field)
  return v
}

/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 最近事件。 */
export function snapshot(s: Services, rev: string): Json {
  const b = s.store.get()
  return {
    ok: true,
    rev,
    board: b,
    states: s.states.list().map((x) => ({ key: x.key, project: x.project, slug: x.slug, status: x.status, next: x.next, updated: x.updated, path: x.path, error: x.error })),
    hub: s.hub(),
    caps: { unarchive: s.canUnarchive() },
    events: s.store.eventsTail(80),
  }
}

type Handler = (body: Json, b: Board) => unknown

/** 所有变更动作：名称 → 纯变更（在 store 串行链上执行）。 */
const MUTATIONS: Record<string, Handler> = {
  'group/create': (x, b) => M.addGroup(b, str(x.name, 'name')),
  'group/update': (x, b) => {
    const id = str(x.id, 'id')
    const g = M.group(b, id)
    if (x.name !== undefined) M.renameGroup(b, id, str(x.name, 'name'))
    if (x.collapsed !== undefined) g.collapsed = x.collapsed === true
    if (x.statuses !== undefined) M.setStatuses(b, id, x.statuses as M.Status[])
    if (x.links !== undefined) M.setGroupLinks(b, id, x.links as string[])
    if (x.repos !== undefined) g.repos = M.cleanRepos(x.repos)
    return g
  },
  'group/remove': (x, b) => M.removeGroup(b, str(x.id, 'id')),
  'group/repos-add': (x, b) => M.addRepos(b, str(x.id, 'id'), x.repos, (p) => { try { return realpathSync(p) } catch { return p } }),
  'card/create': (x, b) => M.addCard(b, str(x.group, 'group'), str(x.title, 'title'), (x.links as string[] | undefined) ?? [], x.col as string | undefined),
  'card/update': (x, b) => M.updateCard(b, str(x.id, 'id'), { t: x.title as string | undefined, links: x.links as string[] | undefined }),
  'card/remove': (x, b) => M.removeCard(b, str(x.id, 'id')),
  'card/tasks': (x, b) => M.setTasks(b, str(x.id, 'id'), x.tasks as M.Task[]),
  'card/move': (x, b) => M.moveCard(b, str(x.id, 'id'), { g: x.group as string | undefined, col: str(x.col, 'col'), beforeId: (x.beforeId as string | null | undefined) ?? null }, 'user'),
}

export function mountRoutes(
  webServer: { register(r: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void },
  s: Services,
  boardRev: () => number,
): () => void {
  // 版本号 = 启动标识 + 看板变更计数 + STATE 目录签名：插件重载或 STATE 改动都会让前端拉到新快照
  const boot = Date.now().toString(36)
  const getRev = (): string => boot + '.' + boardRev() + '.' + s.states.signature()
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        if (!isLoopbackPeer(req.socket.remoteAddress) || !loopbackHost(req)) return fail(res, 403, 'FORBIDDEN', '仅限本机访问（Host 必须是 127.0.0.1 / localhost）')
        const u = new URL(req.url ?? '/', 'http://localhost')
        const sub = u.pathname.slice(ROUTE_PREFIX.length).replace(/^\/api/, '') || '/'
        if (req.method === 'GET') {
          if (sub === '/state') {
            const since = u.searchParams.get('since') ?? ''
            const rev = getRev()
            if (since !== '' && since === rev) return send(res, 200, { ok: true, rev, same: true })
            return send(res, 200, snapshot(s, getRev()))
          }
          if (sub === '/session') {
            const id = u.searchParams.get('id') ?? ''
            const b = s.store.get()
            const c = M.cardOfSession(b, id)
            if (!c) return send(res, 200, { ok: true, card: null })
            const g = M.group(b, c.g)
            return send(res, 200, {
              ok: true,
              card: { id: c.id, title: c.t, group: g.name },
              memory: M.memoryOf(b, c).map((m) => { const st = s.states.get(m.key); return { key: m.key, from: m.from, slug: st?.slug ?? m.key, next: st?.next ?? '', found: st !== undefined, read: (M.sessionRef(b, id)?.readKeys ?? []).includes(m.key) } }),
            })
          }
          return fail(res, 404, 'NOT_FOUND', '未知路径 ' + sub)
        }
        if (req.method !== 'POST') return fail(res, 405, 'METHOD', '只支持 GET/POST')
        if (!sameOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '拒绝跨站请求')
        const body = await readBody(req)
        if (body === null) return fail(res, 400, 'BAD_BODY', '请求体必须是 ≤64KB 的 JSON 对象')
        const key = sub.replace(/^\//, '')
        if (key === 'session/prepare') return send(res, 200, { ok: true, ...(await s.prepareSession(str(body.cardId, 'cardId'))) })
        if (key === 'session/bind') return send(res, 200, { ok: true, ...(await s.bindSession(str(body.sessionId, 'sessionId'), str(body.cardId, 'cardId'))) })
        if (key === 'hub/cleanup') return send(res, 200, { ok: true, ...(await s.cleanup()) })
        if (key === 'session/link') {
          const items = Array.isArray(body.sessions) ? (body.sessions as Array<Record<string, unknown>>).map((x) => ({ sessionId: str(x?.sessionId, 'sessionId'), title: typeof x?.title === 'string' ? x.title : undefined })) : []
          const r = await s.linkSessions(str(body.cardId, 'cardId'), items)
          return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) })
        }
        if (key === 'session/unlink') { const r = await s.unlinkSession(str(body.sessionId, 'sessionId')); return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) }) }
        if (key === 'session/unarchive') { const r = await s.unarchiveSession(str(body.sessionId, 'sessionId')); return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) }) }
        if (key === 'states/refresh') { s.states.invalidate(); return send(res, 200, snapshot(s, getRev())) }
        const fn = MUTATIONS[key]
        if (!fn) return fail(res, 404, 'NOT_FOUND', '未知动作 ' + key)
        const result = await s.store.mutate((b) => fn(body, b), (r) => (key === 'card/move' ? [r as M.BoardEvent] : [{ at: new Date().toISOString(), actor: 'user', kind: key, card: typeof body.id === 'string' ? body.id : undefined }]))
        return send(res, 200, { ok: true, result: result ?? null, ...snapshot(s, getRev()) })
      } catch (e) {
        if (e instanceof M.BoardError) return fail(res, 400, e.code, e.message)
        return fail(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e))
      }
    },
  })
}
