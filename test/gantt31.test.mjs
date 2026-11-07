import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import * as G from '../lib/gantt.js'

const at = (s) => Date.parse(s + 'T09:00:00')
const card = (id, extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: 'X', links: [], tasks: [], repos: [], ...extra })
const day = (ms) => G.ymd(ms)
const startMs = Date.parse('2026-10-01T10:00:00')
const mkId = (ms, seq = 1) => 'c' + ms.toString(36) + seq.toString(36)

test('cardCreated 从 id 还原建卡时间（base36 毫秒前缀）', () => {
  const id = mkId(startMs)
  assert.equal(G.cardCreated(card(id)), startMs)
  // 旧卡 / 非法 id：退回 updatedAt
  const t = Date.parse('2026-09-01T00:00:00')
  assert.equal(G.cardCreated(card('legacy-x', { updatedAt: new Date(t).toISOString() })), t)
})

test('planDays v96：只认手动设置 / 拖动过的日子（没有默认段）', () => {
  const c = card(mkId(startMs))
  const st = {}
  const now = at('2026-10-05')
  assert.equal(G.planDays(c, st, [], now).size, 0)            /* 从没手动排过 → 空 */
  const cur = G.planDays(c, st, [], now)
  G.applyPlanDay(st, cur, '2026-10-08', true)
  assert.ok(G.planDays(c, st, [], now).has('2026-10-08'))
  G.applyPlanRange(st, cur, '2026-10-01', '2026-10-04', true)  /* to 不含 */
  assert.deepEqual(st.plan, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-08'])
  G.applyPlanDay(st, cur, '2026-10-02', false)
  assert.deepEqual(st.plan, ['2026-10-01', '2026-10-03', '2026-10-08'])
  /* 手动集合就是全部：明天不会自动多一天 */
  assert.ok(!G.planDays(c, st, [], at('2026-10-09')).has('2026-10-09'))
  /* 全部取消 → 空集合（用户就是要没有计划条） */
  G.applyPlanRange(st, cur, '2026-10-01', '2026-10-31', false)
  assert.deepEqual(st.plan, [])
  assert.equal(G.planDays(c, st, [], now).size, 0)
})

test('actualDays：会话自动 ∪ 手动；手动过的那天自动失效（勾上 / 取消都算）', () => {
  const st = {}
  const auto = ['2026-10-01', '2026-10-02', '2026-10-03']
  let m = G.actualDays(st, auto)
  assert.equal(m.get('2026-10-02'), 'auto')
  G.setActualDay(st, '2026-10-02', false)   /* 取消自动的那天 */
  m = G.actualDays(st, auto)
  assert.ok(!m.has('2026-10-02'))
  assert.deepEqual(st.autoOff, ['2026-10-02'])
  G.setActualDay(st, '2026-10-02', true)    /* 再手动补记回来 = 手动 */
  m = G.actualDays(st, auto)
  assert.equal(m.get('2026-10-02'), 'manual')
  G.setActualDay(st, '2026-10-05', true)    /* 空白日手动记录 */
  assert.deepEqual(st.actual.sort(), ['2026-10-02', '2026-10-05'])
  assert.ok(st.autoOff.includes('2026-10-05'))
})

test('截止时间：写 / 改备注 / 删（v99：同一天可多个 + 硬性 / 软性）', () => {
  const st = {}
  const a = G.addDdl(st, '2026-10-20')
  assert.equal(a.kind, 'hard')
  const b = G.addDdl(st, '2026-10-20', 'soft', '客户要求')
  const c = G.addDdl(st, '2026-10-15', 'soft', '发版')
  assert.deepEqual(st.ddl.map((d) => d.at), ['2026-10-15', '2026-10-20', '2026-10-20'])
  assert.deepEqual(st.ddl.map((d) => d.kind), ['soft', 'hard', 'soft'])
  assert.equal(b.label, '客户要求')
  assert.equal(new Set(st.ddl.map((d) => G.ddlIdOf(d))).size, 3)
  assert.equal(G.updateDdl(st, G.ddlIdOf(b), { kind: 'hard' }).kind, 'hard')
  G.updateDdl(st, G.ddlIdOf(b), { label: '' })
  assert.equal('label' in b, false)
  G.updateDdl(st, G.ddlIdOf(b), { at: '2026-10-21' })
  assert.equal(b.at, '2026-10-21')
  assert.equal(st.ddl.map((d) => d.at).join(','), '2026-10-15,2026-10-20,2026-10-21')
  assert.equal(G.removeDdl(st, G.ddlIdOf(c)), true)
  assert.equal(st.ddl.length, 2)
  assert.equal(G.removeDdl(st, 'nope'), false)
  assert.throws(() => G.addDdl(st, '2026-13-01'), /yyyy-mm-dd/)
  const old = { ddl: [{ at: '2026-10-01' }] }
  assert.equal(G.ddlIdOf(old.ddl[0]), '2026-10-01')
  assert.equal(G.ddlKindOf(old.ddl[0]), 'hard')
  G.updateDdl(old, '2026-10-01', { at: '2026-10-02' })
  assert.equal(old.ddl[0].at, '2026-10-02')
  assert.equal(G.ddlIdOf(old.ddl[0]), '2026-10-01')
})

test('三条边的宽度：夹紧 + null 复位；非法值不改', () => {
  const g = { cards: {} }
  G.setUi(g, { lw: 120, tpw: 9999, dw: 500 })
  assert.deepEqual(g.ui, { lw: 200, tpw: 4000, dw: 500 })
  G.setUi(g, { lw: null })
  assert.deepEqual(g.ui, { tpw: 4000, dw: 500 })
  G.setUi(g, { dw: 'x' })
  assert.deepEqual(g.ui, { tpw: 4000, dw: 500 })
  G.setUi(g, { dw: 900 })
  assert.equal(g.ui.dw, 760)
  // v98：项目组时间显隐（布尔；null 复位回默认隐藏；非布尔不动）
  G.setUi(g, { gtime: true })
  assert.equal(g.ui.gtime, true)
  G.setUi(g, { gtime: false })
  assert.equal(g.ui.gtime, false)
  G.setUi(g, { gtime: 'yes' })
  assert.equal(g.ui.gtime, false)
  G.setUi(g, { gtime: null })
  assert.equal('gtime' in g.ui, false)
})

test('payload：计划 / 实际 / 截止 / 阶段名 / degraded 一起给出', () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, '组A')
  const c = M.addCard(b, g.id, '卡A', [], g.statuses[1].id)
  c.tasks = [{ text: 't1', done: true }, { text: 't2', done: false, subs: [{ text: 's1', done: true }] }]
  const st = { cards: { [c.id]: { actual: ['2026-10-02'], autoOff: ['2026-10-01'], ddl: [{ at: '2026-10-20' }, { at: '2026-10-20', kind: 'soft', label: '内部' }] } } }
  const out = G.payload(b, st, { [c.id]: ['2026-10-01', '2026-10-03'] }, ['x：坏'], [], at('2026-10-05'))
  const cardOut = out.cards.find((x) => x.id === c.id)
  assert.equal(cardOut.stage, g.statuses[1].name)
  assert.deepEqual(cardOut.actual, [{ day: '2026-10-02', src: 'manual' }, { day: '2026-10-03', src: 'auto' }])
  assert.deepEqual(cardOut.auto, ['2026-10-01', '2026-10-03'])
  assert.deepEqual(cardOut.ddl, [{ id: '2026-10-20', at: '2026-10-20', kind: 'hard' }, { id: '2026-10-20', at: '2026-10-20', kind: 'soft', label: '内部' }])
  assert.deepEqual(cardOut.plan, [])   /* v96：没手动排过 = 没有计划条 */
  assert.equal(cardOut.total, 2); assert.equal(cardOut.done, 2) /* 叶子任务：t1 + s1，都完成 */
  assert.deepEqual(out.degraded, ['x：坏'])
  assert.equal(out.today, '2026-10-05')
})

test('eventsFromText：坏行忽略、按 kind / card 取归档恢复', () => {
  const t = ['{"at":"2026-10-01T00:00:00","actor":"user","kind":"card/archive","card":"c1"}', 'not json', ''].join('\n')
  const evs = G.eventsFromText(t)
  assert.equal(evs.length, 1)
  assert.deepEqual(G.archiveTimes(evs, 'c1').map((x) => x.on), [false])
  assert.deepEqual(G.archiveTimes(evs, 'c2'), [])
})

test('isDay：格式对但会被 Date 归一化的日子也拒掉', () => {
  assert.equal(G.isDay('2026-10-05'), true)
  assert.equal(G.isDay('2026-02-31'), false)
  assert.equal(G.isDay('2026-1-5'), false)
  assert.equal(G.isDay(20261005), false)
})
/* v101：截止重复（每天 / 每周 / 每月 + 直到）与三选删除 */
import { addDdlRepeat, removeDdlScoped, repStep } from '../lib/gantt.js'

test('v101 截止重复：每月 31 号夹到月末', () => {
  assert.equal(repStep('2026-01-31', 'month', 1), '2026-02-28')
  assert.equal(repStep('2026-03-31', 'month', 1), '2026-04-30')
  assert.equal(repStep('2026-01-05', 'week', 2), '2026-01-19')
  assert.equal(repStep('2026-01-05', 'day', 3), '2026-01-08')
})

test('v101 截止重复：每周 + 直到，共享 sid，条数正确', () => {
  const c = {}
  const made = addDdlRepeat(c, '2026-11-02', 'hard', '每周验收', { unit: 'week', n: 1, until: '2026-11-30' })
  assert.equal(made.length, 5)
  assert.deepEqual(made.map((d) => d.at), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  assert.equal(new Set(made.map((d) => d.sid)).size, 1)
  assert.equal(c.ddl.length, 5)
})

test('v101 截止重复：无 until 也封顶（不无限长）', () => {
  const c = {}
  const made = addDdlRepeat(c, '2026-11-02', 'soft', '', { unit: 'day', n: 1 })
  assert.ok(made.length <= 120 && made.length > 100)
})

test('v101 三选删除：one / after / all', () => {
  const mk = () => { const c = {}; addDdlRepeat(c, '2026-11-02', 'hard', '', { unit: 'week', n: 1, until: '2026-12-14' }); return c }
  const a = mk()
  const ids = a.ddl.map((d) => d.id)
  assert.equal(removeDdlScoped(a, ids[1], 'one'), 1)
  assert.equal(a.ddl.length, 6)
  assert.equal(removeDdlScoped(a, ids[2], 'after'), 5)
  assert.equal(a.ddl.length, 1)
  const b = mk()
  assert.equal(removeDdlScoped(b, b.ddl[0].id, 'all'), 7)
  assert.equal(b.ddl.length, 0)
})
