import { SqliteClient } from "@effect/sql-sqlite-node"
import { expect, it } from "@effect/vitest"
import { Context, Effect, Layer, Option } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Match } from "../src/domain.js"
import { Store } from "../src/ports.js"
import { SqliteStoreLive } from "../src/sqliteStore.js"

// The engine tests already run on SQLite in memory. This covers what memory can't: a
// database file closed and opened again, as across a real restart, with migrations re-run.
it.scoped("keeps Links and Matches across a reopen of the database file", () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), "multiballs-"))
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })))
    const open = Layer.build(SqliteStoreLive.pipe(Layer.provide(SqliteClient.layer({ filename: join(dir, "bot.sqlite") })))).pipe(
      Effect.map((ctx) => Context.get(ctx, Store))
    ) // closes with whichever scope it's opened in
    const live: Match = {
      id: "m1",
      type: "public",
      minutes: 5,
      creator: { discordId: "d-a", steamId: "s-a" },
      target: null,
      players: [
        { discordId: "d-a", steamId: "s-a" },
        { discordId: "d-b", steamId: "s-b" }
      ],
      state: "live",
      createdAt: 0,
      startedAt: 1,
      endsAt: 300_001,
      map: {
        pfid: "1",
        title: "Gutter Run",
        creator: "pebblewright",
        previewUrl: "",
        boardName: "b",
        medals: { bronze: 40, silver: 30, gold: 25, author: 20 },
        boardId: 7,
        worldRecordTicks: 1_500_000
      },
      bestTicks: { "s-a": 2_100_000 }
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* open
        yield* store.putLink({ discordId: "d-a", steamId: "s-a", personaName: "a" })
        expect(yield* store.nextMatchId).toBe("m1")
        yield* store.putMatch(live)
      })
    )

    const reopened = yield* open
    expect(Option.getOrThrow(yield* reopened.getLink("d-a")).steamId).toBe("s-a")
    expect(yield* reopened.activeMatches).toEqual([live])
    expect(yield* reopened.nextMatchId).toBe("m2")
    yield* reopened.putMatch({ ...live, state: "finished" })
    expect(yield* reopened.activeMatches).toEqual([])
    expect(Option.getOrThrow(yield* reopened.getMatch("m1")).state).toBe("finished")
  })
)
