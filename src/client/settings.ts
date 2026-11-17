/**
 * v182：设置 → 项目看板（settings.section 贡献）。
 *
 * 页面就是原型 prototype/dsh-web-v182.html 那一页：标题 + 一行版本 + 一行「界面语言」三档下拉 + 一句说明。
 * 三档 = 跟随 DSH（默认）/ 中文 / English；切换立刻生效、不刷新、不重建 DOM（见 client/i18n.ts）。
 * 宿主在跑旧代码（没有 i18n 路由 / 不认 prefs.lang）→ 页面点名「重启后可用」，不静默回退。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ApiError } from './api.js'
import { getDictState, getLang, getMode, setMode, subscribe, tr, type LangMode } from './i18n.js'

/** 页面上一行版本号（与 package.json 同步，test/v182 断言）。 */
export const VERSION = '0.79.0'

const OPTS: ReadonlyArray<{ id: LangMode; label: string; desc: string }> = [
  { id: 'auto', label: '跟随 DSH', desc: '' },
  { id: 'zh', label: '中文', desc: '固定中文' },
  { id: 'en', label: 'English', desc: '固定英文' },
]

const CARET = 'M7 10l5 5 5-5'

type Slots = {
  inject(name: string, fn: () => () => void): () => void
  register(opts: Record<string, unknown>, comp: unknown): () => void
}

/** 页面本体（React）。语言 / 词典状态变了就重画；文案本身交给引擎，这里只管结构。 */
export function SettingsSection(): unknown {
  const [, bump] = useState(0)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  // 点外面收起下拉（settings 弹窗自己的 click 不算：只认下拉外）
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      const t = e.target as Element | null
      if (t && box.current && !t.closest('.dpm-set-ct')) setOpen(false)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])

  const mode = getMode()
  const en = getLang() === 'en'
  const dshName = /^en/i.test(document.documentElement.lang || '') ? 'English' : '中文'
  // 旧宿主（没有 i18n 接口）：只有「真的想要英文」时才点名 —— 跟随 DSH + DSH 中文的用户不该被打扰
  const wantEn = mode === 'en' || (mode === 'auto' && /^en/i.test(document.documentElement.lang || ''))
  const dictDead = getDictState() === 'dead' && wantEn
  const cur = mode === 'auto' ? tr('跟随 DSH') : mode === 'en' ? 'English' : '中文'

  const choose = (m: LangMode): void => {
    setOpen(false)
    setErr('')
    void setMode(m).catch((e) => setErr(e instanceof ApiError ? e.message : String(e)))
  }

  return h('div', { className: 'dpm-set', 'data-dpm-i18n': '' },
    h('h2', { className: 'dpm-set-h' }, tr('项目看板')),
    h('p', { className: 'dpm-set-lead' }, 'dsh-project-manager · ' + VERSION),
    h('div', { className: 'dpm-set-row' },
      h('div', { className: 'dpm-set-lb' }, tr('界面语言')),
      h('div', { className: 'dpm-set-ds' }, tr('这个插件的界面语言。默认跟随 DSH；也可以固定成中文或 English —— 只影响这个插件：DSH 本身、其它插件、你的卡片和任务内容都不变。')),
      h('div', { className: 'dpm-set-ct' },
        h('div', { className: 'dpm-set-selbox' },
          h('button', {
            type: 'button',
            className: 'dpm-set-sel',
            'aria-haspopup': 'listbox',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => setOpen((v) => !v),
          }, h('span', null, cur), h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', className: 'dpm-set-caret' }, h('path', { d: CARET }))),
          open ? h('div', { className: 'dpm-set-menu', role: 'listbox' },
            OPTS.map((o) => {
              const label = o.id === 'auto' ? tr('跟随 DSH') : o.label
              const desc = o.id === 'auto'
                ? (en ? 'now: ' + dshName + ' · moves with the DSH language' : '现在是 ' + dshName + ' · 跟着 DSH 语言走')
                : tr(o.desc)
              return h('button', {
                type: 'button',
                role: 'option',
                'aria-selected': mode === o.id ? 'true' : 'false',
                className: 'dpm-set-opt' + (mode === o.id ? ' on' : ''),
                'data-lang': o.id,
                onClick: () => choose(o.id),
              },
              h('span', { className: 'dpm-set-optt' }, h('b', null, label), h('small', null, desc)),
              mode === o.id ? h('span', { className: 'dpm-set-ok', 'aria-hidden': 'true' }, '✓') : null)
            })
          ) : null
        )
      )
    ),
    h('p', { className: 'dpm-set-plain' }, tr('切了立刻生效，不用刷新；DSH 自己的语言设置照常对其它界面生效。')),
    dictDead ? h('p', { className: 'dpm-set-warn' }, tr('英文词典要重启 DSH 才有：宿主还在跑旧代码，没加载 i18n 接口。重启后再回这一页选一次即可。')) : null,
    err ? h('p', { className: 'dpm-set-warn' }, err) : null
  )
}

/**
 * 注册 settings.section 贡献。
 * 语言变了要重新注册：导航项文案由宿主渲染（label 回调），不重注册就还停在旧语言。
 */
export function installSettings(ctx: { effect(fn: () => (() => void) | void, label?: string): void; slots: Slots }): void {
  ctx.effect(() => {
    let off: (() => void) | null = null
    const mount = (): void => {
      off?.()
      off = null
      off = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'project-board',
        order: 30,
        label: () => tr('项目看板'),
      }, SettingsSection))
    }
    mount()
    // 生效语言变了（含「跟随 DSH」时 DSH 改语言）就重注册 —— 导航项文案由宿主渲染，只能靠重注册换字
    let last = getLang()
    const stopSub = subscribe(() => {
      const now = getLang()
      if (now === last) return
      last = now
      mount()
    })
    return () => { stopSub(); off?.(); off = null }
  }, 'dsh-project-manager: settings section')
}
