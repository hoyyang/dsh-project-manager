/**
 * 0.16 落盘项目（/landfill-project）并入：环境检测 → 只补缺引导（~/.ai 骨架、ai-memory）→ skill 软链 → 调 ai-memory → 触发规则。
 * 唯一写入通道仍是 ~/.ai/tools/ai-memory（Python：flock + expected-hash，与其他 CLI 共用同一把锁）；本插件不自己写 ~/.ai 的记忆文件。
 * 判断规则（识别原话 / 拦截 / 收尾拉回）都是纯函数，单测直接覆盖。
 */
import { execFileSync, spawn } from 'node:child_process'
import { constants, chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path'
import type { StateCatalog } from './states.js'
import { blockOf, maskBlock, sameBlock, stripBlock, placeBlock } from './memory.js'
import { specHint, specIssues } from './lfspec.js'

export const SKILL_NAME = 'landfill-project'

export interface LandfillPaths { aiRoot: string; agentsHome: string; pkgDir: string; dataDir: string }
/** linked = 链接指向本插件；missing = 没有；file = 本机已有普通文件（等用户点「接管」）；foreign = 指向别处的链接（不动）。 */
export type SkillLink = 'linked' | 'missing' | 'file' | 'foreign' | 'stale'
export interface LandfillStatus { enabled: boolean; ok: boolean; reason: string; python: string; tool: string; created: string[]; skill: SkillLink; skillPath: string }
export interface RunResult { code: number; stdout: string; stderr: string }
export type Want = 'persist' | 'recall'
export interface Intent { want: Want; keys: string[] }
/** plan = 规划模式（只读，不拉回）；streak = 同一要求此前连续几轮没完成；quiet = 连续被忽略两轮后本轮不再拉回。 */
export interface TurnState extends Intent { turn: number; done: boolean; pulls: number; asked: boolean; plan?: boolean; streak?: number; quiet?: boolean }

const AI_README = '# Shared AI Memory\n\nShared project memory for local AI CLIs. Canonical files live in projects/<project>/memory/ and are written only through tools/ai-memory.\n'
const AI_CONVENTIONS = '# Shared AI Conventions\n\n- Evidence first: prefer concrete files, commands, and reproducible observations.\n- Do not create dual writable truths for the same memory.\n- Keep shared memory human-readable Markdown.\n'

// ── 环境 ──

/** 找 python3；macOS 的 /usr/bin/python3 在没装命令行开发工具时是占位程序（一调用就弹安装框），那种情况跳过。 */
export function findPython(platform: string = process.platform, pathEnv = process.env.PATH ?? '', exists: (p: string) => boolean = existsSync, clt: () => boolean = cltInstalled): string | null {
  if (platform === 'win32') return null
  const seen = new Set<string>()
  for (const d of [...pathEnv.split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    if (!d) continue
    const p = join(d, 'python3')
    if (seen.has(p)) continue
    seen.add(p)
    if (!exists(p)) continue
    if (platform === 'darwin' && p === '/usr/bin/python3' && !clt()) continue
    return p
  }
  return null
}
function cltInstalled(): boolean { try { execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'ignore', timeout: 5000 }); return true } catch { return false } }

/** 只补缺：~/.ai 不存在才建骨架；ai-memory 不存在才从插件包复制。已有的一律不碰（wx / COPYFILE_EXCL 防并发覆盖）。 */
export function bootstrap(p: LandfillPaths): string[] {
  const created: string[] = []
  if (!existsSync(p.aiRoot)) {
    mkdirSync(join(p.aiRoot, 'memory'), { recursive: true })
    writeFileSync(join(p.aiRoot, 'README.md'), AI_README, { flag: 'wx' })
    writeFileSync(join(p.aiRoot, 'conventions.md'), AI_CONVENTIONS, { flag: 'wx' })
    writeFileSync(join(p.aiRoot, 'memory', 'MEMORY_INDEX.md'), '# Memory Index\n', { flag: 'wx' })
    created.push(p.aiRoot)
  }
  const tool = join(p.aiRoot, 'tools', 'ai-memory')
  if (!existsSync(tool) && !isLink(tool)) {
    mkdirSync(dirname(tool), { recursive: true })
    copyFileSync(join(p.pkgDir, 'bin', 'ai-memory'), tool, constants.COPYFILE_EXCL)
    chmodSync(tool, 0o755)
    created.push(tool)
  }
  return created
}

function isLink(p: string): boolean { try { return lstatSync(p).isSymbolicLink() } catch { return false } }

export const skillFile = (p: LandfillPaths): string => join(p.pkgDir, 'skills', SKILL_NAME, 'SKILL.md')
export const skillLinkPath = (p: LandfillPaths): string => join(p.agentsHome, 'skills', SKILL_NAME, 'SKILL.md')

/** 链接目标是不是本插件（任意版本）的 skill：<包>/skills/landfill-project/SKILL.md 且 <包>/package.json name = dsh-project-manager。 */
function isOurSkill(target: string): boolean {
  try { return (JSON.parse(readFileSync(join(dirname(dirname(dirname(target))), 'package.json'), 'utf8')) as { name?: string }).name === 'dsh-project-manager' } catch { return false }
}

export function skillState(p: LandfillPaths): SkillLink {
  const link = skillLinkPath(p)
  let st
  try { st = lstatSync(link) } catch { return 'missing' }
  if (!st.isSymbolicLink()) return 'file'
  const raw = resolve(dirname(link), readlinkSync(link))
  if (!existsSync(raw)) return 'stale' // 链接断了（例如插件升级换了目录）
  try { if (realpathSync(raw) === realpathSync(skillFile(p))) return 'linked' } catch { /* 下面判断 */ }
  return isOurSkill(raw) ? 'stale' : 'foreign'
}

/** 没有 → 建链接；断了 / 指向本插件旧版本 → 重建；普通文件 / 别人的链接 → 不动。返回处理后的状态。 */
export function ensureSkillLink(p: LandfillPaths): SkillLink {
  const s = skillState(p)
  if (s !== 'missing' && s !== 'stale') return s
  const link = skillLinkPath(p)
  if (s === 'stale') rmSync(link)
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(skillFile(p), link)
  return 'linked'
}

/** 「接管」：本机已有的普通文件先备份到插件数据目录，再换成指向插件的链接。 */
export function adoptSkill(p: LandfillPaths, now = new Date()): { backup: string } {
  const s = skillState(p)
  if (s !== 'file') throw new LandfillError('NOT_A_FILE', '没有需要接管的普通文件（当前状态：' + s + '）：' + skillLinkPath(p))
  const link = skillLinkPath(p)
  const backup = join(p.dataDir, 'backups', 'landfill-project-SKILL.md.' + now.toISOString().replace(/[-:]/g, '').slice(0, 15))
  mkdirSync(dirname(backup), { recursive: true })
  copyFileSync(link, backup, constants.COPYFILE_EXCL)
  rmSync(link)
  symlinkSync(skillFile(p), link)
  return { backup }
}

export class LandfillError extends Error {
  constructor(readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message); this.name = 'LandfillError' }
}

// ── ai-memory 调用 ──

export function runAiMemory(python: string, tool: string, aiRoot: string, args: string[], input?: string, timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(python, [tool, ...args], { env: { ...process.env, AI_MEMORY_ROOT: aiRoot, AI_MEMORY_WRITER: 'dsh-project-manager' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d: Buffer) => { out += d })
    child.stderr.on('data', (d: Buffer) => { err += d })
    child.on('error', (e) => { clearTimeout(t); done({ code: -1, stdout: out, stderr: String(e) }) })
    child.on('close', (code) => { clearTimeout(t); done({ code: code ?? -1, stdout: out, stderr: err }) })
    child.stdin.end(input ?? '')
  })
}

const EXIT: Record<number, string> = { 2: 'BAD_ARG', 4: 'UNREGISTERED', 5: 'OUT_OF_BAND', 6: 'CONFLICT', 7: 'INVALID', 8: 'NEED_HASH', 75: 'LOCK_TIMEOUT' }
/** ai-memory 失败 → 带 code 的错误；冲突 / 外部改动时把 inbox 产物路径原样带回（不重试）。 */
export function aiFailure(r: RunResult, what: string): LandfillError {
  const msg = (r.stderr.trim() || r.stdout.trim() || 'exit ' + r.code).replace(/^ai-memory:\s*/, '')
  const inbox = /(?:wrote|copied to) (\/\S+)\s*$/.exec(msg)?.[1]
  return new LandfillError(EXIT[r.code] ?? 'AI_MEMORY_FAILED', what + '失败：' + msg, inbox ? { inbox } : {})
}

export const sha256 = (s: string | Buffer): string => (typeof s === 'string' ? createHash('sha256').update(s, 'utf8') : createHash('sha256').update(s)).digest('hex')
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export function checkName(v: unknown, field: string): string {
  if (typeof v !== 'string' || !NAME_RE.test(v)) throw new LandfillError('BAD_ARG', field + ' 只能用字母、数字、. _ -（收到 ' + JSON.stringify(v) + '）')
  return v
}
/** STATE 必须有的章节（landfill-project skill 的 Required STATE Content 里机器能查的部分）。 */
export function missingSections(text: string): string[] {
  const miss: string[] = []
  if (!/重启读取清单/.test(text)) miss.push('## 🔄 重启读取清单')
  if (!/next_action/.test(text)) miss.push('next_action')
  return miss
}

// ── 0.17 分段回忆 + 防丢（纯函数） ──

/** 每段字符上限：宿主只把 ≤12500 token 的工具结果直接给模型（dsh-base spill-policy maxInlineTokens），更大的落到文件、模型只看到提示。
 *  本机 240 份 STATE 实测最密 0.262 token/字符（JSON 转义后）→ 32000 字符 ≈ 8400 token，加 toc 与外层字段仍在上限内。 */
export const CHUNK = 32_000
/** 推荐体量：一段读完。 */
export const SIZE_TARGET = 30_000
/** 从 offset 起切一段：不超过 max，优先切在「## 」标题前，其次换行处。 */
export function cutEnd(text: string, offset: number, max = CHUNK): number {
  if (text.length - offset <= max) return text.length
  const lim = offset + max
  const h = text.lastIndexOf('\n## ', lim - 1)
  if (h > offset + max / 2) return h + 1
  const n = text.lastIndexOf('\n', lim - 1)
  return n > offset ? n + 1 : lim
}
/** 从 0 开始的全部分段起点。 */
export function chunkStarts(text: string, max = CHUNK): number[] {
  const s = [0]
  for (let e = cutEnd(text, 0, max); e < text.length; e = cutEnd(text, e, max)) s.push(e)
  return s
}
/** ## 标题目录（带 offset），最多 60 条（只放二级标题，控制第一段体量）。 */
export function toc(text: string): Array<{ offset: number; title: string }> {
  const out: Array<{ offset: number; title: string }> = []
  for (const m of text.matchAll(/^## .*$/gm)) { out.push({ offset: m.index ?? 0, title: m[0].slice(3, 63) }); if (out.length >= 60) break }
  return out
}
/** 已读区间合并后，没读到的部分。 */
export function uncovered(ranges: Array<[number, number]>, total: number): Array<[number, number]> {
  const r = [...ranges].sort((a, b) => a[0] - b[0])
  const gaps: Array<[number, number]> = []
  let at = 0
  for (const [s, e] of r) { if (s > at) gaps.push([at, s]); at = Math.max(at, e) }
  if (at < total) gaps.push([at, total])
  return gaps
}

const STOP = '\\s`\'"()<>[\\]{}|*\\u3000-\\u303f\\uff00-\\uffef\\u2018-\\u201f'
const URL_RE = new RegExp('https?:\\/\\/[^' + STOP + ']+', 'g')
const PATH_RE = new RegExp('(?<![\\w.:/-])(?:~\\/|\\/(?:Users|home|private|tmp|opt|Applications|Volumes|var|etc|srv)\\/)[^' + STOP + ']+', 'g')
const TAIL = /[.,:;!?)\]}>'"，。；：、）》」]+$/
const LINE_SUFFIX = /(?:#L\d+(?:-L?\d+)?|:\d+(?:[-–]\d+)?)$/
/** 关键事实锚点：commit 哈希、版本号、本机路径、URL、单号。用来发现「新稿悄悄少了什么」。 */
export function anchors(text: string): Set<string> {
  const out = new Set<string>()
  const add = (v: string): void => { const x = v.replace(TAIL, ''); if (x.length >= 4) out.add(x) }
  for (const m of text.matchAll(URL_RE)) add(m[0])
  const noUrl = text.replace(URL_RE, ' ')
  for (const m of noUrl.matchAll(PATH_RE)) add(m[0])
  for (const m of noUrl.matchAll(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g)) add(m[0])
  for (const m of noUrl.matchAll(/(?<![\w.])v?(\d+\.\d+\.\d+)(?![\w.]*\d)/g)) out.add(m[1])
  for (const m of noUrl.matchAll(/\b[A-Z][A-Z0-9]+(?:-\d+[A-Z]?)+\b/g)) add(m[0])
  return out
}
/** 旧稿有、新稿没有、也没被 drop（子串）覆盖的锚点。 */
export function droppedAnchors(oldText: string, newText: string, drop: string[] = []): { lost: string[]; dropped: number } {
  const now = anchors(newText)
  const gone = [...anchors(oldText)].filter((a) => !now.has(a) && !newText.includes(a))
  return { lost: gone.filter((a) => !drop.some((d) => a.includes(d))), dropped: gone.length }
}
/** 新稿里写到、本机却不存在的路径（提示核对，不拦）。 */
export function missingPaths(text: string, home = homedir(), exists: (p: string) => boolean = existsSync): string[] {
  const out: string[] = []
  let n = 0
  for (const a of anchors(text)) {
    if (!(a.startsWith('/') || a.startsWith('~/'))) continue
    if (++n > 300 || out.length >= 20) break
    const p = a.replace(LINE_SUFFIX, '').replace(/^~(?=\/)/, home)
    if (!exists(p)) out.push(a)
  }
  return out
}
const headings = (t: string): string[] => [...t.matchAll(/^#{2,3} (.*)$/gm)].map((m) => m[1].trim())

// ── 0.18 项目文件夹（纯函数） ──

export const REQUIRED_MAX = 60_000
export const AUTOREAD_BUDGET = 96_000
const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|log|csv|ya?ml|html?|js|mjs|cjs|ts|py|sh|xml|toml|ini|diff|patch)$/i
const WRITE_EXT = /\.(md|txt|json|log|csv|ya?ml)$/i
/** 文本文件：扩展名在白名单里，且前 8KB 没有 NUL。 */
export function isText(path: string, head?: Buffer): boolean {
  if (!TEXT_EXT.test(path)) return false
  return head ? !head.includes(0) : true
}
/** 文件索引行：「- [必读|参考] 路径 · 用途 · 何时读」（路径可带反引号）。 */
export function parseIndex(text: string): Array<{ tag: '必读' | '参考'; path: string }> {
  const out: Array<{ tag: '必读' | '参考'; path: string }> = []
  for (const m of text.matchAll(/^\s*[-*]\s*\[(必读|参考)\]\s*`?([^\s`·|，,]+)`?/gm)) out.push({ tag: m[1] as '必读' | '参考', path: m[2].replace(/^\.\//, '') })
  return out
}
/** 文件夹里的相对路径（递归，跳过 STATE.md 与点开头的条目），最多 max 个。 */
export function listDocs(dir: string, max = 200): { files: string[]; more: number } {
  const files: string[] = []
  let more = 0
  const walk = (rel: string): void => {
    let names: string[] = []
    try { names = readdirSync(join(dir, rel)).sort() } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const r = rel ? rel + '/' + n : n
      if (r === 'STATE.md') continue
      let st
      try { st = lstatSync(join(dir, r)) } catch { continue }
      if (st.isDirectory()) walk(r)
      else if (st.isFile()) { if (files.length < max) files.push(r); else more++ }
    }
  }
  walk('')
  return { files, more }
}
/** 「## … 文件索引」这一节的正文；没有这一节 = ''（文件夹里有文件就必须建这一节）。 */
export function indexSection(body: string): string {
  const m = /^## .*文件索引.*$/m.exec(body)
  if (!m) return ''
  const rest = body.slice(m.index + m[0].length)
  const n = rest.search(/^## /m)
  return n < 0 ? rest : rest.slice(0, n)
}
/** 文件有没有进索引：「文件索引」节里有一行 [必读|参考] 写的是它本身，或它所在的任一级目录（写成 dir/）。只提到不算。 */
export function isIndexed(rel: string, whole: string): boolean {
  const paths = parseIndex(indexSection(whole)).map((e) => e.path)
  return paths.some((p) => p === rel || (p.endsWith('/') && rel.startsWith(p)))
}
const IMPORT_MAX = 50 * 1024 * 1024
/** 文件夹内相对路径校验：不能越界 / 不能是 STATE.md / 每段只用字母数字中文 . _ -。 */
export function checkRel(v: unknown, mode: 'read' | 'write' | 'import' = 'read'): string {
  if (typeof v !== 'string' || !v.trim()) throw new LandfillError('BAD_ARG', 'file 是项目文件夹里的相对路径（如 notes/design.md、plans/2026-10-13-x.md）')
  const r = v.trim().replace(/^\.\//, '')
  const seg = r.split('/')
  if (r.startsWith('/') || seg.some((s) => !s || s.startsWith('.') || !/^[A-Za-z0-9._\u4e00-\u9fff-]+$/.test(s)) || r.length > 300) throw new LandfillError('BAD_ARG', 'file 不合法（只能用字母、数字、中文、. _ -，不能越出项目文件夹）：' + JSON.stringify(v))
  if (r === 'STATE.md') throw new LandfillError('BAD_ARG', 'STATE.md 用 op=persist 写，不能用 ' + mode)
  if (mode === 'write' && !WRITE_EXT.test(r)) throw new LandfillError('BAD_ARG', 'op=write 只写文本（.md .txt .json .log .csv .yml）：' + r)
  if (mode === 'import' && !r.startsWith('evidence/')) throw new LandfillError('BAD_ARG', 'op=import 只能导入到 evidence/ 下：' + r)
  return r
}

// ── 触发规则（纯函数） ──

const ISSUE_LIKE = /^(?:iss|feedback|fb|xs)-/i
/** 本句提到的落盘项目：slug（或 0.19 别名）≥4 字符（或问题单号）出现在原文里；被更长命中包含的短名字去掉。 */
export function mentioned(text: string, states: ReadonlyArray<{ key: string; slug: string; aliases?: readonly string[] }>): string[] {
  const low = text.toLowerCase()
  const names = states.flatMap((s) => [s.slug, ...(s.aliases ?? [])].map((n) => ({ key: s.key, n: n.toLowerCase() })))
  // 中文名字 ≥3 字、其余 ≥4 字符才认（太短误伤多）
  const hits = names.filter((x) => (x.n.length >= (/[\u4e00-\u9fff]/.test(x.n) ? 3 : 4) || ISSUE_LIKE.test(x.n)) && low.includes(x.n))
  return [...new Set(hits.filter((x) => !hits.some((o) => o.n.length > x.n.length && o.n.includes(x.n))).map((x) => x.key))]
}

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 「落盘项目」作名词用（讨论这个功能）时后面常跟的字：这些不算指令。 */
const NOUN_AFTER = '的|功能|记录|结构|文件|机制|插件|是|和|与|里|中|这|那|怎么|如何|要|会|能|吗|呢'
/**
 * 用户原话 → 要落盘 / 要回忆。0.18：「落盘项目」只在三种写法下算指令——某行以它开头（后面不是「的 / 功能 …」）、
 * 后面跟着已知 slug / 单号、或在整条消息末尾；引号（「」“”""）里的不算。「回忆」优先；「继续」只在点名了已知项目时算回忆。
 */
export function detectIntent(text: string, states: ReadonlyArray<{ key: string; slug: string; aliases?: readonly string[] }>): Intent | null {
  const t = text.slice(0, 8000)
  if (!t.trim() || t.includes('<task-notification>')) return null
  // 0.19 合并指令（会话信息卡发出）有自己的流程，不算落盘 / 回忆
  if (/^s*合并落盘项目（dsh-project-manager 合并 /.test(t)) return null
  const u = t.replace(/「[^」\n]*」|“[^”\n]*”|"[^"\n]*"/g, ' ')
  const keys = mentioned(u, states)
  if (/回忆/.test(u) && keys.length) return { want: 'recall', keys }
  const lineStart = new RegExp('^[\\s>*-]*落盘项目(?!' + NOUN_AFTER + ')', 'm').test(u)
  const atEnd = /落盘项目[\s。.!！~，,]*$/.test(u)
  const slugs = states.filter((s) => keys.includes(s.key)).flatMap((s) => [s.slug, ...(s.aliases ?? [])])
  const named = slugs.some((sl) => new RegExp('落盘项目\\s*[:：]?\\s*' + escRe(sl), 'i').test(u))
  if (lineStart || atEnd || named) return { want: 'persist', keys }
  if (/继续/.test(u) && keys.length) return { want: 'recall', keys }
  return null
}

export function intentHint(i: Intent, project: string | null): string {
  const keys = i.keys.length ? i.keys.join('、') : '（从用户这句话和上下文判断）'
  if (i.want === 'persist') return '[dsh-project-manager · 落盘项目] 本轮用户要求落盘，先于回答完成：读全 STATE 与全部 [必读] 子文档（插件已注入的全文算已读；缺的用 landfill op=recall，有 next 就带 offset 读到 complete:true）→ 整理项目文件夹（重复的合并 op=write，过时 / 弃用 / 错误的 op=retire）→ 按 landfill-project skill 的「整体优化」规则重写整份 STATE（文件索引与文件夹一致）→ op=persist（有意删掉的 commit/路径/版本号/单号写进 drop）→ 看返回的报告（sizeWarning / missingPaths / dangling 要处理）。候选：' + keys + '；当前项目：' + (project ?? '没有登记（先问用户，确认后 op=register）') + '。写入并回读校验成功后再回答。'
  return '[dsh-project-manager · 回忆] 本轮用户要求回忆 ' + keys + '：先用 landfill 工具 op=recall 读 STATE，有 next 就带 offset 继续读，直到 complete:true；再按其中的 next_action 继续。不要凭会话记忆回答。'
}

/** 回合要结束时：要求的事没做、没在等用户回答、拉回次数没用完、不在规划模式、没被连续忽略 → 返回拉回提示；否则 null。 */
export function stopNudge(s: TurnState, maxPulls = 2, plan = false): string | null {
  if (plan || s.plan || s.quiet || s.done || s.asked || s.pulls >= maxPulls) return null
  return s.want === 'persist'
    ? '[dsh-project-manager] 本轮用户要求「落盘项目」，但还没有一次成功的落盘（landfill op=persist）。现在完成它；确实做不了（例如项目没登记、要等用户确认）就直接说明原因。'
    : '[dsh-project-manager] 本轮用户要求回忆 ' + (s.keys.join('、') || '落盘项目') + '，但 STATE 与 [必读] 子文档还没读全。用 landfill op=recall 按 next / pending 读完（complete:true），再继续回答。'
}

/** 规划模式下识别到落盘：只提示，不要求写。 */
export const PLAN_HINT = '[dsh-project-manager · 落盘项目] 用户提到落盘，但会话在规划模式（只读）：现在不能写 STATE。把「落盘」列为方案里的一个步骤，并告诉用户退出规划模式后再落盘；不要尝试写入。'

const MUTATE_CMD = new Set(['rm', 'mv', 'chmod', 'chflags', 'truncate', 'tee', 'unlink'])
const DEST_CMD = new Set(['cp', 'install', 'ln', 'rsync'])
/** 拦截：write / edit 直写 ~/.ai 记忆 Markdown；bash 里不经 ai-memory 改 ~/.ai/{projects,memory}/。返回拒绝理由或 null。规则只认明确的写法，避免误伤只读命令。 */
export function guardReason(name: string, args: Record<string, unknown>, aiRoot: string, home = homedir()): string | null {
  const root = resolve(aiRoot)
  const expand = (p: string): string => resolve(p.replace(/^~(?=\/)/, home).replace(/^\$\{?HOME\}?(?=\/)/, home))
  // 只管记忆本身：<root>/memory/**、<root>/projects/<id>/memory/**、REGISTRY.md；inbox / locks / log 等不拦
  const inZone = (p: string): boolean => {
    const r = expand(p)
    if (!r.startsWith(root + sep)) return false
    const rel = r.slice(root.length + 1).split(sep)
    return rel[0] === 'memory' || (rel[0] === 'projects' && (rel[1] === 'REGISTRY.md' || rel[2] === 'memory'))
  }
  if (name === 'write' || name === 'edit') {
    const fp = String(args.file_path ?? args.path ?? '')
    return fp && /\.md$/i.test(fp) && inZone(fp) ? REASON : null
  }
  if (name !== 'bash') return null
  const cmd = String(args.command ?? '')
  if (!cmd) return null
  const tok = (s: string): string => s.replace(/^["']|["']$/g, '')
  // 逐段判断：只有「这一段本身就是调 ai-memory」才放行这一段（同一行里别的段照样检查）
  for (const seg of cmd.split(/[;&|\n]+/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean)
    if (words.some((w) => /(^|\/)ai-memory(\.py)?$/.test(tok(w)))) continue
    for (const m of seg.matchAll(/>>?\s*([^\s;&|<>]+)/g)) if (m[1] && !m[1].startsWith('&') && inZone(tok(m[1]))) return REASON
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || words[i] === 'sudo' || words[i] === 'command')) i++
    const c = (words[i] ?? '').replace(/^.*\//, '')
    const rest = words.slice(i + 1).filter((w) => !w.startsWith('-')).map(tok)
    const inplace = (c === 'sed' || c === 'perl') && words.slice(i + 1).some((w) => /^-[a-zA-Z]*i/.test(w))
    if ((MUTATE_CMD.has(c) || inplace) && rest.some(inZone)) return REASON
    if (DEST_CMD.has(c) && rest.length && inZone(rest[rest.length - 1])) return REASON
  }
  return null
}
const REASON = '[dsh-project-manager] ~/.ai 下的落盘项目记忆不能直接改：会绕过并发校验，和别的 CLI 同时写时会丢内容。写 STATE 用 landfill 工具（op=persist / append），或在 bash 里调 ~/.ai/tools/ai-memory。'

// ── 服务 ──

export interface ToolSession { id?: string; cwd?: string }
/** 会话所在卡片：cardId、卡片级 / 组级关联的落盘项目。 */
export interface Scope { cardId?: string; card: string[]; group: string[] }
export interface LandfillDeps {
  /** 这个会话可用来认项目的路径：卡片组 / 卡片挂的仓库（按优先级）。 */
  repoPaths(sessionId: string | undefined): string[]
  /** 落盘成功后：会话绑了卡片就把这个 STATE 关联上。 */
  persisted?(sessionId: string | undefined, key: string): void
  /** 0.18 这个 key 的卡片档案块（按看板现生成；没有关联 = ''）。 */
  cardBlock?(key: string): string
  /** 0.18 会话所在卡片的范围；没绑卡片 = undefined。 */
  scope?(sessionId: string | undefined): Scope | undefined
  /** 0.20 新建落盘项目放哪个项目：会话卡片所在卡片组的落盘文件夹（没设 = undefined；设了但没登记会先登记）。 */
  home?(sessionId: string | undefined): Promise<string | undefined>
  /** 0.20 卡片组还没设落盘文件夹时给的建议（报 NEED_GROUP_FOLDER 用）。 */
  homeHint?(sessionId: string | undefined): { group: string; suggest: string } | undefined
  /** 0.20 这份 STATE 按现行规范要不要迁移：返回目标项目（卡片组的落盘文件夹）。 */
  moveTarget?(key: string): string | undefined
  /** 0.20 迁移（插件自动，可撤销）：返回新 key 与路径改写函数。 */
  migrate?(sessionId: string | undefined, key: string, toProject: string): Promise<{ key: string; rewrite(t: string): string; rec: { id: string; from: string; to: string; retired: string; refs: unknown[] } }>
  /** 0.20 规范检查清单的上下文（关联它的卡片名等）。 */
  specCtx?(key: string): import('./lfspec.js').SpecCtx
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}
interface Read { hash: string; total: number; ranges: Array<[number, number]> }
interface FileInfo { mtime: number; size: number; hash: string; binary: boolean; text?: string }
/** seq = 已检查到的会话事件位置（找 compaction/*）。 */
interface Known { seq?: number; files: Record<string, string> }
export interface Owed { key: string; file: string; next: number }
/** 0.20 信息卡发起的落盘这一轮：busy 进行中 / done 写好了 / stopped 被停止 / error 出错 / ask 在问用户 / nowrite 一轮结束但没写。 */
export interface LfRun { key: string; label: string; at: number; state: 'busy' | 'done' | 'stopped' | 'error' | 'ask' | 'nowrite'; end?: number; error?: string; seen?: boolean }

/** 文件名用的标题：去掉不允许的字符，最长 60。 */
export function titleSlug(plan: string): string {
  const h = /^#\s+(.+)$/m.exec(plan)?.[1] ?? 'plan'
  return h.replace(/[^A-Za-z0-9._\u4e00-\u9fff-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || 'plan'
}
const localDate = (d = new Date()): string => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
export const bundledVersion = (pkgDir: string): number => { try { return Number(/^VERSION\s*=\s*(\d+)/m.exec(readFileSync(join(pkgDir, 'bin', 'ai-memory'), 'utf8'))?.[1] ?? 0) } catch { return 0 } }

export class Landfill {
  status: LandfillStatus & { toolVersion: number; bundledVersion: number; toolOutdated: boolean }
  /** 会话 × 文件绝对路径 → 读到的版本与已读区间（「读全才许写」靠它）。 */
  private seen = new Map<string, Map<string, Read>>()
  /** 会话 × 文件 → 会话上下文里已有完整内容的版本（注入 / 读全 / 本会话写入）；跨重启保存。 */
  private known = new Map<string, Known>()
  private files = new Map<string, FileInfo>()
  private turns = new Map<string, TurnState>()
  private owedOf = new Map<string, { keys: string[]; pulls: number; turn: number }>()
  private readonly knownPath: string
  constructor(readonly paths: LandfillPaths, private readonly states: StateCatalog, private readonly deps: LandfillDeps, enabled = true, platform: string = process.platform) {
    const tool = join(paths.aiRoot, 'tools', 'ai-memory')
    this.knownPath = join(paths.dataDir, 'landfill-known.json')
    this.status = { enabled, ok: false, reason: '', python: '', tool, created: [], skill: 'missing', skillPath: skillLinkPath(paths), toolVersion: 0, bundledVersion: bundledVersion(paths.pkgDir), toolOutdated: false }
    if (!enabled) { this.status.reason = '已在插件配置里关闭'; return }
    if (platform === 'win32') { this.status.reason = 'Windows 不支持（ai-memory 依赖 fcntl 文件锁）'; return }
    const py = findPython(platform)
    if (!py) { this.status.reason = '没找到 python3（macOS 可装命令行开发工具或 Homebrew python）'; return }
    this.status.python = py
    try {
      this.status.created = bootstrap(paths)
      for (const c of this.status.created) deps.log?.info('落盘项目：已创建 ' + c)
      this.status.skill = ensureSkillLink(paths)
      this.probeVersion()
      this.status.ok = true
    } catch (e) { this.status.reason = '初始化失败：' + (e instanceof Error ? e.message : String(e)); deps.log?.warn('落盘项目初始化失败', e) }
    try { const j = JSON.parse(readFileSync(this.knownPath, 'utf8')) as Record<string, Known>; for (const [k, v] of Object.entries(j)) if (v && typeof v.files === 'object') this.known.set(k, { ...(typeof v.seq === 'number' ? { seq: v.seq } : {}), files: v.files }) } catch { /* 没有 / 坏了 = 从空开始 */ }
  }

  private probeVersion(): void {
    let v = 0
    try { v = Number((JSON.parse(execFileSync(this.status.python, [this.status.tool, 'version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, AI_MEMORY_ROOT: this.paths.aiRoot } })) as { version?: number }).version ?? 0) } catch { v = 0 }
    this.status.toolVersion = v
    this.status.toolOutdated = v < this.status.bundledVersion
  }

  /** 看板轮询用：skill 链接状态每次现查（用户可能在外面动过）。 */
  snapshot(): LandfillStatus & { toolVersion: number; bundledVersion: number; toolOutdated: boolean } {
    if (this.status.ok) { try { this.status.skill = skillState(this.paths) } catch { /* 保留上次 */ } }
    return { ...this.status, created: [...this.status.created] }
  }
  adopt(): { backup: string } { const r = adoptSkill(this.paths); this.status.skill = 'linked'; this.deps.log?.info('落盘项目：已接管 skill，原文件备份在 ' + r.backup); return r }
  /** 0.18 用户点「升级」：~/.ai/tools/ai-memory 先备份到插件数据目录，再换成插件自带的新版。 */
  upgradeTool(now = new Date()): { backup: string; version: number } {
    if (!this.status.ok) throw new LandfillError('LANDFILL_OFF', '落盘项目功能没开启：' + this.status.reason)
    if (!this.status.toolOutdated) throw new LandfillError('UP_TO_DATE', 'ai-memory 已是最新（v' + this.status.toolVersion + '）')
    const backup = join(this.paths.dataDir, 'backups', 'ai-memory.' + now.toISOString().replace(/[-:]/g, '').slice(0, 15))
    mkdirSync(dirname(backup), { recursive: true })
    copyFileSync(this.status.tool, backup, constants.COPYFILE_EXCL)
    copyFileSync(join(this.paths.pkgDir, 'bin', 'ai-memory'), this.status.tool)
    chmodSync(this.status.tool, 0o755)
    this.probeVersion()
    this.deps.log?.info('落盘项目：ai-memory 已升级到 v' + this.status.toolVersion + '，原文件备份在 ' + backup)
    return { backup, version: this.status.toolVersion }
  }

  /** 0.19 合并用：调 ai-memory（不抛 LANDFILL_OFF 以外的错，由调用方看 code）。 */
  ai(args: string[], input?: string): Promise<RunResult> { return this.run(args, input) }
  /** 0.19 文件当前版本（按 mtime + 大小缓存）。 */
  fileInfo(path: string): { hash: string; binary: boolean; size: number; text?: string } | undefined { return this.info(path) }
  /** 0.19 会话上下文里是否已有这个文件当前版本（「AI 收到的原文」浮层用）。 */
  inContext(sid: string, path: string): boolean { return this.covered(sid, path) }
  /** 0.19 STATE 文件索引里存在的 [必读] 文本文件。 */
  requiredFiles(key: string): string[] { const f = this.info(this.statePath(key)); return f ? this.requiredOf(f.text ?? '').filter((r) => { const fi = this.info(join(this.dirOf(key), r)); return !!fi && !fi.binary }) : [] }
  /** 0.19 本会话刚写入的完整文件：记为已读 / 已知（不回灌注入）。 */
  wrote(sid: string | undefined, path: string, hash: string, total: number): void { this.files.delete(path); this.remember(sid, path, hash, total, [0, total]) }

  private run(args: string[], input?: string): Promise<RunResult> {
    if (!this.status.ok) throw new LandfillError('LANDFILL_OFF', '落盘项目功能没开启：' + this.status.reason)
    return runAiMemory(this.status.python, this.status.tool, this.paths.aiRoot, args, input)
  }

  // ── 文件与已读 ──

  /** 文件当前版本（按 mtime + 大小缓存）；不存在 / 不是文件 = undefined。 */
  private info(path: string): FileInfo | undefined {
    let st
    try { st = statSync(path) } catch { this.files.delete(path); return undefined }
    if (!st.isFile()) return undefined
    const hit = this.files.get(path)
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit
    const buf = readFileSync(path)
    const binary = !isText(path, buf.subarray(0, 8192))
    const f: FileInfo = { mtime: st.mtimeMs, size: st.size, hash: sha256(buf), binary, ...(binary ? {} : { text: buf.toString('utf8') }) }
    this.files.set(path, f)
    if (this.files.size > 400) this.files.delete(this.files.keys().next().value as string)
    return f
  }
  private knownEntry(sid: string): Known {
    let k = this.known.get(sid)
    if (!k) { k = { files: {} }; this.known.set(sid, k); if (this.known.size > 400) this.known.delete(this.known.keys().next().value as string) }
    return k
  }
  private saveKnown(): void {
    try { mkdirSync(this.paths.dataDir, { recursive: true }); writeFileSync(this.knownPath, JSON.stringify(Object.fromEntries(this.known))) } catch (e) { this.deps.log?.warn('保存已注入版本失败', e) }
  }
  private markKnown(sid: string | undefined, path: string, hash: string): void {
    if (!sid) return
    const k = this.knownEntry(sid)
    if (k.files[path] === hash) return
    k.files[path] = hash
    this.saveKnown()
  }
  /** 分叉：子会话继承父会话上下文里已有的版本。 */
  forkKnown(child: string, parent: string): void {
    const p = this.known.get(parent)
    if (!p || this.known.has(child)) return
    this.known.set(child, { files: { ...p.files } })
    this.saveKnown()
  }
  /** 记一段已读；hash 变了就从头记；读全 = 会话里有完整内容。 */
  private remember(sid: string | undefined, path: string, hash: string, total: number, range: [number, number]): Read | undefined {
    if (!sid) return undefined
    let m = this.seen.get(sid)
    if (!m) { m = new Map(); this.seen.set(sid, m); if (this.seen.size > 300) this.seen.delete(this.seen.keys().next().value as string) }
    let r = m.get(path)
    if (!r || r.hash !== hash) { r = { hash, total, ranges: [] }; m.set(path, r) }
    r.ranges.push(range)
    if (!uncovered(r.ranges, total).length) this.markKnown(sid, path, hash)
    return r
  }
  private forget(sid: string | undefined, path: string): void {
    if (sid) { this.seen.get(sid)?.delete(path); const k = this.known.get(sid); if (k && path in k.files) { delete k.files[path]; this.saveKnown() } }
    this.files.delete(path)
  }
  /** 会话里是否已有这个文件当前版本的完整内容。 */
  private covered(sid: string | undefined, path: string): boolean {
    const f = this.info(path)
    if (!f) return true
    if (!sid) return false
    if (this.known.get(sid)?.files[path] === f.hash) return true
    const r = this.seen.get(sid)?.get(path)
    return !!r && r.hash === f.hash && !uncovered(r.ranges, r.total).length
  }
  /** 没读到的第一处 offset。 */
  private nextGap(sid: string | undefined, path: string): number {
    const f = this.info(path)
    const r = sid ? this.seen.get(sid)?.get(path) : undefined
    if (!f || !r || r.hash !== f.hash) return 0
    return uncovered(r.ranges, r.total)[0]?.[0] ?? 0
  }
  dirOf(key: string): string { return dirname(this.statePath(key)) }
  /** STATE 文件索引里的 [必读] 相对路径（去重）。 */
  private requiredOf(text: string): string[] { return [...new Set(parseIndex(stripBlock(text)).filter((e) => e.tag === '必读').map((e) => e.path))] }
  /** 这个 key 还没读完的文件（STATE + 存在的文本 [必读]）。 */
  pending(sid: string | undefined, key: string): Owed[] {
    const sp = this.statePath(key)
    const f = this.info(sp)
    if (!f) return []
    const out: Owed[] = []
    if (!this.covered(sid, sp)) out.push({ key, file: 'STATE.md', next: this.nextGap(sid, sp) })
    for (const rel of this.requiredOf(f.text ?? '')) {
      const p = join(this.dirOf(key), rel)
      const fi = this.info(p)
      if (!fi || fi.binary || this.covered(sid, p)) continue
      out.push({ key, file: rel, next: this.nextGap(sid, p) })
    }
    return out
  }
  /** 文件夹清单（紧凑字符串，最多 40 条）。 */
  private docsOf(sid: string | undefined, key: string, stateText: string): { docs: string[]; total: number } {
    const dir = this.dirOf(key)
    const body = stripBlock(stateText)
    const idx = new Map(parseIndex(body).map((e) => [e.path.replace(/\/+$/, ''), e.tag]))
    const smt = this.info(this.statePath(key))?.mtime ?? 0
    const { files, more } = listDocs(dir)
    const docs = files.slice(0, 40).map((rel) => {
      const f = this.info(join(dir, rel))
      if (!f) return rel
      const tag = idx.get(rel)
      return [rel, tag ?? (isIndexed(rel, body) ? '目录已索引' : '未索引'), f.binary ? f.size + ' 字节' : (f.text ?? '').length + ' 字', f.mtime > smt ? '上次落盘后改过' : '', f.binary ? '' : this.covered(sid, join(dir, rel)) ? '已读' : '未读'].filter(Boolean).join(' · ')
    })
    return { docs, total: files.length + more }
  }

  /** 项目解析：显式 project → 卡片挂的仓库 → 会话目录；都认不出返回 null。 */
  async resolveProject(s: ToolSession, explicit?: string): Promise<string | null> {
    if (explicit) return checkName(explicit, 'project')
    for (const p of [...this.deps.repoPaths(s.id), ...(s.cwd ? [s.cwd] : [])]) {
      const r = await this.run(['path', '--cwd', p])
      if (r.code === 0) { try { return (JSON.parse(r.stdout) as { project_id: string }).project_id } catch { /* 下一个 */ } }
    }
    return null
  }

  /** slug 或 <project>/<slug> → 唯一 key；找不到时按 project 新建；多个同名要求指定 project。 */
  async resolveKey(s: ToolSession, slugOrKey: string, project?: string, allowNew = false): Promise<string> {
    if (slugOrKey.includes('/')) {
      const [p, sl] = slugOrKey.split('/')
      const k = checkName(p, 'project') + '/' + checkName(sl, 'slug')
      if (existsSync(this.statePath(k))) return k
      // 0.19 合并掉的旧 key → 合并结果（别名）
      const al = this.states.list().filter((x) => (x.aliases ?? []).some((a) => a.toLowerCase() === sl.toLowerCase()))
      return al.length === 1 ? al[0].key : k
    }
    const slug = checkName(slugOrKey, 'slug')
    const all = this.states.list().filter((x) => !project || x.project === project)
    let hits = all.filter((x) => x.slug.toLowerCase() === slug.toLowerCase())
    // 0.19 合并后旧名字是别名
    if (!hits.length) hits = all.filter((x) => (x.aliases ?? []).some((a) => a.toLowerCase() === slug.toLowerCase()))
    if (hits.length === 1) return hits[0].key
    if (hits.length > 1) throw new LandfillError('AMBIGUOUS', '多个项目都有 ' + slug + '：' + hits.map((h) => h.key).join('、') + '，请带上 project')
    if (!allowNew) throw new LandfillError('NOT_FOUND', '没找到落盘项目 ' + slug + (project ? '（project ' + project + '）' : ''))
    // 0.20 新建的落盘项目按卡片组归档：卡片组设了落盘文件夹就放那里（显式 project 优先）
    const home = project ? undefined : await this.deps.home?.(s.id)
    if (!project && !home && this.deps.homeHint) { const h = this.deps.homeHint(s.id); if (h) throw new LandfillError('NEED_GROUP_FOLDER', '卡片组「' + h.group + '」还没设落盘文件夹：新建的落盘项目要放进卡片组自己的文件夹。请用户在会话信息卡里确认一次（建议 ' + h.suggest + '），确认后再落盘', { suggest: h.suggest }) }
    const pid = home ?? await this.resolveProject(s, project)
    if (!pid) throw new LandfillError('UNREGISTERED', '当前会话认不出属于哪个登记过的项目。先问用户项目 id 和根目录，确认后 op=register（confirm:true），或直接带 project 参数', { cwd: s.cwd ?? null, repos: this.deps.repoPaths(s.id) })
    return pid + '/' + slug
  }

  /** 0.18 slug 可省：用会话卡片唯一的主 STATE；新建时防碎片（卡片已有主 STATE 又要建别的 = CARD_HAS_STATE，newState:true 放行）。 */
  async keyFor(s: ToolSession, slugOrKey: string | undefined, project?: string, allowNew = false, newState = false): Promise<string> {
    const sc = this.deps.scope?.(s.id)
    if (!slugOrKey) {
      const pick = sc?.card.length ? sc.card : sc?.group ?? []
      if (pick.length === 1) return pick[0]
      if (pick.length > 1) throw new LandfillError('AMBIGUOUS', '这张卡片关联了多个落盘项目：' + pick.join('、') + '，请带 slug')
      throw new LandfillError('NEED_SLUG', '会话没有关联卡片的落盘项目，请带 slug')
    }
    const key = await this.resolveKey(s, slugOrKey, project, allowNew)
    if (allowNew && !newState && !existsSync(this.statePath(key)) && sc?.card.length && !sc.card.includes(key)) throw new LandfillError('CARD_HAS_STATE', '这张卡片已经有主 STATE：' + sc.card.join('、') + '。同一工作流写进已有的（不带 slug 即可）；确实是能独立推进的工作流，就在同组新建一张卡片，或带 newState:true', { existing: sc.card })
    return key
  }

  statePath(key: string): string { const [p, sl] = key.split('/'); return join(this.paths.aiRoot, 'projects', p, 'memory', 'designs', sl, 'STATE.md') }
  private fullRel(key: string, rel: string): string { return 'memory/designs/' + key.split('/')[1] + '/' + rel }

  /** 分段回忆：STATE（不带 file）或子文档（file）。complete = STATE + 全部 [必读] 都读完。 */
  async recall(s: ToolSession, slugOrKey: string | undefined, project?: string, offset = 0, max = CHUNK, file?: string): Promise<Record<string, unknown>> {
    const key = await this.keyFor(s, slugOrKey, project)
    const rel = file ? checkRel(file) : 'STATE.md'
    const path = join(this.dirOf(key), rel)
    const f = this.info(path)
    if (!f) throw new LandfillError('NOT_FOUND', '读不到 ' + (rel === 'STATE.md' ? 'STATE' : rel) + '：' + path)
    if (f.binary) throw new LandfillError('BINARY', rel + ' 是二进制文件（' + f.size + ' 字节），recall 只读文本；需要时用看图 / 其他工具打开：' + path)
    const text = f.text ?? ''
    const hash = f.hash
    const total = text.length
    if (!Number.isInteger(offset) || offset < 0 || (offset >= total && total > 0)) throw new LandfillError('BAD_ARG', 'offset 要在 0 到 ' + (total - 1) + ' 之间（收到 ' + offset + '）')
    const prev = s.id ? this.seen.get(s.id)?.get(path) : undefined
    if (prev && prev.hash !== hash && offset > 0) {
      this.seen.get(s.id ?? '')?.delete(path)
      throw new LandfillError('CHANGED', key + ' 的 ' + rel + ' 在分段读取之间被别处改过，已读记录作废：从 offset 0 重新读')
    }
    const end = cutEnd(text, offset, max)
    const rec = this.remember(s.id, path, hash, total, [offset, end])
    const missing = rec ? uncovered(rec.ranges, total) : end < total ? [[end, total]] : []
    const fileDone = missing.length === 0
    const pend = s.id ? this.pending(s.id, key) : fileDone ? [] : [{ key, file: rel, next: end }]
    const complete = pend.length === 0
    if (complete) this.mark(s.id, 'recall', key)
    const starts = chunkStarts(text, max)
    const idx = starts.indexOf(offset)
    const next = end < total ? end : missing[0]?.[0]
    const isState = rel === 'STATE.md'
    const sc = this.deps.scope?.(s.id)
    const extra: Record<string, unknown> = {}
    if (isState && offset === 0) {
      const d = this.docsOf(s.id, key, text)
      if (d.total) { extra.docs = d.docs; if (d.total > d.docs.length) extra.docsMore = d.total - d.docs.length }
      const live = this.deps.cardBlock?.(key) ?? ''
      if (!sameBlock(live.trim(), blockOf(text).trim())) {
        extra.cardStale = true
        // 本会话的卡片：实时档案已在系统提示里，不再重复返回
        extra.card = !live ? '（看板里已没有卡片关联它：下次 persist 时档案块会被去掉）' : sc?.cardId && live.includes('cards=') && (/cards=([^\s]*)/.exec(live)?.[1] ?? '').split(',').includes(sc.cardId) ? '（STATE 里的卡片档案已过期；实时版见系统提示「卡片档案（实时）」，persist 时插件会自动更新）' : live
      }
    }
    return {
      key, file: rel, path, hash, total, offset, end, chunk: (idx >= 0 ? idx + 1 : '?') + '/' + starts.length, fileComplete: fileDone, complete,
      ...(isState ? { stateComplete: fileDone } : {}),
      ...(next !== undefined && !fileDone ? { next, missing: missing.slice(0, 10) } : {}),
      ...(!complete ? { pending: pend.slice(0, 20), hint: fileDone ? '这个文件读完了；还有 [必读] 文件没读：按 pending 逐个 recall file=<file> offset=<next>，直到 complete:true' : '还没读全：带 offset=' + next + (isState ? '' : ' file=' + rel) + ' 继续 recall，直到 complete:true' } : {}),
      ...(offset === 0 && starts.length > 1 ? { toc: toc(text) } : {}),
      ...extra,
      content: isState ? maskBlock(text, offset, end, sc?.cardId) : text.slice(offset, end),
    }
  }

  async persist(s: ToolSession, slugOrKey: string | undefined, content: unknown, project?: string, expectedHash?: string, drop: unknown = [], newState = false): Promise<Record<string, unknown>> {
    if (typeof content !== 'string' || !content.trim()) throw new LandfillError('BAD_ARG', 'content 必须是完整的 STATE 正文')
    const miss = missingSections(content)
    if (miss.length) throw new LandfillError('MISSING_SECTIONS', 'STATE 缺少必需内容：' + miss.join('、') + '（见 landfill-project skill 的 Required STATE Content）')
    const badDrop = Array.isArray(drop) ? drop.find((d) => typeof d !== 'string' || d.trim().length < 4) : drop
    if (!Array.isArray(drop) || badDrop !== undefined || drop.length > 500) throw new LandfillError('BAD_ARG', 'drop 是字符串数组（每项 ≥4 字符，≤500 项）：有意删掉的 commit / 路径 / 版本号 / 单号（子串匹配）。不合格：' + (Array.isArray(drop) && drop.length > 500 ? drop.length + ' 项' : JSON.stringify(badDrop)))
    const drops = (drop as string[]).map((d) => d.trim())
    let key = await this.keyFor(s, slugOrKey, project, true, newState)
    const [pid, slug] = key.split('/')
    let path = this.statePath(key)
    const dir = dirname(path)
    // 卡片档案：草稿里的旧块剥掉，换成按看板现生成的
    const block = this.deps.cardBlock?.(key) ?? ''
    let final = placeBlock(content, block)
    const body = stripBlock(final)
    const exists = existsSync(path)
    let args = ['update-state', '--project', pid, '--slug', slug, '--stdin']
    // 0.20 规范检查：AI 要改的项没改好 → 拒绝（插件自己修的项——位置——在写入前迁移）
    const spec = this.deps.specCtx ? specIssues(body, { ...this.deps.specCtx(key), stay: true }).filter((x) => x.by === 'ai') : []
    if (spec.length) throw new LandfillError('SPEC_ISSUES', specHint(key, spec) + '。按这些改好再 persist', { issues: spec.map((x) => ({ id: x.id, text: x.text, fix: x.fix })) })
    let old = ''
    let oldMtime = 0
    if (exists) {
      const cur = this.info(path)
      const rec = s.id ? this.seen.get(s.id)?.get(path) : undefined
      const h = expectedHash ?? (this.covered(s.id, path) ? cur?.hash : rec?.hash)
      if (!h) throw new LandfillError('NEED_READ', key + ' 已存在：先 op=recall 读全再写（避免覆盖别处刚写入的内容）')
      old = readFileSync(path, 'utf8')
      oldMtime = cur?.mtime ?? 0
      // h 与磁盘一致才做读全 / 锚点检查；不一致交给 ai-memory 报冲突（inbox 留存新稿）
      if (h === sha256(old)) {
        const gaps = this.covered(s.id, path) ? [] : (rec && rec.hash === h ? uncovered(rec.ranges, old.length) : [[0, old.length] as [number, number]])
        const docGaps: Owed[] = []
        for (const r of new Set([...this.requiredOf(old), ...this.requiredOf(final)])) {
          const p = join(dir, r)
          const fi = this.info(p)
          if (fi && !fi.binary && !this.covered(s.id, p)) docGaps.push({ key, file: r, next: this.nextGap(s.id, p) })
        }
        if (gaps.length || docGaps.length) throw new LandfillError('NEED_FULL_READ', key + ' 本会话还没读全当前版本（STATE + [必读] 子文档），不能整份覆盖：先 recall 把这些读完', { missing: gaps.slice(0, 10).map((g) => g[0]), files: docGaps.slice(0, 20) })
        const d = droppedAnchors(stripBlock(old), body, drops)
        if (d.lost.length) throw new LandfillError('DROPPED_ANCHORS', '新稿少了 ' + d.lost.length + ' 处关键事实（commit / 路径 / 版本号 / 单号）且没声明删除：补回来，或确认是有意删的就写进 drop 再调', { lost: d.lost.slice(0, 50), total: d.lost.length })
      }
      args.push('--expected-hash', h)
    }
    // 文件夹：每个文件都要有索引；[必读] 只能是存在的文本文件
    const { files: docs, more } = listDocs(dir, 2000)
    const unindexed = docs.filter((r) => !isIndexed(r, body))
    if (unindexed.length) throw new LandfillError('UNINDEXED_FILES', '项目文件夹里有 ' + unindexed.length + ' 个文件没进 STATE 的文件索引：在「## 📁 文件索引」里给每个文件（或整个目录，写成 dir/）补一行「- [必读|参考] 路径 · 用途 · 何时读」；过时的先 op=retire', { files: unindexed.slice(0, 50), total: unindexed.length })
    const idx = parseIndex(body)
    const bad = idx.filter((e) => e.tag === '必读' && existsSync(join(dir, e.path)) && (this.info(join(dir, e.path))?.binary ?? true))
    if (bad.length) throw new LandfillError('BAD_TAG', '[必读] 只能标文本文件（目录 / 二进制改标 [参考]）：' + bad.map((e) => e.path).join('、'), { files: bad.map((e) => e.path) })
    const dangling = idx.filter((e) => !existsSync(join(dir, e.path))).map((e) => e.path)
    const required = this.requiredOf(final).filter((r) => existsSync(join(dir, r)))
    const requiredChars = required.reduce((n, r) => n + (this.info(join(dir, r))?.text?.length ?? 0), 0)
    let folderBytes = 0
    for (const r of docs) folderBytes += this.info(join(dir, r))?.size ?? 0
    const changedSince = exists ? docs.filter((r) => (this.info(join(dir, r))?.mtime ?? 0) > oldMtime).length : 0
    // 0.20 不在卡片组的落盘文件夹里 → 先整个迁过去（可撤销），再写新稿（路径改指新位置）
    let migrated: Record<string, unknown> | undefined
    const origKey = key
    const to = exists && this.deps.moveTarget && this.deps.migrate ? this.deps.moveTarget(key) : undefined
    if (to) {
      const m = await this.deps.migrate!(s.id, key, to)
      final = m.rewrite(final)
      key = m.key
      path = this.statePath(key)
      const cur = this.info(path)
      args = ['update-state', '--project', key.split('/')[0], '--slug', slug, '--stdin', ...(cur ? ['--expected-hash', cur.hash] : [])]
      migrated = { from: m.rec.from, to: m.rec.to, retired: m.rec.retired, refs: m.rec.refs.length, hint: '已按规范迁到卡片组的落盘文件夹（旧文件夹在回收区，可在会话信息卡撤销）' }
    }
    const r = await this.run(args, final)
    if (r.code !== 0) throw aiFailure(r, '写入 ' + key + ' ')
    const out = JSON.parse(r.stdout) as { file: string; hash_after: string }
    const back = readFileSync(out.file, 'utf8')
    if (sha256(back) !== out.hash_after || missingSections(back).length) throw new LandfillError('READBACK_FAILED', '写入后回读校验没通过：' + out.file)
    this.files.delete(out.file)
    this.remember(s.id, out.file, out.hash_after, back.length, [0, back.length])
    this.mark(s.id, 'persist', key)
    // 迁移后 key 变了：信息卡登记的是迁移前的 key，两个都认
    this.runDone(s.id, key, origKey)
    this.states.invalidate()
    try { this.deps.persisted?.(s.id, key) } catch (e) { this.deps.log?.warn('落盘后关联卡片失败', e) }
    const warn = /^# 落盘项目 STATE: /m.test(back) ? [] : ['建议首行用「# 落盘项目 STATE: ' + slug + '」']
    if (!/^## .*文件索引/m.test(back) && docs.length) warn.push('建议加「## 📁 文件索引」节（每个文件一行：[必读|参考] 路径 · 用途 · 何时读）')
    // 写后报告：只提示不拦
    const nowH = new Set(headings(back))
    const removed = exists ? headings(old).filter((h) => !nowH.has(h)).slice(0, 30) : []
    const backBody = stripBlock(back)
    const sizeWarning = back.length > SIZE_TARGET ? '超过 ' + SIZE_TARGET + ' 字符（' + back.length + '）：按 skill 的整体优化规则再精简，目标一次 recall 读完'
      : exists && old.length > SIZE_TARGET && back.length >= old.length ? '大 STATE 写完没变小：确认做了整体优化' : undefined
    const mp = missingPaths(backBody)
    const cmp = missingPaths(blockOf(back))
    const report = {
      before: exists ? old.length : 0, after: back.length, removedHeadings: removed, dropped: exists ? droppedAnchors(stripBlock(old), backBody).dropped : 0,
      card: block ? { synced: true, cards: (/cards=([^\s]*)/.exec(block)?.[1] ?? '').split(',').filter(Boolean).length } : { synced: false },
      files: { total: docs.length + more, required: required.length, requiredChars, changedSince, ...(dangling.length ? { dangling, danglingHint: '文件索引里写了、文件夹里没有：删掉这些行或补上文件' } : {}) },
      ...(requiredChars > REQUIRED_MAX ? { requiredWarning: '[必读] 合计 ' + requiredChars + ' 字（建议 ≤' + REQUIRED_MAX + '）：把不是每次都要读的改成 [参考]，或精简' } : {}),
      ...(folderBytes > 2 * 1024 * 1024 ? { folderWarning: '项目文件夹 ' + Math.round(folderBytes / 1024) + 'KB（>2MB）：精简 evidence/，退役过时的证据' } : {}),
      ...(sizeWarning ? { sizeWarning } : {}),
      ...(mp.length ? { missingPaths: mp, missingHint: '这些路径本机不存在：改正，或删掉（写进 drop）' } : {}),
      ...(cmp.length ? { cardMissingPaths: cmp, cardMissingHint: '卡片档案里登记的这些文件本机不存在：请用户在看板里更新这张卡片' } : {}),
    }
    return { key, path: out.file, created: !exists, hashAfter: out.hash_after, verified: true, report, ...(migrated ? { migrated } : {}), ...(warn.length ? { warnings: warn } : {}) }
  }

  /** 0.18 写项目文件夹里的文本文件（合并 / 精简 / 新建）。已存在的要先读全。 */
  async write(s: ToolSession, slugOrKey: string | undefined, file: unknown, content: unknown, project?: string, expectedHash?: string): Promise<Record<string, unknown>> {
    const key = await this.keyFor(s, slugOrKey, project)
    if (!existsSync(this.statePath(key))) throw new LandfillError('NOT_FOUND', key + ' 还没有 STATE：先 op=persist 建 STATE，再写子文档')
    const rel = checkRel(file, 'write')
    if (typeof content !== 'string' || !content.trim()) throw new LandfillError('BAD_ARG', 'content 不能为空')
    const path = join(this.dirOf(key), rel)
    const f = this.info(path)
    const args = ['write', '--project', key.split('/')[0], '--file', this.fullRel(key, rel), '--stdin']
    if (f) {
      if (f.binary) throw new LandfillError('BAD_ARG', rel + ' 是二进制文件，不能用 write 覆盖')
      if (!this.covered(s.id, path) && expectedHash !== f.hash) throw new LandfillError('NEED_FULL_READ', rel + ' 已存在，本会话还没读全当前版本：先 recall file=' + rel + ' 读完再写', { files: [{ key, file: rel, next: this.nextGap(s.id, path) }] })
      args.push('--expected-hash', f.hash)
    }
    return this.writeRaw(s.id, key, rel, args, content, !f)
  }
  private async writeRaw(sid: string | undefined, key: string, rel: string, args: string[], content: string, created: boolean): Promise<Record<string, unknown>> {
    const r = await this.run(args, content)
    if (r.code !== 0) throw aiFailure(r, '写入 ' + key + ':' + rel + ' ')
    const out = JSON.parse(r.stdout) as { file: string; hash_after: string }
    const back = readFileSync(out.file, 'utf8')
    if (sha256(back) !== out.hash_after) throw new LandfillError('READBACK_FAILED', '写入后回读校验没通过：' + out.file)
    this.files.delete(out.file)
    this.remember(sid, out.file, out.hash_after, back.length, [0, back.length])
    const st = this.info(this.statePath(key))
    const indexed = st?.text ? isIndexed(rel, stripBlock(st.text)) : false
    return { key, file: rel, path: out.file, created, hashAfter: out.hash_after, verified: true, ...(indexed ? {} : { hint: '在 STATE 的「## 📁 文件索引」里加一行（下次 persist 会检查）' }) }
  }

  /** 0.18 退役项目文件夹里的文件：移到 projects/<p>/inbox/retired/（可恢复）。文本要先读全。 */
  async retire(s: ToolSession, slugOrKey: string | undefined, file: unknown, project?: string): Promise<Record<string, unknown>> {
    const key = await this.keyFor(s, slugOrKey, project)
    const rel = checkRel(file)
    const path = join(this.dirOf(key), rel)
    const f = this.info(path)
    if (!f) throw new LandfillError('NOT_FOUND', '没有这个文件：' + path)
    if (!f.binary && !this.covered(s.id, path)) throw new LandfillError('NEED_FULL_READ', '退役前先读完 ' + rel + '（确认里面没有还要留下的内容）：recall file=' + rel, { files: [{ key, file: rel, next: this.nextGap(s.id, path) }] })
    const r = await this.run(['retire', '--project', key.split('/')[0], '--file', this.fullRel(key, rel), '--expected-hash', f.hash])
    if (r.code !== 0) throw aiFailure(r, '退役 ' + key + ':' + rel + ' ')
    const out = JSON.parse(r.stdout) as { retired: string }
    this.forget(s.id, path)
    return { key, file: rel, retired: out.retired, hint: '把它从 STATE 的文件索引里删掉（下次 persist 会提示 dangling）' }
  }

  /** 0.18 导入本机文件（截图 / 日志等，可二进制）到 evidence/。需要新版 ai-memory。 */
  async importFile(s: ToolSession, slugOrKey: string | undefined, src: unknown, dest: unknown, project?: string): Promise<Record<string, unknown>> {
    const key = await this.keyFor(s, slugOrKey, project)
    if (typeof src !== 'string' || !src.startsWith('/')) throw new LandfillError('BAD_ARG', 'src 是本机文件的绝对路径')
    let st
    try { st = statSync(src) } catch { throw new LandfillError('NOT_FOUND', '没有这个文件：' + src) }
    if (!st.isFile()) throw new LandfillError('BAD_ARG', 'src 不是文件：' + src)
    if (st.size > IMPORT_MAX) throw new LandfillError('TOO_LARGE', src + ' 超过 50MB，不导入；在 STATE 里记路径即可')
    const rel = checkRel(typeof dest === 'string' && dest ? dest : 'evidence/' + basename(src).replace(/[^A-Za-z0-9._\u4e00-\u9fff-]+/g, '-'), 'import')
    if (existsSync(join(this.dirOf(key), rel))) throw new LandfillError('EXISTS', rel + ' 已存在：换个 dest，或先 retire 旧的')
    if (this.status.toolOutdated) throw new LandfillError('NEED_UPGRADE', '本机 ~/.ai/tools/ai-memory 是旧版（v' + this.status.toolVersion + '，需要 v' + this.status.bundledVersion + '）不支持导入：请用户在项目看板顶部点「升级 ai-memory」（会先备份）')
    const r = await this.run(['import', '--project', key.split('/')[0], '--file', this.fullRel(key, rel), '--src', src])
    if (r.code !== 0) throw aiFailure(r, '导入 ' + key + ':' + rel + ' ')
    const out = JSON.parse(r.stdout) as { file: string; hash_after: string }
    const got = sha256(readFileSync(out.file))
    if (got !== sha256(readFileSync(src)) || got !== out.hash_after) throw new LandfillError('READBACK_FAILED', '导入后校验没通过：' + out.file)
    return { key, file: rel, path: out.file, bytes: st.size, hashAfter: out.hash_after, verified: true, hint: '在 STATE 的文件索引里加一行（[参考]）' }
  }

  /** 0.18 计划批准后归档到 plans/<日期>-<标题>.md（会话卡片只有一个主 STATE 时）。返回写入结果或 null。 */
  async archivePlan(sid: string | undefined, plan: string): Promise<Record<string, unknown> | null> {
    const sc = this.deps.scope?.(sid)
    const keys = sc?.card.length ? sc.card : sc?.group ?? []
    if (keys.length !== 1) { if (sc) this.deps.log?.info('计划归档跳过：卡片关联了 ' + keys.length + ' 个落盘项目'); return null }
    const key = keys[0]
    if (!existsSync(this.statePath(key))) return null
    const base = 'plans/' + localDate() + '-' + titleSlug(plan)
    let rel = base + '.md'
    for (let i = 2; existsSync(join(this.dirOf(key), rel)); i++) rel = base + '-' + i + '.md'
    return this.writeRaw(sid, key, rel, ['write', '--project', key.split('/')[0], '--file', this.fullRel(key, rel), '--stdin'], plan, true)
  }

  /** 系统提示索引行用：当前版本 hash 与存在的 [必读] 文件。 */
  brief(key: string): { hash?: string; required: string[] } {
    const f = this.info(this.statePath(key))
    if (!f) return { required: [] }
    return { hash: f.hash, required: this.requiredOf(f.text ?? '').filter((r) => existsSync(join(this.dirOf(key), r))) }
  }
  /** 手动关联已有会话：它之前读过的 STATE（readKeys）按当前版本记为已知，不重复注入。 */
  // ponytail: 不知道它读的是哪个版本，按关联时的版本算；之后 STATE 一变就会注入新版
  seed(sid: string, keys: readonly string[]): void {
    for (const k of keys) { const f = this.info(this.statePath(k)); if (f) this.markKnown(sid, this.statePath(k), f.hash) }
  }

  // ── 0.18 注入最新全文 ──

  /** 某文件最近一次写入者（ai-memory journal 的 writer）。 */
  private lastWriter(key: string, rel: string): string | undefined {
    const j = join(this.paths.aiRoot, 'projects', key.split('/')[0], 'log', 'events.jsonl')
    try {
      const fd = openSync(j, 'r')
      try {
        const size = statSync(j).size
        const len = Math.min(size, 128 * 1024)
        const buf = Buffer.alloc(len)
        readSync(fd, buf, 0, len, size - len)
        const want = this.fullRel(key, rel)
        for (const l of buf.toString('utf8').split('\n').reverse()) { if (!l.includes(want)) continue; try { const e = JSON.parse(l) as { file?: string; writer?: string; op?: string }; if (e.file === want && e.writer && e.op !== 'conflict') return e.writer } catch { /* 半行 */ } }
      } finally { closeSync(fd) }
    } catch { /* 没有 journal */ }
    return undefined
  }

  /** 会话事件已检查到哪：返回上次位置（第一次见 = undefined，只记下不回溯），并更新为 at。 */
  scannedTo(sid: string, at: number | undefined): number | undefined {
    if (at === undefined) return undefined
    const k = this.knownEntry(sid)
    const prev = k.seq
    if (prev !== at) { k.seq = at; this.saveKnown() }
    return prev
  }
  /** 会话发生了压缩：之前注入 / 读到的全文不算在上下文里了，下一步重新注入最新版。 */
  contextLost(sid: string): void {
    const k = this.known.get(sid)
    if (k) { k.files = {}; this.saveKnown() }
    this.seen.delete(sid)
  }

  /** 每步调用：会话卡片关联的 STATE 与 [必读] 子文档里，会话上下文还没有当前版本的 → 拼成一条消息返回（null = 都是最新）。 */
  autoRead(sid: string, turn: number, budget = AUTOREAD_BUDGET): string | null {
    if (!this.status.ok) return null
    const sc = this.deps.scope?.(sid)
    if (!sc) return null
    const kn = this.knownEntry(sid)
    const keys = [...sc.card, ...sc.group.filter((k) => !sc.card.includes(k))]
    const cands: Array<{ key: string; rel: string; path: string; f: FileInfo; prev?: string }> = []
    for (const key of keys) {
      const sp = this.statePath(key)
      const f = this.info(sp)
      if (!f || f.binary) continue
      const list = [{ rel: 'STATE.md', path: sp, f }]
      for (const rel of this.requiredOf(f.text ?? '')) { const p = join(this.dirOf(key), rel); const fi = this.info(p); if (fi && !fi.binary) list.push({ rel, path: p, f: fi }) }
      for (const x of list) if (kn.files[x.path] !== x.f.hash) cands.push({ key, ...x, ...(kn.files[x.path] ? { prev: kn.files[x.path] } : {}) })
    }
    if (!cands.length) return null
    const head = '[dsh-project-manager · 项目记忆全文] 以下是本会话卡片关联的落盘项目在磁盘上的最新全文（STATE + [必读] 子文档），由插件按当前版本注入，已计入本会话已读，落盘前不用再 recall 这些。带 replaces 的条目替代本会话之前看到的版本，以新版为准。本卡片的卡片档案以系统提示「卡片档案（实时）」为准。'
    const parts = [head]
    let used = head.length
    const owed: Owed[] = []
    for (const c of cands) {
      const text = c.f.text ?? ''
      const writer = c.prev ? this.lastWriter(c.key, c.rel) : undefined
      const tag = '<landfill-file key="' + c.key + '" file="' + c.rel + '" version="' + c.f.hash.slice(0, 8) + '" updated="' + new Date(c.f.mtime).toISOString() + '"' + (c.prev ? ' replaces="' + c.prev.slice(0, 8) + '"' : '') + (writer ? ' writer="' + writer + '"' : '') + '>'
      const body = (end: number): string => (c.rel === 'STATE.md' ? maskBlock(text, 0, end, sc.cardId) : text.slice(0, end))
      if (used + tag.length + text.length + 20 <= budget) {
        parts.push(tag + '\n' + body(text.length) + '\n</landfill-file>')
        used += tag.length + text.length + 20
        this.remember(sid, c.path, c.f.hash, text.length, [0, text.length])
        continue
      }
      const room = budget - used - tag.length - 300
      if (room > 4000) {
        const end = cutEnd(text, 0, room)
        parts.push(tag + '\n' + body(end) + '\n</landfill-file>')
        used = budget
        this.remember(sid, c.path, c.f.hash, text.length, [0, end])
        owed.push({ key: c.key, file: c.rel, next: end })
      } else owed.push({ key: c.key, file: c.rel, next: 0 })
    }
    if (owed.length) {
      parts.push('还没注入完（超出单次注入预算 ' + budget + ' 字符）：' + owed.map((o) => o.key + ' ' + o.file + ' offset=' + o.next).join('；') + '。用 landfill op=recall slug=<key>（子文档加 file=<file>）offset=<offset> 按 next 读完，读完前不要下结论。')
      this.owedOf.set(sid, { keys: [...new Set(owed.map((o) => o.key))], pulls: 0, turn })
    }
    return parts.join('\n\n')
  }

  /** 回合要结束时的拉回提示（null = 不拉）。plan = 会话在规划模式。 */
  nudge(sid: string | undefined, plan = false): string | null {
    if (!sid) return null
    const t = this.turnOf(sid)
    if (t) { const n = stopNudge(t, 2, plan); if (n) { t.pulls++; return n } }
    const o = this.owedOf.get(sid)
    if (!o || plan || t?.asked) return null
    const pend = o.keys.flatMap((k) => this.pending(sid, k))
    if (!pend.length) { this.owedOf.delete(sid); return null }
    if (o.pulls >= 2) return null
    o.pulls++
    return '[dsh-project-manager] 关联的落盘项目还有内容没读完：' + pend.slice(0, 10).map((p) => p.key + ' ' + p.file + ' offset=' + p.next).join('；') + '。用 landfill op=recall 按 next 读完再结束本轮。'
  }

  async append(s: ToolSession, file: unknown, text: unknown, project?: string): Promise<Record<string, unknown>> {
    if (typeof file !== 'string' || !/^[A-Za-z0-9._/-]+\.md$/.test(file) || file.split('/').includes('..')) throw new LandfillError('BAD_ARG', 'file 是项目 memory/ 下的相对 .md 路径（如 MEMORY_INDEX.md、notes/x.md）')
    if (typeof text !== 'string' || !text.trim()) throw new LandfillError('BAD_ARG', 'text 不能为空')
    const pid = await this.resolveProject(s, project)
    if (!pid) throw new LandfillError('UNREGISTERED', '认不出项目，请带 project 参数')
    const r = await this.run(['append', '--project', pid, '--file', file, '--stdin'], text)
    if (r.code !== 0) throw aiFailure(r, '追加 ' + pid + ':' + file + ' ')
    return JSON.parse(r.stdout) as Record<string, unknown>
  }

  async register(projectId: unknown, path: unknown, aliases: unknown, confirm: unknown): Promise<Record<string, unknown>> {
    const pid = checkName(projectId, 'projectId')
    if (typeof path !== 'string' || !path.startsWith('/')) throw new LandfillError('BAD_ARG', 'path 必须是项目根目录的绝对路径')
    const al = Array.isArray(aliases) ? aliases.map(String) : typeof aliases === 'string' && aliases ? aliases.split(',') : []
    // 项目区 / 卡片组目录是插件给会话用的工作目录，不是项目根目录（实测模型会把会话 cwd 当项目登记）
    let real = path
    try { real = realpathSync(path) } catch { /* 目录还不存在时按原值 */ }
    const hub = (() => { try { return realpathSync(join(this.paths.dataDir, 'hub')) } catch { return resolve(this.paths.dataDir, 'hub') } })()
    if (real === hub || real.startsWith(hub + sep)) throw new LandfillError('HUB_PATH', path + ' 是项目区的会话目录，不是项目根目录。用卡片挂的仓库的真实路径登记（会话目录里 repos/<仓库>/ 指向的地方）')
    // 同一个目录只能属于一个项目（ai-memory 本身不拦，重复登记后项目解析会按最长路径随机落到其中一个）
    const hit = await this.run(['path', '--cwd', path])
    if (hit.code === 0) {
      const cur = (JSON.parse(hit.stdout) as { project_id: string; canonical_path: string })
      if (resolve(cur.canonical_path) === resolve(path)) throw new LandfillError('PATH_REGISTERED', path + ' 已经登记为项目 ' + cur.project_id + '，直接用 project=' + cur.project_id, { projectId: cur.project_id })
    }
    if (confirm !== true) throw new LandfillError('NEED_CONFIRM', '登记新项目会写 ~/.ai/projects/REGISTRY.md：先把 projectId=' + pid + '、path=' + path + (al.length ? '、aliases=' + al.join(',') : '') + ' 给用户确认，用户同意后带 confirm:true 再调')
    const r = await this.run(['register', '--project-id', pid, '--canonical-path', path, ...(al.length ? ['--aliases', al.join(',')] : [])])
    if (r.code !== 0) throw aiFailure(r, '登记 ' + pid + ' ')
    return { projectId: pid, path, registered: true }
  }

  list(project?: string): Record<string, unknown> {
    const l = this.states.list().filter((x) => !project || x.project === project)
    return { count: l.length, states: l.slice(0, 200).map((x) => ({ key: x.key, updated: x.updated, status: x.status.slice(0, 120) })), ...(l.length > 200 ? { more: l.length - 200 } : {}) }
  }

  async validate(): Promise<Record<string, unknown>> {
    const r = await this.run(['validate'])
    if (r.code !== 0) throw aiFailure(r, '校验 ')
    return JSON.parse(r.stdout) as Record<string, unknown>
  }

  // ── 0.20 会话信息卡发起的落盘：跟踪这一轮的结局（完成 / 停止 / 出错 / 在问用户），信息卡据此更新 ──
  private runs = new Map<string, LfRun>()
  /** 信息卡发出「落盘项目 …」后登记（key = 已关联的 STATE；'' = 新建）。 */
  runStart(sid: string, key: string, label: string): LfRun { const r: LfRun = { key, label, at: Date.now(), state: 'busy' }; this.runs.set(sid, r); if (this.runs.size > 200) this.runs.delete(this.runs.keys().next().value as string); return r }
  runOf(sid: string): LfRun | undefined { return this.runs.get(sid) }
  runDismiss(sid: string): void { this.runs.delete(sid) }
  /** persist 成功（本会话）：信息卡发起的那一轮算写好了。 */
  private runDone(sid: string | undefined, key: string, was = key): void { const r = sid ? this.runs.get(sid) : undefined; if (r && r.state === 'busy' && (!r.key || [key, was].includes(r.key) || [key, was].includes(r.label))) Object.assign(r, { state: 'done', key, end: Date.now() }) }
  /** 会话的一轮结束（session/event turn/end）：信息卡发起的落盘还没写好 → 按结束原因标出来。asked = 这一轮最后在问用户。 */
  runTurnEnd(sid: string, reason: { kind?: string; error?: { message?: string } } | undefined, asked: boolean): void {
    const r = this.runs.get(sid)
    // 只认「发出的那条消息进了会话」之后的回合结束（错误回合 0.3 秒内就结束，不能按时间判断）
    if (!r || r.state !== 'busy' || !r.seen) return
    const k = reason?.kind
    if (k === 'completed') Object.assign(r, asked ? { state: 'ask' } : { state: 'nowrite' }, { end: Date.now() })
    else if (k === 'aborted' || k === 'interrupted') Object.assign(r, { state: 'stopped', end: Date.now() })
    else if (k === 'error') Object.assign(r, { state: 'error', end: Date.now(), error: String(reason?.error?.message ?? '未知错误').slice(0, 200) })
  }
  /** 会话里出现了用户消息：是信息卡发出的那条（含名字）→ 之后的回合结束才算这一轮的结局。 */
  runSeen(sid: string, text: string): void { const r = this.runs.get(sid); if (r && r.state === 'busy' && !r.seen && /落盘项目/.test(text) && (!r.label || text.includes(r.label) || text.includes(r.key))) r.seen = true }
  /** 用户回了 AI 的问题（新的一轮开始）：等回复 → 继续进行中。 */
  runTurnStart(sid: string): void { const r = this.runs.get(sid); if (r && (r.state === 'ask' || r.state === 'nowrite')) { r.state = 'busy'; r.at = Date.now(); delete r.end } }

  // ── 回合跟踪：pre-step 记下要求，工具 / read 标完成，turn-stopping 决定拉回 ──
  /** 记下本轮要求。上一轮同样的要求没完成 → streak+1；连续两轮被忽略、本轮又没点名项目 → quiet（不拉回）。 */
  begin(sid: string, turn: number, i: Intent, plan = false): TurnState {
    const prev = this.turns.get(sid)
    const streak = prev && prev.want === i.want && !prev.done ? (prev.turn === turn ? prev.streak ?? 0 : (prev.streak ?? 0) + 1) : 0
    const t: TurnState = { ...i, turn, done: false, pulls: 0, asked: false, streak, ...(plan ? { plan: true } : {}), ...(streak >= 2 && !i.keys.length ? { quiet: true } : {}) }
    this.turns.set(sid, t)
    if (this.turns.size > 300) this.turns.delete(this.turns.keys().next().value as string)
    return t
  }
  turnOf(sid: string | undefined): TurnState | undefined { return sid ? this.turns.get(sid) : undefined }
  mark(sid: string | undefined, want: Want, key?: string): void {
    const t = this.turnOf(sid)
    if (t && t.want === want && (want === 'persist' || !key || !t.keys.length || t.keys.includes(key))) t.done = true
  }
  /** 工具调用旁观：bash 里直接调 ai-memory 写、或者在问用户 → 记下（回忆只认 recall 读全：read 有行数上限会截断）。 */
  observe(sid: string | undefined, name: string, args: Record<string, unknown>): void {
    const t = this.turnOf(sid)
    if (!t || t.done) return
    if (name === 'ask_user_question') { t.asked = true; return }
    if (name === 'bash' && t.want === 'persist' && /\bai-memory\b[^\n]*\b(update-state|append|write|retire|import)\b/.test(String(args.command ?? ''))) t.done = true
  }
}
