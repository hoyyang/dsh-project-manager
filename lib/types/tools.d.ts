import type { BoardStore } from './store.js';
import type { StateCatalog } from './states.js';
export declare const TOOL_NAMES: readonly ["card_manage", "repo_manage", "phase_move", "task_manage"];
export declare function registerTools(host: {
    register(t: unknown): void;
}, store: BoardStore, states: StateCatalog): void;
