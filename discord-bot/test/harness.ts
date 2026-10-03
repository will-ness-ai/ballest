// Fakes for the engine's ports, and a harness that builds the whole engine the way the bot
// does. Tests drive Player actions and the TestClock, and assert on what reached Surface.
import { Context, type Duration, Effect, Exit, Layer, Option, Ref, Scope, TestClock } from "effect";
import type { DrawnMap, Link, MapInfo, Medals } from "../src/domain.js";
import { SCORE_TICKS_PER_SECOND } from "../src/domain.js";
import { Engine } from "../src/engine.js";
import { SqliteStoreInMemory } from "../src/sqliteStore.js";
import { Pings } from "../src/pings.js";
import {
  PingRole,
  PingRoleUnavailable,
  ProfileNotFound,
  Steam,
  SteamUnavailable,
  Store,
  Surface,
  type CardView,
  type ProfilePreview,
  type RemovalReason,
  type ThreadPost,
} from "../src/ports.js";

export const ticks = (secondsValue: number) => Math.round(secondsValue * SCORE_TICKS_PER_SECOND);

const MEDALS: Medals = { bronze: 40, silver: 30, gold: 25, author: 20 };

/** A Workshop Map plus the board facts the fake Steam answers `check` with. */
export interface FakeMap extends MapInfo {
  readonly boardId: number | null;
  readonly worldRecordTicks: number | null;
}

export const makeMap = (boardId: number | null, over: Partial<FakeMap> = {}): FakeMap => ({
  pfid: `pf${boardId ?? "none"}`,
  title: `Map ${boardId ?? "none"}`,
  creator: "pebblewright",
  previewUrl: `https://example.invalid/${boardId}.png`,
  boardName: `ballest_v0_pf${boardId ?? "none"}_Climb_Map`,
  boardId,
  medals: MEDALS,
  worldRecordTicks: boardId === null ? null : ticks(15),
  ...over,
});

// ---------------------------------------------------------------- Steam

export interface FakeSteamControl {
  /** Put (or improve) a time on a board, as if a Player just finished a run. */
  readonly setTime: (boardId: number, steamId: string, seconds: number) => Effect.Effect<void>;
  /** The next n per-player reads fail as if Steam dropped the reply. */
  readonly failNextReads: (n: number) => Effect.Effect<void>;
  readonly setCatalogue: (maps: ReadonlyArray<FakeMap>) => Effect.Effect<void>;
  /** Every per-player read takes this long (on the TestClock), like a real ~150 ms Steam round trip. */
  readonly setReadDelay: (delay: Duration.DurationInput) => Effect.Effect<void>;
  /** How many board reads have been made so far. */
  readonly reads: Effect.Effect<number>;
}

export const makeFakeSteam = (profiles: Record<string, ProfilePreview>) =>
  Effect.gen(function* () {
    const boards = yield* Ref.make(new Map<number, Map<string, number>>());
    const failures = yield* Ref.make(0);
    const catalogue = yield* Ref.make<ReadonlyArray<FakeMap>>([]);
    const readDelay = yield* Ref.make<Duration.DurationInput>(0);
    const readCount = yield* Ref.make(0);
    /** One board read: slow and failing as configured, like the real one-at-a-time queue. */
    const read = (boardId: number, steamIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        yield* Effect.sleep(yield* Ref.get(readDelay));
        yield* Ref.update(readCount, (n) => n + 1);
        const fail = yield* Ref.getAndUpdate(failures, (n) => Math.max(0, n - 1));
        if (fail > 0) return yield* new SteamUnavailable({ reason: "reply dropped" });
        const board = (yield* Ref.get(boards)).get(boardId) ?? new Map<string, number>();
        return steamIds.flatMap((steamId) => {
          const t = board.get(steamId);
          return t === undefined ? [] : [{ steamId, ticks: t }];
        });
      });
    const port = Steam.of({
      catalogue: Ref.get(catalogue),
      check: (map, steamIds) =>
        Effect.gen(function* () {
          const known = (yield* Ref.get(catalogue)).find((m) => m.boardName === map.boardName);
          if (known?.boardId == null) return { boardId: null, worldRecordTicks: null, played: [] };
          const entries = yield* read(known.boardId, steamIds);
          return {
            boardId: known.boardId,
            worldRecordTicks: known.worldRecordTicks,
            played: entries,
          };
        }),
      readPlayers: read,
      resolveProfile: (input) => {
        const found = profiles[input];
        return found
          ? Effect.succeed(found)
          : Effect.fail(new ProfileNotFound({ input, reason: "no such profile" }));
      },
    });
    const control: FakeSteamControl = {
      setTime: (boardId, steamId, seconds) =>
        Ref.update(boards, (all) => {
          const next = new Map(all);
          next.set(boardId, new Map(all.get(boardId) ?? []).set(steamId, ticks(seconds)));
          return next;
        }),
      failNextReads: (n) => Ref.set(failures, n),
      setCatalogue: (maps) => Ref.set(catalogue, maps),
      setReadDelay: (delay) => Ref.set(readDelay, delay),
      reads: Ref.get(readCount),
    };
    return { port, control };
  });

// ---------------------------------------------------------------- Surface

export type SurfaceEvent =
  | { readonly _tag: "Card"; readonly view: CardView }
  | { readonly _tag: "Post"; readonly matchId: string; readonly post: ThreadPost }
  | { readonly _tag: "Removed"; readonly matchId: string; readonly reason: RemovalReason };

export const makeFakeSurface = Effect.gen(function* () {
  const events = yield* Ref.make<ReadonlyArray<SurfaceEvent>>([]);
  const record = (e: SurfaceEvent) => Ref.update(events, (all) => [...all, e]);
  const port = Surface.of({
    showCard: (view) => record({ _tag: "Card", view }),
    post: (matchId, post) => record({ _tag: "Post", matchId, post }),
    remove: (matchId, reason) => record({ _tag: "Removed", matchId, reason }),
  });
  const all = Ref.get(events);
  return {
    port,
    all,
    card: (matchId: string) =>
      all.pipe(
        Effect.map((es) =>
          Option.fromNullable(
            es
              .flatMap((e) => (e._tag === "Card" && e.view.matchId === matchId ? [e.view] : []))
              .at(-1),
          ),
        ),
      ),
    posts: (matchId: string) =>
      all.pipe(
        Effect.map((es) =>
          es.flatMap((e) => (e._tag === "Post" && e.matchId === matchId ? [e.post] : [])),
        ),
      ),
    removed: (matchId: string) =>
      all.pipe(
        Effect.map((es) =>
          Option.fromNullable(
            es
              .flatMap((e) => (e._tag === "Removed" && e.matchId === matchId ? [e.reason] : []))
              .at(0),
          ),
        ),
      ),
  };
});

// ---------------------------------------------------------------- the ping role

export interface FakePingRoleControl {
  /** Give a member the role from outside the bot, as a moderator would in Discord. */
  readonly give: (discordId: string) => Effect.Effect<void>;
  /** Whether the member has the role right now. */
  readonly has: (discordId: string) => Effect.Effect<boolean>;
  /** While true, every read and change fails as if Discord refused it. */
  readonly setFailing: (failing: boolean) => Effect.Effect<void>;
}

export const makeFakePingRole = Effect.gen(function* () {
  const holders = yield* Ref.make(new Set<string>());
  const failing = yield* Ref.make(false);
  const discord = <A>(run: Effect.Effect<A>) =>
    Effect.flatMap(Ref.get(failing), (f) =>
      f ? Effect.fail(new PingRoleUnavailable({ reason: "Discord said no" })) : run,
    );
  const update = (discordId: string, on: boolean) =>
    Ref.update(holders, (all) => {
      const next = new Set(all);
      if (on) next.add(discordId);
      else next.delete(discordId);
      return next;
    });
  const port = PingRole.of({
    has: (discordId) => discord(Ref.get(holders).pipe(Effect.map((all) => all.has(discordId)))),
    add: (discordId) => discord(update(discordId, true)),
    remove: (discordId) => discord(update(discordId, false)),
  });
  const control: FakePingRoleControl = {
    give: (discordId) => update(discordId, true),
    has: (discordId) => Ref.get(holders).pipe(Effect.map((all) => all.has(discordId))),
    setFailing: (f) => Ref.set(failing, f),
  };
  return { port, control };
});

// ---------------------------------------------------------------- the harness

export const ALICE = { discordId: "d-alice", steamId: "s-alice" };
export const BOB = { discordId: "d-bob", steamId: "s-bob" };
export const CARA = { discordId: "d-cara", steamId: "s-cara" };
export const DAN = { discordId: "d-dan", steamId: "s-dan" };
export const UNLINKED = "d-nobody";

/** A Match's Map as drawn, from a fake Map. */
export const drawnMap = (map: FakeMap = makeMap(1)): DrawnMap => ({
  ...map,
  boardId: map.boardId ?? 0,
  worldRecordTicks: map.worldRecordTicks ?? 0,
  personalBests: {},
});

/** A Card view: a Public 1v1 Invite by Alice unless told otherwise. */
export const cardView = (matchId: string, over: Partial<CardView> = {}): CardView => ({
  matchId,
  state: "invite",
  type: "public",
  minutes: 10,
  creator: ALICE,
  target: null,
  players: [ALICE],
  map: null,
  standings: [],
  expiresAt: null,
  endsAt: null,
  ...over,
});

const link = (p: { discordId: string; steamId: string }): Link => ({
  ...p,
  personaName: p.discordId.slice(2),
});

export const PROFILES: Record<string, ProfilePreview> = {
  "https://steamcommunity.com/id/alice": {
    steamId: ALICE.steamId,
    personaName: "alice",
    avatarUrl: "",
    campaignTracks: 21,
    campaignTrackTotal: 23,
  },
};

/**
 * Everything a test needs (run it under `it.scoped`: the database lives for the test's scope): the engine plus the fakes behind it. `restart` tears the engine
 * down (as a crash would) and builds a fresh one over the same Store, fakes and clock.
 */
export const makeHarness = (opts: {
  readonly maps: ReadonlyArray<FakeMap>;
  readonly linked?: boolean;
}) =>
  Effect.gen(function* () {
    // The real SQLite Store on a throwaway in-memory database, alive for the whole test.
    const store = Context.get(yield* Layer.build(SqliteStoreInMemory), Store);
    if (opts.linked !== false)
      for (const p of [ALICE, BOB, CARA, DAN]) yield* store.putLink(link(p));
    const steam = yield* makeFakeSteam(PROFILES);
    yield* steam.control.setCatalogue(opts.maps);
    const surface = yield* makeFakeSurface;
    const role = yield* makeFakePingRole;
    const pings = Context.get(
      yield* Layer.build(
        Pings.Default.pipe(
          Layer.provide(Layer.succeed(PingRole, role.port)),
          Layer.provide(Layer.succeed(Store, store)),
        ),
      ),
      Pings,
    );
    const ports = Layer.mergeAll(
      Layer.succeed(Steam, steam.port),
      Layer.succeed(Surface, surface.port),
      Layer.succeed(Store, store),
    );
    const boot = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const ctx = yield* Layer.buildWithScope(Engine.Default.pipe(Layer.provide(ports)), scope);
      return { engine: Context.get(ctx, Engine), scope };
    });
    let current = yield* boot;
    return {
      get engine() {
        return current.engine;
      },
      steam: steam.control,
      surface,
      store,
      /** The @Multiplayer ping role, as Discord has it. */
      role: role.control,
      pings,
      /** Stop the engine, let `downtime` pass with nothing running, then boot a new one. */
      restart: (downtime: Duration.DurationInput) =>
        Effect.gen(function* () {
          yield* Scope.close(current.scope, Exit.void);
          yield* TestClock.adjust(downtime);
          current = yield* boot;
        }),
    };
  });

/** Move the TestClock and let forked work (polls, expiry, the end) run to completion. */
export const advance = (duration: Duration.DurationInput) =>
  TestClock.adjust(duration).pipe(
    Effect.zipRight(Effect.yieldNow()),
    Effect.zipRight(Effect.yieldNow()),
  );
