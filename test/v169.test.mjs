/* v169：「任务执行安排」卡片第二行重做 —— 去掉「推荐 · xxx」+ 项目组 › 项目 = 设计稿双色色带 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const gantt = src('gantt.ts')
const css = src('style.css')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v169 卡面：推荐胶囊下线（不再产出 .exrt / recTag 已删 / 旧样式已删）', () => {
  assert.doesNotMatch(gantt, /class="exrt"/)
  assert.doesNotMatch(gantt, /function recTag\(/)
  assert.doesNotMatch(css, /\.exi-s \.exrt \{/)
})

test('v169 推荐语义保留：分区「推荐 N」/「全部采纳」/ 面板头「跨天 N」/ 落地动效', () => {
  assert.match(gantt, /推荐 ' \+ recN/)
  assert.match(gantt, /data-ex-rec-all="1"/)
  assert.match(gantt, /ec\.textContent = n \? '跨天 ' \+ n : ''/)
  assert.match(css, /@keyframes dpm-v161land/)
  assert.match(css, /\.dpm \.sched \.exz-h \.zrec \{/)
  assert.match(css, /\.dpm \.sched \.exz-h \.zacc \{/)
})

test('v169 卡片：data-rec 只在有推荐时输出（无推荐不留空属性）', () => {
  assert.match(gantt, /const recZ = recLive\(u, l\.key, key\)/)
  assert.match(gantt, /\(recZ \? ' data-rec="' \+ recZ\.z \+ '"' : ''\)/)
})

test('v169 色带：crumbRibbon（任务卡两段 / 项目卡只一段）+ 第二行接线', () => {
  assert.match(gantt, /function crumbRibbon\(l: LeafL\): string/)
  assert.match(gantt, /class="excr-s ' \+ k \+ '"><i>' \+ esc\(txt\) \+ '<\/i><\/span>/)
  assert.match(gantt, /class="excr" data-lv="' \+ l\.level \+ '" aria-hidden="true">' \+ seg\('g', l\.g\.name\)/)
  assert.match(gantt, /if \(l\.level !== 'p'\) h \+= seg\('p', l\.c\.t\)/)
  assert.match(gantt, /class="exi-s">' \+ crumbRibbon\(l\)/)
  assert.doesNotMatch(gantt, /exi-s">' \+ recTag/)
})

test('v169 色带：DOM 选择器改读 .exi[data-rec]（落地动效 / 跨天跳转）', () => {
  assert.match(gantt, /const cards = \$\$\('#exBody \.exi\[data-rec\]'\)/)
  assert.match(gantt, /const first = \$\('#exBody \.exi\[data-rec\]'\)/)
  assert.match(gantt, /const el = \$\('#exBody \.exi\[data-rec\]'\)/)
  assert.match(gantt, /unz\.querySelector\('\.exi\[data-rec\]'\)/)
  assert.doesNotMatch(gantt, /exi \.exrt/)
})

test('v169 CSS：几何 17/15/6 + 设计稿色值 + chevron + 深色只压描边', () => {
  assert.match(css, /--cr-tip: 6px; --cr-ink: #22262c;/)
  assert.match(css, /height: 17px; padding: 1px; margin: 0 7px 0 0; vertical-align: middle;/)
  assert.match(css, /--cr-fill: #f0f4fc; min-width: 30px;/)
  assert.match(css, /--cr-fill: #fef1cd;/)
  assert.match(css, /font-size: 10px; font-weight: 650; line-height: 15px/)
  assert.match(css, /color: #22262c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/)
  assert.match(css, /calc\(100% - var\(--cr-tip\) - 1px\) 0, 100% 50%/)
  assert.match(css, /0 100%, var\(--cr-tip\) 50%\)/)
  assert.match(css, /--cr-ink: #14161a;/)
})

test('v169 版本：CHANGELOG 有 0.66.0 这一条（当前版本号由最新的版本用例锁）', () => {
  assert.match(log, /## 0\.66\.0/)
  assert.match(log, /色带/)
})
