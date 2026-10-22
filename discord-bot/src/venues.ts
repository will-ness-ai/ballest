// The Venues (CONTEXT.md, spec #315): the Discord servers the bot plays Matches in. The home
// Venue, the game Discord, is DISCORD_GUILD_ID, DISCORD_CHANNEL_ID and DISCORD_PING_ROLE_ID, as
// it was before there were others. Every server that invites the bot it sets up as a Venue itself
// (spec #321), named by the server's id: a `multiballs` channel only it posts in and a
// `Multiplayer ping` role, each reused if the server has one, kept in the `venues` table, and set
// up again when one is gone. The prod app is private, so only Will can invite it.
//
// A server the bot joined before VENUES_SINCE, found when this build first starts, is known but
// not wanted, so a deploy never adds a channel to a server nobody asked for; any other is wanted,
// and kept so, so a setup that fails (a missing permission, an outage) is tried again until it
// works. Which Venues run is settled at startup, from the cache, and fixed until the bot
// restarts: anything that would change it restarts the bot (src/restart.ts, with its brake).
//
// The setup rules run against a small port (SetupGuild) so they are tested on a fake server;
// src/discord/setupGuild.ts is the port on discord.js.
import { SqlClient, SqlSchema } from "@effect/sql";
import { Cause, Clock, Context, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import { MigratorLive } from "./db.js";
import { HOME_VENUE, type VenueName } from "./domain.js";

export interface VenueConfig {
  /** The Venue's short stable key, stored on its Matches: `home`, or its server's id. */
  readonly name: VenueName;
  /** Its server. */
  readonly guildId: string;
  /** Its Match channel: the Footer, Match Cards and Match Threads. */
  readonly channelId: string;
  /** Its @Multiplayer ping role. */
  readonly pingRoleId: string;
}

/** The name of a Venue the bot set up itself: its server's id, which can never be `home`. */
export const venueNameOf = (guildId: string): VenueName => guildId;
/** The server of a Venue the bot set up itself, from its name. */
export const venueGuildId = (name: VenueName): string => name;

/** The Match channel the bot looks for, or makes, in a server it sets up. */
export const MATCH_CHANNEL = "multiballs";
/** The ping role the bot looks for, or makes, in a server it sets up. */
export const PING_ROLE = "Multiplayer ping";

/** A channel permission, as discord.js names its flags. */
export type ChannelPermission =
  | "ViewChannel"
  | "SendMessages"
  | "EmbedLinks"
  | "AttachFiles"
  | "ReadMessageHistory"
  | "CreatePublicThreads"
  | "SendMessagesInThreads"
  | "ManageThreads";

/** Every permission the bot uses in a Venue's channel, as a moderator reads it and as a flag. */
export const REQUIRED_PERMISSIONS: ReadonlyArray<
  readonly [label: string, flag: ChannelPermission]
> = [
  ["View Channel", "ViewChannel"],
  ["Send Messages", "SendMessages"],
  ["Embed Links", "EmbedLinks"],
  ["Attach Files", "AttachFiles"],
  ["Read Message History", "ReadMessageHistory"],
  ["Create Public Threads", "CreatePublicThreads"],
  ["Send Messages in Threads", "SendMessagesInThreads"],
  ["Manage Threads", "ManageThreads"],
];

/** A channel's permission overwrites, as the bot sets them on a channel it sets up. */
export interface ChannelAccess {
  /** Denied to @everyone. */
  readonly everyoneDenied: ReadonlyArray<ChannelPermission>;
  /** Allowed to the bot's own member. */
  readonly botAllowed: ReadonlyArray<ChannelPermission>;
}

/**
 * A Match channel's: members don't post in it (they talk in Match Threads), and the bot may do
 * everything it checks for.
 */
export const MATCH_CHANNEL_ACCESS: ChannelAccess = {
  everyoneDenied: ["SendMessages"],
  botAllowed: REQUIRED_PERMISSIONS.map(([, flag]) => flag),
};

/** What stopped the bot setting a server up as a Venue, in one line. */
export class VenueSetupFailed extends Data.TaggedError("VenueSetupFailed")<{
  readonly reason: string;
  /** What kind of failure it is, as VenueCheckFailed's. */
  readonly kind?: string;
}> {}

/**
 * What is wrong with a Venue the bot can't run, in one line. `kind`, when given, is what kind of
 * failure it is, steadier than the words (Discord's change from one try to the next).
 */
export class VenueCheckFailed extends Data.TaggedError("VenueCheckFailed")<{
  readonly reason: string;
  readonly kind?: string;
}> {}

/**
 * When Venues began setting themselves up: on this build's first start, a server the bot joined
 * before this (or when it can't say when) is known but not wanted; one joined since is wanted, so
 * a server invited with the old by-hand setup that day still becomes a Venue.
 */
export const VENUES_SINCE = Date.parse("2026-10-22T00:00:00Z");

/** A server permission setup may need: Manage Channels to make a channel, Manage Roles to make a role or set a channel's overwrites. */
export type ServerPermission = "Manage Channels" | "Manage Roles";

/** A server, as setting it up as a Venue needs it. Every call can fail with Discord's reason. */
export interface SetupGuild {
  readonly id: string;
  readonly name: string;
  /** When the bot joined the server (ms since the epoch), or null when Discord can't say. */
  readonly joinedAt: number | null;
  /** Whether a stored Venue's channel and role are in the cache: no Discord call. */
  readonly holds: (venue: VenueConfig) => boolean;
  /** The bot's member there: which server permissions setup may need it lacks, and its highest role's position. */
  readonly bot: Effect.Effect<
    { readonly missing: ReadonlyArray<ServerPermission>; readonly topRolePosition: number },
    VenueSetupFailed
  >;
  readonly textChannels: Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly name: string }>,
    VenueSetupFailed
  >;
  /** Make a text channel with these overwrites; its id. */
  readonly createTextChannel: (
    name: string,
    access: ChannelAccess,
  ) => Effect.Effect<string, VenueSetupFailed>;
  /** Set these overwrites on a channel, leaving its others alone. */
  readonly setAccess: (
    channelId: string,
    access: ChannelAccess,
  ) => Effect.Effect<void, VenueSetupFailed>;
  /** The server's roles, each with its position (higher is above). */
  readonly roles: Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly name: string; readonly position: number }>,
    VenueSetupFailed
  >;
  /** Make a mentionable role, below the bot's own; its id. */
  readonly createRole: (name: string) => Effect.Effect<string, VenueSetupFailed>;
}

/**
 * A server as a Venue, from what is stored for it (if anything): a stored channel and role still
 * there are kept as they are; whatever is gone, or everything for a new server, is set up. A
 * channel is the server's `multiballs` text channel, its overwrites set, or a new one; a role is
 * its `Multiplayer ping` role if the bot's own sits above it (so it can give and take it), or a
 * new mentionable one. It asks only for the permissions what it does needs, and reads the bot's
 * member once.
 */
export const setUpVenue = Effect.fn("setUpVenue")(function* (
  guild: SetupGuild,
  stored: Option.Option<VenueConfig>,
) {
  const channels = yield* guild.textChannels;
  const roles = yield* guild.roles;
  const keptChannel = Option.filter(
    Option.map(stored, (v) => v.channelId),
    (id) => channels.some((c) => c.id === id),
  );
  const keptRole = Option.filter(
    Option.map(stored, (v) => v.pingRoleId),
    (id) => roles.some((r) => r.id === id),
  );
  const name = venueNameOf(guild.id);
  if (Option.isSome(keptChannel) && Option.isSome(keptRole))
    return {
      name,
      guildId: guild.id,
      channelId: keptChannel.value,
      pingRoleId: keptRole.value,
    } satisfies VenueConfig;

  const bot = yield* guild.bot;
  const found = channels.find((c) => c.name === MATCH_CHANNEL);
  const foundRole = roles.find((r) => r.name === PING_ROLE && r.position < bot.topRolePosition);
  const needs = new Set<ServerPermission>();
  if (Option.isNone(keptChannel))
    needs.add(found === undefined ? "Manage Channels" : "Manage Roles");
  if (Option.isNone(keptRole) && foundRole === undefined) needs.add("Manage Roles");
  const missing = bot.missing.filter((p) => needs.has(p));
  if (missing.length > 0)
    return yield* new VenueSetupFailed({
      kind: `missing ${missing.join(", ")}`,
      reason: `the bot needs ${missing.join(", ")} there to set up its channel and ping role; give its role that, and it tries again within a few minutes`,
    });

  const channelId = Option.isSome(keptChannel)
    ? keptChannel.value
    : found === undefined
      ? yield* guild.createTextChannel(MATCH_CHANNEL, MATCH_CHANNEL_ACCESS)
      : yield* guild.setAccess(found.id, MATCH_CHANNEL_ACCESS).pipe(Effect.as(found.id));
  const pingRoleId = Option.isSome(keptRole)
    ? keptRole.value
    : foundRole === undefined
      ? yield* guild.createRole(PING_ROLE)
      : foundRole.id;
  yield* Effect.log(`Venue ${name}: set up #${MATCH_CHANNEL} and @${PING_ROLE} in ${guild.name}`);
  return { name, guildId: guild.id, channelId, pingRoleId } satisfies VenueConfig;
});

/** The Venues the bot set up itself, and the servers it knows, by server; home is never among them. */
export class VenueRecords extends Context.Tag("multiballs/VenueRecords")<
  VenueRecords,
  {
    readonly byGuild: (guildId: string) => Effect.Effect<Option.Option<VenueConfig>>;
    /** Store a Venue, replacing what was stored for its server. */
    readonly put: (venue: VenueConfig) => Effect.Effect<void>;
    /**
     * On this build's first start only: every server listed is known, but not wanted as a Venue,
     * as of `at` (ms). Later calls change nothing, except to give a baseline taken without a time
     * (by the build before 0012) this one, so only a rejoin after now counts.
     */
    readonly takeBaseline: (guildIds: ReadonlyArray<string>, at: number) => Effect.Effect<void>;
    /** When the baseline was taken (ms); none before it is. */
    readonly baselineTakenAt: Effect.Effect<Option.Option<number>>;
    /** Whether a server is wanted as a Venue; none for one the bot has never known. */
    readonly wanted: (guildId: string) => Effect.Effect<Option.Option<boolean>>;
    /** Want a server as a Venue from now on. */
    readonly want: (guildId: string) => Effect.Effect<void>;
  }
>() {}

const VenueRow = Schema.Struct({
  name: Schema.String,
  guild_id: Schema.String,
  channel_id: Schema.String,
  ping_role_id: Schema.String,
});

/** VenueRecords in the bot's SQLite database (the `venues` table). Needs a SqlClient. */
export const VenueRecordsLive = Layer.effect(
  VenueRecords,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const find = SqlSchema.findOne({
      Request: Schema.String,
      Result: VenueRow,
      execute: (guildId) => sql`SELECT * FROM venues WHERE guild_id = ${guildId}`,
    });
    const findKnown = SqlSchema.findOne({
      Request: Schema.String,
      Result: Schema.Struct({ wanted: Schema.Number }),
      execute: (guildId) => sql`SELECT wanted FROM known_servers WHERE guild_id = ${guildId}`,
    });
    return VenueRecords.of({
      baselineTakenAt: sql<{
        readonly taken_at: number | null;
      }>`SELECT taken_at FROM known_servers_baseline`.pipe(
        Effect.map((rows) => Option.fromNullable(rows[0]?.taken_at)),
        Effect.orDie,
      ),
      takeBaseline: (guildIds, at) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const taken = yield* sql`SELECT 1 FROM known_servers_baseline`;
              if (taken.length > 0) {
                yield* sql`UPDATE known_servers_baseline SET taken_at = ${at} WHERE taken_at IS NULL`;
                return;
              }
              for (const guildId of guildIds)
                yield* sql`INSERT INTO known_servers (guild_id, wanted) VALUES (${guildId}, 0) ON CONFLICT (guild_id) DO NOTHING`;
              yield* sql`INSERT INTO known_servers_baseline (id, taken_at) VALUES (1, ${at})`;
            }),
          )
          .pipe(Effect.orDie),
      wanted: (guildId) =>
        findKnown(guildId).pipe(Effect.map(Option.map((row) => row.wanted === 1)), Effect.orDie),
      want: (guildId) =>
        sql`INSERT INTO known_servers (guild_id, wanted) VALUES (${guildId}, 1) ON CONFLICT (guild_id) DO UPDATE SET wanted = 1`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
      byGuild: (guildId) =>
        find(guildId).pipe(
          Effect.map(
            Option.map((row): VenueConfig => ({
              name: row.name,
              guildId: row.guild_id,
              channelId: row.channel_id,
              pingRoleId: row.ping_role_id,
            })),
          ),
          Effect.orDie,
        ),
      put: (v) =>
        sql`INSERT INTO venues (name, guild_id, channel_id, ping_role_id)
            VALUES (${v.name}, ${v.guildId}, ${v.channelId}, ${v.pingRoleId})
            ON CONFLICT (name) DO UPDATE SET guild_id = excluded.guild_id,
              channel_id = excluded.channel_id, ping_role_id = excluded.ping_role_id`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
    });
  }),
).pipe(Layer.provide(MigratorLive));

/** Why a server was left out, as ops reads it, and the kind it is told once for. */
const leftOut = (cause: Cause.Cause<VenueSetupFailed | VenueCheckFailed>) =>
  Option.match(Cause.failureOption(cause), {
    onSome: (e) => ({ kind: e.kind ?? e.reason, reason: e.reason }),
    onNone: () => ({ kind: "crashed", reason: "setting it up failed (see the log)" }),
  });

/** How long setting up and checking one server may take before it is left out for now. */
const SETUP_TIMEOUT = "30 seconds";

/**
 * Which servers are Venues. The running set is settled at startup and fixed until the bot
 * restarts; home is never part of it, and never waits on it.
 *
 * A server is wanted once it invites the bot, or when the bot finds it without knowing it (invited
 * while the bot was down or starting); on this build's first start, every server the bot is
 * already in is known as not wanted.
 *
 * `startup` makes no Discord calls: a wanted server with a stored Venue whose channel and role are
 * in the cache is checked from the cache (`check(venue, true)`), and those run. Everything else
 * is `retry`'s, in the background, again every few minutes and when Discord says a server is
 * available: set up (or repaired), stored and checked over the API, one server at a time with a
 * time limit, and once that works `restart` is asked to run it. A server that fails, takes too
 * long or hits a bug is left out, and `alert` (the ops channel) hears each kind of reason once per
 * server. Once one sets up it is pending, left alone until the restart. A running Venue's
 * server that removes the bot asks `restart` too; one that `broke` (its channel was deleted)
 * counts as not running, so the retry repairs it.
 */
export const makeVenueJoiner = Effect.fn("makeVenueJoiner")(function* <A, R>(
  homeGuildId: string,
  check: (venue: VenueConfig, cached: boolean) => Effect.Effect<A, VenueCheckFailed, R>,
  alert: (message: string) => Effect.Effect<void>,
  restart: (why: string) => Effect.Effect<void>,
) {
  const records = yield* VenueRecords;
  // One server at a time: a server invited during a retry isn't tried twice at once.
  const lock = yield* Effect.makeSemaphore(1);
  /** The servers whose Venues run, from startup on, less any that broke. */
  const running = new Set<string>();
  /** The servers set up since startup, waiting for the restart that runs them: left alone till then. */
  const pending = new Set<string>();
  /** When the baseline was taken, read once at startup; none if it couldn't be. */
  let takenAt = Option.none<number>();
  /** What kind of reason each server was last left out for, so ops hears it once, not at every retry. */
  const leftOutFor = new Map<string, string>();
  /**
   * One setup at a time per server, held for as long as the setup runs, even past its time limit,
   * so a retry can't race a channel or role still being made.
   */
  const setups = new Map<string, Effect.Semaphore>();
  const setupLock = (guildId: string) => {
    const found = setups.get(guildId);
    if (found !== undefined) return found;
    const made = Effect.unsafeMakeSemaphore(1);
    setups.set(guildId, made);
    return made;
  };

  /**
   * Set up, store and check a wanted server over the API; its Venue, or none when it is left out
   * (ops told). A bug in it is logged and leaves it out like any failure.
   */
  const setUp = Effect.fn("setUp")(function* (guild: SetupGuild) {
    const tried = yield* Effect.exit(
      Effect.gen(function* () {
        const venue = yield* setUpVenue(guild, yield* records.byGuild(guild.id));
        yield* records.put(venue);
        return yield* check(venue, false);
      }).pipe(
        setupLock(guild.id).withPermits(1),
        // Past the limit the setup runs on in the background, still holding its server's lock.
        Effect.disconnect,
        Effect.timeoutFail({
          duration: SETUP_TIMEOUT,
          onTimeout: () =>
            new VenueSetupFailed({
              kind: "timed out",
              reason: `Discord took over ${SETUP_TIMEOUT} to answer`,
            }),
        }),
      ),
    );
    if (Exit.isSuccess(tried)) {
      leftOutFor.delete(guild.id);
      return Option.some(tried.value);
    }
    if (Option.isNone(Cause.failureOption(tried.cause)))
      yield* Effect.logError(`setting up ${guild.id} failed`, tried.cause);
    const { kind, reason } = leftOut(tried.cause);
    if (leftOutFor.get(guild.id) !== kind) {
      leftOutFor.set(guild.id, kind);
      yield* alert(
        `Multiballs couldn't set up the server ${guild.name} (${guild.id}) as a Venue: ${reason}. It tries again every five minutes.`,
      );
    }
    return Option.none<A>();
  });

  /**
   * Whether a server is wanted, wanting it first when the bot was invited to it unseen: one it
   * doesn't know, or one the baseline counted out that it joined again since. Without a baseline
   * only a server already wanted is.
   */
  const isWanted = Effect.fn("isWanted")(function* (guild: SetupGuild) {
    const wanted = yield* records.wanted(guild.id);
    if (Option.isNone(takenAt)) return Option.getOrElse(wanted, () => false);
    const since = takenAt.value;
    const invited = Option.match(wanted, {
      onNone: () => true,
      onSome: (w) => !w && guild.joinedAt !== null && guild.joinedAt > since,
    });
    if (invited) yield* records.want(guild.id);
    return invited || Option.getOrElse(wanted, () => false);
  });

  /** Try a wanted server that isn't running; when it sets up now, restart to run it. */
  const retry = Effect.fn("retry")(function* (guild: SetupGuild) {
    if (guild.id === homeGuildId || running.has(guild.id) || pending.has(guild.id)) return;
    if (!(yield* isWanted(guild))) return;
    const venue = yield* setUp(guild);
    if (Option.isNone(venue)) return;
    pending.add(guild.id);
    yield* restart(`the server ${guild.name} (${guild.id}) is set up as a Venue`);
  }, lock.withPermits(1));

  return {
    /**
     * At startup, with every server the bot is in: the Venues to run, apart from home, checked
     * from the cache with no Discord calls. The rest are left to `retry`.
     */
    startup: Effect.fn("startup")(function* (guilds: ReadonlyArray<SetupGuild>) {
      const others = guilds.filter((g) => g.id !== homeGuildId);
      // Without a baseline every server would be wanted, so a bug taking it sets nobody up.
      const baseline = yield* Effect.exit(
        Effect.gen(function* () {
          yield* records.takeBaseline(
            others.filter((g) => g.joinedAt === null || g.joinedAt < VENUES_SINCE).map((g) => g.id),
            yield* Clock.currentTimeMillis,
          );
          return yield* records.baselineTakenAt;
        }),
      );
      if (Exit.isFailure(baseline))
        yield* Effect.logError("listing the servers the bot is in failed", baseline.cause);
      else takenAt = baseline.value;
      const venues: Array<A> = [];
      for (const guild of others) {
        const ready = yield* Effect.exit(
          Effect.gen(function* () {
            if (!(yield* isWanted(guild))) return Option.none<A>();
            const stored = yield* records.byGuild(guild.id);
            if (Option.isNone(stored) || !guild.holds(stored.value)) return Option.none<A>();
            return Option.some(yield* check(stored.value, true));
          }),
        );
        if (Exit.isSuccess(ready)) {
          if (Option.isNone(ready.value)) continue;
          running.add(guild.id);
          venues.push(ready.value.value);
        } else if (Option.isNone(Cause.failureOption(ready.cause)))
          yield* Effect.logError(`starting the Venue ${guild.id} failed`, ready.cause);
        else
          yield* Effect.logWarning(
            `the Venue ${guild.id} doesn't start from the cache; it is set up in the background`,
          );
      }
      return venues;
    }, lock.withPermits(1)),
    /** A server just invited the bot: it is wanted, and set up then run after a restart. */
    invited: Effect.fn("invited")(function* (guild: SetupGuild) {
      if (guild.id === homeGuildId) return;
      yield* records.want(guild.id);
      yield* retry(guild);
    }),
    /** Try a server again: in the background after startup, every few minutes, and when it is available again. */
    retry,
    /** A server removed the bot: if its Venue runs, restart without it. Its row stays, for a re-invite. */
    removed: Effect.fn("removed")(function* (guildId: string) {
      leftOutFor.delete(guildId);
      if (running.has(guildId)) yield* restart(`the bot was removed from the server ${guildId}`);
    }, lock.withPermits(1)),
    /** A running Venue's channel is gone: it counts as not running, so the retry repairs it. */
    broke: (guildId: string) =>
      Effect.sync(() => {
        running.delete(guildId);
      }),
  };
});

/**
 * Start the home Venue with `check`: its failing stops the bot, as a broken production setup
 * should. A check turns whatever discord.js throws into its failure.
 */
export const startHome = Effect.fn("startHome")(function* <A, R>(
  home: VenueConfig,
  check: (venue: VenueConfig) => Effect.Effect<A, VenueCheckFailed, R>,
) {
  return yield* check(home).pipe(
    Effect.catchTag("VenueCheckFailed", (e) => Effect.dieMessage(e.reason)),
  );
});

/** The home Venue from its three settings. */
export const homeVenue = (settings: Omit<VenueConfig, "name">): VenueConfig => ({
  name: HOME_VENUE,
  ...settings,
});
