// Chosen Skins as the bot reads them from the leaderboard database (ADR 0006): a throwaway
// database on the Postgres at TEST_DATABASE_URL, migrated by the site's own migrations, as the
// site's and the collector's tests do.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { ChosenSkins, ChosenSkinsLive } from "../src/chosenSkins.js";

const BASE =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const NAME = `bot_test_${String(process.pid)}_${Math.random().toString(36).slice(2, 8)}`;
const URL_ = (() => {
  const url = new URL(BASE);
  url.pathname = `/${NAME}`;
  return url.toString();
})();

const PINK = "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink";
const GOLD = "/Game/Art/M_GoldReal.M_GoldReal";

const onDb = <A, E>(url: string, effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
      Effect.scoped,
    ) as Effect.Effect<A>,
  );

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

/** ChosenSkinsLive over the given settings, as the bot builds it from its environment. */
const read = (env: ReadonlyArray<readonly [string, string]>) =>
  Effect.flatMap(ChosenSkins, (skins) => skins.all).pipe(
    Effect.provide(
      ChosenSkinsLive.pipe(
        Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map(env)))),
      ),
    ),
  );

describe("Chosen Skins", () => {
  it.effect("with none chosen, every player draws their hue marble", () =>
    Effect.gen(function* () {
      expect(yield* read([["DATABASE_URL", URL_]])).toEqual(new Map());
    }),
  );

  it.effect("are each picking player's Skin, by SteamID", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        onDb(
          URL_,
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql`insert into chosen_skins (steam_id, skin) values ('76561198000000001', ${PINK}), ('76561198000000002', ${GOLD})`,
          ),
        ),
      );
      expect(yield* read([["DATABASE_URL", URL_]])).toEqual(
        new Map([
          ["76561198000000001", PINK],
          ["76561198000000002", GOLD],
        ]),
      );
    }),
  );

  it.effect("are none without a database, so the bot runs on", () =>
    Effect.gen(function* () {
      expect(yield* read([])).toEqual(new Map());
    }),
  );

  it.effect("are none while the database can't be read", () =>
    Effect.gen(function* () {
      const missing = new URL(BASE);
      missing.pathname = "/no_such_database_here";
      expect(yield* read([["DATABASE_URL", missing.toString()]])).toEqual(new Map());
    }),
  );
});
