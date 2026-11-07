/**
 * v93（0.42）：「添加卡片任务」弹窗「从历史消息选择」的数据整形（纯函数，可单测）。
 * 只认真实用户输入：user/message 且 source.kind='user'；/goal 这类命令另存为 command/run(name='goal')，
 * 正文落在 args 里（气泡上显示的就是「/goal + args」）。系统提示注入 / AGENTS.md / 技能目录 / 运行时上下文
 * 各有自己的 source.kind，天然被过滤掉。
 *
 * v94（0.43）：不再截断成「只列最近 400 条」，改成按 200 条一页往前翻（详情里还能选别的活跃会话）：
 * historyPage 返回这一页 + 总数 + 是否还有更早的，界面用「加载更早的消息（共 N 条，已加载 M 条）」翻到最早一条。
 * v94 补口（实测 2026-10-24 本机会话日志）：回合进行中发来的用户消息（排队 / 插话）只落
 * `agent/inbox/spliced` 事件（inserted[].source.kind='user'，与 user/message 共享同一 rpcId），
 * 消费时不补写 `user/message` —— historyRow 认不到，这类消息就进不了「从历史消息选择」。
 * historyRows 按整条事件流整形：spliced 的用户条目也算数；同一 rpcId 之后（或之前）出现正式
 * user/message 时以正式那条为准（seq / 时间用消费序），幂等去重不会出两条。
 */
export interface HistoryMsg {
    seq: number;
    at: string;
    text: string;
}
/** 一页多少条（v94 设计：200 条 / 页；上限 400 防止一次拉爆内存）。 */
export declare const HISTORY_PAGE = 200;
export declare const HISTORY_PAGE_MAX = 400;
interface Ev {
    type?: string;
    seq?: number;
    time?: number | string;
    data?: Record<string, unknown>;
}
/** user/message 的正文：只取 text 块，多块换行拼接。 */
export declare function messageText(data: Record<string, unknown>): string;
/** 事件时间 → ISO 字符串（拿不到就给空串，界面显示为空）。 */
export declare function eventAt(t: unknown): string;
/** 一条事件 → 一条历史消息；不是用户自己发的 / 空正文 → null。
 * v94 补口：`agent/inbox/spliced` 里 inserted 的用户条目（回合进行中排队 / 插话，消费时不补写
 * user/message）也出一条。单独用它会和正式 user/message 重复计一条 —— 跨事件去重用 historyRows。 */
export declare function historyRow(ev: Ev): HistoryMsg | null;
/**
 * 整条事件流 → 历史消息（乱序安全：historyPage 会按 seq 排）。
 * 与逐条 historyRow 的差别在跨事件去重：同一 rpcId 的 spliced 与 user/message 只留一条，
 * 有正式 user/message 就用它的 seq / 时间（spliced 只是占位）。其余事件各自成行。
 */
export declare function historyRows(events: readonly Ev[]): HistoryMsg[];
export interface HistoryPage {
    /** 这一页：从新到旧。 */
    messages: HistoryMsg[];
    /** 这个会话里你发过的全部消息条数（不受分页影响）。 */
    total: number;
    /** 还有更早的消息可以继续翻。 */
    hasMore: boolean;
    /** 下一页的游标（这一页最旧那条的 seq）；没有更早的 = null。 */
    before: number | null;
}
/**
 * 翻页：before = 上一页最旧那条的 seq（只返回 seq < before 的），不给 = 从最新一条开始。
 * 从新到旧、每页 limit（默认 200，夹在 1–400）。
 */
export declare function historyPage(all: readonly HistoryMsg[], o?: {
    before?: number;
    limit?: number;
}): HistoryPage;
export {};
