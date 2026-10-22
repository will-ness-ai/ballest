// See my stats (spec #323): the #my-stats panel's button answers a member privately with their
// Stat Card, drawn by the site. A member with no Stats Link (CONTEXT.md, ADR 0014) is sent to the
// site's link page first, by a link request the bot writes to the leaderboard database; the bot
// watches that request, and once the member has signed in with Steam and confirmed, it edits the
// same private answer into their card, with no second press.
import { randomBytes } from "node:crypto";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  HttpClientResponse,
} from "@effect/platform";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";
import { Config, Context, Data, Duration, Effect, Layer, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import type { DiscordError } from "./discord/client.js";

/** How often the bot looks whether a member's request has been used. */
export const WATCH_EVERY = Duration.toMillis("5 seconds");

/**
 * How long it looks: a request lives 15 minutes, as does the interaction token the answer is
 * edited with, so a minute is left over for the edit.
 */
export const WATCH_FOR = Duration.toMillis("14 minutes");

export class StatsUnavailable extends Data.TaggedError("StatsUnavailable")<{
  readonly reason: string;
}> {}

/** The site didn't draw the card. */
export class CardFailed extends Data.TaggedError("CardFailed")<{ readonly reason: string }> {}

/** The site has no player by that Steam ID: none of its runs are on the boards. */
export class NoStats extends Data.TaggedError("NoStats") {}

/** The Stats Links, in the leaderboard database the site owns. */
export class StatsLinks extends Context.Tag("multiballs/StatsLinks")<
  StatsLinks,
  {
    /** The Steam ID this Discord account is paired with, if any. */
    readonly pairedWith: (
      discordId: string,
    ) => Effect.Effect<Option.Option<string>, StatsUnavailable>;
    /** Write a link request for this Discord account; its token. */
    readonly request: (discordId: string, name: string) => Effect.Effect<string, StatsUnavailable>;
    /** Whether the link page's confirm has used the request. */
    readonly used: (token: string) => Effect.Effect<boolean, StatsUnavailable>;
  }
>() {}

/** The site: where the link page and player pages are, and what draws the Stat Card. */
export class StatsSite extends Context.Tag("multiballs/StatsSite")<
  StatsSite,
  {
    readonly url: string;
    /** The Stat Card of the latest Refresh, as a PNG. */
    readonly card: (steamId: string) => Effect.Effect<Buffer, CardFailed | NoStats>;
  }
>() {}

/** What a member's private answer shows; messages.ts lays each out. */
export type StatsAnswer =
  | { readonly _tag: "Card"; readonly steamId: string; readonly png: Buffer; readonly url: string }
  | { readonly _tag: "SignIn"; readonly url: string }
  | { readonly _tag: "NoStats" }
  | { readonly _tag: "CardFailed" }
  | { readonly _tag: "Unavailable" };

/** Shows (or replaces) the member's private answer. */
export type Answer = (answer: StatsAnswer) => Effect.Effect<void, DiscordError>;

export interface Member {
  readonly id: string;
  readonly name: string;
}

export const makeSeeMyStats = Effect.gen(function* () {
  const links = yield* StatsLinks;
  const site = yield* StatsSite;
  // The watches outlive the press that started them, until the bot stops.
  const scope = yield* Effect.scope;

  /** The card, or why not; a failed draw is logged. */
  const cardOf = (steamId: string) =>
    site.card(steamId).pipe(
      Effect.map((png): StatsAnswer => ({
        _tag: "Card",
        steamId,
        png,
        url: `${site.url}/player/${steamId}`,
      })),
      Effect.catchTags({
        NoStats: (): Effect.Effect<StatsAnswer> => Effect.succeed({ _tag: "NoStats" }),
        CardFailed: (e): Effect.Effect<StatsAnswer> =>
          Effect.logWarning(`see my stats: couldn't draw ${steamId}'s card: ${e.reason}`).pipe(
            Effect.as({ _tag: "CardFailed" }),
          ),
      }),
    );

  /** Every few seconds until the request is used, then the card in place of the sign-in link. */
  const watch = (member: Member, token: string, answer: Answer) =>
    links.used(token).pipe(
      Effect.catchTag("StatsUnavailable", (e) =>
        Effect.logWarning(`see my stats: couldn't read a request: ${e.reason}`).pipe(
          Effect.as(false),
        ),
      ),
      Effect.delay(WATCH_EVERY),
      Effect.repeat({ until: (used) => used }),
      Effect.timeoutOption(WATCH_FOR),
      Effect.flatMap((used) =>
        Option.isNone(used) ? Effect.succeed(Option.none()) : links.pairedWith(member.id),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (steamId) => Effect.flatMap(cardOf(steamId), answer),
        }),
      ),
      Effect.catchAll((e) =>
        Effect.logWarning(
          `see my stats: couldn't show ${member.id} their card after signing in: ${e._tag === "StatsUnavailable" ? e.reason : e._tag}`,
        ),
      ),
    );

  /** A new link request, the sign-in link to it, and the watch for its use. */
  const signIn = (member: Member, answer: Answer) =>
    Effect.gen(function* () {
      const token = yield* links.request(member.id, member.name);
      yield* answer({ _tag: "SignIn", url: `${site.url}/discord/link?t=${token}` });
      yield* Effect.forkIn(watch(member, token, answer), scope);
    });

  /** The database couldn't be read or written: no card and no link, said privately. */
  const unavailable = (answer: Answer) => (e: StatsUnavailable) =>
    Effect.logWarning(`see my stats: unavailable: ${e.reason}`).pipe(
      Effect.zipRight(answer({ _tag: "Unavailable" })),
    );

  return {
    /** The panel's button: the member's card, or the way to pair first. */
    see: (member: Member, answer: Answer) =>
      links.pairedWith(member.id).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => signIn(member, answer),
            onSome: (steamId) => Effect.flatMap(cardOf(steamId), answer),
          }),
        ),
        Effect.catchTag("StatsUnavailable", unavailable(answer)),
      ),
    /** Not you? Pair again: a fresh request, whatever the Stats Link is now. */
    pairAgain: (member: Member, answer: Answer) =>
      signIn(member, answer).pipe(Effect.catchTag("StatsUnavailable", unavailable(answer))),
  };
});

export class SeeMyStats extends Context.Tag("multiballs/SeeMyStats")<
  SeeMyStats,
  Effect.Effect.Success<typeof makeSeeMyStats>
>() {}

// ---------------------------------------------------------------- the database

/** A request lives as long as the link page takes it (REQUEST_MS in web/db/stats-link.ts). */
const REQUEST_LIFE = "15 minutes";

const Paired = Schema.Struct({ steamId: Schema.String });

/**
 * The Stats Links at DATABASE_URL: plain SQL over the tables web/ owns (docs/data.md, "Stats
 * Links"). Each call opens its own connection and closes it, like the Chosen Skins' reads, so
 * the bot holds none open between presses. Without a database, every call is unavailable.
 */
export const StatsLinksLive = Layer.effect(
  StatsLinks,
  Effect.gen(function* () {
    const url = yield* Config.option(Config.redacted("DATABASE_URL"));
    if (Option.isNone(url)) {
      yield* Effect.logInfo("see my stats: off (DATABASE_URL not set)");
      const off = Effect.fail(new StatsUnavailable({ reason: "DATABASE_URL not set" }));
      return StatsLinks.of({ pairedWith: () => off, request: () => off, used: () => off });
    }
    const onDb = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
      effect.pipe(
        Effect.provide(PgClient.layer({ url: url.value })),
        Effect.scoped,
        Effect.catchAll((e) =>
          Effect.fail(new StatsUnavailable({ reason: e instanceof Error ? e.message : String(e) })),
        ),
      );
    return StatsLinks.of({
      pairedWith: (discordId) =>
        onDb(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const rows = yield* sql`select steam_id as "steamId" from stats_links
              where discord_id = ${discordId}`.pipe(
              Effect.flatMap(Schema.decodeUnknown(Schema.Array(Paired))),
            );
            return Option.fromNullable(rows[0]?.steamId);
          }),
        ),
      // The one write the bot makes here (ADR 0014): a request, and the old ones pruned.
      request: (discordId, name) =>
        onDb(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const token = randomBytes(16).toString("hex");
            yield* sql.withTransaction(
              Effect.all([
                sql`delete from stats_link_requests
                  where created_at <= now() - ${REQUEST_LIFE}::interval`,
                sql`insert into stats_link_requests ${sql.insert({
                  token,
                  discord_id: discordId,
                  discord_name: name,
                })}`,
              ]),
            );
            return token;
          }),
        ),
      used: (token) =>
        onDb(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const rows = yield* sql`select 1 from stats_link_requests
              where token = ${token} and used_at is not null`;
            return rows.length > 0;
          }),
        ),
    });
  }),
);

// ---------------------------------------------------------------- the site

/** How long the site has to draw a card; a cold draw takes a few seconds. */
export const DRAW_TIMEOUT = Duration.toMillis("30 seconds");

const Refreshed = Schema.Struct({ refreshedAt: Schema.NullOr(Schema.String) });

/**
 * The site at `url`. The card's address carries the latest Refresh's time as `v`, as the site's
 * own share images do, so its CDN keeps one card per Refresh and the date on it is current.
 */
export const statsSiteLive = (url: string) =>
  Layer.effect(
    StatsSite,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      /** What the site answered, as the reason a card failed. */
      const failed = (what: string) => (e: HttpClientError.HttpClientError | ParseError) =>
        new CardFailed({
          reason:
            e._tag === "ResponseError"
              ? `${what}: the site said ${String(e.response.status)}`
              : `${what}: ${e.message}`,
        });
      const refreshed = http.get(`${url}/api/refreshed`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Refreshed)),
        Effect.map(({ refreshedAt }) => (refreshedAt === null ? 0 : Date.parse(refreshedAt))),
        Effect.scoped,
        Effect.mapError(failed("the latest Refresh")),
      );
      const card = (steamId: string, v: number) =>
        http.get(`${url}/og/stats/${steamId}?v=${String(v)}`).pipe(
          Effect.flatMap((res) => res.arrayBuffer),
          Effect.map((bytes) => Buffer.from(bytes)),
          Effect.scoped,
          Effect.catchAll((e): Effect.Effect<never, CardFailed | NoStats> =>
            e._tag === "ResponseError" && e.response.status === 404
              ? Effect.fail(new NoStats())
              : Effect.fail(failed("the card")(e)),
          ),
        );
      return StatsSite.of({
        url,
        card: (steamId) =>
          refreshed.pipe(
            Effect.flatMap((v) => card(steamId, v)),
            Effect.timeoutFail({
              duration: DRAW_TIMEOUT,
              onTimeout: () => new CardFailed({ reason: "the site didn't answer" }),
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** The site at SITE_URL (default the live one), where the bot's database is the site's own. */
const StatsSiteLive = Layer.unwrapEffect(
  Config.string("SITE_URL").pipe(
    Config.withDefault("https://ballestrecords.com"),
    Effect.map(statsSiteLive),
  ),
);

/** See my stats over the database at DATABASE_URL and the site at SITE_URL. */
export const SeeMyStatsLive = Layer.scoped(SeeMyStats, makeSeeMyStats).pipe(
  Layer.provide(Layer.mergeAll(StatsLinksLive, StatsSiteLive)),
);
