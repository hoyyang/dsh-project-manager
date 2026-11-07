/**
 * v92：从会话消息里提炼「添加卡片任务」的纯文本规则（无 DOM、无 DSH 依赖，可单测）。
 * 规则来源：设计卡 v92 —— 只认「正文以 /goal 开头」的已发送消息（允许前面空白，全角 ／ 也算）。
 */

/** 消息是否以 /goal 命令开头。 */
export const isGoalMessage = (text: string): boolean => /^[/／]\s*goal(?:\s|$)/i.test(text.trim())

/** 第一行（去掉首尾空白）。 */
export const firstLine = (text: string): string => (text.split('\n').map((x) => x.trim()).filter(Boolean)[0] ?? '')

/**
 * v94：「添加任务」按钮是否出现在这条消息旁：任何**非空**用户消息 + 会话已关联卡片（/goal 那条样式不变）。
 * v92/v93 只认「以 /goal 开头的消息」，v94 起扩到任意用户消息。
 * pending（待发送 / 发送回执）不算已发送消息。
 */
export const showAddTaskButton = (o: { hasCard: boolean; text: string; pending?: boolean }): boolean => !o.pending && o.hasCard && o.text.trim() !== ''

/**
 * 任务标题：默认取消息第一行，去掉开头的 /goal（含分隔的冒号 / 空格），最长 max（默认 120，与任务标题输入框一致）。
 * 空消息 / 只有 /goal → 用第一行原文，再不行 →「未命名任务」。
 */
export function deriveTaskTitle(text: string, max = 120): string {
  const line = firstLine(text)
  const rest = line.replace(/^[/／]\s*goal\b[:：]?\s*/i, '').trim()
  return (rest || line || '未命名任务').slice(0, max)
}

/**
 * v133（2.3）：模型生成的标题写进标题框前清洗 —— 去开头「标题：/ 任务标题：/ Title:」、Markdown 的 # 和 **、
 * 首尾引号书名号（最多剥三层），压空白、截 120。客户端（goaltask）与 host goalTitle 共用这一条。
 */
export function cleanTitle(s: string, max = 120): string {
  let t = String(s ?? '').trim()
  for (let i = 0; i < 3; i++) {
    const b = t
    t = t.replace(/^\s*(?:#{1,6}\s*|\*\*|__)?\s*(?:任务)?(?:标题|题目|title)\s*(?:\*\*|__)?\s*[:：]\s*/i, '')
      .replace(/^\s*[「『“"'《【]+|[」』”"'》】]+\s*$/g, '').replace(/^\s*#{1,6}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim()
    if (t === b) break
  }
  return t.replace(/\s+/g, ' ').slice(0, max)
}

/**
 * v93：弹窗里标题框的「自动标题」= 说明的第一行去掉 /goal（deriveTaskTitle）；
 * 说明是空的 → 返回空串（标题框清空、露出占位符，添加时再自动导一次）。
 * 只在标题未被手动改过时由弹窗套用（goaltask.ts 的 titleAuto / titleTouched）。
 */
export function autoTaskTitle(note: string): string {
  return note.trim() ? deriveTaskTitle(note) : ''
}

/* ── v93：弹窗里的两项纯规则（无 DOM，可单测） ───────────────────────────── */

/**
 * 「从历史消息选择」的填入：按点选顺序、一个空行分隔，**追加**在现有说明后面（从不覆盖）。
 * 现有说明为空 → 直接就是选中的内容；纯空白 → 当空处理。
 */
export function appendNotes(existing: string, parts: readonly string[]): string {
  const add = parts.map((x) => String(x).trim()).filter(Boolean)
  if (!add.length) return existing
  const base = existing.replace(/\s+$/, '')
  if (base === '') return add.join('\n\n')
  return base + '\n\n' + add.join('\n\n')
}

/**
 * 说明框里的「/」命令触发（与宿主 / 菜单同一口径）：首个 / 或 空格 + /；触发符到光标之间没有空白 = 筛选词。
 * 行中间（前面不是空白、也不是段首）的 / 不触发（URL / 路径里的斜杠）。
 */
export function detectSlash(prefix: string, first: boolean): { len: number; query: string } | null {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const ch = prefix[i]
    if (/\s/.test(ch)) return null
    if (ch !== '/') continue
    if (i === 0) return first ? { len: prefix.length, query: prefix.slice(1) } : null
    const prev = prefix[i - 1]
    if (prev === ' ' || prev === '\u3000' || prev === '\u00a0') return { len: prefix.length - i + 1, query: prefix.slice(i + 1) }
    return null
  }
  return null
}

/**
 * v120（③）：生成标题的重试口径（纯函数，可单测）—— 第一轮 400 token + 推理档 low；
 * 只有「空响应」才自动重试一次（放预算到 1600、关掉推理档），其它失败原样返回。
 */
export type TitleAttempt = { ok: true; title: string } | { ok: false; code: string; message: string }
/* v129：模型 / 推理档由用户配置 —— effort = 首轮档位，retryEffort = 空响应重试档（模型不支持关掉推理时沿用首轮档）；undefined = 交给模型默认档 */
export async function titleWithRetry(attempt: (maxTokens: number, effort: string | undefined) => Promise<TitleAttempt>, effort: string | undefined = 'low', retryEffort: string | undefined = 'off'): Promise<TitleAttempt & { retried: boolean }> {
  const r = await attempt(400, effort)
  if (r.ok || r.code !== 'EMPTY_TITLE') return { ...r, retried: false }
  const r2 = await attempt(1600, retryEffort)
  return { ...r2, retried: true }
}
