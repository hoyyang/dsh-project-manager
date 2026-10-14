import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateCatalog } from '../lib/states.js'
import * as L from '../lib/landfill.js'
import * as M from '../lib/model.js'
import * as S from '../lib/lfspec.js'
import { MigrateEngine } from '../lib/migrate.js'
import { cardBlock } from '../lib/memory.js'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dpm-20-')))

test('0.20 matchStates：空输入按卡片名 / 完全同名（文件名 / 别名）/ 名字相近 / 无', () => {
  const st = [{ key: 'dsh/plugin-doctor', slug: 'plugin-doctor', aliases: ['插件诊断'] }, { key: 'dsh/dsh-plan-board-build', slug: 'dsh-plan-board-build' }, { key: 'p/checkout-tracking', slug: 'checkout-tracking' }]
  assert.deepEqual(S.matchStates('', st, '插件诊断'), { mode: 'hint', hits: [{ key: 'dsh/plugin-doctor', why: '它的别名就是这张卡片的名字「插件诊断」' }] })
  assert.equal(S.matchStates('', st, '新卡片').mode, 'none')
  assert.equal(S.matchStates('Plugin-Doctor', st, 'x').mode, 'exact')
  assert.equal(S.matchStates('插件诊断 kiro', st, 'x').hits[0].why, '和它的别名「插件诊断」相同')
  const near = S.matchStates('plugin-doc', st, 'x')
  assert.equal(near.mode, 'near'); assert.equal(near.hits[0].key, 'dsh/plugin-doctor')
  assert.equal(S.matchStates('checkout-trackng', st, 'x').hits[0].why, '只差 1 个字符')
  assert.equal(S.matchStates('kiro-retry', st, 'x').mode, 'none')
  assert.equal(S.matchStates('ab', st, 'x').mode, 'none', '太短不比')
})

test('0.20 specIssues：标题 / 文件索引 / 别名 / 位置；by 分工；撤销过迁移不再提示', () => {
  const ok = '# 落盘项目 STATE: x\n\n- aliases: 卡片一\n\n## 🔄 重启读取清单\n- next_action: y\n\n## 📁 文件索引\n- 暂无子文档\n'
  const c = { project: 'dsh', slug: 'x', homes: ['dsh-plugins'], home: 'dsh-plugins', cards: ['卡片一'] }
  assert.deepEqual(S.specIssues(ok, { ...c, project: 'dsh-plugins' }), [])
  assert.deepEqual(S.specIssues(ok, c).map((x) => x.id + ':' + x.by), ['location:plugin'])
  assert.deepEqual(S.specIssues(ok, { ...c, stay: true }), [], '撤销过迁移 = 留在原处')
  assert.deepEqual(S.specIssues(ok, { ...c, home: undefined, homes: [] }), [], '卡片组没设文件夹 = 不迁')
  const bad = '# x — 旧标题\n\n## 🔄 重启读取清单\n- next_action: y\n'
  assert.deepEqual(S.specIssues(bad, { ...c, project: 'dsh-plugins', cards: ['卡片一', 'dsh 插件', 'x'] }).map((x) => x.id), ['title', 'index', 'aliases'])
  assert.deepEqual(S.missingAliases(bad, { cards: ['卡片一', 'x'], slug: 'x' }), ['卡片一'], '卡片名等于 slug 不算')
  assert.match(S.specHint('dsh/x', S.specIssues(bad, c)), /^dsh\/x 不合落盘项目规范 v2 的地方：（你改）首行/)
})

test('0.20 suggestFolder / setGroupFolder', () => {
  assert.equal(S.suggestFolder('dsh 插件建设', 'gmunhccece', ['dsh']), 'dsh-group')
  assert.equal(S.suggestFolder('Code Review', 'g1', []), 'code-review')
  assert.equal(S.suggestFolder('结算问题单处理', 'gmumetdo80', []), 'group-etdo80')
  assert.equal(S.suggestFolder('结算/优惠券需求', 'gmumqt48ob', ['group-qt48ob']), 'group-qt48ob-2')
  const b = M.emptyBoard(); const g1 = M.addGroup(b, 'A'); const g2 = M.addGroup(b, 'B')
  M.setGroupFolder(b, g1.id, 'a-folder')
  assert.equal(M.group(b, g1.id).lfProject, 'a-folder')
  assert.throws(() => M.setGroupFolder(b, g2.id, 'a-folder'), { code: 'FOLDER_TAKEN' })
  assert.throws(() => M.setGroupFolder(b, g2.id, 'Bad Name'), { code: 'BAD_FOLDER' })
  M.setGroupFolder(b, g1.id, ''); assert.equal(M.group(b, g1.id).lfProject, undefined)
})

test('0.20 落盘这一轮的结局：停止 / 出错 / 在问用户 → 恢复 / 写好了', () => {
  const d = tmp()
  const lf = new L.Landfill({ aiRoot: join(d, 'ai'), agentsHome: join(d, 'ag'), pkgDir: PKG, dataDir: join(d, 'data') }, new StateCatalog(join(d, 'ai'), 0), { repoPaths: () => [] }, false)
  const wait = (r) => { lf.runSeen('s', '落盘项目 ' + (r.key || r.label)) }
  wait(lf.runStart('s', 'p/x', 'p/x'))
  lf.runTurnEnd('s', { kind: 'aborted', reason: { kind: 'user' } }, false)
  assert.equal(lf.runOf('s').state, 'stopped')
  wait(lf.runStart('s', '', 'plugin-x'))
  lf.runTurnEnd('s', { kind: 'error', error: { message: 'HTTP 500' } }, false)
  assert.deepEqual([lf.runOf('s').state, lf.runOf('s').error], ['error', 'HTTP 500'])
  wait(lf.runStart('s', 'p/x', 'p/x'))
  lf.runTurnEnd('s', { kind: 'completed' }, true)
  assert.equal(lf.runOf('s').state, 'ask')
  lf.runTurnStart('s'); assert.equal(lf.runOf('s').state, 'busy')
  lf.runTurnEnd('s', { kind: 'completed' }, false)
  assert.equal(lf.runOf('s').state, 'nowrite')
  lf.runDismiss('s'); assert.equal(lf.runOf('s'), undefined)
  // 发出的消息还没进会话时，上一轮的 turn/end 不算；进了之后 0 毫秒结束的错误回合照样算
  lf.runStart('s', 'p/x', 'p/x'); lf.runTurnEnd('s', { kind: 'aborted' }, false); assert.equal(lf.runOf('s').state, 'busy')
  lf.runSeen('s', '别的消息'); lf.runTurnEnd('s', { kind: 'aborted' }, false); assert.equal(lf.runOf('s').state, 'busy')
  lf.runSeen('s', '落盘项目 p/x'); lf.runTurnEnd('s', { kind: 'error', error: { message: 'no key' } }, false); assert.equal(lf.runOf('s').state, 'error')
})

// 迁移全链路：旧位置 dsh/x（含子文档 + 外部引用）→ 落盘时自动迁到 grp/x（AI 先改好规范项）→ 撤销回 dsh/x 且不再自动迁 → 再迁一次后删除旧文件夹
test('0.20 迁移：persist 自动迁到卡片组落盘文件夹 → 撤销 → 删除旧文件夹', async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const repo = join(d, 'repo'); mkdirSync(repo)
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'Plugins')
  const c = M.addCard(b, g.id, '插件诊断', ['dsh/x'])
  M.bindSession(b, 's1', c.id)
  const states = new StateCatalog(p.aiRoot, 0)
  const board = { get: () => b, relink: async (fn) => fn(b) }
  let mig
  const ctxOf = (key) => { const L2 = M.linksOfKey(b, key); const gs = L2.cards.map((x) => M.group(b, x.g)); return { project: key.split('/')[0], slug: key.split('/')[1], homes: gs.map((x) => x.lfProject).filter(Boolean), home: gs.find((x) => x.lfProject)?.lfProject, cards: L2.cards.map((x) => x.t), stay: mig.stay(key) } }
  const lf = new L.Landfill(p, states, {
    repoPaths: () => [repo],
    scope: (sid) => (sid === 's1' ? { cardId: c.id, card: M.card(b, c.id).links.slice(), group: [] } : undefined),
    cardBlock: (k) => cardBlock(b, k, 'x'),
    moveTarget: (key) => { const x = ctxOf(key); return S.specIssues('', x).some((i) => i.id === 'location') ? x.home : undefined },
    migrate: (sid, key, to) => mig.migrate(sid, key, to),
    specCtx: ctxOf,
  })
  mig = new MigrateEngine({ aiRoot: p.aiRoot, dataDir: p.dataDir, lf, states, board })
  await lf.register('dsh', repo, [], true)
  const ok = (r) => assert.equal(r.code, 0, r.stderr)
  ok(await lf.ai(['update-state', '--project', 'dsh', '--slug', 'x', '--stdin'], '# x 旧标题\n\n## 🔄 重启读取清单\n- next_action: 下次 500 时查 ' + join(p.aiRoot, 'projects/dsh/memory/designs/x/notes/log.md') + '\n- commit a1b2c3d\n'))
  ok(await lf.ai(['write', '--project', 'dsh', '--file', 'memory/designs/x/notes/log.md', '--stdin'], '# 日志\n见 ' + join(p.aiRoot, 'projects/dsh/memory/designs/x/STATE.md') + '\n'))
  ok(await lf.ai(['append', '--project', 'dsh', '--file', 'MEMORY_INDEX.md', '--stdin'], '- designs/x/STATE.md — 插件诊断\n'))
  states.invalidate()
  const readAll = async (sid, key) => { for (const f of lf.pending(sid, key)) { let off = f.next; for (;;) { const r = await lf.recall({ id: sid }, key, undefined, off, undefined, f.file === 'STATE.md' ? undefined : f.file); if (r.next === undefined || r.fileComplete) break; off = r.next } } }
  await readAll('s1', 'dsh/x')
  const draft = (extra = '') => '# 落盘项目 STATE: x\n\n- aliases: 插件诊断\n\n## 🔄 重启读取清单\n- next_action: 下次 500 时查 ' + join(p.aiRoot, 'projects/dsh/memory/designs/x/notes/log.md') + '\n- commit a1b2c3d\n' + extra + '\n## 📁 文件索引\n- [参考] notes/log.md · 日志\n'
  // 卡片组还没设文件夹：不迁，只按规范检查 AI 项
  await assert.rejects(lf.persist({ id: 's1' }, 'dsh/x', '# x 旧标题\n\n## 🔄 重启读取清单\n- next_action: n\n- commit a1b2c3d ' + join(p.aiRoot, 'projects/dsh/memory/designs/x/notes/log.md') + '\n\n## 📁 文件索引\n- [参考] notes/log.md\n'), { code: 'SPEC_ISSUES' })
  M.setGroupFolder(b, g.id, 'grp')
  await lf.register('grp', join(d, 'grpdir'), ['Plugins'], true).catch(async (e) => { if (e.code !== 'PATH_REGISTERED') throw e })
  lf.runStart('s1', 'dsh/x', 'dsh/x')
  const w = await lf.persist({ id: 's1' }, 'dsh/x', draft('- 第一次落盘\n'))
  assert.equal(w.key, 'grp/x'); assert.equal(w.migrated.from, 'dsh/x')
  assert.deepEqual([lf.runOf('s1').state, lf.runOf('s1').key], ['done', 'grp/x'], '迁移后信息卡登记的旧 key 也算写好了')
  const nd = join(p.aiRoot, 'projects/grp/memory/designs/x')
  const st1 = readFileSync(join(nd, 'STATE.md'), 'utf8')
  assert.match(st1, /第一次落盘/)
  assert.match(st1, /projects\/grp\/memory\/designs\/x\/notes\/log\.md/, 'STATE 里的旧路径改指新位置')
  assert.match(readFileSync(join(nd, 'notes/log.md'), 'utf8'), /projects\/grp\/memory\/designs\/x\/STATE\.md/, '子文档里的路径也改')
  assert.ok(!existsSync(join(p.aiRoot, 'projects/dsh/memory/designs/x')), '旧位置移走')
  assert.ok(existsSync(w.migrated.retired + '/STATE.md'), '旧文件夹在回收区')
  assert.deepEqual(M.card(b, c.id).links, ['grp/x'], '卡片关联换成新 key')
  assert.match(readFileSync(join(p.aiRoot, 'projects/dsh/memory/MEMORY_INDEX.md'), 'utf8'), /projects\/grp\/memory\/designs\/x\/STATE\.md/, '外部引用改指新位置')
  states.invalidate()
  assert.equal(await lf.resolveKey({}, 'dsh/x').catch(() => 'none'), 'dsh/x', '旧 key 本身不再存在（别名靠 aliases 行）')
  assert.equal(lf.pending('s1', 'grp/x').length, 0, '迁移后不用重读')
  // 已在新位置，再落盘不再迁
  const w2 = await lf.persist({ id: 's1' }, undefined, draft('- 第二次\n').replaceAll('/projects/dsh/', '/projects/grp/'))
  assert.equal(w2.key, 'grp/x'); assert.equal(w2.migrated, undefined)
  // 撤销：搬回原处（带上迁移后的内容），之后不再自动迁
  const rec = mig.recOf('grp/x')
  assert.equal(mig.undoWhy(rec), null)
  await mig.undo(rec.id)
  const back = readFileSync(join(p.aiRoot, 'projects/dsh/memory/designs/x/STATE.md'), 'utf8')
  assert.match(back, /第二次/); assert.match(back, /projects\/dsh\/memory\/designs\/x\/notes\/log\.md/)
  assert.deepEqual(M.card(b, c.id).links, ['dsh/x'])
  assert.ok(mig.stay('dsh/x'))
  states.invalidate()
  await readAll('s1', 'dsh/x')
  const w3 = await lf.persist({ id: 's1' }, undefined, draft('- 第三次\n').replaceAll('/grp/', '/dsh/'))
  assert.equal(w3.key, 'dsh/x', '撤销过迁移的不再自动迁')
  assert.equal((await lf.validate()).ok, true)
})

test('0.20 issue #1 / #2：Windows 绝对路径；Desktop 壳转发去掉 Origin 也能写', async () => {
  for (const p of ['/srv/demo/a', 'C:\\Users\\demo\\repo', 'C:/work/demo/repo', 'd:\\x', '\\\\server\\share\\repo']) assert.ok(M.isAbsPath(p), p)
  for (const p of ['repo', './a', 'C:', 'C:repo', '~/x']) assert.ok(!M.isAbsPath(p), p)
  assert.deepEqual(M.cleanRepos([{ name: 'w', path: 'C:\\Users\\demo\\repo' }]).map((r) => r.path), ['C:\\Users\\demo\\repo'])
  assert.throws(() => M.cleanRepos([{ name: 'w', path: 'repo' }]), { code: 'BAD_ARG' })
  assert.equal(M.normPastedPath('"C:\\Users\\demo\\方案.md"', '/srv/demo'), 'C:\\Users\\demo\\方案.md')
  assert.equal(M.normPastedPath('C:\\', '/srv/demo'), 'C:\\')
  const { sameOrigin } = await import('../lib/routes.js')
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3080' } }), true, '没有 Origin（Desktop 壳转发）放行')
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3080', origin: 'https://evil.example.com' } }), false, '跨站仍拒')
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3080', origin: 'null' } }), false)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3080', origin: '' } }), false)
})

test('0.20 skill 链接：另一份同版 / 更新的本插件安装不抢，旧版或断链才重建', async () => {
  const { mkdirSync: mk, writeFileSync: wf, symlinkSync: sl, readlinkSync: rl, rmSync: rm } = await import('node:fs')
  const d = tmp()
  const pkg = (dir, ver) => { mk(join(dir, 'skills/landfill-project'), { recursive: true }); wf(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-project-manager', version: ver })); wf(join(dir, 'skills/landfill-project/SKILL.md'), ver); return join(dir, 'skills/landfill-project/SKILL.md') }
  const me = pkg(join(d, 'me'), '0.20.0')
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: join(d, 'me'), dataDir: join(d, 'data') }
  const link = L.skillLinkPath(p)
  assert.equal(L.ensureSkillLink(p), 'linked'); assert.equal(rl(link), me)
  const other = pkg(join(d, 'other'), '0.20.0')
  rm(link); sl(other, link)
  assert.equal(L.ensureSkillLink(p), 'linked'); assert.equal(rl(link), other, '同版的另一份安装不抢')
  const newer = pkg(join(d, 'newer'), '0.21.0'); rm(link); sl(newer, link)
  assert.equal(L.ensureSkillLink(p), 'linked'); assert.equal(rl(link), newer, '更新的不抢')
  const old = pkg(join(d, 'old'), '0.19.0'); rm(link); sl(old, link)
  assert.equal(L.ensureSkillLink(p), 'linked'); assert.equal(rl(link), me, '旧版换成自己')
  rm(link); sl(join(d, 'gone/skills/landfill-project/SKILL.md'), link)
  assert.equal(L.ensureSkillLink(p), 'linked'); assert.equal(rl(link), me, '断链重建')
})
