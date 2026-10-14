import { type Landfill } from './landfill.js';
import type { StateCatalog } from './states.js';
export declare const MERGE_TOOL_VERSION = 3;
export interface SrcInfo {
    key: string;
    dir: string;
    state: string;
    files: Array<{
        rel: string;
        hash: string;
        binary: boolean;
        size: number;
    }>;
}
export interface Placed {
    rel: string;
    hash: string;
    from: Array<{
        key: string;
        rel: string;
    }>;
    ext?: string;
    size: number;
}
export interface Layout {
    files: Placed[];
    map: Record<string, Record<string, string>>;
    dropped: Array<{
        key: string;
        rel: string;
    }>;
    copied: Array<{
        path: string;
        rel: string;
        from: string;
    }>;
    missing: Array<{
        path: string;
        from: string;
    }>;
    dirs: number;
}
/** 指针型 STATE：只存指向别处的路径，不存状态。 */
export declare const isPointer: (t: string) => boolean;
/**
 * 文件去向（纯函数）：STATE.md 不算（重写）；*.bak* 不带；已在 notes/ evidence/ plans/ 下的保持原路径，其余文档进 notes/、图片等进 evidence/；
 * 内容相同（sha256）只留一份；同名不同内容放 <区>/<来源 slug>/；STATE 引用的 ~/.ai 外文件（存在、≤50MB）复制进 evidence/，找不到的列出来。
 */
export declare function planLayout(srcs: SrcInfo[], aiRoot: string, reserved?: readonly string[], home?: string, stat?: (p: string) => {
    file: boolean;
    size: number;
} | null, hashFile?: (p: string) => string): Layout;
/** 文本里指向来源文件夹 / 被复制的外部文件的路径 → 改指合并结果。relProject = 这个文件属于哪个项目（MEMORY_INDEX 里的相对写法 designs/<slug>/ 只在同项目里认）。 */
export declare function rewritePaths(text: string, aiRoot: string, target: string, srcs: string[], lay: Pick<Layout, 'map' | 'copied'>, relProject?: string, home?: string): string;
/** STATE 里的别名行：已有就合并，没有就插在标题行后。 */
export declare function withAliases(text: string, aliases: string[]): string;
/** 「⚠ 待核实」节里的条目数。 */
export declare function checkCount(text: string): number;
/** 要改的外部引用文件：~/.ai/memory 下（不含 imported/）与相关项目的 MEMORY_INDEX.md 里提到来源路径的（合并 / 迁移共用）。 */
export declare function refFiles(aiRoot: string, keys: string[], target: string): Array<{
    file: string;
    rel: string;
    project: string | null;
}>;
export interface MSrc {
    key: string;
    mergeId?: string;
    retired?: string;
    kind: 'body' | 'pointer';
    chars: number;
    files: number;
}
export interface MergeRef {
    file: string;
    rel: string;
    scope: string;
    afterHash: string;
}
export interface MergeRec {
    id: string;
    key: string;
    srcs: MSrc[];
    aliases: string[];
    dir: string;
    at: string;
    status: 'running' | 'done';
    sid?: string;
    cardId?: string;
    parent?: string;
    purged?: boolean;
    stateHash?: string;
    files?: Placed[];
    copied?: Layout['copied'];
    missing?: Layout['missing'];
    dropped?: Layout['dropped'];
    links?: {
        cards: Array<{
            id: string;
            before: string[];
        }>;
        groups: Array<{
            id: string;
            before: string[];
        }>;
    };
    refs?: MergeRef[];
    refsFailed?: Array<{
        file: string;
        error: string;
    }>;
    report?: {
        chars: number;
        check: number;
        drop: number;
        files: number;
    };
    pulls?: number;
}
export interface BoardPort {
    get(): {
        groups: Array<{
            id: string;
            links: string[];
        }>;
        cards: Array<{
            id: string;
            g: string;
            links: string[];
            archivedAt?: string;
        }>;
    };
    relink(fn: (b: {
        groups: Array<{
            id: string;
            links: string[];
        }>;
        cards: Array<{
            id: string;
            links: string[];
        }>;
    }) => void): Promise<void>;
}
export interface MergeDeps {
    aiRoot: string;
    dataDir: string;
    lf: Landfill;
    states: StateCatalog;
    board: BoardPort;
    cardBlock(key: string): string;
    log?: {
        info(...a: unknown[]): void;
        warn(...a: unknown[]): void;
    };
}
export declare class MergeEngine {
    private readonly d;
    private recs;
    private chain;
    private readonly file;
    constructor(d: MergeDeps);
    private save;
    private serial;
    list(): readonly MergeRec[];
    get(id: string): MergeRec;
    private retiredOf;
    private draftDir;
    /** 先把指向更早合并掉的落盘项目的路径改成那次的合并结果，再按本次改。 */
    private rw;
    /** 合并结果对应的记录（最新一次、已完成、没撤销）。 */
    resultOf(key: string): MergeRec | undefined;
    /** 这次合并回收区里还剩几个合并前的落盘项目（含更早合并的）。 */
    treeN(r: MergeRec): number;
    private src;
    /** 预览（只读）：选中的落盘项目 + 目标名 → 别名、文件去向、外部引用、校验提示。 */
    /** home = 卡片组的落盘文件夹（0.20：合并结果放这里；没设 = 第一份正文来源所在的项目）。 */
    preview(scopeKeys: string[], keys: string[], name: string, home?: string): Record<string, unknown>;
    private aliasesFor;
    /** 开始：建记录（running），返回发给会话的指令。 */
    start(sid: string, cardId: string, scopeKeys: string[], keys: string[], name: string, home?: string): Promise<{
        id: string;
        prompt: string;
        key: string;
    }>;
    cancel(id: string): Promise<void>;
    runningFor(sid: string): MergeRec | undefined;
    /** AI 读计划：来源、要写的要点文件、文件去向、要进文件索引的文件。 */
    plan(sid: string | undefined, id: string): Record<string, unknown>;
    note(sid: string | undefined, id: string, key: string, content: unknown): Record<string, unknown>;
    /** 进度（会话信息卡显示用）。 */
    progress(r: MergeRec): {
        read: number;
        noted: number;
        total: number;
        step: number;
    };
    private ai;
    private notesText;
    /** 提交：校验 → 来源整个移进回收区 → 文件归位 → 写 STATE → 换关联 → 改外部引用。中途失败按已做的倒着撤回。 */
    commit(sid: string | undefined, id: string, content: unknown, drop?: unknown): Promise<Record<string, unknown>>;
    private refFiles;
    /** 撤销（只退一步）：合并结果在合并后没再被改过、合并前的都还在回收区。 */
    undoWhy(r: MergeRec): string | null;
    undo(id: string): Promise<Record<string, unknown>>;
    private rmEmpty;
    private purgeTree;
    /** 删除合并前的落盘项目（连同更早合并的）；sub = 只删某个合并前的项目自己合并前的（它本身留着）。 */
    purge(id: string): Promise<Record<string, unknown>>;
    /** 会话收到合并指令（用户点了「开始合并」）：拉回次数清零。 */
    arm(sid: string, id: string): void;
    /** 收尾：会话里有进行中的合并、还没提交 → 拉回（每条合并指令最多 2 次）。 */
    nudge(sid: string): string | null;
}
/** 发给会话的合并指令（用户在会话信息卡点了「开始合并」）。 */
export declare function promptOf(r: MergeRec): string;
