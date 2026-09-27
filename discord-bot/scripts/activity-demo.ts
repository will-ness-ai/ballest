// `pnpm activity:demo`: the Activity's page and API on http://localhost:8740, over the real
// engine but the tests' fake Steam, an in-memory database and no Discord. Sign in as any of
// the demo members (alice has not linked Steam yet; paste https://steamcommunity.com/id/alice).
// Open a second tab with `?as=d-bob` to play the other side. Once a Match is live, fake racers
// set times on its Map every few seconds, which the engine picks up on its 10-second poll.
import { NodeRuntime } from "@effect/platform-node"
import { ConfigProvider, Context, Effect, Layer, Option, Schedule } from "effect"
import { AuthFailed, DiscordAuth, DiscordMembers } from "../src/activity/auth.js"
import { activityServer } from "../src/activity/server.js"
import { seconds as tickSeconds } from "../src/domain.js"
import { Engine } from "../src/engine.js"
import { MatchLinks, Store, Steam, Surface } from "../src/ports.js"
import { MapPreviews, PreviewSource, PreviewUnavailable } from "../src/previews.js"
import { SqliteStoreInMemory } from "../src/sqliteStore.js"
import { BOB, CARA, DAN, makeFakeSteam, makeMap, PROFILES } from "../test/harness.js"

const MAPS = [
  makeMap(1, { title: "Pebble Ramp", creator: "pebblewright" }),
  makeMap(2, { title: "Spiral Sprint", creator: "marblequeen" }),
  makeMap(3, { title: "Nine Loops", creator: "rollo" })
]

const USERS = [
  { id: "d-alice", name: "alice (not linked)" },
  { id: BOB.discordId, name: "bob" },
  { id: CARA.discordId, name: "cara" },
  { id: DAN.discordId, name: "dan" }
]

/** Tokens are `dev-<discord id>`; codes don't exist outside Discord. */
const DevAuth = Layer.succeed(
  DiscordAuth,
  DiscordAuth.of({
    exchange: () => Effect.fail(new AuthFailed({ reason: "no Discord in the demo" })),
    userOf: (token) =>
      token.startsWith("dev-") && USERS.some((u) => `dev-${u.id}` === token)
        ? Effect.succeed(token.slice(4))
        : Effect.fail(new AuthFailed({ reason: "unknown demo token" }))
  })
)

/** Everyone in the demo is in the server, named as in USERS without the note. */
const DemoMembers = Layer.succeed(
  DiscordMembers,
  DiscordMembers.of({
    nameOf: (id) => Effect.succeed(Option.fromNullable(USERS.find((u) => u.id === id)?.name.replace(/ \(.*\)$/, "")))
  })
)

/** There is no channel, so no Card or Match Thread to link to. */
const NoLinks = Layer.succeed(MatchLinks, MatchLinks.of({ of: () => Effect.succeed(Option.none()) }))

/** The demo's Maps have no Workshop art: every tile draws the stand-in. */
const NoPreviews = MapPreviews.Default.pipe(
  Layer.provide(Layer.succeed(PreviewSource, PreviewSource.of({ fetch: () => Effect.fail(new PreviewUnavailable({ reason: "no previews in the demo" })) })))
)

/** The channel isn't here; say what would have been posted. */
const LogSurface = Layer.succeed(
  Surface,
  Surface.of({
    showCard: (v) => Effect.log(`card ${v.matchId}: ${v.state}`),
    post: (id, p) => Effect.log(`thread ${id}: ${p._tag}`),
    remove: (id, reason) => Effect.log(`removed ${id}: ${reason}`)
  })
)

const Demo = Layer.unwrapScoped(
  Effect.gen(function* () {
    const store = Context.get(yield* Layer.build(SqliteStoreInMemory), Store)
    for (const p of [BOB, CARA, DAN]) yield* store.putLink({ ...p, personaName: p.discordId.slice(2) })
    const steam = yield* makeFakeSteam(PROFILES)
    yield* steam.control.setCatalogue(MAPS)
    const ports = Layer.mergeAll(Layer.succeed(Store, store), Layer.succeed(Steam, steam.port), LogSurface, NoLinks, NoPreviews)

    // The racers: each live Player sometimes finishes a run, usually a little faster than before.
    const race = Effect.gen(function* () {
      for (const m of yield* store.activeMatches) {
        if (m.state !== "live" || m.map === null) continue
        for (const p of m.players) {
          if (Math.random() > 0.35) continue
          const best = m.bestTicks[p.steamId]
          const next = best === undefined ? 30 + Math.random() * 12 : Math.max(15.2, tickSeconds(best) - Math.random() * 3)
          yield* steam.control.setTime(m.map.boardId, p.steamId, next)
        }
      }
    }).pipe(Effect.repeat(Schedule.spaced("4 seconds")), Effect.forkScoped)
    yield* race

    return activityServer({ clientId: "demo", guildId: "demo", channelId: "demo", devUsers: USERS }).pipe(
      Layer.provide(Engine.Default),
      Layer.provide(ports),
      Layer.provide(DevAuth),
      Layer.provide(DemoMembers)
    )
  })
)

Layer.launch(Demo).pipe(
  Effect.withConfigProvider(
    // One Player is enough to start a Lobby here, so a single tab can try the whole flow.
    ConfigProvider.fromMap(new Map([["PORT", "8740"], ["LOBBY_MIN_PLAYERS", "1"]]))
  ),
  NodeRuntime.runMain
)
