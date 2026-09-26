// A logged-in Steam session and the three leaderboard reads the bot needs.
//
// Two facts from the spikes (issue #21, 2026-09-24) shape this file:
// - Leaderboard requests must go ONE AT A TIME. With several in flight, Steam silently drops
//   replies (10% lost at 10 concurrent, 50% at 50). A dropped reply never calls back, so every
//   request has its own timeout and is retried.
// - Find-by-name only works with the message header's routing_appid set to the app.
import { Config, Data, Effect, Option, Redacted, Schema } from "effect"
import SteamUser from "steam-user"
import Protos from "steam-user/protobufs/generated/_load.js"
import { SteamUnavailable } from "../ports.js"

export const APP_ID = 3339810

/** Steam message numbers (steam-user's EMsg table). */
const EMSG_FIND_OR_CREATE_LB = 5416
const EMSG_GET_LB_ENTRIES = 5418
const EResultOK = 1
/** leaderboard_data_request values. */
const REQUEST_GLOBAL = 0
const REQUEST_USERS = 3

const REQUEST_TIMEOUT = "5 seconds"
const REQUEST_RETRIES = 2
const LOGON_TIMEOUT = "30 seconds"

const FindResponse = Schema.Struct({ eresult: Schema.Number, leaderboard_id: Schema.Number })
const EntriesResponse = Schema.Struct({
  eresult: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({ steam_id_user: Schema.String, global_rank: Schema.Number, score: Schema.Number })
  )
})

export interface BoardEntry {
  readonly steamId: string
  readonly globalRank: number
  /** Run time in hundred-thousandths of a second (SCORE_TICKS_PER_SECOND). */
  readonly score: number
}

class NoReply extends Data.TaggedError("NoReply")<{}> {}

/**
 * steam-user's internal send. With `proto` set it writes a protobuf header (routing_appid
 * included); the reply reaches the callback as a ByteBuffer or a Buffer, and a reply Steam
 * drops never calls back. Internal, hence steam-user pinned to an exact version (ADR 0003)
 * and checked for at startup rather than assumed.
 */
interface InternalSend {
  _send(
    header: { readonly msg: number; readonly proto: { readonly routing_appid?: number } },
    body: Buffer,
    callback: (reply: Buffer | { toBuffer(): Buffer }) => void
  ): void
}
const hasInternalSend = (client: object): client is InternalSend => "_send" in client && typeof client._send === "function"

export class SteamSession extends Effect.Service<SteamSession>()("multiballs/SteamSession", {
  scoped: Effect.gen(function* () {
    const token = yield* Config.redacted("STEAM_REFRESH_TOKEN")
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const c = new SteamUser({ autoRelogin: true })
        // Without an `error` listener steam-user throws and takes the process down.
        c.on("error", (err) => console.error(`[steam] ${err.message}`))
        c.on("disconnected", (eresult) => console.warn(`[steam] disconnected (${eresult}); steam-user reconnects`))
        return c
      }),
      (c) => Effect.sync(() => c.logOff())
    )
    yield* Effect.async<void, SteamUnavailable>((resume) => {
      const ok = () => {
        client.off("error", bad)
        resume(Effect.void)
      }
      const bad = (err: Error) => {
        client.off("loggedOn", ok)
        resume(Effect.fail(new SteamUnavailable({ reason: `log on failed: ${err.message}` })))
      }
      client.once("loggedOn", ok)
      client.once("error", bad)
      client.logOn({ refreshToken: Redacted.value(token) })
      return Effect.sync(() => {
        client.off("loggedOn", ok)
        client.off("error", bad)
      })
    }).pipe(
      Effect.timeoutFail({ duration: LOGON_TIMEOUT, onTimeout: () => new SteamUnavailable({ reason: "log on timed out" }) })
    )

    if (!hasInternalSend(client)) return yield* Effect.die("this steam-user version has no internal _send")
    const sender: InternalSend = client
    const oneAtATime = yield* Effect.makeSemaphore(1)

    /** One leaderboard request: encoded, sent, decoded — alone in flight, with a timeout and retries. */
    const call = <A, I>(
      emsg: number,
      request: string,
      response: string,
      body: object,
      schema: Schema.Schema<A, I>,
      routed: boolean
    ) => {
      const req = Protos[request]
      const res = Protos[response]
      if (req === undefined || res === undefined) return Effect.die(`steam-user has no protobuf ${request}/${response}`)
      const send = Effect.async<Buffer, NoReply>((resume) => {
        const bytes = Buffer.from(req.encode(req.fromObject(body)).finish())
        sender._send({ msg: emsg, proto: routed ? { routing_appid: APP_ID } : {} }, bytes, (reply) =>
          resume(Effect.succeed(Buffer.isBuffer(reply) ? reply : reply.toBuffer()))
        )
      }).pipe(Effect.timeoutFail({ duration: REQUEST_TIMEOUT, onTimeout: () => new NoReply() }))
      return oneAtATime.withPermits(1)(send).pipe(
        Effect.retry({ times: REQUEST_RETRIES }),
        Effect.mapError(() => new SteamUnavailable({ reason: `no reply to ${request}` })),
        Effect.flatMap((bytes) =>
          Schema.decodeUnknown(schema)(res.toObject(res.decode(bytes), { longs: String, defaults: true }))
        ),
        Effect.catchTag("ParseError", (e) => Effect.fail(new SteamUnavailable({ reason: `bad ${response}: ${e.message}` })))
      )
    }

    const entries = (boardId: number, dataRequest: number, range: [number, number], steamIds: ReadonlyArray<string>) =>
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
          steamids: [...steamIds]
        },
        EntriesResponse,
        false
      ).pipe(
        Effect.filterOrFail(
          (r) => r.eresult === EResultOK,
          (r) => new SteamUnavailable({ reason: `GetLBEntries eresult ${r.eresult}` })
        ),
        Effect.map((r) =>
          r.entries.map((e): BoardEntry => ({ steamId: e.steam_id_user, globalRank: e.global_rank, score: e.score }))
        )
      )

    return {
      /** A board's id by its exact name; None when no board exists (nobody has finished the Map). */
      findBoard: Effect.fn("SteamSession.findBoard")(function* (name: string) {
        const r = yield* call(
          EMSG_FIND_OR_CREATE_LB,
          "CMsgClientLBSFindOrCreateLB",
          "CMsgClientLBSFindOrCreateLBResponse",
          { app_id: APP_ID, leaderboard_name: name, create_if_not_found: false },
          FindResponse,
          true
        )
        return r.eresult === EResultOK && r.leaderboard_id !== 0 ? Option.some(r.leaderboard_id) : Option.none()
      }),
      /** Rank 1, if the board has any entry. */
      top: (boardId: number) => entries(boardId, REQUEST_GLOBAL, [1, 1], []).pipe(Effect.map((es) => Option.fromNullable(es[0]))),
      /** These Players' entries; a Player with no time is simply absent. */
      players: (boardId: number, steamIds: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<BoardEntry>, SteamUnavailable> =>
        steamIds.length === 0 ? Effect.succeed<ReadonlyArray<BoardEntry>>([]) : entries(boardId, REQUEST_USERS, [0, 0], steamIds)
    } as const
  })
}) {}
