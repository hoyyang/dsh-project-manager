/**
 * 安全裁剪：按 UTF-16 单元切字符串，但**不劈开代理对**。
 *
 * 为什么要有这个（2026-10-22 活体事故 dsh-harness-guard 一并取证）：JS 的
 * `slice(0, n)` 切的是 UTF-16 单元，n 恰好落在一个 emoji（代理对）中间时，
 * 结果里就出现「孤立代理项」。JSON.stringify 会把它序列化成 `\ud83d`——
 * 无效 JSON，网关解析失败直接 400，而且这个坏字符串会留在会话历史里，让
 * 该会话之后每一轮都失败。模型可见的每一处截断都必须走这里。
 */
/** 截到至多 max 个单元，且不把代理对劈成两半（多让一个字符，不劈）。 */
export declare function clip(text: string, max: number): string;
/** 把「从 index 处切开」改成安全切点：index 恰好落在代理对中间时前移一格。 */
export declare function safeBoundary(text: string, index: number): number;
/** 文本里有没有孤立代理项（自检 / 诊断用）。 */
export declare function hasLoneSurrogate(text: string): boolean;
