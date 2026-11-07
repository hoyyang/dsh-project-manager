import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleWithRetry } from '../lib/goaltext.js'

test('v120 生成标题：一次成功 → 不重试，用 400 / low', async () => {
  const calls = []
  const r = await titleWithRetry(async (n, e) => { calls.push([n, e]); return { ok: true, title: 'T' } })
  assert.deepEqual(calls, [[400, 'low']]); assert.equal(r.retried, false); assert.equal(r.title, 'T')
})
test('v120 生成标题：空响应 → 自动重试一次（1600 / off），成功就接上', async () => {
  const calls = []
  const r = await titleWithRetry(async (n, e) => { calls.push([n, e]); return calls.length === 1 ? { ok: false, code: 'EMPTY_TITLE', message: '空' } : { ok: true, title: '第二次' } })
  assert.deepEqual(calls, [[400, 'low'], [1600, 'off']]); assert.equal(r.retried, true); assert.equal(r.title, '第二次')
})
test('v120 生成标题：空响应重试后仍空 → 只重试一次就报错', async () => {
  let n = 0
  const r = await titleWithRetry(async () => { n++; return { ok: false, code: 'EMPTY_TITLE', message: '空' } })
  assert.equal(n, 2); assert.equal(r.ok, false); assert.equal(r.retried, true)
})
test('v120 生成标题：provider 报错（非空响应）→ 不重试，原样透出 code / message', async () => {
  let n = 0
  const r = await titleWithRetry(async () => { n++; return { ok: false, code: 'KIRO_RUNTIME_CLOSED', message: 'Runtime 未开放' } })
  assert.equal(n, 1); assert.equal(r.code, 'KIRO_RUNTIME_CLOSED'); assert.equal(r.message, 'Runtime 未开放')
})
