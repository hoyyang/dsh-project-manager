/**
 * 0.27 会话输入框「>」引用卡片内容：每一类条目插入的文本（原型 v53 定稿，host / client 共用，纯函数）。
 * 外层用「」；内容里本来就有的「」换成『』（中文引号嵌套），外层边界不会被内容截断。
 * 0.27.2（原型 v56）：名字（会话 / 卡片组 / 卡片 / 任务 / 说明标题 / 链接 / 文件 / 仓库）一律加中文双引号“”，名字里原有的“”换成‘’；内容、路径、URL 不加。
 */
export interface QLink {
    id?: string;
    text: string;
    type?: string;
    url: string;
}
export interface QFile {
    id?: string;
    path: string;
    title?: string;
    exists: boolean;
}
export interface QTask {
    id?: string;
    text: string;
    done: boolean;
    note?: string;
    type?: string;
    links?: string[];
    files?: string[];
    subs?: QTask[];
}
export interface QCard {
    tasks: QTask[];
    links: QLink[];
    files: QFile[];
}
export declare const nest: (x: string) => string;
export declare const wrap: (x: string) => string;
/** 名字：“名字”。 */
export declare const nm: (x: string) => string;
export declare const fileTitle: (f: {
    path: string;
    title?: string;
}) => string;
/** 0.27.2 活跃会话：「“会话名”会话（“卡片组名”卡片组-“卡片名”卡片）」；还没卡片 = 去掉「-“卡片名”卡片」；不在卡片组里 = 只写「“会话名”会话」。 */
/** v151（1.1）：带会话 id（Agent 拿 id 精确定位会话，重名不再找错）：「“名”会话（“组”卡片组-“卡”卡片 · 会话 id：session-…）」；没卡片组 =「“名”会话（会话 id：…）」。 */
export declare const sessionText: (name: string, group?: string, card?: string, id?: string) => string;
export declare const noteText: (t: string, v: string) => string;
export declare const linkText: (l: QLink) => string;
/** 还在 =「标题（路径）」，已删除 =「标题（已删除：路径）」。 */
export declare const fileRef: (f: QFile) => string;
export declare const fileText: (f: QFile) => string;
export declare const repoText: (name: string, path: string) => string;
export declare const cardText: (title: string, group: string) => string;
/**
 * v163 S10：知识卡引用原文 =「“标题”知识卡（/abs/path/<id>.md）」。
 * 中间「知识卡」三个字把「”（」隔开 —— FILE_REF_RX（文件引用）与文件胶囊的正则都吃不到它；
 * 文件名 = id、路径恒定，所以不需要 v154 那套搬家同步（改标题只影响显示）。
 */
export declare const kbText: (title: string, path: string) => string;
/**
 * v97：任务的引用文本 = 这条任务的「任务说明」全文（子任务同理）；没有说明才退回标题。
 * 不再拼「任务 N：标题 / 状态 / 类型 / 链接 / 文件 / 子任务」那一大段 —— 那些在详情里都看得到。
 */
export declare function taskText(c: QCard, ti: number, si?: number): string;
/** 「>」/「》」引用触发：行首（本行的第一个字符）或空格后面。
 *  v117 修：原来行首只在「整段文字的第一行」才算（first 参数），所以任务说明是两行以上时，
 *  在第 2 行行首打「>」不会弹引用菜单 —— 用户看到的就是「>」留在正文里、胶囊没插进去（开工 5.2）。
 *  现在任意一行的行首都算；first 保留只为兼容调用方（单行输入框里它恒为 true）。 */
export declare function detectQuote(prefix: string, _first?: boolean): {
    len: number;
    query: string;
} | null;
/**
 * v171：「）」/「)」（半角同理）引用知识卡触发 —— 行首（任意一行的第一个字符）或空格 / 全角空格 / NBSP 之后。
 * 与 detectQuote 同构、同样纯函数：不碰 DOM，四处入口（对话框 / 任务说明 / 相关说明 / 知识卡正文）共用这一条规则。
 * 不做「》」—— 那是「>」的兄弟（引用卡片内容）。
 */
export declare function detectKbQuote(prefix: string): {
    len: number;
    query: string;
} | null;
/**
 * v171：面板被用户主动收起后的「别立刻重开」判定 —— 只认「触发字符左边那段原文」。
 * 规则（原型 v171 J 组定稿）：左边那段原文没被改写、且后面紧跟着的仍是同一个触发字符（可隔一个空白），
 * 就继续压着不弹；用户清掉 / 改写了左边那段、或换了个位置重新打触发字符 → 解除。
 * 只对 esc / outside 记；pick / api（程序化关闭）不记。
 */
export declare function mutedBy(left: string, prefix: string): boolean;
/** 触发字符左边那段原文（len = detectQuote / detectKbQuote 给的触发长度）。 */
export declare const leftOf: (prefix: string, len: number) => string;
/** 文件引用原文：「“标题”（[已删除：]路径）」。 */
export declare const FILE_REF_RX: RegExp;
/** 路径 / 文件名的最后一段（不依赖 model，避免循环依赖）。 */
export declare const refBase: (p: string) => string;
/**
 * v154：文件名归一 key —— 只差空白（含全角空格）与连字符的名字视为同一个文件。
 * 「…严重 bug.mov」与「…严重-bug.mov」= 同一个 key（搬家净化名字的经典情形）；其它字符不折叠，防误配。
 */
export declare const refNameKey: (p: string) => string;
/** v154：一条引用要换成的目标（title 缺省 = 文件名）。 */
export interface RefTarget {
    path: string;
    title?: string;
}
/**
 * v154（1.4）：卡内文件里按「当前路径 → 以前的路径（prev）→ 唯一同名 → 归一同名」找对应文件。
 * 任务说明 / 详情气泡 / 启动修复用同一口径；宿主已发出的消息、用户自己在 Finder 里挪的文件靠这一条兜住。
 */
export declare function findRefFile<T extends {
    path: string;
    prev?: string[];
}>(files: readonly T[], path: string): T | null;
/** v154：相关文件的显示名（自定义标题优先，否则文件名）。 */
export declare const refTitle: (f: {
    path: string;
    title?: string;
}) => string;
/**
 * v154：按 pick 改写 text 里的文件引用原文；pick 返回 null 或同一路径 = 不动。
 * 保留原文的「已删除：」前缀 —— 它记录的是写这条引用时的状态。
 */
export declare function rewriteFileRefText(text: string, pick: (path: string, title: string) => RefTarget | null): {
    text: string;
    n: number;
};
