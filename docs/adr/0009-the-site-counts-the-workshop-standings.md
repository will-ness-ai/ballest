# The site counts the Workshop standings, and the bot reads them from it

Status: accepted (2026-10-16). Amends ADR 0006.

The Workshop standings (`CONTEXT.md`) were counted only by Multiballs, inside the Daily
Report (`discord-bot/src/report/report.ts`). The /you page (spec #221) shows the same four
lists to every player, with places that the Daily Report's image must agree with, so the
two can no longer count them apart. The site owns the counting now:
`web/lib/workshop-standings.ts` holds the rules, moved unchanged from the report (the
creator margin, a board first read after the baseline counting as it stands, Maps gone from
the Workshop on neither side), plus shared places. `workshopStandings` in `web/db/site.ts`
reads the rows, `getWorkshopStandings` in `web/db/data.ts` caches them per baseline under the
data tag, and `GET /api/standings` serves them. The bot will draw the report's image from that
route (ticket #225) instead of counting.

ADR 0006 turned down a site API because no page needed every Map's Entries at once; /you now
does, and a second copy of the rules in the bot would drift. The rest of 0006 stands: the bot
still reads the database directly, with plain SQL, for the report's other sections (unfinished
Maps, unclaimed Medals, Since yesterday, longest-standing records).

## Considered Options

- Keep counting in the bot and copy the rules into the site: two copies of the same rules,
  and the page and the image disagree as soon as one changes.
- The bot imports the site's module: its image is built from `discord-bot/` alone (0006), so
  it would need the site's code copied in at build time. A route keeps one deploy's counting
  as the only one.
- Count in SQL: the first-read rule and the creator margin are clearer, and tested with plain
  rows, in TypeScript; the read is one query per Refresh and baseline, then cached.
