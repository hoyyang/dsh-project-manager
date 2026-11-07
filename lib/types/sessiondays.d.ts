export interface SessionQueryLike {
    listEvents(sessionId: string): Promise<Array<{
        type?: string;
        time?: number;
        surface?: string;
    }>>;
}
export interface DaysResult {
    days: Record<string, string[]>;
    degraded: string[];
}
/** 会话版本：变了才重扫。拿不到（undefined）→ 退回 TTL。 */
export type VersionOf = (sessionId: string) => string | undefined;
/** 最近一轮后台统计的实况（诊断用：读了几条、命中几条缓存、花了多久）。 */
export interface WarmStats {
    at: number;
    read: number;
    cached: number;
    ms: number;
}
export declare class SessionDaysCache {
    private readonly query;
    private readonly ttlMs;
    private readonly limit;
    private readonly callMs;
    private readonly budgetMs;
    private map;
    private last;
    /**
     * 并发上限 + 单次调用超时 + 整体预算：主实例可能有一百多个会话，某个会话的查询卡住不能拖死整页
     * （2026-10-22 主实例实测：无上限时 /gantt 一直不返回，页面空着）。
     * v90：并发 8 → 2，并且每读完一条让出一次事件循环 —— 统计期间宿主要还能立刻响应
     * 「列出会话 / 载入历史」（实测列表接口从 0.7ms 涨到 607ms 就是并发太高把循环占满了）。
     */
    constructor(query: () => SessionQueryLike | undefined, ttlMs?: number, limit?: number, callMs?: number, budgetMs?: number);
    /** 最近一轮统计实况（没跑过 = null）。 */
    stats(): WarmStats | null;
    private fresh;
    /** 只拿缓存（新鲜的），绝不等待会话查询：首帧就靠它，慢查询放后台补。 */
    peek(sessionIds: string[], verOf?: VersionOf): DaysResult;
    /** 同一批会话只跑一轮后台统计，避免 5 秒轮询叠加。 */
    private inflight;
    warm(sessionIds: string[], verOf?: VersionOf): void;
    collect(sessionIds: string[], verOf?: VersionOf): Promise<DaysResult>;
    /** 有新的对话记录时（session/event）可以点名失效，让下一次轮询立刻反映当天。 */
    invalidate(sessionId?: string): void;
    /** 只留还绑着的会话，防止 map 永久增长。 */
    prune(alive: ReadonlySet<string>): void;
}
