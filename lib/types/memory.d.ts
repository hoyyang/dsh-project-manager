/**
 * 会话注入文本 = 两段：
 * 1) 项目记忆：卡片组 ∪ 卡片关联的落盘项目 → 摘要（状态 / next_action / STATE 路径），字节预算 maxBytes，超出从后往前省略并注明；
 * 2) 卡片资料（0.10）：相关说明全文 + 相关链接（显示文字 + 网址）+ 相关文件绝对路径；没有任何资料时不出现。
 *    说明超过 notesMaxBytes 时截断并注明（链接、文件是短列表，全部列出）。
 */
import { Board, Card } from './model.js';
import { StateCatalog } from './states.js';
export declare function memoryText(b: Board, c: Card, states: StateCatalog, maxBytes?: number, readKeys?: readonly string[], notesMaxBytes?: number): string;
/** 卡片资料（相关说明 / 相关链接 / 相关文件）；三者都没有 → 空串。 */
export declare function materialsText(c: Card, notesMaxBytes?: number): string;
