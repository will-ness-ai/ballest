// A throwaway database per test file, created on the Postgres at TEST_DATABASE_URL and
// migrated the way a deploy migrates (scripts/migrations.mjs).
import { fileURLToPath } from "node:url";

import pg from "pg";

import { connect, type Db } from "../db/client";
import { migrateDatabase } from "../scripts/migrations.mjs";

const migrationsFolder = fileURLToPath(new URL("../db/migrations", import.meta.url));

const base =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

// An empty database, for a test that runs the migrate step itself (test/migrate.test.ts).
export async function emptyDb(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const { url, drop } = await createDb();
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  return {
    pool,
    drop: async () => {
      await pool.end();
      await drop();
    },
  };
}

export async function freshDb(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const { url, drop } = await createDb();
  const db = connect(url);
  await migrateDatabase(db.$client, migrationsFolder);
  return {
    db,
    url,
    drop: async () => {
      await db.$client.end();
      await drop();
    },
  };
}

async function createDb(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `test_${String(process.pid)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect().catch((e: unknown) => {
    // otherwise every test fails on its own and reads like a bug in the code under test
    const host = new URL(base).host;
    throw new Error(
      `Can't connect to Postgres at TEST_DATABASE_URL (${host}); is it running? A cloud ` +
        "container stops it on restart: `service postgresql start` (docs/linting.md, Running it).",
      { cause: e },
    );
  });
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`drop database ${name}`);
      await c.end();
    },
  };
}
