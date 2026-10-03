// Every message the bot posts, as discord.js payloads. The images in them come from
// src/render/; here they are only attached, with the buttons and text around them.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type BaseMessageOptions
} from "discord.js"
import { DURATIONS, formatTime, MATCH_TYPE_NAME, type MatchType, type Minutes } from "../domain.js"
import { DECLINE_PING, GET_PING, pingDeclined, pingOffer, PINGS_LABEL, pingsHave, pingsState, REMOVE_PING } from "../pingWords.js"
import { type HowtoPart, STEAM_LINK_HOWTO } from "../present.js"
import { RESULT_HUE, START_HUE } from "../render/art.js"
import type { CardView, KeptReason, ThreadPost } from "../ports.js"
import { type Action, type Control, controlId } from "./controls.js"
import type { MarbleEmojis } from "./marbles.js"

/**
 * A message to post or edit. `attachments: []` on an edit drops the old image; discord.js adds
 * the new files to it, so the same payload posts and redraws.
 */
export type Payload = BaseMessageOptions & { readonly attachments?: Array<never> }

export const PROFILE_FIELD = "profile"

// ---------------------------------------------------------------- formatting


const unix = (ms: number) => Math.floor(ms / 1000)
const who = (discordId: string) => `<@${discordId}>`
const workshopUrl = (pfid: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`

/** Mentions shown as names without pinging anyone. */
export const quiet = { allowedMentions: { parse: [] } } as const

const button = (label: string, control: Control, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(controlId(control)).setLabel(label).setStyle(style).setDisabled(disabled)

const row = (...buttons: Array<ButtonBuilder>) => new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)

const workshopLink = (pfid: string) =>
  new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Map in Workshop").setURL(workshopUrl(pfid))

const workshopButton = (pfid: string) => row(workshopLink(pfid))

/** A rendered image, attached; editing a message with one replaces the old. */
const image = (png: Buffer, name: string) => ({ files: [new AttachmentBuilder(png, { name })], attachments: [] })

// ---------------------------------------------------------------- the Footer

export const footerMessage = (png: Buffer): Payload => ({
  content: "",
  embeds: [],
  ...image(png, "multiballs.png"),
  components: [
    row(
      button("New Match", { _tag: "NewMatch" }, ButtonStyle.Primary),
      button("Link Steam", { _tag: "LinkSteam" }),
      button(PINGS_LABEL, { _tag: "Pings" })
    )
  ],
  ...quiet
})

// ---------------------------------------------------------------- the Match Card

export const threadName = (v: CardView, creatorName: string) => `${creatorName}'s ${MATCH_TYPE_NAME[v.type]} · ${v.minutes} min`

const act = (action: Action, matchId: string): Control => ({ _tag: "Act", action, matchId })
const acceptButton = (matchId: string) => button("Accept", act("accept", matchId), ButtonStyle.Success)
const declineButton = (matchId: string) => button("Decline", act("decline", matchId), ButtonStyle.Danger)

const cardButtons = (v: CardView) => {
  const join = () => button(`Join (${v.players.length})`, act("join", v.matchId), ButtonStyle.Success)
  if (v.state === "live" && v.map !== null) {
    const leave = button("Leave", { _tag: "AskLeave", matchId: v.matchId })
    return [v.type === "lobby" ? row(join(), workshopLink(v.map.pfid), leave) : row(workshopLink(v.map.pfid), leave)]
  }
  if (v.state !== "invite") return []
  const cancel = button("Cancel", act("cancel", v.matchId))
  if (v.type === "public") return [row(acceptButton(v.matchId), cancel)]
  if (v.type === "challenge") return [row(acceptButton(v.matchId), declineButton(v.matchId), cancel)]
  return [
    row(
      join(),
      button("Leave", act("leave", v.matchId)),
      button("Start", act("start", v.matchId), ButtonStyle.Primary),
      cancel
    )
  ]
}

/** The Match's clock as Discord timestamps (each reader sees their own time); none once it's over. */
const clockText = (v: CardView): string | null =>
  v.state === "invite" && v.expiresAt !== null
    ? `Invite expires <t:${unix(v.expiresAt)}:R>`
    : v.state === "live" && v.endsAt !== null
      ? `**Live** · ends <t:${unix(v.endsAt)}:R> (<t:${unix(v.endsAt)}:t>)`
      : null

const INVITE_GREY = 0x4e5058
const LIVE_LIME = 0x8be03c

/**
 * How a Card treats the @Multiplayer ping role. `announce` is true only on the post that
 * creates the Card: Discord notifies a mention when a message is first posted, never on an edit.
 */
export interface CardPing {
  readonly roleId: string
  readonly announce: boolean
}

/** A Lobby's line above its Card: "@Multiplayer ping **@creator** opened a N-minute Lobby". */
const lobbyLine = (v: CardView, roleId: string) =>
  `<@&${roleId}> **${who(v.creator.discordId)}** opened a ${v.minutes}-minute Lobby`

/**
 * The Card image, with the clock in an embed below it: the image never shows one. A Lobby's Card
 * keeps its ping line through live and finished, but only its first post lets the role be
 * mentioned. Public 1v1 and Challenge Cards have no line.
 */
export const cardMessage = (v: CardView, png: Buffer, ping: CardPing): Payload => {
  const text = clockText(v)
  const clock = text === null ? null : new EmbedBuilder().setColor(v.state === "live" ? LIVE_LIME : INVITE_GREY).setDescription(text)
  const lobby = v.type === "lobby"
  return {
    content: lobby ? lobbyLine(v, ping.roleId) : "",
    embeds: clock === null ? [] : [clock],
    ...image(png, `match-${v.matchId}.png`),
    components: cardButtons(v),
    ...(lobby && ping.announce ? { allowedMentions: { parse: [], roles: [ping.roleId] } } : quiet)
  }
}

/** Why a kept Match was cancelled, on its Card and in its thread. */
const WHY_CANCELLED: Record<KeptReason, string> = {
  noEligibleMap: "No Map fits this Match: none suits the length. A longer Match allows more Maps.",
  abandoned: "Everyone left before anyone set a time."
}

/** A cancelled Card that stays, saying why. */
export const closedCardMessage = (reason: KeptReason): Payload => ({
  content: "",
  embeds: [new EmbedBuilder().setTitle("Cancelled").setDescription(WHY_CANCELLED[reason])],
  files: [],
  attachments: [],
  components: [],
  ...quiet
})

// ---------------------------------------------------------------- Match Thread posts ("Marble Icons")

/** The Match Thread's first message: the same clock as under the Card, kept at the thread's top. */
export const clockMessage = (v: CardView | "cancelled"): Payload => ({
  content: v === "cancelled" ? "**Cancelled**" : (clockText(v) ?? "**Finished**"),
  ...quiet
})

/** What a thread post is drawn with, beyond the post itself. */
export interface ThreadArt {
  readonly marbles: MarbleEmojis
  /** The post's image: the Card for Go! and the Result, the row for an Improvement, the graph after the Result. */
  readonly png: Buffer | null
}

const line = (marble: string, text: string) => (marble === "" ? text : `${marble} ${text}`)

export const threadMessage = (matchId: string, post: ThreadPost, art: ThreadArt): Payload => {
  const pic = art.png === null ? {} : image(art.png, `${post._tag.toLowerCase()}.png`)
  switch (post._tag) {
    case "Opened":
      return {
        content: line(art.marbles.forPlayer(post.by.steamId), `**${who(post.by.discordId)}** opened a ${post.minutes}-minute ${MATCH_TYPE_NAME[post.type]}`),
        ...quiet
      }
    case "Challenged": {
      return {
        content: line(
          art.marbles.forPlayer(post.by.steamId),
          `${who(post.target.discordId)} **${who(post.by.discordId)}** challenges you · ${post.minutes} min · answer <t:${unix(post.expiresAt)}:R>`
        ),
        components: [row(acceptButton(matchId), declineButton(matchId))],
        allowedMentions: { users: [post.target.discordId] }
      }
    }
    case "Accepted":
      return { content: line(art.marbles.forPlayer(post.player.steamId), `**${who(post.player.discordId)}** accepted`), ...quiet }
    case "Joined":
      return { content: line(art.marbles.forPlayer(post.player.steamId), `**${who(post.player.discordId)}** joined`), ...quiet }
    case "Left":
      return { content: `-# ${line(art.marbles.forPlayer(post.player.steamId), `**${who(post.player.discordId)}** left`)}`, ...quiet }
    case "Started":
      return {
        content: line(art.marbles.forHue(START_HUE), `${post.players.map((p) => who(p.discordId)).join(" ")} **Go!** Ends <t:${unix(post.endsAt)}:R>`),
        ...pic,
        components: [workshopButton(post.map.pfid)],
        allowedMentions: { users: post.players.map((p) => p.discordId) }
      }
    case "Improved":
      // A world record gets its line; no pings.
      return {
        content: post.improvement.beatWorldRecord === null ? "" : `🏆 **NEW WORLD RECORD** · ${who(post.improvement.player.discordId)}`,
        ...pic,
        ...quiet
      }
    case "Progression":
      return { content: "", ...pic, ...quiet }
    case "Result":
      return {
        content: line(art.marbles.forHue(RESULT_HUE), post.standings.every((s) => s.rank === null) ? "**Final result** · no finishers" : "**Final result**"),
        ...pic,
        ...quiet
      }
    case "PlayedBefore": {
      const pings = post.bars.map((b) => who(b.player.discordId)).join(" ")
      const pbs = post.bars.map((b) => `${who(b.player.discordId)} \`${formatTime(b.ticks)}\``).join(" · ")
      return {
        content: `${pings} you've finished this Map before, so only a run **faster than your PB** counts; otherwise you're DNF.
-# PB to beat: ${pbs}`,
        allowedMentions: { users: post.bars.map((b) => b.player.discordId) }
      }
    }
    case "NoMap":
      return {
        content: `${post.players.map((p) => who(p.discordId)).join(" ")} **Match cancelled.** ${WHY_CANCELLED.noEligibleMap}`,
        allowedMentions: { users: post.players.map((p) => p.discordId) }
      }
    case "Abandoned":
      return { content: `**Match cancelled.** ${WHY_CANCELLED.abandoned}`, ...quiet }
  }
}

// ---------------------------------------------------------------- New Match (Type First), privately

export const pickTypeMessage = (): Payload => ({
  content: "**What kind of Match?**",
  components: [
    row(
      button("Public 1v1", { _tag: "PickType", type: "public" }, ButtonStyle.Primary),
      button("Challenge", { _tag: "PickType", type: "challenge" }, ButtonStyle.Primary),
      button("Lobby", { _tag: "PickType", type: "lobby" }, ButtonStyle.Primary)
    )
  ]
})

export const pickTargetMessage = (): Payload => ({
  content: "**Challenge · who?**",
  components: [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(controlId({ _tag: "PickTarget" })).setPlaceholder("Pick a Player").setMaxValues(1)
    )
  ]
})

export const pickDurationMessage = (type: MatchType, target: string | null, chosen: Minutes | null): Payload => {
  const durations = DURATIONS.map((minutes) =>
    button(
      `${minutes}m`,
      { _tag: "PickDuration", request: { type, target, minutes } },
      minutes === chosen ? ButtonStyle.Primary : ButtonStyle.Secondary
    )
  )
  return {
    content: `**${MATCH_TYPE_NAME[type]}${target ? ` vs ${who(target)}` : ""} · how long?**`,
    components: [
      row(...durations.slice(0, 4)),
      row(...durations.slice(4)),
      row(
        button(
          "Open Invite",
          { _tag: "OpenInvite", request: { type, target, minutes: chosen ?? DURATIONS[0] } },
          ButtonStyle.Success,
          chosen === null
        )
      )
    ],
    ...quiet
  }
}

// ---------------------------------------------------------------- Leave a live Match, privately

export const LEFT_TEXT = "You left the Match. Your best time so far stands."

export const confirmLeaveMessage = (matchId: string): Payload => ({
  content: "**Leave this Match?** Your best time so far stands, but nothing after this counts.",
  components: [row(button("Leave", { _tag: "ConfirmLeave", matchId }, ButtonStyle.Danger), button("Stay", { _tag: "Stay" }))]
})

// ---------------------------------------------------------------- Link Steam

const howtoMarkdown = (parts: ReadonlyArray<HowtoPart>) =>
  parts.map((p) => (typeof p === "string" ? p : "menu" in p ? `**${p.menu}**` : `\`${p.example}\``)).join("")

export const linkForm = () =>
  new ModalBuilder()
    .setCustomId(controlId({ _tag: "LinkForm" }))
    .setTitle("Link your Steam account")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          ...STEAM_LINK_HOWTO.steps.map((step, n) => `${n + 1}. ${howtoMarkdown(step)}`),
          "",
          howtoMarkdown(STEAM_LINK_HOWTO.looksLike),
          `-# ${STEAM_LINK_HOWTO.notThis}`
        ].join("\n")
      )
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Steam profile link")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(PROFILE_FIELD)
            .setPlaceholder("https://steamcommunity.com/profiles/…")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
    )

export const linkPreviewMessage = (png: Buffer): Payload => ({
  content: "**Is this your Steam account?**",
  embeds: [],
  ...image(png, "steam-account.png"),
  components: [row(button("Yes, link it", { _tag: "ConfirmLink" }, ButtonStyle.Success), button("Try again", { _tag: "LinkSteam" }))]
})

export const tryAgainMessage = (text: string): Payload => ({
  content: text,
  embeds: [],
  files: [],
  attachments: [],
  components: [row(button("Try again", { _tag: "LinkSteam" }))]
})

// ---------------------------------------------------------------- Lobby pings, privately (spec #87)
// The role shows as a real mention, which pings nobody here: none of these allow mentions.

const roleMention = (roleId: string) => `<@&${roleId}>`
const PINGS_BOLD = `**${PINGS_LABEL}**`
const getPingButton = () => button(GET_PING, { _tag: "SetPing", on: true }, ButtonStyle.Success)

/** The Footer's Pings reply: where the member stands, and the one button that changes it. */
export const pingsMessage = (on: boolean, roleId: string): Payload => ({
  content: `**${pingsState(on)}**\n${pingsHave(on, roleMention(roleId))}`,
  components: [row(on ? button(REMOVE_PING, { _tag: "SetPing", on: false }) : getPingButton())],
  ...quiet
})

/** Offered once, after a member's first Join or Accept from a Card. Get turns it into the Pings reply. */
export const pingOfferMessage = (roleId: string): Payload => ({
  content: pingOffer(roleMention(roleId), PINGS_BOLD),
  components: [row(getPingButton(), button(DECLINE_PING, { _tag: "DeclinePing" }))],
  ...quiet
})

/** What the offer becomes after No. */
export const pingDeclinedMessage = (): Payload => ({ content: pingDeclined(PINGS_BOLD), components: [], ...quiet })
