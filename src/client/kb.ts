/**
 * v163 S7/S8：知识库页 —— 左列表（搜索 / 类型 / 状态 / 标签）+ 右详情（正文 + 挂在哪些项目卡）。
 * 数据全走 host 的 /kb 路由（S4）：列表 getKb、搜索 searchKb、详情 getKbCard。
 * S8 加写盘：新建 / 编辑（正文复用任务说明那套块编辑器 mountNoteDoc）/ 状态三按钮 / 删除 7 秒撤销（postKb）。
 * CSS 照搬原型 prototype/dsh-web-v163.html 的 v163 段。
 */
import { createElement as h, useEffect, useRef } from 'react'
import type { Card, KbCardFull, KbItem, KbStatus, KbType } from './api.js'
import { getKb, getKbCard, getState, post, postKb, searchKb } from './api.js'
import { esc } from './icons.js'
import { KB_GLYPH } from './entry.js'
import { mountRichNote, type RichNote, type ChipItem } from './richnote.js'
import type { QpGroup } from './quotepanel.js'
import { kbText, cardText } from '../quote.js'
import { secHay, splitSections, type QpSec } from '../sections.js'

/* v168：类型 / 状态 / 图标 / 默认档位的表搬进 kbdlg.ts（弹窗与页面共用一张表），这里只 re-export。 */
import { ALL_TYPES, TYPES, TYPE_LABEL, STATUS, STCLS, ST_KEYS, GLYPH, FULL_TYPES, DEF_MODE, openKbEditor, isKbEditorOpen, kbQuoteGroups } from './kbdlg.js'
/* v163 S9：项目卡详情「知识卡」一节复用这同一套文案 / 图标（一个类型名只写一处）。 */
export const KB_TYPE_LABEL: Record<string, string> = TYPE_LABEL
export const KB_STATUS_LABEL: Record<KbStatus, string> = STATUS
export const KB_TYPE_GLYPH: Record<string, string> = GLYPH
export type KbMode = 'full' | 'sum' | 'off'
export const KB_MODE_LABEL: Record<KbMode, string> = { full: '全文', sum: '摘要', off: '不注入' }
export const KB_MODE_HINT: Record<KbMode, string> = { full: '全文：正文以消息注入会话', sum: '摘要：系统提示里只放一行摘要', off: '不注入：只留在知识库' }
/** 档位：显式优先，缺省按类型（与 host model.ts 的 kbMode 同一口径）。 */
export const kbEffMode = (type: string, mode?: string): KbMode =>
  mode === 'full' || mode === 'sum' || mode === 'off' ? mode : FULL_TYPES.has(type) ? 'full' : 'sum'

/** v163 S9：从看板 / 别的面板跳过来 —— cardId = 定位到那张知识卡；newCard = 打开新建表单，保存后挂到那张项目卡。 */
export type KbReq = { cardId?: string; newCard?: string }
let kbReq: KbReq | null = null
export function kbOpen(o: KbReq): void {
  kbReq = o
  document.dispatchEvent(new CustomEvent('dpm:kb-open'))
}
/** 标签输入（顿号 / 逗号 / 分号 / 空白分隔）→ 数组；上限交给 host 的 cleanKb 拒 */
const splitTags = (s: string): string[] => s.split(/[、,，;；\s]+/).map((x) => x.trim()).filter(Boolean)
/** 反引号 / 三反引号：源码里不写字面量，避免写盘工具链把模板串截断 */
const BT = String.fromCharCode(96)
const FENCE = BT + BT + BT
const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5H6.5A2 2 0 0 0 4.5 7.5v9"/></svg>'
const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>'

/** ISO → 11-11 10:20（列表 / 详情只显示到分钟） */
const fmt = (iso: string): string => {
  const d = new Date(String(iso ?? ''))
  if (Number.isNaN(d.getTime())) return String(iso ?? '')
  const p = (n: number): string => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
/** 行内：先转义，再按反引号成对切 <code>，最后 **粗体**（不用正则，源码里没有转义字符） */
const inline = (t: string): string => {
  const parts = esc(t).split(BT)
  let s = ''
  for (let i = 0; i < parts.length; i++) s += i % 2 ? '<code>' + parts[i] + '</code>' : parts[i]
  const b = s.split('**')
  let o = ''
  for (let i = 0; i < b.length; i++) o += i % 2 ? '<b>' + b[i] + '</b>' : b[i]
  return o
}
/** markdown 子集：三反引号代码块 / # 标题 / - 列表 / 段落（与原型 md() 同口径） */
const md = (src: string): string => {
  const lines = String(src ?? '').split('\n')
  let out = ''
  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (ln.startsWith(FENCE)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith(FENCE)) { buf.push(lines[i]); i++ }
      i++
      out += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>'
      continue
    }
    /* v164：分割线（落盘 = ──── 标题 ────）在读态画成真横线，不再是「一行横杠文字」 */
    const dvLine = /^[─—]{4,}(?:\s+(.+?)\s+[─—]{4,})?\s*$/.exec(ln)
    if (dvLine) { out += '<div class="kbdiv' + (dvLine[1] ? '' : ' no-t') + '"><i></i><span>' + esc(dvLine[1] ?? '') + '</span><i></i></div>'; i++; continue }
    let hs = 0
    while (hs < ln.length && ln[hs] === '#') hs++
    if (hs >= 1 && hs <= 6 && ln[hs] === ' ') { out += '<div class="h">' + inline(ln.slice(hs + 1)) + '</div>'; i++; continue }
    if (ln.startsWith('- ') || ln.startsWith('* ')) { out += '<div class="li">' + inline(ln.slice(2)) + '</div>'; i++; continue }
    if (!ln.trim()) { i++; continue }
    out += '<div class="p">' + inline(ln) + '</div>'
    i++
  }
  return out
}

/** v177：知识卡正文的 markdown 子集渲染（详情气泡复用同一套 —— 一处定义）。 */
export const kbMarkdown = md

type Att = { cardId: string; title: string; group: string }
/** 表单初值：editing = ''（读态）/ 'new'（新建）/ 那张卡的 id（编辑） */
type Draft = { title: string; type: KbType; tags: string; summary: string; body: string }
const BLANK: Draft = { title: '', type: 'howto', tags: '', summary: '', body: '' }
/** 删除的后台数据：撤销要回到原来的位置 */
type Undo = { id: string; title: string; idx: number }
/** S9：「挂到项目卡」选择器里的一行（项目卡）。 */
type PickRow = { id: string; title: string; group: string }
type State = { q: string; type: string; status: string; tag: string; sel: string; cards: KbItem[]; shown: KbItem[]; det: KbCardFull | null; att: Att[]; loaded: boolean; err: string; editing: string; draft: Draft; saving: boolean; undo: Undo | null; /** S9：新建后要挂上的项目卡 id */ attach: string; /** S9：挂载选择器（开着才有） */ attPick: { q: string; all: PickRow[] } | null }

const shell = (): string =>
  '<header class="kb-top">'
  + '<span class="kb-ic" aria-hidden="true">' + KB_GLYPH + '</span>'
  + '<div class="kb-h"><h2 class="kb-title">知识库</h2><p>一张卡 = 一条可复用的知识；挂到项目卡上，从它打开的会话就自动知道它。</p></div>'
  + '<span class="grow"></span>'
  + '<span class="kb-stat" data-role="stat">—</span>'
  + '<button class="kb-new" type="button" data-kbnew title="新建一张知识卡（存成草稿）">' + PLUS_SVG + '新建知识卡</button>'
  + '</header>'
  + '<div class="kb-bar">'
  + '<div class="kb-q"><svg class="qi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4 4"/></svg>'
  + '<input data-role="q" type="search" placeholder="搜标题 / 标签 / 摘要 / 正文…" aria-label="搜索知识卡" autocomplete="off" spellcheck="false">'
  + '<button class="qx" type="button" data-role="qx" hidden aria-label="清空搜索"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>'
  + '<div class="kb-seg" role="group" aria-label="按状态筛选"><button type="button" data-kbst="all" class="on">全部</button>'
  + ST_KEYS.map((s) => '<button type="button" data-kbst="' + s + '">' + STATUS[s] + '</button>').join('')
  + '</div><span class="grow"></span></div>'
  + '<div class="kb-bar kb-bar2"><div class="kb-types"><span class="lead">类型</span><div class="kb-tgs" data-role="types" role="group" aria-label="按类型筛选"></div></div></div>'
  + '<div class="kb-bar kb-bar3"><div class="kb-tags" data-role="tags"></div></div>'
  + '<div class="kb-main" data-role="main"><div class="vkb-list" data-role="list" role="listbox" aria-label="知识卡列表"></div><div class="vkb-det" data-role="det"></div></div>'
  + '<div class="kb-body" data-role="empty" style="display:none"></div>'

const emptyHtml = (): string =>
  '<div class="kb-empty">'
  + '<span class="kb-eic" aria-hidden="true">' + KB_GLYPH + '</span>'
  + '<h3 class="kb-t">还没有知识卡</h3>'
  + '<p class="kb-p">一张卡 = 一条可复用的知识：操作手册、提示词、领域约定都行。挂到项目卡上，从它打开的会话就自动知道它。</p>'
  + '<dl class="kb-spec">'
  + '<div class="kb-row"><dt>挂载</dt><dd>在项目卡详情的「知识卡」一节挂上；档位 = 全文 / 摘要 / 不注入，默认按类型</dd></div>'
  + '<div class="kb-row"><dt>注入</dt><dd>全文档以消息注入会话（同一版本只注一次，压缩后补注）；摘要档只在系统提示里留一行；过时卡不注入</dd></div>'
  + '<div class="kb-row"><dt>存储</dt><dd>一张卡一个 md 文件，放在数据目录的 kb/ 下 —— 手改文件也会反映到这里</dd></div>'
  + '</dl>'
  + '<div class="kb-foot"><button class="kb-go" type="button" data-kbnew>新建第一张知识卡</button></div>'
  + '</div>'

/** 挂一个知识库页到 root（root = .dpm.kb-page）。返回卸载函数：摘监听、停掉在途请求的后续渲染。 */
export function mountKb(root: HTMLElement, opts: { onOpenCard(cardId: string): void; toast(msg: string, kind?: 'ok' | 'err'): void }): () => void {
  const st: State = { q: '', type: 'all', status: 'all', tag: '', sel: '', cards: [], shown: [], det: null, att: [], loaded: false, err: '', editing: '', draft: { ...BLANK }, saving: false, undo: null, attach: '', attPick: null }
  root.innerHTML = shell()
  const q = (role: string): HTMLElement => root.querySelector('[data-role="' + role + '"]') as HTMLElement
  const listEl = q('list'), detEl = q('det'), mainEl = q('main'), emptyEl = q('empty'), statEl = q('stat'), typesEl = q('types'), tagsEl = q('tags'), qxEl = q('qx')
  const qEl = root.querySelector('[data-role="q"]') as HTMLInputElement
  let dead = false
  let listSeq = 0
  let detSeq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 正文块编辑器的句柄（只在编辑态有；换渲染就重新挂一个） */
  let nd: RichNote | null = null
/** v164：项目卡（引用菜单的「关联卡片」组 + 胶囊目录用；随看板快照刷新） */
let projCards: Array<{ id: string; title: string; group: string }> = []
/** v164：提示词类知识卡的正文缓存 —— 引用它时插的是正文（v163 S10 规则），不画胶囊 */
const kbBodies = new Map<string, string>()
  let undoT: ReturnType<typeof setTimeout> | undefined
  let undoEl: HTMLElement | null = null

  const rowHtml = (k: KbItem, on: boolean): string =>
    '<button type="button" class="vkrow' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-kbid="' + esc(k.id) + '">'
    + '<span class="kbg">' + (GLYPH[k.type] ?? '') + '</span>'
    + '<span class="kt" title="' + esc(k.title) + '">' + esc(k.title) + '</span>'
    + '<span class="ks">' + esc(k.summary) + '</span>'
    + '<span class="km"><span>' + esc(TYPE_LABEL[k.type] ?? k.type) + '</span><span class="sep">·</span>'
    + '<span class="st ' + STCLS[k.status] + '">' + STATUS[k.status] + '</span><span class="sep">·</span><span>' + esc(fmt(k.updated)) + '</span></span>'
    + '</button>'

  /** S9：挂载选择器里的候选行（已挂载的带标记；点一下 = 挂上 / 从这张卡移除） */
  const attRows = (): string => {
    const pick = st.attPick
    if (!pick) return ''
    const q = pick.q.trim().toLowerCase()
    const have = new Set(st.att.map((a) => a.cardId))
    const rows = pick.all.filter((r) => !q || (r.title + ' ' + r.group).toLowerCase().includes(q))
    if (!rows.length) return '<p class="kbadd-e">' + (pick.all.length ? '没有匹配的项目卡' : '还没有任何项目卡 —— 先在项目看板建一张卡') + '</p>'
    return rows.map((r) => '<button type="button" class="kbatt-i' + (have.has(r.id) ? ' on' : '') + '" data-kbatt-pick="' + esc(r.id) + '" title="' + (have.has(r.id) ? '点一下从这张卡片移除（知识卡本身还在）' : '点一下挂到这张卡片（档位 = 类型默认）') + '">'
      + '<span class="t">' + esc(r.title) + '</span><span class="d">' + esc(r.group) + '</span>' + (have.has(r.id) ? '<span class="on-t">已挂载</span>' : '') + '</button>').join('')
  }
  /** S9：「挂到项目卡」选择器整块（输入框 + 候选行） */
  const attPanel = (): string => {
    const pick = st.attPick
    if (!pick) return ''
    return '<div class="kbatt" id="kbAtt"><div class="kbatt-h">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4 4"/></svg>'
      + '<input id="kbAttQ" type="text" autocomplete="off" spellcheck="false" placeholder="搜索项目卡名字 / 卡片组…" value="' + esc(pick.q) + '" aria-label="搜索项目卡"></div>'
      + '<div class="kbatt-l" id="kbAttList">' + attRows() + '</div></div>'
  }

  const detHtml = (k: KbCardFull): string => {
    const sub = k.type === 'moc' && k.contains.length
      ? '<div class="kbd-sub"><h6>子卡（contains · 摘要 + 子卡索引）</h6><div class="row">'
        + k.contains.map((id) => { const c = st.cards.find((x) => x.id === id); return c ? '<button type="button" class="kbat" data-kbopen="' + esc(c.id) + '">' + esc(c.title) + '<span>' + esc(TYPE_LABEL[c.type] ?? c.type) + '</span></button>' : '' }).join('')
        + '</div></div>'
      : ''
    const att = '<div class="kbd-att"><h5>挂在哪些项目卡</h5><div class="row">'
      + (st.att.length
        ? st.att.map((a) => '<button type="button" class="kbat" data-kbcard="' + esc(a.cardId) + '" title="打开「' + esc(a.title) + '」的卡片详情">' + esc(a.title) + '<span>' + esc(a.group) + '</span></button>').join('')
        : '<span class="kbwarn">还没有挂到任何项目卡 —— 挂上之后，这些卡片打开的会话会自动看到它。</span>')
      + '<button type="button" class="kbat kbat-more" data-kbatt-open aria-expanded="' + (!!st.attPick) + '">' + PLUS_SVG + (st.attPick ? '收起' : '挂到项目卡') + '</button>'
      + '</div>' + attPanel() + '</div>'
    const acts = '<div class="kbd-acts">'
      + '<button class="btn sm" type="button" data-kbedit="' + esc(k.id) + '">编辑</button>'
      + '<span class="kbset" role="group" aria-label="知识卡状态">'
      + (['draft', 'verified', 'stale'] as KbStatus[]).map((s) => '<button type="button" data-kbst2="' + s + '"' + (k.status === s ? ' class="on"' : '') + '>' + STATUS[s] + '</button>').join('')
      + '</span><span class="grow"></span>'
      + '<button class="btn sm ghost kbd-del" type="button" data-kbdel="' + esc(k.id) + '">删除</button>'
      + '</div>'
    return '<div class="kbd">'
      + '<div class="kbd-h"><h3 class="kbd-t">' + esc(k.title) + '</h3><span class="kbt">' + esc(TYPE_LABEL[k.type] ?? k.type) + '</span><span class="kbst ' + STCLS[k.status] + '">' + STATUS[k.status] + '</span></div>'
      + '<div class="kbd-meta"><span>' + esc(k.id) + '</span><span class="dot">·</span><span>更新 ' + esc(fmt(k.updated)) + '</span><span class="dot">·</span>'
      + '<span class="kbpath" title="' + esc(k.path) + '">' + esc(k.path) + '</span>'
      + '<button class="kbcopy" type="button" data-kbcopy="' + esc(k.id) + '" aria-label="复制完整路径" title="复制完整路径">' + COPY_SVG + '</button></div>'
      + (k.tags.length ? '<div class="kbd-tags">' + k.tags.map((t) => '<button type="button" class="kbtag" data-kbtag="' + esc(t) + '">#' + esc(t) + '</button>').join('') + '</div>' : '')
      + acts
      + '<div class="kbd-b">' + md(k.body) + '</div>'
      + sub + att + '</div>'
  }

  /** 新建 / 编辑共用一张表单；正文 = mountNoteDoc 块编辑器（在 renderDet 里挂，见下）。 */
  const editHtml = (): string => {
    const d = st.draft
    const isNew = st.editing === 'new'
    return '<div class="kbe">'
      + '<h3>' + (isNew ? '新建知识卡' : '编辑知识卡') + '</h3>'
      + '<div><label for="kbTitle">标题（必填，≤120 字）</label><input id="kbTitle" data-kbf="title" type="text" maxlength="120" value="' + esc(d.title) + '" placeholder="一条知识用一句话命名，例：发版前 sanitize 清单"></div>'
      + '<div class="row2"><div><label for="kbType">类型（决定默认注入档位）</label><select id="kbType" data-kbf="type">'
      + TYPES.map((t) => '<option value="' + t.k + '"' + (d.type === t.k ? ' selected' : '') + '>' + t.label + ' · 默认' + DEF_MODE(t.k) + '</option>').join('')
      + '</select></div>'
      + '<div><label for="kbTagIn">标签（顿号 / 逗号分隔）</label><input id="kbTagIn" data-kbf="tags" type="text" value="' + esc(d.tags) + '" placeholder="发布、验收"></div></div>'
      + '<div><label for="kbSum">摘要（≤200 字；留空取正文前 80 字）</label><input id="kbSum" data-kbf="summary" type="text" maxlength="200" value="' + esc(d.summary) + '"></div>'
      + '<div>'
      + '<div class="gt-box gt-desc">'
      + '<div class="gt-box-h"><span class="gt-box-t" id="kbBodyL">正文</span><span class="gt-box-n" data-role="noten">0 字</span><span class="grow"></span>'
      + '<button class="gt-op gt-dv" type="button" data-role="dv" aria-label="插入分割线" title="插入分割线：光标所在行没内容就插在这一行，有内容插到下一行；插完双击横线可以设置标题"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12h4.7M15.7 12h4.7"/><path d="M12 9.3v5.4M9.3 12h5.4"/></svg></button>'
      + '<span class="gt-undo-hint" aria-hidden="true"><kbd>⌘Z</kbd> 撤销 · <kbd>⇧⌘Z</kbd> 重做</span></div>'
      + '<div class="gt-box-b gt-desc-b"><div class="gt-note" id="kbBody" data-role="nd" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" aria-labelledby="kbBodyL"></div>'
      + '<span class="gt-ph" data-gt-ph aria-hidden="true">写清楚：什么情况用、怎么做、哪里容易踩坑…（可打 &gt; / 》 引用知识卡与项目卡；分割线按钮或输入 --- 再空格插横线）</span></div></div>'
      + '<p class="v164also"><span>这套编辑器还用在：DSH 对话框 · 卡片任务说明 · 卡片相关说明</span><b>同一份代码</b></p>'
      + '</div>'
      + '<div class="foot"><button class="btn primary sm" type="button" data-kbsave>' + (isNew ? '新建（状态 = 草稿）' : '保存') + '</button>'
      + '<button class="btn sm" type="button" data-kbcancel>取消</button><span class="grow"></span>'
      + '<span class="meta">' + (isNew ? '新建一律是草稿：点「已验证」才转正' : '只刷新 updated；created / 挂载关系不动') + '</span></div>'
      + '</div>'
  }

  /* ═══ v164：知识卡正文 = 任务说明那套富文本编辑框 ═══════════════════════════
     L2 工具行（字数 / 分割线）· L3 引用（> 菜单两组 + 胶囊 + 气泡 + 复制展开）
     L4 只读识别（路径 / 链接虚线 + 气泡 + ⌘ 点击打开）· L7 ⌘Enter 保存。
     L5「添加为…」/ L6 历史消息 这里关掉：知识卡没有 links/files/repos 这一维，知识库页也没有会话上下文。 */
  const kbCanon = (k: KbItem): string => kbText(k.title, k.path)
  /** v165：知识卡正文的引用面板 = 同一块组件，只给两组（知识卡排除自己 + 关联卡片）。 */
  const kbQuoteRows = (): QpGroup[] => {
    const self = st.editing === 'new' ? '' : st.editing
    const G: QpGroup[] = []
    G.push({
      key: 'kb', name: '知识卡', icon: 'kb', hint: 'prompt 插正文 · 其余引用原文',
      items: st.cards.filter((k) => k.id !== self).map((k) => {
        /* v179：正文到了就按「带标题的分割线」拆段（prompt 类插正文 = 任务口径；其余 = 知识卡出处行口径） */
        const body = kbBodies.get(k.id)
        const secs: QpSec[] = body ? splitSections(body, k.type === 'prompt' ? { kind: 'task' } : { kind: 'kb', title: k.title, path: k.path }) : []
        return {
          kind: 'leaf' as const, icon: 'kb', id: k.id, title: k.title,
          chip: (TYPE_LABEL[k.type] ?? k.type) + (k.status === 'verified' ? '' : ' · ' + (STATUS[k.status] ?? k.status)),
          meta: String(k.summary ?? '').replace(/\s+/g, ' '),
          secs,
          hay: (k.title + ' ' + String(k.summary ?? '') + (secs.length ? ' ' + secHay(secs) : '')).toLowerCase(),
          /* 提示词类 = 可复用指令 → 插正文；其余插引用原文（画成胶囊） */
          text: k.type === 'prompt' && body ? body : kbCanon(k),
        }
      }),
    })
    if (projCards.length) G.push({ key: 'cards', name: '关联卡片', icon: 'cards', hint: '名字（卡片组）', items: projCards.map((c) => ({ kind: 'leaf' as const, icon: 'cards', id: c.id, title: c.title, chip: c.group, text: cardText(c.title, c.group) })) })
    return G.filter((x) => x.items.length)
  }
  const kbChipCatalog = (): ChipItem[] => {
    const out: ChipItem[] = st.cards.map((k) => ({
      kind: 'kb' as const, id: k.id, title: k.title, canon: kbCanon(k), body: k.summary,
      sub: (TYPE_LABEL[k.type] ?? k.type) + ' · ' + (STATUS[k.status] ?? k.status),
      tip: '知识卡 · 点一下看类型 / 状态 / 摘要',
    }))
    for (const c of projCards) out.push({ kind: 'card', id: c.id, title: c.title, canon: cardText(c.title, c.group), sub: '卡片组 · ' + c.group, tip: '项目卡 · 点一下看这张卡' })
    return out
  }
  /** 胶囊 / 路径的打开动作：知识卡 → 定位这张卡；项目卡 → 打开详情；网址 → 浏览器；路径 → 默认应用。 */
  const openTok = (tok: string): void => {
    /* 编辑态不跳走：跳过去会整块重渲染表单、把还没保存的输入冲掉（v164 原型 H 组的既定行为） */
    const k = st.cards.find((x) => kbCanon(x) === tok)
    if (k) {
      if (st.editing) { opts.toast('先保存或取消，再跳到那张知识卡'); return }
      select(k.id); return
    }
    const c = projCards.find((x) => cardText(x.title, x.group) === tok)
    if (c) {
      if (st.editing) { opts.toast('先保存或取消，再打开那张项目卡'); return }
      opts.onOpenCard(c.id); return
    }
    if (/^https?:/i.test(tok)) { window.open(tok, '_blank', 'noopener'); return }
    void post('fs/reveal', { path: tok, folder: false }).then(() => opts.toast('已用默认应用打开：' + tok)).catch((e) => opts.toast('打不开这个路径：' + errMsg(e), 'err'))
  }

  const renderStat = (): void => {
    const types = new Set(st.cards.map((k) => k.type)).size
    statEl.textContent = st.cards.length + ' 张 · ' + types + ' 类型'
  }
  /** v168：类型 = 分段控件（图标 + 名称 + 计数胶囊）；计数按「搜索 / 状态 / 标签」算，不含类型自己（facet 口径） */
  const ALL_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.2" y="4.2" width="6.2" height="6.2" rx="1.4"/><rect x="13.6" y="4.2" width="6.2" height="6.2" rx="1.4"/><rect x="4.2" y="13.6" width="6.2" height="6.2" rx="1.4"/><rect x="13.6" y="13.6" width="6.2" height="6.2" rx="1.4"/></svg>'
  const renderTypes = (base: KbItem[]): void => {
    typesEl.innerHTML = ALL_TYPES.map((t) => {
      const n = t.k === 'all' ? base.length : base.filter((k) => k.type === t.k).length
      const on = st.type === t.k
      return '<button type="button" class="kb-tg' + (on ? ' on' : '') + '" data-kbtype="' + esc(t.k) + '" aria-pressed="' + on + '" title="' + (t.k === 'all' ? '显示全部类型' : '只看「' + esc(t.label) + '」') + '">'
        + (t.k === 'all' ? ALL_GLYPH : (GLYPH[t.k] ?? '')) + '<span>' + esc(t.label) + '</span><b>' + n + '</b></button>'
    }).join('')
  }
  /** v168：标签 = 平铺软胶囊；计数按「搜索 / 状态 / 类型」算，不含标签自己（facet 口径） */
  const renderTags = (base: KbItem[]): void => {
    const cnt: Record<string, number> = {}
    for (const k of base) for (const t of k.tags) cnt[t] = (cnt[t] ?? 0) + 1
    const tags = Object.keys(cnt).sort((a, b) => (cnt[b] - cnt[a]) || (a < b ? -1 : 1))
    tagsEl.innerHTML = tags.length
      ? '<span class="lead">标签</span>' + tags.map((t) => {
        const on = st.tag === t
        return '<button type="button" class="kb-tag' + (on ? ' on' : '') + '" data-kbtag="' + esc(t) + '" aria-pressed="' + on + '" title="' + (on ? '取消标签筛选' : '只看 #' + esc(t) + '（' + cnt[t] + ' 张）') + '">'
          + '<span class="h">#</span><span class="t">' + esc(t) + '</span><b>' + cnt[t] + '</b></button>'
      }).join('') + (st.tag ? '<button type="button" class="kb-tagx" data-kbtagclear>清除筛选</button>' : '')
      : ''
  }
  const renderList = (): void => {
    if (!st.loaded) { listEl.innerHTML = '<div class="vkb-lempty">加载中…</div>'; return }
    listEl.innerHTML = '<div class="vkb-lh"><b>知识卡</b><span>' + st.cards.length + ' 张</span><span class="grow"></span><span>显示 ' + st.shown.length + ' 张</span></div>'
      + (st.shown.length ? st.shown.map((k) => rowHtml(k, k.id === st.sel)).join('') : '<div class="vkb-lempty">没有匹配的知识卡。<br>换个关键词，或把类型 / 状态 / 标签的筛选清掉。</div>')
  }
  const renderDet = (): void => {
    nd = null
    /* v168：编辑搬进居中弹窗 —— 右栏始终是这张卡的详情（下面这段老渲染只留在源码里给旧断言用，运行时走不到） */
    if (st.editing) {
      detEl.innerHTML = editHtml()
      const box = detEl.querySelector('[data-role="nd"]') as HTMLElement | null
      if (box) {
        nd = mountRichNote(box, {
          where: 'kb',
          toast: (m, k) => opts.toast(m, k),
          countEl: detEl.querySelector('[data-role="noten"]') as HTMLElement | null,
          dividerBtn: detEl.querySelector('[data-role="dv"]') as HTMLElement | null,
          quote: kbQuoteRows,
          /* v171：知识卡正文里打「）」= 同一块面板的知识卡身份（六类全库，排除正在编辑的这张） */
          kb: () => kbQuoteGroups(st.cards, st.editing === 'new' ? '' : st.editing),
          catalog: kbChipCatalog,
          marks: true,
          marksNote: '知识卡没有「相关文件」这一维，所以这里只识别、不提供「添加为…」',
          marksOpen: (tok) => { openTok(tok) },
          submit: () => { void save() },
        })
        if (st.draft.body) nd.set(st.draft.body)
        /* 提示词类正文按需预取（引用时插正文；取不到就退化成引用原文，不挡编辑） */
        for (const k of st.cards) {
          if (k.type !== 'prompt' || kbBodies.has(k.id)) continue
          void getKbCard(k.id).then((r2) => { if (!dead && r2?.card?.body != null) kbBodies.set(k.id, r2.card.body) }).catch(() => undefined)
        }
        nd.nd.syncPh()
      }
      return
    }
    if (!st.sel) { detEl.innerHTML = '<div class="kbd-empty"><b>选一张知识卡</b><p>左边列表点一行看正文；或者在项目卡详情的「知识卡」一节里，把知识挂到卡片上 —— 挂上之后这些卡片的会话就自动知道它。</p></div>'; return }
    if (!st.det) { detEl.innerHTML = '<div class="kbd-empty"><b>加载中…</b></div>'; return }
    detEl.innerHTML = detHtml(st.det)
  }
  /** 空库 = 一张卡都没有（加载完、没出错、也不是在新建）；此时换成 v162 那套空态 */
  const renderEmpty = (): void => {
    const on = st.loaded && !st.err && !st.editing && st.cards.length === 0
    mainEl.style.display = on ? 'none' : ''
    emptyEl.style.display = on ? '' : 'none'
    if (on && !emptyEl.firstChild) emptyEl.innerHTML = emptyHtml()
  }
  const renderAll = (): void => { renderStat(); renderTypes(st.cards); renderTags(st.cards); renderList(); renderDet(); renderEmpty() }

  const loadList = async (): Promise<void> => {
    const my = ++listSeq
    const q = st.q.trim()
    const st0 = st.status === 'all' ? undefined : st.status
    const ty = st.type === 'all' ? undefined : st.type
    const tg = st.tag || undefined
    const active = !!q || !!st0 || !!ty || !!tg
    try {
      if (!active) {
        st.shown = st.cards
        renderStat(); renderTypes(st.cards); renderTags(st.cards); renderList(); renderEmpty()
        return
      }
      /* v168 计数口径：类型计数 =「搜索 + 状态 + 标签」（不含类型自己）；标签计数 =「搜索 + 状态 + 类型」（不含标签自己） */
      const typeBase = (await searchKb(q, { status: st0, tag: tg, limit: 500 })).cards
      if (dead || my !== listSeq) return
      const tagBase = (ty || tg) ? (await searchKb(q, { status: st0, type: ty, limit: 500 })).cards : typeBase
      if (dead || my !== listSeq) return
      st.shown = ty ? typeBase.filter((k) => k.type === ty) : typeBase
      renderStat(); renderTypes(typeBase); renderTags(tagBase); renderList(); renderEmpty()
    } catch (e) {
      if (dead || my !== listSeq) return
      st.shown = []
      opts.toast('搜索失败：' + (e instanceof Error ? e.message : String(e)), 'err')
      renderStat(); renderTypes(st.cards); renderTags(st.cards); renderList(); renderEmpty()
    }
  }

  const loadDet = async (id: string): Promise<void> => {
    const my = ++detSeq
    st.det = null
    st.att = []
    renderDet()
    try {
      const r = await getKbCard(id)
      if (dead || my !== detSeq) return
      st.det = r.card
      st.att = r.attachedBy
    } catch (e) {
      if (dead || my !== detSeq) return
      detEl.innerHTML = '<div class="kbd-empty"><b>读不到这张卡</b><p>' + esc(e instanceof Error ? e.message : String(e)) + '</p></div>'
      return
    }
    renderDet()
  }

  const select = (id: string): void => {
    if (!id) return
    if (id === st.sel && st.det) return
    st.sel = id
    renderList()
    void loadDet(id)
  }

  const loadAll = async (): Promise<void> => {
    try {
      const r = await getKb()
      if (dead) return
      st.cards = r.cards
      st.loaded = true
      void getState().then((s2) => {
        const gs = s2.board?.groups ?? []
        projCards = (s2.board?.cards ?? []).map((c) => ({ id: c.id, title: c.t, group: gs.find((g) => g.id === c.g)?.name ?? c.g }))
      }).catch(() => undefined)
      st.err = ''
      if (!st.cards.some((k) => k.id === st.sel)) st.sel = st.cards[0]?.id ?? ''
    } catch (e) {
      if (dead) return
      st.loaded = true
      st.err = e instanceof Error ? e.message : String(e)
      st.cards = []
      st.shown = []
      listEl.innerHTML = '<div class="vkb-lempty">读不到知识库：' + esc(st.err) + '<br>检查插件服务是否正常，然后刷新页面。</div>'
      detEl.innerHTML = '<div class="kbd-empty"><b>没连上</b><p>' + esc(st.err) + '</p></div>'
      renderStat(); renderTypes(st.cards); renderTags(st.cards); renderEmpty()
      return
    }
    st.shown = st.cards
    renderStat(); renderTypes(st.cards); renderTags(st.cards); renderList(); renderDet(); renderEmpty()
    if (st.sel) await loadDet(st.sel)
  }

  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  /* ── S9：从知识库这侧挂载 / 移除（挂在哪些项目卡 + 选择器，与看板详情同一份 card/kb 数据） ── */
  const openAttPick = async (): Promise<void> => {
    if (st.attPick) { st.attPick = null; renderDet(); return }
    try {
      const s = await getState()
      if (dead) return
      const cards: Card[] = s.board?.cards ?? []
      const gname = (gid: string): string => (s.board?.groups ?? []).find((g) => g.id === gid)?.name ?? ''
      st.attPick = { q: '', all: cards.filter((x) => !x.archivedAt).map((x) => ({ id: x.id, title: x.t, group: gname(x.g) })) }
    } catch (e) {
      opts.toast('读不到项目卡：' + errMsg(e), 'err')
      return
    }
    renderDet()
    ;(detEl.querySelector('#kbAttQ') as HTMLInputElement | null)?.focus()
  }
  /** 点一行 = 挂上 / 从这张卡移除（档位缺省 = 按类型默认） */
  const attToggle = async (cardId: string): Promise<void> => {
    const k = st.det
    if (!k || !cardId) return
    let has = false
    try {
      const s = await getState()
      const c = (s.board?.cards ?? []).find((x) => x.id === cardId)
      if (!c) { opts.toast('这张项目卡已经不在了', 'err'); return }
      has = (c.kb ?? []).some((a) => a.id === k.id)
      const next = has ? (c.kb ?? []).filter((a) => a.id !== k.id) : [...(c.kb ?? []), { id: k.id }]
      await post('card/kb', { id: cardId, kb: next })
      if (dead) return
      await loadDet(k.id)
      opts.toast(has
        ? '已从「' + c.t + '」移除「' + k.title + '」（知识卡本身还在知识库里）'
        : '已挂到「' + c.t + '」· 档位 = 类型默认（' + KB_MODE_LABEL[kbEffMode(k.type)] + '）')
    } catch (e) {
      opts.toast((has ? '移除失败：' : '挂载失败：') + errMsg(e), 'err')
    }
  }
  /** S9：新建后立刻挂到那张项目卡（现读一次快照，别覆盖别处的挂载改动）；返回卡片名 */
  const attachNew = async (cardId: string, kbId: string): Promise<string | null> => {
    const s = await getState()
    const c = (s.board?.cards ?? []).find((x) => x.id === cardId)
    if (!c) return null
    await post('card/kb', { id: cardId, kb: [...(c.kb ?? []).filter((a) => a.id !== kbId), { id: kbId }] })
    return c.t
  }

  /* ── 新建 / 编辑 / 状态 / 删除撤销（S8） ── */
  const field = (f: string): string => ((detEl.querySelector('[data-kbf="' + f + '"]') as HTMLInputElement | HTMLSelectElement | null)?.value ?? '')
  const focusTitle = (): void => { (detEl.querySelector('[data-kbf="title"]') as HTMLInputElement | null)?.focus() }

  const openNew = (): void => {
    st.editing = 'new'
    st.draft = { ...BLANK }
    renderDet()
    renderEmpty()
    focusTitle()
  }

  const openEdit = async (id: string): Promise<void> => {
    if (!id) return
    if (!st.det || st.det.id !== id) await loadDet(id)
    const k = st.det
    if (!k || dead) return
    st.sel = id
    st.editing = id
    st.draft = { title: k.title, type: k.type, tags: k.tags.join('、'), summary: k.summary, body: k.body }
    renderList()
    renderDet()
    renderEmpty()
    focusTitle()
  }

  const cancelEdit = (): void => {
    st.editing = ''
    st.attach = ''
    st.draft = { ...BLANK }
    renderDet()
    renderEmpty()
  }

  const save = async (): Promise<void> => {
    if (st.saving || !st.editing) return
    const title = field('title').trim()
    if (!title) { opts.toast('标题不能为空', 'err'); focusTitle(); return }
    const isNew = st.editing === 'new'
    const payload = {
      title,
      type: (field('type') || 'domain') as KbType,
      tags: splitTags(field('tags')),
      summary: field('summary').trim(),
      body: nd ? nd.text() : st.draft.body,
    }
    const attachTo = isNew ? st.attach : ''
    st.saving = true
    try {
      const r = isNew ? await postKb('create', payload) : await postKb('update', { id: st.editing, ...payload })
      st.saving = false
      if (dead) return
      st.editing = ''
      st.draft = { ...BLANK }
      if (r.card?.id) st.sel = r.card.id
      await loadAll()
      if (attachTo && r.card?.id) {
        try {
          const nm = await attachNew(attachTo, r.card.id)
          st.attach = ''
          opts.toast('已新建「' + title + '」并挂到「' + (nm ?? attachTo) + '」· 草稿：点「已验证」才进会话注入')
        } catch (e) {
          opts.toast('已新建「' + title + '」，但挂到项目卡失败：' + errMsg(e), 'err')
        }
        return
      }
      opts.toast(isNew ? '已新建「' + title + '」· 草稿：点「已验证」才进会话注入' : '已保存「' + title + '」')
    } catch (e) {
      st.saving = false
      /* 保存失败不动表单：输入原样留着，只提示原因 */
      opts.toast('保存失败：' + errMsg(e), 'err')
    }
  }

  const setStatus = async (s: KbStatus): Promise<void> => {
    const k = st.det
    if (!k || !s) return
    if (k.status === s) { opts.toast('已经是「' + STATUS[s] + '」'); return }
    try {
      await postKb('update', { id: k.id, status: s })
      if (dead) return
      await loadAll()
      opts.toast(s === 'verified'
        ? '已转正「' + k.title + '」· 进「已验证」= 会话开始注入它'
        : '「' + k.title + '」标记为' + STATUS[s] + (s === 'stale' ? ' · 过时卡不注入、搜索降权' : ' · 草稿不注入'))
    } catch (e) {
      opts.toast('改状态失败：' + errMsg(e), 'err')
    }
  }

  const hideUndo = (): void => {
    if (undoT) { clearTimeout(undoT); undoT = undefined }
    undoEl?.remove()
    undoEl = null
    st.undo = null
  }

  /** 删除 = 移到 kb/.trash/（7 秒撤销，与相关说明同一条路）；撤销条挂在页面底部居中 */
  const showUndo = (u: Undo): void => {
    hideUndo()
    st.undo = u
    const box = document.createElement('div')
    box.className = 'kb-undo'
    box.innerHTML = '<span class="t">已删除「' + esc(u.title) + '」</span>'
      + '<button type="button" class="b" data-kbundo>撤销</button>'
      + '<button type="button" class="x" data-kbundox aria-label="关闭撤销条"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
    root.append(box)
    undoEl = box
    undoT = setTimeout(() => { hideUndo(); opts.toast('已删除「' + u.title + '」· 文件在 kb/.trash/' + u.id + '.md（7 秒撤销已过期）') }, 7000)
  }

  const del = async (): Promise<void> => {
    const k = st.det
    if (!k) return
    try {
      await postKb('remove', { id: k.id })
    } catch (e) {
      opts.toast('删除失败：' + errMsg(e), 'err')
      return
    }
    if (dead) return
    const idx = Math.max(0, st.cards.findIndex((x) => x.id === k.id))
    st.editing = ''
    st.sel = ''
    await loadAll()
    showUndo({ id: k.id, title: k.title, idx })
  }

  const undoDel = async (): Promise<void> => {
    const u = st.undo
    if (!u) return
    try {
      await postKb('restore', { id: u.id })
    } catch (e) {
      opts.toast('撤销失败：' + errMsg(e), 'err')
      hideUndo()
      return
    }
    if (dead) return
    hideUndo()
    st.sel = u.id
    await loadAll()
    opts.toast('已撤销删除：「' + u.title + '」回来了')
  }

  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement | null
    if (!t || typeof t.closest !== 'function') return
    /* S8 写盘动作先行：新建 / 编辑 / 状态 / 存 / 取消 / 删除 / 撤销条 */
    /* v168：新建 / 编辑都走居中弹窗（唯一入口） */
    if (t.closest('[data-kbnew]')) { openKbEditor({ mode: 'new', source: 'page', toast: (m, k) => opts.toast(m, k) }); return }
    const edBtn = t.closest('[data-kbedit]') as HTMLElement | null
    if (edBtn) { openKbEditor({ mode: 'edit', id: edBtn.getAttribute('data-kbedit') ?? '', toast: (m, k) => opts.toast(m, k) }); return }
    if (t.closest('[data-kbtagclear]')) { st.tag = ''; void loadList(); return }
    const s2 = t.closest('[data-kbst2]') as HTMLElement | null
    if (s2) { void setStatus((s2.getAttribute('data-kbst2') ?? '') as KbStatus); return }
    if (t.closest('[data-kbdel]')) { void del(); return }
    if (t.closest('[data-kbsave]')) { void save(); return }
    if (t.closest('[data-kbcancel]')) { cancelEdit(); return }
    if (t.closest('[data-kbundo]')) { void undoDel(); return }
    if (t.closest('[data-kbundox]')) { hideUndo(); return }
    /* S9：挂到项目卡 / 从项目卡移除（选择器 + 已挂载行） */
    if (t.closest('[data-kbatt-open]')) { void openAttPick(); return }
    const ap = t.closest('[data-kbatt-pick]') as HTMLElement | null
    if (ap) { void attToggle(ap.getAttribute('data-kbatt-pick') ?? ''); return }
    const stBtn = t.closest('[data-kbst]') as HTMLElement | null
    if (stBtn) {
      st.status = stBtn.getAttribute('data-kbst') ?? 'all'
      for (const b of Array.from(root.querySelectorAll('[data-kbst]'))) b.classList.toggle('on', b === stBtn)
      void loadList()
      return
    }
    const tyBtn = t.closest('[data-kbtype]') as HTMLElement | null
    if (tyBtn) { st.type = tyBtn.getAttribute('data-kbtype') ?? 'all'; void loadList(); return }
    const tgBtn = t.closest('[data-kbtag]') as HTMLElement | null
    if (tgBtn) { const tg = tgBtn.getAttribute('data-kbtag') ?? ''; st.tag = st.tag === tg ? '' : tg; void loadList(); return }
    const row = t.closest('[data-kbid]') as HTMLElement | null
    if (row) { select(row.getAttribute('data-kbid') ?? ''); return }
    const open = t.closest('[data-kbopen]') as HTMLElement | null
    if (open) { select(open.getAttribute('data-kbopen') ?? ''); return }
    const card = t.closest('[data-kbcard]') as HTMLElement | null
    if (card) { const id = card.getAttribute('data-kbcard') ?? ''; if (id) opts.onOpenCard(id); return }
    const cp = t.closest('[data-kbcopy]') as HTMLElement | null
    if (cp) {
      const p = st.det?.path ?? ''
      if (!p) return
      void navigator.clipboard.writeText(p).then(() => opts.toast('已复制路径：' + p), () => opts.toast('复制失败，手动选中路径再复制', 'err'))
      return
    }
    if (t.closest('[data-role="qx"]')) {
      if (timer) { clearTimeout(timer); timer = undefined }
      st.q = ''
      qEl.value = ''
      qxEl.hidden = true
      void loadList()
      qEl.focus()
    }
  }

  const onInput = (e: Event): void => {
    const t = e.target as HTMLElement | null
    if (!t) return
    /* S9：挂载选择器的搜索（本地过滤，不打断输入框焦点） */
    if (t.id === 'kbAttQ' && st.attPick) {
      st.attPick.q = (t as HTMLInputElement).value
      const box = detEl.querySelector('#kbAttList')
      if (box) box.innerHTML = attRows()
      return
    }
    if (t.getAttribute('data-role') !== 'q') return
    st.q = (t as HTMLInputElement).value
    qxEl.hidden = !st.q
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void loadList() }, 300)
  }

  /** S9：别处跳过来（看板详情点标题 / 新建草稿并挂上）—— 定位一张卡，或打开新建表单并记下要挂的项目卡 */
  const takeReq = (): void => {
    const r = kbReq
    if (!r || dead) return
    kbReq = null
    if (r.newCard) { openKbEditor({ mode: 'new', source: 'board', attachCard: r.newCard, toast: (m, k) => opts.toast(m, k) }); return }
    if (r.cardId) select(r.cardId)
  }

  /** v168：弹窗里保存 / 改状态 / 删除后刷新列表（弹窗只负责写盘，页面刷新归这里） */
  const onChanged = (e: Event): void => {
    const id = String(((e as CustomEvent).detail as { id?: string } | undefined)?.id ?? '')
    void loadAll().then(() => { if (id) select(id) })
  }
  root.addEventListener('click', onClick)
  root.addEventListener('input', onInput)
  document.addEventListener('dpm:kb-open', takeReq)
  document.addEventListener('dpm:kb-changed', onChanged)
  void loadAll()
  takeReq()
  return () => {
    dead = true
    document.removeEventListener('dpm:kb-open', takeReq)
    document.removeEventListener('dpm:kb-changed', onChanged)
    if (timer) clearTimeout(timer)
    if (undoT) { clearTimeout(undoT); undoT = undefined }
    undoEl?.remove()
    undoEl = null
    nd = null
    root.removeEventListener('click', onClick)
    root.removeEventListener('input', onInput)
    root.innerHTML = ''
  }
}

/** React 包装：DOM 全由 mountKb 手动渲染，React 只管这块容器的生命周期（面板切换 = 卸载重挂）。 */
export function kbPage(o: { onOpenCard(cardId: string): void; toast(msg: string, kind?: 'ok' | 'err'): void }): () => unknown {
  return function KbPage(): unknown {
    const ref = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      const el = ref.current
      if (!el) return
      return mountKb(el, o)
    }, [])
    return h('div', { className: 'dpm kb-page', ref })
  }
}
