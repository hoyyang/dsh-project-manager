export declare const SPEC_VERSION = 2;
export interface SpecCtx {
    /** 这份 STATE 现在所在的项目（~/.ai/projects/<project>）。 */
    project: string;
    slug: string;
    /** 关联它的卡片组的落盘文件夹（项目 id）。 */
    homes: string[];
    /** 不在 homes 里时要迁去的项目（第一个关联它的卡片组的落盘文件夹）。 */
    home?: string;
    /** 关联它的卡片名（别名行要包含能当名字用的那些）。 */
    cards: string[];
    /** 用户撤销过迁移：留在原处，不再提示迁移。 */
    stay?: boolean;
}
export interface SpecIssue {
    id: string;
    since: number;
    by: 'plugin' | 'ai';
    text: string;
    fix: string;
}
/** 能当别名的名字（与 states.ts 解析 aliases 行的规则一致）。 */
export declare const ALIAS_OK: RegExp;
export declare function aliasLine(text: string): string[] | null;
export declare function missingAliases(text: string, c: Pick<SpecCtx, 'cards' | 'slug'>): string[];
/** 这份 STATE 不合现行规范的地方。 */
export declare function specIssues(text: string, c: SpecCtx): SpecIssue[];
/** 给 AI 的一段话（落盘提示里附带；persist 被 SPEC_ISSUES 拒时也返回它）。 */
export declare function specHint(key: string, issues: SpecIssue[]): string;
/** 卡片组落盘文件夹的默认名：组名里的英文 / 数字（小写、- 连接）；没有就用组 id；和已有项目重名加后缀。用户确认时可改。 */
export declare function suggestFolder(groupName: string, groupId: string, taken: readonly string[]): string;
export declare const normName: (s: string) => string;
export declare function lev(a: string, b: string): number;
export type MatchMode = 'hint' | 'exact' | 'near' | 'none';
export interface MatchHit {
    key: string;
    why: string;
}
/**
 * 同名检测。q = 输入框原文（空格分隔：第一个不含中文的是文件名，其余是别名）。
 * - 空：按卡片名找「可能就是这个」（slug 或别名等于卡片名）
 * - exact：任一名字等于某个 slug 或别名（同名不能再新建）
 * - near：文件名 ≥3 字符且被某个 slug 包含，或（≥5 字符时）与 slug 相差 ≤2 个字符；最多 3 个
 */
export declare function matchStates(q: string, states: ReadonlyArray<{
    key: string;
    slug: string;
    aliases?: readonly string[];
}>, cardTitle: string): {
    mode: MatchMode;
    hits: MatchHit[];
};
