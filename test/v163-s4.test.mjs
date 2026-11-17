/* v163 / S4：host 接线（KbStore 进 Services + GET /kb·/kb/card·/kb/search + POST kb/* + getRev 拼 kb 签名 + api.ts client 函数）
   路由处理函数难直测（要 mock webServer），按计划用源码锁；纯逻辑已由 S1/S2 覆盖。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')

const indexTs = src('index.ts')
const routesTs = src('routes.ts')
const apiTs = src('client/api.ts')

test('S4 index.ts 建 KbStore(join(dataDir, \'kb\')) 并放进 Services 字面量', () => {
  assert.match(indexTs, /const kb = new KbStore\(join\(dataDir, 'kb'\)\)/)
  const callBlock = indexTs.slice(indexTs.indexOf('const off = mountRoutes'))
  assert.match(callBlock, /const off = mountRoutes[\s\S]*?\n\s+kb,\n/)
})

test('S4 routes.ts Services 接口有 kb: KbStore，import 了 KbStore / buildKbIndex / searchKb', () => {
  assert.match(routesTs, /export interface Services \{[\s\S]*?\n  kb: KbStore\n/)
  assert.match(routesTs, /import type \{ KbCard, KbStatus, KbStore, KbType \} from '\.\/kb\.js'/)
  assert.match(routesTs, /import \{ buildKbIndex, searchKb, type KbSearchOpts \} from '\.\/kbsearch\.js'/)
})

test('S4 GET /kb 返回 {cards: 列表项, errors}，列表项不含 body', () => {
  const seg = routesTs.slice(routesTs.indexOf("sub === '/kb'"))
  assert.match(seg, /s\.kb\.list\(\)\.map\(\(c\) => kbItem\(c, s\.kb\)\)/)
  assert.match(seg, /errors: s\.kb\.errors/)
  // kbItem 本身不许带 body / extra
  const item = routesTs.match(/const kbItem = \(c: KbCard, kb: KbStore\): Json => \(([^\n]+)\)/)
  assert.ok(item, 'kbItem helper 存在')
  assert.ok(!item[1].includes('body'))
  assert.ok(!item[1].includes('extra'))
  assert.match(item[1], /summary: kb\.summaryOf\(c\)/)
})

test('S4 GET /kb/card 带 body + attachedBy 扫 board（cardId/title/group）', () => {
  const seg = routesTs.slice(routesTs.indexOf("sub === '/kb/card'"), routesTs.indexOf("sub === '/kb/search'"))
  assert.match(seg, /fail\(res, 404, 'NO_KB'/)
  assert.match(seg, /\{ \.\.\.c, summary: s\.kb\.summaryOf\(c\) \}/)
  assert.match(seg, /b\.cards\.filter\(\(x\) => \(x\.kb \?\? \[\]\)\.some\(\(k\) => k\.id === c\.id\)\)/)
  assert.match(seg, /\{ cardId: x\.id, title: x\.t, group: M\.group\(b, x\.g\)\.name \}/)
})

test('S4 GET /kb/search 走 buildKbIndex + searchKb，type/tag/status/limit 从 query 解析', () => {
  const seg = routesTs.slice(routesTs.indexOf("sub === '/kb/search'"))
  assert.match(seg, /searchKb\(buildKbIndex\(s\.kb\.list\(\)\)/)
  assert.match(seg, /u\.searchParams\.get\('type'\) as KbType \| undefined/)
  assert.match(seg, /u\.searchParams\.get\('status'\) as KbStatus \| undefined/)
  assert.match(seg, /score: h\.score, hit: h\.hit/)
})

test('S4 POST kb/create|update|remove|restore 四个 op，remove 不返回 card', () => {
  const seg = routesTs.slice(routesTs.indexOf("if (key.startsWith('kb/')"), routesTs.indexOf('const fn = MUTATIONS[key]'))
  for (const op of ['create', 'update', 'remove', 'restore']) assert.match(seg, new RegExp("op === '" + op + "'"))
  assert.match(seg, /s\.kb\.create\(body as unknown as Partial<KbCard>\)/)
  assert.match(seg, /s\.kb\.update\(str\(body\.id, 'id'\), body as unknown as Partial<KbCard>\)/)
  const rm = seg.slice(seg.indexOf("op === 'remove'"), seg.indexOf("op === 'restore'"))
  assert.ok(!rm.includes('card:'), 'remove 的返回不带 card')
  assert.match(seg, /if \(e instanceof M\.BoardError\) throw e/, 'BoardError 交外层统一转 400')
})

test('S4 getRev 拼上 kb.signature()（前端快照能感知知识卡变化）', () => {
  const line = routesTs.match(/const getRev = \(\): string =>[^\n]+/)
  assert.ok(line, 'getRev 存在')
  assert.match(line[0], /\+ '\.' \+ s\.kb\.signature\(\)$/, '末尾拼 kb 目录签名')
})

test('S4 api.ts 有 getKb / getKbCard / searchKb / postKb 四个 client 函数与类型', () => {
  for (const fn of ['getKb', 'getKbCard', 'searchKb', 'postKb']) assert.match(apiTs, new RegExp('export const ' + fn + ' ='))
  assert.match(apiTs, /export interface KbItem \{/)
  assert.match(apiTs, /export interface KbCardInfo extends KbErrors \{ card: KbCardFull; attachedBy: Array<\{ cardId: string; title: string; group: string \}> \}/)
  assert.match(apiTs, /post<\{ card\?: KbItem \} & KbErrors>\('kb\/' \+ op, body\)/)
})

test('S4 client 按步骤放开：kb.ts / board.ts / qmenu.ts（v165 起还有 goaltask.ts；v168 起 kbdlg.ts；v177 起 detailbubble.ts）用 kb 函数，其余文件仍不引用', () => {
  /* v165：任务说明的引用面板也要「知识卡」这一类 → goaltask.ts 读 getKb / getKbCard（一次载入，进程内复用） */
  const names = readdirSync(new URL('../src/client/', import.meta.url)).filter((n) => n.endsWith('.ts') && n !== 'api.ts' && n !== 'kb.ts' && n !== 'board.ts' && n !== 'qmenu.ts' && n !== 'goaltask.ts' && n !== 'kbdlg.ts' && n !== 'detailbubble.ts')
  for (const n of names) {
    const t = readFileSync(new URL('../src/client/' + n, import.meta.url), 'utf8')
    assert.ok(!/\b(getKb|getKbCard|searchKb|postKb)\b/.test(t), n + ' 还不该用 kb client 函数')
  }
  assert.ok(readFileSync(new URL('../src/client/kb.ts', import.meta.url), 'utf8').includes("import { getKb, getKbCard, getState, post, postKb, searchKb } from './api.js'"))
  const board = readFileSync(new URL('../src/client/board.ts', import.meta.url), 'utf8')
  assert.ok(board.includes('getKb,'), 'board.ts 的详情「知识卡」一节要读 /kb 列表')
  assert.ok(board.includes('searchKb,'), 'board.ts 的「添加知识卡」选择器走 /kb/search')
  /* v163 S10：输入框「>」的知识卡组按输入词走 /kb/search（前 8 条） */
  assert.ok(readFileSync(new URL('../src/client/qmenu.ts', import.meta.url), 'utf8').includes("import { searchKb, type KbRef, type SessionInfo } from './api.js'"), 'qmenu.ts 的「>」菜单要用 searchKb')
  assert.ok(readFileSync(new URL('../src/client/goaltask.ts', import.meta.url), 'utf8').includes('getKb, getKbCard,'), 'v165：任务弹窗的引用面板要读知识卡列表')
  /* v177：详情气泡自己按 id 读知识卡全文（摘要态 → refresh） */
  assert.ok(readFileSync(new URL('../src/client/detailbubble.ts', import.meta.url), 'utf8').includes('getKbCard'), 'v177：详情气泡要读知识卡全文')
})
