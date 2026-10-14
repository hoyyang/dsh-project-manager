export interface StateInfo {
    key: string;
    project: string;
    slug: string;
    path: string;
    status: string;
    next: string;
    updated: string;
    /** 0.19 合并前的名字（STATE 里的 aliases: 行）：说这些名字也会回忆 / 落盘这个项目。 */
    aliases?: string[];
    error?: string;
}
export declare function parseState(text: string): {
    status: string;
    next: string;
    aliases?: string[];
};
export declare class StateCatalog {
    private readonly aiRoot;
    private readonly ttlMs;
    private cache;
    constructor(aiRoot: string, ttlMs?: number);
    list(): StateInfo[];
    /** 按 key 直接读单个 STATE（记忆注入每步调用）。0.18：按 mtime + 大小判断是否变了，变了立刻重读（注入永远是磁盘上的最新版）。 */
    get(key: string): StateInfo | undefined;
    private one;
    invalidate(): void;
    /** 目录签名（条目数 + 最新更新日 + 各 status/next 长度和）：STATE 变化时前端轮询能察觉。 */
    signature(): string;
}
