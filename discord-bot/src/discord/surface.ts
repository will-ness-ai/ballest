// The Surface port on Discord: runs the layout's plans against the channel and keeps the
// resulting message and thread ids in SQLite. Discord failures are logged, never thrown at
// the engine: a Card that fails to redraw must not stop a Match.
import { SqlClient, SqlSchema } from "@effect/sql"
import { type Message } from "discord.js"
import { Effect, Layer, Option, Ref, Schedule, Schema } from "effect"
import { MigratorLive } from "../db.js"
import { type CardView, type RemovalReason, Surface, type ThreadPost } from "../ports.js"
import { Discord, DiscordError, tryDiscord } from "./client.js"
import {
  applyOp,
  type Created,
  emptyLayout,
  forget,
  type Layout,
  Op,
  planRemove,
  planShowCard,
  planStartup,
  withThread
} from "./layout.js"
import { cardMessage, closedCardMessage, footerMessage, threadMessage, threadName } from "./messages.js"

const LayoutJson = Schema.parseJson(
  Schema.Struct({
    footerId: Schema.NullOr(Schema.String),
    cards: Schema.Array(
      Schema.Tuple(Schema.String, Schema.Struct({ messageId: Schema.String, threadId: Schema.NullOr(Schema.String) }))
    )
  })
)

/** A missing message or thread (already deleted by hand). */
const isUnknown = (e: DiscordError) =>
  typeof e.cause === "object" && e.cause !== null && "code" in e.cause && (e.cause.code === 10008 || e.cause.code === 10003)

/** Deleting something already gone counts as done. */
const ignoreUnknown = <A>(effect: Effect.Effect<A, DiscordError>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchIf(isUnknown, () => Effect.void)
  )

const make = Effect.gen(function* () {
  const discord = yield* Discord
  const sql = yield* SqlClient.SqlClient
  const channel = discord.channel

  const loadLayout = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ data: LayoutJson }),
    execute: () => sql`SELECT data FROM discord_layout WHERE id = 1`
  })
  const saved = yield* loadLayout(undefined).pipe(Effect.orDie)
  const layout = yield* Ref.make<Layout>(
    Option.match(saved, {
      onNone: () => emptyLayout,
      onSome: ({ data }) => ({ footerId: data.footerId, cards: new Map(data.cards) })
    })
  )
  const setLayout = Effect.fn("setLayout")(function* (change: (current: Layout) => Layout) {
    const next = yield* Ref.updateAndGet(layout, (current) => change(current))
    const data = yield* Schema.encode(LayoutJson)({ footerId: next.footerId, cards: [...next.cards] })
    yield* sql`INSERT INTO discord_layout (id, data) VALUES (1, ${data}) ON CONFLICT (id) DO UPDATE SET data = excluded.data`
  }, Effect.orDie)

  const lock = yield* Effect.makeSemaphore(1)
  const fetchMessage = (id: string) => tryDiscord("fetch message", () => channel.messages.fetch(id))

  /** Start a Match Thread, retrying briefly. A failure leaves the Card thread-less; the next post tries again. */
  const startThread = Effect.fn("startThread")(function* (message: Message, name: string) {
    return yield* tryDiscord("start thread", () => message.startThread({ name })).pipe(
      Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
      Effect.map((thread) => thread.id),
      Effect.tapError((e) => Effect.logError(`starting a thread failed (${e.op})`, e.cause)),
      Effect.option,
      Effect.map(Option.getOrUndefined)
    )
  })

  const threadNameOf = Effect.fn("threadNameOf")(function* (view: CardView) {
    return threadName(view, yield* discord.displayName(view.creator.discordId))
  })

  /** A new Card: the Footer edited into it, or a fresh message if the Footer is gone. */
  const createCard = Effect.fn("createCard")(function* (footerId: string | null, view: CardView) {
    const footer = footerId === null ? Option.none() : yield* fetchMessage(footerId).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isUnknown, () => Effect.succeedNone)
    )
    const message = Option.isSome(footer)
      ? yield* tryDiscord("edit footer into card", () => footer.value.edit(cardMessage(view)))
      : yield* tryDiscord("post card", () => channel.send(cardMessage(view)))
    const threadId = yield* startThread(message, yield* threadNameOf(view))
    const created: Created = threadId === undefined ? { messageId: message.id } : { messageId: message.id, threadId }
    return created
  })

  /** Run one op, then record what it changed. */
  const run = Effect.fn("run")(function* (op: Op, view: CardView | null) {
    const created: Created = yield* Op.$match(op, {
      FooterBecomesCard: ({ messageId }) => (view === null ? Effect.succeed({}) : createCard(messageId, view)),
      PostCard: () => (view === null ? Effect.succeed({}) : createCard(null, view)),
      EditCard: ({ messageId }) =>
        view === null
          ? Effect.succeed({})
          : fetchMessage(messageId).pipe(
              Effect.flatMap((message) => tryDiscord("edit card", () => message.edit(cardMessage(view)))),
              Effect.as({})
            ),
      CloseCard: ({ messageId }) =>
        fetchMessage(messageId).pipe(
          Effect.flatMap((message) => tryDiscord("close card", () => message.edit(closedCardMessage()))),
          ignoreUnknown,
          Effect.as({})
        ),
      PostFooter: () =>
        tryDiscord("post footer", () => channel.send(footerMessage())).pipe(Effect.map((m) => ({ messageId: m.id }))),
      DeleteMessage: ({ messageId }) =>
        fetchMessage(messageId).pipe(
          Effect.flatMap((m) => tryDiscord("delete message", () => m.delete())),
          ignoreUnknown,
          Effect.as({})
        ),
      DeleteThread: ({ threadId }) =>
        tryDiscord("fetch thread", () => channel.threads.fetch(threadId)).pipe(
          Effect.flatMap((t) => (t === null ? Effect.void : tryDiscord("delete thread", async () => void (await t.delete())))),
          ignoreUnknown,
          Effect.as({})
        )
    })
    yield* setLayout((current) => applyOp(current, op, created))
  })

  const logFailure = (e: DiscordError) => Effect.logError(`discord ${e.op} failed`, e.cause)

  /** Every op, each on its own: one that fails is logged and the rest still run. */
  const runEach = (ops: ReadonlyArray<Op>) =>
    Effect.forEach(ops, (op) => run(op, null).pipe(Effect.catchAll((e) => logFailure(e))), { discard: true })

  /** A Card's ops in order, stopping at the first failure so no Footer is posted above a missing Card. */
  const runInOrder = (ops: ReadonlyArray<Op>, view: CardView) =>
    Effect.forEach(ops, (op) => run(op, view), { discard: true }).pipe(Effect.catchAll((e) => logFailure(e)))

  // Startup: the Footer must be the channel's last message, with today's wording.
  yield* lock.withPermits(1)(
    Effect.gen(function* () {
      const latest = yield* tryDiscord("fetch last message", () => channel.messages.fetch({ limit: 1 })).pipe(
        Effect.map((ms) => ms.first()?.id ?? null),
        Effect.orElseSucceed(() => null)
      )
      const ops = planStartup(yield* Ref.get(layout), latest)
      yield* runEach(ops)
      const footerId = (yield* Ref.get(layout)).footerId
      if (ops.length === 0 && footerId !== null)
        yield* fetchMessage(footerId).pipe(
          Effect.flatMap((m) => tryDiscord("refresh footer", () => m.edit(footerMessage()))),
          Effect.catchAll((e) => Effect.logWarning(`footer refresh failed (${e.op})`))
        )
    })
  )

  const showCard = Effect.fn("showCard")(function* (view: CardView) {
    yield* runInOrder(planShowCard(yield* Ref.get(layout), view.matchId), view)
  }, lock.withPermits(1))

  const remove = Effect.fn("remove")(function* (matchId: string, reason: RemovalReason) {
    yield* runEach(planRemove(yield* Ref.get(layout), matchId, reason))
  }, lock.withPermits(1))

  /** The Match Thread for a Card, started now if it couldn't be at the time. */
  const threadOf = Effect.fn("threadOf")(function* (matchId: string) {
    const card = (yield* Ref.get(layout)).cards.get(matchId)
    if (card === undefined) return Option.none<string>()
    if (card.threadId !== null) return Option.some(card.threadId)
    const message = yield* fetchMessage(card.messageId)
    const threadId = yield* startThread(message, `Match #${matchId}`)
    if (threadId === undefined) return Option.none<string>()
    yield* setLayout((current) => withThread(current, matchId, threadId))
    return Option.some(threadId)
  }, lock.withPermits(1))

  const post = Effect.fn("post")(
    function* (matchId: string, post: ThreadPost) {
      const threadId = yield* threadOf(matchId)
      if (Option.isNone(threadId)) return yield* Effect.logWarning(`no thread for ${matchId}; dropped a ${post._tag} post`)
      const thread = yield* tryDiscord("fetch thread", () => channel.threads.fetch(threadId.value))
      if (thread === null) return yield* Effect.logWarning(`thread for ${matchId} is gone`)
      yield* tryDiscord(`post ${post._tag}`, () => thread.send(threadMessage(matchId, post)))
      // The Result is the last thing a Match's Card and thread ever get.
      if (post._tag === "Result") yield* lock.withPermits(1)(setLayout((current) => forget(current, matchId)))
    },
    Effect.catchAll((e) => logFailure(e))
  )

  return Surface.of({ showCard, remove, post })
})

/** The Surface port on Discord. Needs the Discord service and a SqlClient. */
export const DiscordSurfaceLive = Layer.effect(Surface, make).pipe(Layer.provide(MigratorLive))
