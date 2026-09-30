import { Board, BoardEvent } from './model.js';
export declare class BoardStore {
    readonly dataDir: string;
    private board;
    private chain;
    private listeners;
    readonly boardPath: string;
    readonly eventsPath: string;
    constructor(dataDir: string);
    get(): Board;
    subscribe(fn: (b: Board) => void): () => void;
    /** 在串行链上执行一次变更：fn 修改工作副本并返回结果；抛错则丢弃副本、不落盘。 */
    mutate<T>(fn: (b: Board) => T, events?: (r: T) => BoardEvent[]): Promise<T>;
    eventsTail(n: number): BoardEvent[];
}
