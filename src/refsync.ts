/**
 * v154：引用原文同步 / 启动修复（host）。
 *
 * 背景：卡片「相关文件」改路径（放到落盘项目 / 迁移落盘项目 / 撤销）时，任务说明和相关说明里写着的
 * 还是旧路径 → 会话胶囊只能靠 prev / 同名兜底猜，「明明卡片里有却显示已不在」就出在这里。
 *
 * 这里做两件事：
 *  ① syncFileRefs —— 改路径的同一个事务里，把说明里的引用原文（标题 + 路径）一起改到新路径；
 *  ② repairBoardRefs —— 启动时把存量的旧路径修一遍，只认「结构化引用原文」里能确定对应文件的情形。
 * 两者都幂等：没有可改的就不动，返回 0。
 */
import { existsSync } from 'node:fs'
import { refBase, refNameKey, rewriteFileRefText } from './quote.js'
import type { Board, Card, FileRef, Task } from './model.js'

/** 卡片里这条相关文件的显示标题（自定义标题优先，否则文件名）。 */
const titleOf = (f: FileRef): string => f.title || refBase(f.path)

/** 一张卡片里所有会写引用原文的地方：任务说明（含子任务）+ 相关说明。 */
function eachCardText(c: Card, fn: (text: string, set: (next: string) => void) => void): void {
  const walk = (list: Task[] | undefined): void => {
    for (const t of list ?? []) {
      if (typeof t.note === 'string' && t.note) fn(t.note, (next) => { t.note = next })
      walk(t.subs)
    }
  }
  for (const it of c.noteItems ?? []) if (typeof it.v === 'string' && it.v) fn(it.v, (next) => { it.v = next })
  walk(c.tasks)
}

/**
 * 一条相关文件改了路径：全看板说明里指向旧路径的文件引用改成新路径（标题一起改）。返回改动处数。
 * 从别的卡片引用同一个文件也一起改（路径映射是全局的，语义一致）。
 */
export function syncFileRefs(b: Board, f: FileRef, oldPath: string): number {
  if (!oldPath || oldPath === f.path) return 0
  const title = titleOf(f)
  let n = 0
  for (const c of b.cards) {
    eachCardText(c, (text, set) => {
      const r = rewriteFileRefText(text, (p) => (p === oldPath ? { path: f.path, title } : null))
      if (r.n) { n += r.n; set(r.text) }
    })
  }
  return n
}

/**
 * 启动修复：说明里写着旧路径的文件引用，改到卡片现在记的路径。
 * 只认三种情况（其余一律不动，避免猜错）：
 *  - 路径已经是卡内某个文件的当前路径 → 不动；
 *  - 旧路径命中某个文件的 prev（v151 起搬家会记）→ 改；
 *  - 旧路径在磁盘上已不存在、且按文件名归一（空格 / 连字符）在卡内唯一命中 → 改。
 * 幂等：修完再跑 = 0 处改动（调用方据此决定写不写盘）。
 */
export function repairBoardRefs(b: Board): { changed: number; cards: number } {
  let changed = 0
  const hitCards = new Set<string>()
  for (const c of b.cards) {
    const files = c.files ?? []
    if (!files.length) continue
    const exact = new Set(files.map((f) => f.path))
    const byKey = new Map<string, FileRef[]>()
    for (const f of files) {
      const k = refNameKey(f.path)
      const a = byKey.get(k) ?? []
      a.push(f)
      byKey.set(k, a)
    }
    let n = 0
    eachCardText(c, (text, set) => {
      const r = rewriteFileRefText(text, (p) => {
        if (exact.has(p)) return null
        const byPrev = files.find((f) => (f.prev ?? []).includes(p))
        if (byPrev) return { path: byPrev.path, title: titleOf(byPrev) }
        if (existsSync(p)) return null
        const near = byKey.get(refNameKey(p)) ?? []
        return near.length === 1 ? { path: near[0].path, title: titleOf(near[0]) } : null
      })
      if (r.n) { n += r.n; set(r.text) }
    })
    if (n) { changed += n; hitCards.add(c.id) }
  }
  return { changed, cards: hitCards.size }
}
