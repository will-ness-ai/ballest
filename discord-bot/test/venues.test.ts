// Which Venues the bot plays in: home from its three settings, and every server it is invited
// to, which it sets up itself (spec #315, #321): a `multiballs` channel and a `Multiplayer ping`
// role, found or made, kept in SQLite and set up again when one is gone. Setup runs here against
// a fake server; the discord.js calls behind it are tried live with the dev app.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { ChannelType, type Client } from "discord.js";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { checkVenue } from "../src/discord/client.js";
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
  const channels: Array<FakeChannel> = (opts.channels ?? []).map((c) => ({ ...c, access: null }));
  const roles: Array<FakeRole> = (opts.roles ?? []).map((r) => ({ ...r, mentionable: false }));
  const made: Array<string> = [];
  const port: SetupGuild = {
    id: opts.id ?? "g-racing",
    name: "Ballest Racing",
    bot: Effect.sync(() => {
      botReads++;
      return { missing, topRolePosition: opts.botTop ?? 10 };
    }),
    textChannels: Effect.sync(() => channels.map(({ id, name }) => ({ id, name }))),
    createTextChannel: (name, access) =>
      Effect.sync(() => {
        const id = `c-new${next++}`;
        channels.push({ id, name, access });
        made.push(`channel #${name}`);
        return id;
      }),
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
 * its check unless `failing` says why not, and what it started and told ops.
 */
const joiner = Effect.fn("joiner")(function* (
  opts: {
    readonly store?: Context.Tag.Service<typeof VenueRecords>;
    readonly failing?: Ref.Ref<string | null>;
  } = {},
) {
  const store = opts.store ?? (yield* records);
  const started = yield* Ref.make<ReadonlyMap<string, VenueConfig>>(new Map());
  const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
  const failing = opts.failing ?? (yield* Ref.make<string | null>(null));
  const joins = yield* makeVenueJoiner(
    HOME.guildId,
    (venue: VenueConfig) =>
      Effect.flatMap(Ref.get(failing), (reason) =>
        reason === null ? Effect.succeed(venue) : Effect.fail(new VenueCheckFailed({ reason })),
      ),
    (message) => Ref.update(alerts, (all) => [...all, message]),
    {
      has: (name) => Effect.map(Ref.get(started), (all) => all.has(name)),
      start: (name, venue) => Ref.update(started, (all) => new Map(all).set(name, venue)),
    },
  ).pipe(Effect.provideService(VenueRecords, store));
  return {
    joins,
    store,
    failing,
    /** The names of the running Venues the joiner started. */
    started: Effect.map(Ref.get(started), (all) => [...all.keys()]),
    alerts: Ref.get(alerts),
    /** The bot restarts: nothing is running, and ops' memory of what it said is gone. */
    restart: () => joiner({ store, failing }),
  };
});

const homeGuild = () => makeFakeGuild({ id: HOME.guildId });

describe("which servers become Venues", () => {
  it.scoped("on this build's first start, none the bot was already in, and nothing is made", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      const old = makeFakeGuild({ id: "g-old" });
      yield* j.joins.startup([homeGuild().port, old.port]);
      expect(yield* j.started).toEqual([]);
      expect(old.made()).toEqual([]);
      // Nor on any later start, or retry.
      const again = yield* j.restart();
      yield* again.joins.startup([homeGuild().port, old.port]);
      yield* again.joins.retry(old.port);
      expect(yield* again.started).toEqual([]);
      expect(old.made()).toEqual([]);
    }),
  );

  it.scoped("a server that invites the bot, set up, stored and started at once", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([homeGuild().port]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      expect(yield* j.started).toEqual(["g-racing"]);
      expect(racing.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);
      expect(Option.isSome(yield* j.store.byGuild("g-racing"))).toBe(true);
      expect(yield* j.alerts).toEqual([]);
    }),
  );

  it.scoped("a server that invited the bot while it was down, at the next start", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([homeGuild().port]);
      const again = yield* j.restart();
      yield* again.joins.startup([homeGuild().port, makeFakeGuild().port]);
      expect(yield* again.started).toEqual(["g-racing"]);
    }),
  );

  it.scoped("a stored Venue, at each start, with whatever it lost set up again", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([homeGuild().port]);
      const racing = makeFakeGuild();
      yield* j.joins.invited(racing.port);
      const first = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      racing.deleteChannel(first.channelId);
      const again = yield* j.restart();
      yield* again.joins.startup([homeGuild().port, racing.port]);
      expect(yield* again.started).toEqual(["g-racing"]);
      const repaired = Option.getOrThrow(yield* j.store.byGuild("g-racing"));
      expect(repaired.channelId).not.toBe(first.channelId);
      expect(repaired.pingRoleId).toBe(first.pingRoleId);
    }),
  );

  it.scoped("never home", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([]);
      const home = homeGuild();
      yield* j.joins.invited(home.port);
      expect(yield* j.started).toEqual([]);
      expect(home.made()).toEqual([]);
    }),
  );
});

describe("a server that can't be set up yet", () => {
  it.scoped("is kept as wanted, retried until it starts, and ops hears it once per reason", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([homeGuild().port]);
      const racing = makeFakeGuild({ missing: ["Manage Channels", "Manage Roles"] });
      yield* j.joins.invited(racing.port);
      yield* j.joins.retry(racing.port);
      yield* j.joins.retry(racing.port);
      expect(yield* j.started).toEqual([]);
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

      yield* Ref.set(j.failing, null);
      yield* j.joins.retry(racing.port);
      expect(yield* j.started).toEqual(["g-racing"]);
    }),
  );

  it.scoped("is retried at the next start too", () =>
    Effect.gen(function* () {
      const j = yield* joiner();
      yield* j.joins.startup([homeGuild().port]);
      const racing = makeFakeGuild({ missing: ["Manage Channels"] });
      yield* j.joins.invited(racing.port);
      racing.grantAll();
      const again = yield* j.restart();
      yield* again.joins.startup([homeGuild().port, racing.port]);
      expect(yield* again.started).toEqual(["g-racing"]);
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
});
