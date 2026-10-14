/**
 * 0.20 迁移落盘项目：把整个文件夹从旧位置（按仓库对应的项目）搬到卡片组的落盘文件夹（~/.ai/projects/<组文件夹>/memory/designs/<slug>/）。
 * 在落盘（persist）时由插件自动执行，用户可撤销（搬回原处，之后不再自动迁）或删除旧文件夹。
 * 写入一律经 ai-memory（retire-dir / write / import / update-state / purge-retired，需要 v3），中途失败按登记的撤回动作倒放。
 * 和合并共用：路径改写 rewritePaths、外部引用 refFiles。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isText, LandfillError, listDocs, sha256, type Landfill } from './landfill.js'
import { MERGE_TOOL_VERSION, refFiles, rewritePaths, type BoardPort } from './merge.js'
import type { StateCatalog } from './states.js'

const projOf = (key: string): string => key.split('/')[0]
const slugOf = (key: string): string => key.split('/')[1]
const stamp = (d = new Date()): string => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')

export interface MigRec {
  id: string; from: string; to: string; at: string; dir: string; retired: string
  links: { cards: Array<{ id: string; before: string[] }>; groups: Array<{ id: string; before: string[] }> }
  refs: Array<{ file: string; rel: string; scope: string; afterHash: string; backup: string }>
  refsFailed: Array<{ file: string; error: string }>
  files: number
}
export interface MigDeps { aiRoot: string; dataDir: string; lf: Landfill; states: StateCatalog; board: BoardPort; log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void } }

export class MigrateEngine {
  private recs: MigRec[] = []
  /** 用户撤销过迁移的落盘项目：留在原处，之后落盘不再自动迁。 */
  private stays: string[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private readonly file: string
  constructor(private readonly d: MigDeps) {
    this.file = join(d.dataDir, 'migrations.json')
    try { const j = JSON.parse(readFileSync(this.file, 'utf8')) as { recs?: MigRec[]; stays?: string[] }; this.recs = Array.isArray(j.recs) ? j.recs : []; this.stays = Array.isArray(j.stays) ? j.stays : [] } catch { /* 没有 = 空 */ }
  }
  private save(): void { mkdirSync(this.d.dataDir, { recursive: true }); writeFileSync(this.file + '.tmp', JSON.stringify({ recs: this.recs, stays: this.stays }, null, 1)); renameSync(this.file + '.tmp', this.file) }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => undefined); return p }
  stay(key: string): boolean { return this.stays.includes(key) }
  /** 这个 key 最近一次迁移进来的记录（还能撤销 / 删除旧文件夹）。 */
  recOf(key: string): MigRec | undefined { return [...this.recs].reverse().find((r) => r.to === key) }
  get(id: string): MigRec { const r = this.recs.find((x) => x.id === id); if (!r) throw new LandfillError('NO_MIGRATION', '没有这次迁移（可能已撤销或删除）：' + id); return r }
  undoWhy(r: MigRec): string | null {
    if (!existsSync(this.d.lf.statePath(r.to))) return r.to + ' 已不在（可能被合并或移走），不能撤销'
    if (existsSync(this.d.lf.statePath(r.from))) return '原位置 ' + r.from + ' 又有了落盘项目，不能搬回'
    return null
  }
  private async ai(args: string[], input?: string, what = ''): Promise<Record<string, unknown>> {
    const r = await this.d.lf.ai(args, input)
    if (r.code !== 0) throw new LandfillError(r.code === 6 ? 'CONFLICT' : r.code === 5 ? 'OUT_OF_BAND' : 'AI_MEMORY_FAILED', what + '失败：' + (r.stderr.trim() || r.stdout.trim()).replace(/^ai-memory:\s*/, ''))
    try { return JSON.parse(r.stdout) as Record<string, unknown> } catch { return {} }
  }

  /**
   * 搬家：from（<project>/<slug>）→ toProject/<slug>。返回新 key 和改写函数（把文本里指向旧文件夹的路径换成新的）。
   * sid：本会话已读全的旧版本，搬过去后记为已读（内容只是路径被机械改写）。
   */
  private async move(sid: string | undefined, from: string, toProject: string, tag: string): Promise<{ key: string; rec: Omit<MigRec, 'id' | 'at'>; rewrite(t: string): string }> {
    if (this.d.lf.status.toolVersion < MERGE_TOOL_VERSION) throw new LandfillError('NEED_UPGRADE', '迁移落盘项目需要 ai-memory v' + MERGE_TOOL_VERSION + '（本机 v' + this.d.lf.status.toolVersion + '）：先在项目看板顶部点「升级 ai-memory」')
    const slug = slugOf(from)
    const to = toProject + '/' + slug
    if (projOf(from) === toProject) throw new LandfillError('BAD_ARG', from + ' 已经在 ' + toProject + ' 里')
    const srcDir = dirname(this.d.lf.statePath(from))
    if (!existsSync(join(srcDir, 'STATE.md'))) throw new LandfillError('NOT_FOUND', '没有 ' + from + ' 的 STATE')
    if (existsSync(this.d.lf.statePath(to))) throw new LandfillError('MIGRATE_CLASH', toProject + ' 里已经有同名的 ' + slug + '：两份要合在一起请用会话信息卡的「合并」')
    const aiRoot = this.d.aiRoot
    const lay = { map: { [from]: {} as Record<string, string> }, copied: [] as Array<{ path: string; rel: string; from: string }> }
    const rewrite = (t: string, relProject?: string): string => rewritePaths(t, aiRoot, to, [from], lay, relProject)
    const { files } = listDocs(srcDir, 2000)
    const known = new Set([join(srcDir, 'STATE.md'), ...files.map((f) => join(srcDir, f))].filter((p) => this.d.lf.inContext(sid ?? '', p)))
    const h = this.d.lf.fileInfo(join(srcDir, 'STATE.md'))?.hash
    let dir = stamp() + '-' + tag + '-' + slug
    const retiredOf = (dd: string): string => join(aiRoot, 'projects', projOf(from), 'inbox', 'retired', dd, slug)
    for (let i = 2; existsSync(retiredOf(dir)); i++) dir = stamp() + '-' + tag + '-' + slug + '-' + i
    const undo: Array<() => Promise<unknown>> = []
    const tdirRel = 'memory/designs/' + slug
    const links: MigRec['links'] = { cards: [], groups: [] }
    try {
      await this.ai(['retire-dir', '--project', projOf(from), '--dir', 'memory/designs/' + slug, '--dest', dir, ...(h ? ['--expected-hash', h] : [])], undefined, '移走 ' + from + ' ')
      undo.push(() => this.ai(['restore-dir', '--project', projOf(from), '--src', dir + '/' + slug, '--dir', 'memory/designs/' + slug], undefined, '恢复 ' + from + ' '))
      undo.push(async () => { if (existsSync(join(aiRoot, 'projects', toProject, tdirRel))) { await this.ai(['retire-dir', '--project', toProject, '--dir', tdirRel, '--dest', dir + '-failed'], undefined, '撤回半成品 '); await this.ai(['purge-retired', '--project', toProject, '--path', dir + '-failed/' + slug], undefined, '清理半成品 ') } })
      const ret = retiredOf(dir)
      for (const rel of files) {
        const p = join(ret, rel)
        let txt: string | null = null
        if (isText(rel)) { try { const t = readFileSync(p, 'utf8'); txt = t.includes('\u0000') ? null : t } catch { txt = null } }
        if (txt !== null) {
          const nt = rewrite(txt)
          const w = await this.ai(['write', '--project', toProject, '--file', tdirRel + '/' + rel, '--stdin'], nt, '放入 ' + rel + ' ')
          if (known.has(join(srcDir, rel))) this.d.lf.wrote(sid, String(w.file), String(w.hash_after), nt.length)
        } else await this.ai(['import', '--project', toProject, '--file', tdirRel + '/' + rel, '--src', p], undefined, '放入 ' + rel + ' ')
      }
      const st = rewrite(readFileSync(join(ret, 'STATE.md'), 'utf8'))
      const w = await this.ai(['update-state', '--project', toProject, '--slug', slug, '--stdin'], st, '写入 STATE ')
      if (sha256(readFileSync(String(w.file), 'utf8')) !== w.hash_after) throw new LandfillError('READBACK_FAILED', '迁移后回读校验没通过：' + String(w.file))
      if (known.has(join(srcDir, 'STATE.md'))) this.d.lf.wrote(sid, String(w.file), String(w.hash_after), st.length)
      await this.d.board.relink((b) => {
        for (const c of b.cards) if (c.links.includes(from)) { links.cards.push({ id: c.id, before: c.links.slice() }); c.links = [...new Set(c.links.map((k) => (k === from ? to : k)))] }
        for (const g of b.groups) if (g.links.includes(from)) { links.groups.push({ id: g.id, before: g.links.slice() }); g.links = [...new Set(g.links.map((k) => (k === from ? to : k)))] }
      })
    } catch (e) {
      for (const u of undo.reverse()) { try { await u() } catch (x) { this.d.log?.warn('迁移失败后撤回出错（需要人工核对 ' + dir + '）', x) } }
      throw e instanceof LandfillError ? e : new LandfillError('MIGRATE_FAILED', '迁移失败（已撤回）：' + (e instanceof Error ? e.message : String(e)))
    }
    // 外部引用（尽力而为）
    const refs: MigRec['refs'] = []
    const refsFailed: MigRec['refsFailed'] = []
    for (const ref of refFiles(aiRoot, [from], to)) {
      try {
        const old = readFileSync(ref.file, 'utf8')
        const next = rewrite(old, ref.project ?? undefined)
        if (next === old) continue
        const backup = join(this.d.dataDir, 'migrations', dir, sha256(ref.file).slice(0, 16) + '.txt')
        mkdirSync(dirname(backup), { recursive: true })
        writeFileSync(backup, old)
        const out = await this.ai(['write', ...(ref.project ? ['--project', ref.project] : ['--global']), '--file', ref.rel, '--expected-hash', sha256(old), '--stdin'], next, '改引用 ' + ref.rel + ' ')
        refs.push({ file: ref.file, rel: ref.rel, scope: ref.project ?? '', afterHash: String(out.hash_after), backup })
      } catch (e) { refsFailed.push({ file: ref.file, error: e instanceof Error ? e.message : String(e) }) }
    }
    this.d.states.invalidate()
    this.d.log?.info('迁移 ' + from + ' → ' + to + '（旧文件夹在 ' + projOf(from) + '/inbox/retired/' + dir + '）')
    return { key: to, rewrite: (t) => rewrite(t), rec: { from, to, dir, retired: retiredOf(dir), links, refs, refsFailed, files: files.length } }
  }

  /** 落盘时自动迁移（persist 调用）。 */
  migrate(sid: string | undefined, from: string, toProject: string): Promise<{ key: string; rewrite(t: string): string; rec: MigRec }> {
    return this.serial(async () => {
      const m = await this.move(sid, from, toProject, 'migrate')
      const rec: MigRec = { id: 'mv' + Date.now().toString(36), at: new Date().toISOString(), ...m.rec }
      this.recs.push(rec)
      this.save()
      return { key: m.key, rewrite: m.rewrite, rec }
    })
  }

  /** 撤销：搬回原处（带上迁移后又落盘的内容），之后不再自动迁；外部引用由反向搬家一起改回。 */
  undo(id: string): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const r = this.get(id)
      const why = this.undoWhy(r)
      if (why) throw new LandfillError('CANNOT_UNDO', why)
      const back = await this.move(undefined, r.to, projOf(r.from), 'unmigrate')
      // 反向搬家留下的那份和原处现在的内容相同，清掉；迁移前的旧文件夹仍在回收区
      try { await this.ai(['purge-retired', '--project', projOf(r.to), '--path', back.rec.dir + '/' + slugOf(r.to)], undefined, '清理 ') } catch (e) { this.d.log?.warn('撤销迁移后清理回收区失败', e) }
      if (!this.stays.includes(r.from)) this.stays.push(r.from)
      this.recs = this.recs.filter((x) => x !== r)
      this.save()
      return { id, key: r.from, refsBack: back.rec.refs.length, retired: r.retired }
    })
  }

  /** 删除迁移前的旧文件夹（回收区里那份）。 */
  purge(id: string): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const r = this.get(id)
      if (existsSync(r.retired)) await this.ai(['purge-retired', '--project', projOf(r.from), '--path', r.dir + '/' + slugOf(r.from)], undefined, '删除旧文件夹 ')
      this.recs = this.recs.filter((x) => x !== r)
      this.save()
      return { id, removed: r.retired }
    })
  }
}
