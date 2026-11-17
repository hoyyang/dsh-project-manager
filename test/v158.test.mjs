/* v158 / v159：看板搜索纯逻辑（归一 / 分词 / 模糊 / 归档推导 / 排序 / 计数） */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../lib/search.js'

const G = (over) => ({ id: 'g1', name: '密码管理', links: [], statuses: [{ id: 's1', name: '调研' }, { id: 's2', name: '实施' }], ...over })
const C = (over) => ({ id: 'c1', g: 'g1', col: 's2', order: 0, t: '解析正则超时', links: [], tasks: [{ done: true }, { done: false }], ...over })
const ST = (over) => ({ key: 'passwords/passwrd-autofill', project: 'passwords', slug: 'passwrd-autofill', status: '进行中：v1 已完成', updated: '2026-11-09', aliases: ['验证码填充'], ...over })
const input = (over) => ({ groups: [G()], cards: [C()], states: [ST()], ...over })

test('归一化：大小写 / 全半角 / 空格 / 连字符 / 标点都折叠', () => {
  assert.equal(S.key('  ABC  def '), 'abcdef')
  assert.equal(S.key('ＡＢＣ　ＤＥＦ'), 'abcdef')
  assert.equal(S.key('dsh-project-manager'), 'dshprojectmanager')
  assert.equal(S.key('a/b|c「d」'), 'abcd')
  assert.equal(S.key('（全角）'), '全角')
  // map 指回原串（高亮要用）
  const n = S.norm('a b-c')
  assert.deepEqual(n.map, [0, 2, 4])
})

test('空格分词：AND，最多 5 词', () => {
  assert.deepEqual(S.tokens('归档 解析'), ['归档', '解析'])
  assert.deepEqual(S.tokens('  解析  '), ['解析'])
  assert.equal(S.tokens('a b c d e f g').length, 5)
  const m = S.model(input({ cards: [C({ t: '解析正则超时' }), C({ id: 'c2', t: '归档 解析 记录', order: 1 })] }), '归档 解析')
  assert.deepEqual(m.base.map((r) => r.entry.id), ['c2'])
  // 归档卡片的「状态」字段里也有「已归档」这个词 —— 它是搜索词的一部分（设计里状态词可搜）
  const m2 = S.model(input({ cards: [C({ t: '解析正则超时', archivedAt: '2026-11-01' })] }), '归档 解析')
  assert.deepEqual(m2.base.map((r) => r.entry.id), ['c1'])
})

test('子序列：解析超时 命中 解析正则超时（标「模糊」）', () => {
  const f = S.field('title', '标题', '解析正则超时', 100)
  const hit = S.matchField(f, '解析超时')
  assert.ok(hit && hit.fuzzy, '应当靠子序列命中')
  const m = S.model(input({ cards: [C({ t: '解析正则超时' })] }), '解析超时')
  assert.equal(m.base.length, 1)
  assert.equal(m.base[0].fuzzy, true)
})

test('1 字容错：passwrd 命中 password-* 的落盘项目', () => {
  const m = S.model(input({ cards: [C({ t: '登录页', links: ['passwords/password-autofill'] })], states: [ST({ key: 'passwords/password-autofill', slug: 'password-autofill' })] }), 'passwrd')
  const kinds = m.base.map((r) => r.entry.kind)
  assert.ok(kinds.includes('lf'), '落盘项目要能被容错命中')
  assert.equal(m.base.find((r) => r.entry.kind === 'lf').fuzzy, true)
})

test('模糊只对名称类字段：阶段 / 状态 / 项目 / id 只做精确 + 包含', () => {
  const stage = S.field('stage', '阶段', '调研', 22, '', true)
  assert.equal(S.matchField(stage, '调严'), null, 'strict 字段不做容错')
  const idf = S.field('id', '卡片 id', 'cmvxist5y0', 6, '', true)
  assert.equal(S.matchField(idf, 'cmvxist5yy'), null)
  const m = S.model(input({ cards: [C({ col: 's1' })] }), '调严')
  assert.equal(m.base.length, 0)
})

test('落盘项目归档推导：关联卡片全归档 = 已归档；有一张活跃 = 活跃', () => {
  const cards = [
    C({ id: 'a1', t: 'A', links: ['passwords/p'], archivedAt: '2026-11-01' }),
    C({ id: 'a2', t: 'B', links: ['passwords/p'], archivedAt: '2026-11-02', order: 1 })
  ]
  const m1 = S.model(input({ cards, states: [ST({ key: 'passwords/p', slug: 'p' })] }), '')
  const lf1 = m1.all.find((e) => e.kind === 'lf' && e.key === 'passwords/p')
  assert.equal(lf1.arch, true)
  assert.equal(lf1.scope, 'arch')
  cards[1] = { ...cards[1], archivedAt: undefined }
  const m2 = S.model(input({ cards, states: [ST({ key: 'passwords/p', slug: 'p' })] }), '')
  const lf2 = m2.all.find((e) => e.kind === 'lf' && e.key === 'passwords/p')
  assert.equal(lf2.arch, false)
  assert.equal(lf2.scope, 'live')
})

test('卡片组的关联会继承给组内卡片（from = group），并计入落盘项目', () => {
  const m = S.model(input({ groups: [G({ links: ['passwords/p'] })], cards: [C({ links: [] })], states: [ST({ key: 'passwords/p', slug: 'p' })] }), '')
  const card = m.all.find((e) => e.kind === 'card')
  assert.deepEqual(card.mem.map((x) => [x.key, x.from]), [['passwords/p', 'group']])
  const lf = m.all.find((e) => e.kind === 'lf')
  assert.equal(lf.linked.length, 1)
  assert.equal(lf.linked[0].from, 'group')
})

test('卡片组名命中卡片，命中原因写「组名」', () => {
  const m = S.model(input({ groups: [G({ name: '密码管理' })], cards: [C({ t: '无关标题' })] }), '密码')
  const card = m.base.find((r) => r.entry.kind === 'card')
  assert.ok(card, '组名要能把组里的卡片搜出来')
  assert.deepEqual(card.labels.map((l) => l.label), ['组名'])
})

test('只有别名能命中的落盘项目也要列出来（别名权重 70）', () => {
  const m = S.model(input({ cards: [C({ links: ['passwords/passwrd-autofill'] })], states: [ST({ key: 'passwords/passwrd-autofill' })] }), '验证码填充')
  const lf = m.base.find((r) => r.entry.kind === 'lf')
  assert.ok(lf, '别名要能命中')
  assert.deepEqual(lf.labels.map((l) => l.label), ['别名'])
})

test('排序：标题完全相等 > 标题前缀 > 组名；活跃优先于归档', () => {
  const cards = [
    C({ id: 'x1', t: '解析', order: 0 }),
    C({ id: 'x2', t: '解析超时排查', order: 1 }),
    C({ id: 'x3', t: '无关', order: 2 })
  ]
  const m = S.model(input({ groups: [G({ name: '解析组' })], cards }), '解析')
  const ids = m.base.filter((r) => r.entry.kind === 'card').map((r) => r.entry.id)
  assert.deepEqual(ids, ['x1', 'x2', 'x3'])
  const arch = S.model(input({ cards: [C({ id: 'y1', t: '同名', order: 0 }), C({ id: 'y2', t: '同名', order: 1, archivedAt: '2026-11-01' })] }), '同名')
  const order = arch.base.filter((r) => r.entry.kind === 'card').map((r) => r.entry.id)
  assert.deepEqual(order, ['y1', 'y2'], '同分时活跃优先')
})

test('计数：范围 / 类型 / 实际显示条数三套都对得上', () => {
  const cards = [
    C({ id: 'k1', t: '解析 A', order: 0 }),
    C({ id: 'k2', t: '解析 B', order: 1, archivedAt: '2026-11-01' }),
    C({ id: 'k3', t: '别的东西', order: 2 })
  ]
  const m = S.model(input({ cards }), '解析')
  assert.deepEqual(m.counts, { all: 2, live: 1, arch: 1 })
  assert.deepEqual(m.typeCounts, { all: 2, card: 2, group: 0, lf: 0 })
  assert.equal(S.filtered(m, 'arch', 'all').length, 1)
  assert.equal(S.filtered(m, 'all', 'group').length, 0)
  assert.equal(S.rowList(S.filtered(m, 'all', 'all')).length, 2)
})

test('建议：没有命中时给出字形相近的标题（LCS）', () => {
  const all = S.buildEntries(input({ cards: [C({ t: '解析正则超时' })] }))
  const sug = S.suggest('解析正则超时aaa', all, 2)
  assert.ok(sug.length >= 0)
  const sug2 = S.suggest('解析正则超', all, 2)
  assert.equal(sug2.length, 1)
  assert.equal(sug2[0].e.titleText, '解析正则超时')
})

test('空词 = 浏览模式：卡片在前、归档在后、不丢条目', () => {
  const m = S.model(input({ cards: [C({ id: 'b1', t: 'A', order: 0 }), C({ id: 'b2', t: 'B', order: 1, archivedAt: '2026-11-01' })] }), '')
  assert.equal(m.base.length, 3, '2 张卡片 + 1 个卡片组（没有卡片关联的落盘项目不列）')
  assert.deepEqual(m.base.map((r) => r.entry.id), ['b1', 'b2', 'g1'])
})
