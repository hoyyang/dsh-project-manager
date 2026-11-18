/* v177：详情说明气泡统一 —— 一个组件五种身份；卡片详情 + 引用胶囊（含 DSH 对话框 / 知识卡）都用它 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const bubble = src('detailbubble.ts')
const css = src('style.css')
const boardSrc = src('board.ts')
const goalSrc = src('goaltask.ts')
const kbdlgSrc = src('kbdlg.ts')
const indexSrc = src('index.ts')
const kbSrc = src('kb.ts')
const richSrc = src('richnote.ts')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v177 一个组件：只有一处创建 .dpm-dpb、只有一块 CSS；旧 detailpop / .dpm-dp 退场', () => {
  assert.equal((bubble.match(/document\.createElement\('section'\)/g) || []).length, 1, '只允许一个气泡元素')
  assert.equal((bubble.match(/className = 'dpm-dpb'/g) || []).length, 1, '只允许一处根类名')
  assert.ok(!existsSync(new URL('../src/client/detailpop.ts', import.meta.url)), '旧 detailpop.ts 已删除')
  assert.doesNotMatch(css, /\.dpm-dp[ .:{]/, 'CSS 里不允许再有 .dpm-dp 外壳')
  assert.ok(css.includes('.dpm-dpb {'), '新外壳只有一个块')
  assert.equal((css.match(/^\.dpm-dpb \{/gm) || []).length, 1, '外壳只能定义一次')
})

test('v177 外壳：固定定位 / 18px 圆角 / 双层阴影 / 头正文底栏三段 / 箭头三种方向', () => {
  for (const s of [
    'position: fixed; z-index: 86; display: flex; flex-direction: column;',
    'border-radius: 18px;',
    'box-shadow: 0 34px 80px -30px rgba(15, 17, 21, .5), 0 6px 18px rgba(15, 17, 21, .08);',
    'animation: v177in 200ms cubic-bezier(.2, .9, .25, 1);',
    '@keyframes v177sw { from { opacity: .45; transform: scale(.994); } }',
    '.dpm-dpb.arr-r::after { right: -8px;',
    '.dpm-dpb.arr-b::after { right: auto; bottom: -8px;',
    '.dpm-dpb.arr-t::after { bottom: auto; top: -8px;',
    'width: 15px; height: 15px;',
    '.dpm-dpb .dpb-h {',
    '.dpm-dpb .dpb-b {',
    '.dpm-dpb .dpb-f {',
  ]) assert.ok(css.includes(s), '缺：' + s)
  assert.ok(bubble.includes("'dpm-dpb k-' + cur.model.bkind"), '身份只染 k-*')
})

test('v177 五种身份：徽标文案 / 图标 / 主色；项目产物位置留着（v157 数据未落码）', () => {
  assert.ok(bubble.includes('badge: what') && bubble.includes("what = sub ? '子任务' : '任务'"))
  assert.ok(bubble.includes("badge: '相关说明'"))
  assert.ok(bubble.includes("badge: '知识卡'"))
  assert.ok(bubble.includes("prod: '<svg"), '项目产物图标在壳里')
  assert.ok(css.includes('.dpm-dpb.k-prod {'), '项目产物主色在壳里（v157 数据未落码，暂无入口）')
  for (const c of ['k-task', 'k-sub', 'k-note', 'k-prod', 'k-kb']) assert.ok(css.includes('.dpm-dpb.' + c + ' {'), '缺身份色：' + c)
  assert.ok(css.includes('body[data-ds-dark-theme] .dpm-dpb.k-kb'), '深色档')
  assert.ok(css.includes('@media (max-width: 720px)'), '窄窗只收边距')
  assert.ok(css.includes('prefers-reduced-motion'), '动效可关')
})

test('v177 定位：detail 模式贴详情左边（320–800、锚点中线 −140）+ 右箭头', () => {
  assert.ok(bubble.includes('const W = clamp(cr.left - 26, 320, 800)'))
  assert.ok(bubble.includes("e.style.left = Math.round(Math.max(8, cr.left - 14 - W)) + 'px'"))
  assert.ok(bubble.includes('const top = clamp(cy - 140, top0, Math.max(top0, bot0 - H))'))
  assert.ok(bubble.includes("e.classList.remove('arr-t', 'arr-b'); e.classList.add('arr-r')"))
  assert.ok(bubble.includes("e.style.setProperty('--ty'"), '箭头纵向跟锚点')
})

test('v177 定位：float 模式贴胶囊（上方优先、≥160 才优先、放不下翻转、窄窗按面板收窄）', () => {
  assert.ok(bubble.includes('const above = aboveRoom >= belowRoom && aboveRoom >= 160'))
  assert.ok(bubble.includes('Math.min(620, Math.max(200, above ? aboveRoom : belowRoom))'))
  assert.ok(bubble.includes("e.classList.add(above ? 'arr-b' : 'arr-t')"))
  assert.ok(bubble.includes("e.style.setProperty('--ax'"))
  assert.ok(bubble.includes("Math.min(640, paneR.width - 24)"), '窄窗按 dialog 收窄')
  assert.ok(bubble.includes("closest('.ss-composer')"), '输入框里按整块输入区放，不压输入框')
  assert.ok(bubble.includes("closest('dialog[open]')"), '宿主弹窗顶层不被盖住')
})

test('v177 换项 / 下钻 / 返回 / 关闭：同一源再点 = 关；压栈可逐层回；Esc 只关气泡', () => {
  assert.ok(bubble.includes('stack.push({ ...cur })'))
  assert.ok(bubble.includes('data-dpbback'))
  assert.ok(bubble.includes('function back(): void'))
  assert.ok(bubble.includes('cur.anchor === a && keyOf(cur.model) === keyOf(model)'), '同一源再点 = 关')
  assert.ok(bubble.includes("if (e.key !== 'Escape' || !cur || e.defaultPrevented) return") && bubble.includes('e.stopPropagation()'), 'Esc 只关气泡')
  assert.ok(bubble.includes('setTimeout(() => (e.querySelector(\'[data-dpbx]\')'), '焦点先给 ×')
  assert.ok(bubble.includes('focus({ preventScroll: true })'), '关闭后焦点回源')
})

test('v177 知识卡：摘要态先开 + getKbCard 回来自动换数据 + 失败给重试 + 底栏去知识库', () => {
  assert.ok(bubble.includes("busy: '正在读取正文…'"))
  assert.ok(bubble.includes('void getKbCard(id).then((info) => {'))
  assert.ok(bubble.includes('function rewrite(model: DetailModel): void'), '只换数据不换身份')
  assert.ok(bubble.includes('retry: load'))
  assert.ok(bubble.includes('data-dpbkb') && bubble.includes('在知识库中打开'))
  assert.ok(bubble.includes('data-dpbkbnav'), '子卡可下钻')
  assert.ok(bubble.includes('data-dpbcard'), '挂在哪些项目卡可打开')
  assert.ok(kbSrc.includes('export const kbMarkdown = md'), '正文渲染一处定义')
})

test('v177 入口：卡片详情（任务 / 子任务 / 说明）+ 弹窗 / 编辑器 / DSH 对话框的胶囊都走同一个组件', () => {
  assert.ok(boardSrc.includes("from './detailbubble.js'") && !boardSrc.includes('new DetailPop'))
  assert.ok(boardSrc.includes('openTask(this.bctx as BubbleCtx') && boardSrc.includes('openNote(this.bctx as BubbleCtx'))
  assert.ok(boardSrc.includes('if (this.dp) bubbleSync()'))
  assert.ok(goalSrc.includes('openChipDetail(bubbleCtx(), chip, card)'), '任务弹窗的胶囊')
  assert.ok(!goalSrc.includes('showNoteTip(') && !goalSrc.includes('showKbTip('), '旧的说明 / 知识卡小窗已删')
  assert.ok(kbdlgSrc.includes('onChip: (chip, meta) =>') && kbdlgSrc.includes('if (meta.cmd) return false'), '知识卡正文：默认气泡、⌘ 才跳')
  assert.ok(indexSrc.includes('openDetailRef(bubbleCtx()'), 'DSH 对话框')
  assert.ok(indexSrc.includes('setKbOpener('), '知识库跳转一处注册')
  assert.ok(indexSrc.includes('const chipCmd = ()'), '⌘ / Ctrl 点击仍可跳知识库')
})

test('v177 行为细节：60ms 去重（宿主双回调）/ 内容刷新 / 复制展开 / 探针', () => {
  assert.ok(bubble.includes('now - last.at < 60'), '同一次点击只开一次')
  assert.ok(bubble.includes('export function bubbleSync(): void'))
  assert.ok(bubble.includes('__dpmDpCopy') && bubble.includes('export function selText'), '复制胶囊 = 引用原文')
  assert.ok(bubble.includes('__dpmDp'), '验收探针保留')
  assert.ok(bubble.includes("setAttribute('role', 'dialog')") && bubble.includes("'aria-modal', 'false'"))
  assert.ok(bubble.includes('chipInBubble'), '气泡里的胶囊还能继续下钻')
})

test('v177 版本 / 变更日志', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.match(log, /## 0\.72\.0 — 2026-11-14/)
  assert.match(log, /详情说明统一成一个气泡/)
})