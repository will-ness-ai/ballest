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
import type { SqlError } from "@effect/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  SynchronizedRef,
} from "effect";
import type { ParseError } from "effect/ParseResult";
import type { DiscordError } from "./discord/client.js";
import { OpsAlerts } from "./ops.js";

/** How often the bot looks whether a member's request has been used. */
export const WATCH_EVERY = Duration.toMillis("5 seconds");

/**
 * How long it looks: a request can be used for 15 minutes, and the interaction token the answer
 * is edited with lasts as long, so a minute is left over for the edit.
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

/** How often a failed draw may tell the ops channel: while the site is down, every press fails. */
export const CARD_ALERT_EVERY = Duration.toMillis("1 hour");

export const makeSeeMyStats = Effect.gen(function* () {
  const links = yield* StatsLinks;
  const site = yield* StatsSite;
  const alerts = yield* OpsAlerts;
  // The watches outlive the press that started them, until the bot stops.
  const scope = yield* Effect.scope;
  /** When ops last heard of a failed draw. */
  const alerted = yield* Ref.make<number | null>(null);

  /** A failed draw: logged, and told to ops at most once an hour. */
  const drawFailed = Effect.fn("SeeMyStats.drawFailed")(function* (
    steamId: string,
    reason: string,
  ) {
    const why = `couldn't draw ${steamId}'s Stat Card: ${reason}`;
    const now = yield* Clock.currentTimeMillis;
    const tell = yield* Ref.modify(alerted, (last) =>
      last === null || now - last >= CARD_ALERT_EVERY ? [true, now] : [false, last],
    );
    if (tell) yield* alerts.post(`Multiballs ${why}`);
    else yield* Effect.logWarning(`see my stats: ${why}`);
  });

  /** The card, or why not. */
  const cardOf = Effect.fn("SeeMyStats.cardOf")(function* (steamId: string) {
    return yield* site.card(steamId).pipe(
      Effect.map((png): StatsAnswer => ({
        _tag: "Card",
        steamId,
        png,
        url: `${site.url}/player/${steamId}`,
      })),
      Effect.catchTags({
        NoStats: (): Effect.Effect<StatsAnswer> => Effect.succeed({ _tag: "NoStats" }),
        CardFailed: (e): Effect.Effect<StatsAnswer> =>
          drawFailed(steamId, e.reason).pipe(Effect.as({ _tag: "CardFailed" })),
      }),
    );
  });

  /** Every few seconds until the request is used, then the card in place of the sign-in link. */
  const watch = Effect.fn("SeeMyStats.watch")(
    function* (member: Member, token: string, answer: Answer) {
      const used = yield* links.used(token).pipe(
        Effect.catchTag("StatsUnavailable", (e) =>
          Effect.logWarning(`see my stats: couldn't read a request: ${e.reason}`).pipe(
            Effect.as(false),
          ),
        ),
        Effect.delay(WATCH_EVERY),
        Effect.repeat({ until: (u) => u }),
        Effect.timeoutOption(WATCH_FOR),
      );
      if (Option.isNone(used)) return;
      const steamId = yield* links.pairedWith(member.id);
      if (Option.isNone(steamId)) return;
      yield* answer(yield* cardOf(steamId.value));
    },
    (effect, member) =>
      Effect.catchAll(effect, (e) =>
        Effect.logWarning(
          `see my stats: couldn't show ${member.id} their card after signing in: ${e._tag === "StatsUnavailable" ? e.reason : e._tag}`,
        ),
      ),
  );

  /** A new link request, the sign-in link to it, and the watch for its use. */
  const signIn = Effect.fn("SeeMyStats.signIn")(function* (member: Member, answer: Answer) {
    const token = yield* links.request(member.id, member.name);
    yield* answer({ _tag: "SignIn", url: `${site.url}/discord/link?t=${token}` });
    yield* Effect.forkIn(watch(member, token, answer), scope);
  });

  /** The database couldn't be read or written: no card and no link, said privately. */
  const unavailable = Effect.fn("SeeMyStats.unavailable")(function* (
    answer: Answer,
    e: StatsUnavailable,
  ) {
    yield* Effect.logWarning(`see my stats: unavailable: ${e.reason}`);
    yield* answer({ _tag: "Unavailable" });
  });

  return {
    /** The panel's button: the member's card, or the way to pair first. */
    see: Effect.fn("SeeMyStats.see")(
      function* (member: Member, answer: Answer) {
        const paired = yield* links.pairedWith(member.id);
        if (Option.isNone(paired)) return yield* signIn(member, answer);
        yield* answer(yield* cardOf(paired.value));
      },
      (effect, _member, answer) =>
        Effect.catchTag(effect, "StatsUnavailable", (e) => unavailable(answer, e)),
    ),
    /** Not you? Pair again: a fresh request, whatever the Stats Link is now. */
    pairAgain: Effect.fn("SeeMyStats.pairAgain")(
      function* (member: Member, answer: Answer) {
        yield* signIn(member, answer);
      },
      (effect, _member, answer) =>
        Effect.catchTag(effect, "StatsUnavailable", (e) => unavailable(answer, e)),
    ),
  };
});

export class SeeMyStats extends Context.Tag("multiballs/SeeMyStats")<
  SeeMyStats,
  Effect.Effect.Success<typeof makeSeeMyStats>
>() {}

// ---------------------------------------------------------------- the database

/**
 * How long a request is kept, as the site keeps it (KEEP_MS in web/db/stats-link.ts): a day, so
 * the link page can still say it has expired. It can be used for 15 minutes (REQUEST_MS).
 */
const REQUEST_KEPT = "24 hours";

const Paired = Schema.Struct({ steamId: Schema.String });

/**
 * The Stats Links at DATABASE_URL: plain SQL over the tables web/ owns (docs/data.md, "Stats
 * Links"). One pool serves every call, as the watches read every few seconds: made at the first
 * call and kept until the bot stops, its connections closing when idle. A database that can't be
 * reached leaves no pool made, so the next call tries again. Without a database, or while it
 * can't be reached, every call is unavailable.
 */
export const StatsLinksLive = Layer.scoped(
  StatsLinks,
  Effect.gen(function* () {
    const url = yield* Config.option(Config.redacted("DATABASE_URL"));
    if (Option.isNone(url)) {
      yield* Effect.logInfo("see my stats: off (DATABASE_URL not set)");
      const off = Effect.fail(new StatsUnavailable({ reason: "DATABASE_URL not set" }));
      return StatsLinks.of({ pairedWith: () => off, request: () => off, used: () => off });
    }
    const scope = yield* Effect.scope;
    const pool = yield* SynchronizedRef.make(Option.none<SqlClient.SqlClient>());
    const pg = PgClient.layer({ url: url.value, applicationName: "multiballs" });
    const db = SynchronizedRef.modifyEffect(
      pool,
      Option.match({
        onSome: (sql) => Effect.succeed([sql, Option.some(sql)] as const),
        onNone: () =>
          Layer.buildWithScope(pg, scope).pipe(
            Effect.map((ctx) => Context.get(ctx, SqlClient.SqlClient)),
            Effect.map((sql) => [sql, Option.some(sql)] as const),
          ),
      }),
    );
    const unavailable = (e: SqlError | ParseError) => new StatsUnavailable({ reason: e.message });

    return StatsLinks.of({
      pairedWith: Effect.fn("StatsLinks.pairedWith")(function* (discordId: string) {
        const sql = yield* db;
        const rows = yield* sql`select steam_id as "steamId" from stats_links
          where discord_id = ${discordId}`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(Paired))),
        );
        return Option.fromNullable(rows[0]?.steamId);
      }, Effect.mapError(unavailable)),
      // The one write the bot makes here (ADR 0014): a request, and those past a day pruned.
      request: Effect.fn("StatsLinks.request")(function* (discordId: string, name: string) {
        const sql = yield* db;
        const token = randomBytes(16).toString("hex");
        yield* sql.withTransaction(
          Effect.all([
            sql`delete from stats_link_requests
              where created_at <= now() - ${REQUEST_KEPT}::interval`,
            sql`insert into stats_link_requests ${sql.insert({
              token,
              discord_id: discordId,
              discord_name: name,
            })}`,
          ]),
        );
        return token;
      }, Effect.mapError(unavailable)),
      used: Effect.fn("StatsLinks.used")(function* (token: string) {
        const sql = yield* db;
        const rows = yield* sql`select 1 from stats_link_requests
          where token = ${token} and used_at is not null`;
        return rows.length > 0;
      }, Effect.mapError(unavailable)),
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
  Layer.provide(Layer.mergeAll(StatsLinksLive, StatsSiteLive, OpsAlerts.Default)),
);
