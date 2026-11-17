/* v174：星标视觉重做 —— 执行安排卡金角签 / 甘特目录格 18px 金徽标 + 目录格排版重排 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const ganttSrc = src('gantt.ts')
const boardSrc = src('board.ts')
const css = src('style.css')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v174 执行安排：金角签元素固定输出；勾选左边金星（PSTAR_MARK）全清', () => {
  assert.match(ganttSrc, /const PSTAR_TAB = '<span class="pstar-tab" aria-hidden="true">' \+ ic\('star'\) \+ '<\/span>'/)
  assert.doesNotMatch(ganttSrc, /PSTAR_MARK/)
  assert.doesNotMatch(ganttSrc, /class="pstar-mark"/)
  /* v183：勾选圈始终渲染（项目卡用不可见占位），所以这条从 `(ck ? … : '')` 改成无条件输出 */
  assert.match(ganttSrc, /\+ PSTAR_TAB\r?\n\s*\+ '<span class="exck">' \+ ck \+ '<\/span>'/)
  /* 面板里仍然没有可点的星按钮（只显示） */
  const panel = ganttSrc.slice(ganttSrc.indexOf('function pItemHtml'), ganttSrc.indexOf('function subToday'))
  assert.doesNotMatch(panel, /pstar-btn/)
})

test('v174 目录格：18px 金徽标（不再 38px 整格块）；未加星灰星 55%；选中不再单独内缩', () => {
  assert.match(css, /\.dpm \.sched \.sc-name\.ind-cell > \.pstar-btn\.pstar-cell \{ position: absolute; left: 13px; top: 5px; width: 18px; height: 18px;/)
  assert.doesNotMatch(css, /\.pstar-btn\.pstar-cell \{ position: absolute; left: 0; top: 0; bottom: 0; width: 38px;/)
  assert.match(css, /\.dpm \.sched \.sc-name\.ind-cell > \.pstar-btn\.pstar-cell\.on \{ opacity: 1; border-color: #C9922A; background: linear-gradient\(150deg, #FFEDB4, #F5C24C 55%, #E0A62B\);/)
  assert.match(css, /opacity: \.55;/)
  assert.doesNotMatch(css, /v9cur > \.pstar-btn/)
})

test('v174 星按钮只有默认态：行悬停 / 选中不改它，悬停星本身与默认同一组值', () => {
  assert.doesNotMatch(css, /\.sc-row:hover[^\n]*pstar-cell/)
  assert.doesNotMatch(css, /\.sc-row\.sel[^\n]*pstar-cell/)
  assert.match(css, /background: transparent; border-color: transparent; color: var\(--pstar-g-ink\); opacity: \.55;/)
  const gold = css.match(/background: linear-gradient\(150deg, #FFEDB4, #F5C24C 55%, #E0A62B\);/g) || []
  assert.ok(gold.length >= 2, '已加星悬停必须仍是同一套金渐变（不是半透明）')
})

test('v174 目录格排版：第二行 = 阶段胶囊 + 两组静音统计；去短横线；两行同左缘 40px；组行降噪', () => {
  assert.match(ganttSrc, /<span class="v7mt tsk' \+ \(c\.total && c\.done === c\.total \? ' all' : ''\) \+ '"><i>任务<\/i><b>'/)
  assert.match(ganttSrc, /<span class="v7mt act' \+ \(c\.actualSet\.size \? '' : ' z'\) \+ '"><i>实际<\/i><b>'/)
  const sub = ganttSrc.slice(ganttSrc.indexOf('const sub ='), ganttSrc.indexOf('html += '))
  assert.doesNotMatch(sub, /v7tg pnd/)
  assert.match(css, /\.dpm \.sched \.sc-row\.ind \.sc-name\.ind-cell \{ padding: 3px 34px 3px 40px !important; \}/)
  assert.match(css, /\.dpm \.sched \.sc-row\.ind \.sc-name\.ind-cell \.nm \{ padding-left: 0 !important; font-size: 12\.5px; font-weight: 600;/)
  assert.match(css, /\.nm::before \{ display: none; \}/)
  assert.match(css, /\.v7mt i \{ font-style: normal; font-size: 9\.5px; opacity: \.62; \}/)
  assert.match(css, /\.sc-row\.g \.sc-name\.grp-cell \{ padding-left: 12px !important; gap: 6px; \}/)
  assert.match(css, /\.grp-cell \.meta \{ font-size: 10\.5px;/)
  /* 行高一个像素不动 */
  assert.match(css, /\.dpm \.sched \.sc-row \{height: 46px;\}/)
  assert.match(css, /\.dpm \.sched \.sc-row\.g \{height: 54px;\}/)
})

test('v174 执行中绿行：填充 = 执行安排卡片的 #1f7a45（不再 #16a34a 渐变）', () => {
  assert.match(css, /\.dpm \.sched \.exz\[data-zone="run"\] \{ --zc: #1f7a45;/)
  const run = css.slice(css.indexOf('.sc-name.ind-cell.dpm-dirrun'))
  assert.match(run, /background: #1f7a45 !important;/)
  assert.doesNotMatch(run.slice(0, 400), /16a34a/)
})

test('v174 角签几何：30×25 + 白星 14 + 并排窄卡 24×21 / 左内距 38→31', () => {
  assert.match(css, /\.exi\.starred > \.pstar-tab \{ position: absolute; left: 0; top: 0; z-index: 1; width: 30px; height: 25px;/)
  assert.match(css, /\.exi\.starred > \.pstar-tab svg\.i \{ width: 14px; height: 14px; fill: #FFFDF6;/)
  assert.match(css, /\.dpm \.sched #exBody \.exi\.starred \{ padding-left: 38px !important; \}/)
  assert.match(css, /\.exlane\.multi > \.exi\.starred \{ padding-left: 31px !important; \}/)
  assert.match(css, /width: 24px; height: 21px;/)
  assert.match(css, /\.exi\.starred > \.pstar-tab \{ position: absolute[^}]*pointer-events: none;/)
  assert.match(css, /body\[data-ds-dark-theme\] \.dpm \.sched #exBody \.exi\.starred > \.pstar-tab \{ background: linear-gradient\(160deg, #F6D583/)
})

test('v174 执行安排加星卡的「金色镶边 + 扫光」保留（角签只是新增，不替代镶边）', () => {
  assert.match(css, /\.dpm \.sched #exBody \.exi\.starred::after \{ content: ""; position: absolute; inset: 0; z-index: 5; border-radius: inherit; padding: 1\.5px; background: linear-gradient\(135deg, #FFF3C4 0%, #E7BC55 20%, #B9821F 42%, #F7D88F 62%, #D9A63A 82%, #FFE9A6 100%\);/)
  assert.match(css, /\.dpm \.sched #exBody \.exi\.starred \{ border-color: transparent !important; box-shadow: 0 0 0 1px rgba\(201,146,42,\.22\)/)
  assert.match(css, /body\[data-ds-dark-theme\] \.dpm \.sched #exBody \.exi\.starred \{ box-shadow: 0 0 0 1px rgba\(201,162,74,\.25\)/)
  /* 扫光层：starred 卡必须带 .pstar-sheen（v172 一处定义，8.6s） */
  assert.match(ganttSrc, /\(pstar \? PSTAR_SHEEN : ''\)/)
  assert.match(css, /animation: pstarSheen 8\.6s/)
})

test('v174 没动的两处：看板 20px / 详情 26px；星按钮 aria 带「已加星标」', () => {
  assert.match(css, /\.pstar-btn\.pstar-board \{ width: 20px; height: 20px;/)
  assert.match(css, /\.pstar-btn\.pstar-detail \{ width: 26px; height: 26px;/)
  assert.match(ganttSrc, /已加星标；/)
  assert.match(boardSrc, /加星标：看板卡金徽标 \/ 详情整窗金框 \/ 甘特图目录格金徽标 \/ 执行安排左上角金角签/)
})

test('v174 版本 0.70.0 + CHANGELOG', () => {
  assert.equal(pkg.version, '0.79.0')
  assert.match(log, /0\.70\.0/)
  assert.match(log, /金角签/)
  assert.match(log, /18px 金徽标/)
})