// The bot's channel, as the Surface sees it: messages and Match Threads to draw things in.
// It speaks in what to draw, not how, so the Surface's rules run against an in-memory channel
// in tests; this adapter renders each Drawing with messages.ts and runs it on discord.js.
import { Context, Data, Effect, Layer } from "effect"
import type { CardView, ThreadPost } from "../ports.js"
import { Discord, type DiscordError, tryDiscord } from "./client.js"
import { cardMessage, closedCardMessage, footerMessage, threadMessage, threadName } from "./messages.js"

/** What a channel message shows. */
export type Drawing = Data.TaggedEnum<{
  Footer: {}
  Card: { readonly view: CardView }
  /** An Invite cancelled because no Map is eligible. */
  Closed: {}
}>
export const Drawing = Data.taggedEnum<Drawing>()

/** The message or thread was deleted (by hand, or before a restart). */
export class Gone extends Data.TaggedError("Gone")<{ readonly id: string }> {}

export class Channel extends Context.Tag("multiballs/Channel")<
  Channel,
  {
    /** Post a message; its id. */
    readonly post: (drawing: Drawing) => Effect.Effect<string, DiscordError>
    readonly redraw: (messageId: string, drawing: Drawing) => Effect.Effect<void, Gone | DiscordError>
    readonly deleteMessage: (messageId: string) => Effect.Effect<void, Gone | DiscordError>
    /** Start a Card's Match Thread on its message; the thread's id. */
    readonly startThread: (messageId: string, view: CardView) => Effect.Effect<string, Gone | DiscordError>
    readonly deleteThread: (threadId: string) => Effect.Effect<void, Gone | DiscordError>
    readonly postInThread: (threadId: string, matchId: string, post: ThreadPost) => Effect.Effect<void, Gone | DiscordError>
    /** The id of the channel's newest message, whoever posted it. */
    readonly lastMessageId: Effect.Effect<string | null, DiscordError>
  }
>() {}

const render = (drawing: Drawing) =>
  Drawing.$match(drawing, {
    Footer: () => footerMessage(),
    Card: ({ view }) => cardMessage(view),
    Closed: () => closedCardMessage()
  })

/** Discord's "Unknown Message" and "Unknown Channel" errors. */
const isUnknown = (e: DiscordError) =>
  typeof e.cause === "object" && e.cause !== null && "code" in e.cause && (e.cause.code === 10008 || e.cause.code === 10003)

const goneIfUnknown =
  (id: string) =>
  (e: DiscordError): Effect.Effect<never, Gone | DiscordError> =>
    isUnknown(e) ? Effect.fail(new Gone({ id })) : Effect.fail(e)

export const DiscordChannelLive = Layer.effect(
  Channel,
  Effect.gen(function* () {
    const discord = yield* Discord
    const channel = discord.channel

    const fetchMessage = (id: string) =>
      tryDiscord("fetch message", () => channel.messages.fetch(id)).pipe(Effect.catchAll(goneIfUnknown(id)))
    const fetchThread = (id: string) =>
      tryDiscord("fetch thread", () => channel.threads.fetch(id)).pipe(
        Effect.catchAll(goneIfUnknown(id)),
        Effect.flatMap((thread) => (thread === null ? Effect.fail(new Gone({ id })) : Effect.succeed(thread)))
      )

    return Channel.of({
      post: (drawing) => tryDiscord("post", () => channel.send(render(drawing))).pipe(Effect.map((m) => m.id)),
      redraw: (messageId, drawing) =>
        fetchMessage(messageId).pipe(
          Effect.flatMap((m) => tryDiscord("redraw", () => m.edit(render(drawing)))),
          Effect.asVoid
        ),
      deleteMessage: (messageId) =>
        fetchMessage(messageId).pipe(
          Effect.flatMap((m) => tryDiscord("delete message", () => m.delete())),
          Effect.asVoid
        ),
      startThread: Effect.fn("startThread")(function* (messageId: string, view: CardView) {
        const message = yield* fetchMessage(messageId)
        const name = threadName(view, yield* discord.displayName(view.creator.discordId))
        const thread = yield* tryDiscord("start thread", () => message.startThread({ name }))
        return thread.id
      }),
      deleteThread: (threadId) =>
        fetchThread(threadId).pipe(Effect.flatMap((t) => tryDiscord("delete thread", async () => void (await t.delete())))),
      postInThread: (threadId, matchId, post) =>
        fetchThread(threadId).pipe(
          Effect.flatMap((t) => tryDiscord(`post ${post._tag}`, () => t.send(threadMessage(matchId, post)))),
          Effect.asVoid
        ),
      lastMessageId: tryDiscord("fetch last message", () => channel.messages.fetch({ limit: 1 })).pipe(
        Effect.map((ms) => ms.first()?.id ?? null)
      )
    })
  })
)
