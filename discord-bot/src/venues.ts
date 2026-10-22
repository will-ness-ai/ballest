// The Venues (CONTEXT.md, spec #315): the Discord servers the bot plays Matches in. The home
// Venue, the game Discord, is DISCORD_GUILD_ID, DISCORD_CHANNEL_ID and DISCORD_PING_ROLE_ID, as
// it was before there were others. Every server that invites the bot it sets up as a Venue itself
// (spec #321), named by the server's id: a `multiballs` channel only it posts in and a
// `Multiplayer ping` role, each reused if the server has one, kept in the `venues` table, and set
// up again at startup when one is gone. The prod app is private, so only Will can invite it.
//
// A server the bot was already in when this build first started is known but not wanted, so a
// deploy never adds a channel to a server nobody asked for; any other is wanted, and kept so, so a
// setup that fails (a missing permission, an outage) is tried again until it works.
//
// The setup rules run against a small port (SetupGuild) so they are tested on a fake server;
// src/discord/setupGuild.ts is the port on discord.js.
import { SqlClient, SqlSchema } from "@effect/sql";
import { Context, Data, Effect, Either, Layer, Option, Ref, Schema } from "effect";
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
}> {}

/** What is wrong with a Venue the bot can't run, in one line. */
export class VenueCheckFailed extends Data.TaggedError("VenueCheckFailed")<{
  readonly reason: string;
}> {}

/** A server permission setup may need: Manage Channels to make a channel, Manage Roles to make a role or set a channel's overwrites. */
export type ServerPermission = "Manage Channels" | "Manage Roles";

/** A server, as setting it up as a Venue needs it. Every call can fail with Discord's reason. */
export interface SetupGuild {
  readonly id: string;
  readonly name: string;
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
     * On this build's first start only: every server listed is known, but not wanted as a Venue.
     * Later calls change nothing.
     */
    readonly takeBaseline: (guildIds: ReadonlyArray<string>) => Effect.Effect<void>;
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
      takeBaseline: (guildIds) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const taken = yield* sql`SELECT 1 FROM known_servers_baseline`;
              if (taken.length > 0) return;
              for (const guildId of guildIds)
                yield* sql`INSERT INTO known_servers (guild_id, wanted) VALUES (${guildId}, 0) ON CONFLICT (guild_id) DO NOTHING`;
              yield* sql`INSERT INTO known_servers_baseline (id) VALUES (1)`;
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

/** Where the joiner starts a Venue, and asks whether one runs. */
export interface RunningVenues<A> {
  readonly has: (name: VenueName) => Effect.Effect<boolean>;
  readonly start: (name: VenueName, venue: A) => Effect.Effect<void>;
}

/**
 * Which servers become Venues, and setting them up. A server is wanted once it invites the bot
 * (`invited`), or when the bot finds it at startup without knowing it (invited while the bot was
 * down); on this build's first start, every server the bot is already in is known as not wanted.
 * A wanted server that isn't running is set up (or repaired) and started with `check` whenever
 * the bot tries it: at startup, when invited, and at each `retry`. One that can't be set up yet or
 * fails its check stays wanted, and `alert` (the ops channel) hears each reason once.
 */
export const makeVenueJoiner = Effect.fn("makeVenueJoiner")(function* <A, R>(
  homeGuildId: string,
  check: (venue: VenueConfig) => Effect.Effect<A, VenueCheckFailed, R>,
  alert: (message: string) => Effect.Effect<void>,
  running: RunningVenues<A>,
) {
  const records = yield* VenueRecords;
  // One server at a time, so a server invited while the bot starts isn't set up twice.
  const lock = yield* Effect.makeSemaphore(1);
  /** Why each server was last left out, so ops hears a reason once rather than at every retry. */
  const leftOutFor = yield* Ref.make(new Map<string, string>());

  /** Set up and start a wanted server, unless it runs already. */
  const attempt = Effect.fn("attempt")(function* (guild: SetupGuild) {
    const name = venueNameOf(guild.id);
    if (guild.id === homeGuildId || (yield* running.has(name))) return;
    if (!Option.getOrElse(yield* records.wanted(guild.id), () => false)) return;
    const result = yield* Effect.gen(function* () {
      const venue = yield* setUpVenue(guild, yield* records.byGuild(guild.id));
      yield* records.put(venue);
      return yield* check(venue);
    }).pipe(Effect.either);
    if (Either.isRight(result)) {
      yield* Ref.update(leftOutFor, (all) => {
        const next = new Map(all);
        next.delete(guild.id);
        return next;
      });
      return yield* running.start(name, result.right);
    }
    const { reason } = result.left;
    if ((yield* Ref.get(leftOutFor)).get(guild.id) === reason) return;
    yield* Ref.update(leftOutFor, (all) => new Map(all).set(guild.id, reason));
    yield* alert(
      `Multiballs couldn't set up the server ${guild.name} (${guild.id}) as a Venue: ${reason}. It tries again every few minutes.`,
    );
  }, lock.withPermits(1));

  return {
    /** At startup, with every server the bot is in. */
    startup: Effect.fn("startup")(function* (guilds: ReadonlyArray<SetupGuild>) {
      const others = guilds.filter((g) => g.id !== homeGuildId);
      yield* records.takeBaseline(others.map((g) => g.id));
      for (const guild of others)
        if (Option.isNone(yield* records.wanted(guild.id))) yield* records.want(guild.id);
      for (const guild of others) yield* attempt(guild);
    }),
    /** A server just invited the bot. */
    invited: Effect.fn("invited")(function* (guild: SetupGuild) {
      if (guild.id === homeGuildId) return;
      yield* records.want(guild.id);
      yield* attempt(guild);
    }),
    /** Try a server again: it came back from an outage, or its permissions may have changed. */
    retry: attempt,
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
