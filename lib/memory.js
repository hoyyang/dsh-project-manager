/**
 * 0.18 会话注入与卡片档案（纯函数）。
 * - cardSection：卡片档案（实时）——系统提示里唯一的一份卡片资料，每步按看板现生成。
 * - cardBlock：写进 STATE 的「卡片档案块」（按看板生成、AI 不写）；stripBlock / placeBlock / maskBlock 处理它。
 * - memoryText：系统提示单段 = 卡片档案（实时）+ 记忆索引（每个关联落盘项目一行摘要 + 版本）。STATE 全文不进系统提示，
 *   由 landfill.autoRead 在会话里注入最新版（见 landfill.ts）。
 */
import { group, groupMounts, linksOfKey, memoryOf } from './model.js';
export const BLOCK_TITLE = '## 🗂 卡片档案（dsh-project-manager 按看板生成，勿手改；以看板为准）';
const OPEN = '<!-- dpm:card';
const CLOSE = '<!-- /dpm:card -->';
export const MASK = '（本卡片的卡片档案见系统提示「卡片档案（实时）」，这里省略以免重复）';
/** 按 UTF-8 字节截断（不切坏多字节字符）。 */
function cutBytes(s, max) {
    const buf = Buffer.from(s, 'utf8');
    if (buf.length <= max)
        return s;
    return buf.subarray(0, max).toString('utf8').replace(/\uFFFD+$/, '');
}
const fence = (s) => ['```text', s.replace(/```/g, '\u02cb\u02cb\u02cb'), '```'];
const norm = (p) => p.replace(/\/+$/, '') || '/';
/** 一张卡片的档案正文（不含标题）：位置、上级总览、仓库、子任务、链接、文件、说明。 */
export function cardLines(b, c, o, skipKey) {
    const g = group(b, c.g);
    const st = g.statuses.find((s) => s.id === c.col)?.name ?? c.col;
    const max = o.maxItems ?? Infinity;
    const cap = (l) => l.slice(0, max);
    const more = (n) => (n > max ? ['  - …另有 ' + (n - max) + ' 条，见看板'] : []);
    const out = ['- 卡片「' + c.t + '」（' + c.id + '）· 卡片组「' + g.name + '」· 阶段「' + st + '」' + (c.archivedAt ? ' · 已归档 ' + c.archivedAt.slice(0, 10) : '')];
    const up = g.links.filter((k) => k !== skipKey);
    if (up.length)
        out.push('- 上级总览（卡片组关联的落盘项目）：' + up.join('、'));
    const own = c.links.filter((k) => k !== skipKey);
    if (skipKey && own.length)
        out.push('- 这张卡片还关联：' + own.join('、'));
    const repos = c.repos ?? [];
    if (repos.length) {
        out.push('- 仓库（' + repos.length + '）' + (o.mounts ? '：会话目录里 repos/<名>/ 是软链接，读写用这个路径（仓库自己的 AGENTS.md / CLAUDE.md 才会加载）' : '：'));
        for (const r of repos) {
            const n = o.mounts?.get(norm(r.path));
            out.push('  - ' + r.name + '（' + r.role + '）：' + (n ? 'repos/' + n + '/ → ' : '') + r.path);
        }
    }
    const tasks = c.tasks ?? [];
    if (tasks.length)
        out.push('- 子任务（' + tasks.filter((t) => t.done).length + '/' + tasks.length + ' 完成）：', ...cap(tasks).map((t) => '  - [' + (t.done ? 'x' : ' ') + '] ' + t.text), ...more(tasks.length));
    const links = c.webLinks ?? [];
    if (links.length)
        out.push('- 相关链接：', ...cap(links).map((l) => '  - [' + l.text.replace(/[[\]]/g, '') + '](' + l.url + ')（' + l.type + '）'), ...more(links.length));
    const files = c.files ?? [];
    if (files.length)
        out.push('- 相关文件（绝对路径）：', ...cap(files).map((p) => '  - ' + p), ...more(files.length));
    const notes = (c.notes ?? '').trim();
    if (notes) {
        const cut = cutBytes(notes, o.notesMax);
        out.push('- 相关说明（用户原文）：', ...fence(cut));
        if (cut.length < notes.length)
            out.push('  （说明超过 ' + o.notesMax + ' 字节，已截断；全文在项目看板这张卡片的「相关说明」里）');
    }
    if (o.boardPath)
        out.push('- 权威来源：' + o.boardPath + ' → cards[id=' + c.id + ']');
    return out;
}
/** 系统提示里的卡片档案（实时）。 */
export function cardSection(b, c, notesMax = 16000) {
    return ['### 卡片档案（实时，以看板为准）', ...cardLines(b, c, { notesMax, mounts: groupMounts(b, c.g) })].join('\n');
}
/** 组级 STATE：同组卡片清单。 */
function groupLines(b, g, key) {
    const cards = b.cards.filter((c) => c.g === g.id);
    const out = ['- 卡片组「' + g.name + '」（' + g.id + '）关联了本落盘项目（组级总览）；同组卡片 ' + cards.length + ' 张：'];
    for (const c of cards.slice(0, 50)) {
        const st = g.statuses.find((s) => s.id === c.col)?.name ?? c.col;
        const ks = c.links.filter((k) => k !== key);
        out.push('  - 「' + c.t + '」· ' + st + (c.archivedAt ? '（已归档）' : '') + (ks.length ? ' · STATE：' + ks.join('、') : ''));
    }
    if (cards.length > 50)
        out.push('  - …另有 ' + (cards.length - 50) + ' 张，见看板');
    return out;
}
/** 写进 STATE 的卡片档案块；没有任何卡片 / 卡片组关联这个 key → 空串。卡片级最多 5 张。 */
export function cardBlock(b, key, at, boardPath) {
    const { cards, groups } = linksOfKey(b, key);
    if (!cards.length && !groups.length)
        return '';
    const shown = cards.slice(0, 5);
    const out = [BLOCK_TITLE, OPEN + ' v1 key=' + key + ' cards=' + shown.map((c) => c.id).join(',') + ' groups=' + groups.map((g) => g.id).join(',') + ' synced=' + at + ' -->'];
    for (const c of shown)
        out.push('', '### 卡片「' + c.t + '」', ...cardLines(b, c, { notesMax: 2000, maxItems: 30, boardPath }, key));
    if (cards.length > shown.length)
        out.push('', '（另有 ' + (cards.length - shown.length) + ' 张卡片也关联了它，见看板）');
    for (const g of groups)
        out.push('', '### 卡片组「' + g.name + '」', ...groupLines(b, g, key));
    out.push(CLOSE);
    return out.join('\n');
}
/**
 * 档案块在文本里的位置 [起, 止)（含标题行与结尾换行）；没有 → null。
 * 只认独占一行的开始标记（<!-- dpm:card v<n> key=…）和独占一行的结束标记：正文里引用标记文字不算（0.18 门 12 实测误删半节）；
 * 没有结束标记 = 不是完整的块，不动。
 */
export function blockRange(text) {
    const m = /^<!-- dpm:card v\d+ key=\S+[^\n]*-->[ \t]*$/m.exec(text);
    if (!m)
        return null;
    const o = m.index;
    const c = /^<!-- \/dpm:card -->[ \t]*$/m.exec(text.slice(o));
    if (!c)
        return null;
    const prevNl = text.lastIndexOf('\n', o - 2);
    const prevLine = text.slice(prevNl + 1, o).trim();
    const start = prevLine.startsWith('## 🗂 卡片档案') ? prevNl + 1 : o;
    let end = o + c.index + c[0].length;
    if (text[end] === '\n')
        end++;
    return [start, end];
}
export const blockOf = (text) => { const r = blockRange(text); return r ? text.slice(r[0], r[1]) : ''; };
/** 去掉档案块（及其后多出的一个空行）。 */
export function stripBlock(text) {
    const r = blockRange(text);
    if (!r)
        return text;
    let [s, e] = r;
    if (text[e] === '\n' && (s === 0 || text[s - 1] === '\n'))
        e++;
    return text.slice(0, s) + text.slice(e);
}
/** 比较两块是否等价（忽略 synced 时间）。 */
export const sameBlock = (x, y) => x.replace(/ synced=\S+/, '') === y.replace(/ synced=\S+/, '');
/** 档案块写的是哪些卡片。 */
export function blockCards(text) { const m = /<!-- dpm:card [^>]*?cards=([^\s]*)/.exec(text); return m && m[1] ? m[1].split(',') : []; }
/** 剥旧块，插到「重启读取清单」那一节后面（没有就插在标题行后）；block 为空 = 只剥。 */
export function placeBlock(draft, block) {
    const t = stripBlock(draft);
    if (!block)
        return t;
    const h = /^## .*重启读取清单.*$/m.exec(t);
    let at;
    if (h) {
        const n = t.slice(h.index + h[0].length).search(/^## /m);
        at = n < 0 ? t.length : h.index + h[0].length + n;
    }
    else {
        const nl = t.indexOf('\n');
        at = nl < 0 ? t.length : nl + 1;
    }
    const before = t.slice(0, at).replace(/\n*$/, '\n\n');
    const after = t.slice(at);
    return before + block + '\n' + (after ? '\n' + after.replace(/^\n+/, '') : '');
}
/** 原文 [o,e) 这一段里，若含本卡片的档案块 → 换成一行占位（区间仍按原文计）。cardId 不在块里 = 原样。 */
export function maskBlock(text, o, e, cardId) {
    const r = blockRange(text);
    if (!r || !cardId || !blockCards(text.slice(r[0], r[1])).includes(cardId) || r[1] <= o || r[0] >= e)
        return text.slice(o, e);
    const s = Math.max(o, r[0]);
    const t = Math.min(e, r[1]);
    return text.slice(o, s) + (r[0] >= o ? MASK + '\n' : '') + text.slice(t, e);
}
/** 系统提示单段：卡片档案（实时）+ 记忆索引。索引按字节预算从后往前省略并注明。 */
export function memoryText(b, c, index, maxBytes = 6000, notesMaxBytes = 16000) {
    const g = group(b, c.g);
    const head = ['## dsh-project-manager：本会话的项目记忆', '卡片组「' + g.name + '」· 卡片「' + c.t + '」。本段每一步都按看板与磁盘现生成，始终是最新的。', '', cardSection(b, c, notesMaxBytes), '', '### 落盘项目（/landfill-project）'];
    if (!index.length)
        return head.concat('（没有关联落盘项目）').join('\n');
    const blocks = index.map((m) => {
        const s = m.state;
        if (!s)
            return '- ' + m.key + '：未找到 STATE（可能已被移动或删除）';
        return ['- ' + m.key + '（' + (m.from === 'group' ? '来自卡片组' : m.from === 'card' ? '来自卡片' : '卡片组+卡片') + '）',
            ...(m.full ? [] : ['  状态：' + (s.status || '（STATE 未写一行状态）'), '  next_action：' + (s.next || '（未写）')]),
            '  STATE：' + s.path,
            ...(m.required?.length ? ['  必读子文档：' + m.required.join('、')] : [])].join('\n');
    });
    const out = head.slice();
    let used = Buffer.byteLength(out.join('\n'));
    const omitted = [];
    blocks.forEach((blk, i) => {
        const n = Buffer.byteLength(blk) + 1;
        if (used + n > maxBytes + Buffer.byteLength(head.join('\n'))) {
            omitted.push(index[i].key);
            return;
        }
        out.push(blk);
        used += n;
    });
    if (omitted.length)
        out.push('（另有 ' + omitted.length + ' 个落盘项目因长度预算省略，名单：' + omitted.join('、') + '）');
    if (index.some((m) => m.full))
        out.push('状态、next_action 与全文（STATE + 必读子文档）见会话里插件注入的「项目记忆全文」（总是磁盘最新版，别处改了下一步自动补新版）；上下文里找不到时（例如压缩后）用 landfill op=recall 读完。');
    return out.join('\n');
}
export { memoryOf };
//# sourceMappingURL=memory.js.map