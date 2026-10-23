// A past Daily as the leaderboard database holds it (spec #268, for `pnpm daily-post`): its
// final board from `entries`, and its lead rebuilt Refresh by Refresh from the Score history. Against the `tiny`
// dataset in a throwaway database on the Postgres at TEST_DATABASE_URL, migrated and seeded by
// web/'s own scripts (so `pnpm install` in web/ first), with more of its Daily 09-01 written here.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";
import { pastDaily } from "../src/dailyPost/history.js";

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
const db = PgClient.layer({ url: Redacted.make(url.toString()) });
const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(db)));

const at = (iso: string) => Date.parse(iso);
const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const DAY4 = "ballest_v0_9000000004_Daily_20260901_aa000004";

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
  // Daily 09-01 (Fresh Fields) read on after tiny's R2 (03:00), where Points Pat (p8) leads on
  // 5200000: Rolling Rae (p1) takes it on 5100000, seen by the 09:00 Refresh but set at 07:42 by
  // her Ghost, Points Pat ties her by 12:00 (no Ghost read), and Quickmarble (p3) beats them
  // both, seen first by the Refresh at 03:00 the next day, his Ghost's date unset (year 1).
  await run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const refresh = (iso: string) =>
        sql<{ id: number }>`insert into refreshes (started_at, source)
          values (${new Date(iso)}, 'collector') returning id`.pipe(
          Effect.map((rows) => rows[0]!.id),
        );
      const r4 = yield* refresh("2026-09-01T09:00:00Z");
      const r5 = yield* refresh("2026-09-01T12:00:00Z");
      const r6 = yield* refresh("2026-09-02T03:00:00Z");
      for (const r of [r4, r5, r6])
        yield* sql`insert into board_reads (refresh_id, board, ok, entry_count)
          values (${r}, ${DAY4}, true, 3)`;
      const improve = (n: number, score: number, r: number, setAt?: string) =>
        Effect.gen(function* () {
          const ugc = `ghost-${String(n)}-${String(score)}`;
          yield* sql`update entries set closed_refresh = ${r}
            where board = ${DAY4} and steam_id = ${p(n)} and closed_refresh is null`;
          yield* sql`insert into entries (board, steam_id, score, ugc_id, first_seen_refresh, last_seen_refresh)
            values (${DAY4}, ${p(n)}, ${score}, ${ugc}, ${r}, ${r6})`;
          if (setAt !== undefined)
            yield* sql`insert into ghosts (ugc_id, state, set_at, read_at)
              values (${ugc}, 'ok', ${new Date(setAt)}, now())`;
        });
      yield* improve(1, 5_100_000, r4, "2026-09-01T07:42:00Z");
      yield* improve(8, 5_100_000, r5);
      yield* improve(3, 5_000_000, r6, "0001-01-01T00:00:00Z");
    }),
  );
}, 120_000);

afterAll(() => admin(`drop database if exists ${name} with (force)`));

describe("a past Daily from the leaderboard database", () => {
  it("has its window, Map and board as the dailies table names them", async () => {
    const found = Option.getOrThrow(await run(pastDaily("2026-09-01")));
    expect(found.daily).toEqual({
      date: "2026-09-01",
      pfid: "9000000004",
      title: "Fresh Fields",
      startsAt: at("2026-09-01T01:00:00Z"),
      endsAt: at("2026-09-02T01:00:00Z"),
      boardId: 91000004,
    });
  });

  it("has its final board: the player count, and the top 3 fastest first", async () => {
    const found = Option.getOrThrow(await run(pastDaily("2026-09-01")));
    expect(found.board).toEqual({
      players: 3,
      top: [
        { name: "Quickmarble", ticks: 5_000_000 },
        { name: "Rolling Rae", ticks: 5_100_000 },
        { name: "Points Pat", ticks: 5_100_000 },
      ],
    });
    // A tie on the podium goes to whoever was seen first, then the lower Steam ID.
    const tied = Option.getOrThrow(await run(pastDaily("2026-08-30")));
    expect(tied.board).toEqual({
      players: 4,
      top: [
        { name: "Justy Sparks", ticks: 6_000_000 },
        { name: "Quickmarble", ticks: 6_200_000 },
        { name: "Tie Breaker", ticks: 6_200_000 },
      ],
    });
  });

  it("rebuilds every change of lead through the day, timed by the run's Ghost or else the Refresh that saw it", async () => {
    const found = Option.getOrThrow(await run(pastDaily("2026-09-01")));
    expect(found.leads).toEqual([
      {
        at: at("2026-09-01T03:00:00Z"),
        leaders: ["Points Pat"],
        ticks: 5_200_000,
        exact: false,
      },
      {
        at: at("2026-09-01T07:42:00Z"),
        leaders: ["Rolling Rae"],
        ticks: 5_100_000,
        exact: true,
      },
      {
        at: at("2026-09-01T12:00:00Z"),
        leaders: ["Rolling Rae", "Points Pat"],
        ticks: 5_100_000,
        exact: false,
      },
      {
        at: at("2026-09-02T03:00:00Z"),
        leaders: ["Quickmarble"],
        ticks: 5_000_000,
        exact: false,
      },
    ]);
  });

  it("times a run by its Ghost even when the first Refresh to see it was after the close", async () => {
    // Daily 08-29 was first read the day after it closed, but Rolling Rae's Ghost says 09:00.
    const found = Option.getOrThrow(await run(pastDaily("2026-08-29")));
    expect(found.leads).toEqual([
      {
        at: at("2026-08-29T09:00:00Z"),
        leaders: ["Rolling Rae"],
        ticks: 4_100_000,
        exact: true,
      },
    ]);
  });

  it("reads each Refresh's board as it was then, from runs since improved on", async () => {
    // Daily 08-31: Justy Sparks led R1 over Rolling Rae's 3100000, which she beat by R2.
    const found = Option.getOrThrow(await run(pastDaily("2026-08-31")));
    expect(found.leads.map((l) => [l.leaders, l.ticks])).toEqual([
      [["Justy Sparks"], 3_000_000],
      [["Rolling Rae"], 2_900_000],
    ]);
  });

  it("is none for a date with no Daily", async () => {
    expect(Option.isNone(await run(pastDaily("2026-07-01")))).toBe(true);
  });
});
