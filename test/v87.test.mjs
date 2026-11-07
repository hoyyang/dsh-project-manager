import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import * as Mem from '../lib/memory.js'

const mk = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, '组')
  const c = M.addCard(b, g.id, '卡')
  return { b, c }
}

test('v87 · setNoteItems 保留 off=true，丢掉 off=false', () => {
  const { b, c } = mk()
  M.setNoteItems(b, c.id, [{ t: '目标', v: 'A', off: true }, { t: '验收', v: 'B', off: false }])
  assert.deepEqual(b.cards[0].noteItems, [{ t: '目标', v: 'A', off: true }, { t: '验收', v: 'B' }])
})

test('v87 · notesText 只列开启的说明', () => {
  const { b, c } = mk()
  M.setNoteItems(b, c.id, [{ t: '目标', v: '不该出现', off: true }, { t: '验收', v: '该出现' }])
  const t = Mem.notesText(b.cards[0])
  assert.ok(t.includes('验收') && !t.includes('目标') && !t.includes('不该出现'), t)
})

test('v87 · cardSection（系统提示 / STATE）只列开启的说明，条数只算开启', () => {
  const { b, c } = mk()
  M.setNoteItems(b, c.id, [{ t: '目标', v: '不该出现', off: true }, { t: '验收', v: '该出现' }])
  const sec = Mem.cardSection(b, b.cards[0])
  assert.ok(sec.includes('验收') && !sec.includes('不该出现') && !sec.includes('目标'), sec)
  assert.ok(sec.includes('共 1 条'), sec)
})
