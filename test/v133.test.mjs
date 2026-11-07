import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanTitle } from '../lib/goaltext.js'
import * as G from '../lib/gantt.js'
import * as M from '../lib/model.js'

const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')

// v133（2.3）：生成标题偶发「标题：…」前缀（主实例 5 次采样 1 次）
test('v133 2.3: cleanTitle strips title prefixes, markdown and quotes (up to 3 layers)', () => {
  assert.equal(cleanTitle('标题：修复切面板卡顿'), '修复切面板卡顿')
  assert.equal(cleanTitle('任务标题: 修复切面板卡顿'), '修复切面板卡顿')
  assert.equal(cleanTitle('Title: Fix lag'), 'Fix lag')
  assert.equal(cleanTitle('**标题：**「修复卡顿」'), '修复卡顿')
  assert.equal(cleanTitle('# 标题：《修复卡顿》'), '修复卡顿')
  assert.equal(cleanTitle('"修复  卡顿"'), '修复 卡顿')
  assert.equal(cleanTitle('标题党要不得'), '标题党要不得')
  assert.equal(cleanTitle('x'.repeat(200)).length, 120)
})
test('v133 2.3: host goalTitle uses the same cleanTitle', () => {
  assert.match(src('index.ts'), /const title = cleanTitle\(out\)/)
  assert.match(src('client/goaltask.ts'), /cleanTitle\(r\.title\)/)
})

// v133 R1：降级原因各轮顺序 / 内容会抖，不能让快照 rev 每 5s 都变
test('v133 R1: rev ignores degraded; degraded sorted + deduped', () => {
  const b = M.emptyBoard(); const g = M.addGroup(b, '组A'); M.addCard(b, g.id, '卡A', [], g.statuses[0].id)
  const now = Date.parse('2026-10-31T10:00:00')
  const a = G.payload(b, { cards: {} }, {}, ['b：超时', 'a：not found', 'b：超时'], [], now)
  const c = G.payload(b, { cards: {} }, {}, ['a：not found'], [], now)
  assert.deepEqual(a.degraded, ['a：not found', 'b：超时'])
  assert.equal(G.revOf(a), G.revOf(c))
  const d = G.payload(b, { cards: {} }, { [b.cards[0].id]: ['2026-10-30'] }, [], [], now)
  assert.notEqual(G.revOf(a), G.revOf(d))
})

// v133 R2–R4 / ⑤：重画合并、去人为等待、切面板只拉一次、轮询合并
test('v133 R2-R4: render coalescing, no 380/420ms waits, single /gantt load on switch, shared poll', () => {
  const gantt = src('client/gantt.ts'), board = src('client/board.ts'), api = src('client/api.ts')
  assert.match(gantt, /function renderSoon\(\)/)
  assert.match(gantt, /function openCardTasksOf[\s\S]{0,120}rDefer = true[\s\S]{0,60}renderSoon\(\)/)
  // 点执行卡：甘特重画推迟到上屏之后、RO 同宽不补画、ringEl 不强制样式重算、liveGroupIds 只取一次会话
  assert.match(gantt, /if \(w === self\.roW && !self\.roDirty\) return/)
  assert.doesNotMatch(src('client/gtextra.ts'), /getComputedStyle\(el\)\.position/)
  assert.match(board, /liveGroupIds\(\): string\[\] \{ const all = this\.host\.allSessions\(\)/)
  assert.doesNotMatch(gantt, /paintCur\(\); setTimeout\(paintCur, 1880\) \}, 420\)/)
  assert.doesNotMatch(board, /\}, 380\)\n  \}\n  private ringTarget/)
  assert.doesNotMatch(board, /this\.schedView\?\.reload\(\)\n    \}\n    this\.ensureCdHandle/)
  assert.match(board, /private syncLaneNav\(\): void \{\n[^\n]*\n    if \(this\.mode === 'sched'\) return/)
  assert.match(api, /export function poll\(/)
  for (const f of ['client/board.ts', 'client/dock.ts', 'client/index.ts', 'client/gantt.ts']) assert.doesNotMatch(src(f), /setInterval\([^\n]*(refresh|load)\(/, f)
})

test('v133 2.2/3/4: meta three rows, no carry chip, subtask css', () => {
  const gt = src('client/goaltask.ts'), css = src('client/style.css'), gantt = src('client/gantt.ts')
  assert.match(gt, /<span id="dpmGtSt"><\/span><i class="gt-br"/)
  assert.match(gt, /function fitMeta\(\)/)
  assert.doesNotMatch(gantt, /id="exCarryChip"/)
  assert.match(css, /\.gt-meta\.two > \.gt-br \{ display: block; flex: 0 0 100%/)
  assert.match(css, /\.task\.child > \.tkhead, :is\(\.dpm \.detail, \.dpm-global-detail\) \.tilebody \.task > \.tkhead \{ z-index: auto !important; \}/)
  assert.match(css, /\.v10q:focus-within \{[^}]*box-shadow: none/)
})
