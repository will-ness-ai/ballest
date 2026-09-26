// Every message the bot posts, as discord.js payloads. The images in them come from
// src/render/; here they are only attached, with the buttons and text around them.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type BaseMessageOptions
} from "discord.js"
import { DURATIONS, MATCH_TYPE_NAME, type MatchType, type Minutes } from "../domain.js"
import { RESULT_HUE, START_HUE } from "../render/art.js"
import type { CardView, ThreadPost } from "../ports.js"
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

const workshopButton = (pfid: string) =>
  row(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Map in Workshop").setURL(workshopUrl(pfid)))

/** A rendered image, attached; editing a message with one replaces the old. */
const image = (png: Buffer, name: string) => ({ files: [new AttachmentBuilder(png, { name })], attachments: [] })

// ---------------------------------------------------------------- the Footer

export const footerMessage = (png: Buffer): Payload => ({
  content: "",
  embeds: [],
  ...image(png, "multiballs.png"),
  components: [row(button("New Match", { _tag: "NewMatch" }, ButtonStyle.Primary), button("Link Steam", { _tag: "LinkSteam" }))],
  ...quiet
})

// ---------------------------------------------------------------- the Match Card

export const threadName = (v: CardView, creatorName: string) => `${creatorName}'s ${MATCH_TYPE_NAME[v.type]} · ${v.minutes} min`

const act = (action: Action, matchId: string): Control => ({ _tag: "Act", action, matchId })
const acceptButton = (matchId: string) => button("Accept", act("accept", matchId), ButtonStyle.Success)
const declineButton = (matchId: string) => button("Decline", act("decline", matchId), ButtonStyle.Danger)

const cardButtons = (v: CardView) => {
  if (v.state === "live" && v.map !== null) return [workshopButton(v.map.pfid)]
  if (v.state !== "invite") return []
  const cancel = button("Cancel", act("cancel", v.matchId))
  if (v.type === "public") return [row(acceptButton(v.matchId), cancel)]
  if (v.type === "challenge") return [row(acceptButton(v.matchId), declineButton(v.matchId), cancel)]
  return [
    row(
      button(`Join (${v.players.length})`, act("join", v.matchId), ButtonStyle.Success),
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

/** The Card image, with the clock in an embed below it: the image never shows one. */
export const cardMessage = (v: CardView, png: Buffer): Payload => {
  const text = clockText(v)
  const clock = text === null ? null : new EmbedBuilder().setColor(v.state === "live" ? LIVE_LIME : INVITE_GREY).setDescription(text)
  return {
    content: "",
    embeds: clock === null ? [] : [clock],
    ...image(png, `match-${v.matchId}.png`),
    components: cardButtons(v),
    ...quiet
  }
}

const NO_MAP = "No Map fits this Match: someone here has finished every candidate, or none suits the length."

/** A Card whose Invite was cancelled because no Map is eligible: it stays, saying why. */
export const closedCardMessage = (): Payload => ({
  content: "",
  embeds: [new EmbedBuilder().setTitle("Cancelled").setDescription(NO_MAP)],
  files: [],
  attachments: [],
  components: [],
  ...quiet
})

// ---------------------------------------------------------------- Match Thread posts ("Marble Icons")

/** The Match Thread's first message: the same clock as under the Card, kept at the thread's top. */
export const clockMessage = (v: CardView): Payload => ({ content: clockText(v) ?? "**Finished**", ...quiet })

/** What a thread post is drawn with, beyond the post itself. */
export interface ThreadArt {
  readonly marbles: MarbleEmojis
  /** The Match's latest Card, when the bot has it. */
  readonly view: CardView | null
  /** The post's image: the Card for Go! and the Result, the row for an Improvement. */
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
      const v = art.view
      const length = v === null ? "" : ` · ${v.minutes} min`
      const answer = v === null || v.expiresAt === null ? "" : ` · answer <t:${unix(v.expiresAt)}:R>`
      return {
        content: line(art.marbles.forPlayer(post.by.steamId), `${who(post.target.discordId)} **${who(post.by.discordId)}** challenges you${length}${answer}`),
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
      return { content: "", ...pic, ...quiet }
    case "Result":
      return {
        content: line(art.marbles.forHue(RESULT_HUE), post.standings.every((s) => s.rank === null) ? "**Final result** · no finishers" : "**Final result**"),
        ...pic,
        ...quiet
      }
    case "NoMap":
      return {
        content: `${post.players.map((p) => who(p.discordId)).join(" ")} **Match cancelled.** ${NO_MAP}`,
        allowedMentions: { users: post.players.map((p) => p.discordId) }
      }
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

// ---------------------------------------------------------------- Link Steam

export const linkForm = () =>
  new ModalBuilder()
    .setCustomId(controlId({ _tag: "LinkForm" }))
    .setTitle("Link your Steam account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(PROFILE_FIELD)
          .setLabel("Steam profile link, custom URL or SteamID64")
          .setPlaceholder("steamcommunity.com/id/yourname")
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
