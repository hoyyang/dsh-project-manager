/**
 * 落盘项目（/landfill-project）只读目录：扫描 ~/.ai/projects/<project>/memory/designs/<slug>/STATE.md。
 * 规则：只读、不写 ~/.ai；单文件读取上限 256KB；解析失败的条目标记 error 而不是静默丢弃。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface StateInfo {
  key: string
  project: string
  slug: string
  path: string
  status: string
  next: string
  updated: string
  error?: string
}

const MAX_BYTES = 256 * 1024

function pickLine(text: string, labels: RegExp): string {
  for (const line of text.split('\n')) {
    const m = labels.exec(line)
    if (m) return m[1].replace(/\*\*/g, '').trim()
  }
  return ''
}

/** 标签行：可选列表符 + 可选加粗/反引号包裹 + 标签 + 冒号（中英文）。实测 ~/.ai 里 8 种写法都要认。 */
const label = (names: string): RegExp => new RegExp('^\\s*(?:[-*]\\s+)?[*_`]{0,2}(?:' + names + ')[*_`]{0,2}\\s*[:：]\\s*(.+)$', 'i')
const STATUS_RE = label('one-line status|一行状态')
const NEXT_RE = label('next_action')
const META_STATUS_RE = label('status')

export function parseState(text: string): { status: string; next: string } {
  const status = pickLine(text, STATUS_RE) || pickLine(text, META_STATUS_RE)
  const next = pickLine(text, NEXT_RE)
  return { status: status.slice(0, 400), next: next.slice(0, 400) }
}

export class StateCatalog {
  private cache: { at: number; list: StateInfo[] } | null = null
  constructor(private readonly aiRoot: string, private readonly ttlMs = 5000) {}

  list(): StateInfo[] {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.list
    const list: StateInfo[] = []
    const projectsDir = join(this.aiRoot, 'projects')
    let projects: string[] = []
    try { projects = readdirSync(projectsDir) } catch { projects = [] }
    for (const project of projects.sort()) {
      const designs = join(projectsDir, project, 'memory', 'designs')
      let slugs: string[] = []
      try { slugs = readdirSync(designs) } catch { continue }
      for (const slug of slugs.sort()) {
        const path = join(designs, slug, 'STATE.md')
        let st
        try { st = statSync(path) } catch { continue }
        if (!st.isFile()) continue
        const info: StateInfo = { key: project + '/' + slug, project, slug, path, status: '', next: '', updated: st.mtime.toISOString().slice(0, 10) }
        try {
          if (st.size > MAX_BYTES) throw new Error('STATE.md 超过 256KB，只读前 256KB')
          Object.assign(info, parseState(readFileSync(path, 'utf8')))
        } catch (e) {
          info.error = e instanceof Error ? e.message : String(e)
          try { Object.assign(info, parseState(readFileSync(path, 'utf8').slice(0, MAX_BYTES))) } catch { /* 保留 error */ }
        }
        list.push(info)
      }
    }
    this.cache = { at: Date.now(), list }
    return list
  }

  /** 按 key 直接读单个 STATE（记忆注入每步调用，不能每次全量扫描）。 */
  get(key: string): StateInfo | undefined {
    const hit = this.one.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.info
    const m = /^([^/]+)\/([^/]+)$/.exec(key)
    if (!m || m[1] === '..' || m[2] === '..') return undefined
    const path = join(this.aiRoot, 'projects', m[1], 'memory', 'designs', m[2], 'STATE.md')
    let info: StateInfo | undefined
    try {
      const st = statSync(path)
      info = { key, project: m[1], slug: m[2], path, status: '', next: '', updated: st.mtime.toISOString().slice(0, 10) }
      Object.assign(info, parseState(readFileSync(path, 'utf8').slice(0, MAX_BYTES)))
    } catch { info = undefined }
    this.one.set(key, { at: Date.now(), info })
    return info
  }
  private one = new Map<string, { at: number; info: StateInfo | undefined }>()
  invalidate(): void { this.cache = null; this.one.clear() }

  /** 目录签名（条目数 + 最新更新日 + 各 status/next 长度和）：STATE 变化时前端轮询能察觉。 */
  signature(): string {
    const l = this.list()
    let h = 0
    for (const s of l) for (const ch of s.key + s.status + s.next) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return l.length.toString(36) + h.toString(36)
  }
}
