import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rlPlan, CMIN, RMIN, DMIN } from '../lib/rlayout.js'

const base = { hostW: 0, ratio: null, drag: null, last: 'detail', full: false }
/* 1440 窗口、左栏 280：A = 1160，宿主右侧栏轨道 = min(A−400, 0.45·1440) = 648 */
test('v134 三列并排：无空白无重叠，三个下限都守住', () => {
  for (const [A, Rt, D0] of [[1160, 648, 420], [1160, 648, 760], [1440, 648, 420], [1064, 600, 420], [1100, 700, 360]]) {
    const p = rlPlan({ ...base, A, Rt, hostW: Rt, D0 })
    assert.equal(p.mode, 'pair')
    const conv = A - Rt - p.pad
    assert.ok(conv >= CMIN - 0.5, 'conv ' + conv)
    assert.ok(p.Rv >= RMIN && p.D >= DMIN)
    assert.equal(Math.round(conv + p.Rv + p.D), A, '三段拼满 A')
    assert.ok(p.pad >= 0)
  }
})
test('v134 详情放不下先收窄，最窄 360', () => {
  const p = rlPlan({ ...base, A: 1160, Rt: 648, hostW: 648, D0: 600 })
  assert.equal(p.D, 1160 - CMIN - RMIN)
  const q = rlPlan({ ...base, A: 1061, Rt: 600, hostW: 600, D0: 420 })
  assert.equal(q.D, 361)
})
test('v134 拖宿主把手按增量换算并记住比例；拖详情右侧栏让位', () => {
  const p0 = rlPlan({ ...base, A: 1160, Rt: 648, hostW: 648, D0: 420 })
  const p1 = rlPlan({ ...base, A: 1160, Rt: 648, hostW: 648, D0: 420, ratio: p0.ratio, drag: { rv0: p0.Rv, dx: 60 } })
  assert.equal(p1.Rv, Math.max(RMIN, p0.Rv - 60))
  const p2 = rlPlan({ ...base, A: 1160, Rt: 648, hostW: 648, D0: 420, ratio: p1.ratio })
  assert.equal(p2.Rv, p1.Rv, '松手后记住')
  const p3 = rlPlan({ ...base, A: 1160, Rt: 648, hostW: 648, D0: 460, ratio: p2.ratio })
  assert.ok(p3.D === 460 && p3.Rv <= p2.Rv)
})
test('v134 全屏铺到详情左边；放不下三列后开的在前', () => {
  assert.deepEqual(rlPlan({ ...base, A: 1160, Rt: 648, D0: 420, full: true }), { mode: 'full', rbR: 420 })
  const d = rlPlan({ ...base, A: 944, Rt: 544, D0: 380 })
  assert.equal(d.mode, 'compact-detail'); assert.equal(d.D, 544); assert.equal(d.pad, 0)
  const d2 = rlPlan({ ...base, A: 944, Rt: 300, D0: 380 })
  assert.equal(d2.D, 380); assert.equal(d2.pad, 80)
  assert.equal(rlPlan({ ...base, A: 944, Rt: 544, D0: 380, last: 'rightbar' }).mode, 'compact-rightbar')
})
test('v134 client：样式用属性 + 不继承变量、无 :has', () => {
  const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8')
  for (const k of ['--dpm-rb-r', '--dpm-rb-w', '--dpm-rbh-x', '--dpm-gd-w']) assert.match(css, new RegExp('@property ' + k + ' \\{[^}]*inherits: false'))
  assert.match(css, /\[data-dpm-rb="on"\] \{ right: var\(--dpm-rb-r\) !important; width: var\(--dpm-rb-w\) !important; \}/)
  assert.ok(!css.includes(':has('))
  const b = readFileSync(new URL('../src/client/board.ts', import.meta.url), 'utf8')
  /* v145（4）：一个排版引擎管全部列（colsPlan 取代 rlPlan），找不到宿主节点照样 console 点名 */
  assert.match(b, /colsPlan\(/)
  assert.match(b, /console\.warn\('\[dsh-project-manager\] 找不到 DSH 主框架节点/)
})
