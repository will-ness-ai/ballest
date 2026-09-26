// The Surface port on Discord: runs the layout's plans against the channel and keeps the
// resulting message and thread ids in SQLite. Discord failures are logged, never thrown at
// the engine: a Card that fails to redraw must not stop a Match.
import { SqlClient, SqlSchema } from "@effect/sql"
import { type Message } from "discord.js"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { MigratorLive } from "../db.js"
import { type CardView, Surface } from "../ports.js"
import { Discord, tryDiscord } from "./client.js"
import { applyOp, emptyLayout, type Layout, Op, planRemove, planShowCard, planStartup } from "./layout.js"
import { cardMessage, footerMessage, threadMessage, threadName } from "./messages.js"

const LayoutJson = Schema.parseJson(
  Schema.Struct({
    footerId: Schema.NullOr(Schema.String),
    cards: Schema.Array(Schema.Tuple(Schema.String, Schema.Struct({ messageId: Schema.String, threadId: Schema.String })))
  })
)

/** A missing message or thread (already deleted by hand) counts as done. */
const isUnknown = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && (cause.code === 10008 || cause.code === 10003)

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
  const persist = Effect.gen(function* () {
    const l = yield* Ref.get(layout)
    const data = yield* Schema.encode(LayoutJson)({ footerId: l.footerId, cards: [...l.cards] })
    yield* sql`INSERT INTO discord_layout (id, data) VALUES (1, ${data}) ON CONFLICT (id) DO UPDATE SET data = excluded.data`
  }).pipe(Effect.orDie)

  const lock = yield* Effect.makeSemaphore(1)
  const fetchMessage = (id: string) => tryDiscord("fetch message", () => channel.messages.fetch(id))
  const startThread = (message: Message, view: CardView) =>
    Effect.gen(function* () {
      const name = threadName(view, yield* discord.displayName(view.creator.discordId))
      const thread = yield* tryDiscord("start thread", () => message.startThread({ name }))
      return thread.id
    })

  /** Run one op, then record what it changed. */
  const run = (op: Op, view: CardView | null) =>
    Effect.gen(function* () {
      const created = yield* Op.$match(op, {
        FooterBecomesCard: ({ messageId }) =>
          Effect.gen(function* () {
            if (view === null) return {}
            const message = yield* fetchMessage(messageId)
            yield* tryDiscord("edit footer into card", () => message.edit(cardMessage(view)))
            return { threadId: yield* startThread(message, view) }
          }),
        PostCard: () =>
          Effect.gen(function* () {
            if (view === null) return {}
            const message = yield* tryDiscord("post card", () => channel.send(cardMessage(view)))
            return { messageId: message.id, threadId: yield* startThread(message, view) }
          }),
        EditCard: ({ messageId }) =>
          Effect.gen(function* () {
            if (view === null) return {}
            const message = yield* fetchMessage(messageId)
            yield* tryDiscord("edit card", () => message.edit(cardMessage(view)))
            return {}
          }),
        PostFooter: () =>
          tryDiscord("post footer", () => channel.send(footerMessage())).pipe(Effect.map((m) => ({ messageId: m.id }))),
        DeleteMessage: ({ messageId }) =>
          fetchMessage(messageId).pipe(
            Effect.flatMap((m) => tryDiscord("delete message", () => m.delete())),
            Effect.catchIf((e) => isUnknown(e.cause), () => Effect.void),
            Effect.as({})
          ),
        DeleteThread: ({ threadId }) =>
          tryDiscord("fetch thread", () => channel.threads.fetch(threadId)).pipe(
            Effect.flatMap((t) => (t === null ? Effect.void : tryDiscord("delete thread", async () => void (await t.delete())))),
            Effect.catchIf((e) => isUnknown(e.cause), () => Effect.void),
            Effect.as({})
          )
      })
      yield* Ref.update(layout, (l) => applyOp(l, op, created))
      yield* persist
    }).pipe(Effect.catchAll((e) => Effect.logError(`discord ${op._tag} failed (${e.op})`, e.cause)))

  const runAll = (ops: ReadonlyArray<Op>, view: CardView | null) => Effect.forEach(ops, (op) => run(op, view), { discard: true })

  // Startup: the Footer must be the channel's last message, with today's wording.
  yield* lock.withPermits(1)(
    Effect.gen(function* () {
      const latest = yield* tryDiscord("fetch last message", () => channel.messages.fetch({ limit: 1 })).pipe(
        Effect.map((ms) => ms.first()?.id ?? null),
        Effect.orElseSucceed(() => null)
      )
      const ops = planStartup(yield* Ref.get(layout), latest)
      yield* runAll(ops, null)
      const footerId = (yield* Ref.get(layout)).footerId
      if (ops.length === 0 && footerId !== null)
        yield* fetchMessage(footerId).pipe(
          Effect.flatMap((m) => tryDiscord("refresh footer", () => m.edit(footerMessage()))),
          Effect.catchAll((e) => Effect.logWarning(`footer refresh failed (${e.op})`))
        )
    })
  )

  return Surface.of({
    showCard: (view) => lock.withPermits(1)(Ref.get(layout).pipe(Effect.flatMap((l) => runAll(planShowCard(l, view.matchId), view)))),
    remove: (matchId) => lock.withPermits(1)(Ref.get(layout).pipe(Effect.flatMap((l) => runAll(planRemove(l, matchId), null)))),
    post: (matchId, post) =>
      Effect.gen(function* () {
        const card = (yield* Ref.get(layout)).cards.get(matchId)
        if (card === undefined) return yield* Effect.logWarning(`no thread for ${matchId}; dropped a ${post._tag} post`)
        const thread = yield* tryDiscord("fetch thread", () => channel.threads.fetch(card.threadId))
        if (thread === null) return yield* Effect.logWarning(`thread for ${matchId} is gone`)
        yield* tryDiscord(`post ${post._tag}`, () => thread.send(threadMessage(post)))
      }).pipe(Effect.catchAll((e) => Effect.logError(`discord ${e.op} failed`, e.cause)))
  })
})

/** The Surface port on Discord. Needs the Discord service and a SqlClient. */
export const DiscordSurfaceLive = Layer.effect(Surface, make).pipe(Layer.provide(MigratorLive))
