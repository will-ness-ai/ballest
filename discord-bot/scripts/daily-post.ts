// `pnpm daily-post <date>`: post that date's Daily Post now as the dev app, into the sandbox
// channel (`pnpm axi sandbox create`) or the channel given with --channel. It asks the Daily API
// (BALLEST_DAILY_URL, BALLEST_API_KEY) for the Daily, reads its board with the bot account's Steam
// session, and posts the live card with its thread, exactly as the schedule would. It records
// only in memory, so the schedule never sees it. With --close it then keeps the card current as the
// schedule does until the Daily's end, so a past date's card is closed at once by the schedule's
// own final edit (the GIF and ops are off: ops warnings go to the log only). With DATABASE_URL
// set to a local Postgres (it refuses any other) that holds the date's Daily, closed by now, it
// posts it instead as the backfill would: the closed card and its thread, from that database.
import { PlatformConfigProvider } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, Layer, Option, Redacted } from "effect";
import { DailyApiLive, DailyChannelLive, DailySteamLive } from "../src/dailyPost/live.js";
import {
  DailyApi,
  DailyPostLogLive,
  keepCurrent,
  postDaily,
  postPast,
} from "../src/dailyPost/schedule.js";
import { DailyHistory, dailyHistoryAt } from "../src/dailyPost/history.js";
import { DailySpinsOff } from "../src/dailyPost/spin.js";
import { OpsAlerts, opsAlertsOf } from "../src/ops.js";
import { MapPreviews, PreviewSourceLive } from "../src/previews.js";
import { Renderer } from "../src/render/renderer.js";
import { devEnvFile } from "./devEnv.js";
import { readSandbox } from "./sandbox/config.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--channel");
const channel = flag >= 0 ? args[flag + 1] : readSandbox()?.channelId;
const close = args.includes("--close");
const date = args.find((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && args[i - 1] !== "--channel");
if (date === undefined) {
  console.log("error: no date. Usage: pnpm daily-post 2026-10-18 [--close] [--channel <id>]");
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
/** A local leaderboard database to post a past Daily from, closed, as the backfill does. */
const database = process.env.DATABASE_URL;
if (
  database !== undefined &&
  !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(database)
) {
  console.log(
    "error: DATABASE_URL must be a local Postgres, e.g. postgres://postgres:postgres@localhost:5432/ballest_dev",
  );
  process.exit(1);
}

/** A past Daily from a local leaderboard database, posted closed as the backfill would. */
const backfilled = Effect.fn("DailyPostScript.backfilled")(
  function* (url: string) {
    const found = yield* (yield* DailyHistory).find(date);
    if (Option.isNone(found)) return false;
    if (found.value.daily.endsAt > Date.now()) return false;
    const { post, threadFailed } = yield* postPast(found.value);
    yield* Effect.logInfo(
      `daily post: backfilled ${date} as ${post.messageId} in ${channel} from ${new URL(url).pathname.slice(1)} (${found.value.leads.length} changes of lead), thread ${post.threadId ?? "failed"}${Option.match(threadFailed, { onNone: () => "", onSome: (r) => ` (${r})` })}`,
    );
    return true;
  },
  (effect, url) => effect.pipe(Effect.provide(dailyHistoryAt(Redacted.make(url)))),
);

const program = Effect.gen(function* () {
  if (database !== undefined && (yield* backfilled(database))) return;
  const found = yield* (yield* DailyApi).find(date);
  if (Option.isNone(found)) return yield* Effect.logInfo(`daily post: no Daily for ${date} yet`);
  const { post, threadFailed } = yield* postDaily(found.value);
  yield* Effect.logInfo(
    `daily post: posted ${date} as ${post.messageId} in ${channel}, thread ${post.threadId ?? `failed (${Option.getOrElse(threadFailed, () => "")})`}`,
  );
  if (close) yield* keepCurrent(post);
});

program.pipe(
  Effect.provide(
    Layer.mergeAll(
      DailyApiLive,
      DailySteamLive,
      DailyChannelLive,
      MapPreviews.Default.pipe(Layer.provide(PreviewSourceLive)),
      Renderer.Default,
      DailyPostLogLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
      DailySpinsOff,
      Layer.succeed(
        OpsAlerts,
        OpsAlerts.make(
          opsAlertsOf({ configured: false, post: (content) => Effect.logWarning(content) }),
        ),
      ),
    ),
  ),
  Effect.provide(
    PlatformConfigProvider.layerDotEnvAdd(devEnvFile()).pipe(Layer.provide(NodeContext.layer)),
  ),
  // steam-user keeps the process alive after its log off, so leave once the session has closed.
  Effect.ensuring(Effect.sync(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100))),
  NodeRuntime.runMain,
);
