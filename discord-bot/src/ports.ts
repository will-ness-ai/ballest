// The engine's edges. Real adapters (steam-user, discord.js, SQLite) and test fakes both
// implement these; the engine never sees Discord ids or Steam protobufs.
import { Context, Data, type Effect, type Option } from "effect"
import { expiresAt, standings } from "./domain.js"
import type { DrawnMap, Link, MapInfo, Match, MatchState, MatchType, MedalKind, Minutes, PbEvent, Player, Standing } from "./domain.js"

// ---------------------------------------------------------------- Steam

export class SteamUnavailable extends Data.TaggedError("SteamUnavailable")<{ readonly reason: string }> {}
export class ProfileNotFound extends Data.TaggedError("ProfileNotFound")<{ readonly input: string; readonly reason: string }> {}

export interface Entry {
  readonly steamId: string
  readonly ticks: number
}

/** What a candidate Map's board says, for the Eligible Map check. */
export interface MapCheck {
  /** Null when no board exists yet: nobody has finished the Map. */
  readonly boardId: number | null
  readonly worldRecordTicks: number | null
  /** The asked-about Players who hold a time on it, with that time: their PB. */
  readonly played: ReadonlyArray<Entry>
}

export interface ProfilePreview {
  readonly steamId: string
  readonly personaName: string
  readonly avatarUrl: string
  /** How many of the Circuit Tracks this account holds a time on (the Link confirmation shows it). */
  readonly campaignTracks: number
  /** How many Circuit Tracks there are. */
  readonly campaignTrackTotal: number
}

export class Steam extends Context.Tag("multiballs/Steam")<
  Steam,
  {
    /** Every Workshop Map, from the Workshop list alone (no board reads). */
    readonly catalogue: Effect.Effect<ReadonlyArray<MapInfo>, SteamUnavailable>
    /** One candidate Map's board: its id, world record, and which of these Players have Played it. */
    readonly check: (map: MapInfo, steamIds: ReadonlyArray<string>) => Effect.Effect<MapCheck, SteamUnavailable>
    /** The given Players' entries on a board; Players without an entry are simply absent. */
    readonly readPlayers: (
      boardId: number,
      steamIds: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Entry>, SteamUnavailable>
    /** A pasted profile link, custom URL name or SteamID64, resolved to an account. */
    readonly resolveProfile: (input: string) => Effect.Effect<ProfilePreview, ProfileNotFound | SteamUnavailable>
  }
>() {}

// ---------------------------------------------------------------- Discord surface

/** Everything the Match Card image and its embed are drawn from. */
export interface CardView {
  readonly matchId: string
  readonly state: MatchState
  readonly type: MatchType
  readonly minutes: Minutes
  readonly creator: Player
  readonly target: Player | null
  readonly players: ReadonlyArray<Player>
  readonly map: DrawnMap | null
  readonly standings: ReadonlyArray<Standing>
  /** Shown as a live Discord timestamp while the Invite is open. */
  readonly expiresAt: number | null
  /** Shown as a live Discord timestamp while the Match is live. */
  readonly endsAt: number | null
}

/** A Match as its Card shows it: the Map stays sealed while the Invite is open. */
export const cardView = (m: Match): CardView => ({
  matchId: m.id,
  state: m.state,
  type: m.type,
  minutes: m.minutes,
  creator: m.creator,
  target: m.target,
  players: m.players,
  map: m.state === "invite" ? null : m.map,
  standings: standings(m),
  expiresAt: m.state === "invite" ? expiresAt(m) : null,
  endsAt: m.state === "live" ? m.endsAt : null
})

export interface Improvement {
  readonly player: Player
  readonly ticks: number
  readonly medal: MedalKind | null
  /** Rank within the Match after this time; 1 is drawn gold. */
  readonly rank: number
  readonly previousTicks: number | null
  readonly previousRank: number | null
  /** The world record this run beat, as it stood at that moment; null if it didn't beat one. */
  readonly beatWorldRecord: number | null
}

export type ThreadPost = Data.TaggedEnum<{
  Opened: { readonly by: Player; readonly type: MatchType; readonly minutes: Minutes }
  /** `expiresAt` is when the challenged Player must answer by. */
  Challenged: { readonly by: Player; readonly target: Player; readonly minutes: Minutes; readonly expiresAt: number }
  Accepted: { readonly player: Player }
  Joined: { readonly player: Player }
  Left: { readonly player: Player }
  /**
   * The start ping. `players` are the ones sent off, and pinged: everyone at the start, or
   * one Player joining a live Lobby. `card` is the live Card it shows.
   */
  Started: { readonly players: ReadonlyArray<Player>; readonly map: DrawnMap; readonly endsAt: number; readonly card: CardView }
  Improved: { readonly improvement: Improvement }
  /** `card` is the finished Card the Result shows. */
  /** Players who had finished the drawn Map before: only a run faster than `ticks`, their PB, counts. */
  PlayedBefore: { readonly bars: ReadonlyArray<{ readonly player: Player; readonly ticks: number }> }
  /** After the Result: every PB of the Match over time, for the progression graph. */
  Progression: { readonly card: CardView; readonly history: ReadonlyArray<PbEvent> }
  Result: { readonly standings: ReadonlyArray<Standing>; readonly card: CardView }
  /** No Map is eligible, so the Invite is cancelled; everyone in it is told. */
  NoMap: { readonly players: ReadonlyArray<Player> }
  /** Every Player left the live Match before anyone set a time, so it is cancelled. */
  Abandoned: {}
}>
export const ThreadPost = Data.taggedEnum<ThreadPost>()

/** Why a cancelled Match keeps its Card and thread: no Map was eligible, or everyone left before setting a time. */
export type KeptReason = "noEligibleMap" | "abandoned"
export type RemovalReason = "expired" | "cancelled" | "declined" | KeptReason
export const isKept = (reason: RemovalReason): reason is KeptReason => reason === "noEligibleMap" || reason === "abandoned"

export class Surface extends Context.Tag("multiballs/Surface")<
  Surface,
  {
    /** Create or redraw a Match's Card (the adapter handles the Footer and the Match Thread). */
    readonly showCard: (view: CardView) => Effect.Effect<void>
    readonly post: (matchId: string, post: ThreadPost) => Effect.Effect<void>
    /**
     * A Match that ends without a Result: an Invite that never started, or a live Match
     * everyone left before setting a time. Its Card and Match Thread go, unless the reason
     * is a KeptReason: then they stay, saying why, so the Players can read it.
     */
    readonly remove: (matchId: string, reason: RemovalReason) => Effect.Effect<void>
  }
>() {}

/** Where a Match sits in the channel: its Card's message, and its Match Thread once started. */
export interface MatchPlace {
  readonly messageId: string
  readonly threadId: string | null
}

/** Where each Match's Card and Match Thread are, so the Activity can link to them. */
export class MatchLinks extends Context.Tag("multiballs/MatchLinks")<
  MatchLinks,
  {
    /** None when the channel holds no Card for it (yet, or any more). */
    readonly of: (matchId: string) => Effect.Effect<Option.Option<MatchPlace>>
  }
>() {}

// ---------------------------------------------------------------- the ping role

/** Discord wouldn't read or change a member's @Multiplayer ping role just now. */
export class PingRoleUnavailable extends Data.TaggedError("PingRoleUnavailable")<{ readonly reason: string }> {}

/**
 * The @Multiplayer ping role on the server: the one role the bot ever adds or removes. Every
 * read asks Discord, so a moderator's change shows at once.
 */
export class PingRole extends Context.Tag("multiballs/PingRole")<
  PingRole,
  {
    readonly has: (discordId: string) => Effect.Effect<boolean, PingRoleUnavailable>
    readonly add: (discordId: string) => Effect.Effect<void, PingRoleUnavailable>
    readonly remove: (discordId: string) => Effect.Effect<void, PingRoleUnavailable>
  }
>() {}

// ---------------------------------------------------------------- Store

export class Store extends Context.Tag("multiballs/Store")<
  Store,
  {
    readonly getLink: (discordId: string) => Effect.Effect<Option.Option<Link>>
    readonly putLink: (link: Link) => Effect.Effect<void>
    /** Every Link, for picking who to challenge. */
    readonly links: Effect.Effect<ReadonlyArray<Link>>
    readonly nextMatchId: Effect.Effect<string>
    readonly getMatch: (id: string) => Effect.Effect<Option.Option<Match>>
    readonly putMatch: (match: Match) => Effect.Effect<void>
    readonly deleteMatch: (id: string) => Effect.Effect<void>
    /** Matches still open as an Invite or live. */
    readonly activeMatches: Effect.Effect<ReadonlyArray<Match>>
    /** Whether this member has answered the @Multiplayer ping offer, either way. */
    readonly hasAnsweredPingOffer: (discordId: string) => Effect.Effect<boolean>
    /** Remember that this member has answered the offer; answering again changes nothing. */
    readonly answerPingOffer: (discordId: string) => Effect.Effect<void>
  }
>() {}
