// The site's own analytics: our Plausible instance's Stats API (v1, which every Community
// Edition serves), read with PLAUSIBLE_API_KEY for the site PLAUSIBLE_SITE_ID. Plausible counts
// days in the site's own time zone, so a date here is that zone's day.
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { daysBefore } from "../everyDay.js";
import { compared, type Ranked, TrafficUnavailable, type Visits } from "./report.js";

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
// null on a day nobody visited
const Value = Schema.Struct({ value: Schema.NullOr(Schema.Number) });
const Aggregate = Schema.Struct({
  results: Schema.Struct({ visit_duration: Value, bounce_rate: Value }),
});
const Breakdown = Schema.Struct({
  results: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

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
    const get = Effect.fn("VisitsSource.get")(function* <A, I>(
      path: string,
      params: Record<string, string>,
      schema: Schema.Schema<A, I>,
    ) {
      return yield* http
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
    });
    return VisitsSource.of({
      read: Effect.fn("VisitsSource.read")(function* (date: string) {
        const day = { period: "day", date };
        const top = Effect.fn("VisitsSource.top")(function* (property: string) {
          return yield* get(
            "breakdown",
            { ...day, property, metrics: "visitors", limit: "5" },
            Breakdown,
          );
        });
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
          visitDuration: totals.results.visit_duration.value ?? 0,
          bounceRate: totals.results.bounce_rate.value ?? 0,
          pages: rankedBy("page", pages.results),
          sources: rankedBy("source", sources.results),
        };
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
