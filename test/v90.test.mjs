import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionDaysCache } from '../lib/sessiondays.js'

/** v90：会话「按天活跃」统计按会话版本缓存 —— 没新事件的会话不再重读日志。 */

const ev = (day) => ({ type: 'user/message', time: Date.parse(day + 'T10:00:00') })

function fakeQuery (log) {
  return {
    calls: [],
    async listEvents (id) {
      this.calls.push(id)
      const days = log[id] ?? []
      return days.map((d) => ev(d))
    },
  }
}

test('v90 · 会话版本没变 → 第 2、3 轮一条都不重读（listEvents = 0）', async () => {
  const q = fakeQuery({ a: ['2026-10-20'], b: ['2026-10-21'] })
  const cache = new SessionDaysCache(() => q)
  const ids = ['a', 'b']
  const ver = (id) => 'live:' + (id === 'a' ? 1 : 1)
  const r1 = await cache.collect(ids, ver)
  assert.deepEqual(r1.days.a, ['2026-10-20'])
  assert.equal(q.calls.length, 2)
  assert.equal(cache.stats().read, 2)
  assert.equal(cache.stats().cached, 0)
  const r2 = await cache.collect(ids, ver)
  assert.equal(q.calls.length, 2, '第 2 轮不该再读日志')
  assert.deepEqual(r2.days.b, ['2026-10-21'])
  assert.equal(cache.stats().read, 0)
  assert.equal(cache.stats().cached, 2)
  await cache.collect(ids, ver)
  assert.equal(q.calls.length, 2, '第 3 轮同样 0 次')
})

test('v90 · 版本变了才重读那一条（其余走缓存）', async () => {
  const log = { a: ['2026-10-20'], b: ['2026-10-21'] }
  const q = fakeQuery(log)
  const cache = new SessionDaysCache(() => q)
  let aVer = 'live:1'
  const ver = (id) => (id === 'a' ? aVer : 'live:1')
  await cache.collect(['a', 'b'], ver)
  assert.equal(q.calls.length, 2)
  log.a = ['2026-10-20', '2026-10-23']
  aVer = 'live:2'
  const r = await cache.collect(['a', 'b'], ver)
  assert.deepEqual(q.calls, ['a', 'b', 'a'], '只有 a 被重读')
  assert.deepEqual(r.days.a, ['2026-10-20', '2026-10-23'])
  assert.deepEqual(r.days.b, ['2026-10-21'])
})

test('v90 · 拿不到版本（undefined）→ 退回 TTL，不会漏数据', async () => {
  const q = fakeQuery({ a: ['2026-10-20'] })
  const cache = new SessionDaysCache(() => q, 0) // TTL = 0：每次都过期
  await cache.collect(['a'])
  await cache.collect(['a'])
  assert.equal(q.calls.length, 2)
})

test('v90 · peek 只读缓存：新鲜版本命中、版本变了就点名「正在统计」', async () => {
  const q = fakeQuery({ a: ['2026-10-20'] })
  const cache = new SessionDaysCache(() => q)
  let ver = 'live:1'
  const verOf = () => ver
  await cache.collect(['a'], verOf)
  assert.deepEqual(cache.peek(['a'], verOf).days.a, ['2026-10-20'])
  ver = 'live:2'
  const p = cache.peek(['a'], verOf)
  assert.deepEqual(p.days.a, [])
  assert.ok(p.degraded.some((x) => x.includes('正在统计')), JSON.stringify(p.degraded))
})

test('v90 · 没有会话查询服务时点名 degraded（不静默）', async () => {
  const cache = new SessionDaysCache(() => undefined)
  const r = await cache.collect(['a'])
  assert.deepEqual(r.days, {})
  assert.ok(r.degraded[0].includes('ctx.sessionQuery'), r.degraded[0])
})
