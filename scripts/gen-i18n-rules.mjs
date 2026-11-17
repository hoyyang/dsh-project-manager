/**
 * 生成 src/client/i18n.rules.ts（界面文案的动态模板）。
 *
 * 数据在 scripts/i18n-rules.json：[pattern, flags, 英文模板($1..$9)]。
 * 前 86 条 = 原型 prototype/dsh-web-v182.html 里逐条核对过的 RULES；
 * 后面 = 产品 DOM 与原型不同的地方补的（数字被拆成独立 <b> 节点、aria-label 里带变量等）。
 * 顺序有意义：先具体后笼统，命中即返回。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rules = JSON.parse(readFileSync(join(ROOT, 'scripts/i18n-rules.json'), 'utf8'))
const lines = rules.map(([src, flags, out]) => '  R(' + JSON.stringify(src) + ', ' + JSON.stringify(out) + (flags ? ', ' + JSON.stringify(flags) : '') + '),')
const body = `/**
 * v182：带动态值的界面文案模板（词典只命中整句，拼出来的句子走这里）。
 *
 * 由 scripts/gen-i18n-rules.mjs 生成，别手改；要加规则改 scripts/i18n-rules.json。
 * 前 86 条来自原型 prototype/dsh-web-v182.html（中英两态逐条比对过），
 * 后面是产品 DOM 与原型不同之处补的（数字在独立 <b> 里、aria-label / title 带变量）。
 */
const R = (pattern: string, out: string, flags?: string): readonly [RegExp, string] => [new RegExp(pattern, flags), out]

export const RULES: ReadonlyArray<readonly [RegExp, string]> = [
${lines.join('\n')}
]
`
writeFileSync(join(ROOT, 'src/client/i18n.rules.ts'), body)
console.log('[gen-i18n-rules] ' + rules.length + ' 条 · ' + body.length + ' B')
