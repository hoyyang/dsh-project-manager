// 把 src/client/style.css 生成为 TS 字符串模块（避免为打包 CSS 引入额外依赖）。
import { readFileSync, writeFileSync } from 'node:fs'
const css = readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8')
writeFileSync(new URL('../src/client/style.gen.ts', import.meta.url), '// 由 scripts/gen-css.mjs 生成，请改 style.css\nexport const CSS = ' + JSON.stringify(css) + '\n')
