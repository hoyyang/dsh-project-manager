/* v184：跨天自动记录执行 —— 过 00:00 把刚结束那天「等外部 / 个人暂停 / 执行中」三个分区的卡片按「记录执行」同一条路径补记（不是勾选完成） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as G from '../lib/gantt.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const SRC = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

const NOW = Date.parse('2026-11-16T12:00:00')
const DAY = '2026-11-15'
const T = (id, subs = [], done = false) => ({ id, text: id, done, subs })
const S = (id, done = false) => ({ id, text: id, done })
const C = (id, tasks = [], extra = {}) => ({ id, g: 'g1', col: 'c1', order: 0, t: id, links: [], tasks, repos: [], ...extra })

function board () {
  return [
    C('c1', [T('t1', [S('s1')]), T('t2')]),
    C('c2'),
    C('c3', [T('a'), T('b')]),
    C('c4'),
    C('c5'),
    C('cArch', [], { archivedAt: '2026-11-01T00:00:00.000Z' }),
  ]
}
function state (patch = {}) {
  return {
    cards: {},
    panels: {
      [DAY]: {
        sel: ['t|c1|t1', 't|c1|t2', 'p|c2', 't|c3|a', 'p|c4', 'p|c5', 'p|cArch'],
        pst: { 't|c1|t1': 'wait', 't|c1|t2': 'run', 'p|c2': 'pause', 't|c3|a': 'run', 'p|c4': 'run', 'p|cArch': 'run' },
        zl: { wait: [['t|c1|t1']], pause: [['p|c2']], run: [['t|c1|t2'], ['t|c3|a', 'p|c4', 'p|cArch']], un: [] },
        lanes: [['p|c5']],
        carry: true,
        doneAt: {},
        from: {},
        ...patch,
      },
    },
  }
}
const snapshot = (st) => JSON.parse(JSON.stringify(st.panels[DAY]))

test('v184 1：只记等外部 / 个人暂停 / 执行中；项目卡 = 项目（+任务/子任务），任务卡 = 任务 + 子任务', () => {
  const cards = board(), st = state()
  const r = G.autoCloseDay(st, cards, DAY, NOW)
  assert.ok(r, '应该结算')
  assert.equal(r.n, 5, '目标卡数不对')
  assert.deepEqual(r.z, { wait: 1, pause: 1, run: 3 })
  const u = st.panels[DAY]
  const done = new Set(u.done)
  for (const k of ['t|c1|t1', 's|c1|s1', 't|c1|t2', 'p|c2', 't|c3|a', 'p|c4']) assert.ok(done.has(k), k + ' 应进本日已执行')
  assert.ok(!done.has('p|c1'), '有任务的卡片不该写项目 key')
  assert.ok(!done.has('t|c3|b'), '只记分区里的任务，不连带别的任务')
  assert.ok(!done.has('p|c5'), '未安排不记')
  assert.ok(!done.has('p|cArch'), '归档卡跳过')
  assert.equal(u.autoRec.at, NOW)
  assert.equal(u.autoRec.n, 5)
  assert.ok(u.auto.includes('t|c1|t1') && u.auto.includes('s|c1|s1'), 'auto 没记全')
  assert.equal(u.from['p|c2'], 'pause')
  assert.equal(u.from['t|c3|a'], 'run')
  assert.ok(u.doneAt['s|c1|s1'] >= u.doneAt['t|c1|t1'], 'doneAt 顺序不对')
})

test('v184 2：不动 sel / zl / pst / lanes / carry；归档卡不进 auto', () => {
  const cards = board(), st = state()
  const before = snapshot(st)
  assert.ok(G.autoCloseDay(st, cards, DAY, NOW))
  const u = st.panels[DAY]
  assert.deepEqual([...u.sel].sort(), [...before.sel].sort(), 'sel 被改了')
  assert.deepEqual(u.zl.wait, before.zl.wait, 'zl.wait 被改了')
  assert.deepEqual(u.zl.pause, before.zl.pause, 'zl.pause 被改了')
  assert.deepEqual(u.zl.run, before.zl.run, 'zl.run 被改了')
  assert.deepEqual(u.pst, before.pst, 'pst 被改了')
  assert.deepEqual(u.lanes, before.lanes, 'lanes 被改了')
  assert.equal(u.carry, true, 'carry 被改了')
  assert.ok(!u.auto.includes('p|cArch'), '归档卡不该进 auto')
})

test('v184 3：一天只跑一次（autoRec 之后 null）；今天 / 未来 / 没有面板都不结算', () => {
  const cards = board(), st = state()
  assert.ok(G.autoCloseDay(st, cards, DAY, NOW))
  assert.equal(G.autoCloseDay(st, cards, DAY, NOW), null, '第二次又写了')
  assert.equal(G.autoCloseDay(st, cards, '2026-11-16', NOW), null, '今天不该记')
  assert.equal(G.autoCloseDay(st, cards, '2026-11-17', NOW), null, '未来不该记')
  assert.equal(G.autoCloseDay(state({}), cards, '2026-11-14', NOW), null, '没有面板不补')
})

test('v184 4：三个分区都没有可记项就不写', () => {
  const cards = board()
  const st = state({ pst: {}, zl: { wait: [], pause: [], run: [], un: [] } })
  assert.equal(G.autoCloseDay(st, cards, DAY, NOW), null)
  assert.equal(st.panels[DAY].autoRec, undefined)
})

test('v184 5：done 变化裁 auto；只剩 autoRec 也能保住这一天（撤销后不再补）', () => {
  const cards = board(), valid = G.taskKeySetAll(cards)
  const st = state()
  G.autoCloseDay(st, cards, DAY, NOW)
  G.setPanelDay(st, DAY, { done: [], sel: [] }, valid)
  const u = st.panels[DAY]
  assert.ok(u, '本日只剩 autoRec 时面板被删了')
  assert.equal(u.auto, undefined, 'done 清了 auto 还留着')
  assert.ok(u.autoRec && u.autoRec.at === NOW, 'autoRec 不该被 done 清掉')
  assert.equal(G.autoCloseDay(st, cards, DAY, NOW), null, '撤销后不该补记')
})

test('v184 6：autoRec 非法值丢弃；auto 只认还在 done 里的 key', () => {
  const cards = board(), valid = G.taskKeySetAll(cards)
  const st = state()
  G.setPanelDay(st, DAY, { autoRec: { at: 0, n: 3 } }, valid)
  assert.equal(st.panels[DAY].autoRec, undefined, 'at=0 的凭证该丢掉')
  G.setPanelDay(st, DAY, { autoRec: { at: NOW, n: 2, z: { wait: 1, pause: 1, bogus: 9 } } }, valid)
  const r = st.panels[DAY].autoRec
  assert.ok(r && r.n === 2, '合法凭证没写')
  assert.deepEqual(r.z, { wait: 1, pause: 1 }, 'z 没挡非法分区')
  G.setPanelDay(st, DAY, { done: [], auto: ['t|c1|t1'] }, valid)
  assert.equal(st.panels[DAY].auto, undefined, '不在 done 里的 auto 没被裁掉')
})

test('v184 7：源码挂钩（宿主结算 / 客户端 UI / 指纹 / 甘特小窗 / 样式）', () => {
  const ix = src('index.ts'), g = src('gantt.ts'), c = SRC('gantt.ts'), css = SRC('style.css')
  assert.ok(ix.includes('function settleAuto'), '缺 settleAuto')
  assert.ok(ix.includes('await settleAuto()'), 'ganttData 没懒结算')
  assert.ok(ix.includes('setInterval(() => { void settleAuto() }, 60_000)'), '缺 60s 结算')
  assert.ok(ix.includes("kind: 'gantt/auto-rec'"), '缺审计事件')
  assert.ok(g.includes('export function autoCloseDay'), '缺 autoCloseDay')
  assert.ok(g.includes('auto?: string[]') && g.includes('autoRec?: { at: number'), 'PanelDay 缺 auto / autoRec')
  assert.ok(c.includes('data-auto="1"') && c.includes("(auto ? '自动' : '已执行')"), '记录按钮没有自动态')
  assert.ok(c.includes('class="zauto"'), '分区头没有「自动 N」')
  assert.ok(c.includes('id="exAutoChip"'), '日期行没有「昨日自动 N」')
  assert.ok(c.includes('class="exz-auto"') && c.includes('data-exz-auto-go'), '清空分区没有说明')
  assert.ok(c.includes('跨天自动记录（过 00:00）'), '甘特小窗来源没写')
  assert.ok(c.includes('dpm.autoRec.seen.v1'), '缺结算 toast 去重')
  assert.ok(c.includes("out.push('U' + [sigDay") && c.includes('u.autoRec ? u.autoRec.at'), 'modelSig 没收自动结算')
  assert.ok(css.includes('.zauto') && css.includes('#exAutoChip') && css.includes('.exz-auto'), '缺样式')
  assert.ok(css.includes('body[data-ds-dark-theme] .dpm .sched .exz-auto'), '缺深色样式')
})

test('v184 8：版本 0.79.0 + CHANGELOG', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.ok(log.includes('0.79.0'), 'CHANGELOG 没有 0.79.0')
})
