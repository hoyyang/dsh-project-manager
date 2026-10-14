import { isIP } from 'node:net';
import { copyFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as M from './model.js';
export const ROUTE_PREFIX = '/_dsh/dsh-project-manager';
// 相关说明不限字数：体上限放到 2MB（仅本机同源请求）
const MAX_BODY = 2 * 1024 * 1024;
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
        for (const p of c.files ?? [])
            if (!(p in out))
                out[p] = existsSync(p);
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
    'card/notes': (x, b) => M.setNotes(b, str(x.id, 'id'), x.notes),
    'card/weblinks': (x, b) => M.setWebLinks(b, str(x.id, 'id'), x.links),
    'linktype/add': (x, b) => M.addLinkType(b, x.name),
    'linktype/rename': (x, b) => M.renameLinkType(b, x.from, x.to),
    'linktype/move': (x, b) => M.moveLinkType(b, x.name, x.to),
    'card/repos-add': (x, b) => M.addCardRepos(b, str(x.id, 'id'), x.repos, (p) => { try {
        return realpathSync(p);
    }
    catch {
        return p;
    } }),
    'card/repos': (x, b) => M.setCardRepos(b, str(x.id, 'id'), x.repos),
    'card/files-add': (x, b) => M.addFiles(b, str(x.id, 'id'), Array.isArray(x.paths) ? x.paths.map(expandHome) : x.paths),
    'card/files-remove': (x, b) => M.removeFile(b, str(x.id, 'id'), x.path),
    'card/archive': (x, b) => M.archiveCard(b, str(x.id, 'id')),
    'card/unarchive': (x, b) => M.unarchiveCard(b, str(x.id, 'id')),
    'card/move': (x, b) => M.moveCard(b, str(x.id, 'id'), { g: x.group, col: str(x.col, 'col'), beforeId: x.beforeId ?? null }, 'user'),
};
export function mountRoutes(webServer, s, boardRev) {
    // 版本号 = 启动标识 + 看板变更计数 + STATE 目录签名：插件重载或 STATE 改动都会让前端拉到新快照
    const boot = Date.now().toString(36);
    let forkBackup = '';
    // 文件被删/恢复也要让前端拉新快照 → 版本号带上「缺失文件」签名
    const getRev = () => boot + '.' + boardRev() + '.' + s.states.signature() + '.' + fileSig(fileStatus(s.store.get())) + '.' + s.landfill().skill + (s.landfill().toolOutdated ? 'o' : '');
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
                    if (sub === '/session') {
                        const id = u.searchParams.get('id') ?? '';
                        const b = s.store.get();
                        const c = M.cardOfSession(b, id);
                        if (!c)
                            return send(res, 200, { ok: true, card: null });
                        const g = M.group(b, c.g);
                        return send(res, 200, {
                            ok: true,
                            card: { id: c.id, title: c.t, group: g.name },
                            suggest: ((x) => (x ? { key: x.key, slug: x.slug } : null))(M.sameNameState(b, c, s.states.list())),
                            // 0.10：注入的卡片资料概要（会话界面提示用）
                            materials: { notes: (c.notes ?? '').trim().length, links: (c.webLinks ?? []).length, files: (c.files ?? []).length, repos: (c.repos ?? []).length, tasks: c.tasks.length },
                            memory: M.memoryOf(b, c).map((m) => { const st = s.states.get(m.key); return { key: m.key, from: m.from, slug: st?.slug ?? m.key, next: st?.next ?? '', found: st !== undefined, read: (M.sessionRef(b, id)?.readKeys ?? []).includes(m.key) }; }),
                            ...(s.sessionExtra?.(id) ?? {}),
                        });
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
                    return send(res, 200, { ok: true, ...(await s.bindSession(str(body.sessionId, 'sessionId'), str(body.cardId, 'cardId'), body.tree === true)) });
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
                    const id = str(body.id, 'id');
                    M.liveCard(s.store.get(), id);
                    const picked = await s.pickFiles();
                    if (picked === null)
                        return send(res, 200, { ok: true, result: { cancelled: true, added: 0, skipped: 0 }, ...snapshot(s, getRev()) });
                    const r = await s.store.mutate((b) => M.addFiles(b, id, picked), () => [{ at: new Date().toISOString(), actor: 'user', kind: 'card/files-add', card: id }]);
                    return send(res, 200, { ok: true, result: { cancelled: false, ...r }, ...snapshot(s, getRev()) });
                }
                if (key === 'card/files-check') {
                    const c = M.liveCard(s.store.get(), str(body.id, 'id'));
                    return send(res, 200, { ok: true, results: checkPaths(body.paths, c.files ?? [], homedir(), statKind) });
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
                const fn = MUTATIONS[key];
                if (!fn)
                    return fail(res, 404, 'NOT_FOUND', '未知动作 ' + key);
                const result = await s.store.mutate((b) => fn(body, b), (r) => (key === 'card/move' ? [r] : [{ at: new Date().toISOString(), actor: 'user', kind: key, card: typeof body.id === 'string' ? body.id : undefined }]));
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