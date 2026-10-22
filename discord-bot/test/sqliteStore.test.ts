import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsBefore, migratorFor } from "../src/db.js";
import type { Match } from "../src/domain.js";
import { Store } from "../src/ports.js";
import { SqliteStoreLive } from "../src/sqliteStore.js";

/** A throwaway directory for one test's database file, removed when the test ends. */
const tempFile = Effect.gen(function* () {
  const dir = mkdtempSync(join(tmpdir(), "multiballs-"));
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );
  return join(dir, "bot.sqlite");
});

/** The Store on a database file; it closes with whichever scope it's opened in. */
const openStore = (file: string) =>
  Layer.build(SqliteStoreLive.pipe(Layer.provide(SqliteClient.layer({ filename: file })))).pipe(
    Effect.map((ctx) => Context.get(ctx, Store)),
  );

/** A database file migrated only as far as a build from before Venues, holding what it wrote. */
const beforeVenues = (file: string, write: Effect.Effect<unknown, unknown, SqlClient.SqlClient>) =>
  Effect.scoped(
    write.pipe(
      Effect.provide(
        migratorFor(migrationsBefore("0008")).pipe(
          Layer.provideMerge(SqliteClient.layer({ filename: file })),
        ),
      ),
    ),
  ).pipe(Effect.orDie);

// The engine tests already run on SQLite in memory. This covers what memory can't: a
// database file closed and opened again, as across a real restart, with migrations re-run.
it.scoped("keeps Links and Matches across a reopen of the database file", () =>
  Effect.gen(function* () {
    const file = yield* tempFile;
    const live: Match = {
      id: "m1",
      venue: "ballest-racing",
      type: "public",
      minutes: 5,
      creator: { discordId: "d-a", steamId: "s-a" },
      target: null,
      players: [
        { discordId: "d-a", steamId: "s-a" },
        { discordId: "d-b", steamId: "s-b" },
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
        worldRecordTicks: 1_500_000,
        personalBests: { "s-b": 2_400_000 },
      },
      bestTicks: { "s-a": 2_100_000 },
      history: [{ steamId: "s-a", ticks: 2_100_000, at: 42_000 }],
      left: ["s-b"],
      waitingForSteam: false,
    };

    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openStore(file);
        yield* store.putLink({ discordId: "d-a", steamId: "s-a", personaName: "a" });
        expect(yield* store.nextMatchId).toBe("m1");
        yield* store.putMatch(live);
      }),
    );

    const reopened = yield* openStore(file);
    expect(Option.getOrThrow(yield* reopened.getLink("d-a")).steamId).toBe("s-a");
    expect(yield* reopened.activeMatches).toEqual([live]);
    expect(yield* reopened.nextMatchId).toBe("m2");
    yield* reopened.putMatch({ ...live, state: "finished" });
    expect(yield* reopened.activeMatches).toEqual([]);
    expect(Option.getOrThrow(yield* reopened.getMatch("m1")).state).toBe("finished");
  }),
);

it.scoped("reads a Match stored before Venues as the home Venue's", () =>
  Effect.gen(function* () {
    const file = yield* tempFile;
    // An Invite exactly as the build before Venues stored it: no `venue` in its JSON.
    const old = {
      id: "m1",
      type: "public",
      minutes: 5,
      creator: { discordId: "d-a", steamId: "s-a" },
      target: null,
      players: [{ discordId: "d-a", steamId: "s-a" }],
      state: "invite",
      createdAt: 0,
      startedAt: null,
      endsAt: null,
      map: null,
      bestTicks: {},
      history: [],
      left: [],
      waitingForSteam: false,
    };
    yield* beforeVenues(
      file,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO matches ${sql.insert({ id: "m1", state: "invite", data: JSON.stringify(old) })}`;
      }),
    );
    const store = yield* openStore(file);
    expect(Option.getOrThrow(yield* store.getMatch("m1")).venue).toBe("home");
    expect((yield* store.activeMatches).map((m) => m.venue)).toEqual(["home"]);
  }),
);

it.scoped(
  "remembers who has answered the ping offer, by Venue and Discord id, across a reopen",
  () =>
    Effect.gen(function* () {
      const file = yield* tempFile;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(file);
          expect(yield* store.hasAnsweredPingOffer("home", "d-unlinked")).toBe(false);
          // A member without a Link can answer it too, and answering twice is harmless.
          yield* store.answerPingOffer("home", "d-unlinked");
          yield* store.answerPingOffer("home", "d-unlinked");
        }),
      );
      const reopened = yield* openStore(file);
      expect(yield* reopened.hasAnsweredPingOffer("home", "d-unlinked")).toBe(true);
      expect(yield* reopened.hasAnsweredPingOffer("home", "d-someone-else")).toBe(false);
      // Each Venue offers its own role, so an answer in one isn't one in another.
      expect(yield* reopened.hasAnsweredPingOffer("ballest-racing", "d-unlinked")).toBe(false);
      yield* reopened.answerPingOffer("ballest-racing", "d-unlinked");
      expect(yield* reopened.hasAnsweredPingOffer("ballest-racing", "d-unlinked")).toBe(true);
    }),
);

it.scoped("keeps the ping-offer answers given before Venues as the home Venue's", () =>
  Effect.gen(function* () {
    const file = yield* tempFile;
    yield* beforeVenues(
      file,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ping_offer_answers ${sql.insert({ discord_id: "d-old" })}`;
      }),
    );
    const store = yield* openStore(file);
    expect(yield* store.hasAnsweredPingOffer("home", "d-old")).toBe(true);
    expect(yield* store.hasAnsweredPingOffer("ballest-racing", "d-old")).toBe(false);
  }),
);
