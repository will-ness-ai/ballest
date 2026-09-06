# Ballest leaderboards

A static, read-only mirror of the Steam leaderboards for **Ballest of Them All**
(appid `3339810`), live at https://ballest.willness.dev on GitHub Pages
(deploy-from-branch, `main` / root). The game's leaderboards are not exposed through any
public web API, so a collector reads them from Steam directly and commits the results as
JSON that the page fetches.

## Layout

- `index.html` — the entire site. Vanilla JS and CSS in one file: no build step, no
  framework, no JS CDN (Google Fonts is the only external request).
- `data/index.json` — board list, counts, `generated_at`. Loaded first.
- `data/boards/<board>.json` — one file per board, lazy-loaded on selection.
- `tools/campaign_common.py` — the board table and every shared collector helper.
- `tools/steampy_collect.py` — the collector CI runs. **This is the live path.**
- `.github/workflows/refresh.yml` — cron `0 */3 * * *`, commits refreshed data to `main`.
- Everything else under `tools/` is the legacy Steamworks-SDK path or a one-off
  reverse-engineering spike. Read `tools/README-hosting.md` before touching any of it.

## Running it

The page fetches with relative paths, so `file://` will not work. Serve it:

```bash
python -m http.server 8731
```

(or use the `ballest` config in `.claude/launch.json`). Refreshing data locally needs a
Steam refresh token; the mint-and-collect runbook is `tools/README-hosting.md`.

There are no tests, linters, or type checks here — nothing to run before committing.
Verify front-end changes by loading the served page. Verify collector changes by running
it and reading its per-board output lines.

## Invariants worth knowing before you edit

**`score_ms` is two different things.** On `Map_*` boards it is milliseconds and lower is
better. On `Overall*` boards it is points and higher is better — the field name lies
there, and the collector's sibling `time` field is meaningless for those rows. The site
discriminates on the name prefix alone (`index.html:459`); gap arithmetic, column
headers, and row nouns all flip off it. Renaming an Overall board, or adding an aggregate
board not named `Overall*`, silently renders a point total as a duration.

**Adding a board takes two edits, both in `tools/campaign_common.py`**: the tuple in
`BOARDS` (`:64`, which is also the site's ordering) and the numeric ID in
`LEADERBOARD_IDS` (`:37`). steam.py's find-by-name is broken for this app, so the ID
table is mandatory — a board missing from it is skipped without an error.

**Never let a run publish an empty board.** `steampy_collect.py` falls back to the
previously committed file when a read fails, and aborts the run without writing anything
if a board has neither (`tools/steampy_collect.py:105-138`). Preserve that in any change
to the write path. The pagination stop condition (`tools/steampy_collect.py:71`) is
deliberately conservative for the same reason — don't simplify it.

**`.gitignore` ignores `data/*`**, re-including only `!data/index.json` and
`!data/boards/`. A new artifact written under `data/` is invisible to git and 404s in
production.

**Rows are index-aligned to rank.** `rowHtml` reaches for `rows[r.rank - 2]` to compute
the interval to the next rung up, so sorting, filtering, or de-duping the array in place
breaks it.

**`display_name()` emits an em dash** (`Season 2 — Overall`) and `index.html`'s
`SEASON_PREFIX` regex (`:454`) must keep matching it. Change the separator on one side
and the other quietly stops shortening.

**The theme lives in CSS custom properties** on `:root` in `index.html`. It is dark-only
and mobile-first with a single `min-width:820px` breakpoint. Use the variables rather
than literal colors, and put every interpolated value through `esc()`.

## Data and git

`data/` is CI-owned. The refresh workflow commits straight to `main` every three hours,
so don't hand-edit data files and don't carry regenerated data on a feature branch — it
will conflict. Data commits read `data: refresh campaign leaderboards (<UTC>)` and touch
only `data/index.json` and `data/boards/`; keep code changes out of them.

Commits use the repo-local identity `will-ness-ai <n3s.online@gmail.com>`, not the
machine default. Work happens on `claude/<slug>` branches merged by squash — this history
has no merge commits.

## Do not publish the reverse-engineering material

`research/`, `capture/`, and the traffic-capture scripts are gitignored deliberately:
they document the game developers' internal backend hosts and endpoints. Never copy their
contents into a committed file, a commit message, or a PR description. The agreed stance
for this project is read-only, sourced from Steam rather than the developers' servers, at
a modest cadence.
