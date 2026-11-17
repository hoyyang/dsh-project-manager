export interface QpSec {
    /** 段标题（默认段 = ''） */
    t: string;
    /** 段正文（首尾空行已去掉；无标题分割线原样保留） */
    body: string;
    /** 去掉空白后的字数（面板上的「N 字」） */
    n: number;
    /** 正文第一行非空内容，截 58 字（面板预览） */
    prev: string;
    /** 段序号（0 = 默认段） */
    i: number;
    /** 实际注入的文本（段头 + 这一段正文，见 sectionText） */
    ins: string;
}
/** 带标题的分割线：≥4 个 `─`/`—`，中间夹标题；只有横线的 = 无标题分割线。 */
export declare const DIV_RX: RegExp;
/** 段头的两种身份：任务 / 子任务说明（`──── 标题 ────`）与知识卡（出处行）。 */
export type SecKind = 'task' | 'kb';
export interface SecMeta {
    kind: SecKind;
    /** kind = kb 时要：知识卡标题 / 路径（拼出处行） */
    title?: string;
    path?: string;
}
/** 段头（没有就是 ''）：任务 / 子任务 = 真分割线；知识卡 = 出处行（画成引用原文同款）。 */
export declare function sectionHead(meta: SecMeta, t: string): string;
/** 点某一段实际注入的文本：知识卡一定带出处行；任务 / 子任务只有带标题的段才加段头。 */
export declare function sectionText(meta: SecMeta, sec: {
    t: string;
    body: string;
}): string;
/** 正文 → 分段（不分段返回 []）。 */
export declare function splitSections(text: string | null | undefined, meta: SecMeta): QpSec[];
/** 一段的匹配文本（筛选：段标题 + 段正文都进 hay，设计卡 §3.5）。 */
export declare const secHay: (secs: readonly QpSec[]) => string;
