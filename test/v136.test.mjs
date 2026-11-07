import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import * as G from '../lib/gantt.js'
import { memoryText, cardBlock } from '../lib/memory.js'
import { statBatch } from '../lib/routes.js'

const seed = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'grp')
  const a = M.addCard(b, g.id, 'A')
  const c = M.addCard(b, g.id, 'B')
  return { b, g, a, c }
}
test('v136 注入开关：关掉的链接 / 文件 / 仓库 / 关联卡片不进卡片档案（系统提示 + STATE 同口径）', () => {
  const { b, a, c } = seed()
  M.setWebLinks(b, a.id, [{ text: '开的链接', type: '', url: 'https://on.example.com' }, { text: '关的链接', type: '', url: 'https://off.example.com', off: true }])
  M.addFiles(b, a.id, [{ path: '/tmp/on.md' }, { path: '/tmp/off.md', off: true }])
  M.setCardRepos(b, a.id, [{ name: 'on-repo', role: '仓库', path: '/tmp/r1' }, { name: 'off-repo', role: '仓库', path: '/tmp/r2', off: true }])
  M.setRelated(b, a.id, [c.id])
  assert.deepEqual(a.relOff, [c.id], '新关联的卡片默认不注入')
  a.links = ['p/x']
  for (const t of [memoryText(b, a, []), cardBlock(b, 'p/x', '2026-11-02T00:00:00Z')]) {
    assert.match(t, /开的链接/); assert.doesNotMatch(t, /关的链接/)
    assert.match(t, /\/tmp\/on\.md/); assert.doesNotMatch(t, /\/tmp\/off\.md/)
    assert.match(t, /on-repo/); assert.doesNotMatch(t, /off-repo/)
    assert.doesNotMatch(t, /关联卡片（/)
  }
  M.setRelated(b, a.id, [{ id: c.id, off: false }])
  assert.equal(a.relOff, undefined)
  assert.match(memoryText(b, a, []), /- 关联卡片（/)
  // 只给 id：老关联保持原开关
  M.setRelated(b, a.id, [c.id])
  assert.equal(a.relOff, undefined)
})
test('v136 文件开关 setFileOff + 老数据视为注入 + 删除卡片清 relOff', () => {
  const { b, a, c } = seed()
  const r = M.addFiles(b, a.id, ['/tmp/x.md'])
  assert.equal(a.files[0].off, undefined, '老 / 普通添加 = 注入')
  M.setFileOff(b, a.id, r.ids[0], false); assert.equal(a.files[0].off, true)
  M.setFileOff(b, a.id, r.ids[0], true); assert.equal(a.files[0].off, undefined)
  assert.throws(() => M.setFileOff(b, a.id, r.ids[0], 'x'), /true \/ false/)
  M.setRelated(b, a.id, [c.id]); M.removeCard(b, c.id)
  assert.equal(a.related, undefined); assert.equal(a.relOff, undefined)
})
test('v137 任务截止 = 卡片截止旗（派生，id tk:<任务>，子任务 = 父 › 子，完成标 done）', () => {
  const { b, a } = seed()
  M.setTasks(b, a.id, [{ text: '父', done: false, due: '2026-11-05', subs: [{ text: '子', done: true, due: '2026-11-07' }] }, { text: '无截止', done: false }])
  const d = G.taskDdl(a)
  assert.equal(d.length, 2)
  assert.equal(d[0].id, G.TASK_DDL + a.tasks[0].id); assert.equal(d[0].label, '父'); assert.equal(d[0].kind, 'hard')
  assert.equal(d[1].label, '父 › 子'); assert.equal(d[1].done, true)
  const p = G.payload(b, { cards: {} }, {}, [])
  const card = p.cards.find((x) => x.id === a.id)
  assert.deepEqual(card.ddl.map((x) => x.at), ['2026-11-05', '2026-11-07'])
  assert.equal(card.tasks[0].due, '2026-11-05'); assert.equal(card.tasks[0].subs[0].due, '2026-11-07')
})
test('v138 路径批量 stat：只回存在的，~ 展开，非绝对 / 超长忽略', () => {
  const fake = (p) => (p === '/a/file.md' ? 'file' : p === '/h/dir' ? 'dir' : null)
  const r = statBatch(['/a/file.md', '~/dir', '~/dir/', '/nope', 'rel/x', 'x'.repeat(2000)], '/h', fake)
  assert.deepEqual(r, { '/a/file.md': 'file', '~/dir': 'dir', '~/dir/': 'dir' })
  assert.throws(() => statBatch('x', '/h', fake), /数组/)
})
