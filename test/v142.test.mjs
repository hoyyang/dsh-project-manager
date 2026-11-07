import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../lib/model.js'
import { findSameName } from '../lib/routes.js'

const seed = () => {
  const b = M.emptyBoard()
  const g = M.addGroup(b, 'grp')
  const a = M.addCard(b, g.id, 'A')
  M.addLinkType(b, 'GitHub'); M.addLinkType(b, '文档')
  return { b, g, a }
}
test('v140/v141 类型网址：只留 origin、多个网址、同一网址只属于一个类型、改名 / 删除随类型走', () => {
  const { b } = seed()
  assert.equal(M.normDomain('https://www.baidu.com/login?x=1'), 'https://www.baidu.com/')
  assert.equal(M.normDomain('example.org/docx/1'), 'https://example.org/')
  assert.equal(M.normDomain(''), '')
  for (const bad of ['not a url', 'localhostx', 'ftp://a.com']) assert.throws(() => M.normDomain(bad))
  M.addTypeDomain(b, '文档', 'docs.example.com'); M.addTypeDomain(b, '文档', 'https://wiki.example.org/abc')
  assert.deepEqual(b.linkTypeDomains['文档'], ['https://docs.example.com/', 'https://wiki.example.org/'])
  assert.throws(() => M.addTypeDomain(b, 'GitHub', 'https://docs.example.com/x'), /已经属于「文档」/)
  assert.throws(() => M.addTypeDomain(b, '文档', 'docs.example.com'), /已经有/)
  M.addTypeDomain(b, 'GitHub', 'github.com')
  assert.deepEqual(M.typeForUrl(b, 'https://gist.github.com/a'), { type: 'GitHub', domain: 'https://github.com/' })
  assert.equal(M.typeForUrl(b, 'https://example.com'), null)
  M.renameLinkType(b, '文档', 'Lark')
  assert.deepEqual(b.linkTypeDomains.Lark.length, 2); assert.equal(b.linkTypeDomains['文档'], undefined)
  M.deleteLinkType(b, 'Lark'); assert.equal(b.linkTypeDomains.Lark, undefined)
  M.removeTypeDomain(b, 'GitHub', 'https://github.com/'); assert.equal(b.linkTypeDomains, undefined)
  const b2 = M.parseBoard({ version: 1, groups: [], cards: [], sessions: [], linkTypeDomains: { A: 'https://a.com/' } })
  assert.deepEqual(b2.linkTypeDomains.A, ['https://a.com/'], '旧的单个值读成数组')
})
test('v141 类型标签 + 星标：链接带标签必须已登记；删标签回到只显示类型；星标置顶排序', () => {
  const { b, a } = seed()
  M.addTypeTag(b, 'GitHub', 'release 分支')
  assert.throws(() => M.addTypeTag(b, 'GitHub', 'release 分支'), /已经有/)
  assert.throws(() => M.addTypeTag(b, 'GitHub', 'x'.repeat(21)), /20/)
  assert.throws(() => M.setWebLinks(b, a.id, [{ text: 'x', type: 'GitHub', url: 'https://github.com/a', tag: '不存在' }]), /没有标签/)
  M.setWebLinks(b, a.id, [
    { text: 'g1', type: 'GitHub', url: 'https://github.com/1', tag: 'release 分支' },
    { text: 'g2', type: 'GitHub', url: 'https://github.com/2' },
    { text: 'f1', type: '文档', url: 'https://docs.example.com/1' },
    { text: 'g3', type: 'GitHub', url: 'https://github.com/3' },
  ])
  const ids = () => a.webLinks.map((l) => l.text).join(',')
  M.setLinkStar(b, a.id, a.webLinks[3].id, true)
  assert.equal(ids(), 'g3,g1,g2,f1', '加星 = 本类型星标末尾（第一个星）')
  M.setLinkStar(b, a.id, a.webLinks.find((l) => l.text === 'g2').id, true)
  assert.equal(ids(), 'g3,g2,g1,f1', '第二个星排在第一个星后面')
  M.setLinkStar(b, a.id, a.webLinks[0].id, false)
  assert.equal(ids(), 'g2,g3,g1,f1', '去星 = 排到星标后面')
  assert.equal(a.webLinks[0].star, true); assert.equal(a.webLinks[1].star, undefined)
  const r = M.removeTypeTag(b, 'GitHub', 'release 分支')
  assert.equal(r.links, 1); assert.equal(a.webLinks.find((l) => l.text === 'g1').tag, undefined)
  M.setWebLinks(b, a.id, a.webLinks.map((l) => ({ ...l })))
  assert.equal(a.webLinks[0].star, true, 'setWebLinks 保留星标')
})
test('v140 任务关联会话：设 / 清 / 子任务 / 校验 / 计数 / setTasks 保留', () => {
  const { b, a } = seed()
  M.setTasks(b, a.id, [{ id: 't1', text: '任务', done: false, subs: [{ id: 't1a', text: '子', done: false }] }, { id: 't2', text: '二', done: false }])
  M.setTaskSession(b, a.id, 't1', 's-1'); M.setTaskSession(b, a.id, 't1a', 's-1'); M.setTaskSession(b, a.id, 't2', 's-2')
  assert.equal(M.sessionTaskCount(a, 's-1'), 2)
  assert.throws(() => M.setTaskSession(b, a.id, 't1', 'bad id!'), /会话 id/)
  assert.throws(() => M.setTaskSession(b, a.id, 'nope', 's-1'), /没有任务/)
  M.setTasks(b, a.id, JSON.parse(JSON.stringify(a.tasks)))
  assert.equal(a.tasks[0].subs[0].sess, 's-1', 'setTasks 整表替换保留 sess')
  M.setTaskSession(b, a.id, 't2', '')
  assert.equal(a.tasks[1].sess, undefined)
})
test('v142 同名文件：广度优先、跳过隐藏 / node_modules、跳过原路径、上限', () => {
  const tree = { '/r': [{ name: 'a.png', dir: false }, { name: 'sub', dir: true }, { name: '.hid', dir: true }, { name: 'node_modules', dir: true }], '/r/sub': [{ name: 'a.png', dir: false }], '/r/.hid': [{ name: 'a.png', dir: false }], '/r/node_modules': [{ name: 'a.png', dir: false }] }
  const ls = (d) => { if (!tree[d]) throw new Error('nope'); return tree[d] }
  assert.deepEqual(findSameName('a.png', ['/r'], {}, ls), ['/r/a.png', '/r/sub/a.png'])
  assert.deepEqual(findSameName('a.png', ['/r'], { skip: '/r/a.png' }, ls), ['/r/sub/a.png'])
  assert.deepEqual(findSameName('a.png', ['/r'], { max: 1 }, ls), ['/r/a.png'])
  assert.deepEqual(findSameName('a/b', ['/r'], {}, ls), [])
  assert.deepEqual(findSameName('a.png', ['/missing'], {}, ls), [])
})
