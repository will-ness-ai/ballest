// A logged-in Steam session and the three leaderboard reads the bot needs.
//
// Three facts shape this file:
// - Leaderboard requests must go ONE AT A TIME. With several in flight, Steam silently drops
//   replies (10% lost at 10 concurrent, 50% at 50). A dropped reply never calls back, so every
//   request has its own timeout and is retried. (The spikes, issue #21, 2026-09-24.)
// - Find-by-name only works with the message header's routing_appid set to the app. (Same.)
// - steam-user's own reconnect after a dropped connection can fail silently and for good: on
//   2026-10-06 the bot lost Steam at 22:09 UTC and every read of a live Lobby failed until it
//   ended. So once requests have gone unanswered for FRESH_LOGON_AFTER_MS, the session logs
//   on again with a new client.
import { Clock, Config, Data, Effect, Option, Redacted, Ref, Schema } from "effect";
import SteamUser from "steam-user";
import Protos from "steam-user/protobufs/generated/_load.js";
import { SteamUnavailable } from "../ports.js";

export const APP_ID = 3339810;

/** Steam message numbers (steam-user's EMsg table). */
export const EMSG_FIND_OR_CREATE_LB = 5416;
export const EMSG_GET_LB_ENTRIES = 5418;
const EResultOK = 1;
/** leaderboard_data_request values. */
const REQUEST_GLOBAL = 0;
const REQUEST_USERS = 3;

const REQUEST_TIMEOUT = "5 seconds";
const REQUEST_RETRIES = 2;
const LOGON_TIMEOUT = "30 seconds";

/** How long requests may go unanswered before the session logs on again with a new client. */
export const FRESH_LOGON_AFTER_MS = 2 * 60_000;

const FindResponse = Schema.Struct({ eresult: Schema.Number, leaderboard_id: Schema.Number });
const EntriesResponse = Schema.Struct({
  eresult: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({
      steam_id_user: Schema.String,
      global_rank: Schema.Number,
      score: Schema.Number,
    }),
  ),
});

export interface BoardEntry {
  readonly steamId: string;
  readonly globalRank: number;
  /** Run time in hundred-thousandths of a second (SCORE_TICKS_PER_SECOND). */
  readonly score: number;
}

class NoReply extends Data.TaggedError("NoReply") {}

/**
 * A steam-user client as this file uses it, so a test can stand in for one. `_send` is
 * steam-user's internal send. With `proto` set it writes a protobuf header (routing_appid
 * included); the reply reaches the callback as a ByteBuffer or a Buffer, and a reply Steam
 * drops never calls back. Internal, hence steam-user pinned to an exact version (ADR 0003)
 * and checked for at startup rather than assumed. While logged off (`steamID` null) it drops
 * every message without a word, so a request then fails straight away instead.
 */
export interface SteamClient {
  readonly steamID: object | null;
  _send(
    header: { readonly msg: number; readonly proto: { readonly routing_appid?: number } },
    body: Buffer,
    callback: (reply: Buffer | { toBuffer(): Buffer }) => void,
  ): void;
  logOn(details: { readonly refreshToken: string }): void;
  logOff(): void;
  on(event: "loggedOn", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "disconnected", listener: (eresult: number) => void): unknown;
  once(event: "loggedOn", listener: () => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
  off(event: "loggedOn", listener: () => void): unknown;
  off(event: "error", listener: (err: Error) => void): unknown;
}

const hasInternalSend = (client: object): client is Pick<SteamClient, "_send"> =>
  "_send" in client && typeof client._send === "function";

/** A real steam-user client. It reconnects by itself after a dropped connection, mostly. */
const steamUserClient = (): SteamClient => {
  const client = new SteamUser({ autoRelogin: true });
  if (!hasInternalSend(client)) throw new Error("this steam-user version has no internal _send");
  return client;
};

/** The session over clients from `newClient`: steam-user's in production, a fake in tests. */
export const makeSteamSession = Effect.fn("makeSteamSession")(function* (
  newClient: () => SteamClient,
) {
  const token = yield* Config.redacted("STEAM_REFRESH_TOKEN");

  /** A new client, logged on. A client that fails to log on is logged off. */
  const connect = Effect.gen(function* () {
    const client = newClient();
    // Without an `error` listener steam-user throws and takes the process down.
    client.on("error", (err) => console.error(`[steam] ${err.message}`));
    client.on("disconnected", (eresult) =>
      console.warn(`[steam] disconnected (${eresult}); steam-user reconnects`),
    );
    yield* Effect.async<undefined, SteamUnavailable>((resume) => {
      const ok = () => {
        client.off("error", bad);
        resume(Effect.succeed(undefined));
      };
      const bad = (err: Error) => {
        client.off("loggedOn", ok);
        resume(Effect.fail(new SteamUnavailable({ reason: `log on failed: ${err.message}` })));
      };
      client.once("loggedOn", ok);
      client.once("error", bad);
      client.logOn({ refreshToken: Redacted.value(token) });
      return Effect.sync(() => {
        client.off("loggedOn", ok);
        client.off("error", bad);
      });
    }).pipe(
      Effect.timeoutFail({
        duration: LOGON_TIMEOUT,
        onTimeout: () => new SteamUnavailable({ reason: "log on timed out" }),
      }),
      Effect.tapError(() => Effect.sync(() => client.logOff())),
    );
    // Any later log on is steam-user reconnecting, which otherwise leaves no trace in the log.
    client.on("loggedOn", () => console.warn("[steam] logged on again"));
    return client;
  });

  /** The client in use. Each one replaced is logged off then, and the last at shutdown. */
  const current = yield* Effect.acquireRelease(connect.pipe(Effect.flatMap(Ref.make)), (ref) =>
    Ref.get(ref).pipe(Effect.map((client) => client.logOff())),
  );
  const oneAtATime = yield* Effect.makeSemaphore(1);
  /** When the current run of unanswered requests began; null while Steam answers. */
  const failingSince = yield* Ref.make<number | null>(null);

  /** The client is swapped for a new one only once that one has logged on. */
  const logOnAfresh = Effect.fn("logOnAfresh")(function* () {
    yield* Effect.logWarning("[steam] no replies; logging on again with a fresh client");
    const old = yield* Ref.get(current);
    old.logOff();
    const fresh = yield* connect.pipe(
      Effect.tapError((e) => Effect.logError(`[steam] fresh log on failed: ${e.reason}`)),
      Effect.option,
    );
    if (Option.isSome(fresh)) {
      yield* Ref.set(current, fresh.value);
      yield* Effect.logInfo("[steam] logged on with a fresh client");
    }
  }, oneAtATime.withPermits(1));

  /**
   * A request went unanswered: the first starts the clock, and one after it has run out logs
   * on afresh and starts it again, so a fresh log on that fails is retried no sooner.
   */
  const noteFailure = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = yield* Ref.get(failingSince);
    if (since !== null && now - since < FRESH_LOGON_AFTER_MS) return;
    yield* Ref.set(failingSince, now);
    if (since !== null) yield* logOnAfresh();
  });

  /** One leaderboard request: encoded, sent, decoded — alone in flight, with a timeout and retries. */
  const call = <A, I>(
    emsg: number,
    request: string,
    response: string,
    body: object,
    schema: Schema.Schema<A, I>,
    routed: boolean,
  ) => {
    const req = Protos[request];
    const res = Protos[response];
    if (req === undefined || res === undefined)
      return Effect.die(`steam-user has no protobuf ${request}/${response}`);
    const send = Ref.get(current).pipe(
      Effect.flatMap((client) =>
        Effect.async<Buffer, NoReply>((resume) => {
          if (client.steamID === null) return resume(Effect.fail(new NoReply()));
          const bytes = Buffer.from(req.encode(req.fromObject(body)).finish());
          client._send(
            { msg: emsg, proto: routed ? { routing_appid: APP_ID } : {} },
            bytes,
            (reply) => resume(Effect.succeed(Buffer.isBuffer(reply) ? reply : reply.toBuffer())),
          );
        }),
      ),
      Effect.timeoutFail({ duration: REQUEST_TIMEOUT, onTimeout: () => new NoReply() }),
    );
    return oneAtATime
      .withPermits(1)(send)
      .pipe(
        Effect.retry({ times: REQUEST_RETRIES }),
        Effect.tapBoth({
          onFailure: () => noteFailure,
          onSuccess: () => Ref.set(failingSince, null),
        }),
        Effect.mapError(() => new SteamUnavailable({ reason: `no reply to ${request}` })),
        Effect.flatMap((bytes) =>
          Schema.decodeUnknown(schema)(
            res.toObject(res.decode(bytes), { longs: String, defaults: true }),
          ),
        ),
        Effect.catchTag("ParseError", (e) =>
          Effect.fail(new SteamUnavailable({ reason: `bad ${response}: ${e.message}` })),
        ),
      );
  };

  const entries = (
    boardId: number,
    dataRequest: number,
    range: [number, number],
    steamIds: ReadonlyArray<string>,
  ) =>
    call(
      EMSG_GET_LB_ENTRIES,
      "CMsgClientLBSGetLBEntries",
      "CMsgClientLBSGetLBEntriesResponse",
      {
        app_id: APP_ID,
        leaderboard_id: boardId,
        range_start: range[0],
        range_end: range[1],
        leaderboard_data_request: dataRequest,
        steamids: [...steamIds],
      },
      EntriesResponse,
      false,
    ).pipe(
      Effect.filterOrFail(
        (r) => r.eresult === EResultOK,
        (r) => new SteamUnavailable({ reason: `GetLBEntries eresult ${r.eresult}` }),
      ),
      Effect.map((r) =>
        r.entries.map((e): BoardEntry => ({
          steamId: e.steam_id_user,
          globalRank: e.global_rank,
          score: e.score,
        })),
      ),
    );

  return {
    /** A board's id by its exact name; None when no board exists (nobody has finished the Map). */
    findBoard: Effect.fn("SteamSession.findBoard")(function* (name: string) {
      const r = yield* call(
        EMSG_FIND_OR_CREATE_LB,
        "CMsgClientLBSFindOrCreateLB",
        "CMsgClientLBSFindOrCreateLBResponse",
        { app_id: APP_ID, leaderboard_name: name, create_if_not_found: false },
        FindResponse,
        true,
      );
      return r.eresult === EResultOK && r.leaderboard_id !== 0
        ? Option.some(r.leaderboard_id)
        : Option.none();
    }),
    /** Rank 1, if the board has any entry. */
    top: (boardId: number) =>
      entries(boardId, REQUEST_GLOBAL, [1, 1], []).pipe(
        Effect.map((es) => Option.fromNullable(es[0])),
      ),
    /** These Players' entries; a Player with no time is simply absent. */
    players: (
      boardId: number,
      steamIds: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<BoardEntry>, SteamUnavailable> =>
      steamIds.length === 0
        ? Effect.succeed<ReadonlyArray<BoardEntry>>([])
        : entries(boardId, REQUEST_USERS, [0, 0], steamIds),
  } as const;
});

export class SteamSession extends Effect.Service<SteamSession>()("multiballs/SteamSession", {
  scoped: makeSteamSession(steamUserClient),
}) {}
