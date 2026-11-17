/* v175：卡片详情页任务 / 子任务关联多个会话（唯一活跃）+「关联会话」弹窗 + 添加任务丝滑滚动 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as M from '../lib/model.js'

const sess = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const sessSrc = sess('sess.ts')
const boardSrc = sess('board.ts')
const css = sess('style.css')
const idxSrc = sess('index.ts')
const hostIdx = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8')

const task = (over = {}) => ({ id: 't1', text: 'T', done: false, ...over })
const card = (over = {}) => ({ id: 'c1', g: 'g', col: 's', order: 0, t: 'C', links: [], tasks: [task()], ...over })
const board = (c = card()) => ({ version: 1, groups: [{ id: 'g', name: 'G', statuses: [{ id: 's', name: 'S' }], links: [] }], cards: [c], sessions: [] })
const find = (b) => b.cards[0].tasks[0]

test('v175 数据模型：sess 代表会话 + sessArch 其余；去重、保序；空数组清空两组', () => {
  const b = board()
  M.setTaskSessList(b, 'c1', 't1', ['s1', 's2', 's1'], '2026-11-14T00:00:00.000Z')
  const t = find(b)
  assert.equal(t.sess, 's1')
  assert.deepEqual(t.sessArch, ['s2'])
  assert.deepEqual(M.taskSessIds(t), ['s1', 's2'])
  M.setTaskSessList(b, 'c1', 't1', [], '2026-11-14T00:01:00.000Z')
  assert.equal(find(b).sess, undefined)
  assert.equal(find(b).sessArch, undefined)
})

test('v175 唯一活跃守卫：两个未归档 = BAD_ARG；1 活跃 + 1 归档放行；不传判据时不校验', () => {
  const arch = { s2: true, s3: true }
  const isArch = (sid) => !!arch[sid]
  const b = board()
  assert.throws(() => M.setTaskSessList(b, 'c1', 't1', ['s1', 's4'], undefined, isArch), /一个任务只能关联一个活跃会话/)
  M.setTaskSessList(b, 'c1', 't1', ['s1', 's2'], undefined, isArch)
  assert.deepEqual(M.taskSessIds(find(b)), ['s1', 's2'])
  /* 没传判据（宿主拿不到归档状态时）不拦，交给界面 */
  M.setTaskSessList(b, 'c1', 't1', ['s1', 's4'], undefined)
  assert.equal(find(b).sess, 's1')
})

test('v175 老接口不变：setTaskSession 单个写 = 整组替换；清空 = 取消关联', () => {
  const b = board()
  M.setTaskSessList(b, 'c1', 't1', ['s1', 's2'])
  M.setTaskSession(b, 'c1', 't1', 's9')
  assert.equal(find(b).sess, 's9')
  assert.equal(find(b).sessArch, undefined)
  M.setTaskSession(b, 'c1', 't1', '')
  assert.equal(find(b).sess, undefined)
})

test('v175 多关联的连带：sessionTaskCount 数两组；换卡片时两组一起清', () => {
  const c = card({ tasks: [task(), task({ id: 't2', text: 'T2', sess: 's1', sessArch: ['s2'] })] })
  const b = board(c)
  b.cards.push({ id: 'c2', g: 'g', col: 's', order: 1, t: 'C2', links: [], tasks: [] })
  assert.equal(M.sessionTaskCount(b.cards[0], 's1'), 1)
  assert.equal(M.sessionTaskCount(b.cards[0], 's2'), 1)
  const t2 = b.cards[0].tasks.find((x) => x.id === 't2')
  M.bindSession(b, 's2', 'c2')
  assert.equal(t2.sessArch, undefined, '别的卡片关联了这个会话 → 这边两组都要摘掉')
  assert.equal(M.taskSessIds(t2).join(), 's1')
})

test('v175 整表保存任务（setTasks）不丢 sessArch；改内容才刷新 updated', () => {
  const b = board()
  M.setTaskSessList(b, 'c1', 't1', ['s1', 's2'], '2026-11-14T00:00:00.000Z')
  const before = find(b).updated
  M.setTasks(b, 'c1', [{ id: 't1', text: 'T', done: false, sess: 's1', sessArch: ['s2'] }], '2026-11-14T02:00:00.000Z')
  assert.deepEqual(find(b).sessArch, ['s2'])
  assert.equal(find(b).updated, before, '内容没变不该盖 updated')
  M.setTasks(b, 'c1', [{ id: 't1', text: 'T 改了', done: false, sess: 's1', sessArch: ['s2', 's3'] }], '2026-11-14T03:00:00.000Z')
  assert.deepEqual(find(b).sessArch, ['s2', 's3'])
  assert.equal(find(b).updated, '2026-11-14T03:00:00.000Z')
})

test('v175 恢复守卫 liveConflictForSession：别的任务已有活跃 → 返回它；只有自己/没有冲突 → null', () => {
  const c = card({ tasks: [task({ id: 't1', text: 'A', sess: 's1', sessArch: ['s2'] }), task({ id: 't2', text: 'B', sess: 's3', sessArch: ['s2'] })] })
  const b = board(c)
  const arch = (sid) => sid === 's2'
  /* 恢复 s2：任务 A 已经有活跃 s1 → 冲突，点名 A */
  assert.deepEqual(M.liveConflictForSession(b, 's2', arch), { text: 'A', sub: false, other: 's1' })
  /* 恢复一个没人关联的会话 → 不冲突 */
  assert.equal(M.liveConflictForSession(b, 's9', arch), null)
  /* 任务里唯一的活跃就是它自己 → 不算冲突 */
  assert.equal(M.liveConflictForSession(b, 's1', arch), null)
})

test('v175 后端接线：多关联路由 + 归档判据从宿主注入', () => {
  assert.match(routes, /'card\/task-sess-list': \(x, b, s\) => M\.setTaskSessList\(/, '多关联写入口')
  assert.match(routes, /'card\/task-sess': \(x, b, s\) => M\.setTaskSession\(b, str\(x\.id, 'id'\), x\.task, x\.sess, undefined, \(sid\) => s\.isSessionArchived\(sid\)\)/)
  assert.match(routes, /isSessionArchived\(sessionId: string\): boolean/)
  assert.match(hostIdx, /isSessionArchived: \(sessionId\) => \(ctx\.workspaceRegistry\.archivedSessionIds \?\? \[\]\)\.includes\(sessionId\)/)
})

test('v175 任务行：代表会话胶囊 + 数量徽标（>1 才出）+ 管理按钮；有活跃关联不出新建会话', () => {
  assert.match(sessSrc, /export function assocOf\(c: Card \| null, t: Task\): Assoc/)
  assert.match(sessSrc, /const cnt = a\.total > 1 \? '<b class="dpm-scnt s-'/)
  assert.match(sessSrc, /const mg = ro \? '' : '<button type="button" class="dpm-sib" data-dpm-slink=/)
  assert.match(sessSrc, /const nb = ro \|\| a\.live\.length \? '' :/, '有活跃关联时不显示黑底新建会话')
  assert.match(sessSrc, /const rep = live\[0\] \?\? arc\.slice\(\)\.sort\(\(a, b\) => ms\(b\) - ms\(a\)\)\[0\]/, '全归档取最近对话最新的')
})

test('v175 弹窗：500 宽 / 两段 / 13×26 漫画尖尖 / 贴在任务列表统一左缘', () => {
  assert.match(css, /\.dpm-spn \{ position: fixed; z-index: 2147483000; width: 500px;/)
  assert.match(css, /\.dpm-spn-tail\.r, \.dpm-spn-tail\.l \{ width: 13px; height: 26px;/)
  assert.match(css, /\.dpm-spn-tail\.r \{ right: -12px; \}/)
  assert.match(sessSrc, /const room = Math\.round\(listLeft - 8 - 15\)/)
  assert.match(sessSrc, /const left = Math\.round\(listLeft - W - 15\)/)
  assert.match(sessSrc, /tile\.closest\('\.task\[data-lv="0"\]'\)/, '子任务用最外层任务卡的左缘')
  assert.match(sessSrc, /已关联/)
  assert.match(sessSrc, /可关联的活跃会话/)
})

test('v175 弹窗行为：归档 / 恢复 / 取消关联 / 关联都在弹窗内；尖尖跟着滚动与重画', () => {
  assert.match(sessSrc, /data-spn-arch="/)
  assert.match(sessSrc, /data-spn-restore="/)
  assert.match(sessSrc, /data-spn-unlink="/)
  assert.match(sessSrc, /data-spn-pick="/)
  assert.match(sessSrc, /const followScroll = \(\): void => \{ if \(!SP\) return; watchRoot\(\); spPlace\(\) \}/)
  assert.match(sessSrc, /new ResizeObserver\(\(\) => follow\(\)\)/)
  assert.match(sessSrc, /if \(!tile\.getClientRects\(\)\.length\) \{ sessPanelClose\(\); return \}/, '详情切走时收起，不悬空')
  assert.match(sessSrc, /export function sessPanelClose/)
  assert.match(idxSrc, /assoc: async \(cid, tid, ids\) =>/)
  assert.match(idxSrc, /archive: async \(sid\) =>/)
  /* 任务弹窗里的旧选择器也不再整组替换（否则会把归档关联冲掉） */
  assert.match(idxSrc, /const list = !sid \? \[\] : \[sid, \.\.\.cur\.filter\(\(x\) => x !== sid\)\]/)
  assert.match(idxSrc, /restore: async \(sid\) =>/)
  /* 已有活跃关联时「以此任务新建会话」不可点（否则会白建一个孤儿会话、关联被宿主拒） */
  assert.match(sessSrc, /data-spn-new' \+ \(hasLive \? ' aria-disabled="true" title="这个' \+ what \+ '已经有活跃会话了/)
  assert.match(sessSrc, /if \(nw\.getAttribute\('aria-disabled'\) === 'true'\) return/)
})

test('v175 添加任务：smooth 滚到新行 + 高亮 + 延迟聚焦；子任务同一条函数', () => {
  assert.match(boardSrc, /private revealRow\(el: HTMLElement \| null, focusSel\?: string\): void/)
  assert.match(boardSrc, /box\.scrollTo\(\{ top: to, behavior: 'smooth' \}\)/)
  assert.match(boardSrc, /row\.classList\.add\('dpm-newrow'\)/)
  assert.match(boardSrc, /const want = box\.scrollTop \+ \(er\.top - br\.top\) - Math\.max\(16, \(box\.clientHeight - er\.height\) \/ 2 - 60\)/)
  assert.match(boardSrc, /this\.revealRow\(this\.root\.querySelector\('#dpmTkNewRow'\) as HTMLElement \| null, '#dpmTkNewIn'\)/)
  assert.match(boardSrc, /this\.revealRow\(this\.root\.querySelector\('#dpmKAddRow'\) as HTMLElement \| null, '#dpmKAdd'\)/)
  assert.match(css, /\.dpm \.detail \.ptnew\.dpm-newrow/)
})

test('v175 任务行胶囊 tooltip 写全 §4.1：哪个会话 + 一共几个 + 活跃的是哪个（全归档 = 最近对话最新那个）', () => {
  assert.match(sessSrc, /export function chipHtml\(sid: string, o: \{ name\?: boolean; extra\?: string \} = \{\}\): string/)
  assert.match(sessSrc, /\+ \(o\.extra \? ' · ' \+ o\.extra : ''\)/, 'tooltip 末尾接 extra')
  assert.match(sessSrc, /const extra = a\.total > 1/)
  assert.match(sessSrc, /一共关联 ' \+ a\.total \+ ' 个会话，活跃的是「' \+ sessName\(a\.live\[0\]\) \+ '」，其余 '/)
  assert.match(sessSrc, /全是归档会话：显示的是「最近对话最新」的那个/)
  assert.match(sessSrc, /const chip = chipHtml\(a\.rep, \{ name: false, extra \}\)/)
  /* 状态变了原地重画时 extra 不能丢（否则 tooltip 变回短的那句） */
  assert.match(sessSrc, /const xtra = o\.extra \? ' data-dpm-x="' \+ esc\(o\.extra\) \+ '"' : ''/)
  assert.match(sessSrc, /chipHtml\(sid, \{ name: el\.dataset\.nm === '1', extra: el\.dataset\.dpmX \|\| undefined \}\)/)
})

test('v175 弹窗 §4.2 / §4.4：不可选带锁图标；被挡的恢复点了要 toast 点名；归档成功 toast 说「可以关联新的」', () => {
  assert.match(sessSrc, /lock: '<svg viewBox="0 0 24 24"/, '锁图标')
  assert.match(sessSrc, /IC\.lock \+ '不可选/)
  assert.match(sessSrc, /data-spn-why="/)
  assert.match(sessSrc, /不能恢复「' \+ sessName\(rs\.dataset\.spnRestore as string\) \+ '」：' \+ why/, '被挡的恢复要给 toast，不能静默')
  assert.match(idxSrc, /它变成归档会话，和这个任务的关联保留；现在可以关联新的活跃会话了/)
})
