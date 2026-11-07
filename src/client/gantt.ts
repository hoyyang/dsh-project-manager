/**
 * 0.31 任务日程看板（甘特图）：一比一移植 prototype/dsh-web-v80.html 的页面 + 交互。
 * 数据全部来自 host（GET /gantt 派生快照）；变更 POST 回 host，服务端是唯一事实来源。
 * 只画甘特图这一页；右侧「卡片详情」在 BoardView 里（点项目名 = 让 BoardView 打开详情）。
 */
import { ApiError, GanttCard, GanttData, GanttZone, getGantt, getState, poll, post as postBoard, postGantt } from './api.js'
import { esc, ic } from './icons.js'
import { cardLive, chipHtml, followSession, newBtnHtml, pchipHtml, sessLive, wsHighlight } from './sess.js'
import { dueChip, pickZone, recInFlight, ringEl, setPanelCache, setPanelToday, setXS, type XSched } from './gtextra.js'

export interface SchedHost {
  toast(msg: string, kind?: 'ok' | 'err'): void
  /** 点项目名 / 任务面板里的名字：打开右侧卡片详情（不切页面）。 */
  openCard(cardId: string): void
  /** v105：面板里点任务项卡片 → 打开卡片详情并直接落在「任务」区域（展开 + 滚到顶 + 轻微高亮）。 */
  openCardTasks?(cardId: string, taskId?: string | null): void
  /** 服务端快照里的三条边宽度变了（刷新 / 另一处改动）：BoardView 用 dw 同步详情宽度。 */
  uiChanged?(ui: { lw?: number; tpw?: number; dw?: number }): void
  /** v86：有活跃会话的卡片组 id（「只展开活跃卡片组」和看板同一口径）。 */
  liveGroups?(): string[]
  /** v122：面板里勾了任务完成 → 卡片详情 / 看板换成最新快照（同一份任务数据，双向实时同步）。 */
  tasksChanged?(cardId: string): void
  /** v122（2）：「今天」按钮的按下态 = 正在看今天的任务面板（日程页 + 面板开着 + 面板日期 = 今天）。 */
  todayChanged?(on: boolean): void
}

const D = 86400000
const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MON = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']
const FLAG = '<svg viewBox="0 0 15 15" aria-hidden="true"><path d="M1.7 1.6v11.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M2.1 2.1h9l-1.6 3.1 1.6 3.1h-9z" fill="currentColor"/></svg>'
/** v105：每日任务面板图标（暂停 / 取消必须显式写 stroke，否则 SVG 默认按 fill 画 = 只剩色块）。 */
const PV_ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.4v13.2M15 5.4v13.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 3.3v4M16 3.3v4M4 10.2h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="14.6" r="1.9" fill="currentColor" stroke="none"/></svg>',
  playBig: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.2 8.7v6.6l5.4-3.3z" fill="currentColor" stroke="none"/></svg>',
  flag: FLAG,
  /* v122（1.1）：「等外部进展」= 沙漏 */
  wait: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10M7 20h10M8 4c0 4.2 4 5.6 4 8s-4 3.8-4 8M16 4c0 4.2-4 5.6-4 8s4 3.8 4 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  /* v122（1.4）：记录当日执行 = 日历 + 勾 */
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8 3.4v3.2M16 3.4v3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="m8.6 13.2 2.4 2.4 4.6-4.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

/** v98：项目组时间显隐开关的两颗眼睛（显示时亮眼、隐藏时划掉）。 */
const EYE = '<svg class="on-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.9"/></svg>'
const EYE_OFF = '<svg class="off-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 4.6l15.2 15.2"/><path d="M9.7 6.1A9.7 9.7 0 0 1 12 5.8c5.6 0 9.2 6.2 9.2 6.2a16.4 16.4 0 0 1-3.3 3.9"/><path d="M6.6 8.2A16.3 16.3 0 0 0 2.8 12S6.4 18.2 12 18.2c1.4 0 2.7-.3 3.8-.9"/></svg>'

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (ms: number): string => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
const dayMs = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
const md = (ms: number): string => { const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() }
const longDate = (ms: number): string => ymd(ms) + ' ' + DAYS[new Date(ms).getDay()]
const firstOfMonth = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
const addMonths = (ms: number, n: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime() }
const quarterStart = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime() }
const mondayOf = (ms: number): number => { const d = new Date(ms); const dow = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime() }
const isoWeek = (ms: number): number => { const d = new Date(ms); const t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (new Date(t).getUTCDay() + 6) % 7; const thu = t - dow * D + 3 * D; const y = new Date(thu).getUTCFullYear(); return 1 + Math.floor((thu - Date.UTC(y, 0, 1)) / D / 7) }
const diffDays = (a: number, b: number): number => Math.round((b - a) / D)

/** v99 截止时间：同一天可多个，kind = 硬性（红旗）/ 软性（v106 起改实际时间条蓝）。 */
interface DdlM { id: string; at: string; kind: 'hard' | 'soft'; label?: string; ms: number; /** v137：来自任务 / 子任务截止（task = 任务 id；done = 任务已完成）。 */ task?: string; done?: boolean; /** v101：重复截止的系列 id 与规则。 */ sid?: string; rep?: { unit: 'day' | 'week' | 'month'; n: number; until?: string } }
/** v101：重复截止的 ↻ 角标（用 SVG，不用 emoji）。 */
const RQ_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 9.4A8 8 0 0 1 19 7.3"/><path d="M19.6 3.9v4.2h-4.2"/><path d="M19.4 14.6A8 8 0 0 1 5 16.7"/><path d="M4.4 20.1v-4.2h4.2"/></svg>'
const DDL_FRESH = new Set<string>()
const ddlKind = (d: DdlM): 'hard' | 'soft' => (d.kind === 'soft' ? 'soft' : 'hard')
/** 同一天多条 → 那一组旗子 / 点该长哪两种颜色：>1 硬 → 红红；1 硬 1 软 → 红橙；只有软 → 橙橙。 */
const ddlKinds = (list: DdlM[]): Array<'hard' | 'soft'> => {
  const hard = list.filter((d) => ddlKind(d) === 'hard').length
  if (list.length <= 1) return [hard ? 'hard' : 'soft']
  return hard > 1 ? ['hard', 'hard'] : hard === 1 ? ['hard', 'soft'] : ['soft', 'soft']
}
/** v105：卡片任务（计划清单用；子任务只取一层）。 */
interface TaskM { id: string; text: string; done: boolean; due?: string; sess?: string; subs: Array<{ id: string; text: string; done: boolean; due?: string; sess?: string; doneDay?: string }> }
/** v105：一天的看板面板状态（勾选 / 选中 / 排布）；执行中 / 已暂停是运行态，不在这里。 */
/** v121–v123：执行安排的行分区（已安排用 lanes，其余四个用 zl）。 */
type ZlKey = 'pause' | 'wait' | 'run' | 'un'
const ZL_KEYS: ZlKey[] = ['pause', 'wait', 'run', 'un']
interface PanelDayM { done: Set<string>; sel: Set<string>; lanes: string[][] | null; /** v111：这一天已经跑过自动续排 */ carry?: boolean; zl: Record<ZlKey, string[][]>; doneAt: Map<string, number>; from: Map<string, GanttZone> }
interface CardM {
  id: string; g: string; t: string; stage: string; done: number; total: number
  createdMs: number; arch?: string; pending?: boolean; seq: number
  planSet: Set<string>; actualSet: Set<string>
  actualAuto: Set<string>; actualManual: Set<string>; autoOff: Set<string>
  ddlList: DdlM[]
  tasks: TaskM[]
}
interface GroupM { id: string; name: string; upd: number; collapsed?: boolean; cards: CardM[] }

const ZOOM: Record<string, { base: number; unit: string; back: number; fwd: number }> = {
  day: { base: 44, unit: 'day', back: 20, fwd: 22 },
  week: { base: 62, unit: 'week', back: 8, fwd: 5 },
  month: { base: 88, unit: 'month', back: 5, fwd: 4 },
  quarter: { base: 96, unit: 'quarter', back: 4, fwd: 4 },
}

const SHELL = '<header class="sc-bar">'
  + '<div class="sc-bar-l"><h1 class="sc-title">任务日程看板</h1>'
  + '<div class="seg" role="group" aria-label="时间粒度">'
  + '<button type="button" data-z="day" aria-pressed="true">日</button><button type="button" data-z="week" aria-pressed="false">周</button><button type="button" data-z="month" aria-pressed="false">月</button><button type="button" data-z="quarter" aria-pressed="false">季度</button>'
  + '</div><span class="vsep" aria-hidden="true"></span>'
  + '<div class="sc-nav"><button class="btn sm icon" id="btnPrev" type="button" aria-label="向前翻一屏">' + ic('chev') + '</button><button class="btn sm" id="btnToday" type="button">今天</button><button class="btn sm icon" id="btnNext" type="button" aria-label="向后翻一屏">' + ic('chev') + '</button></div></div>'
  + '<div class="sc-bar-r"><div class="search" id="searchBox">' + ic('search') + '<input id="q" type="search" placeholder="搜索项目 / 项目组" aria-label="搜索项目或项目组" autocomplete="off" spellcheck="false"><button class="sclr" id="qClr" type="button" hidden aria-label="清空搜索" title="清空搜索">' + ic('x') + '</button></div>'
  + '<button class="chipbtn" id="fPend" type="button" aria-pressed="true" title="显示 / 隐藏全部 pending 项目（目录与时间轴一起；已归档项目不显示）；选择会记住"><span class="pd"></span><span id="fPendLb">隐藏 pending 项目</span><span class="pcount" id="fPendN" hidden></span></button></div></header>'
  + '<div class="sc-mgr" role="toolbar" aria-label="卡片组展开 / 收起">'
  + '<span class="lbl">项目组</span>'
  + '<div class="sc-seg" role="group" aria-label="一键展开 / 只展开活跃卡片组 / 一键折叠">'
  + '<button class="btn" type="button" data-sc-all-open title="所有卡片组都展开">一键展开</button>'
  + '<button class="btn" type="button" data-sc-only-live title="只展开有活跃会话的卡片组，其余收起">只展开活跃卡片组</button>'
  + '<button class="btn" type="button" data-sc-all-fold title="所有卡片组都收起">一键折叠</button>'
  + '</div><span class="sep" aria-hidden="true"></span>'
  + '<button class="gtoggle" id="scGtime" type="button" aria-pressed="false" aria-controls="rows" title="一键显示所有项目组的时间（计划条 / 实际条 / 截止标记）—— 选择会记住">' + EYE + EYE_OFF + '<span class="gt-lb">显示项目组时间</span></button>'
  + '<span class="sep" aria-hidden="true"></span><span class="scmgr-n" id="scMgrCount"></span>'
  + '<span class="grow"></span><span class="sc-tip">双击日期格设置计划 / 执行</span></div>'
  + '<div class="sc-stage"><i class="lw-resize" id="lwResize" role="separator" aria-orientation="vertical" tabindex="0" aria-label="拖动调整项目目录宽度" title="拖动调整「项目组 / 项目」目录宽度（双击复位）"></i>'
  + '<div class="sc-scroll" id="scroll"><div class="sc-grid" id="grid"><div class="sc-head"><div class="sc-head-l"><b>项目组 / 项目</b><span id="headCount"></span></div><div class="sc-head-t" id="headT"></div></div><div class="sc-bg" id="bg" aria-hidden="true"></div><div class="sc-rows" id="rows"></div><div class="sc-overlay" id="ov" aria-hidden="true"></div></div></div>'
  + '<aside class="tp" id="tp" aria-label="任务面板"><i class="tp-resize" id="tpResize" role="separator" aria-orientation="vertical" tabindex="0" aria-label="拖动调整任务面板宽度" title="拖动调整任务面板宽度（双击复位）"></i>'
  + '<div class="tp-h"><div class="tp-d"><b id="tpDay">—</b><span id="tpSub"></span></div><button class="ib" id="tpPrev" type="button" aria-label="前一天">' + ic('chev') + '</button><button class="ib" id="tpNext" type="button" aria-label="后一天">' + ic('chev') + '</button><button class="ib" id="tpClose" type="button" aria-label="收起任务面板">' + ic('x') + '</button></div>'
  + '<div class="tp-stat" id="tpStat">—</div>'
  + '<div class="tp-pair" id="tpPair">'
  + '<section class="tpc" id="tpExCard" aria-labelledby="tpExT"><header class="tpc-h"><span class="tic" aria-hidden="true">' + PV_ICON.playBig + '</span><h2 id="tpExT">任务执行安排</h2><span class="tpc-n" id="exN">—</span><span class="tpc-hint">任意区之间可拖 · 放下即改状态 · 同一行 = 并行</span><button class="plcard-fold excard-fold" type="button" id="exCardFold" aria-controls="exBody" aria-expanded="true" aria-label="收起任务执行安排（只留标题栏）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.4 5.5 5.2 5.5-5.2"/></svg></button></header><div class="tpc-b" id="exBody"></div></section>'
  + '<i class="tp-split" id="tpSplit" role="separator" aria-orientation="horizontal" aria-label="拖动调整两张卡片的高度：拖到最上 = 执行安排收起，拖到最下 = 计划清单收起；双击 = 3 : 2" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" tabindex="0"><b aria-hidden="true"></b></i>'
  + '<section class="tpc" id="tpPlanCard" aria-labelledby="tpPlT"><header class="tpc-h"><span class="tic" aria-hidden="true">' + PV_ICON.list + '</span><h2 id="tpPlT">本日计划清单</h2><span class="tpc-n" id="plN">—</span><button class="hdchip" type="button" id="plRecChip" hidden title="本日计划清单里之前排过、还没完成的项：点一下跳过去"></button><span class="pltools"><span class="tpc-hint">点「排今天」选中</span><span class="plbtns"><button class="plbtn" type="button" id="plFoldAll" data-pl-foldall aria-pressed="false" title="一键展开 / 收起：展开 = 项目 / 任务 / 子任务全部打开；收起 = 只留项目">收起全部</button><button class="plbtn" type="button" id="plOnlyBtn" data-pl-only aria-pressed="false" title="只显示可安排：隐藏已完成或已排的任务项，其余全部展开">只显示可安排</button><button class="plbtn dn" type="button" id="plDoneBtn" data-pl-done aria-pressed="false" title="只显示本日执行完成项：今天记录过执行的项目 / 任务 / 子任务">只显示本日完成</button></span><button class="plcard-fold" type="button" id="plCardFold" data-pl-cardfold aria-pressed="false" aria-controls="tpList" aria-label="收起本日计划清单（只留标题栏）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.4 5.5 5.2 5.5-5.2"/></svg></button></span></header><div class="tpc-b pl-b" id="tpList"></div></section>'
  + '</div></aside>'
  + '</div>'

type UiPatch = { tpm?: 'ex' | 'pl' | 'split' | null; lw?: number | null; tpw?: number | null; dw?: number | null; tpr?: number | null; pfold?: boolean | null; plonly?: boolean | null; pldone?: boolean | null; plclosed?: string[] | null; plopen?: string[] | null; exz?: string[] | null }

export class SchedView {
  private data: GanttData | null = null
  private groups: GroupM[] = []
  private state = {
    zoom: 'day', q: '', showPending: true, plOnly: true, plFold: true, plDone: false, tpm: 'ex' as 'ex' | 'pl' | 'split', anchor: 0, day: 0,
    closed: new Set<string>(), lw: null as number | null, tpw: null as number | null, tpr: null as number | null, sel: null as string | null,
    /** v98：项目组行的时间信息（计划条 / 实际条 / 截止点 / 引导虚线）是否显示（默认隐藏）。 */
    gtime: false,
    px: 0,
    /** v86：左右各续了几「屏」（预取式，单侧上限 10 屏）。 */
    padB: 0, padF: 0,
    lastZoom: '' as string | null, lastW: -1,
  }
  private st2: {
    px: number
    win: { start: number; end: number; cfg: { base: number; unit: string } } | null
    seg: { fine: Array<{ s: number; e: number; x: number; w: number; a?: string; b?: string; we?: boolean }>; coarse: Array<{ x: number; w: number; label?: string }>; width: number } | null
  } = { px: 0, win: null, seg: null }
  private timer: (() => void) | null = null
  private uiTimer = 0
  private disposed = false
  /** v90：本页是不是正开着（切到项目看板后不停轮询、也不再起后台会话统计）。 */
  private active = true
  private overlays = new Set<HTMLElement>()
  /** v143（1.1）：每日任务面板列宿主（body 上） */
  tpHostEl: HTMLElement | null = null
  private offs: Array<() => void> = []
  /** 3(3)-②：数据还没到时先记下要展开的卡片，首帧 applyData 后再选中 / 滚动。 */
  private pendingReveal: string | null = null
  /** v127（7）：隐藏时画过 = 尺寸不对，显示时必须重画一次。 */
  private roDirty = false
  /** v133 R3：还有一次重画在排队（推迟到上屏之后）；drawn = 那次画完要做的事 */
  private drawPending: () => boolean = () => false
  private drawn: Array<() => void> = []
  /** v133 R2：上一次 render 时的页宽 —— ResizeObserver 见到同一宽度就不再补画（详情打开时曾经多画一遍） */
  roW = 0
  /** v87：组折叠的在途写回——轮询快照到达时先用本地值覆盖；POST 完成且服务端快照一致后再交给服务端。 */
  private pendingClosed = new Map<string, { v: boolean; seq: number; done?: boolean }>()
  private gseq = 0
  /** v98：项目组时间显隐正在写回（期间忽略服务端旧快照里的值）。 */
  private gtimeBusy = 0
  /** v110：pending 显隐在途保存（期间不被 5s 快照覆盖）。 */
  private pendBusy = 0
  /** v118：本日计划清单收起 / 只显示可安排在途保存（期间不被 5s 快照覆盖）。 */
  private plBusy = 0
  /** v121/v124：计划清单开合 / 执行安排分区开合在途保存。 */
  private foldBusy = 0
  private applyData: (d: GanttData) => void = () => undefined
  /** v121（3）/ v122（2）：侧栏「今天」—— 打开今天面板 / 关闭面板 / 按下态同步。 */
  private syncToday: () => void = () => undefined
  openToday: () => void = () => { this.wantToday = true }
  closeToday: () => void = () => undefined
  /** v127：打开今天面板 → 展开分区 → 滚到这些任务项卡片闪一下（今天没排 = 在本日计划清单里闪对应行）。 */
  seek: (keys: string[]) => void = (keys) => { this.wantSeek = keys; this.wantToday = true }
  private wantSeek: string[] | null = null
  private wantToday = false
  private refreshNow: () => void = () => undefined
  private host: SchedHost

  constructor(readonly root: HTMLElement, host: SchedHost) {
    this.host = host
    root.classList.add('sched')
    root.innerHTML = SHELL
    this.boot()
    /* v143（1.1）：面板列开着时，不在日程页也要轮询（执行安排 / 计划清单实时） */
    this.timer = poll(5000, () => { if ((this.active && this.root.isConnected) || this.root.classList.contains('tp-on')) void this.load(true) })
    void this.load()
  }

  dispose(): void {
    this.disposed = true
    this.timer?.()
    clearTimeout(this.uiTimer)
    for (const off of this.offs) off()
    this.offs = []
    for (const el of this.overlays) el.remove()
    this.overlays.clear()
    this.root.classList.remove('sched')
    this.root.innerHTML = ''
  }

  /** 右侧卡片详情开 / 关 / 拖宽之后：本页宽度变了，重算每格像素。 */
  layout(): void { if (!this.disposed) this.refreshNow() }
  /** 3(3)-②：从卡片详情回到本页时，展开项目组、选中并滚到这一行；状态与直接点击项目名一致。 */
  reveal(cardId: string): void {
    if (this.disposed) return
    const g = this.groups.find((x) => x.cards.some((c) => c.id === cardId))
    if (!g) { this.pendingReveal = cardId; return }
    this.pendingReveal = null
    this.state.closed.delete(g.id)
    this.state.sel = cardId
    this.refreshNow()
    /* v133 R3：重画可能推迟到上屏之后 —— 滚动等它画完再量 */
    const go = (): void => {
      const row = this.root.querySelector('.sc-row[data-c="' + CSS.escape(cardId) + '"]') as HTMLElement | null
      const sc = this.root.querySelector('#scroll') as HTMLElement | null
      if (!row || !sc) return
      // v86：只滚甘特图自己的滚动区。scrollIntoView 会连宿主外层容器一起滚（0.19 主实例踩过，
      // 表现为切页时整页被顶走 / 看起来像跳到了别的视图），这里改成手算偏移。
      const rr = row.getBoundingClientRect(), sr = sc.getBoundingClientRect()
      const top = sc.scrollTop + (rr.top - sr.top) - Math.max(16, (sc.clientHeight - rr.height) / 2)
      sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
    if (this.drawPending()) this.drawn.push(go)
    else requestAnimationFrame(go)
  }
  /** 重新拉一次快照（例如切回本页）。 */
  reload(): void { void this.load(!!this.data) }
  /** v90：切页时开关 --- 只有日程页开着才轮询 / 起会话统计（离开后宿主要立刻轻下来）。 */
  /* 切到会话页再切回来，日程页节点被宿主藏掉（display:none）→ 浏览器把甘特横向 / 执行安排 / 计划清单的滚动归零：
     平时记下最后一次滚动位置，节点重新可见（ResizeObserver 从 0 变回有尺寸）时原样放回 */
  private keepSc = new Map<string, [number, number]>()
  private keepWired = false
  private wireKeep(): void {
    if (this.keepWired) return
    this.keepWired = true
    for (const s of ['#scroll', '#exBody', '#tpList']) {
      const e = this.root.querySelector<HTMLElement>(s) ?? this.tpHostEl?.querySelector<HTMLElement>(s) ?? null; if (!e) continue
      e.addEventListener('scroll', () => { if (e.clientWidth || e.clientHeight) this.keepSc.set(s, [e.scrollLeft, e.scrollTop]) }, { passive: true })
      let was = !!(e.clientWidth || e.clientHeight)
      const ro = new ResizeObserver(() => { const now = !!(e.clientWidth || e.clientHeight); if (now && !was) { const k = this.keepSc.get(s); if (k) { if (k[0] && !e.scrollLeft) e.scrollLeft = k[0]; if (k[1] && !e.scrollTop) e.scrollTop = k[1] } } was = now })
      ro.observe(e)
      this.offs.push(() => ro.disconnect())
    }
  }
  setActive(on: boolean): void {
    if (this.disposed || this.active === on) return
    this.active = on
    this.wireKeep()
    if (on) void this.load(!!this.data)
    this.syncToday()
  }

  private async load(quiet = false, full = false): Promise<void> {
    if (this.disposed) return
    this.wireKeep()
    try {
      // v90：只有日程页正开着才起后台会话统计（宿主侧 warm=1）；切走后既不再拉数据、也不再解压会话日志。
      const r = await getGantt(quiet && !full && this.data ? this.data.rev : undefined, this.active)
      if (this.disposed || (r as { same?: boolean }).same) return
      try {
        this.applyData(r)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[dpm-gantt] apply failed', e)
        this.root.dataset.err = String(e)
        this.host.toast('任务日程看板渲染失败：' + String(e), 'err')
      }
    } catch (e) {
      if (this.disposed) return
      this.root.dataset.err = 'load: ' + (e instanceof ApiError ? e.message : String(e))
      if (!quiet) this.host.toast('读取任务日程看板失败：' + (e instanceof ApiError ? e.message : String(e)), 'err')
    }
  }

  /** 变更：乐观更新已经由调用方做；服务端回包后以服务端为准重画。 */
  private async mutate(key: string, body: Record<string, unknown>): Promise<void> {
    try {
      const r = await postGantt(key, body)
      if (this.disposed) return
      if (r.gantt) this.applyData(r.gantt)
    } catch (e) {
      this.host.toast(e instanceof ApiError ? e.message : String(e), 'err')
      void this.load()
    }
  }

  /** 右侧卡片详情当前的记忆宽度（null = 没设过）。 */
  detailWidth(): number | null { return typeof this.data?.ui.dw === 'number' ? this.data.ui.dw as number : null }
  /** 右侧卡片详情拖完 / 复位：落盘（BoardView 调）。 */
  saveDetailWidth(w: number | null): void { void this.mutate('ui', { dw: w }) }

  /** v118：面板偏好在途 patch（多次调用合并成一次写，别互相顶掉）。 */
  private uiPatch: UiPatch = {}
  /** 三条边的宽度 / 面板偏好落盘（拖完 / 复位 / 切换时才发，过程只在本地）。 */
  private saveUi(patch: UiPatch): void {
    Object.assign(this.uiPatch, patch)
    clearTimeout(this.uiTimer)
    this.uiTimer = window.setTimeout(() => { const p = this.uiPatch; this.uiPatch = {}; void this.mutate('ui', p) }, 220)
  }

  private bodyAppend(el: HTMLElement): void { this.overlays.add(el); document.body.append(el) }

  private boot(): void {
    const root = this.root
    const host = this.host
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    /* v143（1.1）：每日任务面板独立成一列 —— #tp 搬到 body 上的列宿主（.dpm.dpm-tpcol > .sched），和卡片详情 / 右侧栏 / Android 平级；
       切到会话 / 看板页面板也不关。查询先找甘特根，找不到再找面板宿主（两边的 id 不重复）。 */
    const tpHost = document.createElement('div')
    tpHost.className = 'dpm dpm-tpcol'
    tpHost.hidden = true
    tpHost.innerHTML = '<div class="sched tpwrap"></div>'
    const tpBox = tpHost.firstElementChild as HTMLElement
    tpBox.append(root.querySelector('#tp') as HTMLElement)
    document.body.append(tpHost)
    self.tpHostEl = tpHost
    self.overlays.add(tpHost)
    const $ = (s: string, r?: ParentNode): HTMLElement | null => (r ? r.querySelector(s) : (root.querySelector(s) ?? tpBox.querySelector(s))) as HTMLElement | null
    const $$ = <T extends Element = HTMLElement>(s: string, r?: ParentNode): T[] => (r ? Array.from(r.querySelectorAll(s)) : [...Array.from(root.querySelectorAll(s)), ...Array.from(tpBox.querySelectorAll(s))]) as T[]
    /** 面板开着 = 宿主列可见（tp-on 记在甘特根上，CSS / 旧逻辑照旧读它） */
    const tpOn = (): boolean => root.classList.contains('tp-on')
    const inR = (n: Node | null): boolean => !!n && (root.contains(n) || tpBox.contains(n))
    /** 开 / 关面板列：甘特根和面板宿主同一个 tp-on；开关状态记在本机（刷新后照旧）；排版引擎（board.ts）收到 dpm:cols 重排 */
    const setTp = (on: boolean): void => {
      root.classList.toggle('tp-on', on); tpBox.classList.toggle('tp-on', on)
      if (tpHost.hidden === on) tpHost.hidden = !on
      tpHost.dataset.want = String(tpWant())
      if (on && !tpHost.dataset.at) tpHost.dataset.at = String(Date.now())
      if (!on) delete tpHost.dataset.at
      try { localStorage.setItem('dpm-tp-on', on ? '1' : '0') } catch { /* 存不了 = 只是刷新后不恢复 */ }
      window.dispatchEvent(new Event('dpm:cols'))
    }
    const toast = (m: string, k?: 'ok' | 'err'): void => host.toast(m, k)
    const post = (k: string, b: Record<string, unknown>): void => { void self.mutate(k, b) }
    const on = (el: EventTarget, ev: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void => {
      el.addEventListener(ev, fn, opts as never)
      self.offs.push(() => el.removeEventListener(ev, fn, opts as never))
    }
    const overlayRoot = document.createElement('div')
    overlayRoot.className = 'dpm-sc'
    document.body.append(overlayRoot)
    this.offs.push(() => overlayRoot.remove())
    const bodyAppend = (el: HTMLElement): void => { overlayRoot.append(el); this.overlays.add(el) }
    const GROUPS: GroupM[] = this.groups
    const state = this.state
    const st2 = this.st2
    let TODAY = 0
    let NOW = Date.now()
    let drag: null | { c: CardM; edge: 'l' | 'r' | 'm'; rs: number; re: number; x0: number; moved: boolean; warned?: boolean; day: number | null; plan: Set<string>; delta?: number } = null
    let menu: HTMLElement | null = null
    let menuTarget: { card: string; day: number } | null = null
    /** v98 ③：格子小窗的锚（这张卡片的这一行 + 这一天那一格）；跟着格子重算位置。 */
    let dayAnchor: { card: string; day: number; fx: number; fy: number } | null = null
    let followRaf = 0
    let fxEl: HTMLElement | null = null
    let hlEl: HTMLElement | null = null
    let hlKey = ''
    let cvCell: Element | null = null
    let cvName: Element | null = null
    let flagDrag: null | { fl: HTMLElement; c: CardM; dd: DdlM; ms0: number; x0: number; w: number; moved: boolean; ms?: number } = null
    let flagClickMute = false
    let mqEl: HTMLElement | null = null
    /** 当前打开浮层的重画函数：服务端快照回来时同步刷新（否则小窗还显示旧状态） */
    let menuDraw: (() => void) | null = null

    const cardsById = new Map<string, CardM>()
    /** v113：每张卡片「已经画出来过的自动执行日」—— 服务端缓存过期少给几天时，条不会凭空消失（只增不减）。 */
    const AUTOKEEP = new Map<string, Set<string>>()
    const findCard = (id: string): CardM | null => cardsById.get(id) ?? null
    const findGroupOf = (id: string): GroupM | null => GROUPS.find((g) => g.cards.some((c) => c.id === id)) ?? null

    /* ── 数据 → 本页模型（group 按更新时间倒序、卡片按建卡时间正序，与项目看板一致）── */
    function renderNote(d: GanttData): void {
      const el = $('#note')
      if (!el) return
      const list = (d.degraded ?? []).filter((x) => !/正在统计/.test(x))
      el.hidden = list.length === 0
      el.textContent = list.length ? '实际条：' + list.slice(0, 2).join('；') + (list.length > 2 ? '；等 ' + list.length + ' 条' : '') : ''
      el.title = list.join('\n')
    }
    function apply(d: GanttData): void {
      self.data = d
      setPanelCache(d)
      root.dataset.ready = '1'
      root.dataset.cards = String((d.cards || []).length)
      root.dataset.groups = String((d.groups || []).length)
      TODAY = dayMs(d.today)
      NOW = Date.now()
      const byG = new Map<string, CardM[]>()
      /* 同一个卡片 id 复用同一个对象：打开着的格子小窗 / 拖拽闭包握着 c，服务端回包后不能换成新对象 */
      for (const gc of d.cards as Array<GanttCard & { autoOff?: string[] }>) {
        const c = (cardsById.get(gc.id) ?? {}) as CardM
        c.id = gc.id; c.g = gc.g; c.t = gc.t; c.stage = gc.stage; c.done = gc.done; c.total = gc.total
        c.createdMs = dayMs(gc.created)
        c.seq = typeof gc.seq === 'number' ? gc.seq : 0
        if (gc.pending) c.pending = true; else delete c.pending
        if (gc.archivedAt) c.arch = gc.archivedAt; else delete c.arch
        const planArr = Array.isArray(gc.plan) ? gc.plan : []
        const actArr = Array.isArray(gc.actual) ? gc.actual : []
        c.planSet = new Set(planArr)
        c.actualSet = new Set([...actArr.map((x) => x.day), ...(AUTOKEEP.get(gc.id) ?? [])])
        /* v113（1.3）：会话统计缓存一过期，服务端会少给几天自动执行日 → 已画出的条只增不减（并集）；
           用户手动取消掉的那天（autoOff）从并集里剔除，不会被补回来。 */
        {
          const off = new Set(gc.autoOff ?? [])
          const keep = AUTOKEEP.get(gc.id) ?? new Set<string>()
          for (const d of gc.auto ?? []) keep.add(d)
          for (const d of off) keep.delete(d)
          AUTOKEEP.set(gc.id, keep)
          c.actualAuto = new Set([...gc.auto ?? [], ...keep])
        }
        c.actualManual = new Set(actArr.filter((x) => x.src === 'manual').map((x) => x.day))
        c.autoOff = new Set(gc.autoOff ?? [])
        c.ddlList = (gc.ddl ?? []).map((x): DdlM => ({ id: x.id ?? x.at, at: x.at, kind: x.kind === 'soft' ? 'soft' : 'hard', ...(x.label ? { label: x.label } : {}), ...(x.sid ? { sid: x.sid } : {}), ...(x.rep ? { rep: x.rep } : {}), ...(x.task ? { task: x.task, ...(x.done ? { done: true } : {}) } : {}), ms: dayMs(x.at) }))
          .sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))
        c.tasks = (gc.tasks ?? []).map((t) => ({ id: t.id, text: t.text, done: t.done === true, ...(t.due ? { due: t.due } : {}), ...(t.sess ? { sess: t.sess } : {}), subs: (t.subs ?? []).map((x) => ({ id: x.id, text: x.text, done: x.done === true, ...(x.due ? { due: x.due } : {}), ...(x.sess ? { sess: x.sess } : {}), ...((x as { doneDay?: string }).doneDay ? { doneDay: (x as { doneDay?: string }).doneDay } : {}) })) }))
        cardsById.set(c.id, c)
        const arr = byG.get(c.g) ?? []
        arr.push(c); byG.set(c.g, arr)
      }
      for (const id of [...cardsById.keys()]) if (!(d.cards as GanttCard[]).some((x) => x.id === id)) { cardsById.delete(id); AUTOKEEP.delete(id) }
      // v86：组顺序 = 项目看板的组顺序（不按更新时间重排）；卡顺序 = 阶段列 + 列内（host 给的 seq）
      const gs: GroupM[] = d.groups.slice()
        .map((g) => ({ id: g.id, name: g.name, upd: g.upd, collapsed: !!g.collapsed, cards: (byG.get(g.id) ?? []).sort((a, b) => a.seq - b.seq || a.createdMs - b.createdMs) }))
      // v86：组折叠状态跟着看板（服务端 group.collapsed），两个看板不再各记一份
      // v87：刚点过、还没被服务端快照确认的组，用本地在途值覆盖（否则 5s 轮询会把别的组一起弹开）
      const srvClosed = new Set(gs.filter((g) => g.collapsed).map((g) => g.id))
      for (const [id, p] of self.pendingClosed) {
        const g = gs.find((x) => x.id === id)
        const srv = !!g?.collapsed
        if (p.v) srvClosed.add(id); else srvClosed.delete(id)
        if (g) g.collapsed = p.v
        if (p.done && srv === p.v) self.pendingClosed.delete(id)
      }
      state.closed = srvClosed
      GROUPS.splice(0, GROUPS.length, ...gs)
      state.lw = typeof d.ui.lw === 'number' ? d.ui.lw : null
      state.tpw = typeof d.ui.tpw === 'number' ? d.ui.tpw : null
      state.tpr = typeof d.ui.tpr === 'number' ? d.ui.tpr : null
      /* v118：本日计划清单收起（缺省 = 收起）/ 只显示可安排（缺省 = 开）；在途保存期间不被旧快照覆盖 */
      /* 只有服务端真的带了这个字段才采纳（旧 host 不认 pfold / plonly 时，别把用户当前的选择顶掉） */
      /* v130（3）：两张卡开合 ui.tpm（ex = 只开执行安排，默认 / pl = 只开计划清单 / split = 两张都开，比例 tpr）；
         旧数据只有 pfold：收起 = ex，展开 = split（v118 时两张卡本来就都开着） */
      if (!self.plBusy) {
        const m = d.ui.tpm
        if (m === 'ex' || m === 'pl' || m === 'split') state.tpm = m
        else if ('pfold' in d.ui) state.tpm = d.ui.pfold === false ? 'split' : 'ex'
        state.plFold = state.tpm === 'ex'
      }
      if (!self.plBusy && 'plonly' in d.ui) state.plOnly = d.ui.plonly !== false
      /* v121：只显示本日完成（与只显示可安排互斥）+ 开合记忆；v124：执行安排分区开合（缺省 = 只收「本日已执行」） */
      if (!self.plBusy && 'pldone' in d.ui) { state.plDone = d.ui.pldone === true; if (state.plDone) state.plOnly = false }
      if (!self.foldBusy) {
        if (Array.isArray(d.ui.plclosed)) { plClosed.clear(); for (const k of d.ui.plclosed) plClosed.add(k) }
        if (Array.isArray(d.ui.plopen)) { plOpenDone.clear(); for (const k of d.ui.plopen) plOpenDone.add(k) }
        EXZ_CLOSED.clear(); for (const z of Array.isArray(d.ui.exz) ? d.ui.exz : ['done']) EXZ_CLOSED.add(z)
      }
      /* v110：pending 显隐落盘在 ui.pend（在途保存期间不被旧快照覆盖） */
      if (!self.pendBusy) state.showPending = d.ui.pend !== false
      /* v143（1.2）：详情勾完成的记录执行还在途 → 这份快照可能是旧的，先不换面板状态（回包后 panelDirty 再拉一次） */
      /* v105：面板的按天状态整份换成服务端快照（乐观写回由 POST 回包对齐） */
      if (!recInFlight()) { PDAY.clear()
      PST.clear()
      for (const [k, v] of Object.entries(d.panels ?? {})) {
        const zl = { pause: [], wait: [], run: [], un: [] } as Record<ZlKey, string[][]>
        for (const z of ZL_KEYS) zl[z] = (v.zl?.[z] ?? []).map((l) => [...l])
        PDAY.set(k, { done: new Set(v.done ?? []), sel: new Set(v.sel ?? []), lanes: v.lanes ? v.lanes.map((l) => [...l]) : null, ...(v.carry ? { carry: true } : {}), zl, doneAt: new Map(Object.entries(v.doneAt ?? {})), from: new Map(Object.entries(v.from ?? {}) as Array<[string, GanttZone]>) })
        /* v110：执行 / 暂停是落盘状态（服务端 panels[day].pst）；v121 加 wait = 等外部进展 */
        for (const [key, stv] of Object.entries(v.pst ?? {})) if (stv === 'run' || stv === 'pause' || stv === 'wait') PST.set(k + '\n' + key, stv)
      } }
      for (const c of cardsById.values()) pActualAdd(c)
      // v98：项目组时间显隐（在途保存期间不被旧快照覆盖）
      if (!self.gtimeBusy) state.gtime = d.ui.gtime === true
      host.uiChanged?.(d.ui)
      if (!state.anchor) state.anchor = TODAY
      if (!state.day) state.day = TODAY
      if (state.lastZoom === '') syncChips()
      render()
      renderNote(d)
      syncGtime()
      if (menu && menuDraw) menuDraw()
      if (self.pendingReveal) { const id = self.pendingReveal; self.pendingReveal = null; requestAnimationFrame(() => self.reveal(id)) }
      if (self.wantToday) { self.wantToday = false; const sk = self.wantSeek; self.wantSeek = null; if (sk) self.seek(sk); else self.openToday() }
    }
    this.applyData = apply
    this.refreshNow = () => { if (TODAY) renderSoon() }

    /* ── 日期 / 窗口 ── */
    function windowFor(zoom: string, anchor: number): { start: number; end: number; cfg: { base: number; unit: string; back: number; fwd: number } } {
      const cfg = ZOOM[zoom]
      // v86：横向续期 = 预取（1.5 屏外就开始补，每次补 3 屏）而不是撞墙再补
      const padB = (state.padB || 0) * cfg.back
      const padF = (state.padF || 0) * cfg.fwd
      let start: number, end: number
      if (zoom === 'day') { start = anchor - (cfg.back + padB) * D; end = anchor + (cfg.fwd + padF) * D }
      else if (zoom === 'week') { const mon = mondayOf(anchor); start = mon - (cfg.back + padB) * 7 * D; end = mon + (cfg.fwd + padF) * 7 * D }
      else if (zoom === 'month') { const f = firstOfMonth(anchor); start = addMonths(f, -(cfg.back + padB)); end = addMonths(f, cfg.fwd + padF) }
      else { const q = quarterStart(anchor); start = addMonths(q, -(cfg.back + padB) * 3); end = addMonths(q, (cfg.fwd + padF) * 3) }
      return { start, end, cfg }
    }
    function unitCount(win: { start: number; end: number; cfg: { unit: string } }): number {
      const u = win.cfg.unit
      if (u === 'day') return Math.round((win.end - win.start) / D)
      if (u === 'week') return Math.round((win.end - win.start) / (7 * D))
      if (u === 'month') { const a = new Date(win.start), b = new Date(win.end); return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) }
      return Math.round(diffDays(win.start, win.end) / 91.31)
    }
    function segments(win: { start: number; end: number; cfg: { unit: string } }, px: number): { fine: Array<{ s: number; e: number; x: number; w: number; a?: string; b?: string; we?: boolean }>; coarse: Array<{ x: number; w: number; label?: string; key?: number; s?: number; e?: number }>; width: number } {
      const { start, end, cfg } = win
      const fine: Array<{ s: number; e: number; x: number; w: number; a?: string; b?: string; we?: boolean }> = []
      if (cfg.unit === 'day') { for (let t = start; t < end; t += D) fine.push({ s: t, e: t + D, x: 0, w: 0 }) }
      else if (cfg.unit === 'week') { for (let t = mondayOf(start); t < end; t += 7 * D) fine.push({ s: Math.max(t, start), e: Math.min(t + 7 * D, end), x: 0, w: 0 }) }
      else if (cfg.unit === 'month') { for (let t = firstOfMonth(start); t < end; t = addMonths(t, 1)) fine.push({ s: Math.max(t, start), e: Math.min(addMonths(t, 1), end), x: 0, w: 0 }) }
      else { for (let t = quarterStart(start); t < end; t = addMonths(t, 3)) fine.push({ s: Math.max(t, start), e: Math.min(addMonths(t, 3), end), x: 0, w: 0 }) }
      fine.forEach((c, i) => { c.x = i * px; c.w = px })
      const width = fine.length * px
      const coarse: Array<{ x: number; w: number; label?: string; key?: number; s?: number; e?: number }> = []
      const keyOf = (s: number): number => cfg.unit === 'day' || cfg.unit === 'week' ? firstOfMonth(s) : cfg.unit === 'month' ? quarterStart(s) : new Date(new Date(s).getFullYear(), 0, 1).getTime()
      for (const c of fine) {
        const key = keyOf(c.s), last = coarse[coarse.length - 1]
        if (last && last.key === key) { last.w += c.w; last.e = c.e } else coarse.push({ key, s: c.s, e: c.e, x: c.x, w: c.w })
      }
      coarse.forEach((c, i) => {
        const d = new Date(c.key as number)
        if (cfg.unit === 'day' || cfg.unit === 'week') c.label = (i === 0 ? d.getFullYear() + ' 年 ' : '') + MON[d.getMonth()]
        else if (cfg.unit === 'month') c.label = d.getFullYear() + ' · Q' + (Math.floor(d.getMonth() / 3) + 1)
        else c.label = d.getFullYear() + ' 年'
      })
      for (const c of fine) {
        const d = new Date(c.s)
        if (cfg.unit === 'day') { c.a = DAYS[d.getDay()]; c.b = String(d.getDate()); c.we = d.getDay() === 0 || d.getDay() === 6 }
        else if (cfg.unit === 'week') { c.a = '第 ' + isoWeek(c.s) + ' 周'; c.b = md(c.s) }
        else if (cfg.unit === 'month') { c.a = ''; c.b = (d.getMonth() + 1) + ' 月' }
        else { const q = Math.floor(d.getMonth() / 3) + 1; c.a = (q * 3 - 2) + '–' + (q * 3) + ' 月'; c.b = 'Q' + q }
      }
      return { fine, coarse, width }
    }
    const at = (ms: number): number => {
      const win = st2.win as { start: number; end: number }, seg = st2.seg as { fine: Array<{ s: number; e: number; x: number; w: number }>; width: number }
      if (ms <= win.start) return 0
      if (ms >= win.end) return seg.width
      let c = seg.fine[seg.fine.length - 1]
      for (const s of seg.fine) if (ms >= s.s && ms < s.e) { c = s; break }
      return c.x + Math.max(0, Math.min(1, (ms - c.s) / (c.e - c.s))) * c.w
    }
    const dayAt = (x: number): number => {
      const seg = st2.seg as { fine: Array<{ s: number; e: number; x: number; w: number }> }
      let c = seg.fine[seg.fine.length - 1]
      for (const s of seg.fine) if (x >= s.x && x < s.x + s.w) { c = s; break }
      const f = Math.max(0, Math.min(0.999, (x - c.x) / c.w))
      /* 必须归到「本地日」的 0 点（Math.floor(ms/D)*D 是 UTC 日界，在东八区会差一天） */
      const t = new Date(c.s + f * (c.e - c.s))
      return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
    }
    function getLw(): number {
      if (state.lw) return state.lw
      const w = root.clientWidth
      return w <= 640 ? 200 : w <= 900 ? 210 : w <= 1180 ? 268 : 318
    }
    const LW_MIN = 200, LW_MAX = 520

    /* ── 派生：计划条（浅蓝）/ 实际条（深蓝）互不影响；截止时间只是红旗，不参与任何计算 ── */
    function planRuns(c: CardM): Array<{ s: number; e: number }> {
      return runsOfDays([...c.planSet].map(dayMs))
    }
    function runsOfDays(days: number[]): Array<{ s: number; e: number }> {
      const arr = days.slice().sort((a, b) => a - b)
      const out: Array<{ s: number; e: number }> = []
      for (const d of arr) { const last = out[out.length - 1]; if (last && last.e === d) last.e = d + D; else out.push({ s: d, e: d + D }) }
      return out
    }
    function mergeSpans(spans: Array<{ s: number; e: number }>): Array<{ s: number; e: number }> {
      const a = spans.slice().sort((p, q) => p.s - q.s)
      const out: Array<{ s: number; e: number }> = []
      for (const sp of a) {
        const last = out[out.length - 1]
        if (last && sp.s <= last.e) { if (sp.e > last.e) last.e = sp.e }
        else out.push({ s: sp.s, e: sp.e })
      }
      return out
    }
    function groupSpans(g: GroupM): Array<{ s: number; e: number }> {
      return mergeSpans(g.cards.flatMap((c) => planRuns(c).map((r) => ({ s: r.s, e: r.e }))))
    }
    /* v107 ①：甘特图只显示 pending 项目 —— 归档项目一律不出行（有没有执行记录都不出）；
       「显示 pending 项目」开关只控制没有执行记录的 pending（有记录的 pending 始终显示）。 */
    function recInView(c: CardM): boolean {
      const w = st2.win ?? windowFor(state.zoom, state.anchor)
      for (const d of c.actualSet) { const ms = dayMs(d); if (ms >= w.start && ms < w.end) return true }
      return false
    }
    function cardVisible(c: CardM, g: GroupM): boolean {
      if (c.arch) return false
      /* v110：pending 全有全无 —— 关 = 目录 / 时间轴都不显示，开 = 全部显示 */
      if (c.pending && !state.showPending) return false
      const q = state.q.trim().toLowerCase()
      if (!q) return true
      if (g.name.toLowerCase().includes(q)) return true
      return c.t.toLowerCase().includes(q) || (c.stage || '').toLowerCase().includes(q)
    }
    function visibleGroups(): GroupM[] {
      const q = state.q.trim().toLowerCase()
      return GROUPS.filter((g) => !q || g.name.toLowerCase().includes(q) || g.cards.some((c) => cardVisible(c, g))).map((g) => {
        return { ...g, cards: g.cards.filter((c) => cardVisible(c, g)) }
        // v90：一个项目也不剩的组不出行（旧代码会留一行「0 项目」），页头 / 徽标的「组数」才是列表里真实的组数
      }).filter((g) => g.cards.length > 0)
    }

    /* v133 R2：同一次操作里的多次重画合成「本帧末尾画一次」（点执行卡曾经一次点击画三遍）；直接 render() 时顺手取消待画的那次 */
    let rRaf = 0
    /* v133 R3：点执行卡时详情 + 高光先上屏，甘特整页重画（4x CPU 下 ~150ms）挪到这一帧画完之后 */
    let rPostF = 0, rPostT = 0, rDefer = false
    function renderSoon(): void {
      if (rDefer) {
        if (rRaf) { cancelAnimationFrame(rRaf); rRaf = 0 }
        if (!rPostF && !rPostT) rPostF = requestAnimationFrame(() => { rPostF = 0; rPostT = window.setTimeout(() => { rPostT = 0; if (!self.disposed) render() }, 0) })
        return
      }
      if (!rRaf && !rPostF && !rPostT) rRaf = requestAnimationFrame(() => { rRaf = 0; if (!self.disposed) render() })
    }
    self.drawPending = () => !!(rRaf || rPostF || rPostT)
    let RW = 0
    function render(): void {
      if (rRaf) { cancelAnimationFrame(rRaf); rRaf = 0 }
      if (rPostF) { cancelAnimationFrame(rPostF); rPostF = 0 }
      if (rPostT) { clearTimeout(rPostT); rPostT = 0 }
      if (!TODAY) return
      RW = root.clientWidth
      if (!RW) self.roDirty = true
      else self.roW = RW
      const win = windowFor(state.zoom, state.anchor)
      const units = unitCount(win)
      const sc = $('#scroll') as HTMLElement
      const avail = Math.max(320, (sc.clientWidth || 900) - getLw() - tpW())
      st2.px = Math.max(win.cfg.base, Math.floor(avail / units))
      const seg = segments(win, st2.px)
      st2.win = win; st2.seg = seg as never
      const grid = $('#grid') as HTMLElement
      grid.style.setProperty('--lw', getLw() + 'px')
      root.style.setProperty('--lw', getLw() + 'px')
      grid.style.setProperty('--tw', seg.width + 'px')
      const dayW = seg.width / Math.max(1, diffDays(win.start, win.end))
      grid.style.setProperty('--dayw', (dayW < 5 ? 9999 : dayW) + 'px')
      if (root.classList.contains('tp-on')) sizeTp()
      renderHead(); renderBg(); renderRows(); paintFx(); renderPanel(); syncPendChip(); self.syncToday()
      // v98 ③：换粒度 / 面板开关 / 明细变化都重画了行 —— 开着的小窗按当前格子重新贴住
      if (menu && dayAnchor && menu.classList.contains('daypop')) placeDay(menu, dayAnchor)
      grid.dataset.range = ymd(win.start) + '|' + ymd(win.end - D)
      sc.style.paddingRight = tpW() ? tpW() + 'px' : ''
      const reanchor = state.lastZoom !== state.zoom || state.lastW !== sc.clientWidth || lastTpOn !== !!tpW()
      state.lastZoom = state.zoom; state.lastW = sc.clientWidth; lastTpOn = !!tpW()
      if (reanchor) { placeTodayOnBand(); if (placeT) clearTimeout(placeT); placeT = setTimeout(() => placeTodayOnBand(), 260) }
      RW = 0
      if (plWant) { plWant = false; plLayout(false) }
      for (const f of self.drawn.splice(0)) f()
    }
    /* v113（1.1）：今天落在可见带靠左约 1/3（用户给的目标位置）。
       可见带 = clientWidth − 目录宽 − 面板宽（面板开着时右边被盖住，不能拿 clientWidth 当分母）；
       今天贴着窗口右端、放不下时，先往后多续几屏日期再落位 —— 这是「怎么调都偏右」的真根因。 */
    let placeT: ReturnType<typeof setTimeout> | null = null
    let placing = false
    let lastTpOn = false
    /* 目标比例 0.29 = 用户给的「甘特图今天预期默认位置.png」量出来的值：
       图宽 2142（DPR2 → 1071 CSS），目录右沿 398.5/2=199.25，今天线中心 910/2=455，
       band = 1071 − 199 = 872 → (455 − 199) / 872 ≈ 0.294。之前写的 0.34 比这张图整体偏右约 40px。 */
    function placeTodayOnBand(ratio = 0.29): void {
      const sc = $('#scroll') as HTMLElement | null
      if (!sc || !st2.win || placing) return
      const lw = getLw()
      const band = Math.max(120, sc.clientWidth - lw - tpW())
      const x0 = at(TODAY), x1 = at(TODAY + D)
      const x = x0 + Math.max(2, x1 - x0) / 2
      /* 注意：at() 的时间轴坐标已经从「目录右边」起算（时间条 origin 就在目录右沿），
         这里再减一次 lw 会把今天整体右移一个目录宽（实测偏到 0.64）—— 只减 band*ratio。 */
      const want = Math.round(x - band * ratio)
      const max = sc.scrollWidth - sc.clientWidth
      if (want > max + 2 && state.padF < 10) {
        placing = true
        state.padF = Math.min(10, state.padF + 3)
        render()
        placing = false
        placeTodayOnBand(ratio)
        return
      }
      sc.scrollLeft = Math.max(0, Math.min(want, Math.max(0, max)))
    }

    function renderHead(): void {
      const seg = st2.seg as { fine: Array<{ s: number; e: number; x: number; w: number; a?: string; b?: string; we?: boolean }>; coarse: Array<{ x: number; w: number; label?: string }> }
      const nowX = at(TODAY) + Math.max(2, at(TODAY + D) - at(TODAY)) / 2
      const fineHtml = seg.fine.map((c) => {
        const isNow = NOW >= c.s && NOW < c.e
        const isSel = state.day >= c.s && state.day < c.e
        const lab = ymd(c.s) + (c.e - c.s > D ? ' → ' + ymd(c.e - D) : '')
        const tip = lab + ' · ' + (isSel ? '任务面板正在看这一天' : (state.zoom === 'day' ? '点它打开任务面板' : '点它选中这一天'))
        return '<button type="button" class="sc-cell' + (c.we ? ' we' : '') + (isNow ? ' td' : '') + (isSel ? ' sel' : '') + '" data-ds="' + c.s + '" data-de="' + c.e + '" title="' + tip + '" aria-label="' + tip + '"' + (isSel ? ' aria-current="date"' : '') + ' style="left:' + c.x + 'px;width:' + c.w + 'px">' +
          (c.a ? '<span class="a">' + esc(c.a) + '</span>' : '') + '<span class="b">' + esc(c.b as string) + '</span></button>'
      }).join('')
      const coarseHtml = seg.coarse.map((c) => '<div class="sc-cell" style="left:' + c.x + 'px;width:' + c.w + 'px">' + esc(c.label as string) + '</div>').join('')
      $('#headT')!.innerHTML = '<div class="sc-tier c1">' + coarseHtml + '</div><div class="sc-tier c2">' + fineHtml + '</div>' +
        '<button type="button" class="now-pill" style="left:' + nowX + 'px" title="今天 · 点它打开今天的任务面板" aria-label="今天，打开今天的任务面板">今天</button>'
      // v90：页头这个数 = 日程列表里实际列出的组数 / 项目行数（折叠的组仍算：行还在列表里；
      // 归档一律不列、没有记录的 pending 由「显示 pending 项目」决定），随搜索与筛选变。侧栏徽标吃同一次广播，两处永远同一帧同一个数。
      const list = visibleGroups()
      const cntGroups = list.length
      const cntItems = list.reduce((n, g) => n + g.cards.length, 0)
      $('#headCount')!.textContent = '共 ' + cntGroups + ' 组 · ' + cntItems + ' 项'
      /* v97：管理条右侧统计 —— 与左侧目录页头同一份口径（组数 / 项目行数），另加「几组有活跃会话」 */
      const mc = $('#scMgrCount')
      if (mc) {
        const liveIds = new Set(host.liveGroups ? host.liveGroups() : [])
        const liveN = list.filter((g) => liveIds.has(g.id)).length
        mc.textContent = cntGroups + ' 组 · ' + cntItems + ' 项 · ' + liveN + ' 组有活跃会话'
        const bOpen = $('[data-sc-all-open]') as HTMLButtonElement | null
        const bFold = $('[data-sc-all-fold]') as HTMLButtonElement | null
        const bLive = $('[data-sc-only-live]') as HTMLButtonElement | null
        const anyClosed = GROUPS.some((g) => state.closed.has(g.id))
        const anyOpen = GROUPS.some((g) => !state.closed.has(g.id))
        if (bOpen) bOpen.disabled = !anyClosed
        if (bFold) bFold.disabled = !anyOpen
        if (bLive) bLive.disabled = !liveN
      }
      try { window.dispatchEvent(new CustomEvent('dpm:sched-count', { detail: { groups: cntGroups, items: cntItems, at: Date.now() } })) } catch { /* 老浏览器 / 非浏览器环境忽略 */ }
    }
    function renderBg(): void {
      const seg = st2.seg as { fine: Array<{ x: number; w: number; we?: boolean }>; coarse: Array<{ x: number }>; width: number }
      let html = ''
      for (const c of seg.fine) html += '<i class="gl" style="left:' + c.x + 'px"></i>'
      html += '<i class="gl" style="left:' + (seg.width - 1) + 'px"></i>'
      for (const c of seg.coarse) html += '<i class="gl strong" style="left:' + c.x + 'px"></i>'
      if (state.zoom === 'day') for (const c of seg.fine) if (c.we) html += '<i class="wk" style="left:' + c.x + 'px;width:' + c.w + 'px"></i>'
      $('#bg')!.innerHTML = html
      $('#ov')!.innerHTML = '<i class="now" style="left:' + (at(TODAY) + Math.max(2, at(TODAY + D) - at(TODAY)) / 2) + 'px"></i>'
    }

    const clipX = (s: number, e: number): null | { left: number; width: number; cutL: boolean; cutR: boolean } => {
      const win = st2.win as { start: number; end: number }
      const a = Math.max(s, win.start), b = Math.min(e, win.end)
      return b <= a ? null : { left: at(a), width: Math.max(1.5, at(b) - at(a)), cutL: s < win.start, cutR: e > win.end }
    }

    function cardTrack(c: CardM): string {
      const runs = planRuns(c)
      let bands = '', actual = '', ddl = '', grabs = ''
      const days = [...c.actualSet].map(dayMs).sort((a, b) => a - b)
      const win = st2.win as { start: number; end: number }
      for (const r0 of runs) {
        const r = clipX(r0.s, r0.e); if (!r) continue
        bands += '<div class="pband' + (r.cutL ? ' cut-l' : '') + (r.cutR ? ' cut-r' : '') + '" data-move="' + esc(c.id) + '" data-rs="' + r0.s + '" data-re="' + r0.e + '" style="left:' + r.left + 'px;width:' + r.width + 'px" title="计划（手动设置）' + ymd(r0.s) + ' → ' + ymd(r0.e - D) + '：只有手动设置 / 拖动过的日子才会出现在这里；按住条体可整体拖动"></div>'
      }
      for (const r0 of runs) {
        const r = clipX(r0.s, r0.e); if (!r) continue
        const attrs = ' data-grab="' + esc(c.id) + '" data-rs="' + r0.s + '" data-re="' + r0.e + '"'
        if (r0.s >= win.start) grabs += '<span class="grab l" style="left:' + at(r0.s) + 'px"' + attrs + ' data-edge="l" role="slider" tabindex="0" aria-label="计划开始 ' + ymd(r0.s) + '" title="拖动改「计划开始」（当前 ' + ymd(r0.s) + '）"></span>'
        if (r0.e <= win.end && r.width >= 26) grabs += '<span class="grab r" style="left:' + at(r0.e) + 'px"' + attrs + ' data-edge="r" role="slider" tabindex="0" aria-label="计划结束 ' + ymd(r0.e - D) + '" title="拖动改「计划结束」（当前 ' + ymd(r0.e - D) + '）"></span>'
      }
      for (const run of runsOfDays(days)) {
        const r = clipX(run.s, run.e); if (!r) continue
        const inside = runs.some((r0) => run.s >= r0.s && run.e <= r0.e)
        actual += '<div class="ablock' + (inside ? '' : ' out') + '" style="left:' + r.left + 'px;width:' + Math.max(2, r.width) + 'px" title="实际执行 ' + md(run.s) + ' → ' + md(run.e - D) + (inside ? '' : '（计划外）') + '"></div>'
      }
      /* v99：同一天可以有多个截止 —— 一个格子只画一组旗子（1 个 = 单旗；≥2 个 = 两面旗 + 数字），
         引导虚线：这天有硬性就红、只有软性才橙。 */
      const byDay = new Map<number, DdlM[]>()
      for (const d of c.ddlList) {
        if (d.ms < win.start || d.ms >= win.end) continue
        const arr = byDay.get(d.ms) ?? []
        arr.push(d); byDay.set(d.ms, arr)
      }
      let prevFlagCx: number | null = null
      for (const [ms, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
        const cx = at(ms) + Math.max(2, at(ms + D) - at(ms)) / 2
        const dayTxt = ymd(ms)
        const hardN = list.filter((d) => ddlKind(d) === 'hard').length, softN = list.length - hardN
        /* v106 ④：虚线的每一段都跟「它右边第一个格子里的旗子」同色；同格两面不同色 → 红。
           起点 = 计划 / 实际条的右端 或 上一面旗（软性左侧蓝、软 → 硬之间红）。 */
        if (ms > TODAY && !c.planSet.has(dayTxt) && !c.actualSet.has(dayTxt)) {
          let edge: number | null = null
          for (const r0 of runs) if (r0.e <= ms && r0.e > win.start) edge = Math.max(edge == null ? -1 : edge, at(r0.e))
          for (const run of runsOfDays(days)) if (run.e <= ms && run.e > win.start) edge = Math.max(edge == null ? -1 : edge, at(run.e))
          if (prevFlagCx != null) edge = Math.max(edge == null ? -1 : edge, prevFlagCx + 8)
          if (edge != null && cx - 10 - edge > 2) ddl += '<i class="ddllead ' + (hardN ? 'hard' : 'soft') + '" data-lead="' + dayTxt + '" style="left:' + edge + 'px;width:' + (cx - 10 - edge) + 'px"></i>'
        }
        prevFlagCx = cx
        const lines = list.map((d) => (d.task ? '任务' : ddlKind(d) === 'soft' ? '软性' : '硬性') + (d.label ? ' · ' + d.label : '') + (d.task && d.done ? '（已完成）' : ''))
        if (list.length === 1) {
          const d = list[0], k = ddlKind(d)
          /* v137：任务截止旗 = 硬性红旗 + 右下角小方块角标；任务完成后变灰 */
          const lab = (d.task ? '任务截止 ' : k === 'soft' ? '软性截止 ' : '硬性截止 ') + dayTxt + (d.label ? ' · ' + d.label : '') + (d.task && d.done ? '（已完成）' : '')
          ddl += '<i class="dflag ' + k + (d.task ? ' tk' + (d.done ? ' tkd' : '') : '') + (d.sid ? ' rep' : '') + '" role="button" tabindex="0" style="left:' + cx + 'px" data-flag="' + esc(c.id) + '" data-did="' + esc(d.id) + '" title="' + esc(lab + (d.sid ? '（重复）' : '') + ' · 点一下改 / 按住拖到别的日期') + '" aria-label="' + esc(lab + '，可拖动改日期') + '">' + FLAG + (d.sid ? '<b class="rq">' + RQ_SVG + '</b>' : '') + '</i>'
        } else {
          const fresh = list.some((d) => DDL_FRESH.has(d.id)) ? ' just' : ''
          ddl += '<i class="dflag2' + fresh + '" role="button" tabindex="0" style="left:' + cx + 'px" data-flag="' + esc(c.id) + '" data-day="' + dayTxt + '" aria-label="' + esc(dayTxt + '：' + list.length + ' 个截止时间，硬性 ' + hardN + '、软性 ' + softN) + '" title="' + esc(dayTxt + '：' + list.length + ' 个截止时间（硬性 ' + hardN + ' / 软性 ' + softN + '）' + String.fromCharCode(10) + lines.join(String.fromCharCode(10)) + String.fromCharCode(10) + '点一下在列表里改') + '">'
            + ddlKinds(list).map((k) => '<span class="df ' + k + '">' + FLAG + '</span>').join('') + '<b class="dfn">' + list.length + '</b>' + (list.some((d) => d.sid) ? '<b class="rq">' + RQ_SVG + '</b>' : '') + '</i>'
        }
      }
      return bands + actual + ddl + grabs
    }
    function groupTrack(g: GroupM): string {
      const win = st2.win as { start: number; end: number }
      const plan = groupSpans(g)
      const days = [...new Set(g.cards.flatMap((c) => [...c.actualSet]))].map(dayMs).sort((a, b) => a - b)
      let bands = '', actual = ''
      for (const s of plan) {
        const r = clipX(s.s, s.e); if (!r) continue
        bands += '<div class="pband g' + (r.cutL ? ' cut-l' : '') + (r.cutR ? ' cut-r' : '') + '" style="left:' + r.left + 'px;width:' + r.width + 'px" title="组计划 = 组内所有项目「手动计划日」的并集 ' + ymd(s.s) + ' → ' + ymd(s.e - D) + '"></div>'
      }
      for (const run of runsOfDays(days)) {
        const r = clipX(run.s, run.e); if (!r) continue
        actual += '<div class="ablock g' + (plan.some((s) => run.s >= s.s && run.e <= s.e) ? '' : ' out') + '" style="left:' + r.left + 'px;width:' + Math.max(2, r.width) + 'px" title="实际执行 ' + md(run.s) + ' → ' + md(run.e - D) + '"></div>'
      }
      const planSet = new Set<string>()
      for (const sp of plan) for (let t = sp.s; t < sp.e; t += D) planSet.add(ymd(t))
      /* v99：组行截止 = 组内子项目截止日并集；同一天多个也一样（红橙按硬 / 软成对 + 数字 + 同色引导虚线）。
         点 / 虚线 / 组计划条三条中线都等于行中线（.gddl2 用 top:50% + translateY(-50%)，别再写 position:relative 把它顶掉）。 */
      const marks = new Map<number, DdlM[]>()
      for (const c of g.cards) for (const d of c.ddlList) { const arr = marks.get(d.ms) ?? []; arr.push(d); marks.set(d.ms, arr) }
      let dots = ''
      let prevFlagCx: number | null = null
      for (const [ms, list] of [...marks.entries()].sort((a, b) => a[0] - b[0])) {
        if (ms < win.start || ms >= win.end) continue
        const cx = at(ms) + Math.max(2, at(ms + D) - at(ms)) / 2
        const hardN = list.filter((d) => ddlKind(d) === 'hard').length, softN = list.length - hardN
        if (ms > TODAY && !planSet.has(ymd(ms)) && !days.includes(ms)) {
          let edge: number | null = null
          for (const sp of plan) if (sp.e <= ms && sp.e > win.start) edge = Math.max(edge == null ? -1 : edge, at(sp.e))
          for (const run of runsOfDays(days)) if (run.e <= ms && run.e > win.start) edge = Math.max(edge == null ? -1 : edge, at(run.e))
          if (prevFlagCx != null) edge = Math.max(edge == null ? -1 : edge, prevFlagCx + 8)
          if (edge != null && cx - 10 - edge > 2) dots += '<i class="ddllead ' + (hardN ? 'hard' : 'soft') + '" data-lead="' + ymd(ms) + '" style="left:' + edge + 'px;width:' + (cx - 10 - edge) + 'px"></i>'
        }
        prevFlagCx = cx
        dots += '<i class="gddl2" style="left:' + cx + 'px" title="' + esc('组内截止 ' + ymd(ms) + (list.length > 1 ? '（' + list.length + ' 个）' : '') + '：硬性 ' + hardN + ' / 软性 ' + softN) + '">'
          + ddlKinds(list).map((k) => '<b class="d ' + k + '"></b>').join('') + (list.length > 1 ? '<b class="gdn">' + list.length + '</b>' : '') + '</i>'
      }
      return bands + actual + dots
    }
    function renderRows(): void {
      const list = visibleGroups()
      if (!list.length) {
        $('#rows')!.innerHTML = '<div class="sc-empty"><b>没有符合条件的项目</b><span>换一个关键词，或清掉筛选条件</span><button class="btn sm" type="button" id="clearF">清空筛选</button></div>'
        const cf = $('#clearF')
        if (cf) cf.onclick = () => { state.q = ''; ($('#q') as HTMLInputElement).value = ''; state.showPending = false; syncChips(); syncPendChip(); syncQ(); render() }
        return
      }
      let html = ''
      for (const g of list) {
        const closed = state.closed.has(g.id)
        const gDays = new Set(g.cards.flatMap((c) => [...c.actualSet])).size
        html += '<div class="sc-row g' + (closed ? ' closed' : '') + '" data-g="' + esc(g.id) + '">' +
          '<div class="sc-name grp-cell" role="button" tabindex="0" data-toggle="' + esc(g.id) + '" aria-expanded="' + (!closed) + '" aria-label="' + (closed ? '展开 ' : '折叠 ') + esc(g.name) + '"><button type="button" class="caret" tabindex="-1" aria-hidden="true"><svg class="i sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>' +
          '<span class="nm" title="' + esc(g.name) + '">' + esc(g.name) + '</span><span class="meta">' + g.cards.filter((c) => !c.pending).length + ' 项目' + (g.cards.some((c) => c.pending) ? ' · Pending ' + g.cards.filter((c) => c.pending).length : '') + ' · 实际 ' + gDays + ' 天</span></div>' +
          '<div class="sc-track">' + groupTrack(g) + '</div></div>'
        if (closed) continue
        for (const c of g.cards) {
          const runs = planRuns(c)
          const planStart = runs.length ? Math.min(...runs.map((r) => r.s)) : null
          const ddlN = c.ddlList.length
          /* v127（2）：目录格第二行 = 彩色圆角标签（阶段 / 任务 x/y / 实际 N 天 / pending） */
          const sub = '<span class="v7tg stg">' + esc(c.stage) + '</span><span class="v7tg tsk' + (c.total && c.done === c.total ? ' all' : '') + '"><u>任务</u> ' + (c.total ? c.done + '/' + c.total : '—') + '</span><span class="v7tg act' + (c.actualSet.size ? '' : ' z') + '"><u>实际</u> ' + c.actualSet.size + ' 天</span>' + (c.pending ? '<span class="v7tg pnd">pending</span>' : '')
          html += '<div class="sc-row ind' + (state.sel === c.id ? ' sel' : '') + (c.pending ? ' pend' : '') + '" data-g="' + esc(g.id) + '" data-c="' + esc(c.id) + '">' +
            '<div class="sc-name ind-cell" role="button" tabindex="0" data-open-card-cell="' + esc(c.id) + '" aria-label="打开「' + esc(c.t) + '」的卡片详情"><span class="nm-line"><button type="button" class="nm sc-open" tabindex="-1" title="' + esc(c.t) + '，打开卡片详情">' + esc(c.t) + '</button>' + (c.pending ? '<span class="pchip pend">pending</span>' : '') + '</span><span class="sub v7tags" title="计划开始 ' + (planStart != null ? ymd(planStart) : '—') + '">' + sub + '</span>' +
            '<button type="button" class="ddlbtn' + (ddlN ? ' on' : '') + '" data-ddl="' + esc(c.id) + '" title="截止时间（' + ddlN + ' 个）"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6.4 21V3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M7 4.2h9.4l-1.9 3.9 1.9 3.9H7z" fill="currentColor"/></svg><span>' + (ddlN ? ddlN : '') + '</span></button>' +
            '</div>' +
            '<div class="sc-track" data-card="' + esc(c.id) + '">' + cardTrack(c) + '</div></div>'
        }
      }
      $('#rows')!.innerHTML = html
      paintCur()
    }
    /* ──────────────────────────────────────────────────────────────────────────
       v105 每日任务面板（一比一移植 prototype/dsh-web-v105.html）
       - 勾选 = 当天完成（只能手动；和卡片详情里的任务完成无关；勾上才画甘特图实际条）
       - 选中 = 排今天（进「任务执行安排」）；执行 / 暂停 / 取消是运行态，只存内存
       - 已完成的任务 / 子任务也列出来（整行置灰）；完成前已排的仍留在执行安排里
       ────────────────────────────────────────────────────────────────────────── */
    /** 全局任务项 key：p|卡片 / t|卡片|任务 / s|卡片|子任务（与 host 的校验同一口径）。 */
    const PKEY = {
      p: (cid: string): string => 'p|' + cid,
      t: (cid: string, tid: string): string => 't|' + cid + '|' + tid,
      s: (cid: string, sid: string): string => 's|' + cid + '|' + sid,
    }
    const pKeyCard = (k: string): string => String(k).split('|')[1] ?? ''
    /** 服务端快照里的按天状态（applyData 整份换）。 */
    const PDAY = new Map<string, PanelDayM>()
    /** 执行中 / 已暂停：运行态，只在内存里（刷新即回未开始，与设计一致）。 */
    const PST = new Map<string, 'run' | 'pause' | 'wait'>()
    const pstKey = (k: string): string => ymd(state.day) + '\n' + k
    const pday = (key: string): PanelDayM => {
      let u = PDAY.get(key)
      if (!u) { u = { done: new Set(), sel: new Set(), lanes: null, zl: { pause: [], wait: [], run: [], un: [] }, doneAt: new Map(), from: new Map() }; PDAY.set(key, u) }
      return u
    }

    interface LeafL { key: string; level: 'p' | 't' | 's'; c: CardM; g: GroupM; t?: TaskM; s?: { id: string; text: string; done: boolean; due?: string; sess?: string }; title: string; cdone?: boolean }
    interface AllIt { t: TaskM; key: string; cdone: boolean; subs: Array<{ s: { id: string; text: string; done: boolean; due?: string; sess?: string }; key: string; cdone: boolean }> }
    interface ProjP { c: CardM; g: GroupM; key: string; all: AllIt[]; tasks: AllIt[]; leaves: LeafL[]; autoOn: boolean }
    interface Found { p: ProjP; level: 'p' | 't' | 's'; c: CardM; g: GroupM; it?: AllIt; s?: { id: string; text: string; done: boolean }; cdone?: boolean }

    function pBuild(day: number): ProjP[] {
      const key = ymd(day), out: ProjP[] = []
      for (const g of GROUPS) {
        for (const c of g.cards) {
          /* v106 ③：执行记录与卡片状态无关 —— 归档 / pending 项目的计划与勾选照常列出（行上带小标签） */
          if (!c.planSet.has(key)) continue
          const u = pday(key)
          const all: AllIt[] = (c.tasks ?? []).map((t) => ({
            t, key: PKEY.t(c.id, t.id), cdone: t.done === true,
            subs: (t.subs ?? []).map((x) => ({ s: x, key: PKEY.s(c.id, x.id), cdone: x.done === true })),
          }))
          const tasks = all.filter((it) => !it.cdone)
          /* v122（1.5）：执行安排只放最小层级 —— 项目有任务就不放项目卡；任务有子任务就不放任务卡（含已完成的，按全部任务判断）。
             v113（4.2）保留：任务早先已被排进执行安排（sel 里有它自己）、后来加了子任务 → 这一项按「它自己」留在原位。 */
          /* v141（1.1）：有子任务的任务 = 一张「任务 + 子任务」卡（键 = 任务键）；子任务不再单独进执行安排，由任务整体管理 */
          const leaves: LeafL[] = []
          for (const it of all) leaves.push({ key: it.key, level: 't', c, g, t: it.t, title: it.t.text, cdone: it.cdone })
          if (!all.length) leaves.push({ key: PKEY.p(c.id), level: 'p', c, g, title: c.t })
          out.push({ c, g, key: PKEY.p(c.id), all, tasks, leaves, autoOn: c.actualAuto.has(key) && !c.autoOff.has(key) })
        }
      }
      return out
    }
    function pLeaves(model: ProjP[]): Map<string, LeafL> { const m = new Map<string, LeafL>(); for (const p of model) for (const l of p.leaves) m.set(l.key, l); return m }
    /** 同 id 的「任务 ↔ 子任务」key 迁移（t| ↔ s|）：层级改了但这一项还在，位置和勾选都跟着走。 */
    function pMigrateKeys(u: PanelDayM, model: ProjP[]): boolean {
      const valid = new Set<string>()
      for (const p of model) {
        valid.add(p.key)
        for (const it of p.all) { valid.add(it.key); for (const x of it.subs) valid.add(x.key as string) }
      }
      const swap = (k: string): string | null => {
        if (valid.has(k)) return null
        const parts = k.split('|')
        if (parts.length !== 3 || (parts[0] !== 't' && parts[0] !== 's')) return null
        const alt = (parts[0] === 't' ? 's' : 't') + '|' + parts[1] + '|' + parts[2]
        return valid.has(alt) ? alt : null
      }
      let changed = false
      const sel = new Set<string>()
      for (const k of u.sel) { const a = swap(k); if (a) { sel.add(a); changed = true } else sel.add(k) }
      if (changed) u.sel = sel
      const done = new Set<string>()
      let dch = false
      for (const k of u.done) { const a = swap(k); if (a) { done.add(a); dch = true } else done.add(k) }
      if (dch) { u.done = done; changed = true }
      if (u.lanes) {
        let lch = false
        u.lanes = u.lanes.map((lane) => lane.map((k) => { const a = swap(k); if (a) { lch = true; return a } return k }))
        if (lch) changed = true
      }
      for (const z of ZL_KEYS) {
        let zch = false
        u.zl[z] = u.zl[z].map((lane) => lane.map((k) => { const a = swap(k); if (a) { zch = true; return a } return k }))
        if (zch) changed = true
      }
      return changed
    }
    /* v121：「排今天」只是选中 → 落「未安排」；只有拖进「已安排」（或点开始执行 / 取消执行）才进 lanes。
       行结构只做清理（去掉不在今天 / 已删的 key），不再把选中的项自动塞进已安排。 */
    function pEnsure(u: PanelDayM, leaves: Map<string, LeafL>): void {
      if (!u.lanes) u.lanes = []
      const seen = new Set<string>()
      const keep = (k: string): boolean => (u.sel.has(k) || u.done.has(k)) && leaves.has(k) && !seen.has(k) && (seen.add(k), true)
      u.lanes = u.lanes.map((lane) => lane.filter(keep)).filter((lane) => lane.length)
      for (const z of ZL_KEYS) u.zl[z] = u.zl[z].map((lane) => lane.filter(keep)).filter((lane) => lane.length)
    }
    function pProjKeys(p: ProjP): string[] { const ls = p.leaves.filter((l) => l.level !== 'p'); return ls.length ? ls.map((l) => l.key) : [p.key] }
    function pTaskKeys(c: CardM, it: AllIt): string[] { return [PKEY.t(c.id, it.t.id)] }
    /* v141：子任务键 → 它的任务键（执行安排只认任务键；子任务只有「记录执行」各记各的） */
    function v41K(k: string): string { const p = String(k).split('|'); if (p[0] !== 's') return k; const c = cardsById.get(p[1]); for (const t of c?.tasks ?? []) if ((t.subs ?? []).some((x) => x.id === p[2])) return PKEY.t(p[1], t.id); return k }
    function v41Subs(tk: string): string[] { const p = String(tk).split('|'); if (p[0] !== 't') return []; const t = cardsById.get(p[1])?.tasks.find((x) => x.id === p[2]); return t && t.subs.length ? t.subs.map((x) => PKEY.s(p[1], x.id)) : [] }
    /** 老数据里的子任务键（选中 / 运行态 / 行）并到它的任务上；子任务全部记录执行 = 任务卡进本日已执行，撤销其中一个 = 回原分区。返回是否改了。 */
    function v41Norm(u: PanelDayM, key: string): boolean {
      let ch = false
      const sel = new Set<string>()
      for (const k of u.sel) { const nk = v41K(k); if (nk !== k) ch = true; sel.add(nk) }
      u.sel = sel
      for (const k of [...PST.keys()]) { if (!k.startsWith(key + '\n')) continue; const kk = k.slice(key.length + 1), nk = v41K(kk); if (nk !== kk) { const v = PST.get(k) as 'run' | 'pause' | 'wait'; PST.delete(k); if (!PST.has(key + '\n' + nk) || v === 'run') PST.set(key + '\n' + nk, v); ch = true } }
      const lanes = (L: string[][]): string[][] => { const seen = new Set<string>(); return L.map((l) => l.map((k) => { const nk = v41K(k); if (nk !== k) ch = true; return nk }).filter((k) => !seen.has(k) && (seen.add(k), true))).filter((l) => l.length) }
      if (u.lanes) u.lanes = lanes(u.lanes)
      for (const z of ZL_KEYS) u.zl[z] = lanes(u.zl[z])
      for (const tk of [...u.sel]) {
        const sk = v41Subs(tk); if (!sk.length) continue
        const all = sk.every((x) => u.done.has(x))
        if (all && !u.done.has(tk)) { if (!u.from.has(tk)) u.from.set(tk, pZoneOf(u, tk, key)); u.done.add(tk); PST.delete(key + '\n' + tk); u.doneAt.set(tk, Date.now()); ch = true }
        else if (!all && u.done.has(tk)) { u.done.delete(tk); u.doneAt.delete(tk); pRestoreFrom(u, tk, key); ch = true }
      }
      return ch
    }
    function pSt(u: PanelDayM, set: Set<string>, keys: string[]): boolean | 'mixed' { const n = keys.filter((k) => set.has(k)).length; return n === 0 ? false : n === keys.length ? true : 'mixed' }
    function pCardDone(c: CardM, u: PanelDayM): boolean { for (const k of u.done) if (pKeyCard(k) === c.id) return true; return false }
    function pSyncActual(c: CardM, u: PanelDayM, key: string): void { setActual(c, key, pCardDone(c, u)) }
    function pFind(k: string, model = pBuild(state.day)): Found | null {
      const cid = pKeyCard(k)
      for (const p of model) {
        if (p.c.id !== cid) continue
        if (k === p.key) return { p, level: 'p', c: p.c, g: p.g }
        for (const it of p.all) {
          if (k === it.key && it.t.id) return { p, level: 't', c: p.c, g: p.g, it, cdone: !!it.cdone }
          for (const x of it.subs) if (k === x.key) return { p, level: 's', c: p.c, g: p.g, it, s: x.s, cdone: !!x.cdone }
        }
      }
      return null
    }
    function pTitleOf(f: Found): string { return f.level === 'p' ? f.c.t : f.level === 's' ? (f.s?.text ?? '') : (f.it?.t.text ?? '') }
    function pKeysFor(f: Found): string[] {
      if (f.level === 'p') return pProjKeys(f.p)
      if (f.level === 's') return [PKEY.t(f.c.id, f.it?.t.id ?? '')]
      return f.it ? pTaskKeys(f.c, f.it) : []
    }
    function pCk(attr: string, fk: string, st: boolean | 'mixed', label: string, dis: boolean): string {
      const v = st === 'mixed' ? 'mixed' : st ? 'true' : 'false'
      return '<button type="button" class="eck' + (st === true ? ' on' : st === 'mixed' ? ' mix' : '') + '" role="checkbox" aria-checked="' + v + '" ' + attr + ' data-fk="' + esc(fk) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (dis ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg><i aria-hidden="true"></i></button>'
    }
    function pTag(level: 'p' | 't' | 's'): string { return level === 'p' ? '<span class="lvt p">项目</span>' : level === 't' ? '<span class="lvt t">任务</span>' : '<span class="lvt s">子任务</span>' }
    function pSelChip(st: boolean | 'mixed', fk: string, label: string, dis = false): string {
      const s = st === true ? 'on' : st === 'mixed' ? 'mixed' : 'off'
      const txt = s === 'on' ? '已排' : s === 'mixed' ? '部分' : '排今天'
      return '<button type="button" class="plsel" data-pl-sel="' + esc(fk) + '" data-state="' + s + '" data-fk="' + esc('plsel:' + fk) + '" aria-pressed="' + (s === 'on' ? 'true' : s === 'mixed' ? 'mixed' : 'false') + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (dis ? ' disabled aria-disabled="true"' : '') + '>' + PV_ICON.cal + '<span class="t">' + txt + '</span></button>'
    }
    function pActBtn(act: string, k: string, label: string, icon: string, cls: string, dis = false, to = ''): string {
      return '<button type="button" class="exa ' + cls + '"' + (to ? ' data-to="' + to + '"' : '') + ' data-ex-act="' + act + '" data-k="' + esc(k) + '" data-fk="' + esc('ex:' + k + ':' + act) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' + (dis ? ' disabled' : '') + '>' + icon + '</button>'
    }
    /* ── v121–v123 任务执行安排六分区：区由状态推出来（不另存「在哪个区」） ── */
    /* v131（1）：分区主题图标（18px 圆角底 + 13px 线条图标，颜色跟分区主题色） */
    const ZI: Record<string, string> = {
      done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
      wait: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5c0 4.6 8 4.4 8 8.5s-8 3.9-8 8.5M16 3.5c0 4.6-8 4.4-8 8.5s8 3.9 8 8.5"/>',
      pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
      run: '<circle cx="12" cy="12" r="8.5"/><path class="f" d="M10 8.3v7.4l6-3.7z"/>',
      arr: '<rect x="4" y="5.2" width="16" height="14.8" rx="3"/><path d="M8.2 3.4v3.4M15.8 3.4v3.4M4 10h16M8 14h3"/>',
      un: '<path d="M4 13.5 6.6 5.5h10.8L20 13.5V19H4z"/><path d="M4 13.5h4.6l1.1 2.2h4.6l1.1-2.2H20"/>',
    }
    /* v131（1）：执行安排内容没变就不重建（卡片原地不动、悬停态不丢）；呼吸动画钉在文档时钟 0 点 → 任何时候重画都接着同一拍 */
    function exBreathSync(el: Element): void { for (const a of el.getAnimations({ subtree: true })) if (((a as CSSAnimation).animationName || '').startsWith('dpm-br-') && a.startTime !== 0) a.startTime = 0 }
    /** 文本没变就不写（innerHTML 赋值哪怕内容一样也会换节点、触发样式重算） */
    function setH(el: HTMLElement & { __h?: string }, html: string): void { if (el.__h !== html) { el.__h = html; el.innerHTML = html } }
    /** 返回 true = 真的换了 DOM（调用方据此决定要不要做量几何的后处理） */
    function exSet(el: HTMLElement & { __h?: string }, html: string): boolean {
      if (el.__h === html && el.firstElementChild) return false
      el.__h = html
      el.innerHTML = html
      exBreathSync(el)
      return true
    }
    /* v131（3）：分区标题吸顶 —— 被 sticky 从自然位置推开了 = 吸住（圆角变方 + 下沿阴影） */
    function exStuck(): void {
      for (const [id, sel] of [['#exBody', '.exz > .exz-h'], ['#tpList', '.plw > .plr']]) {
        const box = $(id)
        if (!box) continue
        for (const h of $$(sel, box)) {
          const pa = h.parentElement as HTMLElement, off = h.getBoundingClientRect().top - pa.getBoundingClientRect().top - pa.clientTop
          h.classList.toggle('stuck', box.scrollTop > 0 && off > 0.5)
        }
      }
    }
    /* v131（3）：计划清单 项目组 / 项目 / 任务 三层吸顶 —— 每层的 top = 外层吸住的行高之和；
       每一行的 scroll-margin-top 也让出外层吸顶高度（定位 / 跳转时不被盖住） */
    function plTops(): void {
      const L = $('#tpList')
      if (!L) return
      const pad = parseFloat(getComputedStyle(L).paddingTop) || 0
      const hOf = new Map<Element, number>()
      const stack = (el: Element): number => {
        let h = 0, a = el.parentElement?.closest('.plw')
        while (a && L.contains(a)) {
          let v = hOf.get(a)
          if (v == null) { v = (a.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0; hOf.set(a, v) }
          h += v
          a = a.parentElement?.closest('.plw')
        }
        return h
      }
      /* v133 R2：先全部量完再写，值没变不写（边写边量 = 每行一次强制布局） */
      const tops: Array<[HTMLElement, string]> = [], mts: Array<[HTMLElement, string]> = []
      for (const w of $$('.plw', L)) { const r = w.firstElementChild as HTMLElement | null; if (r) tops.push([r, (stack(w) - pad) + 'px']) }
      for (const r of $$('.plr', L)) {
        const w = r.parentElement?.classList.contains('plw') ? r.parentElement : r
        mts.push([r as HTMLElement, (stack(w as Element) + 4) + 'px'])
      }
      for (const [r, v] of tops) if (r.style.top !== v) r.style.top = v
      for (const [r, v] of mts) if (r.style.scrollMarginTop !== v) r.style.scrollMarginTop = v
    }
    const EXZ: Array<{ z: GanttZone; t: string; s: string }> = [
      { z: 'done', t: '本日已执行', s: '已记录当日执行 · 按记录时间排，早的在上' },
      { z: 'wait', t: '等外部进展', s: '暂停 · 等别人 / 外部条件 · 同一行 = 并列' },
      { z: 'pause', t: '个人暂停', s: '暂停 · 自己的原因 · 同一行 = 并列' },
      { z: 'run', t: '执行中', s: '正在做 · 同一行 = 同时在做' },
      { z: 'arr', t: '已安排', s: '上下 = 先后 · 同一行 = 并行' },
      { z: 'un', t: '未安排', s: '已排今天，还没定执行顺序' },
    ]
    const EXZ_T: Record<string, string> = { done: '本日已执行', pause: '个人暂停', wait: '等外部进展', run: '执行中', arr: '已安排', un: '未安排' }
    const EXZ_ST: Record<string, string> = { done: '已记录当日执行', pause: '暂停（个人）', wait: '暂停（等外部）', run: '执行中', arr: '已安排（未开始）', un: '默认（未定顺序）' }
    const EXZ_EMPTY: Record<string, string> = { run: '点卡片上的「开始执行」或拖进来 = 正在做', done: '点卡片右边「记录执行」或拖进来 = 记录今天已执行', wait: '拖进来 = 暂停（等外部进展）', pause: '拖进来 = 暂停（个人原因）', arr: '把卡片拖到这里排执行顺序（上下 = 先后，同一行 = 并行）', un: '在下面「本日计划清单」点「排今天」会先落到这里' }
    /** v124（1.3）：收起的分区（缺省只收「本日已执行」；用户开合过就落盘 ui.exz）。 */
    const EXZ_CLOSED = new Set<string>(['done'])
    const pInLanes = (u: PanelDayM, k: string): boolean => (u.lanes ?? []).some((l) => l.includes(k))
    function pZoneOf(u: PanelDayM, k: string, key = ymd(state.day)): GanttZone {
      if (u.done.has(k)) return 'done'
      const st = PST.get(key + '\n' + k)
      if (st === 'pause' || st === 'wait' || st === 'run') return st
      return pInLanes(u, k) ? 'arr' : 'un'
    }
    function pRowsOf(u: PanelDayM, z: GanttZone): string[][] { if (z === 'arr') return u.lanes ?? (u.lanes = []); return u.zl[z as ZlKey] }
    function pZlDrop(u: PanelDayM, k: string): void { for (const z of ZL_KEYS) u.zl[z] = u.zl[z].map((l) => l.filter((x) => x !== k)).filter((l) => l.length) }
    function pLaneDrop(u: PanelDayM, k: string): void { u.lanes = (u.lanes ?? []).map((l) => l.filter((x) => x !== k)).filter((l) => l.length) }
    /** v123（1.1）：撤销执行记录 → 回到当初点「记录执行」时所在的分区。 */
    function pRestoreFrom(u: PanelDayM, k: string, key: string): GanttZone {
      const z = u.from.get(k) ?? (pInLanes(u, k) ? 'arr' : 'un')
      u.from.delete(k)
      if (z === 'pause' || z === 'wait' || z === 'run') { PST.set(key + '\n' + k, z); if (!u.zl[z].some((l) => l.includes(k))) u.zl[z].push([k]) }
      else { PST.delete(key + '\n' + k); if (z === 'arr' && !pInLanes(u, k)) (u.lanes = u.lanes ?? []).push([k]) }
      return z
    }
    /** 记录执行的 key：子任务 = 自己；任务 = 自己 + 全部子任务；项目 = 自己 + 全部任务 / 子任务。 */
    function pRecKeys(f: Found): string[] {
      if (f.level === 'p') { const ks = [f.p.key]; for (const it of f.p.all) { ks.push(it.key); for (const x of it.subs) ks.push(x.key) } return ks }
      if (f.level === 's') return [PKEY.s(f.c.id, f.s?.id ?? '')]
      return f.it ? [f.it.key, ...f.it.subs.map((x) => x.key)] : []
    }
    function pRecSt(u: PanelDayM, k: string): boolean | 'mixed' {
      const f = pFind(k); if (!f) return false
      const ks = pRecKeys(f), n = ks.filter((x) => u.done.has(x)).length
      return n === 0 ? false : n === ks.length ? true : 'mixed'
    }
    /* v122（1.4）：「记录当日执行」按钮 —— 未执行 = 虚线日历；已执行 = 实心绿底 + 勾；部分下级记过 = 绿框「部分执行」 */
    function pRecBtn(k: string, st: boolean | 'mixed', l: { level: 'p' | 't' | 's'; title: string; subsN?: number }, dis: boolean, back: string, lock = false): string {
      const on = st === true, mix = st === 'mixed'
      const scope = l.level === 'p' ? '这个项目和它全部的任务 / 子任务' : l.level === 't' ? (l.subsN ? '这个任务和它的 ' + l.subsN + ' 个子任务' : '这个任务') : '这个子任务'
      const lab = lock ? '已勾选完成「' + l.title + '」：今天的执行记录已锁定（先把勾选去掉才能撤销）' : on ? '今天已完成执行：' + l.title + '（点一下撤销记录' + (back ? '，回到「' + EXZ_T[back] + '」' : '') + '）' : (mix ? '今天部分执行了：' : '记录今天已完成执行：') + l.title + '（记录' + scope + '；甘特图今天的格子会标成「实际执行」）'
      return '<button type="button" class="exrec' + (on ? ' on' : mix ? ' mix' : '') + (lock ? ' lock' : '') + '"' + (back ? ' data-back="' + back + '"' : '') + ' data-x-rec="' + esc(k) + '" data-fk="' + esc('rec:' + k) + '" aria-pressed="' + (on ? 'true' : mix ? 'mixed' : 'false') + '" title="' + esc(lab) + '" aria-label="' + esc(lab) + '"' + (dis ? ' disabled' : '') + '>' + PV_ICON.rec + '<span class="rt">' + (on ? '已执行' : mix ? '部分执行' : '记录执行') + '</span></button>'
    }
    /* v122（1.3/1.4）+ v123 + v126：任务项卡片 = grid：[勾选圆圈（完成；项目卡没有）] [标签 + 标题 / 层级路径] [记录执行]；
       悬停按钮浮在右上角（按分区给出，颜色 = 目标分区的卡片色）；不显示状态标签（分区本身就是状态）；不带原生 title（悬停走对话气泡）。 */
    function pItemHtml(l: LeafL, u: PanelDayM, key: string, future: boolean): string {
      const rec = u.done.has(l.key)
      const st = rec ? '' : (PST.get(key + '\n' + l.key) ?? '')
      const crumb = l.level === 'p' ? l.g.name : l.level === 't' ? l.g.name + ' › ' + l.c.t : l.g.name + ' › ' + l.c.t + ' › ' + (l.t?.text ?? '')
      const cd = l.level === 's' ? !!l.s?.done : l.level === 't' ? !!l.t?.done : false
      const zone = pZoneOf(u, l.key, key)
      let acts = ''
      if (zone === 'run') acts = pActBtn('pause', l.key, '个人暂停「' + l.title + '」→ 个人暂停', PV_ICON.pause, 'pause', false, 'pause') + pActBtn('wait', l.key, '等外部进展「' + l.title + '」→ 等外部进展', PV_ICON.wait, 'wait', false, 'wait') + pActBtn('cancel', l.key, '取消执行「' + l.title + '」→ 回到已安排', PV_ICON.stop, 'stop', false, 'arr')
      else if (zone === 'pause' || zone === 'wait') acts = pActBtn('run', l.key, '继续执行「' + l.title + '」→ 执行中', PV_ICON.play, 'run', false, 'run') + (zone === 'pause' ? pActBtn('wait', l.key, '改成等外部进展 → 等外部进展', PV_ICON.wait, 'wait', false, 'wait') : pActBtn('pause', l.key, '改成个人暂停 → 个人暂停', PV_ICON.pause, 'pause', false, 'pause')) + pActBtn('cancel', l.key, '取消暂停「' + l.title + '」→ 回到已安排', PV_ICON.stop, 'stop', false, 'arr')
      else if (zone === 'arr') acts = pActBtn('run', l.key, future ? '未来的日子不能执行' : '开始执行「' + l.title + '」→ 执行中', PV_ICON.play, 'run', future, 'run') + pActBtn('pause', l.key, '个人暂停「' + l.title + '」→ 个人暂停', PV_ICON.pause, 'pause', future, 'pause') + pActBtn('wait', l.key, '等外部进展「' + l.title + '」→ 等外部进展', PV_ICON.wait, 'wait', future, 'wait')
      /* v127（3）：未安排悬停 = 「当日不安排」（从未安排移除，计划清单变回「排今天」） */
      else if (zone === 'un') acts = pActBtn('unsel', l.key, '当日不安排「' + l.title + '」：从未安排移除，本日计划清单变回「排今天」', PV_ICON.stop, 'unsel')
      const ck = l.level === 'p' ? '' : pCk('data-ex-ck="' + esc(l.key) + '"', 'exck:' + l.key, cd, (cd ? '取消完成' : '完成') + (l.level === 's' ? '子任务' : '任务') + '「' + l.title + '」' + (l.level === 't' && l.t?.subs?.length ? '（连同它的子任务）' : '') + '；和卡片详情里的勾选是同一个状态', false)
      const stateTxt = (cd ? '已完成；' : '') + EXZ_T[zone]
      const flag = (l.c.arch ? ' arc' : '') + (l.c.pending && !l.c.arch ? ' pend' : '')
      /* v140（2.5）/ v141（1.4）：会话状态标签 = 第二行右边；以此任务创建会话 = 悬停按钮组最右（黑底）。v142（3.1）：路径小字在同一行左边 */
      const sid = l.level !== 'p' && l.t?.sess ? l.t.sess : ''
      /* v155：项目卡（只有「没拆任务」的项目才会有这一行）= 这张卡片自己的会话聚合；任务 / 子任务 = 它关联的那个会话 */
      const chip = sid ? chipHtml(sid) : (l.level === 'p' ? pchipHtml(l.c.id) : '')
      /* v151（2.1）：已关联一个没归档的会话 = 不放「以此新建会话」（项目卡 = 卡片自己有活跃会话） */
      if (!l.c.arch && !(l.level === 'p' ? cardLive(l.c.id) : sessLive(l.t?.sess))) acts += newBtnHtml(l.c.id, l.level === 'p' ? '' : (l.t?.id ?? ''), l.level === 'p' ? '卡片' : '任务', 'exa exnb')
      /* v141（1.1/1.2）：有子任务 = 标题行和路径行之间一列子任务小卡（一行：抓手 / 勾选 / 标题 / 会话状态 / 新建会话 / 记录执行） */
      /* v142（反馈）：只列这一天还要做的 —— 未完成的 + 这一天完成 / 记过执行的；之前就完成的子任务不出现 */
      const subs = l.level === 't' && l.t?.subs?.length ? subOrder(l.t.subs.filter((x) => subToday(x, l.c.id, u, key))) : []
      const subRows = subs.map((x) => {
        const sk = PKEY.s(l.c.id, x.id), srec = u.done.has(sk)
        return '<div class="v41sr' + (x.done ? ' done' : '') + (srec ? ' rec' : '') + '" data-sk="' + esc(sk) + '" tabindex="0" title="' + esc('子任务「' + x.text + '」· 点一下 = 打开卡片详情并定位 · 按住上下拖 = 改顺序（和卡片详情同步）') + '">'
          + '<span class="v41grip" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/></svg></span>'
          + pCk('data-ex-ck="' + esc(sk) + '"', 'exck:' + sk, !!x.done, (x.done ? '取消完成' : '完成') + '子任务「' + x.text + '」；和卡片详情 / 本日计划清单同一个状态', false)
          + '<span class="v41st">' + esc(x.text) + '</span><span class="v41cs">' + (x.sess ? chipHtml(x.sess) : '') + '</span>'
          + (l.c.arch || sessLive(x.sess) ? '' : newBtnHtml(l.c.id, x.id, '子任务', 'v42nb'))
          + '<button type="button" class="v41rec' + (srec ? ' on' : '') + '" data-x-rec="' + esc(sk) + '" aria-pressed="' + srec + '" title="' + esc(srec ? '今天已记录执行：' + x.text + '（点一下撤销）' : '记录今天已执行：' + x.text) + '" aria-label="' + esc((srec ? '撤销记录执行：' : '记录执行：') + x.text) + '"' + (future ? ' disabled' : '') + '>' + PV_ICON.rec + '</button></div>'
      }).join('')
      const sb = subs.length ? '<div class="v41subs" role="list" aria-label="' + esc('子任务 ' + subs.filter((x) => x.done).length + '/' + subs.length) + '">' + subRows + '</div>' : ''
      return '<div class="exi' + (ck ? '' : ' nock') + (zone === 'un' ? ' norec' : '') + (acts ? ' hasa' : '') + (st ? ' st-' + st : '') + (rec ? ' done' : '') + (cd ? ' cdone' : '') + (chip ? ' v40has' : '') + (subs.length ? ' v41grp' : '') + flag + '" data-k="' + esc(l.key) + '" data-lv="' + l.level + '" data-st="' + st + '" data-done="' + (rec ? '1' : '0') + '" tabindex="0" aria-label="' + esc(l.title + '；' + crumb + '；' + stateTxt + '；点击打开卡片详情') + '">'
        + '<span class="exgrip" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/></svg></span>'
        + (ck ? '<span class="exck">' + ck + '</span>' : '')
        + '<span class="exi-m"><span class="exi-r1">' + pTag(l.level) + '<span class="exi-t"><span class="mq-t">' + esc(l.title) + '</span></span></span><span class="exi-s"><span class="mq-s">' + carryTag(l.key) + (l.level === 's' ? dueChip(l.s?.due, !!l.s?.done) : l.level === 't' ? dueChip(l.t?.due, !!l.t?.done) : '') + esc(crumb) + '</span></span></span>'
        + '<span class="exslot">' + (acts ? '<span class="exacts">' + acts + '</span>' : '') + '</span>'
        + (zone === 'un' ? '' : pRecBtn(l.key, rec, { level: l.level, title: l.title, subsN: l.t?.subs?.length }, future || (rec && cd), rec ? (u.from.get(l.key) ?? 'arr') : '', rec && cd))
        + (chip ? '<span class="v40ex">' + chip + '</span>' : '')
        + sb
        + '</div>'
    }
    /** 子任务在这一天的执行卡里要不要列：未完成 / 这天完成 / 这天记过执行。 */
    function subToday(x: { id: string; done: boolean; doneDay?: string }, cid: string, u: PanelDayM, key: string): boolean { return !x.done || x.doneDay === key || u.done.has(PKEY.s(cid, x.id)) || (!x.doneDay && key === ymd(Date.now())) }
    /** 子任务顺序 = 卡片里的顺序，未完成在前、已完成在后（和详情一样）。 */
    function subOrder<T extends { done: boolean }>(xs: T[]): T[] { return xs.filter((x) => !x.done).concat(xs.filter((x) => x.done)) }
    function pDdlTitle(list: DdlM[]): string { return list.map((d) => d.at.slice(5) + (ddlKind(d) === 'soft' ? ' 软性' : ' 硬性') + (d.label ? '（' + d.label + '）' : '')).join(' · ') }
    const PL_CHEV = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    /* v106 ②：本日计划清单点行折叠（项目组 → 项目 → 任务 → 子任务）。只影响显示，不动任何执行数据。
       v121（2.4）：开合记忆不分天（key 跨天稳定），并且落盘 ui.plclosed —— 每次进来恢复上次的样子。
       v124（2）：已完成的任务默认折叠，只有用户点开过的才展开（ui.plopen）。 */
    const plClosed = new Set<string>()
    const plOpenDone = new Set<string>()
    const plKeyOf = (k: string): string => k
    const plFilter = (): boolean => state.plOnly || state.plDone
    const plIsOpen = (k: string): boolean => (plFilter() && !/^g\|/.test(k)) ? true : !plClosed.has(plKeyOf(k))
    function plFoldSave(): void {
      self.foldBusy++
      void postGantt('ui', { plclosed: [...plClosed], plopen: [...plOpenDone] }).then((r) => {
        self.foldBusy = Math.max(0, self.foldBusy - 1)
        if (self.data && r.gantt?.ui) self.data.ui = { ...r.gantt.ui }
      }).catch((e) => { self.foldBusy = Math.max(0, self.foldBusy - 1); toast(e instanceof ApiError ? e.message : String(e), 'err') })
    }
    /* v113（7）：开合走 CSS 过渡（grid-template-rows），不再整块重画 —— 重画没有动效、还会丢滚动位置 */
    function plToggle(k: string): void {
      const kk = plKeyOf(k)
      const row = $('#tpList .plr[data-k="' + CSS.escape(k) + '"]')
      let open: boolean
      if (row && ((row.classList.contains('t') && row.classList.contains('cdone')) || row.dataset.alldone === '1')) { open = !plOpenDone.has(k); if (open) plOpenDone.add(k); else plOpenDone.delete(k) }
      else { open = plClosed.has(kk); if (open) plClosed.delete(kk); else plClosed.add(kk) }
      plFoldSave()
      const box = $('[data-pl-kids="' + CSS.escape(k) + '"], [data-pl-sub="' + CSS.escape(k) + '"]')
      if (box) box.classList.toggle('open', open)
      for (const tg of $$<HTMLElement>('[data-pl-tg="' + CSS.escape(k) + '"]')) tg.setAttribute('aria-expanded', String(open))
      if (row && row.classList.contains('gp')) row.setAttribute('aria-expanded', String(open))
      syncPlBtns()
    }
    /* v121（2.1 根因）：「只显示可安排」下项目只要没有可见的任务 / 子任务行就整行跳过 ——
       没拆任务的项目（例「登录页白屏」：tasks = []，项目本身就是唯一可排的项）因此整个消失。
       新口径：可安排 = 这一项本身没记录执行、没排今天、卡片里也没完成；没有任务的项目，项目行本身就是可安排项。 */
    const plAvail = (u: PanelDayM, k: string, cdone: boolean): boolean => !cdone && !u.done.has(k) && !u.sel.has(k) && !u.sel.has(v41K(k))
    /* v121（2.5）：本日执行完成 = 这天记录过执行的项（项目 / 任务 / 子任务） */
    const plDoneToday = (u: PanelDayM, k: string): boolean => u.done.has(k)
    function pPlanHtml(day: number, model: ProjP[], u: PanelDayM): string {
      const future = day > TODAY
      const mode = state.plDone ? 'done' : state.plOnly ? 'avail' : 'all'
      /* v121（2.2）：按项目组分栏 —— 项目组栏只是展示分组（无勾选 / 无排今天），点它开合自己的项目 */
      const groups: Array<{ g: GroupM; ps: ProjP[] }> = []
      for (const p of model) { let gg = groups.find((x) => x.g.id === p.g.id); if (!gg) { gg = { g: p.g, ps: [] }; groups.push(gg) } gg.ps.push(p) }
      let out = ''
      for (const gg of groups) {
        let html = '', shownP = 0
        for (const p of gg.ps) {
          const c = p.c, g = p.g, pk = p.key
          const pKeys = pProjKeys(p)
          const selSt = pSt(u, u.sel, pKeys)
          const tls = p.leaves.filter((l) => l.level !== 'p')
          const visS = (x: AllIt['subs'][number]): boolean => mode === 'all' || (mode === 'avail' ? plAvail(u, x.key, x.cdone) : plDoneToday(u, x.key))
          const visT = (it: AllIt): boolean => mode === 'all' || (it.subs.length ? it.subs.some(visS) || (mode === 'done' && plDoneToday(u, it.key)) : (mode === 'avail' ? plAvail(u, it.key, it.cdone) : plDoneToday(u, it.key)))
          const allShown = mode === 'all' ? p.all : p.all.filter(visT)
          if (mode !== 'all') {
            const selfOk = p.all.length === 0 && (mode === 'avail' ? plAvail(u, pk, false) : plDoneToday(u, pk))
            if (!allShown.length && !selfOk) continue
          }
          shownP++
          const doneN = tls.filter((l) => u.done.has(l.key)).length
          const totalN = tls.length
          const ddls = c.ddlList.filter((d) => d.ms === day).sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))
          const metaTxt = g.name + ' · ' + c.stage + (p.autoOn ? ' · 会话自动' : '')
          const selLab = (selSt === true ? '取消' : '选中') + '「' + c.t + '」排今天执行' + (selSt === 'mixed' ? '（补齐还没选中的任务项）' : '') + '；选中的任务项会出现在上面的任务执行安排里'
          const ddc = ddls.length ? '<button type="button" class="pld' + (ddls.some((d) => ddlKind(d) !== 'soft') ? '' : ' soft') + '" data-pl-ddl="' + esc(c.id) + '" title="' + esc('截止：' + pDdlTitle(ddls)) + '" aria-label="' + esc('截止时间，共 ' + ddls.length + ' 条：' + pDdlTitle(ddls)) + '">' + PV_ICON.flag + '<b>' + ddls.length + '</b></button>' : ''
          const hasKids = allShown.length > 0
          /* v127（4）：项目下全部任务都已完成 → 默认折叠，点开过才展开（记进 ui.plopen）；过滤模式下照旧全开 */
          const allDone = !plFilter() && c.tasks.length > 0 && c.tasks.every((t) => t.done)
          const pOpen = allDone ? plOpenDone.has(pk) : plIsOpen(pk)
          const stat = c.arch ? '<span class="plstat arc">已归档</span>' : (c.pending ? '<span class="plstat pend">pending</span>' : '')
          const pDone = pRecSt(u, pk) === true
          const pRow = '<div class="plr p' + (selSt === false ? ' off' : ' sel') + (pDone ? ' done' : '') + (c.arch ? ' arc' : '') + (c.pending && !c.arch ? ' pend' : '') + '" data-k="' + esc(pk) + '" data-kids="' + (hasKids ? '1' : '0') + '"' + (allDone ? ' data-alldone="1"' : '') + '>'
            + '<button type="button" class="plc' + (hasKids ? '' : ' blank') + '" data-pl-tg="' + esc(pk) + '" aria-expanded="' + (hasKids ? String(pOpen) : 'false') + '" aria-label="' + esc((pOpen ? '收起' : '展开') + '「' + c.t + '」下的任务') + '" title="' + esc((pOpen ? '收起' : '展开') + '任务（点行内空白也能开合）') + '">' + PL_CHEV + '</button>'
            + '<span class="plck-sp" aria-hidden="true"></span>'
            + pTag('p')
            + '<button type="button" class="plt" data-pl-open="' + esc(c.id) + '" title="打开卡片详情：' + esc(c.t) + '">' + esc(c.t) + '</button>'
            + stat
            + '<span class="plm" title="' + esc(metaTxt) + '">' + esc(metaTxt) + '</span>'
            + (totalN ? '<span class="plp" title="' + esc('当天已执行 ' + doneN + ' / ' + totalN + ' 个任务项') + '">' + doneN + '/' + totalN + '</span>' : '')
            + ddc
            + '<span class="v40pl">' + pchipHtml(c.id) + '</span>'
            + pRecBtn(pk, pRecSt(u, pk), { level: 'p', title: c.t }, future, '')
            + pSelChip(selSt, pk, selLab)
            + '</div>'
          if (!hasKids) { html += pRow; continue }
          let kin = ''
          for (const it of allShown) {
            const tk = it.key
            const tKeys = pTaskKeys(c, it)
            const tSel = pSt(u, u.sel, tKeys)
            const cd = it.cdone
            const tDis = cd && tSel !== true
            const selLabT = cd && tSel !== true
              ? '「' + it.t.text + '」已经完成，不用再排今天'
              : (tSel === true ? '取消' : '选中') + '「' + it.t.text + '」排今天执行' + (tSel === 'mixed' ? '（补齐还没选中的子任务）' : '') + '；选中的任务项会出现在上面的任务执行安排里'
            const subsShown = mode === 'all' ? it.subs : it.subs.filter(visS)
            const tHas = subsShown.length > 0
            const tOpen = cd ? plOpenDone.has(tk) : plIsOpen(tk)
            const tRec = pRecSt(u, tk)
            /* v131（3）：有子列表的行和它的子列表包一层 .plw → 吸顶只在自己那一块里生效 */
            if (tHas) kin += '<div class="plw plw-t">'
            kin += '<div class="plr t' + (tSel === false ? ' off' : ' sel') + (tRec === true ? ' done' : '') + (cd ? ' cdone' : '') + '" data-k="' + esc(tk) + '" data-kids="' + (tHas ? '1' : '0') + '">'
              + '<button type="button" class="plc' + (tHas ? '' : ' blank') + '" data-pl-tg="' + esc(tk) + '" aria-expanded="' + (tHas ? String(tOpen) : 'false') + '" aria-label="' + esc((tOpen ? '收起' : '展开') + '「' + it.t.text + '」下的子任务') + '" title="' + esc((tOpen ? '收起' : '展开') + '子任务（点行内空白也能开合）') + '">' + PL_CHEV + '</button>'
              + pCk('data-pl-ck="' + esc(tk) + '"', 'plck:' + tk, cd, (cd ? '取消完成' : '完成') + '任务「' + it.t.text + '」' + (it.subs.length ? '（连同 ' + it.subs.length + ' 个子任务）' : '') + '；和卡片详情同一个状态', false)
              + pTag('t')
              + '<button type="button" class="nmt nmtb" data-pl-open="' + esc(c.id) + '" title="' + esc('打开卡片详情：' + c.t) + '">' + esc(it.t.text) + '</button>' + dueChip(it.t.due, !!it.t.done)
              + (it.t.sess ? '<span class="v40pl">' + chipHtml(it.t.sess) + '</span>' : '')
              + recBadge(tk)
              + pRecBtn(tk, tRec, { level: 't', title: it.t.text, subsN: it.subs.length }, future, '')
              + pSelChip(tSel, tk, selLabT, tDis)
              + '</div>'
            if (tHas) kin += '<div class="plsub' + (tOpen ? ' open' : '') + '" data-pl-sub="' + esc(tk) + '"><div class="plc-in">'
            for (const x of subsShown) {
              const sk = x.key, on = u.done.has(sk), sel = u.sel.has(sk) || u.sel.has(tk), scd = x.cdone
              const sDis = scd && !sel
              kin += '<div class="plr s' + (sel ? ' sel' : ' off') + (on ? ' done' : '') + (scd ? ' cdone' : '') + '" data-k="' + esc(sk) + '">'
                + '<span class="plc blank" aria-hidden="true"></span>'
                + pCk('data-pl-ck="' + esc(sk) + '"', 'plck:' + sk, scd, (scd ? '取消完成' : '完成') + '子任务「' + x.s.text + '」；和卡片详情同一个状态', false)
                + pTag('s')
                + '<button type="button" class="nmt nmtb" data-pl-open="' + esc(c.id) + '" title="' + esc('打开卡片详情：' + c.t) + '">' + esc(x.s.text) + '</button>' + dueChip(x.s.due, !!x.s.done)
                + (x.s.sess ? '<span class="v40pl">' + chipHtml(x.s.sess) + '</span>' : '')
                + recBadge(sk)
                + pRecBtn(sk, on, { level: 's', title: x.s.text }, future, '')
                + pSelChip(sel, sk, scd && !sel ? '「' + x.s.text + '」已经完成，不用再排今天' : (sel ? '取消' : '选中') + '「' + x.s.text + '」排今天执行；选中的任务项会出现在上面的任务执行安排里', sDis)
                + '</div>'
            }
            if (tHas) kin += '</div></div></div>'
          }
          html += '<div class="plw plw-p">' + pRow + '<div class="plchildren' + (pOpen ? ' open' : '') + '" data-pl-kids="' + esc(pk) + '"><div class="plc-in">' + kin + '</div></div></div>'
        }
        if (!shownP) continue
        const gk = 'g|' + gg.g.id
        const gOpen = plIsOpen(gk)
        out += '<div class="plw plw-g"><div class="plr gp" data-k="' + esc(gk) + '" data-kids="1" role="button" tabindex="0" aria-expanded="' + gOpen + '" aria-label="' + esc('项目组「' + gg.g.name + '」：' + shownP + ' 个项目；点击' + (gOpen ? '收起' : '展开')) + '">'
          + '<button type="button" class="plc" data-pl-tg="' + esc(gk) + '" aria-expanded="' + gOpen + '" aria-label="' + esc((gOpen ? '收起' : '展开') + '项目组「' + gg.g.name + '」') + '" title="' + esc((gOpen ? '收起' : '展开') + '这一组的项目（点整行也能开合）') + '">' + PL_CHEV + '</button>'
          + '<span class="gpsp" aria-hidden="true"></span>'
          + '<span class="lvt gp">项目组</span>'
          + '<span class="plt">' + esc(gg.g.name) + '</span>'
          + '<span class="plm">' + shownP + ' 个项目</span>'
          + '</div>'
          + '<div class="plchildren plgrp' + (gOpen ? ' open' : '') + '" data-pl-kids="' + esc(gk) + '"><div class="plc-in">' + html + '</div></div></div>'
      }
      if (!out) {
        if (mode === 'done') return '<div class="plempty"><b>本日还没有执行完成的项</b><span>在这里或「任务执行安排」里点「记录执行」的项目 / 任务 / 子任务会出现在这里。</span><button type="button" class="plbtn" data-pl-done>显示全部</button></div>'
        return '<div class="plempty"><b>本日没有「可安排」的任务项</b><span>都已完成或已排进执行安排。点「显示全部」把已完成的也放回来。</span><button type="button" class="plbtn" data-pl-only>显示全部</button></div>'
      }
      return out
    }
    /* ═══ v118：本日计划清单整卡收起 / 展开 —— 单一高度引擎 ══════════════════════
       收起：卡片向下收，最后只剩标题栏；展开：卡片向上长回上次的比例。
       两端都是确定值（两张卡的高度都算成 px），动画只做一次 height 过渡；
       动画结束后不再做任何二次改动 —— 不会跳状态，也不会留大片空白。 */
    const PL_SPLIT_H = 10
    const PL_BD = new WeakMap<HTMLElement, number>()
    /* v133 R2：重画路径里的高度引擎只跑一次 —— render() 里登记、末尾统一跑（原本 sizeTp + renderPanel 各跑一遍、每遍都强制布局）；
       不在 render() 里调用时放到下一帧上屏前 */
    let plRaf = 0, plWant = false
    function plLayoutSoon(): void {
      if (RW) { plWant = true; return }
      if (!plRaf) plRaf = requestAnimationFrame(() => { plRaf = 0; if (!self.disposed) plLayout(false) })
    }
    let plAnimUntil = 0
    let plLayoutTimer = 0
    let plScrollKeep = 0
    /* v130（3）：两张卡的单一高度引擎 —— 模式 ex / pl / split；分隔条常驻 10px（任一张收起时也留这道间距）；
       拖动范围 = 上到「执行安排只剩标题栏」、下到「计划清单只剩标题栏」，离两端 28px 内松手就吸到那一端 */
    type PairGeo = { free: number; ex: number; pl: number }
    let spDrag: null | { y0: number; a: number; g: PairGeo; h: number } = null
    function pairGeo(): PairGeo | null {
      const pair = $('#tpPair'), ex = $('#tpExCard'), pl = $('#tpPlanCard')
      if (!pair || !ex || !pl) return null
      const cs = getComputedStyle(pair)
      const inner = pair.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
      if (!(inner > 0)) return null
      /* 量「收起态」标题栏高度（展开态右侧工具可能把标题栏撑成两行，收起态只剩一行）+ 卡片上下边框 */
      /* v133 R2：收起态标题栏是 CSS 定死的 36px（#tpExCard.min / #tpPlanCard.min .tpc-h）—— 不再临时加 .min 去量
         （每次加 / 去 class 都强制整页样式 + 布局，主实例一次重画里占 130ms）；边框只量一次 */
      const hh = (c: HTMLElement): number => {
        let bd = PL_BD.get(c)
        if (bd == null) { bd = c.offsetHeight - c.clientHeight; if (!(bd > 0)) bd = 4; PL_BD.set(c, bd) }
        return 36 + bd
      }
      return { free: inner - PL_SPLIT_H, ex: hh(ex), pl: hh(pl) }
    }
    function pairSync(): void {
      const pair = $('#tpPair'), ex = $('#tpExCard'), pl = $('#tpPlanCard'), sp = $('#tpSplit')
      if (!pair || !ex || !pl) return
      const exMin = state.tpm === 'pl', plMin = state.tpm === 'ex'
      state.plFold = plMin
      ex.classList.toggle('min', exMin); pl.classList.toggle('min', plMin)
      pair.classList.toggle('folded', plMin); pair.classList.toggle('exfolded', exMin)
      /* 收起的列表 inert（Tab / 读屏跳过） */
      for (const [el, off] of [[$('#exBody'), exMin], [$('#tpList'), plMin]] as Array<[(HTMLElement & { inert?: boolean }) | null, boolean]>) {
        if (!el) continue
        el.inert = off
        if (off) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden')
      }
      const fe = $('#exCardFold'), fp = $('#plCardFold')
      if (fe) { const l = exMin ? '展开任务执行安排（本日计划清单会自动收起）' : '收起任务执行安排（只留标题栏）'; fe.setAttribute('aria-label', l); fe.setAttribute('aria-expanded', String(!exMin)); fe.dataset.tip = l }
      if (fp) { const l = plMin ? '展开本日计划清单（任务执行安排会自动收起）' : '收起本日计划清单（只留标题栏）'; fp.setAttribute('aria-label', l); fp.setAttribute('aria-expanded', String(!plMin)); fp.setAttribute('aria-pressed', String(!plMin)); fp.dataset.tip = l }
      if (sp) { sp.removeAttribute('aria-hidden'); sp.tabIndex = 0 }
    }
    function plLayout(animate: boolean): void {
      const pair = $('#tpPair'), ex = $('#tpExCard'), pl = $('#tpPlanCard'), sp = $('#tpSplit')
      if (!pair || !ex || !pl || !sp) return
      if (!root.classList.contains('tp-on')) return
      plTops()   /* v131（3）：吸顶高度要在面板可见时量（隐藏时行高都是 0） */
      if (spDrag) return                                         /* 拖分隔条时由拖动接管 */
      if (!animate && Date.now() < plAnimUntil) return          /* 动画中途的重画不抢方向盘 */
      const g = pairGeo()
      if (!g) return
      pairSync()
      const r = (state.tpr == null ? 60 : state.tpr) / 100
      const exH = state.tpm === 'ex' ? g.free - g.pl
        : state.tpm === 'pl' ? g.ex
        : Math.round(Math.min(g.free - g.pl - 40, Math.max(g.ex + 40, g.free * r)))
      pair.classList.toggle('anim', !!animate)
      ex.style.height = exH + 'px'
      sp.style.height = PL_SPLIT_H + 'px'
      pl.style.height = (g.free - exH) + 'px'
      sp.setAttribute('aria-valuenow', String(Math.round((exH - g.ex) / Math.max(1, g.free - g.ex - g.pl) * 100)))
      if (animate) {
        plAnimUntil = Date.now() + 300
        clearTimeout(plLayoutTimer)
        plLayoutTimer = window.setTimeout(() => pair.classList.remove('anim'), 320)
      }
    }
    function syncPlFoldBtn(): void { pairSync() }
    /* 开合模式 / 比例 / 只显示可安排一起落盘（一次 POST；在途期间 plBusy 挡住旧快照）；pfold 仍写，兼容旧 host */
    function plPersist(): void {
      self.plBusy++
      void postGantt('ui', { tpm: state.tpm, tpr: state.tpr, pfold: state.tpm === 'ex', plonly: !!state.plOnly, pldone: !!state.plDone }).then((r) => {
        self.plBusy = Math.max(0, self.plBusy - 1)
        if (self.data && r.gantt?.ui) self.data.ui = { ...r.gantt.ui }
      }).catch((e) => {
        self.plBusy = Math.max(0, self.plBusy - 1)
        toast(e instanceof ApiError ? e.message : String(e), 'err')
      })
    }
    /* 联动：展开执行安排 → 计划清单自动收起；展开计划清单 → 执行安排自动收起 */
    function pairMode(m: 'ex' | 'pl' | 'split', silent?: boolean): void {
      if (state.tpm === m) { plLayout(false); return }
      const list = $('#tpList'), was = state.tpm
      if (m === 'ex' && list) plScrollKeep = list.scrollTop      /* 收起前记住滚到哪，展开后回原位 */
      state.tpm = m
      state.plFold = m === 'ex'
      plPersist()
      plLayout(true)
      if (m !== 'ex' && was === 'ex' && list) window.setTimeout(() => { try { list.scrollTop = plScrollKeep } catch { /* ignore */ } }, 300)
      if (!silent) toast(m === 'ex' ? '已展开任务执行安排 · 本日计划清单自动收起' : m === 'pl' ? '已展开本日计划清单 · 任务执行安排自动收起' : '两张卡都展开')
    }
    /* 计划清单原有入口（箭头 / 收起态整卡 / 「只显示可安排」等自动展开）都走这里 */
    function plSetFold(next: boolean, silent?: boolean): void {
      if (next ? state.tpm === 'ex' : state.tpm !== 'ex') return
      pairMode(next ? 'ex' : 'pl', silent)
    }
    on(window, 'resize', () => { if (root.classList.contains('tp-on')) plLayout(false) })
    /* v127：详情里勾完成记录执行 / 排今天之后，今天面板从服务端重读 */
    on(window, 'dpm-panel-dirty' as 'resize', (e) => { void self.load(true, !!(e as unknown as CustomEvent<{ force?: boolean }>).detail?.force) })
    /* v146：会话开始工作 → 面板开着时：卡片出现在「执行中」分区；分区收着就展开；卡片在视野外就只滚执行安排自己的滚动区（不滚整页）；闪一下绿框 */
    on(window, 'dpm:sess-run' as 'resize', (e) => {
      const hits = ((e as unknown as CustomEvent<{ hits?: Array<{ key: string }> }>).detail?.hits ?? [])
      const keys = hits.map((h) => h.key)
      if (!keys.length) return
      if (EXZ_CLOSED.delete('run')) void postGantt('ui', { exz: [...EXZ_CLOSED] }).catch(() => undefined)
      void self.load(true).then(() => {
        const body = $('#exBody')
        if (!body || !root.classList.contains('tp-on') || !body.offsetParent) return
        const find = (): HTMLElement[] => keys.map((k) => body.querySelector<HTMLElement>('.exi[data-k="' + CSS.escape(k) + '"]')).filter((x): x is HTMLElement => !!x)
        const els = find()
        /* 分区展开有高度过渡、后续轮询可能再重画：立即滚一次，过渡结束后按最新位置再校一次 */
        const into = (smooth: boolean): void => {
          const f = find()[0]; if (!f) return
          const br = body.getBoundingClientRect(), r = f.getBoundingClientRect()
          if (r.top < br.top + 30 || r.bottom > br.bottom - 8) body.scrollTo({ top: body.scrollTop + r.top - br.top - 60, behavior: smooth ? 'smooth' : 'auto' })
        }
        into(true); setTimeout(() => into(false), 700)
        for (const el of els) { el.classList.remove('dpm-runfl'); void el.offsetWidth; el.classList.add('dpm-runfl'); setTimeout(() => el.classList.remove('dpm-runfl'), 1500) }
        ;(window as unknown as Record<string, unknown>).__dpmRunPlaced = { keys, placed: els.map((x) => x.closest<HTMLElement>('.exz')?.dataset.zone), at: Date.now() }
      })
    })
    /* v143（1.2）：详情勾完成 → 自动记录执行写好后，执行安排里那颗「记录执行」闪一下（等这次重读画完再找） */
    on(window, 'dpm-rec-flash' as 'resize', (e) => {
      const keys = ((e as unknown as CustomEvent<{ keys?: string[] }>).detail?.keys ?? [])
      let n = 0
      const tick = (): void => {
        const els = keys.map((k) => $('#exBody [data-x-rec="' + CSS.escape(k) + '"]')).filter((x): x is HTMLElement => !!x && x.classList.contains('on'))
        if (!els.length && ++n < 40) { setTimeout(tick, 100); return }
        for (const b of els) { b.classList.remove('dpm-recfl'); void b.offsetWidth; b.classList.add('dpm-recfl'); setTimeout(() => b.classList.remove('dpm-recfl'), 900) }
        ;(window as unknown as Record<string, unknown>).__dpmRecFlash = { keys, lit: els.length, at: Date.now() }
      }
      tick()
    })
    on(window, 'dpm-detail' as 'resize', () => paintCur())
    /* v110：本日计划清单一键展开 / 收起 + 只显示可安排 */
    const plPanelKeys = (): string[] => {
      const model = pBuild(state.day)
      const out: string[] = []
      for (const p of model) { out.push(p.key); for (const it of p.all) out.push(it.key) }
      for (const p of model) if (!out.includes('g|' + p.g.id)) out.push('g|' + p.g.id)
      return out
    }
    function plFoldAllToggle(): void {
      if (state.plFold) plSetFold(false, true)   /* v118（3）：收起态点它 → 先展开，才看得到结果 */
      /* v121：过滤模式下项目 / 任务全部展开，只有项目组栏能开合 → 一键开合只作用于项目组 */
      const keys = plPanelKeys().filter((k) => !plFilter() || /^g\|/.test(k))
      const allOpen = keys.every((k) => !plClosed.has(plKeyOf(k)))
      for (const k of keys) plClosed.delete(plKeyOf(k))
      if (allOpen) for (const k of keys) plClosed.add(plKeyOf(k))
      /* v124（2）：已完成任务默认折叠 —— 「展开全部 / 收起全部」照样带上它们 */
      const doneTs = $$('#tpList .plr.t.cdone[data-kids="1"], #tpList .plr.p[data-alldone="1"][data-kids="1"]').map((r) => (r as HTMLElement).dataset.k as string)
      if (allOpen) plOpenDone.clear(); else for (const k of doneTs) plOpenDone.add(k)
      plFoldSave()
      /* 全部打开 / 收起也走同一套过渡，不整块重画 */
      for (const el of $$<HTMLElement>('#tpList [data-pl-kids], #tpList [data-pl-sub]')) el.classList.toggle('open', !allOpen)
      for (const el of $$<HTMLElement>('#tpList [data-pl-tg], #tpList .plr.gp')) el.setAttribute('aria-expanded', String(!allOpen))
      syncPlBtns()
      toast(allOpen ? '已收起：只显示项目（点任意行 / 箭头可再展开）' : '已展开：项目 / 任务 / 子任务全部展开')
    }
    /* v118（1）：整卡收起 / 展开 —— 交给 plSetFold / plLayout 这套高度引擎，这里只切换状态 */
    function plCardToggle(): void { plSetFold(!state.plFold) }
    function plOnlyToggle(): void {
      state.plOnly = !state.plOnly
      if (state.plOnly) state.plDone = false
      /* v118（3）：收起态点它 → 先展开，才看得到结果；收起 / 只显示可安排一起落盘 */
      if (state.plFold) plSetFold(false, true)
      else plPersist()
      renderPanel()
      toast(state.plOnly ? '只显示可安排：已完成 / 已排的任务项都收起来了' : '显示全部：已完成 / 已排的任务项都回来了（全部展开）')
    }
    /* v121（2.5）：只显示本日执行完成项 —— 与「只显示可安排」互斥；再点一次 = 显示全部 */
    function plDoneToggle(): void {
      state.plDone = !state.plDone
      if (state.plDone) state.plOnly = false
      if (state.plFold) plSetFold(false, true)
      else plPersist()
      renderPanel()
      toast(state.plDone ? '只显示本日执行完成项：今天记录过执行的项目 / 任务 / 子任务' : '显示全部：今天的全部计划项都回来了')
    }
    function syncPlBtns(): void {
      const fb = $('#plFoldAll'), ob = $('#plOnlyBtn'), db = $('#plDoneBtn')
      if (db) { db.setAttribute('aria-pressed', String(!!state.plDone)); db.textContent = state.plDone ? '显示全部' : '只显示本日完成' }
      if (fb) {
        const keys = plPanelKeys().filter((k) => !plFilter() || /^g\|/.test(k))
        const allOpen = keys.length ? keys.every((k) => !plClosed.has(plKeyOf(k))) : true
        fb.textContent = allOpen ? '收起全部' : '展开全部'
        fb.setAttribute('aria-pressed', String(!allOpen))
      }
      if (ob) {
        ob.textContent = state.plOnly ? '显示全部' : '只显示可安排'
        ob.setAttribute('aria-pressed', String(!!state.plOnly))
      }
    }
    /* v126（1.3）：不悬停不跑马灯 —— 标题放不下就显示省略号；悬停时卡片展开把标题显示全，也不跑。
       这里只量两块尺寸给 CSS 用：记录执行按钮宽（悬停按钮贴它左边）和悬停按钮条宽（宽排时标题第一行给它留位）。 */
    function syncExMarquee(): void {
      const body = $('#exBody')
      if (!body) return
      for (const e of $$('.exi', body)) {
        const el = e as HTMLElement
        const r = el.querySelector(':scope > .exrec')
        if (r) el.style.setProperty('--recw', Math.round(r.getBoundingClientRect().width) + 'px')
        const n = el.querySelectorAll('.exacts .exa').length
        if (n) el.style.setProperty('--actw', (n * 22 + (n - 1) * 4 + 8) + 'px')
      }
      for (const t of $$('.exi-t', body)) (t as HTMLElement).classList.remove('mq')
    }
    function pEmptyHtml(kind: 'arr' | 'plan'): string {
      if (kind === 'arr') return '<div class="tp-empty2"><span class="eic" aria-hidden="true">' + PV_ICON.playBig + '</span><b>这一天还没有选中要执行的任务</b><span>在下面「本日计划清单」里点「排今天」，选中的任务项会立刻出现在这里。勾选只表示当天完成，不会自动选中。</span></div>'
      return '<div class="tp-empty2"><span class="eic" aria-hidden="true">' + PV_ICON.list + '</span><b>这一天没有显示计划条的项目</b><span>双击甘特图里的日期格 →「计划此日执行」，项目就会出现在这里；也可以给已有的计划日加任务。</span></div>'
    }
    let lastPanelDay = ''
    let PANEL_PULSE = new Set<string>()
    function pPulse(keys: string[]): void { for (const k of keys) if (k) PANEL_PULSE.add(k) }
    /** v121（1.3 根因）：后台 5s 轮询会重画面板，重画第一行就是「有拖动就取消」→ 按久了自己回原位。
     *  拖动中只记一笔「欠一次重画」，松手后补上；拖动永远只由松手 / Esc 结束。 */
    let PANEL_DEFER = 0
    /** v124（1.3）：哪个分区正在「闪一下」（到期时间）—— 期间的重画（服务端回包 / 轮询）照样带着这个提示 */
    const ZPULSE = new Map<string, number>()
    function paintZPulse(): void {
      const now = Date.now()
      for (const [z, until] of ZPULSE) {
        if (until <= now) { ZPULSE.delete(z); continue }
        const h = $('#exBody .exz[data-zone="' + z + '"] .exz-h')
        if (h && !h.classList.contains('zpulse')) { h.classList.add('zpulse'); h.style.animationDelay = (until - 1300 - now) + 'ms'; window.setTimeout(() => { h.classList.remove('zpulse'); h.style.animationDelay = '' }, until - now) }
      }
    }
    function renderPanel(): void {
      if ((exDrag && exDrag.on) || document.body.classList.contains('v41dragging')) { PANEL_DEFER++; return }
      if (exDrag) exCleanup()
      PANEL_DEFER = 0
      const day = state.day, key = ymd(day), dt = new Date(day), future = day > TODAY
      const dayChanged = lastPanelDay !== key
      lastPanelDay = key
      if (root.classList.contains('tp-on')) carryRunIfNeeded()
      $('#tpDay')!.textContent = md(day)
      setH($('#tpSub')!, DAYS[dt.getDay()] + ' · ' + dt.getFullYear() + (day === TODAY ? ' <span class="today">今天</span>' : future ? ' <span class="today" style="background:var(--pm-select);color:var(--dsw-alias-label-primary)">未来</span>' : ''))
      const model = pBuild(day), leaves = pLeaves(model), u = pday(key)
      /* v113（4.2）：层级变化（任务 ↔ 子任务）只改「任务项卡片」的内容，不动位置 ——
         同一个 id 的 key 前缀会从 t| 变成 s|（或反过来），这里把 sel / lanes / done 里的旧 key 迁移到新 key，
         否则这一项会被当成「已删除」直接从执行安排里消失。 */
      /* 两步都要跑（|| 短路时 v41Norm 会被跳过：子任务全部记录执行不进本日已执行） */
      const mig = pMigrateKeys(u, model), nrm = v41Norm(u, key)
      if (mig || nrm) savePanel(key, panelPatch(key, u))
      pEnsure(u, leaves)
      REC_SET = recSet(key)
      syncCarryChips(leaves, u)
      const exBody = $('#exBody'), plEl = $('#tpList')
      /* v133 R4：HTML 没变就不碰 DOM —— 也不读写 scrollTop、不跑量几何的后处理（这些都会强制整页布局，选中项变化时每次点击 ~2×30ms） */
      let exCh = false, plCh = false
      const put = (el: HTMLElement & { __h?: string }, html: string): boolean => {
        if (el.__h === html && el.firstElementChild) return false
        const s = dayChanged ? 0 : el.scrollTop
        exSet(el, html)
        el.scrollTop = s
        return true
      }
      const af = document.activeElement as HTMLElement | null
      const fk = af && af.getAttribute ? (af.getAttribute('data-fk') ?? '') : ''
      let selN = 0, doneN = 0
      for (const l of leaves.values()) { if (u.sel.has(l.key)) selN++; if (u.done.has(l.key)) doneN++ }
      const exMembers = [...leaves.values()].filter((l) => u.sel.has(l.key) || u.done.has(l.key))
      setH($('#tpStat')!, '<span class="tsl">' + PV_ICON.check + '勾选 = 任务完成 · ' + PV_ICON.rec + '记录执行 = 今天做了 · ' + PV_ICON.cal + '排今天</span><span class="tsr">计划 <b>' + model.length + '</b> · 已选 <b>' + selN + '</b> · 已完成 <b>' + doneN + '</b>' + (future ? ' · <span class="fut">未来不可勾选</span>' : '') + '</span>')
      const exN = $('#exN'), plN = $('#plN')
      if (exN) exN.textContent = exMembers.length ? exMembers.length + ' 项' : '—'
      if (plN) plN.textContent = model.length ? model.length + ' 项目' : '—'
      if (exBody) {
        exBody.classList.toggle('zones', exMembers.length > 0)
        if (exMembers.length) {
          /* v121–v123：六个分区。区由状态推出来：记录执行 → 本日已执行（同一帧挪过去）；
             暂停 → 个人暂停 / 等外部进展；执行中 → 执行中；在 lanes 里 → 已安排；其余 → 未安排。 */
          const byZ: Record<string, LeafL[]> = { done: [], pause: [], wait: [], run: [], arr: [], un: [] }
          for (const l of exMembers) byZ[pZoneOf(u, l.key, key)].push(l)
          /* v122（1.3）：本日已执行一列，按「记录执行」的时间排，早的在最上面 */
          const dArr = [...u.done]
          const dt = (k: string): number => u.doneAt.has(k) ? (u.doneAt.get(k) as number) : 1e15 + dArr.indexOf(k)
          byZ.done.sort((a, b) => dt(a.key) - dt(b.key))
          const rowsFor = (z: GanttZone): Array<{ lane: string[]; i: number }> => {
            const inZ = new Set(byZ[z].map((l) => l.key)), seen = new Set<string>()
            const rows = pRowsOf(u, z).map((lane, i) => ({ lane: lane.filter((k) => inZ.has(k) && !seen.has(k) && (seen.add(k), true)), i })).filter((r) => r.lane.length)
            /* 新进来的（还没进行表）接到最后一行（非「已安排」满 2 张再开新行） */
            for (const l of byZ[z]) if (!seen.has(l.key)) { const last = rows[rows.length - 1]; if (z !== 'arr' && last && (z === 'run' || last.lane.length < 2) && last.i < 0) last.lane.push(l.key); else rows.push({ lane: [l.key], i: -1 }) }
            return rows
          }
          exCh = put(exBody, EXZ.map((Z) => {
            const list = byZ[Z.z]
            const shut = EXZ_CLOSED.has(Z.z)
            let body = ''
            if (Z.z !== 'done') { const rows = rowsFor(Z.z); body = rows.length ? rows.map((r) => '<div class="exlane' + (r.lane.length > 1 ? ' multi' : '') + '" data-ln="' + r.i + '">' + r.lane.map((k) => { const l = leaves.get(k); return l ? pItemHtml(l, u, key, future) : '' }).join('') + '</div>').join('') : '<div class="exz-empty">' + EXZ_EMPTY[Z.z] + '</div>' }
            else body = list.length ? '<div class="exdone-col">' + list.map((l) => pItemHtml(l, u, key, future)).join('') + '</div>' : '<div class="exz-empty">' + EXZ_EMPTY.done + '</div>'
            return '<section class="exz' + (shut ? ' shut' : '') + (list.length ? ' hasi' : '') + '" data-zone="' + Z.z + '" aria-label="' + Z.t + '（' + list.length + ' 项）">'
              + '<header class="exz-h" data-exz-tg="' + Z.z + '" role="button" tabindex="-1" title="' + (shut ? '展开' : '收起') + '「' + Z.t + '」（点整条标题栏）"><button type="button" class="exz-tg" data-exz-tg="' + Z.z + '" aria-expanded="' + !shut + '" title="' + (shut ? '展开' : '收起') + '「' + Z.t + '」"><svg class="pfchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>'
              + '<span class="zi" aria-hidden="true"><svg viewBox="0 0 24 24">' + (ZI[Z.z] ?? ZI.un) + '</svg></span><b class="zt">' + Z.t + '</b><span class="zn">' + list.length + '</span><span class="zs">' + Z.s + '</span></header>'
              + '<div class="exz-w"><div class="exz-in"' + (shut ? ' inert' : '') + '><div class="exz-b">' + body + '</div></div></div></section>'
          }).join(''))
        } else exCh = put(exBody, pEmptyHtml('arr'))
        if (BUB.card && !BUB.card.isConnected) bubHide()
      }
      if (plEl) {
        /* v133 R2：计划清单和执行安排一样，HTML 没变就不重建 */
        plCh = put(plEl, model.length ? pPlanHtml(day, model, u) : pEmptyHtml('plan'))
      }
      if (exCh) syncExMarquee()
      /* v125：重画后按同一套规则恢复悬停展开（不带动画、不闪） */
      if (HV.key && !HV.el?.isConnected) { const k = HV.key; HV.el = null; HV.key = ''; const c = $('#exBody .exi[data-k="' + CSS.escape(k) + '"]'); if (c && c.matches(':hover')) hvOn(c) }
      if (exCh || plCh) exStuck()
      syncPlBtns()
      syncPlFoldBtn()
      plLayoutSoon()
      if (fk) {
        let f = $('[data-fk="' + CSS.escape(fk) + '"]') as HTMLElement | null
        if (!f) {
          const m = /^ex:(.+):(?:run|pause|cancel)$/.exec(fk)
          if (m) f = $('.exi[data-k="' + CSS.escape(m[1]) + '"]') as HTMLElement | null
        }
        if (f && f.focus) { try { f.focus({ preventScroll: true }) } catch { /* ignore */ } }
      }
      const pulses = PANEL_PULSE
      PANEL_PULSE = new Set()
      if (pulses.size) requestAnimationFrame(() => {
        for (const k of pulses) {
          const els = $$('[data-k="' + CSS.escape(k) + '"]')
          for (const el of els) {
            el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), el.classList.contains('exi') ? 1500 : 720)
            /* v124（1.3）：卡片被挪进收着的分区时，分区标题闪一下提示 */
            const shut = el.closest('.exz.shut') as HTMLElement | null
            if (shut) ZPULSE.set(shut.dataset.zone ?? '', Date.now() + 1300)
          }
        }
        paintZPulse()
      })
      else paintZPulse()
    }
    function futureDay(): boolean { return state.day > TODAY }
    /** v122（1.4）+ v123（1.8）：勾选圆圈 = 卡片里的任务 / 子任务真的完成（和卡片详情同一份数据）；
     *  勾上的同时，没记过执行的记上（来源分区照样记下，卡片进本日已执行）；取消完成不撤销执行记录。 */
    function pDoneToggle(k: string): void {
      const f = pFind(k)
      if (!f || f.level === 'p') return
      const c = f.c
      const t = f.it?.t
      if (!t) return
      const on = f.level === 's' ? !(f.s?.done) : !t.done
      const id = f.level === 's' ? (f.s?.id ?? '') : t.id
      /* 乐观：本地模型先改，服务端回包为准 */
      if (f.level === 's' && f.s) { f.s.done = on; t.done = t.subs.every((x) => x.done) }
      else { t.done = on; for (const x of t.subs) x.done = on }
      const allDone = t.done
      if (on && !futureDay()) {
        const key = ymd(state.day), u = pday(key)
        let rec = false
        for (const x of pRecKeys(f)) if (!u.done.has(x)) { u.from.set(x, pZoneOf(u, x, key)); u.done.add(x); PST.delete(key + '\n' + x); u.doneAt.set(x, Date.now()); rec = true }
        if (rec) { savePanel(key, panelPatch(key, u)); pSyncActual(c, u, key) }
      }
      pPulse([k, f.p.key])
      render()
      void postBoard('card/task-done', { id: c.id, task: id, done: on }).then(() => { void self.load(true); host.tasksChanged?.(c.id) }).catch((e) => { toast('任务完成状态没保存上：' + (e instanceof ApiError ? e.message : String(e)), 'err'); void self.load() })
      const name = f.level === 's' ? f.s?.text ?? '' : t.text
      toast(on ? (f.level === 's' ? '已完成子任务「' + name + '」（卡片详情里同步勾上）' + (allDone ? ' · 子任务全部完成，任务「' + t.text + '」也自动完成' : '') : '已完成任务「' + name + '」' + (t.subs.length ? '和它的 ' + t.subs.length + ' 个子任务' : '') + '（卡片详情里同步勾上）') + ' · 已记录今天执行'
        : '已取消完成「' + name + '」（卡片详情同步；今天的执行记录保留）')
    }
    /** v122（1.4）：「记录当日执行」= 旧勾选的原意（panels[day].done，甘特格子跟着它）。v123：撤销 = 回到来源分区。 */
    function pRecToggle(k: string): void {
      const key = ymd(state.day), u = pday(key), f = pFind(k)
      if (!f) return
      if (futureDay()) { toast('未来的日子不能记录执行'); return }
      const keys = pRecKeys(f)
      const on = !keys.every((x) => u.done.has(x))
      if (!on && f.cdone) { toast('已勾选完成：不能撤销今天的执行记录（先把勾选去掉）'); return }
      let back: GanttZone | '' = ''
      if (on) { for (const x of keys) if (!u.done.has(x)) { u.from.set(x, pZoneOf(u, x, key)); u.done.add(x); PST.delete(key + '\n' + x); u.doneAt.set(x, Date.now()) } }
      else for (const x of keys) { if (!u.done.has(x)) continue; u.done.delete(x); u.doneAt.delete(x); const z = pRestoreFrom(u, x, key); if (x === k) back = z }
      /* v141（1.2）：子任务全部记录执行 = 任务卡整体进本日已执行；撤销其中一个 = 回原分区（保存前就合好，别等下一次载入） */
      v41Norm(u, key)
      savePanel(key, panelPatch(key, u))
      pSyncActual(f.c, u, key)
      pPulse(keys.concat([f.p.key]))
      const what = f.level === 'p' ? '项目及其全部任务 / 子任务' : f.level === 't' ? (f.it?.subs.length ? '任务及其 ' + f.it.subs.length + ' 个子任务' : '任务') : '子任务'
      toast(on ? '已记录今天执行完成：「' + pTitleOf(f) + '」（' + what + '）· 甘特图今天的格子已标记' : '已撤销今天的执行记录：「' + pTitleOf(f) + '」· 回到「' + EXZ_T[back || 'un'] + '」')
      render()
    }
    /** 一天的整份执行安排状态（写回服务端用）。 */
    function panelPatch(key: string, u: PanelDayM): Record<string, unknown> {
      /* v141：选中只认任务键 —— 记过执行的子任务键映射到它的任务（直接并进去会被 v41Norm 再剥掉 → 每次重画都写盘，几笔在途保存互相覆盖，子任务执行记录丢失） */
      return { sel: [...new Set([...u.sel, ...[...u.done].map(v41K)])], done: [...u.done], lanes: u.lanes ?? [], zl: u.zl, pst: dayPst(key), doneAt: Object.fromEntries(u.doneAt), from: Object.fromEntries(u.from) }
    }
    /* v123：按钮 = 把卡片挪到哪个分区 —— 开始执行 → 执行中；个人暂停 / 等外部 → 对应分区；取消执行 / 取消暂停 → 已安排 */
    function pAct(k: string, act: string): void {
      const day = state.day, key = ymd(day), u = pday(key), f = pFind(k)
      if (!f) return
      if (act === 'unsel') {
        u.sel.delete(k); PST.delete(key + '\n' + k); pZlDrop(u, k); pLaneDrop(u, k)
        savePanel(key, { sel: [...u.sel], pst: dayPst(key), lanes: u.lanes ?? [], zl: u.zl })
        pPulse([f.p.key])
        toast('当日不安排「' + pTitleOf(f) + '」：已从未安排移除，本日计划清单里变回「排今天」')
        render()
        return
      }
      if (futureDay()) { toast('未来的日子不能执行'); return }
      if (u.done.has(k)) { toast('这项今天已经记录执行；要继续请先点「已执行」撤销'); return }
      const from = pZoneOf(u, k, key)
      const to: GanttZone = act === 'run' ? 'run' : act === 'pause' ? 'pause' : act === 'wait' ? 'wait' : 'arr'
      pLaneDrop(u, k); pZlDrop(u, k)
      if (to === 'arr') { PST.delete(key + '\n' + k); (u.lanes = u.lanes ?? []).push([k]) }
      else { PST.set(key + '\n' + k, to as 'run' | 'pause' | 'wait'); const zr = u.zl[to as ZlKey]; if (to === 'run' && zr.length) zr[zr.length - 1].push(k); else zr.push([k]) }  /* v127（3）：执行中一行任意多张 */
      const verb = act === 'run' ? (from === 'pause' || from === 'wait' ? '继续执行' : '开始执行') : act === 'pause' ? '个人暂停' : act === 'wait' ? '等外部进展' : from === 'run' ? '取消执行' : '取消暂停'
      savePanel(key, panelPatch(key, u))
      pPulse([k, f.p.key])
      toast(verb + '「' + pTitleOf(f) + '」· 移到「' + EXZ_T[to] + '」')
      render()
    }
    const savePanel = (key: string, patch: Record<string, unknown>): void => { void post('panel', { day: key, ...patch }); setPanelToday(key, panelPatch(key, pday(key))) }
    /** v110：这一天的执行 / 暂停 / 等外部状态（key → run|pause|wait），整体写回服务端。 */
    const dayPst = (key: string): Record<string, 'run' | 'pause' | 'wait'> => {
      const out: Record<string, 'run' | 'pause' | 'wait'> = {}
      const pre = key + '\n'
      for (const [sk, v] of PST) if (sk.startsWith(pre)) out[sk.slice(pre.length)] = v
      return out
    }

    /* ── v111：自动续排 + 本日计划清单「推荐安排」 ─────────────────────────── */
    const CARRY_DONE = new Set<string>()
    let CARRY_BUSY = false
    let REC_SET = new Set<string>()
    /** 之前每一天：key → 最近一天的状态（执行中 / 暂停）。 */
    function histStateMap(dayKey: string): Map<string, { day: string; st: 'run' | 'pause' | 'wait' }> {
      const out = new Map<string, { day: string; st: 'run' | 'pause' | 'wait' }>()
      for (const d of [...PDAY.keys()].filter((x) => x < dayKey).sort().reverse()) {
        const du = PDAY.get(d)
        if (!du) continue
        const pre = d + '\n'
        for (const [sk, st] of PST) {
          if (!sk.startsWith(pre)) continue
          const k = sk.slice(pre.length)
          if (!du.sel.has(k) || out.has(k)) continue
          out.set(k, { day: d, st })
        }
      }
      return out
    }
    /** 之前每一天「排过」的 key（不管有没有状态）。 */
    function histSelKeys(dayKey: string): string[] {
      const out = new Set<string>()
      for (const d of [...PDAY.keys()].filter((x) => x < dayKey)) {
        const du = PDAY.get(d)
        if (du) for (const k of du.sel) out.add(k)
      }
      return [...out]
    }
    /** key → 任务项（项目 / 任务 / 子任务；项目没有任务时按「全部任务完成」判断）。 */
    function leafOfKey(k: string): { text: string; done: boolean; card: CardM } | null {
      const cid = pKeyCard(k)
      const c = cardsById.get(cid)
      if (!c) return null
      const parts = k.split('|')
      const lv = parts[0]
      if (lv === 'p') {
        const flat = (c.tasks ?? []).flatMap((t) => [t, ...(t.subs ?? [])])
        return { text: c.t, done: flat.length ? flat.every((t) => t.done) : false, card: c }
      }
      const id = parts[2] ?? ''
      for (const t of c.tasks ?? []) {
        if (lv === 't' && t.id === id) return { text: t.text, done: t.done === true, card: c }
        for (const sub of t.subs ?? []) if (lv === 's' && sub.id === id) return { text: sub.text, done: sub.done === true || t.done === true, card: c }
      }
      return null
    }
    /** 打开今天的面板时：把之前「执行中 / 暂停」的项复制进今天的执行安排（一天只跑一次）。 */
    function carryRunIfNeeded(): void {
      const dayKey = ymd(state.day)
      if (dayKey !== ymd(TODAY) || CARRY_BUSY) return
      const u = pday(dayKey)
      if (u.carry || CARRY_DONE.has(dayKey)) return
      CARRY_BUSY = true
      u.carry = true
      CARRY_DONE.add(dayKey)
      try {
        const hist = histStateMap(dayKey)
        const names: string[] = []
        const planCards = new Map<string, CardM>()
        for (const [k, h] of hist) {
          const leaf = leafOfKey(k)
          if (!leaf || leaf.done) continue
          if (!u.sel.has(k)) u.sel.add(k)
          if (!PST.has(dayKey + '\n' + k)) { PST.set(dayKey + '\n' + k, h.st); if (!u.zl[h.st].some((l) => l.includes(k))) u.zl[h.st].push([k]) }
          names.push((h.st === 'run' ? '执行中 · ' : h.st === 'wait' ? '等外部 · ' : '已暂停 · ') + leaf.text)
          if (!leaf.card.planSet.has(dayKey)) { leaf.card.planSet.add(dayKey); planCards.set(leaf.card.id, leaf.card) }
        }
        for (const c of planCards.values()) void self.mutate('plan', { card: c.id, day: dayKey, on: true })
        if (names.length || planCards.size) {
          savePanel(dayKey, { sel: [...u.sel], pst: dayPst(dayKey), zl: u.zl, carry: true })
          for (const k of hist.keys()) PANEL_PULSE.add(k)
          const a = names.length ? '已续排 ' + names.length + ' 项（执行中 / 已暂停）：' + names.join('、') : ''
          const b = planCards.size ? planCards.size + ' 个项目今天自动显示计划条：' + [...planCards.values()].map((c) => c.t).join('、') : ''
          window.setTimeout(() => toast([a, b].filter(Boolean).join(' ｜ ')), 360)
        } else {
          savePanel(dayKey, { carry: true })
        }
      } finally {
        CARRY_BUSY = false
      }
    }
    /** 本日计划清单的「推荐安排」：之前排过、没在跑、还没完成、今天有计划条、今天还没排。 */
    function recSet(dayKey: string): Set<string> {
      const out = new Set<string>()
      if (dayKey !== ymd(TODAY)) return out
      const u = pday(dayKey)
      const running = histStateMap(dayKey)
      for (const k of histSelKeys(dayKey)) {
        if (running.has(k) || u.sel.has(k) || u.done.has(k)) continue
        const leaf = leafOfKey(k)
        if (!leaf || leaf.done) continue
        if (!leaf.card.planSet.has(dayKey)) continue
        out.add(k)
      }
      return out
    }
    function recBadge(k: string): string {
      if (!REC_SET.has(k)) return ''
      return '<button type="button" class="plrec" data-pl-rec="' + esc(k) + '" title="之前在「任务执行安排」里排过、还没完成：点一下直接排进今天的执行安排" aria-label="推荐安排：点一下排进今天">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v10M8.2 10.8 12 14.6l3.8-3.8M5.5 19.5h13"/></svg>推荐安排</button>'
    }
    function carryTag(k: string): string {
      const h = histStateMap(ymd(state.day)).get(k)
      if (!h) return ''
      return '<b class="excar" title="从 ' + esc(h.day) + ' 的「任务执行安排」续排过来">续排 ' + esc(md(dayMs(h.day))) + '</b>'
    }
    function syncCarryChips(leaves: Map<string, LeafL>, u: PanelDayM): void {
      const ec = $('#exCarryChip'), rc = $('#plRecChip')
      const hist = histStateMap(ymd(state.day))
      let carried = 0
      const names: string[] = []
      for (const k of leaves.keys()) {
        if (!u.sel.has(k) || !hist.has(k)) continue
        carried++
        names.push(leaves.get(k)!.title)
      }
      if (ec) {
        ec.hidden = carried === 0
        ec.textContent = carried ? '续排 ' + carried : ''
        ec.title = carried ? '今天自动续排：' + names.join('、') : ''
      }
      if (rc) {
        const n = REC_SET.size
        rc.hidden = n === 0
        rc.textContent = n ? '推荐安排 ' + n : ''
        rc.title = n ? '本日计划清单一共 ' + n + ' 项是之前排过、还没完成的：点这里跳到它们' : ''
      }
    }
    function jumpRec(): void {
      const el = $('#tpList .plrec') as HTMLElement | null
      if (!el) return
      const row = el.closest('.plr') as HTMLElement | null
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      for (const x of $$('#tpList .plrec')) { x.classList.add('pulse'); window.setTimeout(() => x.classList.remove('pulse'), 1000) }
      try { el.focus({ preventScroll: true }) } catch { /* ignore */ }
    }
    function pSelToggle(k: string): void {
      const day = state.day, key = ymd(day), u = pday(key), f = pFind(k)
      if (!f) return
      const keys0 = pKeysFor(f)
      if (f.cdone && !keys0.some((x) => u.sel.has(x))) { toast('这项已经完成，不用再排今天'); return }
      const keys = pKeysFor(f), all = keys.every((x) => u.sel.has(x))
      const on = !all
      for (const x of keys) {
        if (on) u.sel.add(x)
        else { u.sel.delete(x); PST.delete(pstKey(x)); pZlDrop(u, x); pLaneDrop(u, x) }
      }
      savePanel(key, { sel: [...u.sel], pst: dayPst(key), lanes: u.lanes ?? [], zl: u.zl })
      pPulse(keys.concat([f.p.key]))
      toast(on ? '已把「' + pTitleOf(f) + '」排进今天的执行安排' : '已取消「' + pTitleOf(f) + '」的今天执行安排')
      render()
    }

    /* ── v105：两块卡片中间的拖动分隔条（默认 3:2，双击复位，键盘 ↑↓ 也能调；比例落盘 ui.tpr）── */
    function spApply(h: number): void {
      const d = spDrag, pair = $('#tpPair'), ex = $('#tpExCard'), pl = $('#tpPlanCard')
      if (!d || !pair || !ex || !pl) return
      const lo = d.g.ex, hi = d.g.free - d.g.pl
      const exH = Math.round(Math.max(lo, Math.min(hi, h)))
      ex.style.height = exH + 'px'
      pl.style.height = (d.g.free - exH) + 'px'
      ex.classList.toggle('min', exH <= lo + 6); pl.classList.toggle('min', exH >= hi - 6)
      pair.classList.toggle('snap-top', exH < lo + 28); pair.classList.toggle('snap-bot', exH > hi - 28)
      d.h = exH
    }
    function spEnd(exH: number, g: PairGeo): void {
      const lo = g.ex, hi = g.free - g.pl
      $('#tpPair')?.classList.remove('snap-top', 'snap-bot')
      let m: 'ex' | 'pl' | 'split' = 'split'
      if (exH < lo + 28) m = 'pl'
      else if (exH > hi - 28) m = 'ex'
      else state.tpr = Math.max(5, Math.min(95, Math.round(exH / g.free * 100)))
      state.tpm = m
      state.plFold = m === 'ex'
      plPersist()
      plLayout(true)
      toast(m === 'pl' ? '执行安排收起到标题栏 · 本日计划清单占满' : m === 'ex' ? '本日计划清单收起到标题栏 · 执行安排占满' : '两张卡高度已调整：上 ' + Math.round(exH) + 'px · 下 ' + Math.round(g.free - exH) + 'px（双击分隔条 = 3 : 2）')
    }
    function tpSplitDown(ev: PointerEvent): void {
      if (ev.button !== 0) return
      ev.preventDefault()
      const g = pairGeo(), pair = $('#tpPair'), ex = $('#tpExCard'), pl = $('#tpPlanCard')
      if (!g || !pair || !ex || !pl) return
      spDrag = { y0: ev.clientY, a: ex.getBoundingClientRect().height, g, h: 0 }
      ex.classList.remove('min'); pl.classList.remove('min')
      pair.classList.remove('folded', 'exfolded', 'anim')
      for (const el of [$('#exBody'), $('#tpList')] as Array<(HTMLElement & { inert?: boolean }) | null>) if (el) { el.inert = false; el.removeAttribute('aria-hidden') }
      document.body.classList.add('tp-splitting')
      spApply(spDrag.a)
      const mv = (e: PointerEvent): void => { if (spDrag) { spApply(spDrag.a + e.clientY - spDrag.y0); e.preventDefault() } }
      const up = (): void => {
        document.removeEventListener('pointermove', mv as EventListener)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', up)
        document.body.classList.remove('tp-splitting')
        const d = spDrag
        spDrag = null
        if (d) spEnd(d.h, d.g)
      }
      document.addEventListener('pointermove', mv as EventListener, { passive: false })
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
    }
    function tpSplitReset(): void {
      state.tpr = 60
      state.tpm = 'split'
      state.plFold = false
      plPersist()
      plLayout(true)
      toast('两张卡都展开：任务执行安排 : 本日计划清单 = 3 : 2')
    }
    function tpSplitKey(ev: KeyboardEvent): void {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return
      ev.preventDefault()
      const g = pairGeo(), ex = $('#tpExCard')
      if (!g || !ex) return
      const cur = ex.getBoundingClientRect().height
      spDrag = { y0: 0, a: cur, g, h: cur }
      spApply(cur + (ev.key === 'ArrowUp' ? -24 : 24))
      const h = spDrag.h
      spDrag = null
      spEnd(h, g)
    }

    /* v105：点任意任务项卡片 → 打开这张卡片的详情，并落在「任务」区域 */
    function openCardTasksOf(c: CardM, tid?: string | null): void {
      state.sel = c.id
      rDefer = true
      try {
        renderSoon()
        if (host.openCardTasks) host.openCardTasks(c.id, tid)
        else host.openCard(c.id)
        ganttGo(c)
      } finally { rDefer = false }
      toast('已打开「' + c.t + '」的卡片详情 · 任务区域')
    }
    function openItemDetail(f: Found): void {
      if (!f || !f.c) return
      openCardTasksOf(f.c, f.level === 's' ? f.s?.id : f.level === 't' ? f.it?.t.id : null)
      /* v142（1.2）：工作区彩色高光按「子任务 → 任务 → 卡片」逐级回退；任务 = 任务 + 子任务；项目 = 卡片 + 全部任务 + 子任务 */
      void wsHighlight(f.c.id, f.level, f.level === 's' ? f.s?.id : f.it?.t.id)
      /* v151（4）：会话窗口正在展示 = 切到对应会话（规则见 sess.ts pickSession） */
      followSession(f.c.id, f.level, f.level === 's' ? f.s?.id : f.it?.t.id)
    }
    /* v129（3）/ v131（1）：甘特定位 —— 滚到项目那一行（组收着先展开），目录格先做彩虹高光，结束后换深蓝粗边框。
       深蓝粗边框 = 卡片详情里正在显示的项目（详情开 / 关 / 换卡都跟着变，双向同步）。 */
    const V9 = { gc: '', at: 0 }
    function detailCard(): string { return (document.querySelector('.dpm-global-detail:not([hidden]) .detail[data-card]') as HTMLElement | null)?.dataset.card ?? '' }
    function paintCur(): void {
      const on = detailCard()
      const el = performance.now() - V9.at
      const glow = V9.gc && el < 1850 ? V9.gc : ''
      for (const x of Array.from($$<HTMLElement>('#rows .ind-cell.v9cur'))) if (x.dataset.openCardCell !== on || x.dataset.openCardCell === glow) x.classList.remove('v9cur')
      const cell = (id: string): HTMLElement | null => $('#rows .ind-cell[data-open-card-cell="' + CSS.escape(id) + '"]')
      if (on && on !== glow) cell(on)?.classList.add('v9cur')
      if (glow) { const x = cell(glow); if (x && !x.querySelector(':scope > .v9ring')) ringEl(x, Math.round(el)) }
    }
    function ganttGo(c: CardM): void {
      self.reveal(c.id)
      /* v133 R3：不再等 420ms —— 本帧重画完（renderSoon 先登记的那一帧）就开始高光，和详情同一拍 */
      requestAnimationFrame(() => { if (self.disposed) return; V9.gc = c.id; V9.at = performance.now(); paintCur(); setTimeout(paintCur, 1880) })
    }

    /* ── v121 拖动引擎：六个分区之间任意拖；跟手（transform + rAF）；不会自己掉线 ──
       1.3 根因：① 每个 pointermove 都同步改 left/top + 对所有卡片 getBoundingClientRect（强制重排），浮卡还继承 transition → 慢半拍；
       ② 5s 后台轮询 → renderPanel() 开头 exCleanup() → 按久了自己退出。
       修法：pointermove 只记坐标，rAF 里一次 transform（浮卡 transition:none）；几何拖起时缓存一次、滚动后再刷新；重画推迟到松手。
       v125（2）：浮卡位置走 --gt 变量（卡片的 transform:none !important 不会再把它盖成 (0,0)）；按下立即收回展开、浮卡固定 44px。 */
    type ExDrop = { z: GanttZone; type: 'same'; next: string | null; prev: string | null } | { z: GanttZone; type: 'new'; below: string | null; above: string | null } | { z: GanttZone; type: 'list' }
    interface ExGeoZone { z: GanttZone; el: HTMLElement; r: DOMRect; br: DOMRect; lanes: Array<{ el: HTMLElement; r: DOMRect; items: Array<{ k: string; r: DOMRect }>; top: number; bottom: number }> | null; items: Array<{ k: string; r: DOMRect }> }
    interface ExDrag { el: HTMLElement; k: string; pid: number; x0: number; y0: number; t0: number; on: boolean; ghost: HTMLElement | null; ind: HTMLElement | null; hint: HTMLElement | null; drop: ExDrop | null; raf: number; lastX: number; lastY: number; dx: number; dy: number; gw: number; gh: number; from: GanttZone; geo: { body: DOMRect; st: number; zones: ExGeoZone[] } | null; frames: number; moves: number; lagMax: number; tMove: number }
    let exDrag: ExDrag | null = null
    let exLastDrag = 0
    function exCleanup(): void {
      const d = exDrag
      if (!d) return
      document.removeEventListener('pointermove', exMove as unknown as EventListener)
      document.removeEventListener('pointerup', exUp)
      document.removeEventListener('pointercancel', exCancel)
      document.removeEventListener('keydown', exKey, true)
      try { if (d.el.hasPointerCapture?.(d.pid)) d.el.releasePointerCapture(d.pid) } catch { /* ignore */ }
      if (d.raf) cancelAnimationFrame(d.raf)
      if (d.ghost) d.ghost.remove()
      if (d.ind) d.ind.remove()
      if (d.hint) d.hint.remove()
      d.el.classList.remove('src'); d.el.removeAttribute('aria-grabbed')
      document.body.classList.remove('ex-dragging')
      for (const l of $$('.exlane.over, .exz.over')) l.classList.remove('over')
      exDrag = null
    }
    function exDown(ev: PointerEvent): void {
      if (ev.button !== 0) return
      const t = ev.target as HTMLElement
      const el = t.closest && t.closest('.exi') as HTMLElement | null
      if (!el) return
      if (t.closest('button')) return
      if (!el.closest('#exBody')) return
      if (t.closest('.v41sr')) return
      exDrag = { el, k: el.dataset.k as string, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), on: false, ghost: null, ind: null, hint: null, drop: null, raf: 0, lastX: ev.clientX, lastY: ev.clientY, dx: 0, dy: 0, gw: 0, gh: 44, from: 'un', geo: null, frames: 0, moves: 0, lagMax: 0, tMove: 0 }
      document.addEventListener('pointermove', exMove as unknown as EventListener, { passive: false })
      document.addEventListener('pointerup', exUp)
      document.addEventListener('pointercancel', exCancel)
      document.addEventListener('keydown', exKey, true)
    }
    /** 拖起时把每个分区 / 行 / 卡片的几何缓存一份（滚动后重算），pointermove 里不再碰布局。 */
    function exGeo(): void {
      const d = exDrag, body = $('#exBody')
      if (!d || !body) return
      const zones: ExGeoZone[] = $$('.exz', body).map((zel) => {
        const z = (zel as HTMLElement).dataset.zone as GanttZone
        const b = (zel.querySelector('.exz-b') ?? zel) as HTMLElement
        const shut = zel.classList.contains('shut')
        const items = shut ? [] : $$('.exi', b).filter((it) => it !== d.el).map((it) => ({ k: (it as HTMLElement).dataset.k as string, r: it.getBoundingClientRect() }))
        const lanes = z === 'done' || shut ? null : $$('.exlane', b).map((ln) => {
          const its = $$('.exi', ln).filter((it) => it !== d.el).map((it) => ({ k: (it as HTMLElement).dataset.k as string, r: it.getBoundingClientRect() }))
          const r = ln.getBoundingClientRect()
          return { el: ln as HTMLElement, r, items: its, top: its.length ? Math.min(...its.map((q) => q.r.top)) : r.top, bottom: its.length ? Math.max(...its.map((q) => q.r.bottom)) : r.bottom }
        })
        return { z, el: zel as HTMLElement, r: zel.getBoundingClientRect(), br: b.getBoundingClientRect(), items, lanes }
      })
      d.geo = { body: body.getBoundingClientRect(), st: body.scrollTop, zones }
    }
    function exStart(): void {
      const d = exDrag
      if (!d || d.on) return
      d.on = true
      bubHide()
      hvOff()                          /* 按下拖动时立即收回悬停按钮行，再量几何 */
      const r = d.el.getBoundingClientRect()
      try { d.el.setPointerCapture(d.pid) } catch { /* ignore */ }
      d.dx = d.x0 - r.left; d.dy = Math.min(d.y0 - r.top, 40)
      d.from = pZoneOf(pday(ymd(state.day)), d.k)
      d.ghost = d.el.cloneNode(true) as HTMLElement
      /* v149（2）：带子任务的任务卡 —— 浮卡保留原卡的布局类（v41grp / v40has），高度按内容；子任务小卡只读（勾选 → 小圆点，按钮在样式里藏掉），超过 3 个只画 3 个 +「还有 N 个子任务」 */
      d.ghost.className = 'exi exi-ghost v49g' + ['nock', 'norec', 'hasa', 'v41grp', 'v40has'].filter((k) => d.el.classList.contains(k)).map((k) => ' ' + k).join('')
      d.ghost.removeAttribute('data-k'); d.ghost.removeAttribute('tabindex')
      for (const b of d.ghost.querySelectorAll('[data-fk]')) b.removeAttribute('data-fk')
      for (const b of d.ghost.querySelectorAll('[tabindex]')) b.removeAttribute('tabindex')
      const gsubs = d.ghost.querySelector(':scope > .v41subs')
      if (gsubs) {
        const rows = [...gsubs.querySelectorAll<HTMLElement>(':scope > .v41sr')]
        for (const row of rows) { const ck = row.querySelector('.eck'); if (ck) { const i = document.createElement('i'); i.className = 'v49ck'; ck.replaceWith(i) } }
        if (rows.length > 3) { for (const row of rows.slice(3)) row.remove(); const m = document.createElement('span'); m.className = 'v49more'; m.textContent = '还有 ' + (rows.length - 3) + ' 个子任务'; gsubs.appendChild(m) }
      }
      d.ghost.setAttribute('data-zone', d.from)
      d.ghost.style.width = r.width + 'px'
      d.ghost.style.height = ''
      d.gw = r.width; d.gh = 44
      document.body.appendChild(d.ghost)
      if (gsubs) d.gh = d.ghost.offsetHeight || Math.round(r.height)
      d.el.classList.add('src')
      d.el.setAttribute('aria-grabbed', 'true')
      document.body.classList.add('ex-dragging')
      d.ind = document.createElement('div')
      d.ind.className = 'exdrop'
      d.ind.hidden = true
      $('#exBody')!.appendChild(d.ind)
      d.hint = document.createElement('div')
      d.hint.className = 'ex-drag-hint'
      d.hint.textContent = '松手：保持原位'
      document.body.appendChild(d.hint)
      exGeo()
      exPaint()
      d.raf = requestAnimationFrame(exTick)
    }
    function exMove(ev: PointerEvent): void {
      const d = exDrag
      if (!d) return
      d.lastX = ev.clientX; d.lastY = ev.clientY
      d.moves++; d.tMove = performance.now()
      if (!d.on) {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return
        exStart()
      }
      ev.preventDefault()
    }
    /** 每帧一次：浮卡 transform + 落点（只读缓存几何）+ 边缘自动滚。 */
    function exTick(): void {
      const d = exDrag
      if (!d || !d.on || !d.geo) return
      const body = $('#exBody') as HTMLElement
      const br = d.geo.body
      let dy = 0
      if (d.lastY < br.top + 26 && d.lastY > br.top - 40) dy = -Math.ceil((br.top + 26 - d.lastY) / 3)
      else if (d.lastY > br.bottom - 26 && d.lastY < br.bottom + 40) dy = Math.ceil((d.lastY - (br.bottom - 26)) / 3)
      if (dy) { const was = body.scrollTop; body.scrollTop += dy; if (body.scrollTop !== was) exGeo() }
      exPaint()
      d.frames++
      if (d.tMove) d.lagMax = Math.max(d.lagMax, performance.now() - d.tMove)
      d.raf = requestAnimationFrame(exTick)
    }
    function exPaint(): void {
      const d = exDrag
      if (!d || !d.ghost || !d.hint) return
      const x = Math.max(6, Math.min(innerWidth - d.gw - 6, d.lastX - d.dx))
      const y = Math.max(6, Math.min(innerHeight - d.gh - 6, d.lastY - d.dy))
      d.ghost.style.setProperty('--gt', 'translate3d(' + x + 'px,' + y + 'px,0) rotate(1.1deg) scale(1.012)')
      d.hint.style.transform = 'translate3d(' + (d.lastX + 14) + 'px,' + (d.lastY + 18) + 'px,0)'
      exDropAt(d.lastX, d.lastY)
    }
    function exDropAt(x: number, y: number): void {
      const d = exDrag, body = $('#exBody')
      if (!d || !body || !d.geo || !d.ind || !d.hint) return
      const G = d.geo
      const off = body.scrollTop - G.st
      const br = G.body
      const sh = (r: { left: number; right: number; width: number; height: number; top: number; bottom: number }) => ({ left: r.left, right: r.right, width: r.width, height: r.height, top: r.top - off, bottom: r.bottom - off })
      for (const zz of G.zones) zz.el.classList.remove('over')
      for (const l of $$('.exlane.over')) l.classList.remove('over')
      let Z: ExGeoZone | null = null, best = 1e9
      for (const zz of G.zones) {
        const r = sh(zz.r)
        const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        if (dist < best) { best = dist; Z = zz }
      }
      if (!Z || x < br.left - 60 || x > br.right + 60 || best > 60) { d.ind.hidden = true; d.drop = null; d.hint.textContent = '松手：放回原位'; return }
      Z.el.classList.add('over')
      const zt = EXZ_T[Z.z]
      const ind = d.ind
      const putV = (rx: number, top: number, h: number): void => { ind.className = 'exdrop v'; ind.hidden = false; ind.style.left = (rx - br.left) + 'px'; ind.style.top = (top - br.top + body.scrollTop - 1) + 'px'; ind.style.width = '3px'; ind.style.height = Math.max(16, h) + 'px' }
      const putH = (cy: number, l: number, w: number): void => { ind.className = 'exdrop h'; ind.hidden = false; ind.style.left = (l - br.left) + 'px'; ind.style.top = (cy - br.top + body.scrollTop - 1) + 'px'; ind.style.width = Math.max(20, w) + 'px'; ind.style.height = '3px' }
      const tag = d.from === Z.z ? '' : '（状态 → ' + EXZ_ST[Z.z] + '）'
      const zb = sh(Z.br)
      if (Z.lanes) {
        const lanes = Z.lanes.map((l) => ({ el: l.el, r: sh(l.r), items: l.items.map((q) => ({ k: q.k, r: sh(q.r) })), top: l.top - off, bottom: l.bottom - off }))
        const inside = lanes.find((l) => y >= l.top - 2 && y <= l.bottom + 2)
        if (inside) {
          let idx = 0
          for (const q of inside.items) if (x > q.r.left + q.r.width / 2) idx++
          const prev = inside.items[idx - 1], next = inside.items[idx]
          let ix = next ? next.r.left - 4 : prev ? prev.r.right + 4 : inside.r.left + 8
          ix = Math.min(Math.max(ix, inside.r.left + 2), inside.r.right - 5)
          putV(ix, inside.top, inside.bottom - inside.top + 2)
          inside.el.classList.add('over')
          d.drop = { z: Z.z, type: 'same', next: next ? next.k : null, prev: prev ? prev.k : null }
          const near = next ?? prev
          const nt = near ? ($('#exBody .exi[data-k="' + CSS.escape(near.k) + '"] .exi-t')?.textContent ?? '') : ''
          d.hint.textContent = '松手：' + zt + ' · ' + (near ? '和「' + nt + '」' + (Z.z === 'arr' ? '并行' : '并列') + '（同一行）' : '放在这一行') + tag
          return
        }
        let before = 0
        for (const l of lanes) if (y > l.top + (l.bottom - l.top) / 2) before++
        let cy: number
        if (!lanes.length) cy = zb.top + 12
        else if (before <= 0) cy = lanes[0].r.top - 3
        else if (before >= lanes.length) cy = lanes[lanes.length - 1].r.bottom + 3
        else cy = (lanes[before - 1].r.bottom + lanes[before].r.top) / 2
        putH(cy, zb.left + 4, zb.width - 8)
        const belowL = lanes[before], aboveL = lanes[before - 1]
        d.drop = { z: Z.z, type: 'new', below: belowL && belowL.items.length ? belowL.items[0].k : null, above: aboveL && aboveL.items.length ? aboveL.items[aboveL.items.length - 1].k : null }
        d.hint.textContent = '松手：' + zt + ' · 插入到第 ' + (before + 1) + ' 行（串行）' + tag
        return
      }
      /* 本日已执行 / 收着的分区：按记录时间排到最后（不在里面排位置） */
      const items = Z.items.map((q) => ({ k: q.k, r: sh(q.r) }))
      if (!items.length) putH(zb.top + Math.max(6, zb.height / 2), zb.left + 6, zb.width - 12)
      else { const last = items[items.length - 1]; putH(last.r.bottom + 3, zb.left + 4, zb.width - 8) }
      d.drop = { z: Z.z, type: 'list' }
      d.hint.textContent = Z.z === 'done' ? '松手：记录今天已执行（按记录时间排到最后）' + tag : '松手：放进「' + zt + '」' + tag
    }
    function exKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape' && exDrag) { ev.preventDefault(); ev.stopPropagation(); exCancel() }
    }
    function exCancel(): void {
      const d = exDrag
      exCleanup()
      if (d && d.on) { exLastDrag = Date.now(); toast('已取消拖动 · 位置和状态都没变') }
      if (PANEL_DEFER) renderPanel()
    }
    /** 放进某个分区 = 立即改成那个分区的状态（记录执行 / 暂停 / 执行中 / 默认），并按落点排顺序。 */
    function exApply(k: string, drop: ExDrop): boolean {
      const key = ymd(state.day), u = pday(key)
      const snap = (): string => JSON.stringify([u.lanes, u.zl, [...u.done], dayPst(key)])
      const before = snap()
      const f = pFind(k)
      const Z = drop.z
      if (Z === 'done' && futureDay()) { toast('未来的日子不能记录执行'); return false }
      const wasDone = u.done.has(k)
      if (Z !== 'done') { pLaneDrop(u, k); pZlDrop(u, k) }
      u.sel.add(k)
      if (Z === 'done') {
        if (!wasDone) { u.from.set(k, pZoneOf(u, k, key)); u.done.add(k); u.doneAt.set(k, Date.now()) }
        PST.delete(key + '\n' + k)
      } else {
        u.done.delete(k); u.doneAt.delete(k); u.from.delete(k)
        if (Z === 'pause' || Z === 'wait' || Z === 'run') PST.set(key + '\n' + k, Z)
        else PST.delete(key + '\n' + k)
        const rows = pRowsOf(u, Z)
        /* 显示出来但还没进行表的卡（新排进来的）先按显示顺序补进行表，落点才算得准 */
        for (const el of $$<HTMLElement>('#exBody .exz[data-zone="' + Z + '"] .exlane')) {
          const ks = $$('.exi', el).map((x) => (x as HTMLElement).dataset.k as string).filter((x) => x !== k)
          if (el.dataset.ln === '-1' && ks.length) rows.push(ks)
        }
        const rowOf = (x: string | null): number => { if (!x) return -1; for (let i = 0; i < rows.length; i++) if (rows[i].includes(x)) return i; return -1 }
        if (drop.type === 'same') {
          let ti = rowOf(drop.next); if (ti < 0) ti = rowOf(drop.prev)
          if (ti < 0) rows.push([k])
          else { const lane = rows[ti]; let idx = drop.next ? lane.indexOf(drop.next) : -1; if (idx < 0) idx = drop.prev ? lane.indexOf(drop.prev) + 1 : lane.length; lane.splice(Math.max(0, Math.min(idx, lane.length)), 0, k) }
        } else if (drop.type === 'new') {
          let at = rowOf(drop.below)
          if (at < 0) { const ja = rowOf(drop.above); at = ja >= 0 ? ja + 1 : rows.length }
          rows.splice(Math.max(0, Math.min(at, rows.length)), 0, [k])
        } else rows.push([k])
        const clean = rows.filter((l) => l.length)
        if (Z === 'arr') u.lanes = clean; else u.zl[Z as ZlKey] = clean
      }
      if (wasDone !== u.done.has(k) && f) pSyncActual(f.c, u, key)
      const changed = snap() !== before
      if (changed) { savePanel(key, panelPatch(key, u)); pPulse([k]) }
      return changed
    }
    function exUp(): void {
      const d = exDrag
      if (!d) return
      if (!d.on) { exCleanup(); if (PANEL_DEFER) renderPanel(); return }
      exLastDrag = Date.now()
      const drop = d.drop, k = d.k, from = d.from
      root.dataset.exlast = JSON.stringify({ frames: d.frames, moves: d.moves, lagMax: Math.round(d.lagMax), held: Math.round(performance.now() - d.t0) })
      exCleanup()
      let ok = false
      if (drop) ok = exApply(k, drop)
      renderPanel()
      if (ok) {
        const f = pFind(k)
        const t = f ? pTitleOf(f) : '这一项'
        toast(drop!.z === from ? '已调整「' + t + '」在「' + EXZ_T[drop!.z] + '」里的位置' : '已把「' + t + '」移到「' + EXZ_T[drop!.z] + '」· 状态 = ' + EXZ_ST[drop!.z])
      }
    }
    /* v106 ①：键盘也能换行（Alt+↑ / Alt+↓），焦点在任务项上时生效（在它所在分区的行里移动） */
    function exKeyMove(k: string, dir: -1 | 1): void {
      const key = ymd(state.day), u = pday(key)
      const z = pZoneOf(u, k, key)
      if (z === 'done') { toast('本日已执行按记录时间排，不能换行'); return }
      const rows = pRowsOf(u, z).map((l) => l.slice())
      let i = rows.findIndex((l) => l.includes(k))
      if (i < 0) { rows.push([k]); i = rows.length - 1 }
      const j = i + dir
      if (j < 0 || j > rows.length - 1) { toast(dir < 0 ? '已经在第一行了' : '已经在最后一行了'); return }
      rows[i].splice(rows[i].indexOf(k), 1)
      rows[j].push(k)
      const clean = rows.filter((l) => l.length)
      if (z === 'arr') u.lanes = clean; else u.zl[z as ZlKey] = clean
      savePanel(key, panelPatch(key, u))
      const f = pFind(k)
      render()
      toast('已把「' + (f ? pTitleOf(f) : '这一项') + '」移到「' + EXZ_T[z] + '」第 ' + (clean.findIndex((l) => l.includes(k)) + 1) + ' 行')
    }

    /* ── v125 悬停立即向下展开（只保证标题完整）+ v126 不需要就不展开 ──
       · 收起 44px；悬停卡片所在的一整行立即展开，离开 120ms 后收回（卡片之间的缝里移动不闪）
       · 每张卡按自己的宽度判断：宽排（标题区 − 按钮宽 ≥ 120px）按钮在右上角；窄排按钮竖排在「记录执行」下面、标题移到勾选下面
       · 层级路径只占一行：悬停的那张放不下时循环跑马灯；整行展开到最高那张需要的高度 → 上下对齐 */
    function xpPathMq(c: HTMLElement, on: boolean): void {
      const sp = c.querySelector('.exi-s') as HTMLElement | null, m = sp?.querySelector('.mq-s') as HTMLElement | null
      if (!sp || !m) return
      sp.classList.remove('mqs'); sp.style.removeProperty('--mqx'); sp.style.removeProperty('--mqd')
      if (!on) return
      const over = m.getBoundingClientRect().width - sp.clientWidth
      if (over > 4) { sp.style.setProperty('--mqx', (-over - 12) + 'px'); sp.style.setProperty('--mqd', Math.max(2.4, Math.round((over / 40 + 1.4) * 10) / 10) + 's'); sp.classList.add('mqs') }
    }
    /* v127（3）去掉悬停向下展开，卡片高度固定；v130（1）进卡那一刻按真实尺寸算一次：
       标题全文 + 按钮自然宽（每个 24px、间距 4px）+ 10px 放得进「标题左端 → 记录执行左端」= 同一行；否则只这张卡向下长出一行（90ms），按钮等分 */
    const HV: { el: HTMLElement | null; key: string } = { el: null, key: '' }
    /* v147（1）+ v148（1）：悬停不展开、不变高 —— 按钮放到第二行小字的位置（靠左），小字淡出、按钮淡入；
       第二行常态就是 30px 高（style.css），按钮 24px 在这一行里垂直居中。按小字这一行的实际位置写 --v47x/y/w（按钮绝对定位） */
    function hvOff(): void { const x = HV.el; HV.el = null; HV.key = ''; if (x) { x.classList.remove('v9tight', 'v47h'); xpPathMq(x, false) } }
    function hvOn(x: HTMLElement): void {
      if (HV.el === x) return
      hvOff()
      if (exDrag && exDrag.on) return
      HV.el = x; HV.key = x.dataset.k ?? ''
      const acts = x.querySelector(':scope > .exslot .exacts'), s = x.querySelector('.exi-s')
      if (!acts || !acts.children.length || !s) { xpPathMq(x, true); return }
      const r = x.getBoundingClientRect(), b = s.getBoundingClientRect()
      if (!b.width) { xpPathMq(x, true); return }
      x.style.setProperty('--v47x', Math.round(b.left - r.left - x.clientLeft) + 'px')
      x.style.setProperty('--v47y', Math.round(b.top - r.top - x.clientTop + b.height / 2 - 12) + 'px')
      x.style.setProperty('--v47w', Math.round(b.width) + 'px')
      x.classList.add('v47h')
    }

    /* ── v126（1.1）：悬停详情 = 白底对话气泡（代替浏览器原生 title 那个深色小框）──
       卡片下边框正下方 9px 立即弹出，尖角居中指向卡片；下方放不下翻到上方；左右贴边整体平移、尖角仍对准卡片中线；
       卡片展开变高时气泡跟着下边框走（ResizeObserver）；按下 / 拖动 / 滚动 / 离开卡片区立即消失；pointer-events:none 不挡点击。 */
    const BUB: { el: HTMLElement | null; card: HTMLElement | null } = { el: null, card: null }
    /* v133 R4：气泡定位要读布局 —— 合到下一帧量一次，别在 pointerover / 点击里强制整页布局（4x CPU 曾占 289ms） */
    let bubRaf = 0
    const bubSoon = (): void => { if (!bubRaf) bubRaf = requestAnimationFrame(() => { bubRaf = 0; bubPlace() }) }
    const bubRO = new ResizeObserver(() => bubSoon())
    self.offs.push(() => { bubRO.disconnect(); if (bubRaf) cancelAnimationFrame(bubRaf); BUB.el?.remove() })
    /* v133：气泡节点只建一次，收起 = 内联 display:none —— 按下时增删节点会触发页面里 :has() 规则失效，整页 4000+ 节点重算样式 */
    function bubHide(): void { bubRO.disconnect(); if (bubRaf) { cancelAnimationFrame(bubRaf); bubRaf = 0 } if (BUB.el) BUB.el.style.display = 'none'; BUB.card = null }
    function bubPlace(): void {
      const el = BUB.el, card = BUB.card
      if (!el || !card) return
      if (!card.isConnected) { bubHide(); return }
      const r = card.getBoundingClientRect(), W = el.offsetWidth, H = el.offsetHeight, gap = 9
      const cx = r.left + r.width / 2
      const left = Math.round(Math.max(8, Math.min(innerWidth - W - 8, cx - W / 2)))
      let top = Math.round(r.top - gap - H), up = true          /* v130（1）：上方居中，贴顶放不下才翻到下方 */
      if (top < 8) { top = Math.round(r.bottom + gap); up = false }
      el.style.left = left + 'px'; el.style.top = top + 'px'
      el.classList.toggle('up', up)
      el.style.setProperty('--ax', Math.round(Math.max(14, Math.min(W - 14, cx - left))) + 'px')
      el.style.visibility = ''
    }
    function bubShow(card: HTMLElement): void {
      if (BUB.card === card && BUB.el) { bubSoon(); return }
      bubHide()
      const f = pFind(card.dataset.k ?? '')
      if (!f) return
      const title = pTitleOf(f)
      const crumb = f.level === 'p' ? f.g.name : f.level === 't' ? f.g.name + ' › ' + f.c.t : f.g.name + ' › ' + f.c.t + ' › ' + (f.it?.t.text ?? '')
      const zone = (card.closest('.exz') as HTMLElement | null)?.dataset.zone ?? ''
      const el = BUB.el ?? document.createElement('div')
      if (!BUB.el) { el.className = 'exbub'; el.setAttribute('role', 'tooltip'); bodyAppend(el) }
      el.style.display = ''
      const bk = ymd(state.day), bu = pday(bk)
      const subs = f.level === 't' && f.it ? subOrder(f.it.t.subs.filter((x) => subToday(x, f.c.id, bu, bk))) : []
      const sbx = subs.length ? '<div class="v41bs"><div class="v41bsh">子任务 <b>' + subs.filter((x) => x.done).length + '/' + subs.length + '</b></div>' + subs.map((x) => '<div class="v41bsr' + (x.done ? ' done' : '') + '"><i aria-hidden="true"></i><span>' + esc(x.text) + '</span>' + (x.sess ? chipHtml(x.sess) : '') + '</div>').join('') + '</div>' : ''
      el.innerHTML = '<div class="bt"><span class="bl">' + (f.level === 'p' ? '项目' : f.level === 't' ? '任务' : '子任务') + '</span>' + esc(title) + '</div>'
        + '<div class="bp">' + esc(crumb) + '</div>' + sbx
        + '<div class="bf"><span class="bz" data-z="' + esc(zone) + '">' + esc(EXZ_T[zone] ?? '') + '</span><span>点击打开卡片详情 · 按住拖动 · Alt+↑/↓ 换行</span></div>'
      BUB.el = el; BUB.card = card
      el.style.visibility = 'hidden'
      bubRO.observe(card)
      bubSoon()
    }
    /* ── 变更：乐观更新本地模型 + POST；服务端回包后按最新数据重画 ── */
    function recalcActual(c: CardM): void {
      const s = new Set<string>()
      for (const k of c.actualAuto) if (!c.autoOff.has(k)) s.add(k)
      for (const k of c.actualManual) s.add(k)
      c.actualSet = s
      pActualAdd(c)
    }
    /** v128（1）：实际条 = 会话自动 ∪ 手动 ∪「这天执行安排里这张卡有已执行项」—— 每次都从执行记录推出来，撤销执行就消失。 */
    function pActualAdd(c: CardM): void { for (const [k, u] of PDAY) if (u.done.size && pCardDone(c, u)) c.actualSet.add(k) }
    /** 手动改执行：勾上 / 取消都先把这天从「会话自动」交还给用户（与 host 的 setActualDay 同规则）。 */
    function setActual(c: CardM, key: string, value: boolean): void {
      c.autoOff.add(key)
      if (value) c.actualManual.add(key); else c.actualManual.delete(key)
      recalcActual(c)
      post('actual', { card: c.id, day: key, on: value })
    }
    function setPlan(c: CardM, key: string, value: boolean): void {
      if (value) c.planSet.add(key); else c.planSet.delete(key)
      post('plan-set', { card: c.id, days: [...c.planSet] })
    }
    function savePlan(c: CardM): void { post('plan-set', { card: c.id, days: [...c.planSet] }) }
    /* v99 截止时间：同一天可多个、分硬性 / 软性；增删改都按 id（本地先乐观更新，服务端快照回来再对齐）。 */
    const newDdlId = (): string => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    function addDdl(c: CardM, at: string, kind: 'hard' | 'soft', label: string): DdlM {
      /* v101：带了重复规则就按规则展开（本地先出一条旗子，服务端快照再把 id / sid 对齐） */
      const rep = repNew.unit === 'none' ? undefined : { unit: repNew.unit, n: 1, ...(repNew.until ? { until: repNew.until } : {}) }
      const made: DdlM[] = []
      if (!rep) {
        const it: DdlM = { id: newDdlId(), at, kind, ...(label ? { label } : {}), ms: dayMs(at) }
        made.push(it)
      } else {
        const sid = 'local' + Date.now().toString(36)
        const limit = ymd(TODAY + 400 * D)
        let cur = at
        for (let i = 0; i < 120; i++) {
          if (rep.until && cur > rep.until) break
          if (cur > limit) break
          made.push({ id: newDdlId(), at: cur, kind, ...(label ? { label } : {}), ms: dayMs(cur), sid, rep })
          const nx = repStepAt(cur, rep.unit, 1)
          if (nx === cur) break
          cur = nx
        }
      }
      c.ddlList = c.ddlList.concat(made).sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))
      for (const it of made) { DDL_FRESH.add(it.id); setTimeout(() => DDL_FRESH.delete(it.id), 700) }
      post('ddl', { card: c.id, day: at, kind, label, ...(rep ? { rep } : {}) })
      setTimeout(() => void self.load(true), 350)
      resetRep()
      return made[0]
    }
    function editDdl(c: CardM, id: string, patch: { at?: string; kind?: 'hard' | 'soft'; label?: string }): void {
      const it = c.ddlList.find((d) => d.id === id)
      if (!it) return
      if (patch.at !== undefined) { it.at = patch.at; it.ms = dayMs(patch.at) }
      if (patch.kind !== undefined) it.kind = patch.kind
      if (patch.label !== undefined) { if (patch.label) it.label = patch.label; else delete it.label }
      c.ddlList.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))
      post('ddl-edit', { card: c.id, id, ...patch })
    }
    function delDdl(c: CardM, id: string, scope: 'one' | 'after' | 'all' = 'one'): number {
      const it = c.ddlList.find((d) => d.id === id)
      const before = c.ddlList.length
      if (it && it.sid && scope !== 'one') {
        c.ddlList = scope === 'after' ? c.ddlList.filter((d) => !(d.sid === it.sid && d.at >= it.at)) : c.ddlList.filter((d) => d.sid !== it.sid)
      } else c.ddlList = c.ddlList.filter((d) => d.id !== id)
      /* 客户端手里可能还是本地乐观 id（服务端快照还没回来）：把日期 / 备注 / 类型一起发过去，host 按它们找回真正那条 */
      post('ddl-del', { card: c.id, id, ...(it ? { at: it.at, label: it.label ?? '', kind: ddlKind(it) } : {}), ...(scope !== 'one' ? { scope } : {}) })
      setTimeout(() => void self.load(true), 350)
      return before - c.ddlList.length
    }
    function moveDdl(c: CardM, id: string, to: string): void {
      const it = c.ddlList.find((d) => d.id === id)
      if (!it) return
      it.at = to; it.ms = dayMs(to)
      c.ddlList.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))
      post('ddl-move', { card: c.id, id, to })
    }

    /* ── v101 截止重复：加截止时的规则（每天 / 每周 / 每月 + 直到）+ 三选删除 ──────────
       规则只作用在「新加的那一条」上；已有条目靠 sid 认系列，删除时问范围。 */
    type RepUnit = 'none' | 'day' | 'week' | 'month'
    let repNew: { unit: RepUnit; until: string } = { unit: 'none', until: '' }
    const resetRep = (): void => { repNew = { unit: 'none', until: '' } }
    /** v101：系列文案（「每周，直到 2026-11-30」）—— 与原型 repText 同一口径。 */
    const repTextOf = (rep?: { unit: 'day' | 'week' | 'month'; n: number; until?: string }): string => {
      if (!rep) return '重复'
      const n = rep.n || 1
      const u = rep.unit === 'day' ? '天' : rep.unit === 'week' ? '周' : '月'
      return (n > 1 ? '每 ' + n + ' ' + u : '每' + u) + (rep.until ? '，直到 ' + rep.until : '，永不停止')
    }
    const repNote = (): string => {
      if (repNew.unit === 'none') return '只加这一条'
      const u = repNew.unit === 'day' ? '每天' : repNew.unit === 'week' ? '每周' : '每月'
      return u + (repNew.until ? '，直到 ' + repNew.until : '，永不停止')
    }
    function repRowHtml(): string {
      repBind()
      const on = (k: RepUnit): string => ' class="' + (repNew.unit === k ? 'on' : '') + '" aria-pressed="' + (repNew.unit === k ? 'true' : 'false') + '"'
      return '<div class="reprow"><span class="k">重复</span><span class="repseg" role="group" aria-label="截止时间的重复规则">'
        + '<button type="button" data-rep="none"' + on('none') + '>不重复</button>'
        + '<button type="button" data-rep="day"' + on('day') + '>每天</button>'
        + '<button type="button" data-rep="week"' + on('week') + '>每周</button>'
        + '<button type="button" data-rep="month"' + on('month') + '>每月</button>'
        + '</span><label class="repuntil">直到<input type="date" data-rep-until value="' + esc(repNew.until) + '" aria-label="重复截止到哪一天（留空 = 永不停止）" title="留空 = 永不停止"></label>'
        + '<span class="k rep-note">' + repNote() + '</span></div>'
    }
    let repBound = false
    /** 重复控件用委托（浮层每次重画都会换 DOM，绑在 document 上一次就够）。 */
    function repBind(): void {
      if (repBound) return
      repBound = true
      document.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest?.('[data-rep]') as HTMLElement | null
        if (!b) return
        e.preventDefault()
        repNew.unit = (b.getAttribute('data-rep') as RepUnit) || 'none'
        const row = b.closest('.reprow')
        if (row) for (const x of row.querySelectorAll('[data-rep]')) { const hit = (x as HTMLElement).getAttribute('data-rep') === repNew.unit; x.classList.toggle('on', hit); x.setAttribute('aria-pressed', String(hit)) }
        const note = row?.querySelector('.rep-note')
        if (note) note.textContent = repNote()
      })
      document.addEventListener('change', (e) => {
        const i = (e.target as HTMLElement).closest?.('[data-rep-until]') as HTMLInputElement | null
        if (!i) return
        repNew.until = i.value || ''
        const note = i.closest('.reprow')?.querySelector('.rep-note')
        if (note) note.textContent = repNote()
      })
    }
    /** 客户端也按规则展开（乐观更新：旗子立刻出现），服务端快照回来再对齐）。 */
    function repStepAt(key: string, unit: 'day' | 'week' | 'month', n = 1): string {
      const [y, m, d] = key.split('-').map(Number)
      if (unit === 'day') return ymd(new Date(y, m - 1, d + n).getTime())
      if (unit === 'week') return ymd(new Date(y, m - 1, d + 7 * n).getTime())
      const total = (m - 1) + n
      const ny = y + Math.floor(total / 12)
      const nm = (total % 12 + 12) % 12
      const last = new Date(ny, nm + 1, 0).getDate()
      return ymd(new Date(ny, nm, Math.min(d, last)).getTime())
    }
    /** 删除三选一：这条有 sid（属于重复系列）就先问范围，否则直接删。 */
    function askDelScope(c: CardM, host: HTMLElement, id: string, after: () => void): void {
      /* 刚加的条目在服务端快照回来之前还是本地乐观 id：按「同一天 + 同备注」把它找回，避免点了没反应 */
      let it = c.ddlList.find((d) => d.id === id)
      let rid = id
      if (!it) {
        const row = host.querySelector('[data-did="' + id + '"]') as HTMLElement | null
        const lab = (row?.querySelector('[data-label]') as HTMLInputElement | null)?.value ?? ''
        const cand = c.ddlList.find((d) => !!d.sid && (d.label ?? '') === lab)
        if (cand) { it = cand; rid = cand.id }
      }
      if (!it || !it.sid) { delDdl(c, rid); after(); toast('已删除这个截止时间'); return }
      closeScope()
      const box = document.createElement('div')
      box.className = 'delscope'
      box.style.position = 'fixed'
      box.style.zIndex = '70'
      box.innerHTML = '<div class="hd">这条是重复截止（' + esc((it.rep ? (it.rep.unit === 'day' ? '每天' : it.rep.unit === 'week' ? '每周' : '每月') + (it.rep.until ? '，直到 ' + it.rep.until : '，永不停止') : '重复')) + '）</div>'
        + '<button type="button" data-scope="one">只删 ' + esc(it.at) + ' 这条</button>'
        + '<button type="button" data-scope="after">删这条及以后（含 ' + esc(it.at) + '）</button>'
        + '<button type="button" data-scope="all">删整个系列（含所有重复）</button>'
        + '<button type="button" data-scope="cancel">取消</button>'
      /* 菜单挂 body：日格小窗 / 旗子弹层会被服务端快照整块重画，挂在里面会被一起抹掉 */
      self.bodyAppend(box)
      scopeEl = box
      /* 贴在浮层左侧展开（不盖住列表本身）；左边放不下就翻到右边，再不行上下夹进视口 */
      const hr = host.getBoundingClientRect()
      const bw = box.offsetWidth || 210, bh = box.offsetHeight || 130
      let bx = hr.left - bw - 8
      let by = hr.top + 8
      if (bx < 8) bx = hr.right + 8
      if (bx + bw > window.innerWidth - 8) bx = Math.max(8, window.innerWidth - bw - 8)
      if (by + bh > window.innerHeight - 8) by = Math.max(46, window.innerHeight - bh - 8)
      box.style.left = Math.round(bx) + 'px'
      box.style.top = Math.round(by) + 'px'
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-scope]') as HTMLElement | null
        if (!b) return
        const sc = b.getAttribute('data-scope') as 'one' | 'after' | 'all' | 'cancel'
        closeScope()
        if (sc === 'cancel') return
        const n = delDdl(c, rid, sc)
        after()
        toast(sc === 'one' ? '只删了 ' + it.at + ' 这一条（系列里其它的还在）' : sc === 'after' ? '已删这条及以后 ' + n + ' 条' : '已删整个系列 ' + n + ' 条')
      })
    }

    /* ── 浮层：日菜单 / DDL 面板 / 红旗小窗 ── */
    /** v101 三选删除菜单：挂 body（浮层在快照回来时会被整块重画，挂里面会被抹掉）。 */
    let scopeEl: HTMLElement | null = null
    function closeScope(): void {
      if (!scopeEl) return
      scopeEl.remove(); self.overlays.delete(scopeEl); scopeEl = null
    }
    function closeMenu(): void {
      closeScope()
      if (menu) { menu.remove(); self.overlays.delete(menu); menu = null }
      menuDraw = null; menuTarget = null; dayAnchor = null
      if (followRaf) { cancelAnimationFrame(followRaf); followRaf = 0 }
      if (fxEl) { fxEl.remove(); self.overlays.delete(fxEl); fxEl = null }
      popAnchor = null
    }
    /** v101：旗子弹层的锚点选择器（render 会换掉旗子节点，所以存选择器、每帧重查）。 */
    let popAnchor: string | null = null
    function anchorEl(): HTMLElement | null { return popAnchor ? (document.querySelector(popAnchor) as HTMLElement | null) : null }
    function placeAnchor(el: HTMLElement, a: HTMLElement | null): boolean {
      if (!a) return false
      const r = a.getBoundingClientRect()
      if (!r.width && !r.height) return false
      el.style.left = '0px'; el.style.top = '0px'
      const e = el.getBoundingClientRect()
      let x = r.left + r.width / 2 - e.width / 2
      let y = r.bottom + 8
      if (y + e.height > window.innerHeight - 8) y = r.top - e.height - 8
      const sc = $('#scroll')
      const box = sc ? sc.getBoundingClientRect() : null
      if (box) { x = Math.max(box.left + 8, Math.min(box.right - e.width - 8, x)); y = Math.max(box.top + 8, Math.min(box.bottom - e.height - 8, y)) }
      x = Math.max(8, Math.min(window.innerWidth - e.width - 8, x))
      y = Math.max(46, Math.min(window.innerHeight - e.height - 8, y))
      el.style.left = Math.round(x) + 'px'
      el.style.top = Math.round(y) + 'px'
      return true
    }
    function place(el: HTMLElement, x: number, y: number): void {
      /* v101：浮层多了「重复」那一行会变高 —— 先按内容量高，再按剩下的视口高度兜住，内部滚动，别把底部按钮顶出屏幕 */
      el.style.maxHeight = ''
      el.style.left = '0px'; el.style.top = '0px'
      const r = el.getBoundingClientRect()
      const top = Math.max(46, Math.min(window.innerHeight - r.height - 8, y + 8))
      el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - 10)) + 'px'
      el.style.top = Math.round(top) + 'px'
      const avail = window.innerHeight - top - 8
      if (r.height > avail) el.style.maxHeight = Math.max(160, Math.round(avail)) + 'px'
    }
    function hideHl(): void { if (hlEl) hlEl.hidden = true; hlKey = '' }
    function moveHl(track: HTMLElement, day: number): void {
      if (menuTarget || drag || flagDrag) return hideHl()
      if (!(state.zoom === 'day' || state.zoom === 'week')) return hideHl()
      const key = (track.dataset.card as string) + '|' + day
      if (key === hlKey) return
      hlKey = key
      if (!hlEl) { hlEl = document.createElement('i'); hlEl.className = 'cellhl'; bodyAppend(hlEl) }
      const r = track.getBoundingClientRect()
      hlEl.style.left = (r.left + at(day)) + 'px'
      hlEl.style.top = (r.top + 2) + 'px'
      hlEl.style.width = Math.max(2, at(day + D) - at(day)) + 'px'
      hlEl.style.height = (r.height - 4) + 'px'
      hlEl.hidden = false
    }
    /* v98 ①：显示 / 隐藏项目组时间的开关 —— 文案 / aria-pressed / 图标 / #rows 的 class 都跟着状态走 */
    function syncGtime(): void {
      const b = $('#scGtime') as HTMLButtonElement | null
      if (!b) return
      b.setAttribute('aria-pressed', String(!!state.gtime))
      const lb = b.querySelector('.gt-lb')
      if (lb) lb.textContent = state.gtime ? '隐藏项目组时间' : '显示项目组时间'
      const rows = $('#rows')
      if (rows) rows.classList.toggle('gtime-off', !state.gtime)
      b.title = state.gtime
        ? '一键隐藏所有项目组的时间（计划条 / 实际条 / 截止标记）—— 选择会记住'
        : '一键显示所有项目组的时间（计划条 / 实际条 / 截止标记）—— 选择会记住'
    }
    /* v98 ③：格子设置小窗跟着格子走 —— 锚在「这张卡片的这一行 + 这一天那一格」，
       横向 / 纵向滚动、窗口缩放、换粒度、面板开关、明细变化都按当前 DOM 重算位置（rAF 同一帧跟，不闪）；
       格子被滚出可视区时贴到甘特图可视区边上停住（不突然消失 —— 正在写的截止备注不会丢）。 */
    function anchorXY(a: { card: string; day: number; fx: number; fy: number }): { x: number; y: number } | null {
      const tr = $('.sc-track[data-card="' + CSS.escape(a.card) + '"]')
      if (!tr) return null
      const row = (tr.closest('.sc-row') ?? tr) as HTMLElement
      const rr = row.getBoundingClientRect()
      let cx: number | null = null
      if (fxEl) { const fr = fxEl.getBoundingClientRect(); cx = fr.left + fr.width / 2 }
      if (cx == null) {
        for (const b of $$('.sc-cell[data-ds]', $('#headT')!)) {
          if (a.day >= Number(b.dataset.ds) && a.day < Number(b.dataset.de)) { const br = b.getBoundingClientRect(); cx = br.left + br.width / 2; break }
        }
      }
      if (cx == null) cx = rr.left + rr.width / 2
      return { x: cx, y: rr.bottom + 6 }
    }
    function placeDay(el: HTMLElement, a: { card: string; day: number; fx: number; fy: number }): void {
      const xy = anchorXY(a) ?? { x: a.fx, y: a.fy }
      place(el, xy.x, xy.y)
      const sc = $('#scroll')
      if (!sc) return
      for (let k = 0; k < 2; k++) {
        const sr = sc.getBoundingClientRect(), r = el.getBoundingClientRect()
        el.style.left = Math.round(Math.max(sr.left + 8, Math.min(sr.right - r.width - 8, r.left))) + 'px'
        el.style.top = Math.round(Math.max(sr.top + 8, Math.min(sr.bottom - r.height - 8, r.top))) + 'px'
      }
    }
    function followDay(): void {
      followRaf = 0
      if (!menu) return
      if (menu.classList.contains('flagpop')) { placeAnchor(menu, anchorEl()); return }
      if (!menu.classList.contains('daypop') || !dayAnchor) return
      placeDay(menu, dayAnchor)
    }
    function followSoon(): void { if ((!dayAnchor && !popAnchor) || followRaf) return; followRaf = requestAnimationFrame(followDay) }
    on($('#scroll') as HTMLElement, 'scroll', followSoon, { passive: true })
    on(window, 'resize', followSoon)

    function paintFx(): void {
      if (fxEl) { fxEl.remove(); self.overlays.delete(fxEl); fxEl = null }
      if (!menuTarget) return
      hideHl()
      const card = menuTarget.card, day = menuTarget.day
      const win = st2.win as { start: number; end: number }
      if (day < win.start || day >= win.end) return
      const track = $('.sc-track[data-card="' + card + '"]') as HTMLElement | null
      if (!track) return
      const el = document.createElement('i')
      el.className = 'cellfx'
      el.style.left = at(day) + 'px'
      el.style.width = Math.max(3, at(day + D) - at(day)) + 'px'
      el.innerHTML = '<b></b><b></b><b></b><b></b>'
      track.append(el)
      fxEl = el
      self.overlays.add(el)
    }
    function clearCv(): void {
      if (cvCell) cvCell.classList.remove('cv')
      if (cvName) cvName.classList.remove('cv')
      cvCell = cvName = null
    }
    function setCv(day: number, row: Element | null): void {
      let cell: Element | null = null
      for (const b of $$('.sc-cell[data-ds]', $('#headT')!)) {
        if (day >= Number(b.dataset.ds) && day < Number(b.dataset.de)) { cell = b; break }
      }
      const nm = row ? row.querySelector('.sc-name') : null
      if (cell !== cvCell) { if (cvCell) cvCell.classList.remove('cv'); cvCell = cell; if (cell) cell.classList.add('cv') }
      if (nm !== cvName) { if (cvName) cvName.classList.remove('cv'); cvName = nm; if (nm) nm.classList.add('cv') }
    }
    /** 目录里文字放不下时，悬停走循环跑马灯（移开恢复省略号；与原型 v80 一致）。 */
    function mqStop(nm: Element | null): void {
      const el = nm as HTMLElement | null
      if (!el || !el.dataset.mqOn) return
      delete el.dataset.mqOn
      el.style.textOverflow = ''
      el.textContent = el.dataset.mqTxt || el.title || ''
      if (mqEl === el) mqEl = null
    }
    function mqStart(nm: Element | null): void {
      const el = nm as HTMLElement | null
      if (!el || el.dataset.mqOn) return
      if (el.scrollWidth <= el.clientWidth + 1) return
      const txt = el.textContent || ''
      el.dataset.mqOn = '1'; el.dataset.mqTxt = txt
      el.style.textOverflow = 'clip'
      el.innerHTML = '<span class="nm-tr"><span class="nm-t"></span><span class="nm-t" aria-hidden="true"></span></span>'
      const ts = el.querySelectorAll('.nm-t')
      ts[0].textContent = txt; ts[1].textContent = txt
      const tr = el.querySelector('.nm-tr') as HTMLElement
      const w = ts[0].getBoundingClientRect().width
      tr.style.setProperty('--mqx', '-' + (w + 28) + 'px')
      tr.style.setProperty('--mqd', Math.max(3, (w + 28) / 45) + 's')
      mqEl = el
      requestAnimationFrame(() => tr.classList.add('mq'))
    }

    /** 格子小窗（v99）：截止时间 = 列表（每条可切换硬性 / 软性、改备注、删除）+ 下面「再加一个」。 */
    function openDayMenu(c: CardM, day: number, x: number, y: number): void {
      closeMenu()
      menuTarget = { card: c.id, day }
      dayAnchor = { card: c.id, day, fx: x, fy: y }
      paintFx()
      const key = ymd(day)
      resetRep()
      const el = document.createElement('div')
      el.className = 'dmenu daypop'
      const has = (): boolean => c.actualSet.has(key)
      const autoOn = (): boolean => c.actualAuto.has(key) && !c.autoOff.has(key)
      const planned = (): boolean => c.planSet.has(key)
      const ddlHere = (): DdlM[] => c.ddlList.filter((d) => (d.at || ymd(d.ms)) === key).sort((a, b) => Number(ddlKind(a) === 'soft') - Number(ddlKind(b) === 'soft') || a.id.localeCompare(b.id))
      let newKind: 'hard' | 'soft' = 'hard'
      let newNote = ''
      /** 重画前先记住正在编辑的备注（否则一条还没失焦就被下一帧抹掉） */
      const keep = new Map<string, string>()
      const draw = (): void => {
        const cur = el.querySelector('#dNewNote') as HTMLInputElement | null
        if (cur) newNote = cur.value
        for (const i of el.querySelectorAll('[data-label]')) keep.set((i as HTMLElement).dataset.label as string, (i as HTMLInputElement).value)
        const list = ddlHere()
        const hardN = list.filter((d) => ddlKind(d) === 'hard').length, softN = list.length - hardN
        const rows = list.map((d) => {
          const k = ddlKind(d)
          return '<div class="dditem' + (d.task ? ' tk' : '') + '" data-did="' + esc(d.id) + '">'
            + (d.task ? '<span class="kbtn tk" title="来自任务的截止（硬性）：在卡片详情或任务弹窗里改，拖动旗子也会改任务">' + FLAG + '任务</span>' : '<button type="button" class="kbtn ' + k + '" data-flip="' + esc(d.id) + '" title="点一下切换硬性 / 软性">' + FLAG + (k === 'soft' ? '软性' : '硬性') + '</button>')
            + '<input class="ddlnote" data-label="' + esc(d.id) + '" placeholder="备注（可空）" aria-label="截止时间备注" value="' + esc(keep.get(d.id) ?? d.label ?? '') + '"' + (d.task ? ' readonly title="任务名（改任务名请在卡片详情里改）"' : '') + '>'
            + (d.sid ? '<b class="rq" title="' + esc('重复：' + repTextOf(d.rep)) + '">' + RQ_SVG + '</b>' : '')
            + '<button type="button" class="ib xs" data-ddel="' + esc(d.id) + '" aria-label="删除这个截止时间" title="删除这个截止时间"><svg class="i sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>'
        }).join('')
        el.innerHTML = '<div class="dh">' + longDate(day) + '<span>' + esc(c.t) + '</span></div>' +
          '<button type="button" data-act="plan" class="' + (planned() ? 'on' : '') + '">' +
          '<svg class="i sm" viewBox="0 0 24 24">' + (planned() ? '<path d="m5 12 5 5 9-10"/>' : '<path d="M4 7h16M4 12h10M4 17h7"/>') + '</svg>' +
          (planned() ? '取消此日计划' : '计划此日执行') + '<span class="st">' + (planned() ? '这天不显示计划条' : '这天显示计划条（计划条只认手动）') + '</span></button>' +
          '<button type="button" data-act="actual" class="' + (has() ? 'on' : '') + (day > TODAY ? ' dis' : '') + '"' + (day > TODAY ? ' disabled' : '') + '>' +
          '<svg class="i sm" viewBox="0 0 24 24">' + (has() ? '<path d="m5 12 5 5 9-10"/>' : '<rect x="4" y="4" width="16" height="16" rx="4"/>') + '</svg>' +
          (has() ? '取消此日记录' : '记录此日执行') + '<span class="st">' + (day > TODAY ? '未来日期' : (has() ? (autoOn() ? '来自会话 · 取消后不再自动' : '手动记录') : (c.autoOff.has(key) ? '这天的会话自动已关闭' : '未记录'))) + '</span></button>' +
          '<div class="ddlsec"><div class="ddlh"><span class="flag">' + FLAG + '</span>截止时间<span class="n">' + (list.length ? list.length + ' 个 · 硬 ' + hardN + ' / 软 ' + softN : '还没设') + '</span></div>' +
          (list.length ? '<div class="ddlist">' + rows + '</div>' : '') +
          '<div class="ddadd"><input class="ddlnote" id="dNewNote" placeholder="' + (list.length ? '再加一个的备注（可空）' : '备注（可空，如：客户要求这天交）') + '" aria-label="新截止时间的备注" value="' + esc(newNote) + '"></div>' +
          '<div class="ddadd2"><button type="button" class="kbtn hard' + (newKind === 'hard' ? ' on' : '') + '" data-kind="hard" aria-pressed="' + (newKind === 'hard') + '">' + FLAG + '硬性</button>' +
          '<button type="button" class="kbtn soft' + (newKind === 'soft' ? ' on' : '') + '" data-kind="soft" aria-pressed="' + (newKind === 'soft') + '">' + FLAG + '软性</button>' +
          '<span class="grow"></span><button type="button" class="btn sm primary" data-dadd>添加截止</button></div>' +
          repRowHtml() +
          (list.length ? '' : '<p class="ddtip">硬性 = 外部严格的截止（红旗 + 红虚线）；软性 = 内部计划（蓝旗 + 蓝虚线，与实际时间条同色）。同一天可以加多个。</p>') +
          '</div>' +
          '<div class="dnote">三项互相独立：计划条 / 实际条 / 截止时间谁都不影响谁；这里只改这一天。</div>' +
          '<div class="dsrc">' + (day > TODAY ? '未来的日子只能计划，不能记录执行。' : (autoOn() ? '这天的执行来自会话记录。在这里手动一次（勾上或取消）后，这天的「会话自动」就关掉，之后只按手动结果画。' : '实际条来自会话记录或手动补记；这天已经被手动改过，所以会话自动不再生效。')) + '</div>'
        placeDay(el, dayAnchor as { card: string; day: number; fx: number; fy: number })
      }
      bodyAppend(el)
      menu = el
      menuDraw = draw
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        const kb = t.closest('[data-kind]') as HTMLElement | null
        if (kb) {
          newKind = kb.dataset.kind === 'soft' ? 'soft' : 'hard'
          for (const b of el.querySelectorAll('[data-kind]')) { b.classList.toggle('on', (b as HTMLElement).dataset.kind === newKind); b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.kind === newKind)) }
          ;(el.querySelector('#dNewNote') as HTMLInputElement | null)?.focus()
          return
        }
        const flip = t.closest('[data-flip]') as HTMLElement | null
        if (flip) {
          const d = c.ddlList.find((x2) => x2.id === flip.dataset.flip)
          if (!d) return
          const next: 'hard' | 'soft' = ddlKind(d) === 'soft' ? 'hard' : 'soft'
          editDdl(c, d.id, { kind: next })
          render(); draw()
          toast('已改成' + (next === 'soft' ? '软性截止（蓝旗 / 蓝虚线）' : '硬性截止（红旗 / 红虚线）'))
          return
        }
        const del = t.closest('[data-ddel]') as HTMLElement | null
        if (del) { askDelScope(c, el, del.dataset.ddel as string, () => { render(); draw() }); return }
        const add = t.closest('[data-dadd]')
        if (add) {
          const inp = el.querySelector('#dNewNote') as HTMLInputElement | null
          const label = (inp?.value ?? newNote).trim()
          addDdl(c, key, newKind, label)
          newNote = ''
          render(); draw()
          ;(el.querySelector('#dNewNote') as HTMLInputElement | null)?.focus()
          toast('已加' + (newKind === 'soft' ? '软性' : '硬性') + '截止时间 ' + key + (label ? '（' + label + '）' : '') + '—— 同一天可以继续加')
          return
        }
        const act = t.closest('[data-act]') as HTMLElement | null
        if (!act) return
        if (act.dataset.act === 'actual') {
          if (day > TODAY) { toast('未来的日期不能记录执行'); return }
          const wasAuto = autoOn()
          if (c.actualSet.has(key)) { setActual(c, key, false); toast(wasAuto ? '已取消 ' + key + '（这天的会话自动已关闭）' : '已取消 ' + key + ' 的执行记录') }
          else { setActual(c, key, true); toast('已记录 ' + key + ' 执行（手动）') }
        } else if (act.dataset.act === 'plan') {
          if (c.planSet.has(key)) { setPlan(c, key, false); toast('已取消 ' + key + ' 的计划（这天不再显示计划条）') }
          else { setPlan(c, key, true); toast('已手动设置「' + c.t + '」在 ' + key + ' 的计划（这天显示计划条）') }
        }
        state.day = day
        render(); draw()
      })
      el.addEventListener('change', (e) => {
        const inp = (e.target as HTMLElement).closest('[data-label]') as HTMLInputElement | null
        if (!inp) return
        const d = c.ddlList.find((x2) => x2.id === inp.dataset.label)
        if (!d) return
        const v = inp.value.trim()
        if (v === (d.label ?? '')) return
        keep.delete(d.id)
        editDdl(c, d.id, { label: v })
        render()
        toast(v ? '备注已保存：' + v : '已清空备注')
      })
      draw()
    }

    /** 行右侧旗帜按钮（v99）：这张卡片全部截止时间的管理面板（硬性 / 软性、同一天可多个）。 */
    function openDdl(c: CardM, x: number, y: number): void {
      closeMenu()
      resetRep()
      const el = document.createElement('div')
      el.className = 'dmenu ddlpop'
      let newKind: 'hard' | 'soft' = 'hard'
      const draw = (): void => {
        for (const i of el.querySelectorAll('[data-label]')) keepL.set((i as HTMLElement).dataset.label as string, (i as HTMLInputElement).value)
        const dv0 = (el.querySelector('#dNew') as HTMLInputElement | null)?.value
        const dl0 = (el.querySelector('#dLabel') as HTMLInputElement | null)?.value
        const rows = c.ddlList.slice().sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id)).map((d) => '<div class="drow" data-did="' + esc(d.id) + '">'
          + '<span class="kchip ' + (d.task ? 'tk' : ddlKind(d)) + '"' + (d.task ? ' title="来自任务的截止：在卡片详情或任务弹窗里改，拖动旗子也会改任务"' : '') + '>' + FLAG + (d.task ? '任务' : ddlKind(d) === 'soft' ? '软性' : '硬性') + '</span>'
          + '<span class="dt">' + md(d.ms) + '</span><span class="dl">' + esc(d.label || '截止时间') + (d.sid ? ' · ' + esc(repTextOf(d.rep)) : '') + '</span>' + (d.sid ? '<b class="rq" title="' + esc('重复：' + repTextOf(d.rep)) + '">' + RQ_SVG + '</b>' : '')
          + '<button type="button" class="ib xs" data-del="' + esc(d.id) + '" aria-label="删除这个截止时间"><svg class="i sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>').join('')
        el.innerHTML = '<div class="dh">截止时间<span>' + esc(c.t) + '</span></div>' +
          (rows || '<div class="dempty">还没有截止时间。</div>') +
          '<div class="dadd"><input type="date" id="dNew" value="' + (dv0 || ymd(TODAY + 7 * D)) + '">' +
          '<span class="seg2"><button type="button" data-nk="hard" class="' + (newKind === 'hard' ? 'on hard' : '') + '">硬性</button><button type="button" data-nk="soft" class="' + (newKind === 'soft' ? 'on soft' : '') + '">软性</button></span>' +
          '<input type="text" id="dLabel" placeholder="备注（可空）" value="' + esc(dl0 ?? '') + '"><button class="btn sm primary" type="button" data-add>添加</button></div>' +
           repRowHtml() +
          '<div class="dnote">硬性 = 外部严格截止（红旗）；软性 = 内部计划（蓝旗，与实际时间条同色）。同一天可以加多个，只做标记：既不影响计划条，也不影响实际条。</div>'
        if (el.isConnected) place(el, x, y)
      }
      draw()
      bodyAppend(el)
      /* 必须挂到 DOM 之后再量尺寸 / 夹进视口：detached 时 rect 全是 0，夹紧会失效（浮层会跑出右边） */
      place(el, x, y)
      menu = el
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        const nk = t.closest('[data-nk]') as HTMLElement | null
        if (nk) { newKind = nk.dataset.nk === 'soft' ? 'soft' : 'hard'; draw(); return }
        const del = t.closest('[data-del]') as HTMLElement | null
        if (del) { const id = del.dataset.del as string; keepL.delete(id); askDelScope(c, el, id, () => { draw(); render() }); return }
        if (t.closest('[data-add]')) {
          const v = (el.querySelector('#dNew') as HTMLInputElement).value
          if (!v) return
          const label = (el.querySelector('#dLabel') as HTMLInputElement).value.trim()
          addDdl(c, v, newKind, label)
          draw(); render(); toast('已添加' + (newKind === 'soft' ? '软性' : '硬性') + '截止时间 ' + v + (label ? '（' + label + '）' : ''))
        }
      })
    }
    const keepL = new Map<string, string>()

    /** 点时间轴上的旗子 / 成对旗（v99）：这一天的全部截止时间（改类型 / 改备注 / 删除 / 再加一个）。 */
    /** v101：旗子元素 → 选择器（成对旗按 data-day，单旗按 data-did）。 */
    function flagSel(fl: HTMLElement, cardId: string): string {
      const did = fl.getAttribute('data-did')
      if (did) return '[data-flag="' + cardId + '"][data-did="' + did + '"]'
      const day = fl.getAttribute('data-day')
      if (day) return '[data-flag="' + cardId + '"][data-day="' + day + '"]'
      return '[data-flag="' + cardId + '"]'
    }
    /** v101 ⑦：旗子弹层挂在旗子上（原型 placeNear 同口径）——有锚点就居中贴住，拿不到锚点才退回点击位置。 */
    function placeFlag(el: HTMLElement, x: number, y: number): void {
      if (!placeAnchor(el, anchorEl())) place(el, x, y)
    }
    function openFlag(c: CardM, day: number, x: number, y: number, anchorSel?: string): void {
      closeMenu()
      popAnchor = anchorSel ?? null
      resetRep()
      const el = document.createElement('div')
      el.className = 'flagpop'
      let newKind: 'hard' | 'soft' = 'hard'
      let newNote = ''
      const draw = (): void => {
        const cur = el.querySelector('#fNewNote') as HTMLInputElement | null
        if (cur) newNote = cur.value
        for (const i of el.querySelectorAll('[data-label]')) keepF.set((i as HTMLElement).dataset.label as string, (i as HTMLInputElement).value)
        const list = c.ddlList.filter((d) => (d.at || ymd(d.ms)) === ymd(day)).slice().sort((a, b) => Number(ddlKind(a) === 'soft') - Number(ddlKind(b) === 'soft') || a.id.localeCompare(b.id))
        const hardN = list.filter((d) => ddlKind(d) === 'hard').length, softN = list.length - hardN
        const rows = list.map((d) => '<div class="fitem2' + (d.task ? ' tk' : '') + '" data-did="' + esc(d.id) + '">'
          + (d.task ? '<span class="kbtn tk" title="来自任务的截止（硬性）">' + FLAG + '任务</span>' : '<button type="button" class="kbtn ' + ddlKind(d) + '" data-flip="' + esc(d.id) + '" title="点一下切换硬性 / 软性">' + FLAG + (ddlKind(d) === 'soft' ? '软性' : '硬性') + '</button>')
          + '<input class="flabel" data-label="' + esc(d.id) + '" placeholder="备注（可空）" aria-label="截止时间备注" value="' + esc(keepF.get(d.id) ?? d.label ?? '') + '"' + (d.task ? ' readonly title="任务名（改任务名请在卡片详情里改）"' : '') + '>'
          + '<button type="button" class="ib xs" data-fdel="' + esc(d.id) + '" aria-label="删除这个截止时间" title="删除这个截止时间"><svg class="i sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>').join('')
        el.innerHTML = '<div class="fh">' + FLAG + '<b>' + md(day) + '</b><span>' + DAYS[new Date(day).getDay()] + ' · ' + list.length + ' 个截止</span></div>' +
          '<div class="fday">' + esc(c.t) + '</div>' +
          '<div class="flist2">' + rows + '</div>' +
          '<div class="fadd2"><span class="seg"><button type="button" data-kind="hard" class="' + (newKind === 'hard' ? 'on hard' : '') + '">硬性</button><button type="button" data-kind="soft" class="' + (newKind === 'soft' ? 'on soft' : '') + '">软性</button></span>' +
          '<input class="flabel" id="fNewNote" placeholder="再加一个的备注（可空）" aria-label="新截止时间的备注" value="' + esc(newNote) + '"></div>' +
          '<div class="fadd3"><span class="grow"></span><button class="btn sm primary" type="button" data-fadd>添加截止</button></div>' +
          repRowHtml() +
          '<p class="fnote">硬性 = 外部严格截止（红旗 + 红虚线）；软性 = 内部计划（蓝旗 + 蓝虚线）。同一天可以加多个；单个截止可以直接拖着改日期，多个请点开列表改。</p>'
        if (el.isConnected) placeFlag(el, x, y)
      }
      draw()
      bodyAppend(el)
      /* 必须挂到 DOM 之后再量尺寸 / 夹进视口：detached 时 rect 全是 0，夹紧会失效（浮层会跑出右边） */
      placeFlag(el, x, y)
      menu = el
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        const kb = t.closest('[data-kind]') as HTMLElement | null
        if (kb) {
          newKind = kb.dataset.kind === 'soft' ? 'soft' : 'hard'
          for (const b of el.querySelectorAll('[data-kind]')) b.classList.toggle('on', (b as HTMLElement).dataset.kind === newKind)
          ;(el.querySelector('#fNewNote') as HTMLInputElement | null)?.focus()
          return
        }
        const flip = t.closest('[data-flip]') as HTMLElement | null
        if (flip) {
          const d = c.ddlList.find((x2) => x2.id === flip.dataset.flip)
          if (!d) return
          const next: 'hard' | 'soft' = ddlKind(d) === 'soft' ? 'hard' : 'soft'
          editDdl(c, d.id, { kind: next })
          render(); draw()
          toast('已改成' + (next === 'soft' ? '软性截止（蓝旗 / 蓝虚线）' : '硬性截止（红旗 / 红虚线）'))
          return
        }
        const del = t.closest('[data-fdel]') as HTMLElement | null
        if (del) { const id = del.dataset.fdel as string; keepF.delete(id); askDelScope(c, el, id, () => { render(); draw() }); return }
        if (t.closest('[data-fadd]')) {
          const inp = el.querySelector('#fNewNote') as HTMLInputElement | null
          const label = (inp?.value ?? newNote).trim()
          addDdl(c, ymd(day), newKind, label)
          newNote = ''
          render(); draw()
          toast('已加' + (newKind === 'soft' ? '软性' : '硬性') + '截止 ' + ymd(day) + (label ? '（' + label + '）' : ''))
        }
      })
      el.addEventListener('change', (e) => {
        const inp = (e.target as HTMLElement).closest('[data-label]') as HTMLInputElement | null
        if (!inp) return
        const d = c.ddlList.find((x2) => x2.id === inp.dataset.label)
        if (!d) return
        const v = inp.value.trim()
        if (v === (d.label ?? '')) return
        keepF.delete(d.id)
        editDdl(c, d.id, { label: v })
        render()
        toast(v ? '备注已保存：' + v : '已清空备注')
      })
    }
    const keepF = new Map<string, string>()


    /* ── 计划条把手拖动 ── */
    function applyEdge(day: number): void {
      if (!drag) return
      const c = drag.c
      c.planSet = new Set(drag.plan)
      if (drag.edge === 'l') {
        let ns = Math.min(day, drag.re - D)
        if (ns !== day && !drag.warned) { drag.warned = true; toast('左手把不能越过右手把（' + md(drag.re - D) + '）；要缩短就拖右端') }
        if (ns < drag.rs) { for (let t = ns; t < drag.rs; t += D) c.planSet.add(ymd(t)) }
        else if (ns > drag.rs) { for (let t = drag.rs; t < ns; t += D) c.planSet.delete(ymd(t)) }
        drag.day = ns
      } else {
        let ne = day + D
        if (ne <= drag.rs) {
          ne = drag.rs + D
          if (!drag.warned) { drag.warned = true; toast('右手把不能越过左手把（' + md(drag.rs) + '）；要缩短就拖左端') }
        }
        if (ne > drag.re) { for (let t = drag.re; t < ne; t += D) c.planSet.add(ymd(t)) }
        else if (ne < drag.re) { for (let t = ne; t < drag.re; t += D) c.planSet.delete(ymd(t)) }
        drag.day = ne - D
      }
    }
    function onDragStart(e: PointerEvent): void {
      const t = e.target as HTMLElement
      const h = t.closest('[data-grab]') as HTMLElement | null
      const band = t.closest('[data-move]') as HTMLElement | null
      if (!h && !band) return
      e.preventDefault()
      if (h) {
        const c = findCard(h.dataset.grab as string); if (!c) return
        drag = { c, edge: h.dataset.edge as 'l' | 'r', rs: Number(h.dataset.rs), re: Number(h.dataset.re), x0: e.clientX, moved: false, day: null, plan: new Set(c.planSet) }
        h.setPointerCapture?.(e.pointerId)
        document.body.style.cursor = 'ew-resize'
      } else {
        const el = band as HTMLElement
        const c = findCard(el.dataset.move as string); if (!c) return
        drag = { c, edge: 'm', rs: Number(el.dataset.rs), re: Number(el.dataset.re), x0: e.clientX, moved: false, day: null, plan: new Set(c.planSet), delta: 0 }
        el.setPointerCapture?.(e.pointerId)
        el.classList.add('dragging')
        document.body.style.cursor = 'grabbing'
      }
    }
    function dragDay(e: PointerEvent): number {
      if (!drag) return 0
      if (drag.edge === 'm') return Math.round((e.clientX - drag.x0) / Math.max(1, at(drag.rs + D) - at(drag.rs)))
      const edgeX = at(drag.edge === 'l' ? drag.rs : drag.re)
      return dayAt(edgeX + (e.clientX - drag.x0))
    }
    /** 整段计划按 delta 天平移（保留段形状；只写 planSet，落盘在松手时一次）。 */
    function shiftPlan(delta: number): void {
      if (!drag) return
      const c = drag.c
      c.planSet = new Set([...drag.plan].map((d) => ymd(dayMs(d) + delta * D)))
      drag.delta = delta
      drag.day = drag.rs + delta * D
    }
    function showDragTip(ms: number, x: number, y: number, edge: string): void {
      let t = (overlayRoot.querySelector('#dtip') as HTMLElement | null) as HTMLElement | null
      if (!t) { t = document.createElement('div'); t.id = 'dtip'; t.className = 'dtip'; bodyAppend(t) }
      t.textContent = edge === 'm' ? '计划整体 · ' + ymd(ms) : (edge === 'l' ? '开始 ' : '结束 ') + ymd(ms); t.hidden = false
      t.style.left = (x + 14) + 'px'; t.style.top = (y + 12) + 'px'
    }
    function hideDragTip(): void { const t = (overlayRoot.querySelector('#dtip') as HTMLElement | null) as HTMLElement | null; if (t) t.hidden = true }
    function onDragMove(e: PointerEvent): void {
      if (!drag) return
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return
      drag.moved = true
      if (drag.edge === 'm') {
        const delta = dragDay(e)
        shiftPlan(delta)
        render()
        if (delta) showDragTip(drag.rs + delta * D, e.clientX, e.clientY, 'm')
        else hideDragTip()
      } else {
        applyEdge(dragDay(e))
        render()
        showDragTip(drag.day as number, e.clientX, e.clientY, drag.edge)
      }
    }
    function onDragEnd(): void {
      if (!drag) return
      const d = drag; drag = null
      document.body.style.cursor = ''
      document.querySelectorAll('.pband.dragging').forEach((n) => n.classList.remove('dragging'))
      hideDragTip()
      if (!d.moved) return
      render()
      if (d.edge === 'm') {
        const delta = d.delta ?? 0
        if (!delta) { toast('计划条没有移动'); return }
        savePlan(d.c)
        toast('计划整体' + (delta > 0 ? '后移 ' : '前移 ') + Math.abs(delta) + ' 天：' + ymd(d.rs + delta * D) + ' → ' + ymd(d.re - D + delta * D))
        return
      }
      savePlan(d.c)
      if (d.warned) toast(d.edge === 'l' ? '左手把不能越过右手把：计划开始停在 ' + ymd(d.day as number) : '右手把不能越过左手把：计划结束停在 ' + ymd(d.day as number))
      else toast((d.edge === 'l' ? '计划开始 = ' : '计划结束 = ') + ymd(d.day as number))
    }

    /* ── 截止红旗拖动 ── */
    function setTip(text: string, x: number, y: number): void {
      let t = (overlayRoot.querySelector('#dtip') as HTMLElement | null) as HTMLElement | null
      if (!t) { t = document.createElement('div'); t.id = 'dtip'; t.className = 'dtip'; bodyAppend(t) }
      t.textContent = text; t.hidden = false
      t.style.left = (x + 14) + 'px'; t.style.top = (y + 12) + 'px'
    }
    function flagGuide(track: Element): HTMLElement {
      let g = $('#flagguide') as HTMLElement | null
      if (!g) { g = document.createElement('i'); g.id = 'flagguide'; g.className = 'flagguide' }
      if (g.parentNode !== track) track.append(g)
      return g
    }
    function hideFlagGuide(): void { const g = $('#flagguide'); if (g) g.remove() }
    function endFlagDrag(commit: boolean): void {
      if (!flagDrag) return
      const d = flagDrag; flagDrag = null
      d.fl.classList.remove('dragging')
      document.body.classList.remove('flag-dragging')
      hideFlagGuide(); hideDragTip(); clearCv()
      if (!d.moved) return
      flagClickMute = true
      setTimeout(() => { flagClickMute = false }, 280)
      if (commit && d.ms != null && d.ms !== d.ms0) {
        moveDdl(d.c, d.dd.id, ymd(d.ms))
        render()
        toast('截止时间 = ' + ymd(d.ms))
      } else render()
    }

    on(document, 'pointerdown', (e) => {
      const ev = e as PointerEvent
      if (ev.button != null && ev.button !== 0) return
      const fl = (ev.target as HTMLElement).closest('[data-flag]') as HTMLElement | null
      if (!fl) return
      /* v99：同一天多个截止（成对旗）不参与拖动 —— 拖错哪一条说不清，点开列表改 */
      if (fl.dataset.day) return
      const c = findCard(fl.dataset.flag as string)
      const dd = c?.ddlList.find((x) => x.id === fl.dataset.did)
      if (!c || !dd) return
      ev.preventDefault()
      closeMenu()
      flagDrag = { fl, c, dd, ms0: dd.ms, x0: ev.clientX, w: Math.max(1, at(dd.ms + D) - at(dd.ms)), moved: false }
      fl.classList.add('dragging')
      document.body.classList.add('flag-dragging')
    }, true)
    on(document, 'pointermove', (e) => {
      const ev = e as PointerEvent
      if (drag) { onDragMove(ev); return }
      if (flagDrag) {
        const dx = ev.clientX - flagDrag.x0
        if (!flagDrag.moved && Math.abs(dx) < 3) return
        flagDrag.moved = true
        const raw = flagDrag.ms0 + Math.round(dx / flagDrag.w) * D
        const win = st2.win as { start: number; end: number }
        const ms = Math.min(win.end - D, Math.max(win.start, raw))
        flagDrag.ms = ms
        const cx = at(ms) + Math.max(2, at(ms + D) - at(ms)) / 2
        flagDrag.fl.style.left = cx + 'px'
        flagGuide(flagDrag.fl.parentNode as Element).style.left = at(ms) + 'px'
        setCv(ms, flagDrag.fl.closest('.sc-row'))
        setTip('截止 ' + ymd(ms) + (ms === TODAY ? ' · 今天' : '') + (raw !== ms ? ' · 到边界了' : ''), ev.clientX, ev.clientY)
        return
      }
      /* 悬停高亮 */
      const track = (ev.target as HTMLElement).closest?.('.sc-track[data-card]') as HTMLElement | null
      if (!track) { hideHl(); clearCv(); return }
      const day = dayAt(ev.clientX - track.getBoundingClientRect().left)
      moveHl(track, day)
      setCv(day, track.closest('.sc-row'))
    })
    on(document, 'pointerup', () => { onDragEnd(); endFlagDrag(true) })
    on(document, 'pointercancel', () => { onDragEnd(); endFlagDrag(false) })
    on(document, 'pointerleave', () => { hideHl(); clearCv() })
    // v86：横向续期——离边界还有 1.5 屏就补 3 屏（静默；左补锚定 scrollLeft，右补保持不动）
    let extending = false
    let extLeft = -1
    const extend = (): void => {
      const sc = $('#scroll') as HTMLElement
      if (!sc || extending || !st2.win) return
      /* v133 R4：只有横向滚动才可能逼近左右边界；竖向滚（点执行卡后的平滑定位）不再触发整页重画（4x CPU 曾占 203ms） */
      const left = sc.scrollLeft
      if (left === extLeft) return
      extLeft = left
      const ahead = sc.clientWidth * 1.5
      const right = sc.scrollWidth - sc.clientWidth - sc.scrollLeft
      /* v133 R4：两头都要补时一次补完（左补不改右侧余量）—— 首次进日程页从两遍整页重画变成一遍 */
      const dl = left < ahead && state.padB < 10, dr = right < ahead && state.padF < 10
      if (!dl && !dr) return
      const oldStart = st2.win.start, oldLeft = sc.scrollLeft
      if (dl) state.padB += 3
      if (dr) state.padF += 3
      extending = true
      render()
      if (dl) sc.scrollLeft = oldLeft + Math.max(0, at(oldStart))
      extLeft = sc.scrollLeft
      extending = false
    }
    on($('#scroll') as HTMLElement, 'scroll', () => { hideHl(); clearCv(); extend() }, { passive: true })
    on(document, 'pointerover', (e) => {
      const row = (e.target as HTMLElement).closest?.('.sc-row')
      if (row) mqStart(row.querySelector('.sc-name .nm'))
    })
    on(document, 'pointerout', (e) => {
      const ev = e as PointerEvent
      const row = (ev.target as HTMLElement).closest?.('.sc-row')
      if (!row) return
      if (row.contains(ev.relatedTarget as Node | null)) return
      mqStop(row.querySelector('.sc-name .nm'))
    })
    on(document, 'pointerdown', onDragStart as EventListener, true)

    /* ── 点击：粒度 / 红旗 / 截止列表 / 项目名 / 折叠 ── */
    on(document, 'click', (e) => {
      const me = e as MouseEvent
      const t = me.target as HTMLElement
      const z = t.closest('[data-z]') as HTMLElement | null
      if (z && inR(z)) { if (z.dataset.z !== 'day') { zTip(z, true); return } setZoom(z.dataset.z as string); return }
      const fl = t.closest('[data-flag]') as HTMLElement | null
      if (fl && inR(fl)) {
        if (flagClickMute) { flagClickMute = false; return }
        const c = findCard(fl.dataset.flag as string)
        const day = fl.dataset.day ? dayMs(fl.dataset.day) : c?.ddlList.find((x) => x.id === fl.dataset.did)?.ms
        if (c && day != null) { const r = fl.getBoundingClientRect(); openFlag(c, day, r.left, r.bottom, flagSel(fl, c.id)) }
        return
      }
      const dl = t.closest('[data-ddl]') as HTMLElement | null
      if (dl && inR(dl)) {
        const c = findCard(dl.dataset.ddl as string)
        if (c) { const r = dl.getBoundingClientRect(); openDdl(c, me.clientX || r.left, me.clientY || r.bottom) }
        return
      }
      const nm = t.closest('.sc-name .nm') as HTMLElement | null
      if (nm && inR(nm)) {
        const row = nm.closest('.sc-row') as HTMLElement | null
        if (row && row.dataset.c) {
          const c = findCard(row.dataset.c)
          if (c) { state.sel = c.id; render(); host.openCard(c.id); void wsHighlight(c.id, 'p') }
          return
        }
      }
      // v86：整个「项目组」目录格子都是按钮（不只小三角 / 名字）
      const gcell = t.closest('.sc-name[data-toggle]') as HTMLElement | null
      if (gcell && inR(gcell)) { toggleGroup(gcell.dataset.toggle as string); return }
      // v86：整个「项目」目录格子也都是按钮（不只标题文字）
      const icell = t.closest('.sc-name[data-open-card-cell]') as HTMLElement | null
      if (icell && inR(icell)) {
        const id = icell.dataset.openCardCell as string
        const c = findCard(id)
        /* v147（2）：点项目目录格 = 照旧开详情 + 工作区里这个项目关联的会话行定位高光（项目 = 卡片 + 任务 + 子任务的会话） */
        if (c) { state.sel = c.id; render(); host.openCard(c.id); void wsHighlight(c.id, 'p') }
        return
      }
      const row = t.closest('.sc-row') as HTMLElement | null
      if (row && inR(row) && row.dataset.g && !row.dataset.c && t.closest('.sc-name')) toggleGroup(row.dataset.g)
    })
    on(document, 'pointerdown', (e) => {
      const t = e.target as Node
      if (scopeEl && !scopeEl.contains(t) && !(t as HTMLElement).closest?.('[data-ddel],[data-fdel],[data-del]')) closeScope()
      if (menu && !menu.contains(t) && !(scopeEl && scopeEl.contains(t)) && !(t as HTMLElement).closest?.('[data-ddl]') && !(t as HTMLElement).closest?.('[data-flag]') && !(t as HTMLElement).closest?.('.sc-name .nm')) closeMenu()
    })
    on(document, 'dblclick', (e) => {
      const t = e.target as HTMLElement
      const track = t.closest('.sc-track[data-card]') as HTMLElement | null
      if (!track || !inR(track)) return
      if (!(state.zoom === 'day' || state.zoom === 'week')) { toast('放大到「日 / 周」才能逐日设置'); return }
      const c = findCard(track.dataset.card as string); if (!c) return
      if (t.closest('[data-grab]')) return
      const me = e as MouseEvent
      me.preventDefault()
      const r = track.getBoundingClientRect()
      openDayMenu(c, dayAt(me.clientX - r.left), me.clientX, r.bottom + 6)
    })
    on(document, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      const t = ev.target as HTMLElement
      /* v113（1.4）：只挡 input/textarea 不够 —— 任务说明是 contenteditable，弹窗开着时下面的面板也在收键；
         在说明里打「1」…「4」会把展示维度切走、「t」会跳今天（用户报的「维度自己跳」）。 */
      const typing = !!t && ((t.matches && t.matches('input, select, textarea')) || !!(t.closest && t.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')))
      if (typing || document.querySelector('dialog[open]')) return
      if (ev.key === 'Escape') { closeScope(); closeMenu(); return }
      // v86：项目组目录格子是 role=button，回车 / 空格也要能展开收起
      const gc = t.closest?.('.sc-name[data-toggle]') as HTMLElement | null
      if (gc && ev.key === 'Enter') { ev.preventDefault(); toggleGroup(gc.dataset.toggle as string); return }
      if (gc && ev.key === ' ') { ev.preventDefault(); toggleGroup(gc.dataset.toggle as string); return }
      const ic = t.closest?.('.sc-name[data-open-card-cell]') as HTMLElement | null
      if (ic && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault()
        const c = findCard(ic.dataset.openCardCell as string)
        if (c) { state.sel = c.id; render(); host.openCard(c.id) }
        return
      }
      if (ev.key === 't' || ev.key === 'T') { state.anchor = TODAY; render(); return }
      /* v140（4）：周 / 月 / 季度暂不开放 —— 2 3 4 = 气泡晃一下，视图不变 */
      if (/^[1-4]$/.test(ev.key)) { const zz = ['day', 'week', 'month', 'quarter'][Number(ev.key) - 1]; if (zz === 'day') setZoom(zz); else { const b = $('.seg [data-z="' + zz + '"]'); if (b) zTip(b, true) } }
    })
    on(document, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      const h = (ev.target as HTMLElement).closest?.('[data-grab]') as HTMLElement | null
      if (h && inR(h) && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        const c = findCard(h.dataset.grab as string); if (!c) return
        ev.preventDefault()
        const rs = Number(h.dataset.rs), re = Number(h.dataset.re), edge = h.dataset.edge as 'l' | 'r'
        const base = edge === 'l' ? rs : re - D
        drag = { c, edge, rs, re, x0: 0, moved: true, day: null, plan: new Set(c.planSet) }
        applyEdge(base + (ev.key === 'ArrowLeft' ? -D : D))
        const nd = drag.day as number; drag = null
        render(); savePlan(c)
        toast((edge === 'l' ? '计划开始 = ' : '计划结束 = ') + ymd(nd))
        return
      }
      const fl = (ev.target as HTMLElement).closest?.('[data-flag]') as HTMLElement | null
      if (!fl || !inR(fl)) return
      const c = findCard(fl.dataset.flag as string)
      const multi = !!fl.dataset.day
      const dd = c?.ddlList.find((x) => x.id === fl.dataset.did)
      if (!c || (!multi && !dd)) return
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        const day = multi ? dayMs(fl.dataset.day as string) : (dd as DdlM).ms
        const r = fl.getBoundingClientRect(); openFlag(c, day, r.left, r.bottom, flagSel(fl, c.id))
        return
      }
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
      ev.preventDefault()
      if (multi) { toast('同一天有多个截止，点一下在列表里改（不参与整体拖动）'); return }
      const win = st2.win as { start: number; end: number }
      const d0 = dd as DdlM
      const ms = Math.max(win.start, Math.min(win.end - D, d0.ms + (ev.key === 'ArrowLeft' ? -D : D)))
      if (ms === d0.ms) { toast('已经到窗口边界了'); return }
      moveDdl(c, d0.id, ymd(ms))
      render()
      const nf = $('[data-flag="' + c.id + '"][data-did="' + CSS.escape(d0.id) + '"]') as HTMLElement | null
      nf?.focus()
      toast('截止时间 = ' + ymd(ms))
    })
    function toggleGroup(id: string): void {
      // v86 修：原来写反了（展开时 delete，等于点不动）→ 现在真的是「有就删、没有就加」
      const open = !state.closed.has(id)
      if (open) state.closed.add(id); else state.closed.delete(id)
      const g = GROUPS.find((x) => x.id === id)
      if (g) g.collapsed = open
      // v87：写回值 = 本地新状态（v86 这里多取反了一次，导致点 A 组把 B 组弹开）；
      // 在途值由 applyData 覆盖轮询快照，POST 完成后再交给服务端；失败回滚 + 点名提示。
      const seq = ++self.gseq
      self.pendingClosed.set(id, { v: open, seq })
      render()
      void postBoard('group/update', { id, collapsed: open }).then(() => {
        const p = self.pendingClosed.get(id)
        if (p && p.seq === seq) p.done = true
      }).catch((e) => {
        const p = self.pendingClosed.get(id)
        if (!p || p.seq !== seq) return
        self.pendingClosed.delete(id)
        if (open) state.closed.delete(id); else state.closed.add(id)
        const gg = GROUPS.find((x) => x.id === id)
        if (gg) gg.collapsed = !open
        render()
        toast('折叠状态没保存：' + (e instanceof Error ? e.message : String(e)), 'err')
      })
    }
    /* v140（4）：周 / 月 / 季度按钮照常显示但不可点（灰 + 禁止光标 + aria-disabled）；悬停 / 聚焦立即出气泡「内容升级中，尽请期待」 */
    let zTipEl: HTMLElement | null = null
    function zTipOff(): void { zTipEl?.remove(); zTipEl = null }
    function zTip(b: HTMLElement, shake: boolean): void {
      if (!zTipEl) { zTipEl = document.createElement('div'); zTipEl.className = 'dpm-ztip'; zTipEl.setAttribute('role', 'tooltip'); zTipEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/></svg>内容升级中，尽请期待'; document.body.append(zTipEl) }
      const r = b.getBoundingClientRect(), w = zTipEl.offsetWidth
      const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      zTipEl.style.left = Math.round(left) + 'px'; zTipEl.style.top = Math.round(r.bottom + 8) + 'px'
      zTipEl.style.setProperty('--ax', Math.round(r.left + r.width / 2 - left) + 'px')
      if (shake) { zTipEl.classList.remove('shake'); void zTipEl.offsetWidth; zTipEl.classList.add('shake') }
    }
    self.offs.push(zTipOff)
    for (const b of $$<HTMLElement>('.seg [data-z]')) {
      if (b.dataset.z === 'day') continue
      b.classList.add('dpm-zoff'); b.setAttribute('aria-disabled', 'true'); b.title = ''
      b.setAttribute('aria-label', b.textContent + '（内容升级中，尽请期待）')
      on(b, 'mouseenter', () => zTip(b, false)); on(b, 'focus', () => zTip(b, false))
      on(b, 'mouseleave', zTipOff); on(b, 'blur', zTipOff)
    }
    function setZoom(z: string): void {
      if (z !== 'day') return
      state.zoom = z
      for (const b of $$('.seg button')) b.classList.toggle('on', (b as HTMLElement).dataset.z === state.zoom)
      render()
    }

    /* ── 任务面板（v77：宽度跟看板 1/3 走，可拖，记住；v80：双击复位）── */
    /* v133 R2：重画期间用重画开头量好的宽度（中途已经写过样式，再读 clientWidth = 强制布局） */
    /* v143（1.1）：面板是独立的一列（排版引擎给宽度），甘特图不再被它盖住 → 甘特里算可见区时面板宽 = 0；
       面板想要的宽度 300–680（默认 380，拖左边缘改、松手记住、双击复位） */
    const TP_MIN = 300, TP_MAX = 680, TP_DEF = 380
    const tpMin = (): number => TP_MIN
    const tpMax = (): number => TP_MAX
    const tpWant = (): number => Math.min(TP_MAX, Math.max(TP_MIN, state.tpw == null ? TP_DEF : state.tpw))
    const tpW = (): number => 0
    const bandW = (): number => Math.max(120, ($('#scroll') as HTMLElement).clientWidth - getLw() - tpW())
    const sizeTp = (): void => {
      /* 宽度由排版引擎写在面板宿主上；这里只报想要的宽度 + 把手的读屏值 */
      const w = Math.round(tpWant()), lo = tpMin(), hi = tpMax()
      if (tpHost.dataset.want !== String(w)) { tpHost.dataset.want = String(w); window.dispatchEvent(new Event('dpm:cols')) }
      const h = $('#tpResize') as HTMLElement
      h.setAttribute('aria-valuenow', String(w)); h.setAttribute('aria-valuemin', String(lo)); h.setAttribute('aria-valuemax', String(hi))
      h.title = '拖动调整任务面板宽度（' + lo + ' – ' + hi + 'px，双击复位）'
      plLayoutSoon()   /* v118（1）：宽度变了（标题行可能折两行）→ 收起高度跟着重算 */
    }
    const openTp = (day: number): void => {
      setTp(true)
      syncPlFoldBtn()      /* v118（3）：进面板先落成上次记住的收起状态，不闪 */
      sizeTp()
      state.day = day
      const win = windowFor(state.zoom, state.anchor)
      if (day < win.start || day >= win.end) state.anchor = day
      render()
      /* v144（5.3）：按那一格的实际位置算 —— 落到时间轴可见区（目录右边 → 面板左边）的 1/3 处，并闪一下表头那格。
         以前用 at(day) − bandW()/2：面板独立成列后可见区变窄，今天被推到可见区右边外面 */
      /* 面板开合 / 列宽变化会触发 render 里的 reanchor（按 0.29 放今天，260ms 后再放一次）—— 这里取消它，自己放两次（立即 + 面板列宽过渡结束后），最后一次再闪 */
      if (placeT) { clearTimeout(placeT); placeT = null }
      const put = (flashIt: boolean): void => {
        const sc = $('#scroll') as HTMLElement
        const cells = Array.from($$<HTMLElement>('#headT .sc-tier.c2 .sc-cell'))
        const cell = cells.find((c) => day >= Number(c.dataset.ds) && day < Number(c.dataset.de)) ?? null
        const lw = getLw(), band = bandW()
        if (!cell) { sc.scrollLeft = Math.max(0, at(day) - band / 3); return }
        const sr = sc.getBoundingClientRect(), cr = cell.getBoundingClientRect()
        const want = sc.scrollLeft + (cr.left + cr.width / 2) - (sr.left + lw + band / 3)
        sc.scrollLeft = Math.max(0, Math.min(want, sc.scrollWidth - sc.clientWidth))
        if (flashIt) { cell.classList.remove('dpm-tdfl'); void cell.offsetWidth; cell.classList.add('dpm-tdfl'); setTimeout(() => cell.classList.remove('dpm-tdfl'), 1200) }
      }
      put(false)
      setTimeout(() => { if (placeT) { clearTimeout(placeT); placeT = null } put(true) }, 300)
    }
    const setDay = (day: number): void => {
      state.day = day
      const win = windowFor(state.zoom, state.anchor)
      if (day < win.start || day >= win.end) state.anchor = day
      render()
    }
    const moveDay = (n: number): void => setDay(state.day + n * D)
    on($('#tpClose') as HTMLElement, 'click', () => { setTp(false); render() })
    /* v122（2）：「今天」按钮的按下态 = 正在看今天的任务面板 —— 任何入口改了面板（开 / 关 / 换日期 / 甘特里点今天）都同步 */
    let lastToday: boolean | null = null
    const syncToday = (): void => {
      /* v143（1.1）：面板是独立一列，不在日程页也算开着 */
      const on = root.classList.contains('tp-on') && state.day === TODAY && !!TODAY
      if (on === lastToday) return
      lastToday = on
      host.todayChanged?.(on)
      window.dispatchEvent(new CustomEvent('dpm:today', { detail: { on } }))
    }
    self.syncToday = syncToday
    self.openToday = (): void => { if (!TODAY) { self.wantToday = true; return } state.anchor = TODAY; openTp(TODAY) }
    self.closeToday = (): void => { setTp(false); render() }
    const flash = (el: Element): void => { el.classList.remove('v7seek'); void (el as HTMLElement).offsetWidth; el.classList.add('v7seek'); setTimeout(() => el.classList.remove('v7seek'), 1700) }
    const seekNow = (keys: string[]): void => {
      const find = (): HTMLElement[] => keys.map((k) => $('#exBody .exi[data-k="' + CSS.escape(k) + '"]')).filter((x): x is HTMLElement => !!x)
      let els = find()
      const shut = [...new Set(els.map((el) => el.closest<HTMLElement>('.exz.shut')).filter((x): x is HTMLElement => !!x))]
      if (shut.length) {
        for (const s of shut) EXZ_CLOSED.delete(s.dataset.zone as string)
        void postGantt('ui', { exz: [...EXZ_CLOSED] }).catch(() => undefined)
        render(); els = find()
      }
      if (els.length) {
        /* v130（3）：执行安排收起时被定位 → 先展开执行安排 */
        const go = (): void => { els[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); els.forEach(flash) }
        if (state.tpm === 'pl') { pairMode('ex', true); window.setTimeout(go, 300) } else go()
        return
      }
      if (state.plFold) plSetFold(false, true)
      setTimeout(() => {
        const r = $('#tpList .plr[data-k="' + CSS.escape(keys[0]) + '"]') ?? $('#tpList .plr[data-k="' + CSS.escape(PKEY.p(pKeyCard(keys[0]))) + '"]')
        if (r) { r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); flash(r) }
        toast(r ? '今天还没排：在本日计划清单里点「排今天」' : '这张卡片今天不在计划里：拖进任务执行安排，或在甘特图上给今天加计划')
      }, 320)
    }
    self.seek = (keys: string[]): void => {
      if (!TODAY) { self.wantSeek = keys; self.wantToday = true; return }
      const wasOn = root.classList.contains('tp-on') && state.day === TODAY
      if (!wasOn) { state.anchor = TODAY; openTp(TODAY) }
      setTimeout(() => seekNow(keys), wasOn ? 0 : 260)
    }
    /* v127（8）/ v128（7）：详情里的项目 / 任务 / 子任务拖进今天的任务执行安排 —— 落点由这里算（详情在另一个 BoardView） */
    const xs: XSched = {
      open: () => !self.disposed && tpOn() && !tpHost.hidden,
      near: (x, y) => { const el = document.elementFromPoint(x, y); return !!el && inR(el) && !!el.closest('#tp') },
      hit: (x, y) => {
        const el = document.elementFromPoint(x, y)
        if (!el || !inR(el)) return null
        /* v130（3）：执行安排收起时把任务拖进面板 → 先自动展开执行安排 */
        if (state.tpm === 'pl' && el.closest('#tpPair')) { pairMode('ex', true); return null }
        const z = el.closest<HTMLElement>('#exBody .exz')
        if (z) return { z: z.dataset.zone as string, el: z }
        const card = el.closest<HTMLElement>('#tpExCard')
        return card ? { z: 'un', el: card } : null
      },
      has: (keys) => { const u = pday(ymd(state.day)); return keys.filter((k) => u.sel.has(k) || u.done.has(k)) },
      zone: (keys) => { const key = ymd(state.day), u = pday(key); return pickZone(keys.map((k) => pZoneOf(u, k, key))) },
      seek: (keys) => seekNow(keys),
      body: () => $('#exBody') as HTMLElement | null,
      place: (cid, keys, z0, title) => {
        const c = findCard(cid)
        if (!c) return
        const key = ymd(state.day), u = pday(key)
        let z = z0 as GanttZone
        if ((z === 'run' || z === 'done') && futureDay()) { toast('未来的日子不能执行，放进「未安排」'); z = 'un' }
        const planAdded = !c.planSet.has(key)
        if (planAdded) c.planSet.add(key)
        for (const k of keys) { u.sel.add(k); PST.delete(key + '\n' + k); pLaneDrop(u, k); pZlDrop(u, k); u.done.delete(k); u.doneAt.delete(k); u.from.delete(k) }
        if (z === 'arr') for (const k of keys) (u.lanes ?? (u.lanes = [])).push([k])
        else if (z === 'run') { const rows = u.zl.run; if (rows.length) rows[rows.length - 1].push(...keys); else rows.push(keys.slice()); for (const k of keys) PST.set(key + '\n' + k, 'run') }
        else if (z === 'pause' || z === 'wait') { u.zl[z].push(keys.slice()); for (const k of keys) PST.set(key + '\n' + k, z) }
        else if (z === 'done') { for (const k of keys) { u.from.set(k, 'un'); u.done.add(k); u.doneAt.set(k, Date.now()) } pSyncActual(c, u, key) }
        if (EXZ_CLOSED.delete(z)) void postGantt('ui', { exz: [...EXZ_CLOSED] }).catch(() => undefined)
        /* 先写面板再补计划条：计划条的回包快照里就已经带着新排进来的项 */
        savePanel(key, panelPatch(key, u))
        if (planAdded) post('plan', { card: cid, day: key, on: true })
        render()
        requestAnimationFrame(() => {
          for (const k of keys) { const el = $('#exBody .exi[data-k="' + CSS.escape(k) + '"]'); if (el) { el.classList.add('v7land'); setTimeout(() => el.classList.remove('v7land'), 1500) } }
          for (const k of keys.concat([PKEY.p(cid)])) { const r = $('#tpList .plr[data-k="' + CSS.escape(k) + '"]'); if (r) flash(r) }
        })
        toast('已放进「' + EXZ_T[z] + '」：「' + title + '」' + (keys.length > 1 ? '（' + keys.length + ' 个任务项）' : '') + ' · 本日计划清单已同步' + (planAdded ? ' · 甘特图今天补上计划条' : ''))
      },
    }
    setXS(xs)
    self.offs.push(() => setXS(null, xs))
    on($('#tpResize') as HTMLElement, 'pointerdown', (e) => {
      const ev = e as PointerEvent
      ev.preventDefault()
      const startX = ev.clientX, startW = tpHost.getBoundingClientRect().width
      const move = (m: Event): void => {
        const mv = m as PointerEvent
        state.tpw = Math.min(tpMax(), Math.max(tpMin(), Math.round(startW + (startX - mv.clientX))))
        sizeTp()
        plLayout(false)   /* v118（1）：拖宽过程中标题行可能折行 → 收起高度实时跟手，不能等下一轮轮询 */
      
      }
      const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); tpBox.classList.remove('tp-resizing'); plLayout(false); self.saveUi({ tpw: state.tpw }) }
      tpBox.classList.add('tp-resizing')
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
    on($('#tpResize') as HTMLElement, 'dblclick', () => {
      state.tpw = null
      self.saveUi({ tpw: null })
      sizeTp()
      toast('任务面板宽度已复位')
    })
    on($('#tpPrev') as HTMLElement, 'click', () => moveDay(-1))
    on($('#tpNext') as HTMLElement, 'click', () => moveDay(1))
    on($('#headT') as HTMLElement, 'click', (e) => {
      const ev = e as MouseEvent
      const t = ev.target as HTMLElement
      if (t.closest('.now-pill')) { openTp(TODAY); return }
      const cell = t.closest('.sc-cell[data-ds]') as HTMLElement | null
      if (!cell) return
      const day = Number(cell.dataset.ds)
      if (state.zoom === 'day') openTp(day); else setDay(day)
    })
    /* ── v105 面板交互：勾选（当天完成）/ 选中（排今天）/ 执行 / 暂停 / 取消 / 打开详情 ── */
    on($('#tp') as HTMLElement, 'click', (e) => {
      const t = (e as MouseEvent).target as HTMLElement
      if (!t || !t.closest) return
      const cardFold = t.closest('[data-pl-cardfold]') as HTMLElement | null
      if (cardFold) { e.preventDefault(); e.stopPropagation(); plCardToggle(); return }
      const foldAll = t.closest('[data-pl-foldall]') as HTMLElement | null
      if (foldAll) { e.preventDefault(); e.stopPropagation(); plFoldAllToggle(); return }
      const onlyBtn = t.closest('[data-pl-only]') as HTMLElement | null
      if (onlyBtn) { e.preventDefault(); e.stopPropagation(); plOnlyToggle(); return }
      const doneBtn = t.closest('[data-pl-done]') as HTMLElement | null
      if (doneBtn) { e.preventDefault(); e.stopPropagation(); plDoneToggle(); return }
      const rec = t.closest('[data-pl-rec]') as HTMLElement | null
      if (rec) { e.preventDefault(); e.stopPropagation(); pSelToggle(rec.dataset.plRec as string); return }
      if (t.closest('#plRecChip')) { e.preventDefault(); jumpRec(); return }
      if (t.closest('#exCarryChip')) { const chip = $('#exCarryChip'); toast(chip && chip.title ? chip.title : '今天没有需要续排的任务项'); return }
      /* v123（1.2）+ v124（1.3）：分区整条标题栏开合（grid 过渡），落盘 ui.exz */
      const zTg = t.closest('[data-exz-tg]') as HTMLElement | null
      if (zTg) {
        e.preventDefault(); e.stopPropagation()
        const z = zTg.dataset.exzTg as string
        if (EXZ_CLOSED.has(z)) EXZ_CLOSED.delete(z); else EXZ_CLOSED.add(z)
        const shut = EXZ_CLOSED.has(z)
        const sec = zTg.closest('.exz') as HTMLElement | null
        if (sec) {
          sec.classList.toggle('shut', shut)
          const tb = sec.querySelector('.exz-tg') as HTMLElement | null
          if (tb) { tb.setAttribute('aria-expanded', String(!shut)); tb.title = (shut ? '展开' : '收起') + '「' + EXZ_T[z] + '」' }
          const hd = sec.querySelector('.exz-h') as HTMLElement | null
          if (hd) hd.title = (shut ? '展开' : '收起') + '「' + EXZ_T[z] + '」（点整条标题栏）'
          const inn = sec.querySelector('.exz-in') as (HTMLElement & { inert?: boolean }) | null
          if (inn) inn.inert = shut
        }
        self.foldBusy++
        void postGantt('ui', { exz: [...EXZ_CLOSED] }).then((r) => { self.foldBusy = Math.max(0, self.foldBusy - 1); if (self.data && r.gantt?.ui) self.data.ui = { ...r.gantt.ui } })
          .catch((er) => { self.foldBusy = Math.max(0, self.foldBusy - 1); toast(er instanceof ApiError ? er.message : String(er), 'err') })
        return
      }
      const act = t.closest('[data-ex-act]') as HTMLElement | null
      if (act) { e.preventDefault(); e.stopPropagation(); pAct(act.dataset.k as string, act.dataset.exAct as string); return }
      const exc = t.closest('[data-ex-ck]') as HTMLElement | null
      if (exc) { e.preventDefault(); e.stopPropagation(); pDoneToggle(exc.dataset.exCk as string); return }
      const xr = t.closest('[data-x-rec]') as HTMLElement | null
      if (xr) { e.preventDefault(); e.stopPropagation(); pRecToggle(xr.dataset.xRec as string); return }
      const pls = t.closest('[data-pl-sel]') as HTMLElement | null
      if (pls) { e.preventDefault(); e.stopPropagation(); pSelToggle(pls.dataset.plSel as string); return }
      const plc = t.closest('[data-pl-ck]') as HTMLElement | null
      if (plc) { e.preventDefault(); pDoneToggle(plc.dataset.plCk as string); return }
      const plt = t.closest('[data-pl-tg]') as HTMLElement | null
      if (plt) { e.preventDefault(); e.stopPropagation(); plToggle(plt.dataset.plTg as string); return }
      const plrow = t.closest('#tpList .plr') as HTMLElement | null
      if (plrow && plrow.dataset.kids === '1' && !t.closest('button')) { e.preventDefault(); plToggle(plrow.dataset.k as string); return }
      const op = t.closest('[data-pl-open]') as HTMLElement | null
      if (op) {
        e.preventDefault()
        const c = findCard(op.dataset.plOpen as string)
        /* v129（3）：计划清单里点任务 / 子任务那一行的打开按钮 → 详情里定位到那张卡（不是整张卡片） */
        const r = op.closest<HTMLElement>('#tpList .plr'), f = r ? pFind(r.dataset.k as string) : null
        if (f && c && f.c.id === c.id) openItemDetail(f); else if (c) { openCardTasksOf(c); followSession(c.id, 'p') }
        return
      }
      const dd = t.closest('[data-pl-ddl]') as HTMLElement | null
      if (dd) {
        e.preventDefault(); e.stopPropagation()
        const c = findCard(dd.dataset.plDdl as string)
        if (c) { const r = dd.getBoundingClientRect(); openDdl(c, r.left + r.width / 2, r.bottom) }
        return
      }
      const exi = t.closest('#exBody .exi') as HTMLElement | null
      if (exi) {
        if (Date.now() - exLastDrag < 350) return
        const f = pFind(exi.dataset.k as string)
        if (f) { e.preventDefault(); openItemDetail(f) }
      }
    })
    on($('#tp') as HTMLElement, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      const t = ev.target as HTMLElement
      /* v121：项目组栏整行可用键盘开合 */
      const gp = t.closest && t.closest('#tpList .plr.gp') as HTMLElement | null
      if (gp && t === gp) { ev.preventDefault(); plToggle(gp.dataset.k as string); return }
      const el = t.closest && t.closest('#exBody .exi') as HTMLElement | null
      if (!el || t.closest('button')) return
      ev.preventDefault()
      const f = pFind(el.dataset.k as string)
      if (f) openItemDetail(f)
    })
    on($('#exBody') as HTMLElement, 'pointerdown', (e) => { bubHide(); exDown(e as PointerEvent) }, true)
    /* ── v141（1.2）子任务小卡：点一下 = 定位高光（只按子任务，不冒泡到外层任务卡）；按住上下拖 = 改顺序（只在未完成之间，写卡片任务顺序 → 详情同步） ── */
    let v41d: { r: HTMLElement; sk: string; y0: number; on: boolean; list?: HTMLElement; line?: HTMLElement; at?: number; pid: number } | null = null
    const subOpen = (sk: string): void => { const f = pFind(sk); if (f) openItemDetail(f) }
    on($('#exBody') as HTMLElement, 'pointerdown', (e) => {
      const ev = e as PointerEvent
      if (ev.button !== 0) return
      const r = (ev.target as HTMLElement).closest?.('.v41sr') as HTMLElement | null
      if (!r || (ev.target as HTMLElement).closest('button')) return
      v41d = { r, sk: r.dataset.sk as string, y0: ev.clientY, on: false, pid: ev.pointerId }
    }, true)
    on(document as unknown as HTMLElement, 'pointermove', (e) => {
      const d = v41d, ev = e as PointerEvent; if (!d) return
      if (!d.on) {
        if (Math.abs(ev.clientY - d.y0) < 5) return
        if (d.r.classList.contains('done')) { v41d = null; toast('已完成的子任务不能拖动（和卡片详情一样：未完成 / 已完成两段不能互换）'); return }
        d.on = true; d.list = d.r.parentElement as HTMLElement; d.r.classList.add('v41drag'); document.body.classList.add('v41dragging')
        d.line = document.createElement('i'); d.line.className = 'v41line'; d.list.append(d.line); bubHide()
      }
      ev.preventDefault()
      d.r.style.transform = 'translateY(' + (ev.clientY - d.y0) + 'px)'
      const sibs = Array.from(d.list!.querySelectorAll<HTMLElement>('.v41sr:not(.done)')).filter((x) => x !== d.r)
      let at = sibs.length
      for (let i = 0; i < sibs.length; i++) { const b = sibs[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { at = i; break } }
      d.at = at
      const lr = d.list!.getBoundingClientRect(), ref = sibs[at]
      d.line!.style.top = Math.round(ref ? ref.getBoundingClientRect().top - lr.top - 2 : (sibs.length ? sibs[sibs.length - 1].getBoundingClientRect().bottom - lr.top + 1 : 0)) + 'px'
    }, { passive: false } as AddEventListenerOptions)
    on(document as unknown as HTMLElement, 'pointerup', () => {
      const d = v41d; v41d = null; if (!d) return
      if (!d.on) { exLastDrag = Date.now(); subOpen(d.sk); return }
      document.body.classList.remove('v41dragging'); d.r.classList.remove('v41drag'); d.r.style.transform = ''; d.line?.remove()
      exLastDrag = Date.now()
      if (PANEL_DEFER) { PANEL_DEFER = 0; render() }
      const p = d.sk.split('|'), c = cardsById.get(p[1]); if (!c) return
      const t = c.tasks.find((x) => x.subs.some((y) => y.id === p[2])); if (!t) return
      /* 落点按画面上的顺序算（d.at 就是按画面里未完成小卡数出来的；模型的完成标记可能还没跟上刚改的数据） */
      const domUn = Array.from(d.list!.querySelectorAll<HTMLElement>('.v41sr:not(.done)')).filter((x) => x !== d.r).map((x) => (x.dataset.sk as string).split('|')[2])
      const rest = domUn.slice(); rest.splice(Math.min(d.at ?? rest.length, rest.length), 0, p[2])
      const order = rest.concat(t.subs.map((x) => x.id).filter((id) => !rest.includes(id)))
      const domAll = Array.from(d.list!.querySelectorAll<HTMLElement>('.v41sr:not(.done)')).map((x) => (x.dataset.sk as string).split('|')[2])
      if (rest.join() === domAll.join()) return
      t.subs = order.map((id) => t.subs.find((x) => x.id === id)!)
      render()
      ;(window as unknown as Record<string, unknown>).__dpmSubMoved = { tid: t.id, order }
      void (async () => {
        try {
          const st = await getState(); const card = st.board.cards.find((x) => x.id === c.id); if (!card) return
          const next = card.tasks.map((x) => x.id !== t.id ? x : { ...x, subs: order.map((id) => (x.subs ?? []).find((y) => y.id === id)).filter(Boolean) })
          await postBoard('card/tasks', { id: c.id, tasks: next })
          host.tasksChanged?.(c.id); void self.load(true)
          toast('已调整「' + t.text + '」的子任务顺序 · 卡片详情同步')
        } catch (er) { toast('子任务顺序没保存上：' + (er instanceof ApiError ? er.message : String(er)), 'err'); void self.load() }
      })()
    })
    on(document as unknown as HTMLElement, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key === 'Escape' && v41d?.on) { const d = v41d; v41d = null; document.body.classList.remove('v41dragging'); d.r.classList.remove('v41drag'); d.r.style.transform = ''; d.line?.remove(); return }
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      const r = ev.target as HTMLElement
      if (!r?.classList?.contains('v41sr')) return
      ev.preventDefault(); ev.stopPropagation(); subOpen(r.dataset.sk as string)
    }, true)
    /* 小卡上的 click 到此为止（pointerup 已经按子任务处理过），小卡里的按钮照常 */
    on($('#exBody') as HTMLElement, 'click', (e) => { const t = e.target as HTMLElement; if (t.closest?.('.v41sr') && !t.closest('button')) { e.preventDefault(); e.stopPropagation() } }, true)
    /* v133：按下执行卡不立刻挪焦点 —— 焦点一变，页面里的 :has(:focus-visible) 等规则让整页重算样式（按下那帧 30–90ms，4x 降速 130–390ms）；
       等浏览器空闲再把焦点给卡片，Alt+↑/↓ 照常可用。正在编辑输入框时不拦，让它照常失焦提交。 */
    on($('#exBody') as HTMLElement, 'mousedown', (e) => {
      const t = e.target as HTMLElement
      const card = t.closest?.('.exi') as HTMLElement | null
      const was = document.activeElement as HTMLElement | null
      if (!card || t.closest('input, textarea, select, [contenteditable]') || (was && (was.isContentEditable || was.matches('input, textarea, select')))) return
      e.preventDefault()
      /* 焦点原来在已换掉的旧详情里时，浏览器会把它退回 body —— 这种情况也交给卡片 */
      requestIdleCallback(() => { const a = document.activeElement; if (card.isConnected && (a === was || !a || a === document.body || !a.isConnected || !(a as HTMLElement).offsetParent)) card.focus({ preventScroll: true }) }, { timeout: 1000 })
    }, true)
    /* v125 悬停展开 + v126 对话气泡：都挂在 #exBody 上（卡片每次重画都换 DOM，委托最稳） */
    on($('#exBody') as HTMLElement, 'pointerover', (e) => {
      if ((exDrag && exDrag.on) || (e as PointerEvent).buttons) { bubHide(); return }
      const card = ((e.target as HTMLElement).closest?.('#exBody .exi') ?? null) as HTMLElement | null
      if (!card) { bubHide(); hvOff(); return }
      hvOn(card)
      bubShow(card)
    })
    on($('#exBody') as HTMLElement, 'pointerleave', () => { bubHide(); hvOff() })
    let stRaf = 0
    on($('#exBody') as HTMLElement, 'scroll', () => { bubHide(); if (!stRaf) stRaf = requestAnimationFrame(() => { stRaf = 0; exStuck() }) }, true)
    /* v131（3）：计划清单滚动 / 开合过渡结束 → 重判哪几行吸住了 */
    const plStuckSoon = (): void => { if (!stRaf) stRaf = requestAnimationFrame(() => { stRaf = 0; exStuck() }) }
    on($('#tpList') as HTMLElement, 'scroll', plStuckSoon)
    on($('#tpList') as HTMLElement, 'transitionend', plStuckSoon)
    /* v127（4）+ v130（3）：两张卡的整条标题栏（按钮 / 徽标除外）+ 箭头 = 开合；收起态整张卡就是展开按钮 */
    let pairTip: HTMLElement | null = null
    const pairTipOff = (): void => { pairTip?.remove(); pairTip = null }
    self.offs.push(pairTipOff)
    on($('#tpPair') as HTMLElement, 'click', (e) => {
      const t = (e as MouseEvent).target as HTMLElement
      if (!t || !t.closest) return
      const card = t.closest<HTMLElement>('#tpExCard, #tpPlanCard')
      if (!card) return
      const arrow = t.closest('#exCardFold, #plCardFold'), head = t.closest('.tpc-h'), min = card.classList.contains('min')
      if (!arrow) {
        if (!head && !min) return
        if (head && t.closest('button:not(.plcard-fold), .hdchip, input, a')) return
      }
      e.preventDefault(); e.stopPropagation()
      pairTipOff()
      if (card.id === 'tpExCard') pairMode(min ? 'ex' : 'pl')
      else pairMode(min ? 'pl' : 'ex')
    }, true)
    /* 两个箭头的说明 = 白底小气泡，0 延迟 */
    for (const id of ['#exCardFold', '#plCardFold']) {
      const b = $(id)
      if (!b) continue
      on(b, 'mouseenter', () => {
        pairTipOff()
        const tp = document.createElement('div')
        tp.className = 'v10tip'
        tp.textContent = b.dataset.tip ?? ''
        document.body.append(tp)
        pairTip = tp
        const r = b.getBoundingClientRect()
        tp.style.left = Math.max(8, Math.min(innerWidth - tp.offsetWidth - 8, r.right - tp.offsetWidth)) + 'px'
        tp.style.top = (r.top - tp.offsetHeight - 7) + 'px'
      })
      on(b, 'mouseleave', pairTipOff)
    }
    on($('#exBody') as HTMLElement, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return
      const el = (ev.target as HTMLElement).closest && (ev.target as HTMLElement).closest('#exBody .exi') as HTMLElement | null
      if (!el) return
      ev.preventDefault(); ev.stopPropagation()
      exKeyMove(el.dataset.k as string, ev.key === 'ArrowUp' ? -1 : 1)
    })
    const splitEl = $('#tpSplit') as HTMLElement | null
    if (splitEl) {
      on(splitEl, 'pointerdown', (e) => tpSplitDown(e as PointerEvent))
      on(splitEl, 'dblclick', () => tpSplitReset())
      on(splitEl, 'keydown', (e) => tpSplitKey(e as KeyboardEvent))
    }

    /* ── 左目录宽度（200–520，双击复位，记住）── */
    const lwMin = LW_MIN, lwMax = LW_MAX
    const putLw = (w: number): void => {
      state.lw = Math.min(lwMax, Math.max(lwMin, Math.round(w)))
      root.style.setProperty('--lw', state.lw + 'px')
      render()
    }
    on($('#lwResize') as HTMLElement, 'pointerdown', (e) => {
      const ev = e as PointerEvent
      ev.preventDefault()
      const h = ev.currentTarget as HTMLElement
      const x0 = ev.clientX, w0 = getLw()
      root.classList.add('lw-resizing')
      h.setPointerCapture?.(ev.pointerId)
      const move = (m: Event): void => {
        const mv = m as PointerEvent
        if (Math.abs(mv.clientX - x0) < 2) return
        putLw(w0 + (mv.clientX - x0))
      }
      const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); root.classList.remove('lw-resizing'); self.saveUi({ lw: state.lw }) }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
    on($('#lwResize') as HTMLElement, 'dblclick', () => {
      state.lw = null
      root.style.removeProperty('--lw')
      self.saveUi({ lw: null })
      render()
      toast('目录宽度已复位')
    })
    on($('#lwResize') as HTMLElement, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
      ev.preventDefault()
      putLw(getLw() + (ev.key === 'ArrowLeft' ? -16 : 16))
      self.saveUi({ lw: state.lw })
    })

    /* ── 页头：翻页 / 今天 / 搜索 / 已归档 ── */
    function shift(dir: number): void {
      if (state.zoom === 'month') state.anchor = addMonths(state.anchor, dir * 3)
      else if (state.zoom === 'quarter') state.anchor = addMonths(state.anchor, dir * 6)
      else if (state.zoom === 'week') state.anchor += dir * 4 * 7 * D
      else state.anchor += dir * 7 * D
      render()
    }
    // v86：组展开 / 折叠三个按钮（写服务端 group.collapsed，两个看板共用一份状态）
    const bulk = async (mode: 'open' | 'only' | 'fold'): Promise<void> => {
      try {
        const live = mode === 'only' && this.host.liveGroups ? this.host.liveGroups() : undefined
        await postBoard('groups/collapse', live ? { mode, live } : { mode })
        // 批量操作是新的权威值，丢掉单组在途覆盖
        self.pendingClosed.clear()
        state.closed = new Set(GROUPS.filter((g) => g.collapsed).map((g) => g.id))
        await this.load(true)
      } catch (e) { this.host.toast(e instanceof ApiError ? e.message : String(e), 'err') }
    }
    for (const [sel, mode] of [['[data-sc-all-open]', 'open'], ['[data-sc-only-live]', 'only'], ['[data-sc-all-fold]', 'fold']] as Array<[string, 'open' | 'only' | 'fold']>) {
      const el = this.root.querySelector(sel) as HTMLElement | null
      if (el) on(el, 'click', () => void bulk(mode))
    }
    // v98 ①⑥：项目组时间显隐 —— 只切 #rows 上的一枚 class：不重画 DOM、不复位横向续期、不重算时间窗
    const gtBtn = $('#scGtime') as HTMLButtonElement | null
    if (gtBtn) on(gtBtn, 'click', () => {
      state.gtime = !state.gtime
      syncGtime()
      self.gtimeBusy++
      void postGantt('ui', { gtime: state.gtime }).then((r) => {
        self.gtimeBusy = Math.max(0, self.gtimeBusy - 1)
        if (self.data && r.gantt?.ui) self.data.ui = { ...r.gantt.ui }
      }).catch((e) => {
        self.gtimeBusy = Math.max(0, self.gtimeBusy - 1)
        state.gtime = !state.gtime
        syncGtime()
        toast(e instanceof ApiError ? e.message : String(e), 'err')
      })
      toast(state.gtime
        ? '已显示所有项目组的时间：计划条 / 实际条 / 截止标记都出来了（这个选择会记住）'
        : '已隐藏所有项目组的时间（默认就是隐藏的；这个选择会记住）')
    })
    syncGtime()
    on($('#btnPrev') as HTMLElement, 'click', () => shift(-1))
    on($('#btnNext') as HTMLElement, 'click', () => shift(1))
    on($('#btnToday') as HTMLElement, 'click', () => { state.anchor = TODAY; openTp(TODAY) })
    const qEl = $('#q') as HTMLInputElement
    const qClr = $('#qClr') as HTMLElement
    const syncQ = (): void => { qClr.hidden = !qEl.value }
    on(qEl, 'input', () => { state.q = qEl.value; syncQ(); render() })
    on(qClr, 'click', () => { qEl.value = ''; state.q = ''; syncQ(); qEl.focus(); render() })
    on(qEl, 'keydown', (e) => {
      const ev = e as KeyboardEvent
      if (ev.key === 'Escape' && qEl.value) { ev.preventDefault(); ev.stopPropagation(); qEl.value = ''; state.q = ''; syncQ(); render() }
      if (ev.key === 'Enter') { ev.preventDefault(); qEl.blur() }
    })
    function pendCount(): number {
      let n = 0
      for (const g of GROUPS) for (const c of g.cards) if (c.pending && !c.arch) n++
      return n
    }
    function syncPendChip(): void {
      const b = $('#fPend') as HTMLElement | null
      if (!b) return
      b.setAttribute('aria-pressed', String(!!state.showPending))
      const lb = $('#fPendLb')
      if (lb) lb.textContent = state.showPending ? '隐藏 pending 项目' : '显示 pending 项目'
      const n = pendCount()
      const cn = $('#fPendN')
      if (cn) { cn.textContent = String(n); cn.hidden = !n }
    }
    on($('#fPend') as HTMLElement, 'click', () => {
      state.showPending = !state.showPending
      syncPendChip()
      render()
      self.pendBusy++
      void postGantt('ui', { pend: state.showPending }).then((r) => {
        self.pendBusy = Math.max(0, self.pendBusy - 1)
        if (self.data && r.gantt?.ui) self.data.ui = { ...r.gantt.ui }
      }).catch((e) => {
        self.pendBusy = Math.max(0, self.pendBusy - 1)
        state.showPending = !state.showPending
        syncPendChip()
        render()
        toast(e instanceof ApiError ? e.message : String(e), 'err')
      })
      toast(state.showPending
        ? '已显示 ' + pendCount() + ' 个 pending 项目（目录 + 计划 / 实际条）'
        : '已隐藏 ' + pendCount() + ' 个 pending 项目（执行记录一起收起）')
    })
    function syncChips(): void {
      for (const b of $$('.seg button')) { const el = b as HTMLElement; el.classList.toggle('on', el.dataset.z === state.zoom); el.setAttribute('aria-pressed', String(el.dataset.z === state.zoom)) }
    }

    /* 尺寸变化（打开 / 关闭右侧详情、窗口缩放）→ 重画每格像素 */
    let roRaf = 0
    /* v127（7）：切看板 = 本页 display none ↔ 显示，宽度回到原值就不重建（数据没变时整页原样留着） */
    const ro = new ResizeObserver(() => {
      if (roRaf) return
      roRaf = requestAnimationFrame(() => {
        roRaf = 0
        const w = root.clientWidth
        if (!w || self.disposed || !TODAY) return
        if (w === self.roW && !self.roDirty) return
        self.roDirty = false
        render()
      })
    })
    ro.observe(root)
    self.offs.push(() => { ro.disconnect(); if (roRaf) cancelAnimationFrame(roRaf) })

    syncChips(); syncQ()
    this.refreshNow = (): void => { if (TODAY) renderSoon() }
  }
}
