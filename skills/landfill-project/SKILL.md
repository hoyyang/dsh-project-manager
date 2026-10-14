---
name: landfill-project
description: Strong persist/recall workflow for prompts containing “落盘项目”, “回忆”, or “继续” plus a project slug or issue ID. Uses canonical ~/.ai STATE with optimistic concurrency and verified restart metadata.
---

# 落盘项目

Shared by every CLI that uses `~/.ai` (DeepSeek Harness, Codex, Claude Code, …). The only writer is `~/.ai/tools/ai-memory` (file locks + expected-hash).

- **In DeepSeek Harness with dsh-project-manager**: use the `landfill` tool. It resolves the project (card repos → session cwd; `slug` defaults to the card's STATE), fetches hashes, verifies after writing, and returns inbox paths on conflict. Steps below map to its ops. The plugin also injects the latest full text of the card's STATE + `[必读]` docs into the session (re-injected whenever another session / CLI changes them, and after compaction); injected text counts as read.
- **Elsewhere**: call `~/.ai/tools/ai-memory` directly as written below.

## Project Folder

One landfill project = one folder; `STATE.md` is the only entry point.

```
~/.ai/projects/<project-id>/memory/designs/<slug>/
  STATE.md    entry: restart list, card archive block, file index, state, decisions, next_action
  plans/      AI plans <YYYY-MM-DD>-<title>.md (dsh-project-manager saves approved plans here)
  notes/      topic docs: design / research / knowledge (never a second next_action)
  evidence/   logs, screenshots, probe output, scores (text or binary)
```

- **Every file in the folder has one line** in STATE's `## 📁 文件索引`: `- [必读|参考] <path> · purpose · when to read`. A directory line (`evidence/`) covers everything under it. `[必读]` = must be read before continuing work (text only, keep the total ≤ 60000 chars); `[参考]` = open on demand.
- **Complex projects do not use parent/child STATEs.** Too much content → split topics into `notes/`. Independent workstreams → a separate card in the same group with its own STATE; the group's linked STATE is the overview. Hierarchy comes from the board (written into the card archive block).
- Legacy layouts (`versions/`, `knowledge/`, `assets/`) stay; index them by directory.
- **Filed by card group (dsh-project-manager 0.20)**: each card group has its own landfill folder `~/.ai/projects/<group folder>/`. New STATEs (persist, merge) go there. A STATE linked from a card still in another project is **moved there by the plugin on the next persist** (whole folder, paths rewritten, old folder to `inbox/retired/`, undoable in the session card). A STATE shared by several groups stays with the first group that links it. A STATE whose move the user undid stays where it is.

## Spec Checklist (dsh-project-manager 0.20)

The current spec is a versioned checklist (v2). Every persist re-checks the whole list, so a STATE written under any older spec is brought up to the latest one on its next persist. Items the plugin fixes itself: location (move to the card group's folder). Items you fix while rewriting (the tool refuses `SPEC_ISSUES` until they are right): first line `# 落盘项目 STATE: <slug>`; a `## 📁 文件索引` section (write `- 暂无子文档` when empty); an `aliases:` line under the title that includes every linked card's title. The plugin lists the open items in the persist hint.

## Card Archive Block (dsh-project-manager)

STATE contains `## 🗂 卡片档案 …` between `<!-- dpm:card … -->` and `<!-- /dpm:card -->`. The plugin regenerates it from the board on every persist (repos, subtasks, links, files, notes, parent/sibling cards). It is the authoritative card data: never edit it, never copy its facts into the body (refer to it). Other CLIs writing STATE keep the block verbatim. Wrong card data → ask the user to fix the card on the board (the agent may only tick subtasks via `task_manage`).

## Persist Protocol

1. Resolve the current project: `landfill op=list` / the tool resolves it; CLI: `~/.ai/tools/ai-memory path --cwd "$PWD"`.
2. Derive a stable lowercase kebab-case slug from the user's project name. Preserve the original issue ID in the STATE content.
3. Target `~/.ai/projects/<project-id>/memory/designs/<slug>/STATE.md` (in DeepSeek Harness: the card group's landfill folder; the tool picks it). If the result reports `migrated`, tell the user where the folder moved and that it can be undone in the session card.
4. Existing STATE: read **all of it and every `[必读]` doc** first (`landfill op=recall`; large files come in chunks — repeat with `offset=<next>`; then each `pending` doc with `file=<path>` — until `complete:true`). Then tidy the folder (**Folder Optimization** below), rewrite STATE per **Holistic Optimization**, then write the full new text (`landfill op=persist slug=<slug> content=… drop=[…]`). The tool refuses to overwrite a STATE this session has not fully read (`NEED_FULL_READ`), and refuses a draft that silently loses commit hashes / paths / versions / issue IDs (`DROPPED_ANCHORS`): restore them, or list the deliberately removed ones in `drop` (substring match). Without the tool, read the whole file (if your reader truncates, read ranges until EOF) and diff those anchors yourself. CLI: `ai-memory hash --project <id> memory/designs/<slug>/STATE.md` (output is JSON; use its `hash` field), then `ai-memory update-state --project <id> --slug <slug> --stdin --expected-hash <hash>`.
5. New STATE: `landfill op=persist` (no hash needed). CLI: `ai-memory update-state --project <id> --slug <slug> --stdin`.
6. Never directly edit canonical `~/.ai/**/*.md`. On conflict or out-of-band detection, keep the generated inbox artifact and report its path; do not retry blindly.
7. If the project is not registered, ask the user for the project id and root path, then `landfill op=register … confirm=true` (CLI: `ai-memory register --project-id <id> --canonical-path <path>`). Do not write into an arbitrary other project.
8. Read the written STATE back and verify all required sections before answering (the `landfill` tool does this and reports `verified: true`).
9. Check the tool's `report`: `sizeWarning` / `requiredWarning` / `folderWarning` → optimize again; `missingPaths` → fix each path or remove it (and add it to `drop`); `files.dangling` → drop those index lines; `cardMissingPaths` → tell the user to update the card.
10. The tool refuses: `SPEC_ISSUES` (spec checklist items still open — see Spec Checklist), `NEED_GROUP_FOLDER` (the card group has no landfill folder yet — ask the user to confirm one in the session card), `NEED_FULL_READ` (not fully read), `DROPPED_ANCHORS` (lost facts outside the card block), `UNINDEXED_FILES` (a folder file has no index line), `BAD_TAG` (binary marked `[必读]`), `CARD_HAS_STATE` (the card already has a STATE — write into it, or pass `newState:true` for a real independent workstream).

## Folder Optimization (every persist)

Review files added or changed since the last persist plus anything now outdated:
- **Merge** duplicates into one doc or into STATE (`op=write file=notes/…`; existing docs must be fully read first).
- **Retire** outdated / superseded / wrong / absorbed files (`op=retire file=…` → `projects/<id>/inbox/retired/`, recoverable; text files must be fully read first). Never hard-delete.
- **Import** new evidence (`op=import src=/abs/file` → `evidence/`).
- Keep `[必读]` minimal and accurate; everything else `[参考]` with "when to read".
- Without the tool: `ai-memory write --project <id> --file memory/designs/<slug>/<path> --stdin [--expected-hash h]`, `ai-memory retire --project <id> --file … --expected-hash h`, `ai-memory import --project <id> --file … --src <abs>` (needs ai-memory v2+).

## Holistic Optimization (every persist)

A STATE is the project's single source of truth for restarting work: structured, current, accurate, complete — not a conversation log. Every persist rewrites the whole STATE; never just append.

- **Suggested structure** (order matters, not enforced): `🔄 重启读取清单` (≤15 lines: path, read order, one-line status, next_action) → `🗂 卡片档案` (plugin) → `📁 文件索引` → `📌 metadata` → `📍 current state` → `✅ confirmed decisions` (date + user's words) → `⚠️ red lines / discipline` → `🚧 pending / blockers / awaiting user` → `🗂 index` (Related Memory / Evidence / Code) → `🕘 milestones` (one line per version: version · date · commit · what · status) → `📝 reusable lessons`.
- **Remove**: resolved blockers and finished todos (fold the outcome into a milestone line); superseded plans (keep one line "chose X, switched because Y" only if it prevents re-litigating); probes, debugging narration, conversation flow, raw tool output; facts verified to be wrong.
- **Condense**: state each fact fully in one place, point to it elsewhere; collapse old iterations to one milestone line that keeps the commit/version; replace long evidence with the file path or script name.
- **Keep verbatim**: user red lines, confirmed decisions with the user's words, `pending_user_review` items, unfinished work, still-valid paths/commands, credential *locations* (never values), the card archive block.
- **Accuracy**: verify uncertain facts before writing (git log, file existence); never invent; when unsure, keep it and mark it `未核实`.
- **Size**: aim for ≤ 30000 characters so one recall chunk reads it all; larger is allowed but the tool warns.

## Required STATE Content

- `# 落盘项目 STATE: <slug>`
- `## 🔄 重启读取清单` with canonical STATE path, project memory index, relevant memory/evidence/code read order, recall command/trigger, one-line status, and `next_action`
- metadata including slug, project, problem statement, status, created/updated time, and branch when relevant
- current phase, current step, concrete progress, and next action
- `Related Memory`, `Evidence Index`, and `Code Index`
- confirmed decisions and alternatives/rationale when known
- blockers, risks, pending items, and explicit user-review boundaries
- current-session notes with concrete evidence rather than a vague checkpoint

Never change `pending_user_review` to `confirmed` without explicit user approval.

## Recall Protocol

1. Normalize the requested name and read canonical `~/.ai/projects/<project-id>/memory/designs/<slug>/STATE.md` first (`landfill op=recall slug=<slug>`; ambiguous slugs need `project`). Read every chunk: follow `next`, then every `pending` `[必读]` doc (`file=<path>`), until `complete:true` (the first chunk carries a `toc` and the folder `docs` list). Recall is not done until STATE and every `[必读]` doc are read; text the plugin already injected in full counts.
2. Legacy fallbacks when no canonical STATE exists: repo-local `.ai` manifest target, then other repo-local memory folders the repository documents.
3. Read the STATE and every relevant file named in `Related Memory`, `Evidence Index`, and `Code Index` before analysis.
4. State the restored status and continue from `next_action`; do not reconstruct from memory alone.

## Validation

- Confirm the final path is canonical when the project is registered.
- Confirm the on-disk hash changed for an update or the file exists for a creation.
- Confirm the written STATE is readable and includes every required section.
- Do not claim persistence or recall succeeded based only on configuration presence.
