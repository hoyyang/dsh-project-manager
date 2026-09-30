/**
 * 会话记忆注入文本：卡片组 ∪ 卡片关联的落盘项目 → 摘要（状态 / next_action / STATE 路径）。
 * 字节预算默认 6000；超出时从后往前省略并注明，保证模型知道还有哪些 STATE 可以自己去读。
 */
import { Board, Card, group, memoryOf } from './model.js'
import { StateCatalog } from './states.js'

export function memoryText(b: Board, c: Card, states: StateCatalog, maxBytes = 6000, readKeys: readonly string[] = []): string {
  const g = group(b, c.g)
  const all = memoryOf(b, c)
  // 关联时会话里已读过的 STATE 不再注入（用户规则：没读过才自动读）
  const items = all.filter((m) => !readKeys.includes(m.key))
  const head = [
    '## dsh-project-manager：本会话关联的项目记忆',
    '卡片组「' + g.name + '」· 卡片「' + c.t + '」。以下落盘项目（/landfill-project）已自动关联；需要细节时直接读取 STATE 路径。',
  ]
  if (!all.length) return head.concat(['（没有关联落盘项目）']).join('\n')
  if (!items.length) return head.concat(['（关联的 ' + all.length + ' 个落盘项目本会话之前已读过，不再重复注入：' + all.map((m) => m.key).join('、') + '）']).join('\n')
  const blocks = items.map((m) => {
    const s = states.get(m.key)
    if (!s) return '- ' + m.key + '：未找到 STATE（可能已被移动或删除）'
    return ['- ' + m.key + '（' + (m.from === 'group' ? '来自卡片组' : m.from === 'card' ? '来自卡片' : '卡片组+卡片') + '）',
      '  状态：' + (s.status || '（STATE 未写一行状态）'),
      '  next_action：' + (s.next || '（未写）'),
      '  STATE：' + s.path].join('\n')
  })
  const out = head.slice()
  let used = Buffer.byteLength(out.join('\n'))
  const omitted: string[] = []
  blocks.forEach((blk, i) => {
    const n = Buffer.byteLength(blk) + 1
    if (used + n > maxBytes) { omitted.push(items[i].key); return }
    out.push(blk)
    used += n
  })
  const skipped = all.filter((m) => readKeys.includes(m.key)).map((m) => m.key)
  if (skipped.length) out.push('（本会话之前已读过、不再重复注入：' + skipped.join('、') + '）')
  if (omitted.length) out.push('（另有 ' + omitted.length + ' 个落盘项目因长度预算省略，名单：' + omitted.join('、') + '）')
  return out.join('\n')
}
