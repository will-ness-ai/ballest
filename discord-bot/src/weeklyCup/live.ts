// The Weekly Cup on discord.js (spec #353): switched on per server by WEEKLY_CUP_GUILD_IDS
// (fly.toml: Ballest Racing), a comma-separated list of server ids. For each, at startup and in
// the background, the bot keeps #weekly-cup (channel.ts), stored by id in SQLite, takes the
// presses there as the home Venue's (as #my-stats's, `Discord.answerIn`), and runs that server's
// schedule (schedule.ts). A server it can't set up is told to ops, and the bot runs on without
// its Cup until the next start. Off in the sandbox, whose fresh database each start would run a
// second Cup beside `pnpm dev`'s.
import { SqlClient } from "@effect/sql";
import { ChannelType, type Client, type MessageCreateOptions, type TextChannel } from "discord.js";
import { Cause, Config, Effect, Layer, Option, Ref, Schema } from "effect";
import { MigratorLive } from "../db.js";
import {
  describeDiscordError,
  Discord,
  type DiscordError,
  hasCode,
  tryDiscord,
  UNKNOWN_MESSAGE,
} from "../discord/client.js";
import {
  cupNoticeMessage,
  cupStandingsMessages,
  type Payload,
  sentOnce,
  shortlistMessage,
  weeklyCupMessage,
} from "../discord/messages.js";
import { setupGuildOn } from "../discord/setupGuild.js";
import { OpsAlerts } from "../ops.js";
import { Steam, Store } from "../ports.js";
import { MapPreviews } from "../previews.js";
import { keepCupChannel } from "./channel.js";
import {
  CupChannel,
  CupLinks,
  CupLog,
  CupLogLive,
  type CupNotice,
  CupPostFailed,
  type CupPostView,
  type ShortlistView,
  type StandingsView,
  type CupPresses,
  makeWeeklyCup,
  pressesOf,
  WeeklyCups,
} from "./schedule.js";

/**
 * The CupChannel port on one text channel. Each one-time post goes with its nonce (`sentOnce`);
 * an edit of a message someone deleted fails as `gone` (Unknown Message), for the schedule to
 * post it afresh.
 */
const cupChannelOn = (client: Client<true>, channelId: string) => {
  const failed = Effect.mapError(
    (e: DiscordError) =>
      new CupPostFailed({ reason: describeDiscordError(e), gone: hasCode(e, UNKNOWN_MESSAGE) }),
  );
  const channel = tryDiscord("fetch #weekly-cup", () => client.channels.fetch(channelId)).pipe(
    failed,
    Effect.flatMap((c) =>
      c?.type === ChannelType.GuildText
        ? Effect.succeed<TextChannel>(c)
        : Effect.fail(new CupPostFailed({ reason: `${channelId} is not a text channel` })),
    ),
  );
  const send = Effect.fn("cupChannel.send")(function* (op: string, payload: MessageCreateOptions) {
    const c = yield* channel;
    return (yield* tryDiscord(op, () => c.send(payload)).pipe(failed)).id;
  });
  const editOne = Effect.fn("cupChannel.edit")(function* (
    op: string,
    messageId: string,
    payload: Payload,
  ) {
    const c = yield* channel;
    yield* tryDiscord(op, async () => {
      const m = await c.messages.fetch(messageId);
      await m.edit(payload);
    }).pipe(failed);
  });
  const dropOne = Effect.fn("cupChannel.drop")(function* (messageId: string) {
    const c = yield* channel;
    yield* tryDiscord("drop a Weekly Cup standings message", async () => {
      const m = await c.messages.fetch(messageId);
      await m.delete();
    }).pipe(
      failed,
      Effect.catchIf(
        (e) => e.gone === true,
        () => Effect.void,
      ),
    );
  });
  return CupChannel.of({
    post: Effect.fn("cupChannel.post")(function* (view: CupPostView, replaces: string | null) {
      const message = weeklyCupMessage(view);
      return yield* send(
        "post the Weekly Cup",
        replaces === null ? sentOnce(message, view.week.week, "post") : message,
      );
    }),
    edit: Effect.fn("cupChannel.editPost")(function* (messageId: string, view: CupPostView) {
      yield* editOne("update the Weekly Cup", messageId, weeklyCupMessage(view));
    }),
    say: Effect.fn("cupChannel.say")(function* (notice: CupNotice) {
      const message = cupNoticeMessage(notice);
      yield* send(
        "post in #weekly-cup",
        notice._tag === "CupMaps" ? sentOnce(message, notice.week.week, "cupmaps") : message,
      );
    }),
    postShortlist: Effect.fn("cupChannel.postShortlist")(function* (view: ShortlistView) {
      return yield* send(
        "post the Shortlist",
        sentOnce(shortlistMessage(view), view.week.week, "shortlist"),
      );
    }),
    // The pictures go up again in place of the old ones (`attachments: []`).
    editShortlist: Effect.fn("cupChannel.editShortlist")(function* (
      messageId: string,
      view: ShortlistView,
    ) {
      yield* editOne("close the Shortlist's vote", messageId, {
        ...shortlistMessage(view),
        attachments: [],
      });
    }),
    postStandings: Effect.fn("cupChannel.postStandings")(function* (view: StandingsView) {
      return yield* Effect.forEach(cupStandingsMessages(view), (part) =>
        send("post the Weekly Cup's standings", part),
      );
    }),
    // Each part over the message it had; one more part is posted, one fewer drops a message.
    editStandings: Effect.fn("cupChannel.editStandings")(function* (
      messageIds: ReadonlyArray<string>,
      view: StandingsView,
    ) {
      const ids: Array<string> = [];
      for (const [i, part] of cupStandingsMessages(view).entries()) {
        const id = messageIds[i];
        if (id === undefined) ids.push(yield* send("post the Weekly Cup's standings", part));
        else {
          yield* editOne("update the Weekly Cup's standings", id, part);
          ids.push(id);
        }
      }
      for (const id of messageIds.slice(ids.length)) yield* dropOne(id);
      return ids;
    }),
    postResults: Effect.fn("cupChannel.postResults")(function* (view: StandingsView) {
      return yield* Effect.forEach(cupStandingsMessages(view), (part, i) =>
        send("post the Weekly Cup's results", sentOnce(part, view.week.week, `results-${i + 1}`)),
      );
    }),
  });
};

const ChannelRow = Schema.Struct({ channel_id: Schema.String });

const make = Effect.gen(function* () {
  const running = yield* Ref.make(new Map<string, CupPresses>());
  const registry = WeeklyCups.of({
    in: (guildId) => Effect.map(Ref.get(running), (m) => Option.fromNullable(m.get(guildId))),
  });
  const sandbox = yield* Config.boolean("MULTIBALLS_SANDBOX").pipe(Config.withDefault(false));
  const ids = (yield* Config.array(Config.string(), "WEEKLY_CUP_GUILD_IDS").pipe(
    Config.withDefault([]),
  ))
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (sandbox || ids.length === 0) {
    yield* Effect.logInfo(
      sandbox ? "weekly cup: off in the sandbox" : "weekly cup: off (WEEKLY_CUP_GUILD_IDS not set)",
    );
    return registry;
  }

  const discord = yield* Discord;
  const client = discord.home.channel.client;
  const sql = yield* SqlClient.SqlClient;
  const log = yield* CupLog;
  const alerts = yield* OpsAlerts;
  const steam = yield* Steam;
  const previews = yield* MapPreviews;
  const store = yield* Store;
  const links = CupLinks.of({
    steamIdOf: (discordId) =>
      Effect.map(
        store.getLink(discordId),
        Option.map((link) => link.steamId),
      ),
  });

  const storedChannel = Effect.fn("weeklyCup.storedChannel")(function* (guildId: string) {
    const rows =
      yield* sql`SELECT channel_id FROM weekly_cup_channels WHERE guild_id = ${guildId}`.pipe(
        Effect.flatMap(Schema.decodeUnknown(Schema.Array(ChannelRow))),
        Effect.orDie,
      );
    return Option.fromNullable(rows[0]?.channel_id);
  });

  const start = Effect.fn("weeklyCup.start")(function* (guildId: string) {
    const guild = yield* tryDiscord("fetch the server", () => client.guilds.fetch(guildId));
    const stored = yield* storedChannel(guildId);
    const channelId = yield* keepCupChannel(setupGuildOn(client, guild), stored);
    if (!Option.contains(stored, channelId)) {
      yield* sql`INSERT OR REPLACE INTO weekly_cup_channels (guild_id, channel_id) VALUES (${guildId}, ${channelId})`.pipe(
        Effect.orDie,
      );
      yield* Effect.logInfo(`weekly cup: #weekly-cup in ${guild.name} is ${channelId}`);
    }
    yield* discord.answerIn(channelId);
    const channel = cupChannelOn(client, channelId);
    const ports = Effect.fn("weeklyCup.ports")(function* <A, E>(
      effect: Effect.Effect<A, E, CupChannel | CupLog | OpsAlerts | CupLinks | Steam | MapPreviews>,
    ) {
      return yield* effect.pipe(
        Effect.provideService(CupChannel, channel),
        Effect.provideService(CupLog, log),
        Effect.provideService(OpsAlerts, alerts),
        Effect.provideService(CupLinks, links),
        Effect.provideService(Steam, steam),
        Effect.provideService(MapPreviews, previews),
      );
    });

    const cup = yield* ports(makeWeeklyCup(guildId));
    const presses = yield* ports(pressesOf(cup));
    yield* Ref.update(running, (m) => new Map(m).set(guildId, presses));
    yield* Effect.logInfo(`weekly cup: running in ${guild.name}`);
    return yield* ports(cup.run);
  });

  for (const guildId of ids)
    yield* start(guildId).pipe(
      Effect.catchAll((e) =>
        alerts.post(
          `Multiballs couldn't set up the Weekly Cup in ${guildId}: ${e._tag === "DiscordError" ? describeDiscordError(e) : e.reason}`,
        ),
      ),
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.void
          : Effect.logError("weekly cup: failed", cause).pipe(
              Effect.zipRight(
                alerts.post(
                  `Multiballs couldn't set up the Weekly Cup in ${guildId}: a bug, see the log`,
                ),
              ),
            ),
      ),
      Effect.forkScoped,
    );
  return registry;
});

/** Every switched-on server's Weekly Cup, set up and run in the background. */
export const WeeklyCupsLive = Layer.scoped(WeeklyCups, make).pipe(
  Layer.provide(CupLogLive),
  Layer.provide(MigratorLive),
  Layer.provide(OpsAlerts.Default),
);
