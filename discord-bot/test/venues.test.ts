// Which Venues the bot plays in: home from its three settings, and every other server the bot is
// in, which it sets up itself (spec #315, #321): a `multiballs` channel and a `Multiplayer ping`
// role, found or made, kept in SQLite and set up again when one is gone. Setup runs here against
// a fake server; the discord.js calls behind it are tried in the sandbox.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { ChannelType, type Client } from "discord.js";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { checkVenue } from "../src/discord/client.js";
import {
  type ChannelAccess,
  joinVenue,
  MATCH_CHANNEL_ACCESS,
  REQUIRED_PERMISSIONS,
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
    readonly missing?: ReadonlyArray<string>;
  } = {},
) => {
  let next = 1;
  const channels: Array<FakeChannel> = (opts.channels ?? []).map((c) => ({ ...c, access: null }));
  const roles: Array<FakeRole> = (opts.roles ?? []).map((r) => ({ ...r, mentionable: false }));
  const made: Array<string> = [];
  const port: SetupGuild = {
    id: opts.id ?? "g-racing",
    name: "Ballest Racing",
    missingServerPermissions: Effect.sync(() => opts.missing ?? []),
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
    botTopRolePosition: Effect.sync(() => opts.botTop ?? 10),
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
      expect(guild.made()).toEqual([]);
    }),
  );
});

/** Venue rows in a SQLite database in memory, for as long as the test's scope. */
const records = Effect.map(
  Layer.build(VenueRecordsLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" })))),
  (ctx) => Context.get(ctx, VenueRecords),
);

describe("joining a server", () => {
  const passing = (v: VenueConfig) => Effect.succeed(v);

  it.scoped("sets it up, stores it, and starts it", () =>
    Effect.gen(function* () {
      const store = yield* records;
      const guild = makeFakeGuild();
      const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
      const started = yield* joinVenue(guild.port, passing, (m) =>
        Ref.update(alerts, (all) => [...all, m]),
      ).pipe(Effect.provideService(VenueRecords, store));
      expect(Option.map(started, (v) => v.name)).toEqual(Option.some("g-racing"));
      expect(yield* store.byGuild("g-racing")).toEqual(started);
      expect(yield* Ref.get(alerts)).toEqual([]);
    }),
  );

  it.scoped("picks a stored Venue back up, setting up again whatever is gone", () =>
    Effect.gen(function* () {
      const store = yield* records;
      const guild = makeFakeGuild();
      const first = yield* joinVenue(guild.port, passing, () => Effect.void).pipe(
        Effect.provideService(VenueRecords, store),
        Effect.map(Option.getOrThrow),
      );
      const again = yield* joinVenue(guild.port, passing, () => Effect.void).pipe(
        Effect.provideService(VenueRecords, store),
      );
      expect(again).toEqual(Option.some(first));
      expect(guild.made()).toEqual(["channel #multiballs", "role @Multiplayer ping"]);

      guild.deleteChannel(first.channelId);
      const repaired = yield* joinVenue(guild.port, passing, () => Effect.void).pipe(
        Effect.provideService(VenueRecords, store),
        Effect.map(Option.getOrThrow),
      );
      expect(repaired.channelId).not.toBe(first.channelId);
      expect(repaired.pingRoleId).toBe(first.pingRoleId);
      expect(yield* store.byGuild("g-racing")).toEqual(Option.some(repaired));
    }),
  );

  it.scoped("leaves out a server it can't set up or that fails its checks, telling ops", () =>
    Effect.gen(function* () {
      const store = yield* records;
      const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
      const alert = (m: string) => Ref.update(alerts, (all) => [...all, m]);
      const cantSetUp = yield* joinVenue(
        makeFakeGuild({ missing: ["Manage Roles"] }).port,
        passing,
        alert,
      ).pipe(Effect.provideService(VenueRecords, store));
      expect(cantSetUp).toEqual(Option.none());
      expect(yield* store.byGuild("g-racing")).toEqual(Option.none());

      const failsCheck = yield* joinVenue(
        makeFakeGuild().port,
        () => Effect.fail(new VenueCheckFailed({ reason: "no access to its channel" })),
        alert,
      ).pipe(Effect.provideService(VenueRecords, store));
      expect(failsCheck).toEqual(Option.none());
      const said = yield* Ref.get(alerts);
      expect(said).toHaveLength(2);
      expect(said[0]).toContain("Ballest Racing");
      expect(said[0]).toContain("Manage Roles");
      expect(said[1]).toContain("no access to its channel");
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
