# Coding standards

The review checklist. A review is complete when every hunk has been read against every
rule here and every invariant in `CLAUDE.md`, plus `docs/site.md` for a hunk in
`web/` and `docs/data.md` for one on the write path, and each finding names the rule
it breaks. Those files carry the reasons; this file carries the checks.

## Site (`web/`)

- Text that can come from Steam (a persona, a Map's title or description) is rendered as
  React text, never through `dangerouslySetInnerHTML`. An image URL from Steam goes
  through `safeImg`, and every link inside the site is built by `lib/routes.ts`.
- A page reads the database only through `db/data.ts`'s cached reads (a search through its
  fresh ones), never `db/site.ts` directly, so every read is tagged and revalidated.
- `lib/` is pure: nothing in it imports React, Next or `db/`, and its rules are tested in
  `web/test/`. A component is a client component only where it needs state, an effect, a
  browser API or an event handler; a server component imports no value from a client
  module.
- Anything that can be told from the path alone (a board name, a tab, a Steam ID's shape)
  answers 404 or redirects in `proxy.ts`: a `notFound()` inside a streamed page is a 200.
- Colors come from the custom properties on `:root`, written in `oklch()`, with a tint
  derived from its base by `color-mix(in oklch, …)`. Two literals are allowed: the
  translucent black and white used for shadows and hairlines, `oklch(0% 0 none / a)` and
  `oklch(100% 0 none / a)`, and a player's own hue, `hsl(var(--h) …)`, as on the marble,
  the pill and the standings bars. The one exception is a share image
  (`components/share/Card.tsx`): Satori reads no `oklch()` or custom properties, so it
  restates the tokens it uses in sRGB.
- Base rules serve phones; `app/styles/desktop.css`'s `min-width: 51.25em` block (820px at the default text size) carries
  every desktop override.
- `isPoints` is the one place that reads a board's kind from its name.
- The player page reads the board table in `playerRecord` and nowhere below it: the
  rendering takes that record and nothing else.
- A player's finish is matched to a board **by name**, never by its position in a list.
- A Steam ID that becomes an href, a fetch path or a query selector passes
  `isSteamId` first: one of them arrives from the URL bar.
- Code that walks a board's rows filters into a new array; `rows` itself stays in rank
  order.
- Board code works at any board size. A Circuit board has thousands of rows, but a
  Workshop Map can have 1 or 2, so anything that assumes a podium, a tenth place or a
  `rows[i]` is checked at 1, 2 and 3 rows.
- User-facing text uses `CONTEXT.md`'s terms, and a word on an _Avoid_ line is a finding
  ("campaign" is the Circuit).

## Collector (`tools/`)

- A change to the write path keeps the fallback-then-abort shape described under
  "Never let a run publish an empty board" in `CLAUDE.md`. A derived file such as
  `podiums.json` keeps its previous copy when its input comes out empty.
- A derived file is built from its inputs as written to disk, after every guarded write of
  those inputs, so a write that fails leaves the two agreeing.
- `python tools/check_data.py` passes on the committed data after any collector change.
- A change to when a board is read (`collect_workshop`'s trigger, `FULL_SWEEP_SECONDS`, the
  `refresh.yml` cron) updates the refresh dialog's copy (`components/Freshness.tsx`), which
  restates those rules for players.

## Discord bot (`discord-bot/`)

- Every hunk follows the Effect rules in the `effect` skill (`~/.claude/skills/effect/SKILL.md`).
  The ones this code has broken before:
  - A Promise or a call that can throw is wrapped with `Effect.tryPromise` / `Effect.try` into a
    tagged error; `Effect.promise` and `Effect.sync` wrap only calls that cannot fail.
  - A function that returns an Effect is `Effect.fn("name")(function* ...)`, and a callback is
    an explicit lambda.
  - A failure is recovered by its tag; a defect stays a defect.
- Run times convert through `SCORE_TICKS_PER_SECOND`, never a bare `100_000`.
- User-facing text (messages, cards, the Activity) uses `CONTEXT.md`'s terms, and a word on
  an _Avoid_ line is a finding.
- A thread post or Card view carries everything its message shows; the Channel draws from the
  post, never from state the post didn't bring.
- Behaviour a Player could see is tested through the engine or the Surface port
  (`test/engine.test.ts`, `test/surface.test.ts`). Where an image places something (which
  name sits by which line) is the exception: the ports carry views, not layout, so it is
  tested on the scene `src/render/scenes.ts` returns (`test/progression.test.ts`).

## Docs

- `CLAUDE.md`, this file and `tools/README-hosting.md` cite symbols (`fetch_board`,
  `isPoints`). A symbol survives the next edit; a line number drifts.

## Git

- Work lands on `claude/<slug>` branches, squash-merged onto `main`.
- Commits carry the repo-local identity `will-ness-ai <n3s.online@gmail.com>`.
