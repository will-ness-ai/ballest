// The Match engine: every Match rule, with Discord, Steam and storage behind ports.
// Inputs are Player actions (the methods below) and the clock; outputs go to Surface.
import { Clock, Data, Effect, FiberMap, Option, Ref } from "effect";
import { searchEligible } from "./eligibleMaps.js";
import {
  authorLimitOf,
  timeIsUp,
  expiresAt,
  inMatch,
  involves,
  medalFor,
  POLL_INTERVAL_MS,
  progress,
  racing,
  standings,
  type DrawnMap,
  type Match,
  type MatchType,
  type Minutes,
  type Player,
  type VenueName,
} from "./domain.js";
import {
  ChosenSkins,
  Steam,
  Store,
  Surface,
  ThreadPost,
  cardView,
  chosenSkinOf,
  type Entry,
  type Improvement,
  type ProfileNotFound,
  type ProfilePreview,
  type RemovalReason,
  type SteamUnavailable,
} from "./ports.js";

// ---------------------------------------------------------------- rejections (the Discord adapter shows each privately)

export class NotLinked extends Data.TaggedError("NotLinked")<{ readonly discordId: string }> {}
export class Busy extends Data.TaggedError("Busy")<{ readonly discordId: string }> {}
export class MatchNotFound extends Data.TaggedError("MatchNotFound")<{
  readonly matchId: string;
}> {}
export class NotOpen extends Data.TaggedError("NotOpen")<{ readonly matchId: string }> {}
export class NotAllowed extends Data.TaggedError("NotAllowed")<{ readonly reason: string }> {}
/** Most candidate Maps checked when drawing, about 20 s of Steam reads. */
const MAP_CHECKS = 60;

export class NoEligibleMap extends Data.TaggedError("NoEligibleMap")<{
  readonly matchId: string;
}> {}

/** Every way an action can be turned down. */
export type Rejection =
  | NotLinked
  | Busy
  | MatchNotFound
  | NotOpen
  | NotAllowed
  | NoEligibleMap
  | SteamUnavailable
  | ProfileNotFound;

export interface InviteRequest {
  readonly type: MatchType;
  readonly minutes: Minutes;
  /** The challenged Player's Discord id; required for a Challenge, ignored otherwise. */
  readonly target: string | null;
}

/** How many ended Matches' reasons are remembered. */
const CLOSED_KEPT = 100;

/** A board read that Steam drops is retried this many times. */
const READ_RETRIES = 2;

/** Of these Players, those who held a PB on the Map before the Match: only a faster run counts. */
const barsOf = (players: ReadonlyArray<Player>, map: DrawnMap) =>
  players.flatMap((player) => {
    const ticks = map.personalBests[player.steamId];
    return ticks === undefined ? [] : [{ player, ticks }];
  });

const withPersonalBest = (map: DrawnMap, pb: Entry): DrawnMap => ({
  ...map,
  personalBests: { ...map.personalBests, [pb.steamId]: pb.ticks },
});

/** The read at the end is retried straight away this many times before it counts as failed. */
const END_READ_RETRIES = 2;

/**
 * When Steam is down at the end, the Result waits for it rather than posting times that may
 * miss the last runs: the thread is told time's up, and the end read is tried again every
 * STEAM_WAIT_EVERY_MS, until STEAM_WAIT_MS after the end. Steam's entries carry no
 * timestamp, so a late read can count a run set after time ran out; the time's-up post is
 * what keeps that rare. After that, the last polled times stand and the Result says so.
 */
const STEAM_WAIT_EVERY_MS = 30_000;
const STEAM_WAIT_MS = 30 * 60_000;

export class Engine extends Effect.Service<Engine>()("multiballs/Engine", {
  scoped: Effect.gen(function* () {
    const steam = yield* Steam;
    const surface = yield* Surface;
    const store = yield* Store;
    const chosenSkins = yield* ChosenSkins;
    const lock = yield* Effect.makeSemaphore(1);
    /** Engine state changes happen one at a time. Steam reads are kept outside it. */
    const locked = lock.withPermits(1);
    const timers = yield* FiberMap.make<string>();
    /**
     * Invites whose Map is being drawn (a Steam read per candidate, outside the lock),
     * with the Players they are about to start with. Nothing else may touch them meanwhile.
     */
    const starting = yield* Ref.make(new Map<string, Match>());
    /** Finished Matches whose Players a Play again has pinged already, so a second Lobby can't ping them again. */
    const pingedAgain = yield* Ref.make(new Set<string>());
    /**
     * Why each recent Match ended without a Result, and in which Venue, so everyone who was in it
     * can be told there.
     */
    const closed = yield* Ref.make(
      new Map<string, { readonly venue: VenueName; readonly reason: RemovalReason }>(),
    );
    const noteClosed = Effect.fn("noteClosed")(function* (m: Match, reason: RemovalReason) {
      yield* Ref.update(closed, (all) => {
        const next = new Map(all).set(m.id, { venue: m.venue, reason });
        for (const key of next.keys()) if (next.size > CLOSED_KEPT) next.delete(key);
        return next;
      });
    });

    // ---------------------------------------------------------------- helpers

    /** A Match's Card view, with its Players' Chosen Skins as they stand now. */
    const viewOf = Effect.fn("viewOf")(function* (m: Match) {
      return cardView(m, yield* chosenSkins.all);
    });
    /** A Player's Chosen Skin as it stands now, for a thread post about them. */
    const skinOf = Effect.fn("skinOf")(function* (player: Player) {
      return chosenSkinOf(yield* chosenSkins.all, player.steamId);
    });

    /** Persist a Match and redraw its Card. */
    const save = Effect.fn("save")(function* (m: Match) {
      yield* store.putMatch(m);
      yield* surface.showCard(yield* viewOf(m));
    });

    const orFail = <A, E>(found: Effect.Effect<Option.Option<A>>, missing: () => E) =>
      found.pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(missing()),
            onSome: (a) => Effect.succeed(a),
          }),
        ),
      );

    const playerOf = (discordId: string) =>
      orFail(store.getLink(discordId), () => new NotLinked({ discordId })).pipe(
        Effect.map((l): Player => ({ discordId, steamId: l.steamId })),
      );

    const getMatch = (matchId: string) =>
      orFail(store.getMatch(matchId), () => new MatchNotFound({ matchId }));

    /** An Invite that is still open and not already starting. */
    const getInvite = Effect.fn("getInvite")(function* (matchId: string) {
      const m = yield* getMatch(matchId);
      if (m.state !== "invite" || (yield* Ref.get(starting)).has(matchId))
        return yield* new NotOpen({ matchId });
      return m;
    });

    /**
     * One open Invite or live Match per Player in every Venue together, counting a Challenge that
     * names them and Invites mid-start. A Match in a Venue that isn't running doesn't count: no
     * Player can see or leave it there, though its timers still run it to its Result.
     */
    const busyIn = Effect.fn("busyIn")(function* () {
      const active = [...(yield* store.activeMatches), ...(yield* Ref.get(starting)).values()];
      return active.filter((m) => surface.runs(m.venue));
    });
    const assertFree = Effect.fn("assertFree")(function* (discordId: string) {
      if ((yield* busyIn()).some((m) => involves(m, discordId)))
        return yield* new Busy({ discordId });
    });

    /** An Invite that never became a Match goes. Its expiry timer is left alone: it may be the caller. */
    const dropInvite = Effect.fn("dropInvite")(function* (m: Match, reason: RemovalReason) {
      yield* noteClosed(m, reason);
      yield* store.deleteMatch(m.id);
      yield* surface.remove(m.id, reason);
    });

    /** Drop an Invite from outside its timer, stopping the timer too. */
    const withdrawInvite = Effect.fn("withdrawInvite")(function* (m: Match, reason: RemovalReason) {
      yield* FiberMap.remove(timers, m.id);
      yield* dropInvite(m, reason);
    });

    // ---------------------------------------------------------------- Invite expiry

    const expire = Effect.fn("expire")(function* (matchId: string) {
      const m = yield* store.getMatch(matchId);
      const isStarting = (yield* Ref.get(starting)).has(matchId);
      if (Option.isSome(m) && m.value.state === "invite" && !isStarting)
        yield* dropInvite(m.value, "expired");
    }, locked);

    const scheduleExpiry = Effect.fn("scheduleExpiry")(function* (m: Match) {
      const now = yield* Clock.currentTimeMillis;
      yield* FiberMap.run(
        timers,
        m.id,
        Effect.sleep(Math.max(0, expiresAt(m) - now)).pipe(Effect.zipRight(expire(m.id))),
      );
    });

    // ---------------------------------------------------------------- opening an Invite

    /**
     * A new Invite in `venue`, checked already: its Card, its Opened post (and a Challenge's
     * ping), and its expiry. Called under the lock.
     */
    const open = Effect.fn("open")(function* (
      venue: VenueName,
      creator: Player,
      request: InviteRequest,
      target: Player | null,
      playAgainOf: string | null,
    ) {
      const m: Match = {
        id: yield* store.nextMatchId,
        venue,
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
        history: [],
        left: [],
        waitingForSteam: false,
        playAgainOf,
      };
      yield* save(m);
      yield* surface.post(
        m.id,
        ThreadPost.Opened({
          by: creator,
          skin: yield* skinOf(creator),
          type: m.type,
          minutes: m.minutes,
        }),
      );
      if (target !== null)
        yield* surface.post(
          m.id,
          ThreadPost.Challenged({
            by: creator,
            skin: yield* skinOf(creator),
            target,
            minutes: m.minutes,
            expiresAt: expiresAt(m),
          }),
        );
      yield* scheduleExpiry(m);
      return m;
    });

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
      const { unplayed, fallback } = yield* searchEligible({
        authorLimitSeconds: authorLimitOf(m.minutes),
        steamIds: m.players.map((p) => p.steamId),
        want: 1,
        maxChecks: MAP_CHECKS,
        retries: READ_RETRIES,
      }).pipe(Effect.provideService(Steam, steam));
      return unplayed[0] ?? fallback ?? (yield* new NoEligibleMap({ matchId: m.id }));
    });

    // ---------------------------------------------------------------- the live Match

    /** Sends Players off: the start ping with the Map, then the PB each must beat, if any. */
    const announceStart = Effect.fn("announceStart")(function* (
      m: Match,
      map: DrawnMap,
      endsAt: number,
      players: ReadonlyArray<Player>,
    ) {
      yield* surface.post(
        m.id,
        ThreadPost.Started({ players, map, endsAt, card: yield* viewOf(m) }),
      );
      const bars = barsOf(players, map);
      if (bars.length > 0) yield* surface.post(m.id, ThreadPost.PlayedBefore({ bars }));
    });

    /**
     * Fold one Steam read into the Match and post each Improvement. Every rank is taken
     * after the whole read is applied, so two Players improving in the same poll can't
     * both be shown as P1.
     */
    const applyEntries = Effect.fn("applyEntries")(function* (
      before: Match,
      entries: ReadonlyArray<Entry>,
    ) {
      const map = before.map;
      if (map === null) return before;
      /** The time to beat: the Player's best this Match, else the PB they held on the Map before it. */
      const barOf = (steamId: string) => before.bestTicks[steamId] ?? map.personalBests[steamId];
      const changed = entries.filter((e) => {
        const bar = barOf(e.steamId);
        return (
          racing(before).some((p) => p.steamId === e.steamId) &&
          (bar === undefined || e.ticks < bar)
        );
      });
      if (changed.length === 0) return before;
      const at = (yield* Clock.currentTimeMillis) - (before.startedAt ?? 0);
      // Slowest first, so two WR breaks in one poll are each measured against the WR they beat.
      const inOrder = [...changed].sort((a, b) => b.ticks - a.ticks);
      const after: Match = {
        ...before,
        bestTicks: {
          ...before.bestTicks,
          ...Object.fromEntries(changed.map((e) => [e.steamId, e.ticks])),
        },
        history: [
          ...before.history,
          ...inOrder.map((e) => ({ steamId: e.steamId, ticks: e.ticks, at })),
        ],
      };
      // This read's PBs, told the way every surface tells them.
      const improvements = progress(map, after.history)
        .slice(-inOrder.length)
        .flatMap((p): Array<Improvement> => {
          const player = after.players.find((pl) => pl.steamId === p.steamId);
          return player === undefined
            ? []
            : [
                {
                  player,
                  ticks: p.ticks,
                  medal: medalFor(p.ticks, map.medals),
                  rank: p.rank,
                  previousTicks: p.previousTicks,
                  previousRank: p.previousRank,
                  beatWorldRecord: p.beatWorldRecord,
                },
              ];
        });
      yield* store.putMatch(after);
      for (const improvement of improvements)
        yield* surface.post(
          after.id,
          ThreadPost.Improved({ improvement, skin: yield* skinOf(improvement.player) }),
        );
      yield* surface.showCard(yield* viewOf(after));
      return after;
    });

    const readMatch = (m: Match) =>
      m.map === null
        ? Effect.succeed<ReadonlyArray<Entry>>([])
        : steam.readPlayers(
            m.map.boardId,
            racing(m).map((p) => p.steamId),
          );

    /** Apply a read to the Match if it is still live. */
    const applyIfLive = Effect.fn("applyIfLive")(function* (
      matchId: string,
      entries: ReadonlyArray<Entry>,
    ) {
      const current = yield* getMatch(matchId);
      return current.state === "live" ? yield* applyEntries(current, entries) : current;
    }, locked);

    /** One poll. A failed read is logged and the next poll tries again; it never ends the Match. */
    const poll = Effect.fn("poll")(
      function* (matchId: string) {
        const entries = yield* readMatch(yield* getMatch(matchId));
        yield* applyIfLive(matchId, entries);
      },
      (effect, matchId) =>
        Effect.catchAll(effect, (e) => Effect.logWarning(`poll ${matchId} failed: ${e._tag}`)),
    );

    /**
     * Finished: the Result, then the graph if anyone set a time. `steamDown` when the end read
     * never came back, so the times are the last ones polled. Called under the lock.
     */
    const conclude = Effect.fn("conclude")(function* (
      m: Match,
      { steamDown }: { readonly steamDown: boolean },
    ) {
      const done: Match = { ...m, state: "finished", waitingForSteam: false };
      yield* save(done);
      yield* surface.post(
        done.id,
        ThreadPost.Result({ standings: standings(done), card: yield* viewOf(done), steamDown }),
      );
      if (done.history.length > 0)
        yield* surface.post(
          done.id,
          ThreadPost.Progression({ card: yield* viewOf(done), history: done.history }),
        );
    });

    /** Cancelled: everyone left before anyone set a time. Its Card and thread stay, saying so. Called under the lock. */
    const abandon = Effect.fn("abandon")(function* (m: Match) {
      yield* surface.post(m.id, ThreadPost.Abandoned());
      yield* noteClosed(m, "abandoned");
      yield* store.deleteMatch(m.id);
      yield* surface.remove(m.id, "abandoned");
    });

    /** Time is up and Steam isn't answering: the thread and the Card say so, once. */
    const startWaiting = Effect.fn("startWaiting")(function* (matchId: string) {
      const current = yield* getMatch(matchId);
      if (current.state !== "live" || current.waitingForSteam) return;
      yield* Effect.logWarning(`finish ${matchId}: Steam didn't answer; waiting for it`);
      yield* save({ ...current, waitingForSteam: true });
      yield* surface.post(matchId, ThreadPost.WaitingForSteam());
    }, locked);

    /**
     * The end: one read, retried straight away, then the Result. While Steam is down the
     * Result waits for it, until STEAM_WAIT_MS after the end; a restart picks the wait up
     * where it was, and one after that only posts the last polled times.
     */
    const finish = Effect.fn("finish")(
      function* (matchId: string) {
        const m = yield* getMatch(matchId);
        const giveUpAt = (m.endsAt ?? 0) + STEAM_WAIT_MS;
        const endRead = readMatch(m).pipe(Effect.retry({ times: END_READ_RETRIES }), Effect.option);
        const timeLeft = Effect.map(Clock.currentTimeMillis, (now) => giveUpAt - now);
        let entries = (yield* timeLeft) > 0 ? yield* endRead : Option.none();
        if (Option.isNone(entries) && (yield* timeLeft) > 0) yield* startWaiting(matchId);
        while (Option.isNone(entries)) {
          const left = yield* timeLeft;
          if (left <= 0) break;
          yield* Effect.sleep(Math.min(STEAM_WAIT_EVERY_MS, left));
          entries = yield* endRead;
        }
        yield* locked(
          Effect.gen(function* () {
            const current = yield* getMatch(matchId);
            if (current.state !== "live") return;
            yield* Option.isSome(entries)
              ? conclude(yield* applyEntries(current, entries.value), { steamDown: false })
              : conclude(current, { steamDown: true });
          }),
        );
      },
      (effect, matchId) =>
        Effect.catchAll(effect, (e) => Effect.logError(`finish ${matchId} failed: ${e._tag}`)),
    );

    /** Poll every 10 s until the duration runs out, then finish. Resumable after a restart. */
    const runLive = Effect.fn("runLive")(function* (matchId: string) {
      while (true) {
        const m = yield* store.getMatch(matchId);
        if (Option.isNone(m) || m.value.state !== "live" || m.value.endsAt === null) return;
        const now = yield* Clock.currentTimeMillis;
        if (now >= m.value.endsAt) return yield* finish(matchId);
        const next = Math.min(now + POLL_INTERVAL_MS, m.value.endsAt);
        yield* Effect.sleep(next - now);
        if (next < m.value.endsAt) yield* poll(matchId);
      }
    });

    /**
     * Invite → live. `full` is the Invite with every starting Player. The Map is drawn
     * outside the lock, with the Invite marked as starting so nothing else changes it;
     * `accepted` is the Player whose Accept started a 1v1.
     */
    const launch = Effect.fn("launch")(
      function* (full: Match, accepted: Player | null) {
        const map = yield* pickMap(full).pipe(
          Effect.tapErrorTag("NoEligibleMap", () =>
            locked(
              Effect.gen(function* () {
                yield* surface.post(full.id, ThreadPost.NoMap({ players: full.players }));
                yield* withdrawInvite(full, "noEligibleMap");
              }),
            ),
          ),
        );
        yield* locked(
          Effect.gen(function* () {
            if (accepted !== null)
              yield* surface.post(
                full.id,
                ThreadPost.Accepted({ player: accepted, skin: yield* skinOf(accepted) }),
              );
            const startedAt = yield* Clock.currentTimeMillis;
            const endsAt = startedAt + full.minutes * 60_000;
            const live: Match = {
              ...full,
              state: "live",
              startedAt,
              endsAt,
              map,
              bestTicks: {},
              history: [],
            };
            yield* save(live);
            yield* announceStart(live, map, endsAt, live.players);
            yield* FiberMap.run(timers, live.id, runLive(live.id));
          }),
        );
      },
      (effect, full) =>
        Effect.ensuring(
          effect,
          Ref.update(starting, (s) => {
            const next = new Map(s);
            next.delete(full.id);
            return next;
          }),
        ),
    );

    const markStarting = (full: Match) =>
      Ref.update(starting, (s) => new Map(s).set(full.id, full));

    // ---------------------------------------------------------------- joining a Lobby

    /** Who may join a Lobby: a linked Player who isn't in it yet and isn't busy elsewhere. */
    const joiner = Effect.fn("joiner")(function* (m: Match, discordId: string) {
      if (m.type !== "lobby")
        return yield* new NotAllowed({ reason: "Only a Lobby can be joined." });
      const already = m.players.find((p) => p.discordId === discordId);
      if (already !== undefined)
        return yield* new NotAllowed({
          reason: m.left.includes(already.steamId)
            ? "You left this Match, so you can't rejoin it."
            : "You're already in this Lobby.",
        });
      const player = yield* playerOf(discordId);
      yield* assertFree(discordId);
      return player;
    });

    const joinInvite = Effect.fn("joinInvite")(function* (discordId: string, matchId: string) {
      const m = yield* getInvite(matchId);
      const player = yield* joiner(m, discordId);
      yield* save({ ...m, players: [...m.players, player] });
      yield* surface.post(matchId, ThreadPost.Joined({ player, skin: yield* skinOf(player) }));
    });

    /** A live Match, with the Map and end it always has once live. Closed once its time is up. */
    const getLive = Effect.fn("getLive")(function* (matchId: string) {
      const m = yield* getMatch(matchId);
      if (m.state !== "live" || m.map === null || m.endsAt === null)
        return yield* new NotOpen({ matchId });
      if (timeIsUp(m, yield* Clock.currentTimeMillis))
        return yield* new NotAllowed({ reason: "That Match is over." });
      return { m, map: m.map, endsAt: m.endsAt };
    });

    /**
     * A late join. The Player's PB on the Map is read first, outside the lock, and becomes the
     * PB they must beat, so a time they set before joining can't count as an Improvement. They
     * get their own start ping with the Map. Nobody joins once time is up.
     */
    const joinLive = Effect.fn("joinLive")(function* (discordId: string, matchId: string) {
      const { player, boardId } = yield* locked(
        Effect.gen(function* () {
          const { m, map } = yield* getLive(matchId);
          return { player: yield* joiner(m, discordId), boardId: map.boardId };
        }),
      );
      const pb = (yield* steam
        .readPlayers(boardId, [player.steamId])
        .pipe(Effect.retry({ times: READ_RETRIES }))).at(0);
      yield* locked(
        Effect.gen(function* () {
          // The Match may have ended, or the Player joined another, during the read.
          const { m, map, endsAt } = yield* getLive(matchId);
          yield* joiner(m, discordId);
          const withPb = pb === undefined ? map : withPersonalBest(map, pb);
          const joined: Match = { ...m, map: withPb, players: [...m.players, player] };
          yield* save(joined);
          yield* surface.post(matchId, ThreadPost.Joined({ player, skin: yield* skinOf(player) }));
          yield* announceStart(joined, withPb, endsAt, [player]);
        }),
      );
    });

    /**
     * A Lobby takes joins while it is an Invite and while it is live. One whose Map is still
     * being drawn is neither, so a join then is turned down as not open.
     */
    const join = Effect.fn("join")(function* (discordId: string, matchId: string) {
      yield* locked(joinInvite(discordId, matchId)).pipe(
        Effect.catchTag("NotOpen", () => joinLive(discordId, matchId)),
      );
    });

    // ---------------------------------------------------------------- leaving

    /** A Lobby Invite: the Player is simply out of it. Its creator cancels instead. */
    const leaveLobby = Effect.fn("leaveLobby")(function* (discordId: string, matchId: string) {
      const m = yield* getInvite(matchId);
      const player = m.players.find((p) => p.discordId === discordId);
      if (m.type !== "lobby" || player === undefined)
        return yield* new NotAllowed({ reason: "You're not in this Lobby." });
      if (m.creator.discordId === discordId)
        return yield* new NotAllowed({ reason: "Cancel the Lobby instead." });
      yield* save({ ...m, players: m.players.filter((p) => p.discordId !== discordId) });
      yield* surface.post(matchId, ThreadPost.Left({ player, skin: yield* skinOf(player) }));
    }, locked);

    /** Who may leave: a Player still racing in a live Match. */
    const liveRacer = Effect.fn("liveRacer")(function* (matchId: string, discordId: string) {
      const m = yield* getMatch(matchId);
      // Once time is up only the end read counts, however long Steam takes to give it.
      if (m.state !== "live" || timeIsUp(m, yield* Clock.currentTimeMillis))
        return yield* new NotAllowed({ reason: "That Match is over." });
      const player = racing(m).find((p) => p.discordId === discordId);
      if (player === undefined)
        return yield* new NotAllowed({ reason: "You're not racing in this Match." });
      return { m, player };
    });

    /**
     * A live Match: the Player's board is read first, so a run finished just before leaving
     * still counts; nothing they set after it does. When the last Player leaves, the Match
     * ends there: with its Result if anyone set a time, cancelled if nobody did.
     */
    const leaveLive = Effect.fn("leaveLive")(function* (discordId: string, matchId: string) {
      const { m, player } = yield* liveRacer(matchId, discordId);
      const entries =
        m.map === null
          ? []
          : yield* steam
              .readPlayers(m.map.boardId, [player.steamId])
              .pipe(Effect.retry({ times: READ_RETRIES }));
      yield* locked(
        Effect.gen(function* () {
          // Checked again: the Match may have ended, or they left elsewhere, during the read.
          const { m: current } = yield* liveRacer(matchId, discordId);
          const read = yield* applyEntries(current, entries);
          const after: Match = { ...read, left: [...read.left, player.steamId] };
          yield* surface.post(after.id, ThreadPost.Left({ player, skin: yield* skinOf(player) }));
          if (racing(after).length > 0) return yield* save(after);
          yield* FiberMap.remove(timers, after.id);
          yield* after.history.length > 0 ? conclude(after, { steamDown: false }) : abandon(after);
        }),
      );
    });

    // ---------------------------------------------------------------- restart recovery

    for (const m of yield* store.activeMatches) {
      const now = yield* Clock.currentTimeMillis;
      if (m.state === "invite") {
        if (now >= expiresAt(m)) yield* dropInvite(m, "expired");
        else yield* scheduleExpiry(m);
      } else {
        // Redrawn, so a Card drawn by an older build gets today's buttons.
        yield* surface.showCard(yield* viewOf(m));
        yield* FiberMap.run(timers, m.id, runLive(m.id));
      }
    }

    // ---------------------------------------------------------------- Player actions

    return {
      /** Link Steam, step 1: find the account that was pasted. Nothing is saved yet. */
      previewLink: Effect.fn("previewLink")(function* (input: string) {
        return yield* steam.resolveProfile(input);
      }),

      /** Link Steam, step 2: the preview was confirmed. Not while the Player is in a Match. */
      confirmLink: Effect.fn("confirmLink")(function* (discordId: string, preview: ProfilePreview) {
        yield* assertFree(discordId);
        yield* store.putLink({
          discordId,
          steamId: preview.steamId,
          personaName: preview.personaName,
        });
      }, locked),

      /**
       * An Invite in `venue`, seen and joined only there. The Player must be free in every
       * Venue, as must a Challenge's opponent.
       */
      openInvite: Effect.fn("openInvite")(function* (
        venue: VenueName,
        discordId: string,
        request: InviteRequest,
      ) {
        const creator = yield* playerOf(discordId);
        yield* assertFree(discordId);
        let target: Player | null = null;
        if (request.type === "challenge") {
          if (request.target === null)
            return yield* new NotAllowed({ reason: "A Challenge needs a Player to challenge." });
          if (request.target === discordId)
            return yield* new NotAllowed({ reason: "You can't challenge yourself." });
          target = yield* playerOf(request.target);
          yield* assertFree(request.target);
        }
        return (yield* open(venue, creator, request, target, null)).id;
      }, locked),

      /** Public 1v1: anyone but the creator. Challenge: only the named Player. Starts the Match. */
      accept: Effect.fn("accept")(function* (discordId: string, matchId: string) {
        const { full, player } = yield* locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId);
            if (m.type === "lobby")
              return yield* new NotAllowed({ reason: "Use Join for a Lobby." });
            if (inMatch(m, discordId))
              return yield* new NotAllowed({ reason: "This is your own Invite." });
            if (m.type === "challenge" && m.target?.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the challenged Player can accept." });
            const player = yield* playerOf(discordId);
            if (m.type === "public") yield* assertFree(discordId);
            const full: Match = { ...m, players: [...m.players, player] };
            yield* markStarting(full);
            return { full, player };
          }),
        );
        yield* launch(full, player);
      }),

      decline: Effect.fn("decline")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId);
        if (m.type !== "challenge" || m.target?.discordId !== discordId)
          return yield* new NotAllowed({ reason: "Only the challenged Player can decline." });
        yield* withdrawInvite(m, "declined");
      }, locked),

      join,

      /** A member's PB on a live Match's Map, the time a late join would have to beat; null if they haven't Played it. */
      personalBest: Effect.fn("personalBest")(function* (discordId: string, matchId: string) {
        const player = yield* playerOf(discordId);
        const { map } = yield* getLive(matchId);
        const pb = (yield* steam
          .readPlayers(map.boardId, [player.steamId])
          .pipe(Effect.retry({ times: READ_RETRIES }))).at(0);
        return pb?.ticks ?? null;
      }),

      /** Whether each Player is Busy (`assertFree`'s rule), so they can't open, join or be challenged; one read for them all. */
      busyOf: Effect.fn("busyOf")(function* (discordIds: ReadonlyArray<string>) {
        const active = yield* busyIn();
        return new Set(discordIds.filter((id) => active.some((m) => involves(m, id))));
      }),

      /** Whether this Invite's Map is being drawn right now. */
      isStarting: Effect.fn("isStarting")(function* (matchId: string) {
        return (yield* Ref.get(starting)).has(matchId);
      }),

      /**
       * Why a Match of `venue` that's gone ended without a Result, if it was recent; null
       * otherwise, and for another Venue's Match.
       */
      whyClosed: Effect.fn("whyClosed")(function* (venue: VenueName, matchId: string) {
        const found = (yield* Ref.get(closed)).get(matchId);
        return found?.venue === venue ? found.reason : null;
      }),

      /** Whether the Player may leave this live Match, asked before the confirm is shown. */
      mayLeave: Effect.fn("mayLeave")(function* (discordId: string, matchId: string) {
        yield* liveRacer(matchId, discordId);
      }),

      /** Out of a Lobby Invite, or out of a live Match with the best time so far standing. */
      leave: Effect.fn("leave")(function* (discordId: string, matchId: string) {
        const m = yield* getMatch(matchId);
        return m.state === "live"
          ? yield* leaveLive(discordId, matchId)
          : yield* leaveLobby(discordId, matchId);
      }),

      /** Lobby only: its creator starts it, alone or with whoever has joined. */
      start: Effect.fn("start")(function* (discordId: string, matchId: string) {
        const full = yield* locked(
          Effect.gen(function* () {
            const m = yield* getInvite(matchId);
            if (m.type !== "lobby" || m.creator.discordId !== discordId)
              return yield* new NotAllowed({ reason: "Only the Lobby's creator can start it." });
            yield* markStarting(m);
            return m;
          }),
        );
        yield* launch(full, null);
      }),

      cancel: Effect.fn("cancel")(function* (discordId: string, matchId: string) {
        const m = yield* getInvite(matchId);
        if (m.creator.discordId !== discordId)
          return yield* new NotAllowed({ reason: "Only the creator can cancel." });
        yield* withdrawInvite(m, "cancelled");
      }, locked),

      /**
       * Play again on a finished Match: the first press opens a Lobby of the same length, with
       * the presser as its creator; every later press joins that Lobby while it can be joined, or
       * just finds it for someone already in it. Once it is gone or its time is up, the next press
       * opens a fresh one. The finished Match's Players are pinged only the first time.
       * `creator`: the Start is the presser's; `joinedNow`: this press put them in it.
       */
      playAgain: Effect.fn("playAgain")(function* (discordId: string, matchId: string) {
        const found = yield* locked(
          Effect.gen(function* () {
            const finished = yield* getMatch(matchId);
            if (finished.state !== "finished")
              return yield* new NotAllowed({ reason: "That Match isn't over yet." });
            const now = yield* Clock.currentTimeMillis;
            const again = (yield* store.activeMatches).find(
              (m) => m.playAgainOf === matchId && !timeIsUp(m, now),
            );
            if (again !== undefined) return { lobby: again, opened: false };
            const creator = yield* playerOf(discordId);
            yield* assertFree(discordId);
            // In the finished Match's Venue, as any Lobby the presser opened there.
            const lobby = yield* open(
              finished.venue,
              creator,
              { type: "lobby", minutes: finished.minutes, target: null },
              null,
              matchId,
            );
            const firstTime = !(yield* Ref.get(pingedAgain)).has(matchId);
            yield* Ref.update(pingedAgain, (s) => new Set(s).add(matchId));
            yield* surface.post(
              matchId,
              ThreadPost.PlayingAgain({
                by: creator,
                skin: yield* skinOf(creator),
                others: firstTime ? racing(finished).filter((p) => p.discordId !== discordId) : [],
                minutes: finished.minutes,
              }),
            );
            return { lobby, opened: true };
          }),
        );
        const answer = (joinedNow: boolean) => ({
          lobbyId: found.lobby.id,
          creator: found.lobby.creator.discordId === discordId,
          joinedNow,
        });
        if (found.opened) return answer(true);
        if (involves(found.lobby, discordId)) return answer(false);
        // The Lobby may have moved on since it was found: a second press just landed the Player
        // in it, or its Map is being drawn.
        const joined = yield* join(discordId, found.lobby.id).pipe(Effect.either);
        if (joined._tag === "Right") return answer(true);
        const now = yield* store.getMatch(found.lobby.id);
        if (Option.isSome(now) && involves(now.value, discordId)) return answer(false);
        if ((yield* Ref.get(starting)).has(found.lobby.id))
          return yield* new NotAllowed({
            reason: "Its Lobby is drawing its Map. Press again in a moment.",
          });
        return yield* Effect.fail(joined.left);
      }),
    } as const;
  }),
}) {}
