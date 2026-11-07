export interface Status {
    id: string;
    name: string;
}
/** v136：off = 不自动注入 Agent 会话（卡片档案 / STATE 卡片档案块不出现）；缺省 = 注入（老数据不迁移）。 */
export interface Repo {
    name: string;
    role: string;
    path: string;
    off?: boolean;
}
/** lfProject（0.20）= 这个卡片组的落盘文件夹（~/.ai/projects/<lfProject>/）：新建 / 迁移的落盘项目都放这里；缺省 = 还没设。 */
/** updatedAt（0.26）= 最后更新时间（ISO，服务端在每次改动时盖；null = 旧数据查不到）；archivedAt（0.26）= 卡片组归档时间（组里没有活跃卡片才能归档）。 */
export interface Group {
    id: string;
    name: string;
    collapsed: boolean;
    repos: Repo[];
    links: string[];
    statuses: Status[];
    lfProject?: string;
    updatedAt?: string | null;
    archivedAt?: string;
}
/**
 * 子任务（0.24）：id 稳定标识；note = 任务说明（长文本，里面的 [n] 引用本任务 links 的第 n 条）；type = 子任务类型（空 = 无类型）；
 * links = 绑定的本卡片相关链接 id；subs = 子任务（只一层）；created / updated = 添加 / 最后修改时间（ISO，由服务端盖）。
 * 有子任务时 done 由子任务决定（全部完成 = 完成）。旧数据只有 text / done，读入时补 id。
 */
export interface Task {
    id?: string;
    text: string;
    done: boolean;
    note?: string;
    type?: string;
    links?: string[];
    files?: string[];
    subs?: Task[];
    created?: string;
    updated?: string; /** v127：截止日期 YYYY-MM-DD（可空）。 */
    due?: string; /** v140：关联的会话 id（一个任务一个会话；一个会话可被多个任务关联）。 */
    sess?: string;
}
/** 相关文件（0.26）：id 稳定标识（子任务按 id 绑定）；path = 绝对路径；title = 可选标题（空 = 显示文件名）。 */
export interface FileRef {
    id: string;
    path: string;
    title?: string; /** v136 */
    off?: boolean; /** v151（1.2）：以前用过的路径（放到落盘项目 / 迁移 / 改用新位置时记下，最多 8 条）——会话里旧路径的引用照样认得出是这个文件 */
    prev?: string[];
}
/** 相关说明的一条（0.24）：t = 小标题，v = 内容；pin = 固定在最前（「卡片项目说明」）。 */
export interface NoteItem {
    t: string;
    v: string;
    pin?: boolean;
    off?: boolean;
}
/**
 * notes = 相关说明（自由文本）；webLinks = 相关链接（显示文字 + 类型 + 网址，数组顺序 = 展示顺序）；files = 相关文件的绝对路径（只登记，不复制/不删除文件）。
 * 三者都会作为「卡片资料」注入关联会话（0.10）。
 * archivedAt = 归档时间（ISO）；有值 = 已归档：不在看板列里、内容只读，g/col 保留以便恢复回原阶段。三者都可缺省（旧数据兼容）。
 */
export interface WebLink {
    id?: string;
    text: string;
    type: string;
    url: string; /** v136 */
    off?: boolean; /** v140：星标（类型分组内置顶 + 金色卡 / 金色引用胶囊）。 */
    star?: boolean; /** v141：类型标签（显示「类型名-标签」，标签全局按类型登记在 Board.linkTypeTags）。 */
    tag?: string;
}
/** repos（0.14）= 这张卡片自己的仓库清单：新建时复制所在组的「卡片共用仓库」，之后与组互不影响。 */
/** noteItems（0.24）= 相关说明（小标题 + 内容，按顺序）；旧版 notes 字符串读入时转成一条「卡片项目说明」。related（0.24）= 关联卡片 id（单向，顺序 = 展示顺序）。 */
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
    noteItems?: NoteItem[];
    webLinks?: WebLink[];
    files?: FileRef[];
    archivedAt?: string;
    pending?: boolean;
    related?: string[];
    updatedAt?: string | null; /** v136：关联卡片里「不注入」的 id（related 仍是纯 id 数组，兼容旧数据；新关联默认不注入）。 */
    relOff?: string[];
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
/**
 * linkTypes = 相关链接的「类型」选项（全局共用，数组顺序 = 展示顺序）；缺省 = 默认两项。
 * linkTypeGroups（0.21）= 类型组（顺序 = 展示顺序，types = 组内类型及顺序）；不在任何组里的类型 =「未归类」，排在 linkTypes 末尾。
 * 链接的 type 为空字符串 =「无类型」（不显示标签）。
 */
export interface TypeGroup {
    id: string;
    name: string;
    types: string[];
}
/** taskTypes（0.24）= 子任务类型（全局共用，顺序 = 展示顺序；不分组）；缺省 = DEFAULT_TASK_TYPES。 */
/** prefs（0.26）= 全局开关（所有卡片共用）：lf = 添加文件时放到落盘项目；delAdd / delTolf = 添加文件 / 一键放到落盘项目时删除原文件。缺省都开。 */
export interface Prefs {
    lf: boolean;
    delAdd: boolean;
    delTolf: boolean;
}
/** v140/v141：linkTypeDomains = 类型 → 网址（只留 origin，带结尾 /；同一网址只能属于一个类型）；linkTypeTags = 类型 → 类型标签（全局，≤20 字，同类型不重名）。 */
export interface Board {
    version: 1;
    groups: Group[];
    cards: Card[];
    sessions: SessionRef[];
    linkTypes?: string[];
    linkTypeGroups?: TypeGroup[];
    repoHistory?: RepoSeen[];
    taskTypes?: string[];
    prefs?: Partial<Prefs>;
    linkTypeDomains?: Record<string, string[]>;
    linkTypeTags?: Record<string, string[]>;
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
/** v86：pending = 不活跃也不归档；只改展示区，阶段（col）保持不变。 */
export declare function setPending(b: Board, id: string, on: boolean, col?: string): Card;
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
export declare const flatTasks: (l: Task[]) => Task[];
/** 有子任务的父任务：done = 子任务全部完成。 */
export declare function rollupDone(list: Task[]): Task[];
/**
 * 子任务整表替换（0.24）：两级树（subs 只允许一层）；按 id 对比旧任务盖时间——新任务 created = updated = at，
 * 内容（标题 / 说明 / 类型 / 链接 / 完成）变了才刷新 updated，只调顺序不算修改。links 只能是本卡片相关链接的 id；type 只能是已有的子任务类型（或空）。
 */
export declare function setTasks(b: Board, id: string, tasks: unknown, at?: string): Task[];
/**
 * v122（1.4）：任务执行安排 / 本日计划清单里的「勾选」= 卡片任务真的完成（和卡片详情同一份数据）。
 * 只改 done（不整表替换，说明 / 链接 / 文件原样留着）：勾任务 = 连它的子任务；勾子任务 = 子任务全完成时父任务自动完成。
 */
export declare function setTaskDone(b: Board, id: string, taskId: unknown, on: unknown, at?: string): Task[];
/** 深拷贝子任务树（工具改动前用）。 */
export declare const taskList: (l: Task[]) => Task[];
/** 按编号（"2" / "2.1"，1 起）找子任务；越界点名。 */
export declare function taskAt(list: Task[], num: string): {
    task: Task;
    list: Task[];
    i: number;
    sub: boolean;
};
/** 0.24 相关说明（小标题 + 内容）整表替换：每条小标题、内容都不能空；pin 只认第一条。空数组 = 清空。 */
export declare function setNoteItems(b: Board, id: string, items: unknown): Card;
/** 旧接口兼容：一整段文字 = 一条「卡片项目说明」。 */
export declare function setNotes(b: Board, id: string, text: unknown): Card;
export declare const NOTE_PIN_TITLE = "\u5361\u7247\u9879\u76EE\u8BF4\u660E";
/** 0.24 关联卡片整表替换：只能是其他存在的卡片（活跃 / 已归档都行），去重保序。 */
export declare function setRelated(b: Board, id: string, ids: unknown): Card;
/** 子任务说明里引用 [n] 的链接解除后：[k] → 「链接名」，后面的编号前移。 */
export declare function dropRef(note: string, links: string[], linkId: string, text: string): {
    note: string;
    links: string[];
};
export declare const DEFAULT_TASK_TYPES: string[];
export declare const taskTypes: (b: Board) => string[];
export declare const taskTypeUse: (b: Board, name: string) => number;
export declare function addTaskType(b: Board, name: unknown): string;
export declare function renameTaskType(b: Board, from: unknown, to: unknown): {
    name: string;
    tasks: number;
};
export declare function deleteTaskType(b: Board, name: unknown): {
    tasks: number;
};
export declare function placeTaskType(b: Board, name: unknown, at: unknown): void;
export declare const baseName: (p: string) => string;
export declare const filePaths: (c: Card) => string[];
/**
 * 追加相关文件（0.26：每项可带标题）：逐个校验，任一非法整批不写；已关联的跳过。
 * items = 路径字符串或 {path, title}。返回新增数、跳过数与新增文件的 id。
 */
export declare function addFiles(b: Board, id: string, items: unknown): {
    added: number;
    skipped: number;
    ids: string[];
};
/** 0.26 改标题（空 = 显示文件名）。 */
export declare function setFileTitle(b: Board, id: string, fileId: unknown, title: unknown): FileRef;
/** v136 改「自动注入 Agent 会话」开关（on = 注入）。 */
export declare function setFileOff(b: Board, id: string, fileId: unknown, on: unknown): FileRef;
/**
 * 0.26 放到落盘项目后改指向（撤销时改回）。
 * v154（1.1）：改路径的同一个事务里，把任务说明 / 相关说明里指向旧路径的引用原文一起改到新路径
 * （撤销 = 反向调用，同一段代码改回）—— 否则会话胶囊只能靠 prev / 同名兜底猜，就会出现
 * 「卡片里明明有、对话框却显示已不在」。
 */
export declare function setFilePath(b: Board, id: string, fileId: unknown, path: unknown): FileRef;
/** v151（1.2）：改路径前把旧路径记进 prev（去重、新的在前、最多 8 条；改回原路径时从 prev 里拿掉）。 */
export declare function notePrev(f: FileRef, next: string): void;
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
/** 解除关联：只从列表移除，不碰文件本身；绑定它的子任务一并解绑。返回撤销所需的信息。 */
export declare function removeFile(b: Board, id: string, fileId: unknown): {
    file: FileRef;
    index: number;
    tasks: string[];
};
/** 撤销解除关联：放回原位置，重新绑到原来的子任务（子任务已删的跳过）。 */
export declare function restoreFile(b: Board, id: string, raw: unknown, index: unknown, tasks: unknown): FileRef;
/** 复制后的名字：「xxx」→「xxx（1）」；复制「xxx（1）」接着编号（同组里已有的最大号 + 1）。 */
export declare function dupName(b: Board, c: Card): string;
/**
 * 复制卡片：同组同阶段，排在「原卡片 + 已有副本」最后一张后面（原卡片已归档 → 放到阶段末尾，阶段没了放第一个）。
 * 复制：子任务（含子集；新 id、全部未勾选、时间重盖）、相关说明 / 链接 / 文件、仓库、关联卡片。不复制：会话、关联的落盘项目、归档状态。
 */
export declare function copyCard(b: Board, id: string, at?: string): Card;
/** 要往里加卡片 / 移卡片的卡片组：已归档的先恢复。 */
export declare function liveGroup(b: Board, id: string): Group;
/** 归档卡片组：组里还有活跃卡片就拒绝（点名张数）；阶段、会话、仓库都不动。 */
export declare function archiveGroup(b: Board, id: string, at?: string): Group;
/** 恢复活跃：回到归档前的位置（归档时没挪动，顺序不变）；里面的卡片仍是已归档。 */
export declare function unarchiveGroup(b: Board, id: string): Group;
/** 卡片组管理栏：open = 展开有活跃卡片的组；only = 有活跃卡片的展开、没有的收起；fold = 全部折叠。只动活跃组。 */
export declare function bulkCollapse(b: Board, mode: unknown, liveGroups?: string[]): {
    opened: number;
    folded: number;
};
export declare const prefsOf: (b: Board) => Prefs;
export declare function setPrefs(b: Board, patch: unknown): Prefs;
/** 每次写盘前盖「最后更新时间」：内容变了的卡片 + 它所在（及原来所在）的卡片组；删了卡片也算组被改。 */
export declare function stampTimes(prev: Board, next: Board, at: string): void;
/** 0.26 升级：旧数据没有最后更新时间 → 从审计日志里这张卡片最后一次改动补（归档 / 恢复不算）；卡片组取它卡片里最新的；查不到 = null（显示「—」）。 */
export declare function backfillTimes(b: Board, events: ReadonlyArray<{
    at?: string;
    card?: string;
    group?: string;
    kind?: string;
}>): number;
export declare const DEFAULT_LINK_TYPES: string[];
export declare const NO_TYPE = "\u65E0\u7C7B\u578B";
export declare const LOOSE_GROUP = "\u672A\u5F52\u7C7B";
export declare const linkTypes: (b: Board) => string[];
export declare const typeGroups: (b: Board) => TypeGroup[];
/** 「未归类」的类型（按 linkTypes 里的顺序）。 */
export declare const looseTypes: (b: Board) => string[];
/** 新增全局「类型」选项（已有则不变）；group = 放进哪个类型组（缺省 = 未归类）。类型名限 20 字，不能叫「无类型」。 */
export declare function addLinkType(b: Board, name: unknown, group?: unknown): string;
/** 0.13 改名全局「类型」：类型表、所在类型组与所有卡片（含已归档）里用旧名的链接一起改，任一校验失败什么都不写。返回新名与改到的链接数。 */
export declare function renameLinkType(b: Board, from: unknown, to: unknown): {
    name: string;
    links: number;
};
/** 0.21 删除类型：从类型表和类型组里去掉；用它的链接（含已归档卡片）改成「无类型」。返回改到的链接数。 */
export declare function deleteLinkType(b: Board, name: unknown): {
    links: number;
};
/** 0.21 把类型放到某个类型组（null = 未归类）的第 at 位（at 按去掉它之后的列表算，越界夹到末尾）。 */
export declare function placeLinkType(b: Board, name: unknown, group: unknown, at: unknown): void;
/** 0.21 新增类型组（排在最后、还没有类型）。组名限 20 字、不能重名、不能叫「未归类」。 */
export declare function addTypeGroup(b: Board, name: unknown): TypeGroup;
export declare function renameTypeGroup(b: Board, id: unknown, to: unknown): TypeGroup;
export declare function moveTypeGroup(b: Board, id: unknown, to: unknown): void;
/** 0.21 删除类型组：组里的类型移到「未归类」最前面，链接不受影响。返回移过去的类型数。 */
export declare function deleteTypeGroup(b: Board, id: unknown): {
    types: number;
};
/** 网址只留 origin（带结尾 /）：没写协议补 https://；有空格 / 无「.」的域名 / 非 http(s) 报错。空串 = 合法空。 */
export declare function normDomain(v: unknown): string;
/** 这个网址（按域名）已经属于哪个类型（没有 = ''）。 */
export declare function domainOwner(b: Board, d: string): string;
export declare function addTypeDomain(b: Board, type: unknown, raw: unknown): string;
export declare function removeTypeDomain(b: Board, type: unknown, d: unknown): void;
/** 完整链接按域名（含子域名，取最长匹配）自动选的类型；没有 = null。 */
export declare function typeForUrl(b: Board, url: string): {
    type: string;
    domain: string;
} | null;
export declare function addTypeTag(b: Board, type: unknown, raw: unknown): string;
/** 删标签：用到它的链接回到只显示类型名。返回改到的链接数。 */
export declare function removeTypeTag(b: Board, type: unknown, tag: unknown): {
    links: number;
};
/** 星标：加星 = 挪到本类型组里已有星标链接的最下面；去星 = 排到星标后面（本类型的第一个非星标前）。 */
export declare function setLinkStar(b: Board, id: string, linkId: unknown, on: unknown): WebLink;
/** 设 / 清一个任务或子任务关联的会话（只改 sess，不整表替换）。sess 空 = 取消关联。 */
export declare function setTaskSession(b: Board, id: string, taskId: unknown, sess: unknown, at?: string): Task;
/** v151（2.2）：会话换了卡片 → 其它卡片里关联它的任务 / 子任务解除关联（返回解除了几个）。 */
export declare function dropForeignTaskSess(b: Board, sid: string, keepCard: string): number;
/** 一个会话被这张卡片里几个任务 / 子任务关联。 */
export declare const sessionTaskCount: (c: Card, sid: string) => number;
/** 判断两条链接是否同一个：协议 + 域名（小写）+ 路径（去掉末尾 /）+ 查询 + 锚点。 */
export declare function urlKey(url: string): string;
/** 网址简单校验：只收 http(s)；没写协议但像域名 → 补 https://；不能有空白/控制字符。返回规范化后的网址。 */
export declare function normUrl(v: unknown): string;
/** 相关链接整表替换（新增 / 编辑 / 删除 / 排序都走这里）：逐条校验，任一非法整批不写；没见过的类型自动加入全局选项（未归类）；type 空 = 无类型。 */
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
