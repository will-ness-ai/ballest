// The Discord messages the bot sends, built from plain data: which buttons each one offers,
// what they do, and who each one pings. No Discord needed; the payloads are checked as built.
import { type ActionRowBuilder, type ButtonBuilder, ButtonStyle } from "discord.js"
import { describe, expect, it } from "vitest"
import type { MatchState, MatchType } from "../src/domain.js"
import { parseControl } from "../src/discord/controls.js"
import type { MarbleEmojis } from "../src/discord/marbles.js"
import { cardMessage, confirmLeaveMessage, footerMessage, type Payload, pingDeclinedMessage, pingOfferMessage, pingsMessage, threadMessage } from "../src/discord/messages.js"
import { ThreadPost } from "../src/ports.js"
import { ALICE, BOB, CARA, cardView, drawnMap, ticks } from "./harness.js"

const marbles: MarbleEmojis = { forHue: () => "", forPlayer: () => "" }
const art = { marbles, png: null }
const PNG = Buffer.from([])
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

/** A message that can't notify anyone: no users, no roles, nothing parsed from its text. */
const pingsNobody = (p: Payload) => expect(p.allowedMentions).toEqual({ parse: [] })

describe("the Footer", () => {
  it("offers New Match, Link Steam and Pings, and pings nobody", () => {
    const footer = footerMessage(PNG)
    expect(buttons(footer)).toEqual([
      { label: "New Match", does: { _tag: "NewMatch" } },
      { label: "Link Steam", does: { _tag: "LinkSteam" } },
      { label: "Pings", does: { _tag: "Pings" } }
    ])
    pingsNobody(footer)
  })
})

describe("Lobby pings, privately", () => {
  const ROLE = "555"
  /** Each button's colour, beside its label. */
  const styles = (p: Payload) =>
    (p.components ?? []).flatMap((row) => (row as ActionRowBuilder<ButtonBuilder>).toJSON().components).map((b) => b.style)

  it("the Pings reply, off: says so, names the role, and offers Get", () => {
    const off = pingsMessage(false, ROLE)
    expect(off.content).toBe("**Lobby pings: off**\nYou don't have <@&555>.")
    expect(buttons(off)).toEqual([{ label: "Get @Multiplayer ping", does: { _tag: "SetPing", on: true } }])
    expect(styles(off)).toEqual([ButtonStyle.Success])
    pingsNobody(off)
  })

  it("the Pings reply, on: says so, names the role, and offers Remove", () => {
    const on = pingsMessage(true, ROLE)
    expect(on.content).toBe("**Lobby pings: on**\nYou have <@&555>.")
    expect(buttons(on)).toEqual([{ label: "Remove @Multiplayer ping", does: { _tag: "SetPing", on: false } }])
    expect(styles(on)).toEqual([ButtonStyle.Secondary])
    pingsNobody(on)
  })

  it("the offer: names the role, points at Pings, and offers Get or No", () => {
    const offer = pingOfferMessage(ROLE)
    expect(offer.content).toBe("Get <@&555> to hear when someone opens a Lobby. Change it later from **Pings**.")
    expect(buttons(offer)).toEqual([
      { label: "Get @Multiplayer ping", does: { _tag: "SetPing", on: true } },
      { label: "No", does: { _tag: "DeclinePing" } }
    ])
    expect(styles(offer)).toEqual([ButtonStyle.Success, ButtonStyle.Secondary])
    pingsNobody(offer)
  })

  it("No turns the offer into a line with no buttons", () => {
    const declined = pingDeclinedMessage()
    expect(declined.content).toBe("Lobby pings: off. Change it later from **Pings**.")
    expect(declined.components).toEqual([])
    pingsNobody(declined)
  })
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
    expect(labels(cardMessage(card(state, type), PNG))).toEqual(expected)
  })

  it("wires every button to its action on this Match", () => {
    const lobby = buttons(cardMessage(card("invite", "lobby"), PNG))
    expect(lobby.map((b) => b.does)).toEqual(
      (["join", "leave", "start", "cancel"] as const).map((action) => ({ _tag: "Act", action, matchId: "7" }))
    )
    const live = buttons(cardMessage(card("live", "lobby"), PNG))
    expect(live[0]?.does).toEqual({ _tag: "Act", action: "join", matchId: "7" })
    expect(live[1]?.does).toContain(MAP.pfid)
    // Leave on a live Match asks first
    expect(live[2]?.does).toEqual({ _tag: "AskLeave", matchId: "7" })
    const confirm = buttons(confirmLeaveMessage("7"))
    expect(confirm.map((b) => b.does)).toEqual([{ _tag: "ConfirmLeave", matchId: "7" }, { _tag: "Stay" }])
  })

  it("never pings", () => {
    for (const state of ["invite", "live", "finished"] as const)
      expect(pinged(cardMessage(card(state, "lobby"), PNG))).toEqual([])
  })

  it("keeps each row within Discord's five buttons", () => {
    for (const state of ["invite", "live", "finished"] as const)
      for (const type of ["public", "challenge", "lobby"] as const)
        for (const row of cardMessage(card(state, type), PNG).components ?? [])
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
