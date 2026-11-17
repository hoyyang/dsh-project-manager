/**
 * 知识卡（知识库 v1）：一卡一个 md 文件，frontmatter 只放最小子集（每行 key: value；
 * 数组 / 含特殊字符的字符串一律写 JSON —— JSON 是合法 YAML，人和 Obsidian 都能读）。
 * 存储 <dataDir>/kb/<id>.md：文件名 = id → 引用路径恒定，改标题不改路径。
 * 本文件是宿主纯逻辑：不碰路由 / 工具 / UI / board.json（S4 起接线）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BoardError, newId } from './model.js'
import { clip } from './text.js'

export type KbType = 'prompt' | 'howto' | 'snippet' | 'domain' | 'business' | 'moc'
export type KbStatus = 'draft' | 'verified' | 'stale'
export const KB_TYPES: KbType[] = ['prompt', 'howto', 'snippet', 'domain', 'business', 'moc']
export const KB_STATUSES: KbStatus[] = ['draft', 'verified', 'stale']
/** 文件名 = id：只认小写字母数字（newId('k') 生成），也挡住路径穿越。 */
export const KB_ID_RX = /^k[0-9a-z]{4,40}$/
export const KB_MAX_TITLE = 120
export const KB_MAX_SUMMARY = 200
export const KB_MAX_TAGS = 20
export const KB_MAX_TAG_LEN = 30
/** 正文上限 200 KB（设计卡 §一：一卡一个 md，不做长文仓库）。 */
export const KB_MAX_BODY = 200 * 1024

export interface KbCard {
  id: string
  title: string
  type: KbType
  status: KbStatus
  tags: string[]
  summary: string
  /** 仅 moc 汇总卡：子卡 id。 */
  contains: string[]
  /** 平级软链，只存一边（反链由索引算）。 */
  relates: string[]
  created: string
  updated: string
  body: string
  /** <dir>/<id>.md */
  path: string
  /** 前端不认识的 frontmatter key：原样保留，写回时不丢。 */
  extra?: Record<string, string>
}
export type KbDraft = Omit<KbCard, 'path'>

const KNOWN = new Set(['id', 'title', 'type', 'status', 'tags', 'summary', 'contains', 'relates', 'created', 'updated'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const oneLine = (v: string): string => v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
const cpLen = (v: string): number => Array.from(v).length

/** 裸值 = 不需要引号的 YAML 标量（含中文 / 空格 / 单个冒号都行；挡开头特殊符与「: 」「 #」，因为那会被 YAML 当结构）。 */
function bare(v: string): boolean {
  if (!v || v !== v.trim() || /[\n\r\t]/.test(v)) return false
  if (/^[-?:,\[\]{}#&*!|>'"%@`~]/.test(v)) return false
  return !/: | #/.test(v)
}
/** 标量序列化：能用裸值就裸值（人读得懂），否则 JSON（往返无损）。 */
const sc = (v: string): string => (bare(v) ? v : JSON.stringify(v))

export function serializeKb(c: KbCard): string {
  const fm = [
    'id: ' + c.id,
    'title: ' + sc(c.title),
    'type: ' + c.type,
    'status: ' + c.status,
    'tags: ' + JSON.stringify(c.tags),
    'summary: ' + sc(c.summary),
    'contains: ' + JSON.stringify(c.contains),
    'relates: ' + JSON.stringify(c.relates),
    'created: ' + sc(c.created),
    'updated: ' + sc(c.updated),
  ]
  for (const k of Object.keys(c.extra ?? {}).sort()) if (!KNOWN.has(k)) fm.push(k + ': ' + sc(str(c.extra?.[k])))
  return '---\n' + fm.join('\n') + '\n---\n' + c.body
}

/** 字符串字段：JSON 字符串就解析，否则去掉行尾注释（我们写出的裸值不含「 #」，所以不会误伤）。 */
function strOf(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (t[0] === '"') { try { const j: unknown = JSON.parse(t); if (typeof j === 'string') return j } catch { /* 手写坏引号：当裸值 */ } }
  return t.replace(/\s+#.*$/, '')
}
/** 数组字段：JSON 数组优先（我们写的就是它），否则按逗号切（人手写的简写也认）。 */
function arrOf(raw: string): string[] {
  const t = raw.trim()
  if (!t || t === '[]') return []
  if (t[0] === '[') { try { const j: unknown = JSON.parse(t); if (Array.isArray(j)) return j.filter((x) => typeof x === 'string') as string[] } catch { /* 落回逗号切 */ } }
  return t.replace(/^\[|\]$/g, '').split(',').map((x) => strOf(x).replace(/^["']|["']$/g, '')).filter(Boolean)
}

/** 解析一张知识卡；frontmatter 坏到没法定位 id 时抛错（KbStore 记进 errors 并跳过这个文件）。 */
export function parseKb(text: string, path = ''): KbCard {
  const src = text.replace(/^\uFEFF/, '')
  const lines = src.split('\n')
  if (lines[0].trim() !== '---') throw new BoardError('BAD_KB', '缺少 frontmatter（文件必须以 --- 开头）')
  let close = -1
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { close = i; break }
  if (close < 0) throw new BoardError('BAD_KB', 'frontmatter 没有结束的 ---')
  const fm: Record<string, string> = {}
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s?(.*)$/.exec(lines[i])
    if (m) fm[m[1]] = m[2]
  }
  const extra: Record<string, string> = {}
  for (const k of Object.keys(fm)) if (!KNOWN.has(k)) extra[k] = strOf(fm[k])
  const fileId = basename(path).replace(/\.md$/, '')
  const rawId = strOf(fm.id ?? '')
  const id = KB_ID_RX.test(rawId) ? rawId : KB_ID_RX.test(fileId) ? fileId : ''
  if (!id) throw new BoardError('BAD_KB', 'frontmatter 里没有合法 id，文件名也不是合法 id')
  return {
    id,
    title: strOf(fm.title ?? ''),
    type: typeOf(strOf(fm.type ?? '')),
    status: statusOf(strOf(fm.status ?? '')),
    tags: cleanTags(arrOf(fm.tags ?? '')),
    summary: strOf(fm.summary ?? ''),
    contains: cleanIds(arrOf(fm.contains ?? '')),
    relates: cleanIds(arrOf(fm.relates ?? '')),
    created: strOf(fm.created ?? ''),
    updated: strOf(fm.updated ?? ''),
    body: lines.slice(close + 1).join('\n'),
    path,
    ...(Object.keys(extra).length ? { extra } : {}),
  }
}

const typeOf = (v: string): KbType => (KB_TYPES.includes(v as KbType) ? (v as KbType) : 'domain')
const statusOf = (v: string): KbStatus => (KB_STATUSES.includes(v as KbStatus) ? (v as KbStatus) : 'draft')

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (out.length >= KB_MAX_TAGS) break
    const t = clip(oneLine(typeof x === 'string' ? x : ''), KB_MAX_TAG_LEN)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (out.length >= KB_MAX_TAGS * 10) break
    const id = str(x)
    if (KB_ID_RX.test(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * 校验 + 归一（create / update 唯一入口）。id 缺省 = newId('k')；
 * 越界策略：身份类（id / 标题 / 正文）超限直接拒，展示类（摘要 / 标签）截断。
 */
export function cleanKb(input: Partial<KbCard>, now = new Date().toISOString()): KbDraft {
  const id = str(input.id) || newId('k')
  if (!KB_ID_RX.test(id)) throw new BoardError('BAD_ARG', '知识卡 id 不合法：' + id)
  const title = oneLine(str(input.title))
  if (!title) throw new BoardError('BAD_ARG', '知识卡标题不能为空')
  if (cpLen(title) > KB_MAX_TITLE) throw new BoardError('BAD_ARG', '知识卡标题最多 ' + KB_MAX_TITLE + ' 字')
  const body = str(input.body)
  if (Buffer.byteLength(body, 'utf8') > KB_MAX_BODY) throw new BoardError('BAD_ARG', '知识卡正文超过 ' + KB_MAX_BODY / 1024 + ' KB')
  const extra = input.extra && typeof input.extra === 'object' ? input.extra : undefined
  return {
    id,
    title,
    type: typeOf(str(input.type)),
    status: statusOf(str(input.status)),
    tags: cleanTags(input.tags ?? []),
    summary: clip(oneLine(str(input.summary)), KB_MAX_SUMMARY),
    contains: cleanIds(input.contains ?? []),
    relates: cleanIds(input.relates ?? []),
    created: str(input.created) || now,
    updated: now,
    body,
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  }
}

type Err = { path: string; error: string }
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 目录短签名（文件名 + mtime + 大小）：变了才重读，和 StateCatalog 同一做法。 */
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return s.length.toString(36) + h.toString(36)
}

/**
 * 目录型知识库：一个 md 文件 = 一张卡。写盘一律 tmp + rename（原子）；
 * 外部改了文件，下次 list() 按签名自动重载。
 */
export class KbStore {
  readonly dir: string
  /** 解析失败的文件（不崩：跳过 + 记在这里给 UI / 日志看）。 */
  errors: Err[] = []
  private cards = new Map<string, KbCard>()
  private sig = ''

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
  }

  signature(): string {
    let names: string[] = []
    try { names = readdirSync(this.dir) } catch { names = [] }
    let s = ''
    for (const n of names.sort()) {
      if (!n.endsWith('.md')) continue
      try { const st = statSync(join(this.dir, n)); s += n + ':' + st.mtimeMs + ':' + st.size + ';' } catch { s += n + ':?;' }
    }
    return hash(s)
  }

  /** 全部知识卡（updated 倒序）。 */
  list(): KbCard[] {
    this.reload()
    return [...this.cards.values()].sort((a, b) => (a.updated === b.updated ? a.title.localeCompare(b.title) : a.updated < b.updated ? 1 : -1))
  }

  get(id: string): KbCard | undefined {
    if (!KB_ID_RX.test(id)) return undefined
    this.reload()
    return this.cards.get(id)
  }

  create(input: Partial<KbCard>): KbCard {
    const card: KbCard = { ...cleanKb(input), path: '' }
    card.path = join(this.dir, card.id + '.md')
    if (existsSync(card.path)) throw new BoardError('KB_EXISTS', '知识卡 ' + card.id + ' 已存在')
    this.writeCard(card)
    return card
  }

  /** 局部更新；created 不动、updated 刷新；id / path 不接受改动。 */
  update(id: string, patch: Partial<KbCard>): KbCard {
    const cur = this.get(id)
    if (!cur) throw new BoardError('NO_KB', '找不到知识卡 ' + id)
    const merged: Partial<KbCard> = { ...cur, ...patch, id: cur.id, path: cur.path, created: cur.created }
    const card: KbCard = { ...cleanKb(merged), path: cur.path }
    this.writeCard(card)
    return card
  }

  /** 删除 = 移到 <dir>/.trash/<id>.md（可撤销，与相关说明的 7 秒撤销同一条路）。 */
  remove(id: string): void {
    const cur = this.get(id)
    if (!cur) throw new BoardError('NO_KB', '找不到知识卡 ' + id)
    const trash = join(this.dir, '.trash')
    mkdirSync(trash, { recursive: true })
    renameSync(cur.path, join(trash, id + '.md'))
    this.sig = ''
  }

  restore(id: string): KbCard {
    if (!KB_ID_RX.test(id)) throw new BoardError('BAD_ARG', '知识卡 id 不合法：' + id)
    const from = join(this.dir, '.trash', id + '.md')
    if (!existsSync(from)) throw new BoardError('NO_KB', '回收站里没有知识卡 ' + id)
    const to = join(this.dir, id + '.md')
    if (existsSync(to)) throw new BoardError('KB_EXISTS', '知识卡 ' + id + ' 已经在了')
    renameSync(from, to)
    this.sig = ''
    const card = this.get(id)
    if (!card) throw new BoardError('BAD_KB', '恢复后解析不出知识卡 ' + id)
    return card
  }

  /** 摘要：卡里写了就用它；留空 = 正文去掉 markdown 符号后前 80 字。 */
  summaryOf(c: Pick<KbCard, 'summary' | 'body'>): string {
    if (c.summary) return c.summary
    const plain = c.body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/[*_~|]/g, '')
      .replace(/\s+/g, ' ')
    return clip(plain.trim(), 80)
  }

  private writeCard(c: KbCard): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = c.path + '.tmp'
    writeFileSync(tmp, serializeKb(c))
    renameSync(tmp, c.path)
    this.sig = ''
  }

  private reload(): void {
    const sig = this.signature()
    if (sig === this.sig) return
    const next = new Map<string, KbCard>()
    const errs: Err[] = []
    let names: string[] = []
    try { names = readdirSync(this.dir) } catch { names = [] }
    for (const n of names.sort()) {
      if (!n.endsWith('.md')) continue
      const p = join(this.dir, n)
      try {
        const c = parseKb(readFileSync(p, 'utf8'), p)
        next.set(c.id, c)
      } catch (e) { errs.push({ path: p, error: msg(e) }) }
    }
    this.cards = next
    this.errors = errs
    this.sig = sig
  }
}
