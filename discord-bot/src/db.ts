// The bot's one SQLite database: every table, in migration order. Each module that owns a
// table (the Store, the Steam adapter's board cache, ...) queries its own; this file only
// creates them.
import { NodeContext } from "@effect/platform-node"
import { Migrator, SqlClient } from "@effect/sql"
import { SqliteMigrator } from "@effect/sql-sqlite-node"
import { Effect, Layer } from "effect"

export const MigratorLive = SqliteMigrator.layer({
  loader: Migrator.fromRecord({
    "0001_links_and_matches": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE links (
        discord_id TEXT PRIMARY KEY,
        steam_id TEXT NOT NULL,
        persona_name TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        data TEXT NOT NULL
      )`
      yield* sql`CREATE INDEX matches_state ON matches (state)`
      yield* sql`CREATE TABLE match_ids (n INTEGER PRIMARY KEY AUTOINCREMENT)`
    }),
    // A board's id never changes, and finding one by name costs a Steam round trip.
    "0002_board_ids": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE board_ids (board_name TEXT PRIMARY KEY, board_id INTEGER NOT NULL)`
    }),
    // Where the Footer and each Match's Card and Match Thread are, so a restart can find them.
    "0003_discord_layout": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE discord_layout (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)`
    })
  })
}).pipe(Layer.provide(NodeContext.layer))
