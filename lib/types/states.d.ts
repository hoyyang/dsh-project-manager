export interface StateInfo {
    key: string;
    project: string;
    slug: string;
    path: string;
    status: string;
    next: string;
    updated: string;
    error?: string;
}
export declare function parseState(text: string): {
    status: string;
    next: string;
};
export declare class StateCatalog {
    private readonly aiRoot;
    private readonly ttlMs;
    private cache;
    constructor(aiRoot: string, ttlMs?: number);
    list(): StateInfo[];
    /** 按 key 直接读单个 STATE（记忆注入每步调用，不能每次全量扫描）。 */
    get(key: string): StateInfo | undefined;
    private one;
    invalidate(): void;
    /** 目录签名（条目数 + 最新更新日 + 各 status/next 长度和）：STATE 变化时前端轮询能察觉。 */
    signature(): string;
}
