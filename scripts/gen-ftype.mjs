// 构建期生成相关文件的类型表（扩展名 → 13 类）：mime-db（媒体类型，MIT）+ GitHub linguist languages（编程语言扩展名，MIT）+ 小覆盖表。
// 产物 src/client/ftype.gen.ts 打进插件，运行时不依赖这两个包。
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mime = require('mime-db')
const ling = Object.values((await import('linguist-languages')).default ?? (await import('linguist-languages')))
// 顺序 = 类型 id（0 起）；图标名对应 src/client/icons.ts
const CATS = [['图片', 'img'], ['视频', 'video'], ['音频', 'audio'], ['代码', 'code'], ['数据', 'data'], ['文档', 'doc'], ['表格', 'sheet'], ['演示', 'slides'], ['压缩包', 'archive2'], ['日志', 'log'], ['安装包', 'pkg'], ['字体', 'font'], ['设计稿', 'design']]
const id = (label) => CATS.findIndex((c) => c[0] === label)
const map = new Map()
const put = (ext, label) => { const e = ext.replace(/^\./, '').toLowerCase(); if (/^[a-z0-9_+-]{1,12}$/.test(e)) map.set(e, id(label)) }
// 1) linguist：programming / markup = 代码，data = 数据，prose = 文档
for (const l of ling) for (const x of l.extensions ?? []) put(x, l.type === 'data' ? '数据' : l.type === 'prose' ? '文档' : '代码')
// 2) mime-db 媒体类型（覆盖 linguist：媒体扩展名更常见）
for (const [k, v] of Object.entries(mime)) { const m = /^(image|video|audio|font)\//.exec(k); if (m && v.extensions) for (const x of v.extensions) put(x, { image: '图片', video: '视频', audio: '音频', font: '字体' }[m[1]]) }
// 3) 覆盖表：办公文档 / 压缩包 / 安装包 / 日志 / 设计稿，以及冲突（.ts 按代码、.svg 按图片……）
const OVR = {
  图片: 'png jpg jpeg gif webp heic heif bmp tif tiff svg ico avif',
  视频: 'mp4 mov m4v avi mkv webm flv wmv 3gp',
  音频: 'mp3 wav m4a aac flac ogg opus amr',
  代码: 'ts tsx mts cts js mjs cjs jsx java kt kts py c h cc cpp hpp m mm swift go rs rb php cs scala dart lua sh bash zsh sql gradle vue svelte html htm css scss less aidl smali',
  数据: 'json jsonl yaml yml xml toml ini properties plist proto conf har hprof',
  文档: 'md markdown txt pdf doc docx rtf pages odt epub',
  表格: 'xls xlsx csv tsv numbers ods',
  演示: 'ppt pptx key odp',
  压缩包: 'zip tar gz tgz bz2 xz 7z rar zst',
  日志: 'log',
  安装包: 'apk aab ipa dmg pkg exe msi deb rpm',
  字体: 'ttf otf woff woff2',
  设计稿: 'fig sketch psd ai xd',
}
for (const [label, exts] of Object.entries(OVR)) for (const x of exts.split(' ')) put(x, label)
const by = CATS.map(() => [])
for (const [e, i] of [...map].sort()) by[i].push(e)
const out = '// 由 scripts/gen-ftype.mjs 生成（mime-db + linguist-languages + 覆盖表），请改脚本\n'
  + 'export const FT_CATS: ReadonlyArray<readonly [string, string]> = ' + JSON.stringify(CATS) + '\n'
  + 'export const FT_EXTS: readonly string[] = ' + JSON.stringify(by.map((l) => l.join(' '))) + '\n'
writeFileSync(new URL('../src/client/ftype.gen.ts', import.meta.url), out)
console.log('ftype: ' + map.size + ' 个扩展名')
