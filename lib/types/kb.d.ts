export type KbType = 'prompt' | 'howto' | 'snippet' | 'domain' | 'business' | 'moc';
export type KbStatus = 'draft' | 'verified' | 'stale';
export declare const KB_TYPES: KbType[];
export declare const KB_STATUSES: KbStatus[];
/** 文件名 = id：只认小写字母数字（newId('k') 生成），也挡住路径穿越。 */
export declare const KB_ID_RX: RegExp;
export declare const KB_MAX_TITLE = 120;
export declare const KB_MAX_SUMMARY = 200;
export declare const KB_MAX_TAGS = 20;
export declare const KB_MAX_TAG_LEN = 30;
/** 正文上限 200 KB（设计卡 §一：一卡一个 md，不做长文仓库）。 */
export declare const KB_MAX_BODY: number;
export interface KbCard {
    id: string;
    title: string;
    type: KbType;
    status: KbStatus;
    tags: string[];
    summary: string;
    /** 仅 moc 汇总卡：子卡 id。 */
    contains: string[];
    /** 平级软链，只存一边（反链由索引算）。 */
    relates: string[];
    created: string;
    updated: string;
    body: string;
    /** <dir>/<id>.md */
    path: string;
    /** 前端不认识的 frontmatter key：原样保留，写回时不丢。 */
    extra?: Record<string, string>;
}
export type KbDraft = Omit<KbCard, 'path'>;
export declare function serializeKb(c: KbCard): string;
/** 解析一张知识卡；frontmatter 坏到没法定位 id 时抛错（KbStore 记进 errors 并跳过这个文件）。 */
export declare function parseKb(text: string, path?: string): KbCard;
/**
 * 校验 + 归一（create / update 唯一入口）。id 缺省 = newId('k')；
 * 越界策略：身份类（id / 标题 / 正文）超限直接拒，展示类（摘要 / 标签）截断。
 */
export declare function cleanKb(input: Partial<KbCard>, now?: string): KbDraft;
type Err = {
    path: string;
    error: string;
};
/**
 * 目录型知识库：一个 md 文件 = 一张卡。写盘一律 tmp + rename（原子）；
 * 外部改了文件，下次 list() 按签名自动重载。
 */
export declare class KbStore {
    readonly dir: string;
    /** 解析失败的文件（不崩：跳过 + 记在这里给 UI / 日志看）。 */
    errors: Err[];
    private cards;
    private sig;
    constructor(dir: string);
    signature(): string;
    /** 全部知识卡（updated 倒序）。 */
    list(): KbCard[];
    get(id: string): KbCard | undefined;
    create(input: Partial<KbCard>): KbCard;
    /** 局部更新；created 不动、updated 刷新；id / path 不接受改动。 */
    update(id: string, patch: Partial<KbCard>): KbCard;
    /** 删除 = 移到 <dir>/.trash/<id>.md（可撤销，与相关说明的 7 秒撤销同一条路）。 */
    remove(id: string): void;
    restore(id: string): KbCard;
    /** 摘要：卡里写了就用它；留空 = 正文去掉 markdown 符号后前 80 字。 */
    summaryOf(c: Pick<KbCard, 'summary' | 'body'>): string;
    private writeCard;
    private reload;
}
export {};
