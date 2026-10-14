/**
 * 0.19 会话信息卡（原型 v35 定稿）：会话输入框上方一张卡片。
 * - 收起：一行（组 / 卡片 + 数字胶囊 + 看板直达 + 展开）；展开：「落盘项目」「卡片资料」两组。
 * - 落盘项目：每个一行（单个落盘按钮）；多于 1 个可「合并」（勾选、默认全选），合并结果和它自己的「合并完成」卡片包成一个单元，
 *   合并前的落盘项目按层级列出，可撤销（只退一步）/ 删除（连同更早合并的）/ 单独删除更早合并的。
 * - 没关联：第一行是「新建落盘项目」输入框。
 * - 「查看 AI 收到的原文」：系统提示里本卡片那一段 + 注入会话的全文（与插件发给 AI 的逐字一致）。
 * 数据来自 GET session（与喂给 AI 的同一份看板 / 磁盘数据）。DOM 全部挂在 root 上，dispose 即净。
 */
import { ApiError, getMatch, getMergePreview, getRaw, getSession, post, type LfRun, type MatchResult, type MemDetail, type MergePreview, type MergeView, type MigView, type SessionInfo } from './api.js'
import { BOARD_GLYPH, CHECK_SVG, COPY_SVG, esc, ic } from './icons.js'

export interface DockHost {
  toast(msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }): void
  openBoard(cardId: string): void
  /** 把一条消息排进这个会话（AI 正在跑就排队）。 */
  send(sessionId: string, text: string): Promise<void>
}

const OPEN = new Map<string, boolean>()
const wan = (n: number): string => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万字' : n + ' 字')
const pj = (k: string): string => k.split('/')[0]
const nm = (k: string): string => k.split('/')[1] ?? k
const home = (p: string): string => p.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/')
/** 合并时间（本地时区）：10-13 21:02 */
const when = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const tok = (s: string): number => Math.round(s.length * 0.55)
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const copyBtn = (v: string, what: string): string => '<button type="button" class="ib cp" data-copy="' + esc(v) + '" data-what="' + esc(what) + '" aria-label="复制' + esc(what) + '" title="复制' + esc(what) + '">' + COPY_SVG + CHECK_SVG + '</button>'

/** 新建落盘项目：第一个不含中文的名字当文件名（小写，非法字符换成 -），其余都是别名。 */
export function parseNames(v: string): { file: string | null; aliases: string[] } {
  const names = v.split(/\s+/).map((x) => x.trim()).filter(Boolean)
  const raw = names.find((n) => !/[\u4e00-\u9fff]/.test(n))
  const file = raw ? raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 80) || null : null
  return { file, aliases: names.filter((n) => n !== raw) }
}

type Mg = { sel: Set<string>; name: string; touched: boolean; pv: MergePreview | null; err: string; seq: number; busy: boolean }

/** 只滚会话信息卡自己的滚动区，不碰宿主页面（scrollIntoView 会连外层 overflow:hidden 容器一起滚，整页被顶上去）。 */
function reveal(el: Element | null | undefined): void {
  const box = el?.closest('.scroll') as HTMLElement | null
  if (!el || !box) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < b.top) box.scrollTo({ top: box.scrollTop + r.top - b.top - 8, behavior: 'smooth' })
  else if (r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + Math.min(r.top - b.top - 8, r.bottom - b.bottom + 8), behavior: 'smooth' })
}

export class SessionCard {
  private info: SessionInfo | null = null
  private sig = ''
  private timer = 0
  private dead = false
  private mg: Mg | null = null
  private pvTimer = 0
  /** 刚点了落盘、服务端还没登记好这一轮（发送中）。 */
  private sending: string | null = null
  /** 0.20 同名检测结果（输入框内容 → 候选）。 */
  private mt: { q: string; r: MatchResult | null; seq: number } = { q: '\u0000', r: null, seq: 0 }
  private mtTimer = 0
  /** 0.20 等用户确认卡片组落盘文件夹的动作（确认后继续）。 */
  private ask0: { kind: 'new' | 'key'; key?: string } | null = null
  private lastRun = ''
  private fresh = ''
  private fold = new Map<string, boolean>()
  private shut = new Map<string, boolean>()
  private ask = new Set<string>()
  private busy = new Set<string>()
  private wasMerging = ''
  private ov: HTMLElement | null = null
  private rawTab: 'sys' | 'inj' = 'sys'

  constructor(readonly root: HTMLElement, readonly sid: string, readonly host: DockHost) {
    root.className = 'dpm-dock dpm-sic'
    root.hidden = true
    root.addEventListener('click', this.onClick)
    root.addEventListener('change', this.onChange)
    root.addEventListener('input', this.onInput)
    root.addEventListener('keydown', this.onKey)
    void this.load()
    this.timer = window.setInterval(() => { if (!document.hidden) void this.load() }, 4000)
  }
  dispose(): void {
    this.dead = true
    clearInterval(this.timer)
    clearTimeout(this.pvTimer)
    clearTimeout(this.mtTimer)
    this.closeRaw()
    this.root.removeEventListener('click', this.onClick)
    this.root.removeEventListener('change', this.onChange)
    this.root.removeEventListener('input', this.onInput)
    this.root.removeEventListener('keydown', this.onKey)
    this.root.innerHTML = ''
  }
  private get open(): boolean { return OPEN.get(this.sid) ?? false }
  private set open(v: boolean) { OPEN.set(this.sid, v) }

  async load(force = false): Promise<void> {
    let r: SessionInfo
    try { r = await getSession(this.sid) } catch { return }
    if (this.dead) return
    const sig = JSON.stringify(r)
    if (!force && sig === this.sig) return
    const prev = this.info
    this.info = r
    this.sig = sig
    // 合并完成（进行中 → 没了）：结果闪一下、提示
    const run = r.merging?.id ?? ''
    if (this.wasMerging && !run) {
      const res = (r.memDetail ?? []).find((m) => m.merge && m.merge.id === this.wasMerging)
      if (res) { this.fresh = res.key; this.host.toast('合并完成：' + res.merge!.srcs.length + ' 个落盘项目合成 ' + res.key); this.foldOthers(res.merge!.id) }
    }
    this.wasMerging = run
    // 0.20 信息卡发起的落盘：按这一轮的结局更新（写好了 → 提示并收起；停止 / 出错 → 留着让用户重新落盘或忽略）
    const lr = r.lfRun ?? null
    const rs = lr ? lr.state + lr.at : ''
    if (lr && rs !== this.lastRun) {
      if (lr.state === 'done') { this.fresh = lr.key; this.host.toast('落盘完成：' + lr.key); void post('lf/run-dismiss', { sessionId: this.sid }).catch(() => undefined) }
      else if (lr.state === 'stopped') this.host.toast('落盘被停止：' + (lr.key || lr.label) + ' 没写入', 'err')
      else if (lr.state === 'error') this.host.toast('落盘出错停止：' + (lr.error ?? ''), 'err')
    }
    this.lastRun = rs
    // 正在输入时不整块重画（会丢光标）；输入框失焦后下一轮再画
    const a = document.activeElement
    if (prev && a && this.root.contains(a) && (a as HTMLElement).matches('input[type=text], input:not([type])')) { this.fillMg(); this.fillMt(); return }
    this.render()
  }

  private foldOthers(keep: string): void { for (const m of this.info?.memDetail ?? []) if (m.merge && m.merge.id !== keep) this.fold.set(m.merge.id, true); this.fold.set(keep, false) }

  // ── 渲染 ──
  render(): void {
    const i = this.info
    if (!i?.card || !i.cardInfo) { this.root.hidden = true; this.root.innerHTML = ''; return }
    this.root.hidden = false
    const scroll = (this.root.querySelector('.scroll') as HTMLElement | null)?.scrollTop ?? 0
    const ci = i.cardInfo
    const mem = i.memDetail ?? []
    const memN = mem.length
    const matN = ci.repos.length + ci.links.length + ci.files.length + ci.tasks.length + (ci.notes.trim() ? 1 : 0)
    const pend = mem.reduce((n, m) => n + (m.merge?.all ?? 0), 0)
    const crumb = '<span class="crumb" title="' + esc(i.card.group + ' / ' + i.card.title) + '"><span class="g">' + esc(i.card.group) + '</span><span class="sl">/</span><span class="t">' + esc(i.card.title) + '</span></span>'
    const boardBtn = '<button type="button" class="ib board" data-board aria-label="在项目看板打开这张卡片" title="在项目看板打开这张卡片">' + BOARD_GLYPH + '</button>'
    const chev = '<button type="button" class="ib" data-tgl aria-label="' + (this.open ? '收起' : '展开') + '会话信息" title="' + (this.open ? '收起' : '展开') + '" aria-expanded="' + this.open + '">' + ic('chev') + '</button>'
    let head: string
    if (!memN) {
      const run = i.lfRun && !i.lfRun.key ? i.lfRun : null
      const busy = !!this.sending || run?.state === 'busy' || run?.state === 'ask'
      head = '<div class="sic-h">' + crumb + '<div class="mk" id="dpmMk"><input id="dpmMkIn" type="text" placeholder="新建落盘项目：输入名字，空格分隔，留空由 AI 起名" aria-label="新建落盘项目的名字（空格分隔；第一个不含中文的当文件名，其余是别名）" autocomplete="off" spellcheck="false"' + (busy ? ' disabled' : '') + '><span class="tok" id="dpmMkTok"></span></div><span id="dpmMkBtn">' + this.mkBtn(run, busy) + '</span><span class="acts">' + boardBtn + chev + '</span></div>'
        + this.runLine(run) + this.folderHtml() + '<div class="mt" id="dpmMt"><div class="in" id="dpmMtIn"></div></div>'
    } else {
      const lr = i.lfRun && i.lfRun.key ? i.lfRun : null
      const pills = '<span class="pill mem">' + ic('mem') + '落盘项目 <b>' + memN + '</b></span>' + (lr?.state === 'busy' || (this.sending && this.sending !== '__new') ? '<span class="pill mem"><span class="dot"></span>落盘中</span>' : lr && ['stopped', 'error', 'nowrite'].includes(lr.state) ? '<span class="pill bad">落盘没完成</span>' : lr?.state === 'ask' ? '<span class="pill mem">等你回复</span>' : '') + (i.merging ? '<span class="pill mem"><span class="dot"></span>合并中</span>' : '') + (pend ? '<span class="pill" title="合并前的落盘项目还在回收区，可撤销或删除">合并前 <b>' + pend + '</b> 个待清理</span>' : '')
        + '<span class="pill">仓库 <b>' + ci.repos.length + '</b></span>' + (ci.links.length ? '<span class="pill">链接 <b>' + ci.links.length + '</b></span>' : '') + (ci.tasks.length ? '<span class="pill">子任务 <b>' + ci.tasks.filter((t) => t.done).length + '/' + ci.tasks.length + '</b></span>' : '') + (ci.notes.trim() ? '<span class="pill">说明</span>' : '') + (ci.files.length ? '<span class="pill">文件 <b>' + ci.files.length + '</b></span>' : '')
      head = '<div class="sic-h"><button type="button" class="tgl" data-tgl aria-expanded="' + this.open + '">' + crumb + '<span class="pills">' + pills + '</span></button><span class="acts">' + boardBtn + chev + '</span></div>' + this.folderHtml()
    }
    const g1 = memN ? '<section class="grp" aria-label="落盘项目"><div class="grp-h">' + ic('mem') + '落盘项目<span class="n">' + memN + '</span><span class="sp"></span>' + (memN > 1 && !this.mg && !i.merging ? '<button type="button" class="btn sm" data-merge title="选几个合并成一个">' + ic('merge') + '合并</button>' : '') + '</div>' + this.listHtml(mem) + (i.merging ? this.runHtml() : this.mg ? this.mgHtml(mem) : '') + '</section>' : ''
    const g2 = '<section class="grp" aria-label="卡片资料"><div class="grp-h">' + ic('repo') + '卡片资料<span class="n">' + matN + '</span><span class="sp"></span><button type="button" class="lnk" data-raw title="插件每一步发给 AI 的卡片档案和落盘项目全文，逐字显示">查看 AI 收到的原文</button></div>' + this.matHtml() + '</section>'
    this.root.className = 'dpm-dock dpm-sic' + (memN ? ' on' : ' off') + (this.open ? ' open' : '')
    const mk = (this.root.querySelector('#dpmMkIn') as HTMLInputElement | null)?.value ?? ''
    this.root.innerHTML = head + '<div class="sic-b"><div class="in"><div class="scroll">' + g1 + g2 + '</div></div></div>'
    const s = this.root.querySelector('.scroll') as HTMLElement | null
    if (s) s.scrollTop = scroll
    const mi = this.root.querySelector('#dpmMkIn') as HTMLInputElement | null
    if (mi && mk) { mi.value = mk; this.mkTok() }
    this.fillMg()
    if (!memN) { this.fillMt(); if (this.mt.q !== (mi?.value ?? '').trim()) this.scheduleMatch() }
    if (this.fresh) { const k = this.fresh; this.fresh = ''; setTimeout(() => { const el = this.root.querySelector('[data-row="' + CSS.escape(k) + '"]'); reveal(el?.closest('.unit')) }, 50) }
  }

  private lfRow(m: MemDetail, freshKey: string): string {
    const run = this.info?.merging?.srcs.includes(m.key)
    const lr = this.info?.lfRun && this.info.lfRun.key === m.key ? this.info.lfRun : null
    const busy = this.sending === m.key || lr?.state === 'busy' || !!run
    const picked = this.mg?.sel.has(m.key)
    const tags = (m.pointer ? '<span class="tag" title="这份 STATE 只放了指向别处的路径，不存状态">指针</span>' : '') + (m.merge ? '<span class="tag" title="由 ' + m.merge.srcs.length + ' 个落盘项目合并而来">合并结果</span>' : '') + '<span class="tag">' + (m.from === 'group' ? '卡片组关联' : m.from === 'card' ? '卡片关联' : '卡片组 + 卡片') + '</span>'
    if (!m.found) return '<div class="lf" data-row="' + esc(m.key) + '"><div class="txt"><div class="l1"><span class="nm mq">' + esc(m.key) + '</span>' + tags + '</div><div class="l2">未找到这个落盘项目的 STATE（可能已移动或删除）</div></div></div>'
    const spec = (m.spec ?? []).filter((x) => x.id !== 'location')
    const specTag = (m.moveTo || spec.length) ? '<span class="tag legacy" title="' + esc([m.moveTo ? '落盘时插件会把整个文件夹迁到 ~/.ai/projects/' + m.moveTo + '/（可撤销）' : '', ...spec.map((x) => x.text + ' → 落盘时 AI 按规范改')].filter(Boolean).join('\n')) + '">' + (m.moveTo ? '落盘时迁到 ' + esc(m.moveTo) : '旧规范 ' + spec.length + ' 处') + '</span>' : ''
    const ended = lr && ['stopped', 'error', 'nowrite', 'ask'].includes(lr.state) ? lr : null
    const st = ended ? this.endSt(ended) : m.injected ? ic('check') + '已注入 ' + esc(m.version) : '<span class="pend" title="下一步注入最新版">待注入</span>'
    const l2 = ended ? '<div class="l2 mq' + (ended.state === 'ask' ? '' : ' bad') + '">' + esc(this.endText(ended, m.version)) + '</div>' : '<div class="l2 mq">' + esc(m.next || m.status || '暂无下一步') + '</div>'
    const btn = ended && ended.state !== 'ask'
      ? '<button type="button" class="btn sm" data-dismiss title="不再提示">忽略</button><button type="button" class="btn sm pri lfb" data-lf="' + esc(m.key) + '" title="再发一次「落盘项目 ' + esc(m.key) + '」">' + ic('save') + '重新落盘</button>'
      : '<button type="button" class="btn sm lfb" data-lf="' + esc(m.key) + '"' + (busy || ended ? ' disabled' : '') + ' title="' + (ended ? '回答 AI 的问题后它会接着写' : '在本会话执行「落盘项目 ' + esc(m.key) + '」') + '">' + (busy ? '<span class="spin"></span>落盘中' : ended ? ic('save') + '等待回复' : ic('save') + '落盘') + '</button>'
    return '<div class="lf' + (busy ? ' busy' : '') + (ended && ended.state !== 'ask' ? ' stopped' : '') + (picked ? ' picked' : '') + (freshKey === m.key ? ' fresh' : '') + '" data-row="' + esc(m.key) + '"><div class="txt"><div class="l1"><span class="nm mq">' + esc(m.slug) + '</span><span class="pj">' + esc(m.project) + '</span>' + specTag + tags + '</div>'
      + (m.aliases.length ? '<div class="l2 mq" title="说出这些名字也会回忆 / 落盘这个项目">别名：' + esc(m.aliases.join(' · ')) + '</div>' : '') + l2 + '</div>'
      + '<span class="st' + (ended ? ' ' + (ended.state === 'ask' ? 'wait' : 'stop') : '') + '" title="' + (ended ? '' : m.injected ? '插件已把最新全文注入本会话' : '本会话还没有当前版本，下一步注入') + '">' + st + (ended ? '' : ' · ' + esc(wan(m.chars)) + (m.files ? ' · ' + m.files + ' 个文件' : '')) + '</span>'
      + btn + '</div>'
  }
  private listHtml(mem: MemDetail[]): string {
    const fk = this.fresh
    return '<div class="lfs">' + mem.map((m) => (m.merge || m.migration ? '<div class="unit' + (fk === m.key ? ' fresh' : '') + '">' + this.lfRow(m, '') + (m.merge ? this.doneHtml(m.merge) : '') + (m.migration ? this.migHtml(m, m.migration) : '') + '</div>' : this.lfRow(m, fk))).join('') + '</div>'
  }

  /** 合并完成卡片（挂在合并结果下面）；合并前的落盘项目若本身是合并结果，就在它下面缩进列出（可折叠、可单独删除）。 */
  private oRows(v: MergeView): string {
    return v.srcs.map((s) => {
      const sub = s.sub && !s.sub.purged ? s.sub : null
      const kids = sub ? sub.srcs.filter((x) => x.exists).length : 0
      const open = sub ? !(this.shut.get(sub.id) ?? false) : false
      const tg = kids ? '<button type="button" class="ib xp" data-exp="' + esc(sub!.id) + '" aria-expanded="' + open + '" aria-label="展开或收起 ' + esc(nm(s.key)) + ' 合并前的 ' + kids + ' 个" title="' + (open ? '收起' : '展开') + '它合并前的 ' + kids + ' 个">' + ic('chev') + '</button>' : '<span class="xp-sp"></span>'
      const what = s.sub ? '合并结果 · ' + when(s.sub.at) + ' 合并' + (s.sub.purged || !kids ? ' · 它合并前的已删除' : '') : [s.kind === 'pointer' ? '指针' : '', s.key === v.key ? '合并前的旧版' : ''].filter(Boolean).join(' · ')
      const del = kids ? '<button type="button" class="btn sm danger ghost" data-sub-del="' + esc(sub!.id) + '" title="只删 ' + esc(nm(s.key)) + ' 合并前的 ' + sub!.all + ' 个；' + esc(nm(s.key)) + ' 本身留着"' + (this.ask.has(sub!.id) ? ' disabled' : '') + '>删除</button>' : '<span></span>'
      const row = '<div class="orow' + (s.exists ? '' : ' gone') + '">' + tg + '<span class="p mq"><b>' + esc(nm(s.key)) + '</b><span>' + esc(pj(s.key)) + (what ? ' · ' + esc(what) : '') + (s.exists ? '' : ' · 回收区里已不在') + '</span></span><span class="m">' + esc(wan(s.chars)) + (s.files ? ' · ' + s.files + ' 个文件' : '') + '</span>' + del + (s.retired ? copyBtn(s.retired + '/', '回收区路径') : '<span></span>') + '</div>'
      const lv = sub ? sub.srcs.map((x) => nm(x.key)).join('、') : ''
      const ask = sub && this.ask.has(sub.id) ? '<div class="ask in-row" role="alertdialog" aria-label="确认删除"><b>永久删除 ' + esc(nm(s.key)) + ' 合并前的 ' + sub.all + ' 个落盘项目（' + esc(lv) + '）？</b><br>' + esc(nm(s.key)) + ' 本身留在回收区：撤销 ' + esc(nm(v.key)) + ' 这次合并后 ' + esc(nm(s.key)) + ' 还会回来，但 ' + esc(lv) + ' 不能再恢复，' + esc(nm(s.key)) + ' 那次合并也就不能撤销了。<div class="ft"><span class="meta"></span><button type="button" class="btn sm" data-ask-no="' + esc(sub.id) + '">再想想</button><button type="button" class="btn sm danger solid" data-purge-yes="' + esc(sub.id) + '"' + (this.busy.has(sub.id) ? ' disabled' : '') + '>永久删除</button></div></div>' : ''
      return row + ask + (kids && open ? '<div class="nest">' + this.oRows(sub!) + '</div>' : '')
    }).join('')
  }
  private filesBlock(v: MergeView): string {
    const notes = v.files.filter((f) => f.rel.startsWith('notes/')).length + v.notes.length
    const evi = v.files.filter((f) => f.rel.startsWith('evidence/')).length
    const row = (k: string, val: string, extra = ''): string => '<div class="fr"><span class="fk">' + k + '</span><span class="fv">' + val + '</span>' + extra + '</div>'
    const dest = (this.info?.memDetail ?? []).find((m) => m.key === v.key)
    const destPath = dest ? '~/.ai/projects/' + pj(v.key) + '/memory/designs/' + nm(v.key) + '/' : ''
    const li = v.files.map((f) => '<li><span class="fp mq">' + esc(f.rel) + '</span><span class="ff mq">' + esc(f.from.join('、')) + (f.from.length > 1 ? ' · 内容相同只留一份' : '') + (f.ext ? ' · 从 ~/.ai 外复制' : '') + '</span></li>').join('') + v.notes.map((n) => '<li><span class="fp mq">' + esc(n) + '</span><span class="ff">合并时写的要点</span></li>').join('')
    return '<details class="fx"><summary>' + ic('chev') + '<b>文件归位</b><span class="fm">都在 ~/.ai 里 · 按 dsh-project-manager 的落盘项目规范</span></summary><div class="fx-b">'
      + row('合并结果', '<code class="mq">' + esc(destPath) + '</code><span class="fs">STATE.md · notes/ ' + notes + ' 份 · evidence/ ' + evi + ' 份 · 全部写进「📁 文件索引」</span>', destPath ? copyBtn(destPath, '文件夹路径') : '')
      + (li ? '<ul class="fl">' + li + '</ul>' : '')
      + row('合并前的', v.retiredDirs.map((d) => '<code class="mq">' + esc(home(d)) + '/</code>').join('') + '<span class="fs">' + v.srcs.map((s) => esc(nm(s.key))).join('、') + ' 整个文件夹已移入</span>')
      + (v.copied.length ? row('~/.ai 外的', '<span class="fs">' + v.copied.length + ' 个文件已复制进 evidence/，原文件不动，STATE 里的路径改指 ~/.ai：</span>' + v.copied.map((c) => '<code class="mq">' + esc(home(c.path)) + '</code>').join('')) : '')
      + (v.missing.length ? row('找不到的', '<span class="fs warn-t">' + v.missing.length + ' 个本机已不存在，写进「⚠ 待核实」，不编造：</span>' + v.missing.map((c) => '<code class="mq">' + esc(home(c)) + '</code>').join('')) : '')
      + (v.dropped.length ? row('不带过去', v.dropped.map((d) => '<code class="mq">' + esc(d) + '</code>').join('') + '<span class="fs">旧备份，留在回收区里</span>') : '')
      + '</div></details>'
  }
  private doneHtml(v: MergeView): string {
    const n = v.srcs.length
    const all = v.all
    const lv = (x: MergeView): number => x.srcs.reduce((a, s) => a + (s.sub ? lv(s.sub) : 1), 0)
    const leaves = lv(v)
    const open = !(this.fold.get(v.id) ?? false)
    const r = v.report
    const head = '<button type="button" class="dn-h" data-fold="' + esc(v.id) + '" aria-expanded="' + open + '"><span class="okc">' + ic('check') + '</span><b>合并完成</b><span class="dn-m">' + n + ' → 1 · ' + esc(when(v.at)) + '</span><span class="sp"></span><span class="dn-m">合并前 ' + all + ' 个在回收区</span>' + ic('chev') + '</button>'
    const inner = v.srcs.filter((s) => s.sub && !s.sub.purged).map((s) => s.key)
    const ask = this.ask.has(v.id) ? '<div class="ask" role="alertdialog" aria-label="确认删除"><b>永久删除 ' + esc(v.key) + ' 合并前的 ' + all + ' 个落盘项目？</b><br>' + (inner.length ? '包括 ' + inner.map(esc).join('、') + ' 和它合并前的落盘项目。' : '') + '会删掉回收区里这 ' + all + ' 个文件夹，删了这次合并就不能撤销。合并结果和其他合并都不受影响。<div class="ft"><span class="meta"></span><button type="button" class="btn sm" data-ask-no="' + esc(v.id) + '">再想想</button><button type="button" class="btn sm danger solid" data-purge-yes="' + esc(v.id) + '"' + (this.busy.has(v.id) ? ' disabled' : '') + '>永久删除</button></div></div>' : ''
    const body = '<div class="res"><div><b>' + n + ' → 1</b>落盘项目' + (leaves > n ? '（最初 ' + leaves + ' 个）' : '') + '</div><div><b>' + esc(r ? wan(r.chars).replace(' 万字', ' 万').replace(' 字', '') : '-') + '</b>STATE 字数</div><div><b>' + (r?.files ?? v.files.length) + '</b>个子文档</div></div>'
      + '<p class="sub">回读校验通过：没有丢章节，关键事实（commit / 路径 / 版本号 / 单号）都在' + (r?.drop ? '，有意删掉的 ' + r.drop + ' 条已列出' : '') + (r?.check ? '；「⚠ 待核实」' + r.check + ' 条' : '') + '。' + (v.refs.length ? '外部引用改了 ' + v.refs.length + ' 处：' + v.refs.map((x) => esc(home(x))).join('、') + '。' : '没有需要改的外部引用。') + (v.refsFailed.length ? '<span class="warn-t">另有 ' + v.refsFailed.length + ' 处没改成：' + v.refsFailed.map((x) => esc(home(x.file))).join('、') + '</span>' : '') + '</p>'
      + this.filesBlock(v)
      + '<div class="old"><p class="old-t">合并前的落盘项目 ' + n + ' 个' + (all > n ? '（含更早合并的 ' + (all - n) + ' 个）' : '') + ' · 在回收区' + (v.undo ? '' : '，可撤销') + '</p>' + this.oRows(v) + '</div>' + ask
      + '<div class="ft"><span class="meta mq" title="' + esc(v.undo ?? '') + '">' + esc(v.undo ? '不能撤销：' + v.undo : '撤销回到 ' + v.srcs.map((s) => nm(s.key)).join('、')) + '</span><button type="button" class="btn sm" data-mg-undo="' + esc(v.id) + '"' + (v.undo || this.busy.has(v.id) ? ' disabled' : '') + ' title="只退回这一次合并">' + ic('undo') + '撤销合并</button><button type="button" class="btn sm danger" data-purge="' + esc(v.id) + '"' + (this.ask.has(v.id) || this.busy.has(v.id) ? ' disabled' : '') + '>删除合并前的落盘项目</button></div>'
    return '<div class="dn' + (open ? ' open' : '') + '" id="dpm-dn-' + esc(v.id) + '">' + head + '<div class="dn-b"><div class="in"><div class="dn-body">' + body + '</div></div></div></div>'
  }

  private runHtml(): string {
    const r = this.info!.merging!
    const steps: Array<[string, string, number]> = [['读全来源', r.srcs.length + ' 份 STATE + [必读] 子文档 · ' + r.read + '/' + r.total, r.read >= r.total ? 2 : 1], ['逐份写要点', '防止上下文压缩丢进度 · ' + r.noted + '/' + r.total, r.noted >= r.total ? 2 : r.read >= r.total ? 1 : 0], ['整体重写并提交', '一份 STATE + notes/；插件校验关键事实、文件索引，归位文件、换关联、改外部引用', r.noted >= r.total ? 1 : 0]]
    const tl = steps.map(([t, s, k]) => '<li class="' + (k === 2 ? 'ok' : k === 1 ? 'on' : '') + '"><span class="nd">' + (k === 2 ? ic('check') : '') + '</span><div style="flex:1;min-width:0"><div>' + t + '</div><div class="mono">' + esc(s) + '</div>' + (k === 1 && t === '读全来源' ? '<div class="bar"><i style="width:' + Math.round(r.read / Math.max(1, r.total) * 100) + '%"></i></div>' : '') + '</div></li>').join('')
    return '<div class="mg" id="dpmMg"><h4>正在把 ' + r.total + ' 个合并到 ' + esc(r.key) + '</h4><p class="sub">合并在本会话里由 AI 进行，期间可以照常看进度；关掉页面也不会中断。</p><ul class="tl">' + tl + '</ul><div class="ft"><span class="meta">还没提交前可以取消，什么都不会改</span><button type="button" class="btn sm" data-mg-abort="' + esc(r.id) + '">取消合并</button></div></div>'
  }
  private mgHtml(mem: MemDetail[]): string {
    const m = this.mg!
    const srcs = mem.filter((x) => x.found).map((x) => '<label class="src" title="' + esc(x.merge ? '合并结果：它合并前的 ' + x.merge.all + ' 个会一起归到这次新合并下' : x.key) + '"><input type="checkbox" data-src="' + esc(x.key) + '"' + (m.sel.has(x.key) ? ' checked' : '') + '><span class="p mq">' + esc(x.key) + '</span><span class="m">' + (x.pointer ? '指针 · ' : '') + (x.merge ? '合并结果 · ' : '') + esc(wan(x.chars)) + (x.files ? ' · ' + x.files + ' 个文件' : '') + '</span></label>').join('')
    return '<div class="mg" id="dpmMg"><h4 id="dpmMgT"></h4><p class="sub">默认全选，取消勾选的保持原样。本会话的 AI 先读全所选来源，再整体重写成一份；来源不删除，移到回收区，可以一键撤销。</p>'
      + '<div class="srcs-h"><span id="dpmMgCount" aria-live="polite"></span><span class="sp"></span><button type="button" class="btn sm" id="dpmSelAll" data-sel-all>全选</button><button type="button" class="btn sm" id="dpmSelNone" data-sel-none>全不选</button></div><div class="srcs">' + srcs + '</div>'
      + '<div class="tgt"><label for="dpmMgName">合并成</label><div class="fld"><span class="mono" id="dpmMgPj"></span><input id="dpmMgName" type="text" spellcheck="false" autocomplete="off"></div><label>别名</label><div class="als" id="dpmMgAls"></div></div>'
      + '<p class="warn" id="dpmMgWarn" role="status"></p><ol class="plan" id="dpmMgPlan"></ol><div id="dpmMgFiles"></div>'
      + '<div class="ft"><span class="meta" id="dpmMgMeta"></span><button type="button" class="btn sm" data-mg-cancel>取消</button><button type="button" class="btn sm pri" data-mg-go id="dpmMgGo">' + ic('merge') + '开始合并</button></div></div>'
  }
  /** 合并面板里随勾选 / 名字变化的部分（不重画整块，保留焦点）。 */
  private fillMg(): void {
    const m = this.mg
    const box = this.root.querySelector('#dpmMg') as HTMLElement | null
    if (!m || !box || this.info?.merging) return
    const $ = (id: string): HTMLElement => box.querySelector('#' + id) as HTMLElement
    const mem = (this.info?.memDetail ?? []).filter((x) => x.found)
    const chosen = mem.filter((x) => m.sel.has(x.key))
    const n = chosen.length
    const first = chosen.find((x) => !x.pointer) ?? chosen[0]
    const inp = $('dpmMgName') as HTMLInputElement
    if (!m.touched && first && document.activeElement !== inp) { m.name = first.slug; inp.value = m.name } else if (inp.value !== m.name && document.activeElement !== inp) inp.value = m.name
    $('dpmMgPj').textContent = (first ? first.project : '项目') + ' /'
    $('dpmMgT').textContent = n >= 2 ? '合并 ' + n + ' 个落盘项目' : '合并落盘项目'
    const pv = m.pv
    const okPv = !!pv && n >= 2
    $('dpmMgAls').innerHTML = okPv && pv!.aliases.length ? pv!.aliases.map((a) => '<span>' + esc(a) + '</span>').join('') : '<span class="none">' + (n >= 2 ? '无' : '—') + '</span>'
    const warn = n < 2 ? '至少选 2 个才能合并' : !NAME_RE.test(m.name) ? '名字只能用字母、数字和 . _ -' : m.err ? m.err : pv?.clash ? '「' + pv.key + '」已存在且没被选上：换个名字，或把它也选进来' : pv?.busy ? '其中有落盘项目正在另一次合并里' : pv && !pv.toolOk ? '合并需要新版 ai-memory：先在项目看板顶部点「升级 ai-memory」' : ''
    const w = $('dpmMgWarn'); w.textContent = warn; w.hidden = !warn
    const rest = mem.length - n
    const mm = chosen.filter((x) => x.merge)
    const ptr = chosen.filter((x) => x.pointer).length
    const plan = n < 2 || !pv ? ['选好后这里会列出合并会做的事'] : [
      'AI 读全 <b>' + n + ' 份 STATE</b> 与它们的 [必读] 子文档（约 ' + wan(pv.chars) + '，分段读完）；每读完一份先写一份要点',
      '整体重写成 <b>一份 STATE</b>（≤3 万字），细节写进 <b>notes/</b>；来源之间说法矛盾的写进「⚠ 待核实」，不替你选边',
      '所有文件归位到 <b>~/.ai</b>：明细见下面「文件去向」',
      pv.aliases.length ? '被合并的名字变成别名：<b>说「回忆 ' + esc(pv.aliases[0]) + '」照样能找到</b>' + (ptr ? '（其中 ' + ptr + ' 份是指针，只存了路径）' : '') : '',
      mm.length ? '其中 ' + mm.map((x) => '<b>' + esc(x.slug) + '</b>').join('、') + ' 是合并结果：它合并前的一起归到这次合并下；<b>撤销这次合并会回到现在的样子</b>' : '',
      '卡片和卡片组里这 ' + n + ' 个关联换成合并结果' + (pv.refs.length ? '；~/.ai 里引用旧路径的 <b>' + pv.refs.length + ' 处</b>一并改指向' : ''),
      rest ? '<b>没选的 ' + rest + ' 个保持原样</b>，照常显示和注入' : '',
    ].filter(Boolean)
    $('dpmMgPlan').innerHTML = plan.map((t) => '<li>' + t + '</li>').join('')
    const fx = $('dpmMgFiles')
    const wasOpen = (fx.querySelector('details') as HTMLDetailsElement | null)?.open ?? true
    fx.innerHTML = okPv && !warn ? this.previewFiles(pv!) : ''
    const nd = fx.querySelector('details') as HTMLDetailsElement | null
    if (nd) nd.open = wasOpen
    $('dpmMgMeta').textContent = m.busy ? '正在发出…' : rest ? '没选的 ' + rest + ' 个不动' : '合并在本会话里进行，期间能看进度'
    ;($('dpmMgGo') as HTMLButtonElement).disabled = !!warn || !pv || m.busy
    $('dpmMgCount').textContent = '已选 ' + n + ' / ' + mem.length
    ;($('dpmSelAll') as HTMLButtonElement).disabled = n === mem.length
    ;($('dpmSelNone') as HTMLButtonElement).disabled = !n
    box.querySelectorAll<HTMLInputElement>('[data-src]').forEach((el) => { el.checked = m.sel.has(el.dataset.src as string) })
    this.root.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => el.classList.toggle('picked', m.sel.has(el.dataset.row as string)))
  }
  private previewFiles(pv: MergePreview): string {
    const row = (k: string, v: string, extra = ''): string => '<div class="fr"><span class="fk">' + k + '</span><span class="fv">' + v + '</span>' + extra + '</div>'
    const dest = '~/.ai/projects/' + pj(pv.key) + '/memory/designs/' + nm(pv.key) + '/'
    const notes = pv.files.filter((f) => f.rel.startsWith('notes/')).length + pv.notes.length
    const evi = pv.files.filter((f) => f.rel.startsWith('evidence/')).length
    const li = pv.files.map((f) => '<li><span class="fp mq">' + esc(f.rel) + '</span><span class="ff mq">' + esc(f.from.join('、')) + (f.from.length > 1 ? ' · 内容相同只留一份' : '') + (f.ext ? ' · 从 ~/.ai 外复制' : '') + '</span></li>').join('') + pv.notes.map((x) => '<li><span class="fp mq">' + esc(x) + '</span><span class="ff">合并时写的要点</span></li>').join('')
    return '<details class="fx" open><summary>' + ic('chev') + '<b>文件去向</b><span class="fm">都在 ~/.ai 里 · 按 dsh-project-manager 的落盘项目规范</span></summary><div class="fx-b">'
      + row('合并结果', '<code class="mq">' + esc(dest) + '</code><span class="fs">STATE.md（重写）· notes/ ' + notes + ' 份 · evidence/ ' + evi + ' 份 · 全部写进「📁 文件索引」</span>', copyBtn(dest, '文件夹路径'))
      + (li ? '<ul class="fl">' + li + '</ul>' : '')
      + row('合并前的', pv.retired.map((x) => '<code class="mq">' + esc(home(x.path)) + '</code><span class="fs">' + x.names.map(esc).join('、') + ' 整个文件夹移入</span>').join(''))
      + (pv.copied.length ? row('~/.ai 外的', '<span class="fs">' + pv.copied.length + ' 个文件复制进 evidence/，原文件不动，STATE 里的路径改指 ~/.ai：</span>' + pv.copied.map((c) => '<code class="mq">' + esc(home(c.path)) + '</code>').join('')) : '')
      + (pv.missing.length ? row('找不到的', '<span class="fs warn-t">' + pv.missing.length + ' 个本机已不存在，写进「⚠ 待核实」，不编造：</span>' + pv.missing.map((c) => '<code class="mq">' + esc(home(c.path)) + '</code>').join('')) : '')
      + (pv.dropped.length ? row('不带过去', pv.dropped.map((d) => '<code class="mq">' + esc(d.rel) + '</code>').join('') + '<span class="fs">旧备份，留在回收区里</span>') : '')
      + (pv.refs.length ? row('外部引用', pv.refs.map((x) => '<code class="mq">' + esc(home(x)) + '</code>').join('') + '<span class="fs">里面的旧路径改指合并结果（撤销时改回）</span>') : '')
      + '</div></details>'
  }
  private schedulePreview(): void {
    clearTimeout(this.pvTimer)
    const m = this.mg
    if (!m) return
    m.pv = m.sel.size >= 2 ? m.pv : null
    m.err = ''
    this.fillMg()
    if (m.sel.size < 2 || !NAME_RE.test(m.name)) return
    const seq = ++m.seq
    this.pvTimer = window.setTimeout(() => {
      getMergePreview(this.sid, [...m.sel], m.name).then((pv) => { if (this.mg !== m || m.seq !== seq) return; m.pv = pv; m.err = ''; if (!m.touched) m.name = nm(pv.key); this.fillMg() })
        .catch((e) => { if (this.mg !== m || m.seq !== seq) return; m.pv = null; m.err = e instanceof ApiError ? e.message : String(e); this.fillMg() })
    }, 200)
  }

  private matHtml(): string {
    const ci = this.info!.cardInfo!
    const sec = (icon: string, t: string, n: string | number, body: string): string => '<div class="ma-s"><p class="ma-t">' + ic(icon) + t + ' <span class="c">' + n + '</span></p>' + body + '</div>'
    const repos = ci.repos.length ? ci.repos.map((r) => '<div class="row"><span class="k mq">' + esc(r.name) + '</span><span class="v mono mq">' + esc(r.path) + '</span>' + copyBtn(r.path, '仓库路径') + '</div>').join('') : '<p class="empty">没有仓库</p>'
    const tasks = ci.tasks.length ? ci.tasks.map((t) => '<div class="row task' + (t.done ? ' dn' : '') + '"><span class="bx">' + (t.done ? ic('check') : '') + '</span><span class="v mq">' + esc(t.text) + '</span></div>').join('') : '<p class="empty">没有子任务</p>'
    const notes = ci.notes.trim() ? '<p class="note">' + esc(ci.notes) + '</p>' : '<p class="empty">没有相关说明</p>'
    const links = ci.links.length ? ci.links.map((l) => '<div class="row"><span class="ty">' + esc(l.type) + '</span><span class="v pri mq" title="' + esc(l.url) + '">' + esc(l.text) + '</span>' + copyBtn(l.url, '链接') + '<a class="ib" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" aria-label="打开链接 ' + esc(l.text) + '" title="打开链接">' + ic('ext') + '</a></div>').join('') : '<p class="empty">没有相关链接</p>'
    const files = ci.files.length ? ci.files.map((f) => '<div class="row' + (f.exists ? '' : ' gone') + '"><span class="k mq">' + esc(f.path.split('/').pop() ?? f.path) + '</span><span class="v mono mq">' + esc(f.path) + (f.exists ? '' : '（已删除）') + '</span>' + copyBtn(f.path, '文件路径') + '</div>').join('') : '<p class="empty">没有相关文件</p>'
    return '<div class="ma">' + sec('repo', '仓库', ci.repos.length, repos) + sec('clip', '子任务', ci.tasks.length ? ci.tasks.filter((t) => t.done).length + '/' + ci.tasks.length : 0, tasks) + sec('note', '相关说明', ci.notes.trim() ? ci.notes.length + ' 字' : 0, notes) + sec('link', '相关链接', ci.links.length, links) + sec('file', '相关文件', ci.files.length, files) + '</div>'
  }
  private mkTok(): void {
    const inp = this.root.querySelector('#dpmMkIn') as HTMLInputElement | null
    const box = this.root.querySelector('#dpmMkTok') as HTMLElement | null
    if (!inp || !box) return
    const names = inp.value.split(/\s+/).filter(Boolean)
    const raw = names.find((n) => !/[\u4e00-\u9fff]/.test(n))
    const ex = this.mt.r?.mode === 'exact' && this.mt.q === inp.value.trim() ? this.mt.r.hits : []
    const dup = (n: string): boolean => ex.some((h) => h.slug.toLowerCase() === n.toLowerCase() || h.aliases.some((a) => a.toLowerCase() === n.toLowerCase()))
    box.innerHTML = names.slice(0, 4).map((n) => '<span class="' + (dup(n) ? 'dup' : n === raw ? 'file' : '') + '">' + esc(n) + (dup(n) ? ' · 已存在' : n === raw ? ' · 文件名' : '') + '</span>').join('')
  }

  // ── 0.20 落盘这一轮的结局 / 同名检测 / 卡片组落盘文件夹 / 迁移 ──
  private hhmm(t: number): string { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
  private endSt(r: LfRun): string { return r.state === 'ask' ? ic('ask') + '等你回复' : r.state === 'error' ? ic('x') + '出错停止，没写入' : r.state === 'nowrite' ? ic('x') + '这一轮没写入' : ic('stop') + '已停止，没写入' }
  private endText(r: LfRun, ver = ''): string {
    const at = this.hhmm(r.end ?? r.at)
    if (r.state === 'ask') return 'AI 落盘前在问你问题，回答后它会接着写'
    if (r.state === 'error') return (r.error ? r.error.slice(0, 80) + ' · ' : '') + at + ' 那一轮中断' + (ver ? '，STATE 没变（仍是 ' + ver + '）' : '')
    if (r.state === 'nowrite') return at + ' 那一轮结束了，但没有写入' + (ver ? '（STATE 仍是 ' + ver + '）' : '') + '：AI 可能没完成或在等你'
    return '「落盘项目 ' + (r.key || r.label) + '」那一轮在 ' + at + ' 被停止' + (ver ? '，STATE 没变（仍是 ' + ver + '）' : '')
  }
  /** 未关联时首行的主按钮：进行中 / 等回复 / 重新新建 / 关联并落盘（完全同名）/ 新建并落盘。 */
  private mkBtn(run: LfRun | null, busy: boolean): string {
    if (busy) return '<button type="button" class="btn sm pri" disabled>' + (run?.state === 'ask' ? '等待回复' : '<span class="spin"></span>落盘中') + '</button>'
    const m = this.mt.r
    if (m?.mode === 'exact' && m.hits[0]) return '<button type="button" class="btn sm pri" data-link-lf="' + esc(m.hits[0].key) + '" title="关联 ' + esc(m.hits[0].key) + ' 并在本会话落盘">' + ic('save') + '关联并落盘</button>'
    return '<button type="button" class="btn sm pri" data-mk>' + ic('plus') + (run && run.state !== 'done' ? '重新新建并落盘' : '新建并落盘') + '</button>'
  }
  private runLine(run: LfRun | null): string {
    if (!run || run.state === 'busy' || run.state === 'done') return ''
    const label = '「新建 ' + run.label + '」'
    if (run.state === 'ask') return '<div class="hint-l">AI 在问你问题，回答后它会接着建</div>'
    const em = run.state === 'error' ? '出错停止' : run.state === 'nowrite' ? '没建出来' : '已停止'
    const why = run.state === 'error' ? (run.error ? run.error.slice(0, 80) + '，' : '') + '还没建出来' : run.state === 'nowrite' ? label + '那一轮结束了，但没有写入' : label + '那一轮在 ' + this.hhmm(run.end ?? run.at) + ' 被停止，还没建出来'
    return '<div class="hint-l" role="status"><span class="em">' + em + '</span><span class="mq">' + esc(why) + '</span><span class="sp"></span><button type="button" class="lnk" data-dismiss>忽略</button></div>'
  }
  /** 卡片组还没设落盘文件夹：落盘前请用户确认一次（按组名给建议，可改）。 */
  private folderHtml(): string {
    const fo = this.info?.folder
    if (!this.ask0 || !fo || fo.value) return ''
    return '<div class="fo" role="dialog" aria-label="确认卡片组的落盘文件夹"><p class="fo-t">先给卡片组「' + esc(fo.group) + '」定一个落盘文件夹（只问这一次）</p><p class="fo-s">这个组的落盘项目以后都放这里；旧的落盘项目在下次落盘时自动迁过来（可撤销）。</p>'
      + '<div class="fo-r"><label class="fld"><span class="pre">~/.ai/projects/</span><input id="dpmFoIn" value="' + esc(fo.suggest ?? '') + '" spellcheck="false" autocomplete="off" aria-label="落盘文件夹名"><span class="pre">/</span></label><button type="button" class="btn sm" data-fo-no>取消</button><button type="button" class="btn sm pri" data-fo-ok>确认并继续</button></div><p class="fo-e" id="dpmFoErr" role="status"></p></div>'
  }
  private migHtml(m: MemDetail, v: MigView): string {
    const open = !(this.fold.get(v.id) ?? true)
    const head = '<button type="button" class="dn-h" data-fold="' + esc(v.id) + '" aria-expanded="' + open + '"><span class="okc">' + ic('check') + '</span><b>已按规范迁移</b><span class="dn-m">' + esc(pj(v.from)) + ' → ' + esc(m.project) + ' · ' + esc(when(v.at)) + '</span><span class="sp"></span>' + ic('chev') + '</button>'
    const body = '<p class="sub">落盘时插件把整个文件夹从 ' + esc(v.from) + ' 迁到了卡片组的落盘文件夹' + ([v.files ? v.files + ' 个子文档一起搬过来，里面的旧路径已改指新位置' : '', v.refs ? '~/.ai 里 ' + v.refs + ' 处外部引用已改指向' : ''].filter(Boolean).map((x, k) => (k ? '；' : '（') + x).join('') + ([v.files, v.refs].some(Boolean) ? '）' : '')) + '。' + (v.exists ? '旧文件夹在回收区：' : '旧文件夹已不在回收区。') + '</p>'
      + (v.exists ? '<div class="orow"><span class="xp-sp"></span><span class="p mq"><b>' + esc(nm(v.from)) + '</b><span>' + esc(home(v.retired)) + '/</span></span><span></span><span></span>' + copyBtn(v.retired + '/', '回收区路径') + '</div>' : '')
      + '<div class="ft"><span class="meta mq" title="' + esc(v.undo ?? '') + '">' + esc(v.undo ? '不能撤销：' + v.undo : '撤销 = 搬回 ' + v.from + '（之后不再自动迁）') + '</span><button type="button" class="btn sm" data-mig-undo="' + esc(v.id) + '"' + (v.undo || this.busy.has(v.id) ? ' disabled' : '') + '>' + ic('undo') + '撤销迁移</button><button type="button" class="btn sm danger" data-mig-purge="' + esc(v.id) + '"' + (this.busy.has(v.id) ? ' disabled' : '') + '>' + (v.exists ? '删除旧文件夹' : '不再显示') + '</button></div>'
    return '<div class="dn' + (open ? ' open' : '') + '" id="dpm-dn-' + esc(v.id) + '">' + head + '<div class="dn-b"><div class="in"><div class="dn-body">' + body + '</div></div></div></div>'
  }
  private scheduleMatch(): void {
    clearTimeout(this.mtTimer)
    const q = ((this.root.querySelector('#dpmMkIn') as HTMLInputElement | null)?.value ?? '').trim()
    if (q === this.mt.q) return
    const seq = ++this.mt.seq
    this.mtTimer = window.setTimeout(() => {
      getMatch(this.sid, q).then((r) => { if (this.dead || seq !== this.mt.seq) return; this.mt = { q, r, seq }; this.fillMt() }, () => undefined)
    }, 200)
  }
  /** 同名候选区 + 主按钮 + 名字标签（局部更新，不动输入框）。 */
  private fillMt(): void {
    const box = this.root.querySelector('#dpmMtIn') as HTMLElement | null
    if (!box) return
    const r = this.mt.r
    const run = this.info?.lfRun && !this.info.lfRun.key ? this.info.lfRun : null
    const busy = !!this.sending || run?.state === 'busy' || run?.state === 'ask'
    const btn = this.root.querySelector('#dpmMkBtn') as HTMLElement | null
    if (btn) btn.innerHTML = this.mkBtn(run, busy)
    this.root.querySelector('#dpmMk')?.classList.toggle('dup', r?.mode === 'exact')
    this.mkTok()
    const mt = this.root.querySelector('#dpmMt') as HTMLElement | null
    const show = !!r && r.hits.length > 0 && !busy && !this.ask0
    mt?.classList.toggle('on', show)
    if (!show || !r) { box.innerHTML = ''; return }
    const title = { hint: '可能就是这个', exact: '已有同名落盘项目', near: '名字相近的落盘项目', none: '' }[r.mode]
    const why = { hint: '按卡片名找到的', exact: '同名不能再新建（回忆 / 落盘会分不清是哪个）', near: '确认不是同一个的话，照常新建', none: '' }[r.mode]
    const q0 = r.mode === 'near' ? (this.mt.q.split(/\s+/).find((n) => !/[\u4e00-\u9fff]/.test(n)) ?? '').toLowerCase() : ''
    const hl = (sl: string): string => { const i = q0 ? sl.toLowerCase().indexOf(q0) : -1; return i < 0 ? esc(sl) : esc(sl.slice(0, i)) + '<mark>' + esc(sl.slice(i, i + q0.length)) + '</mark>' + esc(sl.slice(i + q0.length)) }
    const cands = r.hits.map((h) => '<div class="cand' + (r.mode === 'exact' ? ' exact' : '') + '"><div class="txt"><div class="l1"><span class="nm mq">' + hl(h.slug) + '</span><span class="pj">' + esc(h.project) + '</span>' + (h.aliases.length ? '<span class="tag mq">别名 ' + esc(h.aliases.slice(0, 3).join(' · ')) + '</span>' : '') + '</div>'
      + '<div class="l2 mq">' + esc(h.why) + ' · ' + esc(wan(h.chars)) + ' · ' + esc(h.updated) + ' 更新 · ' + (h.cards.length ? '已关联卡片「' + esc(h.cards.join('」「')) + '」' : '还没关联任何卡片') + '</div>'
      + (h.moveTo ? '<div class="l3">落盘时迁到 <b>~/.ai/projects/' + esc(h.moveTo) + '/memory/designs/' + esc(h.slug) + '/</b>（可撤销）</div>' : '') + '</div>'
      + '<span class="cacts"><button type="button" class="btn sm" data-only-lf="' + esc(h.key) + '" title="只关联到本卡片，不落盘">只关联</button><button type="button" class="btn sm pri" data-link-lf="' + esc(h.key) + '" title="关联到本卡片，并在本会话执行「落盘项目 ' + esc(h.key) + '」">' + ic('save') + '关联并落盘</button></span></div>').join('')
    const sug = r.mode === 'exact' ? nm(r.hits[0].key) + '-2' : ''
    const foot = r.mode === 'exact' ? '<p class="mt-f">要另起一个新的？换个名字，例如 <button type="button" class="lnk" data-fill="' + esc(sug) + '">' + esc(sug) + '</button></p>' : r.mode === 'hint' ? '<p class="mt-f">不是它？直接在上面输入新名字</p>' : ''
    box.innerHTML = '<div class="mt-b"><p class="mt-t">' + esc(title) + '<span class="sp"></span><span class="why">' + esc(why) + '</span></p>' + cands + foot + '</div>'
  }
  /** 发「落盘项目 …」：先登记这一轮（信息卡据此跟踪结局），再排进会话。 */
  private async sendLf(key: string, label: string, text: string, toast: string): Promise<void> {
    if (this.sending) return
    this.sending = key || '__new'
    this.render()
    try {
      await post('lf/run', { sessionId: this.sid, key, label })
      await this.host.send(this.sid, text)
      this.host.toast(toast)
    } catch (e) {
      await post('lf/run-dismiss', { sessionId: this.sid }).catch(() => undefined)
      this.host.toast('发送失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally { this.sending = null; await this.load(true) }
  }
  /** 卡片组还没设落盘文件夹 → 先确认（只问一次），确认后继续原来的动作。 */
  private needFolder(next: { kind: 'new' | 'key'; key?: string }): boolean {
    const fo = this.info?.folder
    if (!fo || fo.value) return false
    this.ask0 = next
    this.open = true
    this.render()
    setTimeout(() => { const i = this.root.querySelector('#dpmFoIn') as HTMLInputElement | null; i?.focus(); i?.select() }, 30)
    return true
  }
  private async linkLf(key: string, persist: boolean): Promise<void> {
    if (persist && this.needFolder({ kind: 'key', key })) return
    try { await post('lf/link', { sessionId: this.sid, key }) } catch (e) { this.host.toast('关联失败：' + (e instanceof ApiError ? e.message : String(e)), 'err'); return }
    const el = this.root.querySelector('#dpmMkIn') as HTMLInputElement | null
    if (el) el.value = ''
    this.mt = { q: '\u0000', r: null, seq: this.mt.seq + 1 }
    this.open = true
    if (!persist) { this.host.toast('已把 ' + key + ' 关联到这张卡片'); await this.load(true); return }
    await this.sendLf(key, key, '落盘项目 ' + key, '已关联 ' + key + '，并在本会话发出「落盘项目 ' + key + '」')
  }

  // ── 交互 ──
  private onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement
    if (t.id === 'dpmMkIn') { this.mkTok(); this.scheduleMatch(); return }
    if (t.id === 'dpmFoIn') { const e = this.root.querySelector('#dpmFoErr'); if (e) e.textContent = ''; return }
    if (t.id === 'dpmMgName' && this.mg) { this.mg.name = t.value.trim(); this.mg.touched = true; this.schedulePreview() }
  }
  private onChange = (e: Event): void => {
    const t = e.target as HTMLInputElement
    if (this.mg && t.dataset.src !== undefined) { if (t.checked) this.mg.sel.add(t.dataset.src); else this.mg.sel.delete(t.dataset.src); this.schedulePreview() }
  }
  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && t.id === 'dpmMkIn') { e.preventDefault(); const m = this.mt.r; if (m?.mode === 'exact' && m.hits[0] && this.mt.q === (t as HTMLInputElement).value.trim()) void this.linkLf(m.hits[0].key, true); else void this.make() }
    if (e.key === 'Enter' && t.id === 'dpmFoIn') { e.preventDefault(); void this.saveFolder() }
    if (e.key === 'Escape' && t.id === 'dpmFoIn') { e.preventDefault(); this.ask0 = null; this.render() }
  }
  private toggle(): void {
    this.open = !this.open
    this.root.classList.toggle('open', this.open)
    this.root.querySelectorAll('[data-tgl]').forEach((b) => b.setAttribute('aria-expanded', String(this.open)))
  }
  private async act<T>(id: string, fn: () => Promise<T>, ok: (r: T) => string): Promise<void> {
    if (this.busy.has(id)) return
    this.busy.add(id); this.render()
    try { const r = await fn(); this.host.toast(ok(r)) } catch (e) { this.host.toast(e instanceof ApiError ? e.message : String(e), 'err') } finally { this.busy.delete(id); this.ask.delete(id); await this.load(true) }
  }
  private async saveFolder(): Promise<void> {
    const inp = this.root.querySelector('#dpmFoIn') as HTMLInputElement | null
    const v = (inp?.value ?? '').trim().toLowerCase()
    const err = this.root.querySelector('#dpmFoErr') as HTMLElement | null
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)) { if (err) err.textContent = '只能用小写字母、数字和 . _ -，以字母或数字开头'; inp?.focus(); return }
    try { await post('lf/folder', { sessionId: this.sid, value: v }) } catch (e) { if (err) err.textContent = e instanceof ApiError ? e.message : String(e); inp?.focus(); return }
    const next = this.ask0
    this.ask0 = null
    this.host.toast('卡片组「' + (this.info?.folder?.group ?? '') + '」的落盘文件夹：~/.ai/projects/' + v + '/')
    await this.load(true)
    if (next?.kind === 'key' && next.key) {
      const has = (this.info?.memDetail ?? []).some((x) => x.key === next.key)
      if (has) await this.sendLf(next.key, next.key, '落盘项目 ' + next.key, '已在本会话发出「落盘项目 ' + next.key + '」')
      else await this.linkLf(next.key, true)
    } else if (next?.kind === 'new') await this.make()
  }
  private async make(): Promise<void> {
    if (this.sending) return
    const v = ((this.root.querySelector('#dpmMkIn') as HTMLInputElement | null)?.value ?? '').trim()
    const m = this.mt.r
    if (m?.mode === 'exact' && this.mt.q === v && m.hits[0]) { this.host.toast('已有同名落盘项目 ' + m.hits[0].key + '：点「关联并落盘」，或换个名字', 'err'); return }
    if (this.needFolder({ kind: 'new' })) return
    const { file, aliases } = parseNames(v)
    const text = file ? '落盘项目：新建 ' + file + (aliases.length ? '（别名：' + aliases.join('、') + '，写进 STATE 的 aliases: 行）' : '') + '，关联到本卡片' : v ? '落盘项目：新建，名字由你按「' + v + '」起一个英文文件名（这些词都写进 STATE 的 aliases: 行），关联到本卡片' : '落盘项目：新建，名字由你按本会话内容起，关联到本卡片'
    await this.sendLf('', file ?? (v || 'AI 起名'), text, file ? '已发出「落盘项目 新建 ' + file + '」' + (aliases.length ? '，别名 ' + aliases.join(' ') : '') : '已发出「落盘项目 新建」，名字由 AI 起')
  }
  private onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest('button, a, summary') as HTMLElement | null
    if (!t || !this.root.contains(t)) return
    const d = t.dataset
    const i = this.info
    if (d.tgl !== undefined) return this.toggle()
    if (d.board !== undefined && i?.card) return this.host.openBoard(i.card.id)
    if (d.raw !== undefined) { void this.openRaw(t); return }
    if (d.copy !== undefined) { void this.copy(t, d.copy, d.what ?? ''); return }
    if (d.mk !== undefined) { void this.make(); return }
    if (d.linkLf) { void this.linkLf(d.linkLf, true); return }
    if (d.onlyLf) { void this.linkLf(d.onlyLf, false); return }
    if (d.fill) { const el = this.root.querySelector('#dpmMkIn') as HTMLInputElement | null; if (el) { el.value = d.fill; el.focus(); this.mkTok(); this.scheduleMatch() } return }
    if (d.foOk !== undefined) { void this.saveFolder(); return }
    if (d.foNo !== undefined) { this.ask0 = null; this.render(); return }
    if (d.dismiss !== undefined) { void post('lf/run-dismiss', { sessionId: this.sid }).then(() => this.load(true)); return }
    if (d.migUndo) { const id = d.migUndo; void this.act(id, () => post<{ key: string }>('lf/migrate-undo', { id }), (r) => '已撤销迁移：搬回 ' + r.key + '，之后落盘不再自动迁'); return }
    if (d.migPurge) { const id = d.migPurge; void this.act(id, () => post('lf/migrate-purge', { id }), () => '已删除迁移前的旧文件夹'); return }
    if (d.lf) {
      const m = (i?.memDetail ?? []).find((x) => x.key === d.lf)
      if (!m || this.sending) return
      if (m.moveTo === null && i?.folder && !i.folder.value && this.needFolder({ kind: 'key', key: m.key })) return
      void this.sendLf(m.key, m.key, '落盘项目 ' + m.key, '已在本会话发出「落盘项目 ' + m.key + '」' + (m.moveTo ? '（落盘时迁到 ' + m.moveTo + '）' : ''))
      return
    }
    if (d.merge !== undefined) { this.mg = { sel: new Set((i?.memDetail ?? []).filter((x) => x.found).map((x) => x.key)), name: '', touched: false, pv: null, err: '', seq: 0, busy: false }; this.open = true; this.render(); this.schedulePreview(); reveal(this.root.querySelector('#dpmMg')); return }
    if (d.selAll !== undefined && this.mg) { for (const x of i?.memDetail ?? []) if (x.found) this.mg.sel.add(x.key); this.schedulePreview(); return }
    if (d.selNone !== undefined && this.mg) { this.mg.sel.clear(); this.schedulePreview(); return }
    if (d.mgCancel !== undefined) { this.mg = null; this.render(); return }
    if (d.mgGo !== undefined && this.mg && this.mg.pv) { void this.startMerge(); return }
    if (d.mgAbort) { if (!window.confirm('取消这次合并？还没提交，落盘项目和关联都不会变。')) return; void this.act(d.mgAbort, () => post('merge/cancel', { id: d.mgAbort }), () => '已取消合并'); return }
    // 0.20：按当前展开状态切换（合并卡片默认展开、迁移卡片默认收起，不能按存的默认值猜）
    if (d.fold) { const v = t.getAttribute('aria-expanded') === 'true'; this.fold.set(d.fold, v); const el = this.root.querySelector('#dpm-dn-' + CSS.escape(d.fold)); el?.classList.toggle('open', !v); t.setAttribute('aria-expanded', String(!v)); return }
    if (d.exp) { this.shut.set(d.exp, !(this.shut.get(d.exp) ?? false)); this.render(); return }
    if (d.purge || d.subDel) { this.ask.add((d.purge || d.subDel) as string); this.render(); reveal(this.root.querySelector('.ask')); return }
    if (d.askNo) { this.ask.delete(d.askNo); this.render(); return }
    if (d.purgeYes) { const id = d.purgeYes; void this.act(id, () => post<{ removed: number }>('merge/purge', { id }), (r) => '已永久删除合并前的 ' + r.removed + ' 个落盘项目；其他合并不受影响'); return }
    if (d.mgUndo) { const id = d.mgUndo; void this.act(id, () => post<{ restored: string[]; refsBack: string[]; refsSkipped?: string[] }>('merge/undo', { id }), (r) => '已撤销：回到合并前的 ' + r.restored.length + ' 个落盘项目' + (r.refsBack.length ? '，外部引用改回 ' + r.refsBack.length + ' 处' : '') + (r.refsSkipped?.length ? '（' + r.refsSkipped.length + ' 处合并后被改过，没动）' : '')); return }
  }
  private async startMerge(): Promise<void> {
    const m = this.mg
    if (!m || m.busy) return
    m.busy = true
    this.fillMg()
    try {
      const r = await post<{ id: string; prompt: string; key: string }>('merge/start', { sessionId: this.sid, keys: [...m.sel], name: m.name })
      try { await this.host.send(this.sid, r.prompt) } catch (e) { await post('merge/cancel', { id: r.id }).catch(() => undefined); throw e }
      this.mg = null
      this.wasMerging = r.id
      this.host.toast('已在本会话发出合并指令（' + m.sel.size + ' 个 → ' + r.key + '）')
      await this.load(true)
    } catch (e) { m.busy = false; m.err = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e); this.fillMg(); this.host.toast('开始合并失败：' + m.err, 'err') }
  }
  private async copy(btn: HTMLElement, text: string, what: string): Promise<void> {
    try { await navigator.clipboard.writeText(text) } catch (e) { this.host.toast('复制失败：' + (e instanceof Error ? e.message : String(e)), 'err'); return }
    btn.classList.add('copied')
    this.host.toast('已复制' + what + '：' + text)
    setTimeout(() => btn.classList.remove('copied'), 1200)
  }

  // ── AI 收到的原文 ──
  private rawFrom: HTMLElement | null = null
  private raw: Awaited<ReturnType<typeof getRaw>> | null = null
  private async openRaw(from: HTMLElement): Promise<void> {
    this.rawFrom = from
    try { this.raw = await getRaw(this.sid) } catch (e) { this.host.toast('读取原文失败：' + (e instanceof Error ? e.message : String(e)), 'err'); return }
    this.rawTab = 'sys'
    this.paintRaw()
  }
  private rawText(): string { const r = this.raw!; return this.rawTab === 'sys' ? [r.rules, r.system].filter(Boolean).join('\n\n') : r.files.map((f) => f.text).join('\n\n') }
  private paintRaw(): void {
    const r = this.raw
    if (!r || this.dead) return
    const sys = [r.rules, r.system].filter(Boolean).join('\n\n')
    const sum = r.files.reduce((n, f) => n + f.chars, 0)
    const tabs = '<div class="tabs" role="tablist"><button type="button" role="tab" id="dpmRawTab-sys" data-raw-tab="sys" aria-selected="' + (this.rawTab === 'sys') + '" aria-controls="dpmRawBody">系统提示<span class="c">' + sys.length + ' 字 · 每一步</span></button><button type="button" role="tab" id="dpmRawTab-inj" data-raw-tab="inj" aria-selected="' + (this.rawTab === 'inj') + '" aria-controls="dpmRawBody">落盘项目全文<span class="c">' + r.files.length + ' 份' + (r.files.length ? ' · ' + wan(sum) : '') + ' · 有新版才发</span></button></div>'
    const body = this.rawTab === 'sys'
      ? '<p class="hint">AI 每一步都会收到这一段（常驻规则 + 本卡片的卡片档案与落盘项目索引）。卡片资料在看板上一改，下一步就是新的。</p><pre class="raw">' + esc(sys) + '</pre>'
      : r.files.length ? '<p class="hint">每份只在版本变化时发给 AI 一次（同一版本不重发），上下文被压缩后重发。下面是当前版本的全文（与注入时的文本一致，本卡片的档案块换成了占位行）。</p>' + r.files.map((f, k) => '<details class="inj"' + (k ? '' : ' open') + '><summary>' + ic('chev') + '<b>' + esc(f.key + (f.file === 'STATE.md' ? '' : ' · ' + f.file)) + '</b><span class="tag">' + esc(f.version) + '</span><span class="sp"></span><span class="m">' + esc(wan(f.chars)) + ' · ' + (f.inContext ? '已在本会话' : '下一步注入') + '</span></summary><pre class="raw">' + esc(f.text) + (f.truncated ? '\n…（还有 ' + f.truncated + ' 字，浮层里省略）' : '') + '</pre></details>').join('') : '<p class="hint">本卡片还没有关联落盘项目，AI 只收到「系统提示」那一段。</p>'
    let ov = this.ov
    if (!ov) {
      ov = document.createElement('div')
      ov.className = 'dpm-ov'
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) this.closeRaw() })
      ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeRaw() } })
      ov.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button') as HTMLElement | null
        if (!b) return
        if (b.dataset.rawTab) { this.rawTab = b.dataset.rawTab as 'sys' | 'inj'; this.paintRaw(); (ov!.querySelector('#dpmRawTab-' + this.rawTab) as HTMLElement | null)?.focus(); return }
        if (b.dataset.rawClose !== undefined) return this.closeRaw()
        if (b.dataset.rawCopy !== undefined) { void navigator.clipboard.writeText(this.rawText()).then(() => this.host.toast(this.rawTab === 'sys' ? '已复制系统提示原文' : '已复制落盘项目全文'), (x) => this.host.toast('复制失败：' + String(x), 'err')) }
      })
      document.body.append(ov)
      this.ov = ov
    }
    ov.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dpmRawT"><div class="dlg-h"><div style="flex:1;min-width:0"><h2 id="dpmRawT">AI 收到的原文</h2><p>' + esc((this.info?.card?.group ?? '') + ' / ' + (this.info?.card?.title ?? '')) + ' · 和插件发给 AI 的文本逐字一致</p></div><button type="button" class="ib" data-raw-close aria-label="关闭" title="关闭（Esc）">' + ic('x') + '</button></div>' + tabs + '<div class="dlg-b" id="dpmRawBody" role="tabpanel" aria-labelledby="dpmRawTab-' + this.rawTab + '">' + body + '</div><div class="dlg-f"><span class="meta">约 ' + tok(this.rawText()).toLocaleString() + ' token</span><button type="button" class="btn sm" data-raw-copy>复制全文</button><button type="button" class="btn sm" data-raw-close>关闭</button></div></div>'
    if (!ov.contains(document.activeElement)) (ov.querySelector('[data-raw-close]') as HTMLElement).focus()
  }
  private closeRaw(): void {
    const ov = this.ov
    if (!ov) return
    this.ov = null
    ov.classList.add('out')
    setTimeout(() => ov.remove(), 160)
    this.rawFrom?.focus()
  }
}

/** 悬停走马灯：只在文字被截断且鼠标悬停时跑，离开即复原；减少动效时改成悬停提示。挂在 document 上，返回卸载函数。 */
export function marquee(scope: string): () => void {
  const reduce = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches
  const over = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest?.(scope) as HTMLElement | null
    if (!el || el.dataset.mq !== undefined || el.children.length) return
    if (el.scrollWidth <= el.clientWidth + 1) return
    const txt = el.textContent ?? ''
    if (reduce()) { if (!el.title) el.title = txt; return }
    el.dataset.mq = txt
    el.classList.add('mq-on')
    el.style.setProperty('--mq-dur', Math.max(4, txt.length * 0.22) + 's')
    el.innerHTML = '<span class="mq-track"><span>' + esc(txt) + '</span><span aria-hidden="true">' + esc(txt) + '</span></span>'
    const leave = (): void => { if (el.dataset.mq !== undefined) el.textContent = el.dataset.mq; delete el.dataset.mq; el.classList.remove('mq-on'); el.style.removeProperty('--mq-dur'); el.removeEventListener('mouseleave', leave) }
    el.addEventListener('mouseleave', leave)
  }
  document.addEventListener('mouseover', over)
  return () => document.removeEventListener('mouseover', over)
}
