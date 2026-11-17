/**
 * v163 / S2：知识卡检索（设计卡 §五）。宿主纯逻辑：不碰路由 / 工具 / UI / board.json。
 * 名称类（标题 / 标签 / 摘要）：复用 src/search.ts 的 matchField（全等 / 前缀 / 包含 / 子序列 / 1 字容错）叠加加分。
 * 正文：内存 BM25（k1=1.2, b=0.75），中文二元切词（单字 run 保留一元）、英文 / 数字按词；
 * 字段权重 标题 ×3 / 标签 ×2 / 摘要 ×1.5 / 正文 ×1；过时 ×0.5。零依赖，千卡级毫秒内。
 * 向量 v1 不做：score(card, q) 是第二路叠加点（见函数注释）。
 */
import type { KbCard, KbStatus, KbType } from './kb.js';
export type KbHitField = '标题' | '标签' | '摘要' | '正文';
export interface KbSearchItem {
    id: string;
    score: number;
    hit?: KbHitField;
}
export interface KbSearchOpts {
    type?: KbType;
    tag?: string;
    status?: KbStatus;
    limit?: number;
}
/**
 * 切词：NFKC + 小写归一（归一效果与 search.ts 的 norm 相同；不直接复用 norm 是因为它会把空格也删掉，
 * 英文多词 'npm run build' 会粘成 'npmrunbuild' 永远查不中），然后按 run 切：
 * 连续汉字切二元（单字 run 保留一元），英文 / 数字按词，其它字符当分隔符。
 */
export declare function grams(text: unknown): string[];
interface FieldTf {
    tf: Map<string, number>;
    len: number;
}
interface DocTf {
    title: FieldTf;
    tags: FieldTf;
    summary: FieldTf;
    body: FieldTf;
    len: number;
}
/** ponytail: 向量 v3 可选开关 —— score(card, q) 是第二路叠加点：0 = 不相关，正值 = 词面相关分；未来向量检索的分值可与它加权合并进 searchKb 排序（无语料，idf 取 1、avg 取本文档长度）。 */
export declare function score(card: KbCard, q: string): number;
export interface KbDoc {
    card: KbCard;
    dt: DocTf;
}
export interface KbIndex {
    docs: Map<string, KbDoc>;
    df: Map<string, number>;
    n: number;
    avgLen: number;
}
/** 倒排 df + 文档长度；千卡级全量重建毫秒内，调用方在卡集合变化后重建即可。 */
export declare function buildKbIndex(cards: KbCard[]): KbIndex;
/** 空查询 = 浏览态：受筛选的全量按 updated 倒序（score 0、无 hit）；非空 = BM25 + 名称叠加，stale ×0.5，按分数降序。 */
export declare function searchKb(index: KbIndex, q: unknown, opts?: KbSearchOpts): KbSearchItem[];
export {};
