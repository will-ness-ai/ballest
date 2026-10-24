// Which Venues the bot plays in: home from its three settings, and every server it is invited
// to, which it sets up itself (spec #315, #321): a `multiballs` channel and a `Multiplayer ping`
// role, found or made, kept in SQLite and set up again when one is gone. Setup runs here against
// a fake server; the discord.js calls behind it are tried live with the dev app.
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { ChannelType, type Client, type Interaction } from "discord.js";
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  TestClock,
} from "effect";
import {
  checkVenue,
  DiscordError,
  type DiscordVenue,
  discordKind,
  retryPasses,
  routeClick,
} from "../src/discord/client.js";
import { Guests, makeGuests } from "../src/guests.js";
import { opsAlertsOf } from "../src/ops.js";
import {
  type ChannelAccess,
  makeVenueJoiner,
  MATCH_CHANNEL_ACCESS,
  REQUIRED_PERMISSIONS,
  type ServerPermission,
  type SetupGuild,
  setUpVenue,
  startHome,
  VenueCheckFailed,
  type VenueConfig,
  VenueRecords,
  VenueRecordsLive,
  VENUES_SINCE,
  VenueSetupFailed,
} from "../src/venues.js";

const HOME = { name: "home", guildId: "g-home", channelId: "c-home", pingRoleId: "r-home" };
const RACING = {
  name: "g-racing",
  guildId: "g-racing",
  channelId: "c-racing",
  pingRoleId: "r-racing",
};

interface FakeChannel {
  readonly id: string;
  readonly name: string;
  access: ChannelAccess | null;
}
interface FakeRole {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly mentionable: boolean;
}

/** A server as setup sees it: its text channels and roles, the bot's place, and what it lacks. */
const makeFakeGuild = (
  opts: {
    readonly id?: string;
    /** When the bot joined it (ms), or null when Discord can't say; long before Venues unless told. */
    readonly joinedAt?: number | null;
    readonly channels?: ReadonlyArray<Omit<FakeChannel, "access">>;
    readonly roles?: ReadonlyArray<Omit<FakeRole, "mentionable">>;
    /** The position of the bot's highest role. */
    readonly botTop?: number;
    readonly missing?: ReadonlyArray<ServerPermission>;
  } = {},
) => {
  let next = 1;
  let missing = opts.missing ?? [];
  let botReads = 0;
  /** Every Discord call setup made: reads and writes over the API, never the cache. */
  let apiCalls = 0;
  const api = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.sync(() => apiCalls++).pipe(Effect.zipRight(effect));
  let joinedAt = opts.joinedAt === undefined ? Date.parse("2026-01-01T00:00:00Z") : opts.joinedAt;
  /** What reading the server's channels does instead of answering: Discord failing, or a bug. */
  let fault: VenueSetupFailed | "crash" | null = null;
  /** While set, making the channel waits for it, as a slow Discord call would. */
  let gate: Deferred.Deferred<undefined> | null = null;
  const channels: Array<FakeChannel> = (opts.channels ?? []).map((c) => ({ ...c, access: null }));
  const roles: Array<FakeRole> = (opts.roles ?? []).map((r) => ({ ...r, mentionable: false }));
  const made: Array<string> = [];
  const port: SetupGuild = {
    id: opts.id ?? "g-racing",
    get joinedAt() {
      return joinedAt;
    },
    name: "Ballest Racing",
    holds: (venue) =>
      channels.some((c) => c.id === venue.channelId) &&
      roles.some((r) => r.id === venue.pingRoleId),
    bot: Effect.sync(() => {
      botReads++;
      return { missing, topRolePosition: opts.botTop ?? 10 };
    }).pipe(api),
    textChannels: Effect.suspend(() =>
      fault === "crash"
        ? Effect.dieMessage("a bug")
        : fault !== null
          ? Effect.fail(fault)
          : Effect.succeed(channels.map(({ id, name }) => ({ id, name }))),
    ).pipe(api),
    createTextChannel: (name, access) =>
      Effect.suspend(() => (gate === null ? Effect.void : Deferred.await(gate))).pipe(
        Effect.zipRight(
          Effect.sync(() => {
            const id = `c-new${next++}`;
            channels.push({ id, name, access });
            made.push(`channel #${name}`);
            return id;
          }),
        ),
      ),
    setAccess: (channelId, access) =>
      Effect.suspend(() => {
        const channel = channels.find((c) => c.id === channelId);
        if (channel === undefined)
          return Effect.fail(new VenueSetupFailed({ reason: `no channel ${channelId}` }));
        channel.access = access;
        return Effect.void;
      }),
    roles: Effect.sync(() => roles.map(({ id, name, position }) => ({ id, name, position }))).pipe(
      api,
    ),
    createRole: (name) =>
      Effect.sync(() => {
        const id = `r-new${next++}`;
        // Discord puts a new role just above @everyone: below the bot's.
        roles.push({ id, name, position: 1, mentionable: true });
        made.push(`role @${name}`);
        return id;
      }),
  };
  return {
    port,
    made: () => [...made],
    /** How often setup read the bot's member. */
    botReads: () => botReads,
    /** How many Discord calls setup made. */
    apiCalls: () => apiCalls,
    /** A moderator gives the bot's role every permission it lacked. */
    grantAll: () => {
      missing = [];
    },
    /** The bot is removed and invited again at this time. */
    rejoin: (at: number) => {
      joinedAt = at;
    },
    setFault: (next: VenueSetupFailed | "crash" | null) => {
      fault = next;
    },
    /** Hold making the channel until the gate it returns is opened. */
    hold: Effect.fn("hold")(function* () {
      const held = yield* Deferred.make<undefined>();
      gate = held;
      return held;
    }),
    channel: (id: string) => channels.find((c) => c.id === id),
    role: (id: string) => roles.find((r) => r.id === id),
    deleteChannel: (id: string) => {
      const i = channels.findIndex((c) => c.id === id);
      if (i >= 0) channels.splice(i, 1);
    },
    deleteRole: (id: string) => {
      const i = roles.findIndex((r) => r.id === id);
      if (i >= 0) roles.splice(i, 1);
    },
  };
};

describe("setting up a server as a Venue", () => {
  it.effect("makes a multiballs channel only the bot posts in, and a mentionable ping role", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild({ channels: [{ id: "c-general", name: "general" }] });
      const venue = yield* setUpVenue(guild.port, Option.none());
      expect(guild.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      // A Venue is named by its server's id.
      expect(venue).toMatchObject({ name: "g-racing", guildId: "g-racing" });
      expect(guild.channel(venue.channelId)?.name).toBe("multiballs");
      expect(guild.channel(venue.channelId)?.access).toEqual(MATCH_CHANNEL_ACCESS);
      expect(guild.role(venue.pingRoleId)).toMatchObject({
        name: "Multiplayer ping",
        mentionable: true,
      });
    }),
  );

  it("lets the bot do everything it checks for in its channel, and members only talk in threads", () => {
    expect(MATCH_CHANNEL_ACCESS.everyoneDenied).toEqual(["SendMessages"]);
    expect(MATCH_CHANNEL_ACCESS.botAllowed).toEqual(REQUIRED_PERMISSIONS.map(([, flag]) => flag));
    expect(MATCH_CHANNEL_ACCESS.botAllowed).toEqual([
      "ViewChannel",
      "SendMessages",
      "EmbedLinks",
      "AttachFiles",
      "ReadMessageHistory",
      "CreatePublicThreads",
      "SendMessagesInThreads",
      "ManageThreads",
    ]);
  });

  it.effect(
    "reuses a multiballs channel, setting its permissions, and a ping role below the bot",
    () =>
      Effect.gen(function* () {
        const guild = makeFakeGuild({
          channels: [
            { id: "c-general", name: "general" },
            { id: "c-mb", name: "multiballs" },
          ],
          roles: [{ id: "r-ping", name: "Multiplayer ping", position: 3 }],
          botTop: 5,
        });
        const venue = yield* setUpVenue(guild.port, Option.none());
        expect(guild.made()).toEqual([]);
        expect(venue).toEqual({
          name: "g-racing",
          guildId: "g-racing",
          channelId: "c-mb",
          pingRoleId: "r-ping",
        });
        expect(guild.channel("c-mb")?.access).toEqual(MATCH_CHANNEL_ACCESS);
      }),
  );

  it.effect("makes its own ping role when the one by that name sits above the bot's", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild({
        roles: [{ id: "r-ping", name: "Multiplayer ping", position: 7 }],
        botTop: 5,
      });
      const venue = yield* setUpVenue(guild.port, Option.none());
      expect(venue.pingRoleId).not.toBe("r-ping");
      expect(guild.made()).toContain("role @Multiplayer ping");
    }),
  );

  it.effect("leaves a stored Venue whose channel and role are there as it is", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild({
        channels: [{ id: "c-racing", name: "match-room" }],
        roles: [{ id: "r-racing", name: "pingers", position: 2 }],
        missing: ["Manage Channels"],
      });
      expect(yield* setUpVenue(guild.port, Option.some(RACING))).toEqual(RACING);
      expect(guild.made()).toEqual([]);
      expect(guild.channel("c-racing")?.access).toBeNull();
    }),
  );

  it.effect("sets up again only what a stored Venue lost", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild({
        channels: [{ id: "c-racing", name: "multiballs" }],
        roles: [{ id: "r-racing", name: "Multiplayer ping", position: 2 }],
      });
      guild.deleteRole("r-racing");
      const noRole = yield* setUpVenue(guild.port, Option.some(RACING));
      expect(noRole.channelId).toBe("c-racing");
      expect(guild.made()).toEqual(["role @Multiplayer ping"]);

      guild.deleteChannel("c-racing");
      const noChannel = yield* setUpVenue(guild.port, Option.some(noRole));
      expect(noChannel.pingRoleId).toBe(noRole.pingRoleId);
      expect(guild.made()).toEqual(["role @Multiplayer ping", "channel #multiballs"]);
    }),
  );

  it.effect("fails, saying what the bot lacks, without Manage Channels or Manage Roles", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild({ missing: ["Manage Channels", "Manage Roles"] });
      const failed = yield* Effect.flip(setUpVenue(guild.port, Option.none()));
      expect(failed).toBeInstanceOf(VenueSetupFailed);
      expect(failed.reason).toContain("Manage Channels, Manage Roles");
      expect(failed.reason).not.toContain("invite");
      expect(guild.made()).toEqual([]);
    }),
  );

  it.effect("asks only for what it does: Manage Channels to make the channel", () =>
    Effect.gen(function* () {
      // The role is there; only the channel is made.
      const guild = makeFakeGuild({
        roles: [{ id: "r-ping", name: "Multiplayer ping", position: 2 }],
        missing: ["Manage Roles"],
      });
      const venue = yield* setUpVenue(guild.port, Option.none());
      expect(venue.pingRoleId).toBe("r-ping");
      expect(guild.made()).toEqual(["channel #multiballs"]);
      const noChannels = makeFakeGuild({
        roles: [{ id: "r-ping", name: "Multiplayer ping", position: 2 }],
        missing: ["Manage Channels"],
      });
      const failed = yield* Effect.flip(setUpVenue(noChannels.port, Option.none()));
      expect(failed.reason).toContain("Manage Channels");
      expect(failed.reason).not.toContain("Manage Roles");
    }),
  );

  it.effect("asks only for what it does: Manage Roles to make the role or fix the channel", () =>
    Effect.gen(function* () {
      // Repairing only a lost role needs no Manage Channels.
      const guild = makeFakeGuild({
        channels: [{ id: "c-racing", name: "multiballs" }],
        missing: ["Manage Channels"],
      });
      expect((yield* setUpVenue(guild.port, Option.some(RACING))).channelId).toBe("c-racing");
      expect(guild.made()).toEqual(["role @Multiplayer ping"]);
      // Reusing a multiballs channel sets its overwrites, which takes Manage Roles.
      const noRoles = makeFakeGuild({
        channels: [{ id: "c-mb", name: "multiballs" }],
        roles: [{ id: "r-ping", name: "Multiplayer ping", position: 2 }],
        missing: ["Manage Roles"],
      });
      const failed = yield* Effect.flip(setUpVenue(noRoles.port, Option.none()));
      expect(failed.reason).toContain("Manage Roles");
      expect(failed.reason).not.toContain("Manage Channels");
    }),
  );

  it.effect("reads the bot's member once per setup", () =>
    Effect.gen(function* () {
      const guild = makeFakeGuild();
      yield* setUpVenue(guild.port, Option.none());
      expect(guild.botReads()).toBe(1);
    }),
  );
});

/** Venue rows in a SQLite database in memory, for as long as the test's scope. */
const records = Effect.map(
  Layer.build(VenueRecordsLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" })))),
  (ctx) => Context.get(ctx, VenueRecords),
);

/**
 * The joiner over a fresh database (or `store`), given the servers other than home (the caller
 * leaves home out), each Venue passing its check unless `failing` says why not, and what it told
 * ops and why it asked to restart.
 */
const joiner = Effect.fn("joiner")(function* (
  opts: {
    readonly store?: Context.Tag.Service<typeof VenueRecords>;
    readonly failing?: Ref.Ref<string | null>;
  } = {},
) {
  // A day after Venues began, so the baseline is taken then.
  if (opts.store === undefined) yield* TestClock.setTime(NOW);
  const store = opts.store ?? (yield* records);
  const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
  const restarts = yield* Ref.make<ReadonlyArray<string>>([]);
  const checks = yield* Ref.make<ReadonlyArray<"cache" | "api">>([]);
  const failing = opts.failing ?? (yield* Ref.make<string | null>(null));
  const guests = makeGuests();
  const joins = yield* makeVenueJoiner(
    (venue: VenueConfig, cached: boolean) =>
      Ref.update(checks, (all) => [...all, cached ? "cache" : "api"] as const).pipe(
        Effect.zipRight(Ref.get(failing)),
        Effect.flatMap((reason) =>
          reason === null ? Effect.succeed(venue) : Effect.fail(new VenueCheckFailed({ reason })),
        ),
      ),
    opsAlertsOf({
      configured: true,
      post: (message) => Ref.update(alerts, (all) => [...all, message]),
    }),
    // The same ask again joins the restart already asked for, as the Restart port does.
    (why) => Ref.update(restarts, (all) => (all.includes(why) ? all : [...all, why])),
  ).pipe(Effect.provideService(VenueRecords, store), Effect.provideService(Guests, guests));
  return {
    joins,
    store,
    failing,
    /** Start up with these servers; the names of the Venues it runs. */
    startup: (guilds: ReadonlyArray<SetupGuild>) =>
      Effect.map(joins.startup(guilds), (venues) => venues.map((v) => v.name)),
    /** The background pass after startup: each server tried. */
    background: (guilds: ReadonlyArray<SetupGuild>) =>
      Effect.forEach(guilds, (g) => joins.retry(g), { discard: true }),
    /** A running guest's channel or role was deleted, as the Surface reports it. */
    broke: (venue: string) => guests.broke(venue),
    alerts: Ref.get(alerts),
    /** Why the bot asked to restart, each reason once. */
    restarts: Ref.get(restarts),
    /** How each check read the server: from the cache, or over the API. */
    checks: Ref.get(checks),
    /** The bot restarts: nothing is running, and ops' memory of what it said is gone. */
    restart: () => joiner({ store, failing }),
  };
});

/** When the tests' bot first starts this build. */
const NOW = Date.parse("2026-10-23T00:00:00Z");

describe("which servers become Venues", () => {
  it.scoped("on this build's first start, none the bot was already in, and nothing is made", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      const old = makeFakeGuild({ id: "g-old" });
      expect(yield* j.startup([old.port])).toEqual([]);
      yield* j.background([old.port]);
      // Nor on any later start, or retry.
      const again = yield* j.restart();
      expect(yield* again.startup([old.port])).toEqual([]);
      yield* again.background([old.port]);
      expect(yield* j.restarts).toEqual([]);
      expect(yield* again.restarts).toEqual([]);
      expect(old.made()).toEqual([]);
    }),
  );

  it.scoped("on this build's first start, a server the bot joined since Venues began", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      const racing = makeFakeGuild({ joinedAt: Date.parse("2026-10-22T09:30:00Z") });
      const atCutoff = makeFakeGuild({ id: "g-cutoff", joinedAt: VENUES_SINCE });
      const before = makeFakeGuild({ id: "g-before", joinedAt: VENUES_SINCE - 1 });
      const unknown = makeFakeGuild({ id: "g-unknown", joinedAt: null });
      const all = [racing.port, atCutoff.port, before.port, unknown.port];
      expect(yield* j.startup(all)).toEqual([]);
      yield* j.background(all);
      expect(yield* j.restarts).toHaveLength(2);
      expect(before.made()).toEqual([]);
      expect(unknown.made()).toEqual([]);
      const again = yield* j.restart();
      expect(yield* again.startup(all)).toEqual(["g-racing", "g-cutoff"]);
    }),
  );

  it.scoped("a server that invites the bot: set up and stored, then run after a restart", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      expect(racing.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      expect(Option.isSome(yield* j.store.byGuild("g-racing"))).toBe(true);
      expect(yield* j.restarts).toHaveLength(1);
      expect(yield* j.alerts).toEqual([]);
    }),
  );

  it.scoped("a stored Venue at startup: checked from the cache, with no Discord calls", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const calls = racing.apiCalls();
      const again = yield* j.restart();
      expect(yield* again.startup([racing.port])).toEqual(["g-racing"]);
      expect(racing.apiCalls()).toBe(calls);
      expect(yield* again.checks).toEqual(["cache"]);
      // Running, so the background leaves it alone.
      yield* again.background([racing.port]);
      expect(racing.apiCalls()).toBe(calls);
      expect(yield* again.restarts).toEqual([]);
    }),
  );

  it.scoped("a server that invited the bot while it was down, in the background", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const again = yield* j.restart();
      const racing = makeFakeGuild();
      expect(yield* again.startup([racing.port])).toEqual([]);
      yield* again.background([racing.port]);
      expect(yield* again.restarts).toHaveLength(1);
    }),
  );

  it.scoped("a server that invited the bot while it started up, at the next retry", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      yield* j.joins.retry(makeFakeGuild({ joinedAt: NOW }).port);
      expect(yield* j.restarts).toHaveLength(1);
    }),
  );

  it.scoped("a stored Venue that lost its channel: repaired in the background, then run", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const first = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      racing.deleteChannel(first.channelId);
      const again = yield* j.restart();
      expect(yield* again.startup([racing.port])).toEqual([]);
      yield* again.background([racing.port]);
      expect(yield* again.restarts).toHaveLength(1);
      const repaired = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      expect(repaired.channelId).not.toBe(first.channelId);
      expect(repaired.pingRoleId).toBe(first.pingRoleId);
      const third = yield* again.restart();
      expect(yield* third.startup([racing.port])).toEqual(["g-racing"]);
    }),
  );

  it.scoped("a running Venue that broke: repaired by the next retry, which restarts", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const again = yield* j.restart();
      yield* again.startup([racing.port]);
      yield* again.broke("g-racing");
      yield* again.background([racing.port]);
      expect(yield* again.restarts).toHaveLength(1);
    }),
  );

  it.scoped("a server it was in, removed and invited again while the bot was down", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      const old = makeFakeGuild({ id: "g-old" });
      yield* j.startup([old.port]);
      yield* TestClock.adjust("2 hours");
      old.rejoin(NOW + 3_600_000);
      const again = yield* j.restart();
      yield* again.startup([old.port]);
      yield* again.background([old.port]);
      expect(yield* again.restarts).toHaveLength(1);
      expect(old.made()).not.toEqual([]);
    }),
  );

  it.scoped("a running Venue's server that removes the bot restarts it; another doesn't", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const again = yield* j.restart();
      yield* again.startup([racing.port]);
      yield* again.joins.removed("g-other");
      expect(yield* again.restarts).toEqual([]);
      yield* again.joins.removed("g-racing");
      expect(yield* again.restarts).toHaveLength(1);
    }),
  );

  it.scoped("each on its own: a bug setting one up is logged, ops told once, the next set up", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const broken = makeFakeGuild({ id: "g-broken" });
      broken.setFault("crash");
      const racing = makeFakeGuild();
      const again = yield* j.restart();
      yield* again.startup([broken.port, racing.port]);
      yield* again.background([broken.port, racing.port]);
      yield* again.joins.retry(broken.port);
      expect(yield* again.restarts).toHaveLength(1);
      const said = yield* again.alerts;
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("g-broken");
      expect(said[0]).toContain("setting it up failed (see the log)");
    }),
  );

  it.scoped("each on its own: one Discord doesn't answer for is left out after 30 seconds", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const slow = makeFakeGuild({ id: "g-slow" });
      yield* slow.hold();
      const racing = makeFakeGuild();
      const pass = yield* Effect.fork(j.background([slow.port, racing.port]));
      yield* TestClock.adjust("30 seconds");
      yield* Fiber.join(pass);
      expect(yield* j.restarts).toHaveLength(1);
      expect((yield* j.alerts)[0]).toContain("g-slow");
    }),
  );

  it.scoped(
    "a setup past its time limit isn't cut off: it makes its channel when Discord answers",
    () =>
      Effect.gen(function* () {
        const j = yield* joiner();
        yield* j.startup([]);
        const slow = makeFakeGuild({ id: "g-slow", joinedAt: NOW });
        const gate = yield* slow.hold();
        const first = yield* Effect.fork(j.joins.retry(slow.port));
        yield* TestClock.adjust("30 seconds");
        yield* Fiber.join(first);
        yield* Deferred.succeed(gate, undefined);
        yield* Effect.repeatN(Effect.yieldNow(), 50);
        expect(slow.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      }),
  );

  it.scoped("one setup at a time per server: a retry skips a slow one, making nothing twice", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const slow = makeFakeGuild({ id: "g-slow", joinedAt: NOW });
      const gate = yield* slow.hold();
      const first = yield* Effect.fork(j.joins.retry(slow.port));
      yield* TestClock.adjust("30 seconds");
      yield* Fiber.join(first);
      // The first setup is still making the channel when the retry comes: it is skipped.
      yield* j.joins.retry(slow.port);
      yield* Deferred.succeed(gate, undefined);
      yield* Effect.repeatN(Effect.yieldNow(), 50);
      // The next retry finds what the first made, and runs it.
      yield* j.joins.retry(slow.port);
      expect(slow.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      expect(yield* j.restarts).toHaveLength(1);
    }),
  );

  it.scoped("a server set up and waiting for its restart: set up again harmlessly", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      yield* j.joins.retry(racing.port);
      yield* j.background([racing.port]);
      expect(racing.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      expect(yield* j.restarts).toHaveLength(1);
      expect(yield* j.alerts).toEqual([]);
    }),
  );

  it.scoped("a running Venue that broke, whose server removes the bot: restarts all the same", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const again = yield* j.restart();
      yield* again.startup([racing.port]);
      yield* again.broke("g-racing");
      yield* again.joins.removed("g-racing");
      expect(yield* again.restarts).toHaveLength(1);
    }),
  );
});

describe("a server that can't be set up yet", () => {
  it.scoped("is kept as wanted, retried until it sets up, and ops hears it once per reason", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild({ missing: ["Manage Channels", "Manage Roles"] });
      yield* j.joins.invited(racing.port);
      yield* j.joins.retry(racing.port);
      yield* j.joins.retry(racing.port);
      expect(yield* j.restarts).toEqual([]);
      const said = yield* j.alerts;
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("Ballest Racing");
      expect(said[0]).toContain("Manage Channels");

      // Its check fails for a new reason: ops hears that once too.
      racing.grantAll();
      yield* Ref.set(j.failing, "no access to its channel");
      yield* j.joins.retry(racing.port);
      yield* j.joins.retry(racing.port);
      expect(yield* j.alerts).toHaveLength(2);
      expect((yield* j.alerts)[1]).toContain("no access to its channel");

      // Now it sets up: the bot restarts to run it.
      yield* Ref.set(j.failing, null);
      yield* j.joins.retry(racing.port);
      expect(yield* j.restarts).toHaveLength(1);
    }),
  );

  it.scoped("tells ops once per Discord error, whatever Discord's words", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      racing.setFault(
        new VenueSetupFailed({ reason: "fetch channels: [500] oops", kind: "discord 5xx" }),
      );
      yield* j.joins.invited(racing.port);
      racing.setFault(
        new VenueSetupFailed({ reason: "fetch channels: [502] bad gateway", kind: "discord 5xx" }),
      );
      yield* j.joins.retry(racing.port);
      expect(yield* j.alerts).toHaveLength(1);
      // A different lasting failure is news.
      racing.setFault(
        new VenueSetupFailed({
          reason: "fetch channels: [50001] Missing Access",
          kind: "discord 50001",
        }),
      );
      yield* j.joins.retry(racing.port);
      expect(yield* j.alerts).toHaveLength(2);
    }),
  );

  it.scoped("is told to ops afresh once it removes the bot and invites it again", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild({ missing: ["Manage Channels"] });
      yield* j.joins.invited(racing.port);
      yield* j.joins.removed("g-racing");
      yield* j.joins.invited(racing.port);
      expect(yield* j.alerts).toHaveLength(2);
    }),
  );

  it.scoped("is retried after the next start too", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild({ missing: ["Manage Channels"] });
      yield* j.joins.invited(racing.port);
      racing.grantAll();
      const again = yield* j.restart();
      yield* again.startup([racing.port]);
      yield* again.background([racing.port]);
      expect(yield* again.restarts).toHaveLength(1);
    }),
  );
});

describe("a baseline taken by a build that kept no time", () => {
  it.scoped("keeps a server it counted out unwanted, and takes its time as the next start's", () =>
    Effect.gen(function* () {
      const sql = yield* Layer.build(SqliteClient.layer({ filename: ":memory:" }));
      const store = Context.get(
        yield* Layer.build(VenueRecordsLive.pipe(Layer.provide(Layer.succeedContext(sql)))),
        VenueRecords,
      );
      // What the build before 0012 wrote: the row with no time, and the server it counted out,
      // which the bot joined after Venues began.
      yield* Effect.flatMap(SqlClient.SqlClient, (db) =>
        Effect.all([
          db`INSERT INTO known_servers_baseline (id) VALUES (1)`,
          db`INSERT INTO known_servers (guild_id, wanted) VALUES ('g-old', 0)`,
        ]),
      ).pipe(Effect.provide(sql), Effect.orDie);
      yield* TestClock.setTime(NOW);
      const j = yield* joiner({ store });
      const old = makeFakeGuild({ id: "g-old", joinedAt: Date.parse("2026-10-22T09:00:00Z") });
      yield* j.startup([old.port]);
      yield* j.background([old.port]);
      expect(old.made()).toEqual([]);
      expect(yield* j.restarts).toEqual([]);
      expect(yield* store.baselineTakenAt).toEqual(Option.some(NOW));
      // Only a later rejoin wants it.
      old.rejoin(NOW + 60_000);
      yield* j.joins.retry(old.port);
      expect(yield* j.restarts).toHaveLength(1);
    }),
  );
});

describe("a click", () => {
  const venue = (name: string, channelId: string) =>
    ({ name, channel: { id: channelId } }) as unknown as DiscordVenue;
  const click = (channelId: string, parentId: string | null = null) =>
    ({
      channelId,
      channel: { isThread: () => parentId !== null, parentId },
    }) as unknown as Interaction;
  const running = [venue("home", "c-home"), venue("g-racing", "c-racing")];

  it("goes to the Venue whose channel or Match Thread it came from", () => {
    expect(routeClick(running, () => false, click("c-racing"))).toMatchObject({
      _tag: "Venue",
      venue: { name: "g-racing" },
    });
    expect(routeClick(running, () => false, click("t-1", "c-home"))).toMatchObject({
      _tag: "Venue",
      venue: { name: "home" },
    });
    expect(routeClick(running, () => false, click("c-general"))._tag).toBe("Elsewhere");
  });

  it("in a Venue being repaired, is told so and opens nothing", () => {
    const repairing = (name: string) => name === "g-racing";
    expect(routeClick(running, repairing, click("c-racing"))._tag).toBe("Repairing");
    expect(routeClick(running, repairing, click("c-home"))._tag).toBe("Venue");
  });
});

describe("the guest Venues on offer", () => {
  it.effect("are each guest once its channel is up, until it breaks; never another Venue", () =>
    Effect.gen(function* () {
      const guests = makeGuests();
      yield* guests.start("g-racing");
      yield* guests.start("g-third");
      expect(guests.unavailable("g-racing")).toBe(true);
      expect(guests.unavailable("home")).toBe(false);
      yield* guests.up("g-racing");
      expect(guests.unavailable("g-racing")).toBe(false);
      expect(guests.unavailable("g-third")).toBe(true);
      yield* guests.broke("g-racing");
      expect(guests.unavailable("g-racing")).toBe(true);
      // Broken until the restart, whatever its channel does meanwhile.
      yield* guests.up("g-racing");
      expect(guests.unavailable("g-racing")).toBe(true);
      expect(guests.started("g-racing")).toBe(true);
      // Home never starts as a guest: nothing it reports changes it.
      yield* guests.broke("home");
      expect(guests.unavailable("home")).toBe(false);
      expect(guests.started("home")).toBe(false);
    }),
  );
});

describe("the retries", () => {
  it.scoped("first come 20 seconds after startup, then every five minutes", () =>
    Effect.gen(function* () {
      const passes = yield* Ref.make(0);
      yield* Effect.forkScoped(retryPasses(Ref.update(passes, (n) => n + 1)));
      const at = Effect.fn("at")(function* (wait: Duration.DurationInput) {
        yield* TestClock.adjust(wait);
        yield* Effect.repeatN(Effect.yieldNow(), 5);
        return yield* Ref.get(passes);
      });
      expect(yield* at("19 seconds")).toBe(0);
      expect(yield* at("1 second")).toBe(1);
      expect(yield* at("5 minutes")).toBe(2);
      expect(yield* at("5 minutes")).toBe(3);
    }),
  );
});

describe("starting home", () => {
  it.effect("runs it when it passes its checks", () =>
    Effect.gen(function* () {
      expect(yield* startHome(HOME, (v) => Effect.succeed(v.name))).toBe("home");
    }),
  );

  it.effect("stops the bot when it fails them", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        startHome(HOME, (v) => Effect.fail(new VenueCheckFailed({ reason: `no ${v.channelId}` }))),
      );
      if (Exit.isSuccess(exit)) return expect.unreachable();
      expect(Cause.isDie(exit.cause)).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain("no c-home");
    }),
  );
});

describe("checking a Venue", () => {
  it.effect("turns a discord.js call that throws into that Venue's check failing", () =>
    Effect.gen(function* () {
      // A text channel in the Venue's server whose permissions discord.js can't work out.
      const channel = {
        type: ChannelType.GuildText,
        id: RACING.channelId,
        guildId: RACING.guildId,
        name: "multiballs",
        permissionsFor: () => {
          throw new Error("no cached member");
        },
      };
      const client = {
        user: { id: "bot" },
        channels: { fetch: () => Promise.resolve(channel) },
      } as unknown as Client<true>;
      const failed = yield* Effect.flip(checkVenue(client, RACING));
      expect(failed).toBeInstanceOf(VenueCheckFailed);
      expect(failed.reason).toContain("no cached member");
    }),
  );

  it("tells Discord's failures apart by Discord's code, else the HTTP status, not their words", () => {
    const kindOf = (cause: unknown) => discordKind(new DiscordError({ op: "fetch", cause }));
    expect(kindOf({ code: 50001, message: "Missing Access" })).toBe("discord 50001");
    expect(kindOf({ status: 403, message: "Forbidden" })).toBe("discord 403");
    // Discord down is one kind, whatever the status or code.
    expect(kindOf({ status: 503, message: "Service Unavailable" })).toBe("discord 5xx");
    expect(kindOf({ status: 502, code: 0, message: "Bad Gateway" })).toBe("discord 5xx");
    expect(kindOf("timed out")).toBe("discord");
  });
});
