/* v163 / S3：项目卡挂载知识卡（Card.kb + setCardKb + kbMode + routes card/kb） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as M from '../lib/model.js'

const seed = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'kb-group')
  const c = M.addCard(b, g.id, '挂载卡片')
  return { b, g, c }
}

test('S3 去重保序，首见优先（字符串与 {id,mode} 混用）', () => {
  const { b, c } = seed()
  M.setCardKb(b, c.id, ['kabc11', { id: 'kdef22', mode: 'off' }, { id: 'kabc11', mode: 'full' }, 'kghi33'])
  assert.deepEqual(c.kb, [{ id: 'kabc11' }, { id: 'kdef22', mode: 'off' }, { id: 'kghi33' }])
})

test('S3 非法 id / 非法 mode / 非数组 / 超 50 张拒绝且不落盘', () => {
  const { b, c } = seed()
  const bad = (fn) => assert.throws(fn, (e) => e.code === 'BAD_ARG')
  bad(() => M.setCardKb(b, c.id, ['c12345']))
  bad(() => M.setCardKb(b, c.id, ['KABC12']))
  bad(() => M.setCardKb(b, c.id, ['kx']))
  bad(() => M.setCardKb(b, c.id, [{ id: 'kabc11', mode: 'all' }]))
  bad(() => M.setCardKb(b, c.id, 'kabc11'))
  bad(() => M.setCardKb(b, c.id, Array.from({ length: 51 }, () => 'kabc11')))
  assert.equal(c.kb, undefined)
})

test('S3 归档卡拒绝挂载（CARD_ARCHIVED）', () => {
  const { b, c } = seed()
  M.archiveCard(b, c.id)
  assert.throws(() => M.setCardKb(b, c.id, ['kabc11']), /CARD_ARCHIVED|已归档/)
})

test('S3 空数组 = 删字段（JSON 里不再出现 kb）', () => {
  const { b, c } = seed()
  M.setCardKb(b, c.id, ['kabc11', 'kdef22'])
  assert.equal(c.kb?.length, 2)
  M.setCardKb(b, c.id, [])
  assert.equal('kb' in c, false)
  assert.equal(JSON.stringify(c).includes('"kb"'), false)
})

test('S3 kbMode：六类型默认 + 显式覆盖 + 非法值回落默认', () => {
  assert.equal(M.kbMode('prompt'), 'full')
  assert.equal(M.kbMode('howto'), 'full')
  assert.equal(M.kbMode('snippet'), 'full')
  assert.equal(M.kbMode('domain'), 'sum')
  assert.equal(M.kbMode('business'), 'sum')
  assert.equal(M.kbMode('moc'), 'sum')
  assert.equal(M.kbMode('prompt', 'off'), 'off')
  assert.equal(M.kbMode('domain', 'full'), 'full')
  assert.equal(M.kbMode('domain', 'sum'), 'sum')
  assert.equal(M.kbMode('domain', 'garbage'), 'sum')
  assert.equal(M.kbMode('whatever'), 'sum')
})

test('S3 老数据（无 kb 字段）读写不变：别的 mutation 不引入 kb，JSON 往返保 kb', () => {
  const { b, g, c } = seed()
  const other = M.addCard(b, g.id, '另一张')
  M.setRelated(b, c.id, [other.id])
  M.setCardKb(b, c.id, [{ id: 'kabc11', mode: 'sum' }])
  const round = JSON.parse(JSON.stringify(b))
  const rc = round.cards.find((x) => x.id === c.id)
  assert.deepEqual(rc.kb, [{ id: 'kabc11', mode: 'sum' }])
  assert.equal('kb' in round.cards.find((x) => x.id === other.id), false)
})

test('S3 复制卡片：related 照旧复制，kb 不跟拷', () => {
  const { b, g, c } = seed()
  const other = M.addCard(b, g.id, '被关联')
  M.setRelated(b, c.id, [other.id])
  M.setCardKb(b, c.id, ['kabc11'])
  const cp = M.copyCard(b, c.id)
  assert.deepEqual(cp.related, [other.id])
  assert.equal('kb' in cp, false)
})

test('S3 源码锁：model 导出 kbMode / setCardKb（引 KB_ID_RX）、routes 注册 card/kb（payload x.kb）', () => {
  const m = readFileSync(new URL('../src/model.ts', import.meta.url), 'utf8')
  assert.match(m, /export function kbMode/)
  assert.match(m, /export function setCardKb/)
  assert.match(m, /import \{ KB_ID_RX \} from '\.\/kb\.js'/)
  const r = readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8')
  assert.match(r, /'card\/kb': \(x, b\) => M\.setCardKb\(b, str\(x\.id, 'id'\), x\.kb\)/)
})
