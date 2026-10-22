// Which Venues the bot plays in: home from its three settings, and every server it is invited
// to, which it sets up itself (spec #315, #321): a `multiballs` channel and a `Multiplayer ping`
// role, found or made, kept in SQLite and set up again when one is gone. Setup runs here against
// a fake server; the discord.js calls behind it are tried live with the dev app.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { ChannelType, type Client } from "discord.js";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  TestClock,
} from "effect";
import { checkVenue, DiscordError, discordKind } from "../src/discord/client.js";
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
    bot: Effect.sync(() => {
      botReads++;
      return { missing, topRolePosition: opts.botTop ?? 10 };
    }),
    textChannels: Effect.suspend(() =>
      fault === "crash"
        ? Effect.dieMessage("a bug")
        : fault !== null
          ? Effect.fail(fault)
          : Effect.succeed(channels.map(({ id, name }) => ({ id, name }))),
    ),
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
    roles: Effect.sync(() => roles.map(({ id, name, position }) => ({ id, name, position }))),
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
 * The joiner over a fresh database (or `store`), with home in server g-home, each Venue passing
 * its check unless `failing` says why not, and what it told ops and why it asked to restart.
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
  const failing = opts.failing ?? (yield* Ref.make<string | null>(null));
  const joins = yield* makeVenueJoiner(
    HOME.guildId,
    (venue: VenueConfig) =>
      Effect.flatMap(Ref.get(failing), (reason) =>
        reason === null ? Effect.succeed(venue) : Effect.fail(new VenueCheckFailed({ reason })),
      ),
    (message) => Ref.update(alerts, (all) => [...all, message]),
    (why) => Ref.update(restarts, (all) => [...all, why]),
  ).pipe(Effect.provideService(VenueRecords, store));
  return {
    joins,
    store,
    failing,
    /** Start up with these servers (home's added); the names of the Venues it runs. */
    startup: (guilds: ReadonlyArray<SetupGuild>) =>
      Effect.map(joins.startup([homeGuild().port, ...guilds]), (venues) =>
        venues.map((v) => v.name),
      ),
    alerts: Ref.get(alerts),
    /** Why the bot asked to restart, each time. */
    restarts: Ref.get(restarts),
    /** The bot restarts: nothing is running, and ops' memory of what it said is gone. */
    restart: () => joiner({ store, failing }),
  };
});

const homeGuild = () => makeFakeGuild({ id: HOME.guildId });

/** When the tests' bot first starts this build. */
const NOW = Date.parse("2026-10-23T00:00:00Z");

describe("which servers become Venues", () => {
  it.scoped("on this build's first start, none the bot was already in, and nothing is made", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      const old = makeFakeGuild({ id: "g-old" });
      expect(yield* j.startup([old.port])).toEqual([]);
      expect(old.made()).toEqual([]);
      // Nor on any later start, or retry.
      const again = yield* j.restart();
      expect(yield* again.startup([old.port])).toEqual([]);
      yield* again.joins.retry(old.port);
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
      expect(yield* j.startup([racing.port, atCutoff.port, before.port, unknown.port])).toEqual([
        "g-racing",
        "g-cutoff",
      ]);
      expect(before.made()).toEqual([]);
      expect(unknown.made()).toEqual([]);
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
      const again = yield* j.restart();
      expect(yield* again.startup([racing.port])).toEqual(["g-racing"]);
      expect(racing.made()).toHaveLength(2);
    }),
  );

  it.scoped("a server that invited the bot while it was down, at the next start", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const again = yield* j.restart();
      expect(yield* again.startup([makeFakeGuild().port])).toEqual(["g-racing"]);
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

  it.scoped("a stored Venue, at each start, with whatever it lost set up again", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const first = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      racing.deleteChannel(first.channelId);
      const again = yield* j.restart();
      expect(yield* again.startup([racing.port])).toEqual(["g-racing"]);
      const repaired = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      expect(repaired.channelId).not.toBe(first.channelId);
      expect(repaired.pingRoleId).toBe(first.pingRoleId);
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
      expect(yield* again.startup([old.port])).toEqual(["g-old"]);
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
      expect(yield* again.startup([broken.port, racing.port])).toEqual(["g-racing"]);
      yield* again.joins.retry(broken.port);
      expect(yield* again.restarts).toEqual([]);
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
      const again = yield* j.restart();
      const started = yield* Effect.fork(again.startup([slow.port, racing.port]));
      yield* TestClock.adjust("30 seconds");
      expect(yield* Fiber.join(started)).toEqual(["g-racing"]);
      expect((yield* again.alerts)[0]).toContain("g-slow");
    }),
  );

  it.scoped("never home", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const home = homeGuild();
      yield* j.joins.invited(home.port);
      expect(yield* j.restarts).toEqual([]);
      expect(home.made()).toEqual([]);
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
        new VenueSetupFailed({ reason: "fetch channels: [500] oops", kind: "discord 500" }),
      );
      yield* j.joins.invited(racing.port);
      racing.setFault(
        new VenueSetupFailed({ reason: "fetch channels: [500] try later", kind: "discord 500" }),
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

  it.scoped("is retried at the next start too", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.startup([]);
      const racing = makeFakeGuild({ missing: ["Manage Channels"] });
      yield* j.joins.invited(racing.port);
      racing.grantAll();
      const again = yield* j.restart();
      expect(yield* again.startup([racing.port])).toEqual(["g-racing"]);
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
    expect(kindOf({ status: 503, message: "Service Unavailable" })).toBe("discord 503");
    expect(kindOf("timed out")).toBe("discord");
  });
});
