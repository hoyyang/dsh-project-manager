/* v163 S9：项目卡详情「知识卡」一节（类型图标 + 标题 + 摘要 + 三档 + 移除；搜索添加 / 就地新建草稿）+ 知识库页「挂到项目卡」 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const board = src('board.ts')
const kb = src('kb.ts')
const index = src('index.ts')
const css = src('style.css')
const api = src('api.ts')

test('数据：Card.kb（id + 三档 mode）进 client 类型，档位口径与 host kbMode 同一套', () => {
  assert.ok(api.includes("kb?: Array<{ id: string; mode?: 'full' | 'sum' | 'off' }>"))
  assert.ok(kb.includes('export const KB_MODE_LABEL: Record<KbMode, string> = { full: 全文, sum: 摘要, off: 不注入 }'.replace(/全文/, "'全文'").replace(/摘要/, "'摘要'").replace(/不注入/, "'不注入'")))
  assert.ok(kb.includes('export const kbEffMode'))
  assert.ok(kb.includes("FULL_TYPES.has(type) ? 'full' : 'sum'"))
})

test('位置：详情里「知识卡」一节紧跟「相关说明」，「关联的落盘项目」之前', () => {
  assert.ok(board.includes('this.notesHtml(c, ro) + this.kbSecHtml(c, ro) + this.webLinksHtml(c, ro)'))
  assert.ok(board.includes("'<section class=\"sec\" id=\"dpmKbSec\"><h3>' + BOOK_SVG + '知识卡 · ' + list.length"))
})

test('行：类型图标 + 标题（点它跳知识库）+ 类型·状态 + 摘要一行 + 移除', () => {
  assert.ok(board.includes('data-kb-open="'), '标题按钮 = 打开知识库并定位这张卡')
  assert.ok(board.includes("'<span class=\"kbg\">' + (KB_TYPE_GLYPH[type] ?? '')"), '类型图标复用 KB_TYPE_GLYPH')
  assert.ok(board.includes('class="m2">'), '摘要一行')
  assert.ok(board.includes('esc(k?.summary ?? '), '摘要把 /kb 列表的 summary 画出来')
  assert.ok(board.includes('data-kb-rm="'), '移除按钮')
})

test('三档：全文 / 摘要 / 不注入，缺省档位按类型并打 data-def 细描边', () => {
  assert.ok(board.includes("(['full', 'sum', 'off'] as KbMode[])"))
  assert.ok(board.includes('data-kb-mode="'), '三档按钮各自带 data-kb-mode')
  assert.ok(board.includes('data-kb-mid="'), '按钮同时记着是哪张知识卡')
  assert.ok(board.includes("(mode ? '' : ' data-def=\"1\"')"))
  assert.ok(board.includes('KB_MODE_HINT[m]'))
})

test('添加：搜索选择器走 /kb/search（160ms 防抖），点候选 = card/kb 挂上；「新建草稿并挂上」交给知识库页', () => {
  assert.ok(board.includes("this.kbAdd = { card: c.id, q: '' }"))
  assert.ok(board.includes('await searchKb(q, { limit: 20 })'))
  assert.ok(board.includes('window.setTimeout(() => void this.kbAddSearch(), 160)'))
  assert.ok(board.includes("await this.act('card/kb', { id: c.id, kb: next }, '已挂上「'"))
  assert.ok(board.includes('data-kb-new-card="'), '就地新建：把请求交给知识库页的新建表单')
  assert.ok(board.includes('this.host.openKb({ newCard: c.id })'))
})

test('改动都走 card/kb；移除带 7 秒式撤销（撤销 = 把原清单写回）', () => {
  assert.ok(board.includes("this.act('card/kb', { id: c.id, kb: next }, '「'"),
  )
  assert.ok(board.includes("this.host.toast('已从这张卡片移除「' + (k?.title ?? id) + '」· 知识卡本身还在知识库里', 'ok', { label: '撤销'"))
})

test('归档只读：只读详情没有「+ 添加」与「移除」，行也不出移除按钮', () => {
  assert.ok(board.includes("const add = ro ? '' : this.hbtn('plus', '添加知识卡（搜索已有 / 就地新建草稿）', 'data-kb-add')"))
  assert.ok(board.includes("+ (ro ? '' : '<button type=\"button\" class=\"ib sm krm\" data-kb-rm=\"'"))
})

test('跳转接线：openKb（cardId / newCard）→ index.ts 切到知识库面板；知识库页取请求定位 / 开新建表单', () => {
  assert.ok(board.includes('openKb?(o: { cardId?: string; newCard?: string }): void'))
  assert.ok(index.includes('kbOpen, kbPage'))
  assert.ok(index.includes('openKb: (o) => { kbOpen(o); ctx.layout.selectPanel(KB) }'))
  assert.ok(kb.includes('export function kbOpen(o: KbReq): void'))
  assert.ok(kb.includes("document.addEventListener('dpm:kb-open', takeReq)"))
  assert.ok(kb.includes("if (r.newCard) { openKbEditor({ mode: 'new', source: 'board', attachCard: r.newCard, toast: (m, k) => opts.toast(m, k) }); return }"))
  assert.ok(kb.includes('if (r.cardId) select(r.cardId)'))
})

test('知识库页也能挂 / 移除：选择器读 getState 的项目卡，点行 = card/kb 增删；新建后自动挂上', () => {
  assert.ok(kb.includes("data-kbatt-open"))
  assert.ok(kb.includes("data-kbatt-pick=\"' + esc(r.id)"))
  assert.ok(kb.includes('await post(\'card/kb\', { id: cardId, kb: next })'))
  assert.ok(kb.includes('const attachNew = async (cardId: string, kbId: string)'))
  assert.ok(kb.includes('const attachTo = isNew ? st.attach : '))
})

test('样式：详情一节的网格行 / 三档 / 选择器 + 知识库页的挂载选择器', () => {
  assert.ok(css.includes('#dpmKbSec .kbrw { display: grid;'))
  assert.ok(css.includes('#dpmKbSec .kbm button.on[data-def]'))
  assert.ok(css.includes('#dpmKbSec .kbadd-i'))
  assert.ok(css.includes('.dpm.kb-page .kbatt-i'))
})
