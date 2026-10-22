// The Venues (CONTEXT.md, spec #315): the Discord servers the bot plays Matches in. The home
// Venue, the game Discord, is DISCORD_GUILD_ID, DISCORD_CHANNEL_ID and DISCORD_PING_ROLE_ID, as
// it was before there were others; each other Venue is one entry of DISCORD_VENUES, a JSON list
// of { name, guildId, channelId, pingRoleId } (ids, not secrets: it is set in fly.toml). Absent,
// the bot plays in home alone, so `pnpm dev` and the sandbox need nothing new.
import { Cause, Data, Effect, Either, Option, Schema } from "effect";
import { HOME_VENUE, type VenueName } from "./domain.js";

export interface VenueConfig {
  /** The Venue's short stable key, stored on its Matches: `home`, or e.g. `ballest-racing`. */
  readonly name: VenueName;
  /** Its server. */
  readonly guildId: string;
  /** Its Match channel: the Footer, Match Cards and Match Threads. */
  readonly channelId: string;
  /** Its @Multiplayer ping role. */
  readonly pingRoleId: string;
}

const Id = Schema.String.pipe(Schema.minLength(1));
const VenueList = Schema.parseJson(
  Schema.Array(Schema.Struct({ name: Schema.String, guildId: Id, channelId: Id, pingRoleId: Id })),
);

/** A name that reads as a key in logs and the database. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Every configured Venue: home first, then the others. */
export type Venues<V> = readonly [home: V, ...others: ReadonlyArray<V>];

/**
 * Every configured Venue, home first, and why any listed one was left out. A setting that isn't a
 * list of Venues leaves out every extra one: home is never at stake.
 */
export const parseVenues = (
  home: Omit<VenueConfig, "name">,
  setting: string | undefined,
): { readonly venues: Venues<VenueConfig>; readonly problems: ReadonlyArray<string> } => {
  const venues: [VenueConfig, ...Array<VenueConfig>] = [{ name: HOME_VENUE, ...home }];
  if (setting === undefined || setting.trim() === "") return { venues, problems: [] };
  const listed = Schema.decodeUnknownEither(VenueList)(setting);
  if (Either.isLeft(listed))
    return {
      venues,
      problems: [`DISCORD_VENUES isn't a list of { name, guildId, channelId, pingRoleId }`],
    };
  const problems: Array<string> = [];
  for (const v of listed.right) {
    const clash = venues.find(
      (other) =>
        other.name === v.name || other.guildId === v.guildId || other.channelId === v.channelId,
    );
    if (!NAME.test(v.name))
      problems.push(`Venue "${v.name}": a name is lower-case letters, digits and dashes`);
    else if (clash !== undefined)
      problems.push(
        `Venue "${v.name}": its name, server or channel is already Venue "${clash.name}"'s`,
      );
    else venues.push(v);
  }
  return { venues, problems };
};

/** What is wrong with a Venue the bot can't run, in one line. */
export class VenueCheckFailed extends Data.TaggedError("VenueCheckFailed")<{
  readonly reason: string;
}> {}

/**
 * Start each Venue with `check`, which says what is wrong with one it can't run; the running
 * ones, home first. The home Venue failing stops the bot, as a broken production setup should;
 * any other is left out with a line to `alert` (the ops channel), so a second server can never
 * take the game Discord's bot down: not even a check that crashes there.
 */
export const startVenues = Effect.fn("startVenues")(function* <A, R>(
  [home, ...others]: Venues<VenueConfig>,
  check: (venue: VenueConfig) => Effect.Effect<A, VenueCheckFailed, R>,
  alert: (message: string) => Effect.Effect<void>,
) {
  const running: [A, ...Array<A>] = [
    yield* check(home).pipe(
      Effect.catchTag("VenueCheckFailed", (e) => Effect.dieMessage(e.reason)),
    ),
  ];
  for (const venue of others) {
    const leaveOut = (reason: string) =>
      alert(`Multiballs left out the Venue "${venue.name}" (server ${venue.guildId}): ${reason}`);
    const started = yield* check(venue).pipe(
      Effect.map((a) => Option.some(a)),
      Effect.catchTag("VenueCheckFailed", (e) =>
        leaveOut(e.reason).pipe(Effect.as(Option.none<A>())),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.logError(`checking the Venue ${venue.name} crashed`, Cause.die(defect)).pipe(
          Effect.andThen(
            leaveOut(
              `its check crashed: ${defect instanceof Error ? defect.message : String(defect)}`,
            ),
          ),
          Effect.as(Option.none<A>()),
        ),
      ),
    );
    if (Option.isSome(started)) running.push(started.value);
  }
  const result: Venues<A> = running;
  return result;
});
