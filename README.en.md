# dsh-project-manager

![banner](assets/banner.png)

**A project board for DeepSeek Harness: card groups are parent projects, cards are the work. Each card links landfill-project memory, mounted repos and sessions, and every session opened from a card starts with that project context loaded.**

[**中文**](README.md) · [Releases](https://github.com/hoyyang/dsh-project-manager/releases) · [Changelog](CHANGELOG.md)

<p align="center">
  <img alt="dsh" src="https://img.shields.io/badge/dsh-0.2.0--rc.2-2f5fcc">
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

**Zero config**: restart dsh after installing — no account, API key or settings needed. Landfill projects are scanned read-only from `~/.ai`; see "Configuration" to change the data folder or the permission mode.

**Supported dsh versions**

| Environment | Version | Status |
|---|---|---|
| dsh CLI (`@deepseek-ai/dsh`, `dsh web`) | `0.2.0-rc.2` | Tested (0.11.0) |
| DSH Desktop | `2.0.17` (bundles dsh `0.2.0-rc.2`) | Tested (0.11.0) |
| dsh `0.1.5-rc.1` | — | Tested with 0.4.0; not re-verified since 0.5.0 |
| peerDependencies | `@deepseek-ai/cordis >=4.0.1 <5`, `@deepseek-ai/dsh-tools >=0.1.5-rc <2`, `@deepseek-ai/dsh-client-ui-slots >=0.1.5-rc <2`, `@deepseek-ai/schemastery ^3.18.1` | Declared ranges; other versions inside them not individually tested |

Needs the dsh web UI (`dsh web` from the CLI, or DSH Desktop). The sidebar counts, indentation and the "+" takeover depend on the markup of dsh's workspace list; if a future dsh changes it, those three simply stop showing — the board and sessions keep working.

## Features

![Project board](assets/board-zh.png)

### Board

- **Every project at a glance**: one swim lane per card group; stage names, count and order are editable. Drag cards within a stage (Alt+↑/↓ from the keyboard) or to another stage to advance them. Drag a group by the handle on its header to reorder; click anywhere on the left of the header to collapse/expand.
- **Add cards right where they go**: every stage has an always-visible "添加卡片" row — Enter adds and keeps typing, Esc closes. Or bulk-import landfill projects (one STATE → one linked card).
- **Two small badges per card**: a session badge (green with active sessions, gray when all are archived, hidden with none) and the landfill-project count (hidden when zero). Subtasks live in the detail pane.
- **Archive cards**: the archive icon on a card or in its detail, or drag the card into the opened "已归档卡片" tray. The tray is collapsed by default; open it in place, click a row for a read-only detail, "恢复活跃" puts it back in its stage. The card's sessions are not touched.
- **The agent can edit the board too**: 4 tools `card_manage` / `repo_manage` / `phase_move` / `task_manage`; inside a project session, omitting `card` targets the session's own card.

### Card detail

![Card detail](assets/card-detail-zh.png)

- **The card's sessions come first**: active ones first, then archived, each newest first. Open them, archive them (same call as dsh's sidebar "归档会话"; a session that is still working asks "停止并归档" first, with undo), restore archived ones to their original place in the workspace, or unlink with a confirmation (the session is never deleted).
- **Link existing sessions**: search by session name or repo; active and archived columns grouped by repo, newest first; tick and save once. A session belongs to one card.
- **Landfill projects, titles first**: "关联的落盘项目" shows only titles by default; a single "展开详情 / 收起详情" button expands or collapses all of them (project, updated date, one-line status, next_action). The choice sticks while you switch cards and resets when the board is reopened.
- **Notes / links / files**: notes have no length limit, URLs are clickable and long notes fold with "展开全部 / 收起"; links have a label, a type ("文档 / 代码" by default, new types are shared across cards) and a full URL, with bulk add, edit, delete and drag-to-reorder, opening in your default browser; files are picked with the system file dialog, shown as present/deleted, and unlinking never deletes the file.
- **Stages and subtasks**: click a step to move there, or "推进到 …"; tick, delete or add subtasks with Enter.

![Landfill projects expanded](assets/card-memory-zh.png)

### The 项目区 sidebar section

![Sidebar](assets/sidebar-zh.png)

- **A pinned 项目区 workspace**: kept first in the workspace list, with one sub-workspace per card group (nested under 项目区 when dsh's view options use "Workspace Tree" grouping). Project sessions live there by group.
- **Active session counts**: each card-group row shows how many unarchived sessions it has, gray 0 when none; it updates as sessions are created, archived or restored, with a small bump when it changes. On hover the number stays and the row actions appear to its right.
- **Clear nesting**: a group's sessions are indented as whole rows to the right of a vertical guide line — the selected background and any border/fill other plugins add to session rows move with them; an expanded group's name turns bold.
- **Opening from the board reveals the session**: after "打开" in the detail, opening from the "新建会话" dialog, or creating a session from a card, the session's group (and 项目区) expands if collapsed and scrolls to the session; groups that are already open are never collapsed.
- **"+" asks for a card first**: the "+" on 项目区 or a group row opens a card picker (a group row lists only its own cards; each row shows stage, memory count and session count), then the "新建会话" dialog lets you pick exactly one: start a new session, or open one of the card's linked sessions (archived ones can be restored in place).
- **The "项目看板" hero button** sits in the sidebar's global panel list next to Plugins, with an "N in progress" badge.

![Card picker](assets/card-picker-zh.png)

### Sessions

- **Memory loads itself, and only once**: sessions created from a card or linked to it get the de-duplicated "group ∪ card" landfill memory (one-line status, next_action, STATE path) every turn; on linking, the session history is scanned and STATEs it already `read` are skipped.
- **Card materials come along**: the card's notes (full text, truncated with a note above 16 KB), links (label + URL + type) and files (absolute paths) are injected as "卡片资料" after the memory — even when no landfill project is linked.
- **Memory strip**: above the composer, "已自动读取 N 个落盘项目的记忆，M 个已读过不重复读取", collapsed by default, expandable to each next_action.
- **Same-name hint**: when a card has no linked landfill project but its title contains one's name (e.g. an issue id), the "新建会话" dialog and the memory strip offer a one-click "关联" — never linked silently.
- **Project sessions start with full access** and are renamed to the card name ("Workspace Tree" grouping) or "group · card".

**How it differs**: most board plugins track per-workspace to-dos. This one does not do generic to-dos; it does one chain — project → landfill memory → repos → sessions — so a card is the project and its sessions inherit the context.

## Quick start (30 seconds)

1. Click the "项目看板" hero button under Plugins in the sidebar, then "新建卡片组", type a name and press Enter.
2. Click "添加卡片" at the bottom of any stage, type a title and press Enter; keep typing to add more.
3. Open the card detail, click "关联" next to linked landfill projects, tick them and save.
4. Open "卡片组设置", click "添加" next to repos, tick dsh workspaces or click "选择文件夹…", then "保存".
5. Click "以此卡片新建会话" at the bottom of the card detail: the session appears in that group's sub-workspace under 项目区 with memory loaded, and the group row's count goes up by one.

| Action | Result |
|---|---|
| Drag a card to another stage | The card moves; `events.jsonl` gets a move record |
| Type a title at the bottom of a stage and press Enter | A new card at the end of that stage; the input stays open |
| Create a session from a card | It appears in the group sub-workspace, the group count +1, a collapsed group expands |
| Archive an active session in the detail | The group count −1, you stay on the board, with undo |
| Click "展开详情" | Every linked landfill project shows its status and next_action |
| Click "恢复活跃" on an archived session | It returns to its original place in the workspace, now active |
| Mount a path that is already mounted | Rejected with `REPO_MOUNTED`, naming the existing repo |

Let the agent drive the board from a project session (omitting `card` targets this session's card):

```text
> Move this card to 验收 and add a subtask "补回归用例"
phase_move  { "status": "verify" }                     → {"ok":true,"event":{"kind":"move","from":"开发","to":"验收"}}
task_manage { "op": "add", "text": "补回归用例" }      → {"ok":true,"tasks":[…,{"text":"补回归用例","done":false}]}
```

## Use cases

- **One feature across several repos**: mount front end, SDK and infra repos on a group; project sessions read and write them through `repos/<repo>/`, and AGENTS.md lists them.
- **Pick a long project back up**: link the STATE written by /landfill-project to a card; tomorrow's session opened from that card already has the status and next_action.
- **Gather scattered sessions**: link discussions started in various workspaces to one card and see the whole project's progress in one place.
- **Start the day with the big picture**: the sidebar shows each group's active session count, the board shows every card's stage and session badge.
- **Bring back an archived session**: when an old discussion is needed again, "恢复活跃" on the card puts it back where it was.
- **Hand over to a teammate or a new session**: the card's landfill projects, notes, links, files and sessions are the handover checklist.
- **Stage-based reviews**: name a group's stages after your process (e.g. 方案 → 开发 → 验收) and walk the board column by column.
- **Let the agent advance work**: `phase_move` and `task_manage` from a project session update the board live, every move audited.

![Link existing sessions](assets/link-sessions-zh.png)

## What you get

- Under 项目区 each group row carries its active session count; its sessions are indented behind a guide line; opening a session from the board expands its group.
- Board cards show the session badge and landfill-project count; in the detail, landfill projects are titles first with one button to expand all.
- A memory strip above the composer, expandable to each next_action; card materials injected alongside the memory.
- Sessions in 项目区 and its group sub-workspaces start with full access and are renamed to the card name or "group · card".
- The 项目区 folder holds `repos/<group>/<repo>` symlinks and an AGENTS.md; each group folder holds its own `repos/<repo>` and AGENTS.md; repo AGENTS.md / CLAUDE.md files load via those literal paths.
- Every move, link and mount is appended to `events.jsonl` — who (user / agent) did what, and when.
- Dark theme follows dsh; the board has a one-click toggle.

![Mount repos](assets/add-repos-zh.png)

## Configuration

Works with zero config. To override, add a top-level id entry to the profile's `cordis.patch.yml` (not inside an `insert:` list):

```yaml
- id: dsh-project-manager
  config:
    dataDir: ''                              # default <DSH_HOME>/dsh-project-manager
    aiRoot: ''                               # default ~/.ai (read-only)
    hubTitle: 项目区
    projectSessionMode: danger-full-access   # or inherit (follow the global permission)
    memoryMaxBytes: 6000                     # per-session memory budget, 1000–32000
```

## How it works

- **Data**: the board lives in `<dataDir>/board.json` (atomic writes, serialized mutations); audits append to `events.jsonl`; landfill projects are scanned read-only on demand from `~/.ai/projects/*/memory/designs/*/STATE.md`.
- **项目区**: one workspace registered through the official `workspaceRegistry` (folder `<dataDir>/hub`) and kept first; each card group registers a sub-workspace (`hub/groups/<group id>`, titled with the group name), which dsh's "Workspace Tree" grouping nests by folder. Repos are symlinked under `hub/repos/<group>/<repo>` and `hub/groups/<group id>/repos/<repo>`.
- **Memory injection**: per-session card memory and materials through the official `systemPrompt.context`; unchanged text is not resent and the "already read" set computed at link time stays fixed.
- **Sessions and archive**: candidates come from dsh's session and workspace lists; archiving calls `workspaces.archiveSession`, restoring calls `workspaceRegistry.unarchiveSession` (from dsh-manage-sessions); archiving never changes a session's order in its workspace, so restoring puts it back in place.
- **UI**: the board is a main-area panel; the hero button uses the official `sidebar.panellist` slot. The sidebar counts and nesting are one stylesheet generated per row id (`[data-row-key="workspace:<id>"]`) without touching dsh's nodes; the "+" takeover and the auto-expand are DOM enhancements (auto-expand = one simulated click on a collapsed row). When those rows can't be found they are skipped quietly and the official "+" still creates a session.

## Reliability and verification

- **Isolated verification**: every release is assembled in a separate staging DSH_HOME first; it reaches the everyday dsh only after the cold-start static checks (dependency links / bundle manifest / runtime imports / duplicate entries — six classes) pass for this plugin.
- **Real GUI tests**: Playwright drives a real dsh web — 22 new checks in 0.11.0 (count 1→2→1→2, gray 0, no numbers on other workspaces, whole-row indentation and guide-line position, auto-expand after collapsing a group or 项目区, open groups not collapsed, landfill titles-first and expand/collapse-all), plus 28 + 36 + 42 + 8 regression checks — all passing, 0 page errors.
- **Live-instance check**: after installing into the everyday dsh, read-only probes confirm the new code is running (0.11.0: group counts, indentation in both grouping modes, dsh-kiro session styling moving with the indent, auto-expand after opening from the board).
- **Uninstall/reinstall is idempotent**: after uninstalling there are no styles, no entry, no sidebar numbers and routes return 404 while user data stays; after reinstalling everything comes back and all checks pass again.
- **Upgrade check**: old data loaded with the previous build reads losslessly after an in-place upgrade (missing fields fall back to defaults; no migration).
- **Unit tests**: 49 node:test cases cover the board model, mount conflicts, bulk session linking and moves, read detection, memory budget and omission notes, card-material injection, link validation and symlink containment.
- **Failures name names**: conflicts and errors return explicit codes and objects such as `REPO_NAME_TAKEN`, `REPO_MOUNTED`, `BAD_URL` (with the row number), `CARD_ARCHIVED`, `UNARCHIVE_UNAVAILABLE` — never swallowed.
- **Compatibility and limits**: "恢复活跃" needs the core patch from dsh-manage-sessions; without it the button is disabled with the reason. Several dsh processes sharing one DSH_HOME have no cross-process lock.
- **Security boundary**: project sessions default to full access (only for sessions in the 项目区 folders; switch to `inherit`); HTTP routes accept loopback only and writes check same-origin, with no login check; no credentials read or written, no network access, no git commands; deleting a group removes symlinks only, never real repos.

![Dark theme](assets/board-dark-zh.png)

## FAQ

- **No 项目区 in the sidebar?** It is registered with the first project session; until then use the "项目看板" hero button.
- **Groups not nested under 项目区?** Set grouping to "Workspace Tree" in the view options next to the workspace list title.
- **No numbers or indentation on group rows?** Only 项目区's group sub-workspaces get them; if a dsh update changed the markup they switch off on their own — please open an issue with your dsh version.
- **Group didn't expand after opening from the board?** It applies only to sessions in 项目区 and its groups; a sidebar collapsed to an icon rail has no rows to expand.
- **"恢复活跃" is disabled?** Your dsh lacks `workspaceRegistry.unarchiveSession`; install dsh-manage-sessions and apply its core patch.
- **"选择文件夹…" became a text field?** dsh is using its web file browser (non-local or remote access), which can't open the system dialog; type an absolute path.
- **A new session shows "新会话" in the sidebar?** That is how dsh shows blank sessions; after the first message it shows the card name.

## Uninstall

1. Call `POST /_dsh/dsh-project-manager/api/hub/cleanup` (or remove 项目区 and the group workspaces from the workspace list by hand) to drop the workspaces the plugin registered; sessions and files are not deleted.
2. `dsh plugin --profile web remove dsh-project-manager`, then restart dsh.
3. Data stays in `<DSH_HOME>/dsh-project-manager/` (board.json, events.jsonl, hub/); delete it by hand if you want.

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
