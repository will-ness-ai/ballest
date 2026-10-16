// tsx scripts/prefab-samples.ts: adds the two Prefabs Will shared before uploading existed
// (prefabs/samples/), credited to him, to the database at DATABASE_URL. Run once on
// production, by hand, after the prefabs migration; a sample already there is skipped, so
// running it again changes nothing. Nothing reads prefabs/samples/ at runtime.
import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";

import { connect } from "../db/client";
import { addPrefab } from "../db/prefabs";
import { ADMIN_STEAM_ID, slugOf } from "../lib/prefabs";

const SAMPLES = [
  { file: "bench.json", name: "Bench", tags: ["Decoration"] },
  { file: "testparkhill.json", name: "Park hill", tags: ["Scenery"] },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const db = connect(url);
for (const s of SAMPLES) {
  const slug = slugOf(s.name);
  const there = await db.execute(sql`select 1 from prefabs where slug = ${slug}`);
  if (there.rows.length) {
    console.log(`${slug}: already there`);
    continue;
  }
  const file = readFileSync(new URL(`../../prefabs/samples/${s.file}`, import.meta.url), "utf8");
  await addPrefab(db, {
    name: s.name,
    description: "",
    tags: s.tags,
    uploader: ADMIN_STEAM_ID,
    uploaderName: "Will",
    file,
  });
  console.log(`${slug}: added`);
}
await db.$client.end();
