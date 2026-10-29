// The migrate step every database goes through: the deploy's (migrate.mjs), migrate.yml's,
// CI's and each test's (test/pg.ts). Drizzle applies a migration only when its journal `when`
// is newer than the newest one the database applied, so a migration that sorts older and
// isn't applied would be skipped without an error: one merged after another branch's newer
// migration reached production, say. migrateDatabase refuses that before migrating.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies the migrations in `migrationsFolder` to the database behind `pool`, or throws,
 * changing nothing, when one isn't applied but sorts at or before the newest applied one.
 * @param {import("pg").Pool} pool
 * @param {string} migrationsFolder
 */
export async function migrateDatabase(pool, migrationsFolder) {
  await checkOrder(pool, migrationsFolder);
  await migrate(drizzle(pool), { migrationsFolder });
}

/**
 * @param {import("pg").Pool} pool
 * @param {string} folder
 */
async function checkOrder(pool, folder) {
  const exists = await pool.query(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
  );
  if (!exists.rows[0].present) return; // a fresh database: everything applies
  const { rows } = await pool.query("select hash, created_at from drizzle.__drizzle_migrations");
  if (rows.length === 0) return;
  const applied = new Set(rows.map((r) => r.hash));
  /** @type {Array<{ tag: string; when: number }>} */
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")).entries;
  const newestWhen = Math.max(...rows.map((r) => Number(r.created_at)));
  // each .sql hashed once, as Drizzle's readMigrationFiles records it: sha256 of the file's text
  const entries = journal.map((e) => ({
    ...e,
    applied: applied.has(
      createHash("sha256")
        .update(readFileSync(join(folder, `${e.tag}.sql`)).toString())
        .digest("hex"),
    ),
  }));
  // the newest applied entry by name, when this journal still lists it
  const newest = entries.find((e) => e.when === newestWhen && e.applied)?.tag ?? "a migration";
  for (const e of entries) {
    if (e.when > newestWhen || e.applied) continue;
    throw new Error(
      `migrate: ${e.tag} (when ${String(e.when)}) is not applied, but it is not newer than ` +
        `${newest} (when ${String(newestWhen)}), the newest migration this database applied, ` +
        "so Drizzle would skip it without an error. Regenerate it so it sorts last: delete " +
        `${e.tag}.sql, its snapshot and its journal entry, then run \`pnpm db:generate\` in web/ ` +
        "(docs/data.md, The database).",
    );
  }
}
