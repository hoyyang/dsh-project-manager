/**
 * 0.31：会话「按天活跃」索引 —— 实际条「会话自动」的唯一来源。
 *
 * 口径：某一天（本地日，00:00–24:00）这个会话里有任意对话事件（user/assistant/developer/system 消息，
 * 或 tool/call、tool/result），就算这一天有执行。
 *
 * 0.38（v90）：按「会话版本」缓存 —— 主实例 178 个会话 / 322MB 压缩日志，绝大多数一天里没有新事件，
 * 旧代码按 45 秒 TTL 全量重解一遍（每轮 6 秒、把宿主事件循环占满 → 切会话载入历史变慢）。
 * 现在只有版本变了的会话才重读：live 会话用内存事件条数、落盘的用日志文件 mtime+size；
 * 拿不到版本（未落盘 / 布局变了）才退回 TTL，绝不因为拿不到版本就漏数据。
 * 会话查询（ctx.sessionQuery）不是本插件的硬依赖：没挂时返回空 + 一条 degraded 说明（界面上点名，不静默）。
 */
import { ymd } from './gantt.js'

export interface SessionQueryLike {
  listEvents(sessionId: string): Promise<Array<{ type?: string; time?: number; surface?: string }>>
}

const MSG = new Set(['user/message', 'assistant/message', 'developer/message', 'system/message', 'tool/call', 'tool/result'])

export interface DaysResult { days: Record<string, string[]>; degraded: string[] }
/** 会话版本：变了才重扫。拿不到（undefined）→ 退回 TTL。 */
export type VersionOf = (sessionId: string) => string | undefined
/** 最近一轮后台统计的实况（诊断用：读了几条、命中几条缓存、花了多久）。 */
export interface WarmStats { at: number; read: number; cached: number; ms: number }

export class SessionDaysCache {
  private map = new Map<string, { days: string[]; at: number; ver?: string; error?: string }>()
  private last: WarmStats | null = null
  /**
   * 并发上限 + 单次调用超时 + 整体预算：主实例可能有一百多个会话，某个会话的查询卡住不能拖死整页
   * （2026-10-22 主实例实测：无上限时 /gantt 一直不返回，页面空着）。
   * v90：并发 8 → 2，并且每读完一条让出一次事件循环 —— 统计期间宿主要还能立刻响应
   * 「列出会话 / 载入历史」（实测列表接口从 0.7ms 涨到 607ms 就是并发太高把循环占满了）。
   */
  constructor(
    private readonly query: () => SessionQueryLike | undefined,
    private readonly ttlMs = 45_000,
    private readonly limit = 2,
    private readonly callMs = 2_500,
    private readonly budgetMs = 6_000,
  ) {}

  /** 最近一轮统计实况（没跑过 = null）。 */
  stats(): WarmStats | null { return this.last }

  private fresh(hit: { at: number; ver?: string } | undefined, ver: string | undefined): boolean {
    if (!hit) return false
    if (ver !== undefined && hit.ver !== undefined) return hit.ver === ver
    return Date.now() - hit.at < this.ttlMs
  }

  /** 只拿缓存（新鲜的），绝不等待会话查询：首帧就靠它，慢查询放后台补。 */
  peek(sessionIds: string[], verOf?: VersionOf): DaysResult {
    const q = this.query()
    if (!q) return { days: {}, degraded: ['当前 dsh 没有挂会话查询（ctx.sessionQuery），实际条只能手动记录'] }
    const out: Record<string, string[]> = {}
    const degraded: string[] = []
    let pending = 0
    for (const id of new Set(sessionIds.filter((x) => typeof x === 'string' && x !== ''))) {
      const hit = this.map.get(id)
      const ver = verOf?.(id)
      if (hit && this.fresh(hit, ver)) {
        if (hit.error) degraded.push(id.slice(0, 14) + '…：' + hit.error)
        out[id] = hit.days
      } else { pending++; out[id] = [] }
    }
    if (pending) degraded.push('会话自动执行日正在统计（' + pending + ' 个会话），画好计划条后自动补上')
    return { days: out, degraded: degraded.slice(0, 8) }
  }

  /** 同一批会话只跑一轮后台统计，避免 5 秒轮询叠加。 */
  private inflight: Promise<DaysResult> | null = null
  warm(sessionIds: string[], verOf?: VersionOf): void {
    if (this.inflight) return
    this.inflight = this.collect(sessionIds, verOf).finally(() => { this.inflight = null }) as Promise<DaysResult>
    void this.inflight.catch(() => undefined)
  }

  async collect(sessionIds: string[], verOf?: VersionOf): Promise<DaysResult> {
    const q = this.query()
    const uniq = [...new Set(sessionIds.filter((x) => typeof x === 'string' && x !== ''))]
    if (!q) {
      return { days: {}, degraded: ['当前 dsh 没有挂会话查询（ctx.sessionQuery），实际条只能手动记录'] }
    }
    const out: Record<string, string[]> = {}
    const degraded: string[] = []
    const started = Date.now()
    let read = 0
    let cached = 0
    const todo: Array<{ id: string; ver?: string }> = []
    for (const id of uniq) {
      const hit = this.map.get(id)
      const ver = verOf?.(id)
      if (hit && this.fresh(hit, ver)) {
        if (hit.error) degraded.push(id.slice(0, 14) + '…：' + hit.error)
        out[id] = hit.days
        cached++
      } else todo.push({ id, ver })
    }
    const one = async (id: string, ver: string | undefined): Promise<void> => {
      if (Date.now() - started > this.budgetMs) {
        /* 预算用完：这一次先给空（不写缓存），页面立刻能画；下一次轮询继续补 */
        out[id] = []
        degraded.push(id.slice(0, 14) + '…：会话查询超时（>' + Math.round(this.budgetMs / 1000) + 's），实际条稍后自动重试')
        return
      }
      try {
        const evs = await Promise.race([
          q.listEvents(id),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('会话查询超时（>' + Math.round(this.callMs / 1000) + 's）')), this.callMs)),
        ])
        const days = [...new Set(evs.filter((e) => e && typeof e.time === 'number' && MSG.has(String(e.type))).map((e) => ymd(e.time as number)))].sort()
        this.map.set(id, { days, at: Date.now(), ver })
        out[id] = days
        read++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.map.set(id, { days: [], at: Date.now(), ver, error: msg })
        degraded.push(id.slice(0, 14) + '…：' + msg)
        out[id] = []
        read++
      }
      /* 每读完一条让出事件循环：统计期间宿主仍要立刻响应用户操作（切会话 / 载入历史 / 列表接口）。 */
      await new Promise<void>((r) => setTimeout(r, 0))
    }
    let i = 0
    const worker = async (): Promise<void> => { while (i < todo.length) { const t = todo[i++] as { id: string; ver?: string }; await one(t.id, t.ver) } }
    await Promise.all(Array.from({ length: Math.min(this.limit, todo.length) }, worker))
    this.last = { at: Date.now(), read, cached, ms: Date.now() - started }
    return { days: out, degraded: [...new Set(degraded)].slice(0, 8) }
  }

  /** 有新的对话记录时（session/event）可以点名失效，让下一次轮询立刻反映当天。 */
  invalidate(sessionId?: string): void { if (sessionId) this.map.delete(sessionId); else this.map.clear() }

  /** 只留还绑着的会话，防止 map 永久增长。 */
  prune(alive: ReadonlySet<string>): void { for (const k of this.map.keys()) if (!alive.has(k)) this.map.delete(k) }
}
