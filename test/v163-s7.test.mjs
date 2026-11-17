/* v163 S7：知识库页（只读）—— 列表 / 搜索 300ms 防抖 / 类型 + 状态 + 标签筛选 / 读详情 / 「挂在哪些项目卡」跳转 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const kb = src('kb.ts')
const index = src('index.ts')
const css = src('style.css')

test('接线：KbPage = kbPage()（面板 key 不变）；「挂在哪些项目卡」走 openBoardAt', () => {
  assert.ok(index.includes("import { kbOpen, kbPage } from './kb.js'"))
  assert.ok(index.includes('const KbPage = kbPage({ onOpenCard: openBoardAt, toast })'))
  assert.match(index, /slots\.register\(\{ name: 'main', key: KB \}, wrapRoot\(KbPage\)\)/)
})

test('数据：读三路（getKb / searchKb / getKbCard）；S8 起写盘走 postKb（本步只有读）', () => {
  assert.ok(kb.includes("import { getKb, getKbCard, getState, post, postKb, searchKb } from './api.js'"))
  assert.ok(kb.includes('await getKb()'))
  assert.ok(kb.includes('await searchKb('))
  assert.ok(kb.includes('await getKbCard('))
})

test('搜索：输入 300ms 防抖后走 /kb/search；清空按钮同时停掉在途防抖', () => {
  assert.ok(kb.includes('timer = setTimeout(() => { timer = undefined; void loadList() }, 300)'))
  assert.ok(kb.includes('clearTimeout(timer)'))
  assert.ok(kb.includes('data-role="qx"'))
  assert.ok(kb.includes('limit: 500'))
})

test('筛选：类型 chips（全部 + 6 类）/ 状态三档 / 标签云，都变成 searchKb 的过滤参数', () => {
  /* v168：类型 / 状态 / 图标的表搬进 kbdlg.ts（弹窗与页面共用一张表） */
  const meta = readFileSync(new URL('../src/client/kbdlg.ts', import.meta.url), 'utf8')
  for (const k of ['prompt', 'howto', 'snippet', 'domain', 'business', 'moc']) assert.ok(meta.includes("k: '" + k + "'"), k)
  assert.ok(kb.includes('data-kbtype'))
  assert.ok(kb.includes('data-kbst'))
  assert.ok(kb.includes('data-kbtag'))
  assert.ok(kb.includes("st.status === 'all' ? undefined : st.status"))
  assert.ok(kb.includes('const tg = st.tag || undefined'))
})

test('详情：标题 / 类型 / 状态 / 路径 + 复制 / 标签 / markdown 正文 / 挂在哪些项目卡（点击 → onOpenCard）', () => {
  for (const s of ['kbd-h', 'kbst ', 'kbd-meta', 'kbpath', 'kbcopy', 'kbd-tags', 'kbd-b', 'kbd-att']) assert.ok(kb.includes(s), s)
  assert.ok(kb.includes('data-kbcard='))
  assert.ok(kb.includes('opts.onOpenCard(id)'))
  assert.ok(kb.includes('<pre><code>'))
  assert.ok(kb.includes('while (i < lines.length)'))
})

test('空库：沿用 v162 空态，文案换成「新建第一张知识卡」，按钮 S8 起可用', () => {
  assert.ok(kb.includes('还没有知识卡'))
  assert.ok(kb.includes('新建第一张知识卡'))
  assert.ok(kb.includes('class="kb-go" type="button" data-kbnew'))
  assert.ok(kb.includes('st.cards.length === 0'))
})

test('CSS：工具条 / 列表行 / 详情 / 窄屏单列（照搬原型 v163 + 深色）', () => {
  for (const s of ['.dpm.kb-page .kb-bar', '.dpm.kb-page .kb-seg', '.dpm.kb-page .kb-chips', '.dpm.kb-page .kb-main', '.dpm.kb-page .vkrow', '.dpm.kb-page .vkb-det', '.dpm.kb-page .kbd-b pre', '.dpm.kb-page .kbat', '@container kbpage (max-width: 900px)', '@container kbpage (max-width: 660px)']) assert.ok(css.includes(s), s)
  assert.ok(css.includes('body[data-ds-dark-theme] .dpm.kb-page .kbst.v'))
  assert.ok(css.includes('.dpm.kb-page .kb-new[disabled]'))
})
