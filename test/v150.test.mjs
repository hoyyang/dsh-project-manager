import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relinkFiles } from '../lib/migrate.js'

/* v144（4.3）：迁移落盘项目时，卡片相关文件里指向旧文件夹的路径同一事务改到新文件夹；撤销 = 反向调用改回 */
test('v150 relinkFiles：只改旧文件夹下的路径（前缀要到目录边界），反向调用复原', () => {
  const A = '/h/.ai/projects/p1/memory/designs/x', B = '/h/.ai/projects/p2/memory/designs/x'
  const b = { version: 1, groups: [], sessions: [], cards: [{ id: 'c', g: 'g', col: 's', order: 0, t: 'C', links: [], tasks: [], files: [{ path: A + '/evidence/a.png' }, { path: A }, { path: A + 'y/other.md' }, { path: '/tmp/z.txt' }] }, {}] }
  assert.equal(relinkFiles(b, A, B), 2)
  assert.deepEqual(b.cards[0].files.map((f) => f.path), [B + '/evidence/a.png', B, A + 'y/other.md', '/tmp/z.txt'])
  assert.equal(relinkFiles(b, B, A), 2)
  assert.deepEqual(b.cards[0].files.map((f) => f.path), [A + '/evidence/a.png', A, A + 'y/other.md', '/tmp/z.txt'])
})
