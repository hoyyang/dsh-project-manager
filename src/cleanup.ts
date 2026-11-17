/**
 * v180（0.75.0）清理关联文件 —— 判定口径「一处定义」。
 *
 * 「无用文件」按**文件路径**算（同一路径可能被多张卡片挂着）：
 *   1. 这个路径没有任何**未完成**的任务 / 子任务关联（卡片归档了也一样）；
 *   2. 这个路径没有任何**未归档**卡片关联（只要还有一张活跃卡片挂着它就不算）。
 * 两条都满足才算无用 —— 实际只剩「已归档卡片、且没人再用了」的文件。
 *
 * 行的 reason 只用来解释「为什么不算 / 为什么算」：
 *   arch   = 无用（可清理）
 *   active = 这张卡片还没归档（这一行不自动算无用）
 *   shared = 这一行在归档卡上，但同路径还被活跃卡片挂着
 *   undone = 这一行在归档卡上，但同路径还有未完成任务 / 子任务在用
 *   done   = 卡片未归档 + 本行关联过已完成的任务 / 子任务 + 同路径没有未完成任务 / 子任务（v181 可手动清理）
 *
 * 只处理「在卡片关联的落盘项目文件夹里」的文件（dirsOf 由调用方给：卡片 ∪ 卡片组的落盘项目目录）；
 * 不在范围里的文件进 outside（界面只展示计数，不可选，也不动）。
 */
import type { Board, Card, Task } from './model.js'

export type CleanupReason = 'arch' | 'active' | 'shared' | 'undone' | 'done'

export interface CleanupBind { id: string; text: string; done: boolean; sub: boolean }

export interface CleanupRow {
  /** cardId + '|' + fileId（前端选择集用它） */
  key: string
  cardId: string
  cardTitle: string
  groupId: string
  groupName: string
  archived: boolean
  archivedAt: string
  fileId: string
  name: string
  path: string
  size: number
  exists: boolean
  binds: CleanupBind[]
  useless: boolean
  reason: CleanupReason
  /** 同路径还有几张未归档卡片 */
  pathActive: number
  /** 同路径还有几个未完成任务 / 子任务 */
  pathUndone: number
  /** 同路径一共有几个已完成的任务 / 子任务（v181） */
  pathDone: number
  /** 同路径一共被几张卡片挂着（>1 = 删文件会打断别的卡片 → 只解除关联） */
  pathCards: number
}

export interface CleanupOutside { cardId: string; cardTitle: string; name: string; path: string; why: string }

export interface CleanupCounts { all: number; useless: number; done: number; arch: number; busy: number; missing: number }

export interface CleanupScan {
  rows: CleanupRow[]
  outside: CleanupOutside[]
  counts: CleanupCounts
  /** 无用文件里还能真删掉（存在、且没有被别的卡片挂着）的字节数 */
  uselessSize: number
  totalSize: number
}

export interface CleanupInfo { size: number; exists: boolean }

export const baseName = (p: string): string => {
  const s = String(p ?? '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/** 文件在不在某个目录下（不要求目录存在，纯字符串；目录结尾的 / 去掉）。 */
export const underDir = (path: string, dir: string): boolean => {
  const d = dir.replace(/\/+$/, '')
  return path === d || path.startsWith(d + '/')
}

const flat = (list: Task[] | undefined, out: Task[] = [], sub = false): Task[] => {
  for (const t of list ?? []) {
    out.push(t)
    if (t.subs?.length) flat(t.subs, out, true)
  }
  return out
}

/** 这棵任务树里绑了 fileId 的任务 / 子任务（sub = 是否子任务）。 */
export function bindsOf(c: Card, fileId: string): CleanupBind[] {
  const out: CleanupBind[] = []
  const walk = (list: Task[] | undefined, sub: boolean): void => {
    for (const t of list ?? []) {
      if (t.files?.includes(fileId)) out.push({ id: String(t.id ?? ''), text: String(t.text ?? ''), done: t.done === true, sub })
      if (t.subs?.length) walk(t.subs, true)
    }
  }
  walk(c.tasks, false)
  return out
}

export function cleanupRows(
  b: Board,
  dirsOf: (c: Card) => string[],
  sizeOf?: (path: string) => CleanupInfo,
): CleanupScan {
  interface Draft { c: Card; fileId: string; name: string; path: string; binds: CleanupBind[]; inScope: boolean }
  const drafts: Draft[] = []
  const groupName = new Map<string, string>()
  for (const g of b.groups ?? []) groupName.set(g.id, g.name)
  for (const c of b.cards ?? []) {
    const dirs = dirsOf(c).filter((x) => typeof x === 'string' && x.startsWith('/'))
    for (const f of c.files ?? []) {
      const path = String(f.path ?? '')
      drafts.push({
        c,
        fileId: String(f.id ?? path),
        name: baseName(path),
        path,
        binds: bindsOf(c, String(f.id ?? '')),
        inScope: dirs.some((d) => underDir(path, d)),
      })
    }
  }

  /* 按路径汇总：还有几张活跃卡片、还有几个未完成任务 / 子任务、一共几张卡片 */
  const agg = new Map<string, { cards: Set<string>; active: number; undone: number; done: number }>()
  for (const d of drafts) {
    let a = agg.get(d.path)
    if (!a) { a = { cards: new Set(), active: 0, undone: 0, done: 0 }; agg.set(d.path, a) }
    a.cards.add(d.c.id)
    if (!d.c.archivedAt) a.active++
    for (const bd of d.binds) { if (bd.done) a.done++; else a.undone++ }
  }

  const rows: CleanupRow[] = []
  const outside: CleanupOutside[] = []
  for (const d of drafts) {
    const a = agg.get(d.path)
    const pathActive = a?.active ?? 0
    const pathUndone = a?.undone ?? 0
    const pathDone = a?.done ?? 0
    const useless = pathActive === 0 && pathUndone === 0
    /* v181：任务都完成 = 本行卡片未归档 + 本行关联过已完成的任务/子任务 + 同路径 0 个未完成 */
    const ownDone = d.binds.some((bd) => bd.done)
    const reason: CleanupReason = useless
      ? 'arch'
      : (!d.c.archivedAt ? (ownDone && pathUndone === 0 ? 'done' : 'active') : (pathActive > 0 ? 'shared' : 'undone'))
    if (!d.inScope) {
      outside.push({ cardId: d.c.id, cardTitle: d.c.t, name: d.name, path: d.path, why: '不在卡片关联的落盘项目文件夹里' })
      continue
    }
    const info = sizeOf ? sizeOf(d.path) : { size: 0, exists: true }
    rows.push({
      key: d.c.id + '|' + d.fileId,
      cardId: d.c.id,
      cardTitle: d.c.t,
      groupId: d.c.g,
      groupName: groupName.get(d.c.g) ?? '',
      archived: !!d.c.archivedAt,
      archivedAt: d.c.archivedAt ?? '',
      fileId: d.fileId,
      name: d.name,
      path: d.path,
      size: info.size,
      exists: info.exists,
      binds: d.binds,
      useless,
      reason,
      pathActive,
      pathUndone,
      pathDone,
      pathCards: a?.cards.size ?? 1,
    })
  }

  const counts: CleanupCounts = { all: rows.length, useless: 0, done: 0, arch: 0, busy: 0, missing: 0 }
  let uselessSize = 0
  let totalSize = 0
  for (const r of rows) {
    if (r.useless) { counts.useless++; if (r.exists && r.pathCards <= 1) uselessSize += r.size } else counts.busy++
    if (r.reason === 'done') counts.done++
    if (r.archived) counts.arch++
    if (!r.exists) counts.missing++
    totalSize += r.size
  }
  return { rows, outside, counts, uselessSize, totalSize }
}

/** 删除动作对一条路径到底能做什么：没有文件（已丢失）/ 别的卡片也在用 → 只能解除关联。 */
export const canTrash = (r: CleanupRow): boolean => r.exists && r.pathCards <= 1
