/**
 * v185：界面词典（host 侧唯一出口）—— en / ru 各一份，按语言读一次（ESM 单例 memo，无模块级副作用）。
 *
 * 词典 = scripts/gen-i18n.mjs --lang <code> 由 locales/ + scripts/i18n-overrides.<code>.json + scripts/i18n-protect.json
 * 生成到 lib/i18n/<code>.json，只在这里按需读一次。client 不内联它（体积），走 GET /i18n?lang= 按需投递
 * + 浏览器 localStorage 缓存（按语言 + v）。
 *
 * 读不到（旧包 / 文件被删）就返回 null，路由回 404，界面回退中文并在设置页点名原因（不静默）。
 * 注意：**缺词典一律回退中文**，不回退英文 —— 用户选的是 Русский，给他英文是另一种错。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Dict { v: string; dict: Record<string, string>; /** 该语言的键空间总数（覆盖率分母；老词典没有这一项 */ total?: number }
/** v185：可用的界面词典语言（zh 是源语言，不需要词典）。 */
export type DictLang = 'en' | 'ru'
export const DICT_LANGS: readonly DictLang[] = ['en', 'ru']

const cache = new Map<DictLang, Dict>()
const tried = new Set<DictLang>()

/** 读一份词典（成功后再调直接给缓存；失败不缓存失败结果 —— 重装 / 重新构建后重试时才可能变好）。 */
export function loadDict(lang: DictLang = 'en'): Dict | null {
  const hit = cache.get(lang)
  if (hit) return hit
  if (tried.has(lang)) return null
  tried.add(lang)
  const file = join(dirname(fileURLToPath(import.meta.url)), 'i18n', lang + '.json')
  if (!existsSync(file)) {
    console.warn('[dsh-project-manager] ' + lang + ' 词典缺失（' + file + '）—— 界面语言会回退中文；重新 npm i / 重新构建可恢复')
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Dict
    if (!raw || typeof raw.v !== 'string' || !raw.dict || typeof raw.dict !== 'object') {
      console.warn('[dsh-project-manager] ' + lang + ' 词典格式不对（缺 v / dict）：' + file)
      return null
    }
    cache.set(lang, raw)
    return raw
  } catch (e) {
    console.warn('[dsh-project-manager] ' + lang + ' 词典读取失败：', e)
    return null
  }
}
