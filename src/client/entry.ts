/**
 * 全局面板「项目看板」主按钮的图标块（原型 v15-panel2）。
 * 行（button）由宿主 dsh-client-ui-sidebar 画，插件经 sidebar.panellist 只给图标组件：
 *  - .dpm-entry 本身是行内的图标块；整行渐变 / 浮起 / 选中态由 style.css 里 button[data-dpm-eb] 规则给宿主行加（v132：组件挂载时给宿主行打 data-dpm-eb / -on / -sched / -rail，
 *    行到图标块之间的每层打 data-dpm-ea —— 不再用 has 选择器，宿主页面任何 DOM 改动都不用整页重新匹配；失效 = 普通图标行）；
 *  - 光效层（流光边框 / 跟随光晕 / 高光 / 波纹）与「N 进行中」徽标从图标块里绝对定位铺满整行（宿主行由同一条 CSS 设为 position:relative）。
 * 动效只在状态变化时播一次（悬停 / 点击 / 进入看板），不循环；prefers-reduced-motion 下全部关闭。
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import type { Snapshot } from './api.js'

/** 0.19 进行中 = 没归档、且至少有 1 个没归档会话（不算子代理；会话已删除的不算）的卡片。live(id) = 会话存在且没归档。 */
export function doingCount(b: Snapshot['board'], live: (sessionId: string) => boolean): number {
  const busy = new Set(b.sessions.filter((s) => live(s.sessionId)).map((s) => s.cardId))
  return b.cards.filter((c) => !c.archivedAt && busy.has(c.id)).length
}
export const DOING_TIP = '进行中 = 没归档、且至少有 1 个没归档会话的卡片（会话归档 / 恢复、卡片归档 / 恢复后立刻刷新）'

const GLYPH = '<svg class="pgi" viewBox="0 0 24 24" aria-hidden="true"><rect class="b1" x="3.5" y="4" width="4.5" height="15" rx="2.25"/><rect class="b2" x="9.75" y="4" width="4.5" height="10" rx="2.25"/><rect class="b3" x="16" y="4" width="4.5" height="12.5" rx="2.25"/><rect class="drop" x="10.6" y="15.6" width="2.8" height="3.2" rx="1.1"/></svg>'

interface PanelEntryProps { active: boolean; compact: boolean; count: number; suffix: string; glyph: string; variant?: string }
/** 项目看板 / 任务日程看板共用一套行内结构：光效层 + 徽标 + 图标块（任务日程只换颜色 / 图标 / 徽标文案）。 */
function PanelEntry(p: PanelEntryProps): ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null)
  const was = useRef(p.active)
  // 宿主行：光晕跟随鼠标、点击处波纹位置（监听挂在宿主行上，组件卸载即移除）
  useEffect(() => {
    const row = ref.current?.closest('button')
    if (!row) return
    const move = (e: PointerEvent): void => { const r = row.getBoundingClientRect(); row.style.setProperty('--dpm-mx', (e.clientX - r.left) + 'px'); row.style.setProperty('--dpm-my', (e.clientY - r.top) + 'px') }
    const down = (e: PointerEvent): void => { const r = row.getBoundingClientRect(); row.style.setProperty('--dpm-rx', (e.clientX - r.left) + 'px'); row.style.setProperty('--dpm-ry', (e.clientY - r.top) + 'px') }
    row.addEventListener('pointermove', move, { passive: true })
    row.addEventListener('pointerdown', down, { passive: true })
    return () => { row.removeEventListener('pointermove', move); row.removeEventListener('pointerdown', down); for (const k of ['--dpm-mx', '--dpm-my', '--dpm-rx', '--dpm-ry']) row.style.removeProperty(k) }
  }, [])
  // v132（3）：宿主行打属性（代替 has 选择器）；先于绘制打上，第一帧就带样式
  useLayoutEffect(() => {
    const el = ref.current
    const row = el?.closest('button')
    if (!el || !row) return
    const chain: HTMLElement[] = []
    for (let n = el.parentElement; n && n !== row; n = n.parentElement) chain.push(n)
    row.setAttribute('data-dpm-eb', '')
    row.toggleAttribute('data-dpm-on', p.active)
    row.toggleAttribute('data-dpm-sched', p.variant === 'sched')
    row.toggleAttribute('data-dpm-rail', p.compact)
    for (const n of chain) n.setAttribute('data-dpm-ea', '')
    return () => { for (const k of ['data-dpm-eb', 'data-dpm-on', 'data-dpm-sched', 'data-dpm-rail']) row.removeAttribute(k); for (const n of chain) n.removeAttribute('data-dpm-ea') }
  }, [p.active, p.compact, p.variant])
  // 进入页面那一下播一次「波纹 + 落卡片 + 高光 + 徽标弹」（重新挂 fx 类以重播）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (p.active && !was.current) { el.classList.remove('fx'); void el.offsetWidth; el.classList.add('fx') }
    if (!p.active) el.classList.remove('fx')
    was.current = p.active
  }, [p.active])
  // v90：「任务日程看板」的徽标与日程页页头「共 N 组 · M 项」同一个数 —— 口径 = 日程列表里实际列出的项目行
  //（待排队 pending 不列、归档默认不列），随搜索与「显示已归档」变。
  const badgeTitle = p.suffix === '进行中' ? p.count + ' 张卡片进行中。' + DOING_TIP
    : p.variant === 'sched' ? p.count + ' 个项目 · 与任务日程看板页头「共 N 组 · M 项」同一个数（日程列表里实际列出的项目：待排队不列、归档默认不列，随筛选变）'
      : p.count + ' 个未归档项目'
  return h('span', { ref, className: 'dpm-entry' + (p.variant ? ' ' + p.variant : '') + (p.compact ? ' rail' : ''), 'data-active': String(p.active), 'aria-hidden': 'true' },
    h('span', { className: 'hfx' }, h('span', { className: 'rim' }), h('span', { className: 'spot' }), h('span', { className: 'sheen' }), h('span', { className: 'ripple' })),
    p.count > 0 ? h('span', { className: 'hbadge', title: badgeTitle }, h('i'), String(p.count), h('span', { className: 'hl' }, ' ' + p.suffix)) : null,
    h('span', { className: 'pgw' }, h('span', { className: 'pg', dangerouslySetInnerHTML: { __html: p.glyph } })))
}

export function BoardEntry(p: { active: boolean; compact: boolean; count: number }): ReactElement {
  return h(PanelEntry, { active: p.active, compact: p.compact, count: p.count, suffix: '进行中', glyph: GLYPH })
}

/** 0.32 「任务日程看板」：与项目看板同一套结构 / 动效，只换紫色 + 日历图标 + 项目数徽标。 */
const SCHED_GLYPH = '<svg class="pgi" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect class="sb" x="7" y="12" width="8.5" height="2.8" rx="1.4"/><path d="M17.8 11.6v6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
export function SchedEntry(p: { active: boolean; compact: boolean; count: number }): ReactElement {
  return h(PanelEntry, { active: p.active, compact: p.compact, count: p.count, suffix: '项目', glyph: SCHED_GLYPH, variant: 'sched' })
}
