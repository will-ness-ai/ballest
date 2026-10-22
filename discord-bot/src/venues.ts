// The Venues (CONTEXT.md, spec #315): the Discord servers the bot plays Matches in. The home
// Venue, the game Discord, is DISCORD_GUILD_ID, DISCORD_CHANNEL_ID and DISCORD_PING_ROLE_ID, as
// it was before there were others. Every other server the bot is in it sets up as a Venue itself
// (spec #321), named by the server's id: a `multiballs` channel only it posts in and a
// `Multiplayer ping` role, each reused if the server has one, kept in the `venues` table, and set
// up again at startup when one is gone. The prod app is private, so only Will can invite it.
//
// The setup rules run against a small port (SetupGuild) so they are tested on a fake server;
// src/discord/setupGuild.ts is the port on discord.js.
import { SqlClient, SqlSchema } from "@effect/sql";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
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

/** A server, as setting it up as a Venue needs it. Every call can fail with Discord's reason. */
export interface SetupGuild {
  readonly id: string;
  readonly name: string;
  /** Which of Manage Channels and Manage Roles the bot lacks on the server, by name. */
  readonly missingServerPermissions: Effect.Effect<ReadonlyArray<string>, VenueSetupFailed>;
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
  /** The position of the bot's highest role. */
  readonly botTopRolePosition: Effect.Effect<number, VenueSetupFailed>;
  /** Make a mentionable role, below the bot's own; its id. */
  readonly createRole: (name: string) => Effect.Effect<string, VenueSetupFailed>;
}

/**
 * A server as a Venue, from what is stored for it (if anything): a stored channel and role still
 * there are kept as they are; whatever is gone, or everything for a new server, is set up. A
 * channel is the server's `multiballs` text channel, its overwrites set, or a new one; a role is
 * its `Multiplayer ping` role if the bot's own sits above it (so it can give and take it), or a
 * new mentionable one.
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

  const missing = yield* guild.missingServerPermissions;
  if (missing.length > 0)
    return yield* new VenueSetupFailed({
      reason: `the bot needs ${missing.join(", ")} to set up its channel and ping role; invite it again with the link in discord-bot/AGENTS.md`,
    });

  const channelId = Option.isSome(keptChannel)
    ? keptChannel.value
    : yield* Effect.gen(function* () {
        const found = channels.find((c) => c.name === MATCH_CHANNEL);
        if (found === undefined)
          return yield* guild.createTextChannel(MATCH_CHANNEL, MATCH_CHANNEL_ACCESS);
        yield* guild.setAccess(found.id, MATCH_CHANNEL_ACCESS);
        return found.id;
      });
  const pingRoleId = Option.isSome(keptRole)
    ? keptRole.value
    : yield* Effect.gen(function* () {
        const top = yield* guild.botTopRolePosition;
        const found = roles.find((r) => r.name === PING_ROLE && r.position < top);
        return found === undefined ? yield* guild.createRole(PING_ROLE) : found.id;
      });
  yield* Effect.log(`Venue ${name}: set up #${MATCH_CHANNEL} and @${PING_ROLE} in ${guild.name}`);
  return { name, guildId: guild.id, channelId, pingRoleId } satisfies VenueConfig;
});

/** The Venues the bot set up itself, by server; home is never among them. */
export class VenueRecords extends Context.Tag("multiballs/VenueRecords")<
  VenueRecords,
  {
    readonly byGuild: (guildId: string) => Effect.Effect<Option.Option<VenueConfig>>;
    /** Store a Venue, replacing what was stored for its server. */
    readonly put: (venue: VenueConfig) => Effect.Effect<void>;
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
    return VenueRecords.of({
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

/**
 * Make a server the bot is in a running Venue: set it up (or repair what is stored for it), store
 * it, and start it with `check`. A server it can't set up or that fails its check is left out
 * with a line to `alert` (the ops channel), so a second server can never take the bot down.
 */
export const joinVenue = Effect.fn("joinVenue")(function* <A, R>(
  guild: SetupGuild,
  check: (venue: VenueConfig) => Effect.Effect<A, VenueCheckFailed, R>,
  alert: (message: string) => Effect.Effect<void>,
) {
  const records = yield* VenueRecords;
  const leaveOut = (e: VenueSetupFailed | VenueCheckFailed) =>
    alert(`Multiballs left out the server ${guild.name} (${guild.id}): ${e.reason}`).pipe(
      Effect.as(Option.none<A>()),
    );
  return yield* Effect.gen(function* () {
    const venue = yield* setUpVenue(guild, yield* records.byGuild(guild.id));
    yield* records.put(venue);
    return Option.some(yield* check(venue));
  }).pipe(Effect.catchTags({ VenueSetupFailed: leaveOut, VenueCheckFailed: leaveOut }));
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
