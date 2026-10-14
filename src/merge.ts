/**
 * 0.19 合并落盘项目：把同一张卡片关联的几个落盘项目合成一个（可再合并 / 撤销上一步 / 删除合并前的）。
 * 分工：插件管文件（盘点、去重、归位到 ~/.ai、回收区、换关联、改外部引用、可回滚）；会话里的 AI 管内容（读全每份来源、写要点、整体重写 STATE）。
 * 写入一律经 ~/.ai/tools/ai-memory（retire-dir / restore-dir / purge-retired / import / write / update-state，需要 v3）。
 * 合并记录存在插件数据目录 merges.json；要点草稿与外部引用的原文存在 merges/<id>/。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { anchors, checkName, isIndexed, isText, listDocs, LandfillError, missingSections, parseIndex, sha256, type Landfill } from './landfill.js'
import { placeBlock, stripBlock } from './memory.js'
import type { StateCatalog } from './states.js'

export const MERGE_TOOL_VERSION = 3
const EXT_MAX = 30
const EXT_BYTES = 50 * 1024 * 1024
const IMG = /\.(png|jpe?g|gif|webp|svg|pdf|bmp|heic|mp4|mov|zip|gz|tgz)$/i
/** 只复制文档 / 图片 / 日志类外部文件（可执行程序、目录、源码不搬：STATE 里留原路径）。 */
const EXT_OK = /\.(md|markdown|txt|json|jsonl|log|csv|ya?ml|html?|png|jpe?g|gif|webp|svg|pdf|heic|mp4|mov)$/i
const RELC = '[^\\s\x60\'"()<>\\[\\]{}|*\\u3000-\\u303f\\uff00-\\uffef]*'
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PUNCT = /[.,:;!?)\]}>'"，。；：、）》」]+$/

export interface SrcInfo { key: string; dir: string; state: string; files: Array<{ rel: string; hash: string; binary: boolean; size: number }> }
export interface Placed { rel: string; hash: string; from: Array<{ key: string; rel: string }>; ext?: string; size: number }
export interface Layout { files: Placed[]; map: Record<string, Record<string, string>>; dropped: Array<{ key: string; rel: string }>; copied: Array<{ path: string; rel: string; from: string }>; missing: Array<{ path: string; from: string }>; dirs: number }

/** 指针型 STATE：只存指向别处的路径，不存状态。 */
export const isPointer = (t: string): boolean => /^\s*[-*]?\s*\x60?pointer_kind\x60?\s*[:：]/m.test(t) || /^\s*[-*]?\s*\x60?authority\x60?\s*[:：]\s*\x60?none\b/im.test(t)
const slugOf = (key: string): string => key.split('/')[1]
const projOf = (key: string): string => key.split('/')[0]
const noteRel = (key: string): string => 'notes/merge-' + projOf(key) + '-' + slugOf(key) + '.md'

/**
 * 文件去向（纯函数）：STATE.md 不算（重写）；*.bak* 不带；已在 notes/ evidence/ plans/ 下的保持原路径，其余文档进 notes/、图片等进 evidence/；
 * 内容相同（sha256）只留一份；同名不同内容放 <区>/<来源 slug>/；STATE 引用的 ~/.ai 外文件（存在、≤50MB）复制进 evidence/，找不到的列出来。
 */
export function planLayout(srcs: SrcInfo[], aiRoot: string, reserved: readonly string[] = [], home = homedir(), stat: (p: string) => { file: boolean; size: number } | null = statOf, hashFile: (p: string) => string = (p) => sha256(readFileSync(p))): Layout {
  const files: Placed[] = []
  const map: Record<string, Record<string, string>> = {}
  const dropped: Layout['dropped'] = []
  const copied: Layout['copied'] = []
  const missing: Layout['missing'] = []
  let dirs = 0
  const res = new Set(reserved.map((r) => r.toLowerCase()))
  const taken = (rel: string): boolean => res.has(rel.toLowerCase()) || files.some((f) => f.rel.toLowerCase() === rel.toLowerCase())
  const put = (want: string, hash: string, from: { key: string; rel: string }, size: number, ext?: string): string => {
    const same = files.find((f) => f.hash === hash)
    if (same) { if (!same.from.some((x) => x.key === from.key && x.rel === from.rel)) same.from.push(from); return same.rel }
    let rel = want
    if (taken(rel)) { const m = /^(notes|evidence|plans)\/(.*)$/.exec(want); rel = m ? m[1] + '/' + slugOf(from.key) + '/' + m[2].split('/').pop() : slugOf(from.key) + '/' + want }
    for (let i = 2; taken(rel); i++) rel = rel.replace(/(-\d+)?(\.[^./]+)?$/, (_m, _n, e) => '-' + i + (e ?? ''))
    files.push({ rel, hash, from: [from], size, ...(ext ? { ext } : {}) })
    return rel
  }
  const area = (rel: string, binary: boolean): string => {
    if (/^(notes|evidence|plans)\//.test(rel)) return rel
    const b = rel.split('/').pop() as string
    return (binary || IMG.test(b) ? 'evidence/' : 'notes/') + b
  }
  for (const s of srcs) {
    const m: Record<string, string> = (map[s.key] = { 'STATE.md': 'STATE.md' })
    for (const f of s.files) {
      if (/\.bak(\.|$)|\.orig$|~$/.test(f.rel)) { dropped.push({ key: s.key, rel: f.rel }); continue }
      m[f.rel] = put(area(f.rel, f.binary), f.hash, { key: s.key, rel: f.rel }, f.size)
    }
    let n = 0
    for (const a of anchors(stripBlock(s.state))) {
      if (!(a.startsWith('/') || a.startsWith('~/'))) continue
      const p = a.replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?:[-–]\d+)?)$/, '').replace(/^~(?=\/)/, home)
      if (p === aiRoot || p.startsWith(aiRoot + '/') || copied.some((c) => c.path === p) || missing.some((c) => c.path === p)) continue
      const st = stat(p)
      if (!st) { missing.push({ path: p, from: s.key }); continue }
      if (!st.file) { dirs++; continue }
      if (!EXT_OK.test(p)) continue
      if (st.size > EXT_BYTES || ++n > EXT_MAX) continue
      const rel = put('evidence/' + basename(p).replace(/[^A-Za-z0-9._\u4e00-\u9fff-]+/g, '-'), hashFile(p), { key: s.key, rel: p }, st.size, p)
      copied.push({ path: p, rel, from: s.key })
    }
  }
  return { files, map, dropped, copied, missing, dirs }
}
function statOf(p: string): { file: boolean; size: number } | null { try { const s = statSync(p); return { file: s.isFile(), size: s.size } } catch { return null } }

/** 文本里指向来源文件夹 / 被复制的外部文件的路径 → 改指合并结果。relProject = 这个文件属于哪个项目（MEMORY_INDEX 里的相对写法 designs/<slug>/ 只在同项目里认）。 */
export function rewritePaths(text: string, aiRoot: string, target: string, srcs: string[], lay: Pick<Layout, 'map' | 'copied'>, relProject?: string, home = homedir()): string {
  const tp = projOf(target)
  const tdir = aiRoot + '/projects/' + tp + '/memory/designs/' + slugOf(target) + '/'
  const tilde = aiRoot.startsWith(home + '/') ? '~' + aiRoot.slice(home.length) : null
  let out = text
  const sub = (re: RegExp, key: string, to: (rel: string) => string): void => {
    out = out.replace(re, (_m, rel: string) => { const tail = PUNCT.exec(rel)?.[0] ?? ''; const r = rel.slice(0, rel.length - tail.length); return to(lay.map[key]?.[r] ?? r) + tail })
  }
  for (const key of srcs) {
    const p = projOf(key)
    const sl = slugOf(key)
    const abs = aiRoot + '/projects/' + p + '/memory/designs/' + sl + '/'
    sub(new RegExp(escRe(abs) + '(' + RELC + ')', 'g'), key, (r) => tdir + r)
    if (tilde) { const t = tilde + '/projects/' + p + '/memory/designs/' + sl + '/'; sub(new RegExp(escRe(t) + '(' + RELC + ')', 'g'), key, (r) => tilde + '/projects/' + tp + '/memory/designs/' + slugOf(target) + '/' + r) }
    sub(new RegExp('(?<![\\w.-])' + escRe(p + ':memory/designs/' + sl + '/') + '(' + RELC + ')', 'g'), key, (r) => tp + ':memory/designs/' + slugOf(target) + '/' + r)
    if (relProject === p) sub(new RegExp('(?<![\\w./:-])designs/' + escRe(sl) + '/(' + RELC + ')', 'g'), key, (r) => (tp === p ? 'designs/' : (tilde ?? aiRoot) + '/projects/' + tp + '/memory/designs/') + slugOf(target) + '/' + r)
  }
  for (const c of lay.copied) {
    const to = tdir + c.rel
    out = out.split(c.path).join(to)
    if (c.path.startsWith(home + '/')) out = out.split('~' + c.path.slice(home.length)).join(tilde ? tilde + to.slice(aiRoot.length) : to)
  }
  return out
}

/** STATE 里的别名行：已有就合并，没有就插在标题行后。 */
export function withAliases(text: string, aliases: string[]): string {
  if (!aliases.length) return text
  const re = /^(\s*[-*]?\s*)\x60?aliases\x60?\s*[:：]\s*(.*)$/im
  const m = re.exec(text)
  if (m) { const note = /[（(].*$/.exec(m[2])?.[0] ?? ''; const have = m[2].slice(0, m[2].length - note.length).split(/[\s,，、]+/).map((x) => x.replace(/\x60/g, '')).filter(Boolean); const all = [...new Set([...have, ...aliases])]; return text.replace(re, m[1] + 'aliases: ' + all.join(', ') + note) }
  const h = /^# .*$/m.exec(text)
  const line = '- aliases: ' + aliases.join(', ') + '（合并前的名字；说这些名字也会回忆 / 落盘这个项目）'
  if (!h) return line + '\n\n' + text
  const at = h.index + h[0].length
  return text.slice(0, at) + '\n\n' + line + text.slice(at)
}
/** 「⚠ 待核实」节里的条目数。 */
export function checkCount(text: string): number {
  const m = /^#{2,3} .*待核实.*$/m.exec(text)
  if (!m) return 0
  const rest = text.slice(m.index + m[0].length)
  const end = rest.search(/^#{1,3} /m)
  return (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length
}

/** 要改的外部引用文件：~/.ai/memory 下（不含 imported/）与相关项目的 MEMORY_INDEX.md 里提到来源路径的（合并 / 迁移共用）。 */
export function refFiles(aiRoot: string, keys: string[], target: string): Array<{ file: string; rel: string; project: string | null }> {
  const out: Array<{ file: string; rel: string; project: string | null }> = []
  const needles = keys.flatMap((k) => ['designs/' + slugOf(k) + '/'])
  const has = (f: string): boolean => { try { const t = readFileSync(f, 'utf8'); return needles.some((n) => t.includes(n)) } catch { return false } }
  const mem = join(aiRoot, 'memory')
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 4) return
    let names: string[] = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n.startsWith('.') || (depth === 0 && n === 'imported')) continue
      const p = join(dir, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p, rel + n + '/', depth + 1)
      else if (/\.md$/.test(n) && st.size < 512 * 1024 && has(p)) out.push({ file: p, rel: 'memory/' + rel + n, project: null })
    }
  }
  walk(mem, '', 0)
  for (const p of new Set([...keys.map(projOf), projOf(target)])) {
    const f = join(aiRoot, 'projects', p, 'memory', 'MEMORY_INDEX.md')
    if (existsSync(f) && has(f)) out.push({ file: f, rel: 'memory/MEMORY_INDEX.md', project: p })
  }
  return out
}

// ── 记录 ──

export interface MSrc { key: string; mergeId?: string; retired?: string; kind: 'body' | 'pointer'; chars: number; files: number }
export interface MergeRef { file: string; rel: string; scope: string; afterHash: string }
export interface MergeRec {
  id: string; key: string; srcs: MSrc[]; aliases: string[]; dir: string; at: string; status: 'running' | 'done'
  sid?: string; cardId?: string; parent?: string; purged?: boolean
  stateHash?: string; files?: Placed[]; copied?: Layout['copied']; missing?: Layout['missing']; dropped?: Layout['dropped']
  links?: { cards: Array<{ id: string; before: string[] }>; groups: Array<{ id: string; before: string[] }> }
  refs?: MergeRef[]; refsFailed?: Array<{ file: string; error: string }>
  report?: { chars: number; check: number; drop: number; files: number }
  pulls?: number
}
export interface BoardPort {
  get(): { groups: Array<{ id: string; links: string[] }>; cards: Array<{ id: string; g: string; links: string[]; archivedAt?: string }> }
  relink(fn: (b: { groups: Array<{ id: string; links: string[] }>; cards: Array<{ id: string; links: string[] }> }) => void): Promise<void>
}
export interface MergeDeps { aiRoot: string; dataDir: string; lf: Landfill; states: StateCatalog; board: BoardPort; cardBlock(key: string): string; log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void } }

const stamp = (d = new Date()): string => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')

export class MergeEngine {
  private recs: MergeRec[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private readonly file: string
  constructor(private readonly d: MergeDeps) {
    this.file = join(d.dataDir, 'merges.json')
    try { const j = JSON.parse(readFileSync(this.file, 'utf8')) as MergeRec[]; if (Array.isArray(j)) this.recs = j } catch { /* 没有 = 空 */ }
  }
  private save(): void { mkdirSync(this.d.dataDir, { recursive: true }); writeFileSync(this.file + '.tmp', JSON.stringify(this.recs, null, 1)); renameSync(this.file + '.tmp', this.file) }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => undefined); return p }
  list(): readonly MergeRec[] { return this.recs }
  get(id: string): MergeRec { const r = this.recs.find((x) => x.id === id); if (!r) throw new LandfillError('NO_MERGE', '没有这次合并（可能已撤销或删除）：' + id); return r }
  private retiredOf(key: string, dir: string): string { return join(this.d.aiRoot, 'projects', projOf(key), 'inbox', 'retired', dir, slugOf(key)) }
  private draftDir(id: string): string { return join(this.d.dataDir, 'merges', id) }
  /** 先把指向更早合并掉的落盘项目的路径改成那次的合并结果，再按本次改。 */
  private rw(text: string, aiRoot: string, target: string, srcs: string[], lay: Pick<Layout, 'map' | 'copied'>, relProject?: string): string {
    let t = text
    for (const r of this.recs) {
      if (r.status !== 'done') continue
      const map: Record<string, Record<string, string>> = {}
      for (const f of r.files ?? []) for (const x of f.from) if (!f.ext) (map[x.key] ??= {})[x.rel] = f.rel
      t = rewritePaths(t, aiRoot, r.key, r.srcs.map((x) => x.key), { map, copied: r.copied ?? [] }, relProject)
    }
    return rewritePaths(t, aiRoot, target, srcs, lay, relProject)
  }
  /** 合并结果对应的记录（最新一次、已完成、没撤销）。 */
  resultOf(key: string): MergeRec | undefined { return [...this.recs].reverse().find((r) => r.status === 'done' && r.key === key && !r.parent) }
  /** 这次合并回收区里还剩几个合并前的落盘项目（含更早合并的）。 */
  treeN(r: MergeRec): number {
    if (r.purged) return 0
    let n = 0
    for (const s of r.srcs) { if (s.retired && existsSync(s.retired)) n++; const sub = s.mergeId ? this.recs.find((x) => x.id === s.mergeId) : undefined; if (sub) n += this.treeN(sub) }
    return n
  }

  private src(key: string): SrcInfo {
    const path = this.d.lf.statePath(key)
    const f = this.d.lf.fileInfo(path)
    if (!f || f.binary) throw new LandfillError('NOT_FOUND', '读不到 ' + key + ' 的 STATE：' + path)
    const dir = dirname(path)
    const files = listDocs(dir, 2000).files.flatMap((rel) => { const fi = this.d.lf.fileInfo(join(dir, rel)); return fi ? [{ rel, hash: fi.hash, binary: fi.binary, size: fi.size }] : [] })
    return { key, dir, state: f.text ?? '', files }
  }

  /** 预览（只读）：选中的落盘项目 + 目标名 → 别名、文件去向、外部引用、校验提示。 */
  /** home = 卡片组的落盘文件夹（0.20：合并结果放这里；没设 = 第一份正文来源所在的项目）。 */
  preview(scopeKeys: string[], keys: string[], name: string, home?: string): Record<string, unknown> {
    const sel = [...new Set(keys)].filter((k) => scopeKeys.includes(k))
    if (sel.length < 2) throw new LandfillError('BAD_ARG', '至少选 2 个落盘项目才能合并')
    const srcs = sel.map((k) => this.src(k))
    const first = srcs.find((s) => !isPointer(s.state)) ?? srcs[0]
    const tp = home ?? projOf(first.key)
    const target = tp + '/' + checkName(name || slugOf(first.key), '名字')
    const clash = !sel.includes(target) && (scopeKeys.includes(target) || existsSync(this.d.lf.statePath(target)))
    const lay = planLayout(srcs, this.d.aiRoot, sel.map(noteRel))
    const aliases = this.aliasesFor(sel, target)
    const busy = this.recs.find((r) => r.status === 'running' && r.srcs.some((s) => sel.includes(s.key)))
    return {
      key: target, aliases, clash, busy: busy?.id ?? null,
      srcs: srcs.map((s) => ({ key: s.key, pointer: isPointer(s.state), chars: s.state.length, files: s.files.length, merge: this.resultOf(s.key)?.id ?? null })),
      files: lay.files.map((f) => ({ rel: f.rel, from: f.from.map((x) => slugOf(x.key)), ext: f.ext ?? null })),
      notes: sel.map(noteRel), copied: lay.copied, missing: lay.missing, dropped: lay.dropped, dirs: lay.dirs,
      retired: [...new Set(sel.map(projOf))].map((p) => ({ project: p, path: join(this.d.aiRoot, 'projects', p, 'inbox', 'retired', '<时间>-merge-' + slugOf(target)) + '/', names: sel.filter((k) => projOf(k) === p).map(slugOf) })),
      refs: this.refFiles(sel, target).map((r) => r.file),
      chars: srcs.reduce((n, s) => n + s.state.length, 0),
      toolOk: this.d.lf.status.toolVersion >= MERGE_TOOL_VERSION,
    }
  }
  private aliasesFor(sel: string[], target: string): string[] {
    const al = new Set<string>()
    for (const k of sel) { al.add(slugOf(k)); for (const a of this.d.states.get(k)?.aliases ?? []) al.add(a) }
    al.delete(slugOf(target))
    return [...al]
  }

  /** 开始：建记录（running），返回发给会话的指令。 */
  start(sid: string, cardId: string, scopeKeys: string[], keys: string[], name: string, home?: string): Promise<{ id: string; prompt: string; key: string }> {
    return this.serial(async () => {
      if (!this.d.lf.status.ok) throw new LandfillError('LANDFILL_OFF', '落盘项目功能没开启：' + this.d.lf.status.reason)
      if (this.d.lf.status.toolVersion < MERGE_TOOL_VERSION) throw new LandfillError('NEED_UPGRADE', '合并需要 ai-memory v' + MERGE_TOOL_VERSION + '（本机 v' + this.d.lf.status.toolVersion + '）：先在项目看板顶部点「升级 ai-memory」')
      const p = this.preview(scopeKeys, keys, name, home) as { key: string; aliases: string[]; clash: boolean; busy: string | null; srcs: Array<{ key: string; pointer: boolean; chars: number; files: number }> }
      if (p.clash) throw new LandfillError('EXISTS', p.key + ' 已存在且没被选上：换个名字，或把它也选进来')
      if (p.busy) throw new LandfillError('BUSY', '其中有落盘项目正在另一次合并里：' + p.busy)
      if (this.recs.some((r) => r.status === 'running' && r.sid === sid)) throw new LandfillError('BUSY', '这个会话已经有一次合并在进行，先完成或取消')
      const id = 'mg' + Date.now().toString(36)
      const rec: MergeRec = { id, key: p.key, srcs: p.srcs.map((s) => ({ key: s.key, kind: s.pointer ? 'pointer' : 'body', chars: s.chars, files: s.files, ...(this.resultOf(s.key) ? { mergeId: this.resultOf(s.key)!.id } : {}) })), aliases: p.aliases, dir: '', at: new Date().toISOString(), status: 'running', sid, cardId }
      this.recs.push(rec)
      this.save()
      this.d.log?.info('合并开始 ' + id + '：' + rec.srcs.map((s) => s.key).join(' + ') + ' → ' + rec.key)
      return { id, key: rec.key, prompt: promptOf(rec) }
    })
  }
  cancel(id: string): Promise<void> {
    return this.serial(async () => { const r = this.get(id); if (r.status !== 'running') throw new LandfillError('BAD_STATE', '这次合并已经完成，不能取消；要退回请用「撤销合并」'); this.recs = this.recs.filter((x) => x !== r); this.save() })
  }
  runningFor(sid: string): MergeRec | undefined { return this.recs.find((r) => r.status === 'running' && r.sid === sid) }

  /** AI 读计划：来源、要写的要点文件、文件去向、要进文件索引的文件。 */
  plan(sid: string | undefined, id: string): Record<string, unknown> {
    const r = this.get(id)
    if (r.status !== 'running') throw new LandfillError('BAD_STATE', '这次合并已经完成')
    const srcs = r.srcs.map((s) => this.src(s.key))
    const lay = planLayout(srcs, this.d.aiRoot, r.srcs.map((s) => noteRel(s.key)))
    const pend = r.srcs.flatMap((s) => this.d.lf.pending(sid, s.key))
    return {
      id, target: r.key, aliases: r.aliases,
      sources: r.srcs.map((s, i) => ({ key: s.key, kind: s.kind, chars: srcs[i].state.length, read: !this.d.lf.pending(sid, s.key).length, note: noteRel(s.key), noted: existsSync(join(this.draftDir(id), 'notes', projOf(s.key) + '-' + slugOf(s.key) + '.md')) })),
      ...(pend.length ? { toRead: pend.slice(0, 20), hint: '先用 landfill op=recall 把这些读完（有 next 就带 offset），每读完一份就 op=merge action=note' } : {}),
      indexFiles: [...lay.files.map((f) => f.rel), ...r.srcs.map((s) => noteRel(s.key))].sort(),
      copied: lay.copied.map((c) => c.path + ' → ' + c.rel), missing: lay.missing.map((m) => m.path), dropped: lay.dropped.map((x) => x.key + ':' + x.rel),
      rules: '合并后的 STATE：≤30000 字符、按 landfill-project skill「整体优化」；细节指向 notes/；来源之间说法矛盾的写进「## ⚠ 待核实」节（逐条列出，不替用户选边）；「## 📁 文件索引」给 indexFiles 每个文件一行（[必读] 只标文本），可写目录 dir/；missing 里的文件本机已不存在，写进待核实；commit 时插件自动加 aliases 行、卡片档案块，并把旧路径改成合并后的路径。',
    }
  }
  note(sid: string | undefined, id: string, key: string, content: unknown): Record<string, unknown> {
    const r = this.get(id)
    if (r.status !== 'running') throw new LandfillError('BAD_STATE', '这次合并已经完成')
    const s = r.srcs.find((x) => x.key === key || slugOf(x.key) === key)
    if (!s) throw new LandfillError('BAD_ARG', key + ' 不是这次合并的来源：' + r.srcs.map((x) => x.key).join('、'))
    if (typeof content !== 'string' || content.trim().length < 20) throw new LandfillError('BAD_ARG', 'content 是这份来源的要点（状态、结论、决策、所有 commit / 路径 / 版本号 / 单号）')
    const p = this.d.lf.pending(sid, s.key)
    if (p.length) throw new LandfillError('NEED_FULL_READ', s.key + ' 还没读全，先 recall 读完再写要点', { files: p.slice(0, 10) })
    const f = join(this.draftDir(id), 'notes', projOf(s.key) + '-' + slugOf(s.key) + '.md')
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, '# 合并要点：' + s.key + '\n\n' + content.trim() + '\n')
    const left = r.srcs.filter((x) => !existsSync(join(this.draftDir(id), 'notes', projOf(x.key) + '-' + slugOf(x.key) + '.md'))).map((x) => x.key)
    return { id, key: s.key, saved: noteRel(s.key), left, ...(left.length ? {} : { hint: '要点都写完了：整体重写一份 STATE，然后 op=merge action=commit' }) }
  }
  /** 进度（会话信息卡显示用）。 */
  progress(r: MergeRec): { read: number; noted: number; total: number; step: number } {
    const total = r.srcs.length
    const read = r.srcs.filter((s) => !this.d.lf.pending(r.sid, s.key).length).length
    const noted = r.srcs.filter((s) => existsSync(join(this.draftDir(r.id), 'notes', projOf(s.key) + '-' + slugOf(s.key) + '.md'))).length
    return { read, noted, total, step: noted >= total ? 2 : 1 }
  }

  private async ai(args: string[], input?: string, what = ''): Promise<Record<string, unknown>> {
    const r = await this.d.lf.ai(args, input)
    if (r.code !== 0) throw new LandfillError(r.code === 6 ? 'CONFLICT' : r.code === 5 ? 'OUT_OF_BAND' : 'AI_MEMORY_FAILED', what + '失败：' + (r.stderr.trim() || r.stdout.trim()).replace(/^ai-memory:\s*/, ''))
    try { return JSON.parse(r.stdout) as Record<string, unknown> } catch { return {} }
  }
  private notesText(id: string, key: string): string | null { try { return readFileSync(join(this.draftDir(id), 'notes', projOf(key) + '-' + slugOf(key) + '.md'), 'utf8') } catch { return null } }

  /** 提交：校验 → 来源整个移进回收区 → 文件归位 → 写 STATE → 换关联 → 改外部引用。中途失败按已做的倒着撤回。 */
  commit(sid: string | undefined, id: string, content: unknown, drop: unknown = []): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const r = this.get(id)
      if (r.status !== 'running') throw new LandfillError('BAD_STATE', '这次合并已经完成')
      if (typeof content !== 'string' || !content.trim()) throw new LandfillError('BAD_ARG', 'content 是合并后的完整 STATE')
      if (!Array.isArray(drop) || drop.some((x) => typeof x !== 'string' || x.trim().length < 4)) throw new LandfillError('BAD_ARG', 'drop 是字符串数组（每项 ≥4 字符）')
      const drops = (drop as string[]).map((x) => x.trim())
      const miss = missingSections(content)
      if (miss.length) throw new LandfillError('MISSING_SECTIONS', 'STATE 缺少必需内容：' + miss.join('、'))
      const keys = r.srcs.map((s) => s.key)
      const pend = keys.flatMap((k) => this.d.lf.pending(sid, k))
      if (pend.length) throw new LandfillError('NEED_FULL_READ', '还有来源没读全（STATE + [必读]）：先 recall 读完', { files: pend.slice(0, 20) })
      const noNote = keys.filter((k) => this.notesText(id, k) === null)
      if (noNote.length) throw new LandfillError('NEED_NOTES', '这些来源还没写要点（op=merge action=note）：' + noNote.join('、'))
      const target = r.key
      const inPlace = keys.includes(target)
      if (!inPlace && existsSync(this.d.lf.statePath(target))) throw new LandfillError('EXISTS', target + ' 已存在且不是来源')
      const srcs = keys.map((k) => this.src(k))
      const lay = planLayout(srcs, this.d.aiRoot, keys.map(noteRel))
      const notes = keys.map((k) => ({ rel: noteRel(k), text: this.notesText(id, k) as string }))
      // 内容：旧路径改指合并结果 → 别名行 → 卡片档案块
      const body0 = this.rw(stripBlock(content), this.d.aiRoot, target, keys, lay)
      const body = withAliases(body0, r.aliases)
      // 关键事实：每份来源的锚点（换成新路径后）要出现在新 STATE / 要点 / 带过去的文本文件里，或写进 drop
      const carried = lay.files.filter((f) => !f.ext && !srcs.find((s) => s.key === f.from[0].key)?.files.find((x) => x.rel === f.from[0].rel)?.binary).map((f) => { try { return readFileSync(join(srcs.find((s) => s.key === f.from[0].key)!.dir, f.from[0].rel), 'utf8') } catch { return '' } })
      const pool = [body, ...notes.map((n) => this.rw(n.text, this.d.aiRoot, target, keys, lay)), ...carried.map((t) => this.rw(t, this.d.aiRoot, target, keys, lay))].join('\n')
      const lost: string[] = []
      for (const s of srcs) for (const a of anchors(this.rw(stripBlock(s.state), this.d.aiRoot, target, keys, lay))) if (!pool.includes(a) && !drops.some((x) => a.includes(x)) && !lost.includes(a)) lost.push(a)
      if (lost.length) throw new LandfillError('DROPPED_ANCHORS', '合并稿少了 ' + lost.length + ' 处来源里的关键事实（commit / 路径 / 版本号 / 单号）：写进新 STATE 或对应来源的要点（op=merge action=note 可重写），确认不要的写进 drop', { lost: lost.slice(0, 60), total: lost.length })
      const want = [...lay.files.map((f) => f.rel), ...notes.map((n) => n.rel)]
      const unindexed = want.filter((rel) => !isIndexed(rel, body))
      if (unindexed.length) throw new LandfillError('UNINDEXED_FILES', '合并结果里有 ' + unindexed.length + ' 个文件没进「📁 文件索引」：每个文件（或目录 dir/）一行「- [必读|参考] 路径 · 用途」', { files: unindexed.slice(0, 60), total: unindexed.length })
      const badTag = parseIndex(body).filter((e) => e.tag === '必读' && (!want.includes(e.path) || !(isText(e.path) || notes.some((n) => n.rel === e.path)))).filter((e) => !e.path.endsWith('/'))
      if (badTag.length) throw new LandfillError('BAD_TAG', '[必读] 只能标合并结果里存在的文本文件：' + badTag.map((e) => e.path).join('、'))
      // ── 写入（每步登记撤回动作） ──
      let dir = stamp() + '-merge-' + slugOf(target)
      for (let i = 2; keys.some((k) => existsSync(this.retiredOf(k, dir))); i++) dir = stamp() + '-merge-' + slugOf(target) + '-' + i
      const undo: Array<() => Promise<unknown>> = []
      let final = ''
      const tp = projOf(target)
      const tdirRel = 'memory/designs/' + slugOf(target)
      try {
        for (const s of srcs) {
          const h = this.d.lf.fileInfo(this.d.lf.statePath(s.key))?.hash
          await this.ai(['retire-dir', '--project', projOf(s.key), '--dir', 'memory/designs/' + slugOf(s.key), '--dest', dir, ...(h ? ['--expected-hash', h] : [])], undefined, '移走 ' + s.key + ' ')
          undo.push(() => this.ai(['restore-dir', '--project', projOf(s.key), '--src', dir + '/' + slugOf(s.key), '--dir', 'memory/designs/' + slugOf(s.key)], undefined, '恢复 ' + s.key + ' '))
        }
        undo.push(async () => { if (existsSync(dirname(this.d.lf.statePath(target)))) { await this.ai(['retire-dir', '--project', tp, '--dir', tdirRel, '--dest', dir + '-failed'], undefined, '撤回半成品 '); await this.ai(['purge-retired', '--project', tp, '--path', dir + '-failed/' + slugOf(target)], undefined, '清理半成品 ') } })
        for (const f of lay.files) {
          const from = f.ext ?? join(this.retiredOf(f.from[0].key, dir), f.from[0].rel)
          // 带过去的文本文件里指向旧文件夹的路径一并改成合并后的
          const txt = !f.ext && isText(f.rel) ? (() => { try { const t = readFileSync(from, 'utf8'); return t.includes('\u0000') ? null : t } catch { return null } })() : null
          const nt = txt === null ? null : this.rw(txt, this.d.aiRoot, target, keys, lay)
          if (nt !== null && nt !== txt) await this.ai(['write', '--project', tp, '--file', tdirRel + '/' + f.rel, '--stdin'], nt, '放入 ' + f.rel + ' ')
          else await this.ai(['import', '--project', tp, '--file', tdirRel + '/' + f.rel, '--src', from], undefined, '放入 ' + f.rel + ' ')
        }
        for (const n of notes) await this.ai(['write', '--project', tp, '--file', tdirRel + '/' + n.rel, '--stdin'], this.rw(n.text, this.d.aiRoot, target, keys, lay), '写入 ' + n.rel + ' ')
        // 换关联（卡片 + 卡片组），再按新关联生成卡片档案块写 STATE
        const links: NonNullable<MergeRec['links']> = { cards: [], groups: [] }
        await this.d.board.relink((b) => {
          const swap = (l: string[]): string[] | null => { if (!l.some((k) => keys.includes(k))) return null; const out: string[] = []; for (const k of l) { const v = keys.includes(k) ? target : k; if (!out.includes(v)) out.push(v) } return out }
          for (const c of b.cards) { const n = swap(c.links); if (n) { links.cards.push({ id: c.id, before: c.links.slice() }); c.links = n } }
          for (const g of b.groups) { const n = swap(g.links); if (n) { links.groups.push({ id: g.id, before: g.links.slice() }); g.links = n } }
        })
        r.links = links
        undo.push(() => this.d.board.relink((b) => { for (const c of links.cards) { const x = b.cards.find((y) => y.id === c.id); if (x) x.links = c.before } for (const g of links.groups) { const x = b.groups.find((y) => y.id === g.id); if (x) x.links = g.before } }))
        final = placeBlock(body, this.d.cardBlock(target))
        const w = await this.ai(['update-state', '--project', tp, '--slug', slugOf(target), '--stdin'], final, '写入 STATE ')
        const back = readFileSync(String(w.file), 'utf8')
        if (sha256(back) !== w.hash_after) throw new LandfillError('READBACK_FAILED', '写入后回读校验没通过：' + String(w.file))
        r.stateHash = String(w.hash_after)
        this.d.lf.wrote(sid, String(w.file), String(w.hash_after), back.length)
      } catch (e) {
        for (const u of undo.reverse()) { try { await u() } catch (x) { this.d.log?.warn('合并失败后撤回出错（需要人工核对 ' + dir + '）', x) } }
        throw e instanceof LandfillError ? e : new LandfillError('MERGE_FAILED', '合并失败（已撤回）：' + (e instanceof Error ? e.message : String(e)))
      }
      // 外部引用（尽力而为：失败的列进报告，不回滚合并）
      const refs: NonNullable<MergeRec['refs']> = []
      const refsFailed: NonNullable<MergeRec['refsFailed']> = []
      for (const ref of this.refFiles(keys, target)) {
        try {
          const old = readFileSync(ref.file, 'utf8')
          const next = this.rw(old, this.d.aiRoot, target, keys, lay, ref.project ?? undefined)
          if (next === old) continue
          const bk = join(this.draftDir(id), 'refs', sha256(ref.file).slice(0, 16) + '.txt')
          mkdirSync(dirname(bk), { recursive: true })
          writeFileSync(bk, old)
          const out = await this.ai(['write', ...(ref.project ? ['--project', ref.project] : ['--global']), '--file', ref.rel, '--expected-hash', sha256(old), '--stdin'], next, '改引用 ' + ref.rel + ' ')
          refs.push({ file: ref.file, rel: ref.rel, scope: ref.project ?? '', afterHash: String(out.hash_after) })
        } catch (e) { refsFailed.push({ file: ref.file, error: e instanceof Error ? e.message : String(e) }) }
      }
      for (const s of r.srcs) { s.retired = this.retiredOf(s.key, dir); if (s.mergeId) { const sub = this.recs.find((x) => x.id === s.mergeId); if (sub) sub.parent = r.id } }
      Object.assign(r, { status: 'done', dir, files: lay.files.map((f) => ({ ...f })), copied: lay.copied, missing: lay.missing, dropped: lay.dropped, refs, refsFailed, report: { chars: final.length, check: checkCount(final), drop: drops.length, files: lay.files.length + notes.length } })
      this.save()
      this.d.states.invalidate()
      this.d.log?.info('合并完成 ' + id + ' → ' + target + '（' + keys.length + ' → 1，回收区 ' + dir + '）')
      return { id, key: target, path: this.d.lf.statePath(target), verified: true, retired: [...new Set(keys.map((k) => dirname(this.retiredOf(k, dir))))], files: r.report!.files, refs: refs.map((x) => x.file), ...(refsFailed.length ? { refsFailed } : {}), check: r.report!.check, missing: lay.missing.map((m) => m.path), hint: '合并完成：用一两句话告诉用户结果（来源移进了回收区，可在会话信息卡里撤销或删除）' }
    })
  }

  private refFiles(keys: string[], target: string): Array<{ file: string; rel: string; project: string | null }> { return refFiles(this.d.aiRoot, keys, target) }

  /** 撤销（只退一步）：合并结果在合并后没再被改过、合并前的都还在回收区。 */
  undoWhy(r: MergeRec): string | null {
    if (r.status !== 'done') return '合并还没完成'
    if (r.parent) return '它已经被并进了另一次合并：先撤销那次'
    if (r.purged) return '合并前的落盘项目已删除'
    const lack = r.srcs.filter((s) => !s.retired || !existsSync(s.retired))
    if (lack.length) return '回收区里缺 ' + lack.length + ' 个合并前的落盘项目（' + lack.map((s) => slugOf(s.key)).join('、') + '），不能撤销，只能删除剩下的'
    const cur = this.d.lf.fileInfo(this.d.lf.statePath(r.key))?.hash
    if (cur !== r.stateHash) return '合并后 ' + r.key + ' 又被写过（落盘过），撤销会丢掉这些新内容'
    const want = new Set([...(r.files ?? []).map((f) => f.rel), ...r.srcs.map((s) => noteRel(s.key))])
    const extra = listDocs(dirname(this.d.lf.statePath(r.key)), 2000).files.filter((x) => !want.has(x))
    if (extra.length) return '合并后 ' + r.key + ' 的文件夹里又多了 ' + extra.length + ' 个文件（' + extra.slice(0, 3).join('、') + '），撤销会丢掉它们'
    return null
  }
  undo(id: string): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const r = this.get(id)
      const why = this.undoWhy(r)
      if (why) throw new LandfillError('CANNOT_UNDO', why)
      const tp = projOf(r.key)
      const tsl = slugOf(r.key)
      const gone = r.dir + '-undone'
      await this.ai(['retire-dir', '--project', tp, '--dir', 'memory/designs/' + tsl, '--dest', gone, ...(r.stateHash ? ['--expected-hash', r.stateHash] : [])], undefined, '移走合并结果 ')
      const done: MSrc[] = []
      try {
        for (const s of r.srcs) { await this.ai(['restore-dir', '--project', projOf(s.key), '--src', r.dir + '/' + slugOf(s.key), '--dir', 'memory/designs/' + slugOf(s.key)], undefined, '恢复 ' + s.key + ' '); done.push(s) }
      } catch (e) {
        for (const s of done.reverse()) { try { await this.ai(['retire-dir', '--project', projOf(s.key), '--dir', 'memory/designs/' + slugOf(s.key), '--dest', r.dir]) } catch { /* 人工核对 */ } }
        try { await this.ai(['restore-dir', '--project', tp, '--src', gone + '/' + tsl, '--dir', 'memory/designs/' + tsl]) } catch { /* 人工核对 */ }
        throw e
      }
      await this.ai(['purge-retired', '--project', tp, '--path', gone + '/' + tsl], undefined, '清理合并结果 ')
      this.rmEmpty(tp, gone)
      for (const p of new Set(r.srcs.map((s) => projOf(s.key)))) this.rmEmpty(p, r.dir)
      // 关联改回：当前含合并结果的 → 换回合并前关联的那几个
      const keys = r.srcs.map((s) => s.key)
      await this.d.board.relink((b) => {
        // 合并结果那一项换回合并前它所在位置关联的那几个，其余不动
        // 合并后没人动过这组关联 → 原样恢复；动过 → 只把合并结果换回合并前的那几个，其余照旧
        const after = (before: string[]): string[] => { const out: string[] = []; for (const k of before) { const v = keys.includes(k) ? r.key : k; if (!out.includes(v)) out.push(v) } return out }
        const back = (cur: string[], before: string[]): string[] => { if (JSON.stringify(cur) === JSON.stringify(after(before))) return before.slice(); const out: string[] = []; for (const k of cur) for (const x of k === r.key ? before.filter((y) => keys.includes(y)) : [k]) if (!out.includes(x)) out.push(x); return out }
        for (const c of r.links?.cards ?? []) { const cd = b.cards.find((x) => x.id === c.id); if (cd && cd.links.includes(r.key)) cd.links = back(cd.links, c.before) }
        for (const g of r.links?.groups ?? []) { const gr = b.groups.find((x) => x.id === g.id); if (gr && gr.links.includes(r.key)) gr.links = back(gr.links, g.before) }
      })
      const refsBack: string[] = []
      const refsSkipped: string[] = []
      for (const ref of r.refs ?? []) {
        const bk = join(this.draftDir(id), 'refs', sha256(ref.file).slice(0, 16) + '.txt')
        try {
          const cur = readFileSync(ref.file, 'utf8')
          if (sha256(cur) !== ref.afterHash) { refsSkipped.push(ref.file + '（合并后又被改过，没动）'); continue }
          await this.ai(['write', ...(ref.scope ? ['--project', ref.scope] : ['--global']), '--file', ref.rel, '--expected-hash', ref.afterHash, '--stdin'], readFileSync(bk, 'utf8'), '改回引用 ')
          refsBack.push(ref.file)
        } catch (e) { refsSkipped.push(ref.file + '：' + (e instanceof Error ? e.message : String(e))) }
      }
      for (const s of r.srcs) if (s.mergeId) { const sub = this.recs.find((x) => x.id === s.mergeId); if (sub) delete sub.parent }
      // 来源已删光的子合并不再需要记录（它回到普通落盘项目）
      this.recs = this.recs.filter((x) => x !== r && !(x.purged && !x.parent))
      this.save()
      this.d.states.invalidate()
      return { id, restored: keys, refsBack, ...(refsSkipped.length ? { refsSkipped } : {}) }
    })
  }

  private rmEmpty(project: string, dir: string): void { const p = join(this.d.aiRoot, 'projects', project, 'inbox', 'retired', dir); try { if (!readdirSync(p).length) rmdirSync(p) } catch { /* 不在 / 非空 */ } }
  private async purgeTree(r: MergeRec, removed: string[]): Promise<void> {
    for (const s of r.srcs) {
      if (s.retired && existsSync(s.retired)) { await this.ai(['purge-retired', '--project', projOf(s.key), '--path', r.dir + '/' + slugOf(s.key)], undefined, '删除 ' + s.key + ' '); removed.push(s.retired) }
      this.rmEmpty(projOf(s.key), r.dir)
      const sub = s.mergeId ? this.recs.find((x) => x.id === s.mergeId) : undefined
      if (sub && !sub.purged) await this.purgeTree(sub, removed)
    }
    r.purged = true
  }
  /** 删除合并前的落盘项目（连同更早合并的）；sub = 只删某个合并前的项目自己合并前的（它本身留着）。 */
  purge(id: string): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const r = this.get(id)
      if (r.status !== 'done') throw new LandfillError('BAD_STATE', '合并还没完成')
      const removed: string[] = []
      await this.purgeTree(r, removed)
      // 顶层：整棵树的记录都不再需要；子合并：留着（上层卡片要显示「它合并前的已删除」）
      if (!r.parent) { const drop = new Set<string>(); const walk = (x: MergeRec): void => { drop.add(x.id); for (const s of x.srcs) { const sub = s.mergeId ? this.recs.find((y) => y.id === s.mergeId) : undefined; if (sub) walk(sub) } }; walk(r); this.recs = this.recs.filter((x) => !drop.has(x.id)) }
      this.save()
      return { id, removed: removed.length, paths: removed }
    })
  }

  /** 会话收到合并指令（用户点了「开始合并」）：拉回次数清零。 */
  arm(sid: string, id: string): void { const r = this.recs.find((x) => x.id === id && x.sid === sid && x.status === 'running'); if (r) r.pulls = 0 }
  /** 收尾：会话里有进行中的合并、还没提交 → 拉回（每条合并指令最多 2 次）。 */
  nudge(sid: string): string | null {
    const r = this.runningFor(sid)
    if (!r || (r.pulls ?? 2) >= 2) return null
    r.pulls = (r.pulls ?? 0) + 1
    const p = this.progress(r)
    return '[dsh-project-manager · 合并 ' + r.id + '] 合并还没提交（来源读全 ' + p.read + '/' + p.total + '，要点 ' + p.noted + '/' + p.total + '）。按 landfill op=merge action=plan id=' + r.id + ' 的步骤继续：读全 → 每份写要点 → 整体重写 → action=commit。确实做不下去（例如要等用户决定）就说明原因。'
  }
}

/** 发给会话的合并指令（用户在会话信息卡点了「开始合并」）。 */
export function promptOf(r: MergeRec): string {
  return '合并落盘项目（dsh-project-manager 合并 ' + r.id + '）：用户在会话信息卡里点了「开始合并」，把下面 ' + r.srcs.length + ' 个合并成 ' + r.key + '：\n'
    + r.srcs.map((s) => '- ' + s.key + (s.kind === 'pointer' ? '（指针：只存了路径）' : '') + (s.mergeId ? '（上一次合并的结果）' : '')).join('\n') + '\n\n'
    + '1. landfill op=merge action=plan id=' + r.id + '：看来源、文件去向、要进「📁 文件索引」的文件。\n'
    + '2. 逐份读全来源的 STATE 与 [必读]（已注入的算读过；其余 landfill op=recall，有 next 就带 offset 读到 complete:true）。每读完一份，立刻 landfill op=merge action=note id=' + r.id + ' slug=<来源 key> content=<这份的要点：状态、结论、决策、所有 commit / 路径 / 版本号 / 单号>，防止上下文压缩丢进度。\n'
    + '3. 全部读完后，按 landfill-project skill「整体优化」写出一份合并后的 STATE：≤3 万字，细节指向 notes/；来源之间说法矛盾的写进「## ⚠ 待核实」，不替用户选边；「## 📁 文件索引」覆盖 plan 里的 indexFiles。\n'
    + '4. landfill op=merge action=commit id=' + r.id + ' content=<STATE 全文> drop=[有意删掉的 commit / 路径 / 版本号 / 单号]。被拒就按返回的 code 改好再提交。\n'
    + '5. 完成后用一两句话告诉用户结果（外部引用改了哪几处、待核实几条、哪些文件本机已不存在）。'
}
