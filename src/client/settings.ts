/**
 * v182：设置 → 项目看板（settings.section 贡献）；v185：界面语言四档 + 「译文状态」一行。
 *
 * 页面 = 原型 prototype/dsh-web-v185.html 那一页：标题 + 一行版本 + 一行「界面语言」四档下拉
 *        + 一块「译文状态」（语言 · 覆盖 / 总数 · 缺失 · 词典 v · 如何改进译文）+ 一句说明。
 * 四档 = 跟随 DSH（默认）/ 中文 / English / Русский；切换立刻生效、不刷新、不重建 DOM（见 client/i18n.ts）。
 * 页面文案自己按语言渲染（不等引擎）：它是「语言开关的宿主」，它自己必须立刻正确。
 * 宿主在跑旧代码（没有 i18n 路由 / 不认 prefs.lang / 没有该语言词典）→ 页面点名原因，不静默回退。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { ApiError } from './api.js'
import { dictSize, dictTotalSize, getDictErr, getDictState, getDictVersion, getLang, getMode, setMode, subscribe, tr, type Lang, type LangMode } from './i18n.js'

/** 页面上一行版本号（与 package.json 同步，test/v185 断言）。 */
export const VERSION = '0.80.0'

interface Copy {
  title: string
  lang: string
  desc: string
  auto: string
  zh: string
  en: string
  ru: string
  pinZh: string
  pinEn: string
  pinRu: string
  now: string
  moves: string
  covTitle: string
  covOf: string
  /** 源语言（中文）时的状态文案：没有译文这回事 */
  covSrc: string
  miss: string
  howto: string
  plain: string
  dead: string
}

/** 页面自渲染文案（zh / en / ru 三份）。俄语是本次新增，只影响这一页自己。 */
const COPY: Record<Lang, Copy> = {
  zh: {
    title: '项目看板', lang: '界面语言',
    desc: '这个插件的界面语言。默认跟随 DSH；也可以固定成中文、English 或 Русский —— 只影响这个插件：DSH 本身、其它插件、你的卡片和任务内容都不变。',
    auto: '跟随 DSH', zh: '中文', en: 'English', ru: 'Русский',
    pinZh: '固定中文', pinEn: '固定英文', pinRu: '固定俄语',
    now: '现在是 ', moves: ' · 跟着 DSH 语言走',
    covTitle: '译文状态', covOf: '条已译', covSrc: '源语言 · 无需译文', miss: '缺', howto: '如何改进译文',
    plain: '切了立刻生效，不用刷新；DSH 自己的语言设置照常对其它界面生效。',
    dead: '这门语言的词典还没加载：宿主在跑旧代码（重启 DSH 后可用），或包内缺 lib/i18n/ 词典。界面暂时按中文显示。',
  },
  en: {
    title: 'Project Board', lang: 'Interface language',
    desc: 'The interface language of this plugin. Default is “Follow DSH”; you can pin it to 中文, English or Русский. It only affects this plugin — the DSH shell, other plugins, and your cards, tasks and notes stay as they are.',
    auto: 'Follow DSH', zh: '中文', en: 'English', ru: 'Русский',
    pinZh: 'Pin to Chinese', pinEn: 'Pin to English', pinRu: 'Pin to Russian',
    now: 'now: ', moves: ' · moves with the DSH language',
    covTitle: 'Translation status', covOf: 'translated', covSrc: 'source language · no translation needed', miss: 'missing', howto: 'How to improve',
    plain: 'Nothing else changes: no reload, and the DSH language setting keeps working for everything outside this plugin.',
    dead: 'This language has no dictionary yet: the host is running old code (available after restarting DSH) or the package is missing lib/i18n/. The interface stays in Chinese for now.',
  },
  ru: {
    title: 'Доска проекта', lang: 'Язык интерфейса',
    desc: 'Язык интерфейса этого плагина. По умолчанию — как в DSH; можно закрепить 中文, English или Русский. Влияет только на этот плагин: сам DSH, другие плагины, ваши карточки и задачи не меняются.',
    auto: 'Следовать за DSH', zh: '中文', en: 'English', ru: 'Русский',
    pinZh: 'Закрепить 中文', pinEn: 'Закрепить English', pinRu: 'Закрепить Русский',
    now: 'сейчас: ', moves: ' · меняется вместе с языком DSH',
    covTitle: 'Словарь перевода', covOf: 'переведено', covSrc: 'исходный язык · перевод не нужен', miss: 'без перевода', howto: 'Как улучшить перевод',
    plain: 'Переключение действует сразу, без перезагрузки; язык DSH по-прежнему управляет остальным интерфейсом.',
    dead: 'Для этого языка ещё нет словаря: хост работает на старом коде (заработает после перезапуска DSH) или в пакете нет lib/i18n/. Пока интерфейс на китайском.',
  },
}

const OPTS: ReadonlyArray<{ id: LangMode }> = [{ id: 'auto' }, { id: 'zh' }, { id: 'en' }, { id: 'ru' }]

const CARET = 'M7 10l5 5 5-5'

/** 千分位（"4 612"）—— 覆盖率那一行要与原型一致。 */
const fmtNum = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

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
  const lang = getLang()
  const C = COPY[lang] ?? COPY.zh
  const dshLang: Lang = /^ru/i.test(document.documentElement.lang || '') ? 'ru' : /^en/i.test(document.documentElement.lang || '') ? 'en' : 'zh'
  const dshName = dshLang === 'ru' ? 'Русский' : dshLang === 'en' ? 'English' : '中文'
  const optName = (id: LangMode | Lang): string => (id === 'auto' ? C.auto : id === 'zh' ? C.zh : id === 'en' ? C.en : C.ru)
  const cur = optName(mode)
  // 旧宿主 / 缺词典：只有真的想要非中文时才点名 —— 跟随 DSH + DSH 中文的用户不该被打扰
  const wantDict = (mode !== 'auto' ? mode : dshLang) !== 'zh'
  const dictDead = getDictState() === 'dead' && wantDict
  const have = dictSize()
  const total = dictTotalSize()
  const pct = total > 0 ? Math.round((100 * have) / total) : 0

  const choose = (m: LangMode): void => {
    setOpen(false)
    setErr('')
    void setMode(m).catch((e) => setErr(e instanceof ApiError ? e.message : String(e)))
  }

  return h('div', { className: 'dpm-set', 'data-dpm-i18n': '' },
    h('h2', { className: 'dpm-set-h' }, tr('项目看板')),
    h('p', { className: 'dpm-set-lead' }, 'dsh-project-manager · ' + VERSION),
    h('div', { className: 'dpm-set-row' },
      h('div', { className: 'dpm-set-lb' }, C.lang),
      h('div', { className: 'dpm-set-ds' }, C.desc),
      h('div', { className: 'dpm-set-ct' },
        h('div', { className: 'dpm-set-selbox', ref: box },
          h('button', {
            type: 'button',
            className: 'dpm-set-sel',
            'aria-haspopup': 'listbox',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => setOpen((v) => !v),
          }, h('span', null, cur), h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', className: 'dpm-set-caret' }, h('path', { d: CARET }))),
          open ? h('div', { className: 'dpm-set-menu', role: 'listbox' },
            OPTS.map((o) => {
              const label = optName(o.id)
              const desc = o.id === 'auto'
                ? C.now + dshName + C.moves
                : o.id === 'zh' ? C.pinZh : o.id === 'en' ? C.pinEn : C.pinRu
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
    // v185：译文状态（只读信息块 —— 让「缺 N 条」可见：用户能报，维护者能查）
    h('div', { className: 'dpm-set-cov', 'data-dpm-cov': lang },
      h('div', { className: 'dpm-set-cov-h' },
        h('b', null, C.covTitle),
        h('span', null, lang === 'zh'
          ? optName('zh') + ' · ' + C.covSrc
          : optName(lang) + ' · ' + fmtNum(have) + ' / ' + fmtNum(total) + ' ' + C.covOf + ' · ' + pct + '%')
      ),
      h('div', { className: 'dpm-set-cov-b' },
        lang === 'zh' ? null : h('span', null, C.miss + ': ' + fmtNum(Math.max(0, total - have))),
        lang === 'zh' ? null : h('span', { className: 'dpm-set-cov-v' }, 'v=' + (getDictVersion() || '—')),
        h('a', { className: 'dpm-set-cov-a', href: 'https://github.com/hoyyang/dsh-project-manager#translations', target: '_blank', rel: 'noreferrer' }, C.howto)
      )
    ),
    h('p', { className: 'dpm-set-plain' }, C.plain),
    dictDead ? h('p', { className: 'dpm-set-warn' }, C.dead + (getDictErr() ? ' (' + getDictErr() + ')' : '')) : null,
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
