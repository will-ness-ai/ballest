// The Stats Links as the bot reads and writes them in the leaderboard database (ADR 0014): a
// throwaway database on the Postgres at TEST_DATABASE_URL, migrated by the site's own
// migrations, as chosenSkins.test.ts does.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { StatsLinks, StatsLinksLive } from "../src/seeMyStats.js";

const BASE =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const NAME = `bot_test_${String(process.pid)}_${Math.random().toString(36).slice(2, 8)}`;
const URL_ = (() => {
  const url = new URL(BASE);
  url.pathname = `/${NAME}`;
  return url.toString();
})();

const onDb = <A, E>(url: string, effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
      Effect.scoped,
    ) as Effect.Effect<A>,
  );

/** Plain SQL on the test database, as the site would write it. */
const run = <A>(query: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) =>
  Effect.promise(() => onDb(URL_, Effect.flatMap(SqlClient.SqlClient, query)));

beforeAll(async () => {
  await onDb(
    BASE,
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(`create database ${NAME}`)),
  );
  const env = { ...process.env };
  delete env.DATABASE_URL_UNPOOLED;
  const migrate = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../web/scripts/migrate.mjs", import.meta.url))],
    { env: { ...env, DATABASE_URL: URL_ }, encoding: "utf8" },
  );
  if (migrate.status !== 0 || !migrate.stdout.includes("up to date"))
    throw new Error(`migrate failed: ${migrate.stdout}${migrate.stderr}`);
}, 60_000);

afterAll(async () => {
  await onDb(
    BASE,
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.unsafe(`drop database if exists ${NAME} with (force)`),
    ),
  );
});

/** StatsLinksLive over the given settings, as the bot builds it from its environment, kept for
 * the rest of the test. */
const links = (env: ReadonlyArray<readonly [string, string]> = [["DATABASE_URL", URL_]]) =>
  Layer.build(
    StatsLinksLive.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map(env)))),
    ),
  ).pipe(Effect.map(Context.get(StatsLinks)));

const STEAM = "76561198000000001";

describe("Stats Links in the database", () => {
  it.scoped("a Discord account is paired with the Steam ID the site wrote, if any", () =>
    Effect.gen(function* () {
      const l = yield* links();
      expect(yield* l.pairedWith("d-pair")).toEqual(Option.none());
      yield* run(
        (sql) => sql`insert into stats_links (discord_id, steam_id) values ('d-pair', ${STEAM})`,
      );
      expect(yield* l.pairedWith("d-pair")).toEqual(Option.some(STEAM));
    }),
  );

  it.scoped("a request is one new row, by a 128-bit token, with the member's name", () =>
    Effect.gen(function* () {
      const l = yield* links();
      const token = yield* l.request("d-ask", "alice");
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      const rows = yield* run(
        (sql) =>
          sql`select token, discord_name as name, used_at as used from stats_link_requests where discord_id = 'd-ask'`,
      );
      expect(rows).toEqual([{ token, name: "alice", used: null }]);
      expect(yield* l.request("d-ask", "alice")).not.toBe(token);
    }),
  );

  it.scoped("writing a request prunes those past a day", () =>
    Effect.gen(function* () {
      const l = yield* links();
      yield* run(
        (sql) => sql`insert into stats_link_requests (token, discord_id, discord_name, created_at)
          values ('old', 'd-old', 'old', now() - interval '25 hours'),
                 ('recent', 'd-old', 'old', now() - interval '23 hours')`,
      );
      yield* l.request("d-new", "new");
      const left = yield* run(
        (sql) => sql`select token from stats_link_requests where discord_id = 'd-old'`,
      );
      expect(left).toEqual([{ token: "recent" }]);
    }),
  );

  it.scoped("a request reads as used once the link page's confirm has used it", () =>
    Effect.gen(function* () {
      const l = yield* links();
      const token = yield* l.request("d-use", "bob");
      expect(yield* l.used(token)).toBe(false);
      yield* run(
        (sql) => sql`update stats_link_requests set used_at = now() where token = ${token}`,
      );
      expect(yield* l.used(token)).toBe(true);
      expect(yield* l.used("no-such-token")).toBe(false);
    }),
  );

  it.scoped("share one pool across calls, rather than connecting for each", () =>
    Effect.gen(function* () {
      const l = yield* links();
      yield* l.pairedWith("d-pool");
      yield* l.used("no-such-token");
      yield* l.request("d-pool", "pool");
      const open = yield* run(
        (sql) => sql`select count(*)::int as n from pg_stat_activity
          where datname = ${NAME} and application_name = 'multiballs'`,
      );
      expect(open).toEqual([{ n: 1 }]);
    }),
  );

  it.scoped("are unavailable without a database, or one that can't be read", () =>
    Effect.gen(function* () {
      const none = yield* links([]);
      expect((yield* Effect.flip(none.pairedWith("d-x")))._tag).toBe("StatsUnavailable");
      const missing = new URL(BASE);
      missing.pathname = "/no_such_database_here";
      const broken = yield* links([["DATABASE_URL", missing.toString()]]);
      expect((yield* Effect.flip(broken.request("d-x", "x")))._tag).toBe("StatsUnavailable");
    }),
  );
});
