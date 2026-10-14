import type { StateCatalog } from './states.js';
export declare const SKILL_NAME = "landfill-project";
export interface LandfillPaths {
    aiRoot: string;
    agentsHome: string;
    pkgDir: string;
    dataDir: string;
}
/** linked = 链接指向本插件；missing = 没有；file = 本机已有普通文件（等用户点「接管」）；foreign = 指向别处的链接（不动）。 */
export type SkillLink = 'linked' | 'missing' | 'file' | 'foreign' | 'stale';
export interface LandfillStatus {
    enabled: boolean;
    ok: boolean;
    reason: string;
    python: string;
    tool: string;
    created: string[];
    skill: SkillLink;
    skillPath: string;
}
export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type Want = 'persist' | 'recall';
export interface Intent {
    want: Want;
    keys: string[];
}
/** plan = 规划模式（只读，不拉回）；streak = 同一要求此前连续几轮没完成；quiet = 连续被忽略两轮后本轮不再拉回。 */
export interface TurnState extends Intent {
    turn: number;
    done: boolean;
    pulls: number;
    asked: boolean;
    plan?: boolean;
    streak?: number;
    quiet?: boolean;
}
/** 找 python3；macOS 的 /usr/bin/python3 在没装命令行开发工具时是占位程序（一调用就弹安装框），那种情况跳过。 */
export declare function findPython(platform?: string, pathEnv?: string, exists?: (p: string) => boolean, clt?: () => boolean): string | null;
/** 只补缺：~/.ai 不存在才建骨架；ai-memory 不存在才从插件包复制。已有的一律不碰（wx / COPYFILE_EXCL 防并发覆盖）。 */
export declare function bootstrap(p: LandfillPaths): string[];
export declare const skillFile: (p: LandfillPaths) => string;
export declare const skillLinkPath: (p: LandfillPaths) => string;
export declare function skillState(p: LandfillPaths): SkillLink;
/** 没有 → 建链接；断了 / 指向本插件旧版本 → 重建；普通文件 / 别人的链接 → 不动。返回处理后的状态。 */
export declare function ensureSkillLink(p: LandfillPaths): SkillLink;
/** 「接管」：本机已有的普通文件先备份到插件数据目录，再换成指向插件的链接。 */
export declare function adoptSkill(p: LandfillPaths, now?: Date): {
    backup: string;
};
export declare class LandfillError extends Error {
    readonly code: string;
    readonly extra: Record<string, unknown>;
    constructor(code: string, message: string, extra?: Record<string, unknown>);
}
export declare function runAiMemory(python: string, tool: string, aiRoot: string, args: string[], input?: string, timeoutMs?: number): Promise<RunResult>;
/** ai-memory 失败 → 带 code 的错误；冲突 / 外部改动时把 inbox 产物路径原样带回（不重试）。 */
export declare function aiFailure(r: RunResult, what: string): LandfillError;
export declare const sha256: (s: string | Buffer) => string;
export declare function checkName(v: unknown, field: string): string;
/** STATE 必须有的章节（landfill-project skill 的 Required STATE Content 里机器能查的部分）。 */
export declare function missingSections(text: string): string[];
/** 每段字符上限：宿主只把 ≤12500 token 的工具结果直接给模型（dsh-base spill-policy maxInlineTokens），更大的落到文件、模型只看到提示。
 *  本机 240 份 STATE 实测最密 0.262 token/字符（JSON 转义后）→ 32000 字符 ≈ 8400 token，加 toc 与外层字段仍在上限内。 */
export declare const CHUNK = 32000;
/** 推荐体量：一段读完。 */
export declare const SIZE_TARGET = 30000;
/** 从 offset 起切一段：不超过 max，优先切在「## 」标题前，其次换行处。 */
export declare function cutEnd(text: string, offset: number, max?: number): number;
/** 从 0 开始的全部分段起点。 */
export declare function chunkStarts(text: string, max?: number): number[];
/** ## 标题目录（带 offset），最多 60 条（只放二级标题，控制第一段体量）。 */
export declare function toc(text: string): Array<{
    offset: number;
    title: string;
}>;
/** 已读区间合并后，没读到的部分。 */
export declare function uncovered(ranges: Array<[number, number]>, total: number): Array<[number, number]>;
/** 关键事实锚点：commit 哈希、版本号、本机路径、URL、单号。用来发现「新稿悄悄少了什么」。 */
export declare function anchors(text: string): Set<string>;
/** 旧稿有、新稿没有、也没被 drop（子串）覆盖的锚点。 */
export declare function droppedAnchors(oldText: string, newText: string, drop?: string[]): {
    lost: string[];
    dropped: number;
};
/** 新稿里写到、本机却不存在的路径（提示核对，不拦）。 */
export declare function missingPaths(text: string, home?: string, exists?: (p: string) => boolean): string[];
export declare const REQUIRED_MAX = 60000;
export declare const AUTOREAD_BUDGET = 96000;
/** 文本文件：扩展名在白名单里，且前 8KB 没有 NUL。 */
export declare function isText(path: string, head?: Buffer): boolean;
/** 文件索引行：「- [必读|参考] 路径 · 用途 · 何时读」（路径可带反引号）。 */
export declare function parseIndex(text: string): Array<{
    tag: '必读' | '参考';
    path: string;
}>;
/** 文件夹里的相对路径（递归，跳过 STATE.md 与点开头的条目），最多 max 个。 */
export declare function listDocs(dir: string, max?: number): {
    files: string[];
    more: number;
};
/** 「## … 文件索引」这一节的正文；没有这一节 = ''（文件夹里有文件就必须建这一节）。 */
export declare function indexSection(body: string): string;
/** 文件有没有进索引：「文件索引」节里有一行 [必读|参考] 写的是它本身，或它所在的任一级目录（写成 dir/）。只提到不算。 */
export declare function isIndexed(rel: string, whole: string): boolean;
/** 文件夹内相对路径校验：不能越界 / 不能是 STATE.md / 每段只用字母数字中文 . _ -。 */
export declare function checkRel(v: unknown, mode?: 'read' | 'write' | 'import'): string;
/** 本句提到的落盘项目：slug（或 0.19 别名）≥4 字符（或问题单号）出现在原文里；被更长命中包含的短名字去掉。 */
export declare function mentioned(text: string, states: ReadonlyArray<{
    key: string;
    slug: string;
    aliases?: readonly string[];
}>): string[];
/**
 * 用户原话 → 要落盘 / 要回忆。0.18：「落盘项目」只在三种写法下算指令——某行以它开头（后面不是「的 / 功能 …」）、
 * 后面跟着已知 slug / 单号、或在整条消息末尾；引号（「」“”""）里的不算。「回忆」优先；「继续」只在点名了已知项目时算回忆。
 */
export declare function detectIntent(text: string, states: ReadonlyArray<{
    key: string;
    slug: string;
    aliases?: readonly string[];
}>): Intent | null;
export declare function intentHint(i: Intent, project: string | null): string;
/** 回合要结束时：要求的事没做、没在等用户回答、拉回次数没用完、不在规划模式、没被连续忽略 → 返回拉回提示；否则 null。 */
export declare function stopNudge(s: TurnState, maxPulls?: number, plan?: boolean): string | null;
/** 规划模式下识别到落盘：只提示，不要求写。 */
export declare const PLAN_HINT = "[dsh-project-manager \u00B7 \u843D\u76D8\u9879\u76EE] \u7528\u6237\u63D0\u5230\u843D\u76D8\uFF0C\u4F46\u4F1A\u8BDD\u5728\u89C4\u5212\u6A21\u5F0F\uFF08\u53EA\u8BFB\uFF09\uFF1A\u73B0\u5728\u4E0D\u80FD\u5199 STATE\u3002\u628A\u300C\u843D\u76D8\u300D\u5217\u4E3A\u65B9\u6848\u91CC\u7684\u4E00\u4E2A\u6B65\u9AA4\uFF0C\u5E76\u544A\u8BC9\u7528\u6237\u9000\u51FA\u89C4\u5212\u6A21\u5F0F\u540E\u518D\u843D\u76D8\uFF1B\u4E0D\u8981\u5C1D\u8BD5\u5199\u5165\u3002";
/** 拦截：write / edit 直写 ~/.ai 记忆 Markdown；bash 里不经 ai-memory 改 ~/.ai/{projects,memory}/。返回拒绝理由或 null。规则只认明确的写法，避免误伤只读命令。 */
export declare function guardReason(name: string, args: Record<string, unknown>, aiRoot: string, home?: string): string | null;
export interface ToolSession {
    id?: string;
    cwd?: string;
}
/** 会话所在卡片：cardId、卡片级 / 组级关联的落盘项目。 */
export interface Scope {
    cardId?: string;
    card: string[];
    group: string[];
}
export interface LandfillDeps {
    /** 这个会话可用来认项目的路径：卡片组 / 卡片挂的仓库（按优先级）。 */
    repoPaths(sessionId: string | undefined): string[];
    /** 落盘成功后：会话绑了卡片就把这个 STATE 关联上。 */
    persisted?(sessionId: string | undefined, key: string): void;
    /** 0.18 这个 key 的卡片档案块（按看板现生成；没有关联 = ''）。 */
    cardBlock?(key: string): string;
    /** 0.18 会话所在卡片的范围；没绑卡片 = undefined。 */
    scope?(sessionId: string | undefined): Scope | undefined;
    /** 0.20 新建落盘项目放哪个项目：会话卡片所在卡片组的落盘文件夹（没设 = undefined；设了但没登记会先登记）。 */
    home?(sessionId: string | undefined): Promise<string | undefined>;
    /** 0.20 卡片组还没设落盘文件夹时给的建议（报 NEED_GROUP_FOLDER 用）。 */
    homeHint?(sessionId: string | undefined): {
        group: string;
        suggest: string;
    } | undefined;
    /** 0.20 这份 STATE 按现行规范要不要迁移：返回目标项目（卡片组的落盘文件夹）。 */
    moveTarget?(key: string): string | undefined;
    /** 0.20 迁移（插件自动，可撤销）：返回新 key 与路径改写函数。 */
    migrate?(sessionId: string | undefined, key: string, toProject: string): Promise<{
        key: string;
        rewrite(t: string): string;
        rec: {
            id: string;
            from: string;
            to: string;
            retired: string;
            refs: unknown[];
        };
    }>;
    /** 0.20 规范检查清单的上下文（关联它的卡片名等）。 */
    specCtx?(key: string): import('./lfspec.js').SpecCtx;
    log?: {
        info(...a: unknown[]): void;
        warn(...a: unknown[]): void;
    };
}
export interface Owed {
    key: string;
    file: string;
    next: number;
}
/** 0.20 信息卡发起的落盘这一轮：busy 进行中 / done 写好了 / stopped 被停止 / error 出错 / ask 在问用户 / nowrite 一轮结束但没写。 */
export interface LfRun {
    key: string;
    label: string;
    at: number;
    state: 'busy' | 'done' | 'stopped' | 'error' | 'ask' | 'nowrite';
    end?: number;
    error?: string;
    seen?: boolean;
}
/** 文件名用的标题：去掉不允许的字符，最长 60。 */
export declare function titleSlug(plan: string): string;
export declare const bundledVersion: (pkgDir: string) => number;
export declare class Landfill {
    readonly paths: LandfillPaths;
    private readonly states;
    private readonly deps;
    status: LandfillStatus & {
        toolVersion: number;
        bundledVersion: number;
        toolOutdated: boolean;
    };
    /** 会话 × 文件绝对路径 → 读到的版本与已读区间（「读全才许写」靠它）。 */
    private seen;
    /** 会话 × 文件 → 会话上下文里已有完整内容的版本（注入 / 读全 / 本会话写入）；跨重启保存。 */
    private known;
    private files;
    private turns;
    private owedOf;
    private readonly knownPath;
    constructor(paths: LandfillPaths, states: StateCatalog, deps: LandfillDeps, enabled?: boolean, platform?: string);
    private probeVersion;
    /** 看板轮询用：skill 链接状态每次现查（用户可能在外面动过）。 */
    snapshot(): LandfillStatus & {
        toolVersion: number;
        bundledVersion: number;
        toolOutdated: boolean;
    };
    adopt(): {
        backup: string;
    };
    /** 0.18 用户点「升级」：~/.ai/tools/ai-memory 先备份到插件数据目录，再换成插件自带的新版。 */
    upgradeTool(now?: Date): {
        backup: string;
        version: number;
    };
    /** 0.19 合并用：调 ai-memory（不抛 LANDFILL_OFF 以外的错，由调用方看 code）。 */
    ai(args: string[], input?: string): Promise<RunResult>;
    /** 0.19 文件当前版本（按 mtime + 大小缓存）。 */
    fileInfo(path: string): {
        hash: string;
        binary: boolean;
        size: number;
        text?: string;
    } | undefined;
    /** 0.19 会话上下文里是否已有这个文件当前版本（「AI 收到的原文」浮层用）。 */
    inContext(sid: string, path: string): boolean;
    /** 0.19 STATE 文件索引里存在的 [必读] 文本文件。 */
    requiredFiles(key: string): string[];
    /** 0.19 本会话刚写入的完整文件：记为已读 / 已知（不回灌注入）。 */
    wrote(sid: string | undefined, path: string, hash: string, total: number): void;
    private run;
    /** 文件当前版本（按 mtime + 大小缓存）；不存在 / 不是文件 = undefined。 */
    private info;
    private knownEntry;
    private saveKnown;
    private markKnown;
    /** 分叉：子会话继承父会话上下文里已有的版本。 */
    forkKnown(child: string, parent: string): void;
    /** 记一段已读；hash 变了就从头记；读全 = 会话里有完整内容。 */
    private remember;
    private forget;
    /** 会话里是否已有这个文件当前版本的完整内容。 */
    private covered;
    /** 没读到的第一处 offset。 */
    private nextGap;
    dirOf(key: string): string;
    /** STATE 文件索引里的 [必读] 相对路径（去重）。 */
    private requiredOf;
    /** 这个 key 还没读完的文件（STATE + 存在的文本 [必读]）。 */
    pending(sid: string | undefined, key: string): Owed[];
    /** 文件夹清单（紧凑字符串，最多 40 条）。 */
    private docsOf;
    /** 项目解析：显式 project → 卡片挂的仓库 → 会话目录；都认不出返回 null。 */
    resolveProject(s: ToolSession, explicit?: string): Promise<string | null>;
    /** slug 或 <project>/<slug> → 唯一 key；找不到时按 project 新建；多个同名要求指定 project。 */
    resolveKey(s: ToolSession, slugOrKey: string, project?: string, allowNew?: boolean): Promise<string>;
    /** 0.18 slug 可省：用会话卡片唯一的主 STATE；新建时防碎片（卡片已有主 STATE 又要建别的 = CARD_HAS_STATE，newState:true 放行）。 */
    keyFor(s: ToolSession, slugOrKey: string | undefined, project?: string, allowNew?: boolean, newState?: boolean): Promise<string>;
    statePath(key: string): string;
    private fullRel;
    /** 分段回忆：STATE（不带 file）或子文档（file）。complete = STATE + 全部 [必读] 都读完。 */
    recall(s: ToolSession, slugOrKey: string | undefined, project?: string, offset?: number, max?: number, file?: string): Promise<Record<string, unknown>>;
    persist(s: ToolSession, slugOrKey: string | undefined, content: unknown, project?: string, expectedHash?: string, drop?: unknown, newState?: boolean): Promise<Record<string, unknown>>;
    /** 0.18 写项目文件夹里的文本文件（合并 / 精简 / 新建）。已存在的要先读全。 */
    write(s: ToolSession, slugOrKey: string | undefined, file: unknown, content: unknown, project?: string, expectedHash?: string): Promise<Record<string, unknown>>;
    private writeRaw;
    /** 0.18 退役项目文件夹里的文件：移到 projects/<p>/inbox/retired/（可恢复）。文本要先读全。 */
    retire(s: ToolSession, slugOrKey: string | undefined, file: unknown, project?: string): Promise<Record<string, unknown>>;
    /** 0.18 导入本机文件（截图 / 日志等，可二进制）到 evidence/。需要新版 ai-memory。 */
    importFile(s: ToolSession, slugOrKey: string | undefined, src: unknown, dest: unknown, project?: string): Promise<Record<string, unknown>>;
    /** 0.18 计划批准后归档到 plans/<日期>-<标题>.md（会话卡片只有一个主 STATE 时）。返回写入结果或 null。 */
    archivePlan(sid: string | undefined, plan: string): Promise<Record<string, unknown> | null>;
    /** 系统提示索引行用：当前版本 hash 与存在的 [必读] 文件。 */
    brief(key: string): {
        hash?: string;
        required: string[];
    };
    /** 手动关联已有会话：它之前读过的 STATE（readKeys）按当前版本记为已知，不重复注入。 */
    seed(sid: string, keys: readonly string[]): void;
    /** 某文件最近一次写入者（ai-memory journal 的 writer）。 */
    private lastWriter;
    /** 会话事件已检查到哪：返回上次位置（第一次见 = undefined，只记下不回溯），并更新为 at。 */
    scannedTo(sid: string, at: number | undefined): number | undefined;
    /** 会话发生了压缩：之前注入 / 读到的全文不算在上下文里了，下一步重新注入最新版。 */
    contextLost(sid: string): void;
    /** 每步调用：会话卡片关联的 STATE 与 [必读] 子文档里，会话上下文还没有当前版本的 → 拼成一条消息返回（null = 都是最新）。 */
    autoRead(sid: string, turn: number, budget?: number): string | null;
    /** 回合要结束时的拉回提示（null = 不拉）。plan = 会话在规划模式。 */
    nudge(sid: string | undefined, plan?: boolean): string | null;
    append(s: ToolSession, file: unknown, text: unknown, project?: string): Promise<Record<string, unknown>>;
    register(projectId: unknown, path: unknown, aliases: unknown, confirm: unknown): Promise<Record<string, unknown>>;
    list(project?: string): Record<string, unknown>;
    validate(): Promise<Record<string, unknown>>;
    private runs;
    /** 信息卡发出「落盘项目 …」后登记（key = 已关联的 STATE；'' = 新建）。 */
    runStart(sid: string, key: string, label: string): LfRun;
    runOf(sid: string): LfRun | undefined;
    runDismiss(sid: string): void;
    /** persist 成功（本会话）：信息卡发起的那一轮算写好了。 */
    private runDone;
    /** 会话的一轮结束（session/event turn/end）：信息卡发起的落盘还没写好 → 按结束原因标出来。asked = 这一轮最后在问用户。 */
    runTurnEnd(sid: string, reason: {
        kind?: string;
        error?: {
            message?: string;
        };
    } | undefined, asked: boolean): void;
    /** 会话里出现了用户消息：是信息卡发出的那条（含名字）→ 之后的回合结束才算这一轮的结局。 */
    runSeen(sid: string, text: string): void;
    /** 用户回了 AI 的问题（新的一轮开始）：等回复 → 继续进行中。 */
    runTurnStart(sid: string): void;
    /** 记下本轮要求。上一轮同样的要求没完成 → streak+1；连续两轮被忽略、本轮又没点名项目 → quiet（不拉回）。 */
    begin(sid: string, turn: number, i: Intent, plan?: boolean): TurnState;
    turnOf(sid: string | undefined): TurnState | undefined;
    mark(sid: string | undefined, want: Want, key?: string): void;
    /** 工具调用旁观：bash 里直接调 ai-memory 写、或者在问用户 → 记下（回忆只认 recall 读全：read 有行数上限会截断）。 */
    observe(sid: string | undefined, name: string, args: Record<string, unknown>): void;
}
