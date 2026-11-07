import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Q from '../lib/quote.js'

const card = {
  links: [{ id: 'L1', text: '方案', url: 'https://a.example.com/1' }, { id: 'L2', text: '评审', url: 'https://a.example.com/2' }],
  files: [{ id: 'F1', path: '/x/需求.md', exists: true }, { id: 'F2', path: '/x/旧.zip', title: '旧日志', exists: false }],
  tasks: [
    { text: '完成第一版', done: true, type: '开发' },
    { text: '打包验证', done: false, type: '验证', note: '按 [1] 里「要点」跑\n结论写到 [2]', links: ['L1', 'L2'], files: ['F1', 'F2'], subs: [
      { text: '打包', done: true, type: '开发' }, { text: '回归', done: false }, { text: '跑登录', done: false, note: '各跑一遍', files: ['F1'] }] },
  ],
}

test('v97：任务只给任务说明全文；没有说明才退回标题', () => {
  assert.equal(Q.taskText(card, 1), '按 [1] 里「要点」跑\n结论写到 [2]')
  assert.equal(Q.taskText(card, 0), '完成第一版')
  assert.equal(Q.taskText(card, 1, 2), '各跑一遍')
  assert.equal(Q.taskText(card, 1, 1), '回归')
  assert.equal(Q.taskText(card, 9), '')
  assert.equal(Q.taskText(card, 1, 9), '')
  assert.doesNotMatch(Q.taskText(card, 1), /状态：|任务 \d|链接：|文件：/)
})
test('其它类别的固定格式', () => {
  assert.equal(Q.sessionText('灰度数据复盘（P1）', '结算体验升级', '结算页改版'), '「“灰度数据复盘（P1）”会话（“结算体验升级”卡片组-“结算页改版”卡片）」')
  assert.equal(Q.sessionText('调研', 'dsh 插件建设'), '「“调研”会话（“dsh 插件建设”卡片组）」')
  assert.equal(Q.sessionText('a「b」“c”'), '「“a『b』‘c’”会话」')
  assert.equal(Q.noteText('验收', 'x「y」'), '「“验收”：x『y』」')
  assert.equal(Q.linkText(card.links[0]), '「“方案”（https://a.example.com/1）」')
  assert.equal(Q.fileText(card.files[0]), '「“需求.md”（/x/需求.md）」')
  assert.equal(Q.fileText(card.files[1]), '「“旧日志”（已删除：/x/旧.zip）」')
  assert.equal(Q.repoText('cts', '/r/cts'), '「“cts”（路径：/r/cts）」')
  assert.equal(Q.cardText('一期', '结算'), '「“一期”（卡片组：“结算”）卡片」')
})
test('触发：开头 > 或 空格 + >；任意行行首都触发（v117）；词中间不触发；遇到空白结束', () => {
  assert.deepEqual(Q.detectQuote('>', true), { len: 1, query: '' })
  /* v117：行首不再限制「只能是第一行」—— 说明框多行时第 2 行行首打 > 也要弹菜单 */
  assert.deepEqual(Q.detectQuote('>', false), { len: 1, query: '' })
  assert.deepEqual(Q.detectQuote('先看下 >打包', true), { len: 4, query: '打包' })
  assert.deepEqual(Q.detectQuote('x　>a', true), { len: 3, query: 'a' })
  assert.equal(Q.detectQuote('abc>', true), null)
  assert.equal(Q.detectQuote(' >a b', true), null)
  assert.equal(Q.detectQuote('a -> b', true), null)
})
