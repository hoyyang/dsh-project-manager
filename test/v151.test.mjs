/* v151：会话只属于一张卡片 / 相关文件记住以前的路径 / 会话引用带 id */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import { relinkFiles } from '../lib/migrate.js'
import { sessionText } from '../lib/quote.js'

const board = () => ({ version: 1, groups: [{ id: 'g', name: 'G', statuses: [{ id: 's', name: 'S' }], links: [] }], cards: [
  { id: 'a', g: 'g', col: 's', order: 0, t: 'A', links: [], tasks: [{ id: 'a1', text: 'A1', done: false, subs: [{ id: 'a1s', text: 'A1s', done: false }] }], files: [{ id: 'f1', path: '/x/old.png' }] },
  { id: 'b', g: 'g', col: 's', order: 1, t: 'B', links: [], tasks: [{ id: 'b1', text: 'B1', done: false }] }], sessions: [] })

test('任务关联会话 = 会话关联到任务所在卡片；别的卡片关联 = 挪过去并解除原卡片任务', () => {
  const b = board()
  M.setTaskSession(b, 'a', 'a1s', 'session-1')
  assert.equal(b.sessions.find((s) => s.sessionId === 'session-1').cardId, 'a')
  M.setTaskSession(b, 'a', 'a1', 'session-1')
  M.setTaskSession(b, 'b', 'b1', 'session-1')
  assert.equal(b.sessions.filter((s) => s.sessionId === 'session-1').length, 1)
  assert.equal(b.sessions[0].cardId, 'b')
  assert.equal(b.cards[0].tasks[0].sess, undefined)
  assert.equal(b.cards[0].tasks[0].subs[0].sess, undefined)
  assert.equal(b.cards[1].tasks[0].sess, 'session-1')
})
test('解除会话关联 = 任务也解除', () => {
  const b = board()
  M.setTaskSession(b, 'a', 'a1', 'session-2')
  M.unbindSession(b, 'session-2')
  assert.equal(b.cards[0].tasks[0].sess, undefined)
})
test('改路径记住以前的路径（去重、改回去时拿掉）', () => {
  const b = board()
  M.setFilePath(b, 'a', 'f1', '/y/new.png')
  assert.deepEqual(b.cards[0].files[0].prev, ['/x/old.png'])
  M.setFilePath(b, 'a', 'f1', '/x/old.png')
  assert.deepEqual(b.cards[0].files[0].prev, ['/y/new.png'])
  const cb = { version: 1, groups: [], cards: [{ id: 'c', g: 'g', col: 's', order: 0, t: 'C', links: [], tasks: [], files: [{ id: 'f', path: '/r/p/evidence/a.png' }] }], sessions: [] }
  relinkFiles(cb, '/r/p', '/r/q')
  assert.equal(cb.cards[0].files[0].path, '/r/q/evidence/a.png')
  assert.deepEqual(cb.cards[0].files[0].prev, ['/r/p/evidence/a.png'])
})
test('会话引用带 session id', () => {
  assert.equal(sessionText('N', 'G', 'C', 'session-x'), '「“N”会话（“G”卡片组-“C”卡片 · 会话 id：session-x）」')
  assert.equal(sessionText('N', undefined, undefined, 'session-x'), '「“N”会话（会话 id：session-x）」')
  assert.equal(sessionText('N', 'G'), '「“N”会话（“G”卡片组）」')
})
