/**
 * v179（0.74.0）：说明 / 知识卡正文按「带标题的分割线」拆段 —— 引用面板里悬停那一行就展开每一段，
 * 点一段只注入这一段（需求 1.1–1.4 / 设计卡 §二）。
 *
 * 纯函数：host / client / 测试共用同一份口径（不在 DOM 里再抄一遍）。
 *  ① 带标题的分割线（`──── 标题 ────`）往下到下一个带标题分割线 = 一段，段头 = 这条分割线的标题；
 *  ② 不带标题的分割线（`────`）不切段、留在当前这一段正文里（注入时原样保留）；
 *  ③ 第一条带标题分割线之前的内容 = 「默认」段；开头就是分割线则没有这一段；
 *  ④ 全文没有带标题分割线 → 返回 []（面板不展开、整行照旧注入全文）。
 */
import { nest, nm } from './quote.js'

export interface QpSec {
  /** 段标题（默认段 = ''） */
  t: string
  /** 段正文（首尾空行已去掉；无标题分割线原样保留） */
  body: string
  /** 去掉空白后的字数（面板上的「N 字」） */
  n: number
  /** 正文第一行非空内容，截 58 字（面板预览） */
  prev: string
  /** 段序号（0 = 默认段） */
  i: number
  /** 实际注入的文本（段头 + 这一段正文，见 sectionText） */
  ins: string
}

/** 带标题的分割线：≥4 个 `─`/`—`，中间夹标题；只有横线的 = 无标题分割线。 */
export const DIV_RX = /^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/

/** 段头的两种身份：任务 / 子任务说明（`──── 标题 ────`）与知识卡（出处行）。 */
export type SecKind = 'task' | 'kb'
export interface SecMeta {
  kind: SecKind
  /** kind = kb 时要：知识卡标题 / 路径（拼出处行） */
  title?: string
  path?: string
}

/** 段头（没有就是 ''）：任务 / 子任务 = 真分割线；知识卡 = 出处行（画成引用原文同款）。 */
export function sectionHead(meta: SecMeta, t: string): string {
  if (meta.kind !== 'kb') return t ? '──── ' + t + ' ────' : ''
  const which = t ? '分割线『' + nest(t) + '』' : '默认段'
  return '「' + nm(meta.title ?? '') + '知识卡 · ' + which + '（' + (meta.path ?? '') + '）」'
}

/** 点某一段实际注入的文本：知识卡一定带出处行；任务 / 子任务只有带标题的段才加段头。 */
export function sectionText(meta: SecMeta, sec: { t: string; body: string }): string {
  const head = sectionHead(meta, sec.t)
  return head ? head + '\n' + sec.body : sec.body
}

const trimBlank = (s: string): string => s.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')

/** 正文 → 分段（不分段返回 []）。 */
export function splitSections(text: string | null | undefined, meta: SecMeta): QpSec[] {
  const src = String(text ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return []
  const raw: Array<{ t: string; body: string }> = []
  let cur = { t: '', lines: [] as string[] }
  let hit = false
  const flush = (): void => {
    const body = trimBlank(cur.lines.join('\n'))
    if (cur.t || body.trim()) raw.push({ t: cur.t, body })
  }
  for (const ln of src.split('\n')) {
    const m = DIV_RX.exec(ln)
    if (m && m[1] && m[1].trim()) {
      flush()
      cur = { t: m[1].trim(), lines: [] }
      hit = true
      continue
    }
    cur.lines.push(ln)
  }
  flush()
  if (!hit || !raw.length) return []
  return raw.map((s, i) => ({
    t: s.t,
    body: s.body,
    n: s.body.replace(/\s+/g, '').length,
    prev: (String(s.body.split('\n').find((x) => x.trim()) ?? '').trim()).slice(0, 58),
    i,
    ins: sectionText(meta, s),
  }))
}

/** 一段的匹配文本（筛选：段标题 + 段正文都进 hay，设计卡 §3.5）。 */
export const secHay = (secs: readonly QpSec[]): string => secs.map((s) => (s.t || '默认') + ' ' + s.body).join(' ').toLowerCase()
