import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, statSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateCatalog } from '../lib/states.js'
import * as L from '../lib/landfill.js'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dpm-lf-')))
const ST = [{ key: 'dsh/dsh-project-manager-build', slug: 'dsh-project-manager-build' }, { key: 'dsh/dsh-project-manager', slug: 'dsh-project-manager' }, { key: 'p/ISS-1', slug: 'ISS-1' }, { key: 'p/abc', slug: 'abc' }]

test('detectIntent: 落盘 / 回忆 / 继续，长 slug 吞掉被包含的短 slug', () => {
  assert.deepEqual(L.detectIntent('落盘项目 dsh-project-manager-build', ST), { want: 'persist', keys: ['dsh/dsh-project-manager-build'] })
  assert.deepEqual(L.detectIntent('回忆 dsh-project-manager-build 专项，落盘项目里那节', ST), { want: 'recall', keys: ['dsh/dsh-project-manager-build'] })
  assert.deepEqual(L.detectIntent('继续 ISS-1', ST), { want: 'recall', keys: ['p/ISS-1'] })
  assert.equal(L.detectIntent('继续吧', ST), null, '继续 没点名项目 = 普通对话')
  assert.equal(L.detectIntent('回忆一下昨天说的', ST), null)
  assert.equal(L.detectIntent('abc 这个词太短不算', ST), null)
  assert.deepEqual(L.detectIntent('落盘项目', ST), { want: 'persist', keys: [] })
  assert.equal(L.detectIntent('<task-notification>落盘项目</task-notification>', ST), null)
})

test('stopNudge: 没做才拉回、问用户时不拉、最多 2 次', () => {
  const s = { want: 'persist', keys: [], turn: 1, done: false, pulls: 0, asked: false }
  assert.match(L.stopNudge(s), /落盘/)
  assert.equal(L.stopNudge({ ...s, done: true }), null)
  assert.equal(L.stopNudge({ ...s, asked: true }), null)
  assert.equal(L.stopNudge({ ...s, pulls: 2 }), null)
  assert.match(L.stopNudge({ ...s, want: 'recall', keys: ['a/b'] }), /a\/b/)
})

test('guardReason: 只拦直写记忆，放行只读和 ai-memory', () => {
  const ai = '/h/.ai', home = '/h'
  const g = (n, a) => L.guardReason(n, a, ai, home)
  assert.ok(g('write', { file_path: '/h/.ai/projects/x/memory/designs/s/STATE.md' }))
  assert.ok(g('edit', { file_path: '~/.ai/memory/MEMORY_INDEX.md' }))
  assert.equal(g('write', { file_path: '/h/.ai/inbox/x.md' }), null, 'inbox 不是记忆')
  assert.equal(g('write', { file_path: '/h/.ai/projects/x/memory/a.json' }), null, '只管 .md')
  assert.ok(g('bash', { command: 'echo hi > ~/.ai/projects/x/memory/designs/s/STATE.md' }))
  assert.ok(g('bash', { command: 'cd /tmp && sed -i "" s/a/b/ $HOME/.ai/memory/MEMORY_INDEX.md' }))
  assert.ok(g('bash', { command: 'cp /tmp/x.md /h/.ai/projects/REGISTRY.md' }))
  assert.ok(g('bash', { command: 'rm -f /h/.ai/projects/x/memory/designs/s/STATE.md' }))
  assert.equal(g('bash', { command: 'cat ~/.ai/projects/x/memory/designs/s/STATE.md | head' }), null)
  assert.equal(g('bash', { command: 'grep -n next ~/.ai/projects/x/memory/designs/s/STATE.md > /tmp/o.txt' }), null)
  assert.equal(g('bash', { command: 'cp ~/.ai/projects/x/memory/designs/s/STATE.md /tmp/bak.md' }), null, '从 ~/.ai 复制出去 = 只读')
  assert.equal(g('bash', { command: '~/.ai/tools/ai-memory update-state --project x --slug s --stdin < /tmp/n.md' }), null)
  // 回归（staging 实测绕过）：同一行里带了 ai-memory 不能让整行放行
  assert.ok(g('bash', { command: 'echo test >> /h/.ai/projects/x/memory/designs/s/STATE.md; ~/.ai/tools/ai-memory hash --project x memory/designs/s/STATE.md' }))
  assert.ok(g('bash', { command: '~/.ai/tools/ai-memory path && rm /h/.ai/projects/x/memory/designs/s/STATE.md' }))
  assert.equal(g('bash', { command: 'cat /tmp/n.md | ~/.ai/tools/ai-memory update-state --project x --slug s --stdin' }), null)
  assert.equal(g('read', { file_path: '/h/.ai/projects/x/memory/designs/s/STATE.md' }), null)
})

test('findPython: Windows 关闭；macOS 没装开发工具时跳过 /usr/bin/python3', () => {
  assert.equal(L.findPython('win32', '/usr/bin', () => true), null)
  assert.equal(L.findPython('darwin', '/usr/bin', (p) => p === '/usr/bin/python3', () => false), null)
  assert.equal(L.findPython('darwin', '/usr/bin', (p) => p === '/usr/bin/python3', () => true), '/usr/bin/python3')
  assert.equal(L.findPython('linux', '/x:/usr/bin', (p) => p === '/x/python3'), '/x/python3')
})

test('bootstrap 只补缺；skill 链接 建 / 断了重建 / 普通文件不动 / 接管带备份', () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const made = L.bootstrap(p)
  assert.equal(made.length, 2)
  assert.ok(existsSync(join(p.aiRoot, 'memory', 'MEMORY_INDEX.md')))
  assert.ok(statSync(join(p.aiRoot, 'tools', 'ai-memory')).mode & 0o100)
  writeFileSync(join(p.aiRoot, 'README.md'), 'mine')
  assert.deepEqual(L.bootstrap(p), [], '第二次什么都不建')
  assert.equal(readFileSync(join(p.aiRoot, 'README.md'), 'utf8'), 'mine', '已有文件不覆盖')

  const link = L.skillLinkPath(p)
  assert.equal(L.ensureSkillLink(p), 'linked')
  assert.equal(readlinkSync(link), L.skillFile(p))
  assert.equal(L.ensureSkillLink(p), 'linked', '幂等')
  // 断链（例如插件升级换了目录）→ 重建
  const q = { ...p, agentsHome: join(d, 'agents2') }
  mkdirSync(dirname(L.skillLinkPath(q)), { recursive: true })
  symlinkSync(join(d, 'gone', 'SKILL.md'), L.skillLinkPath(q))
  assert.equal(L.skillState(q), 'stale')
  assert.equal(L.ensureSkillLink(q), 'linked')
  // 普通文件：不动，接管后备份 + 换成链接
  const r = { ...p, agentsHome: join(d, 'agents3') }
  mkdirSync(dirname(L.skillLinkPath(r)), { recursive: true })
  writeFileSync(L.skillLinkPath(r), 'old skill')
  assert.equal(L.ensureSkillLink(r), 'file')
  const { backup } = L.adoptSkill(r)
  assert.equal(readFileSync(backup, 'utf8'), 'old skill')
  assert.ok(lstatSync(L.skillLinkPath(r)).isSymbolicLink())
  assert.throws(() => L.adoptSkill(r), /NOT_A_FILE|没有需要接管/)
  // 别人的链接：不动
  const f = { ...p, agentsHome: join(d, 'agents4') }
  writeFileSync(join(d, 'other.md'), 'x')
  mkdirSync(dirname(L.skillLinkPath(f)), { recursive: true })
  symlinkSync(join(d, 'other.md'), L.skillLinkPath(f))
  assert.equal(L.ensureSkillLink(f), 'foreign')
})

test('Landfill 全链路（临时 ~/.ai，真跑 ai-memory）：注册 / 新建 / 未读拒写 / 读后更新 / 冲突带 inbox / 关联卡片 / 拉回', async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const repo = join(d, 'repo')
  mkdirSync(repo)
  const linked = []
  const states = new StateCatalog(p.aiRoot, 0)
  const lf = new L.Landfill(p, states, { repoPaths: (sid) => (sid === 's1' ? [repo] : []), persisted: (sid, key) => linked.push(sid + '>' + key) })
  assert.equal(lf.status.ok, true, lf.status.reason)
  const s = { id: 's1', cwd: join(d, 'hub') }
  await assert.rejects(lf.persist(s, 'demo', '# 落盘项目 STATE: demo\n## 🔄 重启读取清单\n- next_action: x\n'), (e) => e.code === 'UNREGISTERED')
  await assert.rejects(lf.register('proj', repo), (e) => e.code === 'NEED_CONFIRM')
  mkdirSync(join(p.dataDir, 'hub', 'groups', 'g1'), { recursive: true })
  await assert.rejects(lf.register('hubby', join(p.dataDir, 'hub', 'groups', 'g1'), [], true), (e) => e.code === 'HUB_PATH', '项目区目录不能登记成项目')
  await lf.register('proj', repo, ['p2'], true)
  await assert.rejects(lf.register('proj2', repo, [], true), (e) => e.code === 'PATH_REGISTERED' && e.extra.projectId === 'proj', '同一目录不能登记两次')
  assert.equal(await lf.resolveProject(s), 'proj', '卡片仓库优先于 cwd')
  await assert.rejects(lf.persist(s, 'demo', 'no sections'), (e) => e.code === 'MISSING_SECTIONS')
  const body = (n) => '# 落盘项目 STATE: demo\n\n## 🔄 重启读取清单\n- next_action: step ' + n + '\n'
  const w1 = await lf.persist(s, 'demo', body(1))
  assert.equal(w1.created, true)
  assert.equal(w1.verified, true)
  assert.deepEqual(linked, ['s1>proj/demo'])
  assert.equal((statSync(w1.path).mode & 0o777).toString(8), '444')
  const s2 = { id: 's2', cwd: repo }
  await assert.rejects(lf.persist(s2, 'demo', body(2)), (e) => e.code === 'NEED_READ', '没读过的会话不能覆盖')
  const rc = await lf.recall(s2, 'demo')
  assert.match(rc.content, /step 1/)
  const w2 = await lf.persist(s2, 'proj/demo', body(2))
  assert.equal(w2.created, false)
  // s1 手里的 hash 已过期 → 冲突，inbox 路径原样带回，文件不变
  const c = await lf.persist(s, 'demo', body(3)).then(() => null, (e) => e)
  assert.equal(c.code, 'CONFLICT')
  assert.ok(c.extra.inbox && existsSync(c.extra.inbox), 'inbox 产物存在')
  assert.match(readFileSync(w1.path, 'utf8'), /step 2/)
  assert.equal((await lf.validate()).ok, true)
  assert.equal(lf.list().count, 1)
  const ap = await lf.append(s2, 'MEMORY_INDEX.md', '- demo')
  assert.ok(existsSync(ap.file))
  await assert.rejects(lf.append(s2, '../x.md', 'a'), (e) => e.code === 'BAD_ARG')
  // 回合跟踪
  lf.begin('s3', 1, { want: 'recall', keys: ['proj/demo'] })
  assert.ok(L.stopNudge(lf.turnOf('s3')))
  await lf.recall({ id: 's3', cwd: repo }, 'demo')
  assert.equal(L.stopNudge(lf.turnOf('s3')), null, 'recall 读全就算回忆完成')
  lf.begin('s4', 1, { want: 'persist', keys: [] })
  lf.observe('s4', 'bash', { command: '~/.ai/tools/ai-memory update-state --project proj --slug demo --stdin' })
  assert.equal(L.stopNudge(lf.turnOf('s4')), null)
})

test('0.17 分段：切在标题/换行处、起点连续、toc、uncovered', () => {
  const t = '# T\n' + Array.from({ length: 40 }, (_, i) => '## s' + i + '\n' + 'x'.repeat(90) + '\n').join('')
  const st = L.chunkStarts(t, 500)
  assert.ok(st.length > 5)
  for (let i = 1; i < st.length; i++) { assert.equal(t[st[i] - 1], '\n'); assert.ok(t.startsWith('## ', st[i]), '优先切在标题前') }
  assert.equal(st.map((s, i) => t.slice(s, st[i + 1] ?? t.length)).join(''), t, '拼回去一字不差')
  assert.equal(L.toc(t).length, 40)
  assert.equal(L.toc(t)[0].title, 's0')
  assert.deepEqual(L.uncovered([[0, 10], [20, 30]], 40), [[10, 20], [30, 40]])
  assert.deepEqual(L.uncovered([[0, 25], [20, 40]], 40), [])
  assert.equal(L.cutEnd('abc', 0, 500), 3)
})

test('0.17 每段（含 toc，JSON 后）不超过宿主直给上限：按 0.262 token/字符估 < 12500', () => {
  const zh = '# 落盘项目 STATE: z\n' + Array.from({ length: 900 }, (_, i) => '## 第' + i + '节：很长的中文标题用来撑满目录条目长度很长很长很长\n- 中文内容「引号」，标点；路径 /srv/demo/x/a' + i + '.ts\n').join('')
  for (let o = 0, n = 0; o < zh.length && n < 10; n++) {
    const e = L.cutEnd(zh, o)
    const out = JSON.stringify({ ok: true, key: 'p/z', path: '/x', hash: 'h'.repeat(64), total: zh.length, offset: o, end: e, chunk: '1/9', complete: false, next: e, missing: [[e, zh.length]], hint: 'x'.repeat(60), toc: o === 0 ? L.toc(zh) : undefined, content: zh.slice(o, e) })
    assert.ok(out.length * 0.262 < 12500, 'chunk@' + o + ' ≈ ' + Math.round(out.length * 0.262) + ' token')
    o = e
  }
})

test('0.17 锚点：commit / 版本 / 路径 / URL / 单号；drop 子串覆盖', () => {
  const a = L.anchors('HEAD 3b71e4e，v0.11.0 发布；见 ~/.ai/x/STATE.md、/srv/demo/repo/src/a.ts:24，https://github.com/o/r/pull/6163。单 ISS-202601-00000042A，deadbeef 不算（无数字）')
  for (const x of ['3b71e4e', '0.11.0', '~/.ai/x/STATE.md', '/srv/demo/repo/src/a.ts:24', 'https://github.com/o/r/pull/6163', 'ISS-202601-00000042A']) assert.ok(a.has(x), x)
  assert.ok(!a.has('deadbeef'))
  const old = 'a 3b71e4e b /tmp/e2e/x.cjs c /tmp/e2e/y.cjs d 1.2.3'
  assert.deepEqual(L.droppedAnchors(old, 'a 3b71e4e d 1.2.3').lost.sort(), ['/tmp/e2e/x.cjs', '/tmp/e2e/y.cjs'])
  assert.deepEqual(L.droppedAnchors(old, 'a 3b71e4e d 1.2.3', ['/tmp/e2e/']).lost, [], '一条 drop 覆盖整个目录')
  assert.equal(L.droppedAnchors(old, 'a 3b71e4e d 1.2.3', ['/tmp/e2e/']).dropped, 2)
  assert.deepEqual(L.missingPaths('有 /tmp 和 /tmp/nope-zz/a.md:3', '/h', (p) => p !== '/tmp/nope-zz/a.md'), ['/tmp/nope-zz/a.md:3'])
})

test('0.17 全链路：大 STATE 分段读全才许写、少锚点拒写、drop 放行、报告、回忆读全才完成', async () => {
  const d = tmp()
  const p = { aiRoot: join(d, 'ai'), agentsHome: join(d, 'agents'), pkgDir: PKG, dataDir: join(d, 'data') }
  const repo = join(d, 'repo'); mkdirSync(repo)
  const lf = new L.Landfill(p, new StateCatalog(p.aiRoot, 0), { repoPaths: () => [repo] })
  await lf.register('proj', repo, [], true)
  const big = '# 落盘项目 STATE: big\n\n## 🔄 重启读取清单\n- next_action: go\n' + Array.from({ length: 1500 }, (_, i) => '## 节 ' + i + '\n- commit a1b2c' + String(i).padStart(3, '0') + ' 路径 ' + repo + '/f' + i + '.ts\n').join('')
  const s = { id: 'w', cwd: repo }
  await lf.persist(s, 'big', big)
  const s2 = { id: 'r', cwd: repo }
  const c1 = await lf.recall(s2, 'big')
  assert.equal(c1.complete, false); assert.ok(c1.next > 0); assert.ok(c1.toc.length > 10); assert.match(c1.chunk, /^1\//)
  assert.ok(c1.content.length <= L.CHUNK)
  const e1 = await lf.persist(s2, 'big', big + '\n').then(() => null, (e) => e)
  assert.equal(e1.code, 'NEED_FULL_READ', '只读了第一段不能写'); assert.deepEqual(e1.extra.missing, [c1.next])
  let r = c1, parts = [c1.content]
  while (!r.complete) { r = await lf.recall(s2, 'big', undefined, r.next); parts.push(r.content) }
  assert.equal(parts.join(''), readFileSync(lf.statePath('proj/big'), 'utf8'), '分段拼起来 = 全文')
  // 优化稿：删掉一半节
  const slim = '# 落盘项目 STATE: big\n\n## 🔄 重启读取清单\n- next_action: go\n' + Array.from({ length: 750 }, (_, i) => '## 节 ' + i + '\n- commit a1b2c' + String(i).padStart(3, '0') + ' 路径 ' + repo + '/f' + i + '.ts\n').join('')
  const e2 = await lf.persist(s2, 'big', slim).then(() => null, (e) => e)
  assert.equal(e2.code, 'DROPPED_ANCHORS'); assert.equal(e2.extra.total, 1500); assert.equal(e2.extra.lost.length, 50)
  assert.match(readFileSync(lf.statePath('proj/big'), 'utf8'), /节 1499/, '拒写时文件不变')
  const drop = ['a1b2c', repo + '/f'] // 子串：两条覆盖 1500 处
  const w = await lf.persist(s2, 'big', slim, undefined, undefined, drop)
  assert.equal(w.verified, true)
  assert.equal(w.report.before, big.length); assert.ok(w.report.after < big.length)
  assert.equal(w.report.dropped, 1500); assert.ok(w.report.removedHeadings.includes('节 750') && w.report.removedHeadings.length === 30)
  assert.ok(w.report.sizeWarning, '仍超 40000 → 提示'); assert.ok(w.report.missingPaths.length > 0, 'f*.ts 不存在 → 提示核对')
  await assert.rejects(lf.persist(s2, 'big', slim, undefined, undefined, ['ab']), (e) => e.code === 'BAD_ARG', 'drop 太短')
  // 写后本会话视为已读全，可再写
  assert.equal((await lf.persist(s2, 'big', slim + '- x\n', undefined, undefined, drop)).verified, true)
  // 分段之间被改 → CHANGED
  const s3 = { id: 'c', cwd: repo }
  const a1 = await lf.recall(s3, 'big')
  if (!a1.complete) {
    await lf.persist(s2, 'big', slim, undefined, undefined, drop)
    await assert.rejects(lf.recall(s3, 'big', undefined, a1.next), (e) => e.code === 'CHANGED')
  }
  // 回忆：没读完不算完成
  lf.begin('m', 1, { want: 'recall', keys: ['proj/big'] })
  const m1 = await lf.recall({ id: 'm', cwd: repo }, 'big')
  assert.equal(lf.turnOf('m').done, m1.complete)
  let mr = m1; while (!mr.complete) mr = await lf.recall({ id: 'm', cwd: repo }, 'big', undefined, mr.next)
  assert.equal(lf.turnOf('m').done, true)
  lf.begin('m2', 1, { want: 'recall', keys: ['proj/big'] })
  lf.observe('m2', 'read', { file_path: lf.statePath('proj/big') })
  assert.equal(lf.turnOf('m2').done, false, 'read 不再算回忆完成')
})

test('Landfill 关闭时 fail loud（点名原因），工具调用报 LANDFILL_OFF', async () => {
  const d = tmp()
  const lf = new L.Landfill({ aiRoot: join(d, 'ai'), agentsHome: join(d, 'ag'), pkgDir: PKG, dataDir: d }, new StateCatalog(join(d, 'ai')), { repoPaths: () => [] }, true, 'win32')
  assert.equal(lf.status.ok, false)
  assert.match(lf.status.reason, /Windows/)
  assert.equal(existsSync(join(d, 'ai')), false, '关闭时不建任何东西')
  await assert.rejects(lf.validate(), (e) => e.code === 'LANDFILL_OFF')
})
