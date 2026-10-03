// The Discord messages the bot sends, built from plain data: which buttons each one offers,
// what they do, and who each one pings. No Discord needed; the payloads are checked as built.
import type { ActionRowBuilder, ButtonBuilder } from "discord.js"
import { describe, expect, it } from "vitest"
import type { MatchState, MatchType } from "../src/domain.js"
import { parseControl } from "../src/discord/controls.js"
import type { MarbleEmojis } from "../src/discord/marbles.js"
import { cardMessage, closedCardMessage, confirmLeaveMessage, type Payload, threadMessage } from "../src/discord/messages.js"
import { ThreadPost } from "../src/ports.js"
import { ALICE, BOB, CARA, cardView, drawnMap, ticks } from "./harness.js"

const marbles: MarbleEmojis = { forHue: () => "", forPlayer: () => "" }
const art = { marbles, png: null }
const PNG = Buffer.from([])
const ROLE = "555"
/** A Card redrawn: the ping line, if any, mentions nobody. */
const redrawn = { roleId: ROLE, announce: false }
/** A Card's first post: a Lobby's ping line mentions the role. */
const announced = { roleId: ROLE, announce: true }
const MAP = drawnMap()
const WORKSHOP = "Open Map in Workshop"

/** Each button on a message: its label, and what it does (its Control, or its link). */
const buttons = (p: Payload) =>
  (p.components ?? [])
    .flatMap((row) => (row as ActionRowBuilder<ButtonBuilder>).toJSON().components)
    .map((b) => ({ label: "label" in b ? b.label : undefined, does: "custom_id" in b ? parseControl(b.custom_id) : "url" in b ? b.url : null }))

const labels = (p: Payload) => buttons(p).map((b) => b.label)

/** Who a message pings: the user ids it lets Discord mention. */
const pinged = (p: Payload) => p.allowedMentions?.users ?? []

const card = (state: MatchState, type: MatchType) =>
  cardView("7", {
    state,
    type,
    players: [ALICE, BOB],
    map: state === "invite" ? null : MAP,
    expiresAt: state === "invite" ? 1 : null,
    endsAt: state === "live" ? 1 : null
  })

describe("the Card", () => {
  it.each([
    ["invite", "public", ["Accept", "Cancel"]],
    ["invite", "challenge", ["Accept", "Decline", "Cancel"]],
    ["invite", "lobby", ["Join (2)", "Leave", "Start", "Cancel"]],
    ["live", "public", [WORKSHOP, "Leave"]],
    ["live", "challenge", [WORKSHOP, "Leave"]],
    ["live", "lobby", ["Join (2)", WORKSHOP, "Leave"]],
    ["finished", "public", []],
    ["finished", "lobby", []]
  ] as const)("a %s %s offers %j", (state, type, expected) => {
    expect(labels(cardMessage(card(state, type), PNG, redrawn))).toEqual(expected)
  })

  it("wires every button to its action on this Match", () => {
    const lobby = buttons(cardMessage(card("invite", "lobby"), PNG, redrawn))
    expect(lobby.map((b) => b.does)).toEqual(
      (["join", "leave", "start", "cancel"] as const).map((action) => ({ _tag: "Act", action, matchId: "7" }))
    )
    const live = buttons(cardMessage(card("live", "lobby"), PNG, redrawn))
    expect(live[0]?.does).toEqual({ _tag: "Act", action: "join", matchId: "7" })
    expect(live[1]?.does).toContain(MAP.pfid)
    // Leave on a live Match asks first
    expect(live[2]?.does).toEqual({ _tag: "AskLeave", matchId: "7" })
    const confirm = buttons(confirmLeaveMessage("7"))
    expect(confirm.map((b) => b.does)).toEqual([{ _tag: "ConfirmLeave", matchId: "7" }, { _tag: "Stay" }])
  })

  it("never pings", () => {
    for (const state of ["invite", "live", "finished"] as const)
      expect(pinged(cardMessage(card(state, "lobby"), PNG, redrawn))).toEqual([])
  })

  it("a Lobby's first post pings only the role, with who opened it and for how long", () => {
    const first = cardMessage(cardView("7", { type: "lobby", creator: ALICE, players: [ALICE], minutes: 15 }), PNG, announced)
    expect(first.content).toBe(`<@&555> **<@${ALICE.discordId}>** opened a 15-minute Lobby`)
    expect(first.allowedMentions).toEqual({ parse: [], roles: [ROLE] })
  })

  it("a Lobby keeps its line on every redraw, live and finished, and pings nobody", () => {
    for (const state of ["invite", "live", "finished"] as const) {
      const again = cardMessage(cardView("7", { state, type: "lobby", creator: ALICE, minutes: 15 }), PNG, redrawn)
      expect(again.content).toBe(`<@&555> **<@${ALICE.discordId}>** opened a 15-minute Lobby`)
      expect(again.allowedMentions).toEqual({ parse: [] })
    }
  })

  it("a Public 1v1 or Challenge has no line and pings nobody, even on its first post", () => {
    for (const type of ["public", "challenge"] as const) {
      const first = cardMessage(card("invite", type), PNG, announced)
      expect(first.content).toBe("")
      expect(first.allowedMentions).toEqual({ parse: [] })
    }
  })

  it("a kept-cancelled Card says why, with no line, and pings nobody", () => {
    for (const reason of ["noEligibleMap", "abandoned"] as const) {
      const closed = closedCardMessage(reason)
      expect(closed.content).toBe("")
      expect(closed.allowedMentions).toEqual({ parse: [] })
    }
  })

  it("keeps each row within Discord's five buttons", () => {
    for (const state of ["invite", "live", "finished"] as const)
      for (const type of ["public", "challenge", "lobby"] as const)
        for (const row of cardMessage(card(state, type), PNG, redrawn).components ?? [])
          expect((row as ActionRowBuilder<ButtonBuilder>).toJSON().components.length).toBeLessThanOrEqual(5)
  })
})

describe("thread posts", () => {
  const live = card("live", "lobby")

  it.each([
    ["Opened", ThreadPost.Opened({ by: ALICE, type: "lobby", minutes: 10 })],
    ["Accepted", ThreadPost.Accepted({ player: BOB })],
    ["Joined", ThreadPost.Joined({ player: CARA })],
    ["Left", ThreadPost.Left({ player: CARA })],
    ["Result", ThreadPost.Result({ standings: [], card: live })],
    ["Progression", ThreadPost.Progression({ card: live, history: [] })],
    ["Abandoned", ThreadPost.Abandoned()],
    [
      "Improved",
      ThreadPost.Improved({
        improvement: { player: BOB, ticks: ticks(20), medal: null, rank: 1, previousTicks: null, previousRank: null, beatWorldRecord: null }
      })
    ]
  ] as const)("%s pings nobody", (_, post) => {
    expect(pinged(threadMessage("7", post, art))).toEqual([])
  })

  it("the start ping pings exactly the Players it sends off, with the Workshop link", () => {
    const everyone = threadMessage("7", ThreadPost.Started({ players: [ALICE, BOB], map: MAP, endsAt: 1, card: live }), art)
    expect(pinged(everyone)).toEqual([ALICE.discordId, BOB.discordId])
    const lateJoin = threadMessage("7", ThreadPost.Started({ players: [CARA], map: MAP, endsAt: 1, card: live }), art)
    expect(pinged(lateJoin)).toEqual([CARA.discordId])
    expect(labels(lateJoin)).toEqual([WORKSHOP])
  })

  it("a Challenge pings only its target, who can answer from the post", () => {
    const post = ThreadPost.Challenged({ by: ALICE, target: BOB, minutes: 10, expiresAt: 1 })
    const message = threadMessage("7", post, art)
    expect(pinged(message)).toEqual([BOB.discordId])
    expect(buttons(message).map((b) => b.does)).toEqual([
      { _tag: "Act", action: "accept", matchId: "7" },
      { _tag: "Act", action: "decline", matchId: "7" }
    ])
  })

  it("pings each Player with a PB to beat, and everyone when no Map fits", () => {
    const bars = [{ player: CARA, ticks: ticks(20) }]
    expect(pinged(threadMessage("7", ThreadPost.PlayedBefore({ bars }), art))).toEqual([CARA.discordId])
    expect(pinged(threadMessage("7", ThreadPost.NoMap({ players: [ALICE, BOB] }), art))).toEqual([ALICE.discordId, BOB.discordId])
  })
})
