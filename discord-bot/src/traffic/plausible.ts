// The site's own analytics: our Plausible instance's Stats API (v1, which every Community
// Edition serves), read with PLAUSIBLE_API_KEY for the site PLAUSIBLE_SITE_ID. Plausible counts
// days in the site's own time zone, so a date here is that zone's day.
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect";
import type { Compared, Ranked, Visits } from "./report.js";

export class TrafficUnavailable extends Data.TaggedError("TrafficUnavailable")<{
  readonly reason: string;
}> {}

export class VisitsSource extends Context.Tag("multiballs/VisitsSource")<
  VisitsSource,
  { readonly read: (date: string) => Effect.Effect<Visits, TrafficUnavailable> }
>() {}

const Day = Schema.Struct({
  date: Schema.String,
  visitors: Schema.Number,
  pageviews: Schema.Number,
});
const Timeseries = Schema.Struct({ results: Schema.Array(Day) });
const Value = Schema.Struct({ value: Schema.Number });
const Aggregate = Schema.Struct({
  results: Schema.Struct({ visit_duration: Value, bounce_rate: Value }),
});
const Breakdown = Schema.Struct({
  results: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

/** "2026-10-17" `n` days before `date` */
export const daysBefore = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);

/** A day's value against the mean of the days before it that the series holds. */
export const compared = (
  days: ReadonlyArray<{ date: string; n: number }>,
  date: string,
): Compared => {
  const day = days.find((d) => d.date === date)?.n ?? 0;
  const before = days.filter((d) => d.date < date);
  return {
    day,
    weekMean: before.length ? before.reduce((s, d) => s + d.n, 0) / before.length : null,
  };
};

/** A breakdown's rows as names and visitors, whatever the property's key is called. */
export const rankedBy = (
  key: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<Ranked> =>
  rows.flatMap((r) => {
    const name = r[key];
    const n = r.visitors;
    return typeof name === "string" && typeof n === "number" ? [{ name, n }] : [];
  });

export const PlausibleLive = Layer.effect(
  VisitsSource,
  Effect.gen(function* () {
    const base = yield* Config.string("PLAUSIBLE_URL");
    const key = yield* Config.redacted("PLAUSIBLE_API_KEY");
    const site = yield* Config.withDefault(
      Config.string("PLAUSIBLE_SITE_ID"),
      "ballest.willness.dev",
    );
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const get = <A, I>(path: string, params: Record<string, string>, schema: Schema.Schema<A, I>) =>
      http
        .execute(
          HttpClientRequest.get(`${base}/api/v1/stats/${path}`, {
            urlParams: { site_id: site, ...params },
          }).pipe(HttpClientRequest.bearerToken(Redacted.value(key))),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.scoped,
          Effect.mapError(
            (e) => new TrafficUnavailable({ reason: `Plausible ${path}: ${e._tag}` }),
          ),
        );
    return VisitsSource.of({
      read: Effect.fn("VisitsSource.read")(function* (date: string) {
        const day = { period: "day", date };
        const top = (property: string) =>
          get("breakdown", { ...day, property, metrics: "visitors", limit: "5" }, Breakdown);
        const [series, totals, pages, sources] = yield* Effect.all(
          [
            get(
              "timeseries",
              {
                period: "custom",
                date: `${daysBefore(date, 7)},${date}`,
                metrics: "visitors,pageviews",
              },
              Timeseries,
            ),
            get("aggregate", { ...day, metrics: "visit_duration,bounce_rate" }, Aggregate),
            top("event:page"),
            top("visit:source"),
          ],
          { concurrency: 4 },
        );
        return {
          date,
          visitors: compared(
            series.results.map((d) => ({ date: d.date, n: d.visitors })),
            date,
          ),
          pageviews: compared(
            series.results.map((d) => ({ date: d.date, n: d.pageviews })),
            date,
          ),
          visitDuration: totals.results.visit_duration.value,
          bounceRate: totals.results.bounce_rate.value,
          pages: rankedBy("page", pages.results),
          sources: rankedBy("source", sources.results),
        };
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
