import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/gantt.js'

/* v111：每日任务面板「自动续排」标记（panels[day].carry） */

const tsk = (id, text, done = false, subs) => ({ id, text, done, ...(subs ? { subs } : {}) })
const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: '卡片 ' + id, links: [], tasks: [], repos: [], ...extra })
const withTasks = () => card('cA', { tasks: [tsk('t1', '任务 1'), tsk('t2', '任务 2', false, [tsk('s1', '子 1'), tsk('s2', '子 2')])] })

test('v111 setPanelDay：carry 标记落盘、单独存在也保留这一天', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  const day = G.setPanelDay(st, '2026-10-27', { carry: true }, valid)
  assert.equal(day?.carry, true)
  assert.equal(st.panels?.['2026-10-27']?.carry, true)
  assert.deepEqual(st.panels?.['2026-10-27']?.sel, undefined)
})

test('v111 setPanelDay：carry 和 sel / pst 一起写，互不影响', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-27', { sel: ['t|cA|t1', 's|cA|s2'], pst: { 't|cA|t1': 'run' }, carry: true }, valid)
  const p = st.panels?.['2026-10-27']
  assert.equal(p?.carry, true)
  assert.deepEqual(p?.sel, ['s|cA|s2', 't|cA|t1'])
  assert.deepEqual(p?.pst, { 't|cA|t1': 'run' })
})

test('v111 setPanelDay：carry=false 清掉标记；也清空 = 删掉整天', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-27', { carry: true }, valid)
  G.setPanelDay(st, '2026-10-27', { carry: false }, valid)
  assert.equal(st.panels?.['2026-10-27'], undefined)
})

test('v111 setPanelDay：以后的重复续排被 carry 标记挡住（存在即可判断）', () => {
  const st = { cards: {} }
  const valid = G.taskKeySet(withTasks())
  G.setPanelDay(st, '2026-10-27', { sel: ['t|cA|t1'], carry: true }, valid)
  /* 模拟「用户把续排进来的项全部取消」：sel 清空，但 carry 还在 → 这一天不会重跑续排 */
  G.setPanelDay(st, '2026-10-27', { sel: [] }, valid)
  assert.equal(st.panels?.['2026-10-27']?.carry, true)
  assert.equal(st.panels?.['2026-10-27']?.sel, undefined)
})
