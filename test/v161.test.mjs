/* v161：跨天自动接续（推荐项 / 执行中照抄排布）+ 未安排悬停「执行 / 安排」 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setPanelDay, taskKeySet } from '../lib/gantt.js'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const gantt = src('gantt.ts')
const css = src('style.css')

const card = { id: 'c1', tasks: [{ id: 't1', subs: [{ id: 's1' }] }, { id: 't2' }] }
const valid = taskKeySet(card)
const K = 't|c1|t1'
const other = 't|c1|t2'
const day = '2026-11-10'
const st = () => ({ cards: {} })

test('host：PanelDay.rec 接受合法来源（key 必须在 sel 里）', () => {
  const s = st()
  setPanelDay(s, day, { sel: [K], rec: { [K]: { d: '2026-11-09', z: 'wait' } } }, valid)
  assert.deepEqual(s.panels[day].rec, { [K]: { d: '2026-11-09', z: 'wait' } })
})

test('host：rec 挡掉非法分区 / 非法日期 / 没排在今天的 key', () => {
  const s = st()
  setPanelDay(s, day, { sel: [K], rec: { [K]: { d: '2026-02-31', z: 'wait' } } }, valid)
  assert.equal(s.panels[day].rec, undefined)
  setPanelDay(s, day, { sel: [K], rec: { [K]: { d: '2026-11-09', z: 'done' } } }, valid)
  assert.equal(s.panels[day].rec, undefined)
  setPanelDay(s, day, { sel: [K], rec: { [other]: { d: '2026-11-09', z: 'un' } } }, valid)
  assert.equal(s.panels[day].rec, undefined)
  setPanelDay(s, day, { sel: [K], rec: { [K]: { d: '2026-11-09', z: 'run' } } }, valid)
  assert.deepEqual(s.panels[day].rec, { [K]: { d: '2026-11-09', z: 'run' } })
})

test('host：取消「排今天」后 rec 跟着裁掉；只改 pst 时保留', () => {
  const s = st()
  setPanelDay(s, day, { sel: [K], rec: { [K]: { d: '2026-11-09', z: 'pause' } } }, valid)
  setPanelDay(s, day, { pst: { [K]: 'run' } }, valid)
  assert.deepEqual(s.panels[day].rec, { [K]: { d: '2026-11-09', z: 'pause' } })
  setPanelDay(s, day, { sel: [] }, valid)
  assert.equal(s.panels?.[day]?.rec, undefined)
})

test('client：只接前一天 + 非执行中按 wait → pause → arr → un 顺序进未安排', () => {
  assert.match(gantt, /const prevKey = ymd\(dayMs\(dayKey\) - D\)/)
  assert.match(gantt, /for \(const z of \['wait', 'pause', 'arr', 'un'\] as const\)/)
  assert.match(gantt, /if \(keep.length\) u\.zl\.un\.push\(keep\)/)
})

test('client：执行中逐行照抄（行 / 顺序 / 并行分组），状态 = run', () => {
  assert.match(gantt, /for \(const row of \(pu\.zl\.run \?\? \[\]\)\)/)
  assert.match(gantt, /u\.zl\.run\.push\(keep\)/)
  assert.match(gantt, /PST\.set\(dayKey \+ '\\n' \+ k, 'run'\)/)
})

test('client：已完成 / 今天已排 / 已记录执行的项跳过；被接的卡片补「排今天」与计划条', () => {
  assert.match(gantt, /if \(!leaf \|\| leaf\.done\) return null/)
  assert.match(gantt, /if \(u\.done\.has\(k\) \|\| u\.sel\.has\(k\)\) return null/)
  assert.match(gantt, /leaf\.card\.planSet\.add\(dayKey\)/)
  assert.match(gantt, /self\.mutate\('plan', \{ card: c\.id, day: dayKey, on: true \}\)/)
})

test('client：推荐标记只在「还待在接进来的分区」时显示（未安排 / 执行中）', () => {
  assert.match(gantt, /z === \(r\.z === 'run' \? 'run' : 'un'\)/)
  /* v169：卡片第二行的「推荐 · 来源」胶囊下线 → 推荐语义改为卡片本体带 data-rec（分区计数 / 跨天跳转 / 落卡动效都读它） */
  assert.match(gantt, /\(recZ \? ' data-rec="' \+ recZ\.z \+ '"' : ''\)/)
})

test('client：未安排悬停 = 执行 + 安排 + 当日不安排（安排 disabled 跟随未来日期）', () => {
  assert.match(gantt, /else if \(zone === 'un'\) acts = pActBtn\('run'/)
  assert.match(gantt, /pActBtn\('arr', l\.key, future \? '未来的日子不能安排'/)
  assert.match(gantt, /pActBtn\('unsel'/)
  assert.match(gantt, /act === 'arr' \? '安排'/)
})

test('client：面板头「跨天 N」+ 分区「推荐 N」+「全部采纳」都接线', () => {
  assert.match(gantt, /ec\.textContent = n \? '跨天 ' \+ n : ''/)
  /* 设计卡 6.3：title 按来源分区写明细 */
  assert.match(gantt, /未安排 ' \+ unN \+ ' 项（等外部 '/)
  assert.match(gantt, /执行中 ' \+ cz\.run \+ ' 项按昨天的排布继续'/)
  /* 设计卡 6.3：点「跨天」先把未安排展开 */
  assert.match(gantt, /EXZ_CLOSED\.delete\('un'\)/)
  assert.match(gantt, /推荐 ' \+ recN/)
  assert.match(gantt, /data-ex-rec-all="1"/)
  assert.match(gantt, /function acceptAllRec\(\): void/)
  assert.match(gantt, /function jumpCross\(\): void/)
})

test('client：写盘带上 rec（只留还在被接进分区的项）', () => {
  assert.match(gantt, /from: Object\.fromEntries\(u\.from\), rec, auto: \[\.\.\.u\.auto\] \}/)
  assert.match(gantt, /if \(pZoneOf\(u, k, key\) !== \(r\.z === 'run' \? 'run' : 'un'\)\) continue/)
})

test('CSS：分区计数 / 全部采纳 / 落地动效（v169 起推荐胶囊样式已删）', () => {
  assert.doesNotMatch(css, /\.exi-s \.exrt \{/)
  assert.match(css, /\.dpm \.sched \.exz-h \.zrec \{/)
  assert.match(css, /\.dpm \.sched \.exz-h \.zacc \{/)
  assert.match(css, /@keyframes dpm-v161land/)
})
