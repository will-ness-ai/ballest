// The Match engine: every Match rule, with Discord, Steam and storage behind ports.
// Inputs are Player actions (the methods below) and the clock; outputs go to Surface.
import { Clock, Data, Effect, FiberMap, Option, Random, Ref } from "effect"
import {
  expiresAt,
  fitsDuration,
  inMatch,
  involves,
  LOBBY_MIN_PLAYERS,
  medalFor,
  POLL_INTERVAL_MS,
  rankOf,
  standings,
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
  /** The challenged Player's Discord id; required for a Challenge, ignored otherwise. */
  readonly target: string | null
}

/**
 * The read at the end is retried straight away, never after a wait: a retry that lands
 * seconds late could count a run finished after the Match ended. If every try fails, the
 * last polled times stand.
 */
const END_READ_RETRIES = 2

export class Engine extends Effect.Service<Engine>()("multiballs/Engine", {
  scoped: Effect.gen(function* () {
    const steam = yield* Steam
    const surface = yield* Surface
    const store = yield* Store
    const lock = yield* Effect.makeSemaphore(1)
    /** Engine state changes happen one at a time. Steam reads are kept outside it. */
    const locked = lock.withPermits(1)
    const timers = yield* FiberMap.make<string>()
    /**
     * Invites whose Map is being drawn (a Steam read per candidate, outside the lock),
     * with the Players they are about to start with. Nothing else may touch them meanwhile.
     */
    const starting = yield* Ref.make(new Map<string, Match>())

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

    /** Persist a Match and redraw its Card. */
    const save = Effect.fn("save")(function* (m: Match) {
      yield* store.putMatch(m)
      yield* surface.showCard(cardOf(m))
    })

    const orFail = <A, E>(found: Effect.Effect<Option.Option<A>>, missing: () => E) =>
      found.pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(missing()),
            onSome: (a) => Effect.succeed(a)
          })
        )
      )

    const playerOf = (discordId: string) =>
      orFail(store.getLink(discordId), () => new NotLinked({ discordId })).pipe(
        Effect.map((l): Player => ({ discordId, steamId: l.steamId }))
      )

    const getMatch = (matchId: string) => orFail(store.getMatch(matchId), () => new MatchNotFound({ matchId }))

    /** An Invite that is still open and not already starting. */
    const getInvite = Effect.fn("getInvite")(function* (matchId: string) {
      const m = yield* getMatch(matchId)
      if (m.state !== "invite" || (yield* Ref.get(starting)).has(matchId)) return yield* new NotOpen({ matchId })
      return m
    })

    /** One open Invite or live Match per Player, counting a Challenge that names them and Invites mid-start. */
    const assertFree = Effect.fn("assertFree")(function* (discordId: string) {
      const active = [...(yield* store.activeMatches), ...(yield* Ref.get(starting)).values()]
      if (active.some((m) => involves(m, discordId))) return yield* new Busy({ discordId })
    })

    /** An Invite that never became a Match goes. Its expiry timer is left alone: it may be the caller. */
    const dropInvite = Effect.fn("dropInvite")(function* (matchId: string, reason: RemovalReason) {
      yield* store.deleteMatch(matchId)
      yield* surface.remove(matchId, reason)
    })

    /** Drop an Invite from outside its timer, stopping the timer too. */
    const withdrawInvite = Effect.fn("withdrawInvite")(function* (matchId: string, reason: RemovalReason) {
      yield* FiberMap.remove(timers, matchId)
      yield* dropInvite(matchId, reason)
    })

    // ---------------------------------------------------------------- Invite expiry

    const expire = Effect.fn("expire")(function* (matchId: string) {
      const m = yield* store.getMatch(matchId)
      const isStarting = (yield* Ref.get(starting)).has(matchId)
      if (Option.isSome(m) && m.value.state === "invite" && !isStarting) yield* dropInvite(matchId, "expired")
    }, locked)

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

    /**
     * Fold one Steam read into the Match and post each Improvement. Every rank is taken
     * after the whole read is applied, so two Players improving in the same poll can't
     * both be shown as P1.
     */
    const applyEntries = Effect.fn("applyEntries")(function* (before: Match, entries: ReadonlyArray<Entry>) {
      const map = before.map
      if (map === null) return before
      const changed = entries.filter((e) => {
        const previous = before.bestTicks[e.steamId]
        return before.players.some((p) => p.steamId === e.steamId) && (previous === undefined || e.ticks < previous)
      })
      if (changed.length === 0) return before
      const after: Match = {
        ...before,
        bestTicks: { ...before.bestTicks, ...Object.fromEntries(changed.map((e) => [e.steamId, e.ticks])) }
      }
      const improvements = changed
        .flatMap((e): Array<Improvement> => {
          const player = after.players.find((p) => p.steamId === e.steamId)
          return player === undefined
            ? []
            : [
                {
                  player,
                  ticks: e.ticks,
                  medal: medalFor(e.ticks, map.medals),
                  rank: rankOf(after, e.steamId) ?? 1,
                  previousTicks: before.bestTicks[e.steamId] ?? null,
                  previousRank: rankOf(before, e.steamId)
                }
              ]
        })
        .sort((a, b) => b.ticks - a.ticks)
      yield* store.putMatch(after)
      for (const improvement of improvements) yield* surface.post(after.id, ThreadPost.Improved({ improvement }))
      yield* surface.showCard(cardOf(after))
      return after
    })

    const readMatch = (m: Match) =>
      m.map?.boardId == null
        ? Effect.succeed<ReadonlyArray<Entry>>([])
        : steam.readPlayers(
            m.map.boardId,
            m.players.map((p) => p.steamId)
          )

    /** Apply a read to the Match if it is still live. */
    const applyIfLive = Effect.fn("applyIfLive")(function* (matchId: string, entries: ReadonlyArray<Entry>) {
      const current = yield* getMatch(matchId)
      return current.state === "live" ? yield* applyEntries(current, entries) : current
    }, locked)

    /** One poll. A failed read is logged and the next poll tries again; it never ends the Match. */
    const poll = Effect.fn("poll")(
      function* (matchId: string) {
        const entries = yield* readMatch(yield* getMatch(matchId))
        yield* applyIfLive(matchId, entries)
      },
      (effect, matchId) => Effect.catchAll(effect, (e) => Effect.logWarning(`poll ${matchId} failed: ${e._tag}`))
    )

    /** The end: one read, retried only immediately, then the Result. */
    const finish = Effect.fn("finish")(
      function* (matchId: string) {
        const entries = yield* readMatch(yield* getMatch(matchId)).pipe(
          Effect.retry({ times: END_READ_RETRIES }),
          Effect.option
        )
        yield* locked(
          Effect.gen(function* () {
            const current = yield* getMatch(matchId)
            if (current.state !== "live") return
            const withFinalRead = Option.isSome(entries) ? yield* applyEntries(current, entries.value) : current
            const done: Match = { ...withFinalRead, state: "finished" }
            yield* save(done)
            yield* surface.post(done.id, ThreadPost.Result({ standings: standings(done) }))
          })
        )
      },
      (effect, matchId) => Effect.catchAll(effect, (e) => Effect.logError(`finish ${matchId} failed: ${e._tag}`))
    )

    /** Poll every 10 s until the duration runs out, then finish. Resumable after a restart. */
    const runLive = Effect.fn("runLive")(function* (matchId: string) {
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

    /**
     * Invite → live. `full` is the Invite with every starting Player. The Map is drawn
     * outside the lock, with the Invite marked as starting so nothing else changes it;
     * `accepted` is the Player whose Accept started a 1v1.
     */
    const launch = Effect.fn("launch")(function* (full: Match, accepted: Player | null) {
      const map: MapInfo = yield* pickMap(full).pipe(
        Effect.tapErrorTag("NoEligibleMap", () => locked(withdrawInvite(full.id, "noEligibleMap")))
      )
      yield* locked(
        Effect.gen(function* () {
          if (accepted !== null) yield* surface.post(full.id, ThreadPost.Accepted({ player: accepted }))
          const startedAt = yield* Clock.currentTimeMillis
          const endsAt = startedAt + full.minutes * 60_000
          const live: Match = { ...full, state: "live", startedAt, endsAt, map, bestTicks: {} }
          yield* save(live)
          yield* surface.post(live.id, ThreadPost.Started({ players: live.players, map, endsAt }))
          yield* FiberMap.run(timers, live.id, runLive(live.id))
        })
      )
    }, (effect, full) => Effect.ensuring(effect, Ref.update(starting, (s) => {
      const next = new Map(s)
      next.delete(full.id)
      return next
    })))

    const markStarting = (full: Match) => Ref.update(starting, (s) => new Map(s).set(full.id, full))

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
      /** Link Steam, step 1: find the account that was pasted. Nothing is saved yet. */
      previewLink: Effect.fn("previewLink")(function* (input: string) {
        return yield* steam.resolveProfile(input)
      }),

      /** Link Steam, step 2: the preview was confirmed. Not while the Player is in a Match. */
      confirmLink: Effect.fn("confirmLink")(function* (discordId: string, preview: ProfilePreview) {
        yield* assertFree(discordId)
        yield* store.putLink({ discordId, steamId: preview.steamId, personaName: preview.personaName })
      }, locked),

      openInvite: Effect.fn("openInvite")(function* (discordId: string, request: InviteRequest) {
        const creator = yield* playerOf(discordId)
        yield* assertFree(discordId)
        let target: Player | null = null
        if (request.type === "challenge") {
          if (request.target === null) return yield* new NotAllowed({ reason: "A Challenge needs a Player to challenge." })
          if (request.target === discordId) return yield* new NotAllowed({ reason: "You can't challenge yourself." })
          target = yield* playerOf(request.target)
          yield* assertFree(request.target)
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
          bestTicks: {}
        }
        yield* save(m)
        yield* surface.post(m.id, ThreadPost.Opened({ by: creator, type: m.type, minutes: m.minutes }))
        if (target !== null) yield* surface.post(m.id, ThreadPost.Challenged({ by: creator, target }))
        yield* scheduleExpiry(m)
        return m.id
      }, locked),

      /** Public 1v1: anyone but the creator. Challenge: only the named Player. Starts the Match. */
      accept: Effect.fn("accept")(function* (discordId: string, matchId: string) {
        const { full, player } = yield* locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type === "lobby") return yield* new NotAllowed({ reason: "Use Join for a Lobby." })
            if (inMatch(m, discordId)) return yield* new NotAllowed({ reason: "This is your own Invite." })
            if (m.type === "challenge" && m.target?.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the challenged Player can accept." })
            const player = yield* playerOf(discordId)
            if (m.type === "public") yield* assertFree(discordId)
            const full: Match = { ...m, players: [...m.players, player] }
            yield* markStarting(full)
            return { full, player }
          })
        )
        yield* launch(full, player)
      }),

      decline: Effect.fn("decline")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId)
        if (m.type !== "challenge" || m.target?.discordId !== discordId)
          return yield* new NotAllowed({ reason: "Only the challenged Player can decline." })
        yield* withdrawInvite(matchId, "declined")
      }, locked),

      join: Effect.fn("join")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId)
        if (m.type !== "lobby") return yield* new NotAllowed({ reason: "Only a Lobby can be joined." })
        if (inMatch(m, discordId)) return yield* new NotAllowed({ reason: "You're already in this Lobby." })
        const player = yield* playerOf(discordId)
        yield* assertFree(discordId)
        yield* save({ ...m, players: [...m.players, player] })
        yield* surface.post(matchId, ThreadPost.Joined({ player }))
      }, locked),

      leave: Effect.fn("leave")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId)
        const player = m.players.find((p) => p.discordId === discordId)
        if (m.type !== "lobby" || player === undefined) return yield* new NotAllowed({ reason: "You're not in this Lobby." })
        if (m.creator.discordId === discordId) return yield* new NotAllowed({ reason: "Cancel the Lobby instead." })
        yield* save({ ...m, players: m.players.filter((p) => p.discordId !== discordId) })
        yield* surface.post(matchId, ThreadPost.Left({ player }))
      }, locked),

      /** Lobby only: its creator starts it, with at least two Players. */
      start: Effect.fn("start")(function* (discordId: string, matchId: string) {
        const full = yield* locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "lobby" || m.creator.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the Lobby's creator can start it." })
            if (m.players.length < LOBBY_MIN_PLAYERS) return yield* new NotEnoughPlayers({ count: m.players.length })
            yield* markStarting(m)
            return m
          })
        )
        yield* launch(full, null)
      }),

      cancel: Effect.fn("cancel")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId)
        if (m.creator.discordId !== discordId) return yield* new NotAllowed({ reason: "Only the creator can cancel." })
        yield* withdrawInvite(matchId, "cancelled")
      }, locked)
    } as const
  })
}) {}
