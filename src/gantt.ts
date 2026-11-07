/**
 * 0.31 任务日程看板（甘特图）：数据口径 + 纯变更逻辑（无 IO，便于单测）。
 *
 * 口径（notes/0.31-gantt-design.md 第九节；v96 起计划条只认手动）：
 * - 计划条逐日：只认手动设置 / 拖动过的日子（没有默认段，不跟今天长）。
 * - 实际条逐日：会话自动（严格 24h 内有对话）∪ 手动记录（actual）；autoOff = 这天被手动动过 → 自动失效。
 * - 截止时间 { at, label }；三条边的宽度存 ui.{lw,tpw,dw}。
 */
import type { Board, BoardEvent, Card, Group, Task } from './model.js'

export const DAY = 86400000

/**
 * 截止时间（v99：同一天可以有多个，分硬性 / 软性）。
 * - id：稳定身份（老数据没有 → 用 at 当 id）；客户端增删改都按 id 走，同一天多条不会串。
 * - kind：hard = 外部严格截止（红旗 / 红虚线）；soft = 内部可调（浅橙旗 / 浅橙虚线）。老数据没有 → hard。
 */
export interface DdlRep { unit: 'day' | 'week' | 'month'; n: number; until?: string }
export interface GanttDDL { id?: string; at: string; kind?: 'hard' | 'soft'; label?: string; /** v137：来自任务 / 子任务截止的派生条目（task = 任务 id，done = 任务已完成）；不落盘，拖动 / 删除 = 改 task.due。 */ task?: string; done?: boolean; /** v101：同一条重复截止的系列 id（没有 = 单条）。 */ sid?: string; /** v101：重复规则（每天 / 每周 / 每月 + 直到）。 */ rep?: DdlRep }
/**
 * v105 每日任务面板的按天状态（落到看板，刷新不丢）：
 * - done = 这天勾选「完成」的任务项 key（p|卡片 / t|卡片|任务 / s|卡片|子任务）
 * - sel  = 这天「排今天」选中的任务项 key（进「任务执行安排」）
 * - lanes = 执行安排的行（行内多项 = 并行）
 * 执行中 / 已暂停是运行态，只存内存（不进这里）。
 */
export type PanelSt = 'run' | 'pause' | 'wait'
/** v121–v123 任务执行安排的分区：本日已执行 / 等外部进展 / 个人暂停 / 执行中 / 已安排 / 未安排。 */
export type PanelZone = 'done' | 'wait' | 'pause' | 'run' | 'arr' | 'un'
export const ZL_KEYS = ['pause', 'wait', 'run', 'un'] as const
export interface PanelDay {
  done?: string[]; sel?: string[]; lanes?: string[][]
  /** v110：执行中 / 已暂停（落盘的运行态；key 与 done/sel 同一口径）。v121 起多一个 wait = 等外部进展。 */
  pst?: Record<string, PanelSt>
  /** v111：这一天已经跑过「自动续排」；只跑一次，用户取消后不会自己回来。 */
  carry?: boolean
  /** v122/v123：个人暂停 / 等外部进展 / 执行中 / 未安排 四个分区的行（同一行 = 并列），已安排用 lanes。 */
  zl?: Partial<Record<(typeof ZL_KEYS)[number], string[][]>>
  /** v122：记录执行的时间（本日已执行按它排，早的在上）。 */
  doneAt?: Record<string, number>
  /** v123：记录执行那一刻卡片在哪个分区（点「已执行」撤销时回到这里）。 */
  from?: Record<string, PanelZone>
}
export interface CardGantt {
  /**
   * 手动设置 / 拖动过的计划日（完整逐日集合）。v96 起计划条只认它：
   * 没有这个字段 = 计划条为空；空数组也算「用户就是要没有计划」。
   */
  plan?: string[]
  /** 手动记录的执行日。 */
  actual?: string[]
  /** 这天被手动动过（勾上 / 取消都算）→ 会话自动失效。 */
  autoOff?: string[]
  ddl?: GanttDDL[]
}
export interface GanttUI { lw?: number; tpw?: number; dw?: number; /** v98：日程管理条「显示 / 隐藏项目组时间」（默认隐藏）。 */ gtime?: boolean; /** v105：面板两块卡片的高度比（上面那块占的百分比，5–95；没有 = 3:2；v130 起拖动范围到两端收起态）。 */ tpr?: number; /** v110：甘特图是否显示 pending 项目（目录 + 时间轴；默认 true）。 */ pend?: boolean; /** v118：本日计划清单是否收起（只留标题栏；默认收起）。 */ pfold?: boolean; /** v118：本日计划清单是否「只显示可安排」（默认开）。 */ plonly?: boolean
  /** v121：本日计划清单「只显示本日完成」（默认关；与 plonly 互斥）。 */ pldone?: boolean
  /** v121：本日计划清单里收起的行（项目组 g| / 项目 p| / 任务 t| 的 key；跨天稳定）。 */ plclosed?: string[]
  /** v124：已完成任务里用户点开过的（默认折叠）。 */ plopen?: string[]
  /** v124：任务执行安排里收起的分区（没有 = 默认只收「本日已执行」）。 */ exz?: string[]
  /** v130：两张卡（执行安排 / 计划清单）的开合 —— ex = 只开执行安排（默认）、pl = 只开计划清单、split = 两张都开（比例 = tpr）。 */ tpm?: 'ex' | 'pl' | 'split' }
export interface GanttState {
  cards: Record<string, CardGantt>
  ui?: GanttUI
  /** v105：每日任务面板按天状态（勾选 / 选中 / 排布）—— 一天一份，key 用的是全局任务项 key。 */
  panels?: Record<string, PanelDay>
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** 本地日（与界面一致；跨时区按用户机器）。 */
export const ymd = (ms: number): string => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
export const dayMs = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
/** 合法日：格式对、且回写一致（挡掉 2026-02-31 这类会被 Date 归一化的值）。 */
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && ymd(dayMs(v)) === v
export const todayKey = (now = Date.now()): string => ymd(now)

/** 建卡时间：newId('c') = 'c' + Date.now().toString(36)（8 位）+ 序号；旧卡兜底 updatedAt。 */
/** ISO 时间 → 本机日期 yyyy-mm-dd（拿不到 = 空串）。 */
const localDay = (iso: string): string => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n: number): string => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) }
export function cardCreated(c: Card): number {
  const m = /^c([0-9a-z]{8})/.exec(c.id)
  /* 只认「像正常建卡时间」的 id：老/测试卡（如 cv60width）会解出 2047 年这种未来时间，退回 updatedAt */
  if (m) { const t = parseInt(m[1], 36); if (t > 1.5e12 && t <= Date.now() + DAY) return t }
  return Date.parse(c.updatedAt ?? '') || Date.now()
}

/** 这段卡片的「归档 / 恢复」历史（events.jsonl 的 card/archive、card/unarchive，按时间升序）。 */
export function archiveTimes(events: BoardEvent[], cardId: string): Array<{ at: number; on: boolean }> {
  const out: Array<{ at: number; on: boolean }> = []
  for (const e of events) {
    if (e.card !== cardId) continue
    if (e.kind !== 'card/archive' && e.kind !== 'card/unarchive') continue
    const t = Date.parse(e.at)
    if (!Number.isFinite(t)) continue
    out.push({ at: t, on: e.kind === 'card/unarchive' })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** 有效计划日：只认手动设置 / 拖动过的日子（v96 起没有默认段）。 */
export function planDays(_c: Card, st: CardGantt | undefined, _events: BoardEvent[] = [], _now = Date.now()): Set<string> {
  return new Set((st?.plan ?? []).filter(isDay))
}

/** 有效实际日：{day → src}；autoOff 的会话自动失效，手动记录优先。 */
export function actualDays(st: CardGantt | undefined, auto: Iterable<string>): Map<string, 'auto' | 'manual'> {
  const off = new Set(st?.autoOff ?? [])
  const manual = new Set((st?.actual ?? []).filter(isDay))
  const out = new Map<string, 'auto' | 'manual'>()
  for (const d of auto) if (isDay(d) && !off.has(d)) out.set(d, 'auto')
  for (const d of manual) out.set(d, 'manual')
  return out
}

/** 手动改一天计划：以当前集合为底，改完存成完整逐日集合。 */
export function applyPlanDay(st: CardGantt, cur: Set<string>, key: string, on: boolean): string[] {
  if (!isDay(key)) return [...cur].sort()
  if (on) cur.add(key); else cur.delete(key)
  st.plan = [...cur].sort()
  return st.plan
}

/** 手动改一段（拖把手）：from 含、to 不含（yyyy-mm-dd）。 */
export function applyPlanRange(st: CardGantt, cur: Set<string>, from: string, to: string, on: boolean): string[] {
  let a = dayMs(from), b = dayMs(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...cur].sort()
  if (b < a) [a, b] = [b, a]
  for (let t = a; t < b; t += DAY) { const k = ymd(t); if (on) cur.add(k); else cur.delete(k) }
  st.plan = [...cur].sort()
  return st.plan
}

const uniq = (a: string[]): string[] => [...new Set(a)].sort()

/** 任意入口（格子小窗 / 任务面板）的手动改执行：先关掉这天的会话自动，再写 / 删手动记录。 */
export function setActualDay(c: CardGantt, key: string, on: boolean): void {
  if (!isDay(key)) return
  c.autoOff = uniq([...(c.autoOff ?? []), key])
  c.actual = uniq(on ? [...(c.actual ?? []), key] : (c.actual ?? []).filter((x) => x !== key))
}

/* ── v105 每日任务面板：按天勾选（当天完成）/ 选中（排今天）/ 排布（lanes） ── */
/** 这张卡片合法的任务项 key（p|卡片 / t|卡片|任务 / s|卡片|子任务）；非法 key 一律挡在写盘外。 */
export function taskKeySet(c: Card): Set<string> {
  const s = new Set<string>()
  s.add('p|' + c.id)
  /** 一层任务 = t|，再往下的子任务 = s|（key 的层级必须和界面的 p / t / s 一一对上，否则写盘会被当成非法 key 丢掉）。 */
  const walk = (l: Task[], sub: boolean): void => {
    for (const t of l) {
      if (t.id) s.add((sub ? 's|' : 't|') + c.id + '|' + t.id)
      if (t.subs && t.subs.length) walk(t.subs, true)
    }
  }
  walk(c.tasks ?? [], false)
  return s
}

const panelKeys = (v: unknown, valid: Set<string>): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || x.length > 160 || !valid.has(x)) continue
    if (!out.includes(x)) out.push(x)
  }
  return out.slice(0, 4000)
}
/** v121（1.2 根因）：集合字段（done / sel）排序后存，比对稳定；lanes / zl 的行内顺序 = 用户拖出来的顺序，不能排。 */
const panelSet = (v: unknown, valid: Set<string>): string[] => panelKeys(v, valid).sort()
/** 行结构（lanes / zl[z]）：保序、跨行去重、只留合法 key。 */
const panelRows = (v: unknown, valid: Set<string>, seen: Set<string>, keep?: Set<string>): string[][] => {
  const rows: string[][] = []
  if (!Array.isArray(v)) return rows
  for (const lane of v.slice(0, 400)) {
    if (!Array.isArray(lane)) continue
    const l: string[] = []
    for (const k of panelKeys(lane, valid)) {
      if ((keep && !keep.has(k)) || seen.has(k)) continue
      seen.add(k)
      l.push(k)
    }
    if (l.length) rows.push(l.slice(0, 40))
  }
  return rows
}
const ZONES = new Set<PanelZone>(['done', 'wait', 'pause', 'run', 'arr', 'un'])

/** 多张卡片合起来的合法任务项 key（写入时挡掉过期 / 伪造的 key）。 */
export function taskKeySetAll(cards: Card[]): Set<string> {
  const s = new Set<string>()
  for (const c of cards) for (const k of taskKeySet(c)) s.add(k)
  return s
}

/** 写一天的面板状态（done / sel / lanes 都可单独传；空 = 删掉那一项）。非法 key 丢弃，不报错。 */
export function setPanelDay(st: GanttState, key: string, patch: Record<string, unknown>, valid: Set<string>): PanelDay | null {
  if (!isDay(key)) throw new Error('任务面板的日期必须是 yyyy-mm-dd：' + key)
  const panels = st.panels ?? (st.panels = {})
  const cur: PanelDay = panels[key] ?? (panels[key] = {})
  /* 卡片 / 任务被删掉后留下的旧 key：每次写盘顺手清掉，不让状态越积越多 */
  if (cur.done) { const a = panelSet(cur.done, valid); if (a.length) cur.done = a; else delete cur.done }
  if (cur.sel) { const a = panelSet(cur.sel, valid); if (a.length) cur.sel = a; else delete cur.sel }
  if ('done' in patch) {
    const list = panelSet(patch.done, valid)
    if (list.length) cur.done = list
    else delete cur.done
  }
  if ('sel' in patch) {
    const list = panelSet(patch.sel, valid)
    if (list.length) cur.sel = list
    else delete cur.sel
  }
  if ('lanes' in patch) {
    const lanes = panelRows(patch.lanes, valid, new Set<string>(), new Set(cur.sel ?? []))
    if (lanes.length) cur.lanes = lanes
    else delete cur.lanes
  } else if (cur.lanes) {
    /* 只改勾选 / 选中时也要把旧排布对齐到新的选中集合：取消选中后不许留下指向未选中项的 lanes */
    const sel = new Set(cur.sel ?? [])
    const seen = new Set<string>()
    const lanes = cur.lanes.map((l) => l.filter((k) => sel.has(k) && valid.has(k) && !seen.has(k) && (seen.add(k), true))).filter((l) => l.length)
    if (lanes.length) cur.lanes = lanes
    else delete cur.lanes
  }
  /* v110：执行 / 暂停状态落盘（pst）。非法 key 丢弃；只改勾选 / 选中时按新的选中集合裁一遍。 */
  if ('pst' in patch) {
    const src = patch.pst
    const out: Record<string, PanelSt> = {}
    const sel = new Set(cur.sel ?? [])
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        /* 只认「合法 + 还排在今天」的 key：没选中的项不该留着执行态 */
        if (!valid.has(k) || !sel.has(k)) continue
        if (v === 'run' || v === 'pause' || v === 'wait') out[k] = v
      }
    }
    if (Object.keys(out).length) cur.pst = out
    else delete cur.pst
  } else if (cur.pst) {
    const sel = new Set(cur.sel ?? [])
    const keep: Record<string, PanelSt> = {}
    for (const [k, v] of Object.entries(cur.pst)) if (sel.has(k) && valid.has(k)) keep[k] = v
    if (Object.keys(keep).length) cur.pst = keep
    else delete cur.pst
  }
  /* v111：续排标记（true = 这天已经跑过自动续排）。单独存在也保留这一天 —— 用户把续排进来的项全取消后，同一天不会再自动补一遍。 */
  if ('carry' in patch) {
    if (patch.carry === true) cur.carry = true
    else delete cur.carry
  }
  /* v122/v123：四个「行」分区（个人暂停 / 等外部 / 执行中 / 未安排）的排布 —— 保序，只留排在今天的 key */
  if ('zl' in patch) {
    const src = patch.zl && typeof patch.zl === 'object' && !Array.isArray(patch.zl) ? patch.zl as Record<string, unknown> : {}
    const sel = new Set(cur.sel ?? [])
    const seen = new Set<string>()
    const zl: NonNullable<PanelDay['zl']> = {}
    for (const z of ZL_KEYS) { const rows = panelRows(src[z], valid, seen, sel); if (rows.length) zl[z] = rows }
    if (Object.keys(zl).length) cur.zl = zl
    else delete cur.zl
  } else if (cur.zl) {
    const sel = new Set(cur.sel ?? [])
    const seen = new Set<string>()
    const zl: NonNullable<PanelDay['zl']> = {}
    for (const z of ZL_KEYS) { const rows = panelRows(cur.zl[z], valid, seen, sel); if (rows.length) zl[z] = rows }
    if (Object.keys(zl).length) cur.zl = zl
    else delete cur.zl
  }
  /* v122：记录执行的时间；v123：记录执行那一刻的来源分区 —— 都只跟着 done 走 */
  const doneSet = new Set(cur.done ?? [])
  if ('doneAt' in patch) {
    const src = patch.doneAt && typeof patch.doneAt === 'object' && !Array.isArray(patch.doneAt) ? patch.doneAt as Record<string, unknown> : {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(src)) if (doneSet.has(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v)
    if (Object.keys(out).length) cur.doneAt = out
    else delete cur.doneAt
  } else if (cur.doneAt) {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(cur.doneAt)) if (doneSet.has(k)) out[k] = v
    if (Object.keys(out).length) cur.doneAt = out
    else delete cur.doneAt
  }
  if ('from' in patch) {
    const src = patch.from && typeof patch.from === 'object' && !Array.isArray(patch.from) ? patch.from as Record<string, unknown> : {}
    const out: Record<string, PanelZone> = {}
    for (const [k, v] of Object.entries(src)) if (doneSet.has(k) && typeof v === 'string' && ZONES.has(v as PanelZone) && v !== 'done') out[k] = v as PanelZone
    if (Object.keys(out).length) cur.from = out
    else delete cur.from
  } else if (cur.from) {
    const out: Record<string, PanelZone> = {}
    for (const [k, v] of Object.entries(cur.from)) if (doneSet.has(k)) out[k] = v
    if (Object.keys(out).length) cur.from = out
    else delete cur.from
  }
  if (!cur.done && !cur.sel && !cur.lanes && !cur.pst && !cur.carry && !cur.zl) { delete panels[key]; if (!Object.keys(panels).length) delete st.panels; return null }
  return cur
}

/* ── v99 截止时间：同一天多个 + 硬性 / 软性 ── */
export const ddlIdOf = (d: GanttDDL): string => d.id || d.at
export const ddlKindOf = (d: GanttDDL): 'hard' | 'soft' => (d.kind === 'soft' ? 'soft' : 'hard')
const sortDdl = (l: GanttDDL[]): void => { l.sort((a, b) => a.at.localeCompare(b.at) || ddlIdOf(a).localeCompare(ddlIdOf(b))) }

/** 加一条截止时间（同一天可以加多个）；返回新条目。 */
export function addDdl(c: CardGantt, key: string, kind: 'hard' | 'soft' = 'hard', label = ''): GanttDDL {
  if (!isDay(key)) throw new Error('截止时间必须是 yyyy-mm-dd：' + key)
  const list = c.ddl ?? (c.ddl = [])
  let n = 1
  for (const d of list) { const m = /^d(\d+)$/.exec(ddlIdOf(d)); if (m) n = Math.max(n, Number(m[1]) + 1) }
  const it: GanttDDL = { id: 'd' + n, at: key, kind: kind === 'soft' ? 'soft' : 'hard' }
  if (label) it.label = label
  list.push(it)
  sortDdl(list)
  return it
}

/* ── v101 截止重复：一条规则展开成多条（共享 sid），删除按「这条 / 及以后 / 整系列」 ── */
export const DDL_REP_MAX = 120
/** 重复展开的窗口上界（今天 + 400 天；再远不铺，避免把状态写爆）。 */
export const DDL_REP_HORIZON = 400

/** 按单位往后走 n 步（月会夹到月末，避免 1/31 + 1 月跳到 3/3）。 */
export function repStep(key: string, unit: DdlRep['unit'], n = 1): string {
  const [y, m, d] = key.split('-').map(Number)
  if (unit === 'day') return ymd(new Date(y, m - 1, d + n).getTime())
  if (unit === 'week') return ymd(new Date(y, m - 1, d + 7 * n).getTime())
  const total = (m - 1) + n
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12
  const last = new Date(ny, nm + 1, 0).getDate()
  return ymd(new Date(ny, nm, Math.min(d, last)).getTime())
}

export interface DdlRepInput { unit: DdlRep['unit']; n?: number; until?: string }

/**
 * 加一条（或按规则展开成多条）截止时间。
 * - 没有 rep / rep.unit 非法 → 就是一条，行为与 v99 一致；
 * - 有 rep → 从 key 起按 unit 走，直到 until（含当天）或 +400 天 / 120 条封顶；每条共享 sid。
 */
export function addDdlRepeat(c: CardGantt, key: string, kind: 'hard' | 'soft' = 'hard', label = '', rep?: DdlRepInput): GanttDDL[] {
  if (!isDay(key)) throw new Error('截止时间必须是 yyyy-mm-dd：' + key)
  const unit = rep?.unit
  if (!unit || (unit !== 'day' && unit !== 'week' && unit !== 'month')) return [addDdl(c, key, kind, label)]
  const n = Math.max(1, Math.min(12, Math.round(rep?.n ?? 1)))
  const until = rep?.until && isDay(rep.until) ? rep.until : undefined
  const list = c.ddl ?? (c.ddl = [])
  let maxId = 0, maxSid = 0
  for (const d of list) {
    const m = /^d(\d+)$/.exec(ddlIdOf(d)); if (m) maxId = Math.max(maxId, Number(m[1]))
    const ms = /^ds(\d+)$/.exec(d.sid ?? ''); if (ms) maxSid = Math.max(maxSid, Number(ms[1]))
  }
  const sid = 'ds' + (maxSid + 1)
  const rule: DdlRep = { unit, n, ...(until ? { until } : {}) }
  const out: GanttDDL[] = []
  const limit = ymd(Date.now() + DDL_REP_HORIZON * 86400000)
  let cur = key
  for (let i = 0; i < DDL_REP_MAX; i++) {
    if (until && cur > until) break
    if (cur > limit) break
    const it: GanttDDL = { id: 'd' + (maxId + 1 + i), at: cur, kind: kind === 'soft' ? 'soft' : 'hard', sid, rep: rule }
    if (label) it.label = label
    list.push(it)
    out.push(it)
    const next = repStep(cur, unit, n)
    if (next === cur) break
    cur = next
  }
  sortDdl(list)
  return out
}

/**
 * 删重复截止：scope = one（只这条）/ after（这条及以后）/ all（整个系列）。
 * 没有 sid 的条目等价于 one。返回值 = 实际删掉的条数。
 */
export function removeDdlScoped(c: CardGantt, id: string, scope: 'one' | 'after' | 'all' = 'one'): number {
  const list = c.ddl ?? []
  const it = list.find((d) => ddlIdOf(d) === id)
  if (!it) return 0
  const sid = it.sid
  if (!sid || scope === 'one') { c.ddl = list.filter((d) => ddlIdOf(d) !== id); return 1 }
  if (scope === 'after') {
    const before = list.length
    c.ddl = list.filter((d) => !(d.sid === sid && d.at >= it.at))
    return before - (c.ddl?.length ?? 0)
  }
  const before = list.length
  c.ddl = list.filter((d) => d.sid !== sid)
  return before - (c.ddl?.length ?? 0)
}

/** 改一条：日期 / 类型 / 备注（label 传空字符串 = 清掉备注）。找不到 → null。 */
export function updateDdl(c: CardGantt, id: string, patch: { at?: string; kind?: 'hard' | 'soft'; label?: string }): GanttDDL | null {
  const list = c.ddl ?? []
  const it = list.find((d) => ddlIdOf(d) === id)
  if (!it) return null
  if (patch.at !== undefined) {
    if (!isDay(patch.at)) throw new Error('截止时间必须是 yyyy-mm-dd：' + patch.at)
    if (it.at !== patch.at) { if (!it.id) it.id = ddlIdOf(it); it.at = patch.at }
  }
  if (patch.kind !== undefined) it.kind = patch.kind === 'soft' ? 'soft' : 'hard'
  if (patch.label !== undefined) { const v = patch.label.trim(); if (v) it.label = v; else delete it.label }
  sortDdl(list)
  return it
}

/** 删一条（按 id；兼容老数据把 at 当 id）。 */
export function removeDdl(c: CardGantt, id: string): boolean {
  const list = c.ddl ?? []
  const n = list.length
  c.ddl = list.filter((d) => ddlIdOf(d) !== id)
  return c.ddl.length !== n
}

/** 三条边的宽度（越界夹紧；null / undefined = 复位回默认，删掉这一项）。 */
export function setUi(g: GanttState, patch: Record<string, unknown>): GanttUI {
  const ui = g.ui ?? (g.ui = {})
  /** null = 显式复位（删掉这一项）；非法值 = undefined（不动，别把用户设好的宽度悄悄清掉）。 */
  const clamp = (v: unknown, lo: number, hi: number): number | null | undefined => {
    if (v === null) return null
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (!Number.isFinite(n)) return undefined
    return Math.round(Math.min(hi, Math.max(lo, n)))
  }
  const put = (k: 'lw' | 'tpw' | 'dw' | 'tpr', lo: number, hi: number): void => {
    if (!(k in patch)) return
    const v = clamp(patch[k], lo, hi)
    if (v === null) delete ui[k]
    else if (v !== undefined) ui[k] = v
  }
  put('lw', 200, 520); put('tpw', 240, 4000); put('dw', 360, 760); put('tpr', 5, 95)
  // v98：项目组时间显隐（布尔）。null = 复位回默认（隐藏）；非布尔 = 不动。
  if ('gtime' in patch) {
    const v = patch.gtime
    if (v === null) delete ui.gtime
    else if (typeof v === 'boolean') ui.gtime = v
  }
  /* v110：pending 项目显隐（布尔）。null = 复位回默认（显示）；非布尔 = 不动。 */
  if ('pend' in patch) {
    const v = patch.pend
    if (v === null) delete ui.pend
    else if (typeof v === 'boolean') ui.pend = v
  }
  /* v118：本日计划清单收起 / 只显示可安排（布尔）。null = 复位回默认（收起 / 开）；非布尔 = 不动。 */
  if ('pfold' in patch) {
    const v = patch.pfold
    if (v === null) delete ui.pfold
    else if (typeof v === 'boolean') ui.pfold = v
  }
  if ('plonly' in patch) {
    const v = patch.plonly
    if (v === null) delete ui.plonly
    else if (typeof v === 'boolean') ui.plonly = v
  }
  /* v121：只显示本日完成（布尔）。 */
  if ('pldone' in patch) {
    const v = patch.pldone
    if (v === null) delete ui.pldone
    else if (typeof v === 'boolean') ui.pldone = v
  }
  /* v121 / v124：计划清单开合记忆 + 执行安排分区开合（字符串数组，只认 key 形状；null = 复位） */
  const keyList = (v: unknown, max: number): string[] | null | undefined => {
    if (v === null) return null
    if (!Array.isArray(v)) return undefined
    const out: string[] = []
    for (const x of v) if (typeof x === 'string' && x.length <= 160 && /^[gpts]\|[\w|-]+$/.test(x) && !out.includes(x)) out.push(x)
    return out.slice(0, max)
  }
  for (const k of ['plclosed', 'plopen'] as const) {
    if (!(k in patch)) continue
    const v = keyList(patch[k], 4000)
    if (v === null) delete ui[k]
    else if (v !== undefined) ui[k] = v
  }
  if ('tpm' in patch) {
    const v = patch.tpm
    if (v === null) delete ui.tpm
    else if (v === 'ex' || v === 'pl' || v === 'split') ui.tpm = v
  }
  if ('exz' in patch) {
    const v = patch.exz
    if (v === null) delete ui.exz
    else if (Array.isArray(v)) ui.exz = [...new Set(v.filter((x): x is string => typeof x === 'string' && ZONES.has(x as PanelZone)))]
  }
  return ui
}

/** 卡片组里干活的任务数（叶子任务完成 / 全部）。 */
export function taskStats(tasks: Task[]): { done: number; total: number } {
  let done = 0, total = 0
  const walk = (l: Task[]): void => { for (const t of l) { if (t.subs?.length) walk(t.subs); else { total++; if (t.done) done++ } } }
  walk(tasks ?? [])
  return { done, total }
}

export interface GanttCardOut {
  id: string; g: string; t: string; stage: string; done: number; total: number
  created: string; archivedAt?: string
  /** v86：与项目看板一致的展示顺序（阶段序号 × 1000 + 列内 order）。 */
  seq: number
  /** v86：pending 卡片不进日程（行、计数、组统计都不算）。 */
  pending?: boolean
  plan: string[]; actual: Array<{ day: string; src: 'auto' | 'manual' }>; ddl: GanttDDL[]
  /** 会话自动涂上的原始日子（任务面板「执行 · 会话」标签与提示用）。 */
  auto: string[]
  /** 手动动过、已关掉会话自动的日子（小窗文案「这天的会话自动已关闭」用）。 */
  autoOff: string[]
  /** v105：卡片任务（任务面板「本日计划清单」要用；子任务只取一层，与详情一致）。 */
  tasks: Array<{ id: string; text: string; done: boolean; due?: string; sess?: string; subs: Array<{ id: string; text: string; done: boolean; due?: string; sess?: string }> }>
}
export interface GanttGroupOut { id: string; name: string; upd: number; archivedAt?: string; stages: Array<{ id: string; name: string }>; collapsed?: boolean }
export interface GanttPayload {
  rev: string
  today: string
  groups: GanttGroupOut[]
  cards: GanttCardOut[]
  /** v105：每日任务面板按天状态（勾选 = 当天完成 / 选中 = 排今天 / 排布）。 */
  panels: Record<string, PanelDay>
  ui: GanttUI
  /** 会话查询不可用 / 某些会话读失败：界面点名提示，不静默退化。 */
  degraded: string[]
}

/** v133 R1：快照版本号只看会显示的数据 —— 降级原因（统计实况，各轮顺序 / 内容会抖）不进 rev，否则 5s 轮询每次都整页重画。 */
export function revOf(body: Omit<GanttPayload, 'rev'>): string {
  const { degraded: _dg, ...shown } = body
  const s = JSON.stringify(shown)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

/** v137：任务截止旗的 id 前缀（ddl-move / ddl-del 见到它就改 task.due）。 */
export const TASK_DDL = 'tk:'
/** v137：任务 / 子任务的截止 = 卡片的一个截止时间（派生，不另存）；label = 任务名（子任务 = 父任务 › 子任务）。 */
export function taskDdl(c: Card): GanttDDL[] {
  const out: GanttDDL[] = []
  const push = (t: Task, label: string): void => { if (t.id && t.due && isDay(t.due)) out.push({ id: TASK_DDL + t.id, at: t.due, kind: 'hard', label, task: t.id, ...(t.done ? { done: true } : {}) }) }
  for (const t of c.tasks ?? []) { push(t, t.text); for (const x of t.subs ?? []) push(x, t.text + ' › ' + x.text) }
  return out
}
/** 组行 = 子卡并集（计划 / 实际 / 截止日都取并集），客户端按天数组自己算。 */
export function payload(b: Board, g: GanttState, auto: Record<string, string[]>, degraded: string[], events: BoardEvent[] = [], now = Date.now()): Omit<GanttPayload, 'rev'> {
  const cards: GanttCardOut[] = []
  for (const c of b.cards) {
    const grp = b.groups.find((x) => x.id === c.g)
    if (!grp) continue
    const st = g.cards[c.id]
    const stats = taskStats(c.tasks ?? [])
    const act = actualDays(st, auto[c.id] ?? [])
    const stIdx = Math.max(0, grp.statuses.findIndex((s) => s.id === c.col))
    cards.push({
      id: c.id, g: c.g, t: c.t, stage: grp.statuses.find((s) => s.id === c.col)?.name ?? '',
      done: stats.done, total: stats.total,
      created: ymd(cardCreated(c)), ...(c.archivedAt ? { archivedAt: c.archivedAt } : {}),
      seq: stIdx * 1000 + (c.order ?? 0),
      ...(c.pending ? { pending: true } : {}),
      plan: [...planDays(c, st, events, now)].sort(),
      actual: [...act.entries()].map(([day, src]) => ({ day, src })).sort((a, b) => a.day.localeCompare(b.day)),
      ddl: [...(st?.ddl ?? []).map((d): GanttDDL => ({ id: ddlIdOf(d), at: d.at, kind: ddlKindOf(d), ...(d.label ? { label: d.label } : {}), ...(d.sid ? { sid: d.sid } : {}), ...(d.rep ? { rep: d.rep } : {}) })), ...taskDdl(c)]
        .sort((a, b) => a.at.localeCompare(b.at) || (a.id ?? '').localeCompare(b.id ?? '')),
      auto: [...new Set((auto[c.id] ?? []).filter(isDay))].sort(),
      autoOff: [...new Set((st?.autoOff ?? []).filter(isDay))].sort(),
      tasks: (c.tasks ?? []).map((t) => ({
        id: t.id as string, text: t.text, done: t.done === true, ...(t.due ? { due: t.due } : {}), ...(t.sess ? { sess: t.sess } : {}),
        /* v142（反馈）：已完成子任务带上完成那天（= 最后修改时间的本地日期），执行安排只列「未完成 + 这天完成的」 */
        subs: (t.subs ?? []).map((x) => ({ id: x.id as string, text: x.text, done: x.done === true, ...(x.due ? { due: x.due } : {}), ...(x.sess ? { sess: x.sess } : {}), ...(x.done && x.updated ? { doneDay: localDay(x.updated) } : {}) })),
      })),
    })
  }
  const groups: GanttGroupOut[] = b.groups.map((grp: Group) => ({
    id: grp.id, name: grp.name, upd: Date.parse(grp.updatedAt ?? '') || 0, ...(grp.archivedAt ? { archivedAt: grp.archivedAt } : {}),
    stages: grp.statuses.map((s) => ({ id: s.id, name: s.name })),
    ...(grp.collapsed ? { collapsed: true } : {}),
  }))
  /* v133 R1：降级原因排序去重（会话统计各轮按遍历顺序 push，顺序会抖） */
  return { today: todayKey(now), groups, cards, panels: { ...(g.panels ?? {}) }, ui: { ...(g.ui ?? {}) }, degraded: [...new Set(degraded)].sort() }
}

/** 纯函数：把 events.jsonl 文本解析成事件（非法行忽略）。 */
export function eventsFromText(text: string): BoardEvent[] {
  const out: BoardEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { const e = JSON.parse(line) as BoardEvent; if (e && typeof e.at === 'string' && typeof e.kind === 'string') out.push(e) } catch { /* 坏行忽略 */ }
  }
  return out
}
