import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, chmodSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateCatalog } from '../lib/states.js'
import * as L from '../lib/landfill.js'
import * as M from '../lib/model.js'
import { cardBlock, placeBlock, stripBlock, blockOf, maskBlock, sameBlock, MASK } from '../lib/memory.js'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dpm-18-')))
const ST = [{ key: 'dsh/dsh-project-manager-build', slug: 'dsh-project-manager-build' }]

test('0.18 detectIntent: 讨论「落盘项目」功能不算指令；行首 / 带 slug / 末尾 才算', () => {
  const no = [
    '迭代优化 dsh-project-manager 插件：\n1、复杂项目的落盘项目结构怎么设计？要走父子落盘项目么？\n2、「落盘项目」功能现在已经和插件绑定',
    '刚才忘记提，补充上如下这些的方案：我想知道落盘项目的整个文件结构，是否是一个项目对应一个文件夹',
    '1、方案是否可以保证即使有子文档，Agent 读取落盘记忆时能完整读取。\n3、如果之前「落盘项目」和「卡片档案」是分开注入的',
    '注意，每次注入时都要保证记忆和卡片项目档案是最新的。关掉 plan 模式，开工吧。',
    '落盘项目的记录是 AI 写的，灵活性比较大',
  ]
  for (const t of no) assert.equal(L.detectIntent(t, ST), null, t.slice(0, 30))
  assert.deepEqual(L.detectIntent('落盘项目 dsh-project-manager-build', ST), { want: 'persist', keys: ['dsh/dsh-project-manager-build'] })
  assert.deepEqual(L.detectIntent('做完了\n落盘项目', ST), { want: 'persist', keys: [] })
  assert.deepEqual(L.detectIntent('今天就到这，落盘项目。', ST), { want: 'persist', keys: [] })
  assert.deepEqual(L.detectIntent('先改完再落盘项目：dsh-project-manager-build', ST)?.want, 'persist')
  assert.equal(L.detectIntent('「落盘项目」这个按钮好用吗', ST), null)
})

test('0.18 stopNudge / begin: 规划模式不拉回；连续两轮被忽略后不再拉回，点名项目恢复', () => {
  const d = tmp()
  const lf = new L.Landfill({ aiRoot: join(d, 'ai'), agentsHome: join(d, 'ag'), pkgDir: PKG, dataDir: join(d, 'data') }, new StateCatalog(join(d, 'ai'), 0), { repoPaths: () => [] })
  const s = { want: 'persist', keys: [], turn: 1, done: false, pulls: 0, asked: false }
  assert.equal(L.stopNudge(s, 2, true), null, '规划模式')
  assert.equal(L.stopNudge({ ...s, plan: true }), null)
  assert.ok(L.stopNudge(s))
  assert.equal(lf.begin('x', 1, { want: 'persist', keys: [] }).quiet, undefined)
  assert.equal(lf.begin('x', 2, { want: 'persist', keys: [] }).quiet, undefined)
  const t3 = lf.begin('x', 3, { want: 'persist', keys: [] })
  assert.equal(t3.quiet, true, '第三轮还是没做 → 不再拉回')
  assert.equal(lf.nudge('x'), null)
  assert.equal(lf.begin('x', 4, { want: 'persist', keys: ['a/b'] }).quiet, undefined, '点名项目恢复')
  assert.equal(lf.begin('y', 1, { want: 'persist', keys: [] }, true).plan, true)
  assert.equal(lf.nudge('y'), null)
})

test('0.18 卡片档案块：生成 / 放置 / 剥离往返 / 只遮本卡片 / 忽略 synced', () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'G')
  const c = M.addCard(b, g.id, 'C', ['p/s'])
  M.setNotes(b, c.id, 'n'.repeat(3000))
  M.setWebLinks(b, c.id, Array.from({ length: 35 }, (_, i) => ({ text: 'l' + i, type: '文档', url: 'https://e.com/' + i })))
  M.setGroupLinks(b, g.id, ['p/overview'])
  const blk = cardBlock(b, 'p/s', '2026-10-13T00:00:00Z', '/d/board.json')
  assert.match(blk, /卡片「C」/); assert.match(blk, /上级总览（卡片组关联的落盘项目）：p\/overview/)
  assert.match(blk, /另有 5 条/); assert.match(blk, /已截断/); assert.match(blk, /board\.json → cards\[id=/)
  assert.equal(cardBlock(b, 'p/none', 'x'), '')
  const gb = cardBlock(b, 'p/overview', 'x')
  assert.match(gb, /同组卡片 1 张/); assert.match(gb, /「C」· 调研 · STATE：p\/s/)
  const draft = '# 落盘项目 STATE: s\n\n## 🔄 重启读取清单\n- next_action: a\n\n## 📍 当前\n- x\n'
  const placed = placeBlock(draft, blk)
  assert.ok(placed.indexOf('卡片档案') > placed.indexOf('重启读取清单') && placed.indexOf('卡片档案') < placed.indexOf('📍 当前'))
  assert.equal(stripBlock(placed), draft, '剥离后与原稿一致')
  assert.equal(placeBlock(placed, blk), placed, '再放一次不重复')
  assert.equal(placeBlock(placed, ''), draft, '空块 = 只剥')
  assert.ok(sameBlock(blockOf(placed), blockOf(placeBlock(draft, blk.replace('2026-10-13T00:00:00Z', '2027')))))
  const masked = maskBlock(placed, 0, placed.length, c.id)
  assert.ok(masked.includes(MASK) && !masked.includes('l34'))
  assert.equal(maskBlock(placed, 0, placed.length, 'other'), placed, '别的卡片的块照常返回')
})

test('0.18 档案块只认独占一行的成对标记：正文里引用标记文字不会被当成块删掉（门 12 实测回归）', () => {
  const b = M.emptyBoard()
  const c = M.addCard(b, M.addGroup(b, 'G').id, 'C', ['p/s'])
  const quote = '## 🆕 0.18\n- 卡片档案块: memory.cardBlock（<!-- dpm:card v1 key cards groups synced -->，卡片级 ≤5 张）\n- 注入: 很重要的后半节\n\n## 🖥 本机改动\n- x\n'
  const draft = '# 落盘项目 STATE: s\n\n## 🔄 重启读取清单\n- next_action: a\n\n' + quote
  assert.equal(stripBlock(draft), draft, '没有真实块 = 原样')
  const placed = placeBlock(draft, cardBlock(b, 'p/s', 'x'))
  assert.ok(placed.includes('很重要的后半节') && placed.includes('## 🖥 本机改动'))
  assert.equal(stripBlock(placed), draft, '只剥真实块，正文引用保留')
  assert.equal(placeBlock(placed, cardBlock(b, 'p/s', 'y')), placeBlock(draft, cardBlock(b, 'p/s', 'y')))
  const open = '# T\n\n<!-- dpm:card v1 key=p/s cards= groups= synced=x -->\n- 没有结束标记\n\n## 下一节\n- 保留\n'
  assert.equal(stripBlock(open), open, '缺结束标记不动')
  assert.equal(maskBlock(placed, 0, placed.length, c.id).includes('很重要的后半节'), true)
})

test('0.18 parseIndex / isIndexed / checkRel', () => {
  assert.deepEqual(L.parseIndex('- [必读] notes/a.md · 设计\n* [参考] \u0060evidence/\u0060 · 截图\n- notes/b.md'), [{ tag: '必读', path: 'notes/a.md' }, { tag: '参考', path: 'evidence/' }])
  assert.ok(L.isIndexed('evidence/x/y.png', '## 📁 文件索引\n- [参考] evidence/ · 截图\n'))
  assert.ok(!L.isIndexed('notes/a.md', '## 当前\n- 写了 notes/a.md\n'), '正文别处提到不算索引')
  assert.ok(!L.isIndexed('notes/a.md', '## 📁 文件索引\n- [参考] evidence/\n## 当前\n- notes/a.md\n'), '只认文件索引节')
  assert.ok(!L.isIndexed('notes/a.md', '## 📁 文件索引\n- 暂无（plans/ notes/ evidence/ 均为空）\n'), '只提到目录名不算（staging 实测的绕过）')
  assert.ok(!L.isIndexed('notes/a.md', '只有 notes 没斜杠'))
  for (const bad of ['../x.md', '/abs.md', 'STATE.md', 'a//b.md', 'a/.hidden']) assert.throws(() => L.checkRel(bad), { code: 'BAD_ARG' }, bad)
  assert.throws(() => L.checkRel('notes/a.png', 'write'), { code: 'BAD_ARG' })
  assert.throws(() => L.checkRel('notes/a.png', 'import'), { code: 'BAD_ARG' })
  assert.equal(L.checkRel('plans/2026-10-13-方案.md', 'write'), 'plans/2026-10-13-方案.md')
  assert.equal(L.titleSlug('# dsh 0.18：卡片档案 + 完整读取\n...'), 'dsh-0.18-卡片档案-完整读取')
})

const setup = async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const repo = join(d, 'repo'); mkdirSync(repo)
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'G')
  const c = M.addCard(b, g.id, 'Card', ['proj/demo'])
  M.addFiles(b, c.id, [join(d, 'nope.md')])
  const bound = new Set(['s1', 's2', 's3'])
  const scope = (sid) => (bound.has(sid) ? { cardId: M.card(b, c.id).id, card: M.card(b, c.id).links.slice(), group: M.group(b, g.id).links.slice() } : undefined)
  const lf = new L.Landfill(p, new StateCatalog(p.aiRoot, 0), { repoPaths: () => [repo], scope, cardBlock: (k) => cardBlock(b, k, new Date().toISOString(), '/d/board.json') })
  await lf.register('proj', repo, [], true)
  return { d, p, repo, b, g, c, lf }
}
const STATE = (extra = '') => '# 落盘项目 STATE: demo\n\n## 🔄 重启读取清单\n- next_action: go\n\n## 📁 文件索引\n' + extra + '\n## 📍 当前\n- commit a1b2c3d\n'

test('0.18 全链路：档案块进 STATE、slug 可省、防碎片、文件夹索引、[必读] 读全、write / retire / import', async () => {
  const { d, p, lf, b, c } = await setup()
  const s1 = { id: 's1', cwd: d }
  const w1 = await lf.persist(s1, undefined, STATE())
  assert.equal(w1.key, 'proj/demo', 'slug 省略 → 卡片唯一 STATE')
  const disk = readFileSync(w1.path, 'utf8')
  assert.match(disk, /## 🗂 卡片档案/); assert.match(disk, /卡片「Card」/)
  assert.deepEqual(w1.report.card, { synced: true, cards: 1 })
  assert.ok(w1.report.cardMissingPaths?.some((x) => x.endsWith('nope.md')), '档案里失效路径单独报')
  assert.equal(w1.report.missingPaths, undefined)
  await assert.rejects(lf.persist(s1, 'other', STATE()), (e) => e.code === 'CARD_HAS_STATE')
  // 子文档：write → 未索引拒写 → 补索引 [必读]
  const wd = await lf.write(s1, undefined, 'notes/design.md', '# 设计\n- v1\n')
  assert.equal(wd.created, true); assert.ok(wd.hint)
  const e1 = await lf.persist(s1, undefined, STATE()).then(() => null, (e) => e)
  assert.equal(e1.code, 'UNINDEXED_FILES'); assert.deepEqual(e1.extra.files, ['notes/design.md'])
  const w2 = await lf.persist(s1, undefined, STATE('- [必读] notes/design.md · 设计 · 动手前读\n'))
  assert.equal(w2.report.files.required, 1)
  // 另一个会话：STATE 读全但 [必读] 没读 → complete:false + pending；读完才 complete；才许写
  const s2 = { id: 's2', cwd: d }
  const r1 = await lf.recall(s2, undefined)
  assert.equal(r1.stateComplete, true); assert.equal(r1.complete, false)
  assert.deepEqual(r1.pending.map((x) => x.file), ['notes/design.md'])
  assert.ok(r1.docs.some((x) => x.startsWith('notes/design.md · 必读')))
  assert.ok(r1.content.includes(MASK), '本卡片档案块在 recall 里换成占位')
  const e2 = await lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n')).then(() => null, (e) => e)
  assert.equal(e2.code, 'NEED_FULL_READ'); assert.equal(e2.extra.files[0].file, 'notes/design.md')
  const r2 = await lf.recall(s2, undefined, undefined, 0, undefined, 'notes/design.md')
  assert.equal(r2.complete, true)
  // s2 改写子文档 → s1 手里的旧版不算读完
  await lf.write(s2, undefined, 'notes/design.md', '# 设计\n- v2\n')
  await assert.rejects(lf.write(s1, undefined, 'notes/design.md', '# 设计 v3'), (e) => e.code === 'NEED_FULL_READ')
  // 块外删 commit 仍拦；看板删链接（档案块变化）不拦
  M.setWebLinks(b, c.id, [{ text: 'x', type: '文档', url: 'https://x.example.com/1' }])
  await lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n'))
  M.setWebLinks(b, c.id, [])
  const okNoLink = await lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n'))
  assert.equal(okNoLink.verified, true, '看板删了链接，档案块里少了 URL 不算丢锚点')
  await assert.rejects(lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n').replace('a1b2c3d', 'x')), (e) => e.code === 'DROPPED_ANCHORS')
  // 二进制标必读 → BAD_TAG；import 需要新版 ai-memory（插件自带的就是新版）
  const png = join(d, 'shot.png'); writeFileSync(png, Buffer.from([137, 80, 78, 71, 0, 0, 1, 2]))
  lf.status.toolOutdated = true
  await assert.rejects(lf.importFile(s2, undefined, png), (e) => e.code === 'NEED_UPGRADE')
  lf.status.toolOutdated = false
  const im = await lf.importFile(s2, undefined, png)
  assert.equal(im.file, 'evidence/shot.png'); assert.deepEqual(readFileSync(im.path), readFileSync(png))
  await assert.rejects(lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n- [必读] evidence/shot.png · 截图\n')), (e) => e.code === 'BAD_TAG')
  const w3 = await lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n- [参考] evidence/ · 截图\n'))
  assert.equal(w3.verified, true)
  // retire：文本要先读全；退役后 dangling 提示
  const s3 = { id: 's3', cwd: d }
  await assert.rejects(lf.retire(s3, undefined, 'notes/design.md'), (e) => e.code === 'NEED_FULL_READ')
  const rt = await lf.retire(s2, undefined, 'notes/design.md')
  assert.ok(existsSync(rt.retired) && !existsSync(join(lf.dirOf('proj/demo'), 'notes/design.md')))
  const w4 = await lf.persist(s2, undefined, STATE('- [必读] notes/design.md · 设计\n- [参考] evidence/ · 截图\n'))
  assert.deepEqual(w4.report.files.dangling, ['notes/design.md'])
  assert.equal((await lf.validate()).ok, true, 'ai-memory journal 与磁盘一致')
})

test('0.18 autoRead：首次注入全文 → 不重复 → 别处改了注入新版（replaces + writer）→ 压缩后重注 → 超预算续读并拉回', async () => {
  const { d, lf, c } = await setup()
  const w = { id: 'writer', cwd: d }
  await lf.persist(w, 'proj/demo', STATE('- [必读] notes/a.md · A\n').replace('## 📁', '## 📁'), undefined, undefined, [], true).catch(async (e) => { if (e.code !== 'UNINDEXED_FILES') throw e })
  await lf.persist(w, 'proj/demo', STATE())
  await lf.write(w, 'proj/demo', 'notes/a.md', '# A\n' + 'a'.repeat(100) + '\n')
  await lf.persist(w, 'proj/demo', STATE('- [必读] notes/a.md · A\n'))
  const first = lf.autoRead('s1', 1)
  assert.match(first, /file="STATE.md"/); assert.match(first, /file="notes\/a.md"/)
  assert.ok(first.includes(MASK), '档案块换成占位（系统提示里有实时版）')
  assert.equal(lf.autoRead('s1', 1), null, '同一版本不重复')
  assert.equal(lf.pending('s1', 'proj/demo').length, 0, '注入的算已读')
  // 本会话自己写 → 不回灌
  await lf.persist({ id: 's1', cwd: d }, undefined, STATE('- [必读] notes/a.md · A\n') + '- s1 写的\n')
  assert.equal(lf.autoRead('s1', 2), null, '自己写的不回灌')
  // 别处改了 STATE → 下一步注入新版
  await lf.recall(w, 'proj/demo')
  await lf.persist(w, 'proj/demo', STATE('- [必读] notes/a.md · A\n') + '- writer 写的\n')
  const upd = lf.autoRead('s1', 3)
  assert.match(upd, /replaces="/); assert.match(upd, /writer="dsh-project-manager"/); assert.match(upd, /writer 写的/)
  assert.doesNotMatch(upd, /notes\/a.md"/, '没变的子文档不重注')
  // 系统提示替换不算压缩；压缩（compaction/*）→ 全部重注
  assert.equal(lf.scannedTo('s1', 100), undefined); assert.equal(lf.scannedTo('s1', 120), 100)
  assert.equal(lf.autoRead('s1', 4), null)
  lf.contextLost('s1')
  const again = lf.autoRead('s1', 4)
  assert.match(again, /file="STATE.md"/); assert.match(again, /file="notes\/a.md"/)
  // 新增 [必读] 文件 → 注入它
  await lf.write(w, 'proj/demo', 'notes/b.md', 'B')
  await lf.persist(w, 'proj/demo', STATE('- [必读] notes/a.md · A\n- [必读] notes/b.md · B\n') + '- writer 写的\n')
  const nb = lf.autoRead('s1', 5)
  assert.match(nb, /file="notes\/b.md"/)
  // 超预算：只注一部分，列续读位置，回合结束拉回
  await lf.write(w, 'proj/demo', 'notes/big.md', ('## x\n' + 'y'.repeat(200) + '\n').repeat(60))
  await lf.persist(w, 'proj/demo', STATE('- [必读] notes/a.md · A\n- [必读] notes/b.md · B\n- [必读] notes/big.md · big\n'))
  const part = lf.autoRead('s2', 1, 9000)
  assert.match(part, /还没注入完/)
  assert.match(lf.nudge('s2'), /还有内容没读完/)
  for (const o of lf.pending('s2', 'proj/demo')) { let r = await lf.recall({ id: 's2', cwd: d }, 'proj/demo', undefined, o.next, undefined, o.file === 'STATE.md' ? undefined : o.file); while (!r.fileComplete) r = await lf.recall({ id: 's2', cwd: d }, 'proj/demo', undefined, r.next, undefined, o.file === 'STATE.md' ? undefined : o.file) }
  assert.equal(lf.nudge('s2'), null, '读完就不拉')
  // 没绑卡片的会话不注入；分叉继承
  assert.equal(lf.autoRead('free', 1), null)
  assert.ok(lf.autoRead('s1', 7), 's1 补上最新版')
  lf.forkKnown('s3', 's1')
  assert.equal(lf.autoRead('s3', 1), null, '分叉继承父会话已知版本')
  // known 跨重启保存
  const lf2 = new L.Landfill(lf.paths, new StateCatalog(lf.paths.aiRoot, 0), { repoPaths: () => [], scope: () => ({ cardId: c.id, card: ['proj/demo'], group: [] }) })
  assert.equal(lf2.autoRead('s1', 6), null, '重启后不重复注入')
})

test('0.18 计划归档：写 plans/<日期>-<标题>.md，重名加 -2，卡片没有主 STATE 跳过', async () => {
  const { d, lf } = await setup()
  assert.equal(await lf.archivePlan('s1', '# 方案 A\n- x'), null, '还没有 STATE')
  await lf.persist({ id: 's1', cwd: d }, undefined, STATE())
  const a = await lf.archivePlan('s1', '# 方案 A\n- x')
  const b2 = await lf.archivePlan('s1', '# 方案 A\n- y')
  assert.match(a.file, /^plans\/\d{4}-\d{2}-\d{2}-方案-A\.md$/); assert.match(b2.file, /-2\.md$/)
  assert.equal(await lf.archivePlan('free', '# x'), null)
  const e = await lf.persist({ id: 's1', cwd: d }, undefined, STATE()).then(() => null, (x) => x)
  assert.equal(e.code, 'UNINDEXED_FILES', '计划要补索引')
  assert.ok((await lf.persist({ id: 's1', cwd: d }, undefined, STATE('- [参考] plans/ · 历次计划\n'))).verified)
})

test('0.18 ai-memory 版本检测与升级按钮（先备份）', async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'ag'), pkgDir: PKG, dataDir: join(d, 'data') }
  mkdirSync(join(p.aiRoot, 'tools'), { recursive: true })
  const old = readFileSync(join(PKG, 'bin', 'ai-memory'), 'utf8').replace(/^VERSION = \d+\n/m, '').replace(/    p = sub\.add_parser\("version"\)\n    p\.set_defaults\(func=cmd_version\)\n/, '')
  writeFileSync(join(p.aiRoot, 'tools', 'ai-memory'), old); chmodSync(join(p.aiRoot, 'tools', 'ai-memory'), 0o755)
  const lf = new L.Landfill(p, new StateCatalog(p.aiRoot, 0), { repoPaths: () => [] })
  assert.equal(lf.status.ok, true, lf.status.reason)
  assert.equal(lf.snapshot().toolOutdated, true); assert.equal(lf.snapshot().toolVersion, 0)
  const u = lf.upgradeTool()
  assert.equal(readFileSync(u.backup, 'utf8'), old, '原文件已备份')
  assert.equal(u.version, L.bundledVersion(PKG)); assert.equal(lf.snapshot().toolOutdated, false)
  assert.throws(() => lf.upgradeTool(), { code: 'UP_TO_DATE' })
})
