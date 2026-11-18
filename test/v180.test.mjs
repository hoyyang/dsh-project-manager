/* v180：清理关联文件 —— 判定（按路径）/ 不判归档的文件登记 / 客户端交互 / 路由 / 版本 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Q from '../lib/cleanup.js'
import * as M from '../lib/model.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const SRC = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

const DIR = '/tmp/u/.ai/projects/g/memory/designs/p'
const DIR2 = '/tmp/u/.ai/projects/g/memory/designs/q'
const at = (name, binds) => ({ id: 'fa' + String(name).replace(/[^a-z0-9]/gi, ''), path: DIR + '/evidence/' + name, binds: binds ?? [] })
const fid = (name) => 'fa' + String(name).replace(/[^a-z0-9]/gi, '')
const mkBoard = (cards, groups) => ({ version: 1, groups: groups ?? [{ id: 'g1', name: '组一', links: [] }], cards, sessions: [] })
const card = (id, files, o = {}) => ({ id, g: o.g ?? 'g1', col: 'build', order: 0, t: o.t ?? id, links: o.links ?? ['g/p'], tasks: o.tasks ?? [], files, ...(o.arch ? { archivedAt: '2026-11-01T00:00:00.000Z' } : {}) })
const task = (id, files, done, subs) => ({ id, text: 'T' + id, done: !!done, ...(files ? { files } : {}), ...(subs ? { subs } : {}) })
const info = (p) => ({ size: 10, exists: true })

test('判定：已归档卡片 + 没有未完成任务 → 无用（arch）', () => {
  const b = mkBoard([card('c1', [at('a.png')], { arch: true, tasks: [task('t1', [fid('a.png')], true)] })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].useless, true)
  assert.equal(r.rows[0].reason, 'arch')
  assert.equal(r.counts.useless, 1)
  assert.equal(r.counts.busy, 0)
})

test('判定：活跃卡片 + 本行任务已完成 + 无未完成 → done（v181 新口径）', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { tasks: [task('t1', [fid('a.png')], true)] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows[0].useless, false)
  assert.equal(r.rows[0].reason, 'done')
  assert.equal(r.rows[0].pathDone, 1)
  assert.equal(r.counts.done, 1)
  assert.equal(r.counts.busy, 1)
})

test('判定：归档卡上还有未完成任务 / 子任务在用 → 不算（undone），并按路径算', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { arch: true, tasks: [task('t1', [fid('a.png')], true, [task('s1', [fid('a.png')], false)])] }),
    card('c2', [at('a.png')], { arch: true, tasks: [] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  for (const row of r.rows) {
    assert.equal(row.useless, false)
    assert.equal(row.reason, 'undone')
    assert.equal(row.pathUndone, 1)
    assert.equal(row.pathActive, 0)
  }
  assert.equal(r.counts.useless, 0)
})

test('判定：归档卡上的路径还被活跃卡片挂着 → shared（按路径汇总）', () => {
  const b = mkBoard([
    card('c1', [at('a.png')], { arch: true }),
    card('c2', [at('a.png')], { tasks: [] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  const a = r.rows.find((x) => x.cardId === 'c1')
  const c = r.rows.find((x) => x.cardId === 'c2')
  assert.equal(a.useless, false)
  assert.equal(a.reason, 'shared')
  assert.equal(a.pathActive, 1)
  assert.equal(c.reason, 'active')
  assert.equal(a.pathCards, 2)
  assert.equal(Q.canTrash(a), false) // 别的卡片也在用 → 只能解除关联
})

test('范围：不在卡片关联的落盘项目里 → outside，不参与选择/统计', () => {
  const b = mkBoard([card('c1', [{ id: 'f-x', path: '/tmp/u/Desktop/x.png' }], { arch: true })])
  const r = Q.cleanupRows(b, () => [DIR], info)
  assert.equal(r.rows.length, 0)
  assert.equal(r.outside.length, 1)
  assert.match(r.outside[0].why, /落盘项目/)
})

test('范围：卡片组 links 也算（组级 ∪ 卡级）', () => {
  const b = mkBoard([card('c1', [at('a.png')], { links: [] })], [{ id: 'g1', name: '组一', links: ['g/q'] }])
  const rows = Q.cleanupRows(b, (c) => [DIR, DIR2], info).rows
  assert.equal(rows.length, 1)
  assert.equal(Q.underDir(DIR2 + '/evidence/a.png', DIR2), true)
  assert.equal(Q.underDir(DIR2 + 'x', DIR2), false)
})

test('体积：uselessSize 只算存在且没有被别的卡片挂着的', () => {
  const b = mkBoard([
    card('c1', [at('a.png'), at('b.png')], { arch: true }),
    card('c2', [at('a.png')], { tasks: [] }),
  ])
  const r = Q.cleanupRows(b, () => [DIR], info)
  // a.png 被两张卡挂着 → 删了会打断 c2，不计入可释放；b.png 只有 c1
  assert.equal(r.uselessSize, 10)
})

test('文件登记：已归档卡片也能移除 / 恢复（removeFileIn / restoreFileIn），普通入口仍然拒绝', () => {
  const b = mkBoard([card('c1', [at('a.png')], { arch: true, tasks: [task('t1', [fid('a.png')], false)] })])
  assert.throws(() => M.removeFile(b, 'c1', fid('a.png')), (e) => e.code === 'CARD_ARCHIVED')
  const keep = M.removeFileIn(M.card(b, 'c1'), fid('a.png'))
  assert.equal(keep.file.path, DIR + '/evidence/a.png')
  assert.equal(M.card(b, 'c1').files, undefined)
  assert.equal(M.card(b, 'c1').tasks[0].files, undefined)
  M.restoreFileIn(M.card(b, 'c1'), keep.file, keep.index, keep.tasks)
  assert.equal(M.card(b, 'c1').files.length, 1)
  assert.deepEqual(M.card(b, 'c1').tasks[0].files, [fid('a.png')])
})

test('路由：三条清理路由都在（扫描 / 应用 / 撤销），并带快照回包', () => {
  const r = src('routes.ts')
  assert.match(r, /key === 'card\/files-cleanup'/)
  assert.match(r, /key === 'card\/files-cleanup-apply'/)
  assert.match(r, /key === 'card\/files-cleanup-undo'/)
  assert.match(r, /cleanupApply\?\(mode: string, keys: unknown\)/)
})

test('客户端：三态全选复选框 + 已选 N / M；不再有「全选」「全不选」两颗文字按钮', () => {
  const c = SRC('cleanup.ts')
  assert.match(c, /data-cl-allck/)
  assert.match(c, /data-cl-seln/)
  assert.match(c, /ck\.indeterminate = on > 0 && on < vis\.length/)
  assert.match(c, /已全不选（清空全部选择）/)
  assert.doesNotMatch(c, /data-cl-none/)
  assert.doesNotMatch(c, /data-cl-all\b/)
})

test('客户端：五颗筛选 / 判定规则四条 / 一键全选无用文件 / 两个动作 / 撤销', () => {
  const c = SRC('cleanup.ts')
  for (const k of ['all', 'useless', 'arch', 'busy', 'missing']) assert.match(c, new RegExp("k: '" + k + "'"))
  assert.match(c, /没有任何未完成任务 \/ 子任务/)
  assert.match(c, /没有任何未归档卡片/)
  assert.match(c, /data-cl-smart/)
  assert.match(c, /data-cl-trash/)
  assert.match(c, /data-cl-unlink/)
  assert.match(c, /data-cl-undo/)
  assert.match(c, /card\/files-cleanup-apply/)
  assert.match(c, /card\/files-cleanup-undo/)
})

test('客户端：排序只动组内、组头永远按卡片（A10）', () => {
  const c = SRC('cleanup.ts')
  assert.match(c, /function order\(list: ClRow\[\]\): ClRow\[\]/)
  assert.match(c, /function visible\(\): ClRow\[\] \{ return order\(rows\(\)\.filter\(pass\)\) \}/)
  // 不许再对整张列表全局 sort（会把「已丢失 / 同路径」的卡片组头也带着重排）
  assert.doesNotMatch(c, /const out = rows\(\)\.filter\(pass\)\n  if \(state\.sort/)
  assert.match(c, /for \(const arr of byCard\.values\(\)\)/)
})

test('客户端：弹窗 1160×780 / 行 56 / 深色与窄窗都有规则', () => {
  const css = SRC('style.css')
  assert.match(css, /dialog\.dpm-cl \{ width: min\(1160px, calc\(100vw - 52px\)\); height: min\(780px, calc\(100vh - 52px\)\)/)
  assert.match(css, /\.dpm-cl-r \{[^}]*height: 56px/)
  assert.match(css, /body\[data-ds-dark-theme\] dialog\.dpm-cl/)
  assert.match(css, /@media \(max-width: 1180px\)/)
  assert.match(css, /\.dpm-cl-rsn\.green/)
})

test('看板入口：按钮挂在标题区（导入落盘项目之前）+ 徽标数来自扫描', () => {
  const b = SRC('board.ts')
  assert.match(b, /\+ cleanupBtnHtml\(\)\r?\n\s*\+ '<button type="button" class="btn" data-import>'/)
  assert.match(b, /openCleanup\(\{ toast:/)
  assert.match(b, /refreshCleanupBadge\(this\.root\)/)
  const c = SRC('cleanup.ts')
  assert.match(c, /data-cleanup-n/)
  assert.match(c, /class="btn dpm-cl-btn"/)
})

test('版本 0.78.0 + CHANGELOG 有 0.78.0', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.match(log, /0\.76\.0/)
})