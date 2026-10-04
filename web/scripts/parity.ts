// pnpm db:parity: compares what the read layer (db/site.ts) reads from the database at
// DATABASE_URL with the JSON the collector committed under data/, board by board and figure
// by figure, and exits 1 on any difference. Run it against a database backfilled from the
// same commit (tools/db_backfill.py), never production from a laptop. It goes when the
// JSON does (docs/nextjs-migration.md, phase 5).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { connect } from "../db/client";
import * as site from "../db/site";
import { CIRCUIT } from "../lib/circuit";
import { podiumTallies } from "../lib/podiums";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return
   -- the committed JSON is read untyped, as it is only compared */
const DATA = join(import.meta.dirname, "..", "..", "data");
const json = (path: string): any => JSON.parse(readFileSync(join(DATA, path), "utf8"));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = connect(url);

let differences = 0;
function compare(label: string, want: Array<unknown>, got: Array<unknown>) {
  const shown: Array<string> = [];
  const n = Math.max(want.length, got.length);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(want[i]);
    const b = JSON.stringify(got[i]);
    if (a !== b && bad++ < 3) shown.push(`  #${String(i)} json ${a}\n      db   ${b}`);
  }
  if (!bad) return;
  differences++;
  console.log(`${label}: ${String(bad)} of ${String(n)} differ\n${shown.join("\n")}`);
}

const counts = await site.circuitCounts(db);
for (const b of CIRCUIT) {
  const file = json(`boards/${b.name}.json`);
  const page = await site.boardPage(db, b.name, { count: 1_000_000 });
  compare(`${b.name} count`, [file.rows.length], [counts[b.name]]);
  compare(
    b.name,
    file.rows.map((r: any) => [r.rank, r.steam_id, r.score_ms, r.seasons ?? null]),
    page.rows.map((r) => [r.rank, r.steamId, r.score, r.seasons]),
  );
}

compare(
  "podiums",
  json("podiums.json").seasons.map((t: any) => [
    t.group,
    t.tracks,
    t.players.map((p: any) => [
      p.steam_id,
      p.gold,
      p.silver,
      p.bronze,
      p.rank,
      p.finishes.map((f: any) => [f.track, f.rank, f.score_ms]),
    ]),
  ]),
  podiumTallies(await site.trackPodiums(db)).map((t) => [
    t.group,
    t.tracks,
    t.players.map((p) => [
      p.steamId,
      p.gold,
      p.silver,
      p.bronze,
      p.rank,
      p.finishes.map((f) => [f.track, f.rank, f.score]),
    ]),
  ]),
);

const standings = json("standings.json");
const st = await site.standings(db);
compare("standings", [standings.tracks, standings.maps], [st.tracks, st.maps]);
compare(
  "standings rows",
  standings.players.map((p: any) => [p[0], ...p.slice(2)]),
  st.players.map((p) => [p[0], ...p.slice(2)]),
);

const maps = await site.workshopMaps(db);
const byPfid = new Map(maps.map((m) => [m.pfid, m]));
const listed = json("workshop.json").maps;
compare("Maps listed", [listed.length], [maps.length]);
compare(
  "Maps",
  listed.map((m: any) => [
    m.pfid,
    m.display,
    m.creator,
    m.cid,
    m.preview,
    m.created,
    m.medals,
    m.entry_count,
    m.sessions,
    m.subs,
    m.top3 ?? [],
    m.gap13 ?? null,
    m.crowd ?? 0,
    m.author_beaten ?? 0,
  ]),
  listed.map((m: any) => {
    const g = byPfid.get(m.pfid);
    return g
      ? [
          g.pfid,
          g.title,
          g.creator,
          g.cid,
          g.preview,
          g.created,
          g.medals,
          g.entryCount,
          g.sessions,
          g.subs,
          g.top3,
          g.gap13,
          g.crowd,
          g.authorBeaten,
        ]
      : null;
  }),
);

for (const f of readdirSync(join(DATA, "workshop"))) {
  const file = json(`workshop/${f}`);
  const page = await site.boardPage(db, file.name, { count: 1_000_000 });
  compare(
    file.name,
    file.rows.map((r: any) => [r.rank, r.steam_id, r.score_ms]),
    page.rows.map((r) => [r.rank, r.steamId, r.score]),
  );
}

await db.$client.end();
console.log(differences ? `${String(differences)} differences` : "the database matches data/");
process.exit(differences ? 1 : 0);
