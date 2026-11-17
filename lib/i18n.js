/**
 * v182：英文词典（host 侧唯一出口）。
 *
 * 词典 = scripts/gen-i18n.mjs 由 locales/ + scripts/i18n-overrides.json 生成到 lib/i18n/en.json，
 * 只在这里按需读一次（ESM 单例 memo，无模块级副作用）。client 不内联它 —— 4,454 条 370 KB，
 * 内联会把 client.js 从 2.4 MB 撑到 ~4 MB；改走 GET /i18n 按需投递 + 浏览器 localStorage 缓存（带 v）。
 *
 * 读不到（旧包 / 文件被删）就返回 null，路由回 404，界面回退中文并在设置页点名原因（不静默）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let cached = null;
let tried = false;
/** 读一次词典（成功后再调直接给缓存；失败不缓存失败结果 —— 点「重启后可用」重试时才可能变好）。 */
export function loadDict() {
    if (cached)
        return cached;
    if (tried)
        return null;
    tried = true;
    const file = join(dirname(fileURLToPath(import.meta.url)), 'i18n', 'en.json');
    if (!existsSync(file)) {
        console.warn('[dsh-project-manager] 英文词典缺失（' + file + '）—— 界面语言会回退中文；重新 npm i / 重新构建可恢复');
        return null;
    }
    try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        if (!raw || typeof raw.v !== 'string' || !raw.dict || typeof raw.dict !== 'object') {
            console.warn('[dsh-project-manager] 英文词典格式不对（缺 v / dict）：' + file);
            return null;
        }
        cached = raw;
        return cached;
    }
    catch (e) {
        console.warn('[dsh-project-manager] 英文词典读取失败：', e);
        return null;
    }
}
//# sourceMappingURL=i18n.js.map