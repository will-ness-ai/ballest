// Each player's Chosen Skin (GLOSSARY.md, spec #276), read from the leaderboard database at
// DATABASE_URL (ADR 0006) as the Daily Report's reads are (report/source.ts): plain SQL over the
// chosen_skins table web/ owns and writes. The images and the Match Thread's emojis draw a
// player's Chosen Skin in place of their hue marble; the bot reads no Ghosts.
//
// Never a reason to fail a draw: with no DATABASE_URL (`pnpm dev`, the sandbox), or a database
// that can't be read, every player keeps their hue marble, and a failed read says so in the log.
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { ChosenSkins, type ChosenSkinPicks } from "./ports.js";

/** A pick on the site reaches Discord within this long; a Card redraws far more often. */
const FRESH_FOR = "1 minute";

const Row = Schema.Struct({ steamId: Schema.String, skin: Schema.String });

const readAll = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`select steam_id as "steamId", skin from chosen_skins`.pipe(
    Effect.flatMap(Schema.decodeUnknown(Schema.Array(Row))),
  );
  const all: ChosenSkinPicks = new Map(rows.map((r) => [r.steamId, r.skin]));
  return all;
});

const NONE: ChosenSkinPicks = new Map();

/** A read that failed: said in the log, and every player keeps their hue marble until the next. */
const unreadable = Effect.fn("unreadable")(function* (reason: string) {
  yield* Effect.logWarning(`chosen skins unreadable, marbles only: ${reason}`);
  return NONE;
});

/** No Chosen Skins: every player draws their hue marble. For tests and scripts without a database. */
export const NoChosenSkins = Layer.succeed(
  ChosenSkins,
  ChosenSkins.of({ all: Effect.succeed(NONE) }),
);

/**
 * The database at DATABASE_URL, read at most once a minute. Each read opens its own connection
 * and closes it, like the Daily Report's, so the bot holds none open between draws.
 */
export const ChosenSkinsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const url = yield* Config.option(Config.redacted("DATABASE_URL"));
    if (Option.isNone(url)) {
      yield* Effect.logInfo("chosen skins: off (DATABASE_URL not set); marbles only");
      return NoChosenSkins;
    }
    const all = yield* Effect.cachedWithTTL(
      readAll.pipe(
        Effect.provide(PgClient.layer({ url: url.value })),
        Effect.scoped,
        Effect.catchTags({
          SqlError: (e) => unreadable(e.message),
          ParseError: (e) => unreadable(e.message),
        }),
      ),
      FRESH_FOR,
    );
    return Layer.succeed(ChosenSkins, ChosenSkins.of({ all }));
  }),
);
