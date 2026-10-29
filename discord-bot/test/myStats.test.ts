// The My Stats channel (spec #323), kept through its port over an in-memory server and SQLite in
// memory: the channel made once and found by id, its one panel posted, left alone or redrawn,
// across restarts and deletions, and a failure reported to ops rather than stopping the bot.
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { Context, Effect, Layer } from "effect";
import { Gone } from "../src/discord/channel.js";
import { DiscordError } from "../src/discord/client.js";
import {
  EVERYONE_DENIED,
  missingFrom,
  MyStatsChannel,
  MyStatsPanelLive,
  NEEDED_TO_CREATE,
} from "../src/discord/myStats.js";
import { OpsAlerts, opsAlertsOf } from "../src/ops.js";

/** A server in memory: its channels by id, each with its messages, and failures on demand. */
const makeFakeServer = () => {
  let next = 1;
  let nextChannel = 1;
  const channels = new Map<string, { name: string; messages: Map<string, string> }>();
  const posted: Array<string> = [];
  const redrawn: Array<string> = [];
  const answering: Array<string> = [];
  /** Stands for the bot's build: a new one may draw the panel differently. */
  let build = 1;
  let canCreate = true;
  let discordDown = false;
  let missing: ReadonlyArray<string> = [];

  const port = MyStatsChannel.of({
    exists: (channelId) =>
      discordDown
        ? Effect.fail(new DiscordError({ op: "fetch #my-stats", cause: "503" }))
        : Effect.sync(() => channels.has(channelId)),
    missingToCreate: Effect.sync(() => missing),
    create: Effect.suspend(() => {
      if (!canCreate)
        return Effect.fail(
          new DiscordError({ op: "create #my-stats", cause: "the bot needs Manage Channels" }),
        );
      const id = `chan${nextChannel++}`;
      channels.set(id, { name: "my-stats", messages: new Map() });
      return Effect.succeed(id);
    }),
    hasMessage: (channelId, messageId) =>
      Effect.sync(() => channels.get(channelId)?.messages.has(messageId) ?? false),
    postPanel: (channelId) =>
      Effect.suspend(() => {
        const channel = channels.get(channelId);
        if (channel === undefined) return Effect.fail(new Gone({ id: channelId }));
        const id = `msg${next++}`;
        channel.messages.set(id, `panel ${build}`);
        posted.push(channelId);
        return Effect.succeed(id);
      }),
    redrawPanel: (channelId, messageId) =>
      Effect.suspend(() => {
        const messages = channels.get(channelId)?.messages;
        if (messages?.has(messageId) !== true) return Effect.fail(new Gone({ id: messageId }));
        messages.set(messageId, `panel ${build}`);
        redrawn.push(messageId);
        return Effect.void;
      }),
    panelFingerprint: Effect.sync(() => `build ${build}`),
    answerIn: (channelId) => Effect.sync(() => void answering.push(channelId)),
  });

  return {
    port,
    /** Each channel's name and what its messages show. */
    channels: () =>
      [...channels.values()].map((c) => ({ name: c.name, messages: [...c.messages.values()] })),
    posted: () => posted.length,
    redrawn: () => redrawn.length,
    /** Each channel whose presses the bot was told to take, in order. */
    answering: () => answering,
    newBuild: () => {
      build++;
    },
    rename: (name: string) => {
      for (const c of channels.values()) c.name = name;
    },
    deleteChannel: () => channels.clear(),
    deletePanel: () => {
      for (const c of channels.values()) c.messages.clear();
    },
    withoutManageChannels: () => {
      canCreate = false;
    },
    discordDown: () => {
      discordDown = true;
    },
    lacking: (names: ReadonlyArray<string>) => {
      missing = names;
    },
  };
};

/** A server and a database that outlive any one start, so a test can restart the bot. */
const setup = Effect.gen(function* () {
  const server = makeFakeServer();
  const alerts: Array<string> = [];
  const sql = yield* Layer.build(SqliteClient.layer({ filename: ":memory:" }));
  const ops = OpsAlerts.make(
    opsAlertsOf({
      configured: true,
      post: (content) => Effect.sync(() => void alerts.push(content)),
    }),
  );
  const start = Layer.build(MyStatsPanelLive).pipe(
    Effect.provide(Context.add(sql, MyStatsChannel, server.port).pipe(Context.add(OpsAlerts, ops))),
  );
  return { server, alerts, start };
});

describe("the My Stats channel", () => {
  it.scoped("is made on first start, holding the panel, and its presses reach the bot", () =>
    Effect.gen(function* () {
      const { server, start, alerts } = yield* setup;
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 1"] }]);
      expect(server.answering()).toEqual(["chan1"]);
      expect(alerts).toEqual([]);
    }),
  );

  it.scoped("edits nothing on a restart of the same build", () =>
    Effect.gen(function* () {
      const { server, start } = yield* setup;
      yield* start;
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 1"] }]);
      expect(server.posted()).toBe(1);
      expect(server.redrawn()).toBe(0);
    }),
  );

  it.scoped("redraws the panel in place when a new build draws it differently", () =>
    Effect.gen(function* () {
      const { server, start } = yield* setup;
      yield* start;
      server.newBuild();
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 2"] }]);
      expect(server.redrawn()).toBe(1);
      yield* start;
      expect(server.redrawn()).toBe(1);
    }),
  );

  it.scoped("keeps a renamed channel: it is found by id, never by name", () =>
    Effect.gen(function* () {
      const { server, start } = yield* setup;
      yield* start;
      server.rename("stats-here");
      yield* start;
      expect(server.channels()).toEqual([{ name: "stats-here", messages: ["panel 1"] }]);
    }),
  );

  it.scoped("posts the panel again when it was deleted", () =>
    Effect.gen(function* () {
      const { server, start } = yield* setup;
      yield* start;
      server.deletePanel();
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 1"] }]);
      expect(server.posted()).toBe(2);
    }),
  );

  it.scoped("makes the channel again when it was deleted", () =>
    Effect.gen(function* () {
      const { server, start } = yield* setup;
      yield* start;
      server.deleteChannel();
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 1"] }]);
      expect(server.answering()).toEqual(["chan1", "chan2"]);
    }),
  );

  it.scoped("tells ops when it can't make the channel, and starts anyway", () =>
    Effect.gen(function* () {
      const { server, start, alerts } = yield* setup;
      server.withoutManageChannels();
      yield* start;
      expect(server.channels()).toEqual([]);
      expect(alerts).toEqual([
        "Multiballs couldn't set up #my-stats: create #my-stats: the bot needs Manage Channels",
      ]);
    }),
  );

  it.scoped("names every permission the bot lacks to ops, and makes no channel without them", () =>
    Effect.gen(function* () {
      const { server, start, alerts } = yield* setup;
      server.lacking(["Manage Roles", "Embed Links"]);
      yield* start;
      expect(server.channels()).toEqual([]);
      expect(alerts).toEqual([
        "Multiballs lacks permissions it needs to make #my-stats: Manage Roles, Embed Links",
      ]);
    }),
  );

  it.scoped("keeps a channel it already made without alerting: only making one needs them", () =>
    Effect.gen(function* () {
      const { server, start, alerts } = yield* setup;
      yield* start;
      server.lacking(["Manage Roles", "Create Public Threads"]);
      server.newBuild();
      yield* start;
      server.deletePanel();
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 2"] }]);
      expect(alerts).toEqual([]);
    }),
  );

  it.scoped("makes no second channel when Discord can't say whether the first is there", () =>
    Effect.gen(function* () {
      const { server, start, alerts } = yield* setup;
      yield* start;
      server.discordDown();
      yield* start;
      expect(server.channels()).toEqual([{ name: "my-stats", messages: ["panel 1"] }]);
      expect(alerts).toEqual(["Multiballs couldn't set up #my-stats: fetch #my-stats: 503"]);
    }),
  );
});

describe("the My Stats channel's permissions", () => {
  it("denies @everyone messages, threads and reactions", () => {
    expect(new PermissionsBitField(EVERYONE_DENIED).toArray().sort()).toEqual([
      "AddReactions",
      "CreatePrivateThreads",
      "CreatePublicThreads",
      "SendMessages",
      "SendMessagesInThreads",
    ]);
  });

  it("needs Manage Channels, Manage Roles and every permission its overwrites name, and names what's missing", () => {
    expect(Object.keys(NEEDED_TO_CREATE)).toEqual([
      "Manage Channels",
      "Manage Roles",
      "View Channel",
      "Send Messages",
      "Embed Links",
      "Read Message History",
      "Create Public Threads",
      "Create Private Threads",
      "Send Messages in Threads",
      "Add Reactions",
    ]);
    const all = Object.values(NEEDED_TO_CREATE).reduce((a, b) => a | b);
    for (const denied of EVERYONE_DENIED) expect(all & denied).toBe(denied);
    expect(missingFrom(all)).toEqual([]);
    expect(missingFrom(PermissionsBitField.All)).toEqual([]);
    expect(
      missingFrom(all & ~PermissionFlagsBits.ManageRoles & ~PermissionFlagsBits.EmbedLinks),
    ).toEqual(["Manage Roles", "Embed Links"]);
  });
});
