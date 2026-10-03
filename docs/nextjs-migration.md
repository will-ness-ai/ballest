# Moving the site to Next.js on Vercel

The plan behind ADR 0004. Each phase ships on its own and leaves the site working.

## Phase 0: a Next.js shell that serves today's site (done in this branch)

`web/` is a Next.js app with no pages of its own. `pnpm build` copies the root site files
into `web/public/` (`scripts/sync-site.mjs`, the same list as `deploy.yml`'s `cp` line)
and serves them unchanged: `/` is `index.html` byte for byte, `data/` is served as is,
`/leth` redirects to `/leth/` as Pages does, and `/multiballs/terms` answers as well as
`terms.html`. GitHub Pages is still production; nothing about it changes.

Run it locally:

```bash
cd web
pnpm install
pnpm dev          # or: pnpm build && pnpm start
```

## Phase 1: link Vercel and move the domain (needs Will)

1. In Vercel, import `will-ness-ai/ballest` and set the project's Root Directory to
   `web`. Keep "Include files outside the Root Directory" on (the default): the build
   copies them. Everything else comes from `web/vercel.json`.
2. Compare the preview deploy with https://ballest.willness.dev.
3. Add `ballest.willness.dev` to the project and point its DNS record at Vercel.
4. Then one PR retires Pages: delete `deploy.yml`, the `deploy` job in `refresh.yml` and
   `CNAME`, switch Pages off, and mark ADR 0002 superseded. Vercel deploys each refresh
   commit itself, and `vercel.json`'s `ignoreCommand` skips commits that touch only the
   collector or the bot.

Rollback is pointing the DNS record back at Pages, which keeps deploying until step 4.

Limits worth checking first: Vercel's Hobby plan is for non-commercial use, and allows
100 deploys a day (the refresh makes about eight) and 100 GB of transfer a month, the
same soft cap Pages has. Plausible shows whether traffic is anywhere near it.

## Phase 2: real URLs with link previews

`/player/<steam_id>`, `/board/<board>`, `/map/<pfid>` and `/vs/<a>/<b>` become Next
routes that serve the same page with that page's own title, description and preview
image (`next/og`), read from `data/` at request time and cached until the next deploy.
`route()` in `index.html` learns to read the path as well as the hash, and `go()` writes
paths, so every old `#/` link keeps working. This is the first change players see: a
player or Map shared in Discord previews as itself rather than the site's one `og.png`.

## Phase 3: port the page a view at a time

Each view becomes React in its own PR, in this order: head to head, the player page, a
board, the Workshop homepage, All maps. A PR takes that view's code out of `index.html`.
While a view is being ported, other changes to it wait or land in the port, so the order
can follow whatever the page's other work is not touching.

The page's invariants move into one shared module first, with tests, since the page has
none today: `isPoints`, `SCORE_TICKS_PER_SECOND`, rank-aligned `rows`, `isSteamId`.
`esc()` goes away with the markup strings, because React escapes text and attributes.
`tools/page-check` is retired with the last view.

## Phase 4, optional: data out of git

The collector would upload to Vercel Blob instead of committing, and the app would read
it at request time, so a refresh stops being a commit and a deploy. It changes "Data and
git" in `AGENTS.md` and the collector's write path, so it is its own decision once the
site is on Vercel.
