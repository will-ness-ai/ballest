# Leaderboards move into Postgres on Neon, stored as change-only score history

Status: accepted (2026-10-03). Replaces Phase 4 of `docs/nextjs-migration.md`.

The committed JSON in `data/` holds only the latest state of every board, so the site
can't answer anything about the past: when a world record fell, how a player's personal
best came down, what a board looked like last week. The collector will write every
Refresh into Postgres on Neon, provisioned through the Vercel Marketplace, and the Next.js
app will read it from server components. Neon gives each Vercel preview deploy its own
database branch, so a preview can be seeded with whatever dataset it needs.

What gets stored is only what Steam says, as **score history**: one row per board, player
and score, with when it was first and last seen, written only when a score changes and
closed off, never deleted, when a player drops off a board. Ranks are not stored (they
come from the scores at any moment, and storing them would rewrite thousands of rows
whenever someone near the top moves), and neither are the derived boards, podiums or
standings, which the app computes and caches. Overall boards are the one exception to
keeping every score: their points move for most players on every Refresh as others pass
them, which in the backfill was 85% of all rows and about 70,000 more a day, past Neon's
free tier within weeks. So an Overall board holds current points only, one Entry per
player updated in place, and its history is rebuilt from the tracks' (close to Steam's
own totals, not exact). Every collector Refresh is logged with the
boards it read, because Workshop Maps are not read on every Refresh and a gap in reading
must not look like a gap in play. The git history of `data/` is replayed into the database
once, so history starts at 2026-09-05 rather than on the day this ships.

The schema is owned by Drizzle in `web/`, for type safety, and migrated in the Vercel
build so every preview branch is current. The Python collector writes it with plain SQL in
one transaction per Refresh, keeping the "never publish an empty board" guards as checks
inside that transaction. During the port the collector writes both the JSON and the
database; the JSON, and the commit-and-deploy on every Refresh, stop once nothing reads
them. Pages are cached by tag and revalidated by the collector when a Refresh lands.

## Considered Options

- Supabase, Turso, or Postgres on Fly beside the bot: none gives a database branch per
  Vercel preview as directly. The bot keeps its own SQLite (ADR 0003).
- Snapshots of every board each Refresh: simple, but about 175,000 rows a Refresh for a
  few hundred changes.
- The collector keeps writing JSON and a loader ingests it: one more moving part, and the
  database would trail the files.
