// `pnpm daily-post <date>`: post that date's Daily Post now as the dev app, into the sandbox
// channel (`pnpm axi sandbox create`) or the channel given with --channel. It asks the Daily API
// (BALLEST_DAILY_URL, BALLEST_API_KEY) for the Daily, reads its board with the bot account's Steam
// session, and posts the live card with its thread, exactly as the schedule would. It records
// nothing, so the schedule never sees it, and it never edits the card afterwards.
import { PlatformConfigProvider } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { DailyApiLive, DailyChannelLive, DailySteamLive } from "../src/dailyPost/live.js";
import { DailyApi, postDaily } from "../src/dailyPost/schedule.js";
import { MapPreviews, PreviewSourceLive } from "../src/previews.js";
import { devEnvFile } from "./devEnv.js";
import { readSandbox } from "./sandbox/config.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--channel");
const channel = flag >= 0 ? args[flag + 1] : readSandbox()?.channelId;
const date = args.find((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && args[i - 1] !== "--channel");
if (date === undefined) {
  console.log("error: no date. Usage: pnpm daily-post 2026-10-18 [--channel <id>]");
  process.exit(1);
}
if (channel === undefined) {
  console.log(
    "error: no channel. Make the sandbox one with `pnpm axi sandbox create`, or pass --channel <id>.",
  );
  process.exit(1);
}
/** The game Discord's daily challenge channel: only the production bot posts there. */
const PRODUCTION_CHANNEL = "1541802743205990460";
if (channel === PRODUCTION_CHANNEL) {
  console.log("error: that is the production daily challenge channel; post into the sandbox.");
  process.exit(1);
}
process.env.DAILY_CHANNEL_ID = channel;

const program = Effect.gen(function* () {
  const found = yield* (yield* DailyApi).find(date);
  if (Option.isNone(found)) return yield* Effect.logInfo(`daily post: no Daily for ${date} yet`);
  const { post, threadFailed } = yield* postDaily(found.value);
  yield* Effect.logInfo(
    `daily post: posted ${date} as ${post.messageId} in ${channel}, thread ${post.threadId ?? `failed (${Option.getOrElse(threadFailed, () => "")})`}`,
  );
});

program.pipe(
  Effect.provide(
    Layer.mergeAll(
      DailyApiLive,
      DailySteamLive,
      DailyChannelLive,
      MapPreviews.Default.pipe(Layer.provide(PreviewSourceLive)),
    ),
  ),
  Effect.provide(
    PlatformConfigProvider.layerDotEnvAdd(devEnvFile()).pipe(Layer.provide(NodeContext.layer)),
  ),
  // steam-user keeps the process alive after its log off, so leave once the session has closed.
  Effect.ensuring(Effect.sync(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100))),
  NodeRuntime.runMain,
);
