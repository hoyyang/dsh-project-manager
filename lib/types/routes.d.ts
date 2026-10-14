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
    /** 0.16 落盘项目环境（看板顶部提示 / 接管按钮用）。 */
    landfill(): import('./landfill.js').LandfillStatus & {
        toolOutdated?: boolean;
    };
    /** 0.16：把 ~/.agents 下已有的 SKILL.md 备份后换成指向插件的链接。 */
    adoptSkill(): {
        backup: string;
    };
    /** 0.18 用户点「升级 ai-memory」：先备份再替换。 */
    upgradeTool(): {
        backup: string;
        version: number;
    };
    /** 弹系统选文件框（可多选）；取消返回 null；不支持的平台抛 BoardError('PICK_UNAVAILABLE')。 */
    pickFiles(): Promise<string[] | null>;
    /** 0.15：慢请求日志（超过阈值时记每一步耗时）。 */
    warn?(msg: string): void;
    /** 0.19 会话信息卡：卡片资料明细 + 落盘项目明细 + 合并卡片。 */
    sessionExtra?(sessionId: string): Json;
    /** 0.19「AI 收到的原文」：系统提示原文 + 注入的全文。 */
    sessionRaw?(sessionId: string): Json;
    /** 0.19 合并：预览 / 开始 / 取消 / 撤销 / 删除合并前的。 */
    merge?: {
        preview(sessionId: string, keys: string[], name: string): Json;
        start(sessionId: string, keys: string[], name: string): Promise<Json>;
        cancel(id: string): Promise<void>;
        undo(id: string): Promise<Json>;
        purge(id: string): Promise<Json>;
    };
    /** 0.20 同名检测。 */
    lfMatch?(sessionId: string, q: string): Json;
    /** 0.20 把已有落盘项目关联到会话的卡片。 */
    lfLink?(sessionId: string, key: string): Promise<Json>;
    /** 0.20 信息卡发出落盘指令后登记 / 用户点「忽略」。 */
    lfRunStart?(sessionId: string, key: string, label: string): unknown;
    lfRunDismiss?(sessionId: string): void;
    /** 0.20 设卡片组的落盘文件夹（并在 ~/.ai 登记）。 */
    setFolder?(sessionId: string, value: string): Promise<Json>;
    migUndo?(id: string): Promise<Json>;
    migPurge?(id: string): Promise<Json>;
}
type Json = Record<string, unknown>;
/**
 * 写操作：带 Origin 时必须与 Host 一致（挡浏览器跨站请求——浏览器发 POST 一定带 Origin）。
 * 没有 Origin 放行：DSH Desktop 壳转发请求时会删掉 Origin（issue #2），脚本 / 同进程工具也不带；
 * 能到这里的请求已经过了「仅本机回环 + Host 是 127.0.0.1 / localhost」那道门。与 dsh-manage-sessions 同一口径。
 */
export declare function sameOrigin(req: Pick<IncomingMessage, 'headers'>): boolean;
/** 所有卡片相关文件的存在状态（路径 → 是否存在）。ponytail: 每次轮询逐个 stat，文件上千时再改成按需检查。 */
export declare function fileStatus(b: Board): Record<string, boolean>;
/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 文件状态 + 最近事件。 */
export declare function snapshot(s: Services, rev: string): Json;
/** 0.15 粘贴路径检测：逐行规整 + 判断存在 / 是文件夹 / 已关联 / 本批重复 / 非绝对路径。只读，不写盘。 */
export type PathCheck = {
    raw: string;
    path: string;
    status: 'ok' | 'dir' | 'missing' | 'linked' | 'dup' | 'bad';
};
export declare function checkPaths(raws: unknown, linked: readonly string[], home: string, stat: (p: string) => 'file' | 'dir' | null): PathCheck[];
export declare function mountRoutes(webServer: {
    register(r: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, s: Services, boardRev: () => number): () => void;
export {};
