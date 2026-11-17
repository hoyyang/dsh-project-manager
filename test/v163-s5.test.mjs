/* v163 / S5：Agent 工具 kb_manage（search / read / list / create / update / attach / detach；无 remove；create 强制 draft；update 禁改 status） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as M from '../lib/model.js'
import { KbStore } from '../lib/kb.js'
import { registerTools } from '../lib/tools.js'

const setup = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'kb-group')
  const c = M.addCard(b, g.id, '工具卡片')
  const kb = new KbStore(join(mkdtempSync(join(tmpdir(), 'kb-s5-')), 'kb'))
  const registered = []
  registerTools({ register: (t) => registered.push(t) }, { get: () => b, mutate: async (fn) => fn(b) }, {}, kb)
  const tool = registered.find((t) => t.name === 'kb_manage')
  assert.ok(tool, 'kb_manage 已注册')
  return { b, g, c, kb, run: (args) => tool.execute(args, { agent: { session: { id: 'sess1' } } }) }
}

test('S5 create 一律草稿（显式传 status:verified 也被强制 draft），文件落盘', async () => {
  const { kb, run } = setup()
  const r = await run({ op: 'create', title: '发版清单', type: 'howto', body: '# 步骤', status: 'verified' })
  assert.equal(r.ok, true)
  assert.equal(r.card.status, 'draft')
  assert.equal(r.card.type, 'howto')
  assert.ok(existsSync(join(kb.dir, r.card.id + '.md')), 'md 文件已写入')
})

test('S5 read 返回正文 + 路径；不存在 → NO_KB', async () => {
  const { run } = setup()
  const cr = await run({ op: 'create', title: '读卡测试', type: 'domain', body: '正文内容' })
  const r = await run({ op: 'read', id: cr.card.id })
  assert.equal(r.ok, true)
  assert.equal(r.card.body, '正文内容')
  assert.ok(r.card.path.endsWith(r.card.id + '.md'))
  const miss = await run({ op: 'read', id: 'kzzzz9' })
  assert.equal(miss.ok, false)
  assert.equal(miss.code, 'NO_KB')
})

test('S5 list：列表项不含 body，errors 为数组', async () => {
  const { run } = setup()
  await run({ op: 'create', title: '清单一', type: 'snippet', body: 'x'.repeat(300) })
  const r = await run({ op: 'list' })
  assert.equal(r.ok, true)
  assert.equal(r.cards.length, 1)
  assert.equal('body' in r.cards[0], false)
  assert.ok(Array.isArray(r.errors))
  assert.ok(r.cards[0].summary.length > 0, '空 summary 走 summaryOf 兜底')
})

test('S5 update 改 title / body / tags；status 参数一律拒绝（KB_FORBIDDEN）', async () => {
  const { run } = setup()
  const cr = await run({ op: 'create', title: '原标题', type: 'prompt', body: 'v1' })
  const up = await run({ op: 'update', id: cr.card.id, title: '新标题', body: 'v2', tags: ['a', 'a', 'b'] })
  assert.equal(up.ok, true)
  assert.equal(up.card.title, '新标题')
  assert.deepEqual(up.card.tags, ['a', 'b'])
  for (const status of ['verified', 'stale', 'draft']) {
    const bad = await run({ op: 'update', id: cr.card.id, status })
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'KB_FORBIDDEN')
  }
  const miss = await run({ op: 'update', id: 'kzzzz9', title: 'x' })
  assert.equal(miss.code, 'NO_KB')
})

test('S5 无 remove：op=remove → BAD_OP，文件仍在', async () => {
  const { kb, run } = setup()
  const cr = await run({ op: 'create', title: '不许删', type: 'domain', body: 'x' })
  const r = await run({ op: 'remove', id: cr.card.id })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'BAD_OP')
  assert.ok(existsSync(join(kb.dir, cr.card.id + '.md')), '文件没被删')
})

test('S5 search：中文命中标题、type / tag 过滤、空 q 浏览态', async () => {
  const { run } = setup()
  const a = await run({ op: 'create', title: '发版清单', type: 'howto', body: '第一步 构建' })
  const b2 = await run({ op: 'create', title: '检索说明', type: 'domain', tags: ['检索'], body: 'BM25 说明' })
  const hit = await run({ op: 'search', q: '发版' })
  assert.equal(hit.ok, true)
  assert.equal(hit.results[0]?.id, a.card.id)
  assert.equal(hit.results[0]?.hit, '标题')
  const byType = await run({ op: 'search', q: '', type: 'domain' })
  assert.deepEqual(byType.results.map((x) => x.id), [b2.card.id])
  const byTag = await run({ op: 'search', q: '检索', tag: '检索' })
  assert.deepEqual(byTag.results.map((x) => x.id), [b2.card.id])
  const browse = await run({ op: 'search', q: '' })
  assert.equal(browse.results.length, 2)
  assert.ok(browse.results.every((x) => x.score === 0))
})

test('S5 attach / detach：挂载、重复 attach 换档位移到末尾、非法 mode 拒绝、detach 清空删字段、归档卡拒绝', async () => {
  const { b, g, c, run } = setup()
  const k1 = (await run({ op: 'create', title: '卡一', type: 'howto', body: 'x' })).card.id
  const k2 = (await run({ op: 'create', title: '卡二', type: 'domain', body: 'x' })).card.id
  const a1 = await run({ op: 'attach', id: k1, card: c.id })
  assert.deepEqual(a1.card.kb, [{ id: k1 }])
  await run({ op: 'attach', id: k2, card: c.id })
  const a3 = await run({ op: 'attach', id: k1, card: c.id, mode: 'off' })
  assert.deepEqual(a3.card.kb, [{ id: k2 }, { id: k1, mode: 'off' }])
  const badMode = await run({ op: 'attach', id: k2, card: c.id, mode: 'all' })
  assert.equal(badMode.ok, false)
  assert.equal(badMode.code, 'BAD_ARG')
  const miss = await run({ op: 'attach', id: 'kzzzz9', card: c.id })
  assert.equal(miss.code, 'NO_KB')
  const d1 = await run({ op: 'detach', id: k1, card: c.id })
  assert.deepEqual(d1.card.kb, [{ id: k2 }])
  const d2 = await run({ op: 'detach', id: k2, card: c.id })
  assert.deepEqual(d2.card.kb, [])
  assert.equal('kb' in b.cards.find((x) => x.id === c.id), false, '空清单 = 删字段')
  const other = M.addCard(b, g.id, '归档卡')
  M.archiveCard(b, other.id)
  const arch = await run({ op: 'attach', id: k1, card: other.id })
  assert.equal(arch.ok, false)
  assert.match(arch.error, /已归档/)
})

test('S5 源码锁：注册名 / op 列表 / create 强制 draft / update 禁 verified / 无 remove / index.ts 接线', () => {
  const src = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8')
  assert.match(src, /name: 'kb_manage'/)
  assert.match(src, /'task_manage', 'kb_manage', 'landfill'/)
  const start = src.indexOf("name: 'kb_manage'")
  const end = src.indexOf('export function registerLandfillTool')
  const block = src.slice(start, end)
  assert.match(block, /case 'search'/)
  assert.match(block, /case 'read'/)
  assert.match(block, /case 'list'/)
  assert.match(block, /case 'create'/)
  assert.match(block, /case 'update'/)
  assert.match(block, /case 'attach'/)
  assert.match(block, /case 'detach'/)
  assert.doesNotMatch(block, /case 'remove'/)
  assert.match(block, /status: 'draft'/)
  assert.match(block, /KB_FORBIDDEN/)
  assert.match(block, /新建一律草稿/)
  const idx = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(idx.includes('registerTools((h as HostCtx).tools, store, states, kb)'), 'index.ts 把 kb 传给 registerTools')
})
