import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectIntent, detectMemoryRequests } from '../lib/landfill.js'
import { parseState } from '../lib/states.js'
import { apply } from '../lib/index.js'
import * as M from '../lib/model.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const aliases = parseState('aliases: dsh-desktop · dsh 桌面版 · DSH Desktop 升级与插件兼容 · 看板卡片「dsh 插件建设 / dsh 升级&插件兼容」').aliases
const states = [
  { key: 'other/dsh-desktop', slug: 'dsh-desktop', aliases },
  { key: 'local/dsh-project-manager-build', slug: 'dsh-project-manager-build' },
  { key: 'old/desktop-legacy', slug: 'desktop-legacy', aliases: ['Desktop'] },
]
const msg = (text, source = { kind: 'user' }, role = 'user') => ({ role, source, content: [{ type: 'text', text }] })
const report = '🎨 dsh-html-dev 自动验证 — /tmp/u/Desktop/DSH/dsh-project-manager/prototype/page.html\nStatus: load_error\n下一步: 全绿 → 继续九步协议 Step 8'

test('multiword aliases stay whole, including comma/semicolon formats', () => {
  assert.ok(aliases.includes('DSH Desktop 升级与插件兼容'))
  assert.ok(aliases.includes('dsh 桌面版'))
  assert.ok(!aliases.includes('Desktop'))
  assert.deepEqual(parseState('aliases: alpha-one, DSH Desktop; beta-two').aliases, ['alpha-one', 'DSH Desktop', 'beta-two'])
  assert.deepEqual(parseState('aliases: old-one old-two').aliases, ['old-one', 'old-two'])
  assert.deepEqual(parseState('aliases: `DSH Desktop`').aliases, ['DSH Desktop'])
  assert.deepEqual(parseState('aliases: `old-one` `old-two`').aliases, ['old-one', 'old-two'])
  assert.deepEqual(parseState('aliases: `DSH Desktop` old-one `old-two`').aliases, ['DSH Desktop', 'old-one', 'old-two'])
  // 斜杠列别名（旧文件常见写法）要拆干净，不能留下裸 / 与残缺引号。
  assert.deepEqual(parseState('别名: 「dsh-image-gen 建设」/ dsh-image-gen-jianshe / dsh-image-gen').aliases, ['dsh-image-gen 建设', 'dsh-image-gen-jianshe', 'dsh-image-gen'])
  // 引号里的空格不断开（旧空格列表格式）；带 · 分隔时整段原样保留。
  assert.deepEqual(parseState('aliases: 看板卡片「dsh 插件建设 / dsh 升级&插件兼容」').aliases, ['看板卡片', 'dsh 插件建设 / dsh 升级&插件兼容'])
  assert.deepEqual(parseState('aliases: a-one · 看板卡片「dsh 插件建设 / dsh 升级&插件兼容」').aliases, ['a-one', '看板卡片「dsh 插件建设 / dsh 升级&插件兼容」'])
})

test('reports, unrelated targets, paths, code and quoted prose are not instructions', () => {
  for (const text of [report, report.replace('继续', '回忆'), report.replace('继续', '落盘项目'),
    '回忆一下昨天的流程，文件是 dsh-desktop', '继续九步协议，dsh-desktop 在路径里',
    '我昨天回忆 dsh-desktop 时出错了', '不必回忆 dsh-desktop',
    '回忆 /tmp/u/Desktop/dsh-desktop/STATE.md', '回忆 ./dsh-desktop/STATE.md',
    '回忆 https://example.com/dsh-desktop', '回忆 dsh-desktop-extra',
    '回忆 dsh-desktop/STATE.md', '回忆\ndsh-desktop',
    '> 回忆 dsh-desktop', '```text\n回忆 dsh-desktop\n```', '~~~\n落盘项目 dsh-desktop\n~~~',
    '```\n回忆 dsh-desktop', '“回忆 dsh-desktop”', '「落盘项目 dsh-desktop」',
    '`回忆 dsh-desktop`', '回忆 `other/dsh-desktop`', '[回忆 dsh-desktop](https://example.com)',
    '落盘项目的记录是 AI 写的', '我们上次回忆 dsh-desktop 时发现了问题',
    '## 落盘项目（/landfill-project）\n- 用户说「落盘项目 XX」= 写进 XX 的 STATE；「回忆 XX」/「继续 XX」= 先读 STATE\n落盘项目按卡片组归档（~/.ai/projects/）']) assert.equal(detectIntent(text, states), null, text)
})

test('explicit cross-project targets, whole aliases and target lists still work', () => {
  for (const text of ['回忆 dsh-desktop', '继续 dsh-desktop', '请先回忆 other/dsh-desktop', '回忆 DSH Desktop 升级与插件兼容', '回忆 dsh 桌面版',
    '回忆一下 dsh-desktop', '回忆下 dsh-desktop', '继续做 dsh-desktop', '继续推进 dsh-desktop',
    '那继续 dsh-desktop', '然后回忆 dsh-desktop', '现在继续 dsh-desktop', '好的继续 dsh-desktop', '麻烦帮我回忆一下 dsh-desktop']) {
    assert.deepEqual(detectIntent(text, states), { want: 'recall', keys: ['other/dsh-desktop'] }, text)
  }
  assert.deepEqual(detectIntent('回忆 dsh-desktop、dsh-project-manager-build', states), { want: 'recall', keys: ['other/dsh-desktop', 'local/dsh-project-manager-build'] })
  assert.deepEqual(detectIntent('落盘项目 dsh-desktop', states), { want: 'persist', keys: ['other/dsh-desktop'] })
  assert.deepEqual(detectIntent('落盘项目 当前项目', states), { want: 'persist', keys: [] })
  assert.deepEqual(detectIntent('dsh-desktop 在路径里。落盘项目', states), { want: 'persist', keys: [] })
  assert.deepEqual(detectIntent('回忆 dsh-project-manager-build；路径 /tmp/u/Desktop/DSH/', states), { want: 'recall', keys: ['local/dsh-project-manager-build'] })
})

test('ambiguous names list every candidate instead of guessing or dropping the request', () => {
  const shared = [{ key: 'alpha/shared-slug', slug: 'shared-slug', aliases: ['Old Name'] }, { key: 'beta/shared-slug', slug: 'shared-slug', aliases: ['Old Name'] }]
  for (const target of ['shared-slug', 'Old Name']) {
    assert.deepEqual(detectIntent('回忆 ' + target, shared), { want: 'recall', keys: ['alpha/shared-slug', 'beta/shared-slug'] })
    assert.deepEqual(detectIntent('落盘项目 ' + target, shared), { want: 'persist', keys: ['alpha/shared-slug', 'beta/shared-slug'] })
  }
  assert.deepEqual(detectIntent('回忆 beta/shared-slug', shared), { want: 'recall', keys: ['beta/shared-slug'] })
  // 同名目标不能连累同一条消息里的合法目标。
  assert.deepEqual(detectIntent('回忆 other/dsh-desktop、shared-slug', [states[0], ...shared]),
    { want: 'recall', keys: ['other/dsh-desktop', 'alpha/shared-slug', 'beta/shared-slug'] })
})

test('shared ingress does not combine messages or trust plugin/tool/assistant sources', () => {
  assert.deepEqual(detectMemoryRequests([msg('回忆'), msg('dsh-desktop')], states), { intent: null, merges: [] })
  assert.deepEqual(detectMemoryRequests([msg(report), msg('继续九步协议')], states), { intent: null, merges: [] })
  for (const source of [{ kind: 'plugin:dsh-html-dev' }, { kind: 'plugin', plugin: 'dsh-html-dev' }, { kind: 'tool' }]) {
    assert.deepEqual(detectMemoryRequests([msg('回忆 dsh-desktop', source)], states), { intent: null, merges: [] })
  }
  assert.equal(detectMemoryRequests([msg('回忆 dsh-desktop', { kind: 'user' }, 'assistant')], states).intent, null)
  assert.deepEqual(detectMemoryRequests([msg(report), msg('回忆 dsh-desktop')], states).intent, { want: 'recall', keys: ['other/dsh-desktop'] })
  assert.equal(detectMemoryRequests([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '回忆' }, { type: 'text', text: 'dsh-desktop' }] }], states).intent, null)
})

test('merge uses the same source boundary; explicit command translations remain user actions', () => {
  const merge = '合并落盘项目（dsh-project-manager 合并 mgabc123）\n回忆 dsh-desktop'
  assert.deepEqual(detectMemoryRequests([msg(merge)], states), { intent: null, merges: ['mgabc123'] })
  assert.deepEqual(detectMemoryRequests([msg(merge, { kind: 'plugin:dsh-html-dev' })], states), { intent: null, merges: [] })
  assert.deepEqual(detectMemoryRequests([msg(merge.split('\n').map((line) => '> ' + line).join('\n'))], states), { intent: null, merges: [] })
  assert.equal(detectMemoryRequests([msg('回忆 dsh-desktop')], states).intent.want, 'recall')
  assert.equal(detectMemoryRequests([msg('落盘项目 dsh-desktop')], states).intent.want, 'persist')
})

test('apply ingress: real Landfill hooks and slash commands stay within fixture memory', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dpm-ingress-')))
  const oldHome = process.env.DSH_HOME
  const disposers = []
  const hooks = new Map(), commands = new Map(), tools = new Map(), warnings = []
  const aiRoot = join(root, 'ai'), dataDir = join(root, 'data')
  const stateFile = (key) => join(aiRoot, 'projects', key.split('/')[0], 'memory', 'designs', key.split('/')[1], 'STATE.md')
  try {
    process.env.DSH_HOME = join(root, 'dsh')
    for (const key of ['local/card-memory', 'other/dsh-desktop', 'alpha/shared-slug', 'beta/shared-slug']) {
      const path = stateFile(key)
      mkdirSync(join(path, '..', 'notes'), { recursive: true })
      writeFileSync(path, '# 落盘项目 STATE: ' + key + '\naliases: ' + (key === 'other/dsh-desktop' ? aliases.join(' · ') : key.split('/')[1]) + '\n## 📁 文件索引\n- [必读] notes/required.md · fixture\n')
      writeFileSync(join(path, '..', 'notes/required.md'), 'required fixture ' + key)
    }
    const board = M.emptyBoard(), group = M.addGroup(board, 'Fixture')
    const card = M.addCard(board, group.id, 'Fixture card', ['local/card-memory'])
    M.bindSession(board, 'bound', card.id)
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'board.json'), JSON.stringify(board))
    let plan = false
    // Only host registration/services are adapted; apply and Landfill are not mocked.
    const ctx = {
      on: (name, handler) => hooks.set(name, handler),
      effect: (fn) => disposers.push(fn()),
      inject: (deps, fn) => { if (deps[0] === 'commands' || deps[0] === 'tools') disposers.push(fn(ctx)) },
      commands: { register: (c) => { commands.set(c.name, c); return () => commands.delete(c.name) } },
      tools: { register: (t) => tools.set(t.name, t) },
      workspaceRegistry: { list: () => [] },
      get: (name) => name === 'planMode' ? { get: () => ({ active: plan }) } : undefined,
      logger: () => ({ info() {}, warn: (...args) => warnings.push(args) }),
    }
    apply(ctx, { dataDir, aiRoot, agentsHome: join(root, 'agents'), landfill: true, hubTitle: 'Fixture', memoryMaxBytes: 6000, kbIndexMaxBytes: 4000, kbFullMaxBytes: 12000, projectSessionMode: 'inherit' })
    assert.ok(hooks.has('agent/pre-step') && hooks.has('agent/turn-stopping') && tools.has('landfill'))
    const agent = (id) => ({ session: { id, header: {} }, steered: [], steer(m) { this.steered.push(m) } })
    const pre = (a, messages, turn = 1, decision = { kind: 'continue', messages: [] }) => hooks.get('agent/pre-step')({ agent: a, messages, turn }, async () => decision)
    const stop = (a) => hooks.get('agent/turn-stopping')({ agent: a })
    const text = (messages) => messages.flatMap((m) => m.content.map((b) => b.text)).join('\n')
    const negatives = [
      [msg(report), msg('继续九步协议')], [msg('回忆'), msg('dsh-desktop')],
      [msg('回忆 dsh-desktop', { kind: 'plugin:dsh-html-dev' })],
      [msg('落盘项目 dsh-desktop', { kind: 'tool' })], [msg('回忆 dsh-desktop', { kind: 'user' }, 'assistant')],
      [msg('> 回忆 dsh-desktop')], [msg('```\n落盘项目 dsh-desktop\n```')],
      [msg('回忆 /tmp/u/Desktop/dsh-desktop/STATE.md')],
    ]
    for (const [i, messages] of negatives.entries()) {
      const a = agent('negative-' + i)
      assert.deepEqual((await pre(a, messages)).messages, [], text(messages))
      stop(a); assert.deepEqual(a.steered, [], text(messages))
    }
    const bound = agent('bound')
    const injected = (await pre(bound, [msg(report)])).messages
    assert.deepEqual(injected.map((m) => m.source.form), ['landfill-autoread'])
    assert.match(text(injected), /key="local\/card-memory"/)
    assert.match(text(injected), /required fixture local\/card-memory/)
    assert.doesNotMatch(text(injected), /other\/dsh-desktop/)
    stop(bound); assert.deepEqual(bound.steered, [])
    assert.deepEqual((await pre(bound, [msg(report)], 2)).messages, [])
    writeFileSync(join(stateFile('local/card-memory'), '..', 'notes/required.md'), 'updated required fixture content')
    assert.match(text((await pre(bound, [msg(report)], 3)).messages), /replaces=.*updated required fixture content/s)
    const cross = agent('cross')
    const translated = commands.get('recall').handler({ rawInput: ' DSH Desktop 升级与插件兼容 ', agent: cross })
    assert.deepEqual(translated, { kind: 'success', text: '回忆 DSH Desktop 升级与插件兼容' })
    assert.deepEqual(cross.steered[0].source, { kind: 'user' })
    const request = cross.steered.pop()
    assert.match(text((await pre(cross, [msg(report), request])).messages), /other\/dsh-desktop/)
    stop(cross); stop(cross); stop(cross)
    assert.equal(cross.steered.length, 2, 'real nudge caps unfinished recall at two pulls')
    assert.ok(cross.steered.every((m) => m.source.form === 'landfill-stop' && text([m]).includes('other/dsh-desktop')))
    const completed = agent('completed')
    await pre(completed, [request])
    const recalled = await tools.get('landfill').execute({ op: 'recall', slug: 'other/dsh-desktop' }, { agent: completed })
    assert.equal(recalled.ok, true, JSON.stringify(recalled))
    const required = await tools.get('landfill').execute({ op: 'recall', slug: 'other/dsh-desktop', file: 'notes/required.md' }, { agent: completed })
    assert.equal(required.ok, true, JSON.stringify(required))
    stop(completed); assert.deepEqual(completed.steered, [])
    const persist = agent('persist')
    assert.equal(commands.get('landfill').handler({ rawInput: 'other/dsh-desktop', agent: persist }).text, '落盘项目 other/dsh-desktop')
    assert.deepEqual(persist.steered[0].source, { kind: 'user' })
    assert.match(text((await pre(persist, [persist.steered.pop()])).messages), /other\/dsh-desktop/)
    stop(persist); assert.equal(persist.steered[0].source.form, 'landfill-stop')
    assert.equal(commands.get('recall').handler({ rawInput: '', agent: bound }).text, '回忆 local/card-memory')
    assert.equal(commands.get('recall').handler({ rawInput: '', agent: agent('unbound') }).kind, 'error')
    assert.equal(commands.get('landfill').handler({ rawInput: '', agent: agent('unbound') }).text, '落盘项目 当前项目')
    assert.equal(commands.get('recall').handler({ rawInput: 'dsh-desktop' }).kind, 'error')
    plan = true
    const planned = agent('planned')
    assert.match(text((await pre(planned, [msg('落盘项目 other/dsh-desktop')])).messages), /规划模式/)
    stop(planned); assert.deepEqual(planned.steered, [])
    const rejected = agent('rejected'), decision = { kind: 'reject', messages: [] }
    assert.equal(await pre(rejected, [msg('回忆 dsh-desktop')], 1, decision), decision)
    stop(rejected); assert.deepEqual(rejected.steered, [])
    assert.deepEqual(warnings, [])
    assert.match(readFileSync(join(dataDir, 'landfill-known.json'), 'utf8'), /local/)
  } finally {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose()
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    rmSync(root, { recursive: true, force: true })
  }
})
