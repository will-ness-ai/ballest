import { describe, expect, it } from "@effect/vitest";
import { EventEmitter } from "node:events";
import { ConfigProvider, Effect, Either, Fiber, Layer, TestClock } from "effect";
import Protos from "steam-user/protobufs/generated/_load.js";
import {
  EMSG_GET_LB_ENTRIES,
  FRESH_LOGON_AFTER_MS,
  makeSteamSession,
} from "../src/steam/session.js";

/**
 * A stand-in steam-user client. It logs on at once and answers every leaderboard read with
 * one entry, until `dead`: then, like the connection on 2026-10-06, nothing answers.
 */
class FakeClient extends EventEmitter {
  steamID: object | null = null;
  dead = false;
  loggedOff = false;

  logOn() {
    this.steamID = {};
    this.emit("loggedOn");
  }

  logOff() {
    this.loggedOff = true;
    this.steamID = null;
  }

  _send(header: { readonly msg: number }, _body: Buffer, callback: (reply: Buffer) => void): void {
    if (this.dead || header.msg !== EMSG_GET_LB_ENTRIES) return;
    const res = Protos.CMsgClientLBSGetLBEntriesResponse!;
    const reply = res.fromObject({
      eresult: 1,
      entries: [{ steam_id_user: "76561198000000001", global_rank: 1, score: 1_234_567 }],
    });
    callback(Buffer.from(res.encode(reply).finish()));
  }
}

const config = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([["STEAM_REFRESH_TOKEN", "fake-token"]])),
);

/** A session over fake clients, and every client it has made so far. */
const session = Effect.gen(function* () {
  const clients: Array<FakeClient> = [];
  const s = yield* makeSteamSession(() => {
    const c = new FakeClient();
    clients.push(c);
    return c;
  });
  return { s, clients };
});

/** One read, with the clock run past its three timeouts. */
const readThroughTimeouts = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(Effect.either(read));
    yield* TestClock.adjust("20 seconds");
    return yield* Fiber.join(fiber);
  });

describe("the Steam session", () => {
  it.scoped("reads a board while Steam answers", () =>
    Effect.gen(function* () {
      const { s } = yield* session;
      const entries = yield* s.players(1, ["76561198000000001"]);
      expect(entries).toEqual([{ steamId: "76561198000000001", globalRank: 1, score: 1_234_567 }]);
    }).pipe(Effect.provide(config)),
  );

  it.scoped("logs on with a fresh client once Steam has stopped answering for a while", () =>
    Effect.gen(function* () {
      const { s, clients } = yield* session;
      clients[0]!.dead = true;

      // The first unanswered read starts the clock; nothing is replaced yet.
      expect(Either.isLeft(yield* readThroughTimeouts(s.players(1, ["a"])))).toBe(true);
      yield* TestClock.adjust(FRESH_LOGON_AFTER_MS);
      expect(clients).toHaveLength(1);

      // Still unanswered after that long: the dead client goes and a fresh one logs on.
      expect(Either.isLeft(yield* readThroughTimeouts(s.players(1, ["a"])))).toBe(true);
      expect(clients).toHaveLength(2);
      expect(clients[0]!.loggedOff).toBe(true);

      // Reads go to the fresh client, and Steam answers again.
      expect(yield* s.players(1, ["a"])).toHaveLength(1);
    }).pipe(Effect.provide(config)),
  );

  it.scoped("fails a read at once while logged off, instead of waiting out its timeouts", () =>
    Effect.gen(function* () {
      const { s, clients } = yield* session;
      clients[0]!.steamID = null;
      // No clock adjustment: the read must fail without waiting.
      expect(Either.isLeft(yield* Effect.either(s.players(1, ["a"])))).toBe(true);
    }).pipe(Effect.provide(config)),
  );

  it.scoped("keeps answering through short gaps without logging on again", () =>
    Effect.gen(function* () {
      const { s, clients } = yield* session;
      clients[0]!.dead = true;
      yield* readThroughTimeouts(s.players(1, ["a"]));
      clients[0]!.dead = false;
      expect(yield* s.players(1, ["a"])).toHaveLength(1);
      // The answer cleared the clock, so a later failure starts it afresh.
      yield* TestClock.adjust(FRESH_LOGON_AFTER_MS * 2);
      clients[0]!.dead = true;
      yield* readThroughTimeouts(s.players(1, ["a"]));
      expect(clients).toHaveLength(1);
    }).pipe(Effect.provide(config)),
  );
});
