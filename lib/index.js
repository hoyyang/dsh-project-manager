/**
 * dsh-project-manager — host 入口（hybrid：看板数据 + HTTP 面 + 4 工具 + 项目区工作区 + 会话记忆注入）。
 * 生命周期：apply 只登记 inject 回调，无 module 级副作用；每个贡献（路由/工具/监听/上下文）都在 dispose 中撤销。
 * 卸载不删用户数据（board.json/hub/会话），「项目区」及卡片组子工作区条目由界面「卸载前清理」或 POST hub/cleanup 撤销。
 * 0.9：每个卡片组 = 「项目区」下的子工作区（hub/groups/<组 id>/，标题 = 组名）；dsh「按工作区树」分组下自然嵌套。
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import z from '@deepseek-ai/schemastery';
import * as M from './model.js';
import { BoardStore } from './store.js';
import { StateCatalog } from './states.js';
import { groupDir, hubDir, syncHub } from './hub.js';
import { memoryText } from './memory.js';
import { mountRoutes, ROUTE_PREFIX } from './routes.js';
import { registerTools } from './tools.js';
export const name = 'dsh-project-manager';
export const Config = z.object({
    dataDir: z.string().default('').description('数据目录（缺省 <DSH_HOME>/dsh-project-manager）'),
    aiRoot: z.string().default('').description('落盘项目根目录（缺省 ~/.ai），只读'),
    hubTitle: z.string().default('项目区').description('工作区列表里「项目区」的标题'),
    projectSessionMode: z.union(['danger-full-access', 'inherit']).default('danger-full-access').description('项目会话默认权限：完全访问 / 跟随全局'),
    memoryMaxBytes: z.natural().min(1000).max(32000).default(6000).description('每个会话注入的项目记忆上限（字节）'),
});
export const inject = ['webServer', 'tools', 'workspaceRegistry', 'sessions', 'permissionPresets', 'sessionTitle', 'systemPrompt'];
export function apply(ctx, config) {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    const dataDir = config.dataDir || join(dshHome, 'dsh-project-manager');
    const aiRoot = config.aiRoot || join(homedir(), '.ai');
    const log = ctx.logger?.('dsh-project-manager');
    const store = new BoardStore(dataDir);
    const states = new StateCatalog(aiRoot);
    let rev = 1;
    let hubWs = null;
    const hubPath = syncHub(dataDir, store.get(), states);
    const hubReal = realpathSync(hubPath);
    ctx.effect(() => store.subscribe((b) => {
        rev++;
        try {
            syncHub(dataDir, b, states);
        }
        catch (e) {
            log?.warn('同步项目区目录失败', e);
        }
        // 组新建 / 改名 / 删除 / 排序 → 子工作区跟着变
        void arrange().catch(() => undefined);
    }), 'dsh-project-manager: board subscription');
    /** 找到或创建「项目区」工作区并置顶；幂等（同路径 create 复用原条目）。 */
    const ensureHub = async () => {
        const existing = ctx.workspaceRegistry.list().find((w) => w.path === hubReal);
        hubWs = existing ?? await ctx.workspaceRegistry.create(hubPath, config.hubTitle);
        await pin();
        return hubWs;
    };
    // ── 卡片组子工作区 ──
    const groupsReal = join(hubReal, 'groups');
    const groupReal = (gid) => { const p = groupDir(dataDir, gid); try {
        return realpathSync(p);
    }
    catch {
        return join(groupsReal, p.slice(p.lastIndexOf('/') + 1));
    } };
    /** cwd（已 realpath）是否属于项目区：根目录或某个卡片组子目录。 */
    const projectCwd = (cwd) => cwd === hubReal || dirname(cwd) === groupsReal;
    const groupWsOf = (gid) => { const p = groupReal(gid); return ctx.workspaceRegistry.list().find((w) => w.path === p); };
    /**
     * 让登记与看板一致（幂等，串行）：每个卡片组一个子工作区、标题 = 组名；组已删 → 撤销登记（目录与会话保留）；
     * 顺序 = 项目区第一，紧跟各卡片组（按看板顺序）。只在已有「项目区」工作区时生效（用户还没用过项目会话就不往侧栏加东西）。
     */
    let chain = Promise.resolve();
    const arrange = () => {
        const run = async () => {
            if (!hubWs || !ctx.workspaceRegistry.get(hubWs.id))
                return;
            const reg = ctx.workspaceRegistry;
            const b = store.get();
            const want = [];
            for (const g of b.groups) {
                const p = groupDir(dataDir, g.id);
                if (!existsSync(p))
                    continue;
                let w = groupWsOf(g.id);
                if (!w)
                    w = await reg.create(p, g.name);
                else if (w.title !== g.name && typeof w.setTitle === 'function')
                    await w.setTitle(g.name);
                want.push(w);
            }
            const keep = new Set(want.map((w) => w.id));
            for (const w of reg.list())
                if (dirname(w.path) === groupsReal && !keep.has(w.id))
                    await reg.delete(w.id);
            const desired = [hubWs.id, ...want.map((w) => w.id)];
            for (let i = 0; i < desired.length; i++) {
                const order = reg.list().map((w) => w.id);
                if (order[i] !== desired[i])
                    await reg.insertBefore(desired[i], order[i]);
            }
        };
        const p = chain.then(run, run);
        chain = p.catch((e) => { log?.warn('同步卡片组子工作区失败', e); });
        return p;
    };
    hubWs = ctx.workspaceRegistry.list().find((w) => w.path === hubReal) ?? null;
    if (hubWs)
        void arrange().catch(() => undefined);
    const pin = arrange;
    // 别的工作区被新建/挪动时，把「项目区 + 卡片组」放回最前（已在位时 arrange 不写，避免自触发循环）
    ctx.on('domain/changed', ((c) => {
        if (!hubWs || c.domain !== 'workspace' || c.table !== '' || c.operation !== 'put')
            return;
        const ids = c.value?.workspaceIds ?? [];
        const want = [hubWs.id, ...store.get().groups.map((g) => groupWsOf(g.id)?.id).filter((x) => !!x)];
        if (want.some((id, i) => ids[i] !== id))
            void arrange().catch(() => undefined);
    }));
    /** 绑定后同步设置权限与标题（session/bind 路由调用；会话必须在运行中）。 */
    /** tree = 用户当前是 dsh「按工作区树」分组（组名已在树上）→ 会话名只用卡片名；否则「组名 · 卡片名」。 */
    const applyToSession = (s, cardId, tree) => {
        const b = store.get();
        const c = M.card(b, cardId);
        const g = M.group(b, c.g);
        let permission = false;
        if (config.projectSessionMode === 'danger-full-access') {
            ctx.permissionPresets.set(s, 'danger-full-access');
            permission = true;
        }
        const title = tree ? c.t : g.name + ' · ' + c.t;
        try {
            ctx.sessionTitle.rename(s, title);
        }
        catch (e) {
            log?.warn('会话改名失败', e);
            return { title: null, permission };
        }
        return { title, permission };
    };
    ctx.on('session/created', ((s) => {
        if (s.header.origin === 'subagent' || !s.header.cwd)
            return;
        let cwd = s.header.cwd;
        try {
            cwd = realpathSync(cwd);
        }
        catch { /* 目录不存在时按原值比较 */ }
        if (!projectCwd(cwd))
            return;
        // 会话恢复也会触发 created：只处理刚创建的会话（createdAt 在 60 秒内），不覆盖用户后来改过的权限
        const createdAt = s.header.createdAt;
        if (typeof createdAt === 'number' && Date.now() - createdAt > 60_000)
            return;
        // 项目区里新建的会话一律按完全访问（即使不是经卡片发起，例如官方「+」降级路径）
        if (config.projectSessionMode === 'danger-full-access') {
            try {
                ctx.permissionPresets.set(s, 'danger-full-access');
            }
            catch (e) {
                log?.warn('设置完全访问失败', e);
            }
        }
    }));
    ctx.inject(['webServer'], (h) => {
        const off = mountRoutes(h.webServer, {
            store,
            states,
            hub: () => {
                const ws = hubWs ? ctx.workspaceRegistry.get(hubWs.id) : undefined;
                const groups = {};
                for (const g of store.get().groups) {
                    const w = groupWsOf(g.id);
                    if (w)
                        groups[g.id] = w.id;
                }
                return { workspaceId: ws ? ws.id : null, path: hubReal, title: ws ? ws.title : config.hubTitle, groups };
            },
            prepareSession: async (cardId) => {
                const c = M.liveCard(store.get(), cardId);
                const hub = await ensureHub();
                const g = M.group(store.get(), c.g);
                const w = groupWsOf(g.id);
                if (!w)
                    throw new M.BoardError('NO_GROUP_WORKSPACE', '卡片组「' + g.name + '」的子工作区没建好（目录 ' + groupDir(dataDir, g.id) + '），请重试');
                return { workspaceId: w.id, workspaceTitle: hub.title + ' / ' + w.title };
            },
            bindSession: async (sessionId, cardId, tree) => {
                const s = ctx.sessions.get(sessionId);
                if (!s)
                    throw new M.BoardError('NO_SESSION', '会话不在运行中：' + sessionId);
                let cwd = s.header.cwd ?? '';
                try {
                    cwd = realpathSync(cwd);
                }
                catch { /* 按原值比较 */ }
                if (!projectCwd(cwd))
                    throw new M.BoardError('NOT_HUB_SESSION', '会话不在「' + config.hubTitle + '」或它的卡片组子工作区里，拒绝绑定：' + sessionId);
                const r = applyToSession(s, cardId, tree);
                await store.mutate((b) => M.bindSession(b, sessionId, cardId, r.title ?? undefined), () => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/bind', card: cardId }]);
                return r;
            },
            linkSessions: async (cardId, items) => {
                const b0 = store.get();
                const c = M.card(b0, cardId);
                // 用户规则：会话里已读过的 STATE 不再注入 → 关联时按会话记录算 readKeys（只算一次，保证注入文本稳定）
                const paths = new Map();
                for (const m of M.memoryOf(b0, c)) {
                    const s = states.get(m.key);
                    if (s)
                        paths.set(m.key, s.path);
                }
                const withRead = await Promise.all(items.map(async (it) => {
                    // sessionQuery 不是本插件的硬依赖：没有时按「没读过」处理（照常注入）
                    const q = ctx.get('sessionQuery');
                    if (!paths.size || !q)
                        return it;
                    try {
                        return { ...it, readKeys: M.readKeysFromEvents((await q.readSession(it.sessionId)).events, paths) };
                    }
                    catch (e) {
                        log?.warn('读取会话记录失败，按未读处理：' + it.sessionId, e);
                        return it;
                    }
                }));
                return store.mutate((b) => M.bindMany(b, cardId, withRead), (r) => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/link', card: cardId, to: String(r.linked) }]);
            },
            unlinkSession: async (sessionId) => {
                const ref = await store.mutate((b) => M.unbindSession(b, sessionId), (r) => [{ at: new Date().toISOString(), actor: 'user', kind: 'session/unlink', card: r.cardId }]);
                return { cardId: ref.cardId };
            },
            unarchiveSession: async (sessionId) => {
                const reg = ctx.workspaceRegistry;
                if (typeof reg.unarchiveSession !== 'function')
                    throw new M.BoardError('UNARCHIVE_UNAVAILABLE', '当前 DSH 没有「恢复归档」能力（workspaceRegistry.unarchiveSession 不存在；需要 dsh-manage-sessions 的核心补丁）');
                if (!(reg.archivedSessionIds ?? []).includes(sessionId))
                    return { restored: false };
                await reg.unarchiveSession(sessionId);
                return { restored: true };
            },
            canUnarchive: () => typeof ctx.workspaceRegistry.unarchiveSession === 'function',
            // DSH 只开放了「选文件夹」：选文件用 macOS 自带的 choose file（可多选），其他平台由界面改为手输路径
            pickFiles: () => new Promise((resolve, reject) => {
                if (process.platform !== 'darwin')
                    return reject(new M.BoardError('PICK_UNAVAILABLE', '当前系统不支持弹出选文件对话框（仅 macOS），请手动输入路径'));
                const script = ['activate', 'set fs to choose file with prompt "选择相关文件（可按住 ⌘ 多选）" with multiple selections allowed', 'set out to ""', 'repeat with f in fs', 'set out to out & POSIX path of f & linefeed', 'end repeat', 'return out'];
                execFile('osascript', script.flatMap((l) => ['-e', l]), { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
                    if (!err)
                        return resolve(M.parsePicked(String(stdout)));
                    if (/-128/.test(String(stderr)))
                        return resolve(null); // 用户点了取消
                    reject(new M.BoardError('PICK_FAILED', '打开系统选文件对话框失败：' + (String(stderr).trim() || err.message)));
                });
            }),
            cleanup: async () => {
                hubWs = null;
                await chain;
                const reg = ctx.workspaceRegistry;
                let groups = 0;
                for (const w of reg.list())
                    if (dirname(w.path) === groupsReal && await reg.delete(w.id))
                        groups++;
                const ws = reg.list().find((w) => w.path === hubReal);
                return { removedWorkspace: ws ? await reg.delete(ws.id) : false, removedGroupWorkspaces: groups };
            },
        }, () => rev);
        return off;
    });
    ctx.inject(['tools'], (h) => { registerTools(h.tools, store, states); });
    ctx.inject(['systemPrompt'], (h) => h.systemPrompt.context({
        name: 'dsh-project-manager:memory',
        order: 130,
        text: (c) => {
            const id = c.agent?.session.id;
            if (!id)
                return '';
            const b = store.get();
            const card = M.cardOfSession(b, id);
            return card ? memoryText(b, card, states, config.memoryMaxBytes, M.sessionRef(b, id)?.readKeys ?? []) : '';
        },
    }));
    log?.info('ready', ROUTE_PREFIX, 'data=' + dataDir, 'hub=' + hubDir(dataDir));
}
//# sourceMappingURL=index.js.map