import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/gantt.js'

/* v105 每日任务面板：任务项 key 校验 + 按天状态落盘 + /gantt 载荷带任务明细 */

const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: '卡片 ' + id, links: [], tasks: [], repos: [], ...extra })
const tsk = (id, text, done = false, subs) => ({ id, text, done, ...(subs ? { subs } : {}) })

const withTasks = () => card('cA', {
  tasks: [
    tsk('t1', '任务 1', false, [tsk('s1', '子 1', true), tsk('s2', '子 2', false)]),
    tsk('t2', '任务 2', true),
  ],
})

test('v105 taskKeySet：项目 / 任务 / 子任务三层 key 齐全，不把子任务当成任务', () => {
  const c = withTasks()
  const set = G.taskKeySet(c)
  assert.ok(set.has('p|cA'))
  assert.ok(set.has('t|cA|t1'))
  assert.ok(set.has('t|cA|t2'))
  assert.ok(set.has('s|cA|s1'))
  assert.ok(set.has('s|cA|s2'))
  assert.ok(!set.has('t|cA|s1'), '子任务不能按任务层 key 放进来')
  assert.equal(set.size, 5)
  const all = G.taskKeySetAll([c, card('cB', { tasks: [tsk('t9', 'x')] })])
  assert.ok(all.has('t|cB|t9') && all.has('p|cB'))
  assert.equal(all.size, 7)
})

test('v105 setPanelDay：勾选 / 选中 / 排布分别落盘，空数组 = 清掉', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { done: ['t|cA|t1', 's|cA|s2'], sel: ['s|cA|s2', 't|cA|t1'] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].done, ['s|cA|s2', 't|cA|t1'])
  assert.deepEqual(st.panels['2026-10-26'].sel, ['s|cA|s2', 't|cA|t1'])
  /* lanes：只收「已选中 + 合法 + 不重复」的 key */
  G.setPanelDay(st, '2026-10-26', { lanes: [['s|cA|s2', 't|cA|t1', 't|cA|t1'], ['t|cA|t2', 'nope|x']] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].lanes, [['s|cA|s2', 't|cA|t1']])
  /* 取消勾选 / 取消选中后：空 = 删掉这一项；整天空了 = 连这一天一起删 */
  G.setPanelDay(st, '2026-10-26', { done: [], sel: [] }, valid)
  assert.equal(st.panels?.['2026-10-26'], undefined)
  G.setPanelDay(st, '2026-10-26', { lanes: [] }, valid)
  assert.equal(st.panels, undefined)
})

test('v105 setPanelDay：非法 key 丢弃、跨卡 key 丢弃、坏日期报错', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { done: ['t|cA|t1', 't|ZZZ|t1', 'garbage', 42, 'p|cA'] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].done, ['p|cA', 't|cA|t1'])
  assert.throws(() => G.setPanelDay(st, '2026-02-31', { sel: [] }, valid))
})

test('v105 setPanelDay：卡片 / 任务被删后，旧 key 在下一次写盘时清掉', () => {
  const st = { cards: {} }
  const full = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { done: ['t|cA|t1', 't|cA|t2'], sel: ['t|cA|t1'] }, full)
  const shrink = G.taskKeySet(card('cA', { tasks: [tsk('t1', '任务 1')] }))
  G.setPanelDay(st, '2026-10-26', { done: ['t|cA|t1'] }, shrink)
  assert.deepEqual(st.panels['2026-10-26'].done, ['t|cA|t1'])
  assert.deepEqual(st.panels['2026-10-26'].sel, ['t|cA|t1'])
})

test('v105 setPanelDay：只改选中时，旧排布同步对齐（取消选中的项不许留在 lanes 里）', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1', 't|cA|t2'], lanes: [['t|cA|t1', 't|cA|t2']] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].lanes, [['t|cA|t1', 't|cA|t2']])
  /* 取消选中 t2：只发 sel，lanes 里也必须跟着去掉 */
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1'] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].lanes, [['t|cA|t1']])
  /* 全部取消选中：lanes 直接清掉 */
  G.setPanelDay(st, '2026-10-26', { sel: [] }, valid)
  assert.equal(st.panels?.['2026-10-26']?.lanes, undefined)
})

test('v105 /gantt 载荷：卡片带任务明细（含子任务）+ panels 整份带出去', () => {
  const g1 = { id: 'g1', name: '组', updatedAt: '2026-10-01T00:00:00Z', statuses: [{ id: 'c1', name: '常规任务' }] }
  const b = { cards: [withTasks()], groups: [g1], sessions: [] }
  const g = { cards: { cA: { plan: ['2026-10-26'] } }, panels: { '2026-10-26': { sel: ['t|cA|t1'] } } }
  const out = G.payload(b, g, {}, [], [], Date.parse('2026-10-26T10:00:00'))
  const c = out.cards[0]
  assert.deepEqual(c.tasks, [
    { id: 't1', text: '任务 1', done: false, subs: [{ id: 's1', text: '子 1', done: true }, { id: 's2', text: '子 2', done: false }] },
    { id: 't2', text: '任务 2', done: true, subs: [] },
  ])
  assert.deepEqual(out.panels, { '2026-10-26': { sel: ['t|cA|t1'] } })
  assert.equal(out.today, '2026-10-26')
})
