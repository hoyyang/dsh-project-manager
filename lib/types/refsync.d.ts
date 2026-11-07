import type { Board, FileRef } from './model.js';
/**
 * 一条相关文件改了路径：全看板说明里指向旧路径的文件引用改成新路径（标题一起改）。返回改动处数。
 * 从别的卡片引用同一个文件也一起改（路径映射是全局的，语义一致）。
 */
export declare function syncFileRefs(b: Board, f: FileRef, oldPath: string): number;
/**
 * 启动修复：说明里写着旧路径的文件引用，改到卡片现在记的路径。
 * 只认三种情况（其余一律不动，避免猜错）：
 *  - 路径已经是卡内某个文件的当前路径 → 不动；
 *  - 旧路径命中某个文件的 prev（v151 起搬家会记）→ 改；
 *  - 旧路径在磁盘上已不存在、且按文件名归一（空格 / 连字符）在卡内唯一命中 → 改。
 * 幂等：修完再跑 = 0 处改动（调用方据此决定写不写盘）。
 */
export declare function repairBoardRefs(b: Board): {
    changed: number;
    cards: number;
};
