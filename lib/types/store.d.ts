import { Board, BoardEvent } from './model.js';
export declare class BoardStore {
    readonly dataDir: string;
    private board;
    private chain;
    private listeners;
    readonly boardPath: string;
    readonly eventsPath: string;
    constructor(dataDir: string);
    /** 0.26 升级前的备份路径（没升级 = 空）。 */
    backup: string;
    /** v154：启动修复引用原文的结果（没跑 = null）。 */
    repair: {
        changed: number;
        cards: number;
    } | null;
    /** v154：启动修复写盘前的备份路径（没改 = 空）。 */
    repairBackup: string;
    /** ponytail: 只在升级时整读一次审计日志（几 MB 以内）；更大时改成流式逐行读 */
    private allEvents;
    private write;
    get(): Board;
    subscribe(fn: (b: Board) => void): () => void;
    /** 在串行链上执行一次变更：fn 修改工作副本并返回结果；抛错则丢弃副本、不落盘。 */
    mutate<T>(fn: (b: Board) => T, events?: (r: T) => BoardEvent[]): Promise<T>;
    eventsTail(n: number): BoardEvent[];
}
