import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/gantt.js'

/* v118：本日计划清单收起（ui.pfold）+ 只显示可安排（ui.plonly）落盘 */

const tsk = (id, text, done = false, subs) => ({ id, text, done, ...(subs ? { subs } : {}) })
const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: '卡片 ' + id, links: [], tasks: [], repos: [], ...extra })
const withTasks = () => card('cA', { tasks: [tsk('t1', '任务 1')] })

test('v118 setUi.pfold：布尔落盘、null 复位、非布尔不动', () => {
  const g = { cards: {} }
  G.setUi(g, { pfold: false })
  assert.equal(g.ui.pfold, false)
  G.setUi(g, { pfold: 'yes' })
  assert.equal(g.ui.pfold, false, '非布尔值不能改掉已有设置')
  G.setUi(g, { pfold: true })
  assert.equal(g.ui.pfold, true)
  G.setUi(g, { pfold: null })
  assert.equal(g.ui.pfold, undefined)
})

test('v118 setUi.plonly：布尔落盘、null 复位、非布尔不动', () => {
  const g = { cards: {} }
  G.setUi(g, { plonly: false })
  assert.equal(g.ui.plonly, false)
  G.setUi(g, { plonly: 1 })
  assert.equal(g.ui.plonly, false, '非布尔值不能改掉已有设置')
  G.setUi(g, { plonly: true })
  assert.equal(g.ui.plonly, true)
  G.setUi(g, { plonly: null })
  assert.equal(g.ui.plonly, undefined)
})

test('v118 setUi：pfold / plonly 同一次写入互不影响，也不动宽度与比例', () => {
  const g = { cards: {}, ui: { lw: 260, tpr: 55 } }
  G.setUi(g, { pfold: false, plonly: false })
  assert.deepEqual(g.ui, { lw: 260, tpr: 55, pfold: false, plonly: false })
  G.setUi(g, { plonly: true })
  assert.deepEqual(g.ui, { lw: 260, tpr: 55, pfold: false, plonly: true })
})

test('v118 /gantt 载荷：ui 带 pfold / plonly，panels 不受影响', () => {
  const g1 = { id: 'g1', name: '组', updatedAt: '2026-10-01T00:00:00Z', statuses: [{ id: 'c1', name: '常规任务' }] }
  const b = { cards: [withTasks()], groups: [g1], sessions: [] }
  const g = { cards: {}, panels: {}, ui: { pfold: true, plonly: true } }
  const out = G.payload(b, g, {}, [], [], Date.parse('2026-10-26T10:00:00'))
  assert.equal(out.ui.pfold, true)
  assert.equal(out.ui.plonly, true)
})
