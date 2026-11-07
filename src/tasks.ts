/**
 * v119：任务树的纯逻辑（不碰 DOM）——客户端拖动 / 键盘改层级、服务端校验都用这一份。
 * 规则：子任务最多一层；有子任务的任务不能再成为别人的子任务；只能在「已完成 / 未完成」同一区内移动
 * （跨区会造出「已完成父任务带未完成子任务」这种矛盾）。
 */
export interface TaskLike { id?: string; text: string; done: boolean; subs?: TaskLike[] }

export interface TaskHit<T> { t: T; list: T[]; i: number; p: T | null }

/** 在任务树里找一条（顶层或子任务），同时给出它所在的数组与它的父任务。 */
export function tFindIn<T extends TaskLike>(l: T[], id: string): TaskHit<T> | null {
  for (let i = 0; i < l.length; i++) {
    if (l[i].id === id) return { t: l[i], list: l, i, p: null }
    const subs = (l[i].subs ?? []) as T[]
    const j = subs.findIndex((s) => s.id === id)
    if (j >= 0) return { t: subs[j], list: subs, i: j, p: l[i] }
  }
  return null
}

export type TaskMoveMode = 'nest' | 'outdent' | 'order'

/** 一次拖放 / 键盘改层级的结果：{ msg } = 成功（msg 为空表示没变化），{ err } = 拒绝并说明原因。 */
export type TaskMoveResult = { msg: string; err?: undefined } | { msg?: undefined; err: string }

/**
 * 就地改 list（调用方自己深拷贝）：nest = 变成 tid 的最后一个子任务；outdent = 子任务回顶层（before 决定插前 / 后）；
 * order = 同层换位（before 决定插前 / 后）。
 */
export function tMove<T extends TaskLike>(list: T[], op: { id: string; tid: string; mode: TaskMoveMode; before: boolean; sid?: string }): TaskMoveResult {
  const f = tFindIn(list, op.id)
  const tgt = tFindIn(list, op.tid)
  if (!f || !tgt) return { err: '找不到这条任务' }
  if (op.mode === 'nest') {
    if (tgt.p) return { err: '子任务最多一层' }
    if (f.p === tgt.t) return { err: '「' + f.t.text + '」已经在「' + tgt.t.text + '」的子任务里了' }
    const n = (f.t.subs ?? []).length
    if (n) return { err: '「' + f.t.text + '」还有 ' + n + ' 个子任务，不能再成为别人的子任务' }
    /* v130（2）：sid 给了 = 插到目标子任务列表里指定位置（sid 前 / 后；'' = 最后），否则追加到最后 */
    const wasSub = !!f.p
    f.list.splice(f.i, 1)
    const subs = [...((tgt.t.subs ?? []) as T[])]
    let at = op.sid ? subs.findIndex((x) => x.id === op.sid) : -1
    if (at < 0) at = subs.length
    else if (!op.before) at++
    subs.splice(at, 0, f.t)
    tgt.t.subs = subs
    if (op.sid === undefined) return { msg: '「' + f.t.text + '」已成为「' + tgt.t.text + '」的子任务' }
    return { msg: '「' + f.t.text + '」' + (wasSub ? '已移到「' + tgt.t.text + '」的子任务里' : '已成为「' + tgt.t.text + '」的子任务') + '（第 ' + (at + 1) + ' 个）' }
  }
  if (op.mode === 'outdent') {
    if (tgt.p) return { err: '落点无效：子任务不能再套一层' }
    if (!f.p) return { err: '这条已经是独立任务了' }
    if (tgt.t === f.p) {
      /* 拖到自己父任务的上 / 下沿 = 移出这一组，排到父任务前 / 后 */
    }
    f.list.splice(f.i, 1)
    const ti = list.indexOf(tgt.t)
    list.splice(op.before ? ti : ti + 1, 0, f.t)
    return { msg: '「' + f.t.text + '」已恢复为独立任务' }
  }
  if (!!f.p !== !!tgt.p) return { err: '只能在同层里换位' }
  if (f.t === tgt.t) return { msg: '' }
  const ti2 = f.list.indexOf(tgt.t)
  if (ti2 < 0) return { err: '只在自己这一组子任务里换位' }
  f.list.splice(f.i, 1)
  const ti = f.list.indexOf(tgt.t)
  f.list.splice(op.before ? ti : ti + 1, 0, f.t)
  return { msg: '已调整「' + f.t.text + '」的位置' }
}
