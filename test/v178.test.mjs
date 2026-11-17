/* v178：看板搜索搜进卡片内容（内容字段 / 命中片段 / 维度计数 / 前缀定维 / 排序） */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../lib/search.js'

const G = (over) => ({ id: 'g1', name: '密码管理', links: [], statuses: [{ id: 's1', name: '调研' }, { id: 's2', name: '实施' }], ...over })
const C = (over) => ({ id: 'c1', g: 'g1', col: 's2', order: 0, t: '解析正则超时', links: [], tasks: [{ done: true }, { done: false }], ...over })
const ST = (over) => ({ key: 'passwords/passwrd-autofill', project: 'passwords', slug: 'passwrd-autofill', status: '进行中', updated: '2026-11-09', aliases: ['验证码填充'], ...over })
const KB = [{ id: 'k1', title: '冷启动知识卡', summary: '冷启动时先读 STATE', tags: ['启动', '记忆'] }]
const input = (over) => ({ groups: [G()], cards: [C()], states: [ST()], kb: KB, ...over })

test('内容字段：任务 / 子任务 / 说明 / 链接 / 文件 / 知识卡各有专属维度', () => {
  const c = C({
    tasks: [{ id: 't1', text: '验收滚动贴顶', done: false, note: '逐项截图', subs: [{ text: '四处落点', note: '子说明' }] }],
    noteItems: [{ t: '风险', v: '回归脚本会漂' }],
    webLinks: [{ id: 'l1', text: '项目仓库', url: 'https://github.com/hoyyang/dsh-project-manager', type: '代码', tag: 'gh' }],
    files: [{ id: 'f1', path: '/tmp/录屏.mov', title: '验收录屏' }],
    kb: [{ id: 'k1' }]
  })
  const fs = S.contentFields(c, S.kbIndex(input()))
  const dims = fs.map((f) => f.dim)
  assert.ok(dims.includes('task') && dims.includes('note') && dims.includes('link') && dims.includes('file') && dims.includes('kb'))
  assert.ok(fs.some((f) => f.id === 'task:t1' && f.w === 44))
  assert.ok(fs.some((f) => f.id === 'sub:t1s0'))
  assert.ok(fs.some((f) => f.id === 'kb:k1' && f.label === '知识卡'))
  assert.ok(fs.some((f) => f.id === 'kbt:k1:0' && f.text === '启动'))
  // 空字段不建
  const empty = S.contentFields(C(), S.kbIndex(input()))
  assert.equal(empty.length, 0)
})

test('matchEntry：同一张卡的多个任务都收进内容命中（不是只留最好的那个）', () => {
  const c = C({ tasks: [{ text: '验收一', done: false }, { text: '验收二', done: false }, { text: '验收三', done: false }] })
  const m = S.model(input({ cards: [c] }), '验收')
  assert.equal(m.base.length, 1)
  const hits = S.shownHits(m.base[0], 'all')
  assert.equal(hits.length, 3)
  assert.deepEqual(hits.map((h) => h.text).sort(), ['验收一', '验收三', '验收二'].sort())
})

test('排序：标题命中排在纯内容命中之前', () => {
  const a = C({ id: 'a', order: 0, t: '验收清单', tasks: [] })
  const b = C({ id: 'b', order: 1, t: '别的东西', tasks: [{ text: '验收滚动', done: false }] })
  const m = S.model(input({ cards: [a, b] }), '验收')
  assert.equal(m.base[0].entry.id, 'a')
})

test('命中片段：窗口切在命中处，区间跟着平移，两头省略', () => {
  const long = '前'.repeat(80) + '验收目标' + '后'.repeat(80)
  const s = S.snip(long, [[80, 84]], 24, 60)
  assert.ok(s.head && s.tail)
  assert.ok(s.text.length <= 60)
  const seg = s.text.slice(s.ranges[0][0], s.ranges[0][1])
  assert.equal(seg, '验收目标')
  // 短文本不加省略号
  const s2 = S.snip('验收目标', [[0, 4]], 24, 130)
  assert.equal(s2.text, '验收目标')
  assert.equal(s2.head, false)
  assert.equal(s2.tail, false)
})

test('前缀定维：半角 / 全角冒号都认，前缀不进关键词', () => {
  assert.deepEqual(S.parseQuery('任务:回归'), { dim: 'task', text: '回归', pre: '任务' })
  assert.deepEqual(S.parseQuery('知识卡：冷启动'), { dim: 'kb', text: '冷启动', pre: '知识卡' })
  assert.deepEqual(S.parseQuery(' 文件: 录屏 '), { dim: 'file', text: '录屏', pre: '文件' })
  assert.deepEqual(S.parseQuery('相关说明:风险'), { dim: 'note', text: '风险', pre: '相关说明' })
  assert.deepEqual(S.parseQuery('回归'), { dim: null, text: '回归', pre: '' })
  // 冒号后面没字 = 不是前缀（当普通关键词）
  assert.equal(S.parseQuery('任务:').dim, null)
})

test('维度计数：按「有命中的卡片数」算，不重复计同一张卡', () => {
  const c = C({ tasks: [{ text: '验收一', done: false }, { text: '验收二', done: false }], noteItems: [{ t: '验收说明', v: '' }] })
  const m = S.model(input({ cards: [c] }), '验收')
  const n = S.dimCounts(m.base)
  assert.equal(n.task, 1)
  assert.equal(n.note, 1)
  assert.equal(n.all, 1)
  assert.deepEqual(S.rowDims(m.base[0]).sort(), ['note', 'task'])
})

test('维度筛选：filtered 带 dim 时只剩这一类有命中的卡片', () => {
  const a = C({ id: 'a', t: '卡片甲', tasks: [{ text: '验收脚本', done: false }] })
  const b = C({ id: 'b', t: '卡片乙', noteItems: [{ t: '验收说明', v: '' }] })
  const m = S.model(input({ cards: [a, b] }), '验收')
  assert.equal(S.filtered(m, 'all', 'all').length, 2)
  assert.deepEqual(S.filtered(m, 'all', 'all', 'task').map((r) => r.entry.id), ['a'])
  assert.deepEqual(S.filtered(m, 'all', 'all', 'note').map((r) => r.entry.id), ['b'])
})

test('内容索引规模：每类条数（空态「能搜什么」用）', () => {
  const c = C({
    tasks: [{ text: '一', done: false }, { text: '二', done: false, subs: [{ text: '二之一' }] }],
    noteItems: [{ t: '说明一', v: '' }],
    webLinks: [{ text: '链接', url: 'https://a.b' }],
    files: [{ id: 'f1', path: '/a/b.png' }],
    kb: [{ id: 'k1' }]
  })
  const n = S.contentTotals(input({ cards: [c] }))
  assert.equal(n.task, 3)   // 2 个任务 + 1 个子任务
  assert.equal(n.note, 1)
  assert.equal(n.link, 1)
  assert.equal(n.file, 1)
  assert.equal(n.kb, 1)
})

test('索引记忆化：同一个 rev 复用同一份索引，rev 变了才重建', () => {
  const inp = input({ rev: 7 })
  const a = S.buildEntries(inp)
  const b = S.buildEntries(input({ rev: 7 }))
  assert.equal(a, b)                       // 同一个数组（没有重建）
  const c = S.buildEntries(input({ rev: 8 }))
  assert.notEqual(a, c)                    // 版本变了 → 重建
})

test('知识卡列表没加载：kb 维度记 0，其它维度照常', () => {
  const c = C({ tasks: [{ text: '验收一', done: false }], kb: [{ id: 'k1' }] })
  const m = S.model(input({ cards: [c], kb: undefined }), '验收')
  assert.equal(m.base.length, 1)
  assert.equal(S.dimCounts(m.base).kb, 0)
  assert.equal(S.contentTotals(input({ cards: [c], kb: undefined })).kb, 0)
})
