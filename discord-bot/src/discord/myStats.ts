// The My Stats channel (spec #323): a read-only #my-stats the bot makes in its server, holding one
// panel message whose See my stats button answers each member privately. Kept in SQLite, so it
// is found by id at each start and an admin may rename or move it.
//
// The rules, at each start:
// - No channel stored, or the stored one is gone: make #my-stats, read-only to @everyone (no
//   messages, threads or reactions), and keep its id at once, so a crash after it never makes a
//   second one. To make it, the bot must hold Manage Channels, Manage Roles and every permission
//   the channel's overwrites name, allowed or denied, where the channel will be (the Match
//   channel's category, else the server): Discord refuses an overwrite naming one the bot lacks.
//   Any missing goes to the ops channel by name, and no channel is made without them. A channel
//   that is already there needs none of them, so it raises no alert.
// - The panel is edited only when this build draws it differently (like the Footer, PR #151):
//   an edit shows as activity in the channel. A deleted panel is posted again.
// - Anything that fails (most likely the bot lacking Manage Channels) goes to the ops channel and
//   the bot runs on without it: the Matches never depend on it.
import { SqlClient, SqlSchema } from "@effect/sql";
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { OpsAlerts } from "../ops.js";
import { Gone } from "./channel.js";
import {
  describeDiscordError,
  Discord,
  DiscordError,
  hasCode,
  tryDiscord,
  UNKNOWN_CHANNEL,
  UNKNOWN_MESSAGE,
} from "./client.js";
import { fingerprint, myStatsPanelMessage } from "./messages.js";

/** The channel or the message was deleted. */
const isUnknown = (e: DiscordError) => hasCode(e, UNKNOWN_MESSAGE, UNKNOWN_CHANNEL);

export const MY_STATS_NAME = "my-stats";

export class MyStatsChannel extends Context.Tag("multiballs/MyStatsChannel")<
  MyStatsChannel,
  {
    /** Whether the channel is still a text channel in this server. */
    readonly exists: (channelId: string) => Effect.Effect<boolean, DiscordError>;
    /**
     * The permissions making #my-stats needs (NEEDED_TO_CREATE) that the bot lacks where it will
     * be made, by name.
     */
    readonly missingToCreate: Effect.Effect<ReadonlyArray<string>, DiscordError>;
    /** Make #my-stats, read-only to everyone but the bot; its id. */
    readonly create: Effect.Effect<string, DiscordError>;
    /** Whether the message is still in the channel. */
    readonly hasMessage: (
      channelId: string,
      messageId: string,
    ) => Effect.Effect<boolean, DiscordError>;
    /** Post the panel; its id. */
    readonly postPanel: (channelId: string) => Effect.Effect<string, Gone | DiscordError>;
    readonly redrawPanel: (
      channelId: string,
      messageId: string,
    ) => Effect.Effect<void, Gone | DiscordError>;
    /** What this build's panel looks like: equal fingerprints draw the same message. */
    readonly panelFingerprint: Effect.Effect<string>;
    /** Take the panel's presses in this channel. */
    readonly answerIn: (channelId: string) => Effect.Effect<void>;
  }
>() {}

const Row = Schema.Struct({
  channel_id: Schema.String,
  panel_id: Schema.NullOr(Schema.String),
  panel_fingerprint: Schema.NullOr(Schema.String),
});

const make = Effect.gen(function* () {
  const channel = yield* MyStatsChannel;
  const sql = yield* SqlClient.SqlClient;
  const alerts = yield* OpsAlerts;

  const load = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Row,
    execute: () =>
      sql`SELECT channel_id, panel_id, panel_fingerprint FROM my_stats_channel WHERE id = 1`,
  });
  const save = Effect.fn("MyStats.save")(function* (row: typeof Row.Type) {
    yield* sql`INSERT INTO my_stats_channel ${sql.insert({ id: 1, ...row })}
        ON CONFLICT (id) DO UPDATE SET channel_id = excluded.channel_id, panel_id = excluded.panel_id,
        panel_fingerprint = excluded.panel_fingerprint`.pipe(Effect.orDie);
  });

  const keep = Effect.gen(function* () {
    const saved = Option.getOrNull(yield* load(undefined).pipe(Effect.orDie));
    let kept = saved !== null && (yield* channel.exists(saved.channel_id)) ? saved : null;
    if (kept === null) {
      // Discord would refuse it, or make it without its overwrites.
      const missing = yield* channel.missingToCreate;
      if (missing.length > 0)
        return yield* alerts.post(
          `Multiballs lacks permissions it needs to make #${MY_STATS_NAME}: ${missing.join(", ")}`,
        );
      kept = { channel_id: yield* channel.create, panel_id: null, panel_fingerprint: null };
      yield* save(kept);
      yield* Effect.logInfo(`my stats: made #${MY_STATS_NAME} (${kept.channel_id})`);
    }
    const channelId = kept.channel_id;
    yield* channel.answerIn(channelId);
    const drawn = yield* channel.panelFingerprint;
    if (kept.panel_id !== null && (yield* channel.hasMessage(channelId, kept.panel_id))) {
      if (drawn === kept.panel_fingerprint) return;
      yield* channel.redrawPanel(channelId, kept.panel_id);
      yield* save({ ...kept, panel_fingerprint: drawn });
    } else {
      const panelId = yield* channel.postPanel(channelId);
      yield* save({ channel_id: channelId, panel_id: panelId, panel_fingerprint: drawn });
    }
  });

  const failed = Effect.fn("MyStats.failed")(function* (why: string) {
    yield* alerts.post(`Multiballs couldn't set up #${MY_STATS_NAME}: ${why}`);
  });
  yield* keep.pipe(
    Effect.catchTags({
      Gone: (e) => failed(`${e.id} is gone`),
      DiscordError: (e) => failed(describeDiscordError(e)),
    }),
    Effect.catchAllDefect((defect) =>
      Effect.logError("my stats: setting up failed", defect).pipe(
        Effect.zipRight(failed("a bug, see the log")),
      ),
    ),
  );
});

/** Keeps the channel and its panel at startup. Needs the MyStatsChannel, OpsAlerts and a SqlClient. */
export const MyStatsPanelLive = Layer.effectDiscard(make).pipe(Layer.provide(MigratorLive));

/** What #my-stats denies @everyone, by name: it is read-only, threads and reactions included. */
const EVERYONE_DENIED_NAMED = {
  "Send Messages": PermissionFlagsBits.SendMessages,
  "Create Public Threads": PermissionFlagsBits.CreatePublicThreads,
  "Create Private Threads": PermissionFlagsBits.CreatePrivateThreads,
  "Send Messages in Threads": PermissionFlagsBits.SendMessagesInThreads,
  "Add Reactions": PermissionFlagsBits.AddReactions,
};
export const EVERYONE_DENIED = Object.values(EVERYONE_DENIED_NAMED);

/** What #my-stats allows the bot, by name: the panel needs nothing more (no files). */
const BOT_ALLOWED = {
  "View Channel": PermissionFlagsBits.ViewChannel,
  "Send Messages": PermissionFlagsBits.SendMessages,
  "Embed Links": PermissionFlagsBits.EmbedLinks,
  "Read Message History": PermissionFlagsBits.ReadMessageHistory,
};

/**
 * What the bot must hold where #my-stats will be to make it: the channel itself, its overwrites,
 * and every permission they name, allowed or denied, since Discord refuses an overwrite naming
 * one the bot lacks.
 */
export const NEEDED_TO_CREATE = {
  "Manage Channels": PermissionFlagsBits.ManageChannels,
  "Manage Roles": PermissionFlagsBits.ManageRoles,
  ...BOT_ALLOWED,
  ...EVERYONE_DENIED_NAMED,
};

/** The NEEDED_TO_CREATE permissions missing from `held`, by name. */
export const missingFrom = (held: bigint) =>
  Object.entries(NEEDED_TO_CREATE).flatMap(([name, bit]) => ((held & bit) === bit ? [] : [name]));

/** The MyStatsChannel port on discord.js, in the Match channel's server. */
export const MyStatsChannelLive = Layer.effect(
  MyStatsChannel,
  Effect.gen(function* () {
    const discord = yield* Discord;
    const client = discord.home.channel.client;
    // MY_STATS_GUILD_ID puts it in another server the bot is in (Ballest Racing, fly.toml);
    // unset, it is the Match channel's server, beside the Match channel.
    const elsewhere = yield* Config.option(Config.string("MY_STATS_GUILD_ID")).pipe(Effect.orDie);
    const home = discord.home.channel.guild;
    const away = Option.filter(elsewhere, (id) => id !== home.id);
    const guild = Option.isSome(away)
      ? yield* tryDiscord("fetch #my-stats's server", () => client.guilds.fetch(away.value))
      : home;
    /** The Match channel's category, where #my-stats is made in its server; none elsewhere. */
    const parentId = Option.isSome(away) ? null : discord.home.channel.parentId;

    /** The channel if it is still a text channel in this server, else null. */
    const find = Effect.fn("MyStats.find")(function* (channelId: string) {
      const c = yield* tryDiscord("fetch #my-stats", () => client.channels.fetch(channelId)).pipe(
        Effect.catchTag("DiscordError", (e) =>
          isUnknown(e) ? Effect.succeed(null) : Effect.fail(e),
        ),
      );
      return c?.type === ChannelType.GuildText && c.guildId === guild.id ? c : null;
    });
    const fetchChannel = Effect.fn("MyStats.fetchChannel")(function* (channelId: string) {
      const c = yield* find(channelId);
      if (c === null) return yield* new Gone({ id: channelId });
      return c;
    });
    const fetchPanel = Effect.fn("MyStats.fetchPanel")(function* (
      channelId: string,
      messageId: string,
    ) {
      const c = yield* fetchChannel(channelId);
      return yield* tryDiscord("fetch the panel", () => c.messages.fetch(messageId)).pipe(
        Effect.catchTag("DiscordError", (e): Effect.Effect<never, Gone | DiscordError> =>
          isUnknown(e) ? Effect.fail(new Gone({ id: messageId })) : Effect.fail(e),
        ),
      );
    });
    const fetchMe = tryDiscord("fetch the bot's member", () => guild.members.fetchMe());

    return MyStatsChannel.of({
      exists: Effect.fn("MyStats.exists")(function* (channelId) {
        return (yield* find(channelId)) !== null;
      }),
      // In the Match channel's category if it is made there: the category's overwrites for the
      // bot count there, not only its roles in the server.
      missingToCreate: Effect.gen(function* () {
        const self = yield* fetchMe;
        // GuildMember.permissions holds the roles' raw bits; an Administrator holds them all.
        const own = self.permissions.has(PermissionFlagsBits.Administrator)
          ? PermissionsBitField.All
          : self.permissions.bitfield;
        if (parentId === null) return missingFrom(own);
        const parent = yield* tryDiscord("fetch the Match channel's category", () =>
          guild.channels.fetch(parentId),
        );
        return missingFrom(parent?.permissionsFor(self)?.bitfield ?? own);
      }),
      create: Effect.gen(function* () {
        const self = yield* fetchMe;
        // Beside the Match channel, or at the top of another server; admins may move it anywhere.
        const made = yield* tryDiscord(`create #${MY_STATS_NAME}`, () =>
          guild.channels.create({
            name: MY_STATS_NAME,
            type: ChannelType.GuildText,
            parent: parentId,
            topic: "Press See my stats for your ranks and Medals. Only you see them.",
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: EVERYONE_DENIED },
              { id: self.id, allow: Object.values(BOT_ALLOWED) },
            ],
          }),
        );
        return made.id;
      }),
      hasMessage: Effect.fn("MyStats.hasMessage")(function* (channelId, messageId) {
        return yield* fetchPanel(channelId, messageId).pipe(
          Effect.as(true),
          Effect.catchTag("Gone", () => Effect.succeed(false)),
        );
      }),
      postPanel: Effect.fn("MyStats.postPanel")(function* (channelId) {
        const c = yield* fetchChannel(channelId);
        const m = yield* tryDiscord("post the panel", () => c.send(myStatsPanelMessage()));
        return m.id;
      }),
      redrawPanel: Effect.fn("MyStats.redrawPanel")(function* (channelId, messageId) {
        const m = yield* fetchPanel(channelId, messageId);
        yield* tryDiscord("redraw the panel", () => m.edit(myStatsPanelMessage()));
      }),
      panelFingerprint: Effect.sync(() => fingerprint(myStatsPanelMessage())),
      answerIn: Effect.fn("MyStats.answerIn")(function* (channelId) {
        return yield* discord.answerIn(channelId);
      }),
    });
  }),
);

/**
 * The My Stats channel, kept at startup. Off in the sandbox: its database is fresh each start, so
 * it would make a new #my-stats on the test server every time.
 */
export const MyStatsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const sandbox = yield* Config.boolean("MULTIBALLS_SANDBOX").pipe(Config.withDefault(false));
    if (sandbox) {
      yield* Effect.logInfo("my stats: off in the sandbox");
      return Layer.empty;
    }
    return MyStatsPanelLive.pipe(
      Layer.provide(MyStatsChannelLive),
      // the bot isn't in MY_STATS_GUILD_ID's server, or can't see it: the bot runs on without it
      Layer.catchAll((e) =>
        Layer.effectDiscard(
          Effect.flatMap(OpsAlerts, (alerts) =>
            alerts.post(
              `Multiballs couldn't set up #${MY_STATS_NAME}: ${e._tag === "DiscordError" ? describeDiscordError(e) : e.message}`,
            ),
          ),
        ),
      ),
      Layer.provide(OpsAlerts.Default),
    );
  }),
);
