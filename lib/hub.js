/**
 * 「项目区」枢纽目录：<dataDir>/hub/。所有项目会话的 cwd 都是它（DSH 按 cwd 严格相等归属工作区）。
 * 内容：repos/<组>/<仓> 软链 + AGENTS.md（仓库清单、读写纪律、每组关联的落盘项目路径）。
 * 删除只删软链本身，绝不跟随软链删目标仓库。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const SAFE = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 64) || 'x';
export const safeName = SAFE;
export function hubDir(dataDir) { return join(dataDir, 'hub'); }
export function syncHub(dataDir, b, states) {
    const root = hubDir(dataDir);
    const repos = join(root, 'repos');
    mkdirSync(repos, { recursive: true });
    const wanted = new Map();
    const owner = new Map();
    for (const g of b.groups)
        for (const r of g.repos) {
            const rel = join(SAFE(g.name), SAFE(r.name));
            const who = g.name + ' / ' + r.name;
            // 撞名（例如 "a b" 与 "a-b"）：先到先得，后者不挂并在 AGENTS.md 里注明，绝不让软链指错仓库
            if (owner.has(rel))
                continue;
            owner.set(rel, who);
            wanted.set(rel, r.path);
        }
    // 清理不再需要的软链（只删 symlink，不碰真实目录）
    for (const gdir of safeList(repos)) {
        const gp = join(repos, gdir);
        // 组目录本身若是软链（异常状态），只删链接本身，绝不进入它的目标
        if (isLink(gp)) {
            rmSync(gp);
            continue;
        }
        for (const name of safeList(gp)) {
            const rel = join(gdir, name);
            const lp = join(repos, rel);
            if (!lstatSync(lp).isSymbolicLink())
                continue;
            if (wanted.get(rel) !== readlinkSync(lp))
                rmSync(lp);
        }
    }
    for (const [rel, target] of wanted) {
        const lp = join(repos, rel);
        mkdirSync(join(lp, '..'), { recursive: true });
        if (existsSync(lp) || isLink(lp))
            continue;
        if (existsSync(target))
            symlinkSync(target, lp, 'dir');
    }
    writeFileSync(join(root, 'AGENTS.md'), agentsMd(b, states));
    return root;
}
function isLink(p) { try {
    return lstatSync(p).isSymbolicLink();
}
catch {
    return false;
} }
function safeList(p) { try {
    return readdirSync(p);
}
catch {
    return [];
} }
export function agentsMd(b, states) {
    const lines = [
        '# 项目区（dsh-project-manager 自动生成，请勿手改）',
        '',
        '本目录是所有项目会话的工作目录。每个卡片组的仓库以软链接挂在 repos/<卡片组>/<仓库>/ 下。',
        '',
        '## 读写纪律',
        '- 读写仓库文件一律用 repos/<卡片组>/<仓库>/ 下的路径，这样仓库里的 AGENTS.md / CLAUDE.md 才会被加载。',
        '- 不要在本目录根下新建项目文件；产物写进对应仓库。',
        '- 落盘项目（~/.ai）只读；更新 STATE 请走 ai-memory 工具。',
        '',
    ];
    for (const g of b.groups) {
        lines.push('## 卡片组：' + g.name);
        if (g.repos.length)
            for (const r of g.repos) {
                const rel = SAFE(g.name) + '/' + SAFE(r.name);
                const clash = b.groups.some((o) => o !== g && SAFE(o.name) === SAFE(g.name) && b.groups.indexOf(o) < b.groups.indexOf(g));
                lines.push('- 仓库 ' + r.name + '（' + r.role + '）：' + (clash ? '未挂载（卡片组名与其他组重名，请改名）' : 'repos/' + rel + '/') + ' → ' + r.path);
            }
        else
            lines.push('- 仓库：未挂载');
        if (g.links.length)
            for (const k of g.links) {
                const s = states.get(k);
                lines.push('- 落盘项目 ' + k + (s ? '：' + s.path : '（未找到）'));
            }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=hub.js.map