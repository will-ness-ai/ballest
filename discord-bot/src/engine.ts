// The Match engine: every Match rule, with Discord, Steam and storage behind ports.
// Inputs are Player actions (the methods below) and the clock; outputs go to Surface.
import { Chunk, Clock, Config, Data, Effect, FiberMap, Option, Random, Ref } from "effect"
import {
  authorTimeFits,
  currentWorldRecord,
  expiresAt,
  inMatch,
  involves,
  LOBBY_MIN_PLAYERS,
  medalFor,
  POLL_INTERVAL_MS,
  rankOf,
  standings,
  worldRecordFits,
  type DrawnMap,
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
  type ProfileNotFound,
  type ProfilePreview,
  type RemovalReason,
  type SteamUnavailable
} from "./ports.js"

// ---------------------------------------------------------------- rejections (the Discord adapter shows each privately)

export class NotLinked extends Data.TaggedError("NotLinked")<{ readonly discordId: string }> {}
export class Busy extends Data.TaggedError("Busy")<{ readonly discordId: string }> {}
export class MatchNotFound extends Data.TaggedError("MatchNotFound")<{ readonly matchId: string }> {}
export class NotOpen extends Data.TaggedError("NotOpen")<{ readonly matchId: string }> {}
export class NotAllowed extends Data.TaggedError("NotAllowed")<{ readonly reason: string }> {}
export class NotEnoughPlayers extends Data.TaggedError("NotEnoughPlayers")<{ readonly count: number; readonly min: number }> {}
/** Most candidate Maps checked when drawing, about 20 s of Steam reads. */
const MAP_CHECKS = 60

export class NoEligibleMap extends Data.TaggedError("NoEligibleMap")<{ readonly matchId: string }> {}

/** Every way an action can be turned down. */
export type Rejection =
  | NotLinked
  | Busy
  | MatchNotFound
  | NotOpen
  | NotAllowed
  | NotEnoughPlayers
  | NoEligibleMap
  | SteamUnavailable
  | ProfileNotFound

export interface InviteRequest {
  readonly type: MatchType
  readonly minutes: Minutes
  /** The challenged Player's Discord id; required for a Challenge, ignored otherwise. */
  readonly target: string | null
}

/** A board read that Steam drops is retried this many times. */
const READ_RETRIES = 2

/** Of these Players, those who held a PB on the Map before the Match: only a faster run counts. */
const barsOf = (players: ReadonlyArray<Player>, map: DrawnMap) =>
  players.flatMap((player) => {
    const ticks = map.personalBests[player.steamId]
    return ticks === undefined ? [] : [{ player, ticks }]
  })

const withPersonalBest = (map: DrawnMap, pb: Entry): DrawnMap => ({
  ...map,
  personalBests: { ...map.personalBests, [pb.steamId]: pb.ticks }
})

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
    /** Fewest Players a Lobby starts with; the test server lowers it to try a Match alone. */
    const lobbyMinPlayers = yield* Config.integer("LOBBY_MIN_PLAYERS").pipe(
      Config.validate({ message: "LOBBY_MIN_PLAYERS must be at least 1", validation: (n) => n >= 1 }),
      Config.withDefault(LOBBY_MIN_PLAYERS)
    )
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

    /**
     * A random Eligible Map. The author-time rule filters the Workshop list for free; each
     * shuffled candidate then costs one board check (world record, who has Played it), so
     * only the Maps actually tried are ever read. When every Map tried has been Played by
     * someone here, the one the fewest have Played is drawn, and their PBs become the bar.
     * At most MAP_CHECKS are tried, so a Player who has Played nearly everything can't stall
     * the start.
     */
    const pickMap = Effect.fn("pickMap")(function* (m: Match) {
      const catalogue = yield* steam.catalogue
      const shuffled = yield* Random.shuffle(catalogue.filter((map) => authorTimeFits(map, m.minutes)))
      const steamIds = m.players.map((p) => p.steamId)
      let fallback: DrawnMap | null = null
      for (const map of Chunk.take(shuffled, MAP_CHECKS)) {
        const c = yield* steam.check(map, steamIds).pipe(Effect.retry({ times: READ_RETRIES }))
        if (c.boardId === null || c.worldRecordTicks === null || !worldRecordFits(c.worldRecordTicks)) continue
        const drawn: DrawnMap = {
          ...map,
          boardId: c.boardId,
          worldRecordTicks: c.worldRecordTicks,
          personalBests: Object.fromEntries(c.played.map((e) => [e.steamId, e.ticks]))
        }
        if (c.played.length === 0) return drawn
        if (fallback === null || c.played.length < Object.keys(fallback.personalBests).length) fallback = drawn
      }
      return fallback ?? (yield* new NoEligibleMap({ matchId: m.id }))
    })

    // ---------------------------------------------------------------- the live Match

    /** Sends Players off: the start ping with the Map, then the PB each must beat, if any. */
    const announceStart = Effect.fn("announceStart")(function* (
      m: Match,
      map: DrawnMap,
      endsAt: number,
      players: ReadonlyArray<Player>
    ) {
      yield* surface.post(m.id, ThreadPost.Started({ players, map, endsAt, card: cardOf(m) }))
      const bars = barsOf(players, map)
      if (bars.length > 0) yield* surface.post(m.id, ThreadPost.PlayedBefore({ bars }))
    })

    /**
     * Fold one Steam read into the Match and post each Improvement. Every rank is taken
     * after the whole read is applied, so two Players improving in the same poll can't
     * both be shown as P1.
     */
    const applyEntries = Effect.fn("applyEntries")(function* (before: Match, entries: ReadonlyArray<Entry>) {
      const map = before.map
      if (map === null) return before
      /** The time to beat: the Player's best this Match, else the PB they held on the Map before it. */
      const barOf = (steamId: string) => before.bestTicks[steamId] ?? map.personalBests[steamId]
      const changed = entries.filter((e) => {
        const bar = barOf(e.steamId)
        return before.players.some((p) => p.steamId === e.steamId) && (bar === undefined || e.ticks < bar)
      })
      if (changed.length === 0) return before
      const at = (yield* Clock.currentTimeMillis) - (before.startedAt ?? 0)
      // Slowest first, so two WR breaks in one poll are each measured against the WR they beat.
      const inOrder = [...changed].sort((a, b) => b.ticks - a.ticks)
      let worldRecord = currentWorldRecord(before) ?? Infinity
      const beaten = new Map<string, number>()
      for (const e of inOrder)
        if (e.ticks < worldRecord) {
          beaten.set(e.steamId, worldRecord)
          worldRecord = e.ticks
        }
      const after: Match = {
        ...before,
        bestTicks: { ...before.bestTicks, ...Object.fromEntries(changed.map((e) => [e.steamId, e.ticks])) },
        history: [...before.history, ...inOrder.map((e) => ({ steamId: e.steamId, ticks: e.ticks, at }))]
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
                  previousTicks: barOf(e.steamId) ?? null,
                  previousRank: rankOf(before, e.steamId),
                  beatWorldRecord: beaten.get(e.steamId) ?? null
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
      m.map === null
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
            yield* surface.post(done.id, ThreadPost.Result({ standings: standings(done), card: cardOf(done) }))
            if (done.history.length > 0) yield* surface.post(done.id, ThreadPost.Progression({ card: cardOf(done), history: done.history }))
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
      const map = yield* pickMap(full).pipe(
        Effect.tapErrorTag("NoEligibleMap", () =>
          locked(
            Effect.gen(function* () {
              yield* surface.post(full.id, ThreadPost.NoMap({ players: full.players }))
              yield* withdrawInvite(full.id, "noEligibleMap")
            })
          )
        )
      )
      yield* locked(
        Effect.gen(function* () {
          if (accepted !== null) yield* surface.post(full.id, ThreadPost.Accepted({ player: accepted }))
          const startedAt = yield* Clock.currentTimeMillis
          const endsAt = startedAt + full.minutes * 60_000
          const live: Match = { ...full, state: "live", startedAt, endsAt, map, bestTicks: {}, history: [] }
          yield* save(live)
          yield* announceStart(live, map, endsAt, live.players)
          yield* FiberMap.run(timers, live.id, runLive(live.id))
        })
      )
    }, (effect, full) => Effect.ensuring(effect, Ref.update(starting, (s) => {
      const next = new Map(s)
      next.delete(full.id)
      return next
    })))

    const markStarting = (full: Match) => Ref.update(starting, (s) => new Map(s).set(full.id, full))

    // ---------------------------------------------------------------- joining a Lobby

    /** Who may join a Lobby: a linked Player who isn't in it yet and isn't busy elsewhere. */
    const joiner = Effect.fn("joiner")(function* (m: Match, discordId: string) {
      if (m.type !== "lobby") return yield* new NotAllowed({ reason: "Only a Lobby can be joined." })
      if (inMatch(m, discordId)) return yield* new NotAllowed({ reason: "You're already in this Lobby." })
      const player = yield* playerOf(discordId)
      yield* assertFree(discordId)
      return player
    })

    const joinInvite = Effect.fn("joinInvite")(function* (discordId: string, matchId: string) {
      const m = yield* getInvite(matchId)
      const player = yield* joiner(m, discordId)
      yield* save({ ...m, players: [...m.players, player] })
      yield* surface.post(matchId, ThreadPost.Joined({ player }))
    })

    /** A live Match, with the Map and end it always has once live. */
    const getLive = Effect.fn("getLive")(function* (matchId: string) {
      const m = yield* getMatch(matchId)
      if (m.state !== "live" || m.map === null || m.endsAt === null) return yield* new NotOpen({ matchId })
      return { m, map: m.map, endsAt: m.endsAt }
    })

    /**
     * A late join. The Player's PB on the Map is read first, outside the lock, and becomes the
     * PB they must beat, so a time they set before joining can't count as an Improvement. They
     * get their own start ping with the Map. Joining after the final read has begun leaves
     * them DNF.
     */
    const joinLive = Effect.fn("joinLive")(function* (discordId: string, matchId: string) {
      const { player, boardId } = yield* locked(
        Effect.gen(function* () {
          const { m, map } = yield* getLive(matchId)
          return { player: yield* joiner(m, discordId), boardId: map.boardId }
        })
      )
      const pb = (yield* steam.readPlayers(boardId, [player.steamId]).pipe(Effect.retry({ times: READ_RETRIES }))).at(0)
      yield* locked(
        Effect.gen(function* () {
          // The Match may have ended, or the Player joined another, during the read.
          const { m, map, endsAt } = yield* getLive(matchId)
          yield* joiner(m, discordId)
          const withPb = pb === undefined ? map : withPersonalBest(map, pb)
          const joined: Match = { ...m, map: withPb, players: [...m.players, player] }
          yield* save(joined)
          yield* surface.post(matchId, ThreadPost.Joined({ player }))
          yield* announceStart(joined, withPb, endsAt, [player])
        })
      )
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
          bestTicks: {},
          history: []
        }
        yield* save(m)
        yield* surface.post(m.id, ThreadPost.Opened({ by: creator, type: m.type, minutes: m.minutes }))
        if (target !== null) yield* surface.post(m.id, ThreadPost.Challenged({ by: creator, target, minutes: m.minutes, expiresAt: expiresAt(m) }))
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

      /**
       * A Lobby takes joins while it is an Invite and while it is live. One whose Map is still
       * being drawn is neither, so a join then is turned down as not open.
       */
      join: Effect.fn("join")(function* (discordId: string, matchId: string) {
        yield* locked(joinInvite(discordId, matchId)).pipe(Effect.catchTag("NotOpen", () => joinLive(discordId, matchId)))
      }),

      leave: Effect.fn("leave")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId)
        const player = m.players.find((p) => p.discordId === discordId)
        if (m.type !== "lobby" || player === undefined) return yield* new NotAllowed({ reason: "You're not in this Lobby." })
        if (m.creator.discordId === discordId) return yield* new NotAllowed({ reason: "Cancel the Lobby instead." })
        yield* save({ ...m, players: m.players.filter((p) => p.discordId !== discordId) })
        yield* surface.post(matchId, ThreadPost.Left({ player }))
      }, locked),

      /** Lobby only: its creator starts it, with at least the Lobby minimum of Players. */
      start: Effect.fn("start")(function* (discordId: string, matchId: string) {
        const full = yield* locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId)
            if (m.type !== "lobby" || m.creator.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the Lobby's creator can start it." })
            if (m.players.length < lobbyMinPlayers)
              return yield* new NotEnoughPlayers({ count: m.players.length, min: lobbyMinPlayers })
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
