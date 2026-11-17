export const baseName = (p) => {
    const s = String(p ?? '');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
};
/** 文件在不在某个目录下（不要求目录存在，纯字符串；目录结尾的 / 去掉）。 */
export const underDir = (path, dir) => {
    const d = dir.replace(/\/+$/, '');
    return path === d || path.startsWith(d + '/');
};
const flat = (list, out = [], sub = false) => {
    for (const t of list ?? []) {
        out.push(t);
        if (t.subs?.length)
            flat(t.subs, out, true);
    }
    return out;
};
/** 这棵任务树里绑了 fileId 的任务 / 子任务（sub = 是否子任务）。 */
export function bindsOf(c, fileId) {
    const out = [];
    const walk = (list, sub) => {
        for (const t of list ?? []) {
            if (t.files?.includes(fileId))
                out.push({ id: String(t.id ?? ''), text: String(t.text ?? ''), done: t.done === true, sub });
            if (t.subs?.length)
                walk(t.subs, true);
        }
    };
    walk(c.tasks, false);
    return out;
}
export function cleanupRows(b, dirsOf, sizeOf) {
    const drafts = [];
    const groupName = new Map();
    for (const g of b.groups ?? [])
        groupName.set(g.id, g.name);
    for (const c of b.cards ?? []) {
        const dirs = dirsOf(c).filter((x) => typeof x === 'string' && x.startsWith('/'));
        for (const f of c.files ?? []) {
            const path = String(f.path ?? '');
            drafts.push({
                c,
                fileId: String(f.id ?? path),
                name: baseName(path),
                path,
                binds: bindsOf(c, String(f.id ?? '')),
                inScope: dirs.some((d) => underDir(path, d)),
            });
        }
    }
    /* 按路径汇总：还有几张活跃卡片、还有几个未完成任务 / 子任务、一共几张卡片 */
    const agg = new Map();
    for (const d of drafts) {
        let a = agg.get(d.path);
        if (!a) {
            a = { cards: new Set(), active: 0, undone: 0, done: 0 };
            agg.set(d.path, a);
        }
        a.cards.add(d.c.id);
        if (!d.c.archivedAt)
            a.active++;
        for (const bd of d.binds) {
            if (bd.done)
                a.done++;
            else
                a.undone++;
        }
    }
    const rows = [];
    const outside = [];
    for (const d of drafts) {
        const a = agg.get(d.path);
        const pathActive = a?.active ?? 0;
        const pathUndone = a?.undone ?? 0;
        const pathDone = a?.done ?? 0;
        const useless = pathActive === 0 && pathUndone === 0;
        /* v181：任务都完成 = 本行卡片未归档 + 本行关联过已完成的任务/子任务 + 同路径 0 个未完成 */
        const ownDone = d.binds.some((bd) => bd.done);
        const reason = useless
            ? 'arch'
            : (!d.c.archivedAt ? (ownDone && pathUndone === 0 ? 'done' : 'active') : (pathActive > 0 ? 'shared' : 'undone'));
        if (!d.inScope) {
            outside.push({ cardId: d.c.id, cardTitle: d.c.t, name: d.name, path: d.path, why: '不在卡片关联的落盘项目文件夹里' });
            continue;
        }
        const info = sizeOf ? sizeOf(d.path) : { size: 0, exists: true };
        rows.push({
            key: d.c.id + '|' + d.fileId,
            cardId: d.c.id,
            cardTitle: d.c.t,
            groupId: d.c.g,
            groupName: groupName.get(d.c.g) ?? '',
            archived: !!d.c.archivedAt,
            archivedAt: d.c.archivedAt ?? '',
            fileId: d.fileId,
            name: d.name,
            path: d.path,
            size: info.size,
            exists: info.exists,
            binds: d.binds,
            useless,
            reason,
            pathActive,
            pathUndone,
            pathDone,
            pathCards: a?.cards.size ?? 1,
        });
    }
    const counts = { all: rows.length, useless: 0, done: 0, arch: 0, busy: 0, missing: 0 };
    let uselessSize = 0;
    let totalSize = 0;
    for (const r of rows) {
        if (r.useless) {
            counts.useless++;
            if (r.exists && r.pathCards <= 1)
                uselessSize += r.size;
        }
        else
            counts.busy++;
        if (r.reason === 'done')
            counts.done++;
        if (r.archived)
            counts.arch++;
        if (!r.exists)
            counts.missing++;
        totalSize += r.size;
    }
    return { rows, outside, counts, uselessSize, totalSize };
}
/** 删除动作对一条路径到底能做什么：没有文件（已丢失）/ 别的卡片也在用 → 只能解除关联。 */
export const canTrash = (r) => r.exists && r.pathCards <= 1;
//# sourceMappingURL=cleanup.js.map