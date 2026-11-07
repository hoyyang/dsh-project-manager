export const DAY = 86400000;
export const ZL_KEYS = ['pause', 'wait', 'run', 'un'];
const pad = (n) => String(n).padStart(2, '0');
/** 本地日（与界面一致；跨时区按用户机器）。 */
export const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
export const dayMs = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
/** 合法日：格式对、且回写一致（挡掉 2026-02-31 这类会被 Date 归一化的值）。 */
export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && ymd(dayMs(v)) === v;
export const todayKey = (now = Date.now()) => ymd(now);
/** 建卡时间：newId('c') = 'c' + Date.now().toString(36)（8 位）+ 序号；旧卡兜底 updatedAt。 */
/** ISO 时间 → 本机日期 yyyy-mm-dd（拿不到 = 空串）。 */
const localDay = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime()))
    return ''; const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
export function cardCreated(c) {
    const m = /^c([0-9a-z]{8})/.exec(c.id);
    /* 只认「像正常建卡时间」的 id：老/测试卡（如 cv60width）会解出 2047 年这种未来时间，退回 updatedAt */
    if (m) {
        const t = parseInt(m[1], 36);
        if (t > 1.5e12 && t <= Date.now() + DAY)
            return t;
    }
    return Date.parse(c.updatedAt ?? '') || Date.now();
}
/** 这段卡片的「归档 / 恢复」历史（events.jsonl 的 card/archive、card/unarchive，按时间升序）。 */
export function archiveTimes(events, cardId) {
    const out = [];
    for (const e of events) {
        if (e.card !== cardId)
            continue;
        if (e.kind !== 'card/archive' && e.kind !== 'card/unarchive')
            continue;
        const t = Date.parse(e.at);
        if (!Number.isFinite(t))
            continue;
        out.push({ at: t, on: e.kind === 'card/unarchive' });
    }
    return out.sort((a, b) => a.at - b.at);
}
/** 有效计划日：只认手动设置 / 拖动过的日子（v96 起没有默认段）。 */
export function planDays(_c, st, _events = [], _now = Date.now()) {
    return new Set((st?.plan ?? []).filter(isDay));
}
/** 有效实际日：{day → src}；autoOff 的会话自动失效，手动记录优先。 */
export function actualDays(st, auto) {
    const off = new Set(st?.autoOff ?? []);
    const manual = new Set((st?.actual ?? []).filter(isDay));
    const out = new Map();
    for (const d of auto)
        if (isDay(d) && !off.has(d))
            out.set(d, 'auto');
    for (const d of manual)
        out.set(d, 'manual');
    return out;
}
/** 手动改一天计划：以当前集合为底，改完存成完整逐日集合。 */
export function applyPlanDay(st, cur, key, on) {
    if (!isDay(key))
        return [...cur].sort();
    if (on)
        cur.add(key);
    else
        cur.delete(key);
    st.plan = [...cur].sort();
    return st.plan;
}
/** 手动改一段（拖把手）：from 含、to 不含（yyyy-mm-dd）。 */
export function applyPlanRange(st, cur, from, to, on) {
    let a = dayMs(from), b = dayMs(to);
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return [...cur].sort();
    if (b < a)
        [a, b] = [b, a];
    for (let t = a; t < b; t += DAY) {
        const k = ymd(t);
        if (on)
            cur.add(k);
        else
            cur.delete(k);
    }
    st.plan = [...cur].sort();
    return st.plan;
}
const uniq = (a) => [...new Set(a)].sort();
/** 任意入口（格子小窗 / 任务面板）的手动改执行：先关掉这天的会话自动，再写 / 删手动记录。 */
export function setActualDay(c, key, on) {
    if (!isDay(key))
        return;
    c.autoOff = uniq([...(c.autoOff ?? []), key]);
    c.actual = uniq(on ? [...(c.actual ?? []), key] : (c.actual ?? []).filter((x) => x !== key));
}
/* ── v105 每日任务面板：按天勾选（当天完成）/ 选中（排今天）/ 排布（lanes） ── */
/** 这张卡片合法的任务项 key（p|卡片 / t|卡片|任务 / s|卡片|子任务）；非法 key 一律挡在写盘外。 */
export function taskKeySet(c) {
    const s = new Set();
    s.add('p|' + c.id);
    /** 一层任务 = t|，再往下的子任务 = s|（key 的层级必须和界面的 p / t / s 一一对上，否则写盘会被当成非法 key 丢掉）。 */
    const walk = (l, sub) => {
        for (const t of l) {
            if (t.id)
                s.add((sub ? 's|' : 't|') + c.id + '|' + t.id);
            if (t.subs && t.subs.length)
                walk(t.subs, true);
        }
    };
    walk(c.tasks ?? [], false);
    return s;
}
const panelKeys = (v, valid) => {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const x of v) {
        if (typeof x !== 'string' || x.length > 160 || !valid.has(x))
            continue;
        if (!out.includes(x))
            out.push(x);
    }
    return out.slice(0, 4000);
};
/** v121（1.2 根因）：集合字段（done / sel）排序后存，比对稳定；lanes / zl 的行内顺序 = 用户拖出来的顺序，不能排。 */
const panelSet = (v, valid) => panelKeys(v, valid).sort();
/** 行结构（lanes / zl[z]）：保序、跨行去重、只留合法 key。 */
const panelRows = (v, valid, seen, keep) => {
    const rows = [];
    if (!Array.isArray(v))
        return rows;
    for (const lane of v.slice(0, 400)) {
        if (!Array.isArray(lane))
            continue;
        const l = [];
        for (const k of panelKeys(lane, valid)) {
            if ((keep && !keep.has(k)) || seen.has(k))
                continue;
            seen.add(k);
            l.push(k);
        }
        if (l.length)
            rows.push(l.slice(0, 40));
    }
    return rows;
};
const ZONES = new Set(['done', 'wait', 'pause', 'run', 'arr', 'un']);
/** 多张卡片合起来的合法任务项 key（写入时挡掉过期 / 伪造的 key）。 */
export function taskKeySetAll(cards) {
    const s = new Set();
    for (const c of cards)
        for (const k of taskKeySet(c))
            s.add(k);
    return s;
}
/** 写一天的面板状态（done / sel / lanes 都可单独传；空 = 删掉那一项）。非法 key 丢弃，不报错。 */
export function setPanelDay(st, key, patch, valid) {
    if (!isDay(key))
        throw new Error('任务面板的日期必须是 yyyy-mm-dd：' + key);
    const panels = st.panels ?? (st.panels = {});
    const cur = panels[key] ?? (panels[key] = {});
    /* 卡片 / 任务被删掉后留下的旧 key：每次写盘顺手清掉，不让状态越积越多 */
    if (cur.done) {
        const a = panelSet(cur.done, valid);
        if (a.length)
            cur.done = a;
        else
            delete cur.done;
    }
    if (cur.sel) {
        const a = panelSet(cur.sel, valid);
        if (a.length)
            cur.sel = a;
        else
            delete cur.sel;
    }
    if ('done' in patch) {
        const list = panelSet(patch.done, valid);
        if (list.length)
            cur.done = list;
        else
            delete cur.done;
    }
    if ('sel' in patch) {
        const list = panelSet(patch.sel, valid);
        if (list.length)
            cur.sel = list;
        else
            delete cur.sel;
    }
    if ('lanes' in patch) {
        const lanes = panelRows(patch.lanes, valid, new Set(), new Set(cur.sel ?? []));
        if (lanes.length)
            cur.lanes = lanes;
        else
            delete cur.lanes;
    }
    else if (cur.lanes) {
        /* 只改勾选 / 选中时也要把旧排布对齐到新的选中集合：取消选中后不许留下指向未选中项的 lanes */
        const sel = new Set(cur.sel ?? []);
        const seen = new Set();
        const lanes = cur.lanes.map((l) => l.filter((k) => sel.has(k) && valid.has(k) && !seen.has(k) && (seen.add(k), true))).filter((l) => l.length);
        if (lanes.length)
            cur.lanes = lanes;
        else
            delete cur.lanes;
    }
    /* v110：执行 / 暂停状态落盘（pst）。非法 key 丢弃；只改勾选 / 选中时按新的选中集合裁一遍。 */
    if ('pst' in patch) {
        const src = patch.pst;
        const out = {};
        const sel = new Set(cur.sel ?? []);
        if (src && typeof src === 'object' && !Array.isArray(src)) {
            for (const [k, v] of Object.entries(src)) {
                /* 只认「合法 + 还排在今天」的 key：没选中的项不该留着执行态 */
                if (!valid.has(k) || !sel.has(k))
                    continue;
                if (v === 'run' || v === 'pause' || v === 'wait')
                    out[k] = v;
            }
        }
        if (Object.keys(out).length)
            cur.pst = out;
        else
            delete cur.pst;
    }
    else if (cur.pst) {
        const sel = new Set(cur.sel ?? []);
        const keep = {};
        for (const [k, v] of Object.entries(cur.pst))
            if (sel.has(k) && valid.has(k))
                keep[k] = v;
        if (Object.keys(keep).length)
            cur.pst = keep;
        else
            delete cur.pst;
    }
    /* v111：续排标记（true = 这天已经跑过自动续排）。单独存在也保留这一天 —— 用户把续排进来的项全取消后，同一天不会再自动补一遍。 */
    if ('carry' in patch) {
        if (patch.carry === true)
            cur.carry = true;
        else
            delete cur.carry;
    }
    /* v122/v123：四个「行」分区（个人暂停 / 等外部 / 执行中 / 未安排）的排布 —— 保序，只留排在今天的 key */
    if ('zl' in patch) {
        const src = patch.zl && typeof patch.zl === 'object' && !Array.isArray(patch.zl) ? patch.zl : {};
        const sel = new Set(cur.sel ?? []);
        const seen = new Set();
        const zl = {};
        for (const z of ZL_KEYS) {
            const rows = panelRows(src[z], valid, seen, sel);
            if (rows.length)
                zl[z] = rows;
        }
        if (Object.keys(zl).length)
            cur.zl = zl;
        else
            delete cur.zl;
    }
    else if (cur.zl) {
        const sel = new Set(cur.sel ?? []);
        const seen = new Set();
        const zl = {};
        for (const z of ZL_KEYS) {
            const rows = panelRows(cur.zl[z], valid, seen, sel);
            if (rows.length)
                zl[z] = rows;
        }
        if (Object.keys(zl).length)
            cur.zl = zl;
        else
            delete cur.zl;
    }
    /* v122：记录执行的时间；v123：记录执行那一刻的来源分区 —— 都只跟着 done 走 */
    const doneSet = new Set(cur.done ?? []);
    if ('doneAt' in patch) {
        const src = patch.doneAt && typeof patch.doneAt === 'object' && !Array.isArray(patch.doneAt) ? patch.doneAt : {};
        const out = {};
        for (const [k, v] of Object.entries(src))
            if (doneSet.has(k) && typeof v === 'number' && Number.isFinite(v) && v > 0)
                out[k] = Math.round(v);
        if (Object.keys(out).length)
            cur.doneAt = out;
        else
            delete cur.doneAt;
    }
    else if (cur.doneAt) {
        const out = {};
        for (const [k, v] of Object.entries(cur.doneAt))
            if (doneSet.has(k))
                out[k] = v;
        if (Object.keys(out).length)
            cur.doneAt = out;
        else
            delete cur.doneAt;
    }
    if ('from' in patch) {
        const src = patch.from && typeof patch.from === 'object' && !Array.isArray(patch.from) ? patch.from : {};
        const out = {};
        for (const [k, v] of Object.entries(src))
            if (doneSet.has(k) && typeof v === 'string' && ZONES.has(v) && v !== 'done')
                out[k] = v;
        if (Object.keys(out).length)
            cur.from = out;
        else
            delete cur.from;
    }
    else if (cur.from) {
        const out = {};
        for (const [k, v] of Object.entries(cur.from))
            if (doneSet.has(k))
                out[k] = v;
        if (Object.keys(out).length)
            cur.from = out;
        else
            delete cur.from;
    }
    if (!cur.done && !cur.sel && !cur.lanes && !cur.pst && !cur.carry && !cur.zl) {
        delete panels[key];
        if (!Object.keys(panels).length)
            delete st.panels;
        return null;
    }
    return cur;
}
/* ── v99 截止时间：同一天多个 + 硬性 / 软性 ── */
export const ddlIdOf = (d) => d.id || d.at;
export const ddlKindOf = (d) => (d.kind === 'soft' ? 'soft' : 'hard');
const sortDdl = (l) => { l.sort((a, b) => a.at.localeCompare(b.at) || ddlIdOf(a).localeCompare(ddlIdOf(b))); };
/** 加一条截止时间（同一天可以加多个）；返回新条目。 */
export function addDdl(c, key, kind = 'hard', label = '') {
    if (!isDay(key))
        throw new Error('截止时间必须是 yyyy-mm-dd：' + key);
    const list = c.ddl ?? (c.ddl = []);
    let n = 1;
    for (const d of list) {
        const m = /^d(\d+)$/.exec(ddlIdOf(d));
        if (m)
            n = Math.max(n, Number(m[1]) + 1);
    }
    const it = { id: 'd' + n, at: key, kind: kind === 'soft' ? 'soft' : 'hard' };
    if (label)
        it.label = label;
    list.push(it);
    sortDdl(list);
    return it;
}
/* ── v101 截止重复：一条规则展开成多条（共享 sid），删除按「这条 / 及以后 / 整系列」 ── */
export const DDL_REP_MAX = 120;
/** 重复展开的窗口上界（今天 + 400 天；再远不铺，避免把状态写爆）。 */
export const DDL_REP_HORIZON = 400;
/** 按单位往后走 n 步（月会夹到月末，避免 1/31 + 1 月跳到 3/3）。 */
export function repStep(key, unit, n = 1) {
    const [y, m, d] = key.split('-').map(Number);
    if (unit === 'day')
        return ymd(new Date(y, m - 1, d + n).getTime());
    if (unit === 'week')
        return ymd(new Date(y, m - 1, d + 7 * n).getTime());
    const total = (m - 1) + n;
    const ny = y + Math.floor(total / 12);
    const nm = (total % 12 + 12) % 12;
    const last = new Date(ny, nm + 1, 0).getDate();
    return ymd(new Date(ny, nm, Math.min(d, last)).getTime());
}
/**
 * 加一条（或按规则展开成多条）截止时间。
 * - 没有 rep / rep.unit 非法 → 就是一条，行为与 v99 一致；
 * - 有 rep → 从 key 起按 unit 走，直到 until（含当天）或 +400 天 / 120 条封顶；每条共享 sid。
 */
export function addDdlRepeat(c, key, kind = 'hard', label = '', rep) {
    if (!isDay(key))
        throw new Error('截止时间必须是 yyyy-mm-dd：' + key);
    const unit = rep?.unit;
    if (!unit || (unit !== 'day' && unit !== 'week' && unit !== 'month'))
        return [addDdl(c, key, kind, label)];
    const n = Math.max(1, Math.min(12, Math.round(rep?.n ?? 1)));
    const until = rep?.until && isDay(rep.until) ? rep.until : undefined;
    const list = c.ddl ?? (c.ddl = []);
    let maxId = 0, maxSid = 0;
    for (const d of list) {
        const m = /^d(\d+)$/.exec(ddlIdOf(d));
        if (m)
            maxId = Math.max(maxId, Number(m[1]));
        const ms = /^ds(\d+)$/.exec(d.sid ?? '');
        if (ms)
            maxSid = Math.max(maxSid, Number(ms[1]));
    }
    const sid = 'ds' + (maxSid + 1);
    const rule = { unit, n, ...(until ? { until } : {}) };
    const out = [];
    const limit = ymd(Date.now() + DDL_REP_HORIZON * 86400000);
    let cur = key;
    for (let i = 0; i < DDL_REP_MAX; i++) {
        if (until && cur > until)
            break;
        if (cur > limit)
            break;
        const it = { id: 'd' + (maxId + 1 + i), at: cur, kind: kind === 'soft' ? 'soft' : 'hard', sid, rep: rule };
        if (label)
            it.label = label;
        list.push(it);
        out.push(it);
        const next = repStep(cur, unit, n);
        if (next === cur)
            break;
        cur = next;
    }
    sortDdl(list);
    return out;
}
/**
 * 删重复截止：scope = one（只这条）/ after（这条及以后）/ all（整个系列）。
 * 没有 sid 的条目等价于 one。返回值 = 实际删掉的条数。
 */
export function removeDdlScoped(c, id, scope = 'one') {
    const list = c.ddl ?? [];
    const it = list.find((d) => ddlIdOf(d) === id);
    if (!it)
        return 0;
    const sid = it.sid;
    if (!sid || scope === 'one') {
        c.ddl = list.filter((d) => ddlIdOf(d) !== id);
        return 1;
    }
    if (scope === 'after') {
        const before = list.length;
        c.ddl = list.filter((d) => !(d.sid === sid && d.at >= it.at));
        return before - (c.ddl?.length ?? 0);
    }
    const before = list.length;
    c.ddl = list.filter((d) => d.sid !== sid);
    return before - (c.ddl?.length ?? 0);
}
/** 改一条：日期 / 类型 / 备注（label 传空字符串 = 清掉备注）。找不到 → null。 */
export function updateDdl(c, id, patch) {
    const list = c.ddl ?? [];
    const it = list.find((d) => ddlIdOf(d) === id);
    if (!it)
        return null;
    if (patch.at !== undefined) {
        if (!isDay(patch.at))
            throw new Error('截止时间必须是 yyyy-mm-dd：' + patch.at);
        if (it.at !== patch.at) {
            if (!it.id)
                it.id = ddlIdOf(it);
            it.at = patch.at;
        }
    }
    if (patch.kind !== undefined)
        it.kind = patch.kind === 'soft' ? 'soft' : 'hard';
    if (patch.label !== undefined) {
        const v = patch.label.trim();
        if (v)
            it.label = v;
        else
            delete it.label;
    }
    sortDdl(list);
    return it;
}
/** 删一条（按 id；兼容老数据把 at 当 id）。 */
export function removeDdl(c, id) {
    const list = c.ddl ?? [];
    const n = list.length;
    c.ddl = list.filter((d) => ddlIdOf(d) !== id);
    return c.ddl.length !== n;
}
/** 三条边的宽度（越界夹紧；null / undefined = 复位回默认，删掉这一项）。 */
export function setUi(g, patch) {
    const ui = g.ui ?? (g.ui = {});
    /** null = 显式复位（删掉这一项）；非法值 = undefined（不动，别把用户设好的宽度悄悄清掉）。 */
    const clamp = (v, lo, hi) => {
        if (v === null)
            return null;
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        if (!Number.isFinite(n))
            return undefined;
        return Math.round(Math.min(hi, Math.max(lo, n)));
    };
    const put = (k, lo, hi) => {
        if (!(k in patch))
            return;
        const v = clamp(patch[k], lo, hi);
        if (v === null)
            delete ui[k];
        else if (v !== undefined)
            ui[k] = v;
    };
    put('lw', 200, 520);
    put('tpw', 240, 4000);
    put('dw', 360, 760);
    put('tpr', 5, 95);
    // v98：项目组时间显隐（布尔）。null = 复位回默认（隐藏）；非布尔 = 不动。
    if ('gtime' in patch) {
        const v = patch.gtime;
        if (v === null)
            delete ui.gtime;
        else if (typeof v === 'boolean')
            ui.gtime = v;
    }
    /* v110：pending 项目显隐（布尔）。null = 复位回默认（显示）；非布尔 = 不动。 */
    if ('pend' in patch) {
        const v = patch.pend;
        if (v === null)
            delete ui.pend;
        else if (typeof v === 'boolean')
            ui.pend = v;
    }
    /* v118：本日计划清单收起 / 只显示可安排（布尔）。null = 复位回默认（收起 / 开）；非布尔 = 不动。 */
    if ('pfold' in patch) {
        const v = patch.pfold;
        if (v === null)
            delete ui.pfold;
        else if (typeof v === 'boolean')
            ui.pfold = v;
    }
    if ('plonly' in patch) {
        const v = patch.plonly;
        if (v === null)
            delete ui.plonly;
        else if (typeof v === 'boolean')
            ui.plonly = v;
    }
    /* v121：只显示本日完成（布尔）。 */
    if ('pldone' in patch) {
        const v = patch.pldone;
        if (v === null)
            delete ui.pldone;
        else if (typeof v === 'boolean')
            ui.pldone = v;
    }
    /* v121 / v124：计划清单开合记忆 + 执行安排分区开合（字符串数组，只认 key 形状；null = 复位） */
    const keyList = (v, max) => {
        if (v === null)
            return null;
        if (!Array.isArray(v))
            return undefined;
        const out = [];
        for (const x of v)
            if (typeof x === 'string' && x.length <= 160 && /^[gpts]\|[\w|-]+$/.test(x) && !out.includes(x))
                out.push(x);
        return out.slice(0, max);
    };
    for (const k of ['plclosed', 'plopen']) {
        if (!(k in patch))
            continue;
        const v = keyList(patch[k], 4000);
        if (v === null)
            delete ui[k];
        else if (v !== undefined)
            ui[k] = v;
    }
    if ('tpm' in patch) {
        const v = patch.tpm;
        if (v === null)
            delete ui.tpm;
        else if (v === 'ex' || v === 'pl' || v === 'split')
            ui.tpm = v;
    }
    if ('exz' in patch) {
        const v = patch.exz;
        if (v === null)
            delete ui.exz;
        else if (Array.isArray(v))
            ui.exz = [...new Set(v.filter((x) => typeof x === 'string' && ZONES.has(x)))];
    }
    return ui;
}
/** 卡片组里干活的任务数（叶子任务完成 / 全部）。 */
export function taskStats(tasks) {
    let done = 0, total = 0;
    const walk = (l) => { for (const t of l) {
        if (t.subs?.length)
            walk(t.subs);
        else {
            total++;
            if (t.done)
                done++;
        }
    } };
    walk(tasks ?? []);
    return { done, total };
}
/** v133 R1：快照版本号只看会显示的数据 —— 降级原因（统计实况，各轮顺序 / 内容会抖）不进 rev，否则 5s 轮询每次都整页重画。 */
export function revOf(body) {
    const { degraded: _dg, ...shown } = body;
    const s = JSON.stringify(shown);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}
/** v137：任务截止旗的 id 前缀（ddl-move / ddl-del 见到它就改 task.due）。 */
export const TASK_DDL = 'tk:';
/** v137：任务 / 子任务的截止 = 卡片的一个截止时间（派生，不另存）；label = 任务名（子任务 = 父任务 › 子任务）。 */
export function taskDdl(c) {
    const out = [];
    const push = (t, label) => { if (t.id && t.due && isDay(t.due))
        out.push({ id: TASK_DDL + t.id, at: t.due, kind: 'hard', label, task: t.id, ...(t.done ? { done: true } : {}) }); };
    for (const t of c.tasks ?? []) {
        push(t, t.text);
        for (const x of t.subs ?? [])
            push(x, t.text + ' › ' + x.text);
    }
    return out;
}
/** 组行 = 子卡并集（计划 / 实际 / 截止日都取并集），客户端按天数组自己算。 */
export function payload(b, g, auto, degraded, events = [], now = Date.now()) {
    const cards = [];
    for (const c of b.cards) {
        const grp = b.groups.find((x) => x.id === c.g);
        if (!grp)
            continue;
        const st = g.cards[c.id];
        const stats = taskStats(c.tasks ?? []);
        const act = actualDays(st, auto[c.id] ?? []);
        const stIdx = Math.max(0, grp.statuses.findIndex((s) => s.id === c.col));
        cards.push({
            id: c.id, g: c.g, t: c.t, stage: grp.statuses.find((s) => s.id === c.col)?.name ?? '',
            done: stats.done, total: stats.total,
            created: ymd(cardCreated(c)), ...(c.archivedAt ? { archivedAt: c.archivedAt } : {}),
            seq: stIdx * 1000 + (c.order ?? 0),
            ...(c.pending ? { pending: true } : {}),
            plan: [...planDays(c, st, events, now)].sort(),
            actual: [...act.entries()].map(([day, src]) => ({ day, src })).sort((a, b) => a.day.localeCompare(b.day)),
            ddl: [...(st?.ddl ?? []).map((d) => ({ id: ddlIdOf(d), at: d.at, kind: ddlKindOf(d), ...(d.label ? { label: d.label } : {}), ...(d.sid ? { sid: d.sid } : {}), ...(d.rep ? { rep: d.rep } : {}) })), ...taskDdl(c)]
                .sort((a, b) => a.at.localeCompare(b.at) || (a.id ?? '').localeCompare(b.id ?? '')),
            auto: [...new Set((auto[c.id] ?? []).filter(isDay))].sort(),
            autoOff: [...new Set((st?.autoOff ?? []).filter(isDay))].sort(),
            tasks: (c.tasks ?? []).map((t) => ({
                id: t.id, text: t.text, done: t.done === true, ...(t.due ? { due: t.due } : {}), ...(t.sess ? { sess: t.sess } : {}),
                /* v142（反馈）：已完成子任务带上完成那天（= 最后修改时间的本地日期），执行安排只列「未完成 + 这天完成的」 */
                subs: (t.subs ?? []).map((x) => ({ id: x.id, text: x.text, done: x.done === true, ...(x.due ? { due: x.due } : {}), ...(x.sess ? { sess: x.sess } : {}), ...(x.done && x.updated ? { doneDay: localDay(x.updated) } : {}) })),
            })),
        });
    }
    const groups = b.groups.map((grp) => ({
        id: grp.id, name: grp.name, upd: Date.parse(grp.updatedAt ?? '') || 0, ...(grp.archivedAt ? { archivedAt: grp.archivedAt } : {}),
        stages: grp.statuses.map((s) => ({ id: s.id, name: s.name })),
        ...(grp.collapsed ? { collapsed: true } : {}),
    }));
    /* v133 R1：降级原因排序去重（会话统计各轮按遍历顺序 push，顺序会抖） */
    return { today: todayKey(now), groups, cards, panels: { ...(g.panels ?? {}) }, ui: { ...(g.ui ?? {}) }, degraded: [...new Set(degraded)].sort() };
}
/** 纯函数：把 events.jsonl 文本解析成事件（非法行忽略）。 */
export function eventsFromText(text) {
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const e = JSON.parse(line);
            if (e && typeof e.at === 'string' && typeof e.kind === 'string')
                out.push(e);
        }
        catch { /* 坏行忽略 */ }
    }
    return out;
}
//# sourceMappingURL=gantt.js.map