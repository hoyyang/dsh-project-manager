/**
 * 看板持久化：<dataDir>/board.json（原子写：tmp + rename）+ events.jsonl（审计追加）。
 * 串行化：所有变更经 mutate() 进入同一条 Promise 链，读-改-写不交错。
 */
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Board, BoardEvent, emptyBoard, parseBoard } from './model.js'

const TAIL_BYTES = 64 * 1024

export class BoardStore {
  private board: Board
  private chain: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(b: Board) => void>()
  readonly boardPath: string
  readonly eventsPath: string

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.boardPath = join(dataDir, 'board.json')
    this.eventsPath = join(dataDir, 'events.jsonl')
    this.board = existsSync(this.boardPath) ? parseBoard(JSON.parse(readFileSync(this.boardPath, 'utf8'))) : emptyBoard()
  }

  get(): Board { return this.board }

  subscribe(fn: (b: Board) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** 在串行链上执行一次变更：fn 修改工作副本并返回结果；抛错则丢弃副本、不落盘。 */
  mutate<T>(fn: (b: Board) => T, events: (r: T) => BoardEvent[] = () => []): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = JSON.parse(JSON.stringify(this.board)) as Board
      const result = fn(draft)
      const tmp = this.boardPath + '.tmp'
      writeFileSync(tmp, JSON.stringify(draft, null, 2))
      renameSync(tmp, this.boardPath)
      this.board = draft
      for (const ev of events(result)) appendFileSync(this.eventsPath, JSON.stringify(ev) + '\n')
      for (const l of this.listeners) { try { l(draft) } catch { /* 订阅者失败不影响写入 */ } }
      return result
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }

  eventsTail(n: number): BoardEvent[] {
    if (!existsSync(this.eventsPath)) return []
    // 只读文件末尾（审计日志只增不减，每次轮询读全量会随时间变慢）；第一行可能被截断，丢掉
    const fd = openSync(this.eventsPath, 'r')
    let text = ''
    try {
      const size = fstatSync(fd).size
      const len = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, size - len)
      text = buf.toString('utf8')
      if (len < size) text = text.slice(text.indexOf('\n') + 1)
    } finally { closeSync(fd) }
    const lines = text.trim().split('\n').filter(Boolean)
    return lines.slice(-n).map((l) => { try { return JSON.parse(l) as BoardEvent } catch { return null } }).filter((x): x is BoardEvent => x !== null)
  }
}
