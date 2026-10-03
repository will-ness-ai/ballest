// Multiballs. Locally, `pnpm dev` (scripts/dev.ts) runs it as the dev app; production runs on
// Fly.io (fly.toml, Dockerfile) with its config in `fly secrets`. MULTIBALLS_ENV names the .env
// file read after the real environment.
import { appendFileSync } from "node:fs";
import { PlatformConfigProvider } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Config, Effect, Layer, Logger, Option } from "effect";
import { DiscordAuthLive, DiscordMembers, MembersUnavailable } from "./activity/auth.js";
import { activityServer } from "./activity/server.js";
import { describeDiscordError, Discord } from "./discord/client.js";
import { InteractionsLive } from "./discord/interactions.js";
import { DiscordChannelLive } from "./discord/channel.js";
import { Marbles } from "./discord/marbles.js";
import { PingRoleLive } from "./discord/pingRole.js";
import { ChannelSurfaceLive } from "./discord/surface.js";
import { Engine } from "./engine.js";
import { InstanceLockLive } from "./instanceLock.js";
import { OpsLive } from "./ops.js";
import { Pings } from "./pings.js";
import { MapPreviews, PreviewSourceLive } from "./previews.js";
import { Renderer } from "./render/renderer.js";
import { SqliteStoreLive } from "./sqliteStore.js";
import { SteamLive } from "./steam/steamLive.js";

/** The real environment first, then .env for anything it leaves out. */
const ConfigLive = PlatformConfigProvider.layerDotEnvAdd(process.env.MULTIBALLS_ENV ?? ".env").pipe(
  Layer.provide(NodeContext.layer),
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
    const guildId = yield* Config.string("DISCORD_GUILD_ID");
    const channelId = yield* Config.string("DISCORD_CHANNEL_ID");
    const members = Layer.effect(
      DiscordMembers,
      Effect.gen(function* () {
        const discord = yield* Discord;
        return DiscordMembers.of({
          nameOf: (discordId) =>
            discord
              .member(discordId)
              .pipe(
                Effect.mapError((e) => new MembersUnavailable({ reason: describeDiscordError(e) })),
              ),
        });
      }),
    );
    return activityServer({ clientId, guildId, channelId, devUsers: [] }).pipe(
      Layer.provide(DiscordAuthLive),
      Layer.provide(members),
    );
  }),
).pipe(Layer.catchAll((e) => Layer.effectDiscard(Effect.logError("activity: not serving", e))));

const SqlLive = SqliteClient.layerConfig({
  filename: Config.string("DB_PATH").pipe(Config.withDefault("multiballs.sqlite")),
});

// Discord first, so the Footer is in place before the engine's restart recovery redraws Cards.
const SurfaceLive = ChannelSurfaceLive.pipe(
  Layer.provide(DiscordChannelLive),
  Layer.provide(Marbles.Default),
);

// One preview cache for both surfaces: the Card and the Activity show the same Workshop art.
const PreviewsLive = MapPreviews.Default.pipe(Layer.provide(PreviewSourceLive));

const PortsLive = Layer.mergeAll(SteamLive, SurfaceLive, SqliteStoreLive, PingRoleLive).pipe(
  Layer.provideMerge(PreviewsLive),
  Layer.provideMerge(Renderer.Default),
  Layer.provideMerge(Discord.Default),
  Layer.provideMerge(SqlLive),
);

const MainLive = Layer.mergeAll(InteractionsLive, OpsLive, ActivityLive).pipe(
  Layer.provide(Engine.Default),
  Layer.provide(Pings.Default),
  Layer.provide(PortsLive),
  Layer.provide(InstanceLockLive),
  Layer.provide(FileLogLive),
  Layer.provide(ConfigLive),
);

Layer.launch(MainLive).pipe(NodeRuntime.runMain);
