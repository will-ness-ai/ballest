// The Surface port, driven through its interface over an in-memory channel and SQLite in
// memory: where Cards, Match Threads and the Footer end up, across failures and restarts.
import { SqliteClient } from "@effect/sql-sqlite-node"
import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { Channel, Drawing, Gone } from "../src/discord/channel.js"
import { DiscordError } from "../src/discord/client.js"
import { ChannelSurfaceLive } from "../src/discord/surface.js"
import { type CardView, Surface, ThreadPost } from "../src/ports.js"

const ALICE = { discordId: "d-alice", steamId: "s-alice" }

const view = (matchId: string, over: Partial<CardView> = {}): CardView => ({
  matchId,
  state: "invite",
  type: "public",
  minutes: 10,
  creator: ALICE,
  target: null,
  players: [ALICE],
  map: null,
  standings: [],
  expiresAt: null,
  endsAt: null,
  ...over
})

type Failable = "post" | "redraw" | "startThread"

/** A channel in memory: messages in order, threads with their posts, and failures on demand. */
const makeFakeChannel = () => {
  let next = 1
  const messages: Array<{ id: string; drawing: Drawing | null }> = []
  const threads = new Map<string, { messageId: string; posts: Array<ThreadPost> }>()
  const failures = new Map<Failable, number>()

  const fail = (op: Failable) => {
    const left = failures.get(op) ?? 0
    if (left === 0) return false
    failures.set(op, left - 1)
    return true
  }
  const broken = (op: string) => new DiscordError({ op, cause: "flaky" })
  const find = (id: string) => messages.find((m) => m.id === id)

  const port = Channel.of({
    post: (drawing) =>
      Effect.suspend(() => {
        if (fail("post")) return Effect.fail(broken("post"))
        const id = `msg${next++}`
        messages.push({ id, drawing })
        return Effect.succeed(id)
      }),
    redraw: (messageId, drawing) =>
      Effect.suspend((): Effect.Effect<void, Gone | DiscordError> => {
        if (fail("redraw")) return Effect.fail(broken("redraw"))
        const m = find(messageId)
        if (m === undefined) return Effect.fail(new Gone({ id: messageId }))
        m.drawing = drawing
        return Effect.void
      }),
    deleteMessage: (messageId) =>
      Effect.suspend(() => {
        const i = messages.findIndex((m) => m.id === messageId)
        if (i < 0) return Effect.fail(new Gone({ id: messageId }))
        messages.splice(i, 1)
        return Effect.void
      }),
    startThread: (messageId) =>
      Effect.suspend((): Effect.Effect<string, Gone | DiscordError> => {
        if (fail("startThread")) return Effect.fail(broken("startThread"))
        if (find(messageId) === undefined) return Effect.fail(new Gone({ id: messageId }))
        const id = `thr${next++}`
        threads.set(id, { messageId, posts: [] })
        return Effect.succeed(id)
      }),
    deleteThread: (threadId) =>
      Effect.suspend(() => (threads.delete(threadId) ? Effect.void : Effect.fail(new Gone({ id: threadId })))),
    postInThread: (threadId, _matchId, post) =>
      Effect.suspend(() => {
        const thread = threads.get(threadId)
        if (thread === undefined) return Effect.fail(new Gone({ id: threadId }))
        thread.posts.push(post)
        return Effect.void
      }),
    lastMessageId: Effect.sync(() => messages.at(-1)?.id ?? null)
  })

  const label = (d: Drawing | null) =>
    d === null ? "someone else" : Drawing.$match(d, { Footer: () => "footer", Card: ({ view }) => `card ${view.matchId}`, Closed: () => "closed" })

  return {
    port,
    /** What the channel shows, top to bottom. */
    order: () => messages.map((m) => label(m.drawing)),
    /** The thread started on a Match's Card, if any, and what was posted in it. */
    threadPosts: (matchId: string) => {
      const card = messages.find((m) => m.drawing !== null && label(m.drawing) === `card ${matchId}`)
      const thread = [...threads.values()].find((t) => t.messageId === card?.id)
      return thread?.posts.map((p) => p._tag) ?? null
    },
    threadCount: () => threads.size,
    failNext: (op: Failable, n: number) => failures.set(op, n),
    postByAnyone: () => messages.push({ id: `msg${next++}`, drawing: null }),
    deleteFooter: () => {
      const i = messages.findIndex((m) => m.drawing?._tag === "Footer")
      if (i >= 0) messages.splice(i, 1)
    }
  }
}

/** A channel and a database that outlive any one Surface, so a test can restart the bot. */
const setup = Effect.gen(function* () {
  const channel = makeFakeChannel()
  const sql = yield* Layer.build(SqliteClient.layer({ filename: ":memory:" }))
  const start = Effect.gen(function* () {
    const ctx = yield* Layer.build(ChannelSurfaceLive).pipe(
      Effect.provide(Context.add(sql, Channel, channel.port))
    )
    return Context.get(ctx, Surface)
  })
  return { channel, start }
})

describe("the channel", () => {
  it.scoped("gets a Footer on first start", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      yield* start
      expect(channel.order()).toEqual(["footer"])
    })
  )

  it.scoped("turns the Footer into each new Card, each with a thread, and keeps one Footer last", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      yield* surface.showCard(view("m1"))
      yield* surface.showCard(view("m2"))
      yield* surface.showCard(view("m1", { players: [ALICE, ALICE] }))
      expect(channel.order()).toEqual(["card m1", "card m2", "footer"])
      expect(channel.threadCount()).toBe(2)
    })
  )

  it.scoped("deletes an expired, cancelled or declined Invite's Card and thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      yield* surface.showCard(view("m1"))
      yield* surface.showCard(view("m2"))
      yield* surface.remove("m1", "expired")
      expect(channel.order()).toEqual(["card m2", "footer"])
      expect(channel.threadCount()).toBe(1)
    })
  )

  it.scoped("keeps a Card cancelled for want of a Map, saying why, with its thread", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      yield* surface.showCard(view("m1"))
      yield* surface.post("m1", ThreadPost.NoMap({ players: [ALICE] }))
      yield* surface.remove("m1", "noEligibleMap")
      expect(channel.order()).toEqual(["closed", "footer"])
      expect(channel.threadCount()).toBe(1)
    })
  )

  it.scoped("posts the Card fresh when the Footer was deleted by hand", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      channel.deleteFooter()
      yield* surface.showCard(view("m1"))
      expect(channel.order()).toEqual(["card m1", "footer"])
      expect(channel.threadPosts("m1")).toEqual([])
    })
  )

  it.scoped("posts no Footer above a Card that couldn't be drawn, and draws it next time", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      channel.failNext("redraw", 1)
      yield* surface.showCard(view("m1"))
      expect(channel.order()).toEqual(["footer"])
      yield* surface.showCard(view("m1"))
      expect(channel.order()).toEqual(["card m1", "footer"])
    })
  )

  it.scoped("starts a thread that failed to start on the Match's next post, so nothing is dropped", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      const surface = yield* start
      channel.failNext("startThread", 3)
      yield* surface.showCard(view("m1"))
      expect(channel.threadCount()).toBe(0)
      yield* surface.post("m1", ThreadPost.Opened({ by: ALICE, type: "public", minutes: 10 }))
      expect(channel.threadPosts("m1")).toEqual(["Opened"])
    })
  )
})

describe("after a restart", () => {
  it.scoped("leaves the Footer alone when it's still last, and keeps drawing Cards in place", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      yield* (yield* start).showCard(view("m1"))
      const surface = yield* start
      expect(channel.order()).toEqual(["card m1", "footer"])
      yield* surface.showCard(view("m1", { state: "live" }))
      yield* surface.post("m1", ThreadPost.Result({ standings: [] }))
      expect(channel.order()).toEqual(["card m1", "footer"])
      expect(channel.threadPosts("m1")).toEqual(["Result"])
    })
  )

  it.scoped("replaces the Footer if something was posted after it", () =>
    Effect.gen(function* () {
      const { channel, start } = yield* setup
      yield* (yield* start).showCard(view("m1"))
      channel.postByAnyone()
      yield* start
      expect(channel.order()).toEqual(["card m1", "someone else", "footer"])
    })
  )
})
