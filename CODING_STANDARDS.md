# Coding standards

The review checklist. A review is complete when every hunk has been read against every
rule here and every invariant in `CLAUDE.md`, plus `docs/site.md` for a hunk in
`index.html` and `docs/data.md` for one on the write path, and each finding names the rule
it breaks. Those files carry the reasons; this file carries the checks.

## Page (`index.html`)

- Every interpolated value that can carry text from Steam — a persona, a board name, an
  avatar or profile URL — goes through `esc()`, and so does anything that lands inside an
  `href` or another attribute. A number this file formatted itself (`fmtN`, `fmtTime`,
  `ord`, a rank) is already digits and is left alone, as the page does throughout.
- Colors come from the custom properties on `:root`. The translucent black and white
  used for shadows and hairlines are the one literal allowed.
- Base rules serve phones; the single `min-width:820px` block carries every desktop
  override.
- `isPoints` is the one place that reads a board's kind from its name.
- The player page reads the board table in `playerRecord` and nowhere below it: the
  rendering takes that record and nothing else.
- A player's finish is matched to a board **by name**, through the shard's own `boards`
  list. A cached shard can disagree with a newer `index.json` about position.
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
  (`test/engine.test.ts`, `test/surface.test.ts`).

## Docs

- `CLAUDE.md`, this file and `tools/README-hosting.md` cite symbols (`fetch_board`,
  `isPoints`). A symbol survives the next edit; a line number drifts.

## Git

- Work lands on `claude/<slug>` branches, squash-merged onto `main`.
- Commits carry the repo-local identity `will-ness-ai <n3s.online@gmail.com>`.
