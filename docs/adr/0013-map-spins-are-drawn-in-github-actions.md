# A Map's spinning GIF is drawn in GitHub Actions

Status: accepted (2026-10-18).

The Daily Post (spec #268) shows the Daily's Map turning once in 3D beside the podium. The
picture is the site's own 3D view of the Map (spec #250, the file from `map_files`, ADR 0010),
so drawing it needs a browser with WebGL: `web/scripts/map-spin.ts` opens the view on
ballestrecords.com in Chromium with software WebGL, drags it one full turn in 160 frames and
encodes a GIF with ffmpeg, a few minutes of work for about 4 MB.

It runs in GitHub Actions, as `.github/workflows/daily-spin.yml`, not in the collector or the
bot. Multiballs starts the workflow for the Map when it posts a Daily
(`GITHUB_DISPATCH_TOKEN`), the workflow stores the GIF in
`map_spins` in the leaderboard database, and the bot reads it from there (ADR 0006) and edits
it into the card. So `map_spins` is the one table written by neither the collector nor the
site's pages: the workflow writes it with the collector's `DATABASE_URL`, and the bot only
reads it. A failed run tells the private ops channel itself, naming the Map; the bot tells ops
too if no GIF has come an hour after it asked, which catches a run that never started.

## Considered Options

- The collector: it writes every other table the bot reads, but it is Python with no browser,
  and a Chromium with WebGL and ffmpeg beside it would be a second runtime for one picture a
  day. A cloud sandbox, where agents run it to check their work, can't run the 3D view either.
- The bot on Fly: its one shared-cpu-1x machine with 1 GB already holds the bot near 335 MB
  plus resvg's memory (`discord-bot/fly.toml`); Chromium drawing 160 WebGL frames in software
  would slow every Match on it for minutes, or run it out of memory.
- Drawing it in the browser of whoever opens the site, or in a Vercel function: a Discord
  card needs the file before anyone opens anything, and a function has no WebGL.
