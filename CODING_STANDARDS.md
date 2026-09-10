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

## Docs

- `CLAUDE.md`, this file and `tools/README-hosting.md` cite symbols (`fetch_board`,
  `isPoints`). A symbol survives the next edit; a line number drifts.

## Git

- Work lands on `claude/<slug>` branches, squash-merged onto `main`.
- Commits carry the repo-local identity `will-ness-ai <n3s.online@gmail.com>`.
