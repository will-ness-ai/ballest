# Moving the site to Next.js on Vercel

The plan behind ADR 0004 and ADR 0005. Each phase ships on its own and leaves the site working.

## Phase 0: a Next.js shell that serves today's site (done, #85)

`web/` is a Next.js app with no pages of its own. `pnpm build` copies the root site files
into `web/public/` (`scripts/sync-site.mjs`, the same list as `deploy.yml`'s `cp` line)
and serves them unchanged: `/` is `index.html` byte for byte, `data/` is served as is,
`/leth` redirects to `/leth/` as Pages does, and `/multiballs/terms` answers as well as
`terms.html`.

Run it locally:

```bash
cd web
pnpm install
pnpm dev          # or: pnpm build && pnpm start
```

## Phase 1: link Vercel and move the domain (done 2026-10-03)

The Vercel project is `ballest` (Root Directory `web`, files outside it included,
Node 22.x), connected to this repo with `main` as production. `ballest.willness.dev` is a
CNAME at Porkbun to the target Vercel gave the project; ballest.vercel.app serves the same
deploy. Vercel deploys each refresh commit itself, and `vercel.json`'s `ignoreCommand`
skips commits that touch only the collector or the bot. `deploy.yml`, the `deploy` job in
`refresh.yml` and `CNAME` are gone, and ADR 0002 is superseded.

Rollback would be pointing the DNS record back at `will-ness-ai.github.io` and restoring
`deploy.yml` from history.

Limits: Vercel's Hobby plan is for non-commercial use, and allows 100 deploys a day (the
refresh makes about eight) and 100 GB of transfer a month, the same soft cap Pages had.

## Phase 2: real URLs with link previews (URLs and titles done in phase 4)

`/player/<steam_id>`, `/board/<board>`, `/map/<pfid>` and `/vs/<a>/<b>` become Next
routes that serve the same page with that page's own title, description and preview
image (`next/og`), read from `data/` at request time and cached until the next deploy.
`route()` in `index.html` learns to read the path as well as the hash, and `go()` writes
paths, so every old `#/` link keeps working. This is the first change players see: a
player or Map shared in Discord previews as itself rather than the site's one `og.png`.

## Phase 3: a database with score history (ADR 0005; done, #115)

The collector writes every Refresh into Postgres on Neon as well as the JSON, the git
history of `data/` is backfilled into it, and the app gets a typed, tag-cached read layer
that the collector revalidates. Preview deploys each get a database branch of production,
which `db:seed` can replace with a named dataset. The page still reads the JSON.

## Phase 4: port the page to React in one go (done, #125)

Every view became server components reading the database, in one branch rather than a
view at a time. The page's invariants (`isPoints`, `SCORE_TICKS_PER_SECOND`, `isSteamId`)
moved into `web/lib/rules.ts` with tests, the derived boards (Season 1 Current, All
Seasons, podiums, standings) are computed from the database, and phase 2's real URLs
landed here: every view has a path and its own title, and an old `#/` link redirects to
it. `index.html` is gone. A refresh commit no longer deploys (`vercel.json`'s
`ignoreCommand` skips `data/`): the collector revalidates the site's cached reads instead,
so the published `data/` files are as of the last deploy. How the app is built:
`docs/site.md`.

## Phase 5: stop the JSON

Once nothing reads `data/`, the collector stops writing it, the refresh stops committing,
and the JSON-only code goes: `derive()`'s file assembly, `check_data.py`'s file checks,
`sync-site.mjs`'s `data/` entry, and "Data and git" in `AGENTS.md`.
