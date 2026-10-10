/**
 * 看板领域模型（纯函数，无 IO、无 DSH 依赖）——store 与路由都只经这里改数据，便于单测。
 * 规则来源：设计卡 v2 + 原型 v8（阶段随卡片组、只用来分组；组内排序；组/卡多对多关联落盘项目）。
 * 数据键名沿用 statuses / col（board.json 兼容），界面与文档统一叫「阶段」。
 */
export interface Status {
    id: string;
    name: string;
}
export interface Repo {
    name: string;
    role: string;
    path: string;
}
export interface Group {
    id: string;
    name: string;
    collapsed: boolean;
    repos: Repo[];
    links: string[];
    statuses: Status[];
}
export interface Task {
    text: string;
    done: boolean;
}
/**
 * notes = 相关说明（自由文本）；webLinks = 相关链接（显示文字 + 类型 + 网址，数组顺序 = 展示顺序）；files = 相关文件的绝对路径（只登记，不复制/不删除文件）。
 * 三者都会作为「卡片资料」注入关联会话（0.10）。
 * archivedAt = 归档时间（ISO）；有值 = 已归档：不在看板列里、内容只读，g/col 保留以便恢复回原阶段。三者都可缺省（旧数据兼容）。
 */
export interface WebLink {
    text: string;
    type: string;
    url: string;
}
export interface Card {
    id: string;
    g: string;
    col: string;
    order: number;
    t: string;
    links: string[];
    tasks: Task[];
    notes?: string;
    webLinks?: WebLink[];
    files?: string[];
    archivedAt?: string;
}
/** readKeys = 关联时该会话已读过的落盘项目（不再注入）；只在关联时计算一次，保证注入文本稳定。 */
export interface SessionRef {
    sessionId: string;
    cardId: string;
    createdAt: string;
    title?: string;
    readKeys?: string[];
}
export interface BoardEvent {
    at: string;
    actor: string;
    kind: string;
    card?: string;
    group?: string;
    from?: string;
    to?: string;
}
/** linkTypes = 相关链接的「类型」选项（全局共用）；缺省 = 默认两项。 */
export interface Board {
    version: 1;
    groups: Group[];
    cards: Card[];
    sessions: SessionRef[];
    linkTypes?: string[];
}
export declare class BoardError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare const emptyBoard: () => Board;
export declare const defaultStatuses: () => Status[];
export declare const newId: (prefix: string) => string;
export declare function group(b: Board, id: string): Group;
export declare function card(b: Board, id: string): Card;
/** 要改动内容的卡片：已归档的只读，先恢复活跃。 */
export declare function liveCard(b: Board, id: string): Card;
export declare function status(g: Group, id: string): Status;
/** 同组同阶段内按 order 排序后的活跃卡片（已归档的不占位置）。 */
export declare function cellCards(b: Board, gId: string, col: string): Card[];
/** 归档卡片：移出看板列（其余卡片补位），内容转只读；卡片的会话不动。已归档再归档 = 无操作。 */
export declare function archiveCard(b: Board, id: string, at?: string): Card;
/** 恢复活跃：回到原阶段末尾。原阶段已被删除时放到第一个阶段。 */
export declare function unarchiveCard(b: Board, id: string): Card;
export declare function addGroup(b: Board, name: string): Group;
/** 调整卡片组顺序：把 id 插到 beforeId 之前；beforeId 缺省/null = 放到最后。顺序即 groups 数组顺序。 */
export declare function moveGroup(b: Board, id: string, beforeId?: string | null): void;
export declare function renameGroup(b: Board, id: string, name: string): void;
export declare function removeGroup(b: Board, id: string): void;
/** 校验并替换整组阶段：至少一个，id 唯一，名称非空，仍有卡片的阶段不能被删。 */
export declare function setStatuses(b: Board, gId: string, next: Status[]): void;
export declare function cleanRepos(v: unknown): Repo[];
/**
 * 追加挂载仓库（「添加挂载仓库」弹窗的保存）：逐个校验后一次性追加，任一冲突整批不写。
 * 同一路径不能挂两次；名称不能与本组已有或本批其他项重名（repos/<组>/<名> 软链路径由名称决定）。
 */
export declare function addRepos(b: Board, gId: string, v: unknown, canon?: (p: string) => string): Repo[];
export declare function setGroupLinks(b: Board, gId: string, links: string[]): void;
export declare function addCard(b: Board, gId: string, title: string, links?: string[], col?: string): Card;
export declare function updateCard(b: Board, id: string, patch: {
    t?: string;
    links?: string[];
}): Card;
export declare function removeCard(b: Board, id: string): void;
/**
 * 移动卡片（跨阶段/跨组/组内排序）。beforeId = 插到这张卡之前；缺省 = 放到末尾。
 * 返回事件（供审计写 events.jsonl）。
 */
export declare function moveCard(b: Board, id: string, to: {
    g?: string;
    col: string;
    beforeId?: string | null;
}, actor: string): BoardEvent;
export declare function setTasks(b: Board, id: string, tasks: Task[]): void;
/** 相关说明：原样保存（只统一换行、去掉 NUL）；全是空白 = 清空。不限字数，受 HTTP 体上限约束。 */
export declare function setNotes(b: Board, id: string, text: unknown): Card;
/** 追加相关文件：逐个校验，任一非法整批不写；已关联的跳过。返回实际新增数与跳过数。 */
export declare function addFiles(b: Board, id: string, paths: unknown): {
    added: number;
    skipped: number;
};
/** 解除关联：只从列表移除，不碰文件本身。 */
export declare function removeFile(b: Board, id: string, path: unknown): void;
export declare const DEFAULT_LINK_TYPES: string[];
export declare const linkTypes: (b: Board) => string[];
/** 新增全局「类型」选项（已有则不变）；类型名同名称类字段规则，限 20 字。 */
export declare function addLinkType(b: Board, name: unknown): string;
/** 网址简单校验：只收 http(s)；没写协议但像域名 → 补 https://；不能有空白/控制字符。返回规范化后的网址。 */
export declare function normUrl(v: unknown): string;
/** 相关链接整表替换（新增 / 编辑 / 删除 / 排序都走这里）：逐条校验，任一非法整批不写；没见过的类型自动加入全局选项。 */
export declare function setWebLinks(b: Board, id: string, list: unknown): Card;
/** osascript「choose file」的输出：每行一个 POSIX 路径。 */
export declare function parsePicked(out: string): string[];
/** 会话实际读取的记忆：卡片组关联 ∪ 卡片关联，去重保序，标注来源。 */
export declare function memoryOf(b: Board, c: Card): Array<{
    key: string;
    from: 'group' | 'card' | 'both';
}>;
/** 一个会话只属于一张卡片：重复绑定以最新一次为准。 */
export declare function bindSession(b: Board, sessionId: string, cardId: string, title?: string): void;
/**
 * 手动关联已有会话（批量）：每个会话只属于一张卡片，已在别的卡片上的移过来；
 * readKeys 由调用方按会话记录算好（读过的 STATE 不再注入）。返回从别的卡片移过来的数量。
 */
/**
 * 卡片没有任何记忆（卡片组 ∪ 卡片都没关联）时，找标题里包含其 slug 的落盘项目作为「同名」建议；
 * slug 至少 6 个字符防误配，多个命中取最长的。只做建议，不自动关联。
 */
export declare function sameNameState<T extends {
    key: string;
    slug: string;
}>(b: Board, c: Card, states: readonly T[]): T | null;
export declare function bindMany(b: Board, cardId: string, items: Array<{
    sessionId: string;
    title?: string;
    readKeys?: string[];
}>): {
    linked: number;
    moved: number;
};
/** 解除关联：会话本身不动，只删绑定。 */
export declare function unbindSession(b: Board, sessionId: string): SessionRef;
/**
 * 会话记录里 read 过哪些 STATE.md（直接调用 read 与 run_code 内调用 read 两种事件都算）。
 * paths: key → STATE 绝对路径；返回读过的 key。
 */
export declare function readKeysFromEvents(events: ReadonlyArray<{
    type: string;
    data?: unknown;
}>, paths: ReadonlyMap<string, string>): string[];
export declare function cardOfSession(b: Board, sessionId: string): Card | undefined;
export declare function sessionRef(b: Board, sessionId: string): SessionRef | undefined;
/**
 * 读盘后的结构校验：坏文件 fail loud，不静默丢数据。
 * 0.1.x 升级：阶段上的 cat（类别）/ gate（证据门）与卡片上的 ev（证据）不再使用，读入时丢掉；
 * 阶段 id、名称、顺序与卡片位置原样保留，下次写盘即为新格式。events.jsonl 里的历史证据不动。
 */
export declare function parseBoard(raw: unknown): Board;
