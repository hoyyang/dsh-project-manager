/* 0.79.0 发布前真机补丁：英文首屏侧栏入口 / 卡片详情会话胶囊 / 相关说明计数 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('词典首次到手要重挂侧栏入口（否则英文首屏入口停在中文）', () => {
  const src = read('src/client/i18n.ts')
  const body = src.slice(src.indexOf('export async function loadDict'), src.indexOf('// ── 语言生效'))
  assert.match(body, /const fresh = !dict \|\| r\.v !== dictV/)
  assert.match(body, /if \(fresh\) notifyLang\(\)/)
})

test('卡片详情会话胶囊按内容撑宽（英文「Session not started」不压住会话名）', () => {
  const css = read('src/client/style.css')
  const line = css.split('\n').find((l) => l.startsWith('.dpm .detail .srow .chip {'))
  assert.ok(line, '缺 .srow .chip 规则')
  assert.match(line, /min-width: 76px/)
  assert.doesNotMatch(line, /[^-]width: 76px/)
})

test('「相关说明 · N」有英文模板', () => {
  const rules = JSON.parse(read('scripts/i18n-rules.json'))
  const r = rules.find((x) => x[0] === '^相关说明 · (\\d+)$')
  assert.ok(r, '缺规则')
  assert.equal('相关说明 · 3'.replace(new RegExp(r[0]), r[2].replace('$1', '3')), 'Notes · 3')
})
