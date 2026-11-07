/** v134：卡片详情 × DSH 右侧栏（文件预览 / 浏览器 / 终端）的宽度分配。纯函数：client board.ts rlLay 调用，test/v134 单测。
    宿主 frame = 三列 grid「左栏 | 中列 minmax(400px,1fr) | 右侧栏轨道」，右侧栏面板 absolute 贴 frame 右边。
    A = 窗口 − 左栏（= 中列 + 右侧栏轨道），Rt = 宿主右侧栏轨道宽，hostW = 宿主给面板的宽，D0 = 详情想要的宽度。
    详情永远最右；右侧栏面板挪到详情左边（right = D、width = Rv），中列补差额 pad = D + Rv − Rt。 */
export const CMIN = 400, RMIN = 300, DMIN = 360
export type RlIn = { A: number; Rt: number; hostW: number; D0: number; ratio: number | null; drag: { rv0: number; dx: number } | null; last: 'detail' | 'rightbar'; full: boolean }
export type RlOut =
  | { mode: 'full'; rbR: number }
  | { mode: 'compact-detail'; D: number; pad: number }
  | { mode: 'compact-rightbar' }
  | { mode: 'pair'; D: number; Rv: number; pad: number; ratio: number }
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
export function rlPlan(i: RlIn): RlOut {
  /* 右侧栏全屏：铺到详情左边为止 */
  if (i.full) return { mode: 'full', rbR: i.D0 }
  /* 放不下三列（会话 400 + 右侧栏 300 + 详情 360）：后打开的那个在前，另一个藏在它后面 */
  if (i.A - CMIN - RMIN < DMIN) {
    if (i.last === 'rightbar') return { mode: 'compact-rightbar' }
    const D = Math.max(i.D0, i.Rt)
    return { mode: 'compact-detail', D, pad: Math.max(0, D - i.Rt) }
  }
  /* 三列并排：详情按想要的宽度、放不下先收到 360；右侧栏按宿主宽度比例缩放（拖宿主把手按增量换算并记住比例） */
  const D = Math.floor(clamp(i.D0, DMIN, i.A - CMIN - RMIN))
  let ratio = i.ratio ?? (i.Rt || i.hostW) / i.A
  if (i.drag) ratio = clamp(i.drag.rv0 - i.drag.dx, RMIN, i.A - D - CMIN) / (i.A - D)
  const Rv = Math.round(clamp(Math.max(ratio * (i.A - D), i.Rt - D), RMIN, i.A - D - CMIN))
  return { mode: 'pair', D, Rv, pad: D + Rv - i.Rt, ratio }
}

/* ═══ v143（1.1）/ v145（4）：一个排版引擎管全部列 ═══
   从左到右：中间区（会话 / 看板 / 日程）| 每日任务面板 tp | 卡片详情 cd | DSH 右侧栏 rbx | Android ap。
   放不下：先按「想要 − 下限」的余量比例压所有列；还放不下 = 最早打开的那列（每日任务面板除外，没手动关就一直显示）收成右边 44px 竖条，
   所有显示的列整体让出竖条宽度，中间区下限仍是 400。 */
export type ColKey = 'tp' | 'cd' | 'rbx' | 'ap'
export const COL_ORDER: ColKey[] = ['ap', 'rbx', 'cd', 'tp']      /* 从右往左 */
export const COL_MIN: Record<ColKey, number> = { tp: 300, cd: 360, rbx: 300, ap: 320 }
export const TAB_W = 44
export type ColIn = { k: ColKey; want: number; at: number }
export type ColOut = { cols: Array<{ k: ColKey; w: number; right: number }>; away: ColKey[]; tabs: number; total: number }
export function colsPlan(avail: number, open: ColIn[], cmin = CMIN): ColOut {
  const by = new Map(open.map((c) => [c.k, c]))
  let shown = COL_ORDER.filter((k) => by.has(k))
  const away: ColKey[] = []
  const fit = (): Record<string, number> | null => {
    const room = avail - cmin - away.length * TAB_W
    const ws: Record<string, number> = {}
    for (const k of shown) ws[k] = Math.max(COL_MIN[k], by.get(k)!.want)
    const sum = shown.reduce((a, k) => a + ws[k], 0)
    if (sum <= room) return ws
    const slack = shown.reduce((a, k) => a + ws[k] - COL_MIN[k], 0), d = sum - room
    if (slack < d) return null
    for (const k of shown) ws[k] -= (ws[k] - COL_MIN[k]) * d / slack
    return ws
  }
  let ws = fit()
  /* 最新打开 / 刚换到前面的那列不叠放（用户刚要它）；每日任务面板也不让位 */
  const newest = shown.slice().sort((a, b) => by.get(b)!.at - by.get(a)!.at)[0]
  const canGo = (): ColKey[] => shown.filter((k) => k !== 'tp' && k !== newest)
  while (!ws && canGo().length) {
    const old = canGo().sort((a, b) => by.get(a)!.at - by.get(b)!.at)[0]
    shown = shown.filter((k) => k !== old); away.push(old); ws = fit()
  }
  if (!ws) { ws = {}; for (const k of shown) ws[k] = COL_MIN[k] }
  let r = away.length * TAB_W
  const cols: ColOut['cols'] = []
  for (const k of COL_ORDER) { if (!shown.includes(k)) continue; const w = Math.round(ws[k]); cols.push({ k, w, right: r }); r += w }
  return { cols, away, tabs: away.length * TAB_W, total: r }
}
