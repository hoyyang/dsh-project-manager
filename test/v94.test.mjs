import test from 'node:test'
import assert from 'node:assert/strict'
import { historyRow, historyRows, historyPage } from '../lib/history.js'

/* ── 造事件的小工具（形状按 2026-10-24 实测的宿主会话日志） ── */
const um = (seq, text, rpcId) => ({ type: 'user/message', seq, time: 1792852000000 + seq, data: { source: { kind: 'user', ...(rpcId ? { rpcId } : {}) }, content: [{ type: 'text', text }] } })
const sys = (seq, kind, text) => ({ type: 'user/message', seq, data: { source: { kind }, content: [{ type: 'text', text }] } })
const ins = (text, rpcId) => ({ content: [{ type: 'text', text }], source: { kind: 'user', rpcId } })
const spliced = (seq, items) => ({ type: 'agent/inbox/spliced', seq, time: 1792852000000 + seq, data: { target: 'next-turn', start: 0, inserted: items } })
const goal = (seq, args) => ({ type: 'command/run', seq, data: { name: 'goal', args, source: { kind: 'user' } } })

test('v94 · historyRow：agent/inbox/spliced 的用户条目也出一条（回合中排队 / 插话）', () => {
  assert.deepEqual(historyRow(spliced(18, [ins('普通用户消息 B', 'rpc-b')])), { seq: 18, at: new Date(1792852000018).toISOString(), text: '普通用户消息 B' })
  assert.equal(historyRow(spliced(20, [ins('   ', 'x')])), null, '空正文不算')
  assert.equal(historyRow(spliced(21, [{ content: [{ type: 'text', text: '内部' }], source: { kind: 'system' } }])), null, '非用户条目不算')
  assert.equal(historyRow(spliced(22, [])), null, '空 splice 不算')
  assert.equal(historyRow(spliced(23, [{ content: [{ type: 'text', text: '甲' }], source: { kind: 'user' } }, { content: [{ type: 'text', text: '乙' }], source: { kind: 'user' } }]))?.text, '甲\n\n乙', '多条防御性合并成一行')
})

test('v94 · historyRows：只有 spliced 的消息也算数（B 场景：消费时不补写 user/message）', () => {
  const rows = historyRows([
    sys(13, 'agent-instructions', '<system-reminder>注入</system-reminder>'),
    spliced(18, [ins('普通用户消息 B', 'rpc-b')]),
    sys(14, 'runtime-context', 'Current runtime context'),
  ])
  assert.deepEqual(rows, [{ seq: 18, at: new Date(1792852000018).toISOString(), text: '普通用户消息 B' }])
  const page = historyPage(rows, {})
  assert.equal(page.total, 1)
  assert.equal(page.messages[0].text, '普通用户消息 B')
})

test('v94 · historyRows：同一 rpcId 的 spliced + user/message 只留一条，正式的 seq 优先（A 场景）', () => {
  // 实测顺序：splice(seq 7) 在前，user/message(seq 12) 在后
  const a = historyRows([spliced(7, [ins('消息 A', 'rpc-a')]), um(12, '消息 A', 'rpc-a')])
  assert.deepEqual(a, [{ seq: 12, at: new Date(1792852000012).toISOString(), text: '消息 A' }])
  // 反序（先正式后占位）也只留一条
  const b = historyRows([um(12, '消息 A', 'rpc-a'), spliced(7, [ins('消息 A', 'rpc-a')])])
  assert.deepEqual(b, a)
  // 没有 rpcId 的 user/message 与占位行互不去重（没法证明是同一份）
  const c = historyRows([spliced(7, [ins('你好', '')]), um(12, '你好')])
  assert.equal(c.length, 2)
})

test('v94 · historyRows：两个不同 rpcId 的同文消息各算一条（双发就两条，不猜）', () => {
  const rows = historyRows([spliced(18, [ins('B', 'r1')]), spliced(19, [ins('B', 'r2')])])
  assert.deepEqual(rows.map((r) => r.seq), [18, 19])
})

test('v94 · historyRows：混合流（正式 + 插话 + /goal + 注入）齐全且 /goal 行不变', () => {
  const rows = historyRows([
    um(12, 'A', 'rpc-a'),
    sys(13, 'agent-instructions', '注入'),
    spliced(18, [ins('B', 'rpc-b')]),
    goal(20, ' 把弹窗改好'),
  ])
  assert.deepEqual(rows.map((r) => [r.seq, r.text]), [[12, 'A'], [18, 'B'], [20, '/goal 把弹窗改好']])
})

test('v94 · historyRows + historyPage：翻页跨过 spliced 行不丢行、不重复', () => {
  const events = [spliced(3, [ins('最早的插话', 'rpc-0')])]
  for (let i = 10; i < 460; i++) events.push(um(i, '消息 ' + i, 'rpc-' + i))
  events.push(spliced(470, [ins('最新插话', 'rpc-latest')]))
  const all = historyRows(events)
  assert.equal(all.length, 452)
  // 200 条一页翻到最早一条
  const seen = []
  let before
  for (let guard = 0; guard < 10; guard++) {
    const page = historyPage(all, { before })
    seen.push(...page.messages)
    if (!page.hasMore) break
    before = page.before
  }
  assert.equal(seen.length, all.length)
  assert.equal(new Set(seen.map((m) => m.seq)).size, all.length, 'seq 不重复（选中键不碰撞）')
  assert.ok(seen.some((m) => m.text === '最早的插话'))
  assert.ok(seen.some((m) => m.text === '最新插话'))
})
