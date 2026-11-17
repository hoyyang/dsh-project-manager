/* v163 S8：知识库页 新建 / 编辑（正文 mountNoteDoc）/ 状态三按钮 / 删除 7 秒撤销（postKb 写盘） */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const kb = src('kb.ts')
const css = src('style.css')

test('写盘：四个动作都走 postKb（create / update / remove / restore），S4 备好的 api 才开始被调用', () => {
  assert.ok(kb.includes("import { getKb, getKbCard, getState, post, postKb, searchKb } from './api.js'"))
  assert.ok(kb.includes("await postKb('create', payload)"))
  assert.ok(kb.includes("await postKb('update', { id: st.editing, ...payload })"))
  assert.ok(kb.includes("await postKb('update', { id: k.id, status: s })"))
  assert.ok(kb.includes("await postKb('remove', { id: k.id })"))
  assert.ok(kb.includes("await postKb('restore', { id: u.id })"))
})

test('状态三按钮：读态 action row = 编辑 + 草稿/已验证/过时 + 删除；点当前档不重复提交', () => {
  assert.ok(kb.includes('class="kbd-acts"'))
  assert.ok(kb.includes("(['draft', 'verified', 'stale'] as KbStatus[]).map"))
  assert.ok(kb.includes("data-kbst2="))
  assert.ok(kb.includes("if (k.status === s) { opts.toast('已经是「' + STATUS[s] + '」'); return }"))
  assert.ok(kb.includes('data-kbdel='))
})

test('新建 / 编辑共用一张表单：字段齐 + 未填标题拦下 + 保存失败不重渲染（输入保留）', () => {
  for (const f of ['title', 'type', 'tags', 'summary']) assert.ok(kb.includes('data-kbf="' + f + '"'), f)
  assert.ok(kb.includes('data-role="nd"'))
  assert.ok(kb.includes('const editHtml = (): string =>'))
  assert.ok(kb.includes("const isNew = st.editing === 'new'"))
  assert.ok(kb.includes("if (!title) { opts.toast('标题不能为空', 'err'); focusTitle(); return }"))
  assert.ok(kb.includes('保存失败不动表单'))
  assert.ok(kb.includes("const splitTags = (s: string): string[] => s.split("))
  assert.ok(readFileSync(new URL('../src/client/kbdlg.ts', import.meta.url), 'utf8').includes("const FULL_TYPES = new Set<string>(['prompt', 'howto', 'snippet'])"))
})

test('正文 = 任务说明那套块编辑器：挂到 data-role=nd，占位走 data-gt-ph（v164 起走 mountRichNote）', () => {
  assert.ok(kb.includes("import { mountRichNote, type RichNote, type ChipItem } from './richnote.js'"))
  assert.ok(kb.includes('nd = mountRichNote(box, {'))
  assert.ok(kb.includes('if (st.draft.body) nd.set(st.draft.body)'))
  assert.ok(kb.includes('body: nd ? nd.text() : st.draft.body'))
  assert.ok(kb.includes('<span class="gt-ph" data-gt-ph aria-hidden="true">'))
})

test('删除撤销：7 秒撤销条（.kb-undo）+ 撤销走 restore + 位序回到删除前；卸载清计时器', () => {
  assert.ok(kb.includes("box.className = 'kb-undo'"))
  assert.ok(kb.includes('data-kbundo'))
  assert.ok(kb.includes('data-kbundox'))
  assert.ok(kb.includes('}, 7000)'))
  assert.ok(kb.includes("if (undoT) { clearTimeout(undoT); undoT = undefined }"))
  assert.ok(kb.includes('const idx = Math.max(0, st.cards.findIndex((x) => x.id === k.id))'))
  assert.ok(kb.includes('showUndo({ id: k.id, title: k.title, idx })') || kb.includes('showUndo({ id: k.id'))
})

test('入口：页头「新建知识卡」与空态「新建第一张知识卡」都可用，点了进新建表单', () => {
  assert.ok(kb.includes('class="kb-new" type="button" data-kbnew'))
  assert.ok(!kb.includes('disabled title="新建知识卡在下一步（S8）接入"'))
  assert.ok(kb.includes('class="kb-go" type="button" data-kbnew'))
  assert.ok(kb.includes("if (t.closest('[data-kbnew]')) { openKbEditor({ mode: 'new', source: 'page', toast: (m, k) => opts.toast(m, k) }); return }"))
  assert.ok(kb.includes('st.editing = \'new\''))
})

test('CSS：编辑态 .kbe / 块编辑器容器 / 状态胶囊 / 撤销条（照搬原型 v163）', () => {
  for (const s of ['.dpm.kb-page .kbe {', '.dpm.kb-page .kbe input', '.dpm.kb-page .kbe .row2', '.dpm.kb-page .kbe .ndoc {', '.dpm.kb-page .kbe .nblk {', '.dpm.kb-page .kbset', '.dpm.kb-page .kbd-acts .kbd-del', '.dpm.kb-page .kb-undo {', '@keyframes kbundoin', 'body[data-ds-dark-theme] .dpm.kb-page .kbd-acts .kbd-del']) assert.ok(css.includes(s), s)
  assert.ok(css.includes('.dpm.kb-page { position: relative; }'))
})
