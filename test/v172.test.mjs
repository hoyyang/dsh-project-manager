/* v172：项目星标 —— 一个布尔四处显示（看板卡 / 详情 / 甘特图目录格 / 执行安排） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as M from '../lib/model.js'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const boardSrc = src('board.ts')
const ganttSrc = src('gantt.ts')
const css = src('style.css')
const routes = readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8')
const hostGantt = readFileSync(new URL('../src/gantt.ts', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

const mk = () => { const b = M.emptyBoard(); const g = M.addGroup(b, 'G'); const c = M.addCard(b, g.id, '卡A'); return { b, g, c } }

test('v172 模型：star 只认 true（开 = 置 true、关 = 删字段），旧数据没有这个字段', () => {
  const { b, c } = mk()
  assert.equal(c.star, undefined)
  assert.equal(M.setCardStar(b, c.id, true).star, true)
  assert.equal(c.star, true)
  assert.equal(M.setCardStar(b, c.id, false).star, undefined)
  assert.equal('star' in c, false)
  /* 任何非 true 的入参 = 关 */
  M.setCardStar(b, c.id, true); M.setCardStar(b, c.id, 'yes'); assert.equal(c.star, undefined)
})

test('v172 模型：parseBoard 清洗非 true 的 star；归档卡不能改星（只读）', () => {
  const { b, c } = mk()
  c.star = false; assert.equal(M.parseBoard(JSON.parse(JSON.stringify(b))).cards[0].star, undefined)
  c.star = true; assert.equal(M.parseBoard(JSON.parse(JSON.stringify(b))).cards[0].star, true)
  /* 归档只读 */
  const d = mk(); M.archiveCard(d.b, d.c.id)
  assert.throws(() => M.setCardStar(d.b, d.c.id, true), /已归档/)
})

test('v172 模型：复制卡片不带星（避免复制品继承「重要」）', () => {
  const { b, c } = mk()
  M.setCardStar(b, c.id, true)
  const n = M.copyCard(b, c.id)
  assert.equal(n.star, undefined)
  assert.equal(c.star, true)
})

test('v172 路由有 card/star（on 只认 true）', () => {
  assert.match(routes, /'card\/star': \(x, b\) => M\.setCardStar\(b, str\(x\.id, 'id'\), x\.on === true\)/)
})

test('v172 看板卡：星按钮在标题左边、卡片根按 star 输出 pstar-on、扫光层只在加星时出现', () => {
  assert.match(boardSrc, /const pstarBtn = \(place: 'board' \| 'detail', c: Card, ro\?: boolean\): string =>/)
  assert.match(boardSrc, /'<div class="pstar-top">' \+ pstarBtn\('board', c\) \+ '<h3>'/)
  assert.match(boardSrc, /\(c\.star \? ' pstar-on' : ''\)/)
  assert.match(boardSrc, /\(c\.star \? PSTAR_SHEEN : ''\)/)
  /* 点星不等于点卡片：星分支先于 d.card 的打开详情 */
  assert.ok(boardSrc.indexOf("if (d.cardStar !== undefined)") > 0)
  assert.ok(boardSrc.indexOf("if (d.cardStar !== undefined)") < boardSrc.indexOf("if (d.card && (t.classList.contains('card')"))
})

test('v172 详情：标题包进 .pstar-dt（星在标题左）、根 pstar-on、归档只读 disabled', () => {
  assert.match(boardSrc, /'<div class="pstar-dt">' \+ pstarBtn\('detail', c, ro\) \+ '<h2 id="dpmDT">'/)
  assert.match(boardSrc, /class="detail' \+ \(ro \? ' ro' : ''\) \+ \(c\.star \? ' pstar-on' : ''\)/)
  assert.match(boardSrc, /\(ro \? ' disabled aria-disabled="true"' : ''\)/)
})

test('v172 甘特目录格：38px 星槽 + starred 类；点星在目录格点击之前 return', () => {
  assert.match(ganttSrc, /class="sc-name ind-cell' \+ \(c\.star \? ' starred' : ''\)/)
  assert.match(ganttSrc, /'<button type="button" class="pstar-btn pstar-cell' \+ \(c\.star \? ' on' : ''\) \+ '" data-card-star="' \+ esc\(c\.id\)/)
  const star = ganttSrc.indexOf("const sbtn = t.closest('[data-card-star]')")
  const cell = ganttSrc.indexOf("const icell = t.closest('.sc-name[data-open-card-cell]')")
  assert.ok(star > 0 && star < cell)
  assert.match(ganttSrc, /function toggleStar\(c: CardM\): void/)
})

/* 0.69.1：星标按钮的修饰类必须自带前缀。裸 `.cell` 会命中看板列那条 `:is(.dpm,.dpm-dialog) .cell { min-height: 96px }`，
   星槽被撑成 38×96、17px 图标被 45px 行裁掉（真机 R3 全废，v172 验收漏了「高度 / 图标可见」这一项）。 */
test('v172 星标按钮修饰类一律 pstar- 前缀（不许裸 board / detail / cell）', () => {
  assert.match(boardSrc, /class="pstar-btn pstar-' \+ place \+ \(on \? ' on' : ''\)/)
  assert.match(ganttSrc, /class="pstar-btn pstar-cell'/)
  assert.doesNotMatch(boardSrc, /class="pstar-btn ' \+ place/)
  assert.doesNotMatch(ganttSrc, /class="pstar-btn cell'/)
  assert.doesNotMatch(css, /\.pstar-btn\.(cell|board|detail)\b/)
  assert.match(css, /\.pstar-btn\.pstar-board \{ width: 20px; height: 20px;/)
  assert.match(css, /\.pstar-btn\.pstar-detail \{ width: 26px; height: 26px;/)
  assert.match(css, /\.pstar-btn\.pstar-cell \{ position: absolute; left: 13px; top: 5px; width: 18px; height: 18px;/)
})

test('v172 执行安排：只显示（星标 mark + starred 类 + 扫光），没有星标按钮', () => {
  assert.match(ganttSrc, /const pstar = l\.c\.star === true/)
  assert.match(ganttSrc, /\+ PSTAR_TAB/)
  assert.match(ganttSrc, /'<span class="exck">' \+ ck \+ '<\/span>'/)
  assert.doesNotMatch(ganttSrc, /PSTAR_MARK/)
  assert.match(ganttSrc, /\(pstar \? PSTAR_SHEEN : ''\)/)
  /* 面板里不能出现可点的星按钮 */
  assert.doesNotMatch(ganttSrc, /class="pstar-btn[^"]*"[^>]*data-card-star[^>]*>\s*' \+ ic\('star'\)[\s\S]{0,400}pItemHtml/)
})

test('v172 快照带上 star（host 甘特 payload + 客户端 CardM / GanttCard 类型）', () => {
  assert.match(hostGantt, /\.\.\.\(c\.star \? \{ star: true \} : \{\}\)/)
  assert.match(readFileSync(new URL('../src/client/api.ts', import.meta.url), 'utf8'), /star\?: boolean/)
  assert.match(ganttSrc, /if \(gc\.star\) c\.star = true; else delete c\.star/)
})

test('v172 CSS：灰星令牌 / 金框 / 扫光 8.6s / 目录格车位与渐隐', () => {
  assert.match(css, /--pstar-g-line: #C9CFD9/)
  assert.match(css, /--pstar-g-fill: #F1F3F7/)
  assert.match(css, /:is\(\.dpm, \.dpm-dialog\) \.card\.pstar-on::before \{ content: ""; position: absolute; inset: 0; z-index: 3; padding: 2px;/)
  assert.match(css, /animation: pstarSheen 8\.6s cubic-bezier\(\.35,0,\.25,1\) infinite;/)
  assert.match(css, /@keyframes pstarSheen \{ 0%, 54% \{ background-position: 210% 0; \} 84%, 100% \{ background-position: -120% 0; \} \}/)
  assert.match(css, /padding: 3px 34px 3px 40px !important;/);
  assert.match(css, /mask-image: linear-gradient\(90deg, #000 calc\(100% - 14px\), transparent\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ :is\(\.dpm, \.dpm-dialog\) \.pstar-sheen \{ animation: none; opacity: 0; \} \}/)
})

test('v172 版本 0.69.0 + CHANGELOG 有项目星标', () => {
  assert.equal(pkg.version, '0.79.0')
  assert.match(log, /0\.69\.0/)
  assert.match(log, /星标/)
})