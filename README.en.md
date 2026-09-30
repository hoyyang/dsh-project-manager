# dsh-project-manager

![banner](assets/banner.png)

**A project board for DeepSeek Harness: card groups are parent projects, cards are tasks. Each card links landfill-project memory, mounted repos and sessions — sessions opened from a card start with the project context already loaded.**

[**中文**](README.md) · [Releases](https://github.com/hoyyang/dsh-project-manager/releases) · [Changelog](CHANGELOG.md)

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-project-manager"><img alt="npm" src="https://img.shields.io/npm/v/dsh-project-manager"></a>
  <a href="https://www.npmjs.com/package/dsh-project-manager"><img alt="downloads" src="https://img.shields.io/npm/dm/dsh-project-manager"></a>
  <a href="https://github.com/hoyyang/dsh-project-manager/releases"><img alt="release" src="https://img.shields.io/github/v/release/hoyyang/dsh-project-manager"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/hoyyang/dsh-project-manager"></a>
  <a href="https://github.com/hoyyang/dsh-project-manager/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hoyyang/dsh-project-manager"></a>
</p>

## Install

```sh
dsh plugin add dsh-project-manager
```

Alternative (straight from GitHub):

```sh
dsh plugin add github:hoyyang/dsh-project-manager
```

**Zero config, works out of the box**: restart dsh web and it is there — no account, API key or settings. Requires DSH `0.1.5-rc.1` (tested; other versions not verified). Landfill-project memory is read (read-only) from `~/.ai`; see "Configuration" to change paths or the permission mode.

## What it does

![Project board](assets/board-zh.png)

- **See everything by project**: one swim lane per card group; rename, add, remove and reorder its stages (columns); drag cards within a stage (Alt+↑/↓ on the keyboard) or to another stage to advance them.
- **Add cards anywhere**: every stage has an always-visible "添加卡片" row — Enter adds and keeps typing, Esc closes; or bulk-import from landfill projects.
- **Cards carry project memory**: card groups and cards each link any number of /landfill-project `STATE.md` files; a session reads the de-duplicated union — one-line status, next_action and STATE path.
- **Sessions auto-read memory, never twice**: sessions created from or linked to a card get the card's memory every turn; when linking, the session log is scanned and STATE files it already `read` are not injected again.
- **Link existing sessions**: search by session name or repo; Active / Archived columns grouped by repo, newest first; ticked sessions move to "Selected" and are saved in one go. A session belongs to one card.
- **Restore archived sessions in one click**: linked rows show name and status; archived ones cannot be opened and have "恢复活跃", which puts the session back in its original workspace slot. "解除关联" asks once and never deletes the session.
- **Mount repos**: the "添加挂载仓库" dialog ticks workspaces already added to dsh or uses dsh's native folder picker; the default name is the folder name, editable, multi-select.
- **A pinned 项目区 workspace**: project sessions live in one workspace kept first in the list; a board button sits beside its title, and its "+" asks which card the new session belongs to.
- **Agents can drive the board**: four tools — `card_manage`, `repo_manage`, `phase_move`, `task_manage` — default to the current session's card inside a project session.

**How it differs**: kanban plugins such as dsh-project-kanban track per-workspace todos. This plugin is not a generic todo list; it owns one chain — project → landfill memory → repos → sessions — so a card *is* the project and every session inherits its context.

## Quick start (30 seconds)

1. Click "项目看板" in the sidebar (once 项目区 exists, click the board button beside its title), then click "新建卡片组" and type a name.
2. Click "添加卡片" at the bottom of any stage, type a title and press Enter; keep typing to add more.
3. Open the card detail, click "关联" next to linked landfill projects, tick them and save.
4. Open "卡片组设置", click "添加" next to Repos, tick existing dsh workspaces or click "选择文件夹…", then click "保存".
5. Click "以此卡片新建会话" at the bottom of the card detail: the session appears in 项目区, titled "group · card", with memory loaded.
6. Click "关联已有会话" next to the card's sessions, tick existing sessions and click "保存关联".
7. Drag the card to the next stage, or click "推进到 …" in the detail to move it forward.

| Action | Result |
|---|---|
| Drag a card to another stage | The card moves; `events.jsonl` gets a move entry |
| Type a title at the bottom of a stage and press Enter | A new card appears at the end of that stage; the input stays open |
| Tick sessions and click "保存关联" | They appear under the card and load its memory from the next turn |
| Click "恢复活跃" on an archived session | It returns to its original workspace slot and turns active |
| Tick workspaces in "添加挂载仓库" and save | `repos/<group>/<repo>` symlinks appear in 项目区 and AGENTS.md updates |
| Mount a path that is already mounted | Save is refused with `REPO_MOUNTED` naming the existing repo |

Let the agent drive the board inside a project session (no `card` argument = this session's card):

```text
> Move this card to review and add a subtask "add regression tests"
phase_move  { "status": "verify" }                           → {"ok":true,"event":{"kind":"move","from":"开发","to":"验收"}}
task_manage { "op": "add", "text": "add regression tests" }  → {"ok":true,"tasks":[…,{"text":"add regression tests","done":false}]}
```

![Card detail](assets/card-detail-zh.png)

## Use cases

- **One feature, several repos**: mount the frontend, SDK and infra repos on a card group; project sessions read and write them under `repos/<group>/<repo>/`, with an auto-generated AGENTS.md listing them.
- **Resume long-running projects**: link a /landfill-project STATE to the card; tomorrow's session from that card already has the status and next_action in context — no manual "recall".
- **Gather scattered sessions**: attach discussion sessions from different workspaces to one card with "关联已有会话" and see the whole project at a glance.
- **Pick up an archived discussion again**: click "恢复活跃" on the card and the session returns to its original workspace slot, ready to continue.
- **Start the day with the big picture**: open the board to see which stage each project is in, how many subtasks are done and which cards still lack memory.
- **Hand over to a teammate or a new session**: the card's landfill projects, mounted repos and session list are the handover checklist; open a new session from the card to take over.
- **Review by stage**: name a group's stages after your team's flow (e.g. design → build → review) and walk the board column by column.
- **Let the agent move work forward**: inside a project session the agent calls `phase_move` and `task_manage`; the board updates live and every move is logged.

![Link existing sessions](assets/link-sessions-zh.png)

## What you'll see

- Each card shows a subtask progress bar and a memory count; cards with no linked landfill project show 0 as a reminder.
- A memory strip above the session composer: "N landfill projects loaded, M already read and skipped", expandable to each next_action.
- Sessions in 项目区 start with full access and are renamed "group · card".
- The 项目区 folder holds `repos/<group>/<repo>` symlinks and an AGENTS.md; repo AGENTS.md / CLAUDE.md files load via those literal paths.
- Every move, link and mount is appended to `events.jsonl` with who (user / agent) and when.
- Dark mode follows dsh, with a one-click toggle on the board.

![Add mounted repos](assets/add-repos-zh.png)

## Configuration

Nothing is required. To override, add a top-level id entry to the profile `cordis.patch.yml`:

```yaml
- id: dsh-project-manager
  config:
    dataDir: ''                              # default <DSH_HOME>/dsh-project-manager
    aiRoot: ''                               # default ~/.ai (read-only)
    hubTitle: 项目区
    projectSessionMode: danger-full-access   # or inherit (follow the global setting)
    memoryMaxBytes: 6000
```

## How it works

- **Data**: the board lives in `<dataDir>/board.json` (atomic, serialized writes) with an append-only `events.jsonl`; landfill projects are scanned read-only from `~/.ai/projects/*/memory/designs/*/STATE.md`.
- **项目区**: registered through the official `workspaceRegistry` (folder `<dataDir>/hub`) and kept first; repos are symlinked under `hub/repos`.
- **Memory injection**: per-session card memory through the official `systemPrompt.context`; unchanged text is not re-sent, and the "already read" set is fixed at link time so nothing is injected repeatedly.
- **Sessions and archive**: candidates come from dsh's session and workspace lists; restore calls `workspaceRegistry.unarchiveSession` (provided by dsh-manage-sessions). Archiving never reorders a workspace's sessions, so restoring returns the session to its slot.
- **UI**: the board is a main-area panel; the board button and "+" on the 项目区 sidebar row are DOM enhancements that fall back to the official panel entry if the row cannot be found.

## Reliability and verification

- **Isolated staging**: every release is assembled in a separate staging DSH_HOME and must pass the cold-start static checks (dependency links, bundle manifest, duplicate entries and three more) before promotion.
- **Upgrade tested**: the previous release seeds old data, then the new one upgrades in place with nothing lost (e.g. 0.2.0 drops the old category and evidence-gate fields while keeping stages and card positions).
- **Idempotent uninstall/reinstall**: after uninstall there are no styles, no entry and routes return 404, with user data kept; reinstall restores everything.
- **Unit tests**: 33 node:test cases cover the board model, batch mount conflicts, batch session linking and moving, read detection, memory budget and omission notes, and symlinks never escaping `repos/`.
- **Real GUI tests**: Playwright drives the real dsh web end to end (drag, inline add, multi-select dialogs, restore, confirm-unlink, light/dark) with zero errors.
- **Fails loudly**: conflicts return explicit codes naming the object — `REPO_NAME_TAKEN`, `REPO_MOUNTED`, `NOT_LINKED`, `UNARCHIVE_UNAVAILABLE` — never silently swallowed.
- **Compatibility and limits**: "恢复活跃" needs dsh-manage-sessions' core patch and is disabled with a reason when missing; no cross-process lock if several dsh processes share one DSH_HOME.
- **Security boundary**: project sessions default to full access (only sessions whose folder is 项目区; set `inherit` to opt out); HTTP routes accept loopback only and check same-origin for writes, with no login check; no credentials, no network, no git; deleting a group removes symlinks only, never the real repos.

![Dark mode](assets/board-dark-zh.png)

## FAQ

- **No 项目区 in the sidebar?** It is registered when you create the first project session; until then use the "项目看板" sidebar entry.
- **"恢复活跃" is greyed out?** This dsh lacks `workspaceRegistry.unarchiveSession`; install dsh-manage-sessions and apply its core patch.
- **"选择文件夹…" turned into a text box?** dsh is using its web file browser (remote or non-local access), so the native dialog is unavailable — type the absolute path.
- **A new session shows "New Session" in the sidebar?** That is dsh's rule for blank sessions; after the first message it shows "group · card".

## Uninstall

1. `POST /_dsh/dsh-project-manager/api/hub/cleanup` (or remove 项目区 from the workspace list) to drop the registered workspace; sessions and files are kept.
2. `dsh plugin --profile web remove dsh-project-manager` (and remove it from `dsh.profile.bundles` in the profile `package.json`), then restart `dsh web`.
3. Data stays in `<DSH_HOME>/dsh-project-manager/` (board.json, events.jsonl, hub/); delete it manually if you want.

## Build locally

```sh
npm install
npm run build          # host: tsc → lib/
npm run build:client   # client: tsdown → lib/client.js
npm run typecheck
npm test               # node:test unit tests
```

## License

[MIT](LICENSE)
