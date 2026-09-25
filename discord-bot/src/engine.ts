// The Match engine: every Match rule, with Discord, Steam and storage behind ports.
// Inputs are Player actions (the methods below) and the clock; outputs go to Surface.
import { Clock, Data, Effect, FiberMap, Option, Random, Schedule } from "effect"
import {
  expiresAt,
  fitsDuration,
  inMatch,
  medalFor,
  POLL_INTERVAL_MS,
  rankOf,
  standings,
  LOBBY_MIN_PLAYERS,
  type MapInfo,
  type Match,
  type MatchType,
  type Minutes,
  type Player
} from "./domain.js"
import {
  Steam,
  Store,
  Surface,
  ThreadPost,
  type CardView,
  type Entry,
  type Improvement,
  type ProfilePreview,
  type RemovalReason
} from "./ports.js"

// ---------------------------------------------------------------- rejections (the Discord adapter shows each privately)

export class NotLinked extends Data.TaggedError("NotLinked")<{ readonly discordId: string }> {}
export class Busy extends Data.TaggedError("Busy")<{ readonly discordId: string }> {}
export class MatchNotFound extends Data.TaggedError("MatchNotFound")<{ readonly matchId: string }> {}
export class NotOpen extends Data.TaggedError("NotOpen")<{ readonly matchId: string }> {}
export class NotAllowed extends Data.TaggedError("NotAllowed")<{ readonly reason: string }> {}
export class NotEnoughPlayers extends Data.TaggedError("NotEnoughPlayers")<{ readonly count: number }> {}
export class NoEligibleMap extends Data.TaggedError("NoEligibleMap")<{ readonly matchId: string }> {}

export interface InviteRequest {
  readonly type: MatchType
  readonly minutes: Minutes
  /** The challenged member's Discord id; required for a Challenge, ignored otherwise. */
  readonly opponent: string | null
}

/** Steam reads during a Match: retried a few times, spaced, before giving up on that read. */
const END_READ_RETRIES = 5
const END_READ_SPACING = "10 seconds"

export class Engine extends Effect.Service<Engine>()("multiballs/Engine", {
  scoped: Effect.gen(function* () {
    const steam = yield* Steam
    const surface = yield* Surface
    const store = yield* Store
    const lock = yield* Effect.makeSemaphore(1)
    const timers = yield* FiberMap.make<string>()
    const locked = lock.withPermits(1)

    // ---------------------------------------------------------------- helpers

    const cardOf = (m: Match): CardView => ({
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
    const show = (m: Match) => surface.showCard(cardOf(m))

    const playerOf = (discordId: string) =>
      store.getLink(discordId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new NotLinked({ discordId })),
            onSome: (l): Effect.Effect<Player> => Effect.succeed({ discordId, steamId: l.steamId })
          })
        )
      )

    /** One open Invite or live Match per Player. */
    const assertFree = Effect.fn("assertFree")(function* (discordId: string) {
      const active = yield* store.activeMatches
      if (active.some((m) => inMatch(m, discordId))) return yield* new Busy({ discordId })
    })

    const getMatch = (matchId: string) =>
      store.getMatch(matchId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new MatchNotFound({ matchId })),
            onSome: (m) => Effect.succeed(m)
          })
        )
      )
    const getInvite = (matchId: string) =>
      getMatch(matchId).pipe(
        Effect.filterOrFail(
          (m) => m.state === "invite",
          () => new NotOpen({ matchId })
        )
      )

    const dropInvite = Effect.fn("dropInvite")(function* (matchId: string, reason: RemovalReason) {
      yield* store.deleteMatch(matchId)
      yield* surface.remove(matchId, reason)
    })

    // ---------------------------------------------------------------- Invite expiry

    const expire = (matchId: string) =>
      locked(
        Effect.gen(function* () {
          const m = yield* store.getMatch(matchId)
          if (Option.isSome(m) && m.value.state === "invite") yield* dropInvite(matchId, "expired")
        })
      )

    const scheduleExpiry = Effect.fn("scheduleExpiry")(function* (m: Match) {
      const now = yield* Clock.currentTimeMillis
      yield* FiberMap.run(timers, m.id, Effect.sleep(Math.max(0, expiresAt(m) - now)).pipe(Effect.zipRight(expire(m.id))))
    })

    // ---------------------------------------------------------------- Map selection

    /** A random Map no Player in the Match has Played, fitting its duration. */
    const pickMap = Effect.fn("pickMap")(function* (m: Match) {
      const catalogue = yield* steam.catalogue
      const shuffled = yield* Random.shuffle(catalogue.filter((map) => fitsDuration(map, m.minutes)))
      const steamIds = m.players.map((p) => p.steamId)
      for (const map of shuffled) {
        if (map.boardId === null) continue
        const entries = yield* steam.readPlayers(map.boardId, steamIds).pipe(Effect.retry({ times: 2 }))
        if (entries.length === 0) return map
      }
      return yield* new NoEligibleMap({ matchId: m.id })
    })

    // ---------------------------------------------------------------- the live Match

    /** Fold a Steam read into the Match, posting each Improvement. Slower times first, so ranks read naturally. */
    const applyEntries = Effect.fn("applyEntries")(function* (start: Match, entries: ReadonlyArray<Entry>) {
      const map = start.map
      if (map === null) return start
      const ids = new Set(start.players.map((p) => p.steamId))
      const improvements: Array<Improvement> = []
      let m = start
      for (const e of [...entries].filter((x) => ids.has(x.steamId)).sort((a, b) => b.ticks - a.ticks)) {
        const previousTicks = m.best[e.steamId] ?? null
        if (previousTicks !== null && e.ticks >= previousTicks) continue
        const previousRank = rankOf(m, e.steamId)
        m = { ...m, best: { ...m.best, [e.steamId]: e.ticks } }
        const player = m.players.find((p) => p.steamId === e.steamId)
        if (player === undefined) continue
        improvements.push({
          player,
          ticks: e.ticks,
          medal: medalFor(e.ticks, map.medals),
          rank: rankOf(m, e.steamId) ?? 1,
          previousTicks,
          previousRank
        })
      }
      if (improvements.length === 0) return m
      yield* store.putMatch(m)
      for (const improvement of improvements) yield* surface.post(m.id, ThreadPost.Improved({ improvement }))
      yield* show(m)
      return m
    })

    const readMatch = (m: Match) =>
      m.map?.boardId == null
        ? Effect.succeed<ReadonlyArray<Entry>>([])
        : steam.readPlayers(
            m.map.boardId,
            m.players.map((p) => p.steamId)
          )

    /** One poll. A failed read is logged and the next poll tries again; it never ends the Match. */
    const poll = (matchId: string) =>
      Effect.gen(function* () {
        const m = yield* getMatch(matchId)
        const entries = yield* readMatch(m)
        yield* locked(
          Effect.gen(function* () {
            const current = yield* getMatch(matchId)
            if (current.state === "live") yield* applyEntries(current, entries)
          })
        )
      }).pipe(Effect.catchAll((e) => Effect.logWarning(`poll ${matchId} failed: ${e._tag}`)))

    /** The end: one final read (retried), then the Result. If Steam stays down, the last polled times stand. */
    const finish = (matchId: string) =>
      Effect.gen(function* () {
        const m = yield* getMatch(matchId)
        const entries = yield* readMatch(m).pipe(
          Effect.retry({ times: END_READ_RETRIES, schedule: Schedule.spaced(END_READ_SPACING) }),
          Effect.option
        )
        yield* locked(
          Effect.gen(function* () {
            const current = yield* getMatch(matchId)
            if (current.state !== "live") return
            const read = Option.isSome(entries) ? yield* applyEntries(current, entries.value) : current
            const done: Match = { ...read, state: "finished" }
            yield* store.putMatch(done)
            yield* show(done)
            yield* surface.post(done.id, ThreadPost.Result({ standings: standings(done) }))
          })
        )
      }).pipe(Effect.catchAll((e) => Effect.logError(`finish ${matchId} failed: ${e._tag}`)))

    /** Poll every 10 s until the duration runs out, then finish. Resumable after a restart. */
    const runLive = (matchId: string) =>
      Effect.gen(function* () {
        while (true) {
          const m = yield* store.getMatch(matchId)
          if (Option.isNone(m) || m.value.state !== "live" || m.value.endsAt === null) return
          const now = yield* Clock.currentTimeMillis
          if (now >= m.value.endsAt) return yield* finish(matchId)
          const next = Math.min(now + POLL_INTERVAL_MS, m.value.endsAt)
          yield* Effect.sleep(next - now)
          if (next < m.value.endsAt) yield* poll(matchId)
        }
      })

    /** Invite → live: draw the Map, ping, start the clock. Called with the lock held. */
    const begin = Effect.fn("begin")(function* (m: Match, accepted: Player | null) {
      const map: MapInfo = yield* pickMap(m).pipe(
        Effect.tapError((e) =>
          e._tag === "NoEligibleMap" ? FiberMap.remove(timers, m.id).pipe(Effect.zipRight(dropInvite(m.id, "noEligibleMap"))) : Effect.void
        )
      )
      if (accepted !== null) yield* surface.post(m.id, ThreadPost.Joined({ player: accepted }))
      const now = yield* Clock.currentTimeMillis
      const live: Match = { ...m, state: "live", startedAt: now, endsAt: now + m.minutes * 60_000, map, best: {} }
      yield* store.putMatch(live)
      yield* show(live)
      yield* surface.post(live.id, ThreadPost.Started({ players: live.players, map, endsAt: now + m.minutes * 60_000 }))
      yield* FiberMap.run(timers, live.id, runLive(live.id))
    })

    // ---------------------------------------------------------------- restart recovery

    for (const m of yield* store.activeMatches) {
      const now = yield* Clock.currentTimeMillis
      if (m.state === "invite") {
        if (now >= expiresAt(m)) yield* dropInvite(m.id, "expired")
        else yield* scheduleExpiry(m)
      } else {
        yield* FiberMap.run(timers, m.id, runLive(m.id))
      }
    }

    // ---------------------------------------------------------------- Player actions

    return {
      /** Link Steam, step 1: find the account a member pasted. Nothing is saved yet. */
      previewLink: (input: string) => steam.resolveProfile(input),

      /** Link Steam, step 2: the member confirmed the preview. Not allowed mid-Match. */
      confirmLink: (discordId: string, preview: ProfilePreview) =>
        locked(
          Effect.gen(function* () {
            yield* assertFree(discordId)
            yield* store.putLink({ discordId, steamId: preview.steamId, personaName: preview.personaName })
          })
        ),

      openInvite: (discordId: string, request: InviteRequest) =>
        locked(
          Effect.gen(function* () {
            const creator = yield* playerOf(discordId)
            yield* assertFree(discordId)
            let target: Player | null = null
            if (request.type === "challenge") {
              if (request.opponent === null) return yield* new NotAllowed({ reason: "A Challenge needs an opponent." })
              if (request.opponent === discordId) return yield* new NotAllowed({ reason: "You can't challenge yourself." })
              target = yield* playerOf(request.opponent)
              yield* assertFree(request.opponent)
            }
            const m: Match = {
              id: yield* store.nextMatchId,
              type: request.type,
              minutes: request.minutes,
              creator,
              target,
              players: [creator],
              state: "invite",
              createdAt: yield* Clock.currentTimeMillis,
              startedAt: null,
              endsAt: null,
              map: null,
              best: {}
            }
            yield* store.putMatch(m)
            yield* show(m)
            yield* surface.post(m.id, ThreadPost.Opened({ by: creator, type: m.type, minutes: m.minutes }))
            if (target !== null) yield* surface.post(m.id, ThreadPost.Challenged({ by: creator, target }))
            yield* scheduleExpiry(m)
            return m.id
          })
        ),

      /** Public 1v1: anyone but the creator. Challenge: only the named Player. Starts the Match. */
      accept: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type === "lobby") return yield* new NotAllowed({ reason: "Use Join for a Lobby." })
            if (inMatch(m, discordId)) return yield* new NotAllowed({ reason: "This is your own Invite." })
            if (m.type === "challenge" && m.target?.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the challenged Player can accept." })
            const player = yield* playerOf(discordId)
            yield* assertFree(discordId)
            const full: Match = { ...m, players: [...m.players, player] }
            yield* begin(full, player)
          })
        ),

      decline: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "challenge" || m.target?.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the challenged Player can decline." })
            yield* FiberMap.remove(timers, matchId)
            yield* dropInvite(matchId, "declined")
          })
        ),

      join: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "lobby") return yield* new NotAllowed({ reason: "Only a Lobby can be joined." })
            if (inMatch(m, discordId)) return yield* new NotAllowed({ reason: "You're already in this Lobby." })
            const player = yield* playerOf(discordId)
            yield* assertFree(discordId)
            const next: Match = { ...m, players: [...m.players, player] }
            yield* store.putMatch(next)
            yield* show(next)
            yield* surface.post(matchId, ThreadPost.Joined({ player }))
          })
        ),

      leave: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "lobby" || !inMatch(m, discordId))
              return yield* new NotAllowed({ reason: "You're not in this Lobby." })
            if (m.creator.discordId === discordId) return yield* new NotAllowed({ reason: "Cancel the Lobby instead." })
            const player = m.players.find((p) => p.discordId === discordId)
            const next: Match = { ...m, players: m.players.filter((p) => p.discordId !== discordId) }
            yield* store.putMatch(next)
            yield* show(next)
            if (player !== undefined) yield* surface.post(matchId, ThreadPost.Left({ player }))
          })
        ),

      /** Lobby only: its creator starts it, with at least two Players. */
      start: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "lobby" || m.creator.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the Lobby's creator can start it." })
            if (m.players.length < LOBBY_MIN_PLAYERS) return yield* new NotEnoughPlayers({ count: m.players.length })
            yield* begin(m, null)
          })
        ),

      cancel: (discordId: string, matchId: string) =>
        locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.creator.discordId !== discordId) return yield* new NotAllowed({ reason: "Only the creator can cancel." })
            yield* FiberMap.remove(timers, matchId)
            yield* dropInvite(matchId, "cancelled")
          })
        )
    } as const
  })
}) {}
