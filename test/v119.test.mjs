import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tFindIn, tMove } from '../lib/tasks.js'

/* v119：任务 / 子任务拖动改层级（同区内）——纯逻辑：nest / outdent / order + 守卫 */

const t = (id, done = false, subs) => ({ id, text: '任务 ' + id, done, ...(subs ? { subs } : {}) })
const seed = () => [t('a', true, [t('a1', true), t('a2', true)]), t('b', true), t('c', false, [t('c1', false), t('c2', false)]), t('d', false)]
const ids = (l) => l.map((x) => x.id + ':' + (x.done ? 'D' : 'U') + ((x.subs ?? []).length ? '[' + x.subs.map((s) => s.id).join(',') + ']' : ''))

test('v119 nest：任务拖到另一个任务上 = 变成它最后一个子任务', () => {
  const l = seed()
  const r = tMove(l, { id: 'd', tid: 'c', mode: 'nest', before: true })
  assert.equal(r.err, undefined)
  assert.match(r.msg, /已成为/)
  assert.deepEqual(ids(l), ['a:D[a1,a2]', 'b:D', 'c:U[c1,c2,d]'])
})

test('v119 nest：已完成区里同样能嵌套，且完成态不被改', () => {
  const l = seed()
  const r = tMove(l, { id: 'b', tid: 'a', mode: 'nest', before: true })
  assert.equal(r.err, undefined)
  assert.deepEqual(ids(l), ['a:D[a1,a2,b]', 'c:U[c1,c2]', 'd:U'])
})

test('v119 nest 守卫：子任务不能再套一层（目标本身是子任务）', () => {
  const l = seed()
  const r = tMove(l, { id: 'd', tid: 'c1', mode: 'nest', before: true })
  assert.match(r.err, /子任务最多一层/)
  assert.deepEqual(ids(l), ['a:D[a1,a2]', 'b:D', 'c:U[c1,c2]', 'd:U'])
})

test('v119 nest：子任务可以直接改挂到另一个任务（换父任务）', () => {
  const l = seed()
  const r = tMove(l, { id: 'c1', tid: 'a', mode: 'nest', before: true })
  assert.equal(r.err, undefined)
  assert.deepEqual(ids(l), ['a:D[a1,a2,c1]', 'b:D', 'c:U[c2]', 'd:U'])
})

test('v119 nest 守卫：有子任务的任务不能再成为别人的子任务', () => {
  const l = seed()
  const r = tMove(l, { id: 'c', tid: 'd', mode: 'nest', before: true })
  assert.match(r.err, /还有 2 个子任务/)
  assert.deepEqual(ids(l), ['a:D[a1,a2]', 'b:D', 'c:U[c1,c2]', 'd:U'])
})

test('v119 nest 守卫：已经是它的子任务了', () => {
  const l = seed()
  const r = tMove(l, { id: 'c1', tid: 'c', mode: 'nest', before: true })
  assert.match(r.err, /已经在/)
})

test('v119 outdent：子任务拖回顶层，插在父任务前面（before）', () => {
  const l = seed()
  const r = tMove(l, { id: 'c1', tid: 'c', mode: 'outdent', before: true })
  assert.equal(r.err, undefined)
  assert.deepEqual(ids(l), ['a:D[a1,a2]', 'b:D', 'c1:U', 'c:U[c2]', 'd:U'])
})

test('v119 outdent：before=false 时插在父任务后面', () => {
  const l = seed()
  const r = tMove(l, { id: 'a1', tid: 'a', mode: 'outdent', before: false })
  assert.equal(r.err, undefined)
  assert.deepEqual(ids(l), ['a:D[a2]', 'a1:D', 'b:D', 'c:U[c1,c2]', 'd:U'])
})

test('v119 outdent 守卫：本来就是顶层任务', () => {
  const l = seed()
  const r = tMove(l, { id: 'd', tid: 'b', mode: 'outdent', before: true })
  assert.match(r.err, /已经是独立任务/)
})

test('v119 order：顶层两个任务换位（before / after）', () => {
  const l = seed()
  assert.equal(tMove(l, { id: 'd', tid: 'c', mode: 'order', before: true }).err, undefined)
  assert.deepEqual(l.map((x) => x.id), ['a', 'b', 'd', 'c'])
  assert.equal(tMove(l, { id: 'd', tid: 'c', mode: 'order', before: false }).err, undefined)
  assert.deepEqual(l.map((x) => x.id), ['a', 'b', 'c', 'd'])
})

test('v119 order：子任务之间换位只影响自己这一组', () => {
  const l = seed()
  assert.equal(tMove(l, { id: 'c1', tid: 'c2', mode: 'order', before: false }).err, undefined)
  assert.deepEqual(ids(l), ['a:D[a1,a2]', 'b:D', 'c:U[c2,c1]', 'd:U'])
})

test('v119 order 守卫：不允许跨层 / 跨父任务换位', () => {
  const l = seed()
  assert.match(tMove(l, { id: 'd', tid: 'c1', mode: 'order', before: true }).err, /同层/)
  const l2 = [t('x', false, [t('x1', false)]), t('y', false, [t('y1', false)])]
  assert.match(tMove(l2, { id: 'x1', tid: 'y1', mode: 'order', before: true }).err, /这一组/)
})

test('v119 没变化 / 找不到：msg 为空或 err 明确', () => {
  const l = seed()
  assert.equal(tMove(l, { id: 'b', tid: 'b', mode: 'order', before: true }).msg, '')
  assert.match(tMove(l, { id: 'zz', tid: 'b', mode: 'nest', before: true }).err, /找不到/)
})

test('v119 tFindIn：给出所属数组与父任务', () => {
  const l = seed()
  assert.equal(tFindIn(l, 'c').p, null)
  const h = tFindIn(l, 'c1')
  assert.equal(h.p.id, 'c')
  assert.equal(h.list, l[2].subs)
  assert.equal(tFindIn(l, 'nope'), null)
})
