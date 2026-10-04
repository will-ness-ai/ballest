// `pnpm report`: build the Daily Report now and post it as the dev app, into the sandbox channel
// (`pnpm axi sandbox create`) or the channel given with --channel. It reads the database at
// DATABASE_URL, which must be a local Postgres (AGENTS.md has how to fill one): never production's.
// It skips the schedule's checks (already posted today, stale data) and records nothing.
import { PlatformConfigProvider } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer } from "effect";
import { ReportChannelLive } from "../src/report/channel.js";
import { postReport } from "../src/report/daily.js";
import { GhostDatesLive } from "../src/report/records.js";
import { buildReport } from "../src/report/report.js";
import { ReportSource, ReportSourceLive } from "../src/report/source.js";
import { Renderer } from "../src/render/renderer.js";
import { devEnvFile } from "./devEnv.js";
import { readSandbox } from "./sandbox/config.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--channel");
const channel = flag >= 0 ? args[flag + 1] : readSandbox()?.channelId;
if (channel === undefined) {
  console.log(
    "error: no channel. Make the sandbox one with `pnpm axi sandbox create`, or pass --channel <id>.",
  );
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.log(
    "error: DATABASE_URL must be a local Postgres, e.g. postgres://postgres:postgres@localhost:5432/ballest_dev",
  );
  process.exit(1);
}
process.env.STATS_CHANNEL_ID = channel;

const program = Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;
  const data = yield* (yield* ReportSource).read(at);
  const report = buildReport(data, at);
  yield* Effect.logInfo(
    `report: ${report.maps} Maps, ${report.players} players, ${report.changes.length} changes; last Refresh ${report.refreshedAt === null ? "never" : new Date(report.refreshedAt).toISOString()}`,
  );
  const { messageId, thread } = yield* postReport(report);
  yield* thread;
  yield* Effect.logInfo(`report: posted ${messageId} in ${channel}`);
});

program.pipe(
  Effect.provide(
    Layer.mergeAll(ReportSourceLive, GhostDatesLive, ReportChannelLive, Renderer.Default),
  ),
  Effect.provide(
    PlatformConfigProvider.layerDotEnvAdd(devEnvFile()).pipe(Layer.provide(NodeContext.layer)),
  ),
  NodeRuntime.runMain,
);
