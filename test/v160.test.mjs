/* v160：任务执行安排「记录执行」按钮没有字 —— 文字按按钮自身空间决定，放不下就整体收成图标方 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const gantt = src('gantt.ts')
const css = src('style.css')

test('按钮文字永远在 DOM 里（.rt 三种文案都在 pRecBtn 里渲染）', () => {
  assert.match(gantt, /'<span class="rt">' \+ \(on \? \(auto \? '自动' : '已执行'\) : mix \? '部分执行' : '记录执行'\) \+ '<\/span><\/button>'/)
})

test('文字显隐按标题自己的宽度算：先按有字摆 → 量标题 → 不足 MIN_REC_T 才收', () => {
  assert.match(gantt, /const MIN_REC_T = 96/)
  assert.match(gantt, /el\.classList\.remove\('recicon'\)/)
  assert.match(gantt, /const t = el\.querySelector\(':scope > \.exi-m > \.exi-r1 > \.exi-t'\)/)
  assert.match(gantt, /if \(tw < MIN_REC_T\) el\.classList\.add\('recicon'\)/)
})

test('.recicon 的宽度在判定之后才量（--recw 用收完的宽度，悬停按钮不飘）', () => {
  const i = gantt.indexOf("classList.add('recicon'")
  const j = gantt.indexOf("setProperty('--recw'", i)
  assert.ok(i > 0 && j > i, '.recicon 切换必须在前，--recw 量取在后')
})

test('放不下 = 整体收成 22×22 图标方，且 .rt 不再占位', () => {
  assert.match(css, /\.dpm \.sched \.exi\.recicon > \.exrec \{ width: 22px; height: 22px; padding: 0; justify-content: center; border-radius: 8px; \}/)
  assert.match(css, /\.dpm \.sched \.exi\.recicon > \.exrec \.rt \{ display: none; \}/)
})

test('胶囊按内容定宽（justify-self: end），不被网格列拉出尾部空白', () => {
  assert.match(css, /\.dpm \.sched #exBody \.exi > \.exrec \{ justify-self: end; \}/)
})

test('有字就画出来：color / visibility / opacity / font-size 四条兜底', () => {
  assert.match(css, /\.dpm \.sched \.exi > \.exrec \.rt \{ display: inline-block; font-size: 10\.5px; line-height: 1; color: inherit; visibility: visible; opacity: 1; \}/)
})

test('不许再按面板 / 容器宽度藏字（≤230 / 一行多张 ≤260 的老规则已删）', () => {
  assert.doesNotMatch(css, /@container \(max-width: 260px\) \{\s*\.dpm \.sched #exBody \.exlane\.multi > \.exi > \.exrec \.rt/)
  assert.doesNotMatch(css, /\.dpm \.sched \.exi \.exrec \.rt \{ display: none; \}/)
  /* 计划清单行「只留图标」是行内窄排，保留 */
  assert.match(css, /\.dpm \.sched \.plr \.exrec \.rt \{ display: none; \}/)
})
