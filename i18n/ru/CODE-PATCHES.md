# Code edits needed for natural Russian (not covered by string catalogs)

The catalogs replace string literals only. Four small code edits were needed on top of them. For a native integration they belong in `src/` (the snippets below are from the built bundles and are equivalent).

## 1. Russian plural forms (`pl` helper)

Chinese uses classifiers (`个`, `条`, `个阶段`), so the UI concatenates counts and nouns without agreement. Add one helper and use it at the count sites:

```js
/** 1 карточка / 2 карточки / 5 карточек */
function pl(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
```

Sites (all in `lib/client.js`): group header card counter and its tooltip, the “активные сессии” label and its tooltip, group “N репозиториев · M этапов” line, archive tray and card detail counters for sessions/projects, and the session title fallback.

Example:

```js
// before: n + " карточек"
// after:  n + " " + pl(n, "карточка", "карточки", "карточек")
```

## 2. “Main repository” role comparison

Repository role is data (`主仓` in existing `board.json` files) while the UI label is Russian;

```js
// before: r.role === "Основной"
// after:  r.role === "主仓" || r.role === "Основной" || r.role === "Главный репозиторий"
```

and the same for the sorting comparator in `lib/index.js`.

## 3. Sidebar “New session” button detection

The client locates the host’s new-session button by its aria-label; with a Russian UI the aria-label is Russian:

```js
// before: /新建会话|New session/i
// after:  /新建会话|New session|Новая сессия/i
```

## 4. Spacing in the “feature disabled” notice

```js
// before: "Функция проектов на диске не включена:<b>"
// after:  "Функция проектов на диске не включена: <b>"
```

Punctuation (`« »`, `(` `)`, `,`, `:`) is already normalized inside the catalogs, so no separate pass is required when applying a catalog with `tools/apply-catalog.js`.
