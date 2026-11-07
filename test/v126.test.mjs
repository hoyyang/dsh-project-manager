import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/gantt.js'
import * as M from '../lib/model.js'

/* v120–v126：任务执行安排六分区落盘 / 计划清单开合落盘 / 勾选 = 任务完成 / 说明不限字数 */

const tsk = (id, text, done = false, subs) => ({ id, text, done, ...(subs ? { subs } : {}) })
const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: '卡片 ' + id, links: [], tasks: [], repos: [], ...extra })
const cA = () => card('cA', { tasks: [tsk('t1', '任务 1'), tsk('t2', '任务 2', false, [tsk('s1', '子 1'), tsk('s2', '子 2')])] })
const valid = () => G.taskKeySetAll([cA()])
const D = '2026-10-20'

test('v121（1.2 根因）lanes 行内顺序保持用户拖出来的顺序（不再按字母 sort）', () => {
  const st = { cards: {} }
  const sel = ['t|cA|t1', 's|cA|s2', 's|cA|s1']
  G.setPanelDay(st, D, { sel, lanes: [['s|cA|s2', 's|cA|s1', 't|cA|t1']] }, valid())
  assert.deepEqual(st.panels[D].lanes, [['s|cA|s2', 's|cA|s1', 't|cA|t1']])
  /* 集合字段仍然排好序存（比对稳定） */
  assert.deepEqual(st.panels[D].sel, [...sel].sort())
})

test('v121 pst 接受 wait（等外部进展），其它值丢弃', () => {
  const st = { cards: {} }
  G.setPanelDay(st, D, { sel: ['t|cA|t1', 's|cA|s1', 's|cA|s2'], pst: { 't|cA|t1': 'wait', 's|cA|s1': 'pause', 's|cA|s2': 'bogus' } }, valid())
  assert.deepEqual(st.panels[D].pst, { 't|cA|t1': 'wait', 's|cA|s1': 'pause' })
})

test('v122/v123 zl：四个行分区保序、跨分区去重、只留排在今天的 key', () => {
  const st = { cards: {} }
  G.setPanelDay(st, D, { sel: ['t|cA|t1', 's|cA|s1', 's|cA|s2'], zl: { pause: [['s|cA|s2', 's|cA|s1']], wait: [['s|cA|s1']], run: [['t|cA|t1']], un: [['p|cX']] } }, valid())
  assert.deepEqual(st.panels[D].zl, { pause: [['s|cA|s2', 's|cA|s1']], run: [['t|cA|t1']] })
  /* 取消排今天 → 旧 zl 跟着裁掉 */
  G.setPanelDay(st, D, { sel: ['t|cA|t1'] }, valid())
  assert.deepEqual(st.panels[D].zl, { run: [['t|cA|t1']] })
})

test('v122 doneAt / v123 from：只跟着 done 走；from 只认合法分区', () => {
  const st = { cards: {} }
  G.setPanelDay(st, D, { sel: ['t|cA|t1', 's|cA|s1'], done: ['t|cA|t1'], doneAt: { 't|cA|t1': 1700000000000, 's|cA|s1': 5 }, from: { 't|cA|t1': 'pause', 's|cA|s1': 'run' } }, valid())
  assert.deepEqual(st.panels[D].doneAt, { 't|cA|t1': 1700000000000 })
  assert.deepEqual(st.panels[D].from, { 't|cA|t1': 'pause' })
  G.setPanelDay(st, D, { from: { 't|cA|t1': 'done' } }, valid())
  assert.equal(st.panels[D].from, undefined, 'done 不能当来源分区')
  /* 撤销执行（done 里没了）→ doneAt 一起清掉 */
  G.setPanelDay(st, D, { done: [] }, valid())
  assert.equal(st.panels[D].doneAt, undefined)
})

test('v121 / v124 setUi：pldone 布尔、plclosed / plopen key 列表、exz 分区列表，null 复位', () => {
  const g = { cards: {} }
  G.setUi(g, { pldone: true, plclosed: ['g|g1', 'p|cA', 'bad key', 't|cA|t1'], plopen: ['t|cA|t2'], exz: ['done', 'run', 'nope'] })
  assert.equal(g.ui.pldone, true)
  assert.deepEqual(g.ui.plclosed, ['g|g1', 'p|cA', 't|cA|t1'])
  assert.deepEqual(g.ui.plopen, ['t|cA|t2'])
  assert.deepEqual(g.ui.exz, ['done', 'run'])
  G.setUi(g, { exz: [] })
  assert.deepEqual(g.ui.exz, [], '空数组 = 用户把分区全展开了（不能当缺省）')
  G.setUi(g, { pldone: null, plclosed: null, plopen: null, exz: null })
  assert.deepEqual(g.ui, {})
})

test('v122（1.4）setTaskDone：只改 done、连带子任务 / 父任务自动完成，说明不丢', () => {
  const c = cA(); c.tasks[1].note = '说明保留'; c.tasks[1].subs[0].note = '子说明'
  const b = { cards: [c], groups: [], sessions: [] }
  M.setTaskDone(b, 'cA', 't2', true)
  assert.equal(c.tasks[1].done, true)
  assert.ok(c.tasks[1].subs.every((x) => x.done))
  assert.equal(c.tasks[1].note, '说明保留')
  assert.equal(c.tasks[1].subs[0].note, '子说明')
  M.setTaskDone(b, 'cA', 's1', false)
  assert.equal(c.tasks[1].done, false, '子任务取消完成 → 父任务不再是完成')
  M.setTaskDone(b, 'cA', 's1', true)
  assert.equal(c.tasks[1].done, true, '子任务全完成 → 父任务自动完成')
  assert.throws(() => M.setTaskDone(b, 'cA', 'zz', true), /没有这个任务/)
})

test('v123（2）任务说明不限字数：60 万字照样存', () => {
  const big = '字'.repeat(600000)
  const b = { cards: [card('cA')], groups: [{ id: 'g1', name: '组', statuses: [{ id: 'c1', name: '常规' }] }], sessions: [], taskTypes: [] }
  const out = M.setTasks(b, 'cA', [{ id: 't1', text: '任务', done: false, note: big }])
  assert.equal(out[0].note.length, 600000)
})
