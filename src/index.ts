/**
 * dsh-project-manager — host 入口（hybrid：看板数据 + HTTP 面 + 4 工具 + 项目区工作区 + 会话记忆注入）。
 * 生命周期：apply 只登记 inject 回调，无 module 级副作用；每个贡献（路由/工具/监听/上下文）都在 dispose 中撤销。
 * 卸载不删用户数据（board.json/hub/会话），「项目区」及卡片组子工作区条目由界面「卸载前清理」或 POST hub/cleanup 撤销。
 * 0.9：每个卡片组 = 「项目区」下的子工作区（hub/groups/<组 id>/，标题 = 组名）；dsh「按工作区树」分组下自然嵌套。
 */
import { homedir } from 'node:os'
import { cleanTitle, titleWithRetry } from './goaltext.js'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as M from './model.js'
import { historyPage, historyRows } from './history.js'
import { BoardStore } from './store.js'
import { StateCatalog } from './states.js'
import { groupDir, hubDir, syncHub } from './hub.js'
import { cardBlock, maskBlock, memoryText } from './memory.js'
import { isPointer, MergeEngine, type MergeRec } from './merge.js'
import { MigrateEngine } from './migrate.js'
import { matchStates, specHint, specIssues, suggestFolder, type SpecCtx } from './lfspec.js'
import { openMode, mountRoutes, ROUTE_PREFIX } from './routes.js'
import { registerTools, registerLandfillTool } from './tools.js'
import * as G from './gantt.js'
import { clip } from './text.js'
import { SessionDaysCache } from './sessiondays.js'
import { detectIntent, guardReason, intentHint, isIndexed, Landfill, listDocs, PLAN_HINT, SKILL_NAME, skillFile } from './landfill.js'

export const name = 'dsh-project-manager'

export interface Config {
  dataDir: string
  aiRoot: string
  hubTitle: string
  projectSessionMode: 'danger-full-access' | 'inherit'
  memoryMaxBytes: number
  landfill: boolean
  agentsHome: string
}

export const Config: z<Config> = z.object({
  dataDir: z.string().default('').description('数据目录（缺省 <DSH_HOME>/dsh-project-manager）'),
  aiRoot: z.string().default('').description('落盘项目根目录（缺省 ~/.ai）'),
  hubTitle: z.string().default('项目区').description('工作区列表里「项目区」的标题'),
  projectSessionMode: z.union(['danger-full-access', 'inherit']).default('danger-full-access').description('项目会话默认权限：完全访问 / 跟随全局'),
  memoryMaxBytes: z.natural().min(1000).max(32000).default(6000).description('每个会话注入的项目记忆上限（字节）'),
  landfill: z.boolean().default(true).description('落盘项目：landfill 工具 + 自动识别「落盘项目 / 回忆」+ 拦截直写 ~/.ai + 收尾检查（经 ~/.ai/tools/ai-memory 写；需要 python3，不支持 Windows）'),
  agentsHome: z.string().default('').description('landfill-project skill 软链所在的 ~/.agents 目录（缺省 ~/.agents）'),
}) as z<Config>

type Session = { id: string; header: { cwd?: string; origin?: string; parentSession?: string } }
type Msg = { id: string; role: 'user'; content: Array<{ type: 'text'; text: string }>; source: { kind: string; form?: string } }
type Ev = { type: string; data?: unknown }
type Agent = { id?: string; session?: { id?: string; header?: { cwd?: string }; seq?: number; eventAt?(seq: number): Ev | undefined }; steer?(m: Msg): void }
const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = 'plugin:dsh-project-manager'
const msg = (text: string, form: string): Msg => ({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: SOURCE, form } })
const textOf = (m: unknown): string => { const c = (m as { content?: Array<{ type?: string; text?: string }> })?.content; return Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('') : '' }
/** 常驻规则（systemPrompt.context，不依赖 ~/.dsh/AGENTS.md）。 */
const RULES = '## 落盘项目（dsh-project-manager）\n'
  + '- 用户说「落盘项目 XX」= 把当前进展写进 XX 的 STATE；「回忆 XX」/「继续 XX」= 先读 XX 的 STATE 再接着做。协议见 landfill-project skill。\n'
  + '- 读写都用 landfill 工具（op=recall / persist / append / list / register / validate），它经 ~/.ai/tools/ai-memory 写入，带并发校验与写后回读。\n'
  + '- 一个落盘项目 = 一个文件夹：STATE.md 是唯一入口，plans/ notes/ evidence/ 里的每个文件都要在 STATE 的「📁 文件索引」里有一行（[必读] 或 [参考]）。\n'
  + '- 「读完」= STATE + 全部 [必读] 子文档。插件会把卡片关联的 STATE 与 [必读] 最新全文注入会话（别处改了下一步自动补新版），注入的算已读；其余用 recall（子文档带 file），有 next 就带 offset 读到 complete:true。\n'
  + '- 落盘 = 读完后整理整个文件夹（重复的合并 op=write，过时 / 弃用 / 错误的 op=retire，新证据 op=import）+ 按 skill「整体优化」重写整份 STATE；有意删掉的 commit / 路径 / 版本号 / 单号写进 persist 的 drop，否则会被拒。\n'
  + '- 落盘项目按卡片组归档（~/.ai/projects/<卡片组的落盘文件夹>/）：新建的放进去；不在那里的由插件在落盘时整个迁过去（可撤销）。每次落盘按规范清单检查（标题行 / 文件索引 / 别名行含卡片名），落盘提示会列出要改的地方。\n'
  + '- STATE 里的「🗂 卡片档案」块由插件按看板生成：不要改、不要在正文里重抄；卡片资料有错请用户在看板改。\n'
  + '- 不要用 write / edit / bash 直接改 ~/.ai 下的记忆文件；冲突时保留 inbox 里的产物并告诉用户，不要覆盖。\n'
  + '- 未经用户明确同意，不得把 pending_user_review 改成 confirmed；登记新项目先问用户。'
type Workspace = { id: string; path: string; title: string; setTitle?(title: string): Promise<void> }
type HostCtx = Context & {
  webServer: { register(r: unknown): () => void }
  tools: { register(t: unknown): void }
  workspaceRegistry: { create(path: string, title?: string): Promise<Workspace>; list(): Workspace[]; archivedSessionIds?: readonly string[]; unarchiveSession?: (id: string) => Promise<void>; get(id: string): Workspace | undefined; delete(id: string): Promise<boolean>; insertBefore(id: string, beforeId?: string): Promise<readonly string[]> }
  sessions: { get(id: string): Session | undefined }
  permissionPresets: { set(session: Session, name: string): void }
  sessionTitle: { rename(session: Session, title: string): unknown }
  systemPrompt: { context(c: { name: string; order: number; text: (c: { agent?: { session: { id: string } } }) => string }): () => void }
  skills?: { register(s: { name: string; description: string; content: string; source: string; path?: string; resourceBase?: { kind: 'directory'; path: string } }): () => void }
  commands?: { register(c: { name: string; description: string; input?: { hint?: string }; handler: (i: { rawInput: string; agent?: Agent }) => { kind: 'success' | 'error'; text: string } }): () => void }
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

  // ── 0.31 任务日程看板：会话按天活跃（实际条自动来源）+ 事件日志缓存（默认计划段要归档 / 恢复历史）──
  const ganttEventsPath = join(dataDir, 'events.jsonl')
  let gEvKey = ''
  let gEvList: M.BoardEvent[] = []
  const ganttEvents = (): M.BoardEvent[] => {
    try {
      const st = statSync(ganttEventsPath)
      const k = st.mtimeMs + ':' + st.size
      if (k !== gEvKey) { gEvKey = k; gEvList = G.eventsFromText(readFileSync(ganttEventsPath, 'utf8')) }
    } catch { gEvKey = ''; gEvList = [] }
    return gEvList
  }
  const ganttState = (b: M.Board): G.GanttState => {
    const bb = b as M.Board & { gantt?: G.GanttState }
    return bb.gantt ?? (bb.gantt = { cards: {} })
  }
  const ganttCardState = (b: M.Board, id: string): G.CardGantt => { const g = ganttState(b); return g.cards[id] ?? (g.cards[id] = {}) }
  const sdays = new SessionDaysCache(() => ctx.get('sessionQuery') as { listEvents(id: string): Promise<Array<{ type?: string; time?: number }>> } | undefined)
  /* v90：会话统计按「会话版本」缓存 —— live 会话用内存事件条数（有新事件就一定变），落盘的用日志文件
     mtime+size（不解压）；拿不到版本才退回 45 秒 TTL。目的：178 个会话 / 322MB 日志不再每轮全解一遍。
     索引（session id → 会话目录）30 秒重建一次；新会话还没落盘时最多 30 秒能扫到，期间按 TTL 兜底。 */
  const sessRoot = join(dshHome, 'sessions')
  let sIdxAt = 0
  let sIdx = new Map<string, string>()
  const sessDirOf = (id: string): string | undefined => {
    const build = (): void => {
      const map = new Map<string, string>()
      try {
        for (const slug of readdirSync(sessRoot, { withFileTypes: true })) {
          if (!slug.isDirectory()) continue
          const base = join(sessRoot, slug.name)
          let ents: Array<{ name: string; isDirectory(): boolean }> = []
          try { ents = readdirSync(base, { withFileTypes: true }) } catch { continue }
          for (const e of ents) if (e.isDirectory() && e.name.startsWith('session-')) map.set(e.name, join(base, e.name))
        }
      } catch { /* 没有落盘目录：只用 live 版本 */ }
      sIdx = map
      sIdxAt = Date.now()
    }
    const now = Date.now()
    if (now - sIdxAt > 30_000) build()
    let dir = sIdx.get(id)
    if (!dir && Date.now() - sIdxAt > 2_000) { build(); dir = sIdx.get(id) }
    return dir
  }
  const sessionVer = (id: string): string | undefined => {
    try {
      const live = ctx.sessions.get(id) as { session?: { seq?: number } } | undefined
      const seq = live?.session?.seq
      if (typeof seq === 'number') return 'live:' + seq
    } catch { /* 会话服务不可用：走落盘版本 */ }
    const dir = sessDirOf(id)
    if (!dir) return undefined
    try {
      let best: { name: string; mtime: number; size: number } | null = null
      for (const f of readdirSync(dir)) {
        if (!/^session\..*jsonl(\.zstd)?$/.test(f)) continue
        const st = statSync(join(dir, f))
        if (!best || st.mtimeMs > best.mtime || (st.mtimeMs === best.mtime && st.size > best.size)) best = { name: f, mtime: st.mtimeMs, size: st.size }
      }
      return best ? best.name + ':' + best.mtime + ':' + best.size : undefined
    } catch { return undefined }
  }
  /** warm = 真的起一轮后台统计（只有日程页发；打开卡片详情走 ganttMeta）。 */
  const ganttData = async (warm = false): Promise<Record<string, unknown>> => {
    const b = store.get()
    const refs = b.sessions.map((x) => x.sessionId)
    sdays.prune(new Set(refs))
    /* 首帧不 await 会话查询：主实例 161 个会话要 7s+，页面会白等；先画计划 / 手动条，自动日后台补（下一次轮询 rev 变化即刷新） */
    const { days, degraded } = sdays.peek(refs, sessionVer)
    if (warm) sdays.warm(refs, sessionVer)
    const auto: Record<string, string[]> = {}
    for (const r of b.sessions) { const d = days[r.sessionId] ?? []; if (r.cardId && d.length) auto[r.cardId] = [...new Set([...(auto[r.cardId] ?? []), ...d])] }
    const body = G.payload(b, ganttState(b), auto, degraded, ganttEvents())
    return { rev: G.revOf(body), ...body }
  }
  /** v90：只回 ui（卡片详情宽度）与统计实况 —— 不构建甘特数据、不起后台统计。
   *  打开卡片详情只为读一个宽度，旧代码走完整 /gantt 会在宿主里放一轮 6 秒的解压，把切会话拖慢。 */
  const ganttMeta = (): Record<string, unknown> => ({ ui: { ...(ganttState(store.get()).ui ?? {}) }, stats: sdays.stats() })
  /** 任务日程看板的变更（plan / actual / ddl / ui）：全部经 store.mutate 串行写盘，回包带最新 gantt 快照。 */
  const ganttMutate = async (key: string, x: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const cardId = typeof x.card === 'string' ? x.card : ''
    const day = typeof x.day === 'string' ? x.day : ''
    const kindName = 'gantt/' + key
    if (key === 'ui') {
      await store.mutate((b) => { G.setUi(ganttState(b), x) }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'gantt/ui' }])
      return { ok: true, gantt: await ganttData() }
    }
    /* v105：每日任务面板（勾选 = 当天完成 / 选中 = 排今天 / 排布）—— 按天一份，key 里带卡片 id */
    if (key === 'panel') {
      if (!G.isDay(day)) throw new M.BoardError('BAD_DAY', '任务面板的日期必须是 yyyy-mm-dd：' + day)
      await store.mutate((b) => {
        if (day > G.todayKey() && Array.isArray(x.done) && x.done.length) throw new M.BoardError('FUTURE', '未来的日子不能勾选完成：' + day)
        G.setPanelDay(ganttState(b), day, x, G.taskKeySetAll(b.cards))
      }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'gantt/panel', from: day }])
      return { ok: true, gantt: await ganttData() }
    }
    if (!cardId) throw new M.BoardError('BAD_ARG', '缺少卡片 id')
    if (key === 'plan-set') {
      const days = Array.isArray(x.days) ? [...new Set(x.days.filter((v) => typeof v === 'string' && G.isDay(v)))].sort().slice(0, 4000) : []
      await store.mutate((b) => { M.liveCard(b, cardId); ganttCardState(b, cardId).plan = days }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'gantt/plan-set', card: cardId, to: String(days.length) }])
      return { ok: true, gantt: await ganttData() }
    }
    if (key === 'ddl-move' || key === 'ddl-del' || key === 'ddl-edit') {
      const id = typeof x.id === 'string' ? x.id : typeof x.from === 'string' ? x.from : ''
      if (!id) throw new M.BoardError('BAD_ARG', '缺少截止时间 id')
      const to = typeof x.to === 'string' ? x.to : typeof x.at === 'string' ? x.at : ''
      if (key === 'ddl-move' && !G.isDay(to)) throw new M.BoardError('BAD_DAY', '截止时间必须是 yyyy-mm-dd')
      await store.mutate((b) => {
        const st = ganttCardState(b, cardId)
        /* v137：任务截止旗（id = tk:<任务 id>）—— 拖动 = 改 task.due，删除 = 清空 task.due；改类型 / 备注不适用 */
        if (id.startsWith(G.TASK_DDL)) {
          const t = M.flatTasks(M.liveCard(b, cardId).tasks).find((x) => x.id === id.slice(G.TASK_DDL.length))
          if (!t) throw new M.BoardError('NOT_FOUND', '找不到这个任务：' + id)
          if (key === 'ddl-del') { delete t.due; t.updated = new Date().toISOString(); return }
          if (key === 'ddl-move' || G.isDay(to)) { t.due = to; t.updated = new Date().toISOString(); return }
          throw new M.BoardError('BAD_ARG', '任务截止只能改日期（类型 / 备注跟着任务走）')
        }
        if (key === 'ddl-del') {
          const scope = x.scope === 'after' || x.scope === 'all' ? x.scope : 'one'
          /* 刚加上的条目客户端还拿着本地乐观 id：按 日期 + 备注 + 类型 找回来再删 */
          let target = id
          if (!(st.ddl ?? []).some((d) => G.ddlIdOf(d) === id) && typeof x.at === 'string') {
            const lab = typeof x.label === 'string' ? x.label : ''
            const kd = x.kind === 'soft' ? 'soft' : x.kind === 'hard' ? 'hard' : undefined
            const m = (st.ddl ?? []).find((d) => d.at === x.at && (d.label ?? '') === lab && (kd ? G.ddlKindOf(d) === kd : true))
            if (m) target = G.ddlIdOf(m)
          }
          if (!G.removeDdlScoped(st, target, scope)) throw new M.BoardError('NOT_FOUND', '没有这个截止时间：' + id)
          return
        }
        if (key === 'ddl-move') {
          if (!G.updateDdl(st, id, { at: to })) throw new M.BoardError('NOT_FOUND', '没有这个截止时间：' + id)
          return
        }
        const patch: { at?: string; kind?: 'hard' | 'soft'; label?: string } = {}
        if (G.isDay(to)) patch.at = to
        if (x.kind === 'hard' || x.kind === 'soft') patch.kind = x.kind
        if (typeof x.label === 'string') patch.label = clip(x.label, 120)
        if (!G.updateDdl(st, id, patch)) throw new M.BoardError('NOT_FOUND', '没有这个截止时间：' + id)
      }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'gantt/' + key, card: cardId, from: id, to: to || undefined }])
      return { ok: true, gantt: await ganttData() }
    }
    if (!cardId) throw new M.BoardError('BAD_ARG', '缺少卡片 id')
    if (!day && key !== 'ui') throw new M.BoardError('BAD_ARG', '缺少日期 day（yyyy-mm-dd）')
    const on = x.on === true
    await store.mutate((b) => {
      const c = M.liveCard(b, cardId)
      const st = ganttCardState(b, cardId)
      if (key === 'plan') {
        G.applyPlanDay(st, G.planDays(c, st, ganttEvents()), day, on)
      } else if (key === 'plan-range') {
        const to = typeof x.to === 'string' ? x.to : ''
        G.applyPlanRange(st, G.planDays(c, st, ganttEvents()), day, to, on)
      } else if (key === 'actual') {
        if (day > G.todayKey()) throw new M.BoardError('FUTURE', '未来的日子不能记录执行：' + day)
        G.setActualDay(st, day, on)
      } else if (key === 'ddl') {
        /* v99：同一天可以加多个（不再覆盖）；硬性 / 软性 */
        if (x.remove === true) {
          const ids = (st.ddl ?? []).filter((d) => d.at === day).map((d) => G.ddlIdOf(d))
          if (!ids.length) throw new M.BoardError('NOT_FOUND', '这天没有截止时间：' + day)
          G.removeDdl(st, ids[0])
        } else {
          /* v101：带重复规则的截止（每天 / 每周 / 每月 + 直到），按规则展开成多条 */
          const r = x.rep as { unit?: string; n?: number; until?: string } | undefined
          const rp = r && (r.unit === 'day' || r.unit === 'week' || r.unit === 'month')
            ? { unit: r.unit, n: typeof r.n === 'number' ? r.n : 1, ...(typeof r.until === 'string' && G.isDay(r.until) ? { until: r.until } : {}) }
            : undefined
          G.addDdlRepeat(st, day, x.kind === 'soft' ? 'soft' : 'hard', typeof x.label === 'string' ? clip(x.label, 120) : '', rp as { unit: 'day' | 'week' | 'month'; n?: number; until?: string } | undefined)
        }
      } else throw new M.BoardError('BAD_OP', '未知的看板操作 ' + key)
    }, () => [{ at: new Date().toISOString(), actor: 'user', kind: kindName, card: cardId, from: day || undefined }])
    return { ok: true, gantt: await ganttData() }
  }
  /** 0.24 关联卡片注入：落盘项目 key → STATE.md 路径。 */
  const statePathOf = (key: string): string | undefined => states.get(key)?.path
  // 0.16 落盘项目：环境检测 + 只补缺引导 + skill 软链（失败只关掉这块，看板照常）
  const repoPathsOf = (sid: string | undefined): string[] => {
    if (!sid) return []
    const b = store.get()
    const c = M.cardOfSession(b, sid)
    if (!c) return []
    const g = b.groups.find((x) => x.id === c.g)
    return [...(c.repos ?? []), ...(g?.repos ?? [])].sort((x, y) => Number(y.role === '主仓') - Number(x.role === '主仓')).map((r) => r.path)
  }
  const landfill: Landfill = new Landfill({ aiRoot, agentsHome: config.agentsHome || join(homedir(), '.agents'), pkgDir: PKG_DIR, dataDir }, states, {
    repoPaths: repoPathsOf,
    // 写的是卡片还没关联的 STATE → 自动关联（一张卡片 = 一个落盘项目）
    persisted: (sid, key) => {
      const c = sid ? M.cardOfSession(store.get(), sid) : undefined
      if (!c || c.archivedAt || M.memoryOf(store.get(), c).some((m) => m.key === key)) return
      void store.mutate((b) => M.updateCard(b, c.id, { links: [...M.card(b, c.id).links, key] }), () => [{ at: new Date().toISOString(), actor: 'agent', kind: 'landfill/link', card: c.id, to: key }]).catch((e) => log?.warn('落盘后关联卡片失败：' + key, e))
    },
    // 0.18 卡片档案块：每次按看板现生成
    cardBlock: (key) => cardBlock(store.get(), key, new Date().toISOString(), store.boardPath, statePathOf),
    scope: (sid) => {
      const b = sid ? store.get() : undefined
      const c = b && sid ? M.cardOfSession(b, sid) : undefined
      if (!b || !c) return undefined
      return { cardId: c.id, card: c.links.slice(), group: (b.groups.find((g) => g.id === c.g)?.links ?? []).slice() }
    },
    // 0.20 按卡片组归档
    home: async (sid) => { const g = groupOfSession(sid); return g?.lfProject ? ensureHome(g.lfProject, g) : undefined },
    homeHint: (sid) => { const g = groupOfSession(sid); return g && !g.lfProject ? { group: g.name, suggest: folderSuggest(g) } : undefined },
    moveTarget: (key) => { const c = specCtxOf(key); return specIssues('', c).some((x) => x.id === 'location') ? c.home : undefined },
    migrate: async (sid, key, to): ReturnType<MigrateEngine['migrate']> => { const g = store.get().groups.find((x) => x.lfProject === to); if (g) await ensureHome(to, g); return migrations.migrate(sid, key, to) },
    specCtx: (key) => specCtxOf(key),
    log,
  }, config.landfill)
  const groupOfSession = (sid: string | undefined): M.Group | undefined => { const b = store.get(); const c = sid ? M.cardOfSession(b, sid) : undefined; return c ? b.groups.find((g) => g.id === c.g) : undefined }
  const projectIds = (): string[] => { try { return readdirSync(join(aiRoot, 'projects')).filter((n) => !n.startsWith('.') && !/\.md$/.test(n)) } catch { return [] } }
  const folderSuggest = (g: M.Group): string => suggestFolder(g.name, g.id, [...projectIds(), ...store.get().groups.filter((x) => x.id !== g.id && x.lfProject).map((x) => x.lfProject as string)])
  /** 卡片组落盘文件夹第一次用到时在 ~/.ai 登记（根目录 = 卡片组子工作区目录，别名带组名，其他 CLI 在组目录里也能认出）。 */
  const ensureHome = async (pid: string, g: M.Group): Promise<string> => {
    if (existsSync(join(aiRoot, 'projects', pid, 'memory'))) return pid
    const al = [g.name.replace(/[|,\n]/g, ' ').trim()].filter(Boolean).join(',')
    const r = await landfill.ai(['register', '--project-id', pid, '--canonical-path', groupDir(dataDir, g.id), ...(al ? ['--aliases', al] : [])])
    if (r.code !== 0 && !/already registered/.test(r.stderr)) throw new M.BoardError('REGISTER_FAILED', '登记卡片组落盘文件夹 ' + pid + ' 失败：' + (r.stderr.trim() || r.stdout.trim()))
    log?.info('卡片组「' + g.name + '」的落盘文件夹已登记：~/.ai/projects/' + pid)
    states.invalidate()
    return pid
  }
  /** 规范检查的上下文：关联它的卡片名、第一个关联它的卡片组的落盘文件夹。跨组共用 = 留在第一个关联它的组（看板顺序：先卡片所在组，再组级关联）。 */
  const specCtxOf = (key: string): SpecCtx => {
    const b = store.get()
    const L = M.linksOfKey(b, key)
    const gs = [...L.cards.filter((c) => !c.archivedAt).map((c) => b.groups.find((g) => g.id === c.g)), ...L.groups].filter((g): g is M.Group => !!g)
    const homes = [...new Set(gs.map((g) => g.lfProject).filter((x): x is string => !!x))]
    const home = gs.find((g) => g.lfProject)?.lfProject
    return { project: key.split('/')[0], slug: key.split('/')[1], homes, ...(home ? { home } : {}), cards: [...new Set(L.cards.map((c) => c.t))], stay: migrations.stay(key) }
  }
  /** 规划模式（plan-mode 服务不在时按「不在规划模式」）。 */
  const planActive = (agent: Agent | undefined): boolean => {
    try { const pm = ctx.get('planMode') as { get(a: unknown): { active?: boolean; pending?: boolean } } | undefined; const st = agent && pm ? pm.get(agent) : undefined; if (st) return st.pending ?? st.active ?? false } catch { /* 下面按会话记录判断 */ }
    // 插件 ctx 拿不到 agent 作用域的 planMode 服务时：会话记录里最后一条 plan/mode 事件
    const s = agent?.session
    if (!s || typeof s.eventAt !== 'function' || typeof s.seq !== 'number') return false
    for (let i = s.seq - 1, n = 0; i >= 0 && n < 20000; i--, n++) { const e = s.eventAt(i); if (e?.type === 'plan/mode') return (e.data as { active?: boolean } | undefined)?.active === true }
    return false
  }
  if (!landfill.status.ok) log?.warn('落盘项目未开启：' + landfill.status.reason)
  const migrations: MigrateEngine = new MigrateEngine({
    aiRoot, dataDir, lf: landfill, states,
    board: { get: () => store.get(), relink: (fn) => store.mutate((b) => { fn(b) }, () => [{ at: new Date().toISOString(), actor: 'agent', kind: 'landfill/migrate-relink' }]) },
    log,
  })
  // 0.19 合并落盘项目
  const merges = new MergeEngine({
    aiRoot, dataDir, lf: landfill, states,
    board: { get: () => store.get(), relink: (fn) => store.mutate((b) => { fn(b) }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'landfill/merge-relink' }]) },
    cardBlock: (key) => cardBlock(store.get(), key, new Date().toISOString(), store.boardPath, statePathOf),
    log,
  })
  const MERGE_RE = /^\s*合并落盘项目（dsh-project-manager 合并 (mg[a-z0-9]+)）/
  /** 系统提示里本卡片那一段（「AI 收到的原文」浮层与 systemPrompt.context 用同一个函数）。 */
  const memoryFor = (sid: string): string => {
    const b = store.get()
    const card = M.cardOfSession(b, sid)
    if (!card) return ''
    const index = M.memoryOf(b, card).map((m) => ({ ...m, state: states.get(m.key), ...(landfill.status.ok ? { required: landfill.brief(m.key).required, full: true } : {}) }))
    return memoryText(b, card, index, config.memoryMaxBytes, undefined, statePathOf)
  }
  /** 合并完成卡片的数据（递归：合并前的项目若本身是合并结果，带上它自己的）。 */
  const mergeView = (r: MergeRec): Record<string, unknown> => ({
    id: r.id, key: r.key, at: r.at, dir: r.dir, purged: !!r.purged, all: merges.treeN(r), report: r.report ?? null, refs: (r.refs ?? []).map((x) => x.file), refsFailed: r.refsFailed ?? [], missing: (r.missing ?? []).map((x) => x.path), copied: (r.copied ?? []).map((x) => ({ path: x.path, rel: x.rel })), dropped: (r.dropped ?? []).map((x) => x.rel),
    files: (r.files ?? []).map((x) => ({ rel: x.rel, from: x.from.map((y) => y.key.split('/')[1]), ext: !!x.ext })), notes: r.srcs.map((s) => 'notes/merge-' + s.key.replace('/', '-') + '.md'),
    retiredDirs: [...new Set(r.srcs.map((s) => s.retired ? dirname(s.retired) : '').filter(Boolean))],
    undo: merges.undoWhy(r),
    srcs: r.srcs.map((s) => { const sub = s.mergeId ? merges.list().find((x) => x.id === s.mergeId) : undefined; return { key: s.key, kind: s.kind, chars: s.chars, files: s.files, retired: s.retired ?? null, exists: !!s.retired && existsSync(s.retired), ...(sub ? { sub: mergeView(sub) } : {}) } }),
  })
  const sessionExtra = (sid: string): Record<string, unknown> => {
    const b = store.get()
    const c = M.cardOfSession(b, sid)
    if (!c) return {}
    const g = M.group(b, c.g)
    const mem = M.memoryOf(b, c).map((m) => {
      const st = states.get(m.key)
      const fi = st ? landfill.fileInfo(st.path) : undefined
      const req = st ? landfill.requiredFiles(m.key) : []
      const res = merges.resultOf(m.key)
      const ctxS = st ? specCtxOf(m.key) : undefined
      const issues = st && ctxS && fi?.text ? specIssues(fi.text, ctxS) : []
      const mv = migrations.recOf(m.key)
      return { key: m.key, from: m.from, found: !!st, project: st?.project ?? m.key.split('/')[0], slug: st?.slug ?? m.key.split('/')[1], next: st?.next ?? '', status: st?.status ?? '', aliases: st?.aliases ?? [], pointer: fi?.text ? isPointer(fi.text) : false, chars: fi?.text?.length ?? 0, files: st ? Math.max(0, require0(st.path)) : 0, version: fi?.hash.slice(0, 8) ?? '', injected: st ? landfill.inContext(sid, st.path) && req.every((r) => landfill.inContext(sid, join(dirname(st.path), r))) : false, merge: res && !res.purged && merges.treeN(res) > 0 ? mergeView(res) : null, spec: issues.map((x) => ({ id: x.id, by: x.by, text: x.text, fix: x.fix })), moveTo: issues.some((x) => x.id === 'location') ? ctxS?.home ?? null : null, migration: mv ? { id: mv.id, from: mv.from, at: mv.at, retired: mv.retired, exists: existsSync(mv.retired), refs: mv.refs.length, files: mv.files, undo: migrations.undoWhy(mv) } : null }
    })
    const run = merges.runningFor(sid)
    const lr = landfill.runOf(sid)
    return {
      // 0.20 信息卡发起的落盘这一轮的结局；卡片组的落盘文件夹；每个落盘项目的规范问题与迁移记录
      lfRun: lr ? { ...lr, ago: Date.now() - lr.at } : null,
      folder: { group: g.name, value: g.lfProject ?? null, suggest: g.lfProject ? null : folderSuggest(g), registered: !!g.lfProject && existsSync(join(aiRoot, 'projects', g.lfProject, 'memory')) },
      cardInfo: { id: c.id, stage: g.statuses.find((s) => s.id === c.col)?.name ?? '', archived: !!c.archivedAt, repos: c.repos ?? [], tasks: c.tasks, notes: c.noteItems ?? [], links: c.webLinks ?? [], related: (c.related ?? []).map((id) => b.cards.find((x) => x.id === id)).filter((x): x is M.Card => !!x).map((r) => { const rg = b.groups.find((x) => x.id === r.g); return { id: r.id, title: r.t, group: rg?.name ?? '', stage: rg?.statuses.find((x) => x.id === r.col)?.name ?? '', archived: !!r.archivedAt, dirs: rg ? M.memoryOf(b, r).map((m) => { const p = statePathOf(m.key); return p ? dirname(p) : m.key }) : [] } }), files: (c.files ?? []).map((f) => ({ id: f.id, path: f.path, title: f.title, exists: existsSync(f.path), ...(f.prev?.length ? { prev: f.prev } : {}) })), sessions: b.sessions.filter((x) => x.cardId === c.id).map((x) => ({ id: x.sessionId, title: x.title ?? '' })), lfDirs: M.memoryOf(b, c).map((m) => { const p = statePathOf(m.key); return p ? dirname(p) : '' }).filter(Boolean) },
      memDetail: mem,
      merging: run ? { id: run.id, key: run.key, srcs: run.srcs.map((s) => s.key), ...merges.progress(run) } : null,
      mergeTool: { ok: landfill.status.ok && landfill.status.toolVersion >= 3, version: landfill.status.toolVersion },
    }
  }
  /** 文件夹里除 STATE.md 外的文件数。 */
  const require0 = (statePath: string): number => { try { return listDocs(dirname(statePath), 2000).files.length } catch { return 0 } }
  /**
   * v93：「从历史消息选择」——某个会话里用户自己发过的消息（从新到旧）。
   * v94：不再截断（「只列最近 400 条」），改成 before / limit 翻页（默认 200 条 / 页）——
   * 弹窗里可以选别的活跃会话、一直翻到最早一条。过滤规则在同目录 history.ts（纯函数，可单测）：
   * 只认 user/message + source.kind=user 与 command/run(name=goal)，系统注入不会混进来。
   * ponytail: 每次请求全量读一遍再切片；会话上百 MB 时再改成只读尾部窗口。
   */
  const sessionMessages = async (sid: string, o: { before?: number; limit?: number } = {}): Promise<Record<string, unknown>> => {
    if (!sid) throw new M.BoardError('BAD_ARG', '缺少会话 id')
    const q = ctx.get('sessionQuery') as { readSession(id: string): Promise<{ events: Array<{ type?: string; seq?: number; time?: number | string; data?: Record<string, unknown> }> }> } | undefined
    if (!q) throw new M.BoardError('NO_SESSION_QUERY', '当前 DSH 没有会话记录服务（sessionQuery），列不出历史消息')
    let events: Array<{ type?: string; seq?: number; time?: number | string; data?: Record<string, unknown> }>
    try { events = (await q.readSession(sid)).events } catch (e) { throw new M.BoardError('NO_SESSION_LOG', '读不到这个会话的记录：' + (e instanceof Error ? e.message : String(e))) }
    // v94：整流整形（含回合中排队 / 插话的 agent/inbox/spliced 用户条目，与正式 user/message 按 rpcId 去重）
    const all = historyRows(events)
    return historyPage(all, o) as unknown as Record<string, unknown>
  }
  const sessionRaw = (sid: string): Record<string, unknown> => {
    const b = store.get()
    const c = M.cardOfSession(b, sid)
    if (!c) return { system: '', rules: '', files: [] }
    const files: Array<Record<string, unknown>> = []
    for (const m of M.memoryOf(b, c)) {
      const st = states.get(m.key)
      if (!st) continue
      for (const rel of ['STATE.md', ...landfill.requiredFiles(m.key)]) {
        const p = join(dirname(st.path), rel)
        const fi = landfill.fileInfo(p)
        if (!fi || fi.binary) continue
        const text = fi.text ?? ''
        const shown = rel === 'STATE.md' ? maskBlock(text, 0, text.length, c.id) : text
        const CAP = 200_000
        files.push({ key: m.key, file: rel, version: fi.hash.slice(0, 8), chars: text.length, inContext: landfill.inContext(sid, p), text: clip(shown, CAP), ...(shown.length > CAP ? { truncated: shown.length - CAP } : {}) })
      }
    }
    return { system: memoryFor(sid), rules: landfill.status.ok ? RULES : '', files }
  }
  let rev = 1
  let hubWs: Workspace | null = null
  const hubPath = syncHub(dataDir, store.get(), states)
  const hubReal = realpathSync(hubPath)

  ctx.effect(() => store.subscribe((b) => {
    rev++
    try { syncHub(dataDir, b, states) } catch (e) { log?.warn('同步项目区目录失败', e) }
    // 组新建 / 改名 / 删除 / 排序 → 子工作区跟着变
    void arrange().catch(() => undefined)
  }), 'dsh-project-manager: board subscription')

  /** 找到或创建「项目区」工作区并置顶；幂等（同路径 create 复用原条目）。 */
  const ensureHub = async (): Promise<Workspace> => {
    const existing = ctx.workspaceRegistry.list().find((w) => w.path === hubReal)
    hubWs = existing ?? await ctx.workspaceRegistry.create(hubPath, config.hubTitle)
    await pin()
    return hubWs
  }
  // ── 卡片组子工作区 ──
  const groupsReal = join(hubReal, 'groups')
  const groupReal = (gid: string): string => { const p = groupDir(dataDir, gid); try { return realpathSync(p) } catch { return join(groupsReal, p.slice(p.lastIndexOf('/') + 1)) } }
  /** cwd（已 realpath）是否属于项目区：根目录或某个卡片组子目录。 */
  const projectCwd = (cwd: string): boolean => cwd === hubReal || dirname(cwd) === groupsReal
  const groupWsOf = (gid: string): Workspace | undefined => { const p = groupReal(gid); return ctx.workspaceRegistry.list().find((w) => w.path === p) }
  /**
   * 让登记与看板一致（幂等，串行）：每个卡片组一个子工作区、标题 = 组名；组已删 → 撤销登记（目录与会话保留）；
   * 顺序 = 项目区第一，紧跟各卡片组（按看板顺序）。只在已有「项目区」工作区时生效（用户还没用过项目会话就不往侧栏加东西）。
   */
  let chain: Promise<void> = Promise.resolve()
  const arrange = (): Promise<void> => {
    const run = async (): Promise<void> => {
      if (!hubWs || !ctx.workspaceRegistry.get(hubWs.id)) return
      const reg = ctx.workspaceRegistry
      const b = store.get()
      const want: Workspace[] = []
      for (const g of b.groups) {
        const p = groupDir(dataDir, g.id)
        if (!existsSync(p)) continue
        let w = groupWsOf(g.id)
        if (!w) w = await reg.create(p, g.name)
        else if (w.title !== g.name && typeof w.setTitle === 'function') await w.setTitle(g.name)
        want.push(w)
      }
      const keep = new Set(want.map((w) => w.id))
      for (const w of reg.list()) if (dirname(w.path) === groupsReal && !keep.has(w.id)) await reg.delete(w.id)
      const desired = [hubWs.id, ...want.map((w) => w.id)]
      for (let i = 0; i < desired.length; i++) {
        const order = reg.list().map((w) => w.id)
        if (order[i] !== desired[i]) await reg.insertBefore(desired[i], order[i])
      }
    }
    const p = chain.then(run, run)
    chain = p.catch((e) => { log?.warn('同步卡片组子工作区失败', e) })
    return p
  }
  hubWs = ctx.workspaceRegistry.list().find((w) => w.path === hubReal) ?? null
  if (hubWs) void arrange().catch(() => undefined)
  const pin = arrange

  // 别的工作区被新建/挪动时，把「项目区 + 卡片组」放回最前（已在位时 arrange 不写，避免自触发循环）
  ctx.on('domain/changed' as never, ((c: { domain?: string; table?: string; operation?: string; value?: { workspaceIds?: string[] } }) => {
    if (!hubWs || c.domain !== 'workspace' || c.table !== '' || c.operation !== 'put') return
    const ids = c.value?.workspaceIds ?? []
    const want = [hubWs.id, ...store.get().groups.map((g) => groupWsOf(g.id)?.id).filter((x): x is string => !!x)]
    if (want.some((id, i) => ids[i] !== id)) void arrange().catch(() => undefined)
  }) as never)

  /** 绑定后同步设置权限与标题（session/bind 路由调用；会话必须在运行中）。 */
  /** tree = 用户当前是 dsh「按工作区树」分组（组名已在树上）→ 会话名只用卡片名；否则「组名 · 卡片名」。 */
  /* v145（1.2）：从任务 / 子任务 / 项目新建的会话，会话名 = 它的标题（不再拼「组名 · 卡片名」）；旧入口（不带 name）保持原样 */
  const applyToSession = (s: Session, cardId: string, tree: boolean, name?: string): { title: string | null; permission: boolean } => {
    const b = store.get()
    const c = M.card(b, cardId)
    const g = M.group(b, c.g)
    let permission = false
    if (config.projectSessionMode === 'danger-full-access') { ctx.permissionPresets.set(s, 'danger-full-access'); permission = true }
    const title = name || (tree ? c.t : g.name + ' · ' + c.t)
    try { ctx.sessionTitle.rename(s, title) } catch (e) { log?.warn('会话改名失败', e); return { title: null, permission } }
    return { title, permission }
  }

  // 0.20 信息卡发起的落盘：一轮结束时按原因标出（停止 / 出错 / 在问用户 / 没写），新的一轮开始时恢复进行中
  ctx.on('session/event' as never, ((sess: { id?: string }, ev: { type?: string; data?: { reason?: { kind?: string; error?: { message?: string } } } }) => {
    try {
      const sid = sess?.id
      if (!sid || !landfill.runOf(sid)) return
      if (ev?.type === 'turn/end') landfill.runTurnEnd(sid, ev.data?.reason, askedLast.get(sid) === true)
      else if (ev?.type === 'turn/start') { askedLast.delete(sid); landfill.runTurnStart(sid) }
      else if (ev?.type === 'user/message') { const t = textOf(ev.data); if (t) landfill.runSeen(sid, t) }
      else if (ev?.type === 'tool/call') askedLast.set(sid, (ev.data as { name?: string } | undefined)?.name === 'ask_user_question')
      else if (ev?.type === 'assistant/message') { const t = textOf((ev.data as { message?: unknown } | undefined)?.message); if (t.trim()) askedLast.set(sid, /[?？]\s*$/.test(t.trim())) }
    } catch (e) { log?.warn('落盘跟踪失败', e) }
  }) as never)
  const askedLast = new Map<string, boolean>()

  ctx.on('session/created' as never, ((s: Session) => {
    if (s.header.origin === 'subagent' || !s.header.cwd) return
    let cwd = s.header.cwd
    try { cwd = realpathSync(cwd) } catch { /* 目录不存在时按原值比较 */ }
    if (!projectCwd(cwd)) return
    // 会话恢复也会触发 created：只处理刚创建的会话（createdAt 在 60 秒内），不覆盖用户后来改过的权限
    const createdAt = (s.header as { createdAt?: number }).createdAt
    if (typeof createdAt === 'number' && Date.now() - createdAt > 60_000) return
    // 项目区里新建的会话一律按完全访问（即使不是经卡片发起，例如官方「+」降级路径）
    if (config.projectSessionMode === 'danger-full-access') {
      try { ctx.permissionPresets.set(s, 'danger-full-access') } catch (e) { log?.warn('设置完全访问失败', e) }
    }
    // 0.14 分叉：源会话关联了卡片 → 新会话自动关联同一张卡片（会话名沿用宿主给的）
    const parent = s.header.parentSession
    if (parent && M.sessionRef(store.get(), parent)) {
      landfill.forkKnown(s.id, parent)
      void store.mutate((b) => M.bindFork(b, s.id, parent), (c) => (c ? [{ at: new Date().toISOString(), actor: 'user', kind: 'session/fork', card: c.id, from: parent, to: s.id }] : []))
        .catch((e) => log?.warn('分叉会话自动关联卡片失败：' + s.id + ' ← ' + parent, e))
    }
  }) as never)

  // ── 0.26 相关文件放到落盘项目：复制进 evidence/（ai-memory import，sha256 校验）→ 相关文件改指向；del = 原文件移到废纸篓 ──
  const trashDir = join(homedir(), '.Trash')
  const moveFile = (from: string, to: string): void => { try { renameSync(from, to) } catch (e) { if ((e as { code?: string }).code !== 'EXDEV') throw e; copyFileSync(from, to); unlinkSync(from) } }
  const uniq = (dir: string, name: string): string => { let n = name; for (let i = 2; existsSync(join(dir, n)); i++) n = name.replace(/(\.[^.]+)?$/, '-' + i + '$1'); return n }
  const LF_IMPORT_MAX = 50 * 1024 * 1024
  const LF_IMPORT_HARD_MAX = 500 * 1024 * 1024
  const sizeOf = (p: string): number => { try { return statSync(p).size } catch { return 0 } }
  const filesToLf = async (cardId: string, fileIds: string[], key: string, del: boolean, opts: { allowLarge?: boolean; pathOnly?: boolean } = {}): Promise<Record<string, unknown>> => {
    const b0 = store.get()
    const c = M.liveCard(b0, cardId)
    if (!M.memoryOf(b0, c).some((m) => m.key === key)) throw new M.BoardError('NOT_LINKED', '卡片「' + c.t + '」没有关联落盘项目 ' + key)
    if (!states.get(key)) throw new M.BoardError('NOT_FOUND', '找不到落盘项目 ' + key + ' 的 STATE')
    const dir = landfill.dirOf(key)
    const want = new Set(fileIds)
    const list = (c.files ?? []).filter((f) => want.has(f.id) && !f.path.startsWith(dir + '/') && existsSync(f.path) && statSync(f.path).isFile())
    const done: Array<{ id: string; from: string; to: string; trashed?: string; kept?: string }> = []
    const failed: Array<{ id: string; path: string; error: string }> = []
    const skipped: Array<{ id: string; path: string; name: string; size: number; reason: 'path' | 'hard' }> = []
    // 0.32 三级规则：先整体预检；有 50MB+ 且用户还没确认 → 一个都不复制，交给界面弹确认。
    const big = list.map((f) => ({ f, size: sizeOf(f.path) })).filter((x) => x.size > LF_IMPORT_MAX)
    if (big.length && !opts.allowLarge && !opts.pathOnly) {
      return { key, done: [], failed: [], skipped: [], need: big.map((x) => ({ id: x.f.id, path: x.f.path, name: basename(x.f.path), size: x.size, hard: x.size > LF_IMPORT_HARD_MAX })) }
    }
    for (const f of list) {
      try {
        const size = sizeOf(f.path)
        if (size > LF_IMPORT_HARD_MAX || (opts.pathOnly && size > LF_IMPORT_MAX)) { skipped.push({ id: f.id, path: f.path, name: basename(f.path), size, reason: size > LF_IMPORT_HARD_MAX ? 'hard' : 'path' }); continue }
        mkdirSync(join(dir, 'evidence'), { recursive: true })
        /* v154（1.2）：搬家保留原文件名（空格 / 全角标点都留着）—— 改名字会让「按文件名认旧引用」全部失效，
           也会让会话里写下的旧路径再也对不上。只有存档层拒收这个名字时，才回退旧的净化名。 */
        const keepName = basename(f.path).replace(/[\\/\u0000-\u001f\u007f]/g, '_')
        let name = uniq(join(dir, 'evidence'), keepName)
        let r: Record<string, unknown>
        try {
          r = await landfill.importFile({}, key, f.path, 'evidence/' + name, undefined, { allowLarge: opts.allowLarge === true })
        } catch (e) {
          const safe = uniq(join(dir, 'evidence'), basename(f.path).replace(/[^A-Za-z0-9._\u4e00-\u9fff-]+/g, '-'))
          if (safe === name) throw e
          name = safe
          r = await landfill.importFile({}, key, f.path, 'evidence/' + name, undefined, { allowLarge: opts.allowLarge === true })
        }
        const it: { id: string; from: string; to: string; trashed?: string; kept?: string } = { id: f.id, from: f.path, to: r.path as string }
        if (del) {
          // 保护：在本卡片仓库里的（源码）、还被别的卡片登记着的，只复制不删
          const inRepo = [...(c.repos ?? []), ...(M.group(b0, c.g).repos ?? [])].some((x) => f.path.startsWith(x.path.replace(/\/+$/, '') + '/'))
          const elsewhere = b0.cards.some((x) => x.id !== c.id && (x.files ?? []).some((y) => y.path === f.path))
          if (inRepo) it.kept = '在仓库里'
          else if (elsewhere) it.kept = '别的卡片也在用'
          else if (!existsSync(trashDir)) it.kept = '找不到废纸篓 ' + trashDir
          else { const t = join(trashDir, uniq(trashDir, basename(f.path))); moveFile(f.path, t); it.trashed = t }
        }
        done.push(it)
      } catch (e) { failed.push({ id: f.id, path: f.path, error: e instanceof Error ? e.message : String(e) }) }
    }
    if (done.length) await store.mutate((b) => { for (const x of done) M.setFilePath(b, cardId, x.id, x.to) }, () => done.map((x) => ({ at: new Date().toISOString(), actor: 'user', kind: 'card/files-tolf', card: cardId, from: x.from, to: x.to })))
    if (failed.length) log?.warn('放到落盘项目：' + failed.length + ' 个文件没复制成功', failed)
    return { key, done, failed, skipped }
  }
  const filesUndoLf = async (cardId: string, items: Array<{ id: string; from: string; trashed?: string }>): Promise<Record<string, unknown>> => {
    const back: string[] = []
    for (const x of items) if (x.trashed && existsSync(x.trashed) && !existsSync(x.from)) { mkdirSync(dirname(x.from), { recursive: true }); moveFile(x.trashed, x.from); back.push(x.from) }
    await store.mutate((b) => { for (const x of items) M.setFilePath(b, cardId, x.id, x.from) }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'card/files-untolf', card: cardId }])
    return { restored: back.length, items: items.length }
  }

  // ── 0.28 相关文件「删除」：文件移到 ~/.Trash 并解除关联（绑定它的任务一起解绑）；撤销 = 从废纸篓放回 + 重新关联 ──
  const fileTrash = async (cardId: string, fileId: string): Promise<Record<string, unknown>> => {
    const c = M.liveCard(store.get(), cardId)
    const f = (c.files ?? []).find((x) => x.id === fileId)
    if (!f) throw new M.BoardError('NOT_FOUND', '卡片「' + c.t + '」里没有这个文件')
    if (!existsSync(f.path)) throw new M.BoardError('FILE_GONE', '文件已经不在了：' + f.path)
    if (!statSync(f.path).isFile()) throw new M.BoardError('NOT_FILE', '这不是文件，不能删除：' + f.path)
    if (!existsSync(trashDir)) throw new M.BoardError('NO_TRASH', '找不到废纸篓 ' + trashDir)
    const trashed = join(trashDir, uniq(trashDir, basename(f.path)))
    moveFile(f.path, trashed)
    let r: { file: M.FileRef; index: number; tasks: string[] } | undefined
    try {
      await store.mutate((b) => { r = M.removeFile(b, cardId, fileId) }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'card/files-trash', card: cardId, from: f.path, to: trashed }])
    } catch (e) { moveFile(trashed, f.path); throw e } // 看板没改成：文件放回原处，不留半截状态
    return { ...(r as object), trashed }
  }
  /** v151（5.2）：批量删除 = 一次写看板（以前逐个 card/files-trash，每个都整份写 + 整份快照，5 个文件要等好几秒）。
   *  先逐个挪到废纸篓，再一次 mutate 解除关联；看板写失败 = 全部放回原处。挪不动的单个文件点名报错、不影响其它。 */
  const fileTrashMany = async (cardId: string, ids: unknown): Promise<Record<string, unknown>> => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some((x) => typeof x !== 'string')) throw new M.BoardError('BAD_ARG', 'files 必须是 1–200 个文件 id')
    const c = M.liveCard(store.get(), cardId)
    if (!existsSync(trashDir)) throw new M.BoardError('NO_TRASH', '找不到废纸篓 ' + trashDir)
    const moved: Array<{ id: string; from: string; trashed: string }> = []
    const failed: Array<{ id: string; path: string; error: string }> = []
    for (const id of [...new Set(ids as string[])]) {
      const f = (c.files ?? []).find((x) => x.id === id)
      if (!f) { failed.push({ id, path: '', error: '卡片里没有这个文件' }); continue }
      try {
        if (!existsSync(f.path)) { moved.push({ id, from: f.path, trashed: '' }); continue } // 已经不在：只解除关联
        if (!statSync(f.path).isFile()) throw new Error('这不是文件，不能删除')
        const trashed = join(trashDir, uniq(trashDir, basename(f.path)))
        moveFile(f.path, trashed)
        moved.push({ id, from: f.path, trashed })
      } catch (e) { failed.push({ id, path: f.path, error: e instanceof Error ? e.message : String(e) }) }
    }
    const items: Array<{ file: M.FileRef; index: number; tasks: string[]; trashed: string }> = []
    try {
      if (moved.length) await store.mutate((b) => { for (const m of moved) items.push({ ...M.removeFile(b, cardId, m.id), trashed: m.trashed }) }, () => moved.map((m) => ({ at: new Date().toISOString(), actor: 'user', kind: 'card/files-trash', card: cardId, from: m.from, to: m.trashed })))
    } catch (e) { for (const m of moved) if (m.trashed) { try { moveFile(m.trashed, m.from) } catch { /* 下面整体报错 */ } } throw e }
    if (failed.length) log?.warn('批量删除：' + failed.length + ' 个文件没删成', failed)
    return { items, failed }
  }
  const fileUntrash = async (cardId: string, file: unknown, index: unknown, tasks: unknown, trashed: string): Promise<Record<string, unknown>> => {
    const o = (file ?? {}) as { path?: unknown }
    const from = typeof o.path === 'string' ? o.path : ''
    if (!from) throw new M.BoardError('BAD_ARG', '缺少文件原路径')
    if (!trashed.startsWith(trashDir + '/') || !existsSync(trashed)) throw new M.BoardError('FILE_GONE', '废纸篓里已经没有这个文件了（可能被清空）：' + basename(trashed))
    if (existsSync(from)) throw new M.BoardError('FILE_EXISTS', '原位置已经有同名文件，没有覆盖：' + from)
    mkdirSync(dirname(from), { recursive: true })
    moveFile(trashed, from)
    await store.mutate((b) => { M.restoreFile(b, cardId, file, index, tasks) }, () => [{ at: new Date().toISOString(), actor: 'user', kind: 'card/files-untrash', card: cardId, to: from }])
    return { path: from }
  }

  /**
   * v129 / v130：任务标题生成 —— 模型由用户在「配置生成标题模型」里手动选（dsh 已配置的 provider / 模型，推理档 = 模型元数据里的 efforts），
   * 不跟随会话模型；没配置 = 不能生成。kiro（dsh-kiro）不能生成标题，目录里整组隐藏。v120 保留：读 finish（error / aborted）原样透出失败原因、空响应自动重试一次。
   * 只读：不往会话里写任何事件；每次尝试超时 20 秒。sid 只用来给请求打会话标签（拿不到也能生成）。
   */
  type Chunk = { type?: string; text?: string; block?: { type?: string; text?: string }; reason?: { kind?: string; failure?: { code?: string; message?: string }; message?: string } }
  type Effort = { id: string; name: string; description?: string }
  type LlmSvc = {
    listProviders?(): Array<{ id: string; name?: string }>
    listModels?(provider: string): Promise<Array<{ id: string; name: string; description?: string }>>
    resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{ reasoning?: { efforts: Effort[]; defaultEffort?: string } }>
    prepareCall(config: Record<string, unknown>, signal: AbortSignal, configure?: (controls: Record<string, unknown>, model: string) => Record<string, unknown>): Promise<{ config: Record<string, unknown>; stream(options: Record<string, unknown>): AsyncIterable<Chunk> }>
  }
  const titleHidden = (id: string): boolean => /kiro/i.test(id)
  let modelsCache: { at: number; v: Record<string, unknown> } | null = null
  /** v130：生成标题可选的模型目录（按 provider 分组；每个模型带它支持的推理档 + 默认档）。60 秒缓存，单个模型元数据 4 秒拿不到就不列档位。 */
  const titleModels = async (): Promise<Record<string, unknown>> => {
    if (modelsCache && Date.now() - modelsCache.at < 60_000) return modelsCache.v
    const llm = ctx.get('llm') as LlmSvc | undefined
    if (!llm?.listProviders || !llm.listModels) return { groups: [], hidden: [] }
    const ps = llm.listProviders()
    const hidden = ps.filter((p) => titleHidden(p.id)).map((p) => p.name || p.id)
    const groups = await Promise.all(ps.filter((p) => !titleHidden(p.id)).map(async (p) => {
      let ms: Array<{ id: string; name: string; description?: string }> = []
      try { ms = await llm.listModels!(p.id) } catch { ms = [] }
      const models = await Promise.all(ms.map(async (m) => {
        let reasoning: { efforts: Effort[]; defaultEffort?: string } | undefined
        if (llm.resolveModelInfo) {
          const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000)
          try { reasoning = (await llm.resolveModelInfo(p.id, m.id, ac.signal)).reasoning } catch { reasoning = undefined } finally { clearTimeout(t) }
        }
        return { id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}), efforts: (reasoning?.efforts ?? []).map((e) => ({ id: e.id, name: e.name })), ...(reasoning?.defaultEffort ? { def: reasoning.defaultEffort } : {}) }
      }))
      return { provider: p.id, name: p.name || p.id, models }
    }))
    const v = { groups: groups.filter((g) => g.models.length), hidden }
    modelsCache = { at: Date.now(), v }
    return v
  }
  const goalTitle = async (sid: string, text: string, route?: { provider?: unknown; model?: unknown; effort?: unknown }): Promise<Record<string, unknown>> => {
    const input = String(text ?? '').trim()
    if (!input) throw new M.BoardError('EMPTY_NOTE', '任务说明是空的：先写点内容（或从历史消息选择），再生成标题')
    const provider = typeof route?.provider === 'string' ? route.provider : ''
    const model = typeof route?.model === 'string' ? route.model : ''
    const effort = typeof route?.effort === 'string' && route.effort ? route.effort : undefined
    if (!provider || !model) throw new M.BoardError('NO_TITLE_MODEL', '还没配置生成标题的模型：点「配置生成标题模型」选一个 dsh 已配置的模型')
    if (titleHidden(provider)) throw new M.BoardError('NO_PROVIDER', 'Kiro（dsh-kiro）不能用来生成标题，换一个模型')
    const llm = ctx.get('llm') as LlmSvc | undefined
    if (!llm) throw new M.BoardError('NO_LLM', '当前 DSH 没有模型服务（llm），不能生成标题')
    if (llm.listProviders && !llm.listProviders().some((p) => p.id === provider)) throw new M.BoardError('NO_PROVIDER', '生成标题选的模型服务 ' + provider + ' 当前 DSH 没装配：重新「配置生成标题模型」')
    const TITLE_ROUTE = { provider, model }
    /* 空响应重试：模型支持「不思考」档才关掉推理，否则沿用首轮档 */
    let retryEffort: string | undefined = effort
    try { const info = await llm.resolveModelInfo?.(provider, model); if (info?.reasoning?.efforts.some((e) => e.id === 'none' || e.id === 'off')) retryEffort = info.reasoning.efforts.some((e) => e.id === 'none') ? 'none' : 'off'; else if (!info?.reasoning) retryEffort = undefined } catch { /* 拿不到元数据：沿用首轮档 */ }
    const attempt = async (maxTokens: number, eff: string | undefined): Promise<{ ok: true; title: string } | { ok: false; code: string; message: string }> => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(new Error('timeout')), 20_000)
      try {
        const call = await llm.prepareCall({ ...TITLE_ROUTE, maxTokens, ...(eff ? { reasoningEffort: eff } : {}) }, ac.signal, (controls) => (eff ? { ...controls, reasoningEffort: eff } : controls))
        const messages = [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '任务说明：\n' + input.slice(0, 12_000) }], source: { kind: SOURCE } }]
        let out = ''
        let fin: Chunk['reason'] | undefined
        for await (const chunk of call.stream({
          ...call.config,
          messages,
          system: '你是任务标题生成器。把用户给的任务说明总结成一条简短标题：不超过 40 个汉字（英文按词），只输出标题本身，不要引号、不要句末句号、不要解释、不要 Markdown。',
          ...(sid ? { sessionId: sid } : {}),
          purpose: 'dsh-project-manager:task-title',
          signal: ac.signal,
        })) {
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
          // 兼容只在 block-end 里给整块文本的适配器（没有 delta 时兜底）
          else if (chunk?.type === 'block-end' && !out && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') out += chunk.block.text
          else if (chunk?.type === 'finish') fin = chunk.reason
        }
        /* v120 根因：宿主把 provider 异常规范化成 finish(reason.kind = error / aborted)，以前不读 → 一律说成「空响应」 */
        if (fin?.kind === 'error' || fin?.kind === 'aborted') {
          if (ac.signal.aborted) return { ok: false, code: 'TIMEOUT', message: '生成标题超时（20 秒），稍后再试' }
          return { ok: false, code: fin.failure?.code || (fin.kind === 'aborted' ? 'ABORTED' : 'PROVIDER_ERROR'), message: fin.failure?.message || fin.message || (fin.kind === 'aborted' ? '请求被中止' : '模型服务报错') }
        }
        const title = cleanTitle(out)
        if (!title) return { ok: false, code: 'EMPTY_TITLE', message: '正文为空（finish.reason = ' + (fin?.kind ?? '无') + '）' }
        return { ok: true, title }
      } catch (e) {
        if (ac.signal.aborted) return { ok: false, code: 'TIMEOUT', message: '生成标题超时（20 秒），稍后再试' }
        const err = e as { code?: unknown; message?: unknown }
        return { ok: false, code: typeof err?.code === 'string' && err.code ? err.code : 'LLM_FAILED', message: e instanceof Error ? e.message : String(e) }
      } finally { clearTimeout(timer) }
    }
    /* v120（③）：空响应只自动重试一次 —— 放预算 + 关掉推理档 */
    const r = await titleWithRetry(attempt, effort, retryEffort)
    if (!r.ok) throw new M.BoardError(r.code, r.message + (r.retried ? '（已自动重试 1 次）' : ''))
    return { title: r.title, provider, model, effort: effort ?? '', retried: r.retried }
  }
  ctx.inject(['webServer'], (h) => {
    const off = mountRoutes((h as HostCtx).webServer as never, {
      store,
      states,
      hub: () => {
        const ws = hubWs ? ctx.workspaceRegistry.get(hubWs.id) : undefined
        const groups: Record<string, string> = {}
        for (const g of store.get().groups) { const w = groupWsOf(g.id); if (w) groups[g.id] = w.id }
        return { workspaceId: ws ? ws.id : null, path: hubReal, title: ws ? ws.title : config.hubTitle, groups }
      },
      prepareSession: async (cardId) => {
        const c = M.liveCard(store.get(), cardId)
        const hub = await ensureHub()
        const g = M.group(store.get(), c.g)
        const w = groupWsOf(g.id)
        if (!w) throw new M.BoardError('NO_GROUP_WORKSPACE', '卡片组「' + g.name + '」的子工作区没建好（目录 ' + groupDir(dataDir, g.id) + '），请重试')
        return { workspaceId: w.id, workspaceTitle: hub.title + ' / ' + w.title }
      },
      bindSession: async (sessionId, cardId, tree, name) => {
        const s = ctx.sessions.get(sessionId)
        if (!s) throw new M.BoardError('NO_SESSION', '会话不在运行中：' + sessionId)
        let cwd = s.header.cwd ?? ''
        try { cwd = realpathSync(cwd) } catch { /* 按原值比较 */ }
        if (!projectCwd(cwd)) throw new M.BoardError('NOT_HUB_SESSION', '会话不在「' + config.hubTitle + '」或它的卡片组子工作区里，拒绝绑定：' + sessionId)
        const r = applyToSession(s, cardId, tree, name)
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
        for (const it of withRead as Array<{ sessionId: string; readKeys?: string[] }>) if (it.readKeys?.length) landfill.seed(it.sessionId, it.readKeys)
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
      gantt: { data: ganttData, meta: ganttMeta, run: ganttMutate },
      landfill: () => landfill.snapshot(),
      adoptSkill: () => landfill.adopt(),
      upgradeTool: () => landfill.upgradeTool(),
      warn: (m) => log?.warn(m),
      sessionExtra,
      sessionMessages,
      goalTitle,
      titleModels,
      // 会话没在运行（还没对话的空会话）时用前端会话列表里的 cwd；只认项目区卡片组子目录
      freeSession: (sid, hint) => {
        const s = ctx.sessions.get(sid)
        let cwd = s?.header.cwd || hint
        if (!cwd) return null
        try { cwd = realpathSync(cwd) } catch { /* 按原值比较 */ }
        if (dirname(cwd) !== groupsReal) return null
        const g = store.get().groups.find((x) => !x.archivedAt && groupReal(x.id) === cwd)
        return g ? { group: { id: g.id, name: g.name, statuses: g.statuses } } : null
      },
      openLocal: async (raw, dry = false) => {
        const p = raw.replace(/^~(?=\/|$)/, homedir()).replace(/(.)\/+$/, '$1')
        if (!p.startsWith('/')) throw new M.BoardError('BAD_ARG', '路径必须是绝对路径：' + raw)
        let st: ReturnType<typeof statSync>
        try { st = statSync(p) } catch { throw new M.BoardError('NOT_FOUND', '路径不存在：' + p) }
        const kind = st.isDirectory() ? 'dir' : 'file'
        const how = openMode(p, kind, st.mode)
        if (dry) return { path: p, kind, how }
        await new Promise<void>((ok, bad) => execFile('/usr/bin/open', how === 'reveal' ? ['-R', p] : [p], { timeout: 15_000 }, (err) => (err ? bad(new M.BoardError('OPEN_FAILED', '打开失败：' + err.message)) : ok())))
        return { path: p, kind, how }
      },
      reveal: async (p, folder) => {
        if (typeof p !== 'string' || !p.startsWith('/')) throw new M.BoardError('BAD_ARG', '路径必须是绝对路径：' + String(p))
        // 只打开看板里登记过的文件 / 仓库，不接受任意路径
        const b = store.get()
        const known = b.cards.some((c) => (folder ? (c.repos ?? []).some((r) => r.path === p) : (c.files ?? []).some((f) => f.path === p)))
        if (!known) throw new M.BoardError('NOT_FOUND', (folder ? '这个仓库' : '这个文件') + '不在任何卡片里：' + p)
        if (!existsSync(p)) throw new M.BoardError('NOT_FOUND', (folder ? '文件夹' : '文件') + '已经不存在：' + p)
        await new Promise<void>((ok, bad) => execFile('/usr/bin/open', folder ? [p] : ['-R', p], { timeout: 15_000 }, (err) => (err ? bad(new M.BoardError('OPEN_FAILED', '打开访达失败：' + err.message)) : ok())))
      },
      // v99：点相关文件的标题 = 用系统默认应用打开（与访达里双击一致）；只认这张卡片登记过的文件，失败点名
      // v122（4.3）：按 id → 路径 → 文件名依次找（文件被挪进落盘项目 evidence/ 后说明里还是旧路径）；仍只认看板登记过的文件，不开放任意路径
      fileOpen: async (cardId, fileId, path = '', name = '', dry = false) => {
        const b = store.get()
        const c = b.cards.find((x) => x.id === cardId)
        if (!c) throw new M.BoardError('NOT_FOUND', '没有这张卡片：' + cardId)
        const base = (p: string): string => basename(p.replace(/\/+$/, ''))
        const mine = c.files ?? []
        const all = b.cards.flatMap((x) => x.files ?? [])
        const want = path ? base(path) : name
        const f = (fileId && mine.find((x) => x.id === fileId))
          || (path && mine.find((x) => x.path === path))
          || (want && mine.find((x) => base(x.path) === want))
          || (path && all.find((x) => x.path === path))
          || (want && all.find((x) => base(x.path) === want))
          || null
        if (!f) throw new M.BoardError('NOT_FOUND', '这个文件没有绑定在任何卡片上：' + (path || name || fileId))
        if (!existsSync(f.path)) throw new M.BoardError('FILE_GONE', '文件已经不存在：' + f.path)
        if (dry) return { path: f.path, id: f.id, moved: !!path && f.path !== path }
        await new Promise<void>((ok, bad) => execFile('/usr/bin/open', [f.path], { timeout: 15_000 }, (err) => (err ? bad(new M.BoardError('OPEN_FAILED', '打不开这个文件：' + err.message)) : ok())))
        return { path: f.path, id: f.id, moved: !!path && f.path !== path }
      },
      /* v106 ⑤：仓库悬停的 Terminal 按钮 —— 只认看板里登记过的仓库路径，打开 Terminal 并 cd 到该目录 */
      repoTerminal: async (p) => {
        if (typeof p !== 'string' || !p.startsWith('/')) throw new M.BoardError('BAD_ARG', '路径必须是绝对路径：' + String(p))
        const b = store.get()
        const known = b.cards.some((c) => (c.repos ?? []).some((r) => r.path === p)) || b.groups.some((g) => (g.repos ?? []).some((r) => r.path === p))
        if (!known) throw new M.BoardError('NOT_FOUND', '这个仓库不在任何卡片里：' + p)
        if (!existsSync(p)) throw new M.BoardError('NOT_FOUND', '这个仓库文件夹已经不存在：' + p)
        await new Promise<void>((ok, bad) => execFile('/usr/bin/open', ['-a', 'Terminal', p], { timeout: 15_000 }, (err) => (err ? bad(new M.BoardError('OPEN_FAILED', '打开 Terminal 失败：' + err.message)) : ok())))
      },
      createForSession: async (sid, gid, title, col, hint) => {
        const s = ctx.sessions.get(sid)
        let cwd = s?.header.cwd || hint
        try { cwd = realpathSync(cwd) } catch { /* 按原值比较 */ }
        if (cwd !== groupReal(gid)) throw new M.BoardError('NOT_GROUP_SESSION', '会话不在这个卡片组的子工作区里：' + sid)
        if (M.cardOfSession(store.get(), sid)) throw new M.BoardError('ALREADY_BOUND', '这个会话已经关联了卡片')
        const c = await store.mutate((b) => { const x = M.addCard(b, gid, title, [], col); M.bindSession(b, sid, x.id, title); return x }, (x) => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/create-card', card: x.id }])
        return { card: c.id, col: c.col }
      },
      sessionRaw,
      // 0.20 同名检测 / 信息卡发起落盘的跟踪 / 卡片组落盘文件夹 / 迁移撤销与删除
      lfMatch: (sid: string, q: string) => {
        const b = store.get()
        const c = M.cardOfSession(b, sid)
        if (!c) return { mode: 'none', hits: [] }
        const list = states.list()
        const r = matchStates(q, list, c.t)
        const L = (key: string): string[] => { const x = M.linksOfKey(b, key); return [...new Set(x.cards.filter((y) => !y.archivedAt).map((y) => y.t))] }
        return { mode: r.mode, hits: r.hits.map((h) => { const st = list.find((x) => x.key === h.key); const fi = st ? landfill.fileInfo(st.path) : undefined; const ctxS = specCtxOf(h.key); const g = M.group(b, c.g); const home = g.lfProject; return { key: h.key, why: h.why, slug: st?.slug ?? '', project: st?.project ?? '', aliases: st?.aliases ?? [], chars: fi?.text?.length ?? 0, updated: st?.updated ?? '', cards: L(h.key), moveTo: home && !ctxS.stay && ctxS.homes.length === 0 && home !== st?.project ? home : (specIssues('', ctxS).some((x) => x.id === 'location') ? ctxS.home ?? null : null) } }) }
      },
      lfLink: async (sid: string, key: string) => {
        const b = store.get()
        const c = M.cardOfSession(b, sid)
        if (!c) throw new M.BoardError('NO_CARD', '会话没有关联卡片')
        if (!states.get(key)) throw new M.BoardError('NOT_FOUND', '没有这个落盘项目：' + key)
        if (!M.memoryOf(b, c).some((m) => m.key === key)) await store.mutate((x) => M.updateCard(x, c.id, { links: [...M.card(x, c.id).links, key] }), () => [{ at: new Date().toISOString(), actor: 'user', kind: 'landfill/link', card: c.id, to: key }])
        return { key }
      },
      lfRunStart: (sid: string, key: string, label: string) => landfill.runStart(sid, key, label),
      lfRunDismiss: (sid: string) => landfill.runDismiss(sid),
      setFolder: async (sid: string, value: string) => {
        const g = groupOfSession(sid)
        if (!g) throw new M.BoardError('NO_CARD', '会话没有关联卡片')
        await store.mutate((b) => M.setGroupFolder(b, g.id, value), () => [{ at: new Date().toISOString(), actor: 'user', kind: 'group/lf-folder', group: g.id, to: value }])
        await ensureHome(value, M.group(store.get(), g.id))
        return { group: g.name, value }
      },
      migUndo: (id: string) => migrations.undo(id),
      migPurge: (id: string) => migrations.purge(id),
      ...(landfill.status.ok ? { filesToLf, filesUndoLf } : {}),
      fileTrash,
      fileTrashMany,
      fileUntrash,
      ...(landfill.status.ok ? {
        merge: {
          // 0.20 合并结果放进卡片组的落盘文件夹（设了的话；第一次用到时登记）
          preview: (sid: string, keys: string[], name: string) => { const c = M.cardOfSession(store.get(), sid); if (!c) throw new M.BoardError('NO_CARD', '会话没有关联卡片'); return merges.preview(M.memoryOf(store.get(), c).map((m) => m.key), keys, name, M.group(store.get(), c.g).lfProject) },
          start: async (sid: string, keys: string[], name: string) => { const c = M.cardOfSession(store.get(), sid); if (!c) throw new M.BoardError('NO_CARD', '会话没有关联卡片'); const g = M.group(store.get(), c.g); if (g.lfProject) await ensureHome(g.lfProject, g); return { ...(await merges.start(sid, c.id, M.memoryOf(store.get(), c).map((m) => m.key), keys, name, g.lfProject)) } },
          cancel: (id: string) => merges.cancel(id),
          undo: (id: string) => merges.undo(id),
          purge: (id: string) => merges.purge(id),
        },
      } : {}),
      // DSH 只开放了「选文件夹」：选文件用 macOS 自带的 choose file（可多选），其他平台由界面改为手输路径
      pickFiles: () => new Promise((resolve, reject) => {
        if (process.platform !== 'darwin') return reject(new M.BoardError('PICK_UNAVAILABLE', '当前系统不支持弹出选文件对话框（仅 macOS），请手动输入路径'))
        const script = ['activate', 'set fs to choose file with prompt "选择相关文件（可按住 ⌘ 多选）" with multiple selections allowed', 'set out to ""', 'repeat with f in fs', 'set out to out & POSIX path of f & linefeed', 'end repeat', 'return out']
        execFile('osascript', script.flatMap((l) => ['-e', l]), { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (!err) return resolve(M.parsePicked(String(stdout)))
          if (/-128/.test(String(stderr))) return resolve(null) // 用户点了取消
          reject(new M.BoardError('PICK_FAILED', '打开系统选文件对话框失败：' + (String(stderr).trim() || err.message)))
        })
      }),
      cleanup: async () => {
        hubWs = null
        await chain
        const reg = ctx.workspaceRegistry
        let groups = 0
        for (const w of reg.list()) if (dirname(w.path) === groupsReal && await reg.delete(w.id)) groups++
        const ws = reg.list().find((w) => w.path === hubReal)
        return { removedWorkspace: ws ? await reg.delete(ws.id) : false, removedGroupWorkspaces: groups }
      },
    }, () => rev)
    return off
  })

  ctx.inject(['tools'], (h) => {
    registerTools((h as HostCtx).tools, store, states)
    if (landfill.status.ok) registerLandfillTool((h as HostCtx).tools, landfill, merges)
  })

  if (landfill.status.ok) {
    // skill：全局层注册一份（没有 ~/.agents 链接时兜底）。实测 agent 预设自带的 skill 目录层会覆盖全局层，
    // 所以会话里实际读到的是 ~/.agents/skills/landfill-project/SKILL.md——它链接到插件这份时内容一致；是单独文件时看板提示「接管」。
    const sf = skillFile(landfill.paths)
    ctx.inject(['skills'], (h) => {
      const raw = readFileSync(sf, 'utf8')
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
      const description = /^description:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim() ?? 'Persist / recall landfill-project STATE'
      return (h as HostCtx).skills!.register({ name: SKILL_NAME, description, content: raw.slice(fm ? fm[0].length : 0).trim(), source: 'plugin', path: sf, resourceBase: { kind: 'directory', path: dirname(sf) } })
    })

    // 每一步：① 识别用户原话（规划模式下只提示）② 注入卡片关联的 STATE 与 [必读] 最新全文（会话里已有当前版本的不重复）
    ctx.on('agent/pre-step' as never, (async (p: { agent?: Agent; messages?: unknown[]; turn?: number; step?: number }, next: () => Promise<{ kind?: string; messages?: unknown[] }>) => {
      const d = await next()
      const sid = p.agent?.session?.id
      if (!sid || d?.kind === 'reject' || !Array.isArray(d?.messages)) return d
      const extra: Msg[] = []
      try {
        const text = (p.messages ?? []).filter((m) => (m as { source?: { kind?: string } })?.source?.kind === 'user').map(textOf).join('\n')
        const mm = MERGE_RE.exec(text)
        if (mm) merges.arm(sid, mm[1])
        const i = text ? detectIntent(text, states.list()) : null
        if (i) {
          const plan = i.want === 'persist' && planActive(p.agent)
          const t = landfill.begin(sid, p.turn ?? 0, i, plan)
          log?.info('落盘项目：识别到 ' + i.want + ' ' + (i.keys.join(',') || '-') + (plan ? '（规划模式，只提示）' : t.quiet ? '（连续被忽略，不再拉回）' : '') + '（会话 ' + sid.slice(0, 20) + '）')
          if (plan) extra.push(msg(PLAN_HINT, 'landfill-intent'))
          else if (!t.quiet) {
            const project = await landfill.resolveProject({ id: sid, cwd: p.agent?.session?.header?.cwd }).catch(() => null)
            // 0.20 落盘时按现行规范要改的地方（插件自动迁移的位置项 + AI 要改的项）一并告诉 AI
            let spec = ''
            if (i.want === 'persist') {
              const b = store.get()
              const c = M.cardOfSession(b, sid)
              const keys = i.keys.length ? i.keys : c ? M.memoryOf(b, c).map((m) => m.key) : []
              spec = keys.map((k) => { const f = states.get(k); const t = f ? landfill.fileInfo(f.path)?.text : undefined; return t ? specHint(k, specIssues(t, specCtxOf(k))) : '' }).filter(Boolean).join('\n')
              // 0.26 卡片「放到落盘项目」复制进 evidence/ 的文件：点名，让 AI 在文件索引补 [参考] 行
              const un = keys.map((k) => { const f = states.get(k); const t = f ? landfill.fileInfo(f.path)?.text : undefined; if (!f || t === undefined) return ''; const miss = listDocs(dirname(f.path), 2000).files.filter((r) => !isIndexed(r, t)); return miss.length ? k + ' 文件夹里有 ' + miss.length + ' 个文件还没进「📁 文件索引」（多是卡片「放到落盘项目」复制进来的）：' + miss.slice(0, 30).join('、') + (miss.length > 30 ? ' 等' : '') + '。每个补一行「- [参考] 路径 · 用途 · 何时读」' : '' }).filter(Boolean).join('\n')
              if (un) spec = spec ? spec + '\n' + un : un
            }
            extra.push(msg(intentHint(i, project) + (spec ? '\n' + spec : ''), 'landfill-intent'))
          }
        }
      } catch (e) { log?.warn('落盘项目：识别原话失败', e) }
      try {
        // 压缩（compaction/*：摘要替换或裁剪工具结果）后之前注入 / 读到的全文可能已不在上下文 → 重新注入
        const s = p.agent?.session
        const at = typeof s?.seq === 'number' ? s.seq : undefined
        const from = landfill.scannedTo(sid, at)
        if (at !== undefined && from !== undefined && typeof s?.eventAt === 'function') for (let i = Math.max(from, at - 20000); i < at; i++) if (s.eventAt(i)?.type.startsWith('compaction/')) { landfill.contextLost(sid); break }
        const full = landfill.autoRead(sid, p.turn ?? 0)
        if (full) { extra.unshift(msg(full, 'landfill-autoread')); log?.info('落盘项目：注入最新全文 ' + full.length + ' 字（会话 ' + sid.slice(0, 20) + '）') }
      } catch (e) { log?.warn('落盘项目：注入全文失败', e) }
      return extra.length ? { ...d, messages: [...d.messages, ...extra] } : d
    }) as never)

    // 拦截直写 ~/.ai 记忆；顺带记下本轮是否已读 STATE / 在问用户
    ctx.on('tools/pre-execute' as never, (async (exec: { name?: string; arguments?: unknown; agent?: Agent }, next: () => Promise<unknown>) => {
      try {
        const a = (exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}) as Record<string, unknown>
        const name = String(exec.name ?? '')
        const why = guardReason(name, a, aiRoot)
        if (why) { log?.info('落盘项目：拦截 ' + name + ' 直写 ~/.ai'); return { kind: 'deny', reason: why } }
        landfill.observe(exec.agent?.session?.id, name, a)
      } catch (e) { log?.warn('落盘项目：拦截检查失败（已放行）', e) }
      return next()
    }) as never)

    // 0.18 计划批准 → 归档到卡片主 STATE 的 plans/（失败只记日志，不影响批准）
    ctx.on('tools/post-execute' as never, (async (exec: { name?: string; arguments?: unknown; agent?: Agent }, result: { isError?: boolean; value?: unknown }, next: () => Promise<unknown>) => {
      const out = await next()
      try {
        if (exec.name === 'exit_plan_mode' && !result?.isError && (result?.value as { approved?: boolean } | undefined)?.approved === true) {
          const plan = String((exec.arguments as { plan?: unknown } | undefined)?.plan ?? '')
          if (plan.trim()) void landfill.archivePlan(exec.agent?.session?.id, plan).then((w) => { if (w) log?.info('落盘项目：计划已归档 ' + String(w.key) + ' ' + String(w.file)) }, (e) => log?.warn('落盘项目：计划归档失败', e))
        }
      } catch (e) { log?.warn('落盘项目：计划归档失败', e) }
      return out
    }) as never)

    // 收尾检查：要求的事没做 / 注入没读完 → 拉回（每轮最多 2 次；规划模式、连续被忽略时不拉）
    ctx.on('agent/turn-stopping' as never, ((p: { agent?: Agent }) => {
      try {
        const sid = p.agent?.session?.id
        if (!sid || !p.agent || typeof p.agent.steer !== 'function') return
        const text = landfill.nudge(sid, planActive(p.agent)) ?? merges.nudge(sid)
        if (!text) return
        log?.info('落盘项目：本轮要求没完成，拉回（会话 ' + sid.slice(0, 20) + '）')
        p.agent.steer(msg(text, 'landfill-stop'))
      } catch (e) { log?.warn('落盘项目：收尾检查失败', e) }
    }) as never)

    // /landfill /recall：把请求作为用户消息送进当前会话（走同一套识别）
    ctx.inject(['commands'], (h) => {
      const reg = (h as HostCtx).commands!
      const mk = (name: string, verb: string, hint: string, desc: string): (() => void) => reg.register({
        name, description: desc, input: { hint },
        handler: ({ rawInput, agent }) => {
          const arg = rawInput.trim()
          if (!agent || typeof agent.steer !== 'function') return { kind: 'error', text: '/' + name + ' 只能在会话里用' }
          const sid = agent.session?.id
          const card = sid ? M.cardOfSession(store.get(), sid) : undefined
          const target = arg || (card ? M.memoryOf(store.get(), card).map((m) => m.key.split('/')[1]).join('、') : '')
          if (!target && verb === '回忆') return { kind: 'error', text: '用法：/recall <项目名>（这个会话没有关联卡片，不知道回忆哪个）' }
          const text = verb + ' ' + (target || '当前项目')
          agent.steer({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
          return { kind: 'success', text }
        },
      })
      const a = mk('landfill', '落盘项目', '[项目名]', 'persist this session into the landfill-project STATE (default: the card\'s project)')
      const b = mk('recall', '回忆', '[项目名]', 'recall a landfill-project STATE and continue from its next_action')
      return () => { a(); b() }
    })
  }

  if (landfill.status.ok) ctx.inject(['systemPrompt'], (h) => (h as HostCtx).systemPrompt.context({ name: 'dsh-project-manager:landfill', order: 129, text: () => RULES }))

  ctx.inject(['systemPrompt'], (h) => (h as HostCtx).systemPrompt.context({
    name: 'dsh-project-manager:memory',
    order: 130,
    // 0.18 单段：卡片档案（实时）+ 记忆索引（当前版本）；全文由 pre-step 注入
    text: (c) => { const id = c.agent?.session.id; return id ? memoryFor(id) : '' },
  }))

  log?.info('ready', ROUTE_PREFIX, 'data=' + dataDir, 'hub=' + hubDir(dataDir))
}