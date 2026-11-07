import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveTaskTitle, firstLine, isGoalMessage, showAddTaskButton } from '../lib/goaltext.js'

/** v92：以 /goal 开头的消息 → 添加卡片任务（文本规则单测）。 */

test('v92 · 只认以 /goal 开头的消息（全角 ／ 也算，前面空白无所谓）', () => {
  assert.equal(isGoalMessage('/goal 帮我看看'), true)
  assert.equal(isGoalMessage('   /goal 前面有空白'), true)
  assert.equal(isGoalMessage('／goal 全角斜杠'), true)
  assert.equal(isGoalMessage('/GOAL 大写'), true)
  assert.equal(isGoalMessage('看下 /goal 这条'), false)
  assert.equal(isGoalMessage('/goalkeeper'), false)
  assert.equal(isGoalMessage('/goal'), true)
  assert.equal(isGoalMessage(''), false)
  assert.equal(isGoalMessage('普通消息'), false)
})

test('v92/v94 · 按钮在「任意非空用户消息 + 有卡片 + 已发送」时出现（v94 去掉 /goal 限制）', () => {
  assert.equal(showAddTaskButton({ hasCard: true, text: '/goal 干活' }), true)
  assert.equal(showAddTaskButton({ hasCard: true, text: '普通消息' }), true)
  assert.equal(showAddTaskButton({ hasCard: true, text: '   ' }), false, '空白消息不算')
  assert.equal(showAddTaskButton({ hasCard: false, text: '普通消息' }), false)
  assert.equal(showAddTaskButton({ hasCard: true, text: '/goal 干活', pending: true }), false)
})

test('v92 · 任务标题默认取第一行、去掉开头的 /goal', () => {
  assert.equal(deriveTaskTitle('/goal 说半天不如举个例子\n第二行'), '说半天不如举个例子')
  assert.equal(deriveTaskTitle('／goal：全角加冒号'), '全角加冒号')
  assert.equal(deriveTaskTitle('/goal'), '/goal')
  assert.equal(deriveTaskTitle(''), '未命名任务')
  assert.equal(deriveTaskTitle('/goal ' + 'x'.repeat(200)).length, 120)
  assert.equal(firstLine('\n\n  第二段  \n第三'), '第二段')
})
