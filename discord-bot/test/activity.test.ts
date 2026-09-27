// The Activity's HTTP API, driven with real Requests over the same engine, fakes and TestClock
// as the engine tests. Discord is faked too: OAuth knows a few codes and access tokens, the
// server knows its members' display names, and the channel knows where each Match's Card is.
import { HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { makeActivityApi } from "../src/activity/api.js"
import { AuthFailed, DiscordAuth, DiscordMembers } from "../src/activity/auth.js"
import { Engine } from "../src/engine.js"
import { MatchLinks, Store } from "../src/ports.js"
import { ALICE, advance, BOB, CARA, DAN, makeHarness, makeMap, ticks, UNLINKED } from "./harness.js"

/** Signed in with Discord, but not a member of the server. */
const OUTSIDER = "d-outsider"

/** Each member's name in the server; their Steam names are the lower-case ones the harness links. */
const MEMBERS: Record<string, string> = {
  [ALICE.discordId]: "Alice",
  [BOB.discordId]: "Bob",
  [CARA.discordId]: "Cara",
  [DAN.discordId]: "Dan",
  [UNLINKED]: "Nobody"
}

const WHERE = { guildId: "g1", channelId: "c1" }

const setup = (opts: Parameters<typeof makeHarness>[0]) =>
  Effect.gen(function* () {
    const h = yield* makeHarness(opts)
    /** Tokens Discord has since revoked. */
    const revoked = new Set<string>()
    const auth = DiscordAuth.of({
      exchange: (code) =>
        code.startsWith("code-") ? Effect.succeed(`token-${code.slice(5)}`) : Effect.fail(new AuthFailed({ reason: "bad code" })),
      userOf: (token) =>
        token.startsWith("token-") && !revoked.has(token)
          ? Effect.succeed(token.slice(6))
          : Effect.fail(new AuthFailed({ reason: "bad token" }))
    })
    const members = DiscordMembers.of({ nameOf: (discordId) => Effect.succeed(Option.fromNullable(MEMBERS[discordId])) })
    /** Every Match's Card is message `msg-<id>`, and its thread `thread-<id>`. */
    const links = MatchLinks.of({ of: (matchId) => Effect.succeed(Option.some({ messageId: `msg-${matchId}`, threadId: `thread-${matchId}` })) })
    const app = yield* makeActivityApi(WHERE).pipe(
      Effect.provideService(Engine, h.engine),
      Effect.provideService(Store, h.store),
      Effect.provideService(DiscordAuth, auth),
      Effect.provideService(DiscordMembers, members),
      Effect.provideService(MatchLinks, links)
    )
    /** One request as `as` (a Discord id) or with a raw `token`, answered with its status and JSON body. */
    const call = (method: string, path: string, opts: { readonly as?: string; readonly token?: string; readonly body?: unknown } = {}) =>
      Effect.gen(function* () {
        const headers: Record<string, string> = { "content-type": "application/json" }
        const token = opts.token ?? (opts.as === undefined ? undefined : `token-${opts.as}`)
        if (token !== undefined) headers["authorization"] = `Bearer ${token}`
        const init: RequestInit = { method, headers }
        if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
        const request = new Request(`http://activity.test${path}`, init)
        const response = yield* app.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request))
        )
        const web = HttpServerResponse.toWeb(response)
        const text = yield* Effect.promise(() => web.text())
        return { status: web.status, body: text === "" ? null : (JSON.parse(text) as any) }
      })
    /** Open an Invite as `by`; its id. */
    const open = (by: string, body: unknown) => call("POST", "/api/matches", { as: by, body }).pipe(Effect.map((r) => r.body.matchId as string))
    return { h, call, open, revoked }
  })

/** The Players on a view's board, by name. */
const namesOn = (match: any): ReadonlyArray<string> => match.standings.map((s: any) => match.names[s.player.discordId])

const MAP = makeMap(1)
const ALICE_PROFILE = "https://steamcommunity.com/id/alice"
const lobby = { type: "lobby", minutes: 5 } as const

describe("signing in", () => {
  it.scoped("swaps Discord's OAuth code for an access token", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP] })
      expect(yield* call("POST", "/api/token", { body: { code: "code-d-alice" } })).toEqual({
        status: 200,
        body: { access_token: "token-d-alice" }
      })
    })
  )

  it.scoped("refuses a request without a valid access token", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP] })
      expect((yield* call("GET", "/api/me")).status).toBe(401)
      expect((yield* call("GET", "/api/me", { token: "stolen" })).status).toBe(401)
    })
  )

  it.scoped("refuses someone who isn't in the server", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP] })
      expect(yield* call("GET", "/api/me", { as: OUTSIDER })).toEqual({
        status: 403,
        body: { error: "NotMember", message: "Multiballs only runs in the Ballest server. Open it from a channel there." }
      })
      expect((yield* call("GET", "/api/matches", { as: OUTSIDER })).status).toBe(403)
    })
  )

  it.scoped("asks Discord about a token again once it has been a while", () =>
    Effect.gen(function* () {
      const { call, revoked } = yield* setup({ maps: [MAP] })
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).status).toBe(200)
      revoked.add(`token-${ALICE.discordId}`)
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).status).toBe(200)
      yield* advance("11 minutes")
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).status).toBe(401)
    })
  )

  it.scoped("tells a member whether they have linked Steam", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP] })
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).body).toEqual({
        discordId: ALICE.discordId,
        link: { steamId: ALICE.steamId, personaName: "alice" },
        matchId: null
      })
      expect((yield* call("GET", "/api/me", { as: UNLINKED })).body).toEqual({ discordId: UNLINKED, link: null, matchId: null })
    })
  )
})

describe("linking Steam", () => {
  it.scoped("previews the pasted profile, then links it when the member confirms", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP], linked: false })
      const preview = yield* call("POST", "/api/link/preview", { as: ALICE.discordId, body: { profile: ALICE_PROFILE } })
      expect(preview).toMatchObject({ status: 200, body: { steamId: ALICE.steamId, personaName: "alice", campaignTracks: 21 } })
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).body.link).toBeNull()
      expect(yield* call("POST", "/api/link/confirm", { as: ALICE.discordId })).toEqual({
        status: 200,
        body: { steamId: ALICE.steamId, personaName: "alice" }
      })
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).body.link).toEqual({ steamId: ALICE.steamId, personaName: "alice" })
    })
  )

  it.scoped("says so when the profile can't be found", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP], linked: false })
      expect(yield* call("POST", "/api/link/preview", { as: ALICE.discordId, body: { profile: "not-a-profile" } })).toEqual({
        status: 404,
        body: { error: "ProfileNotFound", message: "no such profile" }
      })
    })
  )

  it.scoped("only confirms a profile this member previewed", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP], linked: false })
      yield* call("POST", "/api/link/preview", { as: ALICE.discordId, body: { profile: ALICE_PROFILE } })
      expect(yield* call("POST", "/api/link/confirm", { as: BOB.discordId })).toMatchObject({
        status: 409,
        body: { error: "NoPreview" }
      })
      expect((yield* call("GET", "/api/me", { as: BOB.discordId })).body.link).toBeNull()
    })
  )

  it.scoped("won't change a Link while its Player is in a Match", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      yield* open(ALICE.discordId, lobby)
      yield* call("POST", "/api/link/preview", { as: ALICE.discordId, body: { profile: ALICE_PROFILE } })
      expect(yield* call("POST", "/api/link/confirm", { as: ALICE.discordId })).toEqual({
        status: 409,
        body: { error: "Busy", message: "You're already in an open Invite or a live Match." }
      })
    })
  )
})

describe("the Challenge picker", () => {
  it.scoped("lists every other linked member by Discord and Steam name, marking who is busy", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      yield* open(CARA.discordId, lobby)
      expect(yield* call("GET", "/api/players", { as: ALICE.discordId })).toEqual({
        status: 200,
        body: {
          players: [
            { discordId: BOB.discordId, steamId: BOB.steamId, name: "Bob", steamName: "bob", busy: false },
            { discordId: CARA.discordId, steamId: CARA.steamId, name: "Cara", steamName: "cara", busy: true },
            { discordId: DAN.discordId, steamId: DAN.steamId, name: "Dan", steamName: "dan", busy: false }
          ]
        }
      })
    })
  )
})

describe("opening a Match", () => {
  it.scoped("opens an Invite that every member sees, with the Map still sealed", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).body.matchId).toBe(matchId)
      expect((yield* call("GET", "/api/matches", { as: BOB.discordId })).body).toEqual({
        now: 0,
        matches: [
          {
            matchId,
            state: "invite",
            type: "lobby",
            minutes: 5,
            creator: ALICE,
            target: null,
            players: [ALICE],
            expiresAt: 5 * 60_000,
            endsAt: null,
            map: null,
            standings: [{ player: ALICE, ticks: null, rank: null, medal: null }],
            names: { [ALICE.discordId]: "Alice" },
            history: [],
            links: { card: `https://discord.com/channels/g1/c1/msg-${matchId}`, thread: `https://discord.com/channels/g1/thread-${matchId}` },
            actions: ["join"]
          }
        ]
      })
    })
  )

  it.scoped("names a Challenge's opponent before they answer", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, { type: "challenge", minutes: 10, target: BOB.discordId })
      const match = (yield* call("GET", `/api/matches/${matchId}`, { as: CARA.discordId })).body.match
      expect(match.target).toEqual(BOB)
      expect(match.names[BOB.discordId]).toBe("Bob")
    })
  )

  it.scoped("turns down a member who hasn't linked Steam, in words", () =>
    Effect.gen(function* () {
      const { call } = yield* setup({ maps: [MAP] })
      expect(yield* call("POST", "/api/matches", { as: UNLINKED, body: lobby })).toEqual({
        status: 403,
        body: { error: "NotLinked", message: "Link your Steam account first." }
      })
    })
  )

  it.scoped("names another member by their name in the server when they're the reason", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      yield* open(BOB.discordId, lobby)
      expect(yield* call("POST", "/api/matches", { as: ALICE.discordId, body: { type: "challenge", minutes: 10, target: BOB.discordId } })).toEqual({
        status: 409,
        body: { error: "Busy", message: "Bob is already in an open Invite or a live Match." }
      })
    })
  )
})

describe("joining and starting", () => {
  it.scoped("a Lobby fills with Join, and its creator's Start draws the Map and starts the clock", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      const joined = yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
      expect(joined.status).toBe(200)
      expect(namesOn(joined.body.match)).toEqual(["Alice", "Bob"])
      expect((yield* call("POST", `/api/matches/${matchId}/start`, { as: ALICE.discordId })).status).toBe(200)
      const live = (yield* call("GET", `/api/matches/${matchId}`, { as: CARA.discordId })).body.match
      expect(live).toMatchObject({ state: "live", expiresAt: null, endsAt: 5 * 60_000, map: { title: "Map 1", pfid: "pf1" } })
    })
  )

  it.scoped("only the Lobby's creator can start it", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
      expect(yield* call("POST", `/api/matches/${matchId}/start`, { as: BOB.discordId })).toEqual({
        status: 403,
        body: { error: "NotAllowed", message: "Only the Lobby's creator can start it." }
      })
    })
  )

  it.scoped("a Player who joined a Lobby can leave it before the start", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
      const left = yield* call("POST", `/api/matches/${matchId}/leave`, { as: BOB.discordId })
      expect(namesOn(left.body.match)).toEqual(["Alice"])
      expect((yield* call("GET", "/api/me", { as: BOB.discordId })).body.matchId).toBeNull()
    })
  )

  it.scoped("a Public 1v1 starts on the first Accept", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, { type: "public", minutes: 10 })
      const accepted = yield* call("POST", `/api/matches/${matchId}/accept`, { as: BOB.discordId })
      expect(accepted.body.match).toMatchObject({ state: "live", endsAt: 10 * 60_000 })
    })
  )

  it.scoped("a Challenge can be declined only by the Player it names, and then it's gone", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, { type: "challenge", minutes: 10, target: BOB.discordId })
      expect(yield* call("POST", `/api/matches/${matchId}/decline`, { as: CARA.discordId })).toEqual({
        status: 403,
        body: { error: "NotAllowed", message: "Only the challenged Player can decline." }
      })
      expect(yield* call("POST", `/api/matches/${matchId}/decline`, { as: BOB.discordId })).toMatchObject({ status: 200, body: { match: null } })
      expect((yield* call("GET", "/api/me", { as: ALICE.discordId })).body.matchId).toBeNull()
    })
  )

  it.scoped("says why when no Map fits the length", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [makeMap(1, { worldRecordTicks: ticks(400) })] })
      const matchId = yield* open(ALICE.discordId, { type: "public", minutes: 10 })
      expect(yield* call("POST", `/api/matches/${matchId}/accept`, { as: BOB.discordId })).toEqual({
        status: 409,
        body: { error: "NoEligibleMap", message: "No Map suits this length. The Invite is closed; a longer Match allows more Maps." }
      })
      expect((yield* call("GET", `/api/matches/${matchId}`, { as: ALICE.discordId })).status).toBe(404)
    })
  )

  it.scoped("a cancelled Invite is gone", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      expect(yield* call("POST", `/api/matches/${matchId}/cancel`, { as: ALICE.discordId })).toMatchObject({ status: 200, body: { match: null } })
      expect((yield* call("GET", `/api/matches/${matchId}`, { as: ALICE.discordId })).status).toBe(404)
      expect((yield* call("POST", `/api/matches/${matchId}/dance`, { as: ALICE.discordId })).status).toBe(404)
    })
  )
})

describe("each member's buttons", () => {
  /** What each member is offered on a Match. */
  const offers = (call: (method: string, path: string, opts: { as: string }) => Effect.Effect<{ body: any }>, matchId: string) =>
    Effect.forEach([ALICE, BOB, CARA, DAN], (p) =>
      call("GET", `/api/matches/${matchId}`, { as: p.discordId }).pipe(Effect.map((r) => r.body.match.actions))
    )

  it.scoped("on a Lobby: its creator starts or cancels, a Player in it leaves, anyone else joins, late too", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
      expect(yield* offers(call, matchId)).toEqual([["start", "cancel"], ["leave"], ["join"], ["join"]])
      yield* call("POST", `/api/matches/${matchId}/start`, { as: ALICE.discordId })
      yield* call("POST", `/api/matches/${matchId}/leave`, { as: BOB.discordId })
      expect(yield* offers(call, matchId)).toEqual([["leave"], [], ["join"], ["join"]])
    })
  )

  it.scoped("on a Challenge: only the Player it names answers, and nobody joins it once live", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, { type: "challenge", minutes: 10, target: BOB.discordId })
      expect(yield* offers(call, matchId)).toEqual([["cancel"], ["accept", "decline"], [], []])
      yield* call("POST", `/api/matches/${matchId}/accept`, { as: BOB.discordId })
      expect(yield* offers(call, matchId)).toEqual([["leave"], ["leave"], [], []])
    })
  )

  it.scoped("on a Public 1v1: anyone but its creator accepts; nothing once it's over", () =>
    Effect.gen(function* () {
      const { call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, { type: "public", minutes: 5 })
      expect(yield* offers(call, matchId)).toEqual([["cancel"], ["accept"], ["accept"], ["accept"]])
      yield* call("POST", `/api/matches/${matchId}/accept`, { as: CARA.discordId })
      yield* advance("6 minutes")
      expect(yield* offers(call, matchId)).toEqual([[], [], [], []])
    })
  )
})

describe("a live Lobby", () => {
  const liveLobby = Effect.gen(function* () {
    const s = yield* setup({ maps: [MAP] })
    const matchId = yield* s.open(ALICE.discordId, lobby)
    yield* s.call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
    yield* s.call("POST", `/api/matches/${matchId}/start`, { as: ALICE.discordId })
    return { ...s, matchId }
  })

  it.scoped("tells a member their PB on its Map before they join late", () =>
    Effect.gen(function* () {
      const { h, call, matchId } = yield* liveLobby
      expect(yield* call("GET", `/api/matches/${matchId}/pb`, { as: CARA.discordId })).toEqual({ status: 200, body: { ticks: null } })
      yield* h.steam.setTime(1, CARA.steamId, 21.884)
      expect(yield* call("GET", `/api/matches/${matchId}/pb`, { as: CARA.discordId })).toEqual({ status: 200, body: { ticks: ticks(21.884) } })
    })
  )

  it.scoped("says so when Steam can't read that PB", () =>
    Effect.gen(function* () {
      const { h, call, matchId } = yield* liveLobby
      yield* h.steam.failNextReads(3)
      expect(yield* call("GET", `/api/matches/${matchId}/pb`, { as: CARA.discordId })).toEqual({
        status: 503,
        body: { error: "SteamUnavailable", message: "Steam didn't answer. Try again in a moment." }
      })
    })
  )

  it.scoped("takes a late join, with the joiner's PB as the time to beat", () =>
    Effect.gen(function* () {
      const { h, call, matchId } = yield* liveLobby
      yield* h.steam.setTime(1, CARA.steamId, 21.884)
      const joined = yield* call("POST", `/api/matches/${matchId}/join`, { as: CARA.discordId })
      expect(joined.status).toBe(200)
      expect(joined.body.match.map.personalBests).toEqual({ [CARA.steamId]: ticks(21.884) })
      expect((yield* call("GET", "/api/me", { as: CARA.discordId })).body.matchId).toBe(matchId)
    })
  )

  it.scoped("lets a Player leave, after which it's no longer their Match", () =>
    Effect.gen(function* () {
      const { call, matchId } = yield* liveLobby
      expect((yield* call("POST", `/api/matches/${matchId}/leave`, { as: BOB.discordId })).status).toBe(200)
      expect((yield* call("GET", "/api/me", { as: BOB.discordId })).body.matchId).toBeNull()
      expect(yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })).toEqual({
        status: 403,
        body: { error: "NotAllowed", message: "You left this Match, so you can't rejoin it." }
      })
    })
  )
})

describe("standings", () => {
  it.scoped("rank each Player's best time as Steam reports it, and stay readable after the Result", () =>
    Effect.gen(function* () {
      const { h, call, open } = yield* setup({ maps: [MAP] })
      const matchId = yield* open(ALICE.discordId, lobby)
      yield* call("POST", `/api/matches/${matchId}/join`, { as: BOB.discordId })
      yield* call("POST", `/api/matches/${matchId}/join`, { as: CARA.discordId })
      yield* call("POST", `/api/matches/${matchId}/start`, { as: ALICE.discordId })

      yield* h.steam.setTime(1, BOB.steamId, 22)
      yield* h.steam.setTime(1, ALICE.steamId, 31)
      yield* advance("10 seconds")
      const live = (yield* call("GET", `/api/matches/${matchId}`, { as: DAN.discordId })).body
      expect(live.now).toBe(10_000)
      expect(live.match.standings).toEqual([
        { player: BOB, ticks: ticks(22), rank: 1, medal: "gold" },
        { player: ALICE, ticks: ticks(31), rank: 2, medal: "bronze" },
        { player: CARA, ticks: null, rank: null, medal: null }
      ])
      expect(namesOn(live.match)).toEqual(["Bob", "Alice", "Cara"])
      expect(live.match.history).toEqual([
        { steamId: ALICE.steamId, ticks: ticks(31), at: 10_000 },
        { steamId: BOB.steamId, ticks: ticks(22), at: 10_000 }
      ])

      yield* h.steam.setTime(1, ALICE.steamId, 19)
      yield* advance("5 minutes")
      const done = (yield* call("GET", `/api/matches/${matchId}`, { as: DAN.discordId })).body.match
      expect(done.state).toBe("finished")
      expect(done.standings.map((s: any) => [done.names[s.player.discordId], s.rank])).toEqual([
        ["Alice", 1],
        ["Bob", 2],
        ["Cara", null]
      ])
      expect((yield* call("GET", "/api/matches", { as: DAN.discordId })).body.matches).toEqual([])
    })
  )
})
