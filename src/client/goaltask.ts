/**
 * v92：会话里用户发的消息 → 蓝色胶囊「添加任务」→ 居中大弹窗「添加卡片任务」。
 * v93（0.42）：① 任务标题内联到弹窗标题行；② 任务说明可「从历史消息选择」（本会话，点选顺序、追加）；
 *   ③ 说明框里与会话输入框同一套触发（> / 》 引用卡片内容、/ 工具命令）；④ 卡片任务不再自动注入会话上下文。
 * v94（0.43）：① 详情页任务的**添加 / 编辑**都走这个弹窗（编辑 = 「编辑卡片任务」/ 主按钮「保存」，
 *   保留完成状态 / 子任务 / 添加时间；子任务也走它，底栏点名父任务）；
 *   ② 从详情打开时，历史消息面板多一行「会话选择」（只列活跃会话），列表换成所选会话的**完整历史**，
 *   每 200 条一页、底部「加载更早的消息」翻到最早一条（不再有「只列最近 N 条」的截断）；
 *   ③ 按钮扩到**任意非空用户消息**旁（不再只认 /goal 开头）。
 *
 * 为什么按钮走 DOM：宿主只给 AI 消息留了操作条插槽（conversation.chat.assistant-actions），
 * 用户消息的 actions 条（[data-clock="start"]：时间 + 复制）没有插槽；conversation.user.text.node
 * 是文本节点渲染槽（/goal 的 chip 走它）。整块替换 conversation.chat.node 要复刻宿主 hash 类名，
 * 风险高。所以按钮注入到 actions 条末尾，MutationObserver 在宿主重画后补回（幂等，只认自己的标记）。
 */
import { ApiError, Card, FileRef, goalTitle, getSession, getSessionMessages, getState, HistoryMsg, openFileSmart, post, SessionInfo, Snapshot, Task, WebLink } from './api.js'
import { esc, ic } from './icons.js'
import { appendNotes, autoTaskTitle, cleanTitle, deriveTaskTitle, detectSlash, showAddTaskButton } from '../goaltext.js'
import { detectQuote, fileText as quoteFileText, findRefFile, linkText as quoteLinkText, noteText as quoteNoteText, refTitle, repoText as quoteRepoText } from '../quote.js'
import type { ActiveGroup, Group as QGroup, QuoteSource } from './qmenu.js'
import { buildQuoteGroups } from './qmenu.js'
import { mountNoteDoc, type NoteDoc } from './notedoc.js'
import { injCard, fileName, linkBuckets, newTaskId } from './board.js'
import { chipIconSvg } from './chipicon.js'
import { NoteAssist } from './noteassist.js'
import { IC as SIC, LB as SLB, openPicker, pickClose, sessDeps } from './sess.js'
import { mountDue, mountModelCfg, stHtml, swHtml, swOn, swToggle, taskKeys, tipOff, tipOn, tmLoad, tmTip, zoneOfKeys } from './gtextra.js'

/** 宿主 / 菜单的一个数据源（dsh-client-ui-input-trigger 的注册项；命令 + 技能各一个）。 */
export interface SlashSource {
  name: string
  order?: number
  candidates?(session: { sessionId: string }, req: { query: string; signal: AbortSignal; position?: string }): Promise<Array<{ name?: string; description?: string; label?: string }>>
}

export interface GoalTaskOpts {
  /** 宿主当前会话（面板在看板 / 日程页时返回 null）。 */
  sessionId(): string | null
  /** 会话 → 卡片 id（看板绑定关系）。 */
  cardFor(sessionId: string): string | null
  /** 最近一次看板快照（打开弹窗先用它填，提交时再拉最新）。 */
  snapshot(): Snapshot | null
  toast(msg: string, kind?: 'ok' | 'err'): void
  /** 新增任务成功：打开详情并定位到这条任务（子任务带 parentId，先展开父任务的子任务列表）。 */
  added(cardId: string, taskId: string, parentId?: string | null): void
  /** v94：编辑保存成功：刷新详情并定位到这条任务。 */
  saved?(cardId: string, taskId: string): void
  /** 看板数据变了（解除关联 / 关联卡片）时立刻刷新一次快照（可选；不刷新就等 5s 轮询）。 */
  refresh?(): void
  /** v93：引用菜单要用的会话标题（与会话输入框同一份构造）。 */
  sess?(id: string): { title: string; archived: boolean } | null
  /** v93：引用菜单「活跃会话」分组（与会话输入框同一份口径）。 */
  active?(): ActiveGroup[]
  /** v93：宿主 / 菜单的数据源（命令 + 技能）；空数组 = 不弹（不假装有）。 */
  slashSources?(): SlashSource[]
  /** v96：新增链接（打开卡片详情页同一个「添加链接」弹窗），返回新加进来的链接。 */
  addLink?(cardId: string): Promise<WebLink[]>
  /** v96：新增文件（打开卡片详情页同一个「添加文件」弹窗），返回新加进来的文件。 */
  addFile?(cardId: string): Promise<FileRef[]>
  /** v127：点状态按钮 → 打开今天的任务面板并定位这张任务项卡片。 */
  seek?(cardId: string, keys: string[]): void
  /** v127：「排今天」开着时保存后把这条任务排进今天（未安排 + 本日计划清单，甘特今天补计划条）。 */
  scheduleToday?(cardId: string, keys: string[]): void
  /** v140（5.2）：说明里识别出的链接 / 路径 / 选区 →「添加为…」（详情同款弹窗，预填）；保存 resolve 新条目，取消 resolve null。 */
  addFrom?(cardId: string, kind: 'link' | 'file' | 'repo' | 'note', prefill: string): Promise<{ text?: string; url?: string; name?: string; path?: string; t?: string; v?: string } | null>
  /** v144（1）：相关说明模式的保存（k = -1 新增 / 行号 = 编辑）；auto = 编辑时自动保存（只改内容、不关窗、不提示）。返回出错文案（'' = 成功）。 */
  saveNote?(cardId: string, k: number, it: { t: string; v: string; off: boolean }, auto: boolean): Promise<string>
}

/** v94：详情页打开弹窗的参数（从消息气泡打开不经过这里）。 */
export interface GoalTaskOpen {
  cardId: string
  mode?: 'add' | 'edit'
  /** mode = edit：要改的那条任务。 */
  taskId?: string
  /** 添加子任务：父任务 id。 */
  parentId?: string
  /** v99：从「任务区内联输入行 → 编辑详情」打开时带上已经输入的标题。 */
  title?: string
  /** v144（1）：相关说明模式 —— 同一个窗口、同一个说明输入框；k = -1 新增（v = 预填内容）/ 行号 = 编辑。done 收到保存后的条目（取消 = null）。 */
  note?: { k: number; t?: string; v?: string; off?: boolean; done?: (r: { t: string; v: string } | null) => void }
}

export interface GoalTaskHandle {
  dispose(): void
  open(o: GoalTaskOpen): void
}

/** 会话流里的消息节点：普通用户消息（input-message）与 /goal 命令气泡（command-input，宿主 goal 插件渲染）。 */
const NODE_SEL = '[data-chat-node-key]'
const BTN_ATTR = 'data-dpm-goal-add'
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M4 12h6M4 17h4"/><path d="M17.5 11.5v8M13.5 15.5h8"/></svg>'
const ICO_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
const ICO_FILE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>'
const ICO_HIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h9M4 12h6M4 17.5h5"/><path d="m15 13.5 2 2 3.5-3.5"/></svg>'
const ICO_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-5 6 5 6"/><path d="M5.5 12H17"/></svg>'
const ICO_Q = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4 4"/></svg>'
const ICO_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
const ICO_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/></svg>'
const ICO_SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18.5 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/></svg>'
const ICO_NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v15H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>'
const ICO_REPO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h6v13H5zM13 5.5h6v13h-6z"/></svg>'

type Msg = HistoryMsg
type Mi = { g: string; t: string; d?: string; sub?: string; idx?: string; ins: string }
interface Menu { kind: 'quote' | 'cmd'; hit: { len: number; query: string; ch?: string }; items: Mi[]; hi: number; el: HTMLElement; /** v97：只有键盘换高亮时才滚进视野 */ kbd?: boolean }

/** v94：一个会话的历史消息分页状态（从新到旧；msgs 会把翻过的页都拼起来）。 */
interface HistState { msgs: Msg[]; total: number; hasMore: boolean; before: number | null; loading: boolean; error: string }
const histNew = (): HistState => ({ msgs: [], total: 0, hasMore: false, before: null, loading: false, error: '' })
/** 点选的键 = 会话 + 序号，跨会话挑也不混。 */
const hkey = (sid: string, seq: number): string => sid + '#' + seq

interface Open {
  card: Card
  snap: Snapshot
  /** msg = 从消息气泡进（只读那一条消息所在会话）；detail = 从卡片详情进（多一行「会话选择」）。 */
  origin: 'msg' | 'detail'
  mode: 'add' | 'edit'
  /** 当前在看哪个会话的历史。 */
  sid: string
  /** mode = edit：正在改的那条任务 id。 */
  taskId: string | null
  /** v144（1）：相关说明模式（null = 任务模式）。 */
  nm: { k: number; done?: (r: { t: string; v: string } | null) => void; saved: boolean } | null
  /** 添加子任务时的父任务。 */
  parent: Task | null
  info: SessionInfo | null
  links: Set<string>
  files: Set<string>
  pop: '' | 'link' | 'file'
  picked: string[]
  expanded: Set<string>
  filter: string
  hist: boolean
  /** 每个会话各自的分页状态（切会话不丢已选、不重拉）。 */
  hists: Record<string, HistState>
  menu: Menu | null
  /** v140（2 位置 1）：关联卡片会话（编辑 = 即时；新增 = 随添加保存） */
  sess: string
  muted: string | null
  /** v93：最近一次「自动标题」（说明第一行去掉 /goal；说明空 = ''）。标题未被手动改过就跟随它。 */
  titleAuto: string
  /** v93：用户在标题框里打过字 → 不再自动跟随；编辑态从一开始就不跟随。 */
  titleTouched: boolean
  busy: boolean
  /** v96：正在生成标题。 */
  gen?: boolean
  /** v120：打开弹窗后原因条已清过一次。 */
  genShown?: boolean
  /** v96：正在新增链接 / 文件。 */
  addBusy?: boolean
  /** v127：截止日期（YYYY-MM-DD，'' = 未设）。 */
  due: string
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const hhmm = (at: string): string => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const ICO_SPIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8"/></svg>'
const ICO_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>'
const ICO_MS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="6" height="6" rx="1.5"/><path d="m5.6 7.6 1.2 1.2 2-2.2M13 7.5h7M13 16.5h7"/><rect x="4" y="13.5" width="6" height="6" rx="1.5"/></svg>'
const ICO_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.9 12.2h8.6L17.2 7M10.2 10.6v5.4M13.8 10.6v5.4"/></svg>'
/** v136（2.3）：每项的垃圾桶 = 删除并解绑（第一下原地变红「确认删除」，3 秒内再点才执行）；原来的 × 仍 = 只和本任务解绑。 */
const delBtn = (kind: 'link' | 'file', id: string, name: string): string => {
  const tip = kind === 'link' ? '删除这条链接：从卡片里移除，并和本任务（以及别的任务）解绑' : '删除这个文件：移到废纸篓，并从卡片和本任务解绑'
  return '<button class="gt-del" type="button" data-gt-del="' + kind + ':' + esc(id) + '" aria-label="' + esc(tip + '：「' + name + '」') + '" title="' + esc(tip) + '">' + ICO_TRASH + '<span>确认删除</span></button>'
}
function dialogHtml(): string {
  const op = (attrs: string, icon: string, label: string, title: string): string =>
    '<button class="gt-op" type="button" ' + attrs + ' title="' + title + '">' + icon + label + '</button>'
  const card = (key: 'link' | 'file', label: string, empty: string, icon: string): string =>
    '<section class="gt-box gt-mini-card">'
    + '<div class="gt-box-h"><span class="gt-box-t">' + label + ' <span class="gt-n" data-gt-n="' + key + '">0</span></span><span class="grow"></span>'
    + op('data-gt-new="' + key + '"', ICO_PLUS, '新增', '和卡片详情页一样新增；保存后立刻加到卡片，并绑定到这个任务')
    + op('data-gt-pick="' + key + '" aria-expanded="false" aria-controls="dpmGtPop_' + key + '"', icon, '绑定', '从这张卡片已有的' + label.slice(2) + '里挑，勾选即绑定')
    + '<button class="gt-op gt-ms" type="button" data-gt-ms="' + key + '" aria-pressed="false" title="多选：勾选多' + (key === 'link' ? '条' : '个') + '后批量「删除并解绑」（也可以全选）">' + ICO_MS + '<span>多选</span></button>'
    + '</div><div class="gt-box-b gt-scroll"><div class="gt-chips" data-gt-chips="' + key + '"></div>'
    + '<p class="gt-empty" data-gt-empty="' + key + '">' + empty + '</p></div></section>'
  const pop = (key: 'link' | 'file', label: string, hint: string): string =>
    '<div class="gt-popv" id="dpmGtPop_' + key + '" hidden role="dialog" aria-label="绑定' + label + '">'
    + '<div class="gt-popv-h"><b>绑定' + label + '</b><span>' + hint + '</span></div>'
    + '<div class="gt-popv-l" data-gt-list="' + key + '"></div>'
    + '<div class="gt-popv-f"><span>勾选即绑定 · 再点一次取消</span><span class="grow"></span>'
    + '<button class="btn primary sm" type="button" data-gt-done="' + key + '">完成</button></div></div>'
  return '<dialog class="dpm-dialog dpm-goaltask" aria-labelledby="dpmGtT">'
    + '<div class="gt-shell">'
    + '<div class="gt-h"><span class="gt-ic" aria-hidden="true">' + ICON + '</span>'
    + '<h2 id="dpmGtT">添加卡片任务</h2>'
    + '<div class="gt-twrap">'
    + '<input class="gt-title" id="dpmGtTitle" type="text" maxlength="120" autocomplete="off" spellcheck="false" placeholder="任务标题"'
    + ' aria-label="任务标题（自动取说明的第一行；手动改过就不再跟随；留空用自动标题）" title="任务标题：自动取说明的第一行（去掉开头的 /goal），说明改了会跟着变；手动改过就不再自动；留空就用自动标题">'
    + '<button class="gt-gen" type="button" data-gt-gen aria-label="用「配置生成标题模型」选的模型把任务说明总结成标题">'
    + ICO_SPARK + '<span data-gt-gen-t>生成标题</span><span class="gt-gen-spin" data-gt-gen-spin hidden aria-hidden="true"></span></button>'
    + '<button type="button" class="v9cfg" data-gt-cfg aria-haspopup="listbox" aria-expanded="false" aria-label="配置生成标题模型"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/><path d="M10 10h4v4h-4zM9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/></svg><span class="t">配置生成标题模型</span></button>'
    + '</div>'
    + '<button class="gt-x" type="button" data-gt-x aria-label="关闭弹窗" title="关闭">' + ICO_X + '</button></div>'
    + '<div class="gt-genwhy" data-gt-genwhy hidden role="status"></div>'
    + '<div class="gt-meta"><span class="gt-m"><span class="k">卡片</span><b data-gt-card></b></span><span class="gt-dot" aria-hidden="true">·</span>'
    + '<span class="gt-m"><span class="k">卡片组</span><b data-gt-group></b></span>'
    /* v133（2.2）：状态标签跟在卡片组后面；放不下时 .gt-br 换行 → 第三行「截止 · 排今天 · 类型」左对齐 */
    + '<span id="dpmGtSt"></span><i class="gt-br" aria-hidden="true"></i>'
    + '<span class="grow"></span>'
    + '<span class="gt-due"><button type="button" class="v8due" aria-haspopup="dialog" aria-expanded="false" aria-label="截止日期"></button></span>'
    + '<span id="dpmGtSw"></span>'
    + '<label class="gt-type"><span class="k">类型</span><select class="gt-sel" id="dpmGtType" aria-label="任务类型"></select></label></div>'
    + '<div class="gt-main">'
    + '<section class="gt-box gt-desc">'
    + '<div class="gt-box-h"><span class="gt-box-t">任务说明</span><span class="gt-box-n" data-gt-noten>0 字</span><span class="gt-as" data-gt-as hidden role="status" aria-live="polite"></span><label class="gt-asw" data-gt-asw title="开：停 0.8 秒 / 输入法上屏 / 离开说明框就自动保存；关：只有点「保存」才写入"><button type="button" class="nksw" role="switch" aria-checked="true" data-gt-asws aria-label="任务说明自动保存"></button><span>自动保存</span></label><span class="grow"></span>'
    + '<button class="gt-op gt-dv" type="button" data-gt-dv aria-label="插入分割线" title="插入分割线：光标所在行没内容就插在这一行，有内容插到下一行；插完双击横线可以设置标题"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12h4.7M15.7 12h4.7"/><path d="M12 9.3v5.4M9.3 12h5.4"/></svg></button>'
    + '<button class="gt-op" type="button" data-gt-histopen aria-expanded="false" aria-controls="dpmGtHist" title="从本会话你发过的历史消息里多选，按点选顺序追加到说明末尾">'
    + ICO_HIST + '<span data-gt-histopen-t>从历史消息选择</span></button>'
    + '<span class="gt-undo-hint" aria-hidden="true"><kbd>⌘Z</kbd> 撤销 · <kbd>⇧⌘Z</kbd> 重做</span></div>'
    + '<div class="gt-box-b gt-desc-b">'
    + '<div class="gt-note" id="dpmGtNote" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" aria-label="任务说明" aria-describedby="dpmGtHint"></div>'
    + '<span class="gt-ph" data-gt-ph aria-hidden="true">把任务背景、目标、验收标准写在这里…（支持从历史消息选择 / &gt; 引用 / / 命令；左边的分割线按钮可在说明里插横线）</span>'
    + '<div class="gt-hist" id="dpmGtHist" hidden aria-label="从历史消息多选">'
    + '<div class="gt-hist-h"><button class="gt-hback" type="button" data-gt-histback aria-label="返回任务说明" title="返回任务说明">' + ICO_BACK + '</button>'
    + '<span class="t">选历史消息</span><span class="n" id="dpmGtHistN">从新到旧 · 按点选顺序填入</span>'
    + '<label class="gt-hist-q">' + ICO_Q + '<input id="dpmGtHistQ" type="search" placeholder="筛选消息…" aria-label="筛选历史消息" autocomplete="off" spellcheck="false"></label></div>'
    + '<div class="gt-sessrow" id="dpmGtSessRow" hidden>'
    + '<label class="k" for="dpmGtSess">会话</label>'
    + '<select class="gt-sesssel" id="dpmGtSess" aria-label="选择要读取历史消息的会话（只列活跃会话）"></select>'
    + '<span class="n" data-gt-sessn>只列活跃会话</span></div>'
    + '<div class="gt-hist-l" id="dpmGtHistList" role="listbox" aria-multiselectable="true" aria-label="你发过的消息，从新到旧；点选后按顺序追加到任务说明"></div>'
    + '<div class="gt-hist-f"><span class="sel" data-gt-histsel>已选 0 条 · 点一条开始选</span><span class="grow"></span>'
    + '<button class="btn ghost sm" type="button" data-gt-histclear disabled>清空</button>'
    + '<button class="btn primary sm" type="button" data-gt-histfill disabled>填入</button></div>'
    + '</div></div></section>'
    + '<div class="gt-pair">'
    + card('link', '相关链接', '还没有绑定链接。点「新增」直接在卡片里加一条；点「绑定」挑已有的。', ICO_LINK)
    + card('file', '相关文件', '还没有绑定文件。点「新增」从系统挑一个（或粘贴路径）；点「绑定」挑已有的。', ICO_FILE)
    + '</div>'
    + '<p class="gt-hint" id="dpmGtHint"><b>⌘Enter</b> 添加 · <b>Esc</b> 取消 · 说明框里可打 <b>&gt;</b> / <b>》</b> 引用卡片内容、<b>/</b> 插入命令（行首或空格后）· 引用胶囊复制 / 剪切时自动展开成引用项原文</p>'
    + '</div>'
    + '<div class="gt-nrow" data-gt-nrow hidden><button type="button" class="dpm-isw" role="switch" aria-checked="true" data-gt-ninj aria-label="自动注入 Agent 会话"></button><span><b>自动注入 Agent 会话</b> <small>开：关联这张卡片的会话在系统提示「卡片档案」里看得到这条说明；关：只留在看板，引用 / 打开照常</small></span><span class="grow"></span><span class="k" data-gt-ncnt></span></div>'
    + '<div class="gt-f"><span class="meta" data-gt-foot></span><span class="sp"></span>'
    + '<button class="btn" type="button" data-gt-cancel>取消</button><button class="btn primary" type="button" data-gt-add>添加</button></div>'
    + '</div>'
    + pop('link', '相关链接', '只列这张卡片还存在的链接')
    + pop('file', '相关文件', '只列本卡片还存在的文件')
    + '</dialog>'
}

export function mountGoalTask(opts: GoalTaskOpts): GoalTaskHandle {
  let dlg: HTMLDialogElement | null = null
  let cur: Open | null = null
  let ac: AbortController | null = null
  let warned = false
  /** v98 ②：引用菜单开着时每 2s 重读一次卡片数据（别的窗口 / AI 改了也能就地重画，滚动位置与高亮都保留）。 */
  let liveTimer = 0
  let refreshBusy = false
  /** v127：标题框输入法状态（compositionend 后 260ms 内的回车也算选词）。 */
  let imeOn = false
  let imeEnd = 0
  let dueUi: { paint(): void; close(): void } | null = null
  let cfgUi: { paint(): void; close(): void; isOpen(): boolean } | null = null
  const swToggleLocal = (): boolean => swToggle()

  const q = <T extends Element>(sel: string): T | null => (dlg?.querySelector(sel) as T | null) ?? null
  const note = (): HTMLTextAreaElement => q<HTMLElement>('#dpmGtNote') as unknown as HTMLTextAreaElement
  /** v101：说明框的块编辑器（分割线 / 光标行插入 / 双击改标题）。 */
  let nd: NoteDoc | null = null
  let na: NoteAssist | null = null

  /** v93：说明变了 → 未被手动改过的标题自动跟随（自动标题 = 新说明第一行去掉 /goal；说明空 → 清空回占位符）。 */
  function syncAutoTitle(): void {
    const c = cur
    if (!c || c.titleTouched) return
    const auto = autoTaskTitle(note().value)
    if (auto === c.titleAuto) return
    c.titleAuto = auto
    const t = q<HTMLInputElement>('#dpmGtTitle')
    if (t) t.value = auto
  }

  /* ── 打开弹窗 ── */
  function open(req: { text: string; cardId: string; sid?: string; mode?: 'add' | 'edit'; taskId?: string; parentId?: string; title?: string; note?: GoalTaskOpen['note'] }): void {
    const snap = opts.snapshot()
    const card = snap?.board.cards.find((c) => c.id === req.cardId)
    if (!snap || !card) { opts.toast('这张卡片已经不存在了', 'err'); return }
    const mode = req.mode ?? 'add'
    const origin: 'msg' | 'detail' = req.sid !== undefined ? 'msg' : 'detail'
    const active = opts.active?.() ?? []
    // v94：从详情打开时默认 = 打开详情时所在的会话；在看板里打开详情没有「当前会话」→
    // 用这张卡片最近活跃的会话（与会话信息卡同一份活跃口径），再退到全部活跃里的第一个。
    const here = opts.sessionId()
    const mine = active.flatMap((g) => g.items).find((it) => opts.cardFor(it.id) === card.id)
    const sid = req.sid ?? here ?? mine?.id ?? active[0]?.items[0]?.id ?? ''
    const found = mode === 'edit' && req.taskId ? findTask(card, req.taskId) : null
    const parent = req.parentId ? findTask(card, req.parentId)?.t ?? null : null
    if (mode === 'edit' && !found) { opts.toast('这条任务已经不存在了', 'err'); return }
    if (!dlg) {
      dlg = document.createElement('dialog')
      dlg.className = 'dpm-dialog dpm-goaltask'
      dlg.innerHTML = dialogHtml()
      document.body.append(dlg)
      bindDialog(dlg)
      /* v133（2.2）：弹窗 / 第二行任何一块宽度变了（拖窄窗口、截止胶囊换字、排今天开关出没）都重判一行还是三行 */
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => fitMeta())
        const m = dlg.querySelector('.gt-meta')
        if (m) { ro.observe(m); for (const x of Array.from(m.children)) ro.observe(x) }
      }
    }
    if (req.note && dlg?.open) { opts.toast('先关掉已经打开的任务窗口', 'err'); req.note.done?.(null); return }
    if (cur?.nm && !cur.nm.saved) { const f = cur.nm.done; cur.nm = null; f?.(null) }
    cur = {
      card, snap, origin, mode: req.note ? (req.note.k >= 0 ? 'edit' : 'add') : mode, sid, taskId: req.note ? null : (req.taskId ?? null), parent: req.note ? null : parent,
      nm: req.note ? { k: req.note.k, done: req.note.done, saved: false } : null,
      info: null, links: new Set(), files: new Set(), pop: '', picked: [], expanded: new Set(), filter: '',
      hist: false, hists: {}, menu: null, muted: null, titleAuto: '', titleTouched: mode === 'edit' || !!req.title, busy: false,
      gen: false, addBusy: false, due: mode === 'edit' ? (found?.t.due ?? '') : '', sess: mode === 'edit' ? (found?.t.sess ?? '') : '',
    }
    const raw = mode === 'edit' ? '' : req.text.trim()
    if (req.note) {
      /* v144（1）：说明模式 —— 标题 = 说明标题（key，留空取内容前 20 字），说明框 = 说明内容（同一个块编辑器 + 识别器） */
      cur.titleTouched = true
      q<HTMLInputElement>('#dpmGtTitle')!.value = req.note.t ?? ''
      note().value = req.note.v ?? ''
      q<HTMLElement>('[data-gt-ninj]')?.setAttribute('aria-checked', String(req.note.off !== true))
    } else if (mode === 'edit' && found) {
      q<HTMLInputElement>('#dpmGtTitle')!.value = found.t.text
      note().value = found.t.note ?? ''
      ;(found.t.links ?? []).forEach((id) => cur?.links.add(id))
      ;(found.t.files ?? []).forEach((id) => cur?.files.add(id))
    } else if (req.title) {
      /* v99：任务区内联输入行 →「编辑详情」：标题带着刚输入的字（说明留空） */
      cur.titleAuto = ''
      q<HTMLInputElement>('#dpmGtTitle')!.value = req.title.slice(0, 120)
      note().value = ''
    } else {
      cur.titleAuto = autoTaskTitle(raw)
      q<HTMLInputElement>('#dpmGtTitle')!.value = cur.titleAuto
      note().value = raw
    }
    const types = snap.board.taskTypes ?? ['开发', '验证', '文档', '沟通']
    const sel = q<HTMLSelectElement>('#dpmGtType')!
    const tval = mode === 'edit' ? (found?.t.type ?? '') : ''
    sel.innerHTML = '<option value=""' + (tval ? '' : ' selected') + '>无类型</option>' + types.map((t) => '<option' + (t === tval ? ' selected' : '') + '>' + esc(t) + '</option>').join('')
      + (tval && !types.includes(tval) ? '<option selected>' + esc(tval) + '</option>' : '')
    const g = snap.board.groups.find((x) => x.id === card.g)
    q<HTMLElement>('[data-gt-card]')!.textContent = card.t
    q<HTMLElement>('[data-gt-group]')!.textContent = g?.name ?? '（卡片组已删除）'
    paintMode()
    MS.link = null; MS.file = null; MSLAST.link = -1; MSLAST.file = -1; asPaint(''); asLast = null; window.clearTimeout(asT); asT = 0
    paintHist(); syncHistBtn(); chips('link'); chips('file'); closePops()
    paintFoot()
    paintNoteN(); paintGen(); paintSt(); dueUi?.close(); dueUi?.paint(); cfgUi?.close(); cfgUi?.paint(); tipOff(); asSw()
    if (!dlg.open) dlg.showModal()
    fitMeta()
    const start = mode === 'edit' ? note().value.length : 0
    setTimeout(() => { const n = note(); n.focus({ preventScroll: true }); n.setSelectionRange(start, start); n.scrollTop = 0 }, 40)
    // 缓存快照可能已过时（刚加的链接 / 刚放进去的文件）：后台拉一次最新，重画链接与文件
    void getState().then((fresh) => {
      if (!dlg?.open || !cur || cur.card.id !== card.id) return
      const c2 = fresh.board.cards.find((x) => x.id === card.id)
      if (!c2) return
      cur.card = c2
      cur.snap = fresh
      chips('link'); chips('file')
      if (cur.pop) list(cur.pop)
    }).catch(() => undefined)
    // 引用菜单的数据（任务 / 说明 / 链接 / 文件 / 仓库 / 关联卡片 / 活跃会话）与会话输入框同一份
    void loadInfo(sid)
  }

  /**
   * v98 ②：引用菜单的卡片数据 = 此刻快照里的「这张卡片」。
   * 不再走 getSession(sid).cardInfo —— 从详情打开时可能没有本卡片的会话，取到的是别的卡片的链接（实测 20 条 vs 2 条）。
   */
  function cardInfoNow(): NonNullable<SessionInfo['cardInfo']> | null {
    const c = cur
    if (!c) return null
    const snap = c.snap
    const card = snap?.board.cards.find((x) => x.id === c.card.id) ?? c.card
    if (!card) return null
    const g = snap?.board.groups.find((x) => x.id === card.g)
    const base = c.info?.cardInfo && c.info.cardInfo.id === card.id ? c.info.cardInfo : null
    const exists = (p: string): boolean => (snap?.files ? snap.files[p] !== false : true)
    return {
      id: card.id,
      stage: base?.stage ?? (g?.statuses.find((s) => s.id === card.col)?.name ?? ''),
      archived: !!card.archivedAt,
      repos: card.repos ?? [],
      tasks: card.tasks ?? [],
      notes: card.noteItems ?? [],
      links: card.webLinks ?? [],
      files: (card.files ?? []).map((f) => ({ id: f.id, path: f.path, title: f.title, exists: exists(f.path) })),
      related: (card.related ?? []).map((id) => snap?.board.cards.find((x) => x.id === id)).filter((x): x is Card => !!x).map((r) => {
        const rg = snap?.board.groups.find((x) => x.id === r.g)
        return { id: r.id, title: r.t, group: rg?.name ?? '', stage: rg?.statuses.find((x) => x.id === r.col)?.name ?? '', archived: !!r.archivedAt, dirs: [] }
      }),
      lfDirs: base?.lfDirs ?? [],
    }
  }
  /**
   * v98 ②：引用菜单 / 绑定列表读「此刻」的卡片数据 —— 重新拉一次看板快照，就地更新 cur.card / cur.snap；
   * 开着引用菜单时按新数据重画（paintMenu 会保留滚动位置与当前高亮行）。
   * 新增 / 解绑链接文件之后也会 await 一次，保证紧接着打开菜单看到的是最新列表与计数。
   */
  async function refreshInfo(): Promise<void> {
    const c = cur
    if (!c || refreshBusy) return
    const id = c.card.id
    refreshBusy = true
    try {
      const fresh = await getState()
      if (!dlg?.open || !cur || cur.card.id !== id) return
      const c2 = fresh.board.cards.find((x) => x.id === id)
      if (!c2) return
      cur.snap = fresh
      cur.card = c2
      if (cur.menu?.kind === 'quote') showMenu('quote', cur.menu.hit, quoteItems())
    } catch { /* 读不到就沿用现有快照，不假装有 */ } finally { refreshBusy = false }
  }
  function stopLive(): void { if (liveTimer) { clearInterval(liveTimer); liveTimer = 0 } }
  function startLive(): void {
    stopLive()
    liveTimer = window.setInterval(() => {
      if (!dlg?.open || !cur || cur.menu?.kind !== 'quote') { stopLive(); return }
      void refreshInfo()
    }, 2000)
  }
  function loadInfo(sid: string): void {
    if (!sid) return
    // 会话信息只补「落盘文件夹 / 会话行」这类会话侧事实；卡片数据一律用 cardInfoNow（快照）
    void getSession(sid).then((info) => { if (dlg?.open && cur && cur.sid === sid) cur.info = info }).catch(() => undefined)
  }

  /** v94：编辑 / 添加子任务时改标题、主按钮、说明提示、底栏文案。 */
  function paintMode(): void {
    const c = cur
    if (!c) return
    const edit = c.mode === 'edit'
    const ttl = q<HTMLElement>('#dpmGtT')
    if (ttl) ttl.textContent = edit ? '编辑卡片任务' : '添加卡片任务'
    const main = q<HTMLButtonElement>('[data-gt-add]')
    if (main) main.textContent = edit ? '保存' : '添加'
    const hint = q<HTMLElement>('#dpmGtHint')
    if (hint) hint.innerHTML = '<b>⌘Enter</b> ' + (edit ? '保存' : '添加') + ' · <b>Esc</b> 取消 · 说明框里可打 <b>&gt;</b> / <b>》</b> 引用卡片内容、<b>/</b> 插入命令（行首或空格后）' + (edit ? ' · 链接 / 文件改动即时保存' : '')
    const row = q<HTMLElement>('#dpmGtSessRow')
    if (row) row.hidden = c.origin !== 'detail'
    dlg?.setAttribute('data-mode', c.mode)
    dlg?.setAttribute('data-origin', c.origin)
    /* v144（1）：说明模式 —— 任务专属的部分（卡片 / 截止 / 类型行、生成标题、相关链接 / 文件卡、关联会话）不出现 */
    if (c.nm) dlg?.setAttribute('data-note', ''); else dlg?.removeAttribute('data-note')
    const ti = q<HTMLInputElement>('#dpmGtTitle')
    const nrow = q<HTMLElement>('[data-gt-nrow]'); if (nrow) nrow.hidden = !c.nm
    const bl = q<HTMLElement>('.gt-desc .gt-box-t'); if (bl) bl.textContent = c.nm ? '说明内容' : '任务说明'
    const ph = q<HTMLElement>('[data-gt-ph]'); if (ph) ph.textContent = c.nm ? '说明的正文…（和任务说明同一个输入框：⌘Z 撤销 / ⇧⌘Z 重做、从历史消息选择、> 引用、/ 命令、链接 / 路径识别、分割线）' : '把任务背景、目标、验收标准写在这里…（支持从历史消息选择 / > 引用 / / 命令；左边的分割线按钮可在说明里插横线）'
    if (ti) { ti.maxLength = c.nm ? 60 : 120; ti.placeholder = c.nm ? '说明标题（key）· 留空 = 取内容的前 20 个字' : '任务标题'; ti.setAttribute('aria-label', c.nm ? '说明标题' : '任务标题（自动取说明的第一行；手动改过就不再跟随；留空用自动标题）') }
    if (c.nm) {
      if (ttl) ttl.textContent = edit ? '编辑相关说明' : '添加相关说明'
      if (hint) hint.innerHTML = '<b>⌘Enter</b> ' + (edit ? '保存' : '添加') + ' · <b>Esc</b> 取消 · 说明框里可打 <b>&gt;</b> / <b>》</b> 引用卡片内容、<b>/</b> 插入命令' + (edit ? ' · 编辑时自动保存' : '')
    }
  }
  function paintFoot(): void {
    const c = cur
    const f = q<HTMLElement>('[data-gt-foot]')
    if (!c || !f) return
    if (c.nm) { f.innerHTML = (c.nm.k >= 0 ? '保存到「' : '添加到「') + '<b>' + esc(c.card.t) + '</b>」的相关说明'; return }
    /* v140（2）：删「保存到「…」的任务」→「关联卡片会话」按钮（上拉列表）；选了 = 状态图标 + 会话名 + 状态 + × 取消 */
    const D = sessDeps()
    const st = c.sess && D ? D.st(c.sess) : null
    const nm = c.sess && D ? D.title(c.sess) : ''
    f.innerHTML = '<span class="dpm-gff"><button type="button" class="dpm-gfb' + (st ? ' on s-' + st : '') + '" data-gt-sess aria-haspopup="listbox" aria-expanded="false" title="' + esc(st ? '已关联会话「' + nm + '」（' + SLB[st] + '）· 点一下更换' : '从这张卡片的会话里选一个，关联到这个任务') + '">'
      /* v151（1.2）：状态图标 = 执行安排卡片「会话执行中」同一套（.dpm-sst .ic：绿底白圈转圈 + 光带扫过，同一个全局相位） */
      + (st ? '<span class="dpm-sst dpm-gfst s-' + st + '"' + (st === 'run' || st === 'done' ? ' style="--dpm-ph:-' + (performance.now() % 2400).toFixed(0) + 'ms"' : '') + '><span class="ic">' + SIC[st] + '</span><span class="lb">' + SLB[st] + '</span></span><b>' + esc(nm) + '</b>' : SIC.link + '<span>关联卡片会话</span>') + SIC.up + '</button>'
      + (st ? '<button type="button" class="dpm-gfx" data-gt-sessx title="取消关联" aria-label="取消关联的会话">' + SIC.x + '</button>' : '')
      + '<span class="dpm-gfh">' + (st ? (c.mode === 'edit' ? '即时生效' : '随「添加」一起保存') : '一个任务只关联一个会话') + '</span></span>'
  }
  async function setSess(sid: string): Promise<void> {
    const c = cur; if (!c) return
    const D = sessDeps()
    if (c.mode === 'edit' && c.taskId) { if (D) await D.link(c.card.id, c.taskId, sid); c.sess = sid; paintFoot(); return }
    c.sess = sid; paintFoot()
    if (sid && D) { const st = D.st(sid); opts.toast('已选会话「' + D.title(sid) + '」，点「添加」后和任务一起保存'); if (st && st !== 'arch') void D.reveal([sid]) }
  }
  /** v127：类型左边的状态胶囊（编辑 = 今天所在分区；新任务 / 没排 = 「未计划」+ 排今天开关）。 */
  function paintSt(): void {
    const c = cur
    const box = q<HTMLElement>('#dpmGtSt')
    if (!c || !box) return
    const f = c.mode === 'edit' && c.taskId ? findTask(c.card, c.taskId) : null
    const z = f ? zoneOfKeys(f.parent ? ['s|' + c.card.id + '|' + f.t.id, 't|' + c.card.id + '|' + f.parent.id] : taskKeys(c.card.id, f.t, false)) : ''
    box.innerHTML = f ? stHtml(z, 'data-gt-st') : '<span class="v7st" data-z="none" aria-label="新任务还没排进今天"><i aria-hidden="true"></i><span>未计划</span></span>'
    const sw = q<HTMLElement>('#dpmGtSw')
    if (sw) sw.innerHTML = z ? '' : swHtml()
    fitMeta()
  }
  /** v133（2.2）：第二行放得下 = 一行；放不下（实际宽度判断）= 拆三行。窗口 / 弹窗宽度变了实时切换。 */
  function fitMeta(): void {
    const m = q<HTMLElement>('.gt-meta')
    if (!m || !m.clientWidth) return
    /* 量的时候卡片 / 卡片组名不许往下挤（.fit）：名字被挤成省略号也算放不下，否则窄弹窗永远「放得下」 */
    m.classList.remove('two'); m.classList.add('fit')
    const over = m.scrollWidth > m.clientWidth + 1
    m.classList.remove('fit')
    if (over) m.classList.add('two')
  }
  /** v96：说明字数。 */
  function paintNoteN(): void {
    const el = q<HTMLElement>('[data-gt-noten]')
    if (el) el.textContent = note().value.length + ' 字 · 不限字数'
    const n2 = q<HTMLElement>('[data-gt-ncnt]'); if (n2) n2.textContent = cur?.nm ? note().value.length + ' 字' : ''
  }
  /** v96：生成标题按钮：说明空 / 没有会话 / 正在生成 → 不干活，并说清为什么。 */
  function paintGen(): void {
    const c = cur
    const b = q<HTMLButtonElement>('[data-gt-gen]')
    if (!c || !b) return
    if (!c.gen && !c.genShown) { genWhy('', ''); c.genShown = true }
    const t = q<HTMLElement>('[data-gt-gen-t]')
    const spin = q<HTMLElement>('[data-gt-gen-spin]')
    const busy = !!c.gen
    if (t) t.textContent = busy ? '生成中…' : '生成标题'
    if (spin) spin.hidden = !busy
    b.classList.toggle('busy', busy)
    b.disabled = busy || !note().value.trim() || !tmLoad()
  }
  /** v120：标题行下一整行的原因条（重试中 / 失败原因 + 建议 / 重试成功）；kind = '' 隐藏。 */
  function genWhy(html: string, kind: '' | 'retry' | 'err' | 'ok'): void {
    const w = q<HTMLElement>('[data-gt-genwhy]')
    if (!w) return
    if (!html) { w.hidden = true; w.innerHTML = ''; return }
    w.hidden = false
    w.className = 'gt-genwhy' + (kind ? ' ' + kind : '')
    w.innerHTML = html
  }
  /** v96：生成标题（清空原值 → 生成中 → 填入；失败恢复原标题并点名）。 */
  async function genTitle(): Promise<void> {
    const c = cur
    if (!c || c.gen) return
    const text = note().value.trim()
    if (!text) { opts.toast('任务说明还是空的：先写点内容（或从历史消息选择），再生成标题', 'err'); return }
    const tm = tmLoad()
    if (!tm) { opts.toast('还没配置生成标题的模型：点「配置生成标题模型」选一个 dsh 已配置的模型', 'err'); return }
    const inp = q<HTMLInputElement>('#dpmGtTitle')!
    const before = inp.value
    c.gen = true
    c.titleTouched = true
    inp.value = ''
    inp.placeholder = '正在生成标题…'
    inp.classList.add('gen-wait')
    genWhy('', '')
    paintGen()
    try {
      const r = await goalTitle(c.sid, text, { provider: tm.provider, model: tm.id, effort: tm.effort })
      if (cur !== c) return
      /* v133（2.3）：写进标题框前再剥一次「标题：」前缀 / 引号（旧 host 未重启时也生效） */
      r.title = cleanTitle(r.title) || r.title
      inp.value = r.title
      inp.classList.remove('gen-wait')
      inp.classList.remove('gen-in')
      void inp.offsetWidth
      inp.classList.add('gen-in')
      if (r.retried) genWhy('第一轮没拿到正文，已自动重试一次（预算 400 → 1600 token、推理档关掉）后拿到：<b>' + esc(r.title) + '</b>', 'ok')
      opts.toast('已用 ' + tm.label + (tm.effortName ? '（' + tm.effortName + '）' : '') + ' 生成标题：「' + r.title + '」')
    } catch (e) {
      if (cur !== c) return
      inp.value = before
      inp.classList.remove('gen-wait')
      /* v120：失败原样透出 code / message，并给可操作建议；原标题保留 */
      const code = (e as { code?: string })?.code ?? 'LLM_FAILED'
      const msg = e instanceof Error ? e.message : String(e)
      const tip = code === 'TIMEOUT' ? '说明太长或网络慢；缩到几行再试。'
        : code === 'EMPTY_TITLE' ? '模型只回了思考、没给正文；已自动重试过一次，还是空就稍后再试。'
        : code === 'NO_PROVIDER' || code === 'NO_TITLE_MODEL' ? '点「配置生成标题模型」换一个 dsh 里可用的模型后再试。'
        : /AUTH|KEY|401|403/i.test(code + msg) ? '检查 DSH 设置里这个 provider 的 API Key，或在「配置生成标题模型」里换一个模型。'
        : '可以把任务说明写短一点，或稍后再试。'
      genWhy('这次没成：<b>' + esc(code) + '</b>「' + esc(msg) + '」。' + esc(tip), 'err')
      opts.toast('生成标题失败：' + msg, 'err')
    } finally {
      if (cur === c) { c.gen = false; inp.placeholder = '任务标题'; paintGen() }
    }
  }
  /** v96：新增链接 / 文件 —— 与卡片详情页同一个弹窗；保存后卡片与这个任务同时得到。 */
  async function addNew(kind: 'link' | 'file'): Promise<Array<WebLink | FileRef> | null> {
    const c = cur
    if (!c || c.addBusy) return null
    const fn = kind === 'link' ? opts.addLink : opts.addFile
    if (!fn) { opts.toast('当前版本没有接通「新增' + (kind === 'link' ? '链接' : '文件') + '」', 'err'); return null }
    c.addBusy = true
    try {
      const added = await fn(c.card.id)
      if (cur !== c || !added.length) return null
      // 弹窗里加完卡片快照变了（服务端回包已进 live.snap）：重新读一次，保证 chips / 绑定的 id 都在
      const fresh = await getState().catch(() => null)
      if (cur === c && fresh) {
        const c2 = fresh.board.cards.find((x) => x.id === c.card.id)
        if (c2) { c.card = c2; c.snap = fresh }
      }
      for (const it of added) {
        if (kind === 'link') { if (it.id) c.links.add(it.id) } else if (it.id) c.files.add(it.id)
      }
      // v98 ②：卡片的链接 / 文件变了 → 引用菜单的数据源也立刻刷新（不用关掉弹窗重开）
      await refreshInfo()
      chips(kind); list(kind)
      void syncBound(true)
      opts.toast(kind === 'link'
        ? '已新增 ' + added.length + ' 条链接到卡片，并已绑定到这个任务（已即时保存；取消任务不会删掉卡片里的链接）'
        : '已新增 ' + added.length + ' 个文件到卡片，并已绑定到这个任务（已即时保存；取消任务不会删掉卡片里的文件）')
      return added as Array<WebLink | FileRef>
    } catch (e) {
      opts.toast('新增失败：' + (e instanceof Error ? e.message : String(e)), 'err')
      return null
    } finally {
      if (cur === c) c.addBusy = false
    }
  }

  const linksOf = (): WebLink[] => (cur?.card.webLinks ?? []) as WebLink[]
  const filesOf = (): FileRef[] => cur?.card.files ?? []


  /* v97：编辑已存在的任务时，链接 / 文件的新增、解绑**即时保存**（不用再点「保存」）；
     点叉只和这个任务解绑 —— 卡片里的条目保留、文件也不删。 */
  async function syncBound(quiet = false): Promise<void> {
    const c = cur
    if (!c || c.mode !== 'edit' || !c.taskId) return
    const cardId = c.card.id
    const links = (c.card.webLinks ?? []).filter((l) => l.id && c.links.has(l.id)).map((l) => l.id as string)
    const files = (c.card.files ?? []).filter((f) => c.files.has(f.id)).map((f) => f.id)
    try {
      const fresh = await getState()
      const card = fresh.board.cards.find((x) => x.id === cardId)
      if (!card) return
      const next = JSON.parse(JSON.stringify(card.tasks)) as Task[]
      const f = findIn(next, c.taskId)
      if (!f) return
      if (links.length) f.t.links = links; else delete f.t.links
      if (files.length) f.t.files = files; else delete f.t.files
      await post<Snapshot>('card/tasks', { id: cardId, tasks: next })
      const after = await getState()
      if (cur === c) {
        c.snap = after
        c.card = after.board.cards.find((x) => x.id === cardId) ?? c.card
        chips('link'); chips('file')
        if (c.pop) list(c.pop)
      }
      opts.refresh?.()
    } catch (e) {
      if (!quiet) opts.toast('链接 / 文件没保存上：' + (e instanceof Error ? e.message : String(e)), 'err')
    }
  }

  /* ── 链接 / 文件：与详情页任务编辑同一套  /* ── 链接 / 文件：与详情页任务编辑同一套（胶囊 + 加号 → 弹层勾选 → 完成） ── */
  /* v137（2.1）多选模式（每张卡一份）：null = 没进多选；last = Shift 连选的锚点 */
  const MS: Record<'link' | 'file', Set<string> | null> = { link: null, file: null }
  const MSLAST: Record<'link' | 'file', number> = { link: -1, file: -1 }
  const MSARM: Record<'link' | 'file', number> = { link: 0, file: 0 }
  const MSBUSY: Record<'link' | 'file', boolean> = { link: false, file: false }
  const boundOf = (key: 'link' | 'file'): Array<{ id: string; name: string; sub: string; gone?: boolean }> => key === 'link'
    ? linksOf().filter((l) => l.id && cur?.links.has(l.id)).map((l) => ({ id: l.id as string, name: l.text, sub: l.url }))
    : filesOf().filter((f) => cur?.files.has(f.id)).map((f) => ({ id: f.id, name: fileName(f), sub: f.path, gone: cur?.snap.files?.[f.path] === false }))
  function msSet(key: 'link' | 'file', on: boolean): void {
    MS[key] = on ? new Set() : null; MSLAST[key] = -1
    const b = q<HTMLElement>('[data-gt-ms="' + key + '"]'); if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on) }
    chips(key)
  }
  /* v136（2.2）：一项一行顶满宽度 —— 序号 / 图标 + 名字（≤46%）+ 灰色网址 / 路径 + 按钮；多了在卡片里滚动 */
  function chips(key: 'link' | 'file'): void { chips0(key); paintPops() }
  function chips0(key: 'link' | 'file'): void {
    if (!cur) return
    const box = q<HTMLElement>('[data-gt-chips="' + key + '"]')
    const empty = q<HTMLElement>('[data-gt-empty="' + key + '"]')
    const n = q<HTMLElement>('[data-gt-n="' + key + '"]')
    if (!box) return
    const list = boundOf(key)
    const card = box.closest('.gt-mini-card') as HTMLElement | null
    const msb = q<HTMLButtonElement>('[data-gt-ms="' + key + '"]')
    if (empty) empty.hidden = list.length > 0
    if (n) n.textContent = String(list.length)
    const sel = MS[key]
    if (sel) {
      for (const id of [...sel]) if (!list.some((x) => x.id === id)) sel.delete(id)
      const k = sel.size, all = k === list.length && k > 0
      box.innerHTML = '<div class="gt-msbar" role="toolbar" aria-label="批量操作">'
        + '<label class="gt-msall"><input type="checkbox" data-gt-msall="' + key + '"' + (all ? ' checked' : '') + ' aria-label="全选"><span>全选</span></label>'
        + '<span class="gt-msn">已选 <b>' + k + '</b> / ' + list.length + '</span><span class="grow"></span>'
        + '<button type="button" class="gt-msgo' + (MSBUSY[key] ? ' busy' : MSARM[key] && Date.now() - MSARM[key] < 3000 ? ' arm' : '') + '" data-gt-msgo="' + key + '"' + (k && !MSBUSY[key] ? '' : ' disabled') + ' title="' + (key === 'link' ? '把选中的链接从卡片删除，并和所有任务解绑' : '把选中的文件移到废纸篓，并从卡片和所有任务解绑') + '">' + ICO_TRASH + '<span>' + (MSBUSY[key] ? '删除中… ' + k + ' 项' : MSARM[key] && Date.now() - MSARM[key] < 3000 ? '确认删除 ' + k + ' 项' : '删除并解绑' + (k ? ' ' + k : '')) + '</span></button>'
        + '<button type="button" class="gt-msdone" data-gt-msdone="' + key + '">完成</button></div>'
        + list.map((x, i) => '<label class="gt-chip gt-row gt-pick' + (key === 'file' ? ' fk' : '') + (sel.has(x.id) ? ' on' : '') + '" data-gt-id="' + esc(x.id) + '" data-gt-pk="' + key + ':' + esc(x.id) + '" data-i="' + i + '"><input type="checkbox" data-gt-pkc="' + key + ':' + esc(x.id) + '"' + (sel.has(x.id) ? ' checked' : '') + ' aria-label="选中「' + esc(x.name) + '」">'
          + (key === 'file' ? '<span class="fi">' + ICO_FILE + '</span>' : '<b>' + (i + 1) + '</b>') + '<span class="t">' + esc(x.name) + '</span><span class="s" title="' + esc(x.sub) + '">' + esc(x.sub) + '</span></label>').join('')
      const ac = box.querySelector('[data-gt-msall]') as HTMLInputElement | null; if (ac) ac.indeterminate = k > 0 && k < list.length
      card?.classList.add('ms')
      return
    }
    card?.classList.remove('ms')
    if (msb) msb.disabled = list.length < 1
    box.innerHTML = list.map((x, i) => '<span class="gt-chip gt-row' + (key === 'file' ? ' fk' : '') + (x.gone ? ' gone' : '') + '" data-gt-id="' + esc(x.id) + '">' + (key === 'file' ? '<span class="fi">' + ICO_FILE + '</span>' : '<b>' + (i + 1) + '</b>')
      + '<span class="t">' + esc(x.name) + '</span><span class="s" title="' + esc(x.sub) + '">' + esc(x.sub) + '</span>'
      + (key === 'file' && x.gone ? '' : delBtn(key, x.id, x.name))
      + '<button class="x" type="button" ' + (key === 'link' ? 'data-gt-un' : 'data-gt-unf') + '="' + esc(x.id) + '" aria-label="只和这个任务解绑「' + esc(x.name) + '」（卡片里保留）" title="只和这个任务解绑（卡片里保留' + (key === 'file' ? '这个文件，也不会删文件' : '这条链接') + '）">' + ICO_X + '</button></span>').join('')
  }
  /* v136 / v137：删除并解绑 —— 链接 = 从卡片删除（服务端同时和所有任务解绑）；文件 = 移到废纸篓并解绑；即时保存 */
  async function delItems(key: 'link' | 'file', ids: string[]): Promise<number> {
    const c = cur
    if (!c || !ids.length) return 0
    let n = 0
    try {
      if (key === 'link') {
        const fresh = await getState(); const card = fresh.board.cards.find((x) => x.id === c.card.id); if (!card) throw new Error('这张卡片已经不存在了')
        const left = (card.webLinks ?? []).filter((l) => !(l.id && ids.includes(l.id)))
        n = (card.webLinks ?? []).length - left.length
        await post<Snapshot>('card/weblinks', { id: card.id, links: left })
      } else {
        /* v151（5.2）：一次批量请求（以前逐个 card/files-trash，每个都整份写看板 + 整份快照） */
        let r: Snapshot & { result?: { items?: unknown[]; failed?: Array<{ path: string; error: string }> } }
        try { r = await post('card/files-trash-many', { id: c.card.id, files: ids }) }
        catch (e0) {
          /* host 还是旧进程（主实例没重启）：没有批量路由 → 退回逐个删，console 点名 */
          if (!(e0 instanceof ApiError && e0.code === 'NOT_FOUND' && /未知动作/.test(e0.message))) throw e0
          console.warn('[dsh-project-manager] host 没有 card/files-trash-many（旧进程，重启后生效），这次逐个删除')
          for (const id of ids) await post<Snapshot>('card/files-trash', { id: c.card.id, file: id })
          r = { result: { items: ids, failed: [] } } as unknown as typeof r
        }
        n = r.result?.items?.length ?? 0
        const bad = r.result?.failed ?? []
        if (bad.length) opts.toast(bad.length + ' 个文件没删成：' + bad.map((x) => (x.path.split('/').pop() || x.path) + '（' + x.error + '）').join('、'), 'err')
      }
    } catch (e) { opts.toast('删除失败：' + (e instanceof Error ? e.message : String(e)), 'err') }
    for (const id of ids) (key === 'link' ? c.links : c.files).delete(id)
    const after = await getState().catch(() => null)
    if (cur === c && after) { c.snap = after; c.card = after.board.cards.find((x) => x.id === c.card.id) ?? c.card }
    await refreshInfo()
    if (cur === c) { chips(key); if (c.pop === key) list(key); decorateChips() }
    opts.refresh?.()
    return n
  }
  function list(key: 'link' | 'file'): void {
    if (!cur) return
    const box = q<HTMLElement>('[data-gt-list="' + key + '"]')
    if (!box) return
    if (key === 'link') {
      const groups = cur.snap.board.linkTypeGroups ?? []
      box.innerHTML = linkBuckets(linksOf(), groups).map((g) => '<div class="gt-pop-g">' + esc(g.name) + '</div>'
        + g.items.map(({ l }) => '<label class="gt-pop-i"><input type="checkbox" data-gt-l="' + esc(l.id as string) + '"' + (cur?.links.has(l.id as string) ? ' checked' : '') + '>'
          + '<span class="txt"><span class="nm">' + esc(l.text) + '</span><span class="sub">' + (l.type ? esc(l.type) : '无类型') + '</span></span></label>').join('')).join('')
        || '<p class="gt-popv-e">这张卡片还没有相关链接。<br>点「新增」直接加一条，或去卡片详情里加。</p>'
    } else {
      const st = cur.snap.files ?? {}
      const pool = filesOf().filter((f) => st[f.path] !== false)
      box.innerHTML = pool.map((f) => '<label class="gt-pop-i"><input type="checkbox" data-gt-f="' + esc(f.id) + '"' + (cur?.files.has(f.id) ? ' checked' : '') + '>'
        + '<span class="pi">' + ICO_FILE + '</span><span class="txt"><span class="nm">' + esc(fileName(f)) + '</span><span class="sub">' + esc(f.path) + '</span></span></label>').join('')
        || '<p class="gt-popv-e">这张卡片还没有还存在的相关文件。<br>点「新增」从系统挑一个，或粘贴路径。</p>'
    }
  }
  function closePops(): void {
    if (!dlg) return
    if (cur) cur.pop = ''
    ;(['link', 'file'] as const).forEach((k) => {
      const pop = q<HTMLElement>('#dpmGtPop_' + k); if (pop) pop.hidden = true
      const b = q<HTMLElement>('[data-gt-pick="' + k + '"]'); if (b) b.setAttribute('aria-expanded', 'false')
    })
  }
  /** v96：绑定浮层 = 贴着按钮的 fixed 浮层（盖在内容上，不推挤布局、不改卡片尺寸）。 */
  function showPop(k: 'link' | 'file'): void {
    if (!cur) return
    const same = cur.pop === k
    closePops()
    if (same) return
    cur.pop = k
    const pop = q<HTMLElement>('#dpmGtPop_' + k)
    const btn = q<HTMLElement>('[data-gt-pick="' + k + '"]')
    if (!pop) return
    pop.hidden = false
    btn?.setAttribute('aria-expanded', 'true')
    list(k)
    const r = btn?.getBoundingClientRect()
    if (r) {
      const w = 356
      const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8))
      const top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 328))
      pop.style.width = w + 'px'
      pop.style.left = Math.round(left) + 'px'
      pop.style.top = Math.round(top) + 'px'
    }
  }

  /* ── ② 从历史消息多选（v94：详情来源多一行「会话选择」，列表 = 所选会话的完整历史，分页加载） ── */
  function histOf(sid: string): HistState {
    if (!cur) return histNew()
    if (!cur.hists[sid]) cur.hists[sid] = histNew()
    return cur.hists[sid]
  }
  async function loadPage(sid: string, before?: number): Promise<void> {
    const c = cur
    if (!c || !sid) return
    const st = histOf(sid)
    if (st.loading) return
    if (!before && (st.msgs.length || st.error)) { paintHist(); return }
    st.loading = true
    st.error = ''
    if (cur === c && c.hist && c.sid === sid) paintHist()
    try {
      const r = await getSessionMessages(sid, before ? { before } : {})
      if (cur !== c) return
      if (before) st.msgs = st.msgs.concat(r.messages)
      else st.msgs = r.messages
      st.total = r.total
      st.hasMore = r.hasMore
      st.before = r.before
    } catch (e) {
      if (cur !== c) return
      st.error = '读不到这个会话的历史消息：' + (e instanceof Error ? e.message : String(e))
    } finally {
      st.loading = false
      if (cur === c && c.hist && c.sid === sid) paintHist()
    }
  }
  function syncHistBtn(): void {
    const c = cur
    const on = !!c?.hist
    const b = q<HTMLElement>('[data-gt-histopen]')
    const t = q<HTMLElement>('[data-gt-histopen-t]')
    if (b) {
      b.setAttribute('aria-expanded', String(on))
      b.title = on ? '返回任务说明（已选的内容不会丢）'
        : c?.origin === 'detail' ? '从活跃会话的历史消息里多选：先选会话，再点选消息'
        : '从本会话你发过的历史消息里多选，按点选顺序追加到说明末尾'
    }
    if (t) t.textContent = on ? '返回任务说明' : '从历史消息选择'
  }
  /** v94：会话下拉 = 活跃会话（按卡片组分）；当前会话不在列表里就单列一组。 */
  function fillSessSelect(): void {
    const c = cur
    const sel = q<HTMLSelectElement>('#dpmGtSess')
    const n = q<HTMLElement>('[data-gt-sessn]')
    if (!c || !sel) return
    const groups = opts.active?.() ?? []
    let found = false
    const html = groups.map((g) => '<optgroup label="' + esc(g.name) + '">' + g.items.map((it) => {
      if (it.id === c.sid) found = true
      return '<option value="' + esc(it.id) + '"' + (it.id === c.sid ? ' selected' : '') + '>' + esc(it.title) + (it.id === c.sid ? '（当前）' : '') + '</option>'
    }).join('') + '</optgroup>').join('')
    const extra = !found && c.sid
      ? '<optgroup label="当前会话"><option value="' + esc(c.sid) + '" selected>' + esc(opts.sess?.(c.sid)?.title ?? '当前会话') + '（当前）</option></optgroup>'
      : ''
    sel.innerHTML = extra + html
    if (!found && !c.sid) sel.innerHTML = '<option value="">没有活跃会话</option>'
    const st = histOf(c.sid)
    if (n) n.textContent = '只列活跃会话 · ' + (st.total || st.msgs.length || 0) + ' 条历史'
  }
  function paintHist(): void {
    const c = cur
    const box = q<HTMLElement>('#dpmGtHistList')
    if (!c || !box) return
    // 键盘用户在列表里按空格 / 回车会重画列表：先记住当前焦点（整行或行里的「全文」按钮），画完还给它（否则焦点掉到 body，连按就失灵）
    const ae = document.activeElement instanceof HTMLElement && box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
    const aeKey = (ae?.closest?.('[data-gt-hm]') as HTMLElement | null)?.dataset.gtHm
    const aeFull = ae?.dataset?.gtHfull
    const sel = q<HTMLElement>('[data-gt-histsel]')
    const fill = q<HTMLButtonElement>('[data-gt-histfill]')
    const clear = q<HTMLButtonElement>('[data-gt-histclear]')
    const hn = q<HTMLElement>('#dpmGtHistN')
    const n = c.picked.length
    if (fill) fill.disabled = !n
    if (clear) clear.disabled = !n
    const st = histOf(c.sid)
    const sessN = new Set(c.picked.map((k) => k.split('#')[0])).size
    if (sel) sel.textContent = n
      ? '已选 ' + n + ' 条 · 按点选顺序追加到说明末尾' + (sessN > 1 ? '（来自 ' + sessN + ' 个会话）' : '')
      : '已选 0 条 · 点一条开始选'
    if (hn) hn.textContent = st.total || st.msgs.length ? '从新到旧 · 共 ' + st.total + ' 条' : '从新到旧 · 按点选顺序填入'
    if (!c.sid) { box.innerHTML = '<p class="gt-hist-e">没有活跃会话可以读取历史消息</p>'; return }
    if (st.loading && !st.msgs.length) { box.innerHTML = '<p class="gt-hist-e">正在读取历史消息…</p>'; return }
    if (st.error) { box.innerHTML = '<p class="gt-hist-e">' + esc(st.error) + '</p>'; return }
    const k = c.filter.trim().toLowerCase()
    const rows = k ? st.msgs.filter((m) => m.text.toLowerCase().includes(k)) : st.msgs
    if (!rows.length) { box.innerHTML = '<p class="gt-hist-e">' + (k ? '没有和「' + esc(c.filter) + '」匹配的消息' : '这个会话里还没有你发过的消息') + '</p>'; return }
    const body = rows.map((m) => {
      const key = hkey(c.sid, m.seq)
      const at = c.picked.indexOf(key) + 1
      const long = m.text.length > 140
      const full = c.expanded.has(key)
      return '<div class="gt-hrow" role="option" tabindex="0" aria-selected="' + (at > 0) + '" data-gt-hm="' + esc(key) + '">'
        + '<span class="gt-hn" aria-hidden="true">' + (at > 0 ? at : '') + '</span>'
        + '<span class="gt-hb"><span class="tx' + (full ? ' full' : '') + '">' + esc(m.text) + '</span>'
        + '<span class="mt"><span>#' + m.seq + '</span><span>' + esc(hhmm(m.at)) + '</span><span>' + m.text.length + ' 字</span>'
        + (long ? '<span class="grow"></span><button class="gt-hmore" type="button" data-gt-hfull="' + esc(key) + '">' + (full ? '收起' : '全文') + '</button>' : '')
        + '</span></span></div>'
    }).join('')
    const page = !k && st.hasMore
      ? '<button type="button" class="gt-hpage" data-gt-hpage>' + (st.loading ? '正在加载更早的消息…' : '加载更早的消息（共 ' + st.total + ' 条，已加载 ' + st.msgs.length + ' 条）') + '</button>'
      : ''
    box.innerHTML = body + page
    if (sel && k && rows.length !== st.msgs.length) sel.textContent += '（列表已筛选）'
    if (aeKey !== undefined) {
      const row = box.querySelector<HTMLElement>('[data-gt-hm="' + aeKey + '"]')
      const back = (aeFull !== undefined ? box.querySelector<HTMLElement>('[data-gt-hfull="' + aeFull + '"]') : null) ?? row
      if (back && document.activeElement !== back) back.focus({ preventScroll: true })
    }
  }
  function openHist(): void {
    const c = cur
    if (!c || !dlg) return
    c.hist = true
    note().hidden = true
    const box = q<HTMLElement>('#dpmGtHist')
    if (box) box.hidden = false
    if (c.origin === 'detail') fillSessSelect()
    syncHistBtn()
    paintHist()
    void loadPage(c.sid)
    setTimeout(() => { q<HTMLInputElement>('#dpmGtHistQ')?.focus({ preventScroll: true }) }, 30)
  }
  function closeHist(): void {
    const c = cur
    if (!c) return
    c.hist = false
    const box = q<HTMLElement>('#dpmGtHist')
    if (box) box.hidden = true
    note().hidden = false
    const f = q<HTMLInputElement>('#dpmGtHistQ')
    if (f) f.value = ''
    c.filter = ''
    syncHistBtn()
    paintHist()
  }
  /** 切会话：换列表与历史，**已选不清空**（可以跨会话挑）。 */
  function switchSess(sid: string): void {
    const c = cur
    if (!c || !sid || c.sid === sid) return
    c.sid = sid
    loadInfo(sid)
    fillSessSelect()
    paintHist()
    void loadPage(sid)
  }
  /** 填入 = 总是追加（从不覆盖说明框里已有的内容）；空行分隔、按点选顺序。 */
  function fillNote(): void {
    const c = cur
    if (!c || !c.picked.length) return
    const parts = c.picked.map((key) => {
      const cut = key.lastIndexOf('#')
      const sid = key.slice(0, cut), seq = Number(key.slice(cut + 1))
      return (c.hists[sid]?.msgs ?? []).find((m) => m.seq === seq)?.text ?? ''
    }).filter(Boolean)
    if (!parts.length) return
    const n = parts.length
    const sessN = new Set(c.picked.map((key) => key.slice(0, key.lastIndexOf('#')))).size
    const n0 = note()
    n0.value = appendNotes(n0.value, parts)
    syncAutoTitle()
    const end = n0.value.length
    c.picked = []
    closeHist()
    n0.focus()
    n0.setSelectionRange(end, end)
    paintHist()
    opts.toast('已按点选顺序追加 ' + n + ' 条历史消息' + (sessN > 1 ? '（来自 ' + sessN + ' 个会话）' : ''))
  }

  /* ── ③ 说明框里的引用 / 命令（与会话输入框同一套触发与数据） ───────── */
  function paraBefore(): { para: string; first: boolean } {
    const n = note()
    const v = n.value.slice(0, n.selectionStart)
    const nl = v.lastIndexOf('\n')
    return { para: v.slice(nl + 1), first: nl < 0 }
  }
  /** v97：引用菜单的条目口径（与会话输入框同一份 buildQuoteGroups，只补展示需要的序号 / 副行 / 右侧标签）。 */
  function quoteItems(): Mi[] {
    const ci = cardInfoNow()
    if (!ci) return []
    const info = { card: null, cardInfo: ci } as unknown as SessionInfo
    const src: QuoteSource = { info: () => info, active: () => opts.active?.() ?? [], sid: cur?.sid ?? '' }
    const groups: QGroup[] = buildQuoteGroups(src)
    const out: Mi[] = []
    for (const g of groups) for (const it of g.items) {
      const ins = it.text
      if (!ins) continue
      const mt = /^(\d+(?:\.\d+)?)[\u3000\s]+/.exec(it.name)
      const idx = mt ? mt[1] : undefined
      const t = mt ? it.name.slice(mt[0].length) : it.name
      const desc = plain(it.desc ?? '') || it.alias || ''
      if (g.t === '任务') out.push({ g: g.t, t, d: desc.replace(/^子任务 \d+\/\d+\s*/, '').trim(), ins, idx })
      else if (g.t === '相关说明') {
        const off = desc.includes('不注入')
        out.push({ g: g.t, t, d: off ? '不注入' : '', sub: desc.replace(/不注入/g, '').trim(), ins })
      } else out.push({ g: g.t, t, d: desc, ins })
    }
    return out
  }

  /* ── v111：任务说明里的引用胶囊（相关说明 / 链接 / 文件 / 仓库） ─────────── */
  /* v113：alts = 同一引用项的「另一种原文」（文件在/不在 → 有没有「已删除：」前缀）——
     说明里存下的是当时的写法，文件后来被删 / 改名后 canon 变了，只按当前 canon 找就会漏掉（用户报的「有时候不显示」）。 */
  /* v154：moved = 说明里写的是旧路径、但按 prev / 名字归一认到了卡片里的文件 —— 胶囊右上角挂个「已挪」小标
     （说明 / 气泡不走懒同步，原文要等「修复存量引用」或下次搬家才会变成新路径）。 */
  interface RefChip { kind: 'note' | 'link' | 'file' | 'repo'; id: string; title: string; body: string; canon: string; alts?: string[]; moved?: string; gone?: boolean }
  const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p
  function refChips(): RefChip[] {
    const c = cur
    if (!c) return []
    const out: RefChip[] = []
    for (const n of c.card.noteItems ?? []) out.push({ kind: 'note', id: n.t, title: n.t, body: n.v, canon: quoteNoteText(n.t, n.v) })
    for (const l of c.card.webLinks ?? []) out.push({ kind: 'link', id: l.id ?? l.url, title: l.text, body: l.url, canon: quoteLinkText({ id: l.id, text: l.text, type: l.type, url: l.url }) })
    for (const f of c.card.files ?? []) {
      const ex = c.snap.files?.[f.path] !== false
      const mk = (exists: boolean): string => quoteFileText({ id: f.id, path: f.path, title: f.title, exists })
      out.push({ kind: 'file', id: f.id, title: fileName(f), body: f.path, canon: mk(ex), alts: [mk(!ex)] })
    }
    for (const r of c.card.repos ?? []) out.push({ kind: 'repo', id: r.path, title: r.name, body: r.path, canon: quoteRepoText(r.name, r.path) })
    return out
  }
  /* v153：胶囊图标和 DSH 对话框 / 详情气泡同一套（chipicon.ts 一处定义）；文件仍按扩展名细分 */
  const chipIcon = (k: string): string => chipIconSvg(k)
  const chipIconOf = (it: { kind: string; body?: string }): string => chipIconSvg(it.kind, it.body)
  const chipTip = (k: string): string => k === 'note' ? '相关说明 · 点一下看 key-value 全文' : k === 'link' ? '相关链接 · 点一下用浏览器打开' : k === 'file' ? '相关文件 · 点一下用默认应用打开' : '仓库 · 点一下在访达里打开'
  function mkChip(it: RefChip, canonText?: string): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nref'
    span.contentEditable = 'false'
    span.tabIndex = 0
    span.setAttribute('role', 'button')
    span.dataset.rk = it.kind
    span.dataset.rid = it.id
    /* 复制 / 剪切时展开成「说明里那份原文」（可能是文件已删除的旧写法），不改成当前状态 */
    span.dataset.canon = canonText ?? it.canon
    if (it.kind === 'link' && (cur?.card.webLinks ?? []).some((l) => l.star && (l.id ?? l.url) === it.id)) span.classList.add('gold')
    if (it.moved) { span.classList.add('moved'); span.dataset.from = it.moved }
    /* v154：磁盘上真没有这个文件 = 和对话框同款「已不在」（存在但没加进卡片的仍然只是虚线「找不到」，不冒充已不在） */
    if (it.gone) span.classList.add('gone')
    span.title = (it.moved ? '这个文件已经挪到 ' + it.body + '（说明里写的还是旧路径，点「落盘 / 修复」后才改） · ' : '') + chipTip(it.kind) + '（' + it.canon + '）'
    span.innerHTML = '<span class="ri">' + chipIconOf(it) + '</span><span class="rt">' + esc(it.title) + '</span>'
    return span
  }
  /* v122（4.1）：引用文件按结构识别「“标题”（[已删除：]路径）」，不再要求和当前 canon 一字不差 ——
     主实例 82 个文件引用里 50 个对不上（8 个被挪进落盘项目 evidence/、42 个当初没绑到卡片）就露成原文。
     路径对上 / 文件名对上（被挪过）都正常显示；都对不上也显示成虚线「找不到」胶囊。 */
  const REF_FILE_RX = /「“([^”「」]*)”（(已删除：)?(\/[^）「」]*)）」/
  function refFileFind(title: string, path: string): FileRef | null {
    const fl = cur?.card.files ?? []
    /* v151（1.2）：以前的路径（prev）也认 —— 放到落盘项目 / 迁移后，说明里的旧路径引用照样是这个文件。
       v154（1.4）：名字只差空格 / 连字符也算（搬家把空格净化成连字符的经典情形），口径收在 quote.findRefFile。 */
    return findRefFile(fl, path) ?? fl.find((f) => fileName(f) === title) ?? null
  }
  /** 把说明里已有的引用项原文装饰成胶囊（只改 DOM，不改文本）。v122（4.2）：每个胶囊两侧都补零宽占位，行首 / 相邻胶囊之间也放得进光标。 */
  function decorateChips(): void { decorateChips0(); bindFromChips() }
  function decorateChips0(): void {
    const root = q<HTMLElement>('#dpmGtNote')
    if (!root) return
    const chips = refChips().filter((it) => it.kind !== 'file')
    const hadFocus = root.contains(document.activeElement) || document.activeElement === root
    const caret = hadFocus ? note().selectionStart : -1
    let n = 0
    for (const blk of Array.from(root.children) as HTMLElement[]) {
      if (blk.dataset.b !== 't') continue
      let guard = 0
      while (guard++ < 80) {
        let hit: { node: Text; i: number; it: RefChip; len: number; miss?: boolean; path?: string } | null = null
        for (const node of Array.from(blk.childNodes)) {
          if (node.nodeType !== 3) continue
          const txt = node.textContent ?? ''
          for (const it of chips) {
            for (const vari of [it.canon, ...(it.alts ?? [])]) {
              const i = txt.indexOf(vari)
              if (i < 0) continue
              if (!hit || i < hit.i || (i === hit.i && vari.length > hit.len)) hit = { node: node as Text, i, it, len: vari.length }
            }
          }
          const m = REF_FILE_RX.exec(txt)
          if (m && (!hit || m.index < hit.i)) {
            const f = refFileFind(m[1], m[3])
            const ex = f ? cur?.snap.files?.[f.path] !== false : false
            /* 挪过地方：胶囊原文换成现在的路径（存盘 / 复制 / 发给 Agent 都是新路径） */
            const moved = !!f && ex && f.path !== m[3]
            /* 「已不在」只标我们确知的：这个文件还在卡片里，但磁盘上已经没有了（快照里有它的存在状态）；
               没加进卡片的路径不查磁盘、也不冒充「已不在」——保持原来的虚线「找不到」。 */
            const gone = !!(f && !ex)
            hit = { node: node as Text, i: m.index, len: m[0].length, miss: !f || !ex, path: moved ? (f as FileRef).path : m[3], it: { kind: 'file', id: f?.id ?? '', title: (f ? refTitle(f) : '') || m[1] || baseName(m[3]), body: moved ? (f as FileRef).path : m[3], moved: moved ? m[3] : undefined, gone: !!gone, canon: moved ? '「“' + refTitle(f as FileRef) + '”（' + (f as FileRef).path + '）」' : m[0] } }
          }
        }
        if (!hit) break
        const txt = hit.node.textContent ?? ''
        const before = txt.slice(0, hit.i), after = txt.slice(hit.i + hit.len)
        const frag = document.createDocumentFragment()
        frag.appendChild(document.createTextNode(before || ZW))
        const chip = mkChip(hit.it, txt.slice(hit.i, hit.i + hit.len))
        if (hit.path) chip.dataset.path = hit.path
        if (hit.miss) { chip.classList.add('miss'); chip.title = '这个文件没有绑定在卡片上（或已经不在原处）· 点一下看怎么处理（' + hit.it.canon + '）' }
        frag.appendChild(chip)
        frag.appendChild(document.createTextNode(after || ZW))
        blk.replaceChild(frag, hit.node)
        n++
      }
      for (const c of Array.from(blk.querySelectorAll(':scope > .nref'))) {
        if (!c.previousSibling || c.previousSibling.nodeType !== 3) c.before(document.createTextNode(ZW))
        if (!c.nextSibling || c.nextSibling.nodeType !== 3) c.after(document.createTextNode(ZW))
      }
    }
    if (n && caret >= 0) { try { note().setSelectionRange(caret, caret) } catch { /* ignore */ } }
  }
  /**
   * v140（5.1）：说明里出现指向卡片已有链接 / 文件的胶囊（引用菜单、粘贴、手打原文、「使用引用内容」都算）→ 立即关联到这个任务，
   * 右下卡片里那条闪一下 + 提示；编辑 = 即时生效（同「绑定」），新增 = 随添加保存。删胶囊不解绑（解绑仍用 ×）。
   */
  /* 闪一下的条目：重画（syncBound 回包）后照样闪完 */
  const popUntil = new Map<string, number>()
  function paintPops(): void { const now = Date.now(); for (const [k, t] of [...popUntil]) { if (t < now) { popUntil.delete(k); continue } const [kk, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; const el = q<HTMLElement>('[data-gt-chips="' + kk + '"] [data-gt-id="' + CSS.escape(id) + '"]'); if (el && !el.classList.contains('dpm-gtpop')) { el.classList.add('dpm-gtpop'); el.style.animationDelay = -(1200 - (t - now)) + 'ms' } } }
  function bindFromChips(): void {
    const c = cur; const root = q<HTMLElement>('#dpmGtNote'); if (!c || !root) return
    /* v144（1）：「引用即关联」只对任务有效 —— 说明模式里插链接 / 文件不绑到任务上 */
    if (c.nm) return
    const got: Array<{ k: 'link' | 'file'; id: string; t: string }> = []
    for (const ch of Array.from(root.querySelectorAll<HTMLElement>('.nref'))) {
      const k = ch.dataset.rk, id = ch.dataset.rid ?? ''
      if (!id || ch.classList.contains('miss')) continue
      if (k === 'link' && (c.card.webLinks ?? []).some((l) => l.id === id) && !c.links.has(id)) { c.links.add(id); got.push({ k: 'link', id, t: ch.textContent ?? '' }) }
      if (k === 'file' && (c.card.files ?? []).some((f) => f.id === id) && !c.files.has(id)) { c.files.add(id); got.push({ k: 'file', id, t: ch.textContent ?? '' }) }
    }
    if (!got.length) return
    if (got.some((x) => x.k === 'link')) chips('link')
    if (got.some((x) => x.k === 'file')) chips('file')
    if (c.mode === 'edit') void syncBound(true)
    const until = Date.now() + 1200
    for (const x of got) popUntil.set(x.k + ':' + x.id, until)
    requestAnimationFrame(() => paintPops())
    ;(window as unknown as Record<string, unknown>).__dpmGtBound = { got, at: Date.now() }
    opts.toast('说明里引用了' + got.map((x) => '「' + x.t + '」').join('、') + '：已关联到这个任务的相关' + (got.every((x) => x.k === 'link') ? '链接' : got.every((x) => x.k === 'file') ? '文件' : '链接 / 文件') + (c.mode === 'edit' ? '' : '（随「添加」一起保存）'))
  }
  const ZW = '\u200b'
  let noteTip: HTMLElement | null = null
  function hideNoteTip(): void {
    if (!noteTip) return
    const on = dlg?.querySelector('.nref.on') as HTMLElement | null
    if (on) on.classList.remove('on')
    noteTip.remove()
    noteTip = null
  }
  function showNoteTip(chip: HTMLElement, title: string): void {
    hideNoteTip()
    const d = dlg
    const n = (cur?.card.noteItems ?? []).find((x) => x.t === title)
    if (!d || !n) { opts.toast('这条相关说明已经不在了', 'err'); return }
    const el = document.createElement('div')
    el.className = 'nref-pop'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', '相关说明：' + n.t)
    el.innerHTML = '<div class="nph"><span class="npi">' + ICO_NOTE + '</span><b>' + esc(n.t) + '</b><span class="npt">相关说明</span></div>'
      + '<p class="npb">' + esc(n.v) + '</p><div class="npf"><kbd>Esc</kbd> 关闭 · 复制这个胶囊 = 引用项原文</div>'
    d.append(el)
    const hr = d.getBoundingClientRect(), cr = chip.getBoundingClientRect()
    const left = Math.round(Math.max(8, Math.min(cr.left - hr.left + (d.clientLeft || 0), hr.width - el.offsetWidth - 8)))
    el.style.left = left + 'px'
    /* v111：小箭头指向胶囊（原型 .nref-pop::before + --ax） */
    el.style.setProperty('--ax', Math.round(Math.max(10, Math.min(cr.left + cr.width / 2 - hr.left - left, el.offsetWidth - 20))) + 'px')
    let top = cr.bottom - hr.top + (d.clientTop || 0) + 8
    if (top + el.offsetHeight + 12 > hr.height) top = Math.max(8, cr.top - hr.top - el.offsetHeight - 8)
    el.style.top = Math.round(top) + 'px'
    el.classList.toggle('up', cr.bottom - hr.top + el.offsetHeight + 20 > hr.height)
    noteTip = el
    chip.classList.add('on')
  }
  function openChip(chip: HTMLElement): void {
    const kind = chip.dataset.rk ?? ''
    const rid = chip.dataset.rid ?? ''
    const card = cur?.card
    if (!card) return
    if (kind === 'note') { showNoteTip(chip, rid); return }
    hideNoteTip()
    if (kind === 'link') {
      const l = (card.webLinks ?? []).find((x) => (x.id ?? x.url) === rid)
      if (!l) { opts.toast('这条链接已经不在了', 'err'); return }
      window.open(l.url, '_blank', 'noopener')
      return
    }
    if (kind === 'file') {
      /* v122（4.3）：按 id → 路径 → 文件名依次找（host 兜底）；真找不到弹一个小卡片说明原因并给出能做的事 */
      const path = chip.dataset.path ?? ''
      const name = (chip.querySelector('.rt')?.textContent ?? '').trim()
      void openFileSmart({ card: card.id, file: rid, path, name })
        .then((r) => { if (r.moved) opts.toast('文件已挪到 ' + r.path + '，' + (r.how === 'rightbar' ? '已在 DSH 右侧栏打开' : '已用默认应用打开')); else if (r.how === 'rightbar') opts.toast('已在 DSH 右侧栏打开「' + name + '」') })
        .catch((e) => missPop(chip, path || name, e instanceof Error ? e.message : String(e)))
      return
    }
    const r = (card.repos ?? []).find((x) => x.path === rid)
    if (!r) { opts.toast('这个仓库已经不在了', 'err'); return }
    void post('fs/reveal', { path: r.path, folder: true }).catch((e) => opts.toast('打不开这个仓库：' + (e instanceof Error ? e.message : String(e)), 'err'))
  }
  /** v122（4.3）：文件胶囊打不开 → 小卡片：原因 + 「绑定到这张卡片」「在访达里找同名文件」 */
  function missPop(chip: HTMLElement, path: string, why: string): void {
    hideNoteTip()
    const d = dlg
    if (!d) return
    const el = document.createElement('div')
    el.className = 'nref-pop miss'
    el.setAttribute('role', 'dialog')
    const nm = baseName(path)
    el.innerHTML = '<div class="nph"><span class="npi">' + ICO_FILE + '</span><b>' + esc(nm) + '</b><span class="npt">打不开</span></div>'
      + '<p class="npb">' + esc(why) + '</p>'
      + '<div class="npa">' + (path.startsWith('/') ? '<button type="button" class="btn sm" data-miss-bind>绑定到这张卡片</button>' : '') + '<button type="button" class="btn sm" data-miss-reveal>在访达里找同名文件</button></div>'
      + '<div class="npf"><kbd>Esc</kbd> 关闭 · 胶囊里的原文不会被改</div>'
    d.append(el)
    const hr = d.getBoundingClientRect(), cr = chip.getBoundingClientRect()
    const left = Math.round(Math.max(8, Math.min(cr.left - hr.left, hr.width - el.offsetWidth - 8)))
    el.style.left = left + 'px'
    el.style.setProperty('--ax', Math.round(Math.max(10, Math.min(cr.left + cr.width / 2 - hr.left - left, el.offsetWidth - 20))) + 'px')
    el.style.top = Math.round(cr.bottom - hr.top + 8) + 'px'
    noteTip = el
    chip.classList.add('on')
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-miss-bind]')) {
        hideNoteTip()
        const c = cur
        if (!c) return
        void post('card/files-add', { id: c.card.id, items: [path] }).then(async () => {
          const fresh = await getState().catch(() => null)
          if (cur === c && fresh) { const c2 = fresh.board.cards.find((x) => x.id === c.card.id); if (c2) { c.card = c2; c.snap = fresh } }
          const nd2 = q<HTMLElement>('#dpmGtNote'); if (nd2) { const v = note().value; note().value = v; decorateChips() }
          opts.toast('已把「' + nm + '」绑定到卡片（相关文件 +1），胶囊现在能直接打开')
        }).catch((er) => opts.toast('绑定失败：' + (er instanceof Error ? er.message : String(er)), 'err'))
        return
      }
      if (t.closest('[data-miss-reveal]')) {
        hideNoteTip()
        const dir = path.replace(/\/[^/]*$/, '')
        void post('fs/reveal', { path: dir || path, folder: true }).catch(() => opts.toast('访达里找不到这个文件夹：' + (dir || path), 'err'))
      }
    })
  }
  /** 说明里框选的文字（含胶囊）→ 纯文本；胶囊按引用项原文展开。没有胶囊返回 null（走系统默认）。 */
  function noteSelText(): string | null {
    const root = q<HTMLElement>('#dpmGtNote')
    const sel = document.getSelection()
    if (!root || !sel || !sel.rangeCount || sel.isCollapsed) return null
    const r = sel.getRangeAt(0)
    if (!root.contains(r.commonAncestorContainer)) return null
    const chips = Array.from(root.querySelectorAll('.nref')) as HTMLElement[]
    if (!chips.some((c) => r.intersectsNode(c))) return null
    const frag = r.cloneContents()
    const textOf = (node: Node): string => {
      if (node.nodeType === 3) return (node.textContent ?? '').split(ZW).join('')
      const el = node as HTMLElement
      if (el.classList?.contains('nref')) return el.dataset.canon ?? el.textContent ?? ''
      if (el.tagName === 'BR') return '\n'
      let out = ''
      for (const ch of Array.from(node.childNodes)) out += textOf(ch)
      if (el.classList?.contains('nline') || el.classList?.contains('nblk')) out += '\n'
      return out
    }
    let out = ''
    for (const ch of Array.from(frag.childNodes)) out += textOf(ch)
    return out.replace(/\u00a0/g, ' ').replace(/\n+$/, '')
  }
  let copyPrev: HTMLElement | null = null
  function showCopyPreview(txt: string): void {
    const d = dlg
    if (!d) return
    if (copyPrev) copyPrev.remove()
    const el = document.createElement('div')
    el.className = 'vcopy'
    el.innerHTML = '<div class="vch"><b>剪贴板（引用项原文）</b><span>' + txt.length + ' 字</span></div><pre class="vcb">' + esc(txt.length > 420 ? txt.slice(0, 420) + '…' : txt) + '</pre>'
    d.append(el)
    copyPrev = el
    window.setTimeout(() => { if (copyPrev === el) { el.remove(); copyPrev = null } }, 5200)
  }
  function onCopyCut(e: ClipboardEvent): void {
    const txt = noteSelText()
    if (txt == null) return
    e.preventDefault()
    try { e.clipboardData?.setData('text/plain', txt) } catch { /* ignore */ }
    if (e.type === 'cut') { try { document.execCommand('delete') } catch { /* ignore */ } }
    showCopyPreview(txt)
    opts.toast((e.type === 'cut' ? '已剪切 ' : '已复制 ') + txt.length + ' 字 · 胶囊位置已展开成引用项原文')
  }
  /* 引用弹窗里的「新增并引用」一行 */
  function qAddRow(): string {
    const b = (k: string, text: string): string => '<button type="button" class="qadd" data-gt-qadd="' + k + '" title="新增并引用：' + text + '">' + chipIcon(k) + '<span>' + text + '</span></button>'
    return '<div class="gt-qadd" role="toolbar" aria-label="在引用弹窗里直接新增并插入引用胶囊"><span class="qgl">新增并引用</span>'
      + b('note', '+说明') + b('link', '+链接') + b('file', '+文件') + b('repo', '+仓库')
      + '<span class="qgh">插入光标处 · 链接 / 文件自动关联这个任务</span></div>'
  }
  let qaddLen = 0
  /* v117 修（开工 5.2）：点「新增并引用」会先开一个模态弹窗 / 文件选择器，焦点离开说明框后
     selectionStart 归零，insertRefText 就变成「插到最末尾」、而且那个「>」还留在正文里。
     所以在菜单打开的那一刻把光标位置记下来，插入时优先用它。 */
  let qaddCaret = -1
  function insertRefText(text: string): void {
    const n = note()
    const caret = qaddCaret >= 0 ? qaddCaret : n.selectionStart
    const start = Math.max(0, caret - qaddLen)
    n.value = n.value.slice(0, start) + text + n.value.slice(caret)
    n.setSelectionRange(start + text.length, start + text.length)
    qaddLen = 0; qaddCaret = -1
    decorateChips()
    syncAutoTitle()
    n.focus()
  }
  async function startQuoteAdd(kind: 'note' | 'link' | 'file' | 'repo'): Promise<void> {
    const m = cur?.menu
    if (!m) return
    qaddLen = m.hit.len
    qaddCaret = note().selectionStart
    hideMenu()
    if (kind === 'link' || kind === 'file') {
      const added = await addNew(kind)
      if (!added?.length) return
      const freshCard = cur?.card
      const texts = added.map((x) => {
        if (kind === 'link') return quoteLinkText({ id: (x as WebLink).id, text: (x as WebLink).text, type: (x as WebLink).type, url: (x as WebLink).url })
        /* 板里 addFilesForTask 只回 id：路径 / 标题从刚刷新过的卡片里取，别用空对象拼出一对空引号 */
        const id = (x as FileRef).id
        const f = (freshCard?.files ?? []).find((y) => y.id === id)
        return quoteFileText({ id, path: f?.path ?? '', title: f?.title, exists: f ? cur?.snap.files?.[f.path] !== false : true })
      })
      insertRefText(texts.join(' '))
      opts.toast('已插入 ' + added.length + ' 个引用胶囊（' + (kind === 'link' ? '链接' : '文件') + '已自动关联这个任务）')
      return
    }
    if (kind === 'note') openRefDlg('note')
    else openRefDlg('repo')
  }
  function refDlg(): HTMLDialogElement {
    let d = document.getElementById('dpmGtRef') as HTMLDialogElement | null
    if (d) return d
    d = document.createElement('dialog')
    d.id = 'dpmGtRef'
    d.className = 'dpm-dialog'
    d.setAttribute('aria-labelledby', 'dpmGtRefT')
    d.innerHTML = '<form method="dialog"><div class="dlg-h"><h2 id="dpmGtRefT">添加相关说明</h2><p id="dpmGtRefS"></p></div>'
      + '<div class="dlg-b"><label class="ref-l"><span id="dpmGtRefL1">说明标题（key）</span><input id="dpmGtRefA" maxlength="60" autocomplete="off"></label>'
      + '<label class="ref-l"><span id="dpmGtRefL2">说明内容（value）</span><textarea id="dpmGtRefB" rows="3"></textarea></label><div id="dpmGtRefInj"></div></div>'
      + '<div class="dlg-f"><span class="meta">保存后：加到卡片 + 在任务说明里插一个可点的引用胶囊</span><span class="sp"></span>'
      + '<button class="btn" type="button" data-ref-cancel>取消</button><button class="btn primary" type="button" data-ref-ok>添加并引用</button></div></form>'
    document.body.append(d)
    d.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-ref-cancel]')) { d!.close(''); return }
      if (t.closest('[data-ref-ok]')) void saveRefAdd(d!)
      const sw = t.closest('[data-dpm-inj]') as HTMLElement | null
      if (sw) { e.preventDefault(); sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')) }
    })
    return d
  }
  function openRefDlg(kind: 'note' | 'repo'): void {
    const d = refDlg()
    d.dataset.kind = kind
    const isNote = kind === 'note'
    const set = (id: string, text: string): void => { const el = d.querySelector('#' + id); if (el) (el as HTMLElement).textContent = text }
    set('dpmGtRefT', isNote ? '添加相关说明' : '添加仓库')
    set('dpmGtRefS', isNote
      ? '保存后会加到这张卡片的「相关说明」，并在任务说明的光标处插一个可点击的引用胶囊。'
      : '保存后会加到这张卡片的「仓库」，并在任务说明的光标处插一个可点击的引用胶囊（点胶囊 = 在访达里打开）。')
    set('dpmGtRefL1', isNote ? '说明标题（key）' : '仓库名字')
    set('dpmGtRefL2', isNote ? '说明内容（value）' : '仓库路径（绝对路径）')
    const a = d.querySelector('#dpmGtRefA') as HTMLInputElement | null
    const b = d.querySelector('#dpmGtRefB') as HTMLTextAreaElement | null
    if (a) a.value = ''
    if (b) b.value = ''
    /* v136 / v137：底部「自动注入 Agent 会话」开关卡；说明 / 仓库新增默认开 */
    const ij = d.querySelector('#dpmGtRefInj'); if (ij) ij.innerHTML = injCard('dpmGtRefSw', true)
    if (!d.open) d.showModal()
    window.setTimeout(() => { try { a?.focus() } catch { /* ignore */ } }, 40)
  }
  async function saveRefAdd(d: HTMLDialogElement): Promise<void> {
    const c = cur
    const kind = d.dataset.kind === 'repo' ? 'repo' : 'note'
    const a = d.querySelector('#dpmGtRefA') as HTMLInputElement | null
    const b = d.querySelector('#dpmGtRefB') as HTMLTextAreaElement | null
    const t = (a?.value ?? '').trim(), v = (b?.value ?? '').trim()
    const inj = d.querySelector('#dpmGtRefSw')?.getAttribute('aria-checked') !== 'false'
    if (!c) { d.close(''); return }
    if (!t) { a?.focus(); opts.toast('先填标题', 'err'); return }
    try {
      const fresh = await getState()
      const card = fresh.board.cards.find((x) => x.id === c.card.id)
      if (!card) throw new Error('这张卡片已经不存在了')
      if (kind === 'note') {
        if ((card.noteItems ?? []).some((x) => x.t === t)) { opts.toast('已经有一条同名说明了', 'err'); return }
        await post<Snapshot>('card/noteitems', { id: card.id, items: [...(card.noteItems ?? []), { t, v, ...(inj ? {} : { off: true }) }] })
      } else {
        if (v.charAt(0) !== '/') { b?.focus(); opts.toast('仓库路径要以 / 开头', 'err'); return }
        if ((card.repos ?? []).some((x) => x.path === v)) { opts.toast('已经有这个仓库了', 'err'); return }
        await post<Snapshot>('card/repos-add', { id: card.id, repos: [{ name: t, path: v, role: '', ...(inj ? {} : { off: true }) }] })
      }
      const after = await getState().catch(() => null)
      if (cur === c && after) {
        c.snap = after
        c.card = after.board.cards.find((x) => x.id === card.id) ?? c.card
      }
      d.close('ok')
      insertRefText(kind === 'note' ? quoteNoteText(t, v) : quoteRepoText(t, v))
      opts.refresh?.()
      opts.toast((kind === 'note' ? '已添加相关说明「' + t + '」并插入引用胶囊' : '已添加仓库「' + t + '」并插入引用胶囊') + ' · ' + (inj ? '自动注入 Agent 会话' : '不注入 Agent 会话'))
    } catch (e) {
      opts.toast('新增失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    }
  }
  async function cmdItems(query: string, hit: { len: number; query: string }, prev: Menu | null): Promise<void> {
    const srcs = opts.slashSources?.() ?? []
    if (!srcs.length) {
      if (!warned) { warned = true; console.warn('[dsh-project-manager] 拿不到宿主的 / 数据源（inputTriggers），说明框里的命令菜单不弹；命令仍然可以直接打字') }
      hideMenu()
      return
    }
    ac?.abort()
    const mine = new AbortController()
    ac = mine
    const sid = cur?.sid ?? ''
    const LAB: Record<string, string> = { command: '命令', skill: '技能' }
    const out: Mi[] = []
    for (const s of srcs.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      if (!s.candidates) continue
      let rows: Array<{ name?: string; description?: string; label?: string }> = []
      try { rows = await s.candidates({ sessionId: sid }, { query: hit.query, signal: mine.signal, position: 'leading' }) } catch (e) { if (!mine.signal.aborted) console.warn('[dsh-project-manager] / 数据源 ' + s.name + ' 读取失败：', e); continue }
      if (mine.signal.aborted) return
      for (const r of rows) {
        if (!r?.name) continue
        out.push({ g: LAB[s.name] ?? s.name, t: '/' + r.name, d: r.description ?? r.label ?? '', ins: '/' + r.name + ' ' })
      }
    }
    if (mine.signal.aborted || !cur) return
    showMenu('cmd', hit, out)
  }
  function hideMenu(): void {
    const m = cur?.menu
    if (m) { m.el.remove(); if (cur) cur.menu = null }
    stopLive()
  }
  function menuPlace(m: Menu): void {
    const n = note()
    const r = n.getBoundingClientRect()
    const w = Math.min(r.width, 520)
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12))
    m.el.style.left = Math.round(left) + 'px'
    m.el.style.width = Math.round(w) + 'px'
    m.el.style.bottom = Math.round(Math.max(12, innerHeight - r.bottom + 8)) + 'px'
    m.el.style.maxHeight = Math.round(Math.max(180, Math.min(340, r.bottom - 96))) + 'px'
  }
  /** v97：分组标题带总数 + 「插进去是什么格式」，行 = 序号 / 标题 / 右侧次要信息；说明类两行。
      鼠标悬停只换高亮、不重画也不滚动；只有键盘 ↑↓ 才把选中项滚进视野。 */
  function paintMenu(): void {
    const c = cur
    const m = c?.menu
    if (!m) return
    const frame = m.el.querySelector('.qm') as HTMLElement | null
    if (!frame) return
    const counts = new Map<string, number>()
    for (const it of m.items) counts.set(it.g, (counts.get(it.g) ?? 0) + 1)
    const HINT: Record<string, string> = { 任务: '说明全文', 相关说明: '标题：内容', 相关链接: '标题（URL）', 相关文件: '标题（路径）', 仓库: '名字（路径）', 关联卡片: '名字（卡片组）', 活跃会话: '名字（活跃）' }
    const qy = m.hit.query.trim()
    const head = m.kind === 'quote'
      ? '<div class="qm-h"><b>引用卡片内容</b>' + (qy ? '<span class="q">筛选「' + esc(qy) + '」</span>' : '') + '<span class="qm-k"><kbd class="' + (m.hit.ch === '>' ? 'on' : '') + '">&gt;</kbd><kbd class="' + (m.hit.ch === '》' ? 'on' : '') + '">》</kbd></span></div>' + qAddRow()
      : '<div class="qm-h"><b>插入工具命令</b><span>与宿主的 / 菜单同一份数据</span><span class="qm-k"><kbd class="on">/</kbd></span></div>'
    let last = ''
    const body = m.items.length
      ? m.items.map((it, i) => {
        const g = it.g !== last
          ? '<div class="qm-g" role="presentation"><span class="gt2">' + esc(it.g) + '</span><span class="gc">' + (counts.get(it.g) ?? 1) + '</span>'
            + (m.kind === 'quote' && HINT[it.g] ? '<span class="gx">' + HINT[it.g] + '</span>' : '') + '</div>'
          : ''
        last = it.g
        return g + '<button type="button" tabindex="-1" role="option" class="qm-i' + (it.sub ? ' two' : '') + (i === m.hi ? ' on' : '') + '" aria-selected="' + (i === m.hi) + '" data-gt-mi="' + i + '">'
          + '<span class="qi" aria-hidden="true">' + (it.idx ? esc(it.idx) : '') + '</span>'
          + (it.sub
            ? '<span class="tb"><span class="qn">' + esc(it.t) + '</span><span class="qa">' + esc(it.sub) + '</span></span>'
            : '<span class="qn">' + esc(it.t) + '</span>')
          + (it.d ? '<span class="qd">' + esc(it.d) + '</span>' : '') + '</button>'
      }).join('')
      : '<div class="qm-e">没有和「' + esc(qy) + '」匹配的内容</div>'
    const foot = '<div class="qm-f">' + (m.kind === 'quote'
      ? '单击插入 · <b>↑↓</b> 选择 · <b>esc</b> 关闭 · 任务是引用它的任务说明全文'
      : '触发：首个 / / 空格 + / · <b>↑↓</b> 选择 · <b>↵</b> 插入 · <b>esc</b> 关闭') + '</div>'
    const prevTop = (frame.querySelector('.qm-v') as HTMLElement | null)?.scrollTop ?? 0
    frame.innerHTML = head + '<div class="qm-v">' + body + '</div>' + foot
    menuPlace(m)
    const box = frame.querySelector('.qm-v') as HTMLElement | null
    /* 重画不打断人的滚动手感：鼠标 / 输入重画时保持原来的滚动位置，只有键盘 ↑↓ 才把选中项带进视野 */
    if (box && !m.kbd) box.scrollTop = prevTop
    if (!m.kbd) return
    m.kbd = false
    const on = frame.querySelector('.qm-i.on') as HTMLElement | null
    if (on && box) {
      const ob = on.getBoundingClientRect(), bb = box.getBoundingClientRect()
      const a = ob.top - bb.top + box.scrollTop, b = a + ob.height
      if (a < box.scrollTop) box.scrollTop = Math.max(0, a - 24)
      else if (b > box.scrollTop + box.clientHeight) box.scrollTop = b - box.clientHeight + 6
    }
  }
  function showMenu(kind: 'quote' | 'cmd', hit: { len: number; query: string; ch?: string }, items: Mi[]): void {
    const c = cur
    if (!c || !dlg) return
    const k = hit.query.trim().toLowerCase()
    const rows = k ? items.filter((it) => (it.t + ' ' + (it.d ?? '') + ' ' + (it.sub ?? '')).toLowerCase().includes(k)) : items
    const prev = c.menu
    const same = !!prev && prev.kind === kind && prev.hit.query === hit.query
    if (prev && !same) hideMenu()
    let m = c.menu
    if (!m || m.kind !== kind) {
      hideMenu()
      const el = document.createElement('div')
      el.className = 'dpm-qm gt-qm'
      el.setAttribute('role', 'listbox')
      el.setAttribute('aria-label', kind === 'quote' ? '引用卡片内容' : '插入工具命令')
      el.innerHTML = '<div class="qm" role="document"></div>'
      // 弹层必须挂进 dialog：modal dialog 在 top layer，挂 body 上会被它整块盖住
      dlg.append(el)
      el.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-gt-mi]') as HTMLElement | null; if (b) pick(Number(b.dataset.gtMi)) })
      el.addEventListener('mousemove', (e) => {
        const it = (e.target as HTMLElement).closest?.('[data-gt-mi]') as HTMLElement | null
        if (!it || !cur?.menu) return
        const i = Number(it.dataset.gtMi)
        if (i === cur.menu.hi) return
        cur.menu.hi = i
        /* v97：悬停只换高亮 —— 不重画列表、不滚动（滚动只跟键盘） */
        el.querySelectorAll<HTMLElement>('[data-gt-mi]').forEach((n) => { const on = Number(n.dataset.gtMi) === i; n.classList.toggle('on', on); n.setAttribute('aria-selected', String(on)) })
      })
      el.addEventListener('mousedown', (e) => e.preventDefault())
      m = { kind, hit, items: rows, hi: 0, el }
      c.menu = m
      // v98 ②：每次新开引用菜单都重拉一次卡片数据（弹窗打开后卡片又被改过也不怕）；回来后就地重画
      if (kind === 'quote') { void refreshInfo(); startLive() }
    } else {
      // v98 ②：数据刷新（同一筛选词）时按「同一行」保住高亮 —— 上面插进来新条目也不会让高亮跳到别的行
      const keep = same ? m.items[m.hi] : null
      m.hit = hit; m.items = rows
      if (!same || m.hi >= rows.length) m.hi = 0
      if (keep) {
        const j = rows.findIndex((x) => x.g === keep.g && x.ins === keep.ins && x.t === keep.t)
        if (j >= 0) m.hi = j
      }
    }
    paintMenu()
  }
  function menuCheck(): void {
    const c = cur
    if (!c || !dlg?.open || c.hist) { hideMenu(); return }
    if (c.muted !== null && c.muted === note().value) return
    c.muted = null
    const p = paraBefore()
    const qh = detectQuote(p.para, p.first)
    if (qh) {
      // 触发符是哪个（> 还是 》）：菜单元信息里高亮对应的键位提示
      const at = note().selectionStart - qh.len
      const ch = note().value[Math.max(0, at)] === '》' ? '》' : '>'
      showMenu('quote', { len: qh.len, query: qh.query, ch }, quoteItems())
      return
    }
    const sh = detectSlash(p.para, p.first)
    if (sh) { void cmdItems(sh.query, sh, c.menu); return }
    hideMenu()
  }
  function pick(i: number): void {
    const c = cur
    const m = c?.menu
    const it = m?.items[i]
    if (!c || !m || !it) return
    const n = note()
    const caret = n.selectionStart
    const start = Math.max(0, caret - m.hit.len)
    n.value = n.value.slice(0, start) + it.ins + n.value.slice(caret)
    const c2 = start + it.ins.length
    n.setSelectionRange(c2, c2)
    hideMenu()
    n.focus()
    opts.toast('已插入' + (m.kind === 'quote' ? '引用' : '命令') + '：' + it.t)
  }

  /* ── 添加 / 保存 ── */
  /* v136（2.4）：仅编辑模式 —— 说明停止输入 0.8 秒 / 输入法上屏后 / 离开说明框 → 异步只保存说明（task.note）；
     标题旁「保存中… → 已自动保存 hh:mm:ss」；不重画、不挪光标；取消不撤销已自动保存的说明。新增模式不做。 */
  let asT = 0, asBusy = false, asAgain = false, asLast: string | null = null, asComp = false
  /* v151（5.1）：「自动保存」开关（默认开，记住选择）；关 = 只有点「保存」才写入 */
  const asOn = (): boolean => { try { return localStorage.getItem('dpm-gt-as') !== '0' } catch { return true } }
  function asSw(): void {
    const b = q<HTMLElement>('[data-gt-asws]'); if (b) b.setAttribute('aria-checked', String(asOn()))
    if (!asOn() && cur?.mode === 'edit') asPaint('off')
  }
  function asPaint(st: '' | 'saving' | 'saved' | 'err' | 'off', at = ''): void {
    const el = q<HTMLElement>('[data-gt-as]')
    if (!el) return
    if (!asOn() && st !== 'off' && st !== '') st = 'off'
    el.hidden = !st
    el.dataset.st = st
    el.innerHTML = st === 'saving' ? ICO_SPIN + '保存中…' : st === 'saved' ? ICO_OK + '已自动保存 ' + at : st === 'err' ? '自动保存失败（点「保存」再试）' : st === 'off' ? '自动保存已关闭 · 点「保存」才写入' : ''
  }
  function asKick(): void {
    const c = cur
    if (!asOn()) return
    if (!c || c.mode !== 'edit' || (!c.taskId && !(c.nm && c.nm.k >= 0))) return
    if (asComp) return
    window.clearTimeout(asT)
    asT = window.setTimeout(() => { void asRun() }, 800)
  }
  async function asRun(): Promise<void> {
    window.clearTimeout(asT); asT = 0
    if (!asOn()) return
    const c = cur
    if (c && c.nm && c.nm.k >= 0 && !c.busy) { await asNote(c); return }
    if (!c || c.mode !== 'edit' || !c.taskId || c.busy) return
    const v = note().value.replace(/\s+$/, '')
    if (asLast === null) asLast = (findTask(c.card, c.taskId)?.t.note ?? '').replace(/\s+$/, '')
    if (v === asLast) return
    if (asBusy) { asAgain = true; return }
    asBusy = true
    asPaint('saving')
    try {
      const fresh = await getState()
      const card = fresh.board.cards.find((x) => x.id === c.card.id)
      if (!card) throw new Error('这张卡片已经不存在了')
      const next = JSON.parse(JSON.stringify(card.tasks)) as Task[]
      const f = findIn(next, c.taskId)
      if (!f) throw new Error('这条任务已经不存在了')
      if (v.trim()) f.t.note = v; else delete f.t.note
      await post<Snapshot>('card/tasks', { id: card.id, tasks: next })
      asLast = v
      const d = new Date()
      if (cur === c) asPaint('saved', pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()))
      opts.refresh?.()
    } catch (e) {
      if (cur === c) asPaint('err')
      console.warn('[dsh-project-manager] 任务说明自动保存失败：', e)
    } finally {
      asBusy = false
      if (asAgain) { asAgain = false; void asRun() }
    }
  }
  /* v144（1）：编辑相关说明时自动保存（停 0.8 秒 / 输入法上屏 / 失焦）—— 只改内容，标题 / 开关以点「保存」为准 */
  async function asNote(c: Open): Promise<void> {
    if (!c.nm || !opts.saveNote) return
    const v = note().value.replace(/\s+$/, '')
    const old = (c.card.noteItems ?? [])[c.nm.k]
    if (!old || !v.trim() || v === old.v.replace(/\s+$/, '')) return
    if (asBusy) { asAgain = true; return }
    asBusy = true
    asPaint('saving')
    try {
      const err = await opts.saveNote(c.card.id, c.nm.k, { t: old.t, v, off: !!old.off }, true)
      if (err) throw new Error(err)
      old.v = v
      const d = new Date()
      if (cur === c) asPaint('saved', pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()))
    } catch (e) { if (cur === c) asPaint('err'); console.warn('[dsh-project-manager] 相关说明自动保存失败：', e) } finally { asBusy = false; if (asAgain) { asAgain = false; void asRun() } }
  }
  async function saveNoteMode(c: Open): Promise<void> {
    if (!c.nm || !opts.saveNote) return
    window.clearTimeout(asT); asT = 0
    const v = note().value.replace(/\s+$/, '')
    if (!v.trim()) { opts.toast('先写说明内容', 'err'); note().focus(); return }
    const derive = v.split('\n').map((x) => x.trim()).find(Boolean)?.replace(/「“([^”「」]+)”[^「」]*」/g, '$1').replace(/「([^「」：]+)：[^「」]*」/g, '$1').trim().slice(0, 20) ?? ''
    const t = (q<HTMLInputElement>('#dpmGtTitle')!.value.trim() || derive).replace(/\s+/g, ' ')
    if ((c.card.noteItems ?? []).some((x, i) => x.t === t && i !== c.nm?.k)) { opts.toast('已经有一条叫「' + t + '」的说明了，换个标题', 'err'); const ti = q<HTMLInputElement>('#dpmGtTitle'); ti?.focus(); ti?.select(); return }
    const off = q<HTMLElement>('[data-gt-ninj]')?.getAttribute('aria-checked') === 'false'
    c.busy = true
    const btn = q<HTMLButtonElement>('[data-gt-add]'); if (btn) btn.disabled = true
    const err = await opts.saveNote(c.card.id, c.nm.k, { t, v, off }, false)
    c.busy = false; if (btn) btn.disabled = false
    if (err) { opts.toast(err, 'err'); return }
    c.nm.saved = true
    const done = c.nm.done
    close()
    done?.({ t, v })
  }
  async function save(): Promise<void> {
    const c = cur
    if (c?.nm) { if (!c.busy) await saveNoteMode(c); return }
    if (!c || c.busy) return
    window.clearTimeout(asT); asT = 0
    const raw = note().value
    const title = (q<HTMLInputElement>('#dpmGtTitle')!.value.trim() || deriveTaskTitle(raw)).slice(0, 120)
    const typed = q<HTMLInputElement>('#dpmGtTitle')!.value.trim()
    if (!typed && !raw.trim()) { if (c.hist) closeHist(); q<HTMLInputElement>('#dpmGtTitle')?.focus(); return }
    const type = q<HTMLSelectElement>('#dpmGtType')!.value
    const links = (c.card.webLinks ?? []).filter((l) => l.id && c.links.has(l.id)).map((l) => l.id as string)
    const files = (c.card.files ?? []).filter((f) => c.files.has(f.id)).map((f) => f.id)
    const cardId = c.card.id
    const edit = c.mode === 'edit'
    const taskId = c.taskId
    c.busy = true
    const btn = q<HTMLButtonElement>('[data-gt-add]')
    if (btn) btn.disabled = true
    try {
      // 提交前拉一次最新任务表：别人（详情页 / AI）可能刚改过，整表替换不能丢改动
      const fresh = await getState()
      const card = fresh.board.cards.find((x) => x.id === cardId)
      if (!card) throw new Error('这张卡片已经不存在了')
      const next = JSON.parse(JSON.stringify(card.tasks)) as Task[]
      const noteText = raw.replace(/\s+$/, '')
      let id = taskId ?? newTaskId()
      if (edit) {
        const f = findIn(next, taskId as string)
        if (!f) throw new Error('这条任务已经不存在了')
        const o = f.t
        o.text = title
        if (noteText.trim()) o.note = noteText; else delete o.note
        if (type) o.type = type; else delete o.type
        if (links.length) o.links = links; else delete o.links
        if (files.length) o.files = files; else delete o.files
        if (c.due) o.due = c.due; else delete o.due
        if (c.sess) o.sess = c.sess; else delete o.sess
      } else {
        const task: Task = { id, text: title, done: false }
        if (noteText.trim()) task.note = noteText
        if (type) task.type = type
        if (links.length) task.links = links
        if (files.length) task.files = files
        if (c.due) task.due = c.due
        if (c.sess) task.sess = c.sess
        const parent = c.parent ? findIn(next, c.parent.id as string) : null
        if (c.parent && !parent) throw new Error('父任务已经不存在了')
        if (parent) { parent.t.subs = [...(parent.t.subs ?? []), task]; parent.t.done = false }
        else next.push(task)
      }
      await post<Snapshot>('card/tasks', { id: cardId, tasks: next })
      /* v127：排今天开着 → 新任务直接排进今天；编辑时只补还没排今天的 */
      const nf = findIn(next, id)
      const keys = nf ? taskKeys(cardId, nf.parent ?? nf.t, false) : []
      const sched = swOn() && !!opts.scheduleToday && keys.length > 0 && (!edit || !zoneOfKeys(keys))
      close()
      if (sched) opts.scheduleToday?.(cardId, keys)
      if (edit) {
        opts.toast('已保存任务「' + title + '」')
        opts.saved?.(cardId, id)
      } else {
        opts.toast('已添加到「' + card.t + '」的任务：' + title)
        opts.added(cardId, id, c.parent?.id ?? null)
      }
    } catch (e) {
      c.busy = false
      if (btn) btn.disabled = false
      opts.toast((edit ? '任务没保存上：' : '任务没保存上：') + (e instanceof Error ? e.message : String(e)), 'err')
    }
  }

  function close(): void {
    ac?.abort()
    pickClose()
    hideMenu()
    if (cur?.nm && !cur.nm.saved) { const f = cur.nm.done; cur.nm.saved = true; f?.(null) }
    cur = null
    if (dlg && dlg.open) dlg.close()
  }

  function bindDialog(d: HTMLDialogElement): void {
    d.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === d) return // 点遮罩不关（防止手滑丢掉刚改的说明）
      const by = (sel: string): HTMLElement | null => (t.closest?.(sel) as HTMLElement | null) ?? null
      if (by('[data-gt-x]') || by('[data-gt-cancel]')) { close(); return }
      if (by('[data-gt-asw]')) {
        e.preventDefault()
        const on = !asOn()
        try { localStorage.setItem('dpm-gt-as', on ? '1' : '0') } catch { /* ignore */ }
        asSw()
        if (on) { asPaint(''); if (cur?.mode === 'edit') void asRun(); opts.toast('任务说明自动保存：开（没保存的改动已立刻保存）') }
        else opts.toast('任务说明自动保存：关 —— 只有点「保存」才写入')
        return
      }
      { const sw = by('[data-gt-ninj]'); if (sw) { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return } }
      const qadd = by('[data-gt-qadd]')
      if (qadd) { e.preventDefault(); e.stopPropagation(); void startQuoteAdd(qadd.dataset.gtQadd as 'note' | 'link' | 'file' | 'repo'); return }
      const chip = t.closest?.('.nref') as HTMLElement | null
      if (chip) { e.preventDefault(); e.stopPropagation(); openChip(chip); return }
      if (by('[data-gt-add]')) { void save(); return }
      { const sb = by('[data-gt-sess]') as HTMLElement | null; if (sb && cur) { const c = cur; const D = sessDeps(); if (!D) return; const edit = c.mode === 'edit' && !!c.taskId; openPicker(sb, { cid: c.card.id, up: true, noNew: !edit, cur: c.sess, self: edit, what: c.parent || (edit && findTask(c.card, c.taskId as string)?.parent) ? '子任务' : '任务', onPick: (sid) => void setSess(sid), onNew: () => { if (edit) { const cid = c.card.id, tid = c.taskId as string; close(); void D.newFor(cid, tid) } } }); return } }
      if (by('[data-gt-sessx]')) { void setSess(''); return }
      if (by('[data-gt-histopen]')) { if (cur?.hist) closeHist(); else openHist(); return }
      if (by('[data-gt-histback]')) { closeHist(); note().focus(); return }
      if (by('[data-gt-histclear]')) { if (cur) { cur.picked = []; paintHist() } return }
      if (by('[data-gt-histfill]')) { fillNote(); return }
      if (by('[data-gt-hpage]')) { const c = cur; if (c && !c.filter.trim()) void loadPage(c.sid, c.hists[c.sid]?.before ?? undefined); return }
      const full = by('[data-gt-hfull]')
      if (full && cur) { const k = full.dataset.gtHfull as string; if (cur.expanded.has(k)) cur.expanded.delete(k); else cur.expanded.add(k); paintHist(); return }
      const row = by('[data-gt-hm]')
      if (row && cur) { const k = row.dataset.gtHm as string; const i = cur.picked.indexOf(k); if (i >= 0) cur.picked.splice(i, 1); else cur.picked.push(k); paintHist(); return }
      if (by('[data-gt-gen]')) { void genTitle(); return }
      if (by('[data-dpm-sw]')) { e.preventDefault(); const on = swToggleLocal(); opts.toast(on ? '排今天：开 —— 保存后直接进今天的「未安排」和本日计划清单（记住，下次还是开）' : '排今天：关'); return }
      const st = by('[data-gt-st]')
      if (st && cur) { e.preventDefault(); const c = cur; const f = c.taskId ? findTask(c.card, c.taskId) : null; close(); opts.seek?.(c.card.id, f ? taskKeys(c.card.id, f.parent ?? f.t, false) : ['p|' + c.card.id]); return }
      const newBtn = by('[data-gt-new]')
      if (newBtn) { void addNew(newBtn.dataset.gtNew as 'link' | 'file'); return }
      const pickBtn = by('[data-gt-pick]')
      if (pickBtn) { showPop(pickBtn.dataset.gtPick as 'link' | 'file'); return }
      const done = by('[data-gt-done]')
      if (done) { closePops(); return }
      /* v137（2.1）：多选 —— 进入 / 完成 / 全选 / 勾选（Shift 连选）/ 删除并解绑（两步确认） */
      const msb = by('[data-gt-ms]')
      if (msb && cur) { e.preventDefault(); const k = msb.dataset.gtMs as 'link' | 'file'; msSet(k, !MS[k]); if (MS[k]) opts.toast('多选：勾选要处理的' + (k === 'link' ? '链接' : '文件') + '（Shift 点击可以连选），再点「删除并解绑」；Esc / 完成 退出'); return }
      const mdn = by('[data-gt-msdone]'); if (mdn) { e.preventDefault(); msSet(mdn.dataset.gtMsdone as 'link' | 'file', false); return }
      const mgo = by('[data-gt-msgo]')
      if (mgo && cur) {
        e.preventDefault()
        const k = mgo.dataset.gtMsgo as 'link' | 'file', ids = [...(MS[k] ?? [])]; if (!ids.length) return
        const sp = mgo.querySelector('span') as HTMLElement
        /* v151（5.2）：确认态记在多选状态里（重画不丢）；第二下 = 立刻「删除中…」忙态（禁用 + 转圈）、选中行淡出，删完一次刷新 */
        if (MSBUSY[k]) return
        if (!(MSARM[k] && Date.now() - MSARM[k] < 3000)) { MSARM[k] = Date.now(); mgo.classList.add('arm'); sp.textContent = '确认删除 ' + ids.length + ' 项'; window.setTimeout(() => { if (MSARM[k] && Date.now() - MSARM[k] >= 2990) { MSARM[k] = 0; const b2 = q<HTMLElement>('[data-gt-msgo="' + k + '"]'); if (b2 && !MSBUSY[k]) { b2.classList.remove('arm'); const s2 = b2.querySelector('span'); if (s2) s2.textContent = '删除并解绑 ' + ids.length } } }, 3000); return }
        MSARM[k] = 0; MSBUSY[k] = true
        mgo.classList.remove('arm'); mgo.classList.add('busy'); (mgo as HTMLButtonElement).disabled = true; sp.textContent = '删除中… ' + ids.length + ' 项'
        for (const id of ids) q<HTMLElement>('[data-gt-pk="' + k + ':' + CSS.escape(id) + '"]')?.classList.add('gone')
        void delItems(k, ids).finally(() => { MSBUSY[k] = false }).then((n) => {
          if (!cur) return
          MS[k] = new Set()
          if (!boundOf(k).length) msSet(k, false); else chips(k)
          opts.toast(k === 'link' ? '已删除 ' + n + ' 条链接：从卡片移除，并和本任务及其它任务解绑（即时保存）' : '已把 ' + n + ' 个文件移到废纸篓，并从卡片和所有任务解绑（即时保存；废纸篓里可恢复）')
        })
        return
      }
      const allc = by('.gt-msall')
      if (allc && cur && t.tagName !== 'INPUT') { e.preventDefault(); const k = (allc.querySelector('[data-gt-msall]') as HTMLElement).dataset.gtMsall as 'link' | 'file'; const l = boundOf(k); const full = (MS[k]?.size ?? 0) === l.length; MS[k] = new Set(full ? [] : l.map((x) => x.id)); MSLAST[k] = -1; chips(k); return }
      const pk = by('.gt-pick')
      if (pk && cur && t.tagName !== 'INPUT') {
        e.preventDefault()
        const [k0, id] = (pk.dataset.gtPk as string).split(':'); const k = k0 as 'link' | 'file'; const i = Number(pk.dataset.i); const set = MS[k]; if (!set) return
        const l = boundOf(k); const on = !set.has(id)
        if (e.shiftKey && MSLAST[k] >= 0) { const a = Math.min(MSLAST[k], i), b = Math.max(MSLAST[k], i); for (let j = a; j <= b; j++) { if (on) set.add(l[j].id); else set.delete(l[j].id) } }
        else if (on) set.add(id); else set.delete(id)
        MSLAST[k] = i; chips(k); return
      }
      /* v136（2.3）：垃圾桶 = 删除并解绑；第一下原地变红「确认删除」，3 秒内再点才执行 */
      const dl = by('[data-gt-del]')
      if (dl && cur) {
        e.preventDefault()
        if (!dl.classList.contains('arm')) {
          dlg?.querySelectorAll('.gt-del.arm').forEach((b) => { if (b !== dl) b.classList.remove('arm') })
          dl.classList.add('arm'); dl.setAttribute('aria-label', '再点一次确认删除')
          window.setTimeout(() => dl.classList.remove('arm'), 3000)
          return
        }
        const [k0, id] = (dl.dataset.gtDel as string).split(':'); const k = k0 as 'link' | 'file'
        const nm = boundOf(k).find((x) => x.id === id)?.name ?? id
        void delItems(k, [id]).then((n) => { if (n) opts.toast(k === 'link' ? '已删除链接「' + nm + '」：卡片里移除，本任务和其它任务一起解绑（即时保存）' : '已把「' + nm + '」移到废纸篓，并从卡片和本任务解绑（即时保存；废纸篓里可恢复）') })
        return
      }
      const un = by('[data-gt-un]')
      if (un && cur) { cur.links.delete(un.dataset.gtUn as string); chips('link'); if (cur.pop === 'link') list('link'); if (cur.mode === 'edit') { void syncBound(); opts.toast('已从任务解绑（卡片里保留，已即时保存）') } return }
      const unf = by('[data-gt-unf]')
      if (unf && cur) { cur.files.delete(unf.dataset.gtUnf as string); chips('file'); if (cur.pop === 'file') list('file'); if (cur.mode === 'edit') { void syncBound(); opts.toast('已从任务解绑（文件与卡片关联都保留，已即时保存）') } return }
      if (!by('.gt-popv') && !by('[data-gt-pick]')) closePops()
    })
    d.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement
      if (!cur) return
      if (t.id === 'dpmGtSess') { switchSess(t.value); return }
      if (t.dataset.gtMsall) { const k = t.dataset.gtMsall as 'link' | 'file'; MS[k] = new Set(t.checked ? boundOf(k).map((x) => x.id) : []); MSLAST[k] = -1; chips(k); return }
      if (t.dataset.gtPkc) { const [k0, id] = t.dataset.gtPkc.split(':'); const k = k0 as 'link' | 'file'; const set = MS[k]; if (!set) return; if (t.checked) set.add(id); else set.delete(id); MSLAST[k] = Number((t.closest('.gt-pick') as HTMLElement).dataset.i); chips(k); return }
      const lid = t.dataset.gtL
      const fid = t.dataset.gtF
      if (lid) { if (t.checked) cur.links.add(lid); else cur.links.delete(lid); chips('link'); list('link'); void syncBound(true); return }
      if (fid) { if (t.checked) cur.files.add(fid); else cur.files.delete(fid); chips('file'); list('file'); void syncBound(true) }
    })
    d.addEventListener('input', (e) => {
      const t = e.target as HTMLElement
      if (t === note()) { syncAutoTitle(); menuCheck(); paintNoteN(); paintGen(); asKick(); return }
      if (t.id === 'dpmGtTitle' && cur) { cur.titleTouched = true; return }
      if (t.id === 'dpmGtHistQ' && cur) { cur.filter = (t as HTMLInputElement).value; paintHist() }
    })
    d.addEventListener('keyup', (e) => {
      if (e.target === note() && /^(Arrow|Home|End|Page)/.test(e.key)) menuCheck()
    })
    d.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement
      if (t.classList?.contains('nref') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openChip(t); return }
      // 说明框：菜单导航 / 插入、⌘Enter 添加、Esc 逐层收
      if (t === note()) {
        const m = cur?.menu
        if (m) {
          const n = m.items.length
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { m.hi = (m.hi + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; m.kbd = true; paintMenu() } return }
          if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && n) { e.preventDefault(); pick(m.hi); return }
          if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (cur) cur.muted = note().value; hideMenu(); return }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); return }
      }
      // 标题内联：回车跳到说明
      /* v122（4）：中文输入法里按回车 = 选字上屏，不是「跳到说明」（isComposing / keyCode 229） */
      /* v127（1）：输入法选词的回车有时 isComposing 已是 false（compositionend 先到）→ compositionend 后 260ms 内的回车也当选词 */
      if (t.id === 'dpmGtTitle' && e.key === 'Enter' && (e.isComposing || e.keyCode === 229 || imeOn || performance.now() - imeEnd < 260)) { e.stopPropagation(); return }
      if (t.id === 'dpmGtTitle' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); const n = note(); n.focus(); n.setSelectionRange(n.value.length, n.value.length); return }
      // 历史消息列表：空格 / 回车切换选中
      const row = (t.closest?.('[data-gt-hm]') as HTMLElement | null)
      if (row && cur && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); const k = row.dataset.gtHm as string; const i = cur.picked.indexOf(k); if (i >= 0) cur.picked.splice(i, 1); else cur.picked.push(k); paintHist(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save() }
    })
    nd = mountNoteDoc(q<HTMLElement>('#dpmGtNote') as HTMLElement, { toast: opts.toast, onBuilt: () => { decorateChips(); na?.soon() } })
    /* v140（5.2）：任务说明 = 对话框同一套识别器（虚线 + 气泡 + 添加后变胶囊 + 框选加说明 + ⌘ 点击打开） */
    na?.dispose()
    na = new NoteAssist({
      root: () => q<HTMLElement>('#dpmGtNote'),
      home: (opts.snapshot()?.board.cards.flatMap((c) => [...(c.files ?? []).map((f) => f.path), ...(c.repos ?? []).map((r) => r.path)]).map((p) => /^\/(?:Users|home)\/[^/]+/.exec(p)?.[0]).find(Boolean)) ?? '',
      card: () => { const c = cur; if (!c) return null; const st = c.snap.files ?? {}; return { links: c.card.webLinks ?? [], files: (c.card.files ?? []).map((f) => ({ id: f.id, path: f.path, title: f.title, exists: st[f.path] !== false })), repos: c.card.repos ?? [], notes: c.card.noteItems ?? [] } },
      add: async (kind, prefill) => {
        const c = cur; if (!c || !opts.addFrom) return null
        const got = await opts.addFrom(c.card.id, kind, prefill)
        if (!got || cur !== c) return got
        const fresh = await getState().catch(() => null)
        if (fresh && cur === c) { const c2 = fresh.board.cards.find((x) => x.id === c.card.id); if (c2) { c.card = c2; c.snap = fresh } }
        await refreshInfo(); chips('link'); chips('file')
        return got
      },
      toast: opts.toast,
    })
    na.soon()
    {
      const ne = q<HTMLElement>('#dpmGtNote')
      ne?.addEventListener('compositionstart', () => { asComp = true })
      ne?.addEventListener('compositionend', () => { asComp = false; asKick() })
      ne?.addEventListener('focusout', () => { if (cur?.mode === 'edit') void asRun() })
    }
    const ti = q<HTMLInputElement>('#dpmGtTitle')
    ti?.addEventListener('compositionstart', () => { imeOn = true })
    ti?.addEventListener('compositionend', () => { imeOn = false; imeEnd = performance.now() })
    dueUi = mountDue(q<HTMLElement>('.gt-due') as HTMLElement, () => cur?.due ?? '', (v) => { if (cur) cur.due = v })
    const gh = q<HTMLElement>('.gt-h') as HTMLElement
    cfgUi = mountModelCfg(gh, q<HTMLButtonElement>('[data-gt-cfg]') as HTMLButtonElement, opts.toast, () => paintGen())
    const gb = q<HTMLElement>('[data-gt-gen]')
    gb?.addEventListener('mouseenter', () => { if (!cfgUi?.isOpen()) tipOn(gb, tmTip()) })
    gb?.addEventListener('mouseleave', tipOff)
    d.addEventListener('close', () => { tipOff(); dueUi?.close(); cfgUi?.close() })
    d.addEventListener('copy', onCopyCut as EventListener, true)
    d.addEventListener('cut', onCopyCut as EventListener, true)
    q<HTMLElement>('[data-gt-dv]')?.addEventListener('pointerdown', (e) => e.preventDefault())
    q<HTMLElement>('[data-gt-dv]')?.addEventListener('click', () => { nd?.insertDivider(); q<HTMLElement>('#dpmGtNote')?.focus() })
    // Esc 要能被「分割线标题输入框」先吃掉（capture 阶段拦，避免 dialog 的 cancel 抢先关窗）
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae.classList.contains('nd-in')) { e.preventDefault() }
    }, true)
    d.addEventListener('cancel', (e) => {
      if (noteTip) { e.preventDefault(); hideNoteTip(); return }
      if (nd?.editingTitle) { e.preventDefault(); return }
      // Esc：菜单 → 历史消息 → 链接/文件弹层 → 关弹窗（逐层收）
      if (cur?.menu) { e.preventDefault(); if (cur) cur.muted = note().value; hideMenu(); return }
      if (cur?.hist) { e.preventDefault(); closeHist(); note().focus(); return }
      if (cur?.pop) { e.preventDefault(); closePops(); return }
      /* v137：Esc 只退多选，不关弹窗 */
      if (MS.link || MS.file) { e.preventDefault(); if (MS.link) msSet('link', false); if (MS.file) msSet('file', false); opts.toast('已退出多选'); return }
      /* v132（2）：点过模型 / 档位后下拉重画、焦点落到 body，Esc 只收下拉，不关弹窗 */
      if (cfgUi?.isOpen()) { e.preventDefault(); cfgUi.close(); q<HTMLElement>('[data-gt-cfg]')?.focus(); return }
      e.preventDefault()
      close()
    })
    d.addEventListener('close', () => { cur = null; nd = null; na?.dispose(); na = null; d.remove(); dlg = null })
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement
      const m = cur?.menu
      if (m && !m.el.contains(t) && t !== note()) hideMenu()
      if (cur?.pop && !(t.closest?.('.gt-popv') || t.closest?.('[data-gt-pick]'))) closePops()
      if (noteTip && !(t.closest?.('.nref') || noteTip.contains(t))) hideNoteTip()
    })
    window.addEventListener('resize', () => { if (cur?.menu) menuPlace(cur.menu) })
  }

  /* ── 扫描会话消息，注入 / 移除按钮 ──
     两种气泡形状都要认（实测 2026-10-23 宿主 DOM）：
       ① 普通用户消息：flowItem[data-chat-node-key*="input-message"] → div[class*="_userRow"]
          → bubble + div[class*="_actions"][data-clock="start"]（时间 + 复制）→ 按钮排在最后；
       ② /goal 命令气泡：flowItem[data-chat-node-key*="goal-command-input"][data-chat-flow-kind="command-input"]
          → div[data-command-input]（flex，右对齐，无操作条）→ 按钮直接排在气泡后面（右下角）。
     v94：不再只看 /goal —— 任何非空用户消息都有（没有卡片的会话不显示）。
     进行中的「待发送 / 发送回执」不算已发送消息，跳过。 ── */
  function scan(): void {
    const sid = opts.sessionId()
    const cardId = sid ? opts.cardFor(sid) : null
    const snap = opts.snapshot()
    const hasCard = !!(cardId && snap && snap.board.cards.some((c) => c.id === cardId))
    document.querySelectorAll<HTMLElement>(NODE_SEL).forEach((node) => {
      const userRow = node.querySelector<HTMLElement>('div[class*="_userRow"]')
      const cmdRow = node.querySelector<HTMLElement>('[data-command-input]')
      if (!userRow && !cmdRow) return
      const pending = !!userRow && (userRow.hasAttribute('data-pending-steering') || userRow.hasAttribute('data-submission-echo'))
      const bubble = (userRow ?? cmdRow)?.querySelector<HTMLElement>('div[class*="_bubble"]')
      if (!bubble) return
      const host = userRow ? (userRow.querySelector<HTMLElement>('[data-clock="start"]') ?? null) : cmdRow
      if (!host) return
      const want = showAddTaskButton({ hasCard, text: bubble.textContent ?? '', pending })
      const curBtn = host.querySelector<HTMLElement>('[' + BTN_ATTR + ']')
      if (!want) { curBtn?.remove(); return }
      if (curBtn) return
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'dpm-goal-add'
      b.setAttribute(BTN_ATTR, '')
      b.setAttribute('aria-haspopup', 'dialog')
      b.setAttribute('aria-label', '把这条消息添加为卡片任务')
      b.title = '添加为卡片任务'
      b.innerHTML = ICON + '<span>添加任务</span>'
      b.addEventListener('click', () => { if (cardId && sid) open({ text: bubble.textContent ?? '', cardId, sid }) })
      host.append(b)
    })
  }

  let raf = 0
  const kick = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; scan() }) }
  const mo = new MutationObserver(kick)
  mo.observe(document.body, { childList: true, subtree: true })
  /* v133 R2：兜底扫描直接跑（只查 DOM、不量布局），不再借 rAF —— 借 rAF 每 1.2s 白白要一帧，执行中呼吸动画在跑时每帧都要重算动画样式 */
  const timer = window.setInterval(scan, 1200)
  // 看板动作（解除关联 / 关联卡片）后立刻重扫：不等 5s 快照轮询，按钮该消失就消失、该回来就回来
  const onChanged = (): void => { opts.refresh?.(); kick(); setTimeout(kick, 350) }
  document.addEventListener('dpm:board-changed', onChanged)
  kick()
  return {
    open: (o: GoalTaskOpen): void => { open({ text: '', cardId: o.cardId, mode: o.mode, taskId: o.taskId, parentId: o.parentId, title: o.title, note: o.note }) },
    dispose: (): void => {
      mo.disconnect()
      document.removeEventListener('dpm:board-changed', onChanged)
      clearInterval(timer)
      if (raf) cancelAnimationFrame(raf)
      document.querySelectorAll('[' + BTN_ATTR + ']').forEach((n) => n.remove())
      close()
    },
  }
}

/** 在卡片任务树里按 id 找一条（父任务或子任务）。 */
function findTask(card: Card, id: string): { t: Task; parent?: Task } | null {
  const walk = (list: Task[], parent?: Task): { t: Task; parent?: Task } | null => {
    for (const t of list) {
      if (t.id === id) return parent ? { t, parent } : { t }
      const hit = walk(t.subs ?? [], t)
      if (hit) return hit
    }
    return null
  }
  return walk(card.tasks ?? [])
}
/** 同上，但作用在「提交用的新任务表」上（返回可改的引用）。 */
function findIn(list: Task[], id: string): { t: Task; parent?: Task } | null {
  for (const t of list) {
    if (t.id === id) return { t }
    for (const s of t.subs ?? []) if (s.id === id) return { t: s, parent: t }
  }
  return null
}
