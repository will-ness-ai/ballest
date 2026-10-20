// The deploy's migrate step (scripts/migrate.mjs): Drizzle applies only migrations newer than
// the newest one a database holds, so one that sorts older and isn't applied would be skipped
// without an error. migrateDatabase refuses that instead (docs/data.md, "The database").
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test } from "vitest";

import { migrateDatabase } from "../scripts/migrations.mjs";
import { emptyDb } from "./pg";

const real = fileURLToPath(new URL("../db/migrations", import.meta.url));

interface Entry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
const journal = JSON.parse(readFileSync(join(real, "meta/_journal.json"), "utf8")) as {
  entries: Array<Entry>;
};
const newest = journal.entries.reduce((a, b) => (b.when > a.when ? b : a));

let t: Awaited<ReturnType<typeof emptyDb>>;
let folder: string;

beforeEach(async () => {
  t = await emptyDb();
  folder = mkdtempSync(join(tmpdir(), "migrations-"));
  cpSync(real, folder, { recursive: true });
});

afterEach(async () => {
  rmSync(folder, { recursive: true, force: true });
  await t.drop();
});

// the copy of the migrations folder lists these entries
const withEntries = (entries: Array<Entry>) => {
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
};

// the copy gains 0099_late, which isn't applied, with this `when`
const addLate = (when: number) => {
  writeFileSync(join(folder, "0099_late.sql"), "create table late (id integer);");
  withEntries([
    ...journal.entries,
    { ...newest, idx: journal.entries.length, when, tag: "0099_late" },
  ]);
};

const applied = async () =>
  (await t.pool.query<{ n: string }>("select count(*) as n from drizzle.__drizzle_migrations"))
    .rows[0].n;

test("a fresh database applies every migration, and a second run applies none", async () => {
  await migrateDatabase(t.pool, real);
  expect(Number(await applied())).toBe(journal.entries.length);
  await migrateDatabase(t.pool, real);
  expect(Number(await applied())).toBe(journal.entries.length);
});

test("production's history passes: 0010_chosen_skins applied before the newer 0009_map_spins", async () => {
  // migrate.yml applied chosen_skins to production while its PR was open; map_spins merged
  // next, generated after it, then chosen_skins was renumbered 0010 with its older `when`
  const before = journal.entries.filter((e) => e.idx <= 8 || e.tag === "0010_chosen_skins");
  withEntries(before);
  await migrateDatabase(t.pool, folder);

  await migrateDatabase(t.pool, real);
  expect(Number(await applied())).toBe(journal.entries.length);
  await t.pool.query("select * from map_spins limit 0");
});

test("an unapplied migration older than the newest applied one fails, naming both", async () => {
  await migrateDatabase(t.pool, real);
  addLate(newest.when - 60_000);

  await expect(migrateDatabase(t.pool, folder)).rejects.toThrow(
    new RegExp(`0099_late[\\s\\S]*${newest.tag}[\\s\\S]*pnpm db:generate`),
  );
  await expect(t.pool.query("select * from late")).rejects.toThrow(/does not exist/);
});

test("an unapplied migration with the same `when` as the newest applied one fails too", async () => {
  await migrateDatabase(t.pool, real);
  addLate(newest.when);

  await expect(migrateDatabase(t.pool, folder)).rejects.toThrow(/0099_late/);
});

test("an unapplied migration newer than the newest applied one applies", async () => {
  await migrateDatabase(t.pool, real);
  addLate(newest.when + 60_000);

  await migrateDatabase(t.pool, folder);
  await t.pool.query("select * from late");
});
