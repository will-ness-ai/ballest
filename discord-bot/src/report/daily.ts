// The Daily Report (spec #126): built from the leaderboard database, posted to STATS_CHANNEL_ID at
// 16:00 UTC every day. Each posted day is recorded in the bot's SQLite, so a restart after the post
// never posts it again, and a bot that was down at 16:00 posts once when it starts.
import { SqlClient } from "@effect/sql";
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { OpsAlerts } from "../ops.js";
import { Renderer } from "../render/renderer.js";
import { ReportChannel, ReportChannelLive } from "./channel.js";
import {
  BOARD_TITLE,
  counts,
  dayTitle,
  headMessage,
  pack,
  threadName,
  threadSections,
} from "./messages.js";
import { GhostDatesLive, oldestMapRecords, oldestTrackRecords } from "./records.js";
import { buildReport, DAY_MS, type Report } from "./report.js";
import { ReportSource, ReportSourceLive } from "./source.js";

export const REPORT_HOUR_UTC = 16;
/** No Refresh in this long, and the numbers are too old to post as today's. */
export const STALE_AFTER = 2 * DAY_MS;

/** The UTC day a moment falls on, "2026-10-04": the key a posted report is recorded under. */
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Today's report time, or tomorrow's once today's has passed. */
export const nextReportAt = (now: number) => {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), REPORT_HOUR_UTC);
  return today > now ? today : today + DAY_MS;
};

// ---------------------------------------------------------------- which days were posted

export class ReportLog extends Context.Tag("multiballs/ReportLog")<
  ReportLog,
  {
    readonly posted: (day: string) => Effect.Effect<boolean>;
    readonly record: (day: string, messageId: string) => Effect.Effect<void>;
  }
>() {}

const Day = Schema.Struct({ day: Schema.String });

export const ReportLogLive = Layer.effect(
  ReportLog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return ReportLog.of({
      posted: (day) =>
        sql`SELECT day FROM daily_reports WHERE day = ${day}`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(Day))),
          Effect.map((rows) => rows.length > 0),
          Effect.orDie,
        ),
      record: (day, messageId) =>
        sql`INSERT OR REPLACE INTO daily_reports (day, message_id) VALUES (${day}, ${messageId})`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
    });
  }),
).pipe(Layer.provide(MigratorLive));

// ---------------------------------------------------------------- one report

const standingsImage = (r: Report) => ({
  title: dayTitle(r.at),
  subtitle: `Workshop standings · ${counts(r)}`,
  boards: r.boards.map((b) => ({
    title: BOARD_TITLE[b.stat],
    rows: b.rows.map((row) => ({ name: row.persona, n: row.n })),
  })),
});

/**
 * Build the report for `at` and post its channel message. Returns the message id and the
 * thread's post, which runs separately so the day is recorded before it: a thread that fails
 * must not bring the whole report back the next day.
 */
export const postReport = Effect.fn("postReport")(function* (report: Report) {
  const channel = yield* ReportChannel;
  const renderer = yield* Renderer;
  const tracks = yield* oldestTrackRecords(report.trackRecords);
  const maps = yield* oldestMapRecords(report.mapRecords);
  const image = yield* renderer.standings(standingsImage(report));
  const messageId = yield* channel.postHead(headMessage(report), image);
  const thread = channel.postThread(
    messageId,
    threadName(report),
    pack(threadSections(report, { tracks, maps })),
  );
  return { messageId, thread };
});

/** The day's report, unless it was already posted or the data is too old (then ops hears). */
export const runDay = Effect.fn("runDay")(function* (at: number) {
  const log = yield* ReportLog;
  const alerts = yield* OpsAlerts;
  const day = dayOf(at);
  if (yield* log.posted(day)) return;
  yield* Effect.gen(function* () {
    const { data, refreshedAt } = yield* (yield* ReportSource).read(at);
    if (refreshedAt === null || at - refreshedAt > STALE_AFTER) {
      const since = refreshedAt === null ? "ever" : `since ${new Date(refreshedAt).toISOString()}`;
      return yield* alerts.post(
        `Multiballs skipped the Daily Report for ${day}: no Refresh ${since}.`,
      );
    }
    const { messageId, thread } = yield* postReport(buildReport(data, at));
    yield* log.record(day, messageId);
    yield* Effect.logInfo(`report: posted ${day}`);
    yield* thread.pipe(
      Effect.catchAll((e) =>
        alerts.post(
          `Multiballs posted the Daily Report for ${day}, but not its thread: ${e.reason}`,
        ),
      ),
    );
  }).pipe(
    Effect.catchAll((e) =>
      alerts.post(
        `Multiballs couldn't post the Daily Report for ${day}: ${e._tag === "RenderError" ? String(e.cause) : e.reason}`,
      ),
    ),
  );
});

/** Catch up on today if it's past report time, then post at every report time after. */
export const dailyLoop = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  // Past today's report time exactly when the next one falls tomorrow.
  if (dayOf(nextReportAt(now)) !== dayOf(now)) yield* runDay(now);
  while (true) {
    const t = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(nextReportAt(t) - t);
    yield* runDay(yield* Clock.currentTimeMillis);
  }
});

/** The schedule, on when STATS_CHANNEL_ID and DATABASE_URL are both set; otherwise nothing. */
export const DailyReportLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const channel = yield* Config.option(Config.string("STATS_CHANNEL_ID"));
    const database = yield* Config.option(Config.redacted("DATABASE_URL"));
    if (Option.isNone(channel) || Option.isNone(database)) {
      yield* Effect.logInfo("report: off (STATS_CHANNEL_ID or DATABASE_URL not set)");
      return Layer.empty;
    }
    return Layer.scopedDiscard(Effect.forkScoped(dailyLoop)).pipe(
      Layer.provide(
        Layer.mergeAll(
          ReportSourceLive,
          GhostDatesLive,
          ReportChannelLive,
          ReportLogLive,
          OpsAlerts.Default,
        ),
      ),
    );
  }),
);
