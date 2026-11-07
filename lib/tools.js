/**
 * 4 个 agent 工具（上下文经济：描述短、参数少）。都走 store 串行链，错误返回 {ok:false,code,error}。
 * card_manage / repo_manage / phase_move / task_manage —— 与设计卡 v2 决策 7 对应。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as M from './model.js';
import { LandfillError } from './landfill.js';
export const TOOL_NAMES = ['card_manage', 'repo_manage', 'phase_move', 'task_manage', 'landfill'];
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
        const arch = b.cards.filter((c) => c.g === g.id && c.archivedAt);
        if (arch.length)
            lines.push('  已归档（只读）: ' + arch.map((c) => c.t + '[' + c.id + ']').join(' | '));
    }
    return lines.join('\n') || '(看板为空)';
}
export function registerTools(host, store, states) {
    host.register(defineTool({
        name: 'card_manage',
        description: 'Project board (dsh-project-manager). op: list | create_group{name} | create{group,title,links?} | update{card?,title?,links?} | remove{card}. links are landfill-project keys "<project>/<slug>". card defaults to the card bound to this session. 要给卡片关联落盘项目，用 update{card,links}（整份替换）；卡片组的共用记忆（整组所有卡片都会读取）只能在看板的「卡片组设置」里改，本工具不提供。',
        parameters: {
            op: { type: 'string', required: true, description: 'list|create_group|create|update|remove' },
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
        description: 'Set a card group\'s shared repositories (full list replace). New cards copy them at creation; existing cards are unaffected. repos: [{name, path (absolute), role?}].',
        parameters: {
            group: { type: 'string', required: true, description: 'group id' },
            repos: { type: 'array', required: true, description: '[{name,path,role?}]' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                const g = await store.mutate((b) => { const g = M.group(b, String(a.group ?? '')); const next = M.cleanRepos(a.repos); M.noteRepos(b, next.filter((r) => !g.repos.some((o) => o.path === r.path))); g.repos = next; return g; }, () => [{ at: new Date().toISOString(), actor: actor(c), kind: 'repo_manage', group: String(a.group) }]);
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
        description: 'Tasks on a card (two levels: task + subtasks). num = number shown in the card archive ("2" or "2.1"). op: add{text,note?,type?,parent?} | check{num,done} | update{num,text?,note?,type?} | remove{num}. Parent done = all children done. card defaults to this session\'s card.',
        parameters: {
            op: { type: 'string', required: true, description: 'add|check|update|remove' },
            card: { type: 'string', description: 'card id' },
            num: { type: 'string', description: 'task number, e.g. "2" or "2.1"' },
            parent: { type: 'string', description: 'add: parent task number (one level only)' },
            text: { type: 'string', description: 'title' },
            note: { type: 'string', description: 'description' },
            type: { type: 'string', description: 'subtask type (existing name, "" = none)' },
            done: { type: 'boolean', description: 'for check' },
            index: { type: 'number', description: 'legacy 0-based top-level index' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            try {
                const tasks = await store.mutate((b) => {
                    const cd = resolveCard(b, a.card, c);
                    const list = M.taskList(cd.tasks);
                    const num = typeof a.num === 'string' && a.num ? a.num : typeof a.index === 'number' ? String(a.index + 1) : '';
                    const fields = { ...(a.text !== undefined ? { text: String(a.text) } : {}), ...(a.note !== undefined ? { note: String(a.note) } : {}), ...(a.type !== undefined ? { type: String(a.type) } : {}) };
                    if (a.op === 'add') {
                        const t = { text: String(a.text ?? ''), done: false, ...fields };
                        if (typeof a.parent === 'string' && a.parent) {
                            const p = M.taskAt(list, a.parent);
                            if (p.sub)
                                throw new M.BoardError('TOO_DEEP', '子任务最多一层：' + a.parent + ' 已经是子任务');
                            p.task.subs = [...(p.task.subs ?? []), t];
                        }
                        else
                            list.push(t);
                    }
                    else if (a.op === 'check' || a.op === 'update' || a.op === 'remove') {
                        const hit = M.taskAt(list, num);
                        if (a.op === 'remove')
                            hit.list.splice(hit.i, 1);
                        else if (a.op === 'update')
                            Object.assign(hit.task, fields);
                        else {
                            const on = a.done !== false;
                            hit.task.done = on;
                            for (const s of hit.task.subs ?? [])
                                s.done = on;
                        }
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
/** 0.16：落盘项目读写（经 ~/.ai/tools/ai-memory）。失败返回 {ok:false,code,error,inbox?}，冲突不重试。 */
export function registerLandfillTool(host, lf, mg) {
    host.register(defineTool({
        name: 'landfill',
        description: 'Landfill-project memory (~/.ai, via ai-memory). One project = one folder (STATE.md + plans/ notes/ evidence/). slug defaults to the card\'s STATE. op: recall{slug?,file?,offset?} (chunked; complete:true = STATE + all [必读] docs read; follow next / pending) | persist{slug?,content,drop?,newState?} (full rewritten STATE; needs full read; every folder file indexed) | write{slug?,file,content} (text doc in the folder) | retire{slug?,file} (move to inbox/retired) | import{slug?,src,dest?} (local file → evidence/) | append{file,text} | list | register{projectId,path,aliases?,confirm} (ask the user first) | validate | merge{action:plan|note|commit, id, slug?, content?, drop?} (only after the user clicked 合并 in the session card).',
        parameters: {
            op: { type: 'string', required: true, description: 'recall|persist|write|retire|import|append|list|register|validate|merge' },
            action: { type: 'string', description: 'merge: plan|note|commit' },
            id: { type: 'string', description: 'merge id' },
            slug: { type: 'string', description: 'STATE slug or <project>/<slug> (default: card\'s STATE)' },
            project: { type: 'string', description: 'project id' },
            content: { type: 'string', description: 'full STATE markdown for persist' },
            expectedHash: { type: 'string', description: 'hash from recall (optional)' },
            offset: { type: 'number', description: 'recall: chunk start (from next)' },
            drop: { type: 'array', description: 'persist: commits/paths/versions/IDs removed on purpose (substring)' },
            file: { type: 'string', description: 'recall/write/retire: path inside the project folder; append: path under memory/' },
            src: { type: 'string', description: 'import: absolute local file' },
            dest: { type: 'string', description: 'import: evidence/<name>' },
            allowLarge: { type: 'boolean', description: 'import: user already confirmed copying a 50–500MB file (still copies); >500MB always path only' },
            newState: { type: 'boolean', description: 'persist: allow a second STATE for this card' },
            text: { type: 'string', description: 'append: text' },
            projectId: { type: 'string', description: 'register' },
            path: { type: 'string', description: 'register: absolute project root' },
            aliases: { type: 'array', description: 'register' },
            confirm: { type: 'boolean', description: 'register: user agreed' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, exec) => {
            const a = args;
            const c = exec;
            const s = { id: c.agent?.session?.id, cwd: c.agent?.session?.header?.cwd };
            const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);
            const need = (v, f) => { const x = str(v); if (!x)
                throw new LandfillError('BAD_ARG', '缺少参数 ' + f); return x; };
            try {
                switch (a.op) {
                    case 'recall': return toJson({ ok: true, ...(await lf.recall(s, str(a.slug), str(a.project), a.offset === undefined ? 0 : Number(a.offset), undefined, str(a.file))) });
                    case 'persist': return toJson({ ok: true, ...(await lf.persist(s, str(a.slug), a.content, str(a.project), str(a.expectedHash), a.drop ?? [], a.newState === true)) });
                    case 'write': return toJson({ ok: true, ...(await lf.write(s, str(a.slug), a.file, a.content, str(a.project), str(a.expectedHash))) });
                    case 'retire': return toJson({ ok: true, ...(await lf.retire(s, str(a.slug), a.file, str(a.project))) });
                    case 'import': return toJson({ ok: true, ...(await lf.importFile(s, str(a.slug), a.src, a.dest, str(a.project), { allowLarge: a.allowLarge === true })) });
                    case 'append': return toJson({ ok: true, ...(await lf.append(s, a.file, a.text, str(a.project))) });
                    case 'list': return toJson({ ok: true, ...lf.list(str(a.project)) });
                    case 'register': return toJson({ ok: true, ...(await lf.register(a.projectId, a.path, a.aliases, a.confirm)) });
                    case 'validate': return toJson({ ok: true, ...(await lf.validate()) });
                    case 'merge': {
                        if (!mg)
                            throw new LandfillError('MERGE_OFF', '合并不可用');
                        const id = need(a.id, 'id');
                        if (a.action === 'plan')
                            return toJson({ ok: true, ...mg.plan(s.id, id) });
                        if (a.action === 'note')
                            return toJson({ ok: true, ...mg.note(s.id, id, need(a.slug, 'slug'), a.content) });
                        if (a.action === 'commit')
                            return toJson({ ok: true, ...(await mg.commit(s.id, id, a.content, a.drop ?? [])) });
                        throw new LandfillError('BAD_ARG', 'merge 的 action 是 plan | note | commit');
                    }
                    default: throw new LandfillError('BAD_OP', '未知 op ' + String(a.op));
                }
            }
            catch (e) {
                if (e instanceof LandfillError)
                    return toJson({ ok: false, code: e.code, error: e.message, ...e.extra });
                return err(e);
            }
        },
        timeoutMs: 60_000,
    }));
}
//# sourceMappingURL=tools.js.map