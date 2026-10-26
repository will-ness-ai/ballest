// The Traffic Report (#search-analytics in the dev server): once a day at 13:00 UTC, the site's
// visits yesterday (Plausible) and the newest day of Google search (Search Console), posted
// through TRAFFIC_WEBHOOK_URL. Each half is on only when its keys are set, and a half that can't
// be read says so in the post rather than holding it back. Each posted day is recorded in SQLite,
// so a restart never posts it twice, and a bot that was down at 13:00 posts once when it starts.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { SqlClient } from "@effect/sql";
import { Cause, Config, Context, Data, Effect, Layer, Option, Redacted, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { dayOf, daysBefore, everyDayAt } from "../everyDay.js";
import { OpsAlerts } from "../ops.js";
import { PlausibleLive, VisitsSource } from "./plausible.js";
import { type Half, type TrafficUnavailable, trafficMessage } from "./report.js";
import { SearchConsoleLive, SearchSource } from "./searchConsole.js";

export const TRAFFIC_HOUR_UTC = 13;

export class TrafficPostFailed extends Data.TaggedError("TrafficPostFailed")<{
  readonly reason: string;
}> {}

/** Where the post goes. */
export class TrafficChannel extends Context.Tag("multiballs/TrafficChannel")<
  TrafficChannel,
  { readonly post: (content: string) => Effect.Effect<void, TrafficPostFailed> }
>() {}

/** The days already posted. */
export class TrafficLog extends Context.Tag("multiballs/TrafficLog")<
  TrafficLog,
  {
    readonly posted: (day: string) => Effect.Effect<boolean>;
    readonly record: (day: string) => Effect.Effect<void>;
  }
>() {}

const Day = Schema.Struct({ day: Schema.String });

export const TrafficChannelLive = Layer.effect(
  TrafficChannel,
  Effect.gen(function* () {
    const webhook = yield* Config.redacted("TRAFFIC_WEBHOOK_URL");
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    return TrafficChannel.of({
      post: (content) =>
        http
          .execute(
            HttpClientRequest.post(Redacted.value(webhook)).pipe(
              // no pings, whatever a search or a page name holds
              HttpClientRequest.bodyUnsafeJson({ content, allowed_mentions: { parse: [] } }),
            ),
          )
          .pipe(
            Effect.scoped,
            Effect.asVoid,
            Effect.mapError((e) => new TrafficPostFailed({ reason: e._tag })),
          ),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

export const TrafficLogLive = Layer.effect(
  TrafficLog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return TrafficLog.of({
      // The bot's own SQLite: a failure there is a defect, which the schedule reports to ops.
      posted: (day) =>
        sql`SELECT day FROM traffic_reports WHERE day = ${day}`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(Day))),
          Effect.map((rows) => rows.length > 0),
          Effect.orDie,
        ),
      record: (day) =>
        sql`INSERT OR REPLACE INTO traffic_reports (day) VALUES (${day})`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
    });
  }),
).pipe(Layer.provide(MigratorLive));

/** A half from its source, if it has one: Off without, Failed when the read fails. */
export const half = <A>(
  source: Option.Option<Effect.Effect<A, TrafficUnavailable>>,
): Effect.Effect<Half<A>> =>
  Option.match(source, {
    onNone: () => Effect.succeed({ _tag: "Off" } as const),
    onSome: (read) =>
      read.pipe(
        Effect.map((value) => ({ _tag: "Ok", value }) as const),
        Effect.catchTag("TrafficUnavailable", (e) =>
          Effect.succeed({ _tag: "Failed", reason: e.reason } as const),
        ),
      ),
  });

/** Whether an environment variable is set, which is what turns a half on. */
export const isSet = (name: string) =>
  Config.option(Config.string(name)).pipe(Effect.map(Option.isSome));

/** The day's post, unless it was already posted; a post that fails goes to ops instead, and so
 * does a half that couldn't be read (a key revoked or expired), since the post only notes it. */
export const runTrafficDay = Effect.fn("runTrafficDay")(function* (at: number) {
  const channel = yield* TrafficChannel;
  const log = yield* TrafficLog;
  const day = dayOf(at);
  if (yield* log.posted(day)) return;
  const visits = yield* Effect.serviceOption(VisitsSource);
  const search = yield* Effect.serviceOption(SearchSource);
  const halves = {
    Visits: yield* half(Option.map(visits, (s) => s.read(daysBefore(day, 1)))),
    "Google search": yield* half(Option.map(search, (s) => s.read(at))),
  };
  const failed = Object.entries(halves).flatMap(([what, h]) =>
    h._tag === "Failed" ? [`${what}: ${h.reason}`] : [],
  );
  yield* channel.post(trafficMessage(halves.Visits, halves["Google search"])).pipe(
    Effect.zipRight(log.record(day)),
    Effect.zipRight(Effect.logInfo(`traffic: posted ${day}`)),
    Effect.zipRight(
      failed.length
        ? Effect.flatMap(OpsAlerts, (alerts) =>
            alerts.post(`The Traffic Report for ${day} couldn't read ${failed.join("; ")}`),
          )
        : Effect.void,
    ),
    Effect.catchTag("TrafficPostFailed", (e) =>
      Effect.flatMap(OpsAlerts, (alerts) =>
        alerts.post(`Multiballs couldn't post the Traffic Report for ${day}: ${e.reason}`),
      ),
    ),
  );
});

/** A day's report where even a bug is only that day's: ops hears, and the schedule goes on. */
const safely = (at: number) =>
  runTrafficDay(at).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.flatMap(OpsAlerts, (alerts) =>
        alerts.post(
          `Multiballs hit a bug posting the Traffic Report for ${dayOf(at)}: ${Cause.pretty(Cause.die(defect)).split("\n")[0] ?? ""}`,
        ),
      ),
    ),
  );

export const trafficLoop = everyDayAt(TRAFFIC_HOUR_UTC, safely);

/** The schedule, on when TRAFFIC_WEBHOOK_URL is set and at least one half has its keys. */
export const TrafficReportLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const webhook = yield* isSet("TRAFFIC_WEBHOOK_URL");
    const visits = (yield* isSet("PLAUSIBLE_URL")) && (yield* isSet("PLAUSIBLE_API_KEY"));
    const search = yield* isSet("GSC_SERVICE_ACCOUNT");
    if (!webhook || (!visits && !search)) {
      yield* Effect.logInfo(
        "traffic: off (needs TRAFFIC_WEBHOOK_URL, and PLAUSIBLE_URL + PLAUSIBLE_API_KEY or GSC_SERVICE_ACCOUNT)",
      );
      return Layer.empty;
    }
    return Layer.scopedDiscard(Effect.forkScoped(trafficLoop)).pipe(
      Layer.provide(
        Layer.mergeAll(
          TrafficChannelLive,
          TrafficLogLive,
          OpsAlerts.Default,
          visits ? PlausibleLive : Layer.empty,
          search ? SearchConsoleLive : Layer.empty,
        ),
      ),
    );
  }),
);
