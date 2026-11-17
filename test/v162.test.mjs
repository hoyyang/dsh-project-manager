/* v162：知识库入口（order 7，绿色 + 开卷书）+ 空白看板（第 3 个 main 页，三块看板共用一个窗口） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const index = src('index.ts')
const entry = src('entry.ts')
const css = src('style.css')

test('入口：知识库 = sidebar.panellist order 7，复用 PanelEntry（同一套光效层）', () => {
  assert.match(index, /const KB = 'dsh-project-manager:kb'/)
  // v182：label 改由 tr() 出具（导航文案跟插件语言），组件外套一层 i18n 标记
  assert.match(index, /id: KB, order: 7, label: tr\('知识库'\)/)
  assert.match(entry, /export function KbEntry[\s\S]*?variant: 'kb'/)
  assert.match(entry, /h\(PanelEntry, \{ active: p\.active, compact: p\.compact, count: 0, suffix: '', glyph: KB_GLYPH, variant: 'kb' \}\)/)
  assert.match(entry, /row\.toggleAttribute\('data-dpm-kb', p\.variant === 'kb'\)/)
  assert.match(entry, /'data-dpm-sched', 'data-dpm-kb', 'data-dpm-rail'/)
  assert.match(entry, /h\('span', \{ className: 'hfx' \}/)
})

test('页面：第 3 个 main key（v163 S7 起 = 真实知识库页，不再是空白看板）', () => {
  assert.match(index, /slots\.register\(\{ name: 'main', key: KB \}, wrapRoot\(KbPage\)\)/)
  assert.match(index, /const KbPage = kbPage\(/)
  const kb = src('kb.ts')
  for (const s of ['知识库', '一张卡 = 一条可复用的知识', '新建第一张知识卡', '还没有知识卡']) assert.ok(kb.includes(s), s)
  assert.ok(kb.includes('kb-ic') && kb.includes('KB_GLYPH'))
})

test('绿色变量（浅 / 深）+ 开卷书图标（描边 + 两页外移）', () => {
  assert.match(css, /button\[data-dpm-eb\]\[data-dpm-kb\] \{ --dpm-a: #1e8f5e; --dpm-b: #0f5132; --dpm-ink: #166534; \}/)
  assert.match(css, /body\[data-ds-dark-theme\] button\[data-dpm-eb\]\[data-dpm-kb\] \{ --dpm-a: #34b17a; --dpm-b: #146c43; --dpm-ink: #b8e8cb; \}/)
  assert.match(entry, /KB_GLYPH = '<svg class="pgi"/)
  assert.match(css, /\.dpm-entry\.kb \.pgi \.kl[\s\S]*?translateX\(-1\.2px\)/)
})

test('动效与另外三个按钮同一套：base 规则用 --dpm-a 出焦点圈 / 选中反白', () => {
  assert.match(css, /button\[data-dpm-eb\]:focus-visible \{ outline: 2px solid var\(--dpm-a\); outline-offset: 2px; \}/)
  assert.match(css, /button\[data-dpm-eb\]\[data-dpm-on\] \{ color: #ffffff !important;/)
  assert.match(css, /\.dpm-entry\[data-active="true"\] \.pg \{ background: rgba\(255, 255, 255, \.95\); color: var\(--dpm-a\);/)
})

test('空白看板：页头 / 空态 / 深色 / 容器窄屏降级 / 减少动态', () => {
  for (const s of ['.dpm.kb-page', '.kb-top', '.kb-empty', '.kb-eic', '.kb-spec', '.kb-row', '@container kbpage', '@media (prefers-reduced-motion: reduce)']) assert.ok(css.includes(s), s)
  assert.match(css, /body\[data-ds-dark-theme\] \.dpm\.kb-page \.kb-empty/)
  assert.match(css, /@container kbpage \(max-width: 620px\)/)
})

