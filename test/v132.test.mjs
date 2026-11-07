import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// v132（3）：真实 DSH 页面约 7400 个节点，插件样式里的 :has() 让任何 DOM 改动都整页重新匹配（样式重算 29ms → 0.48ms）
test('v132 S1: plugin styles ship zero :has() selectors (style.css + sidebar rowCss + JS-injected css)', () => {
  assert.equal((noComments(src('style.css')).match(/:has\(/g) || []).length, 0)
  for (const f of ['sidebar.ts', 'index.ts', 'board.ts', 'gantt.ts', 'goaltask.ts', 'gtextra.ts', 'dock.ts', 'entry.ts']) {
    const code = noComments(src(f))
    // 只管样式文本：querySelector / closest / matches 里的 :has 不会挂在页面样式表上
    const css = code.split('\n').filter((l) => /:has\(/.test(l) && !/querySelector|closest|matches\(/.test(l))
    assert.deepEqual(css, [], f)
  }
})

test('v132 S1: markers replacing :has() are set by JS', () => {
  const entry = src('entry.ts'), side = src('sidebar.ts'), idx = src('index.ts'), gantt = src('gantt.ts')
  for (const a of ['data-dpm-eb', 'data-dpm-on', 'data-dpm-sched', 'data-dpm-rail', 'data-dpm-ea']) assert.ok(entry.includes("'" + a + "'"), a)
  assert.match(side, /setAttribute\('data-dpm-ws', v\)/)
  assert.match(side, /toggleAttribute\('data-dpm-sw', on\)/)
  assert.match(idx, /addEventListener\('focusin', fin, true\)/)
  assert.match(gantt, /\(acts \? ' hasa' : ''\)/)
})
