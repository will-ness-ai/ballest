// What the Daily Report reads from the leaderboard database: against the `tiny` dataset in a
// throwaway database on the Postgres at TEST_DATABASE_URL, migrated and seeded by web/'s own
// scripts (so `pnpm install` in web/ first).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { ReportSource, ReportSourceLive } from "../src/report/source.js";

const base =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const name = `bot_${String(process.pid)}_${Math.random().toString(36).slice(2, 8)}`;
const url = new URL(base);
url.pathname = `/${name}`;
const web = fileURLToPath(new URL("../../web", import.meta.url));

const admin = (statement: string) =>
  Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement)).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(base) })),
    ),
  );

beforeAll(async () => {
  await admin(`create database ${name}`);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString() };
  delete env.DATABASE_URL_UNPOOLED;
  execFileSync("node", ["scripts/migrate.mjs"], { cwd: web, env, stdio: "pipe" });
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts", "tiny"], {
    cwd: web,
    env,
    stdio: "pipe",
  });
}, 120_000);

afterAll(() => admin(`drop database if exists ${name} with (force)`));

const read = (at: number) =>
  Effect.runPromise(
    Effect.flatMap(ReportSource, (source) => source.read(at)).pipe(
      Effect.provide(ReportSourceLive),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map([["DATABASE_URL", url.toString()]])),
      ),
    ),
  );

describe("the Daily Report's source", () => {
  it("reads the Circuit's Tracks and leaves the Trials out", async () => {
    // tiny holds two Season 1 Tracks and both Towers, all kind 'track'
    const data = await read(Date.parse("2026-09-02T00:00:00Z"));
    const labels = data.tracks.map((t) => t.label);
    expect(labels.length).toBe(2);
    expect(labels.every((l) => l.startsWith("S1 "))).toBe(true);
    expect(data.tracks.map((t) => t.board)).not.toContain("Map_TheTower");
    expect(data.tracks.map((t) => t.board)).not.toContain("Map_TheTowerCP");
  });
});
