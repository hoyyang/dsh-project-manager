/**
 * 4 个 agent 工具（上下文经济：描述短、参数少）。都走 store 串行链，错误返回 {ok:false,code,error}。
 * card_manage / repo_manage / phase_move / task_manage —— 与设计卡 v2 决策 7 对应。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as M from './model.js';
export const TOOL_NAMES = ['card_manage', 'repo_manage', 'phase_move', 'task_manage'];
const toJson = (x) => JSON.parse(JSON.stringify(x ?? null));
const err = (e) => e instanceof M.BoardError ? { ok: false, code: e.code, error: e.message } : { ok: false, code: 'TOOL_FAILED', error: e instanceof Error ? e.message : String(e) };
const actor = (c) => 'agent:' + (c.agent?.id ?? 'unknown');
/** 当前会话绑定的卡片（参数 card 缺省时用它），让 agent 在项目会话里零参数操作自己的卡片。 */
function resolveCard(b, arg, c) {
    if (typeof arg === 'string' && arg !== '')
        return M.card(b, arg);
    const sid = c.agent?.session?.id;
    const bound = sid ? M.cardOfSession(b, sid) : undefined;
    if (!bound)
        throw new M.BoardError('NO_CARD', '未指定 card，且当前会话没有绑定卡片');
    return bound;
}
function summary(b, states) {
    const lines = [];
    for (const g of b.groups) {
        lines.push('# ' + g.name + ' [' + g.id + ']  repos=' + g.repos.map((r) => r.name).join(',') + '  memory=' + g.links.join(','));
        for (const s of g.statuses) {
            const cs = M.cellCards(b, g.id, s.id);
            lines.push('  ' + s.name + ' (' + s.id + '): ' + (cs.map((c) => c.t + '[' + c.id + '] ' + c.tasks.filter((t) => t.done).length + '/' + c.tasks.length + (c.links.length ? ' mem=' + c.links.join(',') : '')).join(' | ') || '—'));
        }
    }
    return lines.join('\n') || '(看板为空)';
}
export function registerTools(host, store, states) {
    host.register(defineTool({
        name: 'card_manage',
        description: 'Project board (dsh-project-manager). op: list | create_group{name} | create{group,title,links?} | update{card?,title?,links?} | remove{card} | link_group{group,links}. links are landfill-project keys "<project>/<slug>". card defaults to the card bound to this session.',
        parameters: {
            op: { type: 'string', required: true, description: 'list|create_group|create|update|remove|link_group' },
            group: { type: 'string', description: 'group id' },
            card: { type: 'string', description: 'card id' },
            name: { type: 'string', description: 'group name' },
            title: { type: 'string', description: 'card title' },
            links: { type: 'array', description: 'landfill-project keys' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                if (a.op === 'list')
                    return { ok: true, text: summary(store.get(), states) };
                const r = await store.mutate((b) => {
                    switch (a.op) {
                        case 'create_group': return M.addGroup(b, String(a.name ?? ''));
                        case 'create': return M.addCard(b, String(a.group ?? ''), String(a.title ?? ''), a.links ?? []);
                        case 'update': return M.updateCard(b, resolveCard(b, a.card, c).id, { t: a.title, links: a.links });
                        case 'remove':
                            M.removeCard(b, String(a.card ?? ''));
                            return null;
                        case 'link_group':
                            M.setGroupLinks(b, String(a.group ?? ''), a.links ?? []);
                            return M.group(b, String(a.group));
                        default: throw new M.BoardError('BAD_OP', '未知 op ' + String(a.op));
                    }
                }, () => [{ at: new Date().toISOString(), actor: actor(c), kind: 'card_manage:' + String(a.op) }]);
                return toJson({ ok: true, result: r });
            }
            catch (e) {
                return err(e);
            }
        },
        timeoutMs: 10_000,
    }));
    host.register(defineTool({
        name: 'repo_manage',
        description: 'Set the repositories mounted on a card group (full list replace). repos: [{name, path (absolute), role?}]. Repos appear under the project hub as repos/<group>/<name>/.',
        parameters: {
            group: { type: 'string', required: true, description: 'group id' },
            repos: { type: 'array', required: true, description: '[{name,path,role?}]' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                const g = await store.mutate((b) => { const g = M.group(b, String(a.group ?? '')); g.repos = M.cleanRepos(a.repos); return g; }, () => [{ at: new Date().toISOString(), actor: actor(c), kind: 'repo_manage', group: String(a.group) }]);
                return toJson({ ok: true, repos: g.repos });
            }
            catch (e) {
                return err(e);
            }
        },
        timeoutMs: 10_000,
    }));
    host.register(defineTool({
        name: 'phase_move',
        description: 'Move a card to another stage (column) of its group, or reorder it with beforeCard; stage ids come from card_manage list. card defaults to this session\'s card.',
        parameters: {
            card: { type: 'string', description: 'card id' },
            status: { type: 'string', required: true, description: 'target stage id' },
            beforeCard: { type: 'string', description: 'insert before this card' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                const ev = await store.mutate((b) => M.moveCard(b, resolveCard(b, a.card, c).id, { col: String(a.status ?? ''), beforeId: a.beforeCard ?? null }, actor(c)), (e) => [e]);
                return toJson({ ok: true, event: ev });
            }
            catch (e) {
                return err(e);
            }
        },
        timeoutMs: 10_000,
    }));
    host.register(defineTool({
        name: 'task_manage',
        description: 'Checklist on a card. op: add{text} | check{index,done} | remove{index}. card defaults to this session\'s card.',
        parameters: {
            op: { type: 'string', required: true, description: 'add|check|remove' },
            card: { type: 'string', description: 'card id' },
            text: { type: 'string', description: 'task text for add' },
            index: { type: 'number', description: '0-based task index' },
            done: { type: 'boolean', description: 'for check' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                const tasks = await store.mutate((b) => {
                    const cd = resolveCard(b, a.card, c);
                    const list = cd.tasks.slice();
                    const i = typeof a.index === 'number' ? a.index : -1;
                    if (a.op === 'add')
                        list.push({ text: String(a.text ?? ''), done: false });
                    else if (a.op === 'check' || a.op === 'remove') {
                        if (i < 0 || i >= list.length)
                            throw new M.BoardError('BAD_INDEX', '子任务序号越界 ' + i + '（共 ' + list.length + ' 项）');
                        if (a.op === 'check')
                            list[i] = { ...list[i], done: a.done !== false };
                        else
                            list.splice(i, 1);
                    }
                    else
                        throw new M.BoardError('BAD_OP', '未知 op ' + String(a.op));
                    M.setTasks(b, cd.id, list);
                    return M.card(b, cd.id).tasks;
                }, () => [{ at: new Date().toISOString(), actor: actor(c), kind: 'task_manage:' + String(a.op) }]);
                return toJson({ ok: true, tasks });
            }
            catch (e) {
                return err(e);
            }
        },
        timeoutMs: 10_000,
    }));
}
//# sourceMappingURL=tools.js.map