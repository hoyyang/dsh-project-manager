export const nest = (x) => String(x).replace(/「/g, '『').replace(/」/g, '』');
export const wrap = (x) => '「' + x + '」';
/** 名字：“名字”。 */
export const nm = (x) => '“' + nest(x).replace(/“/g, '‘').replace(/”/g, '’') + '”';
const base = (p) => p.replace(/\/+$/, '').split('/').pop() || p;
export const fileTitle = (f) => f.title || base(f.path);
/** 0.27.2 活跃会话：「“会话名”会话（“卡片组名”卡片组-“卡片名”卡片）」；还没卡片 = 去掉「-“卡片名”卡片」；不在卡片组里 = 只写「“会话名”会话」。 */
/** v151（1.1）：带会话 id（Agent 拿 id 精确定位会话，重名不再找错）：「“名”会话（“组”卡片组-“卡”卡片 · 会话 id：session-…）」；没卡片组 =「“名”会话（会话 id：…）」。 */
export const sessionText = (name, group, card, id) => {
    const g = group ? nm(group) + '卡片组' + (card ? '-' + nm(card) + '卡片' : '') : '';
    const i = id ? '会话 id：' + id : '';
    return wrap(nm(name) + '会话' + (g || i ? '（' + g + (g && i ? ' · ' : '') + i + '）' : ''));
};
export const noteText = (t, v) => wrap(nm(t) + '：' + nest(v));
export const linkText = (l) => wrap(nm(l.text) + '（' + l.url + '）');
/** 还在 =「标题（路径）」，已删除 =「标题（已删除：路径）」。 */
export const fileRef = (f) => nm(fileTitle(f)) + '（' + (f.exists ? '' : '已删除：') + f.path + '）';
export const fileText = (f) => wrap(fileRef(f));
export const repoText = (name, path) => wrap(nm(name) + '（路径：' + path + '）');
export const cardText = (title, group) => wrap(nm(title) + '（卡片组：' + nm(group) + '）卡片');
/**
 * v163 S10：知识卡引用原文 =「“标题”知识卡（/abs/path/<id>.md）」。
 * 中间「知识卡」三个字把「”（」隔开 —— FILE_REF_RX（文件引用）与文件胶囊的正则都吃不到它；
 * 文件名 = id、路径恒定，所以不需要 v154 那套搬家同步（改标题只影响显示）。
 */
export const kbText = (title, path) => wrap(nm(title) + '知识卡（' + path + '）');
/**
 * v97：任务的引用文本 = 这条任务的「任务说明」全文（子任务同理）；没有说明才退回标题。
 * 不再拼「任务 N：标题 / 状态 / 类型 / 链接 / 文件 / 子任务」那一大段 —— 那些在详情里都看得到。
 */
export function taskText(c, ti, si) {
    const t = c.tasks[ti];
    if (!t)
        return '';
    if (si !== undefined) {
        const x = (t.subs ?? [])[si];
        if (!x)
            return '';
        return (x.note ?? '').trim() || x.text;
    }
    return (t.note ?? '').trim() || t.text;
}
/** 「>」/「》」引用触发：行首（本行的第一个字符）或空格后面。
 *  v117 修：原来行首只在「整段文字的第一行」才算（first 参数），所以任务说明是两行以上时，
 *  在第 2 行行首打「>」不会弹引用菜单 —— 用户看到的就是「>」留在正文里、胶囊没插进去（开工 5.2）。
 *  现在任意一行的行首都算；first 保留只为兼容调用方（单行输入框里它恒为 true）。 */
export function detectQuote(prefix, _first = true) {
    for (let i = prefix.length - 1; i >= 0; i--) {
        const ch = prefix[i];
        if (/\s/.test(ch))
            return null;
        if (ch !== '>' && ch !== '》')
            continue;
        if (i === 0)
            return { len: prefix.length, query: prefix.slice(1) };
        const prev = prefix[i - 1];
        if (prev === ' ' || prev === '\u3000' || prev === '\u00a0')
            return { len: prefix.length - i + 1, query: prefix.slice(i + 1) };
        return null;
    }
    return null;
}
/**
 * v171：「）」/「)」（半角同理）引用知识卡触发 —— 行首（任意一行的第一个字符）或空格 / 全角空格 / NBSP 之后。
 * 与 detectQuote 同构、同样纯函数：不碰 DOM，四处入口（对话框 / 任务说明 / 相关说明 / 知识卡正文）共用这一条规则。
 * 不做「》」—— 那是「>」的兄弟（引用卡片内容）。
 */
export function detectKbQuote(prefix) {
    for (let i = prefix.length - 1; i >= 0; i--) {
        const ch = prefix[i];
        if (/\s/.test(ch))
            return null;
        if (ch !== '）' && ch !== ')')
            continue;
        if (i === 0)
            return { len: prefix.length, query: prefix.slice(1) };
        const prev = prefix[i - 1];
        if (prev === ' ' || prev === '\u3000' || prev === '\u00a0')
            return { len: prefix.length - i + 1, query: prefix.slice(i + 1) };
        return null;
    }
    return null;
}
/**
 * v171：面板被用户主动收起后的「别立刻重开」判定 —— 只认「触发字符左边那段原文」。
 * 规则（原型 v171 J 组定稿）：左边那段原文没被改写、且后面紧跟着的仍是同一个触发字符（可隔一个空白），
 * 就继续压着不弹；用户清掉 / 改写了左边那段、或换了个位置重新打触发字符 → 解除。
 * 只对 esc / outside 记；pick / api（程序化关闭）不记。
 */
export function mutedBy(left, prefix) {
    if (!prefix.startsWith(left))
        return false;
    return /^[\s\u3000\u00a0]?[>》)\uff09]/.test(prefix.slice(left.length));
}
/** 触发字符左边那段原文（len = detectQuote / detectKbQuote 给的触发长度）。 */
export const leftOf = (prefix, len) => prefix.slice(0, Math.max(0, prefix.length - len));
/* ── v154：文件引用原文的识别 / 改写 + 文件名归一（host 同步与修复、client 兜底共用一份） ── */
/** 文件引用原文：「“标题”（[已删除：]路径）」。 */
export const FILE_REF_RX = /「“([^”「」]*)”（(已删除：)?((?:\/|~\/)[^）「」]*)）」/g;
/** 路径 / 文件名的最后一段（不依赖 model，避免循环依赖）。 */
export const refBase = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
/**
 * v154：文件名归一 key —— 只差空白（含全角空格）与连字符的名字视为同一个文件。
 * 「…严重 bug.mov」与「…严重-bug.mov」= 同一个 key（搬家净化名字的经典情形）；其它字符不折叠，防误配。
 */
export const refNameKey = (p) => refBase(p).normalize('NFC').toLowerCase().replace(/[\s\u3000]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
/**
 * v154（1.4）：卡内文件里按「当前路径 → 以前的路径（prev）→ 唯一同名 → 归一同名」找对应文件。
 * 任务说明 / 详情气泡 / 启动修复用同一口径；宿主已发出的消息、用户自己在 Finder 里挪的文件靠这一条兜住。
 */
export function findRefFile(files, path) {
    const exact = files.find((f) => f.path === path);
    if (exact)
        return exact;
    const prev = files.find((f) => (f.prev ?? []).includes(path));
    if (prev)
        return prev;
    const b = refBase(path), same = files.filter((f) => refBase(f.path) === b);
    if (same.length === 1)
        return same[0];
    const key = refNameKey(path), near = files.filter((f) => refNameKey(f.path) === key);
    return near.length === 1 ? near[0] : null;
}
/** v154：相关文件的显示名（自定义标题优先，否则文件名）。 */
export const refTitle = (f) => f.title || refBase(f.path);
/**
 * v154：按 pick 改写 text 里的文件引用原文；pick 返回 null 或同一路径 = 不动。
 * 保留原文的「已删除：」前缀 —— 它记录的是写这条引用时的状态。
 */
export function rewriteFileRefText(text, pick) {
    let n = 0;
    const out = text.replace(FILE_REF_RX, (m, title, del, path) => {
        const t = pick(path, title);
        if (!t || !t.path || t.path === path)
            return m;
        n++;
        return '「“' + (t.title || refBase(t.path)) + '”（' + (del ?? '') + t.path + '）」';
    });
    return { text: out, n };
}
//# sourceMappingURL=quote.js.map