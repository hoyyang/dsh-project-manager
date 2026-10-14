import type { BoardStore } from './store.js';
import type { StateCatalog } from './states.js';
import { Landfill } from './landfill.js';
import type { MergeEngine } from './merge.js';
export declare const TOOL_NAMES: readonly ["card_manage", "repo_manage", "phase_move", "task_manage", "landfill"];
export declare function registerTools(host: {
    register(t: unknown): void;
}, store: BoardStore, states: StateCatalog): void;
/** 0.16：落盘项目读写（经 ~/.ai/tools/ai-memory）。失败返回 {ok:false,code,error,inbox?}，冲突不重试。 */
export declare function registerLandfillTool(host: {
    register(t: unknown): void;
}, lf: Landfill, mg?: MergeEngine): void;
