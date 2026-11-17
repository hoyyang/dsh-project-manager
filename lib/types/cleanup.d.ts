/**
 * v180（0.75.0）清理关联文件 —— 判定口径「一处定义」。
 *
 * 「无用文件」按**文件路径**算（同一路径可能被多张卡片挂着）：
 *   1. 这个路径没有任何**未完成**的任务 / 子任务关联（卡片归档了也一样）；
 *   2. 这个路径没有任何**未归档**卡片关联（只要还有一张活跃卡片挂着它就不算）。
 * 两条都满足才算无用 —— 实际只剩「已归档卡片、且没人再用了」的文件。
 *
 * 行的 reason 只用来解释「为什么不算 / 为什么算」：
 *   arch   = 无用（可清理）
 *   active = 这张卡片还没归档（这一行不自动算无用）
 *   shared = 这一行在归档卡上，但同路径还被活跃卡片挂着
 *   undone = 这一行在归档卡上，但同路径还有未完成任务 / 子任务在用
 *   done   = 卡片未归档 + 本行关联过已完成的任务 / 子任务 + 同路径没有未完成任务 / 子任务（v181 可手动清理）
 *
 * 只处理「在卡片关联的落盘项目文件夹里」的文件（dirsOf 由调用方给：卡片 ∪ 卡片组的落盘项目目录）；
 * 不在范围里的文件进 outside（界面只展示计数，不可选，也不动）。
 */
import type { Board, Card } from './model.js';
export type CleanupReason = 'arch' | 'active' | 'shared' | 'undone' | 'done';
export interface CleanupBind {
    id: string;
    text: string;
    done: boolean;
    sub: boolean;
}
export interface CleanupRow {
    /** cardId + '|' + fileId（前端选择集用它） */
    key: string;
    cardId: string;
    cardTitle: string;
    groupId: string;
    groupName: string;
    archived: boolean;
    archivedAt: string;
    fileId: string;
    name: string;
    path: string;
    size: number;
    exists: boolean;
    binds: CleanupBind[];
    useless: boolean;
    reason: CleanupReason;
    /** 同路径还有几张未归档卡片 */
    pathActive: number;
    /** 同路径还有几个未完成任务 / 子任务 */
    pathUndone: number;
    /** 同路径一共有几个已完成的任务 / 子任务（v181） */
    pathDone: number;
    /** 同路径一共被几张卡片挂着（>1 = 删文件会打断别的卡片 → 只解除关联） */
    pathCards: number;
}
export interface CleanupOutside {
    cardId: string;
    cardTitle: string;
    name: string;
    path: string;
    why: string;
}
export interface CleanupCounts {
    all: number;
    useless: number;
    done: number;
    arch: number;
    busy: number;
    missing: number;
}
export interface CleanupScan {
    rows: CleanupRow[];
    outside: CleanupOutside[];
    counts: CleanupCounts;
    /** 无用文件里还能真删掉（存在、且没有被别的卡片挂着）的字节数 */
    uselessSize: number;
    totalSize: number;
}
export interface CleanupInfo {
    size: number;
    exists: boolean;
}
export declare const baseName: (p: string) => string;
/** 文件在不在某个目录下（不要求目录存在，纯字符串；目录结尾的 / 去掉）。 */
export declare const underDir: (path: string, dir: string) => boolean;
/** 这棵任务树里绑了 fileId 的任务 / 子任务（sub = 是否子任务）。 */
export declare function bindsOf(c: Card, fileId: string): CleanupBind[];
export declare function cleanupRows(b: Board, dirsOf: (c: Card) => string[], sizeOf?: (path: string) => CleanupInfo): CleanupScan;
/** 删除动作对一条路径到底能做什么：没有文件（已丢失）/ 别的卡片也在用 → 只能解除关联。 */
export declare const canTrash: (r: CleanupRow) => boolean;
