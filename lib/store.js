/**
 * 看板持久化：<dataDir>/board.json（原子写：tmp + rename）+ events.jsonl（审计追加）。
 * 串行化：所有变更经 mutate() 进入同一条 Promise 链，读-改-写不交错。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyBoard, parseBoard } from './model.js';
export class BoardStore {
    dataDir;
    board;
    chain = Promise.resolve();
    listeners = new Set();
    boardPath;
    eventsPath;
    constructor(dataDir) {
        this.dataDir = dataDir;
        mkdirSync(dataDir, { recursive: true });
        this.boardPath = join(dataDir, 'board.json');
        this.eventsPath = join(dataDir, 'events.jsonl');
        this.board = existsSync(this.boardPath) ? parseBoard(JSON.parse(readFileSync(this.boardPath, 'utf8'))) : emptyBoard();
    }
    get() { return this.board; }
    subscribe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }
    /** 在串行链上执行一次变更：fn 修改工作副本并返回结果；抛错则丢弃副本、不落盘。 */
    mutate(fn, events = () => []) {
        const run = async () => {
            const draft = JSON.parse(JSON.stringify(this.board));
            const result = fn(draft);
            const tmp = this.boardPath + '.tmp';
            writeFileSync(tmp, JSON.stringify(draft, null, 2));
            renameSync(tmp, this.boardPath);
            this.board = draft;
            for (const ev of events(result))
                appendFileSync(this.eventsPath, JSON.stringify(ev) + '\n');
            for (const l of this.listeners) {
                try {
                    l(draft);
                }
                catch { /* 订阅者失败不影响写入 */ }
            }
            return result;
        };
        const p = this.chain.then(run, run);
        this.chain = p.catch(() => undefined);
        return p;
    }
    eventsTail(n) {
        if (!existsSync(this.eventsPath))
            return [];
        const lines = readFileSync(this.eventsPath, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-n).map((l) => { try {
            return JSON.parse(l);
        }
        catch {
            return null;
        } }).filter((x) => x !== null);
    }
}
//# sourceMappingURL=store.js.map