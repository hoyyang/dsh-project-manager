/* v163 / S1：知识卡文件格式（parse / serialize / clean）+ KbStore（目录 CRUD / 签名重载 / 回收站） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanKb, KB_ID_RX, KbStore, parseKb, serializeKb } from '../lib/kb.js'

const dir = () => mkdtempSync(join(tmpdir(), 'dpm-kb-'))
const KEYS = ['id', 'title', 'type', 'status', 'tags', 'summary', 'contains', 'relates', 'created', 'updated', 'body', 'path']
const card = (over = {}) => ({ id: 'kabc12', title: '发版前清单', type: 'howto', status: 'verified', tags: ['发布', '脱敏'], summary: '五项检查', contains: [], relates: [], created: '2026-11-11T10:00:00+08:00', updated: '2026-11-11T10:00:00+08:00', body: '正文', path: '/tmp/kb/kabc12.md', ...over })

test('往返无损：中文 / 引号 / 冒号 / # 号 / 换行 / 代码块 / 数组', () => {
  const c = card({
    title: '发布前 "sanitize" # 清单: 五项',
    summary: '含「冒号: 空格」与 # 号',
    tags: ['发布', '脱敏', 'a:b', ''].filter(Boolean),
    body: '# 标题\n\n- 第一行 **加粗**\n\n```\nnpm test\n```\n\n尾行',
  })
  const back = parseKb(serializeKb(c), c.path)
  for (const k of KEYS) assert.deepEqual(back[k], c[k], k)
  assert.equal(serializeKb(back), serializeKb(c), '二次序列化稳定')
})

test('未知 frontmatter key 原样保留（写回不丢、不重复）', () => {
  const c = card({ extra: { author: 'hoy', ref: 'k9x8y7' } })
  const text = serializeKb(c)
  const back = parseKb(text, c.path)
  assert.deepEqual(back.extra, { author: 'hoy', ref: 'k9x8y7' })
  assert.equal((serializeKb(back).match(/^author:/gm) ?? []).length, 1)
})

test('非法 type / status 回落（读回与写入都回落 domain / draft）', () => {
  const back = parseKb('---\nid: kabc12\ntitle: x\ntype: 乱写\nstatus: 乱写\n---\n正文', '/tmp/kabc12.md')
  assert.equal(back.type, 'domain')
  assert.equal(back.status, 'draft')
  const clean = cleanKb({ title: 'x', type: 'nope', status: 'nope' })
  assert.equal(clean.type, 'domain')
  assert.equal(clean.status, 'draft')
})

test('超长策略：标题拒 / 摘要截断 / 正文拒 / 标签截断与去重', () => {
  assert.throws(() => cleanKb({ title: '张'.repeat(121) }), /最多 120 字/)
  assert.equal(cleanKb({ title: 'x', summary: 'a'.repeat(300) }).summary.length, 200)
  assert.throws(() => cleanKb({ title: 'x', body: 'a'.repeat(200 * 1024 + 1) }), /200 KB/)
  assert.equal(cleanKb({ title: 'x', tags: ['t'.repeat(40)] }).tags[0].length, 30)
  const many = cleanKb({ title: 'x', tags: Array.from({ length: 30 }, (_, i) => 't' + i) })
  assert.equal(many.tags.length, 20)
  assert.deepEqual(cleanKb({ title: 'x', tags: ['白 ', '白', ' 黑'] }).tags, ['白', '黑'])
})

test('非法 id 拒绝：cleanKb 抛错、get 不认（挡住路径穿越 / 大写）', () => {
  assert.throws(() => cleanKb({ id: '../etc/passwd', title: 'x' }), /id 不合法/)
  assert.throws(() => cleanKb({ id: 'KABC12', title: 'x' }), /id 不合法/)
  const s = new KbStore(dir())
  assert.equal(s.get('../board'), undefined)
  assert.equal(s.get('KABC12'), undefined)
  assert.match(cleanKb({ title: 'x' }).id, KB_ID_RX)
})

test('create → list 可见：id 自动生成、落盘 <id>.md、status 默认草稿、标签去重', () => {
  const d = dir()
  const s = new KbStore(d)
  const c = s.create({ title: '如何发版', type: 'howto', body: '步骤', tags: ['发布', '发布'] })
  assert.match(c.id, KB_ID_RX)
  assert.ok(existsSync(join(d, c.id + '.md')))
  assert.deepEqual(s.list().map((x) => x.id), [c.id])
  assert.deepEqual(c.tags, ['发布'])
  assert.equal(c.status, 'draft')
  assert.equal(c.path, join(d, c.id + '.md'))
  assert.match(readFileSync(c.path, 'utf8'), /^---\nid: /)
})

test('update：局部改、created 不动、updated 刷新、path / id 恒定', async () => {
  const s = new KbStore(dir())
  const c = s.create({ title: '原标题', body: '原正文' })
  await new Promise((r) => setTimeout(r, 5))
  const u = s.update(c.id, { title: '新标题', created: '1999-01-01T00:00:00.000Z' })
  assert.equal(u.title, '新标题')
  assert.equal(u.body, '原正文', '没传的字段保持原样')
  assert.equal(u.created, c.created, 'created 不接受改动')
  assert.ok(u.updated > c.updated, 'updated 刷新')
  assert.equal(u.path, c.path, '改标题不改路径（引用永不失效）')
  assert.equal(u.id, c.id)
})

test('外部直接写文件：list 按目录签名自动重载（新增 + 改内容）', () => {
  const d = dir()
  const s = new KbStore(d)
  s.create({ title: '库里的' })
  const p = join(d, 'kext123.md')
  writeFileSync(p, '---\nid: kext123\ntitle: 外部加的\ntype: domain\n---\n外部正文\n')
  assert.ok(s.list().some((x) => x.id === 'kext123'))
  writeFileSync(p, '---\nid: kext123\ntitle: 外部改过的标题\ntype: domain\n---\n外部正文第二版\n')
  assert.equal(s.get('kext123').title, '外部改过的标题')
})

test('坏 frontmatter 不崩：跳过并记 errors，好卡照常列出', () => {
  const d = dir()
  const s = new KbStore(d)
  const good = s.create({ title: '好的' })
  writeFileSync(join(d, 'kbadxx1.md'), '没有 frontmatter 的垃圾内容')
  writeFileSync(join(d, 'kbadxx2.md'), '---\nid: kbadxx2\ntitle: 没结束\n')
  const list = s.list()
  assert.deepEqual(list.map((x) => x.id), [good.id])
  assert.equal(s.errors.length, 2)
  for (const e of s.errors) assert.match(e.error, /frontmatter/)
})

test('remove = 进 .trash（列表消失）→ restore 原样回来', () => {
  const d = dir()
  const s = new KbStore(d)
  const c = s.create({ title: '要删的', body: '留着正文' })
  s.remove(c.id)
  assert.equal(s.list().length, 0)
  assert.ok(existsSync(join(d, '.trash', c.id + '.md')))
  const back = s.restore(c.id)
  assert.equal(back.title, '要删的')
  assert.equal(back.body, '留着正文')
  assert.equal(s.list().length, 1)
  assert.throws(() => s.remove('kzzzzzz'), /找不到知识卡/)
  assert.throws(() => s.restore('kzzzzzz'), /回收站里没有/)
})

test('summaryOf 兜底：正文去掉 markdown 符号后前 80 字', () => {
  const s = new KbStore(dir())
  assert.equal(s.summaryOf({ summary: '写好的摘要', body: '正文' }), '写好的摘要')
  const plain = s.summaryOf({ summary: '', body: '## 标题\n\n- 第一行 **加粗**\n- `code` 与 [链接](https://a.b)\n\n```\ncode block\n```\n\n尾部' })
  assert.ok(plain.startsWith('标题'), plain)
  assert.ok(!/[#*`\[\]()]/.test(plain), plain)
  assert.ok(plain.length <= 80)
  assert.equal(s.summaryOf({ summary: '', body: '' }), '')
})

test('边界：空库 / 空字段 / 重复 id 拒绝', () => {
  const s = new KbStore(dir())
  assert.deepEqual(s.list(), [])
  const c = s.create({ title: '空' })
  assert.deepEqual(c.tags, [])
  assert.deepEqual(c.contains, [])
  assert.deepEqual(c.relates, [])
  assert.equal(c.body, '')
  assert.throws(() => s.create({ id: c.id, title: '重复' }), /已存在/)
})
