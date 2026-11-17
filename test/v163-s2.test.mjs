/* v163 / S2：检索（grams 中文二元切词 + BM25 字段权重 + matchField 名称叠加 + 过时降权 + 筛选 / 排序 / 性能） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { buildKbIndex, grams, score, searchKb } from '../lib/kbsearch.js'

let seq = 0
const card = (over = {}) => ({
  id: 'ktest' + String(++seq).padStart(6, '0'),
  title: '发版前清单',
  type: 'howto',
  status: 'verified',
  tags: ['发布', '脱敏'],
  summary: '五项检查',
  contains: [],
  relates: [],
  created: '2026-11-11T10:00:00+08:00',
  updated: '2026-11-11T10:00:00+08:00',
  body: '正文',
  path: '/tmp/kb/ktest.md',
  ...over,
})

test('grams：中文二元（单字 run 一元）/ 英文数字按词 / 标点与空格当分隔', () => {
  assert.deepEqual(grams('解析超时'), ['解析', '析超', '超时'])
  assert.deepEqual(grams('卡'), ['卡'])
  assert.deepEqual(grams('npm run build'), ['npm', 'run', 'build'])
  assert.deepEqual(grams('v162 解析'), ['v162', '解析'])
  assert.deepEqual(grams('解析、超时！'), ['解析', '超时'])
  assert.deepEqual(grams(''), [])
})

test('中文无空格查询命中正文（hit = 正文）', () => {
  const c = card({ title: '无关标题卡', summary: '摘要也不含', body: '任务解析超时后自动重试三次' })
  const r = searchKb(buildKbIndex([c]), '解析超时')
  assert.equal(r.length, 1)
  assert.equal(r[0].id, c.id)
  assert.equal(r[0].hit, '正文')
  assert.ok(r[0].score > 0)
})

test('标题命中排在正文命中前（字段权重 ×3 + 名称叠加）', () => {
  const a = card({ title: '解析超时怎么办', body: '无关' })
  const b = card({ title: '另一张卡', body: '任务解析超时后重试' })
  const r = searchKb(buildKbIndex([a, b]), '解析超时')
  assert.equal(r.length, 2)
  assert.equal(r[0].id, a.id)
  assert.equal(r[0].hit, '标题')
  assert.equal(r[1].id, b.id)
  assert.equal(r[1].hit, '正文')
  assert.ok(r[0].score > r[1].score)
})

test('1 字容错 / 子序列命中标题（matchField 叠加，纯容错路径）', () => {
  const c = card({ title: 'kubernetes guide', body: 'nothing related here' })
  const r = searchKb(buildKbIndex([c]), 'kubernets')
  assert.equal(r.length, 1)
  assert.equal(r[0].id, c.id)
  assert.equal(r[0].hit, '标题')
  assert.ok(r[0].score > 0)
})

test('标签过滤', () => {
  const a = card({ tags: ['发布'], body: '解析超时' })
  const b = card({ tags: ['缓存'], body: '解析超时' })
  const idx = buildKbIndex([a, b])
  assert.deepEqual(searchKb(idx, '解析超时', { tag: '缓存' }).map((x) => x.id), [b.id])
  assert.deepEqual(searchKb(idx, '', { tag: '发布' }).map((x) => x.id), [a.id])
})

test('类型过滤', () => {
  const a = card({ type: 'prompt', body: '解析超时' })
  const b = card({ type: 'domain', body: '解析超时' })
  const idx = buildKbIndex([a, b])
  assert.deepEqual(searchKb(idx, '解析超时', { type: 'prompt' }).map((x) => x.id), [a.id])
  assert.deepEqual(searchKb(idx, '', { type: 'domain' }).map((x) => x.id), [b.id])
})

test('过时降权：stale = draft × 0.5（精确）', () => {
  const a = card({ status: 'draft', title: '解析超时清单', body: '解析超时的处理', updated: '2026-11-11T10:00:01+08:00' })
  const b = card({ status: 'stale', title: '解析超时清单', body: '解析超时的处理', updated: '2026-11-11T10:00:02+08:00' })
  const r = searchKb(buildKbIndex([a, b]), '解析超时')
  assert.equal(r.length, 2)
  assert.equal(r[0].id, a.id, 'draft 排前')
  assert.ok(Math.abs(r[1].score * 2 - r[0].score) < 1e-9, 'stale 分值精确减半')
})

test('空查询：按 updated 倒序全量（受筛选 / limit），score 0 无 hit', () => {
  const a = card({ updated: '2026-11-11T10:00:01+08:00' })
  const b = card({ updated: '2026-11-11T10:00:03+08:00', type: 'moc' })
  const c = card({ updated: '2026-11-11T10:00:02+08:00' })
  const idx = buildKbIndex([a, b, c])
  const all = searchKb(idx, '')
  assert.deepEqual(all.map((x) => x.id), [b.id, c.id, a.id])
  assert.equal(all[0].score, 0)
  assert.equal(all[0].hit, undefined)
  assert.deepEqual(searchKb(idx, '', { type: 'moc' }).map((x) => x.id), [b.id])
  assert.equal(searchKb(idx, '', { limit: 2 }).length, 2)
})

test('limit 截断查询结果', () => {
  const cards = [card({ body: '回归检查' }), card({ body: '回归检查' }), card({ body: '回归检查' })]
  const r = searchKb(buildKbIndex(cards), '回归', { limit: 2 })
  assert.equal(r.length, 2)
})

test('score(card, q) 叠加点：命中 > 0，无关 = 0', () => {
  const c = card({ title: '解析超时清单', body: '解析超时的处理' })
  assert.ok(score(c, '解析超时') > 0)
  assert.equal(score(c, 'xyzzy'), 0)
  assert.equal(score(c, ''), 0)
})

test('500 张合成卡 search < 50ms', () => {
  const WORDS = ['解析', '超时', '重试', '部署', '检查', '调度', '缓存', '构建', '发布', '回归', '脱敏', '索引', '登录', '会话', '面板', '队列']
  const cards = []
  for (let i = 0; i < 500; i++) {
    const body = []
    for (let k = 0; k < 8; k++) body.push(WORDS[(i * 7 + k * 3) % WORDS.length])
    cards.push(card({
      id: 'k' + String(i).padStart(6, '0'),
      title: '工单 ' + WORDS[i % WORDS.length] + '指南 ' + i,
      summary: WORDS[(i + 5) % WORDS.length] + '相关摘要',
      tags: [WORDS[i % WORDS.length]],
      body: body.join('、') + '。',
      updated: '2026-11-11T10:00:' + String(i % 60).padStart(2, '0') + '+08:00',
    }))
  }
  const idx = buildKbIndex(cards)
  assert.equal(idx.n, 500)
  for (const q of ['解析超时', '部署检查', '发布']) {
    const t0 = performance.now()
    const r = searchKb(idx, q)
    const ms = performance.now() - t0
    assert.ok(ms < 50, q + ' took ' + ms.toFixed(1) + 'ms')
    assert.ok(r.length > 0, q + ' has hits')
  }
})
