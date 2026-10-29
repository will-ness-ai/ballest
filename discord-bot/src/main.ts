// Multiballs. Locally, `pnpm dev` (scripts/dev.ts) runs it as the dev app; production runs on
// Fly.io (fly.toml, Dockerfile) with its config in `fly secrets`. MULTIBALLS_ENV names the .env
// file read after the real environment.
import { NodeRuntime } from "@effect/platform-node";
import { app } from "./app.js";
import { launchUntilShutdown } from "./restart.js";
import { SteamLive } from "./steam/steamLive.js";

launchUntilShutdown(app(SteamLive)).pipe(NodeRuntime.runMain);
