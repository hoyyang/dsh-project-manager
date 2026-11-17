import { field, matchField, norm, tokens } from './search.js';
const K1 = 1.2;
const B = 0.75;
const W_TITLE = 3;
const W_TAGS = 2;
const W_SUMMARY = 1.5;
const W_BODY = 1;
const CJK = /[\u4e00-\u9fff]/;
const WORD = /[a-z0-9]/;
/* ---------- 切词 ---------- */
/**
 * 切词：NFKC + 小写归一（归一效果与 search.ts 的 norm 相同；不直接复用 norm 是因为它会把空格也删掉，
 * 英文多词 'npm run build' 会粘成 'npmrunbuild' 永远查不中），然后按 run 切：
 * 连续汉字切二元（单字 run 保留一元），英文 / 数字按词，其它字符当分隔符。
 */
export function grams(text) {
    const s = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
    const out = [];
    let i = 0;
    while (i < s.length) {
        if (CJK.test(s[i])) {
            let j = i + 1;
            while (j < s.length && CJK.test(s[j]))
                j++;
            const run = s.slice(i, j);
            if (run.length === 1)
                out.push(run);
            else
                for (let k = 0; k + 1 < run.length; k++)
                    out.push(run[k] + run[k + 1]);
            i = j;
        }
        else if (WORD.test(s[i])) {
            let j = i + 1;
            while (j < s.length && WORD.test(s[j]))
                j++;
            out.push(s.slice(i, j));
            i = j;
        }
        else
            i++;
    }
    return out;
}
/** 单字段词频：tf 里直接存加权值（标题 ×3 / 标签 ×2 / 摘要 ×1.5 / 正文 ×1），len 存原始词数。 */
function fieldTf(text, w) {
    const tf = new Map();
    let len = 0;
    for (const g of grams(text)) {
        tf.set(g, (tf.get(g) ?? 0) + 1);
        len++;
    }
    if (w !== 1)
        for (const [k, v] of tf)
            tf.set(k, v * w);
    return { tf, len };
}
function docTf(card) {
    const title = fieldTf(card.title, W_TITLE);
    const tagsTf = new Map();
    let tagsLen = 0;
    for (const t of card.tags ?? []) {
        const f = fieldTf(t, W_TAGS);
        for (const [k, v] of f.tf)
            tagsTf.set(k, (tagsTf.get(k) ?? 0) + v);
        tagsLen += f.len;
    }
    const summary = fieldTf(card.summary, W_SUMMARY);
    const body = fieldTf(card.body, W_BODY);
    return { title, tags: { tf: tagsTf, len: tagsLen }, summary, body, len: title.len + tagsLen + summary.len + body.len };
}
/* ---------- 名称类叠加 ---------- */
/** 名称类（标题 / 标签 / 摘要）逐 token 跑 matchField，命中分 / 10 计入总分（与 BM25 同量级），并把对应字段标记为命中。 */
function nameBonus(card, toks, hit) {
    let bonus = 0;
    const titleF = field('title', '标题', card.title, 0);
    const sumF = field('summary', '摘要', card.summary, 0);
    for (const tok of toks) {
        const mT = matchField(titleF, tok);
        if (mT) {
            bonus += mT.score / 10;
            hit.add('标题');
        }
        const mS = matchField(sumF, tok);
        if (mS) {
            bonus += mS.score / 10;
            hit.add('摘要');
        }
        let bestTag = 0;
        for (const t of card.tags ?? []) {
            const m = matchField(field('tag', '标签', t, 0), tok);
            if (m && m.score > bestTag)
                bestTag = m.score;
        }
        if (bestTag > 0) {
            bonus += bestTag / 10;
            hit.add('标签');
        }
    }
    return bonus;
}
/* ---------- 打分 ---------- */
function scDoc(card, dt, gs, toks, idf, avg) {
    const hit = new Set();
    let s = 0;
    for (const g of gs) {
        const tT = dt.title.tf.get(g) ?? 0;
        const tG = dt.tags.tf.get(g) ?? 0;
        const tS = dt.summary.tf.get(g) ?? 0;
        const tB = dt.body.tf.get(g) ?? 0;
        const t = tT + tG + tS + tB;
        if (t <= 0)
            continue;
        if (tT > 0)
            hit.add('标题');
        if (tG > 0)
            hit.add('标签');
        if (tS > 0)
            hit.add('摘要');
        if (tB > 0)
            hit.add('正文');
        s += idf(g) * t * (K1 + 1) / (t + K1 * (1 - B + B * dt.len / avg));
    }
    s += nameBonus(card, toks, hit);
    const order = ['标题', '标签', '摘要', '正文'];
    return { s, hit: order.find((x) => hit.has(x)) };
}
/** ponytail: 向量 v3 可选开关 —— score(card, q) 是第二路叠加点：0 = 不相关，正值 = 词面相关分；未来向量检索的分值可与它加权合并进 searchKb 排序（无语料，idf 取 1、avg 取本文档长度）。 */
export function score(card, q) {
    const gs = [...new Set(grams(q))];
    if (!gs.length)
        return 0;
    const dt = docTf(card);
    return scDoc(card, dt, gs, tokens(q), () => 1, Math.max(1, dt.len)).s;
}
/** 倒排 df + 文档长度；千卡级全量重建毫秒内，调用方在卡集合变化后重建即可。 */
export function buildKbIndex(cards) {
    const docs = new Map();
    const df = new Map();
    let total = 0;
    for (const c of cards) {
        const dt = docTf(c);
        docs.set(c.id, { card: c, dt });
        total += dt.len;
        const seen = new Set();
        for (const m of [dt.title.tf, dt.tags.tf, dt.summary.tf, dt.body.tf])
            for (const k of m.keys())
                seen.add(k);
        for (const k of seen)
            df.set(k, (df.get(k) ?? 0) + 1);
    }
    const n = docs.size;
    return { docs, df, n, avgLen: n ? Math.max(1, total / n) : 1 };
}
/* ---------- 检索 ---------- */
function updDesc(a, b) {
    return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function browse(cands, limit) {
    return cands.sort(updDesc).slice(0, limit).map((c) => ({ id: c.id, score: 0 }));
}
/** 空查询 = 浏览态：受筛选的全量按 updated 倒序（score 0、无 hit）；非空 = BM25 + 名称叠加，stale ×0.5，按分数降序。 */
export function searchKb(index, q, opts = {}) {
    const limit = Math.max(1, opts.limit ?? 20);
    const cands = [];
    for (const d of index.docs.values()) {
        const c = d.card;
        if (opts.type && c.type !== opts.type)
            continue;
        if (opts.status && c.status !== opts.status)
            continue;
        if (opts.tag && !(c.tags ?? []).some((t) => norm(t).out === norm(opts.tag).out))
            continue;
        cands.push(c);
    }
    const toks = tokens(q);
    const gs = toks.length ? [...new Set(grams(q))] : [];
    if (!toks.length || !gs.length)
        return browse(cands, limit);
    const idf = (t) => {
        const d = index.df.get(t) ?? 0;
        return Math.log(1 + (index.n - d + 0.5) / (d + 0.5));
    };
    const out = [];
    for (const c of cands) {
        const d = index.docs.get(c.id);
        if (!d)
            continue;
        const r = scDoc(c, d.dt, gs, toks, idf, index.avgLen);
        let s = r.s;
        if (s <= 0)
            continue;
        if (c.status === 'stale')
            s *= 0.5;
        out.push({ id: c.id, score: s, hit: r.hit });
    }
    out.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        const ca = index.docs.get(a.id)?.card, cb = index.docs.get(b.id)?.card;
        return ca && cb ? updDesc(ca, cb) : 0;
    });
    return out.slice(0, limit);
}
//# sourceMappingURL=kbsearch.js.map