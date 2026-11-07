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
    /** v145（1.2）：title = 会话名（任务 / 子任务入口传它的标题；卡片入口不传 = 卡片标题）。 */
    bindSession(sessionId: string, cardId: string, tree: boolean, title?: string): Promise<{
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
    /** 0.27 没关联卡片的会话：在项目区某个卡片组子工作区里 → 返回组（「创建会话卡片」用）。 */
    freeSession?(sessionId: string, cwdHint: string): Json | null;
    /** 0.27 在访达中显示文件 / 打开文件夹（macOS open）。 */
    reveal?(path: string, folder: boolean): Promise<void>;
    repoTerminal?(path: string): Promise<void>;
    /** v99 点文件标题 = 用系统默认应用打开这个文件（和访达里双击一样）；只认这张卡片登记过的文件。 */
    /** v144（3）：dry = 只解析出路径（给右侧栏打开），不调系统默认应用。 */
    fileOpen?(cardId: string, fileId: string, path?: string, name?: string, dry?: boolean): Promise<Json | void>;
    /** 0.27 创建卡片并关联本会话。 */
    createForSession?(sessionId: string, groupId: string, title: string, col: string, cwdHint: string): Promise<Json>;
    /** 0.19「AI 收到的原文」：系统提示原文 + 注入的全文。 */
    sessionRaw?(sessionId: string): Json;
    /** v93/v94：某个会话里用户自己发过的消息（从新到旧；before / limit 翻页，添加任务弹窗「从历史消息选择」用）。 */
    sessionMessages?(sessionId: string, o: {
        before?: number;
        limit?: number;
    }): Promise<Json>;
    /** v96：用这个会话的模型把任务说明总结成标题（最低思考等级；拿不到 route / llm 时点名失败）。 */
    goalTitle?(sessionId: string, text: string, route?: {
        provider?: unknown;
        model?: unknown;
        effort?: unknown;
    }): Promise<Json>;
    /** v129/v130：生成标题可选的模型目录（dsh 已配置的 provider × 模型 × 推理档，隐藏 kiro）。 */
    titleModels?(): Promise<Json>;
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
    /** 0.26 把卡片的相关文件复制进落盘项目 evidence/（del = 校验一致后把原文件移到废纸篓）；撤销 = 改回原路径并放回。 */
    filesToLf?(cardId: string, fileIds: string[], key: string, del: boolean, opts?: {
        allowLarge?: boolean;
        pathOnly?: boolean;
    }): Promise<Json>;
    filesUndoLf?(cardId: string, items: Array<{
        id: string;
        from: string;
        trashed?: string;
    }>): Promise<Json>;
    fileTrash?(cardId: string, fileId: string): Promise<Json>;
    fileTrashMany?(cardId: string, ids: unknown): Promise<Json>;
    /** v138：会话输入框里 ⌘ 点击识别出的路径（不要求登记在卡片上）：文件夹 = 访达；文件 = 默认应用（可执行文件只在访达里选中，不运行）。 */
    openLocal?(path: string, dry?: boolean): Promise<Json>;
    fileUntrash?(cardId: string, file: unknown, index: unknown, tasks: unknown, trashed: string): Promise<Json>;
    /** 0.31 任务日程看板：派生快照（计划 / 实际 / 截止 / 三条边的宽度）与变更。 */
    gantt?: {
        /** warm = 起一轮后台会话统计（只有日程页传 true）。 */
        data(warm?: boolean): Promise<Json>;
        /** v90：只回 ui + 统计实况，不构建甘特数据、不起统计（打开卡片详情用）。 */
        meta(): Json;
        run(key: string, body: Json): Promise<Json>;
    };
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
/** 0.27 卡片仓库路径是否还在（详情里「路径不存在」+ 访达按钮）。 */
export declare function repoStatus(b: Board): Record<string, boolean>;
/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 文件状态 + 最近事件。 */
export declare function snapshot(s: Services, rev: string): Json;
/** 0.15 粘贴路径检测：逐行规整 + 判断存在 / 是文件夹 / 已关联 / 本批重复 / 非绝对路径。只读，不写盘。 */
export type PathCheck = {
    raw: string;
    path: string;
    status: 'ok' | 'dir' | 'missing' | 'linked' | 'dup' | 'bad';
};
export declare function checkPaths(raws: unknown, linked: readonly string[], home: string, stat: (p: string) => 'file' | 'dir' | null): PathCheck[];
/**
 * v138/v139 会话输入框的路径识别：一次批量查「存在吗 + 文件还是文件夹」。只回存在的那些（不存在 = 不在结果里）。
 * ~/ 展开成 home；只收绝对路径；最多 400 条、每条 ≤ 1024 字（超出的忽略，不报错打扰输入）。
 */
/** v138：⌘ 点击打开时不直接运行的文件（可执行位 / 脚本 / 安装包 / app）→ 只在访达里选中。 */
export declare const RUN_EXT: RegExp;
export declare function openMode(path: string, kind: 'file' | 'dir', mode: number): 'open' | 'reveal';
export declare function statBatch(raws: unknown, home: string, stat: (p: string) => 'file' | 'dir' | null): Record<string, 'file' | 'dir'>;
/**
 * v142（4.2）：会话输入框里「原位置已不在」的文件 → 在常用目录里按文件名找同名文件（广度优先、跳过隐藏目录 / node_modules，
 * 最多扫 depth 层、visit 个目录，最多返回 max 个）。ponytail: 线性扫描有上限（8000 个目录），找不到就说找不到，不建索引。
 * v154（1.4）：名字只差空格 / 连字符也算（搬家把空格净化成连字符就靠这一条），一字不差的排在前面。
 */
export declare function findSameName(name: string, roots: string[], o?: {
    depth?: number;
    visit?: number;
    max?: number;
    skip?: string;
}, ls?: (d: string) => Array<{
    name: string;
    dir: boolean;
}>): string[];
export declare function mountRoutes(webServer: {
    register(r: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, s: Services, boardRev: () => number): () => void;
export {};
