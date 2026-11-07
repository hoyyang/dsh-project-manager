/**
 * 0.25.1：模型可见的截断不得劈开代理对（半个 emoji）。
 * 事故：模型可见文本里出现孤立代理项 → JSON.stringify 出 \ud83d → 网关 400，
 * 且坏字符留在会话历史里让该会话之后每一轮都失败。这里逐个守住入口。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clip, hasLoneSurrogate, safeBoundary } from '../lib/text.js'
import * as L from '../lib/landfill.js'

test('clip: 上限落在 emoji 中间时少取一个，不劈代理对', () => {
  const s = 'a📍b' // 'a' + 高代理 + 低代理 + 'b'
  assert.equal(clip(s, 2), 'a', '不能带半个 emoji')
  assert.equal(clip(s, 3), 'a📍')
  assert.equal(clip(s, 99), s)
  assert.equal(clip(s, 0), '')
  assert.equal(hasLoneSurrogate(clip(s, 2)), false)
  for (let max = 0; max <= s.length + 1; max++) assert.equal(hasLoneSurrogate(clip(s, max)), false, 'max=' + max)
})

test('safeBoundary: 切点落在代理对中间时前移一格', () => {
  const s = 'a📍b'
  assert.equal(safeBoundary(s, 2), 1)
  assert.equal(safeBoundary(s, 3), 3)
  assert.equal(safeBoundary(s, 0), 0)
  assert.equal(safeBoundary(s, 99), s.length)
})

test('toc: 标题第 60 个字符正好是 emoji 时不能劈开', () => {
  const heading = '## ' + 'a'.repeat(59) + '📍 后面还有字'
  const entries = L.toc(heading + '\n\n正文')
  assert.equal(entries.length, 1)
  assert.equal(hasLoneSurrogate(entries[0].title), false, '标题出现了孤立代理项：' + JSON.stringify(entries[0].title))
  assert.ok(entries[0].title.endsWith('a'), '应少取那半个 emoji')
})

test('cutEnd: 窗口里没有换行可切时，切点也不能劈代理对', () => {
  // 无换行 + emoji 正好跨在 offset+max 处：旧实现直接返回 lim → 劈开
  const max = 10
  const text = 'a'.repeat(9) + '📍' + 'b'.repeat(10)
  assert.equal(hasLoneSurrogate(text.slice(0, 10)), true, '前提：朴素 slice 确实会劈开')
  const end = L.cutEnd(text, 0, max)
  assert.equal(hasLoneSurrogate(text.slice(0, end)), false, 'cutEnd 返回了会劈开的切点：' + end)
  assert.ok(end <= max && end > 0)
})

test('chunkStarts: 全部分段起点切出来的段都不含孤立代理项', () => {
  const text = ('x'.repeat(7) + '📍').repeat(40) // 每 9 个单元就有 emoji 跨边界
  const starts = L.chunkStarts(text, 13)
  for (let i = 0; i < starts.length; i++) {
    const seg = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length)
    assert.equal(hasLoneSurrogate(seg), false, '第 ' + i + ' 段被劈开了')
  }
})
