/* v176：甘特目录格点星不再整页重画（卡顿 / 闪动修复）—— 局部上色 + 在途星标盖住旧快照 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ganttSrc = readFileSync(new URL('../src/client/gantt.ts', import.meta.url), 'utf8')
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const cut = (from, to) => ganttSrc.slice(ganttSrc.indexOf(from), ganttSrc.indexOf(to))

test('v176 点星只改一颗按钮：toggleStar 里不许再整页 render / 重读快照', () => {
  const fn = cut('function toggleStar', 'function toggleGroup')
  assert.ok(fn.length > 200, 'toggleStar 切片没取到')
  assert.doesNotMatch(fn, /\brender\(\)/)
  assert.doesNotMatch(fn, /self\.load\(true\)/)
  assert.match(fn, /paintStar\(c\)/)
  assert.match(fn, /self\.pendStar\.set\(c\.id, \{ on, seq \}\)/)
})

test('v176 paintStar 只动那一颗：按钮 .on + 读屏文案 + 行类，不碰 innerHTML', () => {
  const fn = cut('function paintStar', 'function toggleStar')
  assert.match(fn, /\[data-card-star="' \+ CSS\.escape\(c\.id\) \+ '"/)
  assert.match(fn, /classList\.toggle\('on', c\.star === true\)/)
  assert.match(fn, /setAttribute\('aria-pressed', c\.star \? 'true' : 'false'\)/)
  assert.match(fn, /classList\.toggle\('starred', c\.star === true\)/)
  assert.match(fn, /classList\.toggle\('star', c\.star === true\)/)
  assert.doesNotMatch(fn, /innerHTML/)
})

test('v176 在途星标：轮询旧快照盖不住刚点的星，服务端对上才交回', () => {
  assert.match(ganttSrc, /private pendStar = new Map<string, \{ on: boolean; seq: number; done\?: boolean \}>\(\)/)
  const i = ganttSrc.indexOf('if (gc.star) c.star = true')
  const apply = ganttSrc.slice(i, i + 460)
  assert.match(apply, /const ps = self\.pendStar\.get\(c\.id\)/)
  assert.match(apply, /if \(ps\.on\) c\.star = true; else delete c\.star/)
  assert.match(apply, /if \(ps\.done && !!gc\.star === ps\.on\) self\.pendStar\.delete\(c\.id\)/)
})

test('v176 星文案一处定义：渲染与局部上色共用 starLabel / starTitle', () => {
  assert.match(ganttSrc, /function starLabel\(c: CardM\): string \{ return \(c\.star \? '取消星标「' : '加星标「'\) \+ c\.t \+ '」' \}/)
  assert.match(ganttSrc, /aria-label="' \+ esc\(starLabel\(c\)\) \+ '" title="' \+ esc\(starTitle\(c\)\) \+ '"/)
  /* 渲染那一处不再内联长文案（否则局部上色跟整页重画会飘） */
  assert.doesNotMatch(ganttSrc, /esc\(c\.star \? '取消星标：四处一起回落成未加星'/)
})

test('v176 整页重画只给「看得见的东西真的变了」：applyData 走 modelSig 判定', () => {
  assert.match(ganttSrc, /const mNo = modelSig\(\)/)
  assert.match(ganttSrc, /const mYes = modelSig\(true\)/)
  assert.match(ganttSrc, /if \(self\.lastModel && mNo === self\.lastModel\) \{/)
  assert.match(ganttSrc, /if \(mYes !== self\.lastModelYes\) paintStars\(\)/)
  const sig = cut('function modelSig', 'function paintStars')
  assert.ok(sig.length > 300)
  /* 指纹只收「画在屏幕上」的字段：快照版本 / 组更新时间这类噪声一律不进 */
  assert.doesNotMatch(sig, /\.upd\b/)
  assert.doesNotMatch(sig, /\.rev\b/)
  assert.match(sig, /withStar && c\.star \? '\|\*' : ''/)
})

test('v176 CHANGELOG 记了这次卡顿修复', () => {
  assert.match(log, /点星「卡顿 \+ 闪动」|点星卡顿/)
})
