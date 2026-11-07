import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import * as G from '../lib/gantt.js'
import { readFileSync } from 'node:fs'

/* v142（反馈）：执行安排只列这一天的子任务 → 快照里已完成子任务带 doneDay（最后修改时间的本地日期） */
test('v142 gantt 快照：已完成子任务带 doneDay，未完成的没有', () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'grp')
  const c = M.addCard(b, g.id, 'A')
  M.setTasks(b, c.id, [{ id: 't1', text: '任务', done: false, subs: [{ id: 's1', text: '未完成', done: false }, { id: 's2', text: '完成', done: true }] }], '2026-11-01T10:00:00.000Z')
  const p = G.payload(b, { cards: {} }, {}, [])
  const subs = p.cards.find((x) => x.id === c.id).tasks[0].subs
  assert.equal(subs.find((x) => x.id === 's1').doneDay, undefined)
  const d = new Date('2026-11-01T10:00:00.000Z'), pad = (n) => String(n).padStart(2, '0')
  assert.equal(subs.find((x) => x.id === 's2').doneDay, d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()))
})

/* 结构回归：几处真问题的修法不能被改回去 */
const gantt = readFileSync(new URL('../src/client/gantt.ts', import.meta.url), 'utf8')
const composer = readFileSync(new URL('../src/client/composer.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8')
test('v142 回归：v41Norm 不被 || 短路；记录执行后立刻合并；选中只认任务键', () => {
  assert.match(gantt, /const mig = pMigrateKeys\(u, model\), nrm = v41Norm\(u, key\)/)
  assert.match(gantt, /v41Norm\(u, key\)\n\s*savePanel\(key, panelPatch\(key, u\)\)/)
  assert.match(gantt, /sel: \[\.\.\.new Set\(\[\.\.\.u\.sel, \.\.\.\[\.\.\.u\.done\]\.map\(v41K\)\]\)\]/)
})
test('v142 回归：会话输入框胶囊三态等 Lexical 画完内层再打标（编辑器 MutationObserver）', () => {
  assert.match(composer, /new MutationObserver\(\(\) => \{ if \(!moRaf\)/)
})
test('v142 回归：已完成子任务的悬停按钮规则同时作用于 .tilebody-in；子任务小卡新建会话白图标', () => {
  assert.ok((css.match(/\.tilebody-in > \.task\.child/g) || []).length >= 20)
  assert.match(css, /#exBody \.v41sr \.v42nb svg \{ stroke: #fff; \}/)
})
