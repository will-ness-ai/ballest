// Google search: the Search Console API for the Domain property sc-domain:ballestrecords.com,
// read as a service account (GSC_SERVICE_ACCOUNT, its JSON key) that the property lists as a
// user. The account signs its own token request (RS256 over node:crypto), so no Google library is
// needed. Search Console's numbers are final about two days late, so the report shows the newest
// final day rather than yesterday.
import { createSign } from "node:crypto";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { dayOf, daysBefore } from "../everyDay.js";
import { compared, type Search, type SearchRow, TrafficUnavailable } from "./report.js";

export class SearchSource extends Context.Tag("multiballs/SearchSource")<
  SearchSource,
  {
    /** the newest final day before `at` (ms) */
    readonly read: (at: number) => Effect.Effect<Search, TrafficUnavailable>;
  }
>() {}

const PROPERTY = "sc-domain:ballestrecords.com";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const API = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}`;
/** how far back the newest final day is looked for */
const LOOK_BACK = 10;
/** how far back a search counts as seen before */
const SEEN_DAYS = 28;

const ServiceAccount = Schema.parseJson(
  Schema.Struct({
    client_email: Schema.String,
    private_key: Schema.String,
    token_uri: Schema.String,
  }),
);
const Token = Schema.Struct({ access_token: Schema.String });
const Row = Schema.Struct({
  keys: Schema.Array(Schema.String),
  clicks: Schema.Number,
  impressions: Schema.Number,
  position: Schema.Number,
});
const Rows = Schema.Struct({ rows: Schema.optionalWith(Schema.Array(Row), { default: () => [] }) });
const Sitemaps = Schema.Struct({
  sitemap: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        lastDownloaded: Schema.optional(Schema.String),
        errors: Schema.optionalWith(Schema.NumberFromString, { default: () => 0 }),
        warnings: Schema.optionalWith(Schema.NumberFromString, { default: () => 0 }),
      }),
    ),
    { default: () => [] },
  ),
});
type Row = typeof Row.Type;
/** A row's one dimension: its date, search or page. */
const keyOf = (r: Row) => r.keys[0] ?? "";
/** The newest date of rows by date. */
const newestDate = (days: ReadonlyArray<Row>) => days.map(keyOf).sort().at(-1);

/** The signed JWT a service account trades for an access token (RFC 7523). */
export const assertion = (
  account: { client_email: string; private_key: string; token_uri: string },
  nowMs: number,
) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.private_key, "base64url");
  return `${unsigned}.${signature}`;
};

const searchRow = (r: Row): SearchRow => ({
  name: keyOf(r),
  clicks: r.clicks,
  impressions: r.impressions,
  position: r.position,
});

/** The report's half from the API's answers: `days` by date over LOOK_BACK days, the newest
 * day's `queries` and `pages` (most clicks first), and every search of the SEEN_DAYS before it. */
export const searchFrom = (a: {
  days: ReadonlyArray<Row>;
  queries: ReadonlyArray<Row>;
  pages: ReadonlyArray<Row>;
  seen: ReadonlyArray<Row>;
  sitemaps: typeof Sitemaps.Type;
}): Search | null => {
  const date = newestDate(a.days);
  if (date === undefined) return null;
  const of = (pick: (r: Row) => number) => a.days.map((r) => ({ date: keyOf(r), n: pick(r) }));
  const newest = a.days.find((r) => keyOf(r) === date);
  const seen = new Set(a.seen.map(keyOf));
  return {
    date,
    clicks: compared(
      of((r) => r.clicks),
      date,
    ),
    impressions: compared(
      of((r) => r.impressions),
      date,
    ),
    position: newest?.position ?? 0,
    queries: a.queries.slice(0, 5).map(searchRow),
    pages: a.pages.slice(0, 5).map(searchRow),
    newQueries: [...a.queries]
      .filter((r) => !seen.has(keyOf(r)))
      .sort((x, y) => y.impressions - x.impressions)
      .slice(0, 5)
      .map(keyOf),
    sitemaps: a.sitemaps.sitemap.map((m) => ({
      path: m.path,
      errors: m.errors,
      warnings: m.warnings,
      lastRead: m.lastDownloaded ?? null,
    })),
  };
};

export const SearchConsoleLive = Layer.effect(
  SearchSource,
  Effect.gen(function* () {
    const key = yield* Config.redacted("GSC_SERVICE_ACCOUNT");
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const failed = (what: string) => (e: { _tag: string }) =>
      new TrafficUnavailable({ reason: `Search Console ${what}: ${e._tag}` });
    const json =
      <A, I>(what: string, schema: Schema.Schema<A, I>) =>
      (request: HttpClientRequest.HttpClientRequest) =>
        http
          .execute(request)
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
            Effect.scoped,
            Effect.mapError(failed(what)),
          );

    return SearchSource.of({
      read: Effect.fn("SearchSource.read")(function* (at: number) {
        const account = yield* Schema.decode(ServiceAccount)(Redacted.value(key)).pipe(
          Effect.mapError(failed("key")),
        );
        const signed = yield* Effect.try({
          try: () => assertion(account, at),
          catch: () => new TrafficUnavailable({ reason: "Search Console key: can't sign" }),
        });
        const { access_token } = yield* HttpClientRequest.post(account.token_uri).pipe(
          HttpClientRequest.bodyUrlParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: signed,
          }),
          json("token", Token),
        );
        const query = (body: object) =>
          HttpClientRequest.post(`${API}/searchAnalytics/query`).pipe(
            HttpClientRequest.bearerToken(access_token),
            HttpClientRequest.bodyUnsafeJson(body),
            json("query", Rows),
            Effect.map((r) => r.rows),
          );
        const today = dayOf(at);
        const days = yield* query({
          startDate: daysBefore(today, LOOK_BACK),
          endDate: today,
          dimensions: ["date"],
        });
        const date = newestDate(days);
        const on = (dimension: string, rowLimit: number) =>
          query({ startDate: date, endDate: date, dimensions: [dimension], rowLimit });
        const [queries, pages, seen, sitemaps] = date
          ? yield* Effect.all(
              [
                on("query", 1000),
                on("page", 5),
                query({
                  startDate: daysBefore(date, SEEN_DAYS),
                  endDate: daysBefore(date, 1),
                  dimensions: ["query"],
                  rowLimit: 25000,
                }),
                HttpClientRequest.get(`${API}/sitemaps`).pipe(
                  HttpClientRequest.bearerToken(access_token),
                  json("sitemaps", Sitemaps),
                ),
              ],
              { concurrency: 4 },
            )
          : [[], [], [], { sitemap: [] }];
        const search = searchFrom({ days, queries, pages, seen, sitemaps });
        if (search === null)
          return yield* new TrafficUnavailable({
            reason: `no searches showed the site in the last ${LOOK_BACK} days`,
          });
        return search;
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
