/**
 * 0.31 任务日程看板（甘特图）：数据口径 + 纯变更逻辑（无 IO，便于单测）。
 *
 * 口径（notes/0.31-gantt-design.md 第九节；v96 起计划条只认手动）：
 * - 计划条逐日：只认手动设置 / 拖动过的日子（没有默认段，不跟今天长）。
 * - 实际条逐日：会话自动（严格 24h 内有对话）∪ 手动记录（actual）；autoOff = 这天被手动动过 → 自动失效。
 * - 截止时间 { at, label }；三条边的宽度存 ui.{lw,tpw,dw}。
 */
import type { Board, BoardEvent, Card, Task } from './model.js';
export declare const DAY = 86400000;
/**
 * 截止时间（v99：同一天可以有多个，分硬性 / 软性）。
 * - id：稳定身份（老数据没有 → 用 at 当 id）；客户端增删改都按 id 走，同一天多条不会串。
 * - kind：hard = 外部严格截止（红旗 / 红虚线）；soft = 内部可调（浅橙旗 / 浅橙虚线）。老数据没有 → hard。
 */
export interface DdlRep {
    unit: 'day' | 'week' | 'month';
    n: number;
    until?: string;
}
export interface GanttDDL {
    id?: string;
    at: string;
    kind?: 'hard' | 'soft';
    label?: string; /** v137：来自任务 / 子任务截止的派生条目（task = 任务 id，done = 任务已完成）；不落盘，拖动 / 删除 = 改 task.due。 */
    task?: string;
    done?: boolean; /** v101：同一条重复截止的系列 id（没有 = 单条）。 */
    sid?: string; /** v101：重复规则（每天 / 每周 / 每月 + 直到）。 */
    rep?: DdlRep;
}
/**
 * v105 每日任务面板的按天状态（落到看板，刷新不丢）：
 * - done = 这天勾选「完成」的任务项 key（p|卡片 / t|卡片|任务 / s|卡片|子任务）
 * - sel  = 这天「排今天」选中的任务项 key（进「任务执行安排」）
 * - lanes = 执行安排的行（行内多项 = 并行）
 * 执行中 / 已暂停是运行态，只存内存（不进这里）。
 */
export type PanelSt = 'run' | 'pause' | 'wait';
/** v121–v123 任务执行安排的分区：本日已执行 / 等外部进展 / 个人暂停 / 执行中 / 已安排 / 未安排。 */
export type PanelZone = 'done' | 'wait' | 'pause' | 'run' | 'arr' | 'un';
export declare const ZL_KEYS: readonly ["pause", "wait", "run", "un"];
export interface PanelDay {
    done?: string[];
    sel?: string[];
    lanes?: string[][];
    /** v110：执行中 / 已暂停（落盘的运行态；key 与 done/sel 同一口径）。v121 起多一个 wait = 等外部进展。 */
    pst?: Record<string, PanelSt>;
    /** v111：这一天已经跑过「自动续排」；只跑一次，用户取消后不会自己回来。 */
    carry?: boolean;
    /** v122/v123：个人暂停 / 等外部进展 / 执行中 / 未安排 四个分区的行（同一行 = 并列），已安排用 lanes。 */
    zl?: Partial<Record<(typeof ZL_KEYS)[number], string[][]>>;
    /** v122：记录执行的时间（本日已执行按它排，早的在上）。 */
    doneAt?: Record<string, number>;
    /** v123：记录执行那一刻卡片在哪个分区（点「已执行」撤销时回到这里）。 */
    from?: Record<string, PanelZone>;
}
export interface CardGantt {
    /**
     * 手动设置 / 拖动过的计划日（完整逐日集合）。v96 起计划条只认它：
     * 没有这个字段 = 计划条为空；空数组也算「用户就是要没有计划」。
     */
    plan?: string[];
    /** 手动记录的执行日。 */
    actual?: string[];
    /** 这天被手动动过（勾上 / 取消都算）→ 会话自动失效。 */
    autoOff?: string[];
    ddl?: GanttDDL[];
}
export interface GanttUI {
    lw?: number;
    tpw?: number;
    dw?: number; /** v98：日程管理条「显示 / 隐藏项目组时间」（默认隐藏）。 */
    gtime?: boolean; /** v105：面板两块卡片的高度比（上面那块占的百分比，5–95；没有 = 3:2；v130 起拖动范围到两端收起态）。 */
    tpr?: number; /** v110：甘特图是否显示 pending 项目（目录 + 时间轴；默认 true）。 */
    pend?: boolean; /** v118：本日计划清单是否收起（只留标题栏；默认收起）。 */
    pfold?: boolean; /** v118：本日计划清单是否「只显示可安排」（默认开）。 */
    plonly?: boolean;
    /** v121：本日计划清单「只显示本日完成」（默认关；与 plonly 互斥）。 */ pldone?: boolean;
    /** v121：本日计划清单里收起的行（项目组 g| / 项目 p| / 任务 t| 的 key；跨天稳定）。 */ plclosed?: string[];
    /** v124：已完成任务里用户点开过的（默认折叠）。 */ plopen?: string[];
    /** v124：任务执行安排里收起的分区（没有 = 默认只收「本日已执行」）。 */ exz?: string[];
    /** v130：两张卡（执行安排 / 计划清单）的开合 —— ex = 只开执行安排（默认）、pl = 只开计划清单、split = 两张都开（比例 = tpr）。 */ tpm?: 'ex' | 'pl' | 'split';
}
export interface GanttState {
    cards: Record<string, CardGantt>;
    ui?: GanttUI;
    /** v105：每日任务面板按天状态（勾选 / 选中 / 排布）—— 一天一份，key 用的是全局任务项 key。 */
    panels?: Record<string, PanelDay>;
}
/** 本地日（与界面一致；跨时区按用户机器）。 */
export declare const ymd: (ms: number) => string;
export declare const dayMs: (key: string) => number;
/** 合法日：格式对、且回写一致（挡掉 2026-02-31 这类会被 Date 归一化的值）。 */
export declare const isDay: (v: unknown) => v is string;
export declare const todayKey: (now?: number) => string;
export declare function cardCreated(c: Card): number;
/** 这段卡片的「归档 / 恢复」历史（events.jsonl 的 card/archive、card/unarchive，按时间升序）。 */
export declare function archiveTimes(events: BoardEvent[], cardId: string): Array<{
    at: number;
    on: boolean;
}>;
/** 有效计划日：只认手动设置 / 拖动过的日子（v96 起没有默认段）。 */
export declare function planDays(_c: Card, st: CardGantt | undefined, _events?: BoardEvent[], _now?: number): Set<string>;
/** 有效实际日：{day → src}；autoOff 的会话自动失效，手动记录优先。 */
export declare function actualDays(st: CardGantt | undefined, auto: Iterable<string>): Map<string, 'auto' | 'manual'>;
/** 手动改一天计划：以当前集合为底，改完存成完整逐日集合。 */
export declare function applyPlanDay(st: CardGantt, cur: Set<string>, key: string, on: boolean): string[];
/** 手动改一段（拖把手）：from 含、to 不含（yyyy-mm-dd）。 */
export declare function applyPlanRange(st: CardGantt, cur: Set<string>, from: string, to: string, on: boolean): string[];
/** 任意入口（格子小窗 / 任务面板）的手动改执行：先关掉这天的会话自动，再写 / 删手动记录。 */
export declare function setActualDay(c: CardGantt, key: string, on: boolean): void;
/** 这张卡片合法的任务项 key（p|卡片 / t|卡片|任务 / s|卡片|子任务）；非法 key 一律挡在写盘外。 */
export declare function taskKeySet(c: Card): Set<string>;
/** 多张卡片合起来的合法任务项 key（写入时挡掉过期 / 伪造的 key）。 */
export declare function taskKeySetAll(cards: Card[]): Set<string>;
/** 写一天的面板状态（done / sel / lanes 都可单独传；空 = 删掉那一项）。非法 key 丢弃，不报错。 */
export declare function setPanelDay(st: GanttState, key: string, patch: Record<string, unknown>, valid: Set<string>): PanelDay | null;
export declare const ddlIdOf: (d: GanttDDL) => string;
export declare const ddlKindOf: (d: GanttDDL) => "hard" | "soft";
/** 加一条截止时间（同一天可以加多个）；返回新条目。 */
export declare function addDdl(c: CardGantt, key: string, kind?: 'hard' | 'soft', label?: string): GanttDDL;
export declare const DDL_REP_MAX = 120;
/** 重复展开的窗口上界（今天 + 400 天；再远不铺，避免把状态写爆）。 */
export declare const DDL_REP_HORIZON = 400;
/** 按单位往后走 n 步（月会夹到月末，避免 1/31 + 1 月跳到 3/3）。 */
export declare function repStep(key: string, unit: DdlRep['unit'], n?: number): string;
export interface DdlRepInput {
    unit: DdlRep['unit'];
    n?: number;
    until?: string;
}
/**
 * 加一条（或按规则展开成多条）截止时间。
 * - 没有 rep / rep.unit 非法 → 就是一条，行为与 v99 一致；
 * - 有 rep → 从 key 起按 unit 走，直到 until（含当天）或 +400 天 / 120 条封顶；每条共享 sid。
 */
export declare function addDdlRepeat(c: CardGantt, key: string, kind?: 'hard' | 'soft', label?: string, rep?: DdlRepInput): GanttDDL[];
/**
 * 删重复截止：scope = one（只这条）/ after（这条及以后）/ all（整个系列）。
 * 没有 sid 的条目等价于 one。返回值 = 实际删掉的条数。
 */
export declare function removeDdlScoped(c: CardGantt, id: string, scope?: 'one' | 'after' | 'all'): number;
/** 改一条：日期 / 类型 / 备注（label 传空字符串 = 清掉备注）。找不到 → null。 */
export declare function updateDdl(c: CardGantt, id: string, patch: {
    at?: string;
    kind?: 'hard' | 'soft';
    label?: string;
}): GanttDDL | null;
/** 删一条（按 id；兼容老数据把 at 当 id）。 */
export declare function removeDdl(c: CardGantt, id: string): boolean;
/** 三条边的宽度（越界夹紧；null / undefined = 复位回默认，删掉这一项）。 */
export declare function setUi(g: GanttState, patch: Record<string, unknown>): GanttUI;
/** 卡片组里干活的任务数（叶子任务完成 / 全部）。 */
export declare function taskStats(tasks: Task[]): {
    done: number;
    total: number;
};
export interface GanttCardOut {
    id: string;
    g: string;
    t: string;
    stage: string;
    done: number;
    total: number;
    created: string;
    archivedAt?: string;
    /** v86：与项目看板一致的展示顺序（阶段序号 × 1000 + 列内 order）。 */
    seq: number;
    /** v86：pending 卡片不进日程（行、计数、组统计都不算）。 */
    pending?: boolean;
    plan: string[];
    actual: Array<{
        day: string;
        src: 'auto' | 'manual';
    }>;
    ddl: GanttDDL[];
    /** 会话自动涂上的原始日子（任务面板「执行 · 会话」标签与提示用）。 */
    auto: string[];
    /** 手动动过、已关掉会话自动的日子（小窗文案「这天的会话自动已关闭」用）。 */
    autoOff: string[];
    /** v105：卡片任务（任务面板「本日计划清单」要用；子任务只取一层，与详情一致）。 */
    tasks: Array<{
        id: string;
        text: string;
        done: boolean;
        due?: string;
        sess?: string;
        subs: Array<{
            id: string;
            text: string;
            done: boolean;
            due?: string;
            sess?: string;
        }>;
    }>;
}
export interface GanttGroupOut {
    id: string;
    name: string;
    upd: number;
    archivedAt?: string;
    stages: Array<{
        id: string;
        name: string;
    }>;
    collapsed?: boolean;
}
export interface GanttPayload {
    rev: string;
    today: string;
    groups: GanttGroupOut[];
    cards: GanttCardOut[];
    /** v105：每日任务面板按天状态（勾选 = 当天完成 / 选中 = 排今天 / 排布）。 */
    panels: Record<string, PanelDay>;
    ui: GanttUI;
    /** 会话查询不可用 / 某些会话读失败：界面点名提示，不静默退化。 */
    degraded: string[];
}
/** v133 R1：快照版本号只看会显示的数据 —— 降级原因（统计实况，各轮顺序 / 内容会抖）不进 rev，否则 5s 轮询每次都整页重画。 */
export declare function revOf(body: Omit<GanttPayload, 'rev'>): string;
/** v137：任务截止旗的 id 前缀（ddl-move / ddl-del 见到它就改 task.due）。 */
export declare const TASK_DDL = "tk:";
/** v137：任务 / 子任务的截止 = 卡片的一个截止时间（派生，不另存）；label = 任务名（子任务 = 父任务 › 子任务）。 */
export declare function taskDdl(c: Card): GanttDDL[];
/** 组行 = 子卡并集（计划 / 实际 / 截止日都取并集），客户端按天数组自己算。 */
export declare function payload(b: Board, g: GanttState, auto: Record<string, string[]>, degraded: string[], events?: BoardEvent[], now?: number): Omit<GanttPayload, 'rev'>;
/** 纯函数：把 events.jsonl 文本解析成事件（非法行忽略）。 */
export declare function eventsFromText(text: string): BoardEvent[];
