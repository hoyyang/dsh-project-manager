export class BoardError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'BoardError';
    }
}
export const emptyBoard = () => ({ version: 1, groups: [], cards: [], sessions: [] });
export const defaultStatuses = () => [
    { id: 'research', name: '调研' },
    { id: 'plan', name: '制定方案' },
    { id: 'build', name: '实施' },
    { id: 'verify', name: '测试验收' },
    { id: 'done', name: '完成' },
];
let seq = 0;
export const newId = (prefix) => prefix + Date.now().toString(36) + (seq++).toString(36);
/** 名称类字段：去控制字符、折叠空白（防止换行把内容注入 AGENTS.md / 会话记忆）、限长 120。 */
const nonEmpty = (v, field) => {
    if (typeof v !== 'string')
        throw new BoardError('BAD_ARG', field + ' 不能为空');
    const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (s === '')
        throw new BoardError('BAD_ARG', field + ' 不能为空');
    if (s.length > 120)
        throw new BoardError('BAD_ARG', field + ' 超过 120 字');
    return s;
};
export function group(b, id) {
    const g = b.groups.find((x) => x.id === id);
    if (!g)
        throw new BoardError('NO_GROUP', '找不到卡片组 ' + id);
    return g;
}
export function card(b, id) {
    const c = b.cards.find((x) => x.id === id);
    if (!c)
        throw new BoardError('NO_CARD', '找不到卡片 ' + id);
    return c;
}
/** 要改动内容的卡片：已归档的只读，先恢复活跃。 */
export function liveCard(b, id) {
    const c = card(b, id);
    if (c.archivedAt)
        throw new BoardError('CARD_ARCHIVED', '卡片「' + c.t + '」已归档，只能查看；先恢复活跃再修改');
    return c;
}
export function status(g, id) {
    const s = g.statuses.find((x) => x.id === id);
    if (!s)
        throw new BoardError('NO_STATUS', '卡片组「' + g.name + '」没有阶段 ' + id);
    return s;
}
/** 同组同阶段内按 order 排序后的活跃卡片（已归档的不占位置）。 */
export function cellCards(b, gId, col) {
    return b.cards.filter((c) => c.g === gId && c.col === col && !c.archivedAt).sort((a, c) => a.order - c.order);
}
/** 归档卡片：移出看板列（其余卡片补位），内容转只读；卡片的会话不动。已归档再归档 = 无操作。 */
export function archiveCard(b, id, at = new Date().toISOString()) {
    const c = card(b, id);
    if (c.archivedAt)
        return c;
    c.archivedAt = at;
    renumber(cellCards(b, c.g, c.col));
    return c;
}
/** 恢复活跃：回到原阶段末尾。原阶段已被删除时放到第一个阶段。 */
export function unarchiveCard(b, id) {
    const c = card(b, id);
    if (!c.archivedAt)
        return c;
    const g = group(b, c.g);
    if (!g.statuses.some((s) => s.id === c.col))
        c.col = g.statuses[0].id;
    c.order = cellCards(b, c.g, c.col).length;
    delete c.archivedAt;
    return c;
}
function renumber(list) { list.forEach((c, i) => { c.order = i; }); }
export function addGroup(b, name) {
    const g = { id: newId('g'), name: nonEmpty(name, '组名'), collapsed: false, repos: [], links: [], statuses: defaultStatuses() };
    b.groups.push(g);
    return g;
}
/** 调整卡片组顺序：把 id 插到 beforeId 之前；beforeId 缺省/null = 放到最后。顺序即 groups 数组顺序。 */
export function moveGroup(b, id, beforeId) {
    const g = group(b, id);
    if (beforeId === id)
        return;
    if (beforeId)
        group(b, beforeId);
    const rest = b.groups.filter((x) => x.id !== id);
    const i = beforeId ? rest.findIndex((x) => x.id === beforeId) : rest.length;
    rest.splice(i, 0, g);
    b.groups = rest;
}
export function renameGroup(b, id, name) { group(b, id).name = nonEmpty(name, '组名'); }
export function removeGroup(b, id) {
    group(b, id);
    if (b.cards.some((c) => c.g === id))
        throw new BoardError('GROUP_NOT_EMPTY', '卡片组里还有卡片，先移走或删除卡片');
    b.groups = b.groups.filter((g) => g.id !== id);
}
/** 校验并替换整组阶段：至少一个，id 唯一，名称非空，仍有卡片的阶段不能被删。 */
export function setStatuses(b, gId, next) {
    const g = group(b, gId);
    if (!Array.isArray(next) || next.length === 0)
        throw new BoardError('BAD_STATUSES', '至少保留一个阶段');
    const ids = new Set();
    const clean = next.map((s) => {
        const id = typeof s?.id === 'string' && s.id !== '' ? s.id : newId('s');
        if (ids.has(id))
            throw new BoardError('BAD_STATUSES', '阶段 id 重复 ' + id);
        ids.add(id);
        return { id, name: nonEmpty(s?.name, '阶段名') };
    });
    // 已归档的卡片不挡删阶段：它们不在列里、也不能移动；恢复时原阶段不在了就回第一个阶段
    for (const c of b.cards)
        if (c.g === gId && !c.archivedAt && !ids.has(c.col)) {
            const lost = g.statuses.find((s) => s.id === c.col);
            throw new BoardError('STATUS_IN_USE', '「' + (lost ? lost.name : c.col) + '」下还有卡片「' + c.t + '」，先移走再删除');
        }
    g.statuses = clean;
}
export function cleanRepos(v) {
    if (!Array.isArray(v))
        throw new BoardError('BAD_ARG', 'repos 必须是数组');
    const out = [];
    for (const r of v) {
        const name = nonEmpty(r?.name, '仓库名');
        const path = nonEmpty(r?.path, '仓库路径');
        if (!path.startsWith('/'))
            throw new BoardError('BAD_ARG', '仓库路径必须是绝对路径：' + path);
        if (out.some((x) => x.name === name))
            throw new BoardError('BAD_ARG', '仓库名重复：' + name);
        out.push({ name, role: typeof r.role === 'string' && r.role.trim() ? r.role.trim() : '仓库', path });
    }
    return out;
}
/**
 * 追加挂载仓库（「添加挂载仓库」弹窗的保存）：逐个校验后一次性追加，任一冲突整批不写。
 * 同一路径不能挂两次；名称不能与本组已有或本批其他项重名（repos/<组>/<名> 软链路径由名称决定）。
 */
export function addRepos(b, gId, v, canon = (p) => p) {
    const g = group(b, gId);
    // canon = 真实路径（软链 / macOS 的 /tmp→/private/tmp）：与 dsh 工作区的规范路径一致，重复挂载才判得准
    const add = cleanRepos(v).map((r) => ({ ...r, path: canon(r.path) }));
    if (add.length === 0)
        throw new BoardError('BAD_ARG', '没有要挂载的仓库');
    const norm = (p) => p.replace(/\/+$/, '') || '/';
    for (const r of add) {
        const clashName = g.repos.find((x) => x.name === r.name);
        if (clashName)
            throw new BoardError('REPO_NAME_TAKEN', '「' + g.name + '」已有同名仓库「' + r.name + '」（' + clashName.path + '），换个名字');
        const clashPath = g.repos.find((x) => norm(x.path) === norm(r.path));
        if (clashPath)
            throw new BoardError('REPO_MOUNTED', r.path + ' 已挂载在「' + g.name + '」（名称「' + clashPath.name + '」）');
    }
    if (new Set(add.map((r) => norm(r.path))).size !== add.length)
        throw new BoardError('BAD_ARG', '同一路径选了两次');
    g.repos = g.repos.concat(add);
    return g.repos;
}
export function setGroupLinks(b, gId, links) {
    group(b, gId).links = dedupe(links);
}
export function addCard(b, gId, title, links = [], col) {
    const g = group(b, gId);
    const target = (col ? status(g, col) : g.statuses[0]).id;
    const c = { id: newId('c'), g: gId, col: target, order: cellCards(b, gId, target).length, t: nonEmpty(title, '卡片标题'), links: dedupe(links), tasks: [] };
    b.cards.push(c);
    return c;
}
export function updateCard(b, id, patch) {
    const c = liveCard(b, id);
    if (patch.t !== undefined)
        c.t = nonEmpty(patch.t, '卡片标题');
    if (patch.links !== undefined)
        c.links = dedupe(patch.links).filter((k) => !group(b, c.g).links.includes(k));
    return c;
}
export function removeCard(b, id) {
    const c = card(b, id);
    b.cards = b.cards.filter((x) => x.id !== id);
    renumber(cellCards(b, c.g, c.col));
    b.sessions = b.sessions.filter((s) => s.cardId !== id);
}
/**
 * 移动卡片（跨阶段/跨组/组内排序）。beforeId = 插到这张卡之前；缺省 = 放到末尾。
 * 返回事件（供审计写 events.jsonl）。
 */
export function moveCard(b, id, to, actor) {
    const c = liveCard(b, id);
    const gId = to.g ?? c.g;
    const g = group(b, gId);
    const dest = status(g, to.col);
    const fromG = group(b, c.g);
    const crossing = c.col !== dest.id || c.g !== gId;
    const fromName = status(fromG, c.col).name;
    const oldCell = cellCards(b, c.g, c.col).filter((x) => x.id !== id);
    c.g = gId;
    c.col = dest.id;
    const peers = cellCards(b, gId, dest.id).filter((x) => x.id !== id);
    let idx = to.beforeId ? peers.findIndex((x) => x.id === to.beforeId) : -1;
    if (idx < 0)
        idx = peers.length;
    peers.splice(idx, 0, c);
    renumber(peers);
    if (crossing)
        renumber(oldCell);
    return { at: new Date().toISOString(), actor, kind: crossing ? 'move' : 'reorder', card: id, group: gId, from: fromName, to: dest.name };
}
export function setTasks(b, id, tasks) {
    liveCard(b, id).tasks = tasks.map((t) => ({ text: nonEmpty(t.text, '子任务'), done: t.done === true }));
}
/** 相关说明：原样保存（只统一换行、去掉 NUL）；全是空白 = 清空。不限字数，受 HTTP 体上限约束。 */
export function setNotes(b, id, text) {
    if (typeof text !== 'string')
        throw new BoardError('BAD_ARG', 'notes 必须是字符串');
    const c = liveCard(b, id);
    const v = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    if (v.trim() === '')
        delete c.notes;
    else
        c.notes = v;
    return c;
}
/** 相关文件路径：必须是绝对路径、不含控制字符；去掉末尾分隔符。 */
const filePath = (v) => {
    if (typeof v !== 'string' || v.trim() === '')
        throw new BoardError('BAD_ARG', '文件路径不能为空');
    const p = v.trim().replace(/\/+$/, '');
    if (!p.startsWith('/'))
        throw new BoardError('BAD_ARG', '文件路径必须是绝对路径：' + v);
    if (/[\u0000-\u001f\u007f]/.test(p))
        throw new BoardError('BAD_ARG', '文件路径含控制字符：' + JSON.stringify(v));
    if (p.length > 4096)
        throw new BoardError('BAD_ARG', '文件路径过长');
    return p;
};
/** 追加相关文件：逐个校验，任一非法整批不写；已关联的跳过。返回实际新增数与跳过数。 */
export function addFiles(b, id, paths) {
    const c = liveCard(b, id);
    if (!Array.isArray(paths) || paths.length === 0)
        throw new BoardError('BAD_ARG', '没有要添加的文件');
    const clean = paths.map(filePath);
    const cur = c.files ?? [];
    let added = 0;
    for (const p of clean)
        if (!cur.includes(p)) {
            cur.push(p);
            added++;
        }
    c.files = cur;
    return { added, skipped: clean.length - added };
}
/** 解除关联：只从列表移除，不碰文件本身。 */
export function removeFile(b, id, path) {
    const c = liveCard(b, id);
    if (typeof path !== 'string' || !(c.files ?? []).includes(path))
        throw new BoardError('NOT_LINKED', '卡片「' + c.t + '」没有关联这个文件：' + String(path));
    c.files = c.files.filter((p) => p !== path);
    if (!c.files.length)
        delete c.files;
}
export const DEFAULT_LINK_TYPES = ['文档', '代码'];
export const linkTypes = (b) => b.linkTypes ?? DEFAULT_LINK_TYPES.slice();
/** 新增全局「类型」选项（已有则不变）；类型名同名称类字段规则，限 20 字。 */
export function addLinkType(b, name) {
    const v = nonEmpty(name, '类型');
    if (v.length > 20)
        throw new BoardError('BAD_ARG', '类型超过 20 字');
    const ts = linkTypes(b);
    if (!ts.includes(v))
        ts.push(v);
    b.linkTypes = ts;
    return v;
}
/** 网址简单校验：只收 http(s)；没写协议但像域名 → 补 https://；不能有空白/控制字符。返回规范化后的网址。 */
export function normUrl(v) {
    if (typeof v !== 'string' || v.trim() === '')
        throw new BoardError('BAD_URL', '请填写完整链接');
    let s = v.trim();
    if (/[\s\u0000-\u001f\u007f]/.test(s))
        throw new BoardError('BAD_URL', '链接里不能有空格或换行：' + s);
    if (!/^https?:\/\//i.test(s)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d/.test(s))
            throw new BoardError('BAD_URL', '只支持 http:// 或 https:// 开头的链接：' + s);
        s = 'https://' + s;
    }
    let u;
    try {
        u = new URL(s);
    }
    catch {
        throw new BoardError('BAD_URL', '链接格式不对：' + v);
    }
    if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !u.hostname.startsWith('['))
        throw new BoardError('BAD_URL', '域名不完整：' + u.hostname);
    if (u.href.length > 4096)
        throw new BoardError('BAD_URL', '链接过长');
    return u.href;
}
/** 相关链接整表替换（新增 / 编辑 / 删除 / 排序都走这里）：逐条校验，任一非法整批不写；没见过的类型自动加入全局选项。 */
export function setWebLinks(b, id, list) {
    const c = liveCard(b, id);
    if (!Array.isArray(list))
        throw new BoardError('BAD_ARG', 'links 必须是数组');
    const clean = list.map((x, i) => {
        const o = (x ?? {});
        try {
            const url = normUrl(o.url);
            const text = typeof o.text === 'string' && o.text.trim() ? nonEmpty(o.text, '显示文字') : url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 60);
            return { text, type: nonEmpty(o.type ?? DEFAULT_LINK_TYPES[0], '类型'), url };
        }
        catch (e) {
            throw e instanceof BoardError ? new BoardError(e.code, '第 ' + (i + 1) + ' 条：' + e.message) : e;
        }
    });
    for (const l of clean)
        addLinkType(b, l.type);
    if (clean.length)
        c.webLinks = clean;
    else
        delete c.webLinks;
    return c;
}
/** osascript「choose file」的输出：每行一个 POSIX 路径。 */
export function parsePicked(out) {
    return out.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => p.replace(/\/+$/, ''));
}
/** 会话实际读取的记忆：卡片组关联 ∪ 卡片关联，去重保序，标注来源。 */
export function memoryOf(b, c) {
    const g = group(b, c.g);
    const out = [];
    for (const k of g.links)
        out.push({ key: k, from: 'group' });
    for (const k of c.links) {
        const hit = out.find((x) => x.key === k);
        if (hit)
            hit.from = 'both';
        else
            out.push({ key: k, from: 'card' });
    }
    return out;
}
/** 一个会话只属于一张卡片：重复绑定以最新一次为准。 */
export function bindSession(b, sessionId, cardId, title) {
    liveCard(b, cardId);
    b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId);
    b.sessions.unshift({ sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}) });
}
/**
 * 手动关联已有会话（批量）：每个会话只属于一张卡片，已在别的卡片上的移过来；
 * readKeys 由调用方按会话记录算好（读过的 STATE 不再注入）。返回从别的卡片移过来的数量。
 */
/**
 * 卡片没有任何记忆（卡片组 ∪ 卡片都没关联）时，找标题里包含其 slug 的落盘项目作为「同名」建议；
 * slug 至少 6 个字符防误配，多个命中取最长的。只做建议，不自动关联。
 */
export function sameNameState(b, c, states) {
    if (memoryOf(b, c).length)
        return null;
    const t = c.t.toLowerCase();
    let hit = null;
    for (const s of states)
        if (s.slug.length >= 6 && t.includes(s.slug.toLowerCase()) && (!hit || s.slug.length > hit.slug.length))
            hit = s;
    return hit;
}
export function bindMany(b, cardId, items) {
    liveCard(b, cardId);
    if (!Array.isArray(items) || items.length === 0)
        throw new BoardError('BAD_ARG', '没有要关联的会话');
    const ids = new Set();
    let moved = 0;
    for (const it of items) {
        if (typeof it?.sessionId !== 'string' || !/^[\w.:-]{1,128}$/.test(it.sessionId))
            throw new BoardError('BAD_ARG', '无效的会话 id：' + String(it?.sessionId));
        if (ids.has(it.sessionId))
            throw new BoardError('BAD_ARG', '同一会话选了两次：' + it.sessionId);
        ids.add(it.sessionId);
    }
    for (const it of items) {
        const prev = b.sessions.find((s) => s.sessionId === it.sessionId);
        if (prev && prev.cardId !== cardId)
            moved++;
        b.sessions = b.sessions.filter((s) => s.sessionId !== it.sessionId);
        const title = typeof it.title === 'string' && it.title.trim() ? it.title.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, 200) : prev?.title;
        const readKeys = Array.isArray(it.readKeys) ? it.readKeys.filter((k) => typeof k === 'string') : [];
        b.sessions.unshift({ sessionId: it.sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}), ...(readKeys.length ? { readKeys } : {}) });
    }
    return { linked: items.length, moved };
}
/** 解除关联：会话本身不动，只删绑定。 */
export function unbindSession(b, sessionId) {
    const ref = b.sessions.find((s) => s.sessionId === sessionId);
    if (!ref)
        throw new BoardError('NOT_LINKED', '会话没有关联任何卡片：' + sessionId);
    b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId);
    return ref;
}
/**
 * 会话记录里 read 过哪些 STATE.md（直接调用 read 与 run_code 内调用 read 两种事件都算）。
 * paths: key → STATE 绝对路径；返回读过的 key。
 */
export function readKeysFromEvents(events, paths) {
    const want = new Map();
    for (const [k, p] of paths)
        want.set(p, k);
    const hit = new Set();
    for (const ev of events) {
        let name;
        let args;
        if (ev.type === 'tool/call') {
            const d = ev.data;
            name = d?.name;
            try {
                args = typeof d?.arguments === 'string' ? JSON.parse(d.arguments) : d?.arguments;
            }
            catch {
                continue;
            }
        }
        else if (ev.type === 'tool/ptc-dispatch' || ev.type === 'tool/ptc-dispatch-start') {
            const d = ev.data;
            name = d?.name;
            args = d?.arguments;
        }
        else
            continue;
        if (name !== 'read')
            continue;
        const fp = args?.file_path;
        if (typeof fp !== 'string')
            continue;
        const k = want.get(fp);
        if (k)
            hit.add(k);
    }
    return [...paths.keys()].filter((k) => hit.has(k));
}
export function cardOfSession(b, sessionId) {
    const ref = b.sessions.find((s) => s.sessionId === sessionId);
    return ref ? b.cards.find((c) => c.id === ref.cardId) : undefined;
}
export function sessionRef(b, sessionId) { return b.sessions.find((s) => s.sessionId === sessionId); }
function dedupe(list) {
    if (!Array.isArray(list))
        throw new BoardError('BAD_ARG', 'links 必须是数组');
    const out = [];
    for (const k of list) {
        const seg = typeof k === 'string' ? k.split('/') : [];
        const okSeg = (x) => x !== '' && !x.startsWith('.') && !/[\u0000-\u001f\u007f\\]/.test(x) && x.length <= 200;
        if (seg.length !== 2 || !seg.every(okSeg))
            throw new BoardError('BAD_LINK', '无效的落盘项目 ' + String(k) + '（格式 <project>/<slug>）');
        if (!out.includes(k))
            out.push(k);
    }
    return out;
}
/**
 * 读盘后的结构校验：坏文件 fail loud，不静默丢数据。
 * 0.1.x 升级：阶段上的 cat（类别）/ gate（证据门）与卡片上的 ev（证据）不再使用，读入时丢掉；
 * 阶段 id、名称、顺序与卡片位置原样保留，下次写盘即为新格式。events.jsonl 里的历史证据不动。
 */
export function parseBoard(raw) {
    const b = raw;
    if (!b || b.version !== 1 || !Array.isArray(b.groups) || !Array.isArray(b.cards))
        throw new BoardError('BAD_BOARD', 'board.json 结构无效');
    if (!Array.isArray(b.sessions))
        b.sessions = [];
    for (const g of b.groups) {
        if (!Array.isArray(g.statuses))
            throw new BoardError('BAD_BOARD', 'board.json 结构无效：卡片组「' + String(g.name) + '」缺少阶段');
        g.statuses = g.statuses.map((s) => ({ id: s.id, name: s.name }));
    }
    for (const c of b.cards)
        delete c.ev;
    return b;
}
//# sourceMappingURL=model.js.map