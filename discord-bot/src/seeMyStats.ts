// See my stats (spec #323): the #my-stats panel's button answers a member privately with their
// Stat Card, drawn by the site. A member with no Stats Link (CONTEXT.md, ADR 0014) is sent to the
// site's link page first, by a link request the bot writes to the leaderboard database; the bot
// watches that request, and once the member has signed in with Steam and confirmed, it edits the
// same private answer into their card, with no second press.
import { Context, Data, Duration, Effect, Option } from "effect";
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
