// The engine's edges. Real adapters (steam-user, discord.js, SQLite) and test fakes both
// implement these; the engine never sees Discord ids or Steam protobufs.
import { Context, Data, type Effect, type Option } from "effect"
import type { Link, MapInfo, Match, MatchState, MatchType, MedalKind, Minutes, Player, Standing } from "./domain.js"

// ---------------------------------------------------------------- Steam

export class SteamUnavailable extends Data.TaggedError("SteamUnavailable")<{ readonly reason: string }> {}
export class ProfileNotFound extends Data.TaggedError("ProfileNotFound")<{ readonly input: string; readonly reason: string }> {}

export interface Entry {
  readonly steamId: string
  readonly ticks: number
}

export interface ProfilePreview {
  readonly steamId: string
  readonly personaName: string
  readonly avatarUrl: string
  /** How many of the campaign Tracks this account holds a time on (the Link confirmation shows it). */
  readonly campaignTracks: number
}

export class Steam extends Context.Tag("multiballs/Steam")<
  Steam,
  {
    /** Every Workshop Map with its board, Medal times and world record. */
    readonly catalogue: Effect.Effect<ReadonlyArray<MapInfo>, SteamUnavailable>
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
  readonly map: MapInfo | null
  readonly standings: ReadonlyArray<Standing>
  /** Shown as a live Discord timestamp while the Invite is open. */
  readonly expiresAt: number | null
  /** Shown as a live Discord timestamp while the Match is live. */
  readonly endsAt: number | null
}

export interface Improvement {
  readonly player: Player
  readonly ticks: number
  readonly medal: MedalKind | null
  /** Rank within the Match after this time; 1 is drawn gold. */
  readonly rank: number
  readonly previousTicks: number | null
  readonly previousRank: number | null
}

export type ThreadPost = Data.TaggedEnum<{
  Opened: { readonly by: Player; readonly type: MatchType; readonly minutes: Minutes }
  Challenged: { readonly by: Player; readonly target: Player }
  Accepted: { readonly player: Player }
  Joined: { readonly player: Player }
  Left: { readonly player: Player }
  Started: { readonly players: ReadonlyArray<Player>; readonly map: MapInfo; readonly endsAt: number }
  Improved: { readonly improvement: Improvement }
  Result: { readonly standings: ReadonlyArray<Standing> }
}>
export const ThreadPost = Data.taggedEnum<ThreadPost>()

export type RemovalReason = "expired" | "cancelled" | "declined" | "noEligibleMap"

export class Surface extends Context.Tag("multiballs/Surface")<
  Surface,
  {
    /** Create or redraw a Match's Card (the adapter handles the Footer and the Match Thread). */
    readonly showCard: (view: CardView) => Effect.Effect<void>
    readonly post: (matchId: string, post: ThreadPost) => Effect.Effect<void>
    /** An Invite that never became a Match: its Card and Match Thread go. */
    readonly remove: (matchId: string, reason: RemovalReason) => Effect.Effect<void>
  }
>() {}

// ---------------------------------------------------------------- Store

export class Store extends Context.Tag("multiballs/Store")<
  Store,
  {
    readonly getLink: (discordId: string) => Effect.Effect<Option.Option<Link>>
    readonly putLink: (link: Link) => Effect.Effect<void>
    readonly nextMatchId: Effect.Effect<string>
    readonly getMatch: (id: string) => Effect.Effect<Option.Option<Match>>
    readonly putMatch: (match: Match) => Effect.Effect<void>
    readonly deleteMatch: (id: string) => Effect.Effect<void>
    /** Matches still open as an Invite or live. */
    readonly activeMatches: Effect.Effect<ReadonlyArray<Match>>
  }
>() {}
