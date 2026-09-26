// Multiballs: `pnpm start` from discord-bot/ in the main checkout (where .env lives).
// Elsewhere, point MULTIBALLS_ENV at that .env file.
import { PlatformConfigProvider } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Config, Layer } from "effect"
import { Discord } from "./discord/client.js"
import { InteractionsLive } from "./discord/interactions.js"
import { DiscordChannelLive } from "./discord/channel.js"
import { Marbles } from "./discord/marbles.js"
import { ChannelSurfaceLive } from "./discord/surface.js"
import { Engine } from "./engine.js"
import { Renderer } from "./render/renderer.js"
import { SqliteStoreLive } from "./sqliteStore.js"
import { SteamLive } from "./steam/steamLive.js"

/** The real environment first, then .env for anything it leaves out. */
const ConfigLive = PlatformConfigProvider.layerDotEnvAdd(process.env["MULTIBALLS_ENV"] ?? ".env").pipe(
  Layer.provide(NodeContext.layer)
)

const SqlLive = SqliteClient.layerConfig({
  filename: Config.string("DB_PATH").pipe(Config.withDefault("multiballs.sqlite"))
})

// Discord first, so the Footer is in place before the engine's restart recovery redraws Cards.
const SurfaceLive = ChannelSurfaceLive.pipe(Layer.provide(DiscordChannelLive), Layer.provide(Marbles.Default))

const PortsLive = Layer.mergeAll(SteamLive, SurfaceLive, SqliteStoreLive).pipe(
  Layer.provideMerge(Renderer.Default),
  Layer.provideMerge(Discord.Default),
  Layer.provideMerge(SqlLive)
)

const MainLive = InteractionsLive.pipe(
  Layer.provide(Engine.Default),
  Layer.provide(PortsLive),
  Layer.provide(ConfigLive)
)

Layer.launch(MainLive).pipe(NodeRuntime.runMain)
