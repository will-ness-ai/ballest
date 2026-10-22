// The My Stats channel (spec #323): a read-only #my-stats the bot makes in its server, holding one
// panel message whose See my stats button answers each member privately. Kept in SQLite, so it
// is found by id at each start and an admin may rename or move it.
//
// The rules, at each start:
// - No channel stored, or the stored one is gone: make #my-stats, with @everyone denied Send
//   Messages, and keep its id at once, so a crash after it never makes a second one.
// - The panel is edited only when this build draws it differently (like the Footer, PR #151):
//   an edit shows as activity in the channel. A deleted panel is posted again.
// - Anything that fails (most likely the bot lacking Manage Channels) goes to the ops channel and
//   the bot runs on without it: the Matches never depend on it.
import { SqlClient, SqlSchema } from "@effect/sql";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { OpsAlerts } from "../ops.js";
import { Gone } from "./channel.js";
import { describeDiscordError, Discord, DiscordError, isUnknown, tryDiscord } from "./client.js";
import { fingerprint, myStatsPanelMessage } from "./messages.js";

export const MY_STATS_NAME = "my-stats";

export class MyStatsChannel extends Context.Tag("multiballs/MyStatsChannel")<
  MyStatsChannel,
  {
    /** Whether the channel is still a text channel in this server. */
    readonly exists: (channelId: string) => Effect.Effect<boolean, DiscordError>;
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
  const save = (row: typeof Row.Type) =>
    sql`INSERT INTO my_stats_channel ${sql.insert({ id: 1, ...row })}
        ON CONFLICT (id) DO UPDATE SET channel_id = excluded.channel_id, panel_id = excluded.panel_id,
        panel_fingerprint = excluded.panel_fingerprint`.pipe(Effect.asVoid, Effect.orDie);

  const keep = Effect.gen(function* () {
    const saved = Option.getOrNull(yield* load(undefined).pipe(Effect.orDie));
    let kept = saved !== null && (yield* channel.exists(saved.channel_id)) ? saved : null;
    if (kept === null) {
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

  const failed = (why: string) =>
    alerts.post(`Multiballs couldn't set up #${MY_STATS_NAME}: ${why}`);
  yield* keep.pipe(
    Effect.catchAll((e) => failed(e._tag === "Gone" ? `${e.id} is gone` : describeDiscordError(e))),
    Effect.catchAllDefect((defect) =>
      Effect.logError("my stats: setting up failed", defect).pipe(
        Effect.zipRight(failed("a bug, see the log")),
      ),
    ),
  );
});

/** Keeps the channel and its panel at startup. Needs the MyStatsChannel, OpsAlerts and a SqlClient. */
export const MyStatsPanelLive = Layer.effectDiscard(make).pipe(Layer.provide(MigratorLive));

/** The bot can't make a channel without this; it's checked first, to say so plainly. */
const MANAGE_CHANNELS = PermissionFlagsBits.ManageChannels;

/** The MyStatsChannel port on discord.js, in the Match channel's server. */
export const MyStatsChannelLive = Layer.effect(
  MyStatsChannel,
  Effect.gen(function* () {
    const discord = yield* Discord;
    const guild = discord.channel.guild;
    const client = discord.channel.client;

    /** The channel if it is still a text channel in this server, else null. */
    const find = (channelId: string) =>
      tryDiscord("fetch #my-stats", () => client.channels.fetch(channelId)).pipe(
        Effect.catchAll((e) => (isUnknown(e) ? Effect.succeed(null) : Effect.fail(e))),
        Effect.map((c) => (c?.type === ChannelType.GuildText && c.guildId === guild.id ? c : null)),
      );
    const fetchChannel = (channelId: string) =>
      find(channelId).pipe(
        Effect.flatMap((c) =>
          c === null ? Effect.fail(new Gone({ id: channelId })) : Effect.succeed(c),
        ),
      );
    const fetchPanel = (channelId: string, messageId: string) =>
      fetchChannel(channelId).pipe(
        Effect.flatMap((c) => tryDiscord("fetch the panel", () => c.messages.fetch(messageId))),
        Effect.catchAll((e) =>
          e._tag === "DiscordError" && isUnknown(e)
            ? Effect.fail(new Gone({ id: messageId }))
            : Effect.fail(e),
        ),
      );

    return MyStatsChannel.of({
      exists: (channelId) => find(channelId).pipe(Effect.map((c) => c !== null)),
      create: Effect.gen(function* () {
        const self = yield* tryDiscord("fetch the bot's member", () => guild.members.fetchMe());
        if (!self.permissions.has(MANAGE_CHANNELS))
          return yield* new DiscordError({
            op: `create #${MY_STATS_NAME}`,
            cause: "the bot needs the Manage Channels permission",
          });
        // Beside the Match channel; admins may move it anywhere.
        const made = yield* tryDiscord(`create #${MY_STATS_NAME}`, () =>
          guild.channels.create({
            name: MY_STATS_NAME,
            type: ChannelType.GuildText,
            parent: discord.channel.parentId,
            topic: "Press See my stats for your ranks and Medals. Only you see them.",
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] },
              {
                id: self.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              },
            ],
          }),
        );
        return made.id;
      }),
      hasMessage: (channelId, messageId) =>
        fetchPanel(channelId, messageId).pipe(
          Effect.as(true),
          Effect.catchTag("Gone", () => Effect.succeed(false)),
        ),
      postPanel: (channelId) =>
        fetchChannel(channelId).pipe(
          Effect.flatMap((c) => tryDiscord("post the panel", () => c.send(myStatsPanelMessage()))),
          Effect.map((m) => m.id),
        ),
      redrawPanel: (channelId, messageId) =>
        fetchPanel(channelId, messageId).pipe(
          Effect.flatMap((m) =>
            tryDiscord("redraw the panel", () => m.edit(myStatsPanelMessage())),
          ),
          Effect.asVoid,
        ),
      panelFingerprint: Effect.sync(() => fingerprint(myStatsPanelMessage())),
      answerIn: (channelId) => discord.answerIn(channelId),
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
      Layer.provide(OpsAlerts.Default),
    );
  }),
);
