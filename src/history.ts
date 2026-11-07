/**
 * v93（0.42）：「添加卡片任务」弹窗「从历史消息选择」的数据整形（纯函数，可单测）。
 * 只认真实用户输入：user/message 且 source.kind='user'；/goal 这类命令另存为 command/run(name='goal')，
 * 正文落在 args 里（气泡上显示的就是「/goal + args」）。系统提示注入 / AGENTS.md / 技能目录 / 运行时上下文
 * 各有自己的 source.kind，天然被过滤掉。
 *
 * v94（0.43）：不再截断成「只列最近 400 条」，改成按 200 条一页往前翻（详情里还能选别的活跃会话）：
 * historyPage 返回这一页 + 总数 + 是否还有更早的，界面用「加载更早的消息（共 N 条，已加载 M 条）」翻到最早一条。
 * v94 补口（实测 2026-10-24 本机会话日志）：回合进行中发来的用户消息（排队 / 插话）只落
 * `agent/inbox/spliced` 事件（inserted[].source.kind='user'，与 user/message 共享同一 rpcId），
 * 消费时不补写 `user/message` —— historyRow 认不到，这类消息就进不了「从历史消息选择」。
 * historyRows 按整条事件流整形：spliced 的用户条目也算数；同一 rpcId 之后（或之前）出现正式
 * user/message 时以正式那条为准（seq / 时间用消费序），幂等去重不会出两条。
 */
export interface HistoryMsg { seq: number; at: string; text: string }
/** 一页多少条（v94 设计：200 条 / 页；上限 400 防止一次拉爆内存）。 */
export const HISTORY_PAGE = 200
export const HISTORY_PAGE_MAX = 400

interface Ev { type?: string; seq?: number; time?: number | string; data?: Record<string, unknown> }

/** user/message 的正文：只取 text 块，多块换行拼接。 */
export function messageText(data: Record<string, unknown>): string {
  const blocks = Array.isArray(data.content) ? (data.content as Array<{ type?: string; text?: unknown }>) : []
  return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => String(b.text)).join('\n').trim()
}

/** 事件时间 → ISO 字符串（拿不到就给空串，界面显示为空）。 */
export function eventAt(t: unknown): string {
  if (typeof t === 'number') return new Date(t).toISOString()
  if (typeof t === 'string' && t) { const d = new Date(t); return Number.isNaN(d.getTime()) ? t : d.toISOString() }
  return ''
}

/** spliced 事件里 inserted 的用户条目正文（排队 / 插话的每条消息各有 content + source）。
 * 防御性约定：一条 splice 若带多条用户消息（正常流程一次一条），正文用空行连接成一条，
 * 保证一行对应一个事件 seq（客户端的选中键 = 会话 + seq，同 seq 两行会互相顶掉）。 */
function splicedTexts(data: Record<string, unknown>): string[] {
  const items = (Array.isArray(data.inserted) ? data.inserted : []) as Array<{ content?: unknown; source?: { kind?: string } }>
  return items.filter((it) => it && it.source?.kind === 'user').map((it) => messageText(it as Record<string, unknown>)).filter(Boolean)
}

/** 一条事件 → 一条历史消息；不是用户自己发的 / 空正文 → null。
 * v94 补口：`agent/inbox/spliced` 里 inserted 的用户条目（回合进行中排队 / 插话，消费时不补写
 * user/message）也出一条。单独用它会和正式 user/message 重复计一条 —— 跨事件去重用 historyRows。 */
export function historyRow(ev: Ev): HistoryMsg | null {
  const data = ev.data ?? {}
  if (ev.type === 'agent/inbox/spliced') {
    const texts = splicedTexts(data)
    return texts.length ? { seq: Number(ev.seq ?? 0), at: eventAt(ev.time), text: texts.join('\n\n') } : null
  }
  const src = data.source as { kind?: string } | undefined
  if (src?.kind !== 'user') return null
  const seq = Number(ev.seq ?? 0)
  const at = eventAt(ev.time)
  if (ev.type === 'user/message') {
    const text = messageText(data)
    return text ? { seq, at, text } : null
  }
  if (ev.type === 'command/run' && data.name === 'goal') {
    const args = typeof data.args === 'string' ? data.args : ''
    return { seq, at, text: ('/goal' + args).trim() }
  }
  return null
}

/** 事件里的 source.rpcId（同一份数据先以 spliced 入账、再以 user/message 入账时两者相同）。 */
const rpcIdOf = (data: Record<string, unknown>): string | undefined => {
  const id = (data.source as { rpcId?: unknown } | undefined)?.rpcId
  return typeof id === 'string' && id ? id : undefined
}

interface Row extends HistoryMsg { rpcId?: string; official?: boolean }

/**
 * 整条事件流 → 历史消息（乱序安全：historyPage 会按 seq 排）。
 * 与逐条 historyRow 的差别在跨事件去重：同一 rpcId 的 spliced 与 user/message 只留一条，
 * 有正式 user/message 就用它的 seq / 时间（spliced 只是占位）。其余事件各自成行。
 */
export function historyRows(events: readonly Ev[]): HistoryMsg[] {
  const rows: Row[] = []
  const byRpc = new Map<string, number>()
  const add = (row: Row): void => {
    if (row.rpcId && byRpc.has(row.rpcId)) {
      // 已有同源行：只有正式 user/message 能占那个位置（覆盖占位的 spliced 行）
      if (row.official) rows[byRpc.get(row.rpcId) as number] = { seq: row.seq, at: row.at, text: row.text }
      return
    }
    if (row.rpcId) byRpc.set(row.rpcId, rows.length)
    rows.push({ seq: row.seq, at: row.at, text: row.text })
  }
  for (const ev of events) {
    const data = ev.data ?? {}
    const seq = Number(ev.seq ?? 0)
    const at = eventAt(ev.time)
    if (ev.type === 'user/message') {
      if ((data.source as { kind?: string } | undefined)?.kind !== 'user') continue
      const text = messageText(data)
      if (!text) continue
      add({ seq, at, text, rpcId: rpcIdOf(data), official: true })
      continue
    }
    if (ev.type === 'command/run' && data.name === 'goal') {
      const args = typeof data.args === 'string' ? data.args : ''
      add({ seq, at, text: ('/goal' + args).trim() })
      continue
    }
    if (ev.type === 'agent/inbox/spliced') {
      const texts = splicedTexts(data)
      if (!texts.length) continue
      const items = (Array.isArray(data.inserted) ? data.inserted : []) as Array<{ source?: { kind?: string; rpcId?: unknown } }>
      const id = items.filter((it) => it && it.source?.kind === 'user').map((it) => it.source?.rpcId).find((x): x is string => typeof x === 'string' && !!x)
      add({ seq, at, text: texts.join('\n\n'), rpcId: id })
      continue
    }
  }
  return rows
}

export interface HistoryPage {
  /** 这一页：从新到旧。 */
  messages: HistoryMsg[]
  /** 这个会话里你发过的全部消息条数（不受分页影响）。 */
  total: number
  /** 还有更早的消息可以继续翻。 */
  hasMore: boolean
  /** 下一页的游标（这一页最旧那条的 seq）；没有更早的 = null。 */
  before: number | null
}

/**
 * 翻页：before = 上一页最旧那条的 seq（只返回 seq < before 的），不给 = 从最新一条开始。
 * 从新到旧、每页 limit（默认 200，夹在 1–400）。
 */
export function historyPage(all: readonly HistoryMsg[], o: { before?: number; limit?: number } = {}): HistoryPage {
  const limit = Math.max(1, Math.min(HISTORY_PAGE_MAX, Math.floor(o.limit ?? HISTORY_PAGE) || HISTORY_PAGE))
  const desc = [...all].sort((a, b) => b.seq - a.seq)
  const at = o.before === undefined ? 0 : desc.findIndex((m) => m.seq < (o.before as number))
  const from = at < 0 ? desc.length : at
  const page = desc.slice(from, from + limit)
  return { messages: page, total: all.length, hasMore: from + page.length < desc.length, before: page.length ? page[page.length - 1].seq : null }
}
