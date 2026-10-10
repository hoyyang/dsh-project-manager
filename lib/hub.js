/**
 * 「项目区」枢纽目录：<dataDir>/hub/。所有项目会话的 cwd 都是它（DSH 按 cwd 严格相等归属工作区）。
 * 内容：repos/<组>/<仓> 软链 + AGENTS.md（仓库清单、读写纪律、每组关联的落盘项目路径）。
 * 0.9：每个卡片组另有 groups/<组 id>/ 子目录（= 「项目区」下的子工作区，新项目会话的 cwd）：repos/<仓> 软链 + 本组 AGENTS.md。
 *   目录按组 id 命名，改组名不搬家（会话 cwd 不失效）；删组只清它的软链，目录保留（旧会话 cwd 仍有效）。
 * 删除只删软链本身，绝不跟随软链删目标仓库。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const SAFE = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 64) || 'x';
export const safeName = SAFE;
export function hubDir(dataDir) { return join(dataDir, 'hub'); }
export function groupDir(dataDir, groupId) { return join(hubDir(dataDir), 'groups', SAFE(groupId)); }
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
    syncGroupDirs(root, b, states);
    return root;
}
/** 每个卡片组的子目录：repos/<仓> 软链与本组 AGENTS.md；已删除组的目录只清软链。 */
function syncGroupDirs(root, b, states) {
    const base = join(root, 'groups');
    mkdirSync(base, { recursive: true });
    const live = new Set();
    for (const g of b.groups) {
        const dir = join(base, SAFE(g.id));
        live.add(SAFE(g.id));
        const wanted = new Map();
        for (const r of g.repos)
            if (!wanted.has(SAFE(r.name)))
                wanted.set(SAFE(r.name), r.path);
        syncLinks(join(dir, 'repos'), wanted);
        writeFileSync(join(dir, 'AGENTS.md'), groupAgentsMd(g, states));
    }
    for (const d of safeList(base)) {
        const p = join(base, d);
        if (live.has(d))
            continue;
        if (isLink(p)) {
            rmSync(p);
            continue;
        }
        syncLinks(join(p, 'repos'), new Map());
    }
}
/** 一层软链目录：多余/指错的软链删掉（只删 symlink），缺的补上（目标不存在时不建）。 */
function syncLinks(dir, wanted) {
    if (isLink(dir))
        rmSync(dir);
    mkdirSync(dir, { recursive: true });
    for (const name of safeList(dir)) {
        const lp = join(dir, name);
        if (lstatSync(lp).isSymbolicLink() && wanted.get(name) !== readlinkSync(lp))
            rmSync(lp);
    }
    for (const [name, target] of wanted) {
        const lp = join(dir, name);
        if (existsSync(lp) || isLink(lp))
            continue;
        if (existsSync(target))
            symlinkSync(target, lp, 'dir');
    }
}
export function groupAgentsMd(g, states) {
    const lines = [
        '# 卡片组「' + g.name + '」（dsh-project-manager 自动生成，请勿手改）',
        '',
        '本目录是卡片组「' + g.name + '」项目会话的工作目录。本组的仓库以软链接挂在 repos/<仓库>/ 下。',
        '',
        '## 读写纪律',
        '- 读写仓库文件一律用 repos/<仓库>/ 下的路径，这样仓库里的 AGENTS.md / CLAUDE.md 才会被加载。',
        '- 不要在本目录根下新建项目文件；产物写进对应仓库。',
        '- 落盘项目（~/.ai）只读；更新 STATE 请走 ai-memory 工具。',
        '',
        '## 仓库',
    ];
    const seen = new Set();
    if (g.repos.length)
        for (const r of g.repos) {
            const n = SAFE(r.name);
            lines.push('- 仓库 ' + r.name + '（' + r.role + '）：' + (seen.has(n) ? '未挂载（与本组其他仓库重名，请改名）' : 'repos/' + n + '/') + ' → ' + r.path);
            seen.add(n);
        }
    else
        lines.push('- 未挂载');
    if (g.links.length) {
        lines.push('', '## 落盘项目');
        for (const k of g.links) {
            const s = states.get(k);
            lines.push('- ' + k + (s ? '：' + s.path : '（未找到）'));
        }
    }
    lines.push('');
    return lines.join('\n');
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