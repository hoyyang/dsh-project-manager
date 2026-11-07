/**
 * v93（0.42）纯规则单测：说明追加、说明框 / 触发、任务不再注入卡片档案。
 * 跑法：node --test test/v93.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendNotes, autoTaskTitle, detectSlash, deriveTaskTitle } from '../lib/goaltext.js'
import { cardLines } from '../lib/memory.js'
import { historyPage, historyRow } from '../lib/history.js'

test('appendNotes：按点选顺序、空行分隔、追加在现有说明后面', () => {
  assert.equal(appendNotes('', ['甲', '乙']), '甲\n\n乙')
  assert.equal(appendNotes('原有说明', ['甲']), '原有说明\n\n甲')
  assert.equal(appendNotes('原有说明\n\n', ['甲']), '原有说明\n\n甲')
  // 空 / 纯空白的选择不动说明
  assert.equal(appendNotes('原有说明', []), '原有说明')
  assert.equal(appendNotes('原有说明', ['  ', '']), '原有说明')
  // 顺序 = 点选顺序（与列表顺序无关）
  assert.equal(appendNotes('', ['三', '一', '四']), '三\n\n一\n\n四')
})

test('detectSlash：首个 / 与 空格 + /；行中间的 / 不触发', () => {
  assert.deepEqual(detectSlash('/', true), { len: 1, query: '' })
  assert.deepEqual(detectSlash('/go', true), { len: 3, query: 'go' })
  // 替换区间含触发符前那个空格（与 quote.ts detectQuote 同一口径）
  assert.deepEqual(detectSlash(' 前面 /ds', false), { len: 4, query: 'ds' })
  assert.equal(detectSlash('/go', false), null, '不是段落开头时首个 / 不算')
  assert.equal(detectSlash('https://x/y', true), null, 'URL 里的斜杠不触发')
  assert.equal(detectSlash('a /b c', true), null, '筛选词里有空白 → 不触发')
})

test('deriveTaskTitle：默认取第一行去掉 /goal，留空回自动标题（v93 标题内联沿用）', () => {
  assert.equal(deriveTaskTitle('/goal 把标题内联'), '把标题内联')
  // 只有 /goal、第一行没有别的字 → 退回第一行原文（沿用 v92 规则）
  assert.equal(deriveTaskTitle('/goal\n第二行'), '/goal')
})

test('autoTaskTitle：弹窗标题框的自动标题跟说明走；说明空 → 清空回占位符（调试「空说明后自动标题」）', () => {
  // 打开时：/goal 消息的说明 → 第一行去掉 /goal
  assert.equal(autoTaskTitle('/goal 调试空说明后自动标题'), '调试空说明后自动标题')
  // 清空说明后 → 标题跟着清空（露占位符；添加时再自动导一次），不再残留旧自动标题
  assert.equal(autoTaskTitle(''), '')
  assert.equal(autoTaskTitle('   \n  '), '')
  // 空说明后补的新说明 → 自动标题 = 新说明第一行（多行取第一行、去 /goal）
  assert.equal(autoTaskTitle('空说明后补的新说明第一行\n第二行'), '空说明后补的新说明第一行')
  assert.equal(autoTaskTitle('/goal 变体B：从历史填入的说明\n尾行'), '变体B：从历史填入的说明')
})

test('v93 ④：卡片档案不再输出「任务」整块（系统提示 / STATE 同一份生成逻辑）', () => {
  const board = {
    groups: [{ id: 'g1', name: '组', collapsed: false, repos: [], links: [], statuses: [{ id: 's1', name: '实施' }] }],
    cards: [{ id: 'c1', g: 'g1', col: 's1', order: 1, t: '卡片', links: [], webLinks: [{ id: 'l1', text: '仓库', type: 'GitHub', url: 'https://x' }], tasks: [{ id: 't1', text: '任务标题', done: false, note: '任务说明' }] }],
    sessions: [],
  }
  const lines = cardLines(board, board.cards[0], { notesMax: 1000 })
  const text = lines.join('\n')
  assert.ok(text.includes('相关链接'), '其他区块照旧')
  assert.ok(!text.includes('任务（完成'), '任务块整块不出现：' + text)
  assert.ok(!text.includes('任务标题'), '任务标题不出现')
  assert.ok(!text.includes('任务说明'), '任务说明不出现')
})

test('historyRow：只认真实用户输入（user/message + source.kind=user 与 command/run(goal)）', () => {
  const um = historyRow({ type: 'user/message', seq: 7, time: 1700000000000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我发的话' }] } })
  assert.equal(um && um.text, '我发的话')
  assert.equal(um && um.seq, 7)
  assert.equal(historyRow({ type: 'user/message', seq: 8, data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '注入' }] } }), null, '注入不算')
  assert.equal(historyRow({ type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [] } }), null, '空正文不算')
  const goal = historyRow({ type: 'command/run', seq: 10, time: '2026-10-24T02:00:00.000Z', data: { name: 'goal', args: ' 把弹窗改好', source: { kind: 'user' } } })
  assert.equal(goal && goal.text, '/goal 把弹窗改好')
  assert.equal(goal && goal.at, '2026-10-24T02:00:00.000Z')
  assert.equal(historyRow({ type: 'command/run', seq: 11, data: { name: 'compact', args: '', source: { kind: 'user' } } }), null, '其他命令不算')
})

test('historyPage（v94）：200 条一页、从新到旧、before 往前翻到最早一条', () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ seq: i + 1, at: '', text: 'm' + (i + 1) }))
  const p1 = historyPage(many)
  assert.equal(p1.messages.length, 200)
  assert.equal(p1.messages[0].text, 'm450', '最新一条在最前')
  assert.equal(p1.messages[199].text, 'm251')
  assert.equal(p1.total, 450)
  assert.equal(p1.hasMore, true)
  assert.equal(p1.before, 251)
  const p2 = historyPage(many, { before: p1.before })
  assert.equal(p2.messages[0].text, 'm250')
  assert.equal(p2.messages.length, 200)
  assert.equal(p2.hasMore, true)
  const p3 = historyPage(many, { before: p2.before })
  assert.equal(p3.messages.length, 50)
  assert.equal(p3.messages[49].text, 'm1', '翻到最早一条')
  assert.equal(p3.hasMore, false)
  // 不超一页 → 没有更多
  const small = historyPage([{ seq: 1, at: '', text: 'a' }])
  assert.equal(small.hasMore, false)
  assert.equal(small.total, 1)
  assert.equal(small.before, 1)
  // 自定义 limit 夹在 1–400
  assert.equal(historyPage(many, { limit: 1000 }).messages.length, 400)
  assert.equal(historyPage(many, { limit: 0 }).messages.length, 200)
})
