import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Option } from "effect"
import type { Match } from "../src/domain.js"
import { ThreadPost } from "../src/ports.js"
import { ALICE, advance, BOB, CARA, DAN, makeHarness, makeMap, PROFILES, ticks, UNLINKED } from "./harness.js"

const MAP = makeMap(1)
const tags = (posts: ReadonlyArray<ThreadPost>) => posts.map((p) => p._tag)
const improvements = (posts: ReadonlyArray<ThreadPost>) =>
  posts.flatMap((p) => (p._tag === "Improved" ? [p.improvement] : []))
const public1v1 = { type: "public", minutes: 5, target: null } as const

describe("linking", () => {
  it.scoped("previews the pasted profile, then links it on confirm", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP], linked: false })
      const preview = yield* h.engine.previewLink("https://steamcommunity.com/id/alice")
      expect(preview.campaignTracks).toBe(21)
      expect(Option.isNone(yield* h.store.getLink(ALICE.discordId))).toBe(true)
      yield* h.engine.confirmLink(ALICE.discordId, preview)
      expect(Option.getOrThrow(yield* h.store.getLink(ALICE.discordId)).steamId).toBe(ALICE.steamId)
    })
  )

  it.scoped("rejects a profile that can't be found", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP], linked: false })
      const err = yield* Effect.flip(h.engine.previewLink("not-a-profile"))
      expect(err._tag).toBe("ProfileNotFound")
    })
  )

  it.scoped("won't re-link a Player mid-Match", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      yield* h.engine.openInvite(ALICE.discordId, public1v1)
      const preview = PROFILES["https://steamcommunity.com/id/alice"]!
      expect((yield* Effect.flip(h.engine.confirmLink(ALICE.discordId, preview)))._tag).toBe("Busy")
    })
  )
})

describe("opening an Invite", () => {
  it.scoped("needs a Link", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      expect(yield* Effect.flip(h.engine.openInvite(UNLINKED, public1v1))).toMatchObject({ _tag: "NotLinked" })
    })
  )

  it.scoped("shows an Invite Card with its expiry and posts Opened", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      const card = Option.getOrThrow(yield* h.surface.card(id))
      expect(card).toMatchObject({ state: "invite", map: null, expiresAt: 5 * 60_000, endsAt: null })
      expect(tags(yield* h.surface.posts(id))).toEqual(["Opened"])
    })
  )

  it.scoped("allows one open Invite or live Match per Player", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      expect((yield* Effect.flip(h.engine.openInvite(ALICE.discordId, public1v1)))._tag).toBe("Busy")
      yield* h.engine.accept(BOB.discordId, id)
      expect((yield* Effect.flip(h.engine.openInvite(BOB.discordId, public1v1)))._tag).toBe("Busy")
    })
  )
})

describe("Public 1v1", () => {
  it.scoped("starts on the first Accept with a drawn Map and a live clock", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* advance("1 minute")
      yield* h.engine.accept(BOB.discordId, id)
      const card = Option.getOrThrow(yield* h.surface.card(id))
      expect(card).toMatchObject({ state: "live", expiresAt: null, endsAt: 6 * 60_000 })
      expect(card.map?.boardId).toBe(1)
      expect(tags(yield* h.surface.posts(id))).toEqual(["Opened", "Accepted", "Started"])
      // The start ping shows the live Card itself
      const started = (yield* h.surface.posts(id)).at(-1)
      if (started?._tag !== "Started") return expect.unreachable()
      expect(started.card).toEqual(card)
    })
  )

  it.scoped("is closed to everyone else while its Map is being drawn", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.steam.setReadDelay("150 millis")
      const accepting = yield* Effect.fork(h.engine.accept(BOB.discordId, id))
      yield* Effect.yieldNow()
      // the engine isn't blocked while Steam is read: other actions answer at once
      expect((yield* Effect.flip(h.engine.accept(CARA.discordId, id)))._tag).toBe("NotOpen")
      expect((yield* Effect.flip(h.engine.cancel(ALICE.discordId, id)))._tag).toBe("NotOpen")
      expect((yield* Effect.flip(h.engine.openInvite(BOB.discordId, public1v1)))._tag).toBe("Busy")
      yield* advance("150 millis")
      yield* Fiber.join(accepting)
      expect(Option.getOrThrow(yield* h.surface.card(id)).state).toBe("live")
    })
  )

  it.scoped("can't be accepted by its creator, or twice", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      expect((yield* Effect.flip(h.engine.accept(ALICE.discordId, id)))._tag).toBe("NotAllowed")
      yield* h.engine.accept(BOB.discordId, id)
      expect((yield* Effect.flip(h.engine.accept(CARA.discordId, id)))._tag).toBe("NotOpen")
    })
  )
})

describe("Challenge", () => {
  const challenge = (opponent: string | null) => ({ type: "challenge", minutes: 5, target: opponent }) as const

  it.scoped("needs a linked opponent other than yourself", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      expect((yield* Effect.flip(h.engine.openInvite(ALICE.discordId, challenge(null))))._tag).toBe("NotAllowed")
      expect((yield* Effect.flip(h.engine.openInvite(ALICE.discordId, challenge(ALICE.discordId))))._tag).toBe("NotAllowed")
      expect(yield* Effect.flip(h.engine.openInvite(ALICE.discordId, challenge(UNLINKED)))).toMatchObject({
        _tag: "NotLinked",
        discordId: UNLINKED
      })
    })
  )

  it.scoped("pings the challenged Player, who alone can accept", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, challenge(BOB.discordId))
      expect(tags(yield* h.surface.posts(id))).toEqual(["Opened", "Challenged"])
      // The ping says how long the Match is and when the answer is due
      const ping = (yield* h.surface.posts(id)).at(-1)
      if (ping?._tag !== "Challenged") return expect.unreachable()
      expect(ping).toMatchObject({ minutes: challenge(BOB.discordId).minutes, expiresAt: Option.getOrThrow(yield* h.surface.card(id)).expiresAt })
      expect((yield* Effect.flip(h.engine.accept(CARA.discordId, id)))._tag).toBe("NotAllowed")
      yield* h.engine.accept(BOB.discordId, id)
      expect(Option.getOrThrow(yield* h.surface.card(id)).state).toBe("live")
    })
  )

  it.scoped("keeps the challenged Player busy until they answer", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      yield* h.engine.openInvite(ALICE.discordId, challenge(BOB.discordId))
      expect((yield* Effect.flip(h.engine.openInvite(BOB.discordId, public1v1)))._tag).toBe("Busy")
      expect((yield* Effect.flip(h.engine.openInvite(CARA.discordId, challenge(BOB.discordId))))._tag).toBe("Busy")
    })
  )

  it.scoped("disappears when declined", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, challenge(BOB.discordId))
      expect((yield* Effect.flip(h.engine.decline(CARA.discordId, id)))._tag).toBe("NotAllowed")
      yield* h.engine.decline(BOB.discordId, id)
      expect(yield* h.surface.removed(id)).toEqual(Option.some("declined"))
      expect(Option.isNone(yield* h.store.getMatch(id))).toBe(true)
    })
  )
})

describe("Lobby", () => {
  const lobby = { type: "lobby", minutes: 5, target: null } as const

  it.scoped("takes joins and leaves, and starts only by its creator", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, lobby)
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.join(CARA.discordId, id)
      yield* h.engine.leave(CARA.discordId, id)
      expect((yield* Effect.flip(h.engine.accept(DAN.discordId, id)))._tag).toBe("NotAllowed")
      expect((yield* Effect.flip(h.engine.leave(ALICE.discordId, id)))._tag).toBe("NotAllowed")
      expect((yield* Effect.flip(h.engine.start(BOB.discordId, id)))._tag).toBe("NotAllowed")
      yield* h.engine.start(ALICE.discordId, id)
      const card = Option.getOrThrow(yield* h.surface.card(id))
      expect(card.players.map((p) => p.discordId)).toEqual([ALICE.discordId, BOB.discordId])
      expect(tags(yield* h.surface.posts(id))).toEqual(["Opened", "Joined", "Joined", "Left", "Started"])
    })
  )

  it.scoped("takes joins while live, with a joiner's PB on the Map as their bar", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, lobby)
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.setTime(1, CARA.steamId, 20) // held before she joined
      yield* h.engine.join(CARA.discordId, id)
      expect((yield* Effect.flip(h.engine.join(CARA.discordId, id)))._tag).toBe("NotAllowed")
      const card = Option.getOrThrow(yield* h.surface.card(id))
      expect(card.state).toBe("live")
      expect(card.players.map((p) => p.discordId)).toEqual([ALICE.discordId, BOB.discordId, CARA.discordId])
      const posts = yield* h.surface.posts(id)
      expect(tags(posts).slice(-3)).toEqual(["Joined", "Started", "PlayedBefore"])
      const ping = posts.at(-2)
      if (ping?._tag !== "Started") return expect.unreachable()
      expect(ping.players).toEqual([CARA]) // only the joiner is pinged, with the Map
      expect(ping.map.boardId).toBe(1)
      expect(posts.at(-1)).toEqual(ThreadPost.PlayedBefore({ bars: [{ player: CARA, ticks: ticks(20) }] }))
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toHaveLength(0)
      yield* h.steam.setTime(1, CARA.steamId, 19)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id)).map((i) => [i.player.discordId, i.previousTicks])).toEqual([
        [CARA.discordId, ticks(20)]
      ])
      yield* advance("5 minutes")
      expect((yield* Effect.flip(h.engine.join(DAN.discordId, id)))._tag).toBe("NotOpen")
    })
  )

  it.scoped("turns a late join down when Steam can't read the joiner's PB", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, lobby)
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.failNextReads(3)
      expect((yield* Effect.flip(h.engine.join(CARA.discordId, id)))._tag).toBe("SteamUnavailable")
      expect(Option.getOrThrow(yield* h.surface.card(id)).players).toHaveLength(2)
    })
  )

  it.scoped("checks a late joiner again after the PB read", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, lobby)
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.setReadDelay("150 millis")
      const joining = yield* Effect.fork(h.engine.join(CARA.discordId, id))
      yield* Effect.yieldNow()
      // Cara opens an Invite of her own while her PB is being read
      yield* h.engine.openInvite(CARA.discordId, public1v1)
      yield* advance("150 millis")
      expect((yield* Effect.flip(Fiber.join(joining)))._tag).toBe("Busy")
      expect(Option.getOrThrow(yield* h.surface.card(id)).players).toHaveLength(2)
    })
  )

  it.scoped("a 1v1 can't be joined once live", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect((yield* Effect.flip(h.engine.join(CARA.discordId, id)))._tag).toBe("NotAllowed")
    })
  )
})

describe("Invite lifetime", () => {
  it.scoped("expires five minutes after it opens", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* advance("4 minutes")
      expect(Option.isNone(yield* h.surface.removed(id))).toBe(true)
      yield* advance("1 minute")
      expect(yield* h.surface.removed(id)).toEqual(Option.some("expired"))
      expect((yield* Effect.flip(h.engine.accept(BOB.discordId, id)))._tag).toBe("MatchNotFound")
    })
  )

  it.scoped("can be cancelled only by its creator", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      expect((yield* Effect.flip(h.engine.cancel(BOB.discordId, id)))._tag).toBe("NotAllowed")
      yield* h.engine.cancel(ALICE.discordId, id)
      expect(yield* h.surface.removed(id)).toEqual(Option.some("cancelled"))
      // the expiry timer died with it: nothing else happens at 5 minutes
      yield* advance("10 minutes")
      expect((yield* h.surface.all).filter((e) => e._tag === "Removed")).toHaveLength(1)
    })
  )
})

describe("Eligible Map", () => {
  it.scoped("skips Maps any Player already holds a time on", () =>
    Effect.gen(function* () {
      const played = makeMap(2)
      const h = yield* makeHarness({ maps: [played, MAP] })
      yield* h.steam.setTime(2, BOB.steamId, 30)
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect(Option.getOrThrow(yield* h.surface.card(id)).map?.boardId).toBe(1)
    })
  )

  it.scoped("draws a Played Map when every candidate has been Played, and pings whoever must beat their PB", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [makeMap(2)] })
      yield* h.steam.setTime(2, BOB.steamId, 20)
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect(Option.getOrThrow(yield* h.surface.card(id)).map).toMatchObject({ boardId: 2, personalBests: { [BOB.steamId]: ticks(20) } })
      const posts = yield* h.surface.posts(id)
      expect(tags(posts).slice(-2)).toEqual(["Started", "PlayedBefore"])
      expect(posts.at(-1)).toEqual(ThreadPost.PlayedBefore({ bars: [{ player: BOB, ticks: ticks(20) }] }))
    })
  )

  it.scoped("counts a Player's run on a Played Map only once it beats their PB, and makes them DNF otherwise", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [makeMap(2)] })
      yield* h.steam.setTime(2, BOB.steamId, 20)
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      // Bob's board entry is still his old PB: it doesn't count
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toEqual([])
      yield* h.steam.setTime(2, ALICE.steamId, 25)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id)).map((i) => i.player)).toEqual([ALICE])
      yield* advance("5 minutes")
      const result = (yield* h.surface.posts(id)).findLast((p) => p._tag === "Result")
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings.map((s) => [s.player.discordId, s.rank])).toEqual([
        [ALICE.discordId, 1],
        [BOB.discordId, null]
      ])
    })
  )

  it.scoped("shows a run that beats the PB as an Improvement over it", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [makeMap(2)] })
      yield* h.steam.setTime(2, BOB.steamId, 20)
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* h.steam.setTime(2, BOB.steamId, 19)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toMatchObject([{ player: BOB, ticks: ticks(19), previousTicks: ticks(20), rank: 1 }])
    })
  )

  it.scoped("tries at most 60 Maps before settling on a Played one", () =>
    Effect.gen(function* () {
      const maps = Array.from({ length: 100 }, (_, i) => makeMap(100 + i))
      const h = yield* makeHarness({ maps })
      for (const map of maps) if (map.boardId !== null) yield* h.steam.setTime(map.boardId, BOB.steamId, 20)
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect(yield* h.steam.reads).toBe(60)
      expect(Option.getOrThrow(yield* h.surface.card(id)).state).toBe("live")
    })
  )

  it.scoped("reads only the boards it tries, not the whole Workshop", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: Array.from({ length: 50 }, (_, i) => makeMap(100 + i)) })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect(yield* h.steam.reads).toBe(1)
    })
  )

  it.scoped("counts a world record of exactly 5 s as fitting", () =>
    Effect.gen(function* () {
      const five = makeMap(6, { worldRecordTicks: ticks(5) })
      const h = yield* makeHarness({ maps: [five] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      expect(Option.getOrThrow(yield* h.surface.card(id)).map?.boardId).toBe(6)
    })
  )

  it.scoped("fits the world record (5 s to 5 min) and the author time (≤ a tenth of the duration)", () =>
    Effect.gen(function* () {
      const tooShort = makeMap(3, { worldRecordTicks: ticks(4) })
      const tooLong = makeMap(4, { worldRecordTicks: ticks(301) })
      const noBoard = makeMap(null)
      const slow = makeMap(5, { medals: { bronze: 150, silver: 130, gold: 110, author: 90 }, worldRecordTicks: ticks(60) })
      const h = yield* makeHarness({ maps: [tooShort, tooLong, noBoard, slow] })
      // 5 minutes allows an author time of 30 s at most: nothing fits
      const short = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      expect((yield* Effect.flip(h.engine.accept(BOB.discordId, short)))._tag).toBe("NoEligibleMap")
      expect(yield* h.surface.removed(short)).toEqual(Option.some("noEligibleMap"))
      // Both Players are told, not just the one who clicked
      expect((yield* h.surface.posts(short)).at(-1)).toEqual(ThreadPost.NoMap({ players: [ALICE, BOB] }))
      // 15 minutes allows 90 s: the slow Map fits
      const long = yield* h.engine.openInvite(ALICE.discordId, { ...public1v1, minutes: 15 })
      yield* h.engine.accept(BOB.discordId, long)
      expect(Option.getOrThrow(yield* h.surface.card(long)).map?.boardId).toBe(5)
    })
  )
})

describe("during the Match", () => {
  const live1v1 = Effect.gen(function* () {
    const h = yield* makeHarness({ maps: [MAP] })
    const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
    yield* h.engine.accept(BOB.discordId, id)
    return { h, id }
  })

  it.scoped("posts each Improvement within one poll, with rank, Medal and the gain over the last time", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.steam.setTime(1, BOB.steamId, 26)
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, ALICE.steamId, 24)
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 19.5)
      yield* advance("10 seconds")
      yield* advance("10 seconds") // nothing new: nothing posted
      expect(improvements(yield* h.surface.posts(id))).toEqual([
        { player: BOB, ticks: ticks(26), medal: "silver", rank: 1, previousTicks: null, previousRank: null, beatWorldRecord: null },
        { player: ALICE, ticks: ticks(24), medal: "gold", rank: 1, previousTicks: null, previousRank: null, beatWorldRecord: null },
        { player: BOB, ticks: ticks(19.5), medal: "author", rank: 1, previousTicks: ticks(26), previousRank: 2, beatWorldRecord: null }
      ])
      const card = Option.getOrThrow(yield* h.surface.card(id))
      expect(card.standings.map((s) => [s.player.discordId, s.rank])).toEqual([
        [BOB.discordId, 1],
        [ALICE.discordId, 2]
      ])
    })
  )

  it.scoped("ranks every Improvement in a poll against the whole poll", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.steam.setTime(1, ALICE.steamId, 30)
      yield* advance("10 seconds")
      // same poll: Alice drops to 20, Bob sets a first time of 25
      yield* h.steam.setTime(1, ALICE.steamId, 20)
      yield* h.steam.setTime(1, BOB.steamId, 25)
      yield* advance("10 seconds")
      const [, ...lastPoll] = improvements(yield* h.surface.posts(id))
      expect(lastPoll.map((i) => [i.player.discordId, i.rank, i.previousRank])).toEqual([
        [BOB.discordId, 2, null],
        [ALICE.discordId, 1, 1]
      ])
    })
  )

  it.scoped("rides out a failed Steam read and catches up on the next poll", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.steam.setTime(1, ALICE.steamId, 30)
      yield* h.steam.failNextReads(1)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toHaveLength(0)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toHaveLength(1)
    })
  )
})

describe("world records", () => {
  it.scoped("marks each PB that beats the WR as it stands, measured against the WR it beat", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] }) // WR 15 s at the start
      const id = yield* h.engine.openInvite(ALICE.discordId, { type: "lobby", minutes: 5, target: null })
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.setTime(1, ALICE.steamId, 16)
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, ALICE.steamId, 14.8)
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 14.9) // under the old WR, but not Alice's new one
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 14.5)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id)).map((i) => [i.player.discordId, i.beatWorldRecord])).toEqual([
        [ALICE.discordId, null],
        [ALICE.discordId, ticks(15)],
        [BOB.discordId, null],
        [BOB.discordId, ticks(14.8)]
      ])
    })
  )

  it.scoped("measures two breaks in one poll each against the WR it beat", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, { type: "lobby", minutes: 5, target: null })
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.setTime(1, ALICE.steamId, 14.9)
      yield* h.steam.setTime(1, BOB.steamId, 14.7)
      yield* advance("10 seconds")
      const byPlayer = Object.fromEntries(improvements(yield* h.surface.posts(id)).map((i) => [i.player.discordId, i.beatWorldRecord]))
      expect(byPlayer).toEqual({ [ALICE.discordId]: ticks(15), [BOB.discordId]: ticks(14.9) })
    })
  )
})

describe("the progression graph", () => {
  it.scoped("follows the Result with every PB of the Match and when it was set", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* h.steam.setTime(1, BOB.steamId, 22)
      yield* advance("30 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 20)
      yield* advance("5 minutes")
      const posts = yield* h.surface.posts(id)
      expect(tags(posts).slice(-2)).toEqual(["Result", "Progression"])
      const graph = posts.at(-1)
      if (graph?._tag !== "Progression") return expect.unreachable()
      expect(graph.history).toEqual([
        { steamId: BOB.steamId, ticks: ticks(22), at: 10_000 },
        { steamId: BOB.steamId, ticks: ticks(20), at: 40_000 }
      ])
      expect(graph.card.state).toBe("finished")
    })
  )

  it.scoped("isn't posted when nobody set a time", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* advance("5 minutes")
      expect(tags(yield* h.surface.posts(id)).at(-1)).toBe("Result")
    })
  )
})

describe("leaving a live Match", () => {
  const live1v1 = Effect.gen(function* () {
    const h = yield* makeHarness({ maps: [MAP] })
    const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
    yield* h.engine.accept(BOB.discordId, id)
    return { h, id }
  })

  it.scoped("counts a run finished just before leaving, and nothing after it", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* advance("10 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 24) // not polled yet
      yield* h.engine.leave(BOB.discordId, id)
      yield* h.steam.setTime(1, BOB.steamId, 18)
      yield* h.steam.setTime(1, ALICE.steamId, 26)
      yield* advance("5 minutes")
      const posts = yield* h.surface.posts(id)
      expect(tags(posts)).toContain("Left")
      const result = posts.find((p) => p._tag === "Result")
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings.map((s) => [s.player.discordId, s.ticks, s.rank])).toEqual([
        [BOB.discordId, ticks(24), 1],
        [ALICE.discordId, ticks(26), 2]
      ])
    })
  )

  it.scoped("ends the Match with its Result when the last Player leaves, if anyone set a time", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.steam.setTime(1, ALICE.steamId, 22)
      yield* h.engine.leave(ALICE.discordId, id)
      yield* h.engine.leave(BOB.discordId, id)
      expect(tags(yield* h.surface.posts(id)).slice(-3)).toEqual(["Left", "Result", "Progression"])
      expect(Option.getOrThrow(yield* h.surface.card(id)).state).toBe("finished")
      yield* advance("5 minutes") // the clock is stopped: no second Result
      expect(tags(yield* h.surface.posts(id)).filter((t) => t === "Result")).toHaveLength(1)
    })
  )

  it.scoped("cancels the Match when everyone leaves before anyone set a time", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.engine.leave(ALICE.discordId, id)
      yield* h.engine.leave(BOB.discordId, id)
      expect(tags(yield* h.surface.posts(id)).slice(-3)).toEqual(["Left", "Left", "Abandoned"])
      expect(yield* h.surface.removed(id)).toEqual(Option.some("abandoned"))
      expect(yield* h.store.activeMatches).toEqual([])
      yield* h.engine.openInvite(ALICE.discordId, public1v1) // free again
    })
  )

  it.scoped("only lets a Player still racing leave", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.engine.mayLeave(ALICE.discordId, id)
      yield* h.engine.leave(ALICE.discordId, id)
      expect((yield* Effect.flip(h.engine.mayLeave(ALICE.discordId, id)))._tag).toBe("NotAllowed") // no confirm to show
      const again = yield* Effect.flip(h.engine.leave(ALICE.discordId, id))
      const stranger = yield* Effect.flip(h.engine.leave(CARA.discordId, id))
      expect([again._tag, stranger._tag]).toEqual(["NotAllowed", "NotAllowed"])
      yield* h.engine.openInvite(ALICE.discordId, public1v1) // free to play again while Bob races on
    })
  )

  it.scoped("in a live Lobby, lets a late joiner leave, but not a leaver back in", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, { type: "lobby", minutes: 5, target: null })
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.engine.leave(BOB.discordId, id)
      const back = yield* Effect.flip(h.engine.join(BOB.discordId, id))
      expect(back._tag === "NotAllowed" && back.reason).toBe("You left this Match, so you can't rejoin it.")
      yield* h.engine.join(CARA.discordId, id)
      yield* h.engine.leave(CARA.discordId, id)
      expect(Option.getOrThrow(yield* h.store.getMatch(id)).state).toBe("live") // Alice races on
    })
  )

  it.scoped("stays open until Steam answers the leaving Player's read", () =>
    Effect.gen(function* () {
      const { h, id } = yield* live1v1
      yield* h.steam.failNextReads(3) // the read and both retries
      const failed = yield* Effect.flip(h.engine.leave(ALICE.discordId, id))
      expect(failed._tag).toBe("SteamUnavailable")
      yield* h.engine.leave(ALICE.discordId, id)
    })
  )
})

describe("the Result", () => {
  it.scoped("is read the moment the Match ends, ranked, with DNF last", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, { type: "lobby", minutes: 5, target: null })
      yield* h.engine.join(BOB.discordId, id)
      yield* h.engine.join(CARA.discordId, id)
      yield* h.engine.start(ALICE.discordId, id)
      yield* h.steam.setTime(1, BOB.steamId, 22)
      yield* advance("295 seconds")
      yield* h.steam.setTime(1, ALICE.steamId, 21) // set between the last poll and the end
      yield* advance("5 seconds")
      yield* h.steam.setTime(1, CARA.steamId, 18) // after the end: doesn't count
      yield* advance("1 minute")
      const posts = yield* h.surface.posts(id)
      const result = posts.findLast((p) => p._tag === "Result")
      expect(result?._tag).toBe("Result")
      if (result?._tag !== "Result") return
      expect(result.standings.map((s) => [s.player.discordId, s.rank, s.medal])).toEqual([
        [ALICE.discordId, 1, "gold"],
        [BOB.discordId, 2, "gold"],
        [CARA.discordId, null, null]
      ])
      expect(Option.getOrThrow(yield* h.surface.card(id))).toMatchObject({ state: "finished", endsAt: null })
      // The Result shows the finished Card itself
      expect(result.card).toEqual(Option.getOrThrow(yield* h.surface.card(id)))
    })
  )

  it.scoped("gives equal times a shared rank", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* h.steam.setTime(1, ALICE.steamId, 23)
      yield* h.steam.setTime(1, BOB.steamId, 23)
      yield* advance("5 minutes")
      const result = (yield* h.surface.posts(id)).findLast((p) => p._tag === "Result")
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings.map((s) => s.rank)).toEqual([1, 1])
    })
  )

  it.scoped("with no finishers, ranks nobody", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* advance("5 minutes")
      const result = (yield* h.surface.posts(id)).at(-1)
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings.every((s) => s.rank === null)).toBe(true)
    })
  )

  it.scoped("keeps the last polled times if the final read keeps failing", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* h.steam.setTime(1, ALICE.steamId, 28)
      yield* advance("290 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 21)
      yield* h.steam.failNextReads(3)
      yield* advance("10 seconds")
      const result = (yield* h.surface.posts(id)).findLast((p) => p._tag === "Result")
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings.map((s) => [s.player.discordId, s.rank])).toEqual([
        [ALICE.discordId, 1],
        [BOB.discordId, null]
      ])
    })
  )

  it.scoped("retries the final read when Steam drops it", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* advance("295 seconds")
      yield* h.steam.setTime(1, BOB.steamId, 25)
      yield* h.steam.failNextReads(2)
      yield* advance("5 seconds")
      const result = (yield* h.surface.posts(id)).findLast((p) => p._tag === "Result")
      if (result?._tag !== "Result") return expect.unreachable()
      expect(result.standings[0]?.player).toEqual(BOB)
    })
  )
})

describe("restart", () => {
  it.scoped("resumes a live Match, and finishes one that ended while the bot was down", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const id = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.engine.accept(BOB.discordId, id)
      yield* advance("1 minute")
      const cardsBefore = (yield* h.surface.all).filter((e) => e._tag === "Card").length
      yield* h.restart("1 minute")
      expect((yield* h.surface.all).filter((e) => e._tag === "Card").length).toBe(cardsBefore + 1) // redrawn on boot
      yield* h.steam.setTime(1, ALICE.steamId, 27)
      yield* advance("10 seconds")
      expect(improvements(yield* h.surface.posts(id))).toHaveLength(1)
      yield* h.steam.setTime(1, BOB.steamId, 26)
      yield* h.restart("10 minutes") // the end passed while down
      yield* advance("0 seconds")
      const stored = Option.getOrThrow(yield* h.store.getMatch(id)) satisfies Match
      expect(stored.state).toBe("finished")
      expect(tags(yield* h.surface.posts(id))).toContain("Result")
    })
  )

  it.scoped("keeps an Invite's expiry across a restart, and drops one that lapsed while down", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ maps: [MAP] })
      const kept = yield* h.engine.openInvite(ALICE.discordId, public1v1)
      yield* h.restart("3 minutes")
      expect(Option.isNone(yield* h.surface.removed(kept))).toBe(true)
      yield* advance("2 minutes")
      expect(yield* h.surface.removed(kept)).toEqual(Option.some("expired"))

      const lapsed = yield* h.engine.openInvite(BOB.discordId, public1v1)
      yield* h.restart("6 minutes")
      expect(yield* h.surface.removed(lapsed)).toEqual(Option.some("expired"))
    })
  )
})
