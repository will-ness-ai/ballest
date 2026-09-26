// Every message the bot posts, as discord.js payloads, and the ids its buttons carry.
//
// Interim look: embeds and text. The rendered images (Match Card, Improvement rows, Footer)
// replace these in the renderer PR; the layout, buttons and flows here stay.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type BaseMessageOptions
} from "discord.js"
import { DURATIONS, SCORE_TICKS_PER_SECOND, type MatchType, type MedalKind, type Minutes, type Standing } from "../domain.js"
import type { CardView, ProfilePreview, ThreadPost } from "../ports.js"

// ---------------------------------------------------------------- button and form ids

export type Action = "accept" | "decline" | "join" | "leave" | "start" | "cancel"
const ACTIONS: ReadonlyArray<Action> = ["accept", "decline", "join", "leave", "start", "cancel"]
const TYPES: ReadonlyArray<MatchType> = ["public", "challenge", "lobby"]

/** What a clicked button (or submitted form) asks for. Choices so far ride along in the id. */
export type Control =
  | { readonly _tag: "NewMatch" }
  | { readonly _tag: "LinkSteam" }
  | { readonly _tag: "PickType"; readonly type: MatchType }
  | { readonly _tag: "PickTarget" }
  | { readonly _tag: "PickDuration"; readonly type: MatchType; readonly target: string | null; readonly minutes: Minutes }
  | { readonly _tag: "OpenInvite"; readonly type: MatchType; readonly target: string | null; readonly minutes: Minutes }
  | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }
  | { readonly _tag: "ConfirmLink" }
  | { readonly _tag: "LinkForm" }

const minutesOf = (s: string | undefined): Minutes | undefined => DURATIONS.find((d) => String(d) === s)
const typeOf = (s: string | undefined): MatchType | undefined => TYPES.find((t) => t === s)
const targetOf = (s: string | undefined) => (s === undefined || s === "-" ? null : s)

export const controlId = (c: Control): string => {
  switch (c._tag) {
    case "NewMatch":
      return "mb:new"
    case "LinkSteam":
      return "mb:link"
    case "PickType":
      return `mb:type:${c.type}`
    case "PickTarget":
      return "mb:target"
    case "PickDuration":
      return `mb:dur:${c.type}:${c.target ?? "-"}:${c.minutes}`
    case "OpenInvite":
      return `mb:open:${c.type}:${c.target ?? "-"}:${c.minutes}`
    case "Act":
      return `mb:act:${c.action}:${c.matchId}`
    case "ConfirmLink":
      return "mb:linkyes"
    case "LinkForm":
      return "mb:linkform"
  }
}

export const parseControl = (id: string): Control | null => {
  const [ns, kind, a, b, c] = id.split(":")
  if (ns !== "mb") return null
  switch (kind) {
    case "new":
      return { _tag: "NewMatch" }
    case "link":
      return { _tag: "LinkSteam" }
    case "linkyes":
      return { _tag: "ConfirmLink" }
    case "linkform":
      return { _tag: "LinkForm" }
    case "target":
      return { _tag: "PickTarget" }
    case "type": {
      const type = typeOf(a)
      return type ? { _tag: "PickType", type } : null
    }
    case "dur":
    case "open": {
      const type = typeOf(a)
      const minutes = minutesOf(c)
      if (!type || !minutes) return null
      return { _tag: kind === "dur" ? "PickDuration" : "OpenInvite", type, target: targetOf(b), minutes }
    }
    case "act": {
      const action = ACTIONS.find((x) => x === a)
      return action && b ? { _tag: "Act", action, matchId: b } : null
    }
    default:
      return null
  }
}

export const PROFILE_FIELD = "profile"

// ---------------------------------------------------------------- formatting

const TYPE_NAME: Record<MatchType, string> = { public: "Public 1v1", challenge: "Challenge", lobby: "Lobby" }
const MEDAL_NAME: Record<MedalKind, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", author: "Author" }

/** m:ss.mmm, as the leaderboard site writes times. */
export const formatTime = (ticks: number): string => {
  const totalMs = Math.round((ticks / SCORE_TICKS_PER_SECOND) * 1000)
  const m = Math.floor(totalMs / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`
}
const formatGain = (ticks: number) => `-${((ticks / SCORE_TICKS_PER_SECOND)).toFixed(3)}`
const unix = (ms: number) => Math.floor(ms / 1000)
const who = (discordId: string) => `<@${discordId}>`

const standingLines = (standings: ReadonlyArray<Standing>) =>
  standings
    .map((s) =>
      s.ticks === null
        ? `– ${who(s.player.discordId)} · DNF`
        : `**${s.rank}.** ${who(s.player.discordId)} · \`${formatTime(s.ticks)}\`${s.medal ? ` · ${MEDAL_NAME[s.medal]}` : ""}`
    )
    .join("\n")

const button = (label: string, control: Control, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(controlId(control)).setLabel(label).setStyle(style).setDisabled(disabled)

const row = (...buttons: Array<ButtonBuilder>) => new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)

// ---------------------------------------------------------------- the Footer

export const footerMessage = (): BaseMessageOptions => ({
  content: "",
  embeds: [
    new EmbedBuilder()
      .setTitle("Multiballs")
      .setDescription(
        [
          "**1 · Pick a mode:** Public 1v1, Challenge or Lobby",
          "**2 · Map is drawn:** a Map no one here has finished",
          "**3 · Fastest wins:** best time when the clock runs out",
          "",
          "-# Unofficial community tool · not made or supported by the Ballest developers"
        ].join("\n")
      )
  ],
  components: [row(button("New Match", { _tag: "NewMatch" }, ButtonStyle.Primary), button("Link Steam", { _tag: "LinkSteam" }))],
  allowedMentions: { parse: [] }
})

// ---------------------------------------------------------------- the Match Card

export const threadName = (v: CardView, creatorName: string) => `${creatorName}'s ${TYPE_NAME[v.type]} · ${v.minutes} min`

const cardButtons = (v: CardView) => {
  if (v.state !== "invite") return []
  const act = (action: Action) => ({ _tag: "Act", action, matchId: v.matchId }) as const
  if (v.type === "public") return [row(button("Accept", act("accept"), ButtonStyle.Success), button("Cancel", act("cancel")))]
  if (v.type === "challenge")
    return [row(button("Accept", act("accept"), ButtonStyle.Success), button("Decline", act("decline"), ButtonStyle.Danger), button("Cancel", act("cancel")))]
  return [
    row(
      button(`Join (${v.players.length})`, act("join"), ButtonStyle.Success),
      button("Leave", act("leave")),
      button("Start", act("start"), ButtonStyle.Primary),
      button("Cancel", act("cancel"))
    )
  ]
}

export const cardMessage = (v: CardView): BaseMessageOptions => {
  const card = new EmbedBuilder()
  if (v.state === "invite") {
    card
      .setTitle(`${TYPE_NAME[v.type]} · ${v.minutes} minutes`)
      .setDescription(
        [
          v.type === "challenge" && v.target ? `${who(v.creator.discordId)} challenges ${who(v.target.discordId)}` : "",
          `**Players:** ${v.players.map((p) => who(p.discordId)).join(", ")}`,
          "**Map:** drawn at the start, one no one here has finished"
        ]
          .filter(Boolean)
          .join("\n")
      )
  } else if (v.map) {
    card
      .setTitle(`${v.state === "live" ? "Live" : "Final"} · ${v.map.title}`)
      .setURL(`https://steamcommunity.com/sharedfiles/filedetails/?id=${v.map.pfid}`)
      .setDescription(
        [`by ${v.map.creator} · ${TYPE_NAME[v.type]} · ${v.minutes} min · WR \`${formatTime(v.map.worldRecordTicks)}\``, "", standingLines(v.standings)].join("\n")
      )
    if (v.map.previewUrl) card.setThumbnail(v.map.previewUrl)
  }
  const clock =
    v.expiresAt !== null
      ? new EmbedBuilder().setDescription(`Invite expires <t:${unix(v.expiresAt)}:R>`)
      : v.endsAt !== null
        ? new EmbedBuilder().setDescription(`**Live** · ends <t:${unix(v.endsAt)}:R>`)
        : null
  return { content: "", embeds: clock ? [card, clock] : [card], components: cardButtons(v), allowedMentions: { parse: [] } }
}

// ---------------------------------------------------------------- Match Thread posts

export const threadMessage = (post: ThreadPost): BaseMessageOptions => {
  const quiet = { allowedMentions: { parse: [] } } as const
  switch (post._tag) {
    case "Opened":
      return { content: `${who(post.by.discordId)} opened a ${post.minutes}-minute ${TYPE_NAME[post.type]}`, ...quiet }
    case "Challenged":
      return {
        content: `${who(post.target.discordId)} ${who(post.by.discordId)} challenges you. Accept or decline on the Card.`,
        allowedMentions: { users: [post.target.discordId] }
      }
    case "Accepted":
      return { content: `${who(post.player.discordId)} accepted`, ...quiet }
    case "Joined":
      return { content: `${who(post.player.discordId)} joined`, ...quiet }
    case "Left":
      return { content: `${who(post.player.discordId)} left`, ...quiet }
    case "Started": {
      const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${post.map.pfid}`
      const m = post.map.medals
      return {
        content: `${post.players.map((p) => who(p.discordId)).join(" ")} **Go!** Ends <t:${unix(post.endsAt)}:R>`,
        embeds: [
          new EmbedBuilder()
            .setTitle(post.map.title)
            .setURL(url)
            .setDescription(
              `by ${post.map.creator}\nWR \`${formatTime(post.map.worldRecordTicks)}\` · Author \`${m.author}s\` · Gold \`${m.gold}s\` · Silver \`${m.silver}s\` · Bronze \`${m.bronze}s\``
            )
            .setImage(post.map.previewUrl || null)
        ],
        components: [row(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Map in Workshop").setURL(url))],
        allowedMentions: { users: post.players.map((p) => p.discordId) }
      }
    }
    case "Improved": {
      const i = post.improvement
      const gain = i.previousTicks === null ? "" : ` ${formatGain(i.previousTicks - i.ticks)}`
      return {
        content: `${i.rank === 1 ? "🥇 " : ""}**P${i.rank}** ${who(i.player.discordId)} \`${formatTime(i.ticks)}\`${gain}${i.medal ? ` · ${MEDAL_NAME[i.medal]}` : ""}`,
        ...quiet
      }
    }
    case "Result":
      return {
        content: post.standings.every((s) => s.rank === null) ? "**Final result:** no finishers" : `**Final result**\n${standingLines(post.standings)}`,
        ...quiet
      }
  }
}

// ---------------------------------------------------------------- New Match (Type First), privately

export const pickTypeMessage = (): BaseMessageOptions => ({
  content: "**What kind of Match?**",
  components: [
    row(
      button("Public 1v1", { _tag: "PickType", type: "public" }, ButtonStyle.Primary),
      button("Challenge", { _tag: "PickType", type: "challenge" }, ButtonStyle.Primary),
      button("Lobby", { _tag: "PickType", type: "lobby" }, ButtonStyle.Primary)
    )
  ]
})

export const pickTargetMessage = (): BaseMessageOptions => ({
  content: "**Challenge · who?**",
  components: [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(controlId({ _tag: "PickTarget" })).setPlaceholder("Pick a Player").setMaxValues(1)
    )
  ]
})

export const pickDurationMessage = (type: MatchType, target: string | null, chosen: Minutes | null): BaseMessageOptions => {
  const durations = DURATIONS.map((minutes) =>
    button(`${minutes}m`, { _tag: "PickDuration", type, target, minutes }, minutes === chosen ? ButtonStyle.Primary : ButtonStyle.Secondary)
  )
  return {
    content: `**${TYPE_NAME[type]}${target ? ` vs ${who(target)}` : ""} · how long?**`,
    components: [
      row(...durations.slice(0, 4)),
      row(...durations.slice(4)),
      row(
        button(
          "Open Invite",
          { _tag: "OpenInvite", type, target, minutes: chosen ?? DURATIONS[0] },
          ButtonStyle.Success,
          chosen === null
        )
      )
    ],
    allowedMentions: { parse: [] }
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

export const linkPreviewMessage = (p: ProfilePreview): BaseMessageOptions => ({
  content: "**Is this your Steam account?**",
  embeds: [
    new EmbedBuilder()
      .setTitle(p.personaName)
      .setURL(`https://steamcommunity.com/profiles/${p.steamId}`)
      .setDescription(`SteamID ${p.steamId} · times on ${p.campaignTracks} campaign Tracks`)
      .setThumbnail(p.avatarUrl || null)
  ],
  components: [row(button("Yes, link it", { _tag: "ConfirmLink" }, ButtonStyle.Success), button("Try again", { _tag: "LinkSteam" }))]
})

export const tryAgainMessage = (text: string): BaseMessageOptions => ({
  content: text,
  embeds: [],
  components: [row(button("Try again", { _tag: "LinkSteam" }))]
})
