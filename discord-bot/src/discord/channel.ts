// The bot's channel, as the Surface sees it: messages and Match Threads to draw things in.
// It speaks in what to draw, not how, so the Surface's rules run against an in-memory channel
// in tests; this adapter draws each one with the renderer and runs it on discord.js.
import { Context, Data, Effect, Layer } from "effect"
import type { MapInfo } from "../domain.js"
import type { CardView, ThreadPost } from "../ports.js"
import { Renderer } from "../render/renderer.js"
import { Discord, DiscordError, tryDiscord } from "./client.js"
import { Marbles } from "./marbles.js"
import { cardMessage, clockMessage, closedCardMessage, footerMessage, threadMessage, type ThreadArt, threadName } from "./messages.js"

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
    /** Open a Match Thread with its clock; the clock message's id. */
    readonly postClock: (threadId: string, view: CardView) => Effect.Effect<string, Gone | DiscordError>
    readonly redrawClock: (threadId: string, messageId: string, view: CardView) => Effect.Effect<void, Gone | DiscordError>
    /** `view` is the Match's latest Card, which the start ping and the Result are drawn from. */
    readonly postInThread: (
      threadId: string,
      matchId: string,
      post: ThreadPost,
      view: CardView | null
    ) => Effect.Effect<void, Gone | DiscordError>
    /** The id of the channel's newest message, whoever posted it. */
    readonly lastMessageId: Effect.Effect<string | null, DiscordError>
  }
>() {}

/** A drawing that failed to render is reported like any other failure to post it. */
const asDiscordError =
  (op: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, DiscordError, R> =>
    effect.pipe(
      Effect.mapError((cause) => new DiscordError({ op, cause })),
      Effect.catchAllDefect((cause) => Effect.fail(new DiscordError({ op, cause })))
    )

/** A Workshop preview image as a data URI; only PNG and JPEG, which the renderer can draw. */
const fetchPreview = (url: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const type = response.headers.get("content-type") ?? ""
    if (!response.ok || !/^image\/(png|jpeg)/.test(type)) throw new Error(`${response.status} ${type}`)
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`
  })

/** Discord's "Unknown Message" and "Unknown Channel" errors. */
const isUnknown = (e: DiscordError) =>
  typeof e.cause === "object" && e.cause !== null && "code" in e.cause && (e.cause.code === 10008 || e.cause.code === 10003)

/** Like goneIfUnknown, but passes a Gone from an earlier step through. */
const goneIfUnknownOr =
  (id: string) =>
  (e: Gone | DiscordError): Effect.Effect<never, Gone | DiscordError> =>
    e._tag === "Gone" ? Effect.fail(e) : goneIfUnknown(id)(e)

const goneIfUnknown =
  (id: string) =>
  (e: DiscordError): Effect.Effect<never, Gone | DiscordError> =>
    isUnknown(e) ? Effect.fail(new Gone({ id })) : Effect.fail(e)

export const DiscordChannelLive = Layer.effect(
  Channel,
  Effect.gen(function* () {
    const discord = yield* Discord
    const renderer = yield* Renderer
    const marbles = yield* Marbles
    const channel = discord.channel

    const fetchMessage = (id: string) =>
      tryDiscord("fetch message", () => channel.messages.fetch(id)).pipe(Effect.catchAll(goneIfUnknown(id)))
    const fetchThread = (id: string) =>
      tryDiscord("fetch thread", () => channel.threads.fetch(id)).pipe(
        Effect.catchAll(goneIfUnknown(id)),
        Effect.flatMap((thread) => (thread === null ? Effect.fail(new Gone({ id })) : Effect.succeed(thread)))
      )

    /** Every Player's name in this server, for the images. */
    const namesOf = Effect.fn("namesOf")(function* (view: CardView) {
      const players = view.target === null ? view.players : [...view.players, view.target]
      const names = new Map<string, string>()
      for (const p of players) names.set(p.discordId, yield* discord.displayName(p.discordId))
      return names
    })

    /** Workshop previews, fetched once each; null draws the stand-in art. */
    const previews = new Map<string, string | null>()
    const previewOf = Effect.fn("previewOf")(function* (map: MapInfo | null) {
      if (map === null || map.previewUrl === "") return null
      const known = previews.get(map.previewUrl)
      if (known !== undefined) return known
      const uri = yield* fetchPreview(map.previewUrl).pipe(
        Effect.tapError((cause) => Effect.logWarning(`no preview for ${map.pfid}`, cause)),
        Effect.orElseSucceed(() => null)
      )
      previews.set(map.previewUrl, uri)
      return uri
    })

    const drawCard = Effect.fn("drawCard")(function* (view: CardView) {
      return yield* renderer.card({ view, names: yield* namesOf(view), preview: yield* previewOf(view.map) })
    })

    const render = (drawing: Drawing) =>
      Drawing.$match(drawing, {
        Footer: () => renderer.footer.pipe(Effect.map((png) => footerMessage(png))),
        Card: ({ view }) => drawCard(view).pipe(Effect.map((png) => cardMessage(view, png))),
        Closed: () => Effect.succeed(closedCardMessage())
      }).pipe(asDiscordError("render"))

    /** The image a thread post carries, if any. */
    const threadPng = Effect.fn("threadPng")(function* (post: ThreadPost, view: CardView | null) {
      if (post._tag === "Improved")
        return yield* renderer.improvement(post.improvement, yield* discord.displayName(post.improvement.player.discordId))
      if ((post._tag === "Started" || post._tag === "Result") && view !== null) return yield* drawCard(view)
      return null
    })

    return Channel.of({
      post: (drawing) =>
        render(drawing).pipe(
          Effect.flatMap((message) => tryDiscord("post", () => channel.send(message))),
          Effect.map((m) => m.id)
        ),
      redraw: (messageId, drawing) =>
        fetchMessage(messageId).pipe(
          Effect.flatMap((m) => render(drawing).pipe(Effect.flatMap((message) => tryDiscord("redraw", () => m.edit(message))))),
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
      postClock: (threadId, view) =>
        fetchThread(threadId).pipe(
          Effect.flatMap((thread) => tryDiscord("post clock", () => thread.send(clockMessage(view)))),
          Effect.map((m) => m.id)
        ),
      redrawClock: (threadId, messageId, view) =>
        fetchThread(threadId).pipe(
          Effect.flatMap((thread) => tryDiscord("fetch clock", () => thread.messages.fetch(messageId))),
          Effect.catchAll(goneIfUnknownOr(messageId)),
          Effect.flatMap((m) => tryDiscord("redraw clock", () => m.edit(clockMessage(view)))),
          Effect.asVoid
        ),
      postInThread: Effect.fn("postInThread")(function* (threadId: string, matchId: string, post: ThreadPost, view: CardView | null) {
        const thread = yield* fetchThread(threadId)
        const png = yield* threadPng(post, view).pipe(asDiscordError("render"))
        const art: ThreadArt = { marbleOf: marbles.forPlayer, marbleAt: marbles.forHue, view, png }
        yield* tryDiscord(`post ${post._tag}`, () => thread.send(threadMessage(matchId, post, art)))
      }),
      lastMessageId: tryDiscord("fetch last message", () => channel.messages.fetch({ limit: 1 })).pipe(
        Effect.map((ms) => ms.first()?.id ?? null)
      )
    })
  })
)
