/**
 * 看板持久化：<dataDir>/board.json（原子写：tmp + rename）+ events.jsonl（审计追加）。
 * 串行化：所有变更经 mutate() 进入同一条 Promise 链，读-改-写不交错。
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { backfillTimes, Board, BoardEvent, emptyBoard, parseBoard, stampTimes } from './model.js'
import { repairBoardRefs } from './refsync.js'

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
    if (!existsSync(this.boardPath)) { this.board = emptyBoard(); return }
    const raw = JSON.parse(readFileSync(this.boardPath, 'utf8')) as Board
    // 0.26 升级（相关文件改成对象、补最后更新时间）：先备份原文件，再迁移并立即写盘（只做一次）
    const old = (raw.cards ?? []).some((c) => c.updatedAt === undefined || (c.files ?? []).some((f) => typeof f === 'string')) || (raw.groups ?? []).some((g) => g.updatedAt === undefined)
    this.board = parseBoard(raw)
    if (old) {
      this.backup = this.boardPath + '.bak-0260-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
      copyFileSync(this.boardPath, this.backup)
      backfillTimes(this.board, this.allEvents())
      this.write(this.board)
    }
    /* v154（1.3）：启动修复存量引用 —— 说明里指向旧路径、但能确定对应哪个文件的，改到卡片现在记的路径。
       幂等：没有可改的就不写盘；要写盘时先备份（与 0.26 升级同一个套路，失败不影响启动）。 */
    try {
      const rep = repairBoardRefs(this.board)
      this.repair = rep
      if (rep.changed) {
        this.repairBackup = this.boardPath + '.bak-refsync-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
        copyFileSync(this.boardPath, this.repairBackup)
        this.write(this.board)
        appendFileSync(this.eventsPath, JSON.stringify({ at: new Date().toISOString(), actor: 'system', kind: 'board/repair-refs' }) + '\n')
      }
    } catch (e) { /* 修复是尽力而为：失败只影响显示兜底，不能拦住插件启动 */ console.warn('[dsh-project-manager] 启动修复引用失败（不影响启动）：', e) }
  }
  /** 0.26 升级前的备份路径（没升级 = 空）。 */
  backup = ''
  /** v154：启动修复引用原文的结果（没跑 = null）。 */
  repair: { changed: number; cards: number } | null = null
  /** v154：启动修复写盘前的备份路径（没改 = 空）。 */
  repairBackup = ''
  /** ponytail: 只在升级时整读一次审计日志（几 MB 以内）；更大时改成流式逐行读 */
  private allEvents(): BoardEvent[] {
    if (!existsSync(this.eventsPath)) return []
    return readFileSync(this.eventsPath, 'utf8').split('\n').flatMap((l) => { try { return l ? [JSON.parse(l) as BoardEvent] : [] } catch { return [] } })
  }
  private write(b: Board): void {
    const tmp = this.boardPath + '.tmp'
    writeFileSync(tmp, JSON.stringify(b, null, 2))
    renameSync(tmp, this.boardPath)
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
      stampTimes(this.board, draft, new Date().toISOString())
      this.write(draft)
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