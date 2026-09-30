import { Board } from './model.js';
import { StateCatalog } from './states.js';
export declare const safeName: (s: string) => string;
export declare function hubDir(dataDir: string): string;
export declare function syncHub(dataDir: string, b: Board, states: StateCatalog): string;
export declare function agentsMd(b: Board, states: StateCatalog): string;
