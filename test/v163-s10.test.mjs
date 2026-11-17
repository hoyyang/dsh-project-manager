/* v163 / S10：输入框「>」引用知识卡 + 胶囊（kbText / refKind kb / 知识卡组 / 点击定位 / 绿色胶囊） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FILE_REF_RX, kbText } from '../lib/quote.js'

const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const hostIndex = src('index.ts')
const composer = src('client/composer.ts')
const qmenu = src('client/qmenu.ts')
const clientIndex = src('client/index.ts')
const chipicon = src('client/chipicon.ts')
const icons = src('client/icons.ts')
const css = src('client/style.css')
const api = src('client/api.ts')

test('kbText：引用原文 =「“标题”知识卡（/abs/path/<id>.md）」；名字里的引号照 nm() 折成中文内层', () => {
  assert.equal(kbText('发版流水线', '/tmp/u/.dsh/dsh-project-manager/kb/kmwbjbkd00.md'), '「“发版流水线”知识卡（/tmp/u/.dsh/dsh-project-manager/kb/kmwbjbkd00.md）」')
  assert.equal(kbText('引号「测试」', '/a/kb/k1234.md'), '「“引号『测试』”知识卡（/a/kb/k1234.md）」')
})

test('嵌套边界：v154 的 FILE_REF_RX 不会误吃知识卡引用原文（「知识卡」三字把「”（」隔开）', () => {
  const t = kbText('发版流水线', '/a/kb/k1234.md')
  assert.equal(t.match(FILE_REF_RX), null, '知识卡引用不能被当成文件引用')
  // 文件引用照旧（回归）
  assert.ok('「“说明.md”（/a/b/说明.md）」'.match(FILE_REF_RX), '文件引用仍然命中')
})

test('refKind：知识卡在 RX_FILE 之前认成 kb；胶囊外观 / 图标 / 反引号前的图标 id 都接上', () => {
  const i = composer.indexOf('const RX_KB')
  const j = composer.indexOf('const RX_FILE')
  const k = composer.indexOf("if (RX_KB.test(ref)) return 'kb'")
  const f = composer.indexOf("if (RX_FILE.test(ref)) return 'file'")
  assert.ok(i > 0 && j > i, 'RX_KB 声明在 RX_FILE 之前')
  assert.ok(k > 0 && f > k, 'refKind 先判 kb 再判 file')
  assert.ok(composer.includes("export function refKind(ref: string): 'note' | 'link' | 'file' | 'repo' | 'card' | 'sess' | 'kb'"))
  assert.ok(composer.includes("{ kind: 'kb', rx: /"), 'firstRef 的 RX 表里也认 kb（胶囊 / 点击走同一条）')
  assert.ok(composer.includes("kb: 'dpm-kb'"), 'appearance')
  assert.ok(composer.includes("'cards', 'chat', 'kb']"), 'CSS mask 的图标 id 列表带上 kb')
  assert.ok(chipicon.includes("if (kind === 'kb') return 'kb'"), '胶囊图标 = 开卷书')
  assert.ok(icons.includes("kb: '<path d="), '开卷书字形在 icons.ts')
})

test('host：/session 的 cardInfo 带本卡挂载的知识卡（prompt 类连带正文，供「>」插正文）', () => {
  assert.ok(hostIndex.includes('kb: (c.kb ?? []).flatMap((a) => { const x = kb.get(a.id); return x ? ['))
  assert.ok(hostIndex.includes("...(x.type === 'prompt' ? { body: x.body } : {})"))
  assert.ok(hostIndex.includes('summary: kb.summaryOf(x)'))
  assert.ok(api.includes('kb?: KbRef[]'))
  assert.ok(api.includes('export interface KbRef { id: string; title: string; type: KbType; status: KbStatus; summary: string; path: string; body?: string }'))
})

test('「>」菜单：知识卡一组（本卡挂载的在前）+ 输入词走 /kb/search 补前 8 条；prompt 插正文', () => {
  /* v165：数据口径留在 qmenu.buildQuoteRows，外壳换成引用伴手弹窗 */
  assert.ok(qmenu.includes("key: 'kb', name: '知识卡', icon: 'kb'"), '知识卡组')
  /* v179：知识卡行改成先算 ids（再按正文二段式补「N 段」），挂在面板条目的知识卡组里 */
  assert.ok(qmenu.includes('items: kbIds.map((k) => kbRow(k as KbRef))'), '本卡挂载的在前')
  assert.ok(qmenu.includes('text: prompt ? body : kbText(k.title, k.path)'), 'prompt 插正文，其余插引用原文')
  assert.ok(qmenu.includes('searchKb(q, { limit: 12 })'))
  assert.ok(qmenu.includes('this.kbHits.filter((x) => !have.has(x.id)).slice(0, 8)'), '搜到的前 8 条，去掉已挂的')
  assert.ok(qmenu.includes('g.items = g.items.concat(add)'), '并进同一个知识卡组')
  assert.ok(qmenu.includes('this.kbQueue()'), '输入变化就去搜')
  assert.ok(qmenu.includes('openQuotePanel({'), '外壳 = 同一块面板')
})

test('胶囊：绿色（浅 / 深），其余引用保持蓝色', () => {
  assert.ok(css.includes('[data-composer-chip="dsh-project-manager"][data-dpm-kind="kb"] > span {'), '浅色绿胶囊')
  assert.ok(css.includes('body[data-ds-dark-theme] [data-composer-chip="dsh-project-manager"][data-dpm-kind="kb"] > span {'), '深色绿胶囊')
  assert.ok(css.includes('background: #eefaf2'), '与知识库入口同一套绿')
})

test('点胶囊 = 切到知识库页并定位这张卡（文件名 = id）', () => {
  assert.ok(clientIndex.includes("if (hit.kind === 'kb') {"))
  assert.ok(clientIndex.includes('kbOpen({ cardId: id }); ctx.layout.selectPanel(KB)'))
  assert.ok(clientIndex.includes("/([^/]+)\\.md$/"), '路径 → id 用文件名')
})
