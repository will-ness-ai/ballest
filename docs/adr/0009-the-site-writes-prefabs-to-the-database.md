# The site writes Prefabs to the database

Status: accepted (2026-10-16).

Until Prefabs, the site only read the database: the collector writes every row (ADR 0005)
and the bot reads them (ADR 0006). Players asked for a place to share Prefabs (CONTEXT.md),
and Will chose uploads by anyone signed in with Steam (ADR 0008), live at once, stored in
the same Postgres (2026-10-16, spec #213).

So the site writes to the database for the first time, and only Prefabs: three tables of
their own (`prefabs`, `prefab_favorites`, `prefab_bans`) that no collector table points at
and the collector never touches. Each write is a route under `app/api/prefabs` that checks
the session cookie on every request and refuses a request another site sent, then writes in
one statement or one transaction. Pages stay cached (ADR 0004): a write expires the cached
Prefab reads by their tag, and the browser asks who is signed in, as it already did.

The file is stored as the text the player uploaded, at most 4 MB, after the same checks the
game's spawn command applies. A Prefab is never deleted outright: deleting or taking one
down stamps its row, so it still counts against the uploader's limit (5 in any rolling hour, or
a per-player limit the admin sets in `prefab_limits`; 5 a day before PR #233), and a ban
hides an uploader's Prefabs at read time, so an unban brings them back. The admin is one
Steam ID in code (Will's), not a role table.

ADR 0008 kept no profile read. An uploader need not be on any board, so the upload reads
their public Steam persona once, from their community profile, and stores it beside the
Prefab for its byline. A player the boards know is still named from the boards.

## Considered Options

- Files in the repo with a manifest, added by Will on request: the first plan, with no
  writes at all. Uploads by players made it a bottleneck on Will.
- Vercel Blob for the files and Postgres for the rest: cheaper per byte for big files, but
  two stores to keep consistent for files that are a few hundred KB at most.
- A separate database for the site's own writes: isolation the three self-contained tables
  already give, at the cost of a second connection and a second backup story.
