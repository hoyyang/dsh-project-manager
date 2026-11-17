/* v176：自动执行日不再「空 ↔ 有」来回跳（活跃会话版本每轮都变 → peek miss → 整页每 5s 重画） */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SessionDaysCache } from '../lib/sessiondays.js'

const mk = () => new SessionDaysCache(() => ({ listEvents: async () => [] }))
const seed = (c, id, days, ver) => c.map.set(id, { days, at: Date.now(), ver })

test('v176 peek：版本没变 = 命中缓存，不算在统计', () => {
  const c = mk()
  seed(c, 's1', ['2026-11-14'], 'v1')
  const r = c.peek(['s1'], () => 'v1')
  assert.deepEqual(r.days.s1, ['2026-11-14'])
  assert.ok(!r.degraded.some((x) => x.includes('正在统计')), JSON.stringify(r.degraded))
})

test('v176 peek：版本变了也先把上次的天数顶上（活跃会话每轮版本都变）', () => {
  const c = mk()
  seed(c, 's1', ['2026-11-14'], 'v1')
  const r = c.peek(['s1'], () => 'v2')
  assert.deepEqual(r.days.s1, ['2026-11-14'], '旧天数必须还在 —— 否则甘特实际条一隐一现')
  assert.ok(r.degraded.some((x) => x.includes('正在统计')), '仍要如实说正在统计')
})

test('v176 peek：从没算过的会话才是空', () => {
  const c = mk()
  const r = c.peek(['never'], () => 'v1')
  assert.deepEqual(r.days.never, [])
})

test('v176 源码里 stale 兜底还在（构建产物同步校验）', () => {
  const src = readFileSync(new URL('../src/sessiondays.ts', import.meta.url), 'utf8')
  assert.match(src, /out\[id\] = hit\?\.days \?\? \[\]/)
})
