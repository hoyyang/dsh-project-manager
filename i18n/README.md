# Russian localization for `dsh-project-manager` (0.20.1)

This directory contains a complete Russian localization of the project board **UI** and the **host messages** of `dsh-project-manager@0.20.1`, packaged as a translation catalog plus a reproducible pipeline.

The plugin UI strings are hardcoded in the sources and compiled into `lib/client.js` and the host modules; the plugin does not use a locale service, so there is no `en.json`/`ru.json` to extend. The catalogs below therefore map **Chinese source literal → Russian literal**, and the tools apply them to built files. Nothing in this PR changes existing source code or build outputs — it only adds files under `i18n/` and `docs/`.

## What is inside

| Path | Content |
|---|---|
| `ru/strings-client.json` | 809 string pairs for `lib/client.js` (board, cards, dialogs, toasts, filters, empty states) |
| `ru/strings-host-*.json` | 462 string pairs across 11 host modules (`index`, `tools`, `routes`, `landfill`, `model`, `merge`, `memory`, `migrate`, `hub`, `lfspec`, `states`) |
| `ru/intentionally-untranslated.json` | 61 strings kept Chinese **by design**: regex bodies, `[必读]`/`[参考]` index tags, STATE headings such as `## 📁 文件索引`/`## 🗂 卡片档案` — they are parsed by the plugin's own Chinese regexps or describe the on-disk STATE format |
| `ru/CODE-PATCHES.md` | the four tiny code edits needed for Russian grammar (plural helper, role comparison, session-button regex, spacing) |
| `ru/README.ru.md` | Russian user guide for the board |
| `tools/` | the localization pipeline (see below) |
| `../docs/presentation/dsh-project-board-ru.html` | standalone HTML presentation about the board and the localization work (open in a browser; styles/fonts come from a CDN, so it needs internet) |

## Pipeline

1. **`extract-literals.js`** — scans a built JS module and collects string literals containing CJK, ignoring comments and regex literals.
2. **`prepare-batches.js`** — splits literals into translatable fragments with bounded context (some HTML/CSS literals are 100 KB+) and emits JSON batches.
3. *Translation* — batches translated to Russian; results live in the `ru/strings-*.json` catalogs in this repository.
4. **`audit-functional.js`** — flags literals used functionally (regex bodies, comparison operands, STATE format markers); those are excluded from translation by design.
5. **`apply-safe.js` / `apply-catalog.js`** — apply a translation by **whole string literal position** only, so regex bodies, comments and code are never touched. `apply-catalog.js <target.js> <catalog.json> --write` applies a finished catalog directly.
6. **`verify-host.js`**, **`restore-regexes.js`**, **`smoke-client.js`** — checks: `node --check` on every bundle, regex bodies restored from the pristine source, client bundle factory executed with a stub loader (exports `apply`/`inject`).

`normalize.js` and `reapply-translations.js` are the maintenance helpers used after a plugin upgrade.

## Validation performed

- 1271 literals translated in total (809 client + 462 host), 927 client occurrences and 503 host occurrences applied.
- All 13 bundles pass `node --check`; the client bundle factory executes and exports `apply`/`inject`.
- 0 regex bodies left corrupted; the only regex containing Cyrillic is the intentional `Новая сессия` alternative for the sidebar button.
- 61 functional strings are intentionally untouched (see `ru/intentionally-untranslated.json`).
- Russian plural forms are handled by a small `pl()` helper (1 карточка / 2 карточки / 5 карточек) — described in `ru/CODE-PATCHES.md`.

## How to use it

```sh
# 1. Get a pristine 0.20.1 package
npm pack dsh-project-manager@0.20.1
mkdir -p work && tar -xzf dsh-project-manager-0.20.1.tgz -C work

# 2. Check the catalog against a bundle (dry run), then apply
node i18n/tools/apply-catalog.js work/package/lib/client.js i18n/ru/strings-client.json
node i18n/tools/apply-catalog.js work/package/lib/client.js i18n/ru/strings-client.json --write

# 3. Same for each host module
for f in index tools routes landfill model merge memory migrate hub lfspec states; do
  node i18n/tools/apply-catalog.js "work/package/lib/$f.js" "i18n/ru/strings-host-$f.json" --write
done

# 4. Apply the four code edits from i18n/ru/CODE-PATCHES.md (plural helper, role comparison, regex, spacing)
# 5. Verify
node i18n/tools/verify-host.js work/package/lib
node i18n/tools/smoke-client.js work/package/lib/client.js
```

The catalogs are pinned to **0.20.1**. After an upstream release, re-run the extraction/audit step to see which strings changed; unchanged entries still apply.

## Scope and limitations

- Russian UI only. The project already ships English and Chinese docs; the plugin UI has never had a language switch.
- The Windows limitation of the *landfill memory* feature (`ai-memory` needs `fcntl`) is unrelated to the localization and stays as it is.
- This is a localization of built bundles, not an i18n refactor: if you are interested, the catalog can be ported to a locale service (an `ctx.locale`-based lookup) so translations ship as first-class resources — happy to adapt the work to whatever shape you prefer.
- Two tiny code edits (plural forms, role labels) are required for natural Russian and are documented, not hidden.

## License

The original plugin is MIT © 2026 hoyyang; these derivative localization files are provided under the same MIT license, keeping the original copyright notice.
