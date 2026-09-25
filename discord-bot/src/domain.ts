// The Match domain: plain data and pure rules. Terms follow CONTEXT.md at the repo root.

/** Steam scores on Map boards are run times in hundred-thousandths of a second (see CLAUDE.md). */
export const SCORE_TICKS_PER_SECOND = 100_000

export type MatchType = "public" | "challenge" | "lobby"

export const DURATIONS = [5, 10, 15, 20, 30, 45, 60] as const
export type Minutes = (typeof DURATIONS)[number]

export const INVITE_TTL_MS = 5 * 60_000
export const POLL_INTERVAL_MS = 10_000
export const LOBBY_MIN_PLAYERS = 2

export type MedalKind = "bronze" | "silver" | "gold" | "author"

/** A Map's Medal targets, in seconds, as its Workshop metadata publishes them. */
export interface Medals {
  readonly bronze: number
  readonly silver: number
  readonly gold: number
  readonly author: number
}

export interface MapInfo {
  readonly pfid: string
  readonly title: string
  readonly creator: string
  readonly previewUrl: string
  /** Steam leaderboard id; null when nobody has finished the Map yet (no board exists). */
  readonly boardId: number | null
  readonly medals: Medals
  /** Rank-1 time on the board, null with no board. */
  readonly worldRecordTicks: number | null
}

export interface Player {
  readonly discordId: string
  readonly steamId: string
}

export interface Link {
  readonly discordId: string
  readonly steamId: string
  readonly personaName: string
}

export type MatchState = "invite" | "live" | "finished"

export interface Match {
  readonly id: string
  readonly type: MatchType
  readonly minutes: Minutes
  readonly creator: Player
  /** The named Player of a Challenge. */
  readonly target: Player | null
  /** Everyone in the Match, creator first. A Challenge's target joins on Accept. */
  readonly players: ReadonlyArray<Player>
  readonly state: MatchState
  readonly createdAt: number
  readonly startedAt: number | null
  readonly endsAt: number | null
  readonly map: MapInfo | null
  /** Best time (ticks) each Player set during the Match, by SteamID. */
  readonly best: Readonly<Record<string, number>>
}

export const expiresAt = (m: Match): number => m.createdAt + INVITE_TTL_MS

export const inMatch = (m: Match, discordId: string): boolean => m.players.some((p) => p.discordId === discordId)

export const seconds = (ticks: number): number => ticks / SCORE_TICKS_PER_SECOND

/** The best Medal whose target the time meets, or null. */
export const medalFor = (ticks: number, medals: Medals): MedalKind | null => {
  const s = seconds(ticks)
  if (s <= medals.author) return "author"
  if (s <= medals.gold) return "gold"
  if (s <= medals.silver) return "silver"
  if (s <= medals.bronze) return "bronze"
  return null
}

/** Eligible Map rules that need no per-Player read: world record 5 s–5 min, author time ≤ duration / 10. */
export const fitsDuration = (map: MapInfo, minutes: Minutes): boolean => {
  if (map.boardId === null || map.worldRecordTicks === null) return false
  const wr = seconds(map.worldRecordTicks)
  return wr > 5 && wr < 300 && map.medals.author <= (minutes * 60) / 10
}

export interface Standing {
  readonly player: Player
  readonly ticks: number | null
  /** 1-based; equal times share a rank. Null for a Player with no time. */
  readonly rank: number | null
  readonly medal: MedalKind | null
}

/** Players ranked by best time; ties share a rank, Players with no time come last. */
export const standings = (m: Match): ReadonlyArray<Standing> => {
  const timed = m.players.filter((p) => m.best[p.steamId] !== undefined)
  const untimed = m.players.filter((p) => m.best[p.steamId] === undefined)
  const time = (p: Player): number => m.best[p.steamId] ?? Infinity
  const sorted = [...timed].sort((a, b) => time(a) - time(b))
  return [
    ...sorted.map((p) => ({
      player: p,
      ticks: time(p),
      rank: 1 + sorted.filter((q) => time(q) < time(p)).length,
      medal: m.map ? medalFor(time(p), m.map.medals) : null
    })),
    ...untimed.map((p) => ({ player: p, ticks: null, rank: null, medal: null }))
  ]
}

export const rankOf = (m: Match, steamId: string): number | null =>
  standings(m).find((s) => s.player.steamId === steamId)?.rank ?? null
