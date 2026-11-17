/* v163 / S6：会话注入 —— kbLines 索引节（格式 / off·stale 不出现 / 草稿标记 / moc 子卡 / 预算省略 / 摘要兜底）
   + kbAutoRead 全文块（同版本不重注 / updated 变了重注 / 档位 / 预算整张跳过）+ index·memory 接线源码锁 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kbAutoRead, kbLines } from '../lib/memory.js'
import { KbStore } from '../lib/kb.js'

const kc = (over = {}) => ({ id: 'kabc12', title: '发版前清单', type: 'howto', status: 'verified', tags: [], summary: '五项检查', contains: [], relates: [], created: '2026-11-11T10:00:00+08:00', updated: '2026-11-11T10:00:00+08:00', body: '第一步：跑单测', path: '/tmp/kb/kabc12.md', ...over })
const store = new KbStore(join(tmpdir(), 'dpm-kb-s6-'))
const sumOf = (c) => store.summaryOf(c)

test('索引节格式：头部计数 + 每卡一行 [类型] 标题 — 摘要 · 路径（按挂载顺序）', () => {
  const cards = [kc(), kc({ id: 'kdom01', title: '领域速览', type: 'domain', status: 'draft', summary: '一句话', path: '/tmp/kb/kdom01.md' })]
  const lines = kbLines(cards, [{ id: 'kdom01' }, { id: 'kabc12' }], { summaryOf: sumOf })
  assert.equal(lines[0], '- 知识卡（2，挂在本卡片；全文见会话消息，摘要档可用 kb_manage read 读全文）：')
  assert.equal(lines[1], '  - [domain] 领域速览 — 一句话 · /tmp/kb/kdom01.md（草稿）')
  assert.equal(lines[2], '  - [howto] 发版前清单 — 五项检查 · /tmp/kb/kabc12.md')
})

test('off 与 stale 不出现；没有挂载 / 挂载的卡不存在 → 空数组', () => {
  const cards = [kc(), kc({ id: 'kstale1', status: 'stale', path: '/tmp/kb/kstale1.md' })]
  assert.deepEqual(kbLines(cards, [{ id: 'kabc12', mode: 'off' }, { id: 'kstale1' }]), [])
  assert.deepEqual(kbLines(cards, undefined), [])
  assert.deepEqual(kbLines(cards, [{ id: 'knone9' }]), [])
})

test('草稿标记只加在 draft 行尾', () => {
  const cards = [kc({ status: 'draft' }), kc({ id: 'kveri1', path: '/tmp/kb/kveri1.md' })]
  const lines = kbLines(cards, [{ id: 'kabc12' }, { id: 'kveri1' }])
  assert.ok(lines[1].endsWith('（草稿）'))
  assert.ok(!lines[2].includes('（草稿）'))
})

test('moc 汇总卡多一行子卡标题（缺失的子卡回落 id）', () => {
  const cards = [kc({ id: 'kmoc01', title: '发布 MOC', type: 'moc', contains: ['kabc12', 'kzzzz9'], path: '/tmp/kb/kmoc01.md' }), kc()]
  const lines = kbLines(cards, [{ id: 'kmoc01' }])
  assert.equal(lines[1], '  - [moc] 发布 MOC — 五项检查 · /tmp/kb/kmoc01.md')
  assert.equal(lines[2], '    子卡：发版前清单、kzzzz9')
})

test('索引超预算从后省略并注明数量（头部计数跟着变）', () => {
  const cards = [1, 2, 3].map((i) => kc({ id: 'klong' + i, title: '很长很长很长很长很长很长很长很长很长的标题' + i, summary: '摘要摘要摘要摘要摘要摘要摘要摘要摘要摘要摘要摘要', path: '/tmp/kb/klong' + i + '.md' }))
  const lines = kbLines(cards, [{ id: 'klong1' }, { id: 'klong2' }, { id: 'klong3' }], { maxBytes: 300 })
  const text = lines.join('\n')
  assert.ok(text.includes('（1，'), '头部数量 = 留下的张数')
  assert.ok(!text.includes('klong2'), '第二张起被省略')
  assert.ok(text.includes('另有 2 张知识卡因长度预算省略'))
})

test('摘要兜底：留空走 KbStore.summaryOf（正文去 markdown 前 80 字）', () => {
  const lines = kbLines([kc({ summary: '', body: '**加粗** 的一句话正文' })], [{ id: 'kabc12' }], { summaryOf: sumOf })
  assert.equal(lines[1], '  - [howto] 发版前清单 — 加粗 的一句话正文 · /tmp/kb/kabc12.md')
})

test('kbAutoRead：首次注入全文；同版本不重注；updated 变了再注', () => {
  const c = kc()
  const r1 = kbAutoRead([c], [{ id: 'kabc12' }], new Map())
  assert.ok(r1.text.includes('[dsh-project-manager · 知识卡全文]'))
  assert.ok(r1.text.includes('<kb-card id="kabc12" title="发版前清单" updated="2026-11-11T10:00:00+08:00">'))
  assert.ok(r1.text.includes('第一步：跑单测'))
  assert.deepEqual(r1.injected, [{ id: 'kabc12', updated: '2026-11-11T10:00:00+08:00' }])
  const seen = new Map(r1.injected.map((x) => [x.id, x.updated]))
  assert.equal(kbAutoRead([c], [{ id: 'kabc12' }], seen), null)
  const r2 = kbAutoRead([{ ...c, updated: '2026-11-11T11:00:00+08:00' }], [{ id: 'kabc12' }], seen)
  assert.equal(r2.injected[0].updated, '2026-11-11T11:00:00+08:00')
})

test('kbAutoRead 档位：domain 缺省 sum 不注全文；显式 mode=full 才注；off 不注', () => {
  const domain = kc({ id: 'kdom01', type: 'domain', path: '/tmp/kb/kdom01.md' })
  assert.equal(kbAutoRead([domain], [{ id: 'kdom01' }], new Map()), null)
  const r = kbAutoRead([domain], [{ id: 'kdom01', mode: 'full' }], new Map())
  assert.ok(r && r.text.includes('kdom01'))
  const off = kc({ id: 'koff01', type: 'prompt', path: '/tmp/kb/koff01.md' })
  assert.equal(kbAutoRead([off], [{ id: 'koff01', mode: 'off' }], new Map()), null)
})

test('kbAutoRead 预算：放不下的整张跳过（不落账）+ 块尾注明；全放不下 → null', () => {
  const a = kc({ id: 'ksma11', body: '短正文', path: '/tmp/kb/ksma11.md' })
  const b = kc({ id: 'kbig01', title: '大卡', body: '很'.repeat(1500), path: '/tmp/kb/kbig01.md' })
  const r = kbAutoRead([a, b], [{ id: 'kbig01' }, { id: 'ksma11' }], new Map(), 600)
  assert.ok(r.text.includes('短正文'))
  assert.ok(!r.text.includes('很'.repeat(50)), '大卡整张跳过')
  assert.ok(r.text.includes('（另有 1 张未展开，用 kb_manage read 读全文）'))
  assert.deepEqual(r.injected, [{ id: 'ksma11', updated: '2026-11-11T10:00:00+08:00' }])
  assert.equal(kbAutoRead([b], [{ id: 'kbig01' }], new Map(), 600), null)
})

test('接线源码锁：config 两上限 / memoryFor 传索引 / pre-step 注全文与 compaction 清账 / memoryText 拼接次序', () => {
  const root = join(fileURLToPath(import.meta.url), '../../src/')
  const idx = readFileSync(root + 'index.ts', 'utf8')
  assert.ok(idx.includes('kbIndexMaxBytes: z.natural().min(500).max(32000).default(4000)'))
  assert.ok(idx.includes('kbFullMaxBytes: z.natural().min(2000).max(64000).default(12000)'))
  assert.ok(idx.includes('kbLines(kb.list(), card.kb, { maxBytes: config.kbIndexMaxBytes, summaryOf: (c) => kb.summaryOf(c) })'))
  assert.ok(idx.includes('kbAutoRead(kb.list(), card?.kb, seen, config.kbFullMaxBytes)'))
  assert.ok(idx.includes('landfill.contextLost(sid); kbSeenOf(sid).clear()'))
  assert.ok(idx.includes("'kb-autoread'"))
  const mem = readFileSync(root + 'memory.ts', 'utf8')
  assert.ok(mem.includes('statePath?: (key: string) => string | undefined, kb: string[] = []'))
  assert.ok(mem.includes("cardSection(b, c, notesMaxBytes, statePath), ...kb, '', '### 落盘项目（/landfill-project）'"))
})
