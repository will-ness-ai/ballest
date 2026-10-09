// A throwaway database per test file, created on the Postgres at TEST_DATABASE_URL and
// migrated with the same migrations a deploy applies.
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { connect, type Db } from "../db/client";

const base =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export async function freshDb(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const name = `test_${String(process.pid)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect().catch((e: unknown) => {
    // otherwise every test fails on its own and reads like a bug in the code under test
    const host = new URL(base).host;
    throw new Error(`Can't connect to Postgres at TEST_DATABASE_URL (${host}); is it running?`, {
      cause: e,
    });
  });
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  const db = connect(url.toString());
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)),
  });
  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.$client.end();
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`drop database ${name}`);
      await c.end();
    },
  };
}
