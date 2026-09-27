// The Match domain: plain data and pure rules. Terms follow CONTEXT.md at the repo root.

/** Steam scores on Map boards are run times in hundred-thousandths of a second (see CLAUDE.md). */
export const SCORE_TICKS_PER_SECOND = 100_000

export type MatchType = "public" | "challenge" | "lobby"

/** What each Match type is called wherever a member reads it. */
export const MATCH_TYPE_NAME: Record<MatchType, string> = { public: "Public 1v1", challenge: "Challenge", lobby: "Lobby" }

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

/** A Workshop Map as the Workshop list describes it. Its board is looked up only when it's a candidate. */
export interface MapInfo {
  readonly pfid: string
  readonly title: string
  readonly creator: string
  readonly previewUrl: string
  /** The Steam leaderboard name the game gives the Map's board. */
  readonly boardName: string
  readonly medals: Medals
}

/** The Map a Match was drawn on, with the board facts checked at the draw. */
export interface DrawnMap extends MapInfo {
  readonly boardId: number
  readonly worldRecordTicks: number
  /**
   * PBs the Match's Players already held on this Map when it was drawn, keyed by SteamID;
   * empty unless every candidate had been Played. A Player's run counts only if it beats theirs.
   */
  readonly personalBests: Readonly<Record<string, number>>
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
  readonly map: DrawnMap | null
  /** Best time (ticks) each Player set during the Match, keyed by SteamID. */
  readonly bestTicks: Readonly<Record<string, number>>
  /** Every PB set during the Match, in order, for the progression graph. */
  readonly history: ReadonlyArray<PbEvent>
  /** SteamIDs of Players who left the live Match: their best time so far stands, later runs don't count. */
  readonly left: ReadonlyArray<string>
}

/** A PB set during a Match: who, the time, and when (ms after the Match started). */
export interface PbEvent {
  readonly steamId: string
  readonly ticks: number
  readonly at: number
}

/** A PB of the Match as every surface shows it: the rank it gave, the time it beat, and any world record it broke. */
export interface Progress extends PbEvent {
  /** Rank in the Match once the whole Steam read it came in on is counted; 1 is drawn gold. */
  readonly rank: number
  /** The Player's rank just before that read; null if they had no time yet. */
  readonly previousRank: number | null
  /** The time it beat: the Player's best this Match, else the PB they brought into it. */
  readonly previousTicks: number | null
  /** The world record this run beat, as it stood at that moment; null if it didn't beat one. */
  readonly beatWorldRecord: number | null
}

/**
 * Every PB of a Match in order, worked out from its history alone, so the Match Thread, the
 * graph and the Activity can't tell it differently. PBs from the same Steam read (the same `at`)
 * are ranked against the whole read, so two Players improving at once can't both be P1. A read's
 * PBs are stored slowest first, so each world-record break is measured against the WR it beat.
 */
export const progress = (map: DrawnMap, history: ReadonlyArray<PbEvent>): ReadonlyArray<Progress> => {
  const rankIn = (bests: ReadonlyMap<string, number>, ticks: number) => 1 + [...bests.values()].filter((t) => t < ticks).length
  const best = new Map<string, number>()
  let worldRecord = map.worldRecordTicks
  const out: Array<Progress> = []
  for (let i = 0; i < history.length; ) {
    let end = i
    while (history[end]?.at === history[i]?.at) end++
    const read = history.slice(i, end)
    const before = new Map(best)
    for (const e of read) best.set(e.steamId, e.ticks)
    for (const e of read) {
      const previous = before.get(e.steamId)
      const beat = e.ticks < worldRecord ? worldRecord : null
      if (beat !== null) worldRecord = e.ticks
      out.push({
        ...e,
        rank: rankIn(best, e.ticks),
        previousRank: previous === undefined ? null : rankIn(before, previous),
        previousTicks: previous ?? map.personalBests[e.steamId] ?? null,
        beatWorldRecord: beat
      })
    }
    i += read.length
  }
  return out
}

/** The world record as it stands during a Match: the one at the start, or a faster time set since. */
export const currentWorldRecord = (m: Match): number | null =>
  m.map === null ? null : Math.min(m.map.worldRecordTicks, ...m.history.map((e) => e.ticks))

export const expiresAt = (m: Match): number => m.createdAt + INVITE_TTL_MS

export const inMatch = (m: Match, discordId: string): boolean => m.players.some((p) => p.discordId === discordId)

/** The Players still racing: everyone who hasn't left. */
export const racing = (m: Match): ReadonlyArray<Player> => m.players.filter((p) => !m.left.includes(p.steamId))

/** Still racing in the Match, or named by its still-open Challenge: either way, busy. A Player who left is free. */
export const involves = (m: Match, discordId: string): boolean =>
  racing(m).some((p) => p.discordId === discordId) || (m.state === "invite" && m.target?.discordId === discordId)

/** What a Player can do to a Match: the Card's buttons. */
export type Action = "accept" | "decline" | "join" | "leave" | "start" | "cancel"
export const ACTIONS: ReadonlyArray<Action> = ["accept", "decline", "join", "leave", "start", "cancel"]

/**
 * What a member may press on a Match by its rules, for a surface that shows each member their own
 * buttons. Whether they're busy in another Match isn't checked: the engine turns that down, in words.
 */
export const actionsFor = (m: Match, discordId: string): ReadonlyArray<Action> => {
  const creator = m.creator.discordId === discordId
  const player = m.players.find((p) => p.discordId === discordId)
  if (m.state === "invite") {
    if (m.type === "lobby") return creator ? ["start", "cancel"] : player !== undefined ? ["leave"] : ["join"]
    if (creator) return ["cancel"]
    if (m.type === "challenge") return m.target?.discordId === discordId ? ["accept", "decline"] : []
    return ["accept"]
  }
  if (m.state === "live") {
    if (player !== undefined) return m.left.includes(player.steamId) ? [] : ["leave"]
    return m.type === "lobby" ? ["join"] : []
  }
  return []
}

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

/** Eligible Map rule from the Workshop list alone: author time at most a tenth of the duration. */
export const authorTimeFits = (map: MapInfo, minutes: Minutes): boolean => map.medals.author <= (minutes * 60) / 10

/** Eligible Map rule from the board: world record between 5 s and 5 min, inclusive. */
export const worldRecordFits = (worldRecordTicks: number): boolean => {
  const wr = seconds(worldRecordTicks)
  return wr >= 5 && wr <= 300
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
  const timed = m.players.filter((p) => m.bestTicks[p.steamId] !== undefined)
  const untimed = m.players.filter((p) => m.bestTicks[p.steamId] === undefined)
  const time = (p: Player): number => m.bestTicks[p.steamId] ?? Infinity
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

/** m:ss.mmm, as the leaderboard site writes times. */
export const formatTime = (ticks: number): string => {
  const totalMs = Math.round((ticks / SCORE_TICKS_PER_SECOND) * 1000)
  const m = Math.floor(totalMs / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`
}
