/**
 * 0.18 会话注入与卡片档案（纯函数）。
 * - cardSection：卡片档案（实时）——系统提示里唯一的一份卡片资料，每步按看板现生成。
 * - cardBlock：写进 STATE 的「卡片档案块」（按看板生成、AI 不写）；stripBlock / placeBlock / maskBlock 处理它。
 * - memoryText：系统提示单段 = 卡片档案（实时）+ 记忆索引（每个关联落盘项目一行摘要 + 版本）。STATE 全文不进系统提示，
 *   由 landfill.autoRead 在会话里注入最新版（见 landfill.ts）。
 */
import { Board, Card, memoryOf } from './model.js';
import type { StateInfo } from './states.js';
export declare const BLOCK_TITLE = "## \uD83D\uDDC2 \u5361\u7247\u6863\u6848\uFF08dsh-project-manager \u6309\u770B\u677F\u751F\u6210\uFF0C\u52FF\u624B\u6539\uFF1B\u4EE5\u770B\u677F\u4E3A\u51C6\uFF09";
export declare const MASK = "\uFF08\u672C\u5361\u7247\u7684\u5361\u7247\u6863\u6848\u89C1\u7CFB\u7EDF\u63D0\u793A\u300C\u5361\u7247\u6863\u6848\uFF08\u5B9E\u65F6\uFF09\u300D\uFF0C\u8FD9\u91CC\u7701\u7565\u4EE5\u514D\u91CD\u590D\uFF09";
export interface CardOpts {
    notesMax: number;
    maxItems?: number;
    mounts?: ReadonlyMap<string, string>;
    boardPath?: string;
}
/** 一张卡片的档案正文（不含标题）：位置、上级总览、仓库、子任务、链接、文件、说明。 */
export declare function cardLines(b: Board, c: Card, o: CardOpts, skipKey?: string): string[];
/** 系统提示里的卡片档案（实时）。 */
export declare function cardSection(b: Board, c: Card, notesMax?: number): string;
/** 写进 STATE 的卡片档案块；没有任何卡片 / 卡片组关联这个 key → 空串。卡片级最多 5 张。 */
export declare function cardBlock(b: Board, key: string, at: string, boardPath?: string): string;
/**
 * 档案块在文本里的位置 [起, 止)（含标题行与结尾换行）；没有 → null。
 * 只认独占一行的开始标记（<!-- dpm:card v<n> key=…）和独占一行的结束标记：正文里引用标记文字不算（0.18 门 12 实测误删半节）；
 * 没有结束标记 = 不是完整的块，不动。
 */
export declare function blockRange(text: string): [number, number] | null;
export declare const blockOf: (text: string) => string;
/** 去掉档案块（及其后多出的一个空行）。 */
export declare function stripBlock(text: string): string;
/** 比较两块是否等价（忽略 synced 时间）。 */
export declare const sameBlock: (x: string, y: string) => boolean;
/** 档案块写的是哪些卡片。 */
export declare function blockCards(text: string): string[];
/** 剥旧块，插到「重启读取清单」那一节后面（没有就插在标题行后）；block 为空 = 只剥。 */
export declare function placeBlock(draft: string, block: string): string;
/** 原文 [o,e) 这一段里，若含本卡片的档案块 → 换成一行占位（区间仍按原文计）。cardId 不在块里 = 原样。 */
export declare function maskBlock(text: string, o: number, e: number, cardId?: string): string;
/** full = 插件会把全文注入会话（索引只放稳定字段：key / 路径 / 必读，避免每次落盘都让系统提示变化、整段重发）。 */
export interface IndexInfo {
    key: string;
    from: 'group' | 'card' | 'both';
    state?: StateInfo;
    required?: string[];
    full?: boolean;
}
/** 系统提示单段：卡片档案（实时）+ 记忆索引。索引按字节预算从后往前省略并注明。 */
export declare function memoryText(b: Board, c: Card, index: IndexInfo[], maxBytes?: number, notesMaxBytes?: number): string;
export { memoryOf };
