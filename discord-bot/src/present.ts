// The words both surfaces share, and what a Match looks like in words and rows: the channel
// (the Card image in render/scenes.ts, the forms in discord/messages.ts) and the Activity page
// (activity/web/view.ts) only lay these out.
// Pure, and free of Node, so the page's bundle uses it as it is.
import { formatTime, MATCH_TYPE_NAME, SCORE_TICKS_PER_SECOND, type MedalKind } from "./domain.js"
import type { CardView } from "./ports.js"

/** A name for each Discord id; whoever can't be named is "Player". */
export type NameOf = (discordId: string) => string

/** One row of the Board Slab. */
export interface BoardRow {
  /** Null for an empty seat. */
  readonly discordId: string | null
  /** The marble's SteamID; null for an empty seat. */
  readonly steamId: string | null
  /** A slot number on an Invite, a rank once live ("–" for no time). */
  readonly rank: string
  /** 1 to 3 are drawn gold, silver and bronze; null is drawn dim. */
  readonly place: number | null
  /** Someone who isn't in the Match yet: an empty seat, or a Challenge's opponent. */
  readonly faded: boolean
  readonly name: string
  /** Under the name: how they got here, or how they stand. */
  readonly note: string
  /** "ready" on an Invite, then the time, "—" for none yet, "DNF" for none at the end. */
  readonly score: string
  readonly medal: MedalKind | null
  /** Holds the world record, set during the Match: a WR ribbon replaces the Medal. */
  readonly worldRecord: boolean
}

/** A gap between two times, in seconds to the thousandth. */
export const formatGap = (ticks: number) => (ticks / SCORE_TICKS_PER_SECOND).toFixed(3)

/** The Board Slab's rows: an Invite's seats, or the standings once the Map is drawn. */
export const boardRows = (view: CardView, nameOf: NameOf): ReadonlyArray<BoardRow> => {
  if (view.state === "invite") {
    const rows: Array<BoardRow> = view.players.map((p, i) => ({
      discordId: p.discordId,
      steamId: p.steamId,
      rank: String(i + 1),
      place: null,
      faded: false,
      name: nameOf(p.discordId),
      note: i === 0 ? "opened the Invite" : "joined",
      score: "ready",
      medal: null,
      worldRecord: false
    }))
    const seat = { rank: String(rows.length + 1), place: null, faded: true, score: "—", medal: null, worldRecord: false }
    if (view.type === "public") rows.push({ ...seat, discordId: null, steamId: null, name: "Open slot", note: "first to accept" })
    if (view.type === "challenge" && view.target !== null)
      rows.push({ ...seat, discordId: view.target.discordId, steamId: view.target.steamId, name: nameOf(view.target.discordId), note: "hasn't answered" })
    return rows
  }
  const live = view.state === "live"
  const leader = view.standings[0]?.ticks ?? null
  const personalBests = view.map?.personalBests ?? {}
  /** What a Player without a counted time is told, which differs for one who must beat their PB. */
  const untimed = (steamId: string) => {
    const pb = personalBests[steamId]
    if (pb === undefined) return live ? "no time yet" : "did not finish"
    return live ? `must beat their PB ${formatTime(pb)}` : `didn't beat their PB ${formatTime(pb)}`
  }
  return view.standings.map((s) => ({
    discordId: s.player.discordId,
    steamId: s.player.steamId,
    rank: s.rank === null ? "–" : String(s.rank),
    place: s.rank,
    faded: false,
    name: nameOf(s.player.discordId),
    note:
      s.ticks === null
        ? untimed(s.player.steamId)
        : s.rank === 1
          ? live
            ? "leads"
            : "wins"
          : leader === null
            ? ""
            : `+${formatGap(s.ticks - leader)} behind`,
    score: s.ticks === null ? (live ? "—" : "DNF") : formatTime(s.ticks),
    medal: s.medal,
    worldRecord: s.rank === 1 && s.ticks !== null && view.map !== null && s.ticks < view.map.worldRecordTicks
  }))
}

/** The Match's big title: its Map, or "Map pending" until the draw. */
export const mapTitle = (view: CardView) => (view.map === null || view.state === "invite" ? "Map pending" : view.map.title)

/** The line under the title: the Map's creator and world record once drawn. */
export const matchDetails = (view: CardView) =>
  view.map === null || view.state === "invite"
    ? `${MATCH_TYPE_NAME[view.type]} · ${view.minutes} min · drawn at the start`
    : `by ${view.map.creator} · ${MATCH_TYPE_NAME[view.type]} · ${view.minutes} min · WR ${formatTime(view.map.worldRecordTicks)}`

/** Whose Match it is: "kiko v Rollo" for a Challenge, else "kiko's Lobby". */
export const matchName = (view: CardView, nameOf: NameOf) =>
  view.type === "challenge" && view.target !== null
    ? `${nameOf(view.creator.discordId)} v ${nameOf(view.target.discordId)}`
    : `${nameOf(view.creator.discordId)}'s ${MATCH_TYPE_NAME[view.type]}`

/** A run of how-to text: plain words, a word from Steam's own menus, or an example link. */
export type HowtoPart = string | { readonly menu: string } | { readonly example: string }

/**
 * Where to find the link Link Steam asks for; Steam hides it behind a right-click. Each
 * surface draws the menu words and examples its own way (Discord markdown, or HTML).
 */
export const STEAM_LINK_HOWTO: {
  readonly steps: ReadonlyArray<ReadonlyArray<HowtoPart>>
  readonly looksLike: ReadonlyArray<HowtoPart>
  readonly notThis: string
} = {
  steps: [
    ["In Steam, hover your name at the top and pick ", { menu: "Profile" }, "."],
    ["Right-click the page and choose ", { menu: "Copy Page URL" }, "."],
    ["Paste it below."]
  ],
  looksLike: [
    "It looks like ",
    { example: "https://steamcommunity.com/profiles/76561198…" },
    " or ",
    { example: "https://steamcommunity.com/id/yourname" }
  ],
  notThis: "Not your display name or friend code."
}
