/**
 * dsh-project-manager — host 入口（hybrid：看板数据 + HTTP 面 + 4 工具 + 项目区工作区 + 会话记忆注入）。
 * 生命周期：apply 只登记 inject 回调，无 module 级副作用；每个贡献（路由/工具/监听/上下文）都在 dispose 中撤销。
 * 卸载不删用户数据（board.json/hub/会话），「项目区」工作区条目由界面「卸载前清理」或 POST hub/cleanup 撤销。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as M from './model.js'
import { BoardStore } from './store.js'
import { StateCatalog } from './states.js'
import { hubDir, syncHub } from './hub.js'
import { memoryText } from './memory.js'
import { mountRoutes, ROUTE_PREFIX } from './routes.js'
import { registerTools } from './tools.js'

export const name = 'dsh-project-manager'

export interface Config {
  dataDir: string
  aiRoot: string
  hubTitle: string
  projectSessionMode: 'danger-full-access' | 'inherit'
  memoryMaxBytes: number
}

export const Config: z<Config> = z.object({
  dataDir: z.string().default('').description('数据目录（缺省 <DSH_HOME>/dsh-project-manager）'),
  aiRoot: z.string().default('').description('落盘项目根目录（缺省 ~/.ai），只读'),
  hubTitle: z.string().default('项目区').description('工作区列表里「项目区」的标题'),
  projectSessionMode: z.union(['danger-full-access', 'inherit']).default('danger-full-access').description('项目会话默认权限：完全访问 / 跟随全局'),
  memoryMaxBytes: z.natural().min(1000).max(32000).default(6000).description('每个会话注入的项目记忆上限（字节）'),
}) as z<Config>

type Session = { id: string; header: { cwd?: string; origin?: string } }
type Workspace = { id: string; path: string; title: string }
type HostCtx = Context & {
  webServer: { register(r: unknown): () => void }
  tools: { register(t: unknown): void }
  workspaceRegistry: { create(path: string, title?: string): Promise<Workspace>; list(): Workspace[]; archivedSessionIds?: readonly string[]; unarchiveSession?: (id: string) => Promise<void>; get(id: string): Workspace | undefined; delete(id: string): Promise<boolean>; insertBefore(id: string, beforeId?: string): Promise<readonly string[]> }
  sessions: { get(id: string): Session | undefined }
  permissionPresets: { set(session: Session, name: string): void }
  sessionTitle: { rename(session: Session, title: string): unknown }
  systemPrompt: { context(c: { name: string; order: number; text: (c: { agent?: { session: { id: string } } }) => string }): () => void }
  get(name: string): unknown
  logger?: (name: string) => { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}

export const inject = ['webServer', 'tools', 'workspaceRegistry', 'sessions', 'permissionPresets', 'sessionTitle', 'systemPrompt']

export function apply(ctx: HostCtx, config: Config): void {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dataDir = config.dataDir || join(dshHome, 'dsh-project-manager')
  const aiRoot = config.aiRoot || join(homedir(), '.ai')
  const log = ctx.logger?.('dsh-project-manager')
  const store = new BoardStore(dataDir)
  const states = new StateCatalog(aiRoot)
  let rev = 1
  let hubWs: Workspace | null = null
  const hubPath = syncHub(dataDir, store.get(), states)
  const hubReal = realpathSync(hubPath)

  ctx.effect(() => store.subscribe((b) => {
    rev++
    try { syncHub(dataDir, b, states) } catch (e) { log?.warn('同步项目区目录失败', e) }
  }), 'dsh-project-manager: board subscription')

  /** 找到或创建「项目区」工作区并置顶；幂等（同路径 create 复用原条目）。 */
  const ensureHub = async (): Promise<Workspace> => {
    const existing = ctx.workspaceRegistry.list().find((w) => w.path === hubReal)
    hubWs = existing ?? await ctx.workspaceRegistry.create(hubPath, config.hubTitle)
    await pin()
    return hubWs
  }
  const pin = async (): Promise<void> => {
    if (!hubWs || !ctx.workspaceRegistry.get(hubWs.id)) return
    const order = ctx.workspaceRegistry.list()
    if (order.length > 0 && order[0].id !== hubWs.id) await ctx.workspaceRegistry.insertBefore(hubWs.id, order[0].id)
  }
  hubWs = ctx.workspaceRegistry.list().find((w) => w.path === hubReal) ?? null
  if (hubWs) void pin().catch((e) => log?.warn('置顶项目区失败', e))

  // 别的工作区被新建/挪到最前时，把「项目区」放回第一位（首位已是自己时跳过，避免自触发）
  ctx.on('domain/changed' as never, ((c: { domain?: string; table?: string; operation?: string; value?: { workspaceIds?: string[] } }) => {
    if (!hubWs || c.domain !== 'workspace' || c.table !== '' || c.operation !== 'put') return
    const first = c.value?.workspaceIds?.[0]
    if (first && first !== hubWs.id) void pin().catch((e) => log?.warn('置顶项目区失败', e))
  }) as never)

  /** 绑定后同步设置权限与标题（session/bind 路由调用；会话必须在运行中）。 */
  const applyToSession = (s: Session, cardId: string): { title: string | null; permission: boolean } => {
    const b = store.get()
    const c = M.card(b, cardId)
    const g = M.group(b, c.g)
    let permission = false
    if (config.projectSessionMode === 'danger-full-access') { ctx.permissionPresets.set(s, 'danger-full-access'); permission = true }
    const title = g.name + ' · ' + c.t
    try { ctx.sessionTitle.rename(s, title) } catch (e) { log?.warn('会话改名失败', e); return { title: null, permission } }
    return { title, permission }
  }

  ctx.on('session/created' as never, ((s: Session) => {
    if (s.header.origin === 'subagent' || !s.header.cwd) return
    let cwd = s.header.cwd
    try { cwd = realpathSync(cwd) } catch { /* 目录不存在时按原值比较 */ }
    if (cwd !== hubReal) return
    // 会话恢复也会触发 created：只处理刚创建的会话（createdAt 在 60 秒内），不覆盖用户后来改过的权限
    const createdAt = (s.header as { createdAt?: number }).createdAt
    if (typeof createdAt === 'number' && Date.now() - createdAt > 60_000) return
    // 项目区里新建的会话一律按完全访问（即使不是经卡片发起，例如官方「+」降级路径）
    if (config.projectSessionMode === 'danger-full-access') {
      try { ctx.permissionPresets.set(s, 'danger-full-access') } catch (e) { log?.warn('设置完全访问失败', e) }
    }
  }) as never)

  ctx.inject(['webServer'], (h) => {
    const off = mountRoutes((h as HostCtx).webServer as never, {
      store,
      states,
      hub: () => {
        const ws = hubWs ? ctx.workspaceRegistry.get(hubWs.id) : undefined
        return { workspaceId: ws ? ws.id : null, path: hubReal, title: ws ? ws.title : config.hubTitle }
      },
      prepareSession: async (cardId) => {
        M.card(store.get(), cardId)
        const ws = await ensureHub()
        return { workspaceId: ws.id }
      },
      bindSession: async (sessionId, cardId) => {
        const s = ctx.sessions.get(sessionId)
        if (!s) throw new M.BoardError('NO_SESSION', '会话不在运行中：' + sessionId)
        let cwd = s.header.cwd ?? ''
        try { cwd = realpathSync(cwd) } catch { /* 按原值比较 */ }
        if (cwd !== hubReal) throw new M.BoardError('NOT_HUB_SESSION', '会话不在「' + config.hubTitle + '」工作区里，拒绝绑定：' + sessionId)
        const r = applyToSession(s, cardId)
        await store.mutate((b) => M.bindSession(b, sessionId, cardId, r.title ?? undefined), () => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/bind', card: cardId }])
        return r
      },
      linkSessions: async (cardId, items) => {
        const b0 = store.get()
        const c = M.card(b0, cardId)
        // 用户规则：会话里已读过的 STATE 不再注入 → 关联时按会话记录算 readKeys（只算一次，保证注入文本稳定）
        const paths = new Map<string, string>()
        for (const m of M.memoryOf(b0, c)) { const s = states.get(m.key); if (s) paths.set(m.key, s.path) }
        const withRead = await Promise.all(items.map(async (it) => {
          // sessionQuery 不是本插件的硬依赖：没有时按「没读过」处理（照常注入）
          const q = ctx.get('sessionQuery') as { readSession(id: string): Promise<{ events: Array<{ type: string; data?: unknown }> }> } | undefined
          if (!paths.size || !q) return it
          try { return { ...it, readKeys: M.readKeysFromEvents((await q.readSession(it.sessionId)).events, paths) } } catch (e) { log?.warn('读取会话记录失败，按未读处理：' + it.sessionId, e); return it }
        }))
        return store.mutate((b) => M.bindMany(b, cardId, withRead), (r) => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/link', card: cardId, to: String(r.linked) }])
      },
      unlinkSession: async (sessionId) => {
        const ref = await store.mutate((b) => M.unbindSession(b, sessionId), (r) => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/unlink', card: r.cardId }])
        return { cardId: ref.cardId }
      },
      unarchiveSession: async (sessionId) => {
        const reg = ctx.workspaceRegistry
        if (typeof reg.unarchiveSession !== 'function') throw new M.BoardError('UNARCHIVE_UNAVAILABLE', '当前 DSH 没有「恢复归档」能力（workspaceRegistry.unarchiveSession 不存在；需要 dsh-manage-sessions 的核心补丁）')
        if (!(reg.archivedSessionIds ?? []).includes(sessionId)) return { restored: false }
        await reg.unarchiveSession(sessionId)
        return { restored: true }
      },
      canUnarchive: () => typeof ctx.workspaceRegistry.unarchiveSession === 'function',
      cleanup: async () => {
        const ws = ctx.workspaceRegistry.list().find((w) => w.path === hubReal)
        hubWs = null
        return { removedWorkspace: ws ? await ctx.workspaceRegistry.delete(ws.id) : false }
      },
    }, () => rev)
    return off
  })

  ctx.inject(['tools'], (h) => { registerTools((h as HostCtx).tools, store, states) })

  ctx.inject(['systemPrompt'], (h) => (h as HostCtx).systemPrompt.context({
    name: 'dsh-project-manager:memory',
    order: 130,
    text: (c) => {
      const id = c.agent?.session.id
      if (!id) return ''
      const b = store.get()
      const card = M.cardOfSession(b, id)
      return card ? memoryText(b, card, states, config.memoryMaxBytes, M.sessionRef(b, id)?.readKeys ?? []) : ''
    },
  }))

  log?.info('ready', ROUTE_PREFIX, 'data=' + dataDir, 'hub=' + hubDir(dataDir))
}
