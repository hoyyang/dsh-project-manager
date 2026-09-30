/**
 * HTTP 面：/_dsh/dsh-project-manager/ 前缀。仅 loopback；变更类 POST 需同源；JSON 体上限 64KB。
 * 错误统一 {ok:false,error:{code,message}}，点名失败对象（fail loud）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BoardStore } from './store.js';
import type { StateCatalog } from './states.js';
export declare const ROUTE_PREFIX = "/_dsh/dsh-project-manager";
export interface Services {
    store: BoardStore;
    states: StateCatalog;
    hub(): {
        workspaceId: string | null;
        path: string;
        title: string;
    };
    prepareSession(cardId: string): Promise<{
        workspaceId: string;
    }>;
    bindSession(sessionId: string, cardId: string): Promise<{
        title: string | null;
        permission: boolean;
    }>;
    cleanup(): Promise<{
        removedWorkspace: boolean;
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
}
type Json = Record<string, unknown>;
/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 最近事件。 */
export declare function snapshot(s: Services, rev: string): Json;
export declare function mountRoutes(webServer: {
    register(r: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, s: Services, boardRev: () => number): () => void;
export {};
