// tsx scripts/add-prefab.ts: insert one Prefab into the database at DATABASE_URL, for the
// rare case a Prefab must be added without a browser upload (a maintainer's own content, on
// a machine that can reach the database when cloud sessions can't). It runs the same two
// checks the upload API does (lib/prefab-check.ts, lib/prefabs.ts) and the same addPrefab,
// so the row is identical to an uploaded one; only the Steam sign-in and rate limit are
// skipped. Idempotent: a Prefab whose name's slug is already taken is left alone.
//
// Reads from the environment, as .github/workflows/add-prefab.yml passes them:
//   PREFAB_FILE  path to the BallestPrefab JSON, from the repo root
//   PREFAB_NAME  the Prefab's name
//   PREFAB_TAGS  comma-separated tags from TAGS (lib/prefabs.ts)
//   PREFAB_DESC  the description (optional)
//   PREFAB_UPLOADER_NAME  the name shown as the uploader (default: the admin's)
import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";

import { connect } from "../db/client";
import { addPrefab } from "../db/prefabs";
import { checkPrefab } from "../lib/prefab-check";
import { ADMIN_STEAM_ID, checkFields, slugOf } from "../lib/prefabs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const path = process.env.PREFAB_FILE;
if (!path) {
  console.error("PREFAB_FILE is not set");
  process.exit(1);
}
const file = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const tags = (process.env.PREFAB_TAGS ?? "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const fields = checkFields({
  name: process.env.PREFAB_NAME ?? "",
  description: process.env.PREFAB_DESC ?? "",
  tags,
});
const parsed = checkPrefab(file);
if (!fields.ok || !parsed.ok) {
  console.error(
    "Won't add it:",
    [...(fields.ok ? [] : fields.problems), ...(parsed.ok ? [] : parsed.problems)].join(" "),
  );
  process.exit(1);
}

const db = connect(url);
const slug = slugOf(fields.fields.name);
const there = await db.execute(sql`select 1 from prefabs where slug = ${slug}`);
if (there.rows.length) {
  console.log(`${slug}: already there, left alone`);
} else {
  const r = await addPrefab(db, {
    ...fields.fields,
    file,
    uploader: ADMIN_STEAM_ID,
    uploaderName: process.env.PREFAB_UPLOADER_NAME ?? "Will",
  });
  console.log(`added as ${r.slug}`);
}
await db.$client.end();
