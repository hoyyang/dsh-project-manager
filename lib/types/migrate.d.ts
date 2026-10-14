import { type Landfill } from './landfill.js';
import { type BoardPort } from './merge.js';
import type { StateCatalog } from './states.js';
export interface MigRec {
    id: string;
    from: string;
    to: string;
    at: string;
    dir: string;
    retired: string;
    links: {
        cards: Array<{
            id: string;
            before: string[];
        }>;
        groups: Array<{
            id: string;
            before: string[];
        }>;
    };
    refs: Array<{
        file: string;
        rel: string;
        scope: string;
        afterHash: string;
        backup: string;
    }>;
    refsFailed: Array<{
        file: string;
        error: string;
    }>;
    files: number;
}
export interface MigDeps {
    aiRoot: string;
    dataDir: string;
    lf: Landfill;
    states: StateCatalog;
    board: BoardPort;
    log?: {
        info(...a: unknown[]): void;
        warn(...a: unknown[]): void;
    };
}
export declare class MigrateEngine {
    private readonly d;
    private recs;
    /** 用户撤销过迁移的落盘项目：留在原处，之后落盘不再自动迁。 */
    private stays;
    private chain;
    private readonly file;
    constructor(d: MigDeps);
    private save;
    private serial;
    stay(key: string): boolean;
    /** 这个 key 最近一次迁移进来的记录（还能撤销 / 删除旧文件夹）。 */
    recOf(key: string): MigRec | undefined;
    get(id: string): MigRec;
    undoWhy(r: MigRec): string | null;
    private ai;
    /**
     * 搬家：from（<project>/<slug>）→ toProject/<slug>。返回新 key 和改写函数（把文本里指向旧文件夹的路径换成新的）。
     * sid：本会话已读全的旧版本，搬过去后记为已读（内容只是路径被机械改写）。
     */
    private move;
    /** 落盘时自动迁移（persist 调用）。 */
    migrate(sid: string | undefined, from: string, toProject: string): Promise<{
        key: string;
        rewrite(t: string): string;
        rec: MigRec;
    }>;
    /** 撤销：搬回原处（带上迁移后又落盘的内容），之后不再自动迁；外部引用由反向搬家一起改回。 */
    undo(id: string): Promise<Record<string, unknown>>;
    /** 删除迁移前的旧文件夹（回收区里那份）。 */
    purge(id: string): Promise<Record<string, unknown>>;
}
