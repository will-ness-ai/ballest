// The SetupGuild port (src/venues.ts) on discord.js: a server's channels and roles over REST (or
// from the cache, for `holds`), and the channel and role the bot makes there. Every Discord
// failure is the setup's, in one line.
import {
  ChannelType,
  type Client,
  type Guild,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwriteOptions,
} from "discord.js";
import { Effect } from "effect";
import {
  type ChannelAccess,
  type ServerPermission,
  type SetupGuild,
  VenueSetupFailed,
} from "../venues.js";
import { type DiscordError, describeDiscordError, discordKind, tryDiscord } from "./client.js";

const REASON = "Multiballs: its Match channel and ping role";

/** What setting a server up may need on the whole server: making the channel, the role and overwrites. */
const SERVER_PERMISSIONS: ReadonlyArray<readonly [ServerPermission, bigint]> = [
  ["Manage Channels", PermissionFlagsBits.ManageChannels],
  ["Manage Roles", PermissionFlagsBits.ManageRoles],
];

const failed = Effect.fn("SetupGuild.failed")(function* <A>(
  effect: Effect.Effect<A, DiscordError>,
) {
  return yield* effect.pipe(
    Effect.mapError(
      (e) => new VenueSetupFailed({ reason: describeDiscordError(e), kind: discordKind(e) }),
    ),
  );
});

/** Each flag set to `value`, as discord.js edits overwrites. */
const flags = (names: ReadonlyArray<string>, value: boolean): PermissionOverwriteOptions =>
  Object.fromEntries(names.map((name) => [name, value]));

export const setupGuildOn = (client: Client<true>, guild: Guild): SetupGuild => {
  return {
    id: guild.id,
    name: guild.name,
    joinedAt: Number.isFinite(guild.joinedTimestamp) ? guild.joinedTimestamp : null,
    holds: (venue) =>
      guild.channels.cache.has(venue.channelId) && guild.roles.cache.has(venue.pingRoleId),
    bot: failed(tryDiscord("fetch the bot's member", () => guild.members.fetchMe())).pipe(
      Effect.map((self) => ({
        missing: SERVER_PERMISSIONS.filter(([, flag]) => !self.permissions.has(flag)).map(
          ([name]) => name,
        ),
        topRolePosition: self.roles.highest.position,
      })),
    ),
    textChannels: failed(tryDiscord("fetch channels", () => guild.channels.fetch())).pipe(
      Effect.map((all) =>
        [...all.values()].flatMap((c) =>
          c?.type === ChannelType.GuildText ? [{ id: c.id, name: c.name }] : [],
        ),
      ),
    ),
    createTextChannel: Effect.fn("SetupGuild.createTextChannel")(function* (
      name: string,
      access: ChannelAccess,
    ) {
      const channel = yield* failed(
        tryDiscord("create channel", () =>
          guild.channels.create({
            name,
            type: ChannelType.GuildText,
            reason: REASON,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                type: OverwriteType.Role,
                deny: [...access.everyoneDenied],
              },
              { id: client.user.id, type: OverwriteType.Member, allow: [...access.botAllowed] },
            ],
          }),
        ),
      );
      return channel.id;
    }),
    setAccess: Effect.fn("SetupGuild.setAccess")(function* (
      channelId: string,
      access: ChannelAccess,
    ) {
      const channel = yield* failed(
        tryDiscord("fetch channel", () => guild.channels.fetch(channelId)),
      );
      if (channel?.type !== ChannelType.GuildText)
        return yield* new VenueSetupFailed({ reason: `${channelId} is not a text channel` });
      yield* failed(
        tryDiscord("set channel permissions", async () => {
          await channel.permissionOverwrites.edit(
            guild.roles.everyone,
            flags(access.everyoneDenied, false),
            { reason: REASON, type: OverwriteType.Role },
          );
          await channel.permissionOverwrites.edit(client.user.id, flags(access.botAllowed, true), {
            reason: REASON,
            type: OverwriteType.Member,
          });
        }),
      );
    }),
    roles: failed(tryDiscord("fetch roles", () => guild.roles.fetch())).pipe(
      Effect.map((all) =>
        [...all.values()].map((r) => ({ id: r.id, name: r.name, position: r.position })),
      ),
    ),
    // Discord puts a new role just above @everyone, so below the bot's own.
    createRole: Effect.fn("SetupGuild.createRole")(function* (name: string) {
      const role = yield* failed(
        tryDiscord("create role", () =>
          guild.roles.create({ name, mentionable: true, reason: REASON }),
        ),
      );
      return role.id;
    }),
  };
};
