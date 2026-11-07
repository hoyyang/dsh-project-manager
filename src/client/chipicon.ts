/**
 * v153：引用内容卡片按钮的「类型图标」—— 全站一套。
 * 任务说明框 / 详情气泡里的胶囊（插件自己画的 <span class="ri">）直接用 chipIconSvg()；
 * DSH 对话框里的胶囊是宿主 DOM（不能加子元素），把 chipIconId() 的结果打在 data-dpm-ic 上，
 * 由 composer.ts 注入的 CSS mask 画出来 —— 两处字形同源（icons.ts 的同一份 path）。
 */
import { FT_CATS, FT_EXTS } from './ftype.gen.js'
import { ic } from './icons.js'

const FT = new Map<string, number>()
FT_EXTS.forEach((l, i) => { for (const x of l.split(' ')) if (x) FT.set(x, i) })

/** 文件按扩展名取图标 id（图片 / 视频 / 音频 / 代码 / 数据 / 文档 / 表格 / 演示 / 压缩包 / 日志 / 安装包 / 字体 / 设计稿），认不出 = file。 */
export function fileTypeIcon(p: string): string {
  const m = /\.([^./\\]+)$/.exec(p.replace(/[/\\]+$/, ''))
  const ext = m ? m[1].toLowerCase() : ''
  const i = ext ? FT.get(ext) : undefined
  return i === undefined ? 'file' : FT_CATS[i][1]
}

/** 引用类型 → 图标 id（icons.ts 的 P 表 key）。 */
export function chipIconId(kind: string, body = ''): string {
  if (kind === 'file') return fileTypeIcon(body)
  if (kind === 'repo' || kind === 'dir' || kind === 'folder') return 'folder'
  if (kind === 'card') return 'cards'
  if (kind === 'sess') return 'chat'
  if (kind === 'link') return 'link'
  if (kind === 'note') return 'note'
  return 'file'
}

/** 说明框 / 气泡窗胶囊里的图标（真 SVG）。 */
export const chipIconSvg = (kind: string, body = ''): string => ic(chipIconId(kind, body))
