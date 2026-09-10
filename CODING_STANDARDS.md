# Coding standards

Rules a reviewer checks a diff against. The reasons behind the data rules live in
`CLAUDE.md` under "Invariants"; this file is the checklist.

## Page (`index.html`)

- Every interpolated value goes through `esc()`. Numbers from our own JSON included.
- Colors come from the custom properties on `:root`, never literals, except the
  translucent black and white used for shadows and hairlines.
- Mobile-first: base rules serve phones, the single `min-width:820px` block overrides.
- Score conversions go through `SCORE_TICKS_PER_SECOND`. A bare `1000` or `100000`
  next to `score_ms` is the bug that shipped once already.
- Point and time behaviour branches only on `isPoints`; nothing else infers a
  board's kind from its name.
- Anything that walks a board's rows keeps them index-aligned to rank: filter into a
  new array, never sort or splice `rows` in place.

## Collector (`tools/`)

- A change to the write path keeps the fallback-then-abort shape: a board that fails
  to read reuses its committed file, and a board with neither stops the run before
  anything is written. Derived files such as `podiums.json` keep their previous copy
  when their input comes out empty.
- Score conversions go through `SCORE_TICKS_PER_SECOND` here too (`fmt_time`).
- A board is added in `BOARDS` and `LEADERBOARD_IDS` together, appended in the
  game's own order.
- `python tools/check_data.py` passes on the committed data after any collector change.

## Docs

- `CLAUDE.md`, `CODING_STANDARDS.md` and `tools/README-hosting.md` cite symbols
  (`fetch_board`, `isPoints`), never line numbers. Line numbers drift on the next edit.
- Nothing from `research/` or `capture/` appears in a committed file, commit message,
  or pull request.

## Git

- Work lands on `claude/<slug>` branches, squash-merged; no merge commits on `main`.
- Commits use the repo-local identity `will-ness-ai <n3s.online@gmail.com>`.
- Code changes stay out of `data:` commits. A feature branch carries no regenerated
  data; a brand-new data artifact may ship its first copy with the code that
  introduces it.
