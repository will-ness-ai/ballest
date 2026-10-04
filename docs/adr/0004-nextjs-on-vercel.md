# The site moves to Next.js on Vercel, in web/, one view at a time

Status: accepted. ballest.willness.dev moved to Vercel on 2026-10-03; it supersedes 0002.
Its view-at-a-time port was reversed on 2026-10-04: the page was ported in one go (below).

The site moves off GitHub Pages to a Next.js app on Vercel. The reasons are what a
static single file cannot do: real URLs for a player, a board or a Map, with their own
title and link-preview image when shared in Discord; preview deploys for every branch;
and room to split the 2,800-line `index.html` into parts that several changes can be in
flight on at once.

The app lives in `web/`, and Vercel builds that folder alone (its Root Directory). The
site files stay where they are at the repo root: `scripts/sync-site.mjs` copies them into
`web/public/` at build time, so the collector, `data/`, the refresh workflow and
`check_data.py` keep every path they have, for the same reason 0002 kept the site at the
root. Vercel also deploys the refresh's data commits on its own: its Git integration sees
a `GITHUB_TOKEN` push, which a GitHub workflow does not.

The page is ported a view at a time rather than rewritten. Until a view is ported it is
still the vanilla code in `index.html`, served unchanged, so feature work on the page
never waits on the migration as a whole.

**Revised 2026-10-04.** Once the database landed (ADR 0005), every view had to move from
the JSON to the database anyway, so the page was ported in one branch instead: server
components reading the database through one cached read layer, real URLs for every view,
and the old `#/` links redirected. Running two pages side by side for a while would have
meant keeping the JSON and the database reads in step in both. `index.html` is gone; the
site is `web/app/` (`docs/site.md`).

## Considered Options

- Next.js at the repo root: one less folder, but its config, `app/` and `node_modules`
  would sit beside the collector and the bot.
- Moving `data/` into `web/public/`: what Next expects, but it moves every collector and
  workflow path, and every open data branch conflicts.
- A full rewrite in one branch: blocks every change to `index.html` until it lands.
  Rejected at first, then chosen once the database made every view change anyway.
