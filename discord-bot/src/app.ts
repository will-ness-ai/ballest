// The bot, as one Layer over its Steam adapter: src/main.ts launches it on real Steam, and the
// sandbox (scripts/sandbox.ts) on the tests' fake Steam with its driver alongside.
import { appendFileSync } from "node:fs";
import { PlatformConfigProvider } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Config, Effect, Layer, Logger, Option } from "effect";
import { DiscordAuthLive, DiscordMembers, MembersUnavailable } from "./activity/auth.js";
import { ChosenSkinsLive } from "./chosenSkins.js";
import { activityServer } from "./activity/server.js";
import { describeDiscordError, Discord } from "./discord/client.js";
import { DriverInteractions, InteractionsLive } from "./discord/interactions.js";
import { VenueChannelsLive } from "./discord/channel.js";
import { Marbles } from "./discord/marbles.js";
import { NewTracksLive } from "./newTracks.js";
import { PingRoleLive } from "./discord/pingRole.js";
import { DailyReportLive } from "./report/daily.js";
import { DailyPostLive } from "./dailyPost/live.js";
import { ChannelSurfaceLive } from "./discord/surface.js";
import { Engine } from "./engine.js";
import type { Steam, Store } from "./ports.js";
import { InstanceLockLive } from "./instanceLock.js";
import { OpsAlerts, OpsLive } from "./ops.js";
import { Pings } from "./pings.js";
import { MapPreviews, PreviewSourceLive } from "./previews.js";
import { Renderer } from "./render/renderer.js";
import { SkinPictures } from "./render/skins.js";
import { SqliteStoreLive } from "./sqliteStore.js";

/**
 * The real environment first, then .env for anything it leaves out. Read when the bot starts,
 * not when this module loads: the sandbox sets MULTIBALLS_ENV after importing it.
 */
const ConfigLive = Layer.suspend(() =>
  PlatformConfigProvider.layerDotEnvAdd(process.env.MULTIBALLS_ENV ?? ".env").pipe(
    Layer.provide(NodeContext.layer),
  ),
);

/** With LOG_FILE set, every log line is also appended there as logfmt, for grepping. */
const FileLogLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const file = yield* Config.option(Config.string("LOG_FILE"));
    if (Option.isNone(file)) return Layer.empty;
    return Logger.add(
      Logger.map(Logger.logfmtLogger, (line) =>
        appendFileSync(
          file.value,
          `${line}
`,
        ),
      ),
    );
  }),
);

/**
 * The Discord Activity (the same Matches in a page inside Discord), on PORT, once the app's
 * OAuth client secret is configured. Without it the bot runs as before, with no web server. If
 * the Activity can't start (a setting missing, the port taken), it says so and the bot runs on.
 */
const ActivityLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const secret = yield* Config.option(Config.redacted("DISCORD_CLIENT_SECRET"));
    if (Option.isNone(secret)) return Layer.empty;
    const clientId = yield* Config.string("DISCORD_APPLICATION_ID");
    // Every running Venue's server: a Venue left out at startup is turned away like any server.
    const discord = yield* Discord;
    const venues = discord.venues.map((v) => ({
      name: v.name,
      guildId: v.channel.guildId,
      channelId: v.channel.id,
      pingRoleName: v.pingRoleName,
    }));
    const members = Layer.succeed(
      DiscordMembers,
      DiscordMembers.of({
        nameOf: (venue, discordId) => {
          const running = discord.venueNamed(venue);
          return running === undefined
            ? Effect.succeed(Option.none())
            : running
                .member(discordId)
                .pipe(
                  Effect.mapError(
                    (e) => new MembersUnavailable({ reason: describeDiscordError(e) }),
                  ),
                );
        },
      }),
    );
    return activityServer({ clientId, venues, devUsers: [] }).pipe(
      Layer.provide(DiscordAuthLive),
      Layer.provide(members),
    );
  }),
).pipe(Layer.catchAll((e) => Layer.effectDiscard(Effect.logError("activity: not serving", e))));

const SqlLive = SqliteClient.layerConfig({
  filename: Config.string("DB_PATH").pipe(Config.withDefault("multiballs.sqlite")),
});

// Discord first, so each Venue's Footer is in place before the engine's restart recovery redraws
// Cards.
const SurfaceLive = ChannelSurfaceLive.pipe(
  Layer.provide(VenueChannelsLive),
  Layer.provide(Marbles.Default),
);

// One preview cache for both surfaces: the Card and the Activity show the same Workshop art.
const PreviewsLive = MapPreviews.Default.pipe(Layer.provide(PreviewSourceLive));

const portsLive = <E, R>(steam: Layer.Layer<Steam, E, R>) =>
  Layer.mergeAll(steam, SurfaceLive, SqliteStoreLive, PingRoleLive).pipe(
    Layer.provideMerge(PreviewsLive),
    Layer.provideMerge(Renderer.Default),
    // The same pictures the Renderer draws, for the Activity to serve.
    Layer.provideMerge(SkinPictures.Default),
    Layer.provideMerge(ChosenSkinsLive),
    // An extra Venue that can't start is left out with a line to ops.
    Layer.provideMerge(Discord.Default.pipe(Layer.provide(OpsAlerts.Default))),
    Layer.provideMerge(SqlLive),
  );

/** What the sandbox (scripts/sandbox.ts) adds: its driver's clicks, and its own server beside the bot. */
export interface SandboxParts<E> {
  readonly feed: Layer.Layer<DriverInteractions, never, Discord>;
  readonly server: Layer.Layer<never, E, Store>;
}

/**
 * The whole bot over the given Steam: SteamLive in production and `pnpm dev`; the tests' fake
 * Steam and the driver in the sandbox.
 */
export const app = <E, R, E2 = never>(
  steam: Layer.Layer<Steam, E, R>,
  sandbox?: SandboxParts<E2>,
) =>
  Layer.mergeAll(
    sandbox === undefined ? InteractionsLive : InteractionsLive.pipe(Layer.provide(sandbox.feed)),
    OpsLive,
    DailyReportLive,
    DailyPostLive,
    NewTracksLive,
    ActivityLive,
    sandbox?.server ?? Layer.empty,
  ).pipe(
    Layer.provide(Engine.Default),
    Layer.provide(Pings.Default),
    Layer.provideMerge(portsLive(steam)),
    Layer.provide(InstanceLockLive),
    Layer.provide(FileLogLive),
    Layer.provide(ConfigLive),
  );
