import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateCatalog, parseState } from '../lib/states.js'
import * as L from '../lib/landfill.js'
import * as M from '../lib/model.js'
import * as G from '../lib/merge.js'
import { cardBlock } from '../lib/memory.js'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dpm-19-')))
const ST = (slug, body, idx = '') => '# 落盘项目 STATE: ' + slug + '\n\n## 🔄 重启读取清单\n- next_action: ' + slug + ' next\n\n## 📍 当前\n' + body + '\n\n## 📁 文件索引\n' + (idx || '- 暂无\n')

test('0.19 planLayout：去重 / 同名分目录 / 分区 / bak 不带 / 外部文件复制或列缺失', () => {
  const srcs = [
    { key: 'h/a', dir: '/x/a', state: '- 见 /srv/ext/keep.md 与 /srv/ext/gone.png，目录 /srv/ext/dir', files: [{ rel: 'PLAN.md', hash: 'p1', binary: false, size: 1 }, { rel: 'assets/x.png', hash: 'img', binary: true, size: 1 }, { rel: 'notes/merge-h-b.md', hash: 'clash', binary: false, size: 1 }] },
    { key: 'h/b', dir: '/x/b', state: '', files: [{ rel: 'PLAN.md', hash: 'p2', binary: false, size: 1 }, { rel: 'assets/x.png', hash: 'img', binary: true, size: 1 }, { rel: 'STATE.md.bak.1', hash: 'bk', binary: false, size: 1 }, { rel: 'evidence/log.txt', hash: 'lg', binary: false, size: 1 }] },
  ]
  const stat = (p) => (p === '/srv/ext/keep.md' ? { file: true, size: 5 } : p === '/srv/ext/dir' ? { file: false, size: 0 } : null)
  const lay = G.planLayout(srcs, '/ai', ['notes/merge-h-a.md', 'notes/merge-h-b.md'], '/srv/demo', stat, () => 'kh')
  const rels = lay.files.map((f) => f.rel)
  assert.deepEqual(rels, ['notes/PLAN.md', 'evidence/x.png', 'notes/a/merge-h-b.md', 'evidence/keep.md', 'notes/b/PLAN.md', 'evidence/log.txt'])
  assert.deepEqual(lay.files.find((f) => f.rel === 'evidence/x.png').from.map((x) => x.key), ['h/a', 'h/b'], '内容相同只留一份')
  assert.deepEqual(lay.dropped, [{ key: 'h/b', rel: 'STATE.md.bak.1' }])
  assert.deepEqual(lay.copied, [{ path: '/srv/ext/keep.md', rel: 'evidence/keep.md', from: 'h/a' }])
  assert.deepEqual(lay.missing, [{ path: '/srv/ext/gone.png', from: 'h/a' }])
  assert.equal(lay.dirs, 1)
  assert.equal(lay.map['h/b']['PLAN.md'], 'notes/b/PLAN.md')
})

test('0.19 rewritePaths / withAliases / checkCount / isPointer / parseState aliases', () => {
  const lay = { map: { 'h/a-L4': { 'PLAN.md': 'notes/a-L4/PLAN.md' }, 'p/a': {} }, copied: [{ path: '/srv/demo/Desktop/x.md', rel: 'evidence/x.md', from: 'h/a' }] }
  const t = [
    '- /ai/projects/h/memory/designs/a-L4/PLAN.md。',
    '- ~/.ai/projects/p/memory/designs/a/STATE.md',
    '- h:memory/designs/a-L4/STATE.md',
    '- designs/a-L4/STATE.md — 子项目',
    '- ~/Desktop/x.md',
    '- designs/a-L4x/STATE.md 不动',
  ].join('\n')
  const out = G.rewritePaths(t, '/srv/demo/.ai'.replace('/srv/demo/.ai', '/ai'), 'h/a', ['h/a-L4', 'p/a'], lay, 'h', '/srv/demo')
  assert.match(out, /\/ai\/projects\/h\/memory\/designs\/a\/notes\/a-L4\/PLAN\.md。/)
  assert.match(out, /h:memory\/designs\/a\/STATE\.md/)
  assert.match(out, /^- designs\/a\/STATE\.md — 子项目$/m)
  assert.match(out, /\/ai\/projects\/h\/memory\/designs\/a\/evidence\/x\.md/)
  assert.match(out, /designs\/a-L4x\/STATE\.md 不动/)
  const ai = G.rewritePaths('~/.ai/projects/p/memory/designs/a/STATE.md', '/srv/demo/.ai', 'h/a', ['p/a'], { map: {}, copied: [] }, undefined, '/srv/demo')
  assert.equal(ai, '~/.ai/projects/h/memory/designs/a/STATE.md')
  const s = G.withAliases('# T\n\n## x\n', ['a-L4', 'a-r'])
  assert.match(s, /^- aliases: a-L4, a-r/m)
  assert.match(G.withAliases(s, ['a-r', 'z1']), /aliases: a-L4, a-r, z1/)
  assert.deepEqual(parseState(s).aliases, ['a-L4', 'a-r'])
  assert.equal(G.checkCount('## ⚠ 待核实\n- a\n- b\n\n## 下\n- c\n'), 2)
  assert.ok(G.isPointer('- pointer_kind: \u0060global\u0060\n'))
  assert.ok(!G.isPointer('# 正文\n- status: x\n'))
  assert.deepEqual(L.mentioned('回忆 a-L4 吧', [{ key: 'h/a', slug: 'a', aliases: ['a-L4'] }]), ['h/a'])
})

// 合成 6 份：3 份正文（含重复 / 同名不同内容 / 外部文件 / 缺失文件）+ 3 份指针；外部引用 ROUTE.md + MEMORY_INDEX
const setup = async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const repoH = join(d, 'repoH'); const repoP = join(d, 'repoP'); mkdirSync(repoH); mkdirSync(repoP)
  const ext = join(d, 'ext.md'); writeFileSync(ext, '外部文件\n')
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'G')
  const c = M.addCard(b, g.id, 'Card', [])
  M.setGroupLinks(b, g.id, ['h/a', 'h/a-L4', 'h/a-r', 'p/a', 'p/a-L4', 'p/a-r'])
  M.bindSession(b, 's1', c.id)
  const states = new StateCatalog(p.aiRoot, 0)
  const scope = (sid) => (sid === 's1' ? { cardId: c.id, card: M.card(b, c.id).links.slice(), group: M.group(b, g.id).links.slice() } : undefined)
  const lf = new L.Landfill(p, states, { repoPaths: () => [], scope, cardBlock: (k) => cardBlock(b, k, 'x') })
  await lf.register('h', repoH, [], true)
  await lf.register('p', repoP, [], true)
  const put = async (key, text) => { const [pj, sl] = key.split('/'); const r = await lf.ai(['update-state', '--project', pj, '--slug', sl, '--stdin'], text); assert.equal(r.code, 0, r.stderr) }
  const doc = async (key, rel, text) => { const [pj, sl] = key.split('/'); const r = await lf.ai(['write', '--project', pj, '--file', 'memory/designs/' + sl + '/' + rel, '--stdin'], text); assert.equal(r.code, 0, r.stderr) }
  await put('h/a', ST('a', '- 父项目 commit a1b2c3d 版本 1.2.3\n- 外部 ' + ext + '\n- 已删 ' + join(d, 'gone.png'), '- [必读] PLAN.md · 规划\n'))
  await doc('h/a', 'PLAN.md', '# 规划 A\n- ISS-202610-00001A\n')
  await put('h/a-L4', ST('a-L4', '- L4 完成 commit 9f8e7d6c\n- 见 ' + join(p.aiRoot, 'projects/h/memory/designs/a-L4/PLAN.md'), '- [参考] PLAN.md\n'))
  await doc('h/a-L4', 'PLAN.md', '# 规划 L4（不同内容）\n')
  await doc('h/a-L4', 'STATE.md.bak.20260707', 'old\n')
  await put('h/a-r', ST('a-r', '- Response 设计 v2.0.1'))
  for (const s of ['a', 'a-L4', 'a-r']) await put('p/' + s, '# ' + s + ' — pointer\n\n- pointer_kind: \u0060route\u0060\n- authority: \u0060none\u0060\n- next_action: 只指向 h\n\n## 🔄 重启读取清单\n- 读 ' + join(p.aiRoot, 'projects/h/memory/designs/' + s + '/STATE.md') + '\n')
  mkdirSync(join(p.aiRoot, 'memory/projects/a'), { recursive: true })
  const route = await lf.ai(['write', '--global', '--file', 'memory/projects/a/ROUTE.md', '--stdin'], '# Route\n1. ' + join(p.aiRoot, 'projects/h/memory/designs/a-L4/STATE.md') + '\n2. h:memory/designs/a-r/STATE.md\n')
  assert.equal(route.code, 0, route.stderr)
  const idx = await lf.ai(['append', '--project', 'h', '--file', 'MEMORY_INDEX.md', '--stdin'], '- \u0060designs/a-L4/STATE.md\u0060 — L4\n')
  assert.equal(idx.code, 0, idx.stderr)
  states.invalidate()
  const store = { b, relink: async (fn) => fn(b) }
  const mg = new G.MergeEngine({ aiRoot: p.aiRoot, dataDir: p.dataDir, lf, states, board: { get: () => b, relink: store.relink }, cardBlock: (k) => cardBlock(b, k, 'x') })
  const readAll = async (sid, keys) => { for (const k of keys) { for (const f of lf.pending(sid, k)) { let off = f.next; for (;;) { const r = await lf.recall({ id: sid }, k, undefined, off, undefined, f.file === 'STATE.md' ? undefined : f.file); if (r.next === undefined || r.fileComplete) break; off = r.next } } } }
  return { d, p, b, g, c, lf, mg, states, readAll, ext }
}
const scopeKeys = (b, g) => M.group(b, g.id).links.slice()
let AI = ''
const draft = (extra = '', idx = '') => '# 落盘项目 STATE: a\n\n## 🔄 重启读取清单\n- next_action: 合并后继续\n\n## 📍 当前\n- 合并 commit a1b2c3d 9f8e7d6c 版本 1.2.3 v2.0.1 ISS-202610-00001A\n- 文件 ' + AI + '/projects/h/memory/designs/a/evidence/ext.md ' + AI + '/projects/h/memory/designs/a/notes/a-L4/PLAN.md\n' + extra + '\n## ⚠ 待核实\n- L4 状态两种说法\n\n## 📁 文件索引\n' + (idx || '- [必读] notes/PLAN.md · 规划\n- [参考] notes/ · 各来源要点与子文档\n- [参考] evidence/ · 外部文件\n')

test('0.19 合并全链路：预览 → 开始 → 读全 / 要点 → 拒绝（锚点 / 索引）→ 提交（回收区 / 归位 / 别名 / 关联 / 外部引用）→ 撤销 → 再合并嵌套 → 子删除 → 删除', async () => {
  const { p, b, g, lf, mg, states, readAll, ext } = await setup()
  AI = p.aiRoot
  assert.ok(lf.status.toolVersion >= 3, 'ai-memory v3')
  const sk = scopeKeys(b, g)
  const pv = mg.preview(sk, ['h/a', 'h/a-L4', 'h/a-r'], '')
  assert.equal(pv.key, 'h/a')
  assert.deepEqual(pv.aliases, ['a-L4', 'a-r'])
  assert.deepEqual(pv.files.map((f) => f.rel).sort(), ['evidence/ext.md', 'notes/PLAN.md', 'notes/a-L4/PLAN.md'])
  assert.equal(pv.missing.length, 1)
  assert.deepEqual(pv.refs.map((x) => x.replace(p.aiRoot, '')).sort(), ['/memory/projects/a/ROUTE.md', '/projects/h/memory/MEMORY_INDEX.md'])
  assert.throws(() => mg.preview(sk, ['h/a'], ''), { code: 'BAD_ARG' })
  assert.equal(mg.preview(sk, ['h/a-L4', 'h/a-r'], 'a').clash, true, '和没选上的已有项目重名')

  const st = await mg.start('s1', 'c', sk, ['h/a', 'h/a-L4', 'h/a-r'], '')
  assert.match(st.prompt, /^合并落盘项目（dsh-project-manager 合并 mg/)
  assert.equal(L.detectIntent(st.prompt, states.list()), null, '合并指令不算落盘')
  await assert.rejects(mg.commit('s1', st.id, draft()), { code: 'NEED_FULL_READ' })
  await readAll('s1', ['h/a', 'h/a-L4', 'h/a-r'])
  await assert.rejects(mg.commit('s1', st.id, draft()), { code: 'NEED_NOTES' })
  assert.throws(() => mg.note('s2', st.id, 'h/a', 'x'.repeat(30)), { code: 'NEED_FULL_READ' })
  for (const k of ['h/a', 'h/a-L4', 'h/a-r']) mg.note('s1', st.id, k, '- ' + k + ' 的要点，' + 'x'.repeat(20))
  const plan = mg.plan('s1', st.id)
  assert.deepEqual(plan.indexFiles, ['evidence/ext.md', 'notes/PLAN.md', 'notes/a-L4/PLAN.md', 'notes/merge-h-a-L4.md', 'notes/merge-h-a-r.md', 'notes/merge-h-a.md'])
  const lost = await mg.commit('s1', st.id, draft().replace(' 9f8e7d6c', '')).catch((e) => e)
  assert.equal(lost.code, 'DROPPED_ANCHORS'); assert.ok(lost.extra.lost.includes('9f8e7d6c'))
  await assert.rejects(mg.commit('s1', st.id, draft('', '- [必读] notes/PLAN.md\n'), ['gone.png']), { code: 'UNINDEXED_FILES' })
  await assert.rejects(mg.commit('s1', st.id, draft('', '- [参考] notes/\n- [参考] evidence/\n- [必读] notes/nope.md\n'), ['gone.png']), { code: 'BAD_TAG' })
  const done = await mg.commit('s1', st.id, draft(), ['gone.png'])
  assert.equal(done.verified, true)
  const dir = join(p.aiRoot, 'projects/h/memory/designs/a')
  const files = readdirSync(join(dir, 'notes')).sort()
  assert.deepEqual(files, ['PLAN.md', 'a-L4', 'merge-h-a-L4.md', 'merge-h-a-r.md', 'merge-h-a.md'])
  assert.equal(readFileSync(join(dir, 'evidence/ext.md'), 'utf8'), '外部文件\n')
  assert.ok(existsSync(ext), '外部原文件不动')
  const state = readFileSync(join(dir, 'STATE.md'), 'utf8')
  assert.match(state, /aliases: a-L4, a-r/)
  assert.match(state, /dpm:card v1 key=h\/a /)
  assert.ok(!existsSync(join(p.aiRoot, 'projects/h/memory/designs/a-L4')), '来源移走')
  const rec = mg.list().find((r) => r.id === st.id)
  assert.equal(rec.srcs.filter((s) => existsSync(s.retired)).length, 3)
  assert.match(rec.srcs[0].retired, /\/projects\/h\/inbox\/retired\/\d{8}-\d{4}-merge-a\/a$/)
  assert.ok(!existsSync(join(rec.srcs[1].retired, 'STATE.md.bak.20260707')) === false, '.bak 留在回收区')
  assert.deepEqual(M.group(b, g.id).links, ['h/a', 'p/a', 'p/a-L4', 'p/a-r'], '组关联换成合并结果，没选的不动')
  const route = readFileSync(join(p.aiRoot, 'memory/projects/a/ROUTE.md'), 'utf8')
  assert.match(route, /designs\/a\/STATE\.md/); assert.ok(!route.includes('a-L4/'))
  assert.match(readFileSync(join(p.aiRoot, 'projects/h/memory/MEMORY_INDEX.md'), 'utf8'), /designs\/a\/STATE\.md/)
  states.invalidate()
  assert.equal(await lf.resolveKey({}, 'a-L4'), 'p/a-L4', '同名的现存项目优先')
  assert.equal(await lf.resolveKey({}, 'h/a-L4'), 'h/a', '合并掉的旧 key = 别名')
  assert.equal(await lf.resolveKey({}, 'a-L4', 'h'), 'h/a', '按项目找别名')
  assert.equal(await lf.resolveKey({}, 'h/a-r'), 'h/a')
  assert.equal(mg.treeN(rec), 3)
  assert.equal((await lf.validate()).ok, true)

  // 撤销：回到合并前
  assert.equal(mg.undoWhy(rec), null)
  await mg.undo(st.id)
  assert.ok(existsSync(join(p.aiRoot, 'projects/h/memory/designs/a-L4/STATE.md')))
  assert.ok(!existsSync(join(dir, 'notes')), '合并结果的新文件撤掉')
  assert.match(readFileSync(join(dir, 'STATE.md'), 'utf8'), /父项目 commit a1b2c3d/)
  assert.deepEqual(M.group(b, g.id).links, sk)
  assert.match(readFileSync(join(p.aiRoot, 'memory/projects/a/ROUTE.md'), 'utf8'), /a-L4\/STATE\.md/)
  assert.equal(mg.list().length, 0)
  assert.equal((await lf.validate()).ok, true)

  // A B C → X，D E → Y，X F → Z；Z 卡片里删 X 合并前的；撤销 Z → X Y F；删除 Y
  const go = async (keys, name, extra = '', idx = '') => { states.invalidate(); const s = await mg.start('s1', 'c', scopeKeys(b, g), keys, name); await readAll('s1', keys); for (const k of keys) mg.note('s1', s.id, k, '- ' + k + ' 要点 ' + 'x'.repeat(20)); const pl = mg.plan('s1', s.id); try { return { s, r: await mg.commit('s1', s.id, extra || draft(), ['gone.png']), pl } } catch (e) { console.log('GO FAIL', keys, e.code, JSON.stringify(e.extra)); throw e } }
  const X = await go(['h/a', 'h/a-L4', 'h/a-r'], '')
  const ptr = (n) => '# 落盘项目 STATE: ' + n + '\n\n## 🔄 重启读取清单\n- next_action: 指针合并\n- 读 ' + join(p.aiRoot, 'projects/h/memory/designs/a/STATE.md') + '\n\n## 📁 文件索引\n- [参考] notes/\n'
  const Y = await go(['p/a', 'p/a-L4'], '', ptr('a'))
  assert.deepEqual(M.group(b, g.id).links, ['h/a', 'p/a', 'p/a-r'])
  const Z = await go(['h/a', 'p/a-r'], '', draft('- 指针 ' + join(p.aiRoot, 'projects/h/memory/designs/a/STATE.md') + '\n'))
  const z = mg.list().find((r) => r.id === Z.s.id)
  assert.equal(z.srcs[0].mergeId, X.s.id, '合并结果再合并：记下上一次')
  assert.equal(mg.list().find((r) => r.id === X.s.id).parent, Z.s.id)
  assert.equal(mg.treeN(z), 5)
  assert.match(mg.undoWhy(mg.list().find((r) => r.id === X.s.id)), /已经被并进/)
  assert.deepEqual(M.group(b, g.id).links, ['h/a', 'p/a'])
  // 子删除：X 合并前的 A B C 删掉，X 本身留着
  await mg.purge(X.s.id)
  assert.equal(mg.treeN(z), 2)
  assert.ok(existsSync(z.srcs[0].retired), 'X 本身还在回收区')
  await mg.undo(Z.s.id)
  assert.deepEqual(M.group(b, g.id).links, ['h/a', 'p/a', 'p/a-r'], '撤销 Z 回到 X Y F')
  assert.ok(existsSync(join(p.aiRoot, 'projects/h/memory/designs/a/notes/merge-h-a-L4.md')), 'X 回来了（带它的要点）')
  assert.equal(mg.resultOf('h/a'), undefined, 'X 的来源已删：不再有合并完成卡片')
  assert.ok(mg.resultOf('p/a'), 'Y 的卡片还在')
  await mg.purge(Y.s.id)
  assert.equal(mg.list().length, 0)
  assert.equal(readdirSync(join(p.aiRoot, 'projects/p/inbox/retired')).length, 0, '回收区清空（空目录也删）')
  assert.equal((await lf.validate()).ok, true)
})

test('0.19 撤销拒绝：合并后又写过 / 回收区缺文件', async () => {
  const { p, b, g, lf, mg, readAll } = await setup()
  const keys = ['h/a-L4', 'h/a-r']
  const s = await mg.start('s1', 'c', scopeKeys(b, g), keys, 'a-L4')
  await readAll('s1', keys)
  for (const k of keys) mg.note('s1', s.id, k, '- ' + k + ' 要点 ' + 'x'.repeat(20))
  const body = '# 落盘项目 STATE: a-L4\n\n## 🔄 重启读取清单\n- next_action: x\n- 9f8e7d6c v2.0.1 ' + join(p.aiRoot, 'projects/h/memory/designs/a-L4/notes/PLAN.md') + '\n\n## 📁 文件索引\n- [参考] notes/\n'
  await mg.commit('s1', s.id, body)
  const rec = mg.list()[0]
  assert.equal(mg.undoWhy(rec), null)
  const r = await lf.persist({ id: 's1' }, 'h/a-L4', body.replace('next_action: x', 'next_action: y'))
  assert.equal(r.verified, true)
  assert.match(mg.undoWhy(rec), /又被写过/)
  await assert.rejects(mg.undo(rec.id), { code: 'CANNOT_UNDO' })
  await mg.purge(rec.id)
  assert.equal(mg.list().length, 0)
})
