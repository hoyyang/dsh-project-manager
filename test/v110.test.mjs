import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/gantt.js'

/* v110：执行 / 暂停状态落盘（panels[day].pst）+ pending 显隐落盘（ui.pend） */

const tsk = (id, text, done = false, subs) => ({ id, text, done, ...(subs ? { subs } : {}) })
const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: '卡片 ' + id, links: [], tasks: [], repos: [], ...extra })
const withTasks = () => card('cA', { tasks: [tsk('t1', '任务 1'), tsk('t2', '任务 2', false, [tsk('s1', '子 1'), tsk('s2', '子 2')])] })

test('v110 setPanelDay：执行 / 暂停状态落盘，非法 key 与非法值丢弃', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1', 's|cA|s2'], pst: { 't|cA|t1': 'run', 's|cA|s2': 'pause', 't|ZZZ|t1': 'run', 't|cA|t2': 'bogus' } }, valid)
  assert.deepEqual(st.panels['2026-10-26'].pst, { 't|cA|t1': 'run', 's|cA|s2': 'pause' })
})

test('v110 setPanelDay：只改选中时 pst 跟着新选中集合裁掉；pst 空 = 删掉这一项', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1', 's|cA|s2'], pst: { 't|cA|t1': 'run', 's|cA|s2': 'pause' } }, valid)
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1'] }, valid)
  assert.deepEqual(st.panels['2026-10-26'].pst, { 't|cA|t1': 'run' })
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1'], pst: {} }, valid)
  assert.equal(st.panels['2026-10-26'].pst, undefined)
})

test('v110 setPanelDay：执行态清空 + 勾选 / 选中都空 = 删掉整天面板', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { done: ['t|cA|t1'], sel: ['t|cA|t1'], pst: { 't|cA|t1': 'run' } }, valid)
  assert.deepEqual(st.panels['2026-10-26'].pst, { 't|cA|t1': 'run' })
  G.setPanelDay(st, '2026-10-26', { done: [], sel: [], pst: {} }, valid)
  assert.equal(st.panels?.['2026-10-26'], undefined)
})

test('v110 setUi.pend：布尔落盘、null 复位、非布尔不动', () => {
  const g = { cards: {} }
  G.setUi(g, { pend: false })
  assert.equal(g.ui.pend, false)
  G.setUi(g, { pend: 'yes' })
  assert.equal(g.ui.pend, false, '非布尔值不能改掉已有设置')
  G.setUi(g, { pend: true })
  assert.equal(g.ui.pend, true)
  G.setUi(g, { pend: null })
  assert.equal(g.ui.pend, undefined)
})

test('v110 setPanelDay：pst 只认「已选中」的 key（没选中的执行态不落盘）', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-26', { sel: ['t|cA|t1'], pst: { 't|cA|t1': 'run', 's|cA|s2': 'pause' } }, valid)
  assert.deepEqual(st.panels['2026-10-26'].pst, { 't|cA|t1': 'run' })
})

test('v110 /gantt 载荷：panels 带 pst、ui 带 pend', () => {
  const g1 = { id: 'g1', name: '组', updatedAt: '2026-10-01T00:00:00Z', statuses: [{ id: 'c1', name: '常规任务' }] }
  const b = { cards: [withTasks()], groups: [g1], sessions: [] }
  const g = { cards: {}, panels: { '2026-10-26': { sel: ['t|cA|t1'], pst: { 't|cA|t1': 'pause' } } }, ui: { pend: false } }
  const out = G.payload(b, g, {}, [], [], Date.parse('2026-10-26T10:00:00'))
  assert.deepEqual(out.panels, { '2026-10-26': { sel: ['t|cA|t1'], pst: { 't|cA|t1': 'pause' } } })
  assert.equal(out.ui.pend, false)
})
