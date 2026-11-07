import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colsPlan, COL_MIN, TAB_W } from '../lib/rlayout.js'

const W = (o) => Object.fromEntries(o.cols.map((c) => [c.k, c.w]))
test('v150 colsPlan：放得下 = 各列按想要宽度，从右往左 ap | rbx | cd | tp', () => {
  const o = colsPlan(1800, [{ k: 'tp', want: 380, at: 1 }, { k: 'cd', want: 420, at: 2 }])
  assert.deepEqual(o.cols, [{ k: 'cd', w: 420, right: 0 }, { k: 'tp', w: 380, right: 420 }])
  assert.equal(o.total, 800); assert.deepEqual(o.away, [])
})
test('v150 colsPlan：放不下先按余量比例压到下限，中间区 ≥ 400', () => {
  const o = colsPlan(1400, [{ k: 'tp', want: 400, at: 1 }, { k: 'cd', want: 460, at: 2 }, { k: 'rbx', want: 400, at: 3 }])
  const w = W(o)
  assert.equal(o.away.length, 0)
  assert.ok(1400 - o.total >= 400 - 1, String(o.total))
  for (const k of ['tp', 'cd', 'rbx']) assert.ok(w[k] >= COL_MIN[k], k)
})
test('v150 colsPlan：还放不下 = 最早打开的非面板列收成 44px 竖条；面板不让位', () => {
  const o = colsPlan(1300, [{ k: 'tp', want: 380, at: 0 }, { k: 'cd', want: 420, at: 2 }, { k: 'rbx', want: 400, at: 1 }, { k: 'ap', want: 360, at: 3 }])
  assert.ok(o.away.includes('rbx'))
  assert.ok(!o.away.includes('tp'))
  assert.equal(o.tabs, o.away.length * TAB_W)
  assert.equal(o.cols[0].right, o.tabs, '显示的列整体让出竖条宽度')
  assert.ok(1300 - o.total >= 400 - 1)
})
test('v150 colsPlan：刚换到前面的列不会因为竖条占地又被叠回去', () => {
  const o = colsPlan(1120, [{ k: 'tp', want: 380, at: 0 }, { k: 'cd', want: 420, at: 9 }, { k: 'rbx', want: 400, at: 1 }, { k: 'ap', want: 420, at: 2 }])
  assert.ok(o.cols.some((c) => c.k === 'cd'), JSON.stringify(o))
  assert.ok(o.cols.some((c) => c.k === 'tp'))
  assert.deepEqual(o.away.sort(), ['ap', 'rbx'])
})
test('v150 colsPlan：只剩面板也放不下 = 面板压到下限', () => {
  const o = colsPlan(600, [{ k: 'tp', want: 500, at: 0 }])
  assert.deepEqual(o.cols, [{ k: 'tp', w: 300, right: 0 }])
})
