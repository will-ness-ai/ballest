# Ballest Records

Community tools for [Ballest of Them All](https://store.steampowered.com/app/3339810/), run by
players. This is not an official project of the game's developers.

The main one is **[ballestrecords.com](https://ballestrecords.com)**, a read-only mirror of the
game's Steam leaderboards. The game doesn't publish its boards anywhere on the web, so a collector
reads them from Steam: every board every three hours, the live Daily every minute, and a new Map
as soon as it's posted in the game's Discord. The site has six sections:

- **Maps**: every player-made Workshop Map, with its board, a 3D view and what's trending this
  week.
- **Campaigns**: curated sets of player-made Maps, ranked together the way the game ranks a Circuit
  season.
- **Daily**: each day's Daily, live while it's open, and every past one.
- **Circuit**: every official Track's board, with world records, podiums and Medal times.
- **Players**: anyone's times, podiums and head-to-head comparisons. Sign in with Steam to see where
  you stand and pick your ball skin.
- **Prefabs**: editor Prefabs shared by players, with a 3D viewer, plus generators to make your own
  signs, trees and more.

## What's in this repo

| Folder                                     | What it is                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`web/`](web/)                             | The site: a Next.js app on Vercel, reading a Postgres database.                            |
| [`tools/`](tools/)                         | The collector (Python, on Fly.io) that reads Steam and writes the database.                |
| [`discord-bot/`](discord-bot/)             | Multiballs, the community Discord bot: Matches, the Daily Report, the Weekly Cup and more. |
| [`multiballs/`](multiballs/)               | Multiballs's Terms of Service and Privacy Policy, published at `/multiballs/`.             |
| [`circuit/`](circuit/), [`skins/`](skins/) | Each Circuit Track's screenshot and each ball skin's picture, which the site draws.        |
| [`prefabs/`](prefabs/)                     | The first two sample Prefabs, added to a database once.                                    |
| [`leth/`](leth/)                           | A 3D ghost-route viewer for the Leth Trial #1 event board.                                 |
| [`docs/`](docs/)                           | How the site and the database work, and the decisions behind them in `docs/adr/`.          |

[`GLOSSARY.md`](GLOSSARY.md) defines the words the code uses (Map, Track, Match, ...).

## Running it locally

You need Node 22, pnpm and a Postgres server on `localhost:5432` with the user and password
`postgres`. This makes a small sample database and starts the site:

```bash
cd web
pnpm install
psql postgres://postgres:postgres@localhost:5432/postgres -c 'create database ballest_dev'
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev
pnpm db:migrate
pnpm db:seed tiny
pnpm dev
```

`pnpm dev` reads `DATABASE_URL` from `web/.env.local` too, so put that line there to skip the
`export` next time.

[`AGENTS.md`](AGENTS.md) is the full guide for contributors: the layout, the checks to run
(`pnpm check` before pushing), and the rules the data depends on. Read it before changing the
collector or the database.

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/will-ness-ai/ballest/issues). If
you'd like your Campaign on the site, open an issue with links to its Maps on the Workshop.
