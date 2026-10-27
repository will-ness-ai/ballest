// The Weekly Cup on discord.js (spec #353): switched on per server by WEEKLY_CUP_GUILD_IDS
// (fly.toml: Ballest Racing), a comma-separated list of server ids. For each, at startup and in
// the background, the bot keeps #weekly-cup (channel.ts), stored by id in SQLite, takes the
// presses there as the home Venue's (as #my-stats's, `Discord.answerIn`), and runs that server's
// schedule (schedule.ts). A server it can't set up is told to ops, and the bot runs on without
// its Cup until the next start. Off in the sandbox, whose fresh database each start would run a
// second Cup beside `pnpm dev`'s.
import { SqlClient } from "@effect/sql";
import { ChannelType, type Client, type TextChannel } from "discord.js";
import { Cause, Config, Effect, Layer, Option, Ref, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { describeDiscordError, Discord, type DiscordError, tryDiscord } from "../discord/client.js";
import { cupNoticeMessage, shortlistMessage, weeklyCupMessage } from "../discord/messages.js";
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
  CupPostFailed,
  type CupPresses,
  makeWeeklyCup,
  pressesOf,
  WeeklyCups,
} from "./schedule.js";

/** The CupChannel port on one text channel. */
const cupChannelOn = (client: Client<true>, channelId: string) => {
  const failed = Effect.mapError(
    (e: DiscordError) => new CupPostFailed({ reason: describeDiscordError(e) }),
  );
  const channel = tryDiscord("fetch #weekly-cup", () => client.channels.fetch(channelId)).pipe(
    failed,
    Effect.flatMap((c) =>
      c?.type === ChannelType.GuildText
        ? Effect.succeed<TextChannel>(c)
        : Effect.fail(new CupPostFailed({ reason: `${channelId} is not a text channel` })),
    ),
  );
  return CupChannel.of({
    post: (view) =>
      channel.pipe(
        Effect.flatMap((c) =>
          tryDiscord("post the Weekly Cup", () => c.send(weeklyCupMessage(view))).pipe(failed),
        ),
        Effect.map((m) => m.id),
      ),
    edit: (messageId, view) =>
      channel.pipe(
        Effect.flatMap((c) =>
          tryDiscord("update the Weekly Cup", async () => {
            const m = await c.messages.fetch(messageId);
            await m.edit(weeklyCupMessage(view));
          }).pipe(failed),
        ),
      ),
    say: (notice) =>
      channel.pipe(
        Effect.flatMap((c) =>
          tryDiscord("post in #weekly-cup", () => c.send(cupNoticeMessage(notice))).pipe(failed),
        ),
        Effect.asVoid,
      ),
    postShortlist: (view) =>
      channel.pipe(
        Effect.flatMap((c) =>
          tryDiscord("post the Shortlist", () => c.send(shortlistMessage(view))).pipe(failed),
        ),
        Effect.map((m) => m.id),
      ),
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

  const storedChannel = (guildId: string) =>
    sql`SELECT channel_id FROM weekly_cup_channels WHERE guild_id = ${guildId}`.pipe(
      Effect.flatMap(Schema.decodeUnknown(Schema.Array(ChannelRow))),
      Effect.map((rows) => Option.fromNullable(rows[0]?.channel_id)),
      Effect.orDie,
    );

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
    const ports = <A, E>(
      effect: Effect.Effect<A, E, CupChannel | CupLog | OpsAlerts | CupLinks | Steam | MapPreviews>,
    ) =>
      effect.pipe(
        Effect.provideService(CupChannel, cupChannelOn(client, channelId)),
        Effect.provideService(CupLog, log),
        Effect.provideService(OpsAlerts, alerts),
        Effect.provideService(CupLinks, links),
        Effect.provideService(Steam, steam),
        Effect.provideService(MapPreviews, previews),
      );
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
