// The Store, on SQLite. The running bot uses a file; tests use ":memory:", which runs the
// same queries and migrations, so there is no separate hand-written store to drift.
import { SqlClient, SqlSchema } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Effect, Layer, Option, Schema } from "effect"
import { DURATIONS, type Link, type Match } from "./domain.js"
import { MigratorLive } from "./db.js"
import { Store } from "./ports.js"

// ---------------------------------------------------------------- how a Match is stored

const PlayerSchema = Schema.Struct({ discordId: Schema.String, steamId: Schema.String })

const DrawnMapSchema = Schema.Struct({
  pfid: Schema.String,
  title: Schema.String,
  creator: Schema.String,
  previewUrl: Schema.String,
  boardName: Schema.String,
  medals: Schema.Struct({ bronze: Schema.Number, silver: Schema.Number, gold: Schema.Number, author: Schema.Number }),
  boardId: Schema.Number,
  worldRecordTicks: Schema.Number
})

const MatchSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("public", "challenge", "lobby"),
  minutes: Schema.Literal(...DURATIONS),
  creator: PlayerSchema,
  target: Schema.NullOr(PlayerSchema),
  players: Schema.Array(PlayerSchema),
  state: Schema.Literal("invite", "live", "finished"),
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  endsAt: Schema.NullOr(Schema.Number),
  map: Schema.NullOr(DrawnMapSchema),
  bestTicks: Schema.Record({ key: Schema.String, value: Schema.Number })
})

/** Fails to compile if the stored shape and the domain's Match drift apart, in either direction. */
type MatchRoundTrips = [Schema.Schema.Type<typeof MatchSchema>] extends [Match]
  ? [Match] extends [Schema.Schema.Type<typeof MatchSchema>]
    ? true
    : false
  : false
const matchRoundTrips: MatchRoundTrips = true
void matchRoundTrips

/** A Match is one JSON document per row; only `state` is a column, for the active-Match query. */
const MatchRow = Schema.Struct({ data: Schema.parseJson(MatchSchema) })

const LinkRow = Schema.Struct({ discord_id: Schema.String, steam_id: Schema.String, persona_name: Schema.String })

// ---------------------------------------------------------------- the Store

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findLink = SqlSchema.findOne({
    Request: Schema.String,
    Result: LinkRow,
    execute: (discordId) => sql`SELECT * FROM links WHERE discord_id = ${discordId}`
  })
  const findMatch = SqlSchema.findOne({
    Request: Schema.String,
    Result: MatchRow,
    execute: (id) => sql`SELECT data FROM matches WHERE id = ${id}`
  })
  const findActive = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MatchRow,
    execute: () => sql`SELECT data FROM matches WHERE state != 'finished' ORDER BY id`
  })
  const encodeMatch = Schema.encode(Schema.parseJson(MatchSchema))

  // A database error is a bug or a broken disk, not something a Player can act on: it dies.
  return Store.of({
    getLink: (discordId) =>
      findLink(discordId).pipe(
        Effect.map(Option.map((r): Link => ({ discordId: r.discord_id, steamId: r.steam_id, personaName: r.persona_name }))),
        Effect.orDie
      ),
    putLink: (link) =>
      sql`INSERT INTO links ${sql.insert({ discord_id: link.discordId, steam_id: link.steamId, persona_name: link.personaName })}
          ON CONFLICT (discord_id) DO UPDATE SET steam_id = excluded.steam_id, persona_name = excluded.persona_name`.pipe(
        Effect.asVoid,
        Effect.orDie
      ),
    nextMatchId: sql<{ readonly n: number }>`INSERT INTO match_ids DEFAULT VALUES RETURNING n`.pipe(
      Effect.map((rows) => `m${rows[0]?.n ?? 0}`),
      Effect.orDie
    ),
    getMatch: (id) => findMatch(id).pipe(Effect.map(Option.map((r) => r.data)), Effect.orDie),
    putMatch: (match) =>
      Effect.gen(function* () {
        const data = yield* encodeMatch(match)
        yield* sql`INSERT INTO matches ${sql.insert({ id: match.id, state: match.state, data })}
                   ON CONFLICT (id) DO UPDATE SET state = excluded.state, data = excluded.data`
      }).pipe(Effect.orDie),
    deleteMatch: (id) => sql`DELETE FROM matches WHERE id = ${id}`.pipe(Effect.asVoid, Effect.orDie),
    activeMatches: findActive(undefined).pipe(
      Effect.map((rows) => rows.map((r) => r.data)),
      Effect.orDie
    )
  })
})

/** The Store over whatever SqlClient is provided, migrated first. */
export const SqliteStoreLive = Layer.effect(Store, make).pipe(Layer.provide(MigratorLive))

/** A throwaway in-memory database: tests, and nothing else. */
export const SqliteStoreInMemory = SqliteStoreLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))
