import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8')
const idx = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
test('v135 图标栏：3/4 宽度只作用于展开态、收起态让出今天胶囊', () => {
  assert.match(css, /button\[data-dpm-eb\]\[data-dpm-sched\]:not\(\[data-dpm-rail\]\) \{ width: calc/)
  assert.match(css, /button\[data-dpm-eb\]\[data-dpm-sched\]\[data-dpm-rail\] \{ margin-bottom: 24px !important; \}/)
  assert.ok(!/data-dpm-rail\] \{[^}]*background: transparent !important/.test(css), '图标栏不再抹平底色（反色）')
  assert.match(css, /\.dpm-today\.rail \{[^}]*font-size: 10px; font-weight: 600/)
})
test('v135 今天按钮：图标栏分支 + 气泡 + 卸载清理', () => {
  assert.match(idx, /row\.hasAttribute\('data-dpm-rail'\)/)
  assert.match(idx, /Math\.round\(r\.bottom \+ 4\)/)
  assert.match(idx, /btn\.remove\(\); tip\.remove\(\)/)
  assert.match(idx, /aria-describedby', 'dpmTodayTip'/)
})
test('v135 修：侧栏开合时今天按钮逐帧跟随 + 按侧栏列裁剪', () => {
  assert.match(idx, /const follow = \(\): void =>/)
  assert.match(idx, /fol = still < 8 \? requestAnimationFrame\(tick\) : 0/)
  assert.match(idx, /btn\.style\.clipPath = cp/)
  assert.match(idx, /addEventListener\('transitionrun', onTs, true\)/)
  assert.match(idx, /fmo\.disconnect\(\); mo\.disconnect\(\)/)
})
