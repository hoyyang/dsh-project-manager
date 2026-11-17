/**
 * v168：知识卡编辑器 = 居中大弹窗（唯一入口，四处共用）。
 *   ① 知识库「新建知识卡」② 详情「编辑」③ 项目卡详情「+ 新建草稿并挂上」④ 框选气泡右半「添加为知识卡」
 * 字段 / 校验 / 保存逻辑与 v163 的行内表单一模一样；正文 = richnote 的同一套 gt-* 编辑器（一处定义）。
 * 另外把「知识卡的元数据表」和「框选气泡两半的同一段结构」也放这里：kb.ts / composer.ts / noteassist.ts 共用。
 */
import type { Card, KbStatus, KbType } from './api.js'
import { getKb, getKbCard, getState, post, postKb } from './api.js'
import { esc } from './icons.js'
import { KB_GLYPH } from './entry.js'
import { mountRichNote, type RichNote, type ChipItem } from './richnote.js'
import { closeQuotePanel, isQuotePanelOpen, repaintQuotePanel, type QpGroup, type QpItem } from './quotepanel.js'
import { kbText, cardText } from '../quote.js'
import { secHay, splitSections, type QpSec } from '../sections.js'
import { openKb, type BubbleCtx } from './detailbubble.js'

/* ── 知识卡元数据（类型 / 状态 / 图标 / 默认档位）：一张表只写一处 ───────────── */
export const TYPES: Array<{ k: KbType; label: string }> = [
  { k: 'prompt', label: '提示词' },
  { k: 'howto', label: '操作手册' },
  { k: 'snippet', label: '片段' },
  { k: 'domain', label: '领域知识' },
  { k: 'business', label: '业务知识' },
  { k: 'moc', label: '汇总卡' },
]
export const ALL_TYPES: Array<{ k: string; label: string }> = [{ k: 'all', label: '全部' }, ...TYPES]
export const TYPE_LABEL: Record<string, string> = { prompt: '提示词', howto: '操作手册', snippet: '片段', domain: '领域知识', business: '业务知识', moc: '汇总卡' }
export const STATUS: Record<KbStatus, string> = { draft: '草稿', verified: '已验证', stale: '过时' }
export const STCLS: Record<KbStatus, string> = { draft: 'd', verified: 'v', stale: 's' }
export const ST_KEYS: KbStatus[] = ['verified', 'draft', 'stale']
/** 6 个类型图标（与原型同一套；描边 / 圆角 / 尺寸由 CSS 给） */
export const GLYPH: Record<string, string> = {
  prompt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3.5z"/><path d="m8.6 10.2 1.9 1.6-1.9 1.6M12.6 13.4h3.2"/></svg>',
  howto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.8h2.2v2.2H4.5zM9.6 7.9h9.9M4.5 12.2h2.2v2.2H4.5zM9.6 13.3h9.9M4.5 17.6h2.2v2.2H4.5zM9.6 18.7h7"/></svg>',
  snippet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8.4 5 12l4 3.6M15 8.4 19 12l-4 3.6"/></svg>',
  domain: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.3"/><path d="M3.8 12h16.4M12 3.7c2.5 2.3 2.5 14.3 0 16.6M12 3.7c-2.5 2.3-2.5 14.3 0 16.6"/></svg>',
  business: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 7.8h16.8v11H3.6z"/><path d="M9 7.8V5.4h6v2.4M3.6 12.4h16.8"/></svg>',
  moc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.6h6l1.8 2.2h9.2v9.6H3.5z"/><path d="M7.4 12.6h9.2M7.4 15.4h6.2"/></svg>',
}
/** 类型默认档位（与 host 的 kbMode 同口径：这三个默认全文，其余摘要） */
export const FULL_TYPES = new Set<string>(['prompt', 'howto', 'snippet'])
export const DEF_MODE = (t: string): string => (FULL_TYPES.has(t) ? '全文' : '摘要')
/** 标签输入（顿号 / 逗号 / 分号 / 空白分隔）→ 数组；上限交给 host 的 cleanKb 拒 */
export const splitTagInput = (s: string): string[] => s.split(/[、,，;；\s]+/).map((x) => x.trim()).filter(Boolean)

/* ── v171：知识卡引用伴手弹窗的数据（四个入口共用一份：六类分组 + 标签 facet + 插入口径） ─────
   「一处定义」：分组顺序 / 状态徽标 / 默认档位 / 插入的是正文还是引用原文，全在这里；
   面板只负责画（kind = kb）+ 标签筛选，四处入口只把这份 groups 交给它。 */
export interface KbPick { id: string; title: string; type: KbType; status: KbStatus; summary: string; path: string; tags: string[]; updated?: string }
const oneLine = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 64)
let kbAll: KbPick[] | null = null
let kbAllAt = 0
let kbHooked = false
/** 知识卡全量（引用面板用；5 秒缓存，知识卡有任何写入（dpm:kb-changed）立刻作废）。 */
export async function ensureKbCards(): Promise<KbPick[]> {
  if (!kbHooked) {
    kbHooked = true
    document.addEventListener('dpm:kb-changed', () => { kbAll = null })
  }
  if (kbAll && Date.now() - kbAllAt < 5000) return kbAll
  const r = await getKb()
  kbAll = (r.cards ?? []).map((k) => ({ id: k.id, title: k.title, type: k.type, status: k.status, summary: k.summary, path: k.path, tags: k.tags ?? [], updated: k.updated }))
  kbAllAt = Date.now()
  return kbAll
}
export const kbCardsNow = (): KbPick[] | null => kbAll
/** 提示词类的正文按需预取（引用它时插的是正文；取不到就退化成引用原文，不挡操作）。 */
export function warmKbBodies(cards: KbPick[], done?: () => void): void {
  const need = cards.filter((k) => k.type === 'prompt' && !bodies.has(k.id))
  if (!need.length) return
  let left = need.length
  for (const k of need) {
    void getKbCard(k.id).then((r) => { if (r?.card?.body != null) bodies.set(k.id, r.card.body) }).catch(() => undefined).finally(() => { if (--left === 0) done?.() })
  }
}
/* ── v179：分段要看正文 —— 逐张二段式预取，到齐后补「N 段」并重画一次（不阻塞列表） ── */
/** 某张知识卡的正文（预取到齐前 = null）。 */
export const kbBodyNow = (id: string): string | null => bodies.get(id) ?? null
const secPending = new Set<string>()
let secAgainT = 0
export function warmKbSecs(cards: readonly { id: string }[], again: () => void): void {
  const todo = cards.filter((k) => !bodies.has(k.id) && !secPending.has(k.id)).slice(0, 40)
  if (!todo.length) return
  for (const k of todo) {
    secPending.add(k.id)
    void getKbCard(k.id).then((r) => { if (r?.card?.body != null) bodies.set(k.id, r.card.body) }).catch(() => undefined).finally(() => {
      secPending.delete(k.id)
      if (secAgainT) clearTimeout(secAgainT)
      secAgainT = window.setTimeout(() => { secAgainT = 0; try { again() } catch { /* 面板已关 */ } }, 90)
    })
  }
}
/** 一张卡的正文 → 分段（prompt 类插正文 = 任务口径段头；其余 = 知识卡出处行口径）。 */
const kbSecsOf = (k: { id: string; title: string; path: string; type: string }): QpSec[] => {
  const body = bodies.get(k.id)
  if (!body) return []
  return splitSections(body, k.type === 'prompt' ? { kind: 'task' } : { kind: 'kb', title: k.title, path: k.path })
}
const ST_CHIP: Record<string, string> = { draft: 'st-draft', stale: 'st-stale' }
/**
 * 六类分组（顺序 = 类型表顺序；空组不出现）。每行的元数据：
 *  chip / chipCls = 状态（已验证不标；草稿虚线 / 过时琥珀）、meta = 一行摘要、
 *  hay = 匹配字段（标题 + 摘要 + 标签 + 类型名 + 状态 + id）、ins = 底栏「将插入 …」的说明。
 * 插入口径：提示词类插正文（它就是可复用指令），其余插引用原文（编辑器里画成绿色书胶囊）。
 */
export function kbQuoteGroups(cards: readonly KbPick[], exclude = ''): QpGroup[] {
  const G: QpGroup[] = []
  for (const t of TYPES) {
    const rows = cards
      .filter((k) => k.type === t.k && k.id !== exclude)
      .sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')))
      .map((k) => {
        const secs = kbSecsOf(k)
        return {
          kind: 'leaf' as const,
          icon: 'kb',
          id: k.id,
          title: k.title,
          chip: k.status === 'verified' ? '' : (STATUS[k.status] ?? ''),
          chipCls: k.status === 'verified' ? '' : (ST_CHIP[k.status] ?? ''),
          meta: oneLine(k.summary),
          tags: k.tags,
          secs,
          hay: (k.title + ' ' + k.summary + ' ' + k.tags.join(' ') + ' ' + (TYPE_LABEL[k.type] ?? '') + ' ' + (STATUS[k.status] ?? '') + ' ' + k.id + (secs.length ? ' ' + secHay(secs) : '')).toLowerCase(),
          ins: t.k === 'prompt' ? '提示词正文（原文插入）' : '引用原文（画成胶囊）',
          text: t.k === 'prompt' ? (bodies.get(k.id) ?? kbText(k.title, k.path)) : kbText(k.title, k.path),
        } as QpItem
      })
    if (!rows.length) continue
    G.push({ key: t.k, name: t.label, icon: 'kb', iconSvg: GLYPH[t.k], hint: '默认' + DEF_MODE(t.k), items: rows })
  }
  warmKbSecs(cards, repaintQuotePanel)
  return G
}

/* ── 框选气泡的两半 = 同一段结构（composer / noteassist 共用，改这里两处一起变） ── */
const IC_NOTE = '<svg viewBox="0 0 24 24"><path d="M5 4.5h14v15H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>'
const IC_KB = '<svg viewBox="0 0 24 24"><path d="M12 6.5C9.9 5.2 7.4 4.9 4.6 5.5v12.6c2.8-.6 5.3-.3 7.4 1 2.1-1.3 4.6-1.6 7.4-1V5.5c-2.8-.6-5.3-.3-7.4 1Z"/><path d="M12 6.5v12.6"/></svg>'
export const SEL_SEGS_HTML = '<button type="button" class="seg nseg" aria-label="添加为相关说明">' + IC_NOTE + '<span>添加为相关说明</span></button>'
  + '<button type="button" class="seg kbseg" data-kbseg aria-label="把框选的这段另存为一张知识卡（正文自动带入）">' + IC_KB + '<span>添加为知识卡</span></button>'

/* ── 弹窗 ─────────────────────────────────────────────────────────────────── */
export interface KbEditorOpts {
  /** new = 新建（一律草稿）；edit = 编辑那张卡 */
  mode: 'new' | 'edit'
  id?: string
  /** 新建时正文初值（框选气泡带进来的原文） */
  prefill?: string
  /** 新建时标题初值 */
  title?: string
  /** sel = 从框选气泡进来的（头部显示「正文已放入刚才框选的 N 字」） */
  source?: 'sel' | 'page' | 'board'
  /** 新建后挂到这张项目卡（看板「+ 新建草稿并挂上」） */
  attachCard?: string
  toast?: (m: string, k?: 'ok' | 'err') => void
}

type Data = { /** v171：tags / self 给「）」知识卡引用面板用（六类分组 + 排除自己） */ self: string; cards: Array<{ id: string; title: string; type: KbType; status: KbStatus; summary: string; path: string; tags: string[]; updated?: string }>; groups: QpGroup[]; proj: Array<{ id: string; title: string; group: string }>; chips: ChipItem[] }
type Draft = { title: string; type: KbType; tags: string; summary: string; body: string }

let dlg: HTMLDialogElement | null = null
let nd: RichNote | null = null
let cur: KbEditorOpts | null = null
let say: (m: string, k?: 'ok' | 'err') => void = (m) => console.log('[dpm kb]', m)
let data: Data = { self: '', cards: [], groups: [], proj: [], chips: [] }
const bodies = new Map<string, string>()

const $ = <T extends Element = HTMLElement>(sel: string): T | null => (dlg ? (dlg.querySelector(sel) as T | null) : null)
const kbCanon = (k: { title: string; path: string }): string => kbText(k.title, k.path)

function buildGroups(selfId: string, cards: Data['cards'], proj: Array<{ id: string; title: string; group: string }>): QpGroup[] {
  const G: QpGroup[] = []
  if (cards.length) {
    G.push({
      key: 'kb', name: '知识卡', icon: 'kb', hint: 'prompt 插正文 · 其余引用原文',
      items: cards.filter((k) => k.id !== selfId).map((k) => {
        const secs = kbSecsOf(k)
        return {
          kind: 'leaf' as const, icon: 'kb', id: k.id, title: k.title,
          chip: (TYPE_LABEL[k.type] ?? k.type) + (k.status === 'verified' ? '' : ' · ' + (STATUS[k.status] ?? k.status)),
          meta: String(k.summary ?? '').replace(/\s+/g, ' '),
          secs,
          hay: (k.title + ' ' + String(k.summary ?? '') + ' ' + (TYPE_LABEL[k.type] ?? '') + (secs.length ? ' ' + secHay(secs) : '')).toLowerCase(),
          text: k.type === 'prompt' && bodies.has(k.id) ? (bodies.get(k.id) as string) : kbCanon(k),
        }
      }),
    })
  }
  if (proj.length) G.push({ key: 'cards', name: '关联卡片', icon: 'cards', hint: '名字（卡片组）', items: proj.map((c) => ({ kind: 'leaf' as const, icon: 'cards', id: c.id, title: c.title, chip: c.group, text: cardText(c.title, c.group) })) })
  return G.filter((x) => x.items.length)
}
function buildChips(cards: Data['cards'], proj: Array<{ id: string; title: string; group: string }>): ChipItem[] {
  const out: ChipItem[] = cards.map((k) => ({
    kind: 'kb' as const, id: k.id, title: k.title, canon: kbCanon(k), body: k.summary,
    sub: (TYPE_LABEL[k.type] ?? k.type) + ' · ' + (STATUS[k.status] ?? k.status),
    tip: '知识卡 · 点一下看类型 / 状态 / 摘要',
  }))
  for (const c of proj) out.push({ kind: 'card', id: c.id, title: c.title, canon: cardText(c.title, c.group), sub: '卡片组 · ' + c.group, tip: '项目卡 · 点一下看这张卡' })
  return out
}

function ensureDlg(): HTMLDialogElement {
  if (dlg) return dlg
  const d = document.createElement('dialog')
  d.className = 'kbm'
  d.setAttribute('aria-labelledby', 'kbDlgT')
  d.innerHTML = '<div class="kbm-shell"></div>'
  document.body.append(d)
  d.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    if (t.closest('[data-kbcancel]')) { e.preventDefault(); closeKbEditor(); return }
    if (t.closest('#kbSave')) { e.preventDefault(); void save(); return }
    if (e.target === d) closeKbEditor()
  })
  /* Esc 逐层收：引用面板开着先关面板，第二次才关弹窗（与 v164 原型同一条规则） */
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (isQuotePanelOpen()) {
      e.preventDefault(); e.stopPropagation()
      closeQuotePanel(undefined, 'esc')
    }
  }, true)
  d.addEventListener('close', () => { cleanup() })
  dlg = d
  return d
}

function cleanup(): void {
  try { nd?.destroy() } catch { /* ignore */ }
  nd = null
  const shell = $('.kbm-shell')
  if (shell) shell.innerHTML = ''
  const was = cur
  cur = null
  if (was) document.dispatchEvent(new CustomEvent('dpm:kb-changed', { detail: { mode: was.mode, id: was.id ?? '' } }))
}

export const isKbEditorOpen = (): boolean => !!(dlg && dlg.open)

export function closeKbEditor(): void {
  if (!dlg || !dlg.open) return
  dlg.close()
}

async function loadData(selfId: string, fail: (m: string) => void): Promise<void> {
  try {
    const [list, state] = await Promise.all([getKb(), getState()])
    const cards = (list.cards ?? []).map((k) => ({ id: k.id, title: k.title, type: k.type, status: k.status, summary: k.summary, path: k.path, tags: k.tags ?? [], updated: k.updated }))
    const gs = state.board?.groups ?? []
    const proj = (state.board?.cards ?? []).filter((c: Card) => !c.archivedAt).map((c) => ({ id: c.id, title: c.t, group: gs.find((g) => g.id === c.g)?.name ?? c.g }))
    data = { self: selfId, cards, groups: buildGroups(selfId, cards, proj), proj, chips: buildChips(cards, proj) }
    for (const k of cards) {
      if (k.type !== 'prompt' || bodies.has(k.id)) continue
      void getKbCard(k.id).then((r) => { if (r?.card?.body != null) bodies.set(k.id, r.card.body) }).catch(() => undefined)
    }
  } catch (e) {
    fail('读不到知识库 / 项目卡：' + (e instanceof Error ? e.message : String(e)))
  }
}

function openTok(tok: string): void {
  if (data.cards.some((x) => kbCanon(x) === tok)) { say('先保存或取消，再跳到那张知识卡'); return }
  if (data.chips.some((x) => x.kind === 'card' && x.canon === tok)) { say('先保存或取消，再打开那张项目卡'); return }
  if (/^https?:/i.test(tok)) { window.open(tok, '_blank', 'noopener'); return }
  void post('fs/reveal', { path: tok, folder: false }).then(() => say('已用默认应用打开：' + tok)).catch(() => say('打不开这个路径：' + tok, 'err'))
}

function shellHtml(o: KbEditorOpts, d: Draft): string {
  const isNew = o.mode === 'new'
  const fromSel = isNew && o.source === 'sel'
  return '<div class="dpm kb-page"><div class="kbe">'
    + '<header class="kbe-h">'
    + '<span class="kbe-ic" aria-hidden="true">' + KB_GLYPH + '</span>'
    + '<div class="kbe-ht"><h3 id="kbDlgT">' + (isNew ? '新建知识卡' : '编辑知识卡') + '</h3>'
    + '<p>' + (isNew ? '一张卡 = 一条可复用的知识 · 新建后是草稿，点「已验证」才注入会话' : '编辑「' + esc(d.title) + '」· 只刷新 updated，created / 挂载关系不动')
    + (fromSel ? '<b class="kbe-src">正文已放入刚才框选的 ' + String(d.body || '').trim().length + ' 字</b>' : '') + '</p></div>'
    + '<span class="grow"></span>'
    + '<button class="kbe-x" type="button" data-kbcancel aria-label="关闭（Esc）" title="关闭（Esc 或点弹窗外）"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
    + '</header>'
    + '<div class="kbe-b">'
    + '<div class="kbf"><label for="kbTitle">标题 <i>必填 · ≤120 字</i></label><input id="kbTitle" data-kbf="title" type="text" maxlength="120" value="' + esc(d.title) + '" placeholder="一条知识用一句话命名，例：发版前 sanitize 清单" autocomplete="off" spellcheck="false"></div>'
    + '<div class="kbf2">'
    + '<div class="kbf"><label for="kbType">类型 <i>决定默认注入档位</i></label><select id="kbType" data-kbf="type">'
    + TYPES.map((t) => '<option value="' + t.k + '"' + (d.type === t.k ? ' selected' : '') + '>' + t.label + ' · 默认' + DEF_MODE(t.k) + '</option>').join('')
    + '</select></div>'
    + '<div class="kbf"><label for="kbTagIn">标签 <i>顿号 / 逗号分隔</i></label><input id="kbTagIn" data-kbf="tags" type="text" value="' + esc(d.tags) + '" placeholder="发布、验收" autocomplete="off"></div>'
    + '</div>'
    + '<div class="kbf"><label for="kbSum">摘要 <i>≤200 字 · 留空取正文前 80 字</i></label><input id="kbSum" data-kbf="summary" type="text" maxlength="200" value="' + esc(d.summary) + '" autocomplete="off"></div>'
    + '<div class="kbf kbf-ed">'
    + '<div class="gt-box gt-desc v164note">'
    + '<div class="gt-box-h"><span class="gt-box-t" id="kbBodyL">正文</span><span class="gt-box-n" data-role="noten">0 字</span><span class="grow"></span>'
    + '<button class="gt-op gt-dv" type="button" data-role="dv" aria-label="插入分割线" title="插入分割线：光标所在行没内容就插在这一行，有内容插到下一行；插完双击横线可以设置标题"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12h4.7M15.7 12h4.7"/><path d="M12 9.3v5.4M9.3 12h5.4"/></svg></button>'
    + '<span class="gt-undo-hint" aria-hidden="true"><kbd>⌘Z</kbd> 撤销 · <kbd>⇧⌘Z</kbd> 重做</span></div>'
    + '<div class="gt-box-b gt-desc-b"><div class="gt-note" id="kbBody" data-role="nd" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" aria-labelledby="kbBodyL"></div>'
    + '<span class="gt-ph" data-gt-ph aria-hidden="true">写清楚：什么情况用、怎么做、哪里容易踩坑…（可打 &gt; / 》 引用知识卡与项目卡；分割线按钮或输入 --- 再空格插横线）</span></div></div>'
    + '<p class="kbe-tip">可打 <kbd>&gt;</kbd> / <kbd>》</kbd> 引用知识卡与项目卡 · 分割线按钮或 <kbd>---</kbd> + 空格 · <kbd>⌘Enter</kbd> 保存</p>'
    + '<p class="v164also"><span>这套编辑器还用在：DSH 对话框 · 卡片任务说明 · 卡片相关说明</span><b>同一份代码</b></p>'
    + '</div></div>'
    + '<footer class="kbe-f"><button class="btn primary sm" type="button" id="kbSave">' + (isNew ? '新建（状态 = 草稿）' : '保存') + '</button>'
    + '<button class="btn sm" type="button" data-kbcancel>取消</button><span class="grow"></span>'
    + '<span class="meta">' + (isNew ? '新建一律是草稿：点「已验证」才转正' : '只刷新 updated；created / 挂载关系不动') + '</span></footer>'
    + '</div></div>'
}

function paint(o: KbEditorOpts, draft: Draft): void {
  const shell = $('.kbm-shell') as HTMLElement | null
  if (!shell) return
  try { nd?.destroy() } catch { /* ignore */ }
  nd = null
  shell.innerHTML = shellHtml(o, draft)
  const box = $('[data-role="nd"]') as HTMLElement | null
  if (!box) return
  nd = mountRichNote(box, {
    where: 'kb',
    toast: (m, k) => say(m, k),
    /* v177：知识卡胶囊 = 详情气泡（默认）；⌘ / Ctrl 才走去知识库打开（旧行为）；项目卡胶囊不变 */
    onChip: (chip, meta) => {
      const it = data.chips.find((x) => x.canon === chip.dataset.canon)
      if (!it || it.kind !== 'kb') return false
      if (meta.cmd) return false
      const ctx: BubbleCtx = { toast: (m, k) => say(m, k) }
      openKb(ctx, { id: it.id, title: it.title }, chip)
      return true
    },
    countEl: $<HTMLElement>('[data-role="noten"]'),
    dividerBtn: $<HTMLElement>('[data-role="dv"]'),
    /* v179：每次重画都重算一次 —— 正文二段式到齐后「N 段」才能补上 */
    quote: () => buildGroups(data.self, data.cards, data.proj),
    /* v171：知识卡正文里打「）」= 同一块面板的知识卡身份（六类全库，排除正在编辑的这张） */
    kb: () => kbQuoteGroups(data.cards, data.self),
    catalog: () => data.chips,
    marks: true,
    marksNote: '知识卡没有「相关文件」这一维，所以这里只识别、不提供「添加为…」',
    marksOpen: (tok) => { openTok(tok) },
    submit: () => { void save() },
  })
  if (draft.body) nd.set(draft.body)
  nd.nd.syncPh()
  requestAnimationFrame(() => {
    const t = $('#kbTitle') as HTMLInputElement | null
    if (t) { t.focus(); if (t.value) t.select() }
  })
}

export function openKbEditor(o: KbEditorOpts): void {
  if (o.mode === 'edit' && !o.id) return
  const d = ensureDlg()
  cur = o
  if (o.toast) say = o.toast
  if (!d.open) d.showModal()
  const shell = $('.kbm-shell')
  if (shell) shell.innerHTML = '<div class="dpm kb-page"><div class="kbe"><div class="kbe-b" style="padding:18px 20px;color:var(--dsw-alias-label-secondary);font-size:12px">加载中…</div></div></div>'
  void (async () => {
    const self = o.mode === 'edit' ? (o.id ?? '') : ''
    await loadData(self, (m) => say(m, 'err'))
    if (cur !== o) return
    if (o.mode === 'edit' && o.id) {
      try {
        const r = await getKbCard(o.id)
        if (cur !== o) return
        if (!r?.card) { say('这张知识卡已经不在了', 'err'); closeKbEditor(); return }
        const k = r.card
        paint(o, { title: k.title, type: k.type, tags: k.tags.join('、'), summary: k.summary, body: k.body })
      } catch (e) {
        say('读不到这张知识卡：' + (e instanceof Error ? e.message : String(e)), 'err')
        closeKbEditor()
      }
      return
    }
    paint(o, { title: o.title ?? '', type: 'howto', tags: '', summary: '', body: o.prefill ?? '' })
  })()
}

async function save(): Promise<void> {
  const o = cur
  if (!o) return
  const title = (($('#kbTitle') as HTMLInputElement | null)?.value ?? '').trim()
  if (!title) { say('标题不能为空', 'err'); ($('#kbTitle') as HTMLInputElement | null)?.focus(); return }
  const payload = {
    title,
    type: ((($('#kbType') as HTMLSelectElement | null)?.value) || 'domain') as KbType,
    tags: splitTagInput((($('#kbTagIn') as HTMLInputElement | null)?.value) ?? ''),
    summary: ((($('#kbSum') as HTMLInputElement | null)?.value) ?? '').trim(),
    body: nd ? nd.text() : '',
  }
  try {
    const r = o.mode === 'new' ? await postKb('create', payload) : await postKb('update', { id: o.id, ...payload })
    const id = r.card?.id ?? o.id ?? ''
    o.id = id || o.id
    const attach = o.attachCard
    say(o.mode === 'new' ? '已新建「' + title + '」· 草稿：点「已验证」才进会话注入' : '已保存「' + title + '」')
    closeKbEditor()
    if (attach && id) {
      try {
        const s = await getState()
        const c = (s.board?.cards ?? []).find((x) => x.id === attach)
        if (c) {
          await post('card/kb', { id: attach, kb: [...(c.kb ?? []).filter((a) => a.id !== id), { id }] })
          say('已新建「' + title + '」并挂到「' + c.t + '」· 草稿：点「已验证」才转正')
        }
      } catch (e) { say('已新建「' + title + '」，但挂到项目卡失败：' + (e instanceof Error ? e.message : String(e)), 'err') }
    }
  } catch (e) {
    say('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err')
  }
}
