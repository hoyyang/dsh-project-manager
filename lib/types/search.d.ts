/**
 * v158：项目看板搜索的纯逻辑（归一 / 分词 / 匹配 / 排序 / 建议），不碰 DOM、不调模型。
 * 渲染在 src/client/search.ts；单测 test/v158.test.mjs 直接 import 本文件编译产物。
 */
export type Scope = 'all' | 'live' | 'arch';
export type TypeF = 'all' | 'card' | 'group' | 'lf';
/** v178：搜索维度（标题维度 = v158 那套卡片元信息；其余 = 卡片内容）。 */
export type Dim = 'title' | 'task' | 'note' | 'link' | 'file' | 'kb' | 'lf';
export type DimF = 'all' | Dim;
export declare const DIM_ORDER: Dim[];
export declare const DIM_NAME: Record<Dim, string>;
/** 前缀定维：任务: / 子任务: / 说明: / 链接: / 文件: / 知识卡: / 标题: / 落盘项目: */
export declare const PREFIX: Array<[string, Dim]>;
interface STask {
    id?: string;
    text?: string;
    done?: boolean;
    note?: string;
    subs?: Array<{
        text?: string;
        note?: string;
    }>;
}
interface SNote {
    t: string;
    v?: string;
}
interface SLink {
    id?: string;
    text: string;
    url: string;
    type?: string;
    tag?: string;
}
interface SFile {
    id: string;
    path: string;
    title?: string;
}
/** 搜索用的最小数据结构（client 的 api.ts 类型、host 的 model.ts 类型都结构化满足）。 */
export interface SearchCard {
    id: string;
    g: string;
    col: string;
    order: number;
    t: string;
    links?: string[];
    tasks: STask[];
    archivedAt?: string;
    pending?: boolean;
    noteItems?: SNote[];
    webLinks?: SLink[];
    files?: SFile[];
    kb?: Array<{
        id: string;
    }>;
}
export interface SearchKb {
    id: string;
    title: string;
    summary?: string;
    tags?: string[];
    type?: string;
}
export interface SearchGroup {
    id: string;
    name: string;
    links?: string[];
    statuses: Array<{
        id: string;
        name: string;
    }>;
    archivedAt?: string;
}
export interface SearchState {
    key: string;
    project: string;
    slug: string;
    status: string;
    updated: string;
    aliases?: string[];
}
export interface SearchInput {
    groups: SearchGroup[];
    cards: SearchCard[];
    states: SearchState[]; /** v178：挂载的知识卡（/kb 列表；没加载到时 kb 维度记 0，不阻塞其它维度） */
    kb?: SearchKb[]; /** v178：快照版本（索引按它记忆化：同版本不重建 1.4k 个字段） */
    rev?: number;
}
export interface LfInfo {
    key: string;
    project: string;
    slug: string;
    status: string;
    updated: string;
    aliases: string[];
}
export interface FieldMatch {
    score: number;
    ranges: Array<[number, number]>;
    fuzzy: boolean;
}
export interface Hit {
    ranges: Array<[number, number]>;
    fuzzy: boolean;
    label: string;
    lfKey: string;
    src: string;
}
export interface LabelHit {
    label: string;
    lfKey: string;
    fuzzy: boolean;
}
export interface Field {
    id: string;
    label: string;
    text: string;
    src: string;
    norm: string;
    map: number[];
    w: number;
    lfKey: string;
    strict: boolean; /** v178：这一条属于哪个维度（缺省 = title） */
    dim?: Dim;
}
/** v178：一条「内容命中」——维度 + 来源标签 + 原文 + 命中区间（原文坐标）。 */
export interface ContentHit {
    fid: string;
    dim: Dim;
    label: string;
    text: string;
    ranges: Array<[number, number]>;
    w: number;
    fuzzy: boolean;
}
export interface Snip {
    text: string;
    ranges: Array<[number, number]>;
    head: boolean;
    tail: boolean;
}
export interface MemLink {
    key: string;
    from: 'card' | 'group' | 'both';
    arch: boolean;
}
export interface Entry {
    kind: 'card' | 'group' | 'lf';
    id: string;
    key?: string;
    card?: SearchCard;
    group?: SearchGroup;
    lf?: LfInfo;
    mem?: MemLink[];
    linked?: Array<{
        card: SearchCard;
        group: SearchGroup;
        from: 'card' | 'group';
    }>;
    n?: number;
    liveN?: number;
    arch: boolean;
    scope: 'live' | 'arch';
    titleText: string;
    ord: number;
    fields: Field[];
    updated?: string;
}
export interface Row {
    entry: Entry;
    score: number;
    fields: Record<string, Hit>;
    labels: LabelHit[];
    fuzzy: boolean; /** v178：内容命中（同一张卡的多个任务 / 多个链接都收；上限 18） */
    content?: ContentHit[];
}
export interface SearchModel {
    q: string;
    tokens: string[];
    all: Entry[];
    base: Row[];
    counts: {
        all: number;
        live: number;
        arch: number;
    };
    typeCounts: {
        all: number;
        card: number;
        group: number;
        lf: number;
    };
    totals: {
        all: number;
        card: number;
        group: number;
        lf: number;
    };
}
export declare function norm(s: unknown): {
    out: string;
    map: number[];
    src: string;
};
export declare const key: (s: unknown) => string;
export declare function tokens(q: unknown): string[];
export declare function lev(a: string, b: string, max: number): number;
export declare function subseq(field: string, tok: string): number[] | null;
export declare function typos(field: string, tok: string): {
    start: number;
    len: number;
} | null;
export declare function field(id: string, label: string, text: unknown, w: number, lfKey?: string, strict?: boolean, dim?: Dim): Field;
/**
 * v178：一张卡片的「内容字段」——任务 / 任务说明 / 子任务 / 子任务说明 / 相关说明 / 相关链接 / 相关文件 / 挂载知识卡。
 * 只给非空字段建 Field（空字段不该命中）；说明正文截前 4000 字（命中片段本来也只给 200 字内）。
 */
export declare function contentFields(c: SearchCard, kbOf?: (id: string) => SearchKb | undefined): Field[];
/** v178：整份索引里各类内容条数（空态「能搜什么」用）。 */
export declare function contentTotals(input: SearchInput): Record<'task' | 'sub' | 'note' | 'link' | 'file' | 'kb', number>;
export declare function kbIndex(input: SearchInput): ((id: string) => SearchKb | undefined);
/** v178：查询里的前缀（「任务:回归」）—— 只定维度，不改变关键词。 */
export declare function parseQuery(q: unknown): {
    dim: Dim | null;
    text: string;
    pre: string;
};
/** 单字段匹配：全等 112 / 前缀 86 / 包含 62（词边界 +6）> 子序列（34 起）> 容错 26；strict 只做精确 + 包含。 */
export declare function matchField(f: Field, tok: string): FieldMatch | null;
export declare function groupArchived(g: SearchGroup, cards: SearchCard[]): boolean;
export declare function stageOf(g: SearchGroup, c: SearchCard): string;
export declare function buildEntries(input: SearchInput): Entry[];
export declare function matchEntry(e: Entry, toks: string[]): Row | null;
export declare function rank(a: Row, b: Row): number;
export declare function browseRank(a: Row, b: Row): number;
export declare function model(input: SearchInput, q: string): SearchModel;
/** v178：这一行命中了哪些维度。 */
export declare function rowDims(r: Row): Dim[];
export declare function dimCounts(rows: Row[]): Record<DimF, number>;
/** v178：命中片段 —— 窗口切在第一个命中前面一点，命中字带区间，过长两头省略。 */
export declare function snip(text: unknown, ranges: Array<[number, number]>, before?: number, max?: number): Snip;
export declare function filtered(m: SearchModel, scope: Scope, type: TypeF, dim?: DimF): Row[];
/** v178：一行里按当前维度该显示哪些内容命中（维度筛选时只显示这一类）。 */
export declare function shownHits(r: Row, dim?: DimF): ContentHit[];
export declare function rowList(list: Row[]): Row[];
export declare function lcs(a: string, b: string): number;
export declare function suggest(q: string, all: Entry[], limit?: number): Array<{
    e: Entry;
    sc: number;
}>;
export {};
