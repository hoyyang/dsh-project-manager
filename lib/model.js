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
export function status(g, id) {
    const s = g.statuses.find((x) => x.id === id);
    if (!s)
        throw new BoardError('NO_STATUS', '卡片组「' + g.name + '」没有阶段 ' + id);
    return s;
}
/** 同组同阶段内按 order 排序后的卡片。 */
export function cellCards(b, gId, col) {
    return b.cards.filter((c) => c.g === gId && c.col === col).sort((a, c) => a.order - c.order);
}
function renumber(list) { list.forEach((c, i) => { c.order = i; }); }
export function addGroup(b, name) {
    const g = { id: newId('g'), name: nonEmpty(name, '组名'), collapsed: false, repos: [], links: [], statuses: defaultStatuses() };
    b.groups.push(g);
    return g;
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
    for (const c of b.cards)
        if (c.g === gId && !ids.has(c.col)) {
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
    const c = card(b, id);
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
    const c = card(b, id);
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
    card(b, id).tasks = tasks.map((t) => ({ text: nonEmpty(t.text, '子任务'), done: t.done === true }));
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
    card(b, cardId);
    b.sessions = b.sessions.filter((s) => s.sessionId !== sessionId);
    b.sessions.unshift({ sessionId, cardId, createdAt: new Date().toISOString(), ...(title ? { title } : {}) });
}
/**
 * 手动关联已有会话（批量）：每个会话只属于一张卡片，已在别的卡片上的移过来；
 * readKeys 由调用方按会话记录算好（读过的 STATE 不再注入）。返回从别的卡片移过来的数量。
 */
export function bindMany(b, cardId, items) {
    card(b, cardId);
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