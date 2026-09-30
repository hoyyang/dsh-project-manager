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
export interface Card {
    id: string;
    g: string;
    col: string;
    order: number;
    t: string;
    links: string[];
    tasks: Task[];
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
export interface Board {
    version: 1;
    groups: Group[];
    cards: Card[];
    sessions: SessionRef[];
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
export declare function status(g: Group, id: string): Status;
/** 同组同阶段内按 order 排序后的卡片。 */
export declare function cellCards(b: Board, gId: string, col: string): Card[];
export declare function addGroup(b: Board, name: string): Group;
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
