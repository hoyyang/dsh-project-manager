/**
 * v185：把外部 PR #3（俄语贡献者 mckeym9-art）的译文当**清洗底稿**导入 locales/ru.json。
 *
 * 为什么只导"能精确对上"的：PR #3 锚定 0.20.1 的字符串集，v182 之后界面全部重做，
 * 直接灌进去会出现"译文对不上原文"的脏数据。做法 = 按 0.79.0 的 locales/zh-CN.json 反查：
 *   PR #3 的 {zh, ru} 里，zh 必须**逐字**等于当前 zh-CN.json 的某个值 → 才写进 locales/ru.json（键 = t_key）。
 * 命中率与未命中明细写进报告（默认 lib 之外，不入发布包）：scripts/.pr3-import-report.json。
 *
 * 用法：node scripts/import-pr3-ru.mjs [--src=/path/to/pr3] [--dry]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const args = process.argv.slice(2)
const srcArg = (args.find((a) => a.startsWith('--src=')) || '').split('=')[1]
const SRC = srcArg || '/tmp/pr3'
const dry = args.includes('--dry')

const zh = read(join(ROOT, 'locales/zh-CN.json'))
const protect = new Set((read(join(ROOT, 'scripts/i18n-protect.json')).list || []))
const byText = new Map()
for (const [key, text] of Object.entries(zh)) if (typeof text === 'string' && !byText.has(text)) byText.set(text, key)

const entries = []
const clientFile = join(SRC, 'i18n/ru/strings-client.json')
if (existsSync(clientFile)) entries.push(...(read(clientFile).entries || []))
const hostDir = join(SRC, 'i18n/ru')
if (existsSync(hostDir)) {
  for (const f of readFileSync ? [] : []) { /* noop for lint */ }
}
import('node:fs').then(({ readdirSync }) => {
  if (existsSync(hostDir)) {
    for (const f of readdirSync(hostDir)) {
      if (!f.startsWith('strings-host') || !f.endsWith('.json')) continue
      entries.push(...(read(join(hostDir, f)).entries || []))
    }
  }
  const uniq = new Map()
  for (const e of entries) if (e && typeof e.zh === 'string' && typeof e.ru === 'string' && !uniq.has(e.zh)) uniq.set(e.zh, e.ru)

  const out = {}
  const meta = {}
  const hit = []
  const miss = []
  let skipped = 0
  for (const [z, ru] of uniq) {
    const key = byText.get(z)
    if (!key) { if (miss.length < 5000) miss.push(z.slice(0, 120)); continue }
    if (protect.has(z)) { skipped++; continue }
    out[key] = ru
    meta[key] = { zhHash: createHash('sha1').update(z).digest('hex').slice(0, 12), src: 'pr3' }
    hit.push(z.slice(0, 120))
  }
  const report = {
    source: 'PR hoyyang/dsh-project-manager#3 (mckeym9-art)',
    importedAt: new Date().toISOString(),
    catalogs: { entries: entries.length, unique: uniq.size },
    matched: Object.keys(out).length,
    unmatched: uniq.size - Object.keys(out).length - skipped,
    protectedSkipped: skipped,
    missSample: miss.slice(0, 40),
  }
  if (!dry) {
    writeFileSync(join(ROOT, 'locales/ru.json'), JSON.stringify(out, null, 1) + '\n')
    writeFileSync(join(ROOT, 'locales/.loc-meta.ru.json'), JSON.stringify(meta, null, 1) + '\n')
    writeFileSync(join(ROOT, 'scripts/.pr3-import-report.json'), JSON.stringify(report, null, 1) + '\n')
  }
  console.log('[import-pr3-ru] 目录 ' + SRC + ' · 条目 ' + entries.length + '（唯一 ' + uniq.size + '）→ 命中 ' + report.matched + ' · 未命中 ' + report.unmatched + ' · 保护清单跳过 ' + skipped + (dry ? ' · DRY' : ' · 已写 locales/ru.json'))
})
