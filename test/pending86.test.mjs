import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'

const seed = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'pending 组')
  const a = M.addCard(b, g.id, 'A')
  const c = M.addCard(b, g.id, 'B')
  return { b, g, a, c, s1: g.statuses[0].id, s2: g.statuses[1].id }
}

test('v86 setPending：置位 / 复位都不改阶段；可同时改阶段', () => {
  const { b, a, s1, s2 } = seed()
  M.setPending(b, a.id, true)
  assert.equal(a.pending, true)
  assert.equal(a.col, s1)
  M.setPending(b, a.id, true, s2)
  assert.equal(a.pending, true)
  assert.equal(a.col, s2, '拖到别的阶段 = 阶段跟着变')
  M.setPending(b, a.id, false)
  assert.equal(a.pending, undefined)
  assert.equal(a.col, s2, '恢复活跃回原阶段，不回第一列')
})

test('v86 setPending：非法阶段点名报错；归档后不能再设', () => {
  const { b, a } = seed()
  assert.throws(() => M.setPending(b, a.id, true, 'nope'), (e) => e.code === 'BAD_COL')
  M.archiveCard(b, a.id)
  assert.throws(() => M.setPending(b, a.id, true), (e) => e.code === 'CARD_ARCHIVED')
})

test('v86 归档会清掉 pending；未完成任务仍拦归档', () => {
  const { b, a, c } = seed()
  M.setTasks(b, c.id, [{ text: '未完成的任务', done: false, subs: [] }])
  M.setPending(b, c.id, true)
  assert.throws(() => M.archiveCard(b, c.id), (e) => e.code === 'CARD_HAS_TASKS')
  M.setPending(b, a.id, true)
  M.archiveCard(b, a.id)
  assert.equal(a.pending, undefined, '归档后不留在 pending 区')
})
