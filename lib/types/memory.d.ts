/**
 * 会话记忆注入文本：卡片组 ∪ 卡片关联的落盘项目 → 摘要（状态 / next_action / STATE 路径）。
 * 字节预算默认 6000；超出时从后往前省略并注明，保证模型知道还有哪些 STATE 可以自己去读。
 */
import { Board, Card } from './model.js';
import { StateCatalog } from './states.js';
export declare function memoryText(b: Board, c: Card, states: StateCatalog, maxBytes?: number, readKeys?: readonly string[]): string;
