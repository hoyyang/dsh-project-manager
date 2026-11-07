/* v155：项目卡（没拆任务的卡片）也要有会话状态 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const sess = src('sess.ts')
const gantt = src('gantt.ts')
const css = src('style.css')

test('优先级 = 等待中 > 执行中 > 完成输出 > 空闲中 > 已归档', () => {
  assert.match(sess, /const AGG_ORDER: SessSt\[\] = \['wait', 'run', 'done', 'idle', 'arch'\]/)
  assert.match(sess, /const AGG_ACTIVE: SessSt\[\] = \['wait', 'run', 'done'\]/)
})

test('聚合：多会话才给数字，「+N」只数别的活跃状态（空闲 / 归档不算）', () => {
  assert.match(sess, /const also = AGG_ACTIVE\.reduce\(\(n, x\) => n \+ \(x === st \? 0 : \(dist\[x\] \?\? 0\)\), 0\)/)
  assert.match(sess, /const cnt = a\.n > 1 \? '<b class="cnt">' \+ a\.n \+ '<\/b>' : ''/)
  assert.match(sess, /const also = a\.also \? '<b class="also">\+' \+ a\.also \+ '<\/b>' : ''/)
})

test('没会话 = 虚线灰标「无会话」；全部归档 = 不可点的 span（不是按钮）', () => {
  assert.match(sess, /class="dpm-sst agg s-none"[^>]*><span class="lb">无会话<\/span>/)
  assert.match(sess, /if \(a\.st === 'arch'\) return '<span class="dpm-sst agg s-arch"/)
  assert.match(css, /\.dpm-sst\.s-none \{[^}]*border-style: dashed;[^}]*cursor: default;/)
})

test('两处都接：任务执行安排的项目卡 + 本日计划清单的项目行', () => {
  assert.match(gantt, /l\.level === 'p' \? pchipHtml\(l\.c\.id\) : ''/)
  assert.match(gantt, /'<span class="v40pl">' \+ pchipHtml\(c\.id\) \+ '<\/span>'/)
})

test('点标签：1 个会话直接打开；多个开「项目会话」列表（不替你盲选）', () => {
  assert.match(sess, /if \(a\.total === 1\) \{ const only = D\.cardSessions\(cid\)\.find\(\(r\) => !r\.archived\)/)
  assert.match(sess, /openPicker\(btn, \{ cid, browse: true, cur: '', self: false, what: '卡片'/)
})
