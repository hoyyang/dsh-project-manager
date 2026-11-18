/* v181：清理关联文件新增筛选「任务都完成」—— 行级 done × 路径级 undone / 子任务 / 归档 / 丢失 / 共享 / 计数不变式 / 源码与版本 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Q from '../lib/cleanup.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const SRC = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

const DIR = '/tmp/u/.ai/projects/g/memory/designs/p'
const at = (name, binds) => ({ id: 'fa' + String(name).replace(/[^a-z0-9]/gi, ''), path: DIR + '/evidence/' + name, binds: binds ?? [] })
const fid = (name) => 'fa' + String(name).replace(/[^a-z0-9]/gi, '')
const mkBoard = (cards) => ({ version: 1, groups: [{ id: 'g1', name: '组一', links: [] }], cards, sessions: [] })
const card = (id, files, o = {}) => ({ id, g: 'g1', col: 'build', order: 0, t: o.t ?? id, links: o.links ?? ['g/p'], tasks: o.tasks ?? [], files, ...(o.arch ? { archivedAt: '2026-11-01T00:00:00.000Z' } : {}) })
const task = (id, files, done, subs) => ({ id, text: 'T' + id, done: !!done, ...(files ? { files } : {}), ...(subs ? { subs } : {}) })
const info = (p) => ({ size: 10, exists: !p.includes('missing') })

test('v181：活跃卡 + 本行已完成 + 同路径 0 未完成 → done', () => {
  const b = mkBoard([card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].reason, 'done')
  assert.equal(r.rows[0].useless, false)
  assert.equal(r.rows[0].pathDone, 1)
  assert.equal(r.rows[0].pathUndone, 0)
  assert.equal(r.counts.done, 1)
  assert.equal(r.counts.busy, 1)
})

test('v181：同一行还有未完成任务 → 不进（行级 done 不越过路径级 undone）', () => {
  const b = mkBoard([card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true), task('t2', [fid('a.png')], false)] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].reason, 'active')
  assert.equal(r.rows[0].pathDone, 1)
  assert.equal(r.rows[0].pathUndone, 1)
  assert.equal(r.counts.done, 0)
})

test('v181：同路径别的卡片还有未完成 → 两张卡的行都不进', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] }),
    card('c2', [at('a.png')], { tasks: [task('t2', [fid('a.png')], false)] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  for (const row of r.rows) { assert.equal(row.reason, 'active'); assert.equal(row.pathUndone, 1) }
  assert.equal(r.counts.done, 0)
})

test('v181：本行没有绑定、只是同路径别的卡有已完成 → 本行不进（行级「有没有已完成」）', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] }),
    card('c2', [at('a.png')], {}),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows.find((x) => x.cardId === 'c1').reason, 'done')
  assert.equal(r.rows.find((x) => x.cardId === 'c2').reason, 'active')
  assert.equal(r.counts.done, 1)
})

test('v181：只关联一个已完成的子任务也算（子任务同权）', () => {
  const b = mkBoard([card('c1', [at('a.png')], { tasks: [task('t1', undefined, false, [task('s1', [fid('a.png')], true)])] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].reason, 'done')
  assert.equal(r.rows[0].pathDone, 1)
})

test('v181：已归档卡片即使任务全完成也不进新筛选（仍走无用文件）', () => {
  const b = mkBoard([card('c1', [at('a.png')], { arch: true, tasks: [task('t1', [fid('a.png')], true)] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].reason, 'arch')
  assert.equal(r.rows[0].useless, true)
  assert.equal(r.counts.done, 0)
  assert.equal(r.counts.useless, 1)
})

test('v181：已丢失的已完成文件也进；删除时只能解除关联', () => {
  const b = mkBoard([card('c1', [at('missing.png')], { tasks: [task('t1', [fid('missing.png')], true)] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].reason, 'done')
  assert.equal(r.rows[0].exists, false)
  assert.equal(Q.canTrash(r.rows[0]), false)
})

test('v181：同路径两张活跃卡都已完成 → 两行都 done；pathCards=2 只能解除关联', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] }),
    card('c2', [at('a.png')], { tasks: [task('t2', [fid('a.png')], true)] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  for (const row of r.rows) { assert.equal(row.reason, 'done'); assert.equal(row.pathCards, 2); assert.equal(Q.canTrash(row), false) }
  assert.equal(r.counts.done, 2)
})

test('v181：计数不变式 all = useless + busy；done ⊂ busy；done ∩ useless = ∅', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] }),
    card('c2', [at('a.png')], {}),
    card('c3', [at('b.png')], { tasks: [task('t2', [fid('b.png')], false)] }),
    card('c4', [at('c.png')], { arch: true }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.counts.all, r.counts.useless + r.counts.busy)
  assert.equal(r.counts.done, 1)
  assert.equal(r.counts.useless, 1)
  for (const row of r.rows) if (row.reason === 'done') assert.equal(row.useless, false)
})

test('v181：客户端 / 样式 / 版本都接上了（筛选、胶囊、提示条、空态、规则第二段）', () => {
  const h = src('cleanup.ts')
  assert.match(h, /'done'/)
  assert.match(h, /pathDone/)
  assert.match(h, /counts\.done/)
  assert.match(h, /ownDone && pathUndone === 0 \? 'done' : 'active'/)
  const c = SRC('cleanup.ts')
  assert.match(c, /k: 'done', t: '任务都完成'/)
  assert.match(c, /cls: 'tdone'/)
  assert.match(c, /data-cl-fhint/)
  assert.match(c, /data-cl-fhintx/)
  assert.match(c, /data-cl-tou/)
  assert.match(c, /dpm-cl-rsplit/)
  const css = SRC('style.css')
  assert.match(css, /\.dpm-cl-rsn\.tdone/)
  assert.match(css, /\.dpm-cl-fhint/)
  assert.match(css, /max-height: min\(560px, calc\(100% - 92px\)\)/)
  assert.equal(pkg.version, '0.80.0')
  assert.match(log, /0\.76\.0/)
})