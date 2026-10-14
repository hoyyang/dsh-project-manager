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
/** lfProject（0.20）= 这个卡片组的落盘文件夹（~/.ai/projects/<lfProject>/）：新建 / 迁移的落盘项目都放这里；缺省 = 还没设。 */
export interface Group {
    id: string;
    name: string;
    collapsed: boolean;
    repos: Repo[];
    links: string[];
    statuses: Status[];
    lfProject?: string;
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
/** repos（0.14）= 这张卡片自己的仓库清单：新建时复制所在组的「卡片共用仓库」，之后与组互不影响。 */
export interface Card {
    id: string;
    g: string;
    col: string;
    order: number;
    t: string;
    links: string[];
    tasks: Task[];
    repos: Repo[];
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
/** 候选仓库（0.14）：任意卡片组 / 卡片添加过的仓库，移除后也保留；at = 最近一次添加的时间。 */
export interface RepoSeen extends Repo {
    at: string;
}
/** linkTypes = 相关链接的「类型」选项（全局共用，数组顺序 = 展示顺序）；缺省 = 默认两项。 */
export interface Board {
    version: 1;
    groups: Group[];
    cards: Card[];
    sessions: SessionRef[];
    linkTypes?: string[];
    repoHistory?: RepoSeen[];
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
/** 0.20 卡片组的落盘文件夹：字母数字开头、只用 a-z 0-9 . _ -；两个组不能共用。空 = 清除。 */
export declare function setGroupFolder(b: Board, id: string, v: unknown): void;
export declare function removeGroup(b: Board, id: string): void;
/** 校验并替换整组阶段：至少一个，id 唯一，名称非空，仍有卡片的阶段不能被删。 */
export declare function setStatuses(b: Board, gId: string, next: Status[]): void;
/** 绝对路径：POSIX「/…」或 Windows「C:\…」「C:/…」「\\server\share…」（issue #1：Windows 原生路径曾被当成相对路径拒掉）。 */
export declare const isAbsPath: (p: string) => boolean;
export declare function cleanRepos(v: unknown): Repo[];
/**
 * 追加挂载仓库（「添加挂载仓库」弹窗的保存）：逐个校验后一次性追加，任一冲突整批不写。
 * 同一路径不能挂两次；名称不能与本组已有或本批其他项重名（repos/<组>/<名> 软链路径由名称决定）。
 */
export declare function addRepos(b: Board, gId: string, v: unknown, canon?: (p: string) => string): Repo[];
/** 0.14 给卡片追加仓库（只影响这张卡片）。 */
export declare function addCardRepos(b: Board, id: string, v: unknown, canon?: (p: string) => string): Repo[];
/** 0.14 整表替换卡片仓库（移除 / 改名 / 改角色）：只影响这张卡片。 */
export declare function setCardRepos(b: Board, id: string, v: unknown): Repo[];
/** 记进候选仓库：同一路径只留一条，时间刷新为最新、名称 / 角色以最近一次为准。 */
export declare function noteRepos(b: Board, rs: Repo[], at?: string): void;
/** 候选仓库：最近添加的在前。 */
export declare function repoCandidates(b: Board): RepoSeen[];
/**
 * 卡片组目录 repos/ 下的软链接（0.14）：组共用仓库 + 本组每张卡片的仓库（含已归档卡片，便于恢复）。
 * 名称 = 软链接目录名；同名不同路径时后来者自动改成「名-2」「名-3」…；同一路径只挂一次。
 * 返回 path → 软链接名（卡片注入时据此写 repos/<名>/）。
 */
export declare function groupMounts(b: Board, gId: string): Map<string, string>;
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
/**
 * 0.15 粘贴的一行路径 → 规整后的绝对路径（不判断存在）。去首尾空白与成对引号、file:// 解码、~ 展开、
 * 终端转义空格（\ ）还原、去末尾分隔符。非绝对路径原样返回（由调用方判非法）。
 */
export declare function normPastedPath(raw: string, home: string): string;
/** 0.15 分叉补关联：0.14 之前分出的会话（源会话关联了卡片、它自己没关联）批量补上。返回补上的 [子会话, 卡片] 对。 */
export declare function backfillForks(b: Board, pairs: Array<{
    child: string;
    parent: string;
}>): Array<{
    child: string;
    card: string;
}>;
/** 解除关联：只从列表移除，不碰文件本身。 */
export declare function removeFile(b: Board, id: string, path: unknown): void;
export declare const DEFAULT_LINK_TYPES: string[];
export declare const linkTypes: (b: Board) => string[];
/** 新增全局「类型」选项（已有则不变）；类型名同名称类字段规则，限 20 字。 */
export declare function addLinkType(b: Board, name: unknown): string;
/** 0.13 改名全局「类型」：类型表与所有卡片（含已归档）里用旧名的链接一起改，任一校验失败什么都不写。返回新名与改到的链接数。 */
export declare function renameLinkType(b: Board, from: unknown, to: unknown): {
    name: string;
    links: number;
};
/** 0.14 调整类型顺序：from 位置的类型挪到 to 位置（数组顺序 = 下拉展示顺序）。 */
export declare function moveLinkType(b: Board, name: unknown, to: unknown): string[];
/** 判断两条链接是否同一个：协议 + 域名（小写）+ 路径（去掉末尾 /）+ 查询 + 锚点。 */
export declare function urlKey(url: string): string;
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
/** 0.18 关联了这个落盘项目的卡片（卡片级，含已归档）与卡片组（组级）。 */
export declare function linksOfKey(b: Board, key: string): {
    cards: Card[];
    groups: Group[];
};
/** 一个会话只属于一张卡片：重复绑定以最新一次为准。 */
export declare function bindSession(b: Board, sessionId: string, cardId: string, title?: string): void;
/** 0.14 分叉：源会话关联了卡片 → 新会话关联同一张卡片（带上源会话已读过的落盘项目）。源会话没关联 / 卡片已归档 → null。 */
export declare function bindFork(b: Board, childId: string, parentId: string, title?: string): Card | null;
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
