import { isIP } from 'node:net';
import { copyFileSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as M from './model.js';
import { refNameKey } from './quote.js';
export const ROUTE_PREFIX = '/_dsh/dsh-project-manager';
// 相关说明不限字数：体上限放到 2MB（仅本机同源请求）
/** v123（2）：任务说明不限字数 → 请求体上限从 2MB 放到 32MB。 */
const MAX_BODY = 32 * 1024 * 1024;
function isLoopbackPeer(remote) {
    if (!remote)
        return false;
    if (remote === '::1')
        return true;
    const m = /^::ffff:(\d+)\.\d+\.\d+\.\d+$/i.exec(remote);
    if (m)
        return Number(m[1]) === 127;
    return isIP(remote) === 4 && remote.startsWith('127.');
}
/** DNS 重绑定防护：Host 必须是回环主机名（与 DSH /api 的 Host 围栏同口径）。 */
function loopbackHost(req) {
    const host = req.headers.host;
    if (typeof host !== 'string')
        return false;
    let name = host.trim().toLowerCase();
    if (name.startsWith('['))
        name = name.slice(0, name.indexOf(']') + 1);
    else
        name = name.replace(/:\d+$/, '');
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}
/**
 * 写操作：带 Origin 时必须与 Host 一致（挡浏览器跨站请求——浏览器发 POST 一定带 Origin）。
 * 没有 Origin 放行：DSH Desktop 壳转发请求时会删掉 Origin（issue #2），脚本 / 同进程工具也不带；
 * 能到这里的请求已经过了「仅本机回环 + Host 是 127.0.0.1 / localhost」那道门。与 dsh-manage-sessions 同一口径。
 */
export function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    const host = req.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string' || host.trim() === '')
        return false;
    try {
        return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
    }
    catch {
        return false;
    }
}
function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
}
const fail = (res, status, code, message) => send(res, status, { ok: false, error: { code, message } });
function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        let over = false;
        req.on('data', (d) => { if (over)
            return; size += d.length; if (size > MAX_BODY) {
            over = true;
            resolve(null);
            return;
        } chunks.push(d); });
        req.on('end', () => {
            if (over)
                return;
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                const v = text.trim() === '' ? {} : JSON.parse(text);
                resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
            }
            catch {
                resolve(null);
            }
        });
        req.on('error', () => resolve(null));
    });
}
const str = (v, field) => {
    if (typeof v !== 'string' || v === '')
        throw new M.BoardError('BAD_ARG', '缺少参数 ' + field);
    return v;
};
/** 所有卡片相关文件的存在状态（路径 → 是否存在）。ponytail: 每次轮询逐个 stat，文件上千时再改成按需检查。 */
export function fileStatus(b) {
    const out = {};
    for (const c of b.cards)
        for (const f of c.files ?? [])
            if (!(f.path in out))
                out[f.path] = existsSync(f.path);
    return out;
}
/** 0.27 卡片仓库路径是否还在（详情里「路径不存在」+ 访达按钮）。 */
export function repoStatus(b) {
    const out = {};
    for (const c of b.cards)
        for (const r of c.repos ?? [])
            if (!(r.path in out))
                out[r.path] = existsSync(r.path);
    return out;
}
const fileSig = (m) => { let n = 0; for (const k in m)
    if (!m[k])
        n = (n * 31 + k.length + 1) >>> 0; return n.toString(36); };
const expandHome = (p) => (typeof p === 'string' && /^~(\/|$)/.test(p.trim()) ? homedir() + p.trim().slice(1) : p);
/** 给前端的完整快照：看板 + 落盘项目目录 + 枢纽工作区 + 文件状态 + 最近事件。 */
export function snapshot(s, rev) {
    const b = s.store.get();
    return {
        files: fileStatus(b),
        repoOk: repoStatus(b),
        ok: true,
        rev,
        board: b,
        states: s.states.list().map((x) => ({ key: x.key, project: x.project, slug: x.slug, status: x.status, next: x.next, updated: x.updated, path: x.path, error: x.error })),
        hub: s.hub(),
        caps: { unarchive: s.canUnarchive() },
        landfill: s.landfill(),
        events: s.store.eventsTail(80),
    };
}
export function checkPaths(raws, linked, home, stat) {
    if (!Array.isArray(raws))
        throw new M.BoardError('BAD_ARG', 'paths 必须是字符串数组');
    if (raws.length > 200)
        throw new M.BoardError('BAD_ARG', '一次最多检测 200 行（收到 ' + raws.length + ' 行）');
    const seen = new Set();
    const out = [];
    for (const r of raws) {
        if (typeof r !== 'string' || r.trim() === '')
            continue;
        const path = M.normPastedPath(r, home);
        const bad = !M.isAbsPath(path) || /[\u0000-\u001f\u007f]/.test(path) || path.length > 4096;
        let status;
        if (bad)
            status = 'bad';
        else if (seen.has(path))
            status = 'dup';
        else if (linked.includes(path))
            status = 'linked';
        else {
            const k = stat(path);
            status = k === 'file' ? 'ok' : k === 'dir' ? 'dir' : 'missing';
        }
        if (!bad)
            seen.add(path);
        out.push({ raw: r.trim(), path, status });
    }
    return out;
}
const statKind = (p) => { try {
    const s = statSync(p);
    return s.isFile() ? 'file' : s.isDirectory() ? 'dir' : null;
}
catch {
    return null;
} };
/**
 * v138/v139 会话输入框的路径识别：一次批量查「存在吗 + 文件还是文件夹」。只回存在的那些（不存在 = 不在结果里）。
 * ~/ 展开成 home；只收绝对路径；最多 400 条、每条 ≤ 1024 字（超出的忽略，不报错打扰输入）。
 */
/** v138：⌘ 点击打开时不直接运行的文件（可执行位 / 脚本 / 安装包 / app）→ 只在访达里选中。 */
export const RUN_EXT = /\.(app|command|sh|bash|zsh|tool|terminal|pkg|mpkg|workflow|scpt|scptd|applescript|jar|py|rb|pl|js|mjs|cjs|exe|bat|ps1)$/i;
export function openMode(path, kind, mode) {
    if (kind === 'dir')
        return /\.app$/i.test(path.replace(/\/+$/, '')) ? 'reveal' : 'open';
    return RUN_EXT.test(path) || (mode & 0o111) !== 0 ? 'reveal' : 'open';
}
export function statBatch(raws, home, stat) {
    const out = {};
    if (!Array.isArray(raws))
        throw new M.BoardError('BAD_ARG', 'paths 必须是数组');
    for (const raw of raws.slice(0, 400)) {
        if (typeof raw !== 'string' || !raw || raw.length > 1024 || raw in out)
            continue;
        const p = raw.replace(/^~(?=\/|$)/, home);
        if (!p.startsWith('/'))
            continue;
        const k = stat(p.length > 1 ? p.replace(/\/+$/, '') || '/' : p);
        if (k)
            out[raw] = k;
    }
    return out;
}
/**
 * v142（4.2）：会话输入框里「原位置已不在」的文件 → 在常用目录里按文件名找同名文件（广度优先、跳过隐藏目录 / node_modules，
 * 最多扫 depth 层、visit 个目录，最多返回 max 个）。ponytail: 线性扫描有上限（8000 个目录），找不到就说找不到，不建索引。
 * v154（1.4）：名字只差空格 / 连字符也算（搬家把空格净化成连字符就靠这一条），一字不差的排在前面。
 */
export function findSameName(name, roots, o = {}, ls = (d) => readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }))) {
    const depth = o.depth ?? 4, visit = o.visit ?? 4000, max = o.max ?? 4;
    if (!name || /[\/\u0000]/.test(name))
        return [];
    const want = refNameKey(name);
    const exact = [], near = [];
    const seen = new Set();
    /* 每个根目录各自一份目录预算：桌面很大也不会把 ~/.ai 挤掉 */
    for (const root of roots.filter(Boolean)) {
        const q = [[root.replace(/\/+$/, ''), 0]];
        let n = 0;
        /* v154：一字不差的优先 —— 扫到想要的精确同名数就停；只差空格 / 连字符的「近似」最多攒 max×3 个，别为它扫穿整棵目录 */
        while (q.length && exact.length < max && near.length < max * 3 && n < visit) {
            const [d, lv] = q.shift();
            if (seen.has(d))
                continue;
            seen.add(d);
            n++;
            let es;
            try {
                es = ls(d);
            }
            catch {
                continue;
            }
            for (const e of es) {
                const p = d + '/' + e.name;
                if (!e.dir && p !== o.skip) {
                    if (e.name === name) {
                        if (!exact.includes(p))
                            exact.push(p);
                    }
                    else if (want && refNameKey(e.name) === want && !near.includes(p))
                        near.push(p);
                    if (exact.length >= max)
                        break;
                }
                if (e.dir && lv < depth && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'Library')
                    q.push([p, lv + 1]);
            }
        }
        if (exact.length >= max)
            break;
    }
    return [...exact, ...near].slice(0, max);
}
/** 所有变更动作：名称 → 纯变更（在 store 串行链上执行）。 */
const MUTATIONS = {
    'group/create': (x, b) => M.addGroup(b, str(x.name, 'name')),
    'group/update': (x, b) => {
        const id = str(x.id, 'id');
        const g = M.group(b, id);
        if (x.name !== undefined)
            M.renameGroup(b, id, str(x.name, 'name'));
        if (x.collapsed !== undefined)
            g.collapsed = x.collapsed === true;
        if (x.statuses !== undefined)
            M.setStatuses(b, id, x.statuses);
        if (x.links !== undefined)
            M.setGroupLinks(b, id, x.links);
        if (x.repos !== undefined) {
            const next = M.cleanRepos(x.repos);
            M.noteRepos(b, next.filter((r) => !g.repos.some((o) => o.path === r.path)));
            g.repos = next;
        }
        if (x.lfProject !== undefined)
            M.setGroupFolder(b, id, x.lfProject);
        return g;
    },
    'group/remove': (x, b) => M.removeGroup(b, str(x.id, 'id')),
    'group/move': (x, b) => M.moveGroup(b, str(x.id, 'id'), x.beforeId ?? null),
    'group/repos-add': (x, b) => M.addRepos(b, str(x.id, 'id'), x.repos, (p) => { try {
        return realpathSync(p);
    }
    catch {
        return p;
    } }),
    'card/create': (x, b) => M.addCard(b, str(x.group, 'group'), str(x.title, 'title'), x.links ?? [], x.col),
    'card/update': (x, b) => M.updateCard(b, str(x.id, 'id'), { t: x.title, links: x.links }),
    'card/remove': (x, b) => M.removeCard(b, str(x.id, 'id')),
    'card/tasks': (x, b) => M.setTasks(b, str(x.id, 'id'), x.tasks),
    'card/task-done': (x, b) => M.setTaskDone(b, str(x.id, 'id'), x.task, x.done),
    'card/notes': (x, b) => M.setNotes(b, str(x.id, 'id'), x.notes),
    'card/noteitems': (x, b) => M.setNoteItems(b, str(x.id, 'id'), x.items),
    'card/related': (x, b) => M.setRelated(b, str(x.id, 'id'), x.cards),
    'tasktype/add': (x, b) => M.addTaskType(b, x.name),
    'tasktype/rename': (x, b) => M.renameTaskType(b, x.from, x.to),
    'tasktype/delete': (x, b) => M.deleteTaskType(b, x.name),
    'tasktype/place': (x, b) => M.placeTaskType(b, x.name, x.at),
    'card/weblinks': (x, b) => M.setWebLinks(b, str(x.id, 'id'), x.links),
    'linktype/add': (x, b) => M.addLinkType(b, x.name, x.group),
    'linktype/rename': (x, b) => M.renameLinkType(b, x.from, x.to),
    'linktype/delete': (x, b) => M.deleteLinkType(b, x.name),
    'linktype/place': (x, b) => M.placeLinkType(b, x.name, x.group ?? null, x.at),
    'typegroup/add': (x, b) => M.addTypeGroup(b, x.name),
    'typegroup/rename': (x, b) => M.renameTypeGroup(b, x.id, x.to),
    'typegroup/move': (x, b) => M.moveTypeGroup(b, x.id, x.to),
    'typegroup/delete': (x, b) => M.deleteTypeGroup(b, x.id),
    /* v140 / v141：链接类型网址 + 类型标签 + 星标 + 任务关联会话 */
    'linktype/domain-add': (x, b) => M.addTypeDomain(b, x.type, x.domain),
    'linktype/domain-remove': (x, b) => M.removeTypeDomain(b, x.type, x.domain),
    'linktype/tag-add': (x, b) => M.addTypeTag(b, x.type, x.tag),
    'linktype/tag-remove': (x, b) => M.removeTypeTag(b, x.type, x.tag),
    'card/link-star': (x, b) => M.setLinkStar(b, str(x.id, 'id'), x.link, x.on),
    'card/task-sess': (x, b) => M.setTaskSession(b, str(x.id, 'id'), x.task, x.sess),
    'card/repos-add': (x, b) => M.addCardRepos(b, str(x.id, 'id'), x.repos, (p) => { try {
        return realpathSync(p);
    }
    catch {
        return p;
    } }),
    'card/repos': (x, b) => M.setCardRepos(b, str(x.id, 'id'), x.repos),
    'card/files-add': (x, b) => { const it = x.items ?? x.paths; return M.addFiles(b, str(x.id, 'id'), Array.isArray(it) ? it.map((v) => (typeof v === 'string' ? expandHome(v) : v && typeof v === 'object' ? { ...v, path: expandHome(v.path) } : v)) : it); },
    'card/files-remove': (x, b) => M.removeFile(b, str(x.id, 'id'), x.file ?? x.path),
    'card/files-restore': (x, b) => M.restoreFile(b, str(x.id, 'id'), x.file, x.index, x.tasks),
    'card/files-title': (x, b) => M.setFileTitle(b, str(x.id, 'id'), x.file, x.title),
    'card/files-off': (x, b) => M.setFileOff(b, str(x.id, 'id'), x.file, x.on),
    'card/copy': (x, b) => M.copyCard(b, str(x.id, 'id')),
    'group/archive': (x, b) => M.archiveGroup(b, str(x.id, 'id')),
    'group/unarchive': (x, b) => M.unarchiveGroup(b, str(x.id, 'id')),
    'groups/collapse': (x, b) => M.bulkCollapse(b, x.mode, Array.isArray(x.live) ? x.live.map(String) : undefined),
    'prefs/set': (x, b) => M.setPrefs(b, x),
    'card/archive': (x, b) => M.archiveCard(b, str(x.id, 'id')),
    'card/unarchive': (x, b) => M.unarchiveCard(b, str(x.id, 'id')),
    // v86：pending 卡片拖回活跃区时可以直接改阶段（col 必须透传，否则拖到别的列仍留在原阶段）
    'card/pending': (x, b) => M.setPending(b, str(x.id, 'id'), x.on !== false, x.col === undefined ? undefined : str(x.col, 'col')),
    'card/move': (x, b) => M.moveCard(b, str(x.id, 'id'), { g: x.group, col: str(x.col, 'col'), beforeId: x.beforeId ?? null }, 'user'),
};
export function mountRoutes(webServer, s, boardRev) {
    // 版本号 = 启动标识 + 看板变更计数 + STATE 目录签名：插件重载或 STATE 改动都会让前端拉到新快照
    const boot = Date.now().toString(36);
    let forkBackup = '';
    // 文件被删/恢复也要让前端拉新快照 → 版本号带上「缺失文件」签名
    const getRev = () => boot + '.' + boardRev() + '.' + s.states.signature() + '.' + fileSig(fileStatus(s.store.get())) + fileSig(repoStatus(s.store.get())) + '.' + s.landfill().skill + (s.landfill().toolOutdated ? 'o' : '');
    return webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
            try {
                if (!isLoopbackPeer(req.socket.remoteAddress) || !loopbackHost(req))
                    return fail(res, 403, 'FORBIDDEN', '仅限本机访问（Host 必须是 127.0.0.1 / localhost）');
                const u = new URL(req.url ?? '/', 'http://localhost');
                const sub = u.pathname.slice(ROUTE_PREFIX.length).replace(/^\/api/, '') || '/';
                if (req.method === 'GET') {
                    if (sub === '/state') {
                        // 0.15：超过 1 秒记下每一步耗时（看板偶发白屏时定位卡在哪）
                        const t0 = Date.now();
                        const since = u.searchParams.get('since') ?? '';
                        const rev = getRev();
                        const t1 = Date.now();
                        if (since !== '' && since === rev) {
                            send(res, 200, { ok: true, rev, same: true });
                            if (t1 - t0 > 1000)
                                s.warn?.('/state 慢：rev ' + (t1 - t0) + 'ms（same）');
                            return;
                        }
                        const body = snapshot(s, rev);
                        const t2 = Date.now();
                        send(res, 200, body);
                        if (Date.now() - t0 > 1000)
                            s.warn?.('/state 慢：共 ' + (Date.now() - t0) + 'ms = rev ' + (t1 - t0) + 'ms + 快照 ' + (t2 - t1) + 'ms + 发送 ' + (Date.now() - t2) + 'ms');
                        return;
                    }
                    if (sub === '/gantt') {
                        if (!s.gantt)
                            return fail(res, 404, 'NOT_FOUND', '当前版本没有任务日程看板');
                        // v90：meta=1 只读宽度（详情打开用，绝不触发会话统计）；warm=1 才起后台统计（只有日程页发）
                        if (u.searchParams.get('meta') === '1')
                            return send(res, 200, { ok: true, ...s.gantt.meta() });
                        const since = u.searchParams.get('since') ?? '';
                        const d = await s.gantt.data(u.searchParams.get('warm') === '1');
                        if (since !== '' && since === d.rev)
                            return send(res, 200, { ok: true, rev: d.rev, same: true });
                        return send(res, 200, { ok: true, ...d });
                    }
                    if (sub === '/session') {
                        const id = u.searchParams.get('id') ?? '';
                        const b = s.store.get();
                        const c = M.cardOfSession(b, id);
                        if (!c)
                            return send(res, 200, { ok: true, card: null, free: s.freeSession?.(id, u.searchParams.get('cwd') ?? '') ?? null });
                        const g = M.group(b, c.g);
                        return send(res, 200, {
                            ok: true,
                            card: { id: c.id, title: c.t, group: g.name },
                            suggest: ((x) => (x ? { key: x.key, slug: x.slug } : null))(M.sameNameState(b, c, s.states.list())),
                            // 0.10：注入的卡片资料概要（会话界面提示用）
                            materials: { notes: (c.noteItems ?? []).reduce((n, x) => n + x.v.length, 0), links: (c.webLinks ?? []).length, files: (c.files ?? []).length, repos: (c.repos ?? []).length, tasks: c.tasks.length },
                            memory: M.memoryOf(b, c).map((m) => { const st = s.states.get(m.key); return { key: m.key, from: m.from, slug: st?.slug ?? m.key, next: st?.next ?? '', found: st !== undefined, read: (M.sessionRef(b, id)?.readKeys ?? []).includes(m.key) }; }),
                            ...(s.sessionExtra?.(id) ?? {}),
                        });
                    }
                    if (sub === '/session/messages') {
                        if (!s.sessionMessages)
                            return fail(res, 404, 'NOT_FOUND', '当前版本没有历史消息接口');
                        const num = (k) => { const v = u.searchParams.get(k); if (!v)
                            return undefined; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
                        return send(res, 200, { ok: true, ...(await s.sessionMessages(u.searchParams.get('id') ?? '', { before: num('before'), limit: num('limit') })) });
                    }
                    if (sub === '/session/raw') {
                        if (!s.sessionRaw)
                            return fail(res, 404, 'NOT_FOUND', '当前版本没有原文接口');
                        return send(res, 200, { ok: true, ...s.sessionRaw(u.searchParams.get('id') ?? '') });
                    }
                    if (sub === '/landfill/match') {
                        if (!s.lfMatch)
                            return fail(res, 404, 'NOT_FOUND', '当前版本没有同名检测');
                        return send(res, 200, { ok: true, ...s.lfMatch(u.searchParams.get('session') ?? '', (u.searchParams.get('q') ?? '').slice(0, 300)) });
                    }
                    if (sub === '/merge/preview') {
                        if (!s.merge)
                            return fail(res, 400, 'MERGE_OFF', '落盘项目功能没开启，不能合并');
                        const keys = (u.searchParams.get('keys') ?? '').split(',').filter(Boolean);
                        return send(res, 200, { ok: true, ...s.merge.preview(u.searchParams.get('session') ?? '', keys, u.searchParams.get('name') ?? '') });
                    }
                    return fail(res, 404, 'NOT_FOUND', '未知路径 ' + sub);
                }
                if (req.method !== 'POST')
                    return fail(res, 405, 'METHOD', '只支持 GET/POST');
                if (!sameOrigin(req))
                    return fail(res, 403, 'CROSS_ORIGIN', '拒绝跨站请求');
                const body = await readBody(req);
                if (body === null)
                    return fail(res, 400, 'BAD_BODY', '请求体必须是 ≤2MB 的 JSON 对象');
                const key = sub.replace(/^\//, '');
                if (key === 'session/prepare')
                    return send(res, 200, { ok: true, ...(await s.prepareSession(str(body.cardId, 'cardId'))) });
                if (key === 'session/bind')
                    return send(res, 200, { ok: true, ...(await s.bindSession(str(body.sessionId, 'sessionId'), str(body.cardId, 'cardId'), body.tree === true, typeof body.title === 'string' ? body.title.trim().slice(0, 120) : undefined)) });
                if (key === 'fs/terminal') {
                    if (!s.repoTerminal)
                        return fail(res, 404, 'NOT_FOUND', '当前版本不能打开 Terminal');
                    await s.repoTerminal(str(body.path, 'path'));
                    return send(res, 200, { ok: true });
                }
                if (key === 'fs/open-local') {
                    if (!s.openLocal)
                        return fail(res, 404, 'NOT_FOUND', '当前版本不能打开本地路径');
                    return send(res, 200, { ok: true, ...(await s.openLocal(str(body.path, 'path'), body.dry === true)) });
                }
                if (key === 'fs/reveal') {
                    if (!s.reveal)
                        return fail(res, 404, 'NOT_FOUND', '当前版本不能打开访达');
                    await s.reveal(str(body.path, 'path'), body.folder === true);
                    return send(res, 200, { ok: true });
                }
                if (key === 'goal/title') {
                    if (!s.goalTitle)
                        return fail(res, 404, 'NOT_FOUND', '当前版本还不能生成任务标题');
                    const route = body.route && typeof body.route === 'object' ? body.route : undefined;
                    return send(res, 200, { ok: true, ...(await s.goalTitle(typeof body.session === 'string' ? body.session : '', str(body.text, 'text'), route)) });
                }
                if (key === 'goal/models') {
                    if (!s.titleModels)
                        return fail(res, 404, 'NOT_FOUND', '当前版本还不能列出模型');
                    return send(res, 200, { ok: true, ...(await s.titleModels()) });
                }
                if (key === 'session/create-card') {
                    if (!s.createForSession)
                        return fail(res, 404, 'NOT_FOUND', '当前版本不能创建会话卡片');
                    const r = await s.createForSession(str(body.sessionId, 'sessionId'), str(body.group, 'group'), str(body.title, 'title'), str(body.col, 'col'), typeof body.cwd === 'string' ? body.cwd : '');
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'hub/cleanup')
                    return send(res, 200, { ok: true, ...(await s.cleanup()) });
                if (key === 'session/link') {
                    const items = Array.isArray(body.sessions) ? body.sessions.map((x) => ({ sessionId: str(x?.sessionId, 'sessionId'), title: typeof x?.title === 'string' ? x.title : undefined })) : [];
                    const r = await s.linkSessions(str(body.cardId, 'cardId'), items);
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'session/unlink') {
                    const r = await s.unlinkSession(str(body.sessionId, 'sessionId'));
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'session/unarchive') {
                    const r = await s.unarchiveSession(str(body.sessionId, 'sessionId'));
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'card/files-pick') {
                    // 0.26 只选不加：选中的进「添加文件」弹窗的待添加列表（与粘贴同一套检测）
                    const c = M.liveCard(s.store.get(), str(body.id, 'id'));
                    const picked = await s.pickFiles();
                    if (picked === null)
                        return send(res, 200, { ok: true, cancelled: true, results: [] });
                    return send(res, 200, { ok: true, cancelled: false, results: checkPaths(picked, M.filePaths(c), homedir(), statKind) });
                }
                if (key === 'card/files-tolf' || key === 'card/files-untolf') {
                    if (!s.filesToLf || !s.filesUndoLf)
                        return fail(res, 400, 'LF_OFF', '落盘项目功能没开启，不能放到落盘项目');
                    const id = str(body.id, 'id');
                    try {
                        const r = key === 'card/files-tolf'
                            ? await s.filesToLf(id, Array.isArray(body.files) ? body.files.map(String) : [], str(body.key, 'key'), body.del === true, { allowLarge: body.allowLarge === true, pathOnly: body.pathOnly === true })
                            : await s.filesUndoLf(id, (Array.isArray(body.items) ? body.items : []).map((x) => { const o = (x ?? {}); return { id: str(o.id, 'id'), from: str(o.from, 'from'), ...(typeof o.trashed === 'string' && o.trashed ? { trashed: o.trashed } : {}) }; }));
                        return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                    }
                    catch (e) {
                        const x = e;
                        if (e instanceof M.BoardError)
                            throw e;
                        return fail(res, 400, x.code ?? 'LF_FAILED', x.message ?? String(e));
                    }
                }
                if (key === 'card/files-open') {
                    if (!s.fileOpen)
                        return fail(res, 404, 'NOT_FOUND', '当前版本不能打开文件');
                    const r = await s.fileOpen(str(body.id, 'id'), typeof body.file === 'string' ? body.file : '', typeof body.path === 'string' ? body.path : '', typeof body.name === 'string' ? body.name : '', body.dry === true);
                    return send(res, 200, { ok: true, ...(r && typeof r === 'object' ? r : {}) });
                }
                if (key === 'card/files-trash-many') {
                    if (!s.fileTrashMany)
                        return fail(res, 400, 'TRASH_OFF', '当前版本不支持批量删除文件');
                    const r = await s.fileTrashMany(str(body.id, 'id'), body.files);
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'card/files-trash' || key === 'card/files-untrash') {
                    if (!s.fileTrash || !s.fileUntrash)
                        return fail(res, 400, 'TRASH_OFF', '当前版本不支持删除文件');
                    const id = str(body.id, 'id');
                    const r = key === 'card/files-trash' ? await s.fileTrash(id, str(body.file, 'file')) : await s.fileUntrash(id, body.file, body.index, body.tasks, str(body.trashed, 'trashed'));
                    return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                }
                if (key === 'repos/check') {
                    // 0.24 新增仓库的「粘贴路径」：逐行检测文件夹（ok = 是文件夹；dir 状态在这里表示「是文件」）
                    const linked = typeof body.id === 'string' && body.id ? (body.mode === 'group' ? M.group(s.store.get(), body.id).repos : M.card(s.store.get(), body.id).repos ?? []).map((r) => r.path.replace(/\/+$/, '')) : [];
                    return send(res, 200, { ok: true, results: checkPaths(body.paths, linked, homedir(), (p) => { const k = statKind(p); return k === 'dir' ? 'file' : k === 'file' ? 'dir' : null; }) });
                }
                if (key === 'paths/stat')
                    return send(res, 200, { ok: true, kinds: statBatch(body.paths, homedir(), statKind) });
                if (key === 'paths/same-name') {
                    const p = str(body.path, 'path').replace(/^~(?=\/|$)/, homedir());
                    const nm = p.replace(/\/+$/, '').split('/').pop() ?? '';
                    const h = homedir();
                    const roots = [h + '/Desktop', h + '/Downloads', h + '/Documents', h + '/.ai', h + '/.dsh'];
                    return send(res, 200, { ok: true, name: nm, candidates: findSameName(nm, roots, { skip: p, depth: 7 }) });
                }
                if (key === 'card/files-check') {
                    const c = M.liveCard(s.store.get(), str(body.id, 'id'));
                    return send(res, 200, { ok: true, results: checkPaths(body.paths, M.filePaths(c), homedir(), statKind) });
                }
                if (key === 'session/fork-backfill') {
                    const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 500).map((x) => ({ child: str(x?.child, 'child'), parent: str(x?.parent, 'parent') }));
                    const b0 = s.store.get();
                    // 先算一遍有没有要补的，没有就不写盘、不备份
                    if (!pairs.some((p) => M.sessionRef(b0, p.parent) && !M.sessionRef(b0, p.child)))
                        return send(res, 200, { ok: true, result: { bound: [] }, ...snapshot(s, getRev()) });
                    if (!forkBackup && existsSync(s.store.boardPath)) {
                        forkBackup = s.store.boardPath + '.bak-fork-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
                        copyFileSync(s.store.boardPath, forkBackup);
                    }
                    const bound = await s.store.mutate((b) => M.backfillForks(b, pairs), (r) => r.map((x) => ({ at: new Date().toISOString(), actor: 'user', kind: 'session/fork-backfill', card: x.card, to: x.child })));
                    return send(res, 200, { ok: true, result: { bound, backup: forkBackup }, ...snapshot(s, getRev()) });
                }
                if (key === 'landfill/adopt-skill') {
                    try {
                        const r = s.adoptSkill();
                        return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                    }
                    catch (e) {
                        const x = e;
                        return fail(res, 400, x.code ?? 'ADOPT_FAILED', '接管 skill 失败：' + (x.message ?? String(e)));
                    }
                }
                if (key === 'landfill/upgrade-tool') {
                    try {
                        const r = s.upgradeTool();
                        return send(res, 200, { ok: true, result: r, ...snapshot(s, getRev()) });
                    }
                    catch (e) {
                        const x = e;
                        return fail(res, 400, x.code ?? 'UPGRADE_FAILED', '升级 ai-memory 失败：' + (x.message ?? String(e)));
                    }
                }
                if (key.startsWith('lf/')) {
                    try {
                        if (key === 'lf/link' && s.lfLink)
                            return send(res, 200, { ok: true, ...(await s.lfLink(str(body.sessionId, 'sessionId'), str(body.key, 'key'))) });
                        if (key === 'lf/run' && s.lfRunStart) {
                            s.lfRunStart(str(body.sessionId, 'sessionId'), typeof body.key === 'string' ? body.key : '', typeof body.label === 'string' ? body.label.slice(0, 120) : '');
                            return send(res, 200, { ok: true });
                        }
                        if (key === 'lf/run-dismiss' && s.lfRunDismiss) {
                            s.lfRunDismiss(str(body.sessionId, 'sessionId'));
                            return send(res, 200, { ok: true });
                        }
                        if (key === 'lf/folder' && s.setFolder)
                            return send(res, 200, { ok: true, ...(await s.setFolder(str(body.sessionId, 'sessionId'), str(body.value, 'value'))) });
                        if (key === 'lf/migrate-undo' && s.migUndo)
                            return send(res, 200, { ok: true, ...(await s.migUndo(str(body.id, 'id'))) });
                        if (key === 'lf/migrate-purge' && s.migPurge)
                            return send(res, 200, { ok: true, ...(await s.migPurge(str(body.id, 'id'))) });
                    }
                    catch (e) {
                        const x = e;
                        if (e instanceof M.BoardError)
                            throw e;
                        return fail(res, 400, x.code ?? 'LF_FAILED', x.message ?? String(e));
                    }
                    return fail(res, 404, 'NOT_FOUND', '未知动作 ' + key);
                }
                if (key === 'states/refresh') {
                    s.states.invalidate();
                    return send(res, 200, snapshot(s, getRev()));
                }
                if (key.startsWith('merge/')) {
                    const mg = s.merge;
                    if (!mg)
                        return fail(res, 400, 'MERGE_OFF', '落盘项目功能没开启，不能合并');
                    try {
                        if (key === 'merge/start')
                            return send(res, 200, { ok: true, ...(await mg.start(str(body.sessionId, 'sessionId'), Array.isArray(body.keys) ? body.keys.map(String) : [], typeof body.name === 'string' ? body.name : '')) });
                        if (key === 'merge/cancel') {
                            await mg.cancel(str(body.id, 'id'));
                            return send(res, 200, { ok: true });
                        }
                        if (key === 'merge/undo')
                            return send(res, 200, { ok: true, ...(await mg.undo(str(body.id, 'id'))) });
                        if (key === 'merge/purge')
                            return send(res, 200, { ok: true, ...(await mg.purge(str(body.id, 'id'))) });
                    }
                    catch (e) {
                        const x = e;
                        if (e instanceof M.BoardError)
                            throw e;
                        return send(res, 400, { ok: false, error: { code: x.code ?? 'MERGE_FAILED', message: x.message ?? String(e) }, ...(x.extra ?? {}) });
                    }
                    return fail(res, 404, 'NOT_FOUND', '未知动作 ' + key);
                }
                if (key.startsWith('gantt/')) {
                    if (!s.gantt)
                        return fail(res, 404, 'NOT_FOUND', '当前版本没有任务日程看板');
                    return send(res, 200, { ok: true, ...(await s.gantt.run(key.slice('gantt/'.length), body)) });
                }
                const fn = MUTATIONS[key];
                if (!fn)
                    return fail(res, 404, 'NOT_FOUND', '未知动作 ' + key);
                const result = await s.store.mutate((b) => fn(body, b), (r) => (key === 'card/move' ? [r] : key === 'card/copy' ? [{ at: new Date().toISOString(), actor: 'user', kind: key, card: r.id, from: body.id }] : key.startsWith('group') ? [{ at: new Date().toISOString(), actor: 'user', kind: key, group: typeof body.id === 'string' ? body.id : undefined }] : [{ at: new Date().toISOString(), actor: 'user', kind: key, card: typeof body.id === 'string' ? body.id : undefined }]));
                return send(res, 200, { ok: true, result: result ?? null, ...snapshot(s, getRev()) });
            }
            catch (e) {
                if (e instanceof M.BoardError)
                    return fail(res, 400, e.code, e.message);
                const lc = e.name === 'LandfillError' ? e.code : '';
                if (lc)
                    return fail(res, 400, lc, e.message);
                return fail(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e));
            }
        },
    });
}
//# sourceMappingURL=routes.js.map