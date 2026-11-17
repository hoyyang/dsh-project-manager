export const DIM_ORDER = ['task', 'note', 'link', 'file', 'kb', 'title', 'lf'];
export const DIM_NAME = { task: '任务', note: '说明', link: '链接', file: '文件', kb: '知识卡', title: '标题', lf: '落盘项目' };
/** 前缀定维：任务: / 子任务: / 说明: / 链接: / 文件: / 知识卡: / 标题: / 落盘项目: */
export const PREFIX = [['相关说明', 'note'], ['相关链接', 'link'], ['相关文件', 'file'], ['落盘项目', 'lf'], ['子任务', 'task'], ['知识卡', 'kb'], ['任务', 'task'], ['说明', 'note'], ['链接', 'link'], ['文件', 'file'], ['标题', 'title'], ['落盘', 'lf']];
const SKIP = /[\s\u3000·・()（）\[\]【】「」『』"'“”‘’:：,，.。!！?？\/\\|_\-—–~～+*#@<>《》=]+/;
const KIND_ORDER = { card: 0, group: 1, lf: 2 };
/* ---------- 归一 / 分词 ---------- */
export function norm(s) {
    const t = String(s == null ? '' : s).normalize('NFKC');
    let out = '';
    const map = [];
    for (let i = 0; i < t.length; i++) {
        const ch = t[i].toLowerCase();
        if (SKIP.test(ch))
            continue;
        out += ch;
        map.push(i);
    }
    return { out, map, src: t };
}
export const key = (s) => norm(s).out;
export function tokens(q) {
    return String(q == null ? '' : q).normalize('NFKC').toLowerCase().split(/[\s\u3000,，、;；|/]+/).map((x) => key(x)).filter(Boolean).slice(0, 5);
}
/* ---------- 模糊：子序列 / 1 字容错 ---------- */
export function lev(a, b, max) {
    const n = a.length, m = b.length;
    if (Math.abs(n - m) > max)
        return max + 1;
    let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++)
        prev[j] = j;
    for (let i = 1; i <= n; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= m; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            cur[j] = v;
            if (v < rowMin)
                rowMin = v;
        }
        if (rowMin > max)
            return max + 1;
        const t = prev;
        prev = cur;
        cur = t;
    }
    return prev[m];
}
export function subseq(field, tok) {
    if (tok.length < 2 || tok.length > field.length + 2)
        return null;
    const pos = [];
    let j = 0;
    for (let i = 0; i < field.length && j < tok.length; i++) {
        if (field[i] === tok[j]) {
            pos.push(i);
            j++;
        }
    }
    if (j < tok.length)
        return null;
    const span = pos[pos.length - 1] - pos[0] + 1;
    if (span > Math.max(8, tok.length * 3 + 2))
        return null;
    if (tok.length / span < 0.5)
        return null;
    return pos;
}
export function typos(field, tok) {
    const n = tok.length;
    if (n < 4 || field.length < n - 1)
        return null;
    for (let L = n - 1; L <= n + 1; L++) {
        if (L > field.length)
            break;
        for (let i = 0; i + L <= field.length; i++) {
            const w = field.slice(i, i + L);
            if (lev(tok, w, 1) <= 1)
                return { start: i, len: L };
        }
    }
    return null;
}
export function field(id, label, text, w, lfKey, strict, dim) {
    const n = norm(text);
    return { id, label, text: String(text == null ? '' : text), src: n.src, norm: n.out, map: n.map, w, lfKey: lfKey || '', strict: !!strict, dim: dim || 'title' };
}
const CONTENT_MAX = 18;
const slice = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; };
const taskKey = (t, i) => (t.id ? String(t.id) : 'i' + i);
/**
 * v178：一张卡片的「内容字段」——任务 / 任务说明 / 子任务 / 子任务说明 / 相关说明 / 相关链接 / 相关文件 / 挂载知识卡。
 * 只给非空字段建 Field（空字段不该命中）；说明正文截前 4000 字（命中片段本来也只给 200 字内）。
 */
export function contentFields(c, kbOf) {
    const out = [];
    const tasks = c.tasks ?? [];
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i], k = taskKey(t, i);
        if (t.text)
            out.push(field('task:' + k, '任务', t.text, 44, '', false, 'task'));
        if (t.note)
            out.push(field('tasknote:' + k, '任务说明', slice(t.note, 4000), 30, '', false, 'task'));
        const subs = t.subs ?? [];
        for (let j = 0; j < subs.length; j++) {
            const s = subs[j], sk = k + 's' + j;
            if (s.text)
                out.push(field('sub:' + sk, '子任务', s.text, 42, '', false, 'task'));
            if (s.note)
                out.push(field('subnote:' + sk, '子任务说明', slice(s.note, 4000), 28, '', false, 'task'));
        }
    }
    const notes = c.noteItems ?? [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.t)
            out.push(field('note:' + i, '说明', n.t, 40, '', false, 'note'));
        if (n.v)
            out.push(field('notebody:' + i, '说明正文', slice(n.v, 4000), 32, '', false, 'note'));
    }
    const links = c.webLinks ?? [];
    for (let i = 0; i < links.length; i++) {
        const l = links[i], k = l.id || 'i' + i;
        const head = [l.text, l.type, l.tag].filter((x) => !!x && String(x).trim()).join(' ');
        if (head)
            out.push(field('link:' + k, '链接', head, 38, '', false, 'link'));
        if (l.url)
            out.push(field('linkurl:' + k, '链接网址', l.url, 26, '', false, 'link'));
    }
    const files = c.files ?? [];
    for (const f of files) {
        if (!f || !f.id)
            continue;
        const name = slice(f.title || f.path.split('/').pop() || f.path, 300);
        if (name)
            out.push(field('file:' + f.id, '文件', name, 40, '', false, 'file'));
        if (f.path)
            out.push(field('filep:' + f.id, '文件路径', f.path, 22, '', false, 'file'));
    }
    for (const m of c.kb ?? []) {
        const k = kbOf ? kbOf(m.id) : undefined;
        if (!k)
            continue;
        if (k.title)
            out.push(field('kb:' + k.id, '知识卡', k.title, 42, '', false, 'kb'));
        if (k.summary)
            out.push(field('kbs:' + k.id, '知识卡摘要', slice(k.summary, 400), 30, '', false, 'kb'));
        for (let i = 0; i < (k.tags ?? []).length; i++)
            out.push(field('kbt:' + k.id + ':' + i, '知识卡标签', (k.tags ?? [])[i], 26, '', false, 'kb'));
    }
    return out;
}
/** v178：整份索引里各类内容条数（空态「能搜什么」用）。 */
export function contentTotals(input) {
    const kbOf = kbIndex(input);
    const out = { task: 0, sub: 0, note: 0, link: 0, file: 0, kb: 0 };
    for (const c of input.cards) {
        for (const f of contentFields(c, kbOf)) {
            const d = f.dim;
            if (d === 'task') {
                if (f.id.startsWith('task:'))
                    out.task++;
                else if (f.id.startsWith('sub:'))
                    out.sub++;
            }
            else if (d === 'note') {
                if (f.id.startsWith('note:'))
                    out.note++;
            }
            else if (d === 'link') {
                if (f.id.startsWith('link:'))
                    out.link++;
            }
            else if (d === 'file') {
                if (f.id.startsWith('file:'))
                    out.file++;
            }
            else if (d === 'kb') {
                if (f.id.startsWith('kb:'))
                    out.kb++;
            }
        }
    }
    out.task += out.sub;
    return out;
}
export function kbIndex(input) {
    const m = new Map();
    for (const k of input.kb ?? [])
        m.set(k.id, k);
    return (id) => m.get(id);
}
/** v178：查询里的前缀（「任务:回归」）—— 只定维度，不改变关键词。 */
export function parseQuery(q) {
    const s = String(q == null ? '' : q).trim();
    for (const [w, d] of PREFIX) {
        if (!s.startsWith(w) || !/^\s*[:：]/.test(s.slice(w.length)))
            continue;
        const rest = s.slice(w.length).replace(/^\s*[:：]\s*/, '').trim();
        /* 冒号后面没字 = 不是前缀（当普通关键词搜，免得空维度出来一片空表） */
        if (rest)
            return { dim: d, text: rest, pre: w };
    }
    return { dim: null, text: s, pre: '' };
}
/** 单字段匹配：全等 112 / 前缀 86 / 包含 62（词边界 +6）> 子序列（34 起）> 容错 26；strict 只做精确 + 包含。 */
export function matchField(f, tok) {
    const fld = f.norm;
    if (!fld)
        return null;
    let best = null;
    const idx = fld.indexOf(tok);
    if (idx >= 0) {
        const exact = idx === 0 && fld.length === tok.length;
        const prefix = idx === 0;
        let score = exact ? 112 : prefix ? 86 : 62;
        if (idx > 0) {
            const prev = f.src[f.map[idx] - 1] || '';
            if (/[\s·・_\-—/|,，、:：]/.test(prev))
                score += 6;
        }
        score += Math.round(8 * (tok.length / Math.max(1, fld.length)));
        if (tok.length < 2)
            score = Math.min(score, 30);
        best = { score, fuzzy: false, ranges: [[f.map[idx], f.map[idx + tok.length - 1] + 1]] };
    }
    if (!best && !f.strict) {
        const latin = /^[a-z0-9][a-z0-9._-]*$/.test(tok);
        if (!latin || tok.length >= 3) {
            const sub = subseq(fld, tok);
            if (sub) {
                const ranges = [];
                for (const p of sub)
                    ranges.push([f.map[p], f.map[p] + 1]);
                const span = sub[sub.length - 1] - sub[0] + 1;
                best = { score: 34 + Math.round((tok.length / span) * 8), fuzzy: true, ranges };
            }
        }
    }
    if ((!best || best.score < 40) && !f.strict) {
        const ty = typos(fld, tok);
        if (ty) {
            const ranges = [];
            for (let k = 0; k < ty.len; k++)
                ranges.push([f.map[ty.start + k], f.map[ty.start + k] + 1]);
            if (!best || 26 >= best.score - 6)
                best = { score: 26, fuzzy: true, ranges };
        }
    }
    return best;
}
/* ---------- 索引 ---------- */
export function groupArchived(g, cards) {
    return !!g.archivedAt || (cards.length > 0 && cards.every((c) => !!c.archivedAt));
}
export function stageOf(g, c) {
    return g.statuses.find((s) => s.id === c.col)?.name ?? '';
}
function lfOf(k, states) {
    const s = states.get(k);
    const p = k.split('/');
    return { key: k, project: s?.project ?? p[0] ?? '', slug: s?.slug ?? (p[1] ?? k), status: s?.status ?? '', updated: s?.updated ?? '', aliases: s?.aliases ?? [] };
}
/** v178：索引记忆化（按快照 rev；内容字段让每次查询都有 1.4k 字段要建，不能每敲一个键重建一遍）。 */
let cacheRev = '';
let cacheAll = null;
export function buildEntries(input) {
    const rv = input.rev == null ? '' : 'r' + input.rev;
    if (rv && cacheAll && cacheRev === rv && cacheAll.length)
        return cacheAll;
    const built = buildEntriesRaw(input);
    if (rv) {
        cacheRev = rv;
        cacheAll = built;
    }
    return built;
}
function buildEntriesRaw(input) {
    const byKey = new Map();
    for (const s of input.states)
        byKey.set(s.key, s);
    const kbOf = kbIndex(input);
    const out = [];
    let ord = 0;
    const perGroup = input.groups.map((g) => ({ g, cards: input.cards.filter((c) => c.g === g.id).sort((a, b) => a.order - b.order) }));
    const linkMap = new Map();
    const addLink = (k, v) => {
        const arr = linkMap.get(k);
        if (arr) {
            if (!arr.some((x) => x.card.id === v.card.id && x.from === v.from))
                arr.push(v);
        }
        else
            linkMap.set(k, [v]);
    };
    for (const { g, cards } of perGroup) {
        for (const c of cards) {
            for (const k of c.links ?? [])
                addLink(k, { card: c, group: g, from: 'card' });
            for (const k of g.links ?? [])
                addLink(k, { card: c, group: g, from: 'group' });
        }
    }
    const archOf = (k) => { const l = linkMap.get(k) ?? []; return l.length > 0 && l.every((x) => !!x.card.archivedAt); };
    for (const { g, cards } of perGroup) {
        for (const c of cards) {
            const cardLinks = c.links ?? [], groupLinks = g.links ?? [];
            const keys = [];
            for (const k of cardLinks)
                if (keys.indexOf(k) < 0)
                    keys.push(k);
            for (const k of groupLinks)
                if (keys.indexOf(k) < 0)
                    keys.push(k);
            const mem = keys.map((k) => ({
                key: k,
                from: cardLinks.indexOf(k) >= 0 ? (groupLinks.indexOf(k) >= 0 ? 'both' : 'card') : 'group',
                arch: archOf(k)
            }));
            const fields = [
                field('title', '标题', c.t, 100),
                field('group', '组名', g.name, 36),
                field('stage', '阶段', stageOf(g, c), 22, '', true),
                field('status', '状态', (c.archivedAt ? '已归档 archive archived ' + c.archivedAt : '活跃 active ') + (c.pending ? 'pending 待办 ' : ''), 16, '', true),
                field('id', '卡片 id', c.id, 6, '', true)
            ];
            for (const m of mem) {
                const lf = lfOf(m.key, byKey);
                fields.push(field('lf:' + m.key, '落盘项目', lf.slug, 54, m.key));
                fields.push(field('lfp:' + m.key, '落盘项目', lf.project, 20, m.key, true));
                for (let ai = 0; ai < lf.aliases.length; ai++)
                    fields.push(field('lfa:' + m.key + ':' + ai, '落盘项目', lf.aliases[ai], 46, m.key));
            }
            for (const f of contentFields(c, kbOf))
                fields.push(f);
            out.push({ kind: 'card', id: c.id, card: c, group: g, mem, arch: !!c.archivedAt, scope: c.archivedAt ? 'arch' : 'live', titleText: c.t, ord: ord++, fields, updated: c.archivedAt ?? '' });
        }
    }
    for (const { g, cards } of perGroup) {
        const arch = groupArchived(g, cards);
        const fields = [
            field('title', '卡片组', g.name, 100),
            field('status', '状态', arch ? '已归档 archive archived' : '活跃 active', 16, '', true),
            field('id', '卡片组 id', g.id, 6, '', true)
        ];
        for (const k of g.links ?? []) {
            const lf = lfOf(k, byKey);
            fields.push(field('lf:' + k, '落盘项目', [lf.slug].concat(lf.aliases).join(' '), 40, k));
        }
        out.push({ kind: 'group', id: g.id, group: g, mem: (g.links ?? []).map((k) => ({ key: k, from: 'group', arch: archOf(k) })), n: cards.length, liveN: cards.filter((c) => !c.archivedAt).length, arch, scope: arch ? 'arch' : 'live', titleText: g.name, ord: ord++, fields });
    }
    const keys = [];
    for (const k of linkMap.keys())
        keys.push(k);
    keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) {
        const linked = (linkMap.get(k) ?? []).slice().sort((a, b) => (a.card.archivedAt ? 1 : 0) - (b.card.archivedAt ? 1 : 0) || (a.from === 'group' ? 1 : 0) - (b.from === 'group' ? 1 : 0));
        const lf = lfOf(k, byKey);
        const arch = linked.every((x) => !!x.card.archivedAt);
        const fields = [field('title', '名称', lf.slug, 100), field('project', '项目', lf.project, 30, '', true), field('status', '状态', lf.status, 18, '', true)];
        for (let i = 0; i < lf.aliases.length; i++)
            fields.push(field('alias:' + i, '别名', lf.aliases[i], 70));
        fields.push(field('key', 'key', lf.key, 42, '', true));
        out.push({ kind: 'lf', id: lf.key, key: lf.key, lf, linked, arch, scope: arch ? 'arch' : 'live', titleText: lf.slug, ord: ord++, fields, updated: lf.updated });
    }
    return out;
}
/* ---------- 匹配 / 排序 / 模型 ---------- */
export function matchEntry(e, toks) {
    let total = 0;
    let fuzzy = false;
    const hits = {};
    const labels = [];
    for (const tok of toks) {
        let best = null;
        for (const f of e.fields) {
            const m = matchField(f, tok);
            if (!m)
                continue;
            const sc = m.score + f.w;
            if (!best || sc > best.sc)
                best = { sc, m, f };
        }
        if (!best)
            return null;
        total += best.sc;
        if (best.m.fuzzy)
            fuzzy = true;
        const prev = hits[best.f.id];
        if (prev) {
            prev.ranges = prev.ranges.concat(best.m.ranges);
            prev.fuzzy = prev.fuzzy || best.m.fuzzy;
        }
        else
            hits[best.f.id] = { ranges: best.m.ranges.slice(), fuzzy: best.m.fuzzy, label: best.f.label, lfKey: best.f.lfKey, src: best.f.src };
        const lab = { label: best.f.label, lfKey: best.f.lfKey, fuzzy: best.m.fuzzy };
        if (!labels.some((x) => x.label === lab.label && x.lfKey === lab.lfKey && x.fuzzy === lab.fuzzy))
            labels.push(lab);
    }
    const titleF = e.fields.find((f) => f.id === 'title');
    if (titleF && toks.every((t) => !!matchField(titleF, t)))
        total += 36;
    if (toks.length === 1 && key(e.titleText) === toks[0])
        total += 150;
    else if (titleF && titleF.norm.indexOf(toks[0]) === 0)
        total += 22;
    if (e.kind === 'card' && labels.some((x) => x.lfKey))
        total += 12;
    if (e.arch)
        total -= 4;
    /* v178：内容命中要「每一处都列出来」——上面只记了每个 token 最好的那一个字段，这里把内容字段全扫一遍 */
    let content;
    if (e.kind === 'card') {
        const byFid = new Map();
        for (const f of e.fields) {
            if (!f.dim || f.dim === 'title')
                continue;
            let rs = [];
            let fz = false;
            for (const tok of toks) {
                const m = matchField(f, tok);
                if (!m)
                    continue;
                rs = rs.concat(m.ranges);
                fz = fz || m.fuzzy;
            }
            if (!rs.length)
                continue;
            byFid.set(f.id, { fid: f.id, dim: f.dim, label: f.label, text: f.src, ranges: rs, w: f.w, fuzzy: fz });
        }
        if (byFid.size)
            content = [...byFid.values()].sort((a, b) => DIM_ORDER.indexOf(a.dim) - DIM_ORDER.indexOf(b.dim) || b.w - a.w || (a.fid < b.fid ? -1 : 1)).slice(0, CONTENT_MAX);
    }
    return { entry: e, score: total, fields: hits, labels: labels.slice(0, 2), fuzzy, content };
}
export function rank(a, b) {
    if (b.score !== a.score)
        return b.score - a.score;
    const k = KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind];
    if (k)
        return k;
    if (a.entry.scope !== b.entry.scope)
        return a.entry.scope === 'live' ? -1 : 1;
    return a.entry.ord - b.entry.ord;
}
export function browseRank(a, b) {
    const k = KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind];
    if (k)
        return k;
    if (a.entry.scope !== b.entry.scope)
        return a.entry.scope === 'live' ? -1 : 1;
    return a.entry.ord - b.entry.ord;
}
export function model(input, q) {
    const toks = q ? tokens(q) : [];
    const all = buildEntries(input);
    let base = [];
    if (toks.length) {
        for (const e of all) {
            const r = matchEntry(e, toks);
            if (r)
                base.push(r);
        }
        base.sort(rank);
    }
    else {
        base = all.map((e) => ({ entry: e, score: 0, fields: {}, labels: [], fuzzy: false }));
        base.sort(browseRank);
    }
    const counts = { all: base.length, live: 0, arch: 0 };
    const typeCounts = { all: base.length, card: 0, group: 0, lf: 0 };
    for (const r of base) {
        if (r.entry.scope === 'arch')
            counts.arch++;
        else
            counts.live++;
        typeCounts[r.entry.kind]++;
    }
    const totals = { all: all.length, card: 0, group: 0, lf: 0 };
    for (const e of all)
        totals[e.kind]++;
    return { q, tokens: toks, all, base, counts, typeCounts, totals };
}
const LF_ID = /^(lf:|lfp:|lfa:)/;
const CONTENT_ID = /^(task:|tasknote:|sub:|subnote:|note:|notebody:|link:|linkurl:|file:|filep:|kb:|kbs:|kbt:)/;
/** v178：这一行命中了哪些维度。 */
export function rowDims(r) {
    const set = new Set();
    if (r.entry.kind === 'lf') {
        set.add('lf');
        return [...set];
    }
    if (r.entry.kind === 'group') {
        set.add('title');
        return [...set];
    }
    for (const h of r.content ?? [])
        set.add(h.dim);
    for (const id of Object.keys(r.fields)) {
        if (LF_ID.test(id))
            set.add('lf');
        else if (!CONTENT_ID.test(id))
            set.add('title');
    }
    return [...set];
}
export function dimCounts(rows) {
    const out = { all: rows.length, title: 0, task: 0, note: 0, link: 0, file: 0, kb: 0, lf: 0 };
    for (const r of rows)
        for (const d of rowDims(r))
            out[d] = (out[d] || 0) + 1;
    return out;
}
/** v178：命中片段 —— 窗口切在第一个命中前面一点，命中字带区间，过长两头省略。 */
export function snip(text, ranges, before = 24, max = 130) {
    const src = String(text == null ? '' : text).replace(/\s+/g, ' ');
    if (!src)
        return { text: '', ranges: [], head: false, tail: false };
    const rs = ranges.slice().sort((a, b) => a[0] - b[0]);
    const first = rs.length ? rs[0][0] : 0;
    let a = Math.max(0, first - before);
    let b = Math.min(src.length, a + max);
    if (b - a < max)
        a = Math.max(0, b - max);
    /* 起点别把一个词劈开：往回找一个空格 */
    if (a > 0) {
        const sp = src.indexOf(' ', a);
        if (sp >= 0 && sp < Math.min(src.length, a + 12))
            a = sp + 1;
    }
    const out = [];
    for (const r of rs) {
        const x = Math.max(a, Math.min(b, r[0])), y = Math.max(a, Math.min(b, r[1]));
        if (y > x)
            out.push([x - a, y - a]);
    }
    return { text: src.slice(a, b), ranges: out, head: a > 0, tail: b < src.length };
}
export function filtered(m, scope, type, dim) {
    return m.base.filter((r) => {
        if (scope !== 'all' && r.entry.scope !== scope)
            return false;
        if (type !== 'all' && r.entry.kind !== type)
            return false;
        if (dim && dim !== 'all' && rowDims(r).indexOf(dim) < 0)
            return false;
        return true;
    });
}
/** v178：一行里按当前维度该显示哪些内容命中（维度筛选时只显示这一类）。 */
export function shownHits(r, dim) {
    const list = r.content ?? [];
    const out = dim && dim !== 'all' && dim !== 'title' && dim !== 'lf' ? list.filter((h) => h.dim === dim) : list;
    return out.slice(0, CONTENT_MAX);
}
export function rowList(list) {
    return list.slice().sort((a, b) => KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]);
}
export function lcs(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m)
        return 0;
    let prev = new Array(m + 1).fill(0), cur = new Array(m + 1).fill(0), best = 0;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
            if (cur[j] > best)
                best = cur[j];
        }
        const t = prev;
        prev = cur;
        cur = t;
        for (let j = 0; j <= m; j++)
            cur[j] = 0;
    }
    return best;
}
export function suggest(q, all, limit = 2) {
    const qk = key(q);
    if (!qk)
        return [];
    const scored = [];
    for (const e of all) {
        if (e.kind === 'lf')
            continue;
        const t = key(e.titleText);
        if (!t)
            continue;
        const sc = lcs(qk, t) / Math.max(4, Math.min(qk.length, t.length));
        if (sc >= 0.24)
            scored.push({ e, sc });
    }
    scored.sort((a, b) => b.sc - a.sc);
    const out = [];
    for (const s of scored) {
        if (!out.some((x) => x.e.titleText === s.e.titleText))
            out.push(s);
        if (out.length >= limit)
            break;
    }
    return out;
}
//# sourceMappingURL=search.js.map