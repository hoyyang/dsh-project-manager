/**
 * 会话注入文本 = 两段：
 * 1) 项目记忆：卡片组 ∪ 卡片关联的落盘项目 → 摘要（状态 / next_action / STATE 路径），字节预算 maxBytes，超出从后往前省略并注明；
 * 2) 卡片资料（0.10）：相关说明全文 + 相关链接（显示文字 + 网址）+ 相关文件绝对路径；没有任何资料时不出现。
 *    说明超过 notesMaxBytes 时截断并注明（链接、文件是短列表，全部列出）。
 */
import { group, memoryOf } from './model.js';
export function memoryText(b, c, states, maxBytes = 6000, readKeys = [], notesMaxBytes = 16000) {
    const mem = memorySection(b, c, states, maxBytes, readKeys);
    const extra = materialsText(c, notesMaxBytes);
    return extra ? mem + '\n\n' + extra : mem;
}
function memorySection(b, c, states, maxBytes, readKeys) {
    const g = group(b, c.g);
    const all = memoryOf(b, c);
    // 关联时会话里已读过的 STATE 不再注入（用户规则：没读过才自动读）
    const items = all.filter((m) => !readKeys.includes(m.key));
    const head = [
        '## dsh-project-manager：本会话关联的项目记忆',
        '卡片组「' + g.name + '」· 卡片「' + c.t + '」。以下落盘项目（/landfill-project）已自动关联；需要细节时直接读取 STATE 路径。',
    ];
    if (!all.length)
        return head.concat(['（没有关联落盘项目）']).join('\n');
    if (!items.length)
        return head.concat(['（关联的 ' + all.length + ' 个落盘项目本会话之前已读过，不再重复注入：' + all.map((m) => m.key).join('、') + '）']).join('\n');
    const blocks = items.map((m) => {
        const s = states.get(m.key);
        if (!s)
            return '- ' + m.key + '：未找到 STATE（可能已被移动或删除）';
        return ['- ' + m.key + '（' + (m.from === 'group' ? '来自卡片组' : m.from === 'card' ? '来自卡片' : '卡片组+卡片') + '）',
            '  状态：' + (s.status || '（STATE 未写一行状态）'),
            '  next_action：' + (s.next || '（未写）'),
            '  STATE：' + s.path].join('\n');
    });
    const out = head.slice();
    let used = Buffer.byteLength(out.join('\n'));
    const omitted = [];
    blocks.forEach((blk, i) => {
        const n = Buffer.byteLength(blk) + 1;
        if (used + n > maxBytes) {
            omitted.push(items[i].key);
            return;
        }
        out.push(blk);
        used += n;
    });
    const skipped = all.filter((m) => readKeys.includes(m.key)).map((m) => m.key);
    if (skipped.length)
        out.push('（本会话之前已读过、不再重复注入：' + skipped.join('、') + '）');
    if (omitted.length)
        out.push('（另有 ' + omitted.length + ' 个落盘项目因长度预算省略，名单：' + omitted.join('、') + '）');
    return out.join('\n');
}
/** 按 UTF-8 字节截断（不切坏多字节字符）。 */
function cutBytes(s, max) {
    const buf = Buffer.from(s, 'utf8');
    if (buf.length <= max)
        return s;
    return buf.subarray(0, max).toString('utf8').replace(/\uFFFD+$/, '');
}
/** 卡片资料（相关说明 / 相关链接 / 相关文件）；三者都没有 → 空串。 */
export function materialsText(c, notesMaxBytes = 16000) {
    const notes = (c.notes ?? '').trim();
    const links = c.webLinks ?? [];
    const files = c.files ?? [];
    if (!notes && !links.length && !files.length)
        return '';
    const out = ['## dsh-project-manager：卡片「' + c.t + '」的资料', '用户在项目看板里给这张卡片登记的资料，作为本项目的上下文；链接和文件需要细节时再自己打开读取。'];
    if (notes) {
        const cut = cutBytes(notes, notesMaxBytes);
        // 说明是用户原文：放进围栏，避免其中的标题 / 列表被当成上面这段的结构
        out.push('', '### 相关说明', '```text', cut.replace(/```/g, '\u02cb\u02cb\u02cb'), '```');
        if (cut.length < notes.length)
            out.push('（说明超过 ' + notesMaxBytes + ' 字节，已截断；全文在项目看板这张卡片的「相关说明」里）');
    }
    if (links.length)
        out.push('', '### 相关链接', ...links.map((l) => '- [' + l.text.replace(/[[\]]/g, '') + '](' + l.url + ')（' + l.type + '）'));
    if (files.length)
        out.push('', '### 相关文件（绝对路径）', ...files.map((p) => '- ' + p));
    return out.join('\n');
}
//# sourceMappingURL=memory.js.map