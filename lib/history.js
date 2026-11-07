/** 一页多少条（v94 设计：200 条 / 页；上限 400 防止一次拉爆内存）。 */
export const HISTORY_PAGE = 200;
export const HISTORY_PAGE_MAX = 400;
/** user/message 的正文：只取 text 块，多块换行拼接。 */
export function messageText(data) {
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => String(b.text)).join('\n').trim();
}
/** 事件时间 → ISO 字符串（拿不到就给空串，界面显示为空）。 */
export function eventAt(t) {
    if (typeof t === 'number')
        return new Date(t).toISOString();
    if (typeof t === 'string' && t) {
        const d = new Date(t);
        return Number.isNaN(d.getTime()) ? t : d.toISOString();
    }
    return '';
}
/** spliced 事件里 inserted 的用户条目正文（排队 / 插话的每条消息各有 content + source）。
 * 防御性约定：一条 splice 若带多条用户消息（正常流程一次一条），正文用空行连接成一条，
 * 保证一行对应一个事件 seq（客户端的选中键 = 会话 + seq，同 seq 两行会互相顶掉）。 */
function splicedTexts(data) {
    const items = (Array.isArray(data.inserted) ? data.inserted : []);
    return items.filter((it) => it && it.source?.kind === 'user').map((it) => messageText(it)).filter(Boolean);
}
/** 一条事件 → 一条历史消息；不是用户自己发的 / 空正文 → null。
 * v94 补口：`agent/inbox/spliced` 里 inserted 的用户条目（回合进行中排队 / 插话，消费时不补写
 * user/message）也出一条。单独用它会和正式 user/message 重复计一条 —— 跨事件去重用 historyRows。 */
export function historyRow(ev) {
    const data = ev.data ?? {};
    if (ev.type === 'agent/inbox/spliced') {
        const texts = splicedTexts(data);
        return texts.length ? { seq: Number(ev.seq ?? 0), at: eventAt(ev.time), text: texts.join('\n\n') } : null;
    }
    const src = data.source;
    if (src?.kind !== 'user')
        return null;
    const seq = Number(ev.seq ?? 0);
    const at = eventAt(ev.time);
    if (ev.type === 'user/message') {
        const text = messageText(data);
        return text ? { seq, at, text } : null;
    }
    if (ev.type === 'command/run' && data.name === 'goal') {
        const args = typeof data.args === 'string' ? data.args : '';
        return { seq, at, text: ('/goal' + args).trim() };
    }
    return null;
}
/** 事件里的 source.rpcId（同一份数据先以 spliced 入账、再以 user/message 入账时两者相同）。 */
const rpcIdOf = (data) => {
    const id = data.source?.rpcId;
    return typeof id === 'string' && id ? id : undefined;
};
/**
 * 整条事件流 → 历史消息（乱序安全：historyPage 会按 seq 排）。
 * 与逐条 historyRow 的差别在跨事件去重：同一 rpcId 的 spliced 与 user/message 只留一条，
 * 有正式 user/message 就用它的 seq / 时间（spliced 只是占位）。其余事件各自成行。
 */
export function historyRows(events) {
    const rows = [];
    const byRpc = new Map();
    const add = (row) => {
        if (row.rpcId && byRpc.has(row.rpcId)) {
            // 已有同源行：只有正式 user/message 能占那个位置（覆盖占位的 spliced 行）
            if (row.official)
                rows[byRpc.get(row.rpcId)] = { seq: row.seq, at: row.at, text: row.text };
            return;
        }
        if (row.rpcId)
            byRpc.set(row.rpcId, rows.length);
        rows.push({ seq: row.seq, at: row.at, text: row.text });
    };
    for (const ev of events) {
        const data = ev.data ?? {};
        const seq = Number(ev.seq ?? 0);
        const at = eventAt(ev.time);
        if (ev.type === 'user/message') {
            if (data.source?.kind !== 'user')
                continue;
            const text = messageText(data);
            if (!text)
                continue;
            add({ seq, at, text, rpcId: rpcIdOf(data), official: true });
            continue;
        }
        if (ev.type === 'command/run' && data.name === 'goal') {
            const args = typeof data.args === 'string' ? data.args : '';
            add({ seq, at, text: ('/goal' + args).trim() });
            continue;
        }
        if (ev.type === 'agent/inbox/spliced') {
            const texts = splicedTexts(data);
            if (!texts.length)
                continue;
            const items = (Array.isArray(data.inserted) ? data.inserted : []);
            const id = items.filter((it) => it && it.source?.kind === 'user').map((it) => it.source?.rpcId).find((x) => typeof x === 'string' && !!x);
            add({ seq, at, text: texts.join('\n\n'), rpcId: id });
            continue;
        }
    }
    return rows;
}
/**
 * 翻页：before = 上一页最旧那条的 seq（只返回 seq < before 的），不给 = 从最新一条开始。
 * 从新到旧、每页 limit（默认 200，夹在 1–400）。
 */
export function historyPage(all, o = {}) {
    const limit = Math.max(1, Math.min(HISTORY_PAGE_MAX, Math.floor(o.limit ?? HISTORY_PAGE) || HISTORY_PAGE));
    const desc = [...all].sort((a, b) => b.seq - a.seq);
    const at = o.before === undefined ? 0 : desc.findIndex((m) => m.seq < o.before);
    const from = at < 0 ? desc.length : at;
    const page = desc.slice(from, from + limit);
    return { messages: page, total: all.length, hasMore: from + page.length < desc.length, before: page.length ? page[page.length - 1].seq : null };
}
//# sourceMappingURL=history.js.map