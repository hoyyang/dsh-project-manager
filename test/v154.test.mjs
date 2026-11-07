/* v154：引用原文同步 / 启动修复 / 名字归一兜底 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as M from '../lib/model.js'
import { relinkFiles } from '../lib/migrate.js'
import { repairBoardRefs, syncFileRefs } from '../lib/refsync.js'
import { refNameKey, rewriteFileRefText } from '../lib/quote.js'

const card = (over) => ({ id: 'a', g: 'g', col: 's', order: 0, t: 'A', links: [], tasks: [], files: [], ...over })
const board = (over) => ({ version: 1, groups: [{ id: 'g', name: 'G', statuses: [{ id: 's', name: 'S' }], links: [] }], cards: [card(over)], sessions: [] })
const canon = (title, path, del) => '「“' + title + '”（' + (del ? '已删除：' : '') + path + '）」'

test('名字归一：只差空格 / 连字符算同一个文件', () => {
  assert.equal(refNameKey('/tmp/x/批量删除功能按钮有多个严重 bug.mov'), refNameKey('/tmp/y/批量删除功能按钮有多个严重-bug.mov'))
  assert.equal(refNameKey('/a/全角\u3000空格.mov'), refNameKey('/b/全角-空格.mov'))
  assert.notEqual(refNameKey('/a/ab.mov'), refNameKey('/b/a b.mov'))
  assert.equal(refNameKey('/a/b/c.png'), 'c.png')
})

test('改写引用原文：保留「已删除：」前缀、标题一起换、多次出现全换', () => {
  const old = '/tmp/desk/a b.mov'
  const text = '（1）' + canon('a b.mov', old) + '\n（2）' + canon('a b.mov', old, true) + '\n（3）' + canon('别的.mov', '/x/y.mov')
  const r = rewriteFileRefText(text, (p) => (p === old ? { path: '/ep/a-b.mov', title: 'a-b.mov' } : null))
  assert.equal(r.n, 2)
  assert.ok(r.text.includes(canon('a-b.mov', '/ep/a-b.mov')))
  assert.ok(r.text.includes(canon('a-b.mov', '/ep/a-b.mov', true)))
  assert.ok(r.text.includes(canon('别的.mov', '/x/y.mov')))
  assert.equal(rewriteFileRefText(text, () => null).n, 0)
  assert.equal(rewriteFileRefText(text, (p) => ({ path: p })).n, 0)
})

test('改路径 = 同一事务把任务说明 / 子任务说明 / 相关说明里的引用原文一起改；撤销对称', () => {
  const old = '/tmp/desk/严重 bug.mov'
  const b = board({
    files: [{ id: 'f1', path: old }],
    tasks: [{ id: 't1', text: 'T1', done: false, note: '看 ' + canon('严重 bug.mov', old), subs: [{ id: 't1s', text: 'S', done: false, note: canon('严重 bug.mov', old) }] }],
    noteItems: [{ t: '说明', v: canon('严重 bug.mov', old) }]
  })
  M.setFilePath(b, 'a', 'f1', '/ep/严重-bug.mov')
  const c = b.cards[0]
  assert.equal(c.tasks[0].note, '看 ' + canon('严重-bug.mov', '/ep/严重-bug.mov'))
  assert.equal(c.tasks[0].subs[0].note, canon('严重-bug.mov', '/ep/严重-bug.mov'))
  assert.equal(c.noteItems[0].v, canon('严重-bug.mov', '/ep/严重-bug.mov'))
  assert.deepEqual(c.files[0].prev, [old])
  M.setFilePath(b, 'a', 'f1', old)
  assert.equal(c.tasks[0].note, '看 ' + canon('严重 bug.mov', old))
  assert.equal(c.noteItems[0].v, canon('严重 bug.mov', old))
  assert.deepEqual(c.files[0].prev, ['/ep/严重-bug.mov'])
})

test('别的卡片里引用了同一个文件也一起改', () => {
  const old = '/d/a.mp4'
  const b = { version: 1, groups: [], cards: [card({ id: 'a', files: [{ id: 'f', path: old }] }), card({ id: 'b', tasks: [{ id: 't', text: 'T', done: false, note: canon('a.mp4', old) }] })], sessions: [] }
  M.setFilePath(b, 'a', 'f', '/e/a.mp4')
  assert.equal(b.cards[1].tasks[0].note, canon('a.mp4', '/e/a.mp4'))
})

test('syncFileRefs 幂等：路径没变 = 0 处', () => {
  const f = { id: 'f', path: '/e/a.mov' }
  const b = board({ files: [f], noteItems: [{ t: 'x', v: canon('a.mov', '/e/a.mov') }] })
  assert.equal(syncFileRefs(b, f, '/e/a.mov'), 0)
})

test('启动修复：prev 命中 / 名字归一命中 / 路径仍存在则不动 / 第二次 0 处', () => {
  const live = join(mkdtempSync(join(tmpdir(), 'v154-')), 'still-here.mov')
  writeFileSync(live, 'x')
  const gone = '/tmp/v154-已经不在的原路径-9f3a.mov'
  const b = board({
    files: [
      { id: 'f1', path: '/ep/旧名字-新.mov', prev: ['/desk/旧名字 老.mov'] },
      { id: 'f2', path: '/ep/严重-bug.mov' },
      { id: 'f3', path: live }
    ],
    tasks: [{ id: 't', text: 'T', done: false, note: [canon('旧名字 老.mov', '/desk/旧名字 老.mov'), canon('严重 bug.mov', '/desk/严重 bug.mov'), canon('still-here.mov', live), canon('没绑定的.mov', gone)].join('\n') }]
  })
  const r1 = repairBoardRefs(b)
  assert.equal(r1.changed, 2)
  assert.equal(r1.cards, 1)
  const note = b.cards[0].tasks[0].note
  assert.ok(note.includes(canon('旧名字-新.mov', '/ep/旧名字-新.mov')))
  assert.ok(note.includes(canon('严重-bug.mov', '/ep/严重-bug.mov')))
  assert.ok(note.includes(canon('still-here.mov', live)))
  assert.ok(note.includes(canon('没绑定的.mov', gone)))
  const r2 = repairBoardRefs(b)
  assert.equal(r2.changed, 0)
})

test('迁移落盘项目：相关文件改路径时说明里的引用一起改', () => {
  const b = board({
    files: [{ id: 'f', path: '/r/p/evidence/a.png' }],
    tasks: [{ id: 't', text: 'T', done: false, note: canon('a.png', '/r/p/evidence/a.png') }]
  })
  assert.equal(relinkFiles(b, '/r/p', '/r/q'), 1)
  assert.equal(b.cards[0].files[0].path, '/r/q/evidence/a.png')
  assert.equal(b.cards[0].tasks[0].note, canon('a.png', '/r/q/evidence/a.png'))
})

/* ── v154 补充：导入路径放宽的边界 / 同名搜索的归一口径 / 修复不猜歧义 ── */
import { checkRel } from '../lib/landfill.js'
import { findSameName } from '../lib/routes.js'

test('导入允许空格 / 全角标点，其它模式不变；越界与控制字符照样拒', () => {
  assert.equal(checkRel('evidence/搬家 保留 原文件名.mov', 'import'), 'evidence/搬家 保留 原文件名.mov')
  assert.equal(checkRel('evidence/（截图）2026-11-06.png', 'import'), 'evidence/（截图）2026-11-06.png')
  assert.throws(() => checkRel('evidence/a\u0001.mov', 'import'), /不合法/)
  assert.throws(() => checkRel('evidence/../x.md', 'import'), /不合法/)
  assert.throws(() => checkRel('/abs/x.md', 'import'), /不合法/)
  assert.throws(() => checkRel('notes/说明 一.md', 'write'), /不合法/)
  assert.equal(checkRel('notes/说明一.md', 'write'), 'notes/说明一.md')
})

test('同名搜索：一字不差排前面，只差空格 / 连字符的也算，max 生效', () => {
  const fs = { '/r1': [{ name: 'a-b.mov', dir: false }, { name: 'x', dir: true }, { name: 'b.mov', dir: false }], '/r1/x': [{ name: 'a b.mov', dir: false }, { name: 'c.mov', dir: false }] }
  const ls = (d) => fs[d] || []
  assert.deepEqual(findSameName('a b.mov', ['/r1'], {}, ls), ['/r1/x/a b.mov', '/r1/a-b.mov'])
  assert.deepEqual(findSameName('c.mov', ['/r1'], {}, ls), ['/r1/x/c.mov'])
  assert.deepEqual(findSameName('a b.mov', ['/r1'], { max: 1 }, ls), ['/r1/x/a b.mov'])
  assert.deepEqual(findSameName('a b.mov', ['/r1'], { skip: '/r1/x/a b.mov' }, ls), ['/r1/a-b.mov'])
  assert.deepEqual(findSameName('a/b.mov', ['/r1'], {}, ls), [])
  assert.deepEqual(findSameName('nope.mov', ['/r1'], {}, ls), [])
})

test('启动修复不猜歧义：卡里两个文件归一后同名 → 原样不动', () => {
  const gone = '/tmp/v154-歧义-77ac.mov'
  const b = board({
    files: [{ id: 'f1', path: '/e/同名 x.mov' }, { id: 'f2', path: '/e/同名-x.mov' }],
    tasks: [{ id: 't', text: 'T', done: false, note: canon('同名 x.mov', gone) }]
  })
  const r = repairBoardRefs(b)
  assert.equal(r.changed, 0)
  assert.ok(b.cards[0].tasks[0].note.includes(gone))
})

test('搬家同步只动结构化引用原文：正文里手写的裸路径不动', () => {
  const old = '/d/a.mov'
  const b = board({ files: [{ id: 'f', path: old }], tasks: [{ id: 't', text: 'T', done: false, note: '裸路径 /d/a.mov 和引用 ' + canon('a.mov', old) }] })
  M.setFilePath(b, 'a', 'f', '/e/a.mov')
  const n = b.cards[0].tasks[0].note
  assert.ok(n.includes('裸路径 /d/a.mov'), n)
  assert.ok(n.includes(canon('a.mov', '/e/a.mov')), n)
})
