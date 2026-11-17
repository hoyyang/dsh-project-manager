/* v170：只设了「晚于今天」的截止 —— 项目行 / 组行的截止旗子也从「今天」拉一条同色虚线 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const gantt = src('gantt.ts')
const css = src('style.css')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v170 nowX：今天竖线的 x 只有一个来源（定义一处，药丸 / .now / 兜底三处调用）', () => {
  assert.match(gantt, /const nowX = \(\): number => at\(TODAY\) \+ Math\.max\(2, at\(TODAY \+ D\) - at\(TODAY\)\) \/ 2/)
  const dup = gantt.match(/at\(TODAY\) \+ Math\.max\(2, at\(TODAY \+ D\) - at\(TODAY\)\) \/ 2/g) || []
  assert.equal(dup.length, 1, 'nowX 算式只能出现在定义里，别处一律调 nowX()')
  assert.match(gantt, /class="now-pill" style="left:' \+ nowX\(\) \+ 'px"/)
  assert.match(gantt, /class="now" style="left:' \+ nowX\(\) \+ 'px"/)
})

test('v170 项目行兜底：「今天」竖线 → 旗子（edge 为空才补）+ data-from', () => {
  assert.match(gantt, /v170：这条行上没有任何「计划 \/ 执行」落在截止之前/)
  assert.match(gantt, /let fromToday = false\n          if \(edge == null\) \{ edge = nowX\(\); fromToday = true \}/)
  assert.match(gantt, /class="ddllead ' \+ \(hardN \? 'hard' : 'soft'\) \+ '"' \+ \(fromToday \? ' data-from="today"' : ''\) \+ ' data-lead="' \+ dayTxt/)
})

test('v170 组行兜底：同一套（两处 fallback）+ data-from', () => {
  assert.match(gantt, /v170：组内没有任何「计划 \/ 执行」落在截止之前/)
  const n = (gantt.match(/edge = nowX\(\)/g) || []).length
  assert.equal(n, 2, 'cardTrack / groupTrack 各一处')
  assert.match(gantt, /class="ddllead ' \+ \(hardN \? 'hard' : 'soft'\) \+ '"' \+ \(fromToday \? ' data-from="today"' : ''\) \+ ' data-lead="' \+ ymd\(ms\)/)
})

test('v170 有安排的行不动：edge 仍来自计划 / 实际条右端 + 上一面旗，兜底只在 null 时', () => {
  assert.match(gantt, /for \(const r0 of runs\) if \(r0\.e <= ms && r0\.e > win\.start\) edge = Math\.max\(edge == null \? -1 : edge, at\(r0\.e\)\)/)
  assert.match(gantt, /for \(const run of runsOfDays\(days\)\) if \(run\.e <= ms && run\.e > win\.start\) edge = Math\.max\(edge == null \? -1 : edge, at\(run\.e\)\)/)
  assert.match(gantt, /if \(prevFlagCx != null\) edge = Math\.max\(edge == null \? -1 : edge, prevFlagCx \+ 8\)/)
  assert.match(gantt, /cx - 10 - edge > 2/)
})

test('v170 CSS 零改动：虚线仍是 1.5px 虚线 + 同色圆点 + 软性蓝 + 组行隐藏规则', () => {
  assert.match(css, /\.dpm \.sched \.ddllead \{position: absolute; top: 50%; height: 0; border-top: 1\.5px dashed var\(--pm-ddl\);/)
  assert.match(css, /\.dpm \.sched \.ddllead::before \{content: ""; position: absolute; left: -2px; top: -3px;/)
  assert.match(css, /\.dpm \.sched \.ddllead\.soft \{ border-top-color: var\(--pm-ddl-soft\); \}/)
  assert.match(css, /\.sc-rows\.gtime-off \.sc-row\.g \.sc-track > \.ddllead \{ display: none; \}/)
})

test('v170 版本：0.67.0 已进 CHANGELOG（当前版本号由最新用例锁）', () => {
  assert.match(log, /## 0\.67\.0/)
  assert.match(log, /截止旗子/)
  assert.match(log, /今天竖线/)
})
