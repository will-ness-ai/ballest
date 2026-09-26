# Coding standards

The review checklist. A review is complete when every hunk has been read against every
rule here and every invariant in `CLAUDE.md`, and each finding names the rule it breaks.
`CLAUDE.md` carries the reasons; this file carries the checks.

## Page (`index.html`)

- Every interpolated value goes through `esc()`, numbers from our own JSON included.
- Colors come from the custom properties on `:root`. The translucent black and white
  used for shadows and hairlines are the one literal allowed.
- Base rules serve phones; the single `min-width:820px` block carries every desktop
  override.
- `isPoints` is the one place that reads a board's kind from its name.
- Code that walks a board's rows filters into a new array; `rows` itself stays in rank
  order.

## Collector (`tools/`)

- A change to the write path keeps the fallback-then-abort shape described under
  "Never let a run publish an empty board" in `CLAUDE.md`. A derived file such as
  `podiums.json` keeps its previous copy when its input comes out empty.
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
