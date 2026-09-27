// What a Match looks like on both surfaces: the Board Slab's rows and words (present.ts), and
// every PB as the Match Thread and the Activity tell it (`progress`).
import { describe, expect, it } from "vitest"
import { progress } from "../src/domain.js"
import { boardRows, matchDetails, matchName } from "../src/present.js"
import { ALICE, BOB, CARA, cardView, drawnMap, makeMap, ticks } from "./harness.js"

const NAMES: Record<string, string> = { [ALICE.discordId]: "Alice", [BOB.discordId]: "Bob", [CARA.discordId]: "Cara" }
const nameOf = (id: string) => NAMES[id] ?? "Player"

/** Each row as name, note and score. */
const said = (rows: ReturnType<typeof boardRows>) => rows.map((r) => [r.rank, r.name, r.note, r.score])

describe("the Board Slab", () => {
  it("seats an Invite, with the seat still to fill", () => {
    expect(said(boardRows(cardView("m1", { type: "public" }), nameOf))).toEqual([
      ["1", "Alice", "opened the Invite", "ready"],
      ["2", "Open slot", "first to accept", "—"]
    ])
    const challenge = boardRows(cardView("m1", { type: "challenge", target: BOB }), nameOf)
    expect(said(challenge)).toEqual([
      ["1", "Alice", "opened the Invite", "ready"],
      ["2", "Bob", "hasn't answered", "—"]
    ])
    expect(challenge[1]).toMatchObject({ faded: true, steamId: BOB.steamId })
    expect(said(boardRows(cardView("m1", { type: "lobby", players: [ALICE, BOB] }), nameOf))).toEqual([
      ["1", "Alice", "opened the Invite", "ready"],
      ["2", "Bob", "joined", "ready"]
    ])
  })

  it("ranks a live Match: the leader, the gaps, and who has no time or must beat their PB", () => {
    const map = { ...drawnMap(), personalBests: { [CARA.steamId]: ticks(21.5) } }
    const view = cardView("m1", {
      state: "live",
      map,
      standings: [
        { player: BOB, ticks: ticks(22), rank: 1, medal: "gold" },
        { player: ALICE, ticks: ticks(24.25), rank: 2, medal: "gold" },
        { player: CARA, ticks: null, rank: null, medal: null }
      ]
    })
    expect(said(boardRows(view, nameOf))).toEqual([
      ["1", "Bob", "leads", "0:22.000"],
      ["2", "Alice", "+2.250 behind", "0:24.250"],
      ["–", "Cara", "must beat their PB 0:21.500", "—"]
    ])
  })

  it("tells the Result: who won, who didn't finish, and a world record set in the Match", () => {
    const view = cardView("m1", {
      state: "finished",
      map: drawnMap(makeMap(1, { worldRecordTicks: ticks(15) })),
      standings: [
        { player: BOB, ticks: ticks(14.9), rank: 1, medal: "author" },
        { player: ALICE, ticks: null, rank: null, medal: null }
      ]
    })
    const rows = boardRows(view, nameOf)
    expect(said(rows)).toEqual([
      ["1", "Bob", "wins", "0:14.900"],
      ["–", "Alice", "did not finish", "DNF"]
    ])
    expect(rows.map((r) => r.worldRecord)).toEqual([true, false])
  })
})

describe("a Match's words", () => {
  it("names it by its Players, and keeps the Map sealed until the start", () => {
    expect(matchName(cardView("m1", { type: "challenge", target: BOB }), nameOf)).toBe("Alice v Bob")
    expect(matchName(cardView("m1", { type: "lobby" }), nameOf)).toBe("Alice's Lobby")
    expect(matchDetails(cardView("m1", { type: "lobby", minutes: 15 }))).toBe("Lobby · 15 min · drawn at the start")
    expect(matchDetails(cardView("m1", { state: "live", map: drawnMap(), minutes: 10 }))).toBe("by pebblewright · Public 1v1 · 10 min · WR 0:15.000")
  })
})

describe("every PB of a Match", () => {
  const map = drawnMap(makeMap(1, { worldRecordTicks: ticks(20) }))

  it("ranks PBs from one Steam read against the whole read", () => {
    const history = [
      { steamId: ALICE.steamId, ticks: ticks(26), at: 10_000 },
      { steamId: BOB.steamId, ticks: ticks(25), at: 10_000 },
      // One read: Alice's 24.5 would lead Bob's old 25, but Bob's 24 came in on the same read.
      { steamId: ALICE.steamId, ticks: ticks(24.5), at: 20_000 },
      { steamId: BOB.steamId, ticks: ticks(24), at: 20_000 }
    ]
    expect(progress(map, history).map((p) => [p.steamId, p.rank, p.previousRank, p.previousTicks])).toEqual([
      [ALICE.steamId, 2, null, null],
      [BOB.steamId, 1, null, null],
      [ALICE.steamId, 2, 2, ticks(26)],
      [BOB.steamId, 1, 1, ticks(25)]
    ])
  })

  it("measures each world-record break against the WR it beat, and a PB brought in as the time beaten", () => {
    const withPb = { ...map, personalBests: { [CARA.steamId]: ticks(19.8) } }
    const history = [
      { steamId: ALICE.steamId, ticks: ticks(19.5), at: 10_000 },
      { steamId: BOB.steamId, ticks: ticks(19), at: 10_000 },
      { steamId: CARA.steamId, ticks: ticks(19.2), at: 30_000 }
    ]
    expect(progress(withPb, history).map((p) => [p.steamId, p.beatWorldRecord, p.previousTicks])).toEqual([
      [ALICE.steamId, ticks(20), null],
      [BOB.steamId, ticks(19.5), null],
      [CARA.steamId, null, ticks(19.8)]
    ])
  })
})
