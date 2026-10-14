/**
 * dsh-project-manager — host 入口（hybrid：看板数据 + HTTP 面 + 4 工具 + 项目区工作区 + 会话记忆注入）。
 * 生命周期：apply 只登记 inject 回调，无 module 级副作用；每个贡献（路由/工具/监听/上下文）都在 dispose 中撤销。
 * 卸载不删用户数据（board.json/hub/会话），「项目区」及卡片组子工作区条目由界面「卸载前清理」或 POST hub/cleanup 撤销。
 * 0.9：每个卡片组 = 「项目区」下的子工作区（hub/groups/<组 id>/，标题 = 组名）；dsh「按工作区树」分组下自然嵌套。
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as M from './model.js'
import { BoardStore } from './store.js'
import { StateCatalog } from './states.js'
import { groupDir, hubDir, syncHub } from './hub.js'
import { cardBlock, maskBlock, memoryText } from './memory.js'
import { isPointer, MergeEngine, type MergeRec } from './merge.js'
import { MigrateEngine } from './migrate.js'
import { matchStates, specHint, specIssues, suggestFolder, type SpecCtx } from './lfspec.js'
import { mountRoutes, ROUTE_PREFIX } from './routes.js'
import { registerTools, registerLandfillTool } from './tools.js'
import { detectIntent, guardReason, intentHint, Landfill, listDocs, PLAN_HINT, SKILL_NAME, skillFile } from './landfill.js'

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
    cardBlock: (key) => cardBlock(store.get(), key, new Date().toISOString(), store.boardPath),
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
    cardBlock: (key) => cardBlock(store.get(), key, new Date().toISOString(), store.boardPath),
    log,
  })
  const MERGE_RE = /^\s*合并落盘项目（dsh-project-manager 合并 (mg[a-z0-9]+)）/
  /** 系统提示里本卡片那一段（「AI 收到的原文」浮层与 systemPrompt.context 用同一个函数）。 */
  const memoryFor = (sid: string): string => {
    const b = store.get()
    const card = M.cardOfSession(b, sid)
    if (!card) return ''
    const index = M.memoryOf(b, card).map((m) => ({ ...m, state: states.get(m.key), ...(landfill.status.ok ? { required: landfill.brief(m.key).required, full: true } : {}) }))
    return memoryText(b, card, index, config.memoryMaxBytes)
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
      cardInfo: { id: c.id, stage: g.statuses.find((s) => s.id === c.col)?.name ?? '', archived: !!c.archivedAt, repos: c.repos ?? [], tasks: c.tasks, notes: c.notes ?? '', links: c.webLinks ?? [], files: (c.files ?? []).map((p) => ({ path: p, exists: existsSync(p) })) },
      memDetail: mem,
      merging: run ? { id: run.id, key: run.key, srcs: run.srcs.map((s) => s.key), ...merges.progress(run) } : null,
      mergeTool: { ok: landfill.status.ok && landfill.status.toolVersion >= 3, version: landfill.status.toolVersion },
    }
  }
  /** 文件夹里除 STATE.md 外的文件数。 */
  const require0 = (statePath: string): number => { try { return listDocs(dirname(statePath), 2000).files.length } catch { return 0 } }
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
        files.push({ key: m.key, file: rel, version: fi.hash.slice(0, 8), chars: text.length, inContext: landfill.inContext(sid, p), text: shown.slice(0, CAP), ...(shown.length > CAP ? { truncated: shown.length - CAP } : {}) })
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
  const applyToSession = (s: Session, cardId: string, tree: boolean): { title: string | null; permission: boolean } => {
    const b = store.get()
    const c = M.card(b, cardId)
    const g = M.group(b, c.g)
    let permission = false
    if (config.projectSessionMode === 'danger-full-access') { ctx.permissionPresets.set(s, 'danger-full-access'); permission = true }
    const title = tree ? c.t : g.name + ' · ' + c.t
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
      bindSession: async (sessionId, cardId, tree) => {
        const s = ctx.sessions.get(sessionId)
        if (!s) throw new M.BoardError('NO_SESSION', '会话不在运行中：' + sessionId)
        let cwd = s.header.cwd ?? ''
        try { cwd = realpathSync(cwd) } catch { /* 按原值比较 */ }
        if (!projectCwd(cwd)) throw new M.BoardError('NOT_HUB_SESSION', '会话不在「' + config.hubTitle + '」或它的卡片组子工作区里，拒绝绑定：' + sessionId)
        const r = applyToSession(s, cardId, tree)
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
      landfill: () => landfill.snapshot(),
      adoptSkill: () => landfill.adopt(),
      upgradeTool: () => landfill.upgradeTool(),
      warn: (m) => log?.warn(m),
      sessionExtra,
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