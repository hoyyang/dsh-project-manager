/* v183：执行安排实时同步 / 排今天→已安排 / 已安排补当日不安排 / 项目卡对齐 / 应用内选文件夹 / 仓库弹窗重排 / 关联会话行复用会话状态胶囊 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const SRC = (p) => readFileSync(new URL('../src/client/' + p, import.meta.url), 'utf8')
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('v183 1.1：对账去掉 board.sessions 闸、兜底 800ms、节流 700ms、前台补一次', () => {
  const s = SRC('index.ts')
  assert.ok(!s.includes('if (!snap.board.sessions.some((r) => r.sessionId === sid)) continue'), '还在用 board.sessions 当闸门')
  assert.ok(s.includes('700') && s.includes('setInterval(soon, 800)'), '节流 / 兜底没改')
  assert.ok(s.includes("document.addEventListener('visibilitychange', onVis)"), '前台回来没补对账')
})

test('v183 1.2：scheduleKeys 支持 zone，默认 arr，落最后一行、满 2 张新开', () => {
  const s = SRC('gtextra.ts')
  assert.ok(s.includes('export type ScheduleZone'), '没有 ScheduleZone')
  assert.ok(s.includes("const zone: ScheduleZone = o?.zone ?? 'arr'"), '缺省不是 arr')
  assert.ok(s.includes('patch.lanes = lanes') && s.includes('last.length >= 2'), '没有落最后一行 / 满 2 新开')
  const b = SRC('board.ts'), i = SRC('index.ts')
  assert.ok(b.includes('已排今天：直接进了今天的「已安排」'), '看板 toast 没改口径')
  assert.ok(i.includes('已排今天：直接进了今天的「已安排」'), '详情 toast 没改口径')
})

test('v183 1.3：已安排卡片有 unsel，文案按来源分区', () => {
  const s = SRC('gantt.ts')
  assert.ok(/pActBtn\('unsel', l\.key, '当日不安排「' \+ l\.title \+ '」：从已安排移除/.test(s), '已安排没加当日不安排')
  assert.ok(s.includes('const v183src = pZoneOf(u, k, key)'), 'unsel 没记来源分区')
  assert.ok(s.includes("已从' + (EXZ_T[v183src] || '今天') + '移除"), 'unsel 文案没按来源写')
})

test('v183 1.4：项目卡渲染不可见勾选圈占位，nock 不再吃掉那一列', () => {
  const s = SRC('gantt.ts')
  assert.ok(s.includes('eck ph'), '项目卡没有占位')
  assert.ok(s.includes("l.level === 'p' ? ' nock' : ''"), 'nock 判定没改')
  assert.ok(/\+ '<span class="exck">' \+ ck \+ '<\/span>'/.test(s), 'exck 不是始终渲染')
  const css = SRC('style.css')
  assert.ok(css.includes('.dpm .sched #exBody .exi.nock:not(.hx-sq)'), 'nock 的列没还回来')
  assert.ok(css.includes('.eck.ph'), '占位没有隐藏规则')
})

test('v183 2.1：fs/dirs 只读路由 + 应用内文件夹浏览器 + pickFolder 降级', () => {
  const routes = src('routes.ts')
  assert.ok(routes.includes("if (key === 'fs/dirs')"), '没有 fs/dirs 路由')
  assert.ok(routes.includes('listDirs?(path?: string)'), 'Services 没声明 listDirs')
  const host = src('index.ts')
  assert.ok(host.includes('listDirs: async (pathIn?: string)'), 'host 没实现 listDirs')
  assert.ok(host.includes('readdirSync(p, { withFileTypes: true })'), '没列目录')
  assert.ok(host.includes("ent.name.startsWith('.')"), '没过滤隐藏目录')
  const b = SRC('board.ts')
  assert.ok(b.includes('private async pickFolder'), '没有 pickFolder')
  assert.ok(b.includes('this.pickFolderInApp()'), '系统对话框失败没换应用内浏览器')
  assert.ok(b.includes('dpmDlgPick'), '没有选择文件夹弹窗')
  assert.ok(!b.includes('当前 dsh 打不开系统选文件夹对话框'), '还在弹「打不开」红字')
})

test('v183 2.2：仓库弹窗更高 + 已选固定 210px + 候选自己滚', () => {
  const css = SRC('style.css')
  assert.ok(css.includes('.dpm-dialog.ar-dlg { height: min(872px, calc(100vh - 40px)); }'), '弹窗没加高')
  assert.ok(css.includes('.dpm-dialog.ar-dlg .ar-picked .ar-scroll { flex: none; height: 210px;'), '已选没固定 210px')
  assert.ok(css.includes('.dpm-dialog.ar-dlg .ar-cand { flex: 1 1 0;'), '候选区没占剩余高度')
})

test('v183 3：关联会话一行复用 .dpm-sst 胶囊，不再用大按钮/折行', () => {
  const s = SRC('goaltask.ts')
  assert.ok(s.includes('dpm-gfl'), '没有「关联会话」标签')
  assert.ok(s.includes('dpm-gfs'), '没有新的平铺按钮')
  assert.ok(s.includes('dpm-sst dpm-gfst'), '没复用会话状态胶囊')
  const css = SRC('style.css')
  assert.ok(css.includes('.dpm-gfs { flex: none;') && css.includes('white-space: nowrap'), '没有单行样式')
})

test('v183 版本 0.78.0 + CHANGELOG', () => {
  assert.equal(pkg.version, '0.80.0')
  assert.ok(log.includes('0.79.0'), 'CHANGELOG 没有 0.78.0')
})
test('v183 1.1 真机回归：分区变化必须进 modelSig（否则服务端已挪、屏幕停在旧分区）', () => {
  const s = SRC('gantt.ts')
  assert.ok(s.includes("out.push('U' + [sigDay") && s.includes('u.autoRec ? u.autoRec.at'), 'modelSig 没收面板按天状态（分区 / 勾选 / 排布 / 自动结算）')
  assert.ok(s.includes("out.push('V' + [...PST.entries()]"), 'modelSig 没收执行状态（PST）')
  assert.ok(s.includes('void self.load(true, true).then('), 'dpm:sess-run 里还是不带 full 的 load')
})

test('v183 2.1 真机回归：旧宿主空态 / 键盘 / 开关文案', () => {
  const b = SRC('board.ts')
  assert.ok(b.includes('private pkRestart()'), '缺旧宿主「重启后可用」空态')
  assert.ok(b.includes('重启后可用'), '空态文案缺失')
  assert.ok(b.includes("k.key !== 'ArrowDown' && k.key !== 'ArrowUp'"), '选文件夹没有 ↑↓ 键盘')
  const g = SRC('goaltask.ts')
  assert.ok(!g.includes('「未安排」和本日计划清单'), '排今天开关 toast 还是旧口径')
  assert.ok(g.includes('保存后直接进今天的「已安排」最后一行'), '排今天开关 toast 没改成已安排')
})
