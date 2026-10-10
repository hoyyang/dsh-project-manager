/**
 * HTTP 面：/_dsh/dsh-project-manager/ 前缀。仅 loopback；变更类 POST 需同源；JSON 体上限 64KB。
 * 错误统一 {ok:false,error:{code,message}}，点名失败对象（fail loud）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Board } from './model.js';
import type { BoardStore } from './store.js';
import type { StateCatalog } from './states.js';
export declare const ROUTE_PREFIX = "/_dsh/dsh-project-manager";
export interface Services {
    store: BoardStore;
    states: StateCatalog;
    /** groups = 卡片组 id → 它的子工作区 id（侧栏按 data-row-key 找组行用）。 */
    hub(): {
        workspaceId: string | null;
        path: string;
        title: string;
        groups: Record<string, string>;
    };
    prepareSession(cardId: string): Promise<{
        workspaceId: string;
        workspaceTitle: string;
    }>;
    /** tree = 用户当前是「按工作区树」分组：会话名只用卡片名。 */
    bindSession(sessionId: string, cardId: string, tree: boolean): Promise<{
        title: string | null;
        permission: boolean;
    }>;
    cleanup(): Promise<{
        removedWorkspace: boolean;
        removedGroupWorkspaces: number;
    }>;
    linkSessions(cardId: string, items: Array<{
        sessionId: string;
        title?: string;
    }>): Promise<{
        linked: number;
        moved: number;
    }>;
    unlinkSession(sessionId: string): Promise<{
        cardId: string;
    }>;
    unarchiveSession(sessionId: string): Promise<{
        restored: boolean;
    }>;
    canUnarchive(): boolean;
    /** 弹系统选文件框（可多选）；取消返回 null；不支持的平台抛 BoardError('PICK_UNAVAILABLE')。 */
    pickFiles(): Promise<string[] | null>;
}
type Json = Record<string, unknown>;
/** 所有卡片相关文件的存在状态（路径 → 是否存在）。ponytail: 每次轮询逐个 stat，文件上千时再改成按需检查。 */
export declare function fileStatus(b: Board): Record<string, boolean>;
/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 文件状态 + 最近事件。 */
export declare function snapshot(s: Services, rev: string): Json;
export declare function mountRoutes(webServer: {
    register(r: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, s: Services, boardRev: () => number): () => void;
export {};
